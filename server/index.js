const express = require('express');
const path = require('path');
const fs = require('fs');
const { renderPdf, chromiumMissing } = require('./pdf');
const crypto = require('crypto');
const { db, seed, seedLeaders, migrate, migrateAmanaHelpers, tachkilaTemplate, SECTION_DEFS, sectionDef } = require('./db');

migrate();
seed();
seedLeaders();

const app = express();
app.set('trust proxy', 1);
// Answered by this very process only — the startup check below asks 127.0.0.1 for it
const instanceProbe = crypto.randomBytes(16).toString('hex');
app.use((req, res, next) =>
  req.headers['x-instance-probe'] === instanceProbe ? res.status(204).end() : next()
);
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});

// ---------- Auth ----------

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
};

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(password, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Granular permission catalog, grouped by page, as fine as the actions themselves: each
// key opens one thing. Dashboard is always allowed; accounts and their rights, the فرق
// themselves, the قادة files and accounts, التشكيلة and the settings stay admin-only.
// The twin catalog, with its wording, is PERM_GROUPS in client/src/pages/Admin.jsx.
const PERM_GROUPS = {
  members: [
    'members.read',
    // الهواتف و العناوين: معطيات شخصية
    'members.contact',
    // الصحة (E1): الحساسية، العلاج، موانع، السباحة، رقم الطوارئ — معطيات حساسة، لا تخرج
    // من الخادم بدونها. قادة المخيم يرونها لمشاركيه وحدهم، بلا هذه الصلاحية.
    'members.health',
    // سجل المتابعة: تسجيل اتصال بأهل العنصر (مكالمة، واتساب، زيارة) و الموعد التالي
    'members.followup',
    'members.create',
    'members.edit',
    // زيادة أو إلغاء مطلب لأي عنصر بشكل يدوي
    'members.matalib',
    // القبول: بنود فترة التجربة، و التكريس (فردي أو جماعي)
    'members.admission',
    'members.delete',
    // الاشتراك الشهري للعناصر (member_dues): رؤيته، ثم قبضه
    'members.dues.read',
    'members.dues.record',
    // G1 : tarif personnel ou exonération (fratrie, cas social), avec son motif
    'members.dues.exempt',
  ],
  sessions: [
    'sessions.read',
    'sessions.create',
    'sessions.edit',
    // الحضور، و القادة (المسؤول و المساعدون)، و الضيوف، و أعداد النشاط العام
    'sessions.attendance',
    'sessions.files',
    // أجرة النشاط و ما دُفع منها، و مصاريفه و تبرعاته
    'sessions.read.fees',
    'sessions.money',
    'sessions.delete',
  ],
  prep: ['prep.read', 'prep.manage', 'prep.delete'],
  events: [
    'events.read',
    // المخيم نفسه، برنامجه، هيئته القيادية، مشاركوه
    'events.manage',
    // الحضور في جلساته، و صوره و ملفاته
    'events.attendance',
    'events.read.fees',
    // قبض اشتراكات المشاركين
    'events.payments',
    // مصاريفه و تبرعاته
    'events.expenses',
    'events.delete',
  ],
  meetings: [
    'meetings.read',
    // المحضر كله: الحضور، جدول الأعمال، المقرّرات
    'meetings.manage',
    // متابعة المقرّرات وحدها: نُفِّذ، أُلغي، قيد التنفيذ
    'meetings.followup',
    'meetings.delete',
  ],
  // نتائج تقييم الأنشطة و المخيمات. التقييم نفسه لمن قاد النشاط أو أخذ في المخيم دورًا.
  evaluations: ['evaluations.read', 'evaluations.details'],
  // Reading الفرق, plus writing الخطة السنوية of a فرقة and its مجموعات.
  // branches.groups also moves عناصر between مجموعات: تقسيم الفرقة عمل قائدها،
  // و هو تنظيم داخلي لا يمسّ ملف العنصر، فلا يُشترط له members.edit.
  branches: ['branches.read', 'branches.plan', 'branches.groups'],
  promotions: ['promotions.read', 'promotions.apply'],
  // Reading التشكيلة, plus filling in بطاقة تقدم القائد. Creating, assigning and
  // deleting توصيفات stays admin-only.
  leaders: ['leaders.read', 'leaders.contact', 'leaders.progress.self', 'leaders.progress.manage'],
  // اشتراك القادة: يُمنح يدويًا لأشخاص بعينهم. مجموعة مستقلة كي لا يرثه من كانت
  // له صفحة القادة كاملة في صيغة الصلاحيات القديمة.
  dues: ['leaders.dues', 'leaders.dues.record'],
  // الصندوق: رصيد الفوج و حركاته. يُمنح يدويًا لأمين المال، عملًا عملًا: المصاريف و
  // المداخيل، التحويلات (بين الصناديق، و إلى المخيمات)، فتح الصناديق و عدّها.
  treasury: ['treasury.read', 'treasury.entries', 'treasury.transfers', 'treasury.counts'],
};
const ALL_PERMS = Object.values(PERM_GROUPS).flat();

// Write permissions are never useful without their corresponding read surface.
// Expanding them server-side prevents malformed combinations even if an old client
// or a direct API request bypasses the admin form.
const PERM_DEPENDENCIES = {
  'members.create': ['members.read'],
  'members.edit': ['members.read'],
  'members.delete': ['members.read'],
  'members.contact': ['members.read'],
  'members.followup': ['members.read'],
  'members.health': ['members.read'],
  'members.matalib': ['members.read'],
  'members.admission': ['members.read'],
  'members.dues.read': ['members.read'],
  'members.dues.record': ['members.dues.read'],
  'members.dues.exempt': ['members.dues.read'],
  'sessions.create': ['sessions.read'],
  'sessions.edit': ['sessions.read'],
  'sessions.attendance': ['sessions.read'],
  'sessions.files': ['sessions.read'],
  'sessions.read.fees': ['sessions.read'],
  'sessions.money': ['sessions.read.fees'],
  'sessions.delete': ['sessions.read'],
  'prep.manage': ['prep.read'],
  'prep.delete': ['prep.read'],
  'events.manage': ['events.read'],
  'events.attendance': ['events.read'],
  'events.read.fees': ['events.read'],
  'events.payments': ['events.read.fees'],
  'events.expenses': ['events.read.fees'],
  'events.delete': ['events.read'],
  'meetings.manage': ['meetings.read'],
  'meetings.followup': ['meetings.read'],
  'meetings.delete': ['meetings.read'],
  'evaluations.details': ['evaluations.read'],
  'branches.plan': ['branches.read'],
  'branches.groups': ['branches.read'],
  'promotions.apply': ['promotions.read', 'members.read'],
  'leaders.contact': ['leaders.read'],
  'leaders.progress.self': ['leaders.read'],
  'leaders.progress.manage': ['leaders.read'],
  'leaders.dues': ['leaders.read'],
  'leaders.dues.record': ['leaders.dues'],
  'treasury.entries': ['treasury.read'],
  'treasury.transfers': ['treasury.read'],
  'treasury.counts': ['treasury.read'],
};

// Keys of an older catalog, read as what they opened then. A stored list is rewritten
// once (migrateStoredPerms) — these only catch a list sent by an old client.
const PERM_ALIASES = {
  'leaders.progress': ['leaders.progress.self'],
  'treasury.manage': ['treasury.entries', 'treasury.transfers', 'treasury.counts'],
};

// The catalog of 2026-10-07, before its keys were split (2026-10-08): what each old key
// also opened, so an account keeps everything it could do. Applied once to every stored
// list (migrateStoredPerms). Rights that were the admin's alone (deleting a نشاط, a
// مخيم, a محضر, a بطاقة; the named detail of the evaluations) are not handed out.
const PERM_SPLIT_2026_10 = [
  // المخيمات، الاجتماعات، بطاقات التحضير و التقييم كانت تُقرأ بصلاحية الأنشطة
  [['sessions.read'], ['prep.read', 'events.read', 'meetings.read', 'evaluations.read']],
  [['sessions.create'], ['sessions.edit', 'prep.manage', 'events.manage', 'meetings.manage', 'meetings.followup']],
  [['sessions.attendance'], ['sessions.files', 'events.attendance']],
  [['sessions.read.fees'], ['events.read.fees', 'members.dues.read']],
  [['sessions.read.fees', 'sessions.attendance'], ['sessions.money', 'events.payments', 'members.dues.record']],
  [['sessions.read.fees', 'sessions.create'], ['events.payments', 'events.expenses']],
  [['treasury.read'], ['members.dues.read']],
  [['treasury.manage'], ['sessions.money', 'members.dues.record']],
  [['leaders.read'], ['leaders.contact']],
  [['leaders.dues'], ['leaders.dues.record']],
];

function expandPerms(keys) {
  const out = new Set(keys);
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...out])
      for (const dep of PERM_DEPENDENCIES[key] || [])
        if (!out.has(dep)) {
          out.add(dep);
          changed = true;
        }
  }
  return [...out];
}

// The pages of the first catalogs — a list of page names, then {page: level} — and the
// keys each one meant then: the whole page, or what its "view" level showed (phones and fees)
const LEGACY_PAGES = {
  members: ['members.read', 'members.create', 'members.edit', 'members.delete', 'members.contact', 'members.matalib'],
  sessions: ['sessions.read', 'sessions.create', 'sessions.attendance', 'sessions.read.fees'],
  branches: ['branches.read', 'branches.plan', 'branches.groups'],
  promotions: ['promotions.read', 'promotions.apply'],
  leaders: ['leaders.read', 'leaders.progress.self', 'leaders.progress.manage'],
};
const LEGACY_VIEW = {
  members: ['members.read', 'members.contact'],
  sessions: ['sessions.read', 'sessions.read.fees'],
  branches: ['branches.read'],
  promotions: ['promotions.read'],
  leaders: ['leaders.read'],
};

// Every key a stored value names, whatever its shape, old keys included as they are
function storedPermKeys(raw) {
  const out = new Set();
  if (Array.isArray(raw)) {
    for (const k of raw) {
      if (LEGACY_PAGES[k]) LEGACY_PAGES[k].forEach((p) => out.add(p));
      else if (typeof k === 'string') out.add(k);
    }
  } else if (raw && typeof raw === 'object') {
    for (const [page, level] of Object.entries(raw)) {
      if (level === 'edit' && LEGACY_PAGES[page]) LEGACY_PAGES[page].forEach((p) => out.add(p));
      else if (level === 'view' && LEGACY_VIEW[page]) LEGACY_VIEW[page].forEach((p) => out.add(p));
    }
  }
  return out;
}

// Whatever shape is stored or sent, the granular array of today's keys
function normalizePerms(raw) {
  if (!raw) return null;
  const out = new Set();
  for (const k of storedPermKeys(raw))
    for (const key of PERM_ALIASES[k] || [k]) if (ALL_PERMS.includes(key)) out.add(key);
  return expandPerms([...out]);
}

// A list stored before the split of 2026-10-08, with every right it gave kept
function splitStoredPerms(raw) {
  const old = storedPermKeys(raw);
  for (const [needs, gives] of PERM_SPLIT_2026_10)
    if (needs.every((k) => old.has(k))) gives.forEach((k) => old.add(k));
  return normalizePerms([...old]);
}

// Rights that were the admin's alone until the split. «Every right» (perms NULL) now
// includes them, so an account that had every right keeps exactly what it had.
const ADMIN_ONLY_BEFORE_SPLIT = ['sessions.delete', 'prep.delete', 'events.delete', 'meetings.delete', 'evaluations.details'];

// Once (user_version 4, after the 3 of db.js), every account's list rewritten in today's
// keys, keeping all it could do the day before — and nothing more.
function migrateStoredPerms() {
  if (db.pragma('user_version', { simple: true }) >= 4) return;
  const update = db.prepare('UPDATE users SET perms = ? WHERE id = ?');
  db.transaction(() => {
    for (const u of db.prepare("SELECT id, perms FROM users WHERE role != 'admin'").all()) {
      if (u.perms === null) {
        update.run(JSON.stringify(ALL_PERMS.filter((k) => !ADMIN_ONLY_BEFORE_SPLIT.includes(k))), u.id);
        continue;
      }
      let raw;
      try {
        raw = JSON.parse(u.perms);
      } catch {
        continue;
      }
      // JSON null: every right, as SQL NULL
      update.run(
        JSON.stringify(raw === null ? ALL_PERMS.filter((k) => !ADMIN_ONLY_BEFORE_SPLIT.includes(k)) : splitStoredPerms(raw)),
        u.id
      );
    }
    db.pragma('user_version = 4');
  })();
}
migrateStoredPerms();

// Once (user_version 5): members.admission is new (B1). An account that could already
// tick مطالب by hand (members.matalib) is the قائد who follows عناصره: he gets it too.
function grantAdmissionPerm() {
  if (db.pragma('user_version', { simple: true }) >= 5) return;
  const update = db.prepare('UPDATE users SET perms = ? WHERE id = ?');
  db.transaction(() => {
    for (const u of db.prepare("SELECT id, perms FROM users WHERE role != 'admin' AND perms IS NOT NULL").all()) {
      let list;
      try {
        list = JSON.parse(u.perms);
      } catch {
        continue;
      }
      if (Array.isArray(list) && list.includes('members.matalib') && !list.includes('members.admission'))
        update.run(JSON.stringify([...list, 'members.admission']), u.id);
    }
    db.pragma('user_version = 5');
  })();
}
grantAdmissionPerm();

// Once (user_version 6): members.followup is new (A2). Whoever could read the parents'
// phones (members.contact) is the قائد who calls them: he may write the call down too.
function grantFollowupPerm() {
  if (db.pragma('user_version', { simple: true }) >= 6) return;
  const update = db.prepare('UPDATE users SET perms = ? WHERE id = ?');
  db.transaction(() => {
    for (const u of db.prepare("SELECT id, perms FROM users WHERE role != 'admin' AND perms IS NOT NULL").all()) {
      let list;
      try {
        list = JSON.parse(u.perms);
      } catch {
        continue;
      }
      if (Array.isArray(list) && list.includes('members.contact') && !list.includes('members.followup'))
        update.run(JSON.stringify([...list, 'members.followup']), u.id);
    }
    db.pragma('user_version = 6');
  })();
}
grantFollowupPerm();

// Once (user_version 7): members.health is new (E1). The قائد who already edits his عناصر'
// files and reads their parents' phones (members.edit + members.contact) fills in their
// health too; nobody else gets it without the admin.
function grantHealthPerm() {
  if (db.pragma('user_version', { simple: true }) >= 7) return;
  const update = db.prepare('UPDATE users SET perms = ? WHERE id = ?');
  db.transaction(() => {
    for (const u of db.prepare("SELECT id, perms FROM users WHERE role != 'admin' AND perms IS NOT NULL").all()) {
      let list;
      try {
        list = JSON.parse(u.perms);
      } catch {
        continue;
      }
      if (Array.isArray(list) && list.includes('members.edit') && list.includes('members.contact') && !list.includes('members.health'))
        update.run(JSON.stringify([...list, 'members.health']), u.id);
    }
    db.pragma('user_version = 7');
  })();
}
grantHealthPerm();

// ---------- Usernames ----------
// A login name is typed on a phone keyboard, dictated over the phone and matched
// case-insensitively by SQLite's NOCASE (ASCII only). So: lowercase ASCII letters,
// digits, dot/underscore/hyphen, 3–32 chars, starting with a letter. Accounts made
// before this rule keep working; the admin page flags them so they can be renamed.
const USERNAME_RE = /^[a-z][a-z0-9._-]{2,31}$/;
const USERNAME_MAX = 32;

const normalizeUsername = (raw) =>
  String(raw ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

const usernameError = (name) => (USERNAME_RE.test(name) ? null : 'invalid_username');

// Arabic letters → Latin, one glyph at a time. Good enough to propose "ahmad.baydoun"
// from أحمد بيضون; the admin can still edit the result before saving.
const ARABIC_LATIN = {
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ٱ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j',
  'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's',
  'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l',
  'م': 'm', 'ن': 'n', 'ه': 'h', 'ة': 'a', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ئ': 'i', 'ؤ': 'u',
  'ء': '', 'ﻻ': 'la', 'گ': 'g', 'پ': 'p', 'چ': 'ch', 'ڤ': 'v',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

// Whole words first: letter-by-letter Arabic drops the short vowels ("ahmd"), so
// the names that come up all the time in the فوج get their usual Latin spelling.
const ARABIC_NAMES = {
  'احمد': 'ahmad', 'أحمد': 'ahmad', 'محمد': 'mohamad', 'محمود': 'mahmoud', 'حسين': 'hussein',
  'حسن': 'hassan', 'علي': 'ali', 'عباس': 'abbas', 'حيدر': 'haidar', 'عبد': 'abed', 'ابراهيم': 'ibrahim',
  'إبراهيم': 'ibrahim', 'يوسف': 'youssef', 'موسى': 'moussa', 'عيسى': 'issa', 'جعفر': 'jaafar',
  'كاظم': 'kazem', 'قاسم': 'kassem', 'مهدي': 'mahdi', 'رضا': 'rida', 'زين': 'zein', 'كريم': 'karim',
  'سامي': 'sami', 'رامي': 'rami', 'هادي': 'hadi', 'عادل': 'adel', 'خليل': 'khalil', 'جواد': 'jawad',
  'مصطفى': 'mostafa', 'صادق': 'sadek', 'باقر': 'baker', 'نبيل': 'nabil', 'وسام': 'wissam',
  'بلال': 'bilal', 'طارق': 'tarek', 'خالد': 'khaled', 'عمر': 'omar', 'أمير': 'amir', 'امير': 'amir',
  'فاطمة': 'fatima', 'فاطمه': 'fatima', 'زينب': 'zeinab', 'مريم': 'mariam', 'زهراء': 'zahraa',
  'الزهراء': 'zahraa', 'خديجة': 'khadija', 'سارة': 'sara', 'ساره': 'sara', 'نور': 'nour',
  'هدى': 'houda', 'رنا': 'rana', 'لينا': 'lina', 'دينا': 'dina', 'ريم': 'rim', 'حنان': 'hanan',
  'رقية': 'rokaya', 'آية': 'aya', 'ايه': 'aya', 'بتول': 'batoul', 'سكينة': 'soukaina', 'هبة': 'hiba',
  'ملاك': 'malak', 'جنى': 'jana', 'لمى': 'lama', 'ياسمين': 'yasmine', 'نادين': 'nadine',
  'بيضون': 'baydoun', 'حيدرأحمد': 'haidar.ahmad', 'مازح': 'mazeh', 'حمود': 'hammoud', 'فران': 'fran',
  'شهاب': 'chehab', 'خليفة': 'khalifeh', 'ناصر': 'nasser', 'سعد': 'saad', 'صالح': 'saleh',
  'عواضة': 'awada', 'فقيه': 'fakih', 'قانصو': 'kanso', 'حرب': 'harb', 'جابر': 'jaber', 'ضاهر': 'daher',
  'يونس': 'younes', 'شمس': 'chams', 'الدين': 'eddine', 'الله': 'allah',
};

function transliterate(text) {
  return String(text || '')
    .replace(/[ً-ْـ]/g, '') // tashkil + tatweel carry no letter
    .split(/(\s+)/)
    .map((word) => {
      const known = ARABIC_NAMES[word.trim()];
      if (known) return known;
      return word
        .split('')
        .map((ch) => (ch in ARABIC_LATIN ? ARABIC_LATIN[ch] : ch))
        .join('');
    })
    .join('');
}

// "Ahmad Baydoun" / "أحمد بيضون" → "ahmad.baydoun"; unusable input → "user"
function usernameBase(name) {
  const words = normalizeUsername(transliterate(name))
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let base = words.join('.').replace(/^[^a-z]+/, '');
  if (base.length > USERNAME_MAX) base = base.slice(0, USERNAME_MAX).replace(/[._-]+$/, '');
  if (base.length < 3) base = (base + 'user').slice(0, USERNAME_MAX);
  return base;
}

// First free variant of the base: ahmad.baydoun, ahmad.baydoun2, ahmad.baydoun3…
function suggestUsername(name, { exceptId = null } = {}) {
  const base = usernameBase(name);
  const taken = (candidate) => {
    const row = db.prepare('SELECT id FROM users WHERE username = ?').get(candidate);
    return row && row.id !== exceptId;
  };
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const candidate = base.slice(0, USERNAME_MAX - suffix.length) + suffix;
    if (!taken(candidate)) return candidate;
  }
  return base + crypto.randomBytes(2).toString('hex');
}

// كلمة سرّ تُولَّد و تُعرض مرّة واحدة. أحرف لا تلتبس ببعضها (لا 0/O و لا 1/l):
// ستُملى شفهيًا أو تُنسخ على هاتف.
function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i === 3 || i === 7) out += '-';
  }
  return out;
}

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  // Made before the username rule existed (spaces, Arabic, capitals): still logs in,
  // but the admin page suggests renaming it
  username_legacy: !USERNAME_RE.test(u.username || ''),
  display_name: u.display_name,
  role: u.role,
  // null = every فرقة; otherwise the branch ids this account may see
  branches: u.branches ? JSON.parse(u.branches) : null,
  // null = full access; otherwise the granular permission keys granted
  perms: u.perms ? normalizePerms(JSON.parse(u.perms)) : null,
  // القائد صاحب الحساب إن وُلّد من صفحة القادة
  leader_id: u.leader_id ?? null,
  leader_name: u.leader_name ?? null,
  // رمز القسم الذي حُصر فيه الحساب ('M' | 'F' | 'FR' | 'FRF')؛ null = كل الأقسام (و الأدمن دائمًا)
  section: u.role === 'admin' ? null : (u.section ?? null),
  active: u.active === undefined ? true : !!u.active,
  must_change_password: !!u.must_change_password,
});

const hasPerm = (req, key) =>
  req.user.role === 'admin' || !req.user.perms || req.user.perms.includes(key);

const requirePerm = (key) => (req, res, next) =>
  hasPerm(req, key) ? next() : res.status(403).json({ error: 'forbidden' });

// One of several permissions is enough — used where the same action is reachable
// from more than one page (adding a quartier while registering or while editing).
const requireAnyPerm = (...keys) => (req, res, next) =>
  keys.some((k) => hasPerm(req, k)) ? next() : res.status(403).json({ error: 'forbidden' });

const auditInsert = db.prepare(
  `INSERT INTO audit_events
    (actor_user_id, actor, action, entity_type, entity_id, before_json, after_json, session_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

// Rows written inside a نشاط carry its session_id: their lines belong to its history too
const AUDIT_IN_SESSION = new Set(['treasury_entry', 'member_due', 'session_evaluation']);

function auditSnapshot(value) {
  if (value === undefined || value === null) return null;
  const clean = { ...value };
  for (const key of ['password_hash', 'token', 'photo', 'consent_scan']) delete clean[key];
  const json = JSON.stringify(clean);
  return json.length > 20000 ? JSON.stringify({ truncated: true }) : json;
}

function auditEvent(req, action, entityType, entityId, before = null, after = null) {
  const sessionId =
    entityType === 'session'
      ? Number(entityId)
      : AUDIT_IN_SESSION.has(entityType)
        ? ((after ?? before)?.session_id ?? null)
        : null;
  auditInsert.run(
    req.user?.id || null,
    req.user?.display_name || req.user?.username || 'system',
    action,
    entityType,
    entityId === undefined || entityId === null ? null : String(entityId),
    auditSnapshot(before),
    auditSnapshot(after),
    sessionId
  );
}

// Coordinates are personal data: without members.contact they never leave the server
const CONTACT_FIELDS = ['member_phone', 'father_phone', 'mother_phone', 'address_abidjan', 'address_lebanon'];
function stripContact(req, m) {
  if (hasPerm(req, 'members.contact')) return stripHealth(req, stripDuesRate(req, m));
  const out = { ...m };
  for (const f of CONTACT_FIELDS) if (f in out) out[f] = null;
  return stripHealth(req, stripDuesRate(req, out));
}

// G1 : le tarif personnel et le motif d'une exonération (cas social) ne sortent pas
// sans members.dues.read
function stripDuesRate(req, m) {
  if (!m || hasPerm(req, 'members.dues.read') || !('dues_monthly' in m || 'dues_note' in m)) return m;
  const out = { ...m };
  delete out.dues_monthly;
  delete out.dues_note;
  delete out.dues_rate_from;
  return out;
}

// Health (E1) is more sensitive still: without members.health the fields are not even sent.
// The قادة of a camp read them for its participants through the camp page (eventHealth).
const HEALTH_FIELDS = [
  'allergies', 'treatment', 'medical_notes', 'can_swim', 'emergency_name', 'emergency_phone',
  'health_updated_at', 'health_updated_by',
];
function stripHealth(req, m) {
  if (!m || hasPerm(req, 'members.health')) return m;
  const out = { ...m };
  for (const f of HEALTH_FIELDS) delete out[f];
  return out;
}

// The same for a قائد's own, with leaders.contact
const LEADER_CONTACT_FIELDS = ['phone', 'address_abidjan', 'address_lebanon'];
function stripLeaderContact(req, l) {
  if (!l || hasPerm(req, 'leaders.contact')) return l;
  const out = { ...l };
  for (const f of LEADER_CONTACT_FIELDS) if (f in out) out[f] = null;
  return out;
}

// Money is its own permission, like contact info
const stripFee = (req, s) => (hasPerm(req, 'sessions.read.fees') ? s : { ...s, fee: null });

// الاشتراك المدفوع لكل عنصر مالٌ كذلك: يسقط مع الأجرة نفسها لمن لا يرى المبالغ
const stripRosterFees = (req, payload) =>
  hasPerm(req, 'sessions.read.fees')
    ? payload
    : {
        ...payload,
        roster: (payload.roster || []).map((m) => ({ ...m, paid: null })),
        subscriptions: null,
      };

// A session dies after 15 minutes without a request, so an unattended machine
// stops being a way in. Absolute cap on top: even an actively used session is
// re-authenticated once a day.
const IDLE_MS = 15 * 60 * 1000;
const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
// Every request would otherwise write a row; a coarse touch is enough to measure idleness
const TOUCH_MS = 30 * 1000;
const MIN_PASSWORD_LENGTH = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map();

const passwordError = (password) => {
  const value = String(password || '');
  if (value.length < MIN_PASSWORD_LENGTH) return 'password too short';
  if (value.length > 256) return 'password too long';
  return null;
};

function loginAttemptKey(req, username) {
  return `${req.ip || req.socket.remoteAddress || 'unknown'}:${String(username || '').trim().toLowerCase()}`;
}

function loginBlocked(key) {
  const now = Date.now();
  const row = loginAttempts.get(key);
  if (!row || now - row.startedAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return row.count >= LOGIN_MAX_ATTEMPTS;
}

function registerLoginFailure(key) {
  const now = Date.now();
  const row = loginAttempts.get(key);
  if (!row || now - row.startedAt > LOGIN_WINDOW_MS)
    loginAttempts.set(key, { count: 1, startedAt: now });
  else row.count += 1;
}

// SQLite stores UTC without a zone marker — Date.parse needs the Z spelled out
const sqlTime = (v) => (v ? Date.parse(v.replace(' ', 'T') + 'Z') : 0);

const dropExpiredTokens = db.prepare(
  `DELETE FROM auth_tokens
    WHERE COALESCE(last_seen_at, created_at) < datetime('now', ?) OR created_at < datetime('now', ?)`
);
const purgeExpired = () =>
  dropExpiredTokens.run(`-${IDLE_MS / 1000} seconds`, `-${MAX_SESSION_MS / 1000} seconds`);

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const attemptKey = loginAttemptKey(req, username);
  if (loginBlocked(attemptKey)) {
    res.setHeader('Retry-After', String(Math.ceil(LOGIN_WINDOW_MS / 1000)));
    return res.status(429).json({ error: 'too_many_attempts' });
  }
  const u = username && db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!u || !u.active || !verifyPassword(String(password || ''), u.password_hash)) {
    registerLoginFailure(attemptKey);
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  loginAttempts.delete(attemptKey);
  purgeExpired();
  const token = crypto.randomBytes(32).toString('hex');
  // last_seen_at is spelled out: on databases where the column arrived by
  // ALTER TABLE it has no default and would land NULL
  db.prepare(
    "INSERT INTO auth_tokens (token, user_id, last_seen_at) VALUES (?, ?, datetime('now'))"
  ).run(token, u.id);
  res.json({ token, user: { ...publicUser(u), absence_threshold: absenceThreshold() }, idleTimeoutMs: IDLE_MS });
});

// Every other /api route requires a valid, still-fresh token
app.use('/api', (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const row =
    token &&
    db
      .prepare(
        `SELECT u.*, t.last_seen_at AS token_last_seen, t.created_at AS token_created
           FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?`
      )
      .get(token);
  if (!row || !row.active) {
    if (token) db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
    return res.status(401).json({ error: 'unauthorized' });
  }

  const idleFor = Date.now() - sqlTime(row.token_last_seen || row.token_created);
  const age = Date.now() - sqlTime(row.token_created);
  if (idleFor > IDLE_MS || age > MAX_SESSION_MS) {
    db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
    return res.status(401).json({ error: 'session_expired' });
  }
  if (idleFor > TOUCH_MS)
    db.prepare("UPDATE auth_tokens SET last_seen_at = datetime('now') WHERE token = ?").run(token);

  req.user = publicUser(row);
  req.token = token;
  next();
});

app.post('/api/auth/logout', (req, res) => {
  db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(req.token);
  res.status(204).end();
});

// absence_threshold: the series of absences that asks for a call (A2), for every badge
app.get('/api/auth/me', (req, res) => res.json({ ...req.user, absence_threshold: absenceThreshold() }));

app.post('/api/auth/change-password', (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row || !verifyPassword(String(req.body?.current_password || ''), row.password_hash))
    return res.status(400).json({ error: 'invalid_current_password' });
  const err = passwordError(req.body?.new_password);
  if (err) return res.status(400).json({ error: err });
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
      hashPassword(String(req.body.new_password)),
      row.id
    );
    db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND token != ?').run(row.id, req.token);
  })();
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id)));
});

// A generated/default password is only a bootstrap credential. Until it is changed,
// the account may inspect itself and change the password, but no product data leaves.
app.use('/api', (req, res, next) => {
  if (!req.user.must_change_password) return next();
  const allowed = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'];
  return allowed.some((p) => req.originalUrl.startsWith(p))
    ? next()
    : res.status(403).json({ error: 'password_change_required' });
});

const requireAdmin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'admin_only' });

// ---------- الأقسام: الفتيان، الفتيات، الفرنكوفون ----------
// كل فرقة و كل قائد و كل نشاط و كل توصيف من قسم واحد (SECTION_DEFS في db.js). الحساب
// المحصور في قسم لا يرى من الأقسام الأخرى شيئًا — لا عناصرها و لا قادتها و لا أنشطتها
// و لا تشكيلتها. الأدمن (و الحساب الذي لا قسم له) يرى الأقسام كلها، و مبدّل القسم في
// الواجهة يحصر عرضه في أحدها بترويسة X-Section.
const SECTIONS = SECTION_DEFS.map((s) => s.code);
const parseSection = (v) => (SECTIONS.includes(v) ? v : null);

// ترتيب الأقسام في القوائم، ترتيبها في SECTION_DEFS: الفوج أولًا. الرموز ثابتة في
// الكود، فدمجها في نص الاستعلام آمن.
const sectionOrderSQL = (col) =>
  `CASE ${col} ${SECTIONS.map((s, i) => `WHEN '${s}' THEN ${i}`).join(' ')} ELSE ${SECTIONS.length} END`;

// قسم الطلب، أو null للقسمين معًا. قسم الحساب يغلب الترويسة دائمًا: حساب في قسم
// الفتيات لا يوسّع نطاقه بإرسال ترويسة أخرى.
function activeSection(req) {
  if (req.user.role !== 'admin' && req.user.section) return req.user.section;
  return parseSection(req.get('X-Section'));
}

const sectionOfBranch = (id) => db.prepare('SELECT section FROM branches WHERE id = ?').get(id)?.section ?? null;

// null = unrestricted; otherwise the Set of allowed branch ids: the account's فرق, cut
// down to the فرق of the request's قسم. Computed once per request — branchOk runs in loops.
function allowedBranches(req) {
  if (req.branchScope !== undefined) return req.branchScope;
  const own = req.user.role === 'admin' || !req.user.branches ? null : new Set(req.user.branches);
  const section = activeSection(req);
  let scope = own;
  if (section) {
    const ids = db.prepare('SELECT id FROM branches WHERE section = ?').all(section).map((r) => r.id);
    scope = new Set(own ? ids.filter((id) => own.has(id)) : ids);
  }
  req.branchScope = scope;
  return scope;
}

// القادة لا فرقة لهم، فيُحصرون بقسمهم هم. `section` مُتحقَّق منه، فدمجه في النص آمن.
const leaderScopeSQL = (req, alias = 'l') => {
  const section = activeSection(req);
  return section ? ` AND ${alias}.section = '${section}'` : '';
};
const leaderOk = (req, leader) => {
  const section = activeSection(req);
  return !section || leader.section === section;
};

// Is this branch (or a branch-less نشاط قادة, id = null) visible to the caller?
function branchOk(req, branchId) {
  const scope = allowedBranches(req);
  return !scope || branchId === null || branchId === undefined || scope.has(Number(branchId));
}

// SQL fragment `AND <col> IN (...)` limiting to the caller's فرق (branch-less rows pass)
function branchFilterSQL(req, col) {
  const scope = allowedBranches(req);
  if (!scope) return '';
  const ids = [...scope].map(Number).filter(Number.isInteger);
  return ` AND (${col} IS NULL OR ${col} IN (${ids.length ? ids.join(',') : -1}))`;
}

// ---------- فرق النشاط ----------
// نفس الحصّة تُعطى أحيانًا لفرقتين معًا، فتُسجَّل نشاطًا واحدًا يشمل الفرقتين. لذلك
// سؤال «هل يخصّ هذا النشاط الفرقة س؟» يُقرأ من session_branches، لا من sessions.branch_id
// الذي صار يعني الفرقة الرئيسية فقط. أرقام الفرق مُتحقَّق منها قبل أن تصل إلى هنا،
// فدمجها في نص الاستعلام آمن و يترك المعاملات الموضعية القائمة على حالها.

// اسم القائد الثلاثي في SQL. اسم الأب اختياري: COALESCE يجعل الاسم ثنائيًا حين يغيب
// بدل أن يصير NULL و يمحو الاسم كلّه.
const fullNameSQL = (alias) =>
  `${alias}.first_name || ' ' || COALESCE(${alias}.father_name || ' ', '') || ${alias}.last_name`;

// -1 لأي مُدخل ليس رقمًا صحيحًا: الاستعلام يبقى صالحًا و لا يطابق شيئًا
const intOr = (v) => (Number.isInteger(Number(v)) ? Number(v) : -1);

// "3,5" (GROUP_CONCAT) -> [3, 5]; NULL -> []
const parseIdList = (v) =>
  v === null || v === undefined || v === '' ? [] : String(v).split(',').map(Number).sort((a, b) => a - b);

const branchIdsOfSession = (sessionId) =>
  db
    .prepare('SELECT branch_id FROM session_branches WHERE session_id = ? ORDER BY branch_id')
    .all(sessionId)
    .map((r) => r.branch_id);

const sessionInBranchSQL = (branchId, alias = 's') =>
  `EXISTS (SELECT 1 FROM session_branches sb WHERE sb.session_id = ${alias}.id AND sb.branch_id = ${intOr(branchId)})`;

// صف حضور يُحتسب لفرقة: النشاط المشترك يوزّع حضوره حسب فرقة العنصر، بينما النشاط ذو
// الفرقة الواحدة يبقى محسوبًا لها بالكامل — و لو انتقل العنصر إلى فرقة أخرى لاحقًا.
const attendanceInBranchSQL = (branchId, sAlias = 's', aAlias = 'a') => {
  const id = intOr(branchId);
  return `(${sessionInBranchSQL(id, sAlias)} AND (
      (SELECT COUNT(*) FROM session_branches sb2 WHERE sb2.session_id = ${sAlias}.id) = 1
      OR COALESCE(${aAlias}.branch_id,
          (SELECT m2.branch_id FROM members m2 WHERE m2.id = ${aAlias}.member_id)) = ${id}))`;
};

// ---------- Séance «pointée» : la seule règle de comptage ----------
// Tous les عناصر sont créés «absent» : une séance jamais pointée ferait passer toute la
// فرقة pour absente. Une séance compte (taux, séries d'absences, مطالب, alertes) si sa
// présence a été validée, ou si elle est passée et qu'au moins un عنصر (ou un قائد, pour
// un نشاط قادة) y est marqué présent ou excusé. Celle du jour et les suivantes ne comptent
// qu'une fois validées. `today` : une date littérale, ou '?' dans une requête préparée.
// Mirrored by isCountedSession() on the client (lib/attendance.js).
function countedSessionSQL(s = 's', today = `'${todayISO()}'`) {
  return `(${s}.attendance_finalized_at IS NOT NULL OR (${s}.date < ${today} AND (
      EXISTS (SELECT 1 FROM attendance cnt_a WHERE cnt_a.session_id = ${s}.id AND cnt_a.status IN ('present', 'excused'))
      OR (${s}.kind = 'leaders' AND EXISTS (SELECT 1 FROM session_leaders cnt_l
            WHERE cnt_l.session_id = ${s}.id AND cnt_l.status IN ('present', 'excused'))))))`;
}
// «Présence non confirmée» : une séance à pointer, passée, qui ne compte pas
const POINTED_KINDS_SQL = (s = 's') => `${s}.kind IN ('activity', 'leaders')`;
function unconfirmedSessionSQL(s = 's', today = `'${todayISO()}'`) {
  return `(${POINTED_KINDS_SQL(s)} AND ${s}.date < ${today} AND NOT ${countedSessionSQL(s, today)})`;
}
// ---------- Suivi des absences (A2) ----------
// La série d'absences qui demande d'appeler la famille : 3 par défaut, réglable par
// l'admin (app_settings). Une même règle pour le badge, le filtre «للمتابعة», le tableau
// de bord et l'alerte push — calculée sur les seules séances qui comptent (countedSessionSQL).
const ABSENCE_THRESHOLD_DEFAULT = 3;
const appSettingStmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
function absenceThreshold() {
  const n = Number(appSettingStmt.get('absence_threshold')?.value);
  return Number.isInteger(n) && n >= 2 && n <= 10 ? n : ABSENCE_THRESHOLD_DEFAULT;
}
// Motif d'un absent ou d'un excusé, et d'un contact avec la famille. «dropout» (انقطاع)
// propose l'archivage côté client.
const ABSENCE_REASONS = ['illness', 'travel', 'study', 'family', 'dropout', 'other'];
const CONTACT_CHANNELS = ['call', 'whatsapp', 'visit', 'other'];
// Le dernier contact de chaque عنصر demandé : «contacté il y a X jours par Y», et la
// relance prévue — tant qu'elle n'est pas échue, la ligne passe au second plan
function lastContactsOf(memberIds) {
  const ids = [...new Set(memberIds.map(Number).filter(Number.isInteger))];
  const out = new Map();
  if (!ids.length) return out;
  const rows = db
    .prepare(
      `SELECT c.member_id, c.contacted_at, c.contacted_by, c.channel, c.reason, c.next_date
       FROM member_contacts c
       WHERE c.member_id IN (${ids.join(',')})
         AND c.id = (SELECT c2.id FROM member_contacts c2 WHERE c2.member_id = c.member_id
                     ORDER BY c2.contacted_at DESC, c2.id DESC LIMIT 1)`
    )
    .all();
  for (const r of rows) out.set(r.member_id, r);
  return out;
}

// The «À régulariser» queue only looks this far back: older gaps no longer ask anything
const TODO_WINDOW_DAYS = 90;
// Évaluation manquante : séance passée, son type a une grille, personne ne l'a notée
const todoEvalSQL = (s = 's') =>
  `(${s}.date < '${todayISO()}' AND EXISTS (SELECT 1 FROM eval_kind_forms k WHERE k.kind = ${s}.kind)
    AND NOT EXISTS (SELECT 1 FROM session_evaluations ev WHERE ev.session_id = ${s}.id))`;
// Finances non saisies : un frais est demandé, des présents, et aucun paiement noté
const todoFinancesSQL = (s = 's') =>
  `(${s}.date < '${todayISO()}' AND COALESCE(${s}.fee, 0) > 0
    AND EXISTS (SELECT 1 FROM attendance a2 WHERE a2.session_id = ${s}.id AND a2.status = 'present')
    AND NOT EXISTS (SELECT 1 FROM attendance a3 WHERE a3.session_id = ${s}.id AND a3.paid IS NOT NULL))`;

// SQL fragment limiting أنشطة to the caller's قسم and فرق — نشاط بلا فرقة (قادة / فوج)
// يمرّ إن كان من قسمه
function sessionScopeSQL(req, alias = 's') {
  const section = activeSection(req);
  const bySection = section ? ` AND ${alias}.section = '${section}'` : '';
  const scope = allowedBranches(req);
  if (!scope) return bySection;
  const ids = [...scope].map(Number).filter(Number.isInteger);
  const list = ids.length ? ids.join(',') : -1;
  return `${bySection} AND (${alias}.branch_id IS NULL OR EXISTS (
      SELECT 1 FROM session_branches sb WHERE sb.session_id = ${alias}.id AND sb.branch_id IN (${list})))`;
}

// هل يرى المستخدم هذا النشاط؟ من قسمه أولًا، ثم تكفي فرقة واحدة مشتركة بينه و بين فرق النشاط
function sessionOk(req, session) {
  const section = activeSection(req);
  if (section) {
    const own = session.section ?? db.prepare('SELECT section FROM sessions WHERE id = ?').get(session.id)?.section;
    if (own !== section) return false;
  }
  const scope = allowedBranches(req);
  if (!scope) return true;
  if (session.branch_id === null || session.branch_id === undefined) return true;
  return branchIdsOfSession(session.id).some((b) => scope.has(b));
}

// فرق النشاط التي يملك المستخدم صلاحية عليها: قائد الفرقة (أو مساعده) يضع حضور
// فرقته وحدها، فلا يكتب أحد حضور عناصر فرقة غيره في نشاط مشترك.
function myBranchesOfSession(req, sessionId) {
  const scope = allowedBranches(req);
  const all = branchIdsOfSession(sessionId);
  return scope ? all.filter((b) => scope.has(b)) : all;
}

// ---------- مجموعات الفرقة ----------
// الفرقة الكبيرة تُقسَّم إلى مجموعات يُوزَّع عليها العناصر يدويًا، فتُقام لكل مجموعة
// حصّتها الخاصة مع قائدها. النشاط يختار مجموعاته بعد فرقه: فرقةٌ اختيرت لها مجموعة
// أو أكثر لا يشارك منها إلا عناصرها، و فرقةٌ لم تُختر لها مجموعة تشارك كاملةً.
// هذه القاعدة هي التي تجعل كل نشاط قديم (بلا صفوف في session_groups) يبقى كما هو.

const groupIdsOfSession = (sessionId) =>
  db
    .prepare('SELECT group_id FROM session_groups WHERE session_id = ? ORDER BY group_id')
    .all(sessionId)
    .map((r) => r.group_id);

// الفرق التي حُصر النشاط فيها بمجموعات بعينها — بقيّة فرق النشاط تشارك كاملةً
const groupedBranchesOfSession = (sessionId) =>
  db
    .prepare(
      `SELECT DISTINCT g.branch_id FROM session_groups sg
       JOIN branch_groups g ON g.id = sg.group_id WHERE sg.session_id = ?`
    )
    .all(sessionId)
    .map((r) => r.branch_id);

// شرط SQL: هل يشارك هذا العنصر في النشاط؟ نشاطٌ بلا مجموعات يقبل الجميع.
function memberInSessionGroupsSQL(sessionId, alias = 'm') {
  const ids = groupIdsOfSession(sessionId);
  if (!ids.length) return '1=1';
  const groups = ids.map(intOr).join(',');
  const branches = groupedBranchesOfSession(sessionId).map(intOr).join(',');
  return `(${alias}.branch_id NOT IN (${branches}) OR ${alias}.group_id IN (${groups}))`;
}

// نفس القاعدة في JS، لحرس الكتابة: لا يُسجَّل حضور عنصر خارج مجموعات النشاط
function memberInSessionGroups(sessionId, member) {
  const ids = groupIdsOfSession(sessionId);
  if (!ids.length) return true;
  if (!groupedBranchesOfSession(sessionId).includes(member.branch_id)) return true;
  return ids.includes(member.group_id);
}

// مجموعات فرقة، و عدد عناصرها النشطين. طلائع السنّ أولًا بترتيب سنّها، ثم اليدوية
// بالترتيب الذي أُنشئت به.
const groupsOfBranch = (branchId) =>
  db
    .prepare(
      `SELECT g.id, g.branch_id, g.name, g.sort_order, g.age_from, g.age_to,
        (SELECT COUNT(*) FROM members m WHERE m.group_id = g.id AND m.status = 'active') AS member_count
       FROM branch_groups g WHERE g.branch_id = ?
       ORDER BY g.age_from IS NULL, g.age_from, g.sort_order, g.id`
    )
    .all(branchId);

// ---------- الطلائع حسب السنّ ----------
// سنّ السنة: ما يبلغه العنصر في السنة الميلادية التي بدأت فيها السنة الكشفية، أي تلك
// السنة ناقص سنة ميلاده. مواليد السنة الواحدة يبقون في طليعة واحدة طوال السنة الكشفية،
// كصفّ المدرسة، و يصعدون كلهم فئةً في أيلول. التوأم في client/src/lib/ageGroups.js:
// المعاينة هناك و القرار هنا، فيجب أن يبقيا متطابقين.
const ageYear = () => Number(currentScoutYear().slice(0, 4));

const isAgeGroup = (g) => Number.isInteger(g.age_from) && Number.isInteger(g.age_to);

// طليعة السنّ لتاريخ الميلاد هذا بين طلائع فرقته، أو null: لا تاريخ، أو لا طليعة بسنّ.
// خارج كل الفئات يذهب إلى الأقرب — الأصغر من الجميع إلى أولاها، و من تجاوز آخرها و لم
// يُرفَّع بعد يبقى فيها — فلا يبقى عنصرٌ له تاريخ ميلاد بلا طليعة.
function ageGroupFor(birthDate, groups, year = ageYear()) {
  const born = Number(String(birthDate || '').slice(0, 4));
  if (!born) return null;
  const age = year - born;
  let best = null;
  let bestGap = Infinity;
  for (const g of groups.filter(isAgeGroup).sort((a, b) => a.age_from - b.age_from)) {
    const gap = age < g.age_from ? g.age_from - age : age >= g.age_to ? age - g.age_to + 1 : 0;
    if (gap < bestGap) {
      best = g;
      bestGap = gap;
    }
  }
  return best;
}

// طليعة السنّ في فرقةٍ ينتقل إليها العنصر (ترفيع أو إلغاؤه) — null إن لم يكن لها طلائع بسنّ
const ageGroupIdFor = (birthDate, branchId) =>
  ageGroupFor(birthDate, db.prepare('SELECT id, age_from, age_to FROM branch_groups WHERE branch_id = ?').all(branchId))
    ?.id ?? null;

// الفئة العمرية كما تُرسَل: السنّان معًا، أو كلاهما فارغ (طليعة يدوية). undefined = لم
// تُذكر في الطلب، فتبقى كما هي.
function parseAgeRange(body) {
  const { age_from: from, age_to: to } = body || {};
  if (from === undefined && to === undefined) return undefined;
  const blank = (v) => v === null || v === undefined || v === '';
  if (blank(from) && blank(to)) return { age_from: null, age_to: null };
  const a = Number(from);
  const b = Number(to);
  if (blank(from) || blank(to) || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > 99 || b <= a)
    return { error: 'invalid_age_range' };
  return { age_from: a, age_to: b };
}

// طليعة سنٍّ أخرى من الفرقة تتقاطع فئتها مع هذه؟ التقاطع يجعل التوزيع حسب السنّ مبهمًا
const ageRangeClash = (branchId, range, exceptId = 0) =>
  range.age_from === null
    ? null
    : db
        .prepare(
          `SELECT name FROM branch_groups
            WHERE branch_id = ? AND id != ? AND age_from IS NOT NULL AND age_to IS NOT NULL
              AND age_from < ? AND ? < age_to
            LIMIT 1`
        )
        .get(branchId, exceptId, range.age_to, range.age_from);

// المجموعة صالحة لعنصر في هذه الفرقة؟ '' و null و undefined كلها «بلا مجموعة».
// يُعيد undefined إذا كانت المجموعة غير موجودة أو من فرقة أخرى.
function resolveGroupId(raw, branchId) {
  if (raw === undefined || raw === null || raw === '') return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const g = db.prepare('SELECT branch_id FROM branch_groups WHERE id = ?').get(id);
  if (!g || Number(g.branch_id) !== Number(branchId)) return undefined;
  return id;
}

// ---------- Users (admin) ----------

function parseBranchList(v) {
  if (v === null || v === undefined || v === '') return null;
  if (!Array.isArray(v) || !v.every((n) => Number.isInteger(n))) return undefined;
  const ids = [...new Set(v)];
  if (ids.some((id) => !db.prepare('SELECT id FROM branches WHERE id = ?').get(id))) return undefined;
  // [] deliberately means no branch. Only an explicit null means unrestricted.
  return JSON.stringify(ids);
}

// قسم الحساب كما يُرسَل: رمز قسم، أو null لكل الأقسام. undefined = قيمة فاسدة.
function parseUserSection(v) {
  if (v === null || v === '') return null;
  return parseSection(v) ?? undefined;
}

// فرق الحساب من قسمه وحده: حساب الفتيات المقيَّد بفرقة من الفتيان لا يرى شيئًا،
// و ذاك خطأ في النموذج لا نيّة — يُرفض بدل أن يُحفظ حسابٌ فارغ
function branchesFitSection(branchesJson, section) {
  if (!section || !branchesJson) return true;
  return JSON.parse(branchesJson).every((id) => sectionOfBranch(id) === section);
}

// Same contract as parseBranchList: null = unrestricted, undefined = invalid input.
// Accepts every historical shape; stores the granular key array.
function parsePermList(v) {
  if (v === null || v === undefined || v === '') return null;
  if (
    Array.isArray(v) &&
    !v.every((k) => typeof k === 'string' && (ALL_PERMS.includes(k) || PERM_ALIASES[k] || LEGACY_PAGES[k]))
  )
    return undefined;
  if (!Array.isArray(v) && typeof v !== 'object') return undefined;
  const keys = normalizePerms(v);
  // Every permission granted = no restriction
  return keys.length === ALL_PERMS.length ? null : JSON.stringify(keys);
}

// ---------- Accès ↔ التشكيلة (I4) ----------
// users.branches is typed by hand; the التشكيلة moves every year. For an account
// linked to a قائد, the فرق of his توصيفات in the latest تشكيلة year are what his
// access (and his notification audience, push.js) should be. Nothing is changed
// silently except an account that was already aligned: it follows the تشكيلة.

// فرق القائد في تشكيلة السنة الأخيرة، مرتّبة؛ من قسم الحساب وحده إن حُصر فيه
function tachkilaBranchIds(leaderId, section = null, year = latestYear()) {
  if (!leaderId || !year) return [];
  return db
    .prepare(
      `SELECT DISTINCT a.branch_id AS id FROM assignments a JOIN branches b ON b.id = a.branch_id
        WHERE a.year = ? AND a.leader_id = ?${section ? ' AND b.section = ?' : ''} ORDER BY a.branch_id`
    )
    .all(...(section ? [year, leaderId, section] : [year, leaderId]))
    .map((r) => r.id);
}

const sameIds = (a, b) => {
  const sa = [...a].map(Number).sort((x, y) => x - y);
  const sb = [...b].map(Number).sort((x, y) => x - y);
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
};

// État d'un compte face à la تشكيلة:
//  'archived' — القائد مؤرشف أو غير نشط (أو محذوف)
//  'absent'   — لا توصيف له في تشكيلة السنة
//  'amana'    — توصيفات بلا فرقة (أمانة): لا شيء يُقارن
//  'all'      — الحساب يرى كل الفرق: لا يُقيَّد تلقائيًا
//  'drift'    — فرق الحساب ≠ فرق التشكيلة
//  'ok'
function tachkilaStatus(u, year = latestYear()) {
  if (!u.leader_id || u.role === 'admin') return null;
  const leader = db.prepare('SELECT status, archived_at FROM leaders WHERE id = ?').get(u.leader_id);
  const ids = tachkilaBranchIds(u.leader_id, u.section, year);
  const base = { tachkila_year: year, assignment_branch_ids: ids };
  if (!leader || leader.archived_at || leader.status !== 'active') return { ...base, tachkila_status: 'archived' };
  const inYear =
    year && db.prepare('SELECT 1 FROM assignments WHERE year = ? AND leader_id = ? LIMIT 1').get(year, u.leader_id);
  if (!inYear) return { ...base, tachkila_status: 'absent' };
  if (ids.length === 0) return { ...base, tachkila_status: 'amana' };
  if (!u.branches) return { ...base, tachkila_status: 'all' };
  return { ...base, tachkila_status: sameIds(JSON.parse(u.branches), ids) ? 'ok' : 'drift' };
}

function alignAccount(req, u, ids) {
  const json = JSON.stringify(ids);
  if (u.branches === json) return false;
  db.prepare('UPDATE users SET branches = ? WHERE id = ?').run(json, u.id);
  auditEvent(req, 'update', 'user', u.id, publicUser(u), publicUser(userById(u.id)));
  return true;
}

// Route middleware for every تشكيلة write: the linked accounts aligned before the
// change are re-aligned after it (only when the write succeeded and the قائد still
// has فرق — an emptied تشكيلة never empties an account; the badge shows it instead).
function followTachkila(req, res, next) {
  const year = latestYear();
  const aligned = db
    .prepare("SELECT * FROM users WHERE leader_id IS NOT NULL AND role != 'admin' AND active = 1 AND branches IS NOT NULL")
    .all()
    .filter((u) => tachkilaStatus(u, year)?.tachkila_status === 'ok')
    .map((u) => u.id);
  if (aligned.length === 0) return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    try {
      for (const id of aligned) {
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!u || !u.active || !u.branches) continue;
        const ids = tachkilaBranchIds(u.leader_id, u.section);
        if (ids.length > 0) alignAccount(req, u, ids);
      }
    } catch (e) {
      console.error('tachkila follow failed:', e.message);
    }
  });
  next();
}

// Active accounts first; the deactivated ones sit in their own section on the page
const USER_LIST_SQL = `
  SELECT u.*, (SELECT ${fullNameSQL('l')} FROM leaders l WHERE l.id = u.leader_id) AS leader_name
    FROM users u ORDER BY u.active DESC, u.username`;
const userById = (id) =>
  db
    .prepare(
      `SELECT u.*, (SELECT ${fullNameSQL('l')} FROM leaders l WHERE l.id = u.leader_id) AS leader_name
         FROM users u WHERE u.id = ?`
    )
    .get(id);

app.get('/api/users', requireAdmin, (req, res) => {
  const year = latestYear();
  res.json(db.prepare(USER_LIST_SQL).all().map((u) => ({ ...publicUser(u), ...(tachkilaStatus(u, year) || {}) })));
});

// «Aligner» : les فرق du compte = celles de sa تشكيلة. `ids` = some accounts; none =
// every active account in drift. 'all' / 'amana' / 'absent' / 'archived' are never
// touched: those need the admin's judgment, not a button.
app.post('/api/users/sync-branches', requireAdmin, (req, res) => {
  const only = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  if (req.body?.ids !== undefined && !only) return res.status(400).json({ error: 'invalid ids' });
  const year = latestYear();
  const rows = db.prepare("SELECT * FROM users WHERE leader_id IS NOT NULL AND role != 'admin' AND active = 1").all();
  const updated = [];
  db.transaction(() => {
    for (const u of rows) {
      if (only && !only.includes(u.id)) continue;
      const st = tachkilaStatus(u, year);
      if (st?.tachkila_status !== 'drift') continue;
      if (alignAccount(req, u, st.assignment_branch_ids)) updated.push(u.id);
    }
  })();
  res.json({ updated: updated.length, ids: updated, year });
});

// What the form fills in while the admin types a display name. `except` = the
// account being edited, so its own current name never counts as taken.
app.get('/api/users/username-suggestion', requireAdmin, (req, res) => {
  const except = Number(req.query.except);
  res.json({
    username: suggestUsername(String(req.query.name || ''), {
      exceptId: Number.isInteger(except) ? except : null,
    }),
  });
});

const lastActiveAdmin = (u) =>
  u.role === 'admin' &&
  u.active &&
  db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n <= 1;

// A password is generated unless the caller sends one. Either way the account
// must replace it at first login, and the clear text is returned exactly once.
app.post('/api/users', requireAdmin, (req, res) => {
  const { display_name, role } = req.body;
  const username = req.body.username
    ? normalizeUsername(req.body.username)
    : suggestUsername(String(display_name || ''));
  const nameErr = usernameError(username);
  if (nameErr) return res.status(400).json({ error: nameErr });
  const generated = !req.body.password;
  const password = generated ? generatePassword() : String(req.body.password);
  const passErr = passwordError(password);
  if (passErr) return res.status(400).json({ error: passErr });
  if (!['admin', 'user'].includes(role || 'user')) return res.status(400).json({ error: 'invalid role' });
  const branches = parseBranchList(req.body.branches);
  if (branches === undefined) return res.status(400).json({ error: 'invalid branches' });
  const perms = parsePermList(req.body.perms);
  if (perms === undefined) return res.status(400).json({ error: 'invalid perms' });
  // A request that says nothing lands in قسم الفتيان, the narrower choice: seeing both
  // sections has to be asked for (section: null)
  const section =
    role === 'admin' ? null : req.body.section === undefined ? 'M' : parseUserSection(req.body.section);
  if (section === undefined) return res.status(400).json({ error: 'invalid section' });
  if (!branchesFitSection(branches, section)) return res.status(400).json({ error: 'branch_outside_section' });
  try {
    const info = db
      .prepare(
        `INSERT INTO users
          (username, password_hash, display_name, role, branches, perms, section, active, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`
      )
      .run(
        username,
        hashPassword(password),
        String(display_name || '').trim() || null,
        role || 'user',
        branches,
        perms,
        section
      );
    const created = userById(info.lastInsertRowid);
    auditEvent(req, 'create', 'user', created.id, null, publicUser(created));
    res.status(201).json({ ...publicUser(created), ...(generated ? { password } : {}) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'username_taken' });
    throw e;
  }
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'user not found' });
  const role = req.body.role ?? u.role;
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  const active = req.body.active === undefined ? !!u.active : !!req.body.active;
  // An admin cannot lock themselves out, and the last admin cannot be demoted
  // either, or the admin page becomes unreachable
  if (u.id === req.user.id && (!active || role !== 'admin'))
    return res.status(400).json({ error: 'cannot_edit_self' });
  if ((role !== 'admin' || !active) && lastActiveAdmin(u)) return res.status(400).json({ error: 'last_admin' });
  // Renaming applies the new rule; an untouched legacy name stays as it is
  let username = u.username;
  if (req.body.username !== undefined && normalizeUsername(req.body.username) !== u.username) {
    username = normalizeUsername(req.body.username);
    const nameErr = usernameError(username);
    if (nameErr) return res.status(400).json({ error: nameErr });
  }
  const branches =
    req.body.branches === undefined ? u.branches : parseBranchList(req.body.branches);
  if (branches === undefined && req.body.branches !== undefined)
    return res.status(400).json({ error: 'invalid branches' });
  const perms = req.body.perms === undefined ? u.perms : parsePermList(req.body.perms);
  if (perms === undefined && req.body.perms !== undefined)
    return res.status(400).json({ error: 'invalid perms' });
  const section =
    role === 'admin' ? null : req.body.section === undefined ? u.section : parseUserSection(req.body.section);
  if (section === undefined) return res.status(400).json({ error: 'invalid section' });
  if (!branchesFitSection(branches, section)) return res.status(400).json({ error: 'branch_outside_section' });
  let password_hash = u.password_hash;
  let mustChange = u.must_change_password || 0;
  // reset_password: a fresh generated one, shown once in the response
  let newPassword = null;
  if (req.body.reset_password) newPassword = generatePassword();
  else if (req.body.password) newPassword = String(req.body.password);
  if (newPassword !== null) {
    const passErr = passwordError(newPassword);
    if (passErr) return res.status(400).json({ error: passErr });
    password_hash = hashPassword(newPassword);
    mustChange = 1;
  }
  try {
    db.prepare(
      `UPDATE users SET username = ?, display_name = ?, role = ?, branches = ?, perms = ?, section = ?,
         password_hash = ?, active = ?, must_change_password = ? WHERE id = ?`
    ).run(
      username,
      req.body.display_name === undefined ? u.display_name : String(req.body.display_name || '').trim() || null,
      role,
      branches,
      perms,
      section,
      password_hash,
      active ? 1 : 0,
      mustChange,
      u.id
    );
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'username_taken' });
    throw e;
  }
  // A password change or a deactivation kicks that user's devices out
  if (newPassword !== null || !active) db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(u.id);
  const updated = userById(u.id);
  auditEvent(req, 'update', 'user', u.id, publicUser(u), publicUser(updated));
  res.json({ ...publicUser(updated), ...(req.body.reset_password ? { password: newPassword } : {}) });
});

// Default: deactivate (the account stays listed, can be reactivated, keeps its
// audit trail). `?permanent=1` removes the row: tokens cascade, audit rows keep
// the actor's name but lose the id.
app.delete('/api/users/:id', requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'cannot_delete_self' });
  const user = userById(req.params.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  if (lastActiveAdmin(user)) return res.status(400).json({ error: 'last_admin' });
  const permanent = ['1', 'true'].includes(String(req.query.permanent || ''));
  if (permanent) {
    db.transaction(() => {
      db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    })();
    auditEvent(req, 'delete', 'user', user.id, publicUser(user), null);
    return res.status(204).end();
  }
  db.transaction(() => {
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(user.id);
    db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(user.id);
  })();
  auditEvent(req, 'deactivate', 'user', user.id, publicUser(user), { ...publicUser(user), active: false });
  res.status(204).end();
});

const todayISO = () => new Date().toISOString().slice(0, 10);

function calcAge(birthDate, ref = new Date()) {
  // تاريخ الميلاد اختياري: بلا تاريخ لا سنّ، لا رقمٌ مختلق
  if (!birthDate) return null;
  const b = new Date(birthDate + 'T00:00:00');
  let age = ref.getFullYear() - b.getFullYear();
  const m = ref.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) age--;
  return age;
}

const getBranches = () => db.prepare('SELECT * FROM branches ORDER BY sort_order').all();

// Branch whose age range contains `age`; if none, the highest branch the member qualifies for
function targetBranchFor(age, branches) {
  const containing = branches.filter(
    (b) => age >= b.min_age && (b.max_age === null || age <= b.max_age)
  );
  if (containing.length) return containing[containing.length - 1];
  const below = branches.filter((b) => b.min_age <= age);
  return below.length ? below[below.length - 1] : null;
}

// عتبة الترفيع لفرقة (% من مطالبها). NULL — فرقة أُنشئت بعد ملء الهجرة — تأخذ قيمة
// montadamahdi: 60 للبراعم و الأشبال، 70 لغيرهما. 0 = بلا عتبة.
function defaultThreshold(nameAr) {
  return /أشبال|براعم/.test(nameAr || '') ? 60 : 70;
}
const branchThreshold = (b) =>
  b.promotion_threshold === null || b.promotion_threshold === undefined
    ? defaultThreshold(b.name_ar)
    : b.promotion_threshold;

// مطالب X/Y و نسبتها، و هل بلغ العتبة. فرقة بلا مطالب (total 0) أو بلا عتبة: جاهز.
function matalibProgress(memberId, branch) {
  const total = branch.total_requirements || 0;
  const earned = earnedNumbersInBranch(memberId, branch.id).filter((n) => !total || n <= total);
  const pct = total ? Math.round((earned.length / total) * 100) : null;
  const threshold = branchThreshold(branch);
  return {
    earned_count: earned.length,
    total,
    pct,
    threshold,
    ready: !total || !threshold || pct >= threshold,
  };
}

function pendingPromotions() {
  // فرقة كل الأعمار خارج سلّم السنّ: عناصرها يبقون فيها، و لا يُرقّى إليها أحد.
  // عنصرٌ فيها يسقط أدناه عند !cur.
  const branches = getBranches().filter((b) => !b.all_ages);
  const byId = Object.fromEntries(branches.map((b) => [b.id, b]));
  // لكل قسم سلّمه: فتاةٌ في فرقة من الفتيات تُرفَّع إلى الفرقة التالية من الفتيات، لا
  // إلى فرقة الفتيان التي في سنّها
  const ladders = Object.fromEntries(SECTIONS.map((s) => [s, branches.filter((b) => b.section === s)]));
  // موقع كل فرقة في الفوج — الترقية تصعد فقط، و المقارنة بالموقع لا بالسنّ
  const rank = new Map(branches.map((b, i) => [b.id, i]));
  const members = db.prepare("SELECT * FROM members WHERE status = 'active'").all();
  const out = [];
  for (const m of members) {
    const cur = byId[m.branch_id];
    if (!cur || cur.max_age === null) continue;
    const age = calcAge(m.birth_date);
    // بلا تاريخ ميلاد لا يُعرف السنّ، فلا تُقترح ترفيعة: الفرقة تُغيَّر يدويًا من ملفّه
    if (age === null) continue;
    // حدود الفرق متقاطعة قصدًا (الكشافة ١٢–١٤، الجوالة ١٤–١٨): ابن الأربعة عشر
    // بلغ أدنى سنّ الجوالة و هو بعدُ في سنّ الكشافة. فالترقية تُقترح ببلوغ الفرقة
    // الأعلى لا بتجاوز أقصى سنّ فرقته — و إلا ظلّ المتقاطعون بلا ترقية أبدًا.
    const target = targetBranchFor(age, ladders[cur.section] || []);
    // فرقة أدنى تعني عنصرًا وُضع فوق سنّه: ذاك تصحيح يدوي لا ترقية
    if (!target || rank.get(target.id) <= rank.get(cur.id)) continue;
    out.push({
      id: m.id,
      first_name: m.first_name,
      father_name: m.father_name,
      last_name: m.last_name,
      photo: m.photo,
      // يحدّد طليعة سنّه في الفرقة التي يُرفَّع إليها
      birth_date: m.birth_date,
      age,
      current_branch: cur,
      target_branch: target,
      ...matalibProgress(m.id, cur),
    });
  }
  return out;
}

/**
 * Active members whose birthday falls today or tomorrow.
 * Only the month-day is compared, so the reminder fires every year, and the
 * window is deliberately one day so nobody is warned too early.
 */
function upcomingBirthdays() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const md = (d) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const wanted = { [md(now)]: 'today', [md(tomorrow)]: 'tomorrow' };

  const members = db
    .prepare(
      `SELECT m.id, m.first_name, m.father_name, m.last_name, m.photo, m.birth_date, m.branch_id,
              b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
         FROM members m LEFT JOIN branches b ON b.id = m.branch_id
        WHERE m.status = 'active' AND substr(m.birth_date, 6, 5) IN (?, ?)`
    )
    .all(md(now), md(tomorrow));
  // القادة أعضاء أيضًا: عيد ميلادهم يُذكَر مثل أي عنصر. بلا فرقة، فيمرّون من
  // فلترة الفرق لكل المستخدمين — و يُفرزون بقسمهم (section) — و kind يُوجّه الرابط
  // إلى ملف القائد.
  const leaders = db
    .prepare(
      `SELECT l.id, l.first_name, l.father_name, l.last_name, l.photo, l.birth_date, l.section,
              NULL AS branch_id, NULL AS branch_name_fr, NULL AS branch_name_ar
         FROM leaders l
        WHERE l.status = 'active' AND substr(l.birth_date, 6, 5) IN (?, ?)`
    )
    .all(md(now), md(tomorrow))
    .map((l) => ({ ...l, kind: 'leader' }));
  return [...members, ...leaders]
    .map((m) => {
      const when = wanted[m.birth_date.slice(5)];
      const ref = when === 'today' ? now : tomorrow;
      return { ...m, when, turning: ref.getFullYear() - Number(m.birth_date.slice(0, 4)) };
    })
    .sort((a, b) => (a.when === b.when ? 0 : a.when === 'today' ? -1 : 1));
}

// مطالب added or cancelled by hand for one عنصر in a given فرقة
const manualMatalib = (memberId, branchId) =>
  db
    .prepare(
      'SELECT number, state, updated_at, updated_by FROM member_matalib WHERE member_id = ? AND branch_id = ? ORDER BY number'
    )
    .all(memberId, branchId);

// Distinct matalib numbers earned by a member in sessions of a given branch,
// then corrected by the manual grants / cancellations a قائد recorded.
function earnedNumbersInBranch(memberId, branchId) {
  const rows = db
    .prepare(
      `SELECT s.matalib FROM attendance a JOIN sessions s ON s.id = a.session_id
       WHERE a.member_id = ? AND a.status = 'present' AND s.kind = 'activity'
         AND ${sessionInBranchSQL(branchId)} AND ${countedSessionSQL('s')}`
    )
    .all(memberId);
  const set = new Set();
  for (const r of rows) JSON.parse(r.matalib || '[]').forEach((n) => set.add(n));
  for (const m of manualMatalib(memberId, branchId)) {
    if (m.state === 'granted') set.add(m.number);
    else set.delete(m.number);
  }
  return [...set].sort((a, b) => a - b);
}

// زيارات الأهل a member received, newest first, with the قادة who took part
function familyVisits(memberId) {
  return db
    .prepare(
      `SELECT s.id AS session_id, s.title, s.date,
        (SELECT GROUP_CONCAT(${fullNameSQL('l')}, ' · ')
         FROM session_leaders sl JOIN leaders l ON l.id = sl.leader_id
         WHERE sl.session_id = s.id) AS leaders
       FROM attendance a JOIN sessions s ON s.id = a.session_id
       WHERE a.member_id = ? AND a.status = 'present' AND s.kind = 'visit'
       ORDER BY s.date DESC, s.id DESC`
    )
    .all(memberId);
}

// ---------- الاشتراكات المالية ----------
// المبلغ يسكن صف الحضور (attendance.paid): هو اشتراك هذا العنصر في هذا النشاط،
// و المجاميع كلها تُحسب منه عند القراءة — لا يُخزَّن مجموع، فلا يشيخ رقمٌ حين
// يُصحَّح مبلغ أو يُلغى.

// كل ما دفعه عنصر اشتراكاتٍ، من أوّل نشاط إلى آخره — تراكمي عبر الفرق كلها
function memberSubscriptions(memberId) {
  const history = db
    .prepare(
      `SELECT s.id AS session_id, s.date, s.title, s.kind, a.paid AS amount
       FROM attendance a JOIN sessions s ON s.id = a.session_id
       WHERE a.member_id = ? AND a.paid IS NOT NULL
       ORDER BY s.date DESC, s.id DESC`
    )
    .all(memberId);
  return { total: history.reduce((n, r) => n + r.amount, 0), count: history.length, history };
}

// حصيلة نشاط واحد. payers = من دفع، roster_total = كل من في اللائحة
const sessionSubscriptions = (sessionId) =>
  db
    .prepare(
      `SELECT COUNT(paid) AS payers, COALESCE(SUM(paid), 0) AS collected, COUNT(*) AS roster_total
       FROM attendance WHERE session_id = ?`
    )
    .get(sessionId);

// مبلغ اشتراك مقبول: رقم موجب، أو NULL حين يُلغى التسجيل («لم يدفع»).
// undefined = مرفوض. النصّ يُقبل لأن الحقل في الواجهة نصّي.
function parsePaid(v) {
  if (v === null || v === '') return null;
  if (typeof v !== 'number' && typeof v !== 'string') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

// Visits are deliberately excluded: a زيارة الأهل is not an activity the عنصر
// attended, so counting it would inflate every présence rate.
// totaux, taux et série d'absences à partir de lignes déjà triées (récentes d'abord)
function statsFromRows(rows) {
  const total = rows.length;
  const present = rows.filter((r) => r.status === 'present').length;
  let streak = 0;
  for (const r of rows) {
    if (r.status === 'absent') streak++;
    else break;
  }
  return {
    history: rows,
    total,
    present,
    rate: total ? Math.round((present / total) * 100) : null,
    consecutive_absences: streak,
  };
}

// كل صفّ حضور يُنسب إلى فرقة نشاطه: نشاط فرقة واحدة يتبعها، و المشترك يتبع
// فرقة العنصر يوم النشاط (من سجلّ الترقيات). فالترقية تعيد نسبته من الصفر —
// حتى لو وقع نشاط الفرقتين في اليوم نفسه — و حضوره القديم بطاقة لفرقته السابقة.
// ملفّ العنصر و قائمة العناصر يحسبان منه، فالنسبة واحدة في الموضعين.
const branchPeriodsStmt = db.prepare(
  `SELECT h.effective_date AS promoted_at, h.old_branch_id, b.name_fr, b.name_ar
   FROM member_branch_history h JOIN branches b ON b.id = h.old_branch_id
   WHERE h.member_id = ? ORDER BY h.effective_date ASC, h.id ASC`
);
const attendanceRowsStmt = db.prepare(
  `SELECT a.status, a.paid, s.date, s.title, s.matalib, s.id AS session_id,
    (SELECT GROUP_CONCAT(sb.branch_id) FROM session_branches sb WHERE sb.session_id = s.id) AS sb_ids
   FROM attendance a JOIN sessions s ON s.id = a.session_id
   WHERE a.member_id = ? AND s.kind = 'activity' AND a.status != 'unmarked'
     AND ${countedSessionSQL('s', '?')}
   ORDER BY s.date DESC, s.id DESC`
);
function attributedAttendance(m, { withFees = false } = {}) {
  const periodsAsc = branchPeriodsStmt.all(m.id);
  const branchAt = (date) => {
    for (const p of periodsAsc) if (date < p.promoted_at) return p.old_branch_id;
    return m.branch_id;
  };
  // فرق العنصر عبر الزمن، الأحدث أولًا — للمشترك الواقع يوم الترقية نفسه:
  // فرقته الجديدة قد لا تكون من فرق النشاط، فيُنسب لآخر فرقة له فيه.
  const branchTimeline = [m.branch_id, ...periodsAsc.map((p) => p.old_branch_id).reverse()];
  const rows = attendanceRowsStmt.all(m.id, todayISO()).map((r) => {
    const ids = (r.sb_ids || '').split(',').filter(Boolean).map(Number);
    const at = branchAt(r.date);
    const branch =
      ids.length <= 1
        ? (ids[0] ?? m.branch_id)
        : ids.includes(at)
          ? at
          : (branchTimeline.find((b) => ids.includes(b)) ?? ids[0]);
    return { status: r.status, paid: withFees ? r.paid : null, date: r.date, title: r.title, session_id: r.session_id, matalib: JSON.parse(r.matalib || '[]'), attributed_branch: branch };
  });
  return { periodsAsc, rows };
}

// `until` (inclusive) bounds the history to a day: a séance's badge counts the streak as
// it stood on that séance, not as it stands today (bug 15)
function attendanceStats(memberId, branchId, { from = null, to = null, until = null } = {}) {
  // نافذة زمنية اختيارية: الترقية تعيد عدّاد الحضور من الصفر، فتاريخ الترقية
  // يحدّ الإحصاء — و ما قبله يُعرض بطاقةً تاريخية للفرقة السابقة.
  const rows = db
    .prepare(
      `SELECT a.status, s.date, s.title, s.matalib, s.id AS session_id
       FROM attendance a JOIN sessions s ON s.id = a.session_id
       WHERE a.member_id = ? AND s.kind = 'activity'
          AND a.status != 'unmarked' AND ${countedSessionSQL('s', '?')}
          AND (? IS NULL OR s.date >= ?) AND (? IS NULL OR s.date < ?) AND (? IS NULL OR s.date <= ?)
       ORDER BY s.date DESC, s.id DESC`
    )
    .all(memberId, todayISO(), from, from, to, to, until, until)
    .map((r) => ({ ...r, matalib: JSON.parse(r.matalib || '[]') }));
  const earned = branchId ? earnedNumbersInBranch(memberId, branchId) : [];
  return {
    ...statsFromRows(rows),
    requirements_earned: earned.length,
    earned_numbers: earned,
  };
}

// ---------- Branches ----------

app.get('/api/branches', (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.*,
        (SELECT COUNT(*) FROM members m WHERE m.branch_id = b.id AND m.status = 'active') AS member_count,
        (SELECT ${fullNameSQL('l')} FROM assignments a JOIN leaders l ON l.id = a.leader_id
          WHERE a.branch_id = b.id AND a.year = (SELECT MAX(a2.year) FROM assignments a2 WHERE a2.branch_id = b.id)
          ORDER BY a.sort_order, a.id LIMIT 1) AS leader_name,
        (SELECT a.leader_id FROM assignments a
          WHERE a.branch_id = b.id AND a.year = (SELECT MAX(a2.year) FROM assignments a2 WHERE a2.branch_id = b.id)
            AND a.leader_id IS NOT NULL
          ORDER BY a.sort_order, a.id LIMIT 1) AS leader_id
       FROM branches b WHERE 1=1${branchFilterSQL(req, 'b.id')} ORDER BY ${sectionOrderSQL('b.section')}, b.sort_order`
    )
    .all();
  // مجموعات كل فرقة تُرسل مع الفرقة نفسها: نموذج إنشاء النشاط يحتاجها فورًا ليعرض
  // مجموعات الفرقة المختارة، فلا يستحقّ ذلك طلبًا ثانيًا.
  res.json(rows.map((b) => ({ ...b, groups: groupsOfBranch(b.id) })));
});

// Everything the الفرق tab shows about one فرقة: عناصر، قادة، أنشطة، حضور، مطالب.
// One endpoint for the whole list — a فرقة is never looked at alone in that page.
app.get('/api/branches/overview', requirePerm('branches.read'), (req, res) => {
  const ym = todayISO().slice(0, 7);
  const year = latestYear();
  // Bug 13 : أنشطة et présence de l'année scoute en cours, ou ?period=all
  const period = statsPeriod(req);
  const inPeriod = periodSQL(period);
  const branches = db
    .prepare(`SELECT * FROM branches WHERE 1=1${branchFilterSQL(req, 'id')} ORDER BY ${sectionOrderSQL('section')}, sort_order, id`)
    .all();

  const membersStmt = db.prepare(
    `SELECT
       COALESCE(SUM(status = 'active'), 0) AS active,
       COALESCE(SUM(status != 'active'), 0) AS inactive,
       COALESCE(SUM(status = 'active' AND sex = 'M'), 0) AS male,
       COALESCE(SUM(status = 'active' AND sex = 'F'), 0) AS female
     FROM members WHERE branch_id = ?`
  );
  // الاستعلامات التي تسأل «هل يخصّ هذا النشاط هذه الفرقة؟» تُبنى لكل فرقة على حدة:
  // رقم الفرقة مدمج في النص، فلا يمكن تحضير الاستعلام مرّة واحدة للجميع.
  const sessionsOf = (id) =>
    db
      .prepare(
        `SELECT
           COALESCE(SUM(kind = 'activity'), 0) AS total,
           COALESCE(SUM(kind = 'activity' AND substr(date, 1, 7) = ?), 0) AS this_month,
           COALESCE(SUM(kind = 'visit'), 0) AS visits
         FROM sessions s WHERE ${sessionInBranchSQL(id)}${inPeriod}`
      )
      .get(ym);
  const attendanceOf = (id) =>
    db
      .prepare(
        `SELECT
           COALESCE(SUM(a.status = 'present'), 0) AS present,
           COALESCE(SUM(a.status = 'absent'), 0) AS absent,
           COALESCE(SUM(a.status = 'excused'), 0) AS excused
         FROM attendance a JOIN sessions s ON s.id = a.session_id
         WHERE s.kind = 'activity' AND ${attendanceInBranchSQL(id)} AND ${countedSessionSQL('s')}${inPeriod}`
      )
      .get();
  const leadersStmt = db.prepare(
    `SELECT a.id, a.title, a.leader_id, l.first_name, l.father_name, l.last_name, l.photo
     FROM assignments a LEFT JOIN leaders l ON l.id = a.leader_id
     WHERE a.branch_id = ? AND a.year = ?
     ORDER BY a.sort_order, a.id`
  );
  // Covered = worked on in a séance that counts and where someone was present (bug 14)
  const mataliOf = (id) =>
    db
      .prepare(
        `SELECT matalib FROM sessions s WHERE kind = 'activity' AND ${sessionInBranchSQL(id)}
           AND ${countedSessionSQL('s')}
           AND EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id AND a.status = 'present')`
      )
      .all();
  const lastSessionOf = (id) =>
    db
      .prepare(
        `SELECT id, title, date FROM sessions s
          WHERE kind = 'activity' AND ${sessionInBranchSQL(id)}
          ORDER BY date DESC, id DESC LIMIT 1`
      )
      .get();

  const rows = branches.map((b) => {
    const members = membersStmt.get(b.id);
    const sessions = sessionsOf(b.id);
    const att = attendanceOf(b.id);
    const marked = att.present + att.absent + att.excused;
    // A مطلب counts as covered once any نشاط of the فرقة has worked on it
    const covered = new Set();
    for (const r of mataliOf(b.id)) JSON.parse(r.matalib || '[]').forEach((n) => covered.add(n));
    return {
      ...b,
      members,
      leaders: year ? leadersStmt.all(b.id, year) : [],
      year,
      stats_period: period,
      sessions_count: sessions.total,
      sessions_month: sessions.this_month,
      visits_count: sessions.visits,
      attendance: { ...att, marked, rate: marked ? Math.round((att.present / marked) * 100) : null },
      matalib: {
        covered: [...covered].sort((x, y) => x - y),
        covered_count: covered.size,
        total: b.total_requirements,
      },
      last_session: lastSessionOf(b.id) || null,
      staffing: staffingAlerts(b.id),
    };
  });
  res.json(rows);
});

// أنشطة a فرقة with, for each one, who took part. Loaded on demand: the الفرق page
// shows one فرقة at a time, so the participant lists of the others are never fetched.
app.get('/api/branches/:id/sessions', requirePerm('branches.read'), (req, res) => {
  const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'branch not found' });
  if (!branchOk(req, branch.id)) return res.status(403).json({ error: 'forbidden' });
  const sessions = db
    .prepare(
      `SELECT s.id, s.title, s.date, s.leader, s.matalib, s.kind, s.attendance_finalized_at,
              ${countedSessionSQL('s')} AS counted, ${unconfirmedSessionSQL('s')} AS unconfirmed
       FROM sessions s WHERE ${sessionInBranchSQL(branch.id)} ORDER BY s.date DESC, s.id DESC`
    )
    .all()
    .map((s) => ({ ...s, counted: !!s.counted, unconfirmed: !!s.unconfirmed, matalib: JSON.parse(s.matalib || '[]') }));

  const attendeesStmt = db.prepare(
    `SELECT a.status, m.id, m.first_name, m.father_name, m.last_name, m.photo
     FROM attendance a JOIN members m ON m.id = a.member_id
     WHERE a.session_id = ? AND COALESCE(a.branch_id, m.branch_id) = ?
       AND a.status != 'unmarked'
     ORDER BY m.last_name, m.first_name`
  );
  const animatorsStmt = db.prepare(
    `SELECT l.id, l.first_name, l.father_name, l.last_name, sl.role, sl.status
     FROM session_leaders sl JOIN leaders l ON l.id = sl.leader_id
     WHERE sl.session_id = ? ORDER BY sl.role = 'helper', l.last_name`
  );

  res.json(
    sessions.map((s) => {
      const attendees = attendeesStmt.all(s.id, branch.id);
      return {
        ...s,
        animators: animatorsStmt.all(s.id),
        present: attendees.filter((a) => a.status === 'present'),
        absent: attendees.filter((a) => a.status === 'absent'),
        excused: attendees.filter((a) => a.status === 'excused'),
      };
    })
  );
});

// ---------- الخطة السنوية ----------
// خطة كل فرقة على مدار السنة الكشفية، مكتوبة بالأيام: عادةً نشاط كل سبت، مع إمكانية
// برمجة أي يوم آخر. التحقيق لا يُخزَّن أبدًا، بل يُستنتج من الأنشطة:
//   - القائد يختار بند الخطة عند إنشاء النشاط  → ربط صريح (plan_item_id)
//   - أو ينشئ نشاطًا بنفس الاسم داخل السنة    → يُحتسب أيضًا، للقائد الذي لم يختر
// So a قائد who never opens the picker still moves the percentage.

// A scout year "2025-2026" runs September 1st to August 31st
function scoutYearRange(year) {
  const m = /^(\d{4})-(\d{4})$/.exec(normYear(year));
  return m ? { from: `${m[1]}-09-01`, to: `${m[2]}-08-31` } : null;
}

function currentScoutYear() {
  const now = new Date();
  const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

// Bug 13 : les statistiques des فرق et des قادة portent sur l'année scoute en cours
// (septembre → août). ?period=all les cumule depuis toujours, ?period=2025-2026 vise une
// année. Les bornes viennent de scoutYearRange (chiffres seuls), on peut les inliner.
function statsPeriod(req) {
  const q = String(req.query.period || '');
  if (q === 'all') return { period: 'all', from: null, to: null };
  const year = scoutYearRange(q) ? normYear(q) : currentScoutYear();
  return { period: year, ...scoutYearRange(year) };
}
const periodSQL = (p, col = 's.date') => (p.from ? ` AND ${col} BETWEEN '${p.from}' AND '${p.to}'` : '');

// Bug 13 : une seule source pour «les أنشطة d'un قائد» — session_leaders (principal et
// aides, avec leur présence), complétée par sessions.leader_id quand aucune ligne de
// session_leaders ne le cite pour cette séance (présence alors non pointée)
const LEADER_SESSIONS_SQL = `(
  SELECT sl0.leader_id, sl0.session_id, sl0.role, sl0.status FROM session_leaders sl0
  UNION ALL
  SELECT s0.leader_id, s0.id, 'main', NULL FROM sessions s0
   WHERE s0.leader_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM session_leaders x0 WHERE x0.session_id = s0.id AND x0.leader_id = s0.leader_id))`;

// Titles compare trimmed and case-folded, so a stray space or capital never
// costs the فرقة its achievement
const planTitleKey = (t) => String(t || '').trim().toLowerCase();

// بند «كما اعتُمد» ما دام على يومه و باسمه
const matchesBaseline = (row, base) =>
  row.date === base.date && planTitleKey(row.title) === planTitleKey(base.title);

// الاعتماد، و مقارنة الخطة الحالية بالنسخة المعتمدة. respect = نسبة البنود المعتمدة
// التي بقيت كما هي؛ المعدَّل و المحذوف يُنقصانها، و المضاف يُعدّ وحده.
function planDiff(branchId, year, items) {
  const validation =
    db
      .prepare('SELECT validated_at, validated_by FROM plan_validations WHERE branch_id = ? AND year = ?')
      .get(branchId, year) || null;
  const baseline = db
    .prepare('SELECT id, date, title FROM plan_baseline WHERE branch_id = ? AND year = ? ORDER BY date, id')
    .all(branchId, year);
  const kept = new Set(items.map((i) => i.baseline_id).filter(Boolean));
  const removed = baseline.filter((b) => !kept.has(b.id));
  const changed = items.filter((i) => i.base && i.changed).length;
  const same = items.filter((i) => i.base && !i.changed).length;
  const added = validation ? items.filter((i) => !i.base).length : 0;
  return {
    validation,
    removed,
    summary: {
      validated_total: baseline.length,
      same,
      changed,
      removed: removed.length,
      added,
      respect: validation && baseline.length ? Math.round((same / baseline.length) * 100) : null,
    },
  };
}

// Years offered in the picker: every year that has plan rows, the current scout
// year, and the next one — an annual plan is written before its year starts.
function planYears() {
  const cur = currentScoutYear();
  const next = `${Number(cur.slice(0, 4)) + 1}-${Number(cur.slice(5)) + 1}`;
  const years = new Set([cur, next]);
  for (const r of db.prepare('SELECT DISTINCT year FROM annual_plan').all()) years.add(r.year);
  return [...years].sort().reverse();
}

// sessions.plan_item_id مرآة لبند الفرقة الرئيسية وحده — القوائم القديمة تقرأه لتعرف
// أن النشاط "من الخطة". المرجع الكامل هو session_plan_items.
function syncPrimaryPlanItem(sessionId) {
  db.prepare(
    `UPDATE sessions SET plan_item_id = (
       SELECT spi.plan_item_id FROM session_plan_items spi
         JOIN annual_plan p ON p.id = spi.plan_item_id
        WHERE spi.session_id = sessions.id AND p.branch_id = sessions.branch_id
        LIMIT 1)
     WHERE id = ?`
  ).run(sessionId);
}

// الخطة الكاملة لفرقة في سنة، مع النشاط الذي حقّق كل بند إن وُجد
function planFor(branchId, year) {
  const items = db
    .prepare(
      `SELECT p.id, p.year, p.branch_id, p.date, p.title, p.baseline_id,
              b.date AS base_date, b.title AS base_title
         FROM annual_plan p LEFT JOIN plan_baseline b ON b.id = p.baseline_id
        WHERE p.branch_id = ? AND p.year = ? ORDER BY p.date, p.id`
    )
    .all(branchId, year);
  const range = scoutYearRange(year);
  const sessions = range
    ? db
        .prepare(
          `SELECT id, title, date,
              (SELECT GROUP_CONCAT(spi.plan_item_id) FROM session_plan_items spi
                WHERE spi.session_id = s.id) AS plan_item_ids
            FROM sessions s
            WHERE kind = 'activity' AND date >= ? AND date <= ? AND ${sessionInBranchSQL(branchId)}
            ORDER BY date, id`
        )
        .all(range.from, range.to)
    : [];
  // A نشاط linked on purpose belongs to that بند alone; only ones unlinked *in this
  // plan* are offered to the title fallback, so one نشاط can never tick two بنود of
  // the same فرقة. النشاط المشترك المربوط ببند فرقة أخرى يبقى مرشّحًا بالاسم هنا:
  // ربطه هناك لا يقول شيئًا عن خطة هذه الفرقة.
  const itemIds = new Set(items.map((i) => i.id));
  const byPlan = new Map();
  const byTitle = new Map();
  for (const s of sessions) {
    const linkedHere = parseIdList(s.plan_item_ids).find((id) => itemIds.has(id)) ?? null;
    s.linked_item_id = linkedHere;
    if (linkedHere !== null) {
      if (!byPlan.has(linkedHere)) byPlan.set(linkedHere, s);
    } else {
      const k = planTitleKey(s.title);
      if (!byTitle.has(k)) byTitle.set(k, []);
      byTitle.get(k).push(s);
    }
  }
  const rows = items.map(({ base_date, base_title, ...i }) => {
    const titleMatches = byTitle.get(planTitleKey(i.title));
    const s = byPlan.get(i.id) || (titleMatches?.length ? titleMatches.shift() : null);
    // البند كما اعتُمد، و هل تغيّر منذ الاعتماد
    const base = i.baseline_id ? { id: i.baseline_id, date: base_date, title: base_title } : null;
    return {
      ...i,
      base,
      changed: base ? !matchesBaseline(i, base) : false,
      session: s ? { id: s.id, title: s.title, date: s.date, linked: s.linked_item_id === i.id } : null,
    };
  });
  const doneCount = rows.filter((r) => r.session).length;
  return {
    year,
    years: planYears(),
    items: rows,
    ...planDiff(branchId, year, rows),
    total: rows.length,
    done_count: doneCount,
    rate: rows.length ? Math.round((doneCount / rows.length) * 100) : null,
  };
}

app.get('/api/branches/:id/plan', requirePerm('branches.read'), (req, res) => {
  const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'branch not found' });
  if (!branchOk(req, branch.id)) return res.status(403).json({ error: 'forbidden' });
  const wanted = normYear(req.query.year);
  const year = scoutYearRange(wanted) ? wanted : currentScoutYear();
  res.json(planFor(branch.id, year));
});

// بنود الخطة المتاحة عند إنشاء نشاط: ما لم يُنفَّذ بعد، مرتّبة بالتاريخ. القائد يختار
// البند فيُملأ الاسم و التاريخ تلقائيًا و يُربط النشاط بالخطة.
app.get('/api/branches/:id/plan/options', requireAnyPerm('sessions.create', 'sessions.edit'), (req, res) => {
  const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'branch not found' });
  if (!branchOk(req, branch.id)) return res.status(403).json({ error: 'forbidden' });
  const wanted = normYear(req.query.year);
  const year = scoutYearRange(wanted) ? wanted : currentScoutYear();
  const plan = planFor(branch.id, year);
  res.json({
    year: plan.year,
    items: plan.items.filter((i) => !i.session).map((i) => ({ id: i.id, date: i.date, title: i.title })),
  });
});

// أنشطة الفرقة في السنة الكشفية — قائمة الاختيار عند ربط نشاط موجود ببند من الخطة.
// النشاط المربوط ببند آخر يبقى معروضًا مع اسم بنده: القائد يرى أنه سيُنقل، لا أنه ضائع.
app.get('/api/branches/:id/plan/sessions', requirePerm('branches.read'), (req, res) => {
  const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'branch not found' });
  if (!branchOk(req, branch.id)) return res.status(403).json({ error: 'forbidden' });
  const wanted = normYear(req.query.year);
  const year = scoutYearRange(wanted) ? wanted : currentScoutYear();
  const range = scoutYearRange(year);
  const sessions = db
    .prepare(
      // البند المعروض هو بند خطة هذه الفرقة: ربط النشاط ببند فرقة أخرى لا يعني هنا شيئًا.
      // بند واحد على الأكثر لكل فرقة، فبقية الصفوف NULL و MAX يلتقط الصف المعني.
      `SELECT s.id, s.title, s.date,
              MAX(p.id) AS plan_item_id, MAX(p.title) AS plan_title, MAX(p.date) AS plan_date
         FROM sessions s
         LEFT JOIN session_plan_items spi ON spi.session_id = s.id
         LEFT JOIN annual_plan p ON p.id = spi.plan_item_id AND p.branch_id = ${intOr(branch.id)}
        WHERE s.kind = 'activity' AND s.date >= ? AND s.date <= ? AND ${sessionInBranchSQL(branch.id)}
        GROUP BY s.id
        ORDER BY s.date DESC, s.id DESC`
    )
    .all(range.from, range.to);
  res.json({ year, sessions });
});

// ربط نشاط موجود ببند من الخطة، أو فكّ الربط — بعد إنشاء الاثنين.
// الحالة الشائعة: أُنشئ النشاط باسم مختلف عن اسم البند، فلا يلتقطه التطابق بالاسم،
// و لا يمكن إصلاح ذلك إلا بتغيير الخطة أو إعادة كتابة اسم النشاط. هنا يُربط مباشرةً.
// البند يحقّقه نشاط واحد: ربط نشاط جديد به يفكّ ربط سابقه في نفس المعاملة.
app.put('/api/branches/:id/plan/:itemId/session', requirePerm('branches.plan'), (req, res) => {
  const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'branch not found' });
  if (!branchOk(req, branch.id)) return res.status(403).json({ error: 'forbidden' });
  const item = db
    .prepare('SELECT id, year, branch_id FROM annual_plan WHERE id = ?')
    .get(req.params.itemId);
  if (!item || item.branch_id !== branch.id)
    return res.status(404).json({ error: 'plan item not found' });
  const range = scoutYearRange(item.year);
  if (!range) return res.status(400).json({ error: 'invalid year' });

  const raw = req.body?.session_id;
  // null = فكّ الربط: البند يعود "لم يُنفَّذ بعد" و النشاط يبقى كما هو
  const sessionId = raw === undefined || raw === null || raw === '' ? null : Number(raw);
  if (sessionId !== null && !Number.isInteger(sessionId))
    return res.status(400).json({ error: 'invalid session_id' });

  let session = null;
  if (sessionId !== null) {
    session = db.prepare('SELECT id, branch_id, kind, date FROM sessions WHERE id = ?').get(sessionId);
    // النشاط المشترك يخصّ عدة فرق: يكفي أن تكون فرقة الخطة إحداها
    if (!session || session.kind !== 'activity' || !branchIdsOfSession(session.id).includes(branch.id))
      return res.status(400).json({ error: 'invalid session_id' });
    // خارج السنة الكشفية للبند: الربط سيبدو بلا أثر، فالخطة لا تقرأ إلا أنشطة سنتها
    if (session.date < range.from || session.date > range.to)
      return res.status(400).json({ error: 'session_outside_year' });
  }

  db.transaction(() => {
    // البند يحقّقه نشاط واحد: أي ربط سابق به يُفكّ
    const previous = db
      .prepare('SELECT session_id FROM session_plan_items WHERE plan_item_id = ?')
      .all(item.id)
      .map((r) => r.session_id);
    db.prepare('DELETE FROM session_plan_items WHERE plan_item_id = ?').run(item.id);
    if (session) {
      // بند واحد لكل فرقة: الربط الجديد يحلّ محلّ ربط هذا النشاط ببند آخر من نفس الخطة
      db.prepare(
        `DELETE FROM session_plan_items WHERE session_id = ? AND plan_item_id IN
           (SELECT id FROM annual_plan WHERE branch_id = ? AND year = ?)`
      ).run(session.id, branch.id, item.year);
      db.prepare('INSERT OR IGNORE INTO session_plan_items (session_id, plan_item_id) VALUES (?, ?)')
        .run(session.id, item.id);
    }
    for (const sid of new Set([...previous, ...(session ? [session.id] : [])]))
      syncPrimaryPlanItem(sid);
  })();
  res.json(planFor(branch.id, item.year));
});

// حفظ خطة شهر كامل دفعة واحدة — this is the editing unit: the قائد fills the four
// Saturdays (plus any extra day) and saves once.
// Rows keep their id across a save, so a نشاط already linked to a بند stays linked;
// a row whose title was emptied is dropped, and dropping it only unlinks its نشاط.
app.put('/api/branches/:id/plan/month', requirePerm('branches.plan'), (req, res) => {
  const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'branch not found' });
  if (!branchOk(req, branch.id)) return res.status(403).json({ error: 'forbidden' });
  const year = normYear(req.body?.year);
  const range = scoutYearRange(year);
  if (!range) return res.status(400).json({ error: 'invalid year' });
  const month = String(req.body?.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'invalid month' });
  if (!Array.isArray(req.body?.items)) return res.status(400).json({ error: 'invalid items' });

  const items = [];
  for (const r of req.body.items) {
    // An empty title is not an error: it is a day with nothing planned
    const title = String(r?.title || '').trim();
    if (!title) continue;
    const date = String(r?.date || '');
    if (!validISODate(date)) return res.status(400).json({ error: 'invalid date' });
    if (!date.startsWith(month)) return res.status(400).json({ error: 'date_outside_month' });
    if (date < range.from || date > range.to)
      return res.status(400).json({ error: 'date_outside_year' });
    items.push({ id: Number.isInteger(r?.id) ? r.id : null, date, title });
  }

  const existing = db
    .prepare('SELECT id FROM annual_plan WHERE branch_id = ? AND year = ? AND substr(date, 1, 7) = ?')
    .all(branch.id, year, month);
  const existingIds = new Set(existing.map((e) => e.id));
  if (items.some((i) => i.id !== null && !existingIds.has(i.id)))
    return res.status(400).json({ error: 'invalid plan item id' });
  if (new Set(items.map((i) => i.date)).size !== items.length)
    return res.status(409).json({ error: 'duplicate plan date' });
  const kept = new Set(items.map((i) => i.id).filter(Boolean));
  const del = db.prepare('DELETE FROM annual_plan WHERE id = ? AND branch_id = ?');
  const upd = db.prepare('UPDATE annual_plan SET date = ?, title = ? WHERE id = ? AND branch_id = ?');
  const ins = db.prepare('INSERT INTO annual_plan (year, branch_id, date, title) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (const e of existing) if (!kept.has(e.id)) del.run(e.id, branch.id);
    for (const i of items) {
      if (i.id) upd.run(i.date, i.title, i.id, branch.id);
      else ins.run(year, branch.id, i.date, i.title);
    }
  })();
  res.json(planFor(branch.id, year));
});

// اعتماد خطة فرقة لسنة: تُحفظ نسخة ثابتة منها، و تُقارن بها كل تعديلاتها اللاحقة.
// إعادة الاعتماد تستبدل النسخة: التعديلات حتى الآن تصير هي الخطة المعتمدة.
app.post('/api/branches/:id/plan/validate', requireAdmin, (req, res) => {
  const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'branch not found' });
  const year = normYear(req.body?.year);
  if (!scoutYearRange(year)) return res.status(400).json({ error: 'invalid year' });
  const items = db
    .prepare('SELECT id, date, title FROM annual_plan WHERE branch_id = ? AND year = ? ORDER BY date, id')
    .all(branch.id, year);
  if (!items.length) return res.status(400).json({ error: 'plan_empty' });
  const ins = db.prepare('INSERT INTO plan_baseline (branch_id, year, date, title) VALUES (?, ?, ?, ?)');
  const link = db.prepare('UPDATE annual_plan SET baseline_id = ? WHERE id = ?');
  db.transaction(() => {
    db.prepare('DELETE FROM plan_baseline WHERE branch_id = ? AND year = ?').run(branch.id, year);
    for (const i of items) link.run(ins.run(branch.id, year, i.date, i.title).lastInsertRowid, i.id);
    db.prepare(
      `INSERT INTO plan_validations (branch_id, year, validated_at, validated_by)
       VALUES (?, ?, datetime('now'), ?)
       ON CONFLICT (branch_id, year) DO UPDATE SET validated_at = excluded.validated_at,
         validated_by = excluded.validated_by`
    ).run(branch.id, year, req.user.display_name || req.user.username);
  })();
  res.json(planFor(branch.id, year));
});

// سحب الاعتماد: الخطة تعود مسودّة، و تُنسى النسخة المعتمدة
app.delete('/api/branches/:id/plan/validate', requireAdmin, (req, res) => {
  const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'branch not found' });
  const year = normYear(req.query.year);
  if (!scoutYearRange(year)) return res.status(400).json({ error: 'invalid year' });
  db.transaction(() => {
    db.prepare('DELETE FROM plan_baseline WHERE branch_id = ? AND year = ?').run(branch.id, year);
    db.prepare('DELETE FROM plan_validations WHERE branch_id = ? AND year = ?').run(branch.id, year);
  })();
  res.json(planFor(branch.id, year));
});

// إرجاع بند كما اعتُمد: بند محذوف يعود، و بند معدَّل يستعيد يومه و اسمه. يحتفظ الصف
// برقمه، فالنشاط المربوط به يبقى مربوطًا. بند آخر في يوم الأصل يحلّ محلّه الأصل.
app.post('/api/branches/:id/plan/restore', requirePerm('branches.plan'), (req, res) => {
  const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'branch not found' });
  if (!branchOk(req, branch.id)) return res.status(403).json({ error: 'forbidden' });
  const base = db
    .prepare('SELECT id, year, date, title FROM plan_baseline WHERE id = ? AND branch_id = ?')
    .get(Number(req.body?.baseline_id), branch.id);
  if (!base) return res.status(404).json({ error: 'baseline item not found' });
  const own = db.prepare('SELECT id FROM annual_plan WHERE baseline_id = ?').get(base.id);
  const atDate = db
    .prepare('SELECT id FROM annual_plan WHERE branch_id = ? AND year = ? AND date = ?')
    .get(branch.id, base.year, base.date);
  db.transaction(() => {
    if (own && atDate && atDate.id !== own.id) db.prepare('DELETE FROM annual_plan WHERE id = ?').run(atDate.id);
    const target = own || atDate;
    if (target)
      db.prepare('UPDATE annual_plan SET date = ?, title = ?, baseline_id = ? WHERE id = ?').run(
        base.date,
        base.title,
        base.id,
        target.id
      );
    else
      db.prepare('INSERT INTO annual_plan (year, branch_id, date, title, baseline_id) VALUES (?, ?, ?, ?, ?)').run(
        base.year,
        branch.id,
        base.date,
        base.title,
        base.id
      );
  })();
  res.json(planFor(branch.id, base.year));
});

// كل الخطط في صفحة واحدة: لكل فرقة ظاهرة للمستخدم خطتها، اعتمادها، و ما تغيّر
// منذ الاعتماد
app.get('/api/plans/overview', requirePerm('branches.read'), (req, res) => {
  const wanted = normYear(req.query.year);
  const year = scoutYearRange(wanted) ? wanted : currentScoutYear();
  const branches = db
    .prepare(`SELECT id, name_fr, name_ar, section FROM branches ORDER BY ${sectionOrderSQL('section')}, sort_order, id`)
    .all()
    .filter((b) => branchOk(req, b.id));
  res.json({
    year,
    years: planYears(),
    branches: branches.map((b) => {
      const plan = planFor(b.id, year);
      return {
        ...b,
        total: plan.total,
        done_count: plan.done_count,
        rate: plan.rate,
        validation: plan.validation,
        summary: plan.summary,
        removed: plan.removed,
        items: plan.items.map((i) => ({
          id: i.id,
          date: i.date,
          title: i.title,
          base: i.base,
          changed: i.changed,
          done: !!i.session,
        })),
      };
    }),
  });
});

// فرق كل الأعمار تأتي بعد سلّم السنّ في كل القوائم — و إلا صارت أول فرقة، أي
// الفرقة التي يُقترح عليها كل عنصر جديد
const ALL_AGES_SORT_ORDER = 1000;

function validateBranchBody(body, { requireNames }) {
  const { min_age, max_age, total_requirements, name_fr, name_ar, all_ages } = body;
  // فرقة كل الأعمار لا حدود سنّ لها: تُخزَّن 0 / NULL و لا تُفحص
  if (!all_ages) {
    if (!Number.isInteger(min_age) || min_age < 0) return 'invalid min_age';
    if (max_age !== null && max_age !== undefined && (!Number.isInteger(max_age) || max_age < min_age))
      return 'invalid max_age';
  }
  if (!Number.isInteger(total_requirements) || total_requirements < 0)
    return 'invalid total_requirements';
  const th = body.promotion_threshold;
  if (th !== undefined && th !== null && (!Number.isInteger(th) || th < 0 || th > 100))
    return 'invalid promotion_threshold';
  // مطالب القبول (B1): أعداد صغيرة، غائبة = بلا تغيير
  for (const [k, max] of [['trial_months', 12], ['law_items_required', 10], ['consecutive_meetings_required', 20], ['cries_required', 20]]) {
    const v = body[k];
    if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0 || v > max)) return `invalid ${k}`;
  }
  if (requireNames || name_fr !== undefined) {
    if (typeof name_fr !== 'string' || !name_fr.trim()) return 'invalid name_fr';
  }
  if (requireNames || name_ar !== undefined) {
    if (typeof name_ar !== 'string' || !name_ar.trim()) return 'invalid name_ar';
  }
  return null;
}

function maxRequirementUsed(branchId) {
  return (
    db.prepare(
      `SELECT COALESCE(MAX(n), 0) AS n FROM (
         SELECT CAST(j.value AS INTEGER) AS n
           FROM sessions s JOIN session_branches sb ON sb.session_id = s.id,
                json_each(CASE WHEN json_valid(s.matalib) THEN s.matalib ELSE '[]' END) j
          WHERE sb.branch_id = ?
         UNION ALL
         SELECT CAST(j.value AS INTEGER) AS n
           FROM prep_cards p,
                json_each(CASE WHEN json_valid(p.matalib) THEN p.matalib ELSE '[]' END) j
          WHERE p.branch_id = ?
         UNION ALL
         SELECT number AS n FROM member_matalib WHERE branch_id = ?
       )`
    ).get(branchId, branchId, branchId).n || 0
  );
}

// ---------- مجموعات الفرقة ----------

// The فرقة whose مجموعات are being read or written, once the caller's scope is checked
function branchForGroups(req, res, perm) {
  const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) {
    res.status(404).json({ error: 'branch not found' });
    return null;
  }
  if (!branchOk(req, branch.id) || !hasPerm(req, perm)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return branch;
}

const groupName = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// المجموعات مع عناصر الفرقة و توزيعهم الحالي — صفحة الفرق توزّع منها بيد واحدة
app.get('/api/branches/:id/groups', requirePerm('branches.read'), (req, res) => {
  const branch = branchForGroups(req, res, 'branches.read');
  if (!branch) return;
  res.json({
    groups: groupsOfBranch(branch.id),
    // السنة التي تُحسب منها سنّ السنة: معاينة التوزيع حسب السنّ تقرأ بساعة الخادم
    age_year: ageYear(),
    // مسؤوليات الطليعة الجارية و تنبيهات العدد (C1)
    responsibilities: currentResponsibilities(branch.id),
    staffing: staffingAlerts(branch.id),
    // العناصر غير النشطين يظهرون أيضًا: توزيعهم محفوظ، و عودتهم لا تحتاج إعادة توزيع
    members: db
      .prepare(
        `SELECT id, first_name, father_name, last_name, photo, status, group_id, birth_date FROM members
         WHERE branch_id = ? ORDER BY status != 'active', last_name, first_name`
      )
      .all(branch.id),
  });
});

app.post('/api/branches/:id/groups', requirePerm('branches.groups'), (req, res) => {
  const branch = branchForGroups(req, res, 'branches.groups');
  if (!branch) return;
  const name = groupName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'name required' });
  const range = parseAgeRange(req.body) ?? { age_from: null, age_to: null };
  if (range.error) return res.status(400).json({ error: range.error });
  const clash = ageRangeClash(branch.id, range);
  if (clash) return res.status(409).json({ error: 'group_age_overlap', name: clash.name });
  const next =
    db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM branch_groups WHERE branch_id = ?')
      .get(branch.id).n;
  try {
    const id = db
      .prepare('INSERT INTO branch_groups (branch_id, name, sort_order, age_from, age_to) VALUES (?, ?, ?, ?, ?)')
      .run(branch.id, name, next, range.age_from, range.age_to).lastInsertRowid;
    res.status(201).json(db.prepare('SELECT * FROM branch_groups WHERE id = ?').get(id));
  } catch (e) {
    // UNIQUE(branch_id, name) — مجموعتان بنفس الاسم في فرقة واحدة لا تُميَّزان
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'group_exists' });
    throw e;
  }
});

// تغيير الفئة العمرية لا ينقل أحدًا بنفسه: التوزيع حسب السنّ يُطلب صراحةً بعده، بمعاينة
app.put('/api/branches/:id/groups/:gid', requirePerm('branches.groups'), (req, res) => {
  const branch = branchForGroups(req, res, 'branches.groups');
  if (!branch) return;
  const g = db.prepare('SELECT * FROM branch_groups WHERE id = ? AND branch_id = ?')
    .get(req.params.gid, branch.id);
  if (!g) return res.status(404).json({ error: 'group not found' });
  const name = groupName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'name required' });
  const range = parseAgeRange(req.body) ?? { age_from: g.age_from, age_to: g.age_to };
  if (range.error) return res.status(400).json({ error: range.error });
  const clash = ageRangeClash(branch.id, range, g.id);
  if (clash) return res.status(409).json({ error: 'group_age_overlap', name: clash.name });
  try {
    db.prepare('UPDATE branch_groups SET name = ?, age_from = ?, age_to = ? WHERE id = ?')
      .run(name, range.age_from, range.age_to, g.id);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'group_exists' });
    throw e;
  }
  res.json(db.prepare('SELECT * FROM branch_groups WHERE id = ?').get(g.id));
});

// حذف مجموعة يعيد عناصرها «بلا مجموعة» و يخرجها من الأنشطة التي كانت مختارة فيها.
// النشاط الذي لم تبق له مجموعة في فرقةٍ ما يعود نشاط تلك الفرقة كاملةً — و هو أضبط
// من إخفاء عناصرها كلهم، لأن الحضور المسجَّل باقٍ على أي حال.
app.delete('/api/branches/:id/groups/:gid', requirePerm('branches.groups'), (req, res) => {
  const branch = branchForGroups(req, res, 'branches.groups');
  if (!branch) return;
  const g = db.prepare('SELECT id FROM branch_groups WHERE id = ? AND branch_id = ?')
    .get(req.params.gid, branch.id);
  if (!g) return res.status(404).json({ error: 'group not found' });
  db.transaction(() => {
    db.prepare('UPDATE members SET group_id = NULL WHERE group_id = ?').run(g.id);
    db.prepare('DELETE FROM session_groups WHERE group_id = ?').run(g.id);
    // توصيف كان للمجموعة يعود توصيفًا للفرقة كلها — يبقى في التشكيلة و لا يضيع
    db.prepare('UPDATE assignments SET group_id = NULL WHERE group_id = ?').run(g.id);
    db.prepare('DELETE FROM branch_groups WHERE id = ?').run(g.id);
  })();
  res.status(204).end();
});

// التوزيع اليدوي: عناصر مختارون يُنقلون دفعةً واحدة إلى مجموعة، أو يُخرجون منها
// جميعًا (group_id = null). كلّهم من هذه الفرقة، و إلا فالطلب مرفوض كاملًا.
app.post('/api/branches/:id/groups/assign', requirePerm('branches.groups'), (req, res) => {
  const branch = branchForGroups(req, res, 'branches.groups');
  if (!branch) return;
  const ids = req.body?.member_ids;
  if (!Array.isArray(ids) || !ids.every((n) => Number.isInteger(n)))
    return res.status(400).json({ error: 'invalid member_ids' });
  const groupId = resolveGroupId(req.body?.group_id, branch.id);
  if (groupId === undefined) return res.status(400).json({ error: 'invalid group_id' });
  const inBranch = db.prepare('SELECT id FROM members WHERE id = ? AND branch_id = ?');
  for (const id of ids) {
    if (!inBranch.get(id, branch.id)) return res.status(400).json({ error: 'invalid member_ids' });
  }
  const update = db.prepare('UPDATE members SET group_id = ? WHERE id = ?');
  db.transaction(() => {
    for (const id of ids) update.run(groupId, id);
  })();
  res.json({ assigned: ids.length, group_id: groupId });
});

// التوزيع حسب السنّ: كل عنصر مؤشَّر إلى طليعة سنّه — أول السنة الكشفية يصعد الجميع
// فئةً. المعاينة في الواجهة للعرض، و الخادم يعيد الحساب هنا بنفسه. من خرج من الفرقة
// منذ المعاينة (رُفّع) أو لا تاريخ ميلاد له يُتجاوز بصمت: لا شيء يُنقل خطأً.
app.post('/api/branches/:id/groups/by-age', requirePerm('branches.groups'), (req, res) => {
  const branch = branchForGroups(req, res, 'branches.groups');
  if (!branch) return;
  const ids = req.body?.member_ids;
  if (!Array.isArray(ids) || !ids.every((n) => Number.isInteger(n)))
    return res.status(400).json({ error: 'invalid member_ids' });
  const groups = groupsOfBranch(branch.id);
  if (!groups.some(isAgeGroup)) return res.status(409).json({ error: 'no_age_groups' });
  const year = ageYear();
  const member = db.prepare("SELECT id, birth_date, group_id FROM members WHERE id = ? AND branch_id = ? AND status = 'active'");
  const update = db.prepare('UPDATE members SET group_id = ? WHERE id = ?');
  let moved = 0;
  db.transaction(() => {
    for (const id of new Set(ids)) {
      const m = member.get(id, branch.id);
      const g = m && ageGroupFor(m.birth_date, groups, year);
      if (!g || g.id === m.group_id) continue;
      update.run(g.id, m.id);
      moved++;
    }
  })();
  res.json({ moved });
});

// ---------- مسؤوليات الطليعة (C1) ----------
// من هو عريف الطليعة و مساعده، و منذ متى. السطر لا يُمحى: نهاية المسؤولية تؤرَّخ، و
// مشغّل في db.js يغلقها بنفسه حين يغادر العنصر طليعته أو فرقته أو يُؤرشَف.
const RESP_ROLES = ['arif_awwal', 'arif', 'musaid', 'other'];
// العريف الأول عريفُ طليعته أيضًا: الدوران يشغلان مكانًا واحدًا، رأس الطليعة
const LEAD_ROLES = ['arif_awwal', 'arif'];
const STRUCT_ROLES = ['arif_awwal', 'arif', 'musaid'];
const RESP_LIMIT_DEFAULTS = { group_min: 5, group_max: 8, unit_max: 33 };

const responsibilitySQL = `SELECT r.id, r.member_id, r.branch_id, r.group_id, r.role, r.label, r.start_date,
    r.end_date, r.end_reason, r.assigned_by, r.ended_by, COALESCE(g.name, r.group_name) AS group_name,
    m.first_name, m.father_name, m.last_name, m.photo
  FROM member_responsibilities r JOIN members m ON m.id = r.member_id
  LEFT JOIN branch_groups g ON g.id = r.group_id`;

const currentResponsibilities = (branchId) =>
  db
    .prepare(
      `${responsibilitySQL} WHERE r.branch_id = ? AND r.end_date IS NULL
       ORDER BY CASE r.role WHEN 'arif_awwal' THEN 0 WHEN 'arif' THEN 1 WHEN 'musaid' THEN 2 ELSE 3 END, r.start_date`
    )
    .all(branchId);

function branchLimits(b) {
  return {
    group_min: b?.group_min ?? RESP_LIMIT_DEFAULTS.group_min,
    group_max: b?.group_max ?? RESP_LIMIT_DEFAULTS.group_max,
    unit_max: b?.unit_max ?? RESP_LIMIT_DEFAULTS.unit_max,
  };
}

// تنبيهات العدد في فرقة: طليعة بلا عريف، عدد خارج الحدّين، فرقة أكبر من حدّها، نشطون
// بلا طليعة. الطليعة الفارغة لا تُنبِّه (لم تُستعمل بعد)، و الفرقة بلا طلائع لا يُنبَّه
// فيها إلا على حجمها.
function staffingAlerts(branchId) {
  const b = db.prepare('SELECT id, group_min, group_max, unit_max FROM branches WHERE id = ?').get(branchId);
  if (!b) return null;
  const limits = branchLimits(b);
  const groups = groupsOfBranch(branchId);
  const active = db
    .prepare("SELECT COUNT(*) AS n FROM members WHERE branch_id = ? AND status = 'active'")
    .get(branchId).n;
  const unassigned = groups.length
    ? db
        .prepare("SELECT COUNT(*) AS n FROM members WHERE branch_id = ? AND status = 'active' AND group_id IS NULL")
        .get(branchId).n
    : 0;
  const led = new Set(
    db
      .prepare(
        `SELECT DISTINCT group_id FROM member_responsibilities
         WHERE branch_id = ? AND end_date IS NULL AND group_id IS NOT NULL AND role IN ('arif_awwal', 'arif')`
      )
      .all(branchId)
      .map((r) => r.group_id)
  );
  const used = groups.filter((g) => g.member_count > 0);
  const pick = (g) => ({ id: g.id, name: g.name, count: g.member_count });
  const out = {
    limits,
    active,
    groups: groups.length,
    no_lead: used.filter((g) => !led.has(g.id)).map(pick),
    small: used.filter((g) => g.member_count < limits.group_min).map(pick),
    large: used.filter((g) => g.member_count > limits.group_max).map(pick),
    over_unit: active > limits.unit_max,
    unassigned,
  };
  out.count =
    out.no_lead.length + out.small.length + out.large.length + (out.over_unit ? 1 : 0) + (unassigned ? 1 : 0);
  return out;
}

app.get('/api/branches/:id/responsibilities', requirePerm('branches.read'), (req, res) => {
  const branch = branchForGroups(req, res, 'branches.read');
  if (!branch) return;
  res.json({
    current: currentResponsibilities(branch.id),
    history: db
      .prepare(
        `${responsibilitySQL} WHERE r.branch_id = ? AND r.end_date IS NOT NULL ORDER BY r.end_date DESC, r.id DESC LIMIT 300`
      )
      .all(branch.id),
  });
});

// تكليف عنصر بمسؤولية. دور البنية (العريف الأول، العريف، المساعد) له صاحب واحد في
// الطليعة — و العريف الأول واحد في الفرقة — فيُغلق سلفه بتاريخ بدء الجديد (replaced)،
// و العنصر لا يحمل إلا دور بنية واحدًا في وقت واحد. الدور الحرّ (مصوّر، منشد…) يتعدّد.
app.post('/api/branches/:id/responsibilities', requirePerm('branches.groups'), (req, res) => {
  const branch = branchForGroups(req, res, 'branches.groups');
  if (!branch) return;
  const b = req.body || {};
  const role = RESP_ROLES.includes(b.role) ? b.role : null;
  if (!role) return res.status(400).json({ error: 'invalid role' });
  const label = role === 'other' && typeof b.label === 'string' ? b.label.trim().slice(0, 40) : null;
  if (role === 'other' && !label) return res.status(400).json({ error: 'label required' });
  const today = todayISO();
  const start = b.start_date === undefined || b.start_date === null || b.start_date === '' ? today : b.start_date;
  if (!validISODate(start) || start > today) return res.status(400).json({ error: 'invalid start_date' });
  const member = db
    .prepare("SELECT id, group_id FROM members WHERE id = ? AND branch_id = ? AND status = 'active'")
    .get(Number(b.member_id), branch.id);
  if (!member) return res.status(400).json({ error: 'invalid member_id' });
  if (role !== 'other' && !member.group_id) return res.status(409).json({ error: 'member_without_group' });
  const group = member.group_id
    ? db.prepare('SELECT id, name FROM branch_groups WHERE id = ?').get(member.group_id)
    : null;
  const open = db.prepare('SELECT * FROM member_responsibilities WHERE branch_id = ? AND end_date IS NULL').all(branch.id);
  if (open.some((r) => r.member_id === member.id && r.role === role && (role !== 'other' || r.label === label)))
    return res.status(409).json({ error: 'responsibility_exists' });
  const toClose = open.filter((r) => {
    if (role === 'other') return false;
    if (r.member_id === member.id) return STRUCT_ROLES.includes(r.role);
    if (r.group_id === member.group_id)
      return LEAD_ROLES.includes(role) ? LEAD_ROLES.includes(r.role) : r.role === role;
    return false;
  });
  // العريف الأول السابق، في طليعة أخرى، يبقى عريف طليعته
  const formerFirst =
    role === 'arif_awwal'
      ? open.find((r) => r.role === 'arif_awwal' && r.member_id !== member.id && r.group_id !== member.group_id)
      : null;
  const user = req.user?.display_name || req.user?.username || null;
  // MAX: تاريخ بدء أقدم من بدء السلف لا يجعله منتهيًا قبل أن يبدأ
  const close = db.prepare(
    `UPDATE member_responsibilities SET end_date = MAX(start_date, ?), end_reason = 'replaced', ended_by = ?
     WHERE id = ? AND end_date IS NULL`
  );
  const insert = db.prepare(
    `INSERT INTO member_responsibilities (member_id, branch_id, group_id, group_name, role, label, start_date, assigned_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let id;
  db.transaction(() => {
    for (const r of toClose) close.run(start, user, r.id);
    if (formerFirst) {
      close.run(start, user, formerFirst.id);
      const g =
        formerFirst.group_id && db.prepare('SELECT name FROM branch_groups WHERE id = ?').get(formerFirst.group_id);
      insert.run(
        formerFirst.member_id, branch.id, formerFirst.group_id, g?.name ?? formerFirst.group_name, 'arif', null, start, user
      );
    }
    id = insert.run(member.id, branch.id, group?.id ?? null, group?.name ?? null, role, label, start, user)
      .lastInsertRowid;
  })();
  const row = db.prepare(`${responsibilitySQL} WHERE r.id = ?`).get(id);
  auditEvent(req, 'create', 'responsibility', id, null, row);
  res.status(201).json(row);
});

// إنهاء مسؤولية: السطر يبقى، مؤرَّخًا
app.post('/api/branches/:id/responsibilities/:rid/end', requirePerm('branches.groups'), (req, res) => {
  const branch = branchForGroups(req, res, 'branches.groups');
  if (!branch) return;
  const r = db
    .prepare('SELECT * FROM member_responsibilities WHERE id = ? AND branch_id = ?')
    .get(req.params.rid, branch.id);
  if (!r) return res.status(404).json({ error: 'responsibility not found' });
  if (r.end_date) return res.status(409).json({ error: 'responsibility_ended' });
  const today = todayISO();
  const end = req.body?.end_date || today;
  if (!validISODate(end) || end > today || end < r.start_date)
    return res.status(400).json({ error: 'invalid end_date' });
  const user = req.user?.display_name || req.user?.username || null;
  db.prepare("UPDATE member_responsibilities SET end_date = ?, end_reason = 'ended', ended_by = ? WHERE id = ?")
    .run(end, user, r.id);
  const after = db.prepare('SELECT * FROM member_responsibilities WHERE id = ?').get(r.id);
  auditEvent(req, 'update', 'responsibility', r.id, r, after);
  res.json(after);
});

// محو سطر أُدخل خطأً (الإنهاء العادي يمرّ بـ /end)
app.delete('/api/branches/:id/responsibilities/:rid', requirePerm('branches.groups'), (req, res) => {
  const branch = branchForGroups(req, res, 'branches.groups');
  if (!branch) return;
  const r = db
    .prepare('SELECT * FROM member_responsibilities WHERE id = ? AND branch_id = ?')
    .get(req.params.rid, branch.id);
  if (!r) return res.status(404).json({ error: 'responsibility not found' });
  db.prepare('DELETE FROM member_responsibilities WHERE id = ?').run(r.id);
  auditEvent(req, 'delete', 'responsibility', r.id, r, null);
  res.status(204).end();
});

// حدود العدد في الفرقة، يضبطها قائدها
app.put('/api/branches/:id/group-limits', requirePerm('branches.groups'), (req, res) => {
  const branch = branchForGroups(req, res, 'branches.groups');
  if (!branch) return;
  const { group_min, group_max, unit_max } = req.body || {};
  const ok = (n, max) => Number.isInteger(n) && n >= 1 && n <= max;
  if (!ok(group_min, 99) || !ok(group_max, 99) || group_min > group_max || !ok(unit_max, 999))
    return res.status(400).json({ error: 'invalid limits' });
  const before = db.prepare('SELECT group_min, group_max, unit_max FROM branches WHERE id = ?').get(branch.id);
  db.prepare('UPDATE branches SET group_min = ?, group_max = ?, unit_max = ? WHERE id = ?')
    .run(group_min, group_max, unit_max, branch.id);
  auditEvent(req, 'update', 'branch_limits', branch.id, before, { group_min, group_max, unit_max });
  res.json(staffingAlerts(branch.id));
});

app.post('/api/branches', requireAdmin, (req, res) => {
  const err = validateBranchBody(req.body, { requireNames: true });
  if (err) return res.status(400).json({ error: err });
  const { name_fr, name_ar, min_age, max_age, total_requirements } = req.body;
  const allAges = !!req.body.all_ages;
  if (req.body.section !== undefined && !parseSection(req.body.section))
    return res.status(400).json({ error: 'invalid section' });
  // Said explicitly, or the قسم the admin is looking at, or قسم الفتيان as before
  const section = parseSection(req.body.section) || activeSection(req) || 'M';
  // sort_order mirrors min_age so branches always list in age order
  const info = db
    .prepare(
      `INSERT INTO branches (name_fr, name_ar, min_age, max_age, sort_order, total_requirements, all_ages, section,
         promotion_threshold) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name_fr.trim(),
      name_ar.trim(),
      allAges ? 0 : min_age,
      allAges ? null : (max_age ?? null),
      allAges ? ALL_AGES_SORT_ORDER : min_age,
      total_requirements,
      allAges ? 1 : 0,
      section,
      Number.isInteger(req.body.promotion_threshold) ? req.body.promotion_threshold : defaultThreshold(name_ar)
    );
  // مطالب القبول: ما أُرسل، و إلا قيم montadamahdi حسب الاسم
  const rules = { ...admissionDefaults(name_ar), ...admissionRulesFrom(req.body) };
  db.prepare(
    `UPDATE branches SET ${ADMISSION_RULE_KEYS.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`
  ).run(...ADMISSION_RULE_KEYS.map((k) => rules[k]), info.lastInsertRowid);
  res.status(201).json(db.prepare('SELECT * FROM branches WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/branches/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'branch not found' });
  // Absent = unchanged, like the names: a request that does not mention it must not flip it
  const allAges = req.body.all_ages !== undefined ? !!req.body.all_ages : !!existing.all_ages;
  const err = validateBranchBody({ ...req.body, all_ages: allAges }, { requireNames: false });
  if (err) return res.status(400).json({ error: err });
  const { min_age, max_age, total_requirements, name_fr, name_ar } = req.body;
  const usedMax = maxRequirementUsed(existing.id);
  if (total_requirements < usedMax)
    return res.status(409).json({ error: 'requirements_in_use', minimum: usedMax });
  const section = req.body.section === undefined ? existing.section : parseSection(req.body.section);
  if (!section) return res.status(400).json({ error: 'invalid section' });
  // A فرقة changes قسم only while nothing personal hangs on it: its عناصر, أنشطة and
  // بطاقات تحضير would otherwise cross over with it, and a قائد already placed in one
  // of its توصيفات would end up in the other قسم's تشكيلة.
  if (section !== existing.section) {
    const inUse =
      db.prepare('SELECT COUNT(*) AS n FROM members WHERE branch_id = ?').get(existing.id).n +
      db.prepare('SELECT COUNT(*) AS n FROM session_branches WHERE branch_id = ?').get(existing.id).n +
      db.prepare('SELECT COUNT(*) AS n FROM prep_cards WHERE branch_id = ?').get(existing.id).n +
      db.prepare('SELECT COUNT(*) AS n FROM assignments WHERE branch_id = ? AND leader_id IS NOT NULL').get(existing.id).n;
    if (inUse > 0) return res.status(409).json({ error: 'branch_section_in_use' });
  }
  db.transaction(() => {
    db.prepare(
      `UPDATE branches SET name_fr = ?, name_ar = ?, min_age = ?, max_age = ?, sort_order = ?, total_requirements = ?,
         all_ages = ?, section = ?, promotion_threshold = ?
       WHERE id = ?`
    ).run(
      name_fr !== undefined ? name_fr.trim() : existing.name_fr,
      name_ar !== undefined ? name_ar.trim() : existing.name_ar,
      allAges ? 0 : min_age,
      allAges ? null : (max_age ?? null),
      allAges ? ALL_AGES_SORT_ORDER : min_age,
      total_requirements,
      allAges ? 1 : 0,
      section,
      Number.isInteger(req.body.promotion_threshold) ? req.body.promotion_threshold : existing.promotion_threshold,
      req.params.id
    );
    const rules = admissionRulesFrom(req.body);
    if (Object.keys(rules).length)
      db.prepare(`UPDATE branches SET ${Object.keys(rules).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
        ...Object.values(rules),
        existing.id
      );
    // Labels of numbers that no longer exist go with them (nothing was ticked above usedMax)
    db.prepare('DELETE FROM branch_matalib WHERE branch_id = ? AND number > ?').run(existing.id, total_requirements);
    // توصيفات الفرقة (و هي فارغة هنا) تتبعها إلى قسمها الجديد
    if (section !== existing.section)
      db.prepare('UPDATE assignments SET section = ? WHERE branch_id = ?').run(section, existing.id);
  })();
  res.json(db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id));
});

app.delete('/api/branches/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  if (!db.prepare('SELECT id FROM branches WHERE id = ?').get(id))
    return res.status(404).json({ error: 'branch not found' });
  const inUse =
    db.prepare('SELECT COUNT(*) AS n FROM members WHERE branch_id = ?').get(id).n +
    // فرقة شريكة في نشاط مشترك مستعملة أيضًا و لو لم تكن فرقته الرئيسية
    db.prepare('SELECT COUNT(*) AS n FROM session_branches WHERE branch_id = ?').get(id).n +
    db.prepare('SELECT COUNT(*) AS n FROM promotions WHERE old_branch_id = ? OR new_branch_id = ?').get(id, id).n +
    db.prepare('SELECT COUNT(*) AS n FROM annual_plan WHERE branch_id = ?').get(id).n +
    db.prepare('SELECT COUNT(*) AS n FROM branch_groups WHERE branch_id = ?').get(id).n +
    db.prepare('SELECT COUNT(*) AS n FROM assignments WHERE branch_id = ?').get(id).n;
  if (inUse > 0) return res.status(400).json({ error: 'branch_in_use' });
  db.prepare('DELETE FROM branches WHERE id = ?').run(id);
  res.status(204).end();
});

// ---------- Referential lists (مكان السكن، المدرسة) ----------

// Each list backs one free-text member column. Registration picks from the list so the
// same quartier is always spelled the same way and filtering on it returns everybody.
const LOOKUP_COLUMNS = {
  residence_abidjan: 'address_abidjan',
  residence_lebanon: 'address_lebanon',
  school: 'school',
};
const LOOKUP_KINDS = Object.keys(LOOKUP_COLUMNS);

// usage_count is what makes a delete decidable: it says how many فرد still carry the value.
function lookupList(kind) {
  return db
    .prepare(
      `SELECT lv.*,
              (SELECT COUNT(*) FROM members m WHERE TRIM(m.${LOOKUP_COLUMNS[kind]}) = lv.label) AS usage_count
         FROM lookup_values lv WHERE lv.kind = ? ORDER BY lv.sort_order, lv.label`
    )
    .all(kind);
}

// Anyone who may open a member file needs the lists — they fill the pickers and the filters.
app.get('/api/lookups', requirePerm('members.read'), (req, res) => {
  res.json(Object.fromEntries(LOOKUP_KINDS.map((k) => [k, lookupList(k)])));
});

function validateLookup(body) {
  if (!LOOKUP_KINDS.includes(body.kind)) return 'invalid kind';
  if (!body.label || !String(body.label).trim()) return 'label required';
  return null;
}

// Adding to a list is part of registering: a quartier missing from the picker must be
// creatable on the spot, not through a trip to الإعدادات. Renaming and deleting stay
// admin-only — those rewrite or retire what everybody else already recorded.
app.post('/api/lookups', requireAnyPerm('members.create', 'members.edit'), (req, res) => {
  const err = validateLookup(req.body);
  if (err) return res.status(400).json({ error: err });
  const label = String(req.body.label).trim();
  const dup = db
    .prepare('SELECT id FROM lookup_values WHERE kind = ? AND label = ?')
    .get(req.body.kind, label);
  if (dup) return res.status(400).json({ error: 'duplicate label' });
  const info = db
    .prepare('INSERT INTO lookup_values (kind, label, sort_order) VALUES (?, ?, ?)')
    .run(req.body.kind, label, Number.isInteger(req.body.sort_order) ? req.body.sort_order : 0);
  res.status(201).json(db.prepare('SELECT * FROM lookup_values WHERE id = ?').get(info.lastInsertRowid));
});

// Renaming an entry rewrites it on every فرد that carries it: an admin fixing a spelling
// means "this place is now written like that", not "orphan everyone who lives there".
app.put('/api/lookups/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM lookup_values WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const body = { ...existing, ...req.body, kind: existing.kind };
  const err = validateLookup(body);
  if (err) return res.status(400).json({ error: err });
  const label = String(body.label).trim();
  const dup = db
    .prepare('SELECT id FROM lookup_values WHERE kind = ? AND label = ? AND id != ?')
    .get(existing.kind, label, existing.id);
  if (dup) return res.status(400).json({ error: 'duplicate label' });
  const col = LOOKUP_COLUMNS[existing.kind];
  db.transaction(() => {
    db.prepare('UPDATE lookup_values SET label = ?, sort_order = ? WHERE id = ?').run(
      label,
      Number.isInteger(body.sort_order) ? body.sort_order : 0,
      existing.id
    );
    if (label !== existing.label) {
      db.prepare(`UPDATE members SET ${col} = ? WHERE TRIM(${col}) = ?`).run(label, existing.label);
    }
  })();
  res.json(db.prepare('SELECT * FROM lookup_values WHERE id = ?').get(existing.id));
});

// Deleting only retires the entry from the pickers. The فرد who live there keep their
// address on file — the list curates future input, it does not own past data.
app.delete('/api/lookups/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM lookup_values WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

// ---------- Members ----------

// Only the name is typed by force. sex and branch_id always arrive — the form preselects
// them — and stay required because the table's CHECK / foreign key need them.
const MEMBER_FIELDS = ['first_name', 'last_name', 'sex', 'branch_id'];

// فصيلة الدم — a closed list: a group outing needs it readable at a glance, and a
// free-text field would fill up with "O positif", "o+", "O +" for the same thing.
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function validISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function validPhone(value) {
  if (value === undefined || value === null || value === '') return true;
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 18;
}

function validPhoto(value) {
  if (value === undefined || value === null || value === '') return true;
  const text = String(value);
  return text.length <= 1500000 && (/^data:image\/(png|jpeg|webp);base64,/i.test(text) || /^https?:\/\//i.test(text));
}

function validateMember(body) {
  for (const f of MEMBER_FIELDS) {
    if (body[f] === undefined || body[f] === null || body[f] === '') return `missing field: ${f}`;
  }
  if (body.blood_type && !BLOOD_TYPES.includes(body.blood_type)) return 'invalid blood_type';
  if (!['M', 'F'].includes(body.sex)) return 'invalid sex';
  if (!['active', 'inactive'].includes(body.status || 'active')) return 'invalid status';
  if (!String(body.first_name).trim() || !String(body.last_name).trim()) return 'invalid name';
  if (body.join_date && !validISODate(body.join_date)) return 'invalid date';
  if (body.birth_date && (!validISODate(body.birth_date) || body.birth_date > todayISO()))
    return 'invalid birth_date';
  if (![body.member_phone, body.father_phone, body.mother_phone].every(validPhone)) return 'invalid phone';
  if (!validPhoto(body.photo)) return 'invalid photo';
  if (!db.prepare('SELECT id FROM branches WHERE id = ?').get(body.branch_id)) return 'invalid branch_id';
  return null;
}

// جنس العنصر من قسم الطلب: حساب الفتيات لا يسجّل ذكرًا، و حساب الفتيان (أو الفرنكوفون،
// ما دام قسمهم للفتيان) لا يسجّل أنثى.
const sexOutsideSection = (req) => {
  // قسمٌ مختلط (gender null) يقبل الجنسين
  const gender = sectionDef(activeSection(req))?.gender;
  return !!gender && req.body.sex !== gender;
};

// Age is derived from birth_date, so sorting by age is sorting by birth_date:
// the oldest عنصر is the one born first.
const MEMBER_SORTS = {
  name: 'm.last_name, m.first_name',
  // بلا تاريخ ميلاد = سنّ مجهول: آخر القائمة في الاتجاهين، لا «الأكبر» لأن NULL يسبق
  age_desc: 'm.birth_date IS NULL, m.birth_date ASC, m.last_name',
  age_asc: 'm.birth_date IS NULL, m.birth_date DESC, m.last_name',
  school: "COALESCE(NULLIF(m.school, ''), 'zzz'), m.last_name, m.first_name",
  residence: "COALESCE(NULLIF(m.address_abidjan, ''), 'zzz'), m.last_name, m.first_name",
};

// Local calendar date, N years back — the bound that turns an age filter into a
// birth_date range. Matching calcAge exactly: age >= N means born on or before this day.
function isoYearsAgo(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - Number(years));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Phones are typed with spaces, dashes and +225 prefixes: compare digits to digits
const phoneDigits = (col) =>
  `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col}, ' ', ''), '-', ''), '.', ''), '(', ''), ')', ''), '+', '')`;

// ملفّ ناقص: what a list can ask for "who still lacks X". The keys of «any» are the
// fields the member's profile counts in its «champs non renseignés» banner, so the
// list and the banner agree; فصيلة الدم comes on top, since a camp needs it. Contact
// fields are left out for an account that may not read them.
const blankSQL = (col) => `COALESCE(TRIM(${col}), '') = ''`;
const MEMBER_MISSING = {
  birth_date: () => blankSQL('m.birth_date'),
  father_name: () => blankSQL('m.father_name'),
  school: () => blankSQL('m.school'),
  parent_phone: (contact) => contact && `(${blankSQL('m.father_phone')} AND ${blankSQL('m.mother_phone')})`,
  residence: (contact) => contact && blankSQL('m.address_abidjan'),
  blood: () => blankSQL('m.blood_type'),
};
const PROFILE_FIELDS = ['birth_date', 'father_name', 'school', 'parent_phone', 'residence'];

function memberMissingSQL(key, canContact) {
  if (key === 'any') return `(${PROFILE_FIELDS.map((k) => MEMBER_MISSING[k](canContact)).filter(Boolean).join(' OR ')})`;
  return Object.hasOwn(MEMBER_MISSING, key) ? MEMBER_MISSING[key](canContact) || null : null;
}

app.get('/api/members', requirePerm('members.read'), (req, res) => {
  const {
    branch, q, status, school, residence,
    residence_lebanon: residenceLebanon,
    blood, age_min: ageMin, age_max: ageMax,
    parent_phone: parentPhone,
    joined_from: joinedFrom, joined_to: joinedTo,
    missing, follow,
  } = req.query;
  const canContact = hasPerm(req, 'members.contact');
  let sql = `SELECT m.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
               g.name AS group_name,
               (SELECT json_group_array(json_object('role', r.role, 'label', r.label))
                  FROM member_responsibilities r WHERE r.member_id = m.id AND r.end_date IS NULL) AS roles_json
             FROM members m JOIN branches b ON b.id = m.branch_id
             LEFT JOIN branch_groups g ON g.id = m.group_id WHERE 1=1`;
  const params = [];
  sql += branchFilterSQL(req, 'm.branch_id');
  if (branch) { sql += ' AND m.branch_id = ?'; params.push(branch); }
  // "none" = العناصر التي لم تُوزَّع على مجموعة بعد — هي أول ما يبحث عنه القائد وهو يوزّع
  if (req.query.group === 'none') sql += ' AND m.group_id IS NULL';
  else if (req.query.group) { sql += ' AND m.group_id = ?'; params.push(req.query.group); }
  if (status) { sql += ' AND m.status = ?'; params.push(status); }
  if (school) { sql += ' AND m.school = ?'; params.push(school); }
  if (blood) { sql += ' AND m.blood_type = ?'; params.push(blood); }
  // Age is derived, so filtering on it filters birth_date: the older the عنصر, the earlier the date
  if (ageMin !== undefined && ageMin !== '') { sql += ' AND m.birth_date <= ?'; params.push(isoYearsAgo(ageMin)); }
  if (ageMax !== undefined && ageMax !== '') { sql += ' AND m.birth_date > ?'; params.push(isoYearsAgo(Number(ageMax) + 1)); }
  if (joinedFrom) { sql += ' AND m.join_date >= ?'; params.push(joinedFrom); }
  if (joinedTo) { sql += ' AND m.join_date <= ?'; params.push(joinedTo); }
  // مكان السكن and phones are contact data: an account that may not read them may not filter on them either
  if (residence && canContact) {
    sql += ' AND m.address_abidjan = ?';
    params.push(residence);
  }
  if (residenceLebanon && canContact) {
    sql += ' AND m.address_lebanon = ?';
    params.push(residenceLebanon);
  }
  if (parentPhone && canContact) {
    const digits = String(parentPhone).replace(/[^0-9]/g, '');
    if (digits) {
      sql += ` AND (${phoneDigits('m.father_phone')} LIKE ? OR ${phoneDigits('m.mother_phone')} LIKE ?)`;
      params.push(`%${digits}%`, `%${digits}%`);
    }
  }
  if (missing) {
    const blank = memberMissingSQL(String(missing), canContact);
    if (blank) sql += ` AND ${blank}`;
  }
  if (q) {
    // One box for every way a قائد recognises a عنصر: name, school, quartier,
    // فصيلة الدم, a phone number read off a screen, or plain age typed as a number.
    const like = `%${q}%`;
    const or = [
      'm.first_name LIKE ?',
      'm.last_name LIKE ?',
      // اسم الأب صار معروضًا في القوائم، فالبحث به لازم: هو ما يفرّق بين «علي أحمد»
      // و «علي أحمد» الآخر. الشكل الثلاثي يُطابَق كاملًا، و بلا اسم أب يبقى ثنائيًا.
      'm.father_name LIKE ?',
      "(m.first_name || ' ' || m.last_name) LIKE ?",
      "(m.first_name || ' ' || COALESCE(m.father_name || ' ', '') || m.last_name) LIKE ?",
      'm.school LIKE ?',
      'm.blood_type = ?',
    ];
    params.push(like, like, like, like, like, like, String(q).trim().toUpperCase());
    if (canContact) {
      or.push('m.address_abidjan LIKE ?', 'm.address_lebanon LIKE ?');
      params.push(like, like);
      const digits = String(q).replace(/[^0-9]/g, '');
      if (digits) {
        or.push(
          `${phoneDigits('m.member_phone')} LIKE ?`,
          `${phoneDigits('m.father_phone')} LIKE ?`,
          `${phoneDigits('m.mother_phone')} LIKE ?`
        );
        params.push(`%${digits}%`, `%${digits}%`, `%${digits}%`);
      }
    }
    // A bare number is read as an age — "12" should list the twelve-year-olds
    const asAge = Number(String(q).trim());
    if (Number.isInteger(asAge) && asAge >= 0 && asAge < 120) {
      or.push('(m.birth_date <= ? AND m.birth_date > ?)');
      params.push(isoYearsAgo(asAge), isoYearsAgo(asAge + 1));
    }
    sql += ` AND (${or.join(' OR ')})`;
  }
  sql += ` ORDER BY ${MEMBER_SORTS[req.query.sort] || MEMBER_SORTS.name}`;
  const rows = db
    .prepare(sql)
    .all(...params)
    .map((m) => {
      // الحضور في الفرقة الحالية، محسوبًا كما في ملفّ العنصر: من توقّف عن المجيء
      // يظهر في القائمة نفسها، قبل أن يُفتح ملفّه
      const st = statsFromRows(attributedAttendance(m).rows.filter((r) => r.attributed_branch === m.branch_id));
      const attendance = {
        rate: st.rate,
        present: st.present,
        total: st.total,
        absences: st.consecutive_absences,
        last_present: st.history.find((r) => r.status === 'present')?.date || null,
        // آخر ثمانية أنشطة، الأحدث أولًا — شريط الحضور في القائمة، كخانات دفتر الحضور
        recent: st.history.slice(0, 8).map((r) => ({ date: r.date, status: r.status })),
      };
      const { roles_json: rolesJson, ...rest } = m;
      return stripContact(req, { ...rest, age: calcAge(m.birth_date), attendance, responsibilities: JSON.parse(rolesJson || '[]') });
    });
  // الحضور محسوب هنا لا في SQL، فترتيبه هنا: الأضعف أولًا، و من لم يُسجَّل له
  // نشاط بعدُ في الآخر. الترتيب ثابت، فالأسماء تبقى أبجدية داخل النسبة الواحدة.
  if (req.query.sort === 'attendance')
    rows.sort((a, b) => (a.attendance.rate ?? 101) - (b.attendance.rate ?? 101));
  // «للمتابعة»: absent from their last three activities or more — the dashboard's
  // follow-up and the red mark in the list, as a filter. The streak is only known
  // once attendance is computed, so it is cut here rather than in SQL.
  // Le dernier contact avec la famille (A2), pour «contacté il y a X jours par Y»
  const contacts = lastContactsOf(rows.map((m) => m.id));
  for (const m of rows) m.last_contact = contacts.get(m.id) || null;
  // G1 : les mois de cotisation en retard (la puce «x أشهر»), pour qui voit les cotisations
  let out = follow ? rows.filter((m) => m.status === 'active' && m.attendance.absences >= absenceThreshold()) : rows;
  if (canSeeMemberDues(req)) {
    const late = arrearsByMember(rows);
    for (const m of rows) {
      const a = late.get(m.id);
      m.dues_late = a ? { months: a.months.length, owed: a.owed, late: isLate(a.months) } : null;
    }
    if (req.query.dues === 'late') out = out.filter((m) => m.dues_late?.late);
  }
  res.json(out);
});

// Values actually present in the base, to fill the المدرسة / مكان السكن filters.
// Declared before /api/members/:id so "filters" is not read as an id.
app.get('/api/members/filters', requirePerm('members.read'), (req, res) => {
  const distinct = (col) =>
    db
      .prepare(
        `SELECT DISTINCT ${col} AS v FROM members m
          WHERE ${col} IS NOT NULL AND TRIM(${col}) != ''${branchFilterSQL(req, 'm.branch_id')}
          ORDER BY v`
      )
      .all()
      .map((r) => r.v);
  res.json({
    schools: distinct('m.school'),
    residences: hasPerm(req, 'members.contact') ? distinct('m.address_abidjan') : [],
    residencesLebanon: hasPerm(req, 'members.contact') ? distinct('m.address_lebanon') : [],
    // The closed list, not what happens to be in the base: an empty فصيلة must stay pickable
    bloodTypes: BLOOD_TYPES,
  });
});

app.get('/api/members/:id', requirePerm('members.read'), (req, res) => {
  const m = db
    .prepare(
      `SELECT m.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        b.total_requirements AS branch_total_requirements, g.name AS group_name
       FROM members m JOIN branches b ON b.id = m.branch_id
       LEFT JOIN branch_groups g ON g.id = m.group_id WHERE m.id = ?`
    )
    .get(req.params.id);
  if (!m) return res.status(404).json({ error: 'member not found' });
  if (!branchOk(req, m.branch_id)) return res.status(403).json({ error: 'forbidden' });
  const promotions = db
    .prepare(
      `SELECT p.id, p.promoted_at, p.matalib, p.override, p.override_reason, p.old_branch_id,
        p.reversed_at, p.reversed_by, p.reversal_reason,
        ob.name_fr AS old_name_fr, ob.name_ar AS old_name_ar,
        ob.total_requirements AS old_total_requirements,
        nb.name_fr AS new_name_fr, nb.name_ar AS new_name_ar
       FROM promotions p
       JOIN branches ob ON ob.id = p.old_branch_id
       JOIN branches nb ON nb.id = p.new_branch_id
       WHERE p.member_id = ?
       ORDER BY p.promoted_at DESC, p.id DESC`
    )
    .all(m.id)
    .map((p) => ({ ...p, matalib: JSON.parse(p.matalib || '[]') }));
  // Bug 5 : les changements de فرقة hors ترفيع (mutation, correction). Les ترفيعات et leurs
  // annulations sont déjà dans `promotions` (annulée = reversed_at), on ne les double pas.
  const branch_moves = db
    .prepare(
      `SELECT h.id, h.effective_date, h.reason, h.changed_by, h.old_branch_id, h.new_branch_id,
        ob.name_fr AS old_name_fr, ob.name_ar AS old_name_ar, nb.name_fr AS new_name_fr, nb.name_ar AS new_name_ar
       FROM member_branch_history h
       JOIN branches ob ON ob.id = h.old_branch_id
       JOIN branches nb ON nb.id = h.new_branch_id
       WHERE h.member_id = ? AND h.source_promotion_id IS NULL AND h.reason IN ('transfer', 'correction')
       ORDER BY h.effective_date DESC, h.id DESC`
    )
    .all(m.id);
  // المبالغ صلاحية قائمة بذاتها، كالهواتف: من لا يراها لا تصله أرقامها أصلًا
  const canSeeFees = hasPerm(req, 'sessions.read.fees');
  const { periodsAsc, rows: allRows } = attributedAttendance(m, { withFees: canSeeFees });
  const currentStats = statsFromRows(allRows.filter((r) => r.attributed_branch === m.branch_id));
  const earned = earnedNumbersInBranch(m.id, m.branch_id);
  const former_attendance = periodsAsc.map((p) => {
    const st = statsFromRows(allRows.filter((r) => r.attributed_branch === p.old_branch_id));
    return {
      branch_id: p.old_branch_id,
      branch_name_fr: p.name_fr,
      branch_name_ar: p.name_ar,
      until: p.promoted_at,
      total: st.total,
      present: st.present,
      rate: st.rate,
      history: st.history,
    };
  });
  res.json(
    stripContact(req, {
      ...m,
      age: calcAge(m.birth_date),
      stats: { ...currentStats, requirements_earned: earned.length, earned_numbers: earned },
      // الاشتراكات المدفوعة تراكميًّا منذ الانتساب — عبر الفرق كلها، فالترقية لا تصفّر
      // مالًا دُفع. يجمعها البرنامج من خانات الأنشطة، لا يُدخَل المجموع يدويًا.
      subscriptions: canSeeFees ? memberSubscriptions(m.id) : null,
      former_attendance,
      absence_threshold: absenceThreshold(),
      visits: familyVisits(m.id),
      // مطالب زيدت أو أُلغيت يدويًا — the UI marks them apart from the ones earned in أنشطة
      manual_matalib: manualMatalib(m.id, m.branch_id),
      // ما تعنيه الأرقام، و عتبة الترفيع في فرقته
      matalib_catalog: branchMatalibList(m.branch_id),
      promotion_threshold: branchThreshold(
        db.prepare('SELECT name_ar, promotion_threshold FROM branches WHERE id = ?').get(m.branch_id)
      ),
      promotions,
      branch_moves,
      // مسؤولياته في الطليعة، الجارية أولًا ثم المنتهية (C1)
      responsibilities: db
        .prepare(
          `SELECT r.id, r.role, r.label, r.start_date, r.end_date, r.end_reason, r.branch_id,
             COALESCE(g.name, r.group_name) AS group_name, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
           FROM member_responsibilities r JOIN branches b ON b.id = r.branch_id
           LEFT JOIN branch_groups g ON g.id = r.group_id
           WHERE r.member_id = ? ORDER BY r.end_date IS NOT NULL, COALESCE(r.end_date, r.start_date) DESC, r.id DESC`
        )
        .all(m.id),
    })
  );
});

app.post('/api/members', requirePerm('members.create'), (req, res) => {
  const err = validateMember(req.body);
  if (err) return res.status(400).json({ error: err });
  if (!branchOk(req, req.body.branch_id)) return res.status(403).json({ error: 'forbidden' });
  if (sexOutsideSection(req)) return res.status(403).json({ error: 'sex_outside_section' });
  const b = req.body;
  // IS, not =: two entries with the same name and no birth date are the same عنصر
  // registered twice — the date is what tells real homonyms apart. Looked for in the
  // new عنصر's own قسم only: the answer names a record, and the other قسم's stay unseen.
  const duplicate = db
    .prepare(
      `SELECT id FROM members
       WHERE lower(trim(first_name)) = lower(trim(?))
         AND lower(trim(last_name)) = lower(trim(?)) AND birth_date IS ?
         AND branch_id IN (SELECT id FROM branches WHERE section = ?)
       LIMIT 1`
    )
    .get(b.first_name, b.last_name, b.birth_date || null, sectionOfBranch(b.branch_id));
  if (duplicate) return res.status(409).json({ error: 'member_duplicate', member_id: duplicate.id });
  const groupId = resolveGroupId(b.group_id, b.branch_id);
  if (groupId === undefined) return res.status(400).json({ error: 'invalid group_id' });
  // B1 : un nouvel عنصر commence en فترة التجربة, à sa date d'adhésion. Le قائد peut
  // l'inscrire déjà مكرَّس (date facultative).
  const invested = b.admission_status === 'invested';
  if (invested && b.invested_at && (!validISODate(b.invested_at) || b.invested_at > todayISO()))
    return res.status(400).json({ error: 'invalid date' });
  const admission = invested
    ? { status: 'invested', invested_at: b.invested_at || null, trial_started_at: null }
    : { status: 'trial', invested_at: null, trial_started_at: b.join_date && b.join_date <= todayISO() ? b.join_date : todayISO() };
  const info = db
    .prepare(
      `INSERT INTO members (first_name, last_name, father_name, mother_name, birth_date, birth_place,
        address_abidjan, address_lebanon, school, blood_type, sex, branch_id, group_id, member_phone,
        father_phone, mother_phone, join_date, photo, status, admission_status, invested_at, trial_started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(b.first_name).trim(), String(b.last_name).trim(), b.father_name?.trim() || null, b.mother_name?.trim() || null,
      b.birth_date || null, b.birth_place || null, b.address_abidjan || null, b.address_lebanon || null,
      b.school || null, b.blood_type || null, b.sex, b.branch_id, groupId, b.member_phone || null,
      b.father_phone || null, b.mother_phone || null, b.join_date || null, b.photo || null, b.status || 'active',
      admission.status, admission.invested_at, admission.trial_started_at
    );
  const created = db.prepare('SELECT * FROM members WHERE id = ?').get(info.lastInsertRowid);
  auditEvent(req, 'create', 'member', created.id, null, created);
  notifications.memberCreated(req, created);
  res.status(201).json(stripContact(req, created));
});

app.put('/api/members/:id', requirePerm('members.edit'), (req, res) => {
  const existing = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'member not found' });
  const err = validateMember(req.body);
  if (err) return res.status(400).json({ error: err });
  // Both the member's current فرقة and the one being assigned must be in scope
  if (!branchOk(req, existing.branch_id) || !branchOk(req, req.body.branch_id))
    return res.status(403).json({ error: 'forbidden' });
  if (sexOutsideSection(req)) return res.status(403).json({ error: 'sex_outside_section' });
  // بلا members.contact لم يصل الهاتف و السكن إلى النموذج أصلًا (stripContact)، فيعودان
  // فارغين: حفظهما كما هما يمحو ما في القاعدة. تبقى القيم المسجّلة إذن.
  const b = hasPerm(req, 'members.contact')
    ? req.body
    : { ...req.body, ...Object.fromEntries(CONTACT_FIELDS.map((f) => [f, existing[f]])) };
  // مجموعات الفرقة الجديدة وحدها مقبولة: نقل عنصر إلى فرقة أخرى يُخرجه من مجموعته
  // القديمة، إلا أن يكون الطلب نفسه قد اختار له مجموعة من الفرقة الجديدة.
  const groupId = resolveGroupId(b.group_id, b.branch_id);
  if (groupId === undefined) return res.status(400).json({ error: 'invalid group_id' });
  const branchChanged = Number(existing.branch_id) !== Number(b.branch_id);
  const changeReason = req.body.branch_change_reason;
  if (branchChanged && !['transfer', 'correction'].includes(changeReason))
    return res.status(400).json({ error: 'branch_change_reason_required' });
  const effectiveDate = req.body.branch_change_date || todayISO();
  if (branchChanged && !validISODate(effectiveDate))
    return res.status(400).json({ error: 'invalid branch_change_date' });
  db.transaction(() => {
    db.prepare(
      `UPDATE members SET first_name = ?, last_name = ?, father_name = ?, mother_name = ?,
       birth_date = ?, birth_place = ?, address_abidjan = ?, address_lebanon = ?, school = ?, blood_type = ?,
       sex = ?, branch_id = ?, group_id = ?, member_phone = ?, father_phone = ?, mother_phone = ?,
       join_date = ?, photo = ?, status = ?,
       archived_at = CASE WHEN ? = 'active' THEN NULL ELSE COALESCE(archived_at, datetime('now')) END,
       archived_by = CASE WHEN ? = 'active' THEN NULL ELSE COALESCE(archived_by, ?) END
       WHERE id = ?`
    ).run(
      String(b.first_name).trim(), String(b.last_name).trim(), b.father_name?.trim() || null, b.mother_name?.trim() || null,
      b.birth_date || null, b.birth_place || null, b.address_abidjan || null, b.address_lebanon || null,
      b.school || null, b.blood_type || null, b.sex, b.branch_id, groupId, b.member_phone || null,
      b.father_phone || null, b.mother_phone || null, b.join_date || null, b.photo || null,
      b.status || 'active', b.status || 'active', b.status || 'active',
      req.user.display_name || req.user.username, req.params.id
    );
    if (branchChanged)
      db.prepare(
        `INSERT INTO member_branch_history
          (member_id, old_branch_id, new_branch_id, effective_date, reason, changed_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        existing.id,
        existing.branch_id,
        b.branch_id,
        effectiveDate,
        changeReason,
        req.user.display_name || req.user.username
      );
  })();
  const updated = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  auditEvent(req, 'update', 'member', existing.id, existing, updated);
  res.json(stripContact(req, updated));
});

// الأرشفة لا تمحو شيئًا: العنصر يخرج من الأنشطة و الترفيعات و العدّ، و يبقى
// سجلّه كاملًا ليُعاد تفعيله متى عاد — كجوّالٍ توقّف عند آخر فرقته ثم رجع.
const archiveMemberStmt = db.prepare(
  "UPDATE members SET status = 'inactive', archived_at = datetime('now'), archived_by = ? WHERE id = ?"
);
function archiveMember(req, existing) {
  archiveMemberStmt.run(req.user.display_name || req.user.username, existing.id);
  auditEvent(req, 'archive', 'member', existing.id, existing, { ...existing, status: 'inactive' });
}

app.delete('/api/members/:id', requirePerm('members.delete'), (req, res) => {
  const existing = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'member not found' });
  if (!branchOk(req, existing.branch_id)) return res.status(403).json({ error: 'forbidden' });
  archiveMember(req, existing);
  res.status(204).end();
});

// أرشفة دفعة واحدة — من صفحة الترفيعات، لمن بلغ سنّ الفرقة التالية و توقّف
app.post('/api/members/archive', requirePerm('members.delete'), (req, res) => {
  const rawIds = req.body?.member_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0)
    return res.status(400).json({ error: 'member_ids required' });
  const ids = [...new Set(rawIds.map(Number))];
  const find = db.prepare('SELECT * FROM members WHERE id = ?');
  const rows = ids.map((id) => find.get(id));
  if (rows.some((m) => !m)) return res.status(404).json({ error: 'member not found' });
  if (rows.some((m) => !branchOk(req, m.branch_id))) return res.status(403).json({ error: 'forbidden' });
  const toArchive = rows.filter((m) => m.status === 'active');
  db.transaction(() => {
    for (const m of toArchive) archiveMember(req, m);
  })();
  res.json({ archived: toArchive.length });
});

app.post('/api/members/:id/restore', requirePerm('members.edit'), (req, res) => {
  const existing = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'member not found' });
  if (!branchOk(req, existing.branch_id)) return res.status(403).json({ error: 'forbidden' });
  if (existing.status === 'active') return res.status(409).json({ error: 'member_already_active' });
  db.prepare(
    "UPDATE members SET status = 'active', archived_at = NULL, archived_by = NULL WHERE id = ?"
  ).run(existing.id);
  const updated = db.prepare('SELECT * FROM members WHERE id = ?').get(existing.id);
  auditEvent(req, 'restore', 'member', existing.id, existing, updated);
  res.json(stripContact(req, updated));
});

// ---------- سجل المتابعة (A2) ----------
// Chaque contact avec la famille d'un عنصر : quand, qui, par quel canal, le motif, une note
// et la relance prévue. Les زيارات الأهل (séances kind='visit') se lisent dans le même fil.
// Lire : members.read ; écrire : members.followup. Une ligne se corrige ou s'efface par son
// auteur (ou l'admin). Tout est tracé dans le journal d'audit.
const contactSQL = 'SELECT * FROM member_contacts WHERE id = ?';
function parseContact(body) {
  const b = body || {};
  const date = String(b.contacted_at || todayISO()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayISO()) return { error: 'invalid_date' };
  const channel = CONTACT_CHANNELS.includes(b.channel) ? b.channel : null;
  if (!channel) return { error: 'invalid_channel' };
  const reason = b.reason ? (ABSENCE_REASONS.includes(b.reason) ? b.reason : undefined) : null;
  if (reason === undefined) return { error: 'invalid_reason' };
  const next = b.next_date ? String(b.next_date).slice(0, 10) : null;
  if (next && (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next < date)) return { error: 'invalid_next_date' };
  const note = String(b.note || '').trim().slice(0, 1000) || null;
  return { value: { contacted_at: date, channel, reason, note, next_date: next } };
}
function followupMember(req, res) {
  const m = db.prepare('SELECT id, branch_id, status FROM members WHERE id = ?').get(intOr(req.params.id));
  if (!m) return void res.status(404).json({ error: 'member not found' });
  if (!branchOk(req, m.branch_id)) return void res.status(403).json({ error: 'forbidden' });
  return m;
}
const contactsOfMember = (memberId) =>
  db
    .prepare('SELECT * FROM member_contacts WHERE member_id = ? ORDER BY contacted_at DESC, id DESC')
    .all(memberId);
const canEditContact = (req, c) => req.user.role === 'admin' || (c.user_id && c.user_id === req.user.id);

app.get('/api/members/:id/contacts', requirePerm('members.read'), (req, res) => {
  const m = followupMember(req, res);
  if (!m) return;
  res.json({
    items: contactsOfMember(m.id).map((c) => ({ ...c, can_edit: hasPerm(req, 'members.followup') && canEditContact(req, c) })),
    visits: familyVisits(m.id),
    can_write: hasPerm(req, 'members.followup'),
  });
});

app.post('/api/members/:id/contacts', requirePerm('members.followup'), (req, res) => {
  const m = followupMember(req, res);
  if (!m) return;
  const { value, error } = parseContact(req.body);
  if (error) return res.status(400).json({ error });
  const info = db
    .prepare(
      `INSERT INTO member_contacts (member_id, contacted_at, contacted_by, user_id, channel, reason, note, next_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(m.id, value.contacted_at, req.user.display_name || req.user.username, req.user.id, value.channel, value.reason, value.note, value.next_date);
  const c = db.prepare(contactSQL).get(info.lastInsertRowid);
  auditEvent(req, 'create', 'member_contact', c.id, null, c);
  res.status(201).json({ ...c, can_edit: true });
});

function loadOwnContact(req, res) {
  const m = followupMember(req, res);
  if (!m) return;
  const c = db.prepare(contactSQL).get(intOr(req.params.cid));
  if (!c || c.member_id !== m.id) return void res.status(404).json({ error: 'contact not found' });
  if (!canEditContact(req, c)) return void res.status(403).json({ error: 'forbidden' });
  return c;
}

app.put('/api/members/:id/contacts/:cid', requirePerm('members.followup'), (req, res) => {
  const c = loadOwnContact(req, res);
  if (!c) return;
  const { value, error } = parseContact(req.body);
  if (error) return res.status(400).json({ error });
  db.prepare(
    'UPDATE member_contacts SET contacted_at = ?, channel = ?, reason = ?, note = ?, next_date = ? WHERE id = ?'
  ).run(value.contacted_at, value.channel, value.reason, value.note, value.next_date, c.id);
  const after = db.prepare(contactSQL).get(c.id);
  auditEvent(req, 'update', 'member_contact', c.id, c, after);
  res.json({ ...after, can_edit: true });
});

app.delete('/api/members/:id/contacts/:cid', requirePerm('members.followup'), (req, res) => {
  const c = loadOwnContact(req, res);
  if (!c) return;
  db.prepare('DELETE FROM member_contacts WHERE id = ?').run(c.id);
  auditEvent(req, 'delete', 'member_contact', c.id, c, null);
  res.status(204).end();
});

// Réglages du suivi : le seuil de la série d'absences (admin)
app.get('/api/settings/followup', (req, res) => res.json({ absence_threshold: absenceThreshold() }));
app.put('/api/settings/followup', requireAdmin, (req, res) => {
  const n = Number(req.body?.absence_threshold);
  if (!Number.isInteger(n) || n < 2 || n > 10) return res.status(400).json({ error: 'invalid_threshold' });
  const before = absenceThreshold();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('absence_threshold', ?, datetime('now'), ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(String(n), req.user.display_name || req.user.username);
  auditEvent(req, 'update', 'app_setting', 'absence_threshold', { value: before }, { value: n });
  res.json({ absence_threshold: n });
});

// زيادة أو إلغاء مطلب لعنصر بشكل يدوي، بمعزل عن حضوره في الأنشطة:
//   granted — المطلب محقق ولو لم يُسجَّل في أي نشاط
//   revoked — المطلب ملغى ولو حُقق في نشاط
//   auto    — إزالة التعديل اليدوي والعودة إلى الحساب من الأنشطة
app.post('/api/members/:id/matalib', requirePerm('members.matalib'), (req, res) => {
  const m = db
    .prepare(
      `SELECT m.id, m.branch_id, b.total_requirements
       FROM members m JOIN branches b ON b.id = m.branch_id WHERE m.id = ?`
    )
    .get(req.params.id);
  if (!m) return res.status(404).json({ error: 'member not found' });
  if (!branchOk(req, m.branch_id)) return res.status(403).json({ error: 'forbidden' });
  const { number, state } = req.body || {};
  if (!Number.isInteger(number) || number < 1 || (m.total_requirements && number > m.total_requirements))
    return res.status(400).json({ error: 'invalid number' });
  if (!['granted', 'revoked', 'auto'].includes(state))
    return res.status(400).json({ error: 'invalid state' });
  const before =
    db
      .prepare('SELECT number, state, updated_at, updated_by FROM member_matalib WHERE member_id = ? AND branch_id = ? AND number = ?')
      .get(m.id, m.branch_id, number) || null;
  if (state === 'auto') {
    db.prepare('DELETE FROM member_matalib WHERE member_id = ? AND branch_id = ? AND number = ?').run(
      m.id, m.branch_id, number
    );
  } else {
    db.prepare(
      `INSERT INTO member_matalib (member_id, branch_id, number, state, updated_at, updated_by)
       VALUES (?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT(member_id, branch_id, number) DO UPDATE SET
         state = excluded.state, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).run(m.id, m.branch_id, number, state, req.user.display_name || req.user.username);
  }
  // السطر اليدوي يُحذف عند «auto»: السجلّ وحده يحفظ من منح المطلب ثم من سحبه
  if ((before?.state || 'auto') !== state)
    auditEvent(
      req,
      'matlab',
      'member',
      m.id,
      { branch_id: m.branch_id, number, state: before?.state || 'auto' },
      { branch_id: m.branch_id, number, state }
    );
  res.json({
    earned_numbers: earnedNumbersInBranch(m.id, m.branch_id),
    manual_matalib: manualMatalib(m.id, m.branch_id),
  });
});

// ---------- كتالوج مطالب الفرقة ----------
// ما يعنيه كل رقم من 1 إلى total_requirements: نصّه، مجاله من المجالات العشرة، و نوعه
// (قبول / تقدم). الأرقام تبقى المفتاح في member_matalib و الأنشطة و البطاقات، فكل ما
// سُجّل قبل الكتالوج يبقى صالحًا و يكتسب اسمه بمجرّد ملئه.
const MAJALAT = [
  'religious', 'civic', 'national', 'scouting', 'arts',
  'health', 'sports', 'social', 'environment', 'science',
];
const MATLAB_KINDS = ['admission', 'progress'];

const branchMatalibList = (branchId) =>
  db
    .prepare('SELECT id, number, label, majal, kind FROM branch_matalib WHERE branch_id = ? ORDER BY number')
    .all(branchId);

function readableBranch(req, res) {
  const b = db.prepare('SELECT id, total_requirements FROM branches WHERE id = ?').get(req.params.id);
  if (!b) {
    res.status(404).json({ error: 'branch not found' });
    return null;
  }
  if (!branchOk(req, b.id)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return b;
}

// Clean one catalogue line; null = invalid. Empty label = no line (the number stays bare).
function cleanMatlab(raw, total) {
  const number = Number(raw?.number);
  if (!Number.isInteger(number) || number < 1 || (total && number > total)) return null;
  const label = String(raw?.label ?? '').trim().slice(0, 300);
  const majal = raw?.majal ? String(raw.majal) : null;
  if (majal && !MAJALAT.includes(majal)) return null;
  const kind = raw?.kind ? String(raw.kind) : 'progress';
  if (!MATLAB_KINDS.includes(kind)) return null;
  return { number, label, majal, kind };
}

app.get(
  '/api/branches/:id/matalib',
  requireAnyPerm('members.read', 'branches.read', 'sessions.read', 'prep.read', 'promotions.read'),
  (req, res) => {
    const b = readableBranch(req, res);
    if (!b) return;
    res.json({ total: b.total_requirements, items: branchMatalibList(b.id) });
  }
);

// Replaces the whole catalogue of one فرقة (the settings editor and the paste import both
// send the full list). Only labels are lost by a removal: the numbers ticked stay.
app.put('/api/branches/:id/matalib', requireAdmin, (req, res) => {
  const b = readableBranch(req, res);
  if (!b) return;
  const items = req.body?.items;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items required' });
  const clean = [];
  const seen = new Set();
  for (const raw of items) {
    const it = cleanMatlab(raw, b.total_requirements);
    if (!it) return res.status(400).json({ error: 'invalid matlab', number: raw?.number ?? null });
    if (seen.has(it.number)) return res.status(400).json({ error: 'duplicate number', number: it.number });
    seen.add(it.number);
    if (it.label) clean.push(it);
  }
  const before = branchMatalibList(b.id);
  db.transaction(() => {
    db.prepare('DELETE FROM branch_matalib WHERE branch_id = ?').run(b.id);
    const ins = db.prepare(
      'INSERT INTO branch_matalib (branch_id, number, label, majal, kind, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const it of clean) ins.run(b.id, it.number, it.label, it.majal, it.kind, it.number);
  })();
  const after = branchMatalibList(b.id);
  auditEvent(req, 'update', 'branch_matalib', b.id, { count: before.length }, { count: after.length });
  res.json({ total: b.total_requirements, items: after });
});

// نسخ كتالوج فرقة إلى نظيرتها (الفتيات، الفرنكوفون): يحلّ محلّ كتالوجها كلّه. الأرقام
// فوق total_requirements الهدف تُترك، و يُقال كم.
app.post('/api/branches/:id/matalib/copy', requireAdmin, (req, res) => {
  const b = readableBranch(req, res);
  if (!b) return;
  const fromId = Number(req.body?.from_branch_id);
  if (!Number.isInteger(fromId) || fromId === b.id) return res.status(400).json({ error: 'invalid from_branch_id' });
  if (!db.prepare('SELECT id FROM branches WHERE id = ?').get(fromId))
    return res.status(404).json({ error: 'branch not found' });
  const source = branchMatalibList(fromId);
  const fits = source.filter((it) => !b.total_requirements || it.number <= b.total_requirements);
  db.transaction(() => {
    db.prepare('DELETE FROM branch_matalib WHERE branch_id = ?').run(b.id);
    const ins = db.prepare(
      'INSERT INTO branch_matalib (branch_id, number, label, majal, kind, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const it of fits) ins.run(b.id, it.number, it.label, it.majal, it.kind, it.number);
  })();
  auditEvent(req, 'copy', 'branch_matalib', b.id, null, { from_branch_id: fromId, count: fits.length });
  res.json({ total: b.total_requirements, items: branchMatalibList(b.id), skipped: source.length - fits.length });
});

// ---------- القبول (B1): فترة التجربة، مطالب القبول، التكريس ----------
// members.admission_status: 'trial' (في فترة التجربة) أو 'invested' (مكرَّس). من كان في
// القاعدة قبل هذه الميزة مكرَّس بتاريخ مجهول (invested_at NULL). قائمة القبول ستة بنود
// لكل عنصر في فرقته (member_admission)، و «الاجتماعات المتتالية» تُحسب من الحضور المعتمد
// (countedSessionSQL، قاعدة A1) و يمكن للقائد أن يثبتها يدويًا.
const ADMISSION_ITEMS = ['request', 'salute', 'promise', 'law', 'meetings', 'cries'];
const ADMISSION_COUNTED = ['law', 'cries'];
const ADMISSION_RULE_KEYS = [
  'trial_months',
  'law_items_required',
  'consecutive_meetings_required',
  'cries_required',
  'internal_skip_trial',
];
// قيم montadamahdi، لفرقة لم تُضبط بعد (أُنشئت قبل الهجرة أو بلا قيم). مرآة migrateAdmission.
function admissionDefaults(nameAr) {
  const n = nameAr || '';
  if (/أشبال|براعم/.test(n))
    return { trial_months: 1, law_items_required: 4, consecutive_meetings_required: 2, cries_required: 3, internal_skip_trial: 1 };
  if (/جوال|علياء/.test(n))
    return { trial_months: 2, law_items_required: 7, consecutive_meetings_required: 4, cries_required: 5, internal_skip_trial: 1 };
  return { trial_months: 1, law_items_required: 5, consecutive_meetings_required: 4, cries_required: 3, internal_skip_trial: 1 };
}
// Les règles d'admission d'un corps de requête déjà validé (validateBranchBody) : seules les clés présentes
function admissionRulesFrom(body) {
  const out = {};
  for (const k of ADMISSION_RULE_KEYS) {
    if (k === 'internal_skip_trial') {
      if (body[k] !== undefined && body[k] !== null) out[k] = body[k] ? 1 : 0;
    } else if (Number.isInteger(body[k])) out[k] = body[k];
  }
  return out;
}
function admissionRules(b) {
  const d = admissionDefaults(b.name_ar);
  return Object.fromEntries(ADMISSION_RULE_KEYS.map((k) => [k, b[k] ?? d[k]]));
}

function addMonthsISO(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  // 31 janvier + 1 mois = fin février, pas 3 mars
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
const daysBetweenISO = (a, b) =>
  Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);

// أطول سلسلة اجتماعات حضرها متتالية منذ بدء التجربة، في الأنشطة المعتمدة وحدها.
// الغياب يقطعها، و الغياب بعذر لا يقطعها و لا يزيدها.
function consecutiveMeetings(memberId, from) {
  const rows = attendanceStats(memberId, null, { from }).history;
  let best = 0;
  let cur = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].status === 'present') best = Math.max(best, ++cur);
    else if (rows[i].status === 'absent') cur = 0;
  }
  return best;
}

const admissionRowsStmt = db.prepare(
  'SELECT item, value, done_at, done_by FROM member_admission WHERE member_id = ? AND branch_id = ?'
);
const internalPromotionStmt = db.prepare(
  'SELECT 1 FROM promotions WHERE member_id = ? AND new_branch_id = ? AND reversed_at IS NULL LIMIT 1'
);

// حالة القبول لعنصر في فرقته: البنود، المدّة، و هل هو جاهز للتكريس
function admissionState(m, b) {
  const rules = admissionRules(b);
  const byItem = Object.fromEntries(admissionRowsStmt.all(m.id, b.id).map((r) => [r.item, r]));
  // رُفِّع إليها من فرقة أدنى: لا مدّة تجربة و لا طلب انتساب
  const internal = !!rules.internal_skip_trial && !!internalPromotionStmt.get(m.id, b.id);
  const start = m.trial_started_at || m.join_date || null;
  const trial = m.admission_status === 'trial';
  const meetings = trial ? consecutiveMeetings(m.id, start) : null;
  const required = {
    law: rules.law_items_required,
    meetings: rules.consecutive_meetings_required,
    cries: rules.cries_required,
  };
  const items = ADMISSION_ITEMS.map((item) => {
    const r = byItem[item];
    const trace = { done_at: r?.done_at ?? null, done_by: r?.done_by ?? null };
    if (item === 'request' && internal) return { item, done: true, waived: true, ...trace };
    if (ADMISSION_COUNTED.includes(item)) {
      const value = r?.value ?? 0;
      return { item, value, required: required[item], done: !required[item] || value >= required[item], ...trace };
    }
    if (item === 'meetings') {
      const auto = !required.meetings || (meetings ?? 0) >= required.meetings;
      return { item, value: meetings, required: required.meetings, auto, done: auto || !!r?.done_at, ...trace };
    }
    return { item, done: !!r?.done_at, ...trace };
  });
  const today = todayISO();
  const trialEnd = start && !internal && rules.trial_months ? addMonthsISO(start, rules.trial_months) : null;
  // بلا تاريخ بداية لا تُحسب المدّة: لا تمنع التكريس
  const durationOk = internal || !rules.trial_months || !start || today >= trialEnd;
  const doneCount = items.filter((i) => i.done).length;
  return {
    status: m.admission_status,
    invested_at: m.invested_at ?? null,
    trial_started_at: start,
    trial_days: trial && start ? Math.max(0, daysBetweenISO(start, today)) : null,
    trial_end: trialEnd,
    duration_ok: durationOk,
    internal,
    rules,
    items,
    done_count: doneCount,
    total: items.length,
    ready: trial && durationOk && doneCount === items.length,
  };
}

const memberWithBranch = (id) => {
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!m) return null;
  return { m, b: db.prepare('SELECT * FROM branches WHERE id = ?').get(m.branch_id) };
};

app.get('/api/members/:id/admission', requirePerm('members.read'), (req, res) => {
  const found = memberWithBranch(req.params.id);
  if (!found) return res.status(404).json({ error: 'member not found' });
  const { m, b } = found;
  if (!branchOk(req, m.branch_id)) return res.status(403).json({ error: 'forbidden' });
  // مطالب «قبول» من كتالوج الفرقة (B2): للإعلام، تُكسب بالحضور أو يدويًا كسائر المطالب
  const earned = new Set(earnedNumbersInBranch(m.id, b.id));
  const catalog = branchMatalibList(b.id)
    .filter((k) => k.kind === 'admission' && (!b.total_requirements || k.number <= b.total_requirements))
    .map((k) => ({ ...k, earned: earned.has(k.number) }));
  res.json({ ...admissionState(m, b), catalog });
});

// بند واحد { item, done } أو { item, value }، أو الحالة { status, invested_at, trial_started_at }
app.post('/api/members/:id/admission', requirePerm('members.admission'), (req, res) => {
  const found = memberWithBranch(req.params.id);
  if (!found) return res.status(404).json({ error: 'member not found' });
  const { m, b } = found;
  if (!branchOk(req, m.branch_id)) return res.status(403).json({ error: 'forbidden' });
  const body = req.body || {};
  const who = req.user.display_name || req.user.username;
  const before = admissionState(m, b);
  if (body.item !== undefined) {
    if (!ADMISSION_ITEMS.includes(body.item)) return res.status(400).json({ error: 'invalid item' });
    let value = null;
    let done;
    if (ADMISSION_COUNTED.includes(body.item)) {
      value = Number(body.value);
      if (!Number.isInteger(value) || value < 0 || value > 50) return res.status(400).json({ error: 'invalid value' });
      done = true;
    } else {
      if (typeof body.done !== 'boolean') return res.status(400).json({ error: 'invalid done' });
      done = body.done;
    }
    db.prepare(
      `INSERT INTO member_admission (member_id, branch_id, item, value, done_at, done_by)
       VALUES (?, ?, ?, ?, CASE WHEN ? THEN datetime('now') END, CASE WHEN ? THEN ? END)
       ON CONFLICT(member_id, branch_id, item) DO UPDATE SET
         value = excluded.value, done_at = excluded.done_at, done_by = excluded.done_by`
    ).run(m.id, b.id, body.item, value, done ? 1 : 0, done ? 1 : 0, who);
  } else if (body.status !== undefined) {
    if (!['trial', 'invested'].includes(body.status)) return res.status(400).json({ error: 'invalid status' });
    const date = body.status === 'invested' ? body.invested_at : body.trial_started_at;
    if (date !== undefined && date !== null && date !== '' && (!validISODate(date) || date > todayISO()))
      return res.status(400).json({ error: 'invalid date' });
    if (body.status === 'invested')
      db.prepare("UPDATE members SET admission_status = 'invested', invested_at = ? WHERE id = ?").run(
        date || (m.admission_status === 'invested' ? null : todayISO()),
        m.id
      );
    else
      db.prepare(
        "UPDATE members SET admission_status = 'trial', invested_at = NULL, trial_started_at = ? WHERE id = ?"
      ).run(date || m.trial_started_at || todayISO(), m.id);
  } else return res.status(400).json({ error: 'item or status required' });
  const after = admissionState(db.prepare('SELECT * FROM members WHERE id = ?').get(m.id), b);
  const snap = (s) => ({
    status: s.status,
    invested_at: s.invested_at,
    trial_started_at: s.trial_started_at,
    items: Object.fromEntries(s.items.map((i) => [i.item, i.value ?? i.done])),
  });
  auditEvent(req, 'admission', 'member', m.id, snap(before), snap(after));
  res.json(after);
});

// التكريس الجماعي: تاريخ واحد لعدّة عناصر (حفل القبول). يصلح أيضًا لتأريخ تكريس
// عناصر قدامى كان تاريخه مجهولًا.
app.post('/api/members/investiture', requirePerm('members.admission'), (req, res) => {
  const rawIds = req.body?.member_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) return res.status(400).json({ error: 'member_ids required' });
  const date = req.body?.date || todayISO();
  if (!validISODate(date) || date > todayISO()) return res.status(400).json({ error: 'invalid date' });
  const ids = [...new Set(rawIds.map(Number))];
  const find = db.prepare('SELECT * FROM members WHERE id = ?');
  const rows = ids.map((id) => find.get(id));
  if (rows.some((m) => !m)) return res.status(404).json({ error: 'member not found' });
  if (rows.some((m) => !branchOk(req, m.branch_id))) return res.status(403).json({ error: 'forbidden' });
  const update = db.prepare("UPDATE members SET admission_status = 'invested', invested_at = ? WHERE id = ?");
  db.transaction(() => {
    for (const m of rows) {
      update.run(date, m.id);
      auditEvent(
        req,
        'investiture',
        'member',
        m.id,
        { admission_status: m.admission_status, invested_at: m.invested_at },
        { admission_status: 'invested', invested_at: date }
      );
    }
  })();
  res.json({ invested: rows.length });
});

// من في فترة التجربة (النشطون، في فرق الحساب)، الجاهزون للتكريس أولًا
function pendingAdmissions(req) {
  const rows = db
    .prepare(
      `SELECT m.* FROM members m JOIN branches b ON b.id = m.branch_id
        WHERE m.status = 'active' AND m.admission_status = 'trial'${branchFilterSQL(req, 'm.branch_id')}`
    )
    .all();
  const branches = Object.fromEntries(getBranches().map((b) => [b.id, b]));
  const out = rows.map((m) => {
    const b = branches[m.branch_id];
    const s = admissionState(m, b);
    return {
      id: m.id,
      first_name: m.first_name,
      father_name: m.father_name,
      last_name: m.last_name,
      photo: m.photo,
      branch_id: b.id,
      branch_name_fr: b.name_fr,
      branch_name_ar: b.name_ar,
      trial_started_at: s.trial_started_at,
      trial_days: s.trial_days,
      trial_end: s.trial_end,
      duration_ok: s.duration_ok,
      done_count: s.done_count,
      total: s.total,
      missing: s.items.filter((i) => !i.done).map((i) => i.item),
      ready: s.ready,
    };
  });
  out.sort((a, b) => b.ready - a.ready || (b.trial_days ?? 0) - (a.trial_days ?? 0));
  return out;
}
app.get('/api/admissions/pending', requirePerm('members.read'), (req, res) => res.json(pendingAdmissions(req)));

// Bug 8 : the same فرق as pendingPromotions, the عناصر it has to skip
const missingBirthDateSQL = (req) => `FROM members m JOIN branches b ON b.id = m.branch_id
        WHERE m.status = 'active' AND m.birth_date IS NULL AND b.all_ages = 0 AND b.max_age IS NOT NULL
          ${branchFilterSQL(req, 'm.branch_id')}`;

// Bug 8 : pendingPromotions ne peut rien proposer sans date de naissance. Ces عناصر sont
// listés ici (mêmes فرق que le ترفيع : à tranche d'âge, pas la dernière) pour être complétés.
app.get('/api/promotions/missing-birth-date', requirePerm('promotions.read'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.id, m.first_name, m.father_name, m.last_name, m.photo, m.branch_id,
              b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
        ${missingBirthDateSQL(req)}
        ORDER BY b.sort_order, m.last_name, m.first_name`
    )
    .all();
  res.json(rows);
});

// ---------- Promotions ----------

// Bug 20 : طليعة d'âge jamais réajustée. Les عناصر actifs dont la طليعة n'est plus celle de
// leur âge (même règle que « répartir par âge » des فرق), فرقة par فرقة. L'action réutilise
// POST /api/branches/:id/groups/by-age (branches.groups).
function ageGroupRealignments(req) {
  const year = ageYear();
  const out = [];
  for (const b of getBranches()) {
    if (!branchOk(req, b.id)) continue;
    const groups = groupsOfBranch(b.id);
    if (!groups.some(isAgeGroup)) continue;
    const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
    const moves = db
      .prepare(
        `SELECT id, first_name, father_name, last_name, photo, birth_date, group_id
           FROM members WHERE branch_id = ? AND status = 'active' AND birth_date IS NOT NULL
          ORDER BY last_name, first_name`
      )
      .all(b.id)
      .map((m) => ({ m, g: ageGroupFor(m.birth_date, groups, year) }))
      .filter(({ m, g }) => g && g.id !== m.group_id)
      .map(({ m, g }) => ({
        ...m,
        from_group_name: byId[m.group_id]?.name ?? null,
        to_group_id: g.id,
        to_group_name: g.name,
      }));
    if (moves.length)
      out.push({ branch_id: b.id, branch_name_fr: b.name_fr, branch_name_ar: b.name_ar, moves });
  }
  return out;
}
app.get('/api/promotions/group-realign', requirePerm('promotions.read'), (req, res) =>
  res.json({ can_apply: hasPerm(req, 'branches.groups'), branches: ageGroupRealignments(req) })
);

app.get('/api/promotions/pending', requirePerm('promotions.read'), (req, res) => {
  // A scoped قائد only sees promotions leaving one of his فرق
  res.json(pendingPromotions().filter((p) => branchOk(req, p.current_branch.id)));
});

app.post('/api/promotions/validate', requirePerm('promotions.apply'), (req, res) => {
  const rawIds = req.body?.member_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0)
    return res.status(400).json({ error: 'member_ids required' });
  const ids = [...new Set(rawIds)];
  const pending = pendingPromotions().filter((p) => branchOk(req, p.current_branch.id));
  const byId = Object.fromEntries(pending.map((p) => [p.id, p]));
  const insert = db.prepare(
    `INSERT INTO promotions (member_id, old_branch_id, new_branch_id, promoted_at, matalib, override, override_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  // الترقية تنقل العنصر إلى فرقة أخرى، و المجموعة تخصّ فرقتها: يخرج منها إلى طليعة
  // سنّه في فرقته الجديدة إن كانت لها طلائع بسنّ، و إلا بقي بلا طليعة حتى يُوزَّع.
  const update = db.prepare('UPDATE members SET branch_id = ?, group_id = ? WHERE id = ?');
  const movement = db.prepare(
    `INSERT INTO member_branch_history
      (member_id, old_branch_id, new_branch_id, effective_date, reason, changed_by, source_promotion_id)
     VALUES (?, ?, ?, ?, 'promotion', ?, ?)`
  );
  const invalid = ids.filter((id) => !byId[id]);
  if (invalid.length) return res.status(409).json({ error: 'promotion_not_eligible', member_ids: invalid });
  // Bug 20 : date d'effet libre (un ترفيع saisi en retard), jamais dans le futur, ni avant
  // le dernier changement de فرقة de l'élément — sinon l'attribution des présences se croise.
  const promotedAt = req.body?.promoted_at ? String(req.body.promoted_at) : todayISO();
  if (!validISODate(promotedAt)) return res.status(400).json({ error: 'invalid_date' });
  if (promotedAt > todayISO()) return res.status(400).json({ error: 'promotion_date_in_future' });
  const lastMove = db.prepare('SELECT MAX(effective_date) AS d FROM member_branch_history WHERE member_id = ?');
  const tooEarly = ids.filter((id) => {
    const d = lastMove.get(id).d;
    return d && promotedAt < d;
  });
  if (tooEarly.length)
    return res.status(409).json({ error: 'promotion_date_before_last_move', member_ids: tooEarly });
  // تحت العتبة: ترفيع استثنائي، لا يمرّ إلا بسببٍ مكتوب لكل عنصر
  const overrides = req.body?.overrides && typeof req.body.overrides === 'object' ? req.body.overrides : {};
  const reasonOf = (id) => String(overrides[id] ?? '').trim().slice(0, 500);
  const unjustified = ids.filter((id) => !byId[id].ready && !reasonOf(id));
  if (unjustified.length)
    return res.status(409).json({ error: 'promotion_below_threshold', member_ids: unjustified });
  let promoted = 0;
  const run = db.transaction(() => {
    for (const id of ids) {
      const p = byId[id];
      const acquired = earnedNumbersInBranch(p.id, p.current_branch.id);
      const override = !p.ready;
      const info = insert.run(
        p.id,
        p.current_branch.id,
        p.target_branch.id,
        promotedAt,
        JSON.stringify(acquired),
        override ? 1 : 0,
        override ? reasonOf(p.id) : null
      );
      update.run(p.target_branch.id, ageGroupIdFor(p.birth_date, p.target_branch.id), p.id);
      movement.run(
        p.id,
        p.current_branch.id,
        p.target_branch.id,
        promotedAt,
        req.user.display_name || req.user.username,
        info.lastInsertRowid
      );
      auditEvent(req, 'apply', 'promotion', info.lastInsertRowid, null, {
        member_id: p.id,
        old_branch_id: p.current_branch.id,
        new_branch_id: p.target_branch.id,
        promoted_at: promotedAt,
        pct: p.pct,
        override,
        override_reason: override ? reasonOf(p.id) : null,
      });
      promoted++;
    }
  });
  run();
  res.json({ promoted });
});

// Bug 20 : la فرقة d'arrivée voit aussi ses ترفيعات entrants, pas seulement celle de départ
function promotionScopeSQL(req) {
  const scope = allowedBranches(req);
  if (!scope) return '';
  const ids = [...scope].map(Number).filter(Number.isInteger);
  const list = ids.length ? ids.join(',') : -1;
  return ` AND (p.old_branch_id IN (${list}) OR p.new_branch_id IN (${list}))`;
}
// L'annulation renvoie l'élément dans sa فرقة d'origine : c'est elle qui décide (ou un admin)
const canReversePromotion = (req, p) =>
  hasPerm(req, 'promotions.apply') && (req.user.role === 'admin' || branchOk(req, p.old_branch_id));

app.get('/api/promotions/history', requirePerm('promotions.read'), (req, res) => {
  const rows = db
    .prepare(
       `SELECT p.id, p.promoted_at, p.member_id, p.matalib,
        p.old_branch_id, p.new_branch_id,
        p.reversed_at, p.reversed_by, p.reversal_reason, p.override, p.override_reason,
        ob.total_requirements AS old_total_requirements,
        m.first_name, m.father_name, m.last_name,
        (p.reversed_at IS NULL AND m.branch_id = p.new_branch_id AND p.id = (
          SELECT p2.id FROM promotions p2 WHERE p2.member_id = p.member_id AND p2.reversed_at IS NULL
          ORDER BY p2.promoted_at DESC, p2.id DESC LIMIT 1)) AS latest_active,
        ob.name_fr AS old_name_fr, ob.name_ar AS old_name_ar,
        nb.name_fr AS new_name_fr, nb.name_ar AS new_name_ar
       FROM promotions p
       JOIN members m ON m.id = p.member_id
       JOIN branches ob ON ob.id = p.old_branch_id
       JOIN branches nb ON nb.id = p.new_branch_id
       WHERE 1=1${promotionScopeSQL(req)}
       ORDER BY p.promoted_at DESC, p.id DESC`
    )
    .all()
    .map(({ latest_active, ...p }) => ({
      ...p,
      matalib: JSON.parse(p.matalib || '[]'),
      // Seul le dernier ترفيع en cours, élément toujours dans la فرقة d'arrivée
      reversible: !!latest_active && canReversePromotion(req, p),
    }));
  res.json(rows);
});

app.post('/api/promotions/:id/reverse', requirePerm('promotions.apply'), (req, res) => {
  const promotion = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
  if (!promotion) return res.status(404).json({ error: 'promotion not found' });
  if (promotion.reversed_at) return res.status(409).json({ error: 'promotion_already_reversed' });
  if (!canReversePromotion(req, promotion)) return res.status(403).json({ error: 'forbidden' });
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(promotion.member_id);
  if (!member) return res.status(404).json({ error: 'member not found' });
  const latest = db
    .prepare(
      `SELECT id FROM promotions
       WHERE member_id = ? AND reversed_at IS NULL
       ORDER BY promoted_at DESC, id DESC LIMIT 1`
    )
    .get(member.id);
  if (!latest || latest.id !== promotion.id || member.branch_id !== promotion.new_branch_id)
    return res.status(409).json({ error: 'promotion_not_latest' });
  const actor = req.user.display_name || req.user.username;
  const reason = String(req.body?.reason || '').trim() || null;
  db.transaction(() => {
    // يعود إلى فرقته القديمة، في طليعة سنّه منها إن كانت مقسَّمة بالسنّ
    db.prepare('UPDATE members SET branch_id = ?, group_id = ? WHERE id = ?').run(
      promotion.old_branch_id,
      ageGroupIdFor(member.birth_date, promotion.old_branch_id),
      member.id
    );
    db.prepare(
      `UPDATE promotions SET reversed_at = datetime('now'), reversed_by = ?, reversal_reason = ? WHERE id = ?`
    ).run(actor, reason, promotion.id);
    db.prepare(
      `INSERT INTO member_branch_history
        (member_id, old_branch_id, new_branch_id, effective_date, reason, changed_by, source_promotion_id)
       VALUES (?, ?, ?, ?, 'reversal', ?, ?)`
    ).run(member.id, promotion.new_branch_id, promotion.old_branch_id, todayISO(), actor, promotion.id);
  })();
  auditEvent(req, 'reverse', 'promotion', promotion.id, promotion, {
    ...promotion,
    reversed_by: actor,
    reversal_reason: reason,
  });
  res.json({ ok: true, member_id: member.id, branch_id: promotion.old_branch_id });
});

// ---------- Leaders & التشكيلة ----------

const latestYear = () =>
  db.prepare('SELECT MAX(year) AS y FROM tachkila_years').get().y ||
  db.prepare('SELECT MAX(year) AS y FROM assignments').get().y ||
  null;

// Assignments (with leader + branch names) for a given تشكيلة year, of one قسم or both.
// LEFT JOIN on leaders: a توصيف with no قائد yet is a real row, it just shows up unassigned.
function assignmentsForYear(year, section = null) {
  if (!year) return [];
  return db
    .prepare(
      `SELECT a.*, l.first_name, l.father_name, l.last_name, l.photo,
        b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar, g.name AS group_name
       FROM assignments a
       LEFT JOIN leaders l ON l.id = a.leader_id
       LEFT JOIN branches b ON b.id = a.branch_id
       LEFT JOIN branch_groups g ON g.id = a.group_id
       WHERE a.year = ?${section ? ' AND a.section = ?' : ''}
       ORDER BY ${sectionOrderSQL('a.section')}, a.role_type = 'amana', COALESCE(b.sort_order, 999), a.sort_order, a.id`
    )
    .all(...(section ? [year, section] : [year]));
}

// ---------- فرقة القادة: بطاقة تقدم القائد ----------
// مطالب خاصة بالقادة، تُتابع سنويًا. Their content is agreed with السيد علي and
// lives in the base (leader_matalib), so it can be adjusted without a new release.

const leaderMatalibList = () =>
  db.prepare('SELECT * FROM leader_matalib ORDER BY sort_order, number, id').all();

// السنة الافتراضية للبطاقة: سنة التشكيلة الأخيرة، وإلا السنة الدراسية الجارية
function defaultCardYear() {
  const y = latestYear();
  if (y) return y;
  const now = new Date();
  // A scout year starts in September: before that month, it is still the previous one
  const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

// كل السنوات التي لها تشكيلة أو بطاقات مملوءة، الأحدث أولًا
function cardYears() {
  const years = new Set([defaultCardYear()]);
  for (const r of db.prepare('SELECT year FROM tachkila_years').all()) years.add(r.year);
  for (const r of db.prepare('SELECT DISTINCT year FROM assignments').all()) years.add(r.year);
  for (const r of db.prepare('SELECT DISTINCT year FROM leader_progress').all()) years.add(r.year);
  return [...years].sort().reverse();
}

// بطاقة تقدم القائد لسنة واحدة: كل المطالب مع ما تحقق منها
function progressCard(leaderId, year) {
  const items = leaderMatalibList();
  const done = new Map(
    db
      .prepare('SELECT matlab_id, achieved_at, note FROM leader_progress WHERE leader_id = ? AND year = ?')
      .all(leaderId, year)
      .map((r) => [r.matlab_id, r])
  );
  return {
    year,
    total: items.length,
    done_count: items.filter((i) => done.has(i.id)).length,
    items: items.map((i) => ({
      ...i,
      done: done.has(i.id),
      achieved_at: done.get(i.id)?.achieved_at || null,
      note: done.get(i.id)?.note || null,
    })),
  };
}

app.get('/api/leader-matalib', requirePerm('leaders.read'), (req, res) => {
  res.json(leaderMatalibList());
});

function validateLeaderMatlab(body) {
  if (!Number.isInteger(body.number) || body.number < 1) return 'invalid number';
  if (!body.label || !String(body.label).trim()) return 'label required';
  return null;
}

app.post('/api/leader-matalib', requireAdmin, (req, res) => {
  const err = validateLeaderMatlab(req.body);
  if (err) return res.status(400).json({ error: err });
  const info = db
    .prepare('INSERT INTO leader_matalib (number, label, sort_order) VALUES (?, ?, ?)')
    .run(
      req.body.number,
      String(req.body.label).trim(),
      Number.isInteger(req.body.sort_order) ? req.body.sort_order : req.body.number
    );
  res.status(201).json(db.prepare('SELECT * FROM leader_matalib WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/leader-matalib/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM leader_matalib WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const body = { ...existing, ...req.body };
  const err = validateLeaderMatlab(body);
  if (err) return res.status(400).json({ error: err });
  db.prepare('UPDATE leader_matalib SET number = ?, label = ?, sort_order = ? WHERE id = ?').run(
    body.number,
    String(body.label).trim(),
    Number.isInteger(body.sort_order) ? body.sort_order : body.number,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM leader_matalib WHERE id = ?').get(req.params.id));
});

// Deleting a مطلب drops it from every بطاقة (ON DELETE CASCADE): it is the list itself
// that changed, so keeping orphan ticks would be misleading.
app.delete('/api/leader-matalib/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM leader_matalib WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

// تحقيق أو إلغاء مطلب لقائد في سنة معيّنة
// ---------- حساب دخول لقائد ----------
// «من له حقّ الدخول؟» يُدار من صفحة القادة نفسها: زرّ واحد يولّد حسابًا مربوطًا
// بالقائد، بكلمة سرّ تُعرض مرّة واحدة، و بصلاحيات تبدأ من قالب جاهز — فليس كل قائد
// يرى كل شيء. القالب تُعرض صلاحياته كلها في الاستمارة و تُضبط فيها، ثم من صفحة الأدمن.
const ACCOUNT_PRESETS = {
  // قائد فرقة: يدير عناصره و أنشطته و خطة فرقته و مجموعاتها، و يقرأ ما حوله.
  // بلا حذف عناصر، بلا تثبيت ترقيات، بلا أرقام مالية — هذه للأدمن.
  branch: [
    'members.read', 'members.create', 'members.edit', 'members.contact', 'members.followup', 'members.health', 'members.matalib', 'members.admission',
    'sessions.read', 'sessions.create', 'sessions.edit', 'sessions.attendance', 'sessions.files',
    'prep.read', 'prep.manage',
    'events.read', 'events.manage', 'events.attendance',
    'meetings.read', 'meetings.manage', 'meetings.followup',
    'evaluations.read',
    'branches.read', 'branches.plan', 'branches.groups',
    'promotions.read',
    'leaders.read', 'leaders.contact', 'leaders.progress.self',
  ],
  // أمين: يرى الفوج كله و يسجّل أنشطة و حضورًا، بلا لمس ملفات العناصر
  amana: [
    'members.read',
    'sessions.read', 'sessions.create', 'sessions.edit', 'sessions.attendance', 'sessions.files',
    'prep.read', 'prep.manage',
    'events.read', 'events.manage', 'events.attendance',
    'meetings.read', 'meetings.manage', 'meetings.followup',
    'evaluations.read',
    'branches.read',
    'promotions.read',
    'leaders.read', 'leaders.contact', 'leaders.progress.self',
  ],
  // قراءة فقط — اطّلاع بلا أي كتابة
  readonly: [
    'members.read', 'sessions.read', 'prep.read', 'events.read', 'meetings.read', 'evaluations.read',
    'branches.read', 'promotions.read', 'leaders.read', 'leaders.contact',
  ],
  // كل الصلاحيات و كل الفرق، من غير إدارة الحسابات (ليس أدمن)
  full: null,
};

app.post('/api/leaders/:id/account', requireAdmin, (req, res) => {
  const leader = db.prepare('SELECT * FROM leaders WHERE id = ?').get(req.params.id);
  if (!leader) return res.status(404).json({ error: 'leader not found' });
  // حساب واحد لكل قائد: الثاني التباسٌ لا فائدة. A previously revoked (deactivated)
  // account is brought back instead of leaving an orphan next to a new one.
  const existing = db.prepare('SELECT * FROM users WHERE leader_id = ?').get(leader.id);
  if (existing && existing.active) return res.status(409).json({ error: 'account_exists' });
  const leaderName = [leader.first_name, leader.father_name, leader.last_name].filter(Boolean).join(' ');
  // No username sent = take the generated one (first.last, deduplicated)
  const username = req.body?.username
    ? normalizeUsername(req.body.username)
    : suggestUsername([leader.first_name, leader.last_name].filter(Boolean).join(' '), {
        exceptId: existing?.id ?? null,
      });
  const nameErr = usernameError(username);
  if (nameErr) return res.status(400).json({ error: nameErr });
  // The rights as ticked in the form, where every right of the chosen set is listed and
  // adjustable (a list; null = every right). An older client sends only the set's name.
  let permsJson;
  if (req.body?.perms !== undefined) {
    permsJson = parsePermList(req.body.perms);
    if (permsJson === undefined) return res.status(400).json({ error: 'invalid perms' });
  } else {
    const preset = req.body?.preset;
    if (!Object.prototype.hasOwnProperty.call(ACCOUNT_PRESETS, preset))
      return res.status(400).json({ error: 'invalid preset' });
    const perms = ACCOUNT_PRESETS[preset];
    permsJson = perms ? JSON.stringify(perms) : null;
  }
  const branches = parseBranchList(req.body?.branches);
  if (branches === undefined) return res.status(400).json({ error: 'invalid branches' });
  // حساب القائد في قسم القائد نفسه، دائمًا: قائدة لا يُولَّد لها حساب يرى الفتيان
  if (!branchesFitSection(branches, leader.section))
    return res.status(400).json({ error: 'branch_outside_section' });
  const password = generatePassword();
  let id;
  try {
    if (existing) {
      db.prepare(
        `UPDATE users SET username = ?, password_hash = ?, display_name = ?, role = 'user', branches = ?,
           perms = ?, section = ?, active = 1, must_change_password = 1 WHERE id = ?`
      ).run(username, hashPassword(password), leaderName, branches, permsJson, leader.section, existing.id);
      id = existing.id;
    } else {
      id = db
        .prepare(
          `INSERT INTO users
            (username, password_hash, display_name, role, branches, perms, section, leader_id, active, must_change_password)
           VALUES (?, ?, ?, 'user', ?, ?, ?, ?, 1, 1)`
        )
        .run(username, hashPassword(password), leaderName, branches, permsJson, leader.section, leader.id)
        .lastInsertRowid;
    }
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'username_taken' });
    throw e;
  }
  const created = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  auditEvent(req, existing ? 'update' : 'create', 'user', created.id, existing ? publicUser(existing) : null, publicUser(created));
  // كلمة السرّ تُعاد هنا وحدها و لا تُخزَّن إلا مجزّأة: من أضاعها يولّد غيرها من صفحة الأدمن
  res.status(201).json({ user: publicUser(created), password });
});

app.post('/api/leaders/:id/progress', requirePerm('leaders.read'), (req, res) => {
  const l = db.prepare('SELECT id, section FROM leaders WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'leader not found' });
  if (!leaderOk(req, l)) return res.status(403).json({ error: 'forbidden' });
  const self = Number(req.user.leader_id) === Number(l.id) && hasPerm(req, 'leaders.progress.self');
  if (req.user.role !== 'admin' && !self && !hasPerm(req, 'leaders.progress.manage'))
    return res.status(403).json({ error: 'forbidden' });
  const year = normYear(req.body?.year) || defaultCardYear();
  if (!scoutYearRange(year)) return res.status(400).json({ error: 'invalid year' });
  const matlabId = Number(req.body?.matlab_id);
  if (!db.prepare('SELECT id FROM leader_matalib WHERE id = ?').get(matlabId))
    return res.status(400).json({ error: 'invalid matlab_id' });
  if (req.body?.done === false) {
    db.prepare('DELETE FROM leader_progress WHERE leader_id = ? AND matlab_id = ? AND year = ?').run(
      l.id, matlabId, year
    );
  } else {
    db.prepare(
      `INSERT INTO leader_progress (leader_id, matlab_id, year, achieved_at, note)
       VALUES (?, ?, ?, date('now'), ?)
       ON CONFLICT(leader_id, matlab_id, year) DO UPDATE SET note = excluded.note`
    ).run(l.id, matlabId, year, req.body?.note || null);
  }
  res.json(progressCard(l.id, year));
});

// Minimal names for session/preparation forms. This intentionally excludes addresses,
// phones, account usernames, training and attendance history. `section` lets a form
// opened on both أقسام offer only the قادة of the نشاط's own قسم.
app.get(
  '/api/leader-options',
  requireAnyPerm('sessions.read', 'prep.read', 'events.read', 'meetings.read'),
  (req, res) => {
    res.json(
      db.prepare(
        `SELECT id, first_name, father_name, last_name, photo, status, section
         FROM leaders l WHERE 1=1${leaderScopeSQL(req)} ORDER BY status != 'active', last_name, first_name`
      ).all()
    );
  }
);

app.get('/api/leaders', requirePerm('leaders.read'), (req, res) => {
  // Bug 13 : une seule source (LEADER_SESSIONS_SQL, aides compris), sur l'année scoute en
  // cours par défaut (?period=all : depuis toujours). Les séances à venir ne comptent pas.
  const period = statsPeriod(req);
  const mine = (cond) =>
    `(SELECT COUNT(*) FROM ${LEADER_SESSIONS_SQL} ls JOIN sessions s ON s.id = ls.session_id
       WHERE ls.leader_id = l.id AND s.date <= @today AND ${cond}${periodSQL(period)})`;
  const rows = db
    .prepare(
      `SELECT l.*,
        (SELECT u.id FROM users u WHERE u.leader_id = l.id AND u.active = 1 LIMIT 1) AS account_user_id,
        (SELECT u.username FROM users u WHERE u.leader_id = l.id AND u.active = 1 LIMIT 1) AS account_username,
        ${mine("s.kind != 'visit'")} AS sessions_count,
        ${mine("s.kind != 'visit' AND ls.role = 'main'")} AS led_count,
        ${mine("s.kind != 'visit' AND ls.status = 'present'")} AS present_count,
        ${mine("s.kind != 'visit' AND ls.status = 'absent'")} AS absent_count,
        ${mine("s.kind = 'visit'")} AS visits_count
       FROM leaders l WHERE 1=1${leaderScopeSQL(req)} ORDER BY l.last_name, l.first_name`
    )
    .all({ today: todayISO() });
  const year = latestYear();
  const roles = {};
  for (const a of assignmentsForYear(year)) {
    if (!a.leader_id) continue;
    (roles[a.leader_id] = roles[a.leader_id] || []).push({
      title: a.title,
      role_type: a.role_type,
      branch_id: a.branch_id,
      group_id: a.group_id,
      sort_order: a.sort_order,
      branch_name_fr: a.branch_name_fr,
      branch_name_ar: a.branch_name_ar,
    });
  }
  // بطاقة تقدم القائد, summarised: how many مطالب of the year each قائد has ticked
  const cardYear = defaultCardYear();
  const cardTotal = db.prepare('SELECT COUNT(*) AS n FROM leader_matalib').get().n;
  const doneByLeader = {};
  for (const r of db
    .prepare('SELECT leader_id, COUNT(*) AS n FROM leader_progress WHERE year = ? GROUP BY leader_id')
    .all(cardYear))
    doneByLeader[r.leader_id] = r.n;
  res.json(
    rows.map((l) => ({
      ...publicLeader(
        stripLeaderContact(
          req,
          req.user.role === 'admin' ? l : { ...l, account_user_id: undefined, account_username: undefined }
        )
      ),
      roles: roles[l.id] || [],
      year,
      stats_period: period,
      // Admin only: is the قائد's account still on the فرق of his تشكيلة (I4)
      ...(req.user.role === 'admin' && l.account_user_id
        ? (() => {
            const st = tachkilaStatus(db.prepare('SELECT * FROM users WHERE id = ?').get(l.account_user_id), year);
            return st ? { account_tachkila_status: st.tachkila_status } : {};
          })()
        : {}),
      card: { year: cardYear, total: cardTotal, done_count: doneByLeader[l.id] || 0 },
    }))
  );
});

app.get('/api/leaders/:id', requirePerm('leaders.read'), (req, res) => {
  const l = db.prepare('SELECT * FROM leaders WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'leader not found' });
  if (!leaderOk(req, l)) return res.status(403).json({ error: 'forbidden' });
  const assignments = db
    .prepare(
      `SELECT a.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
       FROM assignments a LEFT JOIN branches b ON b.id = a.branch_id
       WHERE a.leader_id = ? ORDER BY a.year DESC, a.id`
    )
    .all(l.id);
  // All sessions where the leader is animator (main or helper), with their own présence —
  // the same source as the list (LEADER_SESSIONS_SQL, bug 13)
  const sessions = db
    .prepare(
      `SELECT s.id, s.title, s.date, s.matalib, s.kind, sl.role, sl.status AS my_status,
        b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'present') AS present_count
       FROM ${LEADER_SESSIONS_SQL} sl
       JOIN sessions s ON s.id = sl.session_id
       LEFT JOIN branches b ON b.id = s.branch_id
       WHERE sl.leader_id = ?${sessionScopeSQL(req)} ORDER BY s.date DESC, s.id DESC`
    )
    .all(l.id)
    .map((r) => ({ ...r, matalib: JSON.parse(r.matalib || '[]') }));
  const year = latestYear();
  // زيارات الأهل are listed on their own: they are not أنشطة this قائد animated
  const activities = sessions.filter((s) => s.kind !== 'visit');
  const visitedNames = db.prepare(
    `SELECT m.id, m.first_name, m.father_name, m.last_name FROM attendance a JOIN members m ON m.id = a.member_id
     WHERE a.session_id = ? AND a.status = 'present'${branchFilterSQL(req, 'm.branch_id')}
     ORDER BY m.last_name, m.first_name`
  );
  const visits = sessions
    .filter((s) => s.kind === 'visit')
    .map((s) => ({ ...s, members: visitedNames.all(s.id) }));
  // Bug 13 : les chiffres portent sur l'année scoute en cours (?period=all : depuis
  // toujours), séances à venir exclues ; la liste, elle, garde tout l'historique
  const period = statsPeriod(req);
  const today = todayISO();
  const counted = activities.filter(
    (s) => s.date <= today && (!period.from || (s.date >= period.from && s.date <= period.to))
  );
  const attendance = {
    present: counted.filter((s) => s.my_status === 'present').length,
    absent: counted.filter((s) => s.my_status === 'absent').length,
    unmarked: counted.filter((s) => !s.my_status).length,
    sessions: counted.length,
    led: counted.filter((s) => s.role === 'main').length,
  };
  // بطاقات التحضير التي أعدّها — تنزل في سجلّه أنه حضّر لأنشطته
  const prepCards = db
    .prepare(
      `SELECT p.id, p.title, p.date, p.branch_id, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
       FROM prep_cards p JOIN branches b ON b.id = p.branch_id
       WHERE p.leader_id = ?${branchFilterSQL(req, 'p.branch_id')} ORDER BY p.date DESC, p.id DESC`
    )
    .all(l.id);
  // بطاقة تقدم القائد — one سنة at a time, picked with ?year=
  const years = cardYears();
  const selectedYear = years.includes(normYear(req.query.year)) ? normYear(req.query.year) : years[0];
  res.json({
    ...publicLeader(stripLeaderContact(req, l)),
    year,
    current_roles: assignments.filter((a) => a.year === year),
    assignments,
    sessions: activities,
    visits,
    // His بطاقات التحضير, for whoever reads the بطاقات
    prep_cards: hasPerm(req, 'prep.read') ? prepCards : [],
    attendance,
    stats_period: period,
    card_years: years,
    card: progressCard(l.id, selectedYear),
  });
});

// الحالة الاجتماعية — قائمة مغلقة: نصّ حرّ يمتلئ بـ«متزوج» و«متزوّج» و«marié»
const MARITAL_STATUSES = ['single', 'married'];

// حقول ملفّ القائد التي تُخزَّن نصًّا كما تُكتب. كلها اختيارية.
const LEADER_TEXT_FIELDS = [
  'father_name',
  'birth_date',
  'phone',
  'address_abidjan',
  'address_lebanon',
  'education',
];

// الدورات التدريبية — قائمة مغلقة بترتيب تدرّجها. القائد قد يكون خضع لأكثر من
// واحدة، فالحقل مصفوفة لا قيمة واحدة.
const TRAINING_COURSES = ['qaid', 'chara', 'mudarrib', 'qaid_tadrib', 'moed_haqiba'];

// مصفوفة الدورات كما تُخزَّن: مرتَّبة بترتيب القائمة و بلا تكرار، فترتيب التأشير
// لا يغيّر ما يُحفظ. تُعيد undefined إذا كان المُدخل غير صالح.
function parseTrainingCourses(v) {
  if (v === undefined || v === null || v === '') return [];
  if (!Array.isArray(v) || !v.every((c) => TRAINING_COURSES.includes(c))) return undefined;
  return TRAINING_COURSES.filter((c) => v.includes(c));
}

// صفّ قائد كما يخرج إلى العميل: الدورات مصفوفةً لا نصًّا. الصفوف القديمة (نصّ حرّ
// كُتب قبل أن تصير القائمة مغلقة) تُقرأ كمصفوفة فارغة بدل أن تُسقط الطلب.
function publicLeader(l) {
  if (!l) return l;
  let courses = [];
  try {
    const parsed = JSON.parse(l.training_level || '[]');
    if (Array.isArray(parsed)) courses = parsed.filter((c) => TRAINING_COURSES.includes(c));
  } catch {
    courses = [];
  }
  return { ...l, training_level: courses };
}

// سنوات الخدمة: عدد صحيح موجب أو لا شيء. صفر مقبول — قائد في سنته الأولى.
function leaderYearCount(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : undefined;
}

function validateLeader(body) {
  if (!body.first_name || !String(body.first_name).trim() || !body.last_name || !String(body.last_name).trim())
    return 'first_name and last_name required';
  if (!['active', 'inactive'].includes(body.status || 'active')) return 'invalid status';
  if (body.marital_status && !MARITAL_STATUSES.includes(body.marital_status))
    return 'invalid marital_status';
  // سنة الانتساب: أربعة أرقام. الحدّ الأعلى مفتوح عمدًا — لا يُرفض إدخال سنة قادمة
  // بسبب ساعة خاطئة على الجهاز.
  if (body.join_year && !/^[0-9]{4}$/.test(String(body.join_year).trim()))
    return 'invalid join_year';
  if (leaderYearCount(body.years_ghadir) === undefined) return 'invalid years_ghadir';
  if (leaderYearCount(body.years_total) === undefined) return 'invalid years_total';
  if (body.birth_date && (!validISODate(body.birth_date) || body.birth_date > todayISO()))
    return 'invalid birth_date';
  if (!validPhone(body.phone)) return 'invalid phone';
  if (!validPhoto(body.photo)) return 'invalid photo';
  if (parseTrainingCourses(body.training_level) === undefined) return 'invalid training_level';
  return null;
}

// القيم التي تدخل في INSERT/UPDATE، بالترتيب نفسه في الاثنين
const leaderValues = (b) => [
  String(b.first_name).trim(),
  String(b.last_name).trim(),
  ...LEADER_TEXT_FIELDS.map((f) => (b[f] === undefined || b[f] === '' ? null : b[f])),
  b.marital_status || null,
  b.join_year ? String(b.join_year).trim() : null,
  leaderYearCount(b.years_ghadir),
  leaderYearCount(b.years_total),
  JSON.stringify(parseTrainingCourses(b.training_level)),
  b.photo || null,
  b.status || 'active',
];

const LEADER_COLUMNS = [
  'first_name',
  'last_name',
  ...LEADER_TEXT_FIELDS,
  'marital_status',
  'join_year',
  'years_ghadir',
  'years_total',
  'training_level',
  'photo',
  'status',
];

app.post('/api/leaders', requireAdmin, (req, res) => {
  const err = validateLeader(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  if (b.section !== undefined && !parseSection(b.section))
    return res.status(400).json({ error: 'invalid section' });
  // Said explicitly, or the قسم the admin is looking at, or قسم الفتيان as before
  const section = parseSection(b.section) || activeSection(req) || 'M';
  const info = db
    .prepare(
      `INSERT INTO leaders (${LEADER_COLUMNS.join(', ')}, section)
       VALUES (${LEADER_COLUMNS.map(() => '?').join(', ')}, ?)`
    )
    .run(...leaderValues(b), section);
  const created = db.prepare('SELECT * FROM leaders WHERE id = ?').get(info.lastInsertRowid);
  auditEvent(req, 'create', 'leader', created.id, null, publicLeader(created));
  res.status(201).json(publicLeader(created));
});

// ---------- اشتراك القادة الشهري ----------
// كل قائد يدفع قيمة ثابتة كل شهر، بالسنة الميلادية (كانون الثاني ← كانون الأول).
// صفّ في leader_dues = شهر مدفوع؛ غيابه = غير مدفوع. الشهر يُستحقّ متى حلّ، ابتداءً
// من DUES_START — ما قبله لا يُطالَب به أحد.
// الرؤية لمن مُنح leaders.dues، و التسجيل لمن مُنح leaders.dues.record؛ و كل قائد يرى اشتراكه هو من /api/me/dues.

const LEADER_DUE_MONTHLY = 5000;
const DUES_START = '2026-01';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;

// '2026' -> ['2026-01', ..., '2026-12']
const yearMonths = (year) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
const currentMonth = () => todayISO().slice(0, 7);
// مستحقّ = حلّ و ليس قبل بدء الاشتراك
const monthOwed = (month) => month >= DUES_START && month <= currentMonth();

// السنوات المعروضة: من سنة البدء إلى ما بعد الحالية بسنتين، و أبعد إن سُجّل دفع مقدَّم
function duesYears() {
  const first = Number(DUES_START.slice(0, 4));
  const lastPaid = db.prepare('SELECT MAX(month) AS m FROM leader_dues').get().m;
  const last = Math.max(Number(currentMonth().slice(0, 4)) + 2, lastPaid ? Number(lastPaid.slice(0, 4)) : 0);
  return Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
}

function duesYearParam(req) {
  const y = req.query.year ? String(req.query.year).trim() : currentMonth().slice(0, 4);
  return YEAR_RE.test(y) ? y : null;
}

const duesOfLeader = (leaderId, months) =>
  Object.fromEntries(
    db
      .prepare(
        `SELECT month, amount, paid_at, recorded_by FROM leader_dues
         WHERE leader_id = ? AND month >= ? AND month <= ?`
      )
      .all(leaderId, months[0], months[months.length - 1])
      .map((r) => [r.month, { amount: r.amount, paid_at: r.paid_at, recorded_by: r.recorded_by }])
  );

// حصيلة قائد على كل السنوات: ما دفعه، و الأشهر التي حلّت و لم يدفعها
function duesSummary(leaderId) {
  const paidMonths = new Set(
    db.prepare('SELECT month FROM leader_dues WHERE leader_id = ?').all(leaderId).map((r) => r.month)
  );
  const unpaid = [];
  for (const y of duesYears())
    for (const m of yearMonths(y)) if (monthOwed(m) && !paidMonths.has(m)) unpaid.push(m);
  const paidTotal =
    db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM leader_dues WHERE leader_id = ?').get(leaderId).n;
  // Chaque mois à son tarif du moment (G1) : un nouveau tarif ne touche pas les mois passés
  return { paid_total: paidTotal, unpaid_months: unpaid, owed_total: unpaid.reduce((n, m) => n + rateFor('leader', m), 0) };
}

const duesMeta = (year) => ({
  year,
  years: duesYears(),
  months: yearMonths(year),
  monthly: rateFor('leader', currentMonth()),
  month_rates: Object.fromEntries(yearMonths(year).map((m) => [m, rateFor('leader', m)])),
  start_month: DUES_START,
  current_month: currentMonth(),
});

app.get('/api/leader-dues', requirePerm('leaders.dues'), (req, res) => {
  const year = duesYearParam(req);
  if (!year) return res.status(400).json({ error: 'invalid year' });
  const months = yearMonths(year);
  // القادة الفعّالون، و من أُرشف منهم و قد دفع شيئًا في هذه السنة — دفعه لا يختفي من الجدول
  const leaders = db
    .prepare(
      `SELECT l.id, l.first_name, l.father_name, l.last_name, l.photo, l.status, l.section
       FROM leaders l
       WHERE (l.status = 'active' OR EXISTS (
               SELECT 1 FROM leader_dues d WHERE d.leader_id = l.id AND d.month >= ? AND d.month <= ?))
         ${leaderScopeSQL(req)}
       ORDER BY l.status != 'active', l.first_name, l.last_name`
    )
    .all(months[0], months[11])
    .map((l) => ({ ...l, paid: duesOfLeader(l.id, months) }));
  res.json({ ...duesMeta(year), leaders });
});

function sendLeaderDues(req, res, leaderId) {
  const year = duesYearParam(req);
  if (!year) return res.status(400).json({ error: 'invalid year' });
  res.json({
    ...duesMeta(year),
    leader_id: leaderId,
    paid: duesOfLeader(leaderId, yearMonths(year)),
    summary: duesSummary(leaderId),
    can_edit: hasPerm(req, 'leaders.dues.record'),
  });
}

// إعدادات الواجهة الخاصة بالحساب — بلا أي صلاحية، كلٌّ يرى إعداداته وحده. المفاتيح
// معدودة، و لكل مفتاح شكلٌ يُتحقّق منه: لا يُخزَّن ما لا تعرفه الواجهة.
const isStrList = (v) => Array.isArray(v) && v.length <= 100 && v.every((s) => typeof s === 'string' && s.length <= 60);
const USER_SETTINGS = {
  // الأنواع المطفأة، و ما أُخفي حتى يستجدّ فيه شيء (المفتاح ← ما كان فيه عند الإخفاء)
  'dashboard.todo': {
    empty: { hidden: [], masked: {} },
    valid: (v) =>
      v &&
      typeof v === 'object' &&
      isStrList(v.hidden) &&
      v.masked &&
      typeof v.masked === 'object' &&
      !Array.isArray(v.masked) &&
      Object.entries(v.masked).length <= 100 &&
      Object.entries(v.masked).every(([k, s]) => k.length <= 60 && typeof s === 'string' && s.length <= 4000),
  },
};

app.get('/api/me/settings/:key', (req, res) => {
  const def = USER_SETTINGS[req.params.key];
  if (!def) return res.status(404).json({ error: 'unknown setting' });
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(req.user.id, req.params.key);
  let value = def.empty;
  try {
    if (row) value = JSON.parse(row.value);
  } catch {
    /* a broken row reads as the default */
  }
  res.json(def.valid(value) ? value : def.empty);
});

app.put('/api/me/settings/:key', (req, res) => {
  const def = USER_SETTINGS[req.params.key];
  if (!def) return res.status(404).json({ error: 'unknown setting' });
  if (!def.valid(req.body)) return res.status(400).json({ error: 'invalid setting' });
  db.prepare(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(req.user.id, req.params.key, JSON.stringify(req.body));
  res.json(req.body);
});

// اشتراك القائد صاحب الحساب — بلا أي صلاحية: كل قائد يعرف ما دفعه و ما بقي عليه
app.get('/api/me/dues', (req, res) => {
  const l = req.user.leader_id
    ? db.prepare('SELECT id FROM leaders WHERE id = ?').get(req.user.leader_id)
    : null;
  if (!l) return res.json(null);
  sendLeaderDues(req, res, l.id);
});

// اشتراك قائد واحد، في ملفّه — لمن يسجّل الاشتراكات، و للقائد نفسه
app.get('/api/leaders/:id/dues', (req, res) => {
  const l = db.prepare('SELECT id, section FROM leaders WHERE id = ?').get(req.params.id);
  const self = l && Number(req.user.leader_id) === l.id;
  if (!l || (!self && !leaderOk(req, l))) return res.status(404).json({ error: 'leader not found' });
  if (!self && !hasPerm(req, 'leaders.dues')) return res.status(403).json({ error: 'forbidden' });
  sendLeaderDues(req, res, l.id);
});

// paid: true يسجّل الشهر مدفوعًا بالقيمة الحالية، false يمحوه
app.put('/api/leaders/:id/dues/:month', requirePerm('leaders.dues.record'), (req, res) => {
  const l = db.prepare('SELECT id, section FROM leaders WHERE id = ?').get(req.params.id);
  if (!l || !leaderOk(req, l)) return res.status(404).json({ error: 'leader not found' });
  const month = req.params.month;
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'invalid month' });
  if (typeof req.body?.paid !== 'boolean') return res.status(400).json({ error: 'invalid paid' });
  const before = db.prepare('SELECT * FROM leader_dues WHERE leader_id = ? AND month = ?').get(l.id, month) || null;
  if (req.body.paid) {
    if (!before)
      db.prepare('INSERT INTO leader_dues (leader_id, month, amount, recorded_by) VALUES (?, ?, ?, ?)').run(
        l.id,
        month,
        rateFor('leader', month),
        req.user.display_name || req.user.username
      );
  } else {
    db.prepare('DELETE FROM leader_dues WHERE leader_id = ? AND month = ?').run(l.id, month);
  }
  const after = db.prepare('SELECT * FROM leader_dues WHERE leader_id = ? AND month = ?').get(l.id, month) || null;
  if (!!before !== !!after) auditEvent(req, 'update', 'leader_due', `${l.id}:${month}`, before, after);
  res.json({
    month,
    paid: after ? { amount: after.amount, paid_at: after.paid_at, recorded_by: after.recorded_by } : null,
    summary: duesSummary(l.id),
  });
});

// ---------- اشتراك العناصر الشهري ----------
// كل عنصر يدفع قيمة ثابتة كل شهر، دفعةً واحدة أو على دفعات (500 ثم 1500…): صفّ في
// member_dues = دفعة، و الشهر مسدَّد متى بلغ مجموع دفعاته القيمة الشهرية. الشهر يُستحقّ
// متى حلّ، من MEMBER_DUES_START أو من شهر انتساب العنصر إن جاء بعده؛ العنصر غير الفعّال
// لا يُطالَب بشيء. يُدفع عادةً في النشاط (من لائحة الحضور، مربوطًا به و بيومه) أو من ملفّ
// العنصر (اليوم)، و يدخل صندوق فرقة العنصر.
// يراه من يرى مبالغ الأنشطة أو الصندوق، و يسجّله من يسجّل الدفع في الأنشطة أو أمين المال.

// Le tarif d'avant G1 : il ne sert plus qu'à poser le premier tarif daté (due_rates) et
// de filet si la table était vide
const MEMBER_DUE_MONTHLY = 2000;
const MEMBER_DUES_START = '2026-10';

// ---------- Tarifs datés (G1) ----------
// Un tarif vaut à partir de son mois (effective_month) jusqu'au tarif suivant : changer
// le tarif ne recalcule plus les mois passés. Un mois avant le premier tarif prend le
// premier. Lus une fois, relus après chaque écriture.
const DUE_RATE_KINDS = { member: MEMBER_DUE_MONTHLY, leader: LEADER_DUE_MONTHLY };
let dueRatesCache = null;
function dueRateList(kind) {
  if (!dueRatesCache) {
    dueRatesCache = { member: [], leader: [] };
    for (const r of db.prepare('SELECT * FROM due_rates ORDER BY effective_month, id').all())
      dueRatesCache[r.kind]?.push(r);
  }
  return dueRatesCache[kind];
}
function rateFor(kind, month) {
  const list = dueRateList(kind);
  let amount = list.length ? list[0].amount : DUE_RATE_KINDS[kind];
  for (const r of list) {
    if (r.effective_month > month) break;
    amount = r.amount;
  }
  return amount;
}

// Une fois (user_version 8) : les tarifs codés en dur jusqu'ici, posés à partir du plus
// ancien mois connu (début des cotisations, ou un paiement plus ancien) — chaque mois
// passé garde exactement le montant qu'il avait, aucun solde ne bouge.
function seedDueRates() {
  if (db.pragma('user_version', { simple: true }) >= 8) return;
  const oldest = (table, start) => {
    const m = db.prepare(`SELECT MIN(month) AS m FROM ${table}`).get().m;
    return m && m < start ? m : start;
  };
  const insert = db.prepare(
    "INSERT OR IGNORE INTO due_rates (kind, amount, effective_month, created_by) VALUES (?, ?, ?, 'system')"
  );
  db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM due_rates WHERE kind = 'member'").get())
      insert.run('member', MEMBER_DUE_MONTHLY, oldest('member_dues', MEMBER_DUES_START));
    if (!db.prepare("SELECT 1 FROM due_rates WHERE kind = 'leader'").get())
      insert.run('leader', LEADER_DUE_MONTHLY, oldest('leader_dues', DUES_START));
    db.pragma('user_version = 8');
  })();
}
seedDueRates();

// Ce qu'un عنصر doit pour un mois : son tarif personnel (0 = exonéré) à partir du mois
// où il vaut, le tarif général sinon
const memberRate = (m, month) =>
  m.dues_monthly !== null && m.dues_monthly !== undefined && (!m.dues_rate_from || month >= m.dues_rate_from)
    ? m.dues_monthly
    : rateFor('member', month);

// Les colonnes d'un عنصر dont le calcul des cotisations a besoin
const MEMBER_DUES_COLS = 'status, join_date, archived_at, dues_monthly, dues_note, dues_rate_from';

const canSeeMemberDues = (req) => hasPerm(req, 'members.dues.read');
const canWriteMemberDues = (req) => hasPerm(req, 'members.dues.record');

// '2026-12' -> '2027-01'
const nextMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

// Every month from `first` to `last`, both included
function monthsBetween(first, last) {
  const out = [];
  for (let m = first; m <= last; m = nextMonth(m)) out.push(m);
  return out;
}

// أوّل شهر يُطالَب به العنصر: بدء الاشتراك، أو شهر انتسابه إن جاء بعده
const memberDuesFrom = (m) => {
  const joined = /^\d{4}-\d{2}/.test(m.join_date || '') ? m.join_date.slice(0, 7) : null;
  return joined && joined > MEMBER_DUES_START ? joined : MEMBER_DUES_START;
};

// What was given for each month, from an عنصر's payments: month -> total
const paidByMonth = (rows) => {
  const out = new Map();
  for (const r of rows) out.set(r.month, (out.get(r.month) || 0) + r.amount);
  return out;
};

// What is left to pay of a month once `paid` was given for it, `rate` being its price
const dueLeft = (paid, rate) => Math.max(0, rate - (paid || 0));

// Le dernier mois dû : `until` pour un عنصر actif ; pour un archivé, le mois de son
// archivage (il l'a atteint en étant actif) — sa dette ne disparaît plus (bug 7). Archivé
// sans date (avant l'archivage daté) : rien, faute de savoir jusqu'où.
function memberDuesUntil(m, until) {
  if (m.status === 'active') return until;
  const arch = /^\d{4}-\d{2}/.test(m.archived_at || '') ? m.archived_at.slice(0, 7) : null;
  if (!arch) return null;
  return arch < until ? arch : until;
}

// The months owed up to `until` and not paid in full (`paid`: month -> total)
function memberLateMonths(m, paid, until) {
  const end = memberDuesUntil(m, until);
  if (!end) return [];
  return monthsBetween(memberDuesFrom(m), end).filter((x) => dueLeft(paid.get(x), memberRate(m, x)) > 0);
}

// السنوات المعروضة: من سنة البدء إلى السنة القادمة، و أبعد إن سُجّل دفع مقدَّم
function memberDuesYears() {
  const first = Number(MEMBER_DUES_START.slice(0, 4));
  const lastPaid = db.prepare('SELECT MAX(month) AS m FROM member_dues').get().m;
  const last = Math.max(Number(currentMonth().slice(0, 4)) + 1, lastPaid ? Number(lastPaid.slice(0, 4)) : 0);
  return Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
}

// Payments oldest first: a month reads in the order it was paid
const MEMBER_DUE_SQL = `
  SELECT d.*, s.title AS session_title FROM member_dues d LEFT JOIN sessions s ON s.id = d.session_id`;
const MEMBER_DUE_ORDER = ' ORDER BY d.paid_on, d.id';

const memberDuePayment = (r) => ({
  id: r.id,
  amount: r.amount,
  paid_on: r.paid_on,
  session_id: r.session_id,
  session_title: r.session_title ?? null,
  recorded_by: r.recorded_by,
});

// One month as the screens show it: how much was given, what is left, is it paid in
// full, and each payment. null: nothing given for it.
function memberDueMonth(payments, rate) {
  if (!payments.length) return null;
  const amount = payments.reduce((n, p) => n + p.amount, 0);
  const left = dueLeft(amount, rate);
  return { amount, left, full: left === 0, payments: payments.map(memberDuePayment) };
}

const memberDuesOf = (m, first, last) => {
  const byMonth = new Map();
  for (const r of db
    .prepare(`${MEMBER_DUE_SQL} WHERE d.member_id = ? AND d.month >= ? AND d.month <= ?${MEMBER_DUE_ORDER}`)
    .all(m.id, first, last)) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, []);
    byMonth.get(r.month).push(r);
  }
  return Object.fromEntries([...byMonth].map(([month, rows]) => [month, memberDueMonth(rows, memberRate(m, month))]));
};

const memberMonthOf = (m, month) =>
  memberDueMonth(
    db.prepare(`${MEMBER_DUE_SQL} WHERE d.member_id = ? AND d.month = ?${MEMBER_DUE_ORDER}`).all(m.id, month),
    memberRate(m, month)
  );

// حصيلة عنصر على كل السنوات: ما دفعه، و الأشهر التي حلّت و لم تُسدَّد كاملةً، و ما بقي منها
function memberDuesSummary(m) {
  const rows = db.prepare('SELECT month, amount, paid_on FROM member_dues WHERE member_id = ?').all(m.id);
  const paid = paidByMonth(rows);
  const unpaid = memberLateMonths(m, paid, currentMonth());
  return {
    paid_total: rows.reduce((n, r) => n + r.amount, 0),
    unpaid_months: unpaid,
    owed_total: unpaid.reduce((n, x) => n + dueLeft(paid.get(x), memberRate(m, x)), 0),
    last_paid_on: rows.reduce((d, r) => (r.paid_on && (!d || r.paid_on > d) ? r.paid_on : d), null),
  };
}

// Each عنصر of a نشاط's roster, with the نشاط's month (what was given for it, and is it
// owed), the months before it not paid in full, and what was paid in this نشاط itself
function rosterDues(roster, session) {
  const month = session.date.slice(0, 7);
  const ids = roster.map((m) => intOr(m.id)).join(',') || '-1';
  const info = new Map(
    db.prepare(`SELECT id, ${MEMBER_DUES_COLS} FROM members WHERE id IN (${ids})`).all().map((m) => [m.id, m])
  );
  const byMember = new Map();
  for (const d of db.prepare(`${MEMBER_DUE_SQL} WHERE d.member_id IN (${ids})${MEMBER_DUE_ORDER}`).all()) {
    if (!byMember.has(d.member_id)) byMember.set(d.member_id, []);
    byMember.get(d.member_id).push(d);
  }
  return roster.map((r) => {
    const m = info.get(r.id);
    const own = byMember.get(r.id) || [];
    const from = memberDuesFrom(m);
    return {
      ...r,
      dues: {
        from,
        owes: m.status === 'active' && month >= from && memberRate(m, month) > 0,
        // Ce que coûte le mois de l'activité pour lui : tarif du mois, ou le sien (0 = exonéré)
        rate: memberRate(m, month),
        exempt: memberRate(m, month) === 0,
        month: memberDueMonth(own.filter((d) => d.month === month), memberRate(m, month)),
        late: memberLateMonths(m, paidByMonth(own), month).filter((x) => x < month),
        here: own
          .filter((d) => d.session_id === session.id)
          .map((d) => ({ id: d.id, month: d.month, amount: d.amount })),
      },
    };
  });
}

// العنصر بعد التحقّق من نطاقه، أو null بعد ردّ 404 / 403
function loadDuesMember(req, res) {
  const m = db.prepare(`SELECT id, branch_id, ${MEMBER_DUES_COLS} FROM members WHERE id = ?`).get(intOr(req.params.id));
  if (!m) res.status(404).json({ error: 'member not found' });
  else if (!branchOk(req, m.branch_id)) res.status(403).json({ error: 'forbidden' });
  else return m;
  return null;
}

// The نشاط a payment is taken in (body.session_id): it exists, the writer sees it, and
// the عنصر is on its roster. null: outside a نشاط. undefined: refused, the error sent.
function duesSession(req, res, m) {
  const id = req.body?.session_id;
  if (id === undefined || id === null) return null;
  const session = db.prepare('SELECT id, date, branch_id, section FROM sessions WHERE id = ?').get(intOr(id));
  const onRoster =
    session && db.prepare('SELECT 1 FROM attendance WHERE session_id = ? AND member_id = ?').get(session.id, m.id);
  if (!onRoster) res.status(400).json({ error: 'invalid session' });
  else if (!sessionOk(req, session)) res.status(403).json({ error: 'forbidden' });
  else return session;
  return undefined;
}

// A payment enters the box of the عنصر's فرقة on the نشاط's day (today when the نشاط
// is still to come), or today outside a نشاط
function insertMemberDue(req, m, month, amount, session) {
  const today = todayISO();
  const id = db
    .prepare(
      `INSERT INTO member_dues (member_id, month, amount, paid_on, session_id, branch_id, section, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      m.id,
      month,
      amount,
      session && session.date < today ? session.date : today,
      session?.id ?? null,
      m.branch_id,
      sectionOfBranch(m.branch_id) ?? 'M',
      actorName(req)
    ).lastInsertRowid;
  auditEvent(req, 'create', 'member_due', id, null, db.prepare('SELECT * FROM member_dues WHERE id = ?').get(id));
}

const monthLeft = (m, month) =>
  dueLeft(
    db.prepare('SELECT SUM(amount) AS n FROM member_dues WHERE member_id = ? AND month = ?').get(m.id, month).n,
    memberRate(m, month)
  );

// The month after a change, and the عنصر's whole account with it
const memberMonthPayload = (m, month) => ({ month, paid: memberMonthOf(m, month), summary: memberDuesSummary(m) });

app.get('/api/members/:id/dues', (req, res) => {
  if (!canSeeMemberDues(req)) return res.status(403).json({ error: 'forbidden' });
  const m = loadDuesMember(req, res);
  if (!m) return;
  const year = duesYearParam(req);
  if (!year) return res.status(400).json({ error: 'invalid year' });
  const months = yearMonths(year);
  res.json({
    year,
    years: memberDuesYears(),
    months,
    // Son tarif de ce mois-ci ; month_rates : celui de chaque mois de l'année (G1)
    monthly: memberRate(m, currentMonth()),
    month_rates: Object.fromEntries(months.map((x) => [x, memberRate(m, x)])),
    // Les mois de l'année qui lui sont dus : atteints, depuis son début, jusqu'à son
    // archivage, et pas exonérés
    owed_months: (() => {
      const end = memberDuesUntil(m, currentMonth());
      return end ? months.filter((x) => x >= memberDuesFrom(m) && x <= end && memberRate(m, x) > 0) : [];
    })(),
    personal_rate:
      m.dues_monthly === null || m.dues_monthly === undefined
        ? null
        : { amount: m.dues_monthly, note: m.dues_note, from: m.dues_rate_from },
    general_rate: rateFor('member', currentMonth()),
    can_exempt: hasPerm(req, 'members.dues.exempt'),
    start_month: memberDuesFrom(m),
    current_month: currentMonth(),
    member_id: m.id,
    active: m.status === 'active',
    archived_month: m.status === 'active' ? null : memberDuesUntil(m, currentMonth()),
    paid: memberDuesOf(m, months[0], months[11]),
    summary: memberDuesSummary(m),
    can_edit: canWriteMemberDues(req),
  });
});

// دفعة لشهر: amount ما أُعطي — ما بقي من الشهر إن لم يُذكر — و لا يتجاوز ما بقي.
// session_id: النشاط الذي دُفعت فيه — العنصر من لائحته، و يوم الدفعة يومه (اليوم إن كان
// النشاط لم يأتِ بعد)؛ بدونه اليوم، خارج نشاط.
app.post('/api/members/:id/dues/:month', (req, res) => {
  if (!canWriteMemberDues(req)) return res.status(403).json({ error: 'forbidden' });
  const m = loadDuesMember(req, res);
  if (!m) return;
  const month = req.params.month;
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'invalid month' });
  const session = duesSession(req, res, m);
  if (session === undefined) return;
  const left = monthLeft(m, month);
  if (left === 0) return res.status(400).json({ error: 'already paid' });
  const given = req.body?.amount;
  const amount = given === undefined || given === null || given === '' ? left : parsePaid(given);
  if (!amount) return res.status(400).json({ error: 'invalid amount' });
  if (amount > left) return res.status(400).json({ error: 'more than owed' });
  insertMemberDue(req, m, month, amount, session);
  res.status(201).json(memberMonthPayload(m, month));
});

// Takes one payment back — written by mistake, or the money given back
app.delete('/api/members/:id/dues/payments/:pid', (req, res) => {
  if (!canWriteMemberDues(req)) return res.status(403).json({ error: 'forbidden' });
  const m = loadDuesMember(req, res);
  if (!m) return;
  const p = db.prepare('SELECT * FROM member_dues WHERE id = ? AND member_id = ?').get(intOr(req.params.pid), m.id);
  if (!p) return res.status(404).json({ error: 'payment not found' });
  db.prepare('DELETE FROM member_dues WHERE id = ?').run(p.id);
  auditEvent(req, 'delete', 'member_due', p.id, p, null);
  res.json(memberMonthPayload(m, p.month));
});

// The whole month at once — paid: true pays what is left of it (in the نشاط session_id
// names, as above), false takes back every payment made for it
app.put('/api/members/:id/dues/:month', (req, res) => {
  if (!canWriteMemberDues(req)) return res.status(403).json({ error: 'forbidden' });
  const m = loadDuesMember(req, res);
  if (!m) return;
  const month = req.params.month;
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'invalid month' });
  if (typeof req.body?.paid !== 'boolean') return res.status(400).json({ error: 'invalid paid' });
  const session = duesSession(req, res, m);
  if (session === undefined) return;
  if (req.body.paid) {
    const left = monthLeft(m, month);
    if (left > 0) insertMemberDue(req, m, month, left, session);
  } else
    for (const p of db.prepare('SELECT * FROM member_dues WHERE member_id = ? AND month = ?').all(m.id, month)) {
      db.prepare('DELETE FROM member_dues WHERE id = ?').run(p.id);
      auditEvent(req, 'delete', 'member_due', p.id, p, null);
    }
  res.json(memberMonthPayload(m, month));
});

// ---------- Arriérés (G1) ----------
// Un seul calcul, lu par la trésorerie, العناصر, le tableau de bord et les exports.
// `members` : lignes de members avec MEMBER_DUES_COLS. Rend id -> { months, owed,
// last_paid_on } pour ceux qui doivent quelque chose (`year` : ses seuls mois).
function arrearsByMember(members, year = null) {
  const out = new Map();
  if (!members.length) return out;
  const ids = members.map((m) => intOr(m.id)).join(',');
  const byMember = new Map();
  for (const r of db
    .prepare(`SELECT member_id, month, amount, paid_on FROM member_dues WHERE member_id IN (${ids})`)
    .all()) {
    if (!byMember.has(r.member_id)) byMember.set(r.member_id, []);
    byMember.get(r.member_id).push(r);
  }
  const until = currentMonth();
  for (const m of members) {
    const rows = byMember.get(m.id) || [];
    const paid = paidByMonth(rows);
    let months = memberLateMonths(m, paid, until);
    if (year) months = months.filter((x) => x.startsWith(year));
    if (!months.length) continue;
    out.set(m.id, {
      months,
      owed: months.reduce((n, x) => n + dueLeft(paid.get(x), memberRate(m, x)), 0),
      last_paid_on: rows.reduce((d, r) => (r.paid_on && (!d || r.paid_on > d) ? r.paid_on : d), null),
    });
  }
  return out;
}

// En retard = doit au moins un mois passé : le mois en cours non encore payé, c'est tout
// le monde au début du mois (il ne compte qu'avec current, et dans le montant dû)
const isLate = (months, current = currentMonth()) => months.some((m) => m < current);

// Les عناصر en retard, dans le périmètre du compte : actifs d'un côté, archivés avec une
// dette de l'autre (« soldées / abandonnées » : la dette reste visible après l'archivage).
// withCurrent : aussi ceux qui ne doivent que le mois en cours.
function duesArrears(req, { branch = null, year = null, withCurrent = false } = {}) {
  const params = [];
  let sql = `SELECT m.id, m.first_name, m.father_name, m.last_name, m.branch_id, m.photo,
               m.member_phone, m.father_phone, m.mother_phone,
               ${MEMBER_DUES_COLS.split(', ').map((c) => `m.${c}`).join(', ')},
               b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar, b.sort_order AS branch_sort,
               g.name AS group_name
             FROM members m JOIN branches b ON b.id = m.branch_id
             LEFT JOIN branch_groups g ON g.id = m.group_id
             WHERE (m.status = 'active' OR m.archived_at IS NOT NULL)${branchFilterSQL(req, 'm.branch_id')}`;
  if (branch) {
    sql += ' AND m.branch_id = ?';
    params.push(intOr(branch));
  }
  const members = db.prepare(sql).all(...params);
  const late = arrearsByMember(members, year);
  const rows = members
    .filter((m) => late.has(m.id) && (withCurrent || isLate(late.get(m.id).months)))
    .map((m) => {
      const { dues_note: _n, ...rest } = m;
      return stripContact(req, { ...rest, ...late.get(m.id), archived: m.status !== 'active' });
    })
    .sort(
      (a, b) =>
        (a.branch_sort ?? 0) - (b.branch_sort ?? 0) ||
        a.branch_id - b.branch_id ||
        b.owed - a.owed ||
        `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
    );
  const active = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);
  const total = (list) => ({
    members: list.length,
    months: list.reduce((n, r) => n + r.months.length, 0),
    amount: list.reduce((n, r) => n + r.owed, 0),
  });
  return {
    current_month: currentMonth(),
    rate: rateFor('member', currentMonth()),
    year: year || null,
    with_current: withCurrent,
    members: active,
    archived,
    totals: total(active),
    archived_totals: total(archived),
  };
}

app.get('/api/member-dues/arrears', (req, res) => {
  if (!canSeeMemberDues(req)) return res.status(403).json({ error: 'forbidden' });
  const year = req.query.year ? String(req.query.year).trim() : null;
  if (year && !YEAR_RE.test(year)) return res.status(400).json({ error: 'invalid year' });
  const branch = req.query.branch ? intOr(req.query.branch) : null;
  if (branch && !branchOk(req, branch)) return res.status(403).json({ error: 'forbidden' });
  res.json(duesArrears(req, { branch, year, withCurrent: req.query.current === '1' }));
});

// Tarif personnel ou exonération (G1), sur la fiche : amount null = tarif général,
// 0 = exonéré, n = tarif personnel ; note (le motif : fratrie, cas social…) obligatoire
// dès qu'il s'écarte du tarif ; from = le mois d'où il vaut (ce mois-ci par défaut) —
// les mois d'avant gardent ce qu'ils devaient.
app.put('/api/members/:id/dues-rate', requirePerm('members.dues.exempt'), (req, res) => {
  const m = loadDuesMember(req, res);
  if (!m) return;
  const b = req.body || {};
  const raw = b.amount;
  const amount = raw === null || raw === undefined || raw === '' ? null : Number(raw);
  if (amount !== null && (!Number.isInteger(amount) || amount < 0 || amount > 1000000))
    return res.status(400).json({ error: 'invalid amount' });
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 300) : '';
  if (amount !== null && !note) return res.status(400).json({ error: 'note_required' });
  const from = b.from === undefined || b.from === null || b.from === '' ? currentMonth() : String(b.from);
  if (amount !== null && !MONTH_RE.test(from)) return res.status(400).json({ error: 'invalid month' });
  const before = db.prepare('SELECT dues_monthly, dues_note, dues_rate_from FROM members WHERE id = ?').get(m.id);
  db.prepare('UPDATE members SET dues_monthly = ?, dues_note = ?, dues_rate_from = ? WHERE id = ?').run(
    amount,
    amount === null ? null : note,
    amount === null ? null : from,
    m.id
  );
  const after = db.prepare('SELECT dues_monthly, dues_note, dues_rate_from FROM members WHERE id = ?').get(m.id);
  auditEvent(req, 'update', 'member_dues_rate', m.id, before, after);
  res.json({ personal_rate: amount === null ? null : { amount, note, from }, summary: memberDuesSummary({ ...m, ...after }) });
});

// Tarifs datés (réglages, admin). Lus par qui voit une cotisation.
const dueRatesPayload = () => ({
  current_month: currentMonth(),
  member: dueRateList('member').map(({ id, amount, effective_month, created_by, created_at }) => ({
    id, amount, effective_month, created_by, created_at,
  })),
  leader: dueRateList('leader').map(({ id, amount, effective_month, created_by, created_at }) => ({
    id, amount, effective_month, created_by, created_at,
  })),
  current: { member: rateFor('member', currentMonth()), leader: rateFor('leader', currentMonth()) },
});

app.get('/api/due-rates', (req, res) => {
  if (req.user.role !== 'admin' && !canSeeMemberDues(req) && !hasPerm(req, 'leaders.dues'))
    return res.status(403).json({ error: 'forbidden' });
  res.json(dueRatesPayload());
});

// Un tarif à partir d'un mois ; le même mois déjà tarifé : son montant est remplacé
app.post('/api/due-rates', requireAdmin, (req, res) => {
  const { kind, effective_month: month } = req.body || {};
  const amount = Number(req.body?.amount);
  if (!(kind in DUE_RATE_KINDS)) return res.status(400).json({ error: 'invalid kind' });
  if (!MONTH_RE.test(String(month || ''))) return res.status(400).json({ error: 'invalid month' });
  if (!Number.isInteger(amount) || amount < 0 || amount > 1000000) return res.status(400).json({ error: 'invalid amount' });
  const before = db.prepare('SELECT * FROM due_rates WHERE kind = ? AND effective_month = ?').get(kind, month) || null;
  db.prepare(
    `INSERT INTO due_rates (kind, amount, effective_month, created_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(kind, effective_month) DO UPDATE SET amount = excluded.amount, created_by = excluded.created_by,
       created_at = datetime('now')`
  ).run(kind, amount, month, actorName(req));
  dueRatesCache = null;
  const after = db.prepare('SELECT * FROM due_rates WHERE kind = ? AND effective_month = ?').get(kind, month);
  auditEvent(req, before ? 'update' : 'create', 'due_rate', after.id, before, after);
  res.status(before ? 200 : 201).json(dueRatesPayload());
});

// Le seul tarif d'un genre ne se supprime pas : il faut toujours un prix
app.delete('/api/due-rates/:id', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM due_rates WHERE id = ?').get(intOr(req.params.id));
  if (!r) return res.status(404).json({ error: 'not found' });
  if (db.prepare('SELECT COUNT(*) AS n FROM due_rates WHERE kind = ?').get(r.kind).n <= 1)
    return res.status(400).json({ error: 'last_rate' });
  db.prepare('DELETE FROM due_rates WHERE id = ?').run(r.id);
  dueRatesCache = null;
  auditEvent(req, 'delete', 'due_rate', r.id, r, null);
  res.json(dueRatesPayload());
});

app.put('/api/leaders/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM leaders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'leader not found' });
  const err = validateLeader(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  const section = b.section === undefined ? existing.section : parseSection(b.section);
  if (!section) return res.status(400).json({ error: 'invalid section' });
  db.transaction(() => {
    db.prepare(
      `UPDATE leaders SET ${LEADER_COLUMNS.map((c) => `${c} = ?`).join(', ')}, section = ? WHERE id = ?`
    ).run(...leaderValues(b), section, req.params.id);
    // A قائد moved to the other قسم takes his account with him: left behind, it would
    // keep reading the قسم he no longer belongs to. فرق of the old قسم drop out of
    // its list — an emptied list sees no فرقة until the admin grants the new ones.
    if (section !== existing.section) {
      for (const u of db.prepare("SELECT id, branches FROM users WHERE leader_id = ? AND role != 'admin'").all(existing.id)) {
        const kept = u.branches
          ? JSON.stringify(JSON.parse(u.branches).filter((id) => sectionOfBranch(id) === section))
          : null;
        db.prepare('UPDATE users SET section = ?, branches = ? WHERE id = ?').run(section, kept, u.id);
      }
    }
  })();
  if ((b.status || 'active') === 'active')
    db.prepare('UPDATE leaders SET archived_at = NULL, archived_by = NULL WHERE id = ?').run(req.params.id);
  // Refresh the name snapshot on sessions this leader animated — الاسم الثلاثي حين
  // يوجد اسم الأب، كما يُعرض القائد في كل مكان آخر
  db.prepare('UPDATE sessions SET leader = ? WHERE leader_id = ?').run(
    [b.first_name, b.father_name, b.last_name].filter(Boolean).join(' '), req.params.id
  );
  const updated = db.prepare('SELECT * FROM leaders WHERE id = ?').get(req.params.id);
  auditEvent(req, 'update', 'leader', existing.id, publicLeader(existing), publicLeader(updated));
  res.json(publicLeader(updated));
});

app.delete('/api/leaders/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM leaders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'leader not found' });
  const actor = req.user.display_name || req.user.username;
  db.transaction(() => {
    db.prepare(
      "UPDATE leaders SET status = 'inactive', archived_at = datetime('now'), archived_by = ? WHERE id = ?"
    ).run(actor, existing.id);
    const accounts = db.prepare('SELECT id FROM users WHERE leader_id = ?').all(existing.id);
    for (const account of accounts) {
      db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(account.id);
      db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(account.id);
    }
  })();
  auditEvent(req, 'archive', 'leader', existing.id, publicLeader(existing), {
    ...publicLeader(existing),
    status: 'inactive',
  });
  res.status(204).end();
});

// ---------- قفل التشكيلة ----------
// A locked year is frozen: none of its توصيفات can be created, renamed, reassigned or
// deleted. Only an admin can lock or unlock a year.

const normYear = (v) => (v === undefined || v === null ? '' : String(v).trim());

const lockInfo = (year) =>
  normYear(year) ? db.prepare('SELECT * FROM tachkila_locks WHERE year = ?').get(normYear(year)) || null : null;

const yearLocked = (year) => !!lockInfo(year);

// Refuses any mutation touching a frozen year. `getYears` returns the year(s) the
// request would write to (a PUT can both edit a row and move it to another year).
const rejectLocked = (getYears) => (req, res, next) => {
  const years = [].concat(getYears(req) || []).filter(Boolean);
  return years.some(yearLocked) ? res.status(423).json({ error: 'year_locked' }) : next();
};

const assignmentYear = (req) =>
  db.prepare('SELECT year FROM assignments WHERE id = ?').get(req.params.id)?.year;

app.post('/api/tachkila/lock', requireAdmin, (req, res) => {
  const year = normYear(req.body?.year);
  if (!scoutYearRange(year)) return res.status(400).json({ error: 'invalid year' });
  const locked = req.body?.locked !== false;
  if (locked)
    db.prepare(
      "INSERT OR REPLACE INTO tachkila_locks (year, locked_at, locked_by) VALUES (?, datetime('now'), ?)"
    ).run(year, req.user.display_name || req.user.username);
  else db.prepare('DELETE FROM tachkila_locks WHERE year = ?').run(year);
  const info = lockInfo(year);
  res.json({ year, locked, locked_at: info?.locked_at || null, locked_by: info?.locked_by || null });
});

app.get('/api/tachkila', requirePerm('leaders.read'), (req, res) => {
  const years = db
    .prepare(
      `SELECT year FROM tachkila_years
       UNION SELECT DISTINCT year FROM assignments
       ORDER BY year DESC`
    )
    .all()
    .map((r) => r.year);
  const year = req.query.year || years[0] || null;
  // The year is the فوج's, its توصيفات are each قسم's: a قسم reads its own rows and
  // its own part of the template
  const section = activeSection(req);
  const template = tachkilaTemplate(section);
  const titles = new Set(
    (year ? db.prepare('SELECT title FROM assignments WHERE year = ?').all(year) : []).map((r) => r.title.trim())
  );
  const lock = lockInfo(year);
  res.json({
    years,
    year,
    // Years frozen by an admin — the UI greys the whole list out for them
    locked: !!lock,
    locked_at: lock?.locked_at || null,
    locked_by: lock?.locked_by || null,
    locked_years: db.prepare('SELECT year FROM tachkila_locks').all().map((r) => r.year),
    assignments: assignmentsForYear(year, section),
    // Standard titles, plus how many of them this year is still missing (offer to fill them in)
    template: template.map((r) => r.title),
    missing_count: year ? template.filter((r) => !titles.has(r.title)).length : template.length,
  });
});

// '' from an unselected <select> means "no one assigned yet", not an invalid id
const optionalId = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

// قسم التوصيف: قسم فرقته إن كان توصيف فرقة، و إلا فما طُلب، أو القسم المعروض، أو
// قسم التوصيف الحالي عند التعديل، أو الفتيان
function assignmentSection(req, body, existing = null) {
  const branchId = optionalId(body.branch_id);
  if (branchId !== null) return sectionOfBranch(branchId);
  return parseSection(req.body?.section) || existing?.section || activeSection(req) || 'M';
}

function validateAssignment(body, selfId = null, section = 'M') {
  if (!scoutYearRange(String(body.year || '').trim())) return 'invalid year';
  if (!body.title || !String(body.title).trim()) return 'title required';
  const leaderId = optionalId(body.leader_id);
  if (leaderId !== null) {
    const leader = db.prepare('SELECT id, status, section FROM leaders WHERE id = ?').get(leaderId);
    const currentLeaderId = selfId
      ? db.prepare('SELECT leader_id FROM assignments WHERE id = ?').get(selfId)?.leader_id
      : null;
    if (!leader || (leader.status !== 'active' && Number(currentLeaderId) !== Number(leaderId)))
      return 'invalid leader_id';
    // قائد في توصيف من القسم الآخر يُظهر اسمه في تشكيلة ليست له (section null = فرقة
    // غير موجودة، يرفضها الفحص التالي)
    if (section && leader.section !== section) return 'leader_outside_section';
  }
  const branchId = optionalId(body.branch_id);
  if (branchId !== null && !db.prepare('SELECT id FROM branches WHERE id = ?').get(branchId))
    return 'invalid branch_id';
  // المجموعة من مجموعات فرقة التوصيف نفسها، و توصيفٌ بلا فرقة لا مجموعة له
  if (resolveGroupId(body.group_id, branchId) === undefined) return 'invalid group_id';
  // التبعية للأمانات وحدها: الأب أمانةٌ من السنة نفسها، جذرٌ لا تابعٌ (مستوى واحد)،
  // و ليس التوصيف نفسه
  const parentId = optionalId(body.parent_id);
  if (parentId !== null) {
    if (branchId !== null) return 'invalid parent_id';
    if (selfId !== null && Number(selfId) === parentId) return 'invalid parent_id';
    const parent = db
      .prepare('SELECT year, role_type, parent_id, section FROM assignments WHERE id = ?')
      .get(parentId);
    if (
      !parent ||
      parent.role_type !== 'amana' ||
      parent.parent_id !== null ||
      parent.year !== String(body.year).trim() ||
      parent.section !== section
    )
      return 'invalid parent_id';
  }
  return null;
}

app.post('/api/tachkila', requireAdmin, followTachkila, rejectLocked((req) => req.body?.year), (req, res) => {
  if (req.body?.section !== undefined && !parseSection(req.body.section))
    return res.status(400).json({ error: 'invalid section' });
  const section = assignmentSection(req, req.body);
  const err = validateAssignment(req.body, null, section);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  db.prepare('INSERT OR IGNORE INTO tachkila_years (year, created_by) VALUES (?, ?)').run(
    String(b.year).trim(),
    req.user.display_name || req.user.username
  );
  const branchId = optionalId(b.branch_id);
  const info = db
    .prepare(
      'INSERT INTO assignments (year, leader_id, title, branch_id, group_id, parent_id, role_type, sort_order, section) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      String(b.year).trim(),
      optionalId(b.leader_id),
      String(b.title).trim(),
      branchId,
      resolveGroupId(b.group_id, branchId) ?? null,
      branchId ? null : optionalId(b.parent_id),
      branchId ? 'branch' : 'amana',
      Number.isInteger(b.sort_order) ? b.sort_order : 0,
      section
    );
  res.status(201).json(db.prepare('SELECT * FROM assignments WHERE id = ?').get(info.lastInsertRowid));
});

app.put(
  '/api/tachkila/:id',
  requireAdmin,
  followTachkila,
  rejectLocked((req) => [assignmentYear(req), req.body?.year]),
  (req, res) => {
    const existing = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'assignment not found' });
    if (req.body?.section !== undefined && !parseSection(req.body.section))
      return res.status(400).json({ error: 'invalid section' });
    const body = { ...existing, ...req.body };
    const section = assignmentSection(req, body, existing);
    const err = validateAssignment(body, req.params.id, section);
    if (err) return res.status(400).json({ error: err });
    const branchId = optionalId(body.branch_id);
    const parentId = branchId ? null : optionalId(body.parent_id);
    // أمينٌ له تابعون لا يصير تابعًا: مستوى واحد، فالسلسلة تُرفض من طرفيها
    if (
      parentId !== null &&
      db.prepare('SELECT 1 FROM assignments WHERE parent_id = ?').get(req.params.id)
    )
      return res.status(400).json({ error: 'invalid parent_id' });
    db.prepare(
      `UPDATE assignments SET year = ?, leader_id = ?, title = ?, branch_id = ?, group_id = ?, parent_id = ?, role_type = ?, sort_order = ?,
         section = ?
       WHERE id = ?`
    ).run(
      String(body.year).trim(),
      optionalId(body.leader_id),
      String(body.title).trim(),
      branchId,
      resolveGroupId(body.group_id, branchId) ?? null,
      parentId,
      branchId ? 'branch' : 'amana',
      Number.isInteger(body.sort_order) ? body.sort_order : existing.sort_order,
      section,
      req.params.id
    );
    res.json(db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id));
  }
);

app.delete('/api/tachkila/:id', requireAdmin, followTachkila, rejectLocked(assignmentYear), (req, res) => {
  let changes = 0;
  db.transaction(() => {
    // حذف الأمين لا يُسقط مساعديه من التشكيلة: يعودون توصيفات مستقلة
    db.prepare('UPDATE assignments SET parent_id = NULL WHERE parent_id = ?').run(req.params.id);
    changes = db.prepare('DELETE FROM assignments WHERE id = ?').run(req.params.id).changes;
  })();
  if (changes === 0) return res.status(404).json({ error: 'assignment not found' });
  res.status(204).end();
});

const insertAssignmentRow = () =>
  db.prepare(
    'INSERT INTO assignments (year, leader_id, title, branch_id, group_id, parent_id, role_type, sort_order, section) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

// New تشكيلة year. `mode` decides what it starts with:
//   template (default) — every standard توصيف of the فوج as an empty slot
//   copy               — same توصيفات AND same قادة as `from_year`
//   empty              — nothing, build it by hand
app.post('/api/tachkila/copy', requireAdmin, followTachkila, rejectLocked((req) => req.body?.to_year), (req, res) => {
  const { from_year, to_year, mode = 'template' } = req.body;
  if (!scoutYearRange(String(to_year || '').trim())) return res.status(400).json({ error: 'invalid year' });
  if (!['template', 'copy', 'empty'].includes(mode)) return res.status(400).json({ error: 'invalid mode' });
  const target = String(to_year).trim();
  const exists = db.prepare('SELECT 1 FROM tachkila_years WHERE year = ?').get(target);
  if (exists) return res.status(400).json({ error: 'year_exists' });

  let rows = [];
  if (mode === 'copy') {
    if (!from_year) return res.status(400).json({ error: 'from_year required' });
    rows = db
      .prepare(
        'SELECT id, leader_id, title, branch_id, group_id, parent_id, role_type, sort_order, section FROM assignments WHERE year = ? ORDER BY sort_order, id'
      )
      .all(from_year);
    if (rows.length === 0) return res.status(404).json({ error: 'source_year_empty' });
  } else if (mode === 'template') {
    rows = tachkilaTemplate().map((r) => ({ ...r, leader_id: null }));
  }

  const insert = insertAssignmentRow();
  const run = db.transaction(() => {
    db.prepare('INSERT INTO tachkila_years (year, created_by) VALUES (?, ?)').run(
      target,
      req.user.display_name || req.user.username
    );
    // التبعية تُنسخ على مرحلتين: الصفوف كلها أولًا، ثم parent_id يُعاد ربطه بأرقام
    // السنة الجديدة — الأرقام القديمة تخصّ سنة المصدر و لا معنى لها هنا.
    const idMap = new Map();
    for (const r of rows) {
      const info = insert.run(
        target, r.leader_id ?? null, r.title, r.branch_id, r.group_id ?? null, null,
        r.role_type, r.sort_order ?? 0, r.section
      );
      if (r.id !== undefined) idMap.set(r.id, info.lastInsertRowid);
    }
    for (const r of rows)
      if (r.parent_id && idMap.has(r.parent_id) && idMap.has(r.id))
        db.prepare('UPDATE assignments SET parent_id = ? WHERE id = ?')
          .run(idMap.get(r.parent_id), idMap.get(r.id));
  });
  run();
  // نموذج القالب يولد صفوفًا مسطّحة: تُربط بأمينها فورًا لا في الإقلاع القادم
  migrateAmanaHelpers();
  res.status(201).json({ year: target, created: rows.length });
});

// Add the standard توصيفات an existing year is missing — for تشكيلات made before this template,
// or after a new فرقة was created. Existing rows are matched by title and left untouched.
app.post('/api/tachkila/fill', requireAdmin, followTachkila, rejectLocked((req) => req.body?.year), (req, res) => {
  const year = String(req.body.year || '').trim();
  if (!scoutYearRange(year)) return res.status(400).json({ error: 'invalid year' });
  db.prepare('INSERT OR IGNORE INTO tachkila_years (year, created_by) VALUES (?, ?)').run(
    year,
    req.user.display_name || req.user.username
  );
  const titles = new Set(
    db.prepare('SELECT title FROM assignments WHERE year = ?').all(year).map((r) => r.title.trim())
  );
  // The قسم on screen fills its own part of the template; both when both are shown
  const missing = tachkilaTemplate(activeSection(req)).filter((r) => !titles.has(r.title));
  const insert = insertAssignmentRow();
  const run = db.transaction(() => {
    for (const r of missing)
      insert.run(year, null, r.title, r.branch_id, null, null, r.role_type, r.sort_order, r.section);
  });
  run();
  migrateAmanaHelpers();
  res.status(201).json({ year, added: missing.length });
});

// ---------- إشعارات الأدمن ----------
// Written when a non-admin account touches a نشاط: creation, présence, counts,
// animators. An admin doing the same thing notifies nobody — he is the audience.

// Repeated edits of the same type on the same نشاط by the same قائد within an
// hour collapse into one line: marking présence is one tap per عنصر, and thirty
// rows saying "عدّل الحضور" would drown the notification that matters.
function notifyAdmins(req, type, session) {
  if (req.user.role === 'admin') return;
  const recent = db
    .prepare(
      `SELECT id FROM notifications
        WHERE type = ? AND session_id = ? AND actor_user_id = ?
          AND created_at >= datetime('now', '-1 hour')`
    )
    .get(type, session.id, req.user.id);
  if (recent) {
    db.prepare("UPDATE notifications SET created_at = datetime('now') WHERE id = ?").run(recent.id);
    return;
  }
  db.prepare(
    `INSERT INTO notifications (type, session_id, session_title, branch_id, kind, actor, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    type,
    session.id,
    session.title || null,
    session.branch_id ?? null,
    session.kind || 'activity',
    req.user.display_name || req.user.username,
    req.user.id
  );
  // The feed is a recent-activity log, not an archive — keep the last 200 rows
  db.prepare(
    `DELETE FROM notifications WHERE id NOT IN
      (SELECT id FROM notifications ORDER BY created_at DESC, id DESC LIMIT 200)`
  ).run();
}

app.get('/api/notifications', requireAdmin, (req, res) => {
  // datetime('now') and seen_at share the same UTC format, so string compare works
  const seen =
    db.prepare('SELECT seen_at FROM notification_seen WHERE user_id = ?').get(req.user.id)?.seen_at || '';
  const rows = db
    .prepare(
      `SELECT n.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
       FROM notifications n LEFT JOIN branches b ON b.id = n.branch_id
       ORDER BY n.created_at DESC, n.id DESC LIMIT 50`
    )
    .all()
    .map((n) => ({ ...n, unread: n.created_at > seen }));
  res.json({ items: rows, unread_count: rows.filter((n) => n.unread).length });
});

app.post('/api/notifications/seen', requireAdmin, (req, res) => {
  db.prepare(
    `INSERT INTO notification_seen (user_id, seen_at) VALUES (?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET seen_at = excluded.seen_at`
  ).run(req.user.id);
  res.status(204).end();
});

// Every account's own notifications — the bell, and the push to its phones (server/push.js).
// The same permission rule as hasPerm, for an account other than the caller's.
const notifications = require('./push')(app, {
  canUser: (u, key) => {
    const p = publicUser(u);
    return p.role === 'admin' || !p.perms || p.perms.includes(key);
  },
  // The next نشاط of a فرقة's annual plan from `today`, for the reminder of its بطاقة
  nextPlanned: (branchId, today) => planFor(branchId, currentScoutYear()).items.find((i) => i.date >= today) || null,
});

// ---------- Sessions & attendance ----------

// طبيعة النشاط — a fixed list, translated client-side
const ACTIVITY_TYPES = ['weekly', 'cultural', 'ashura', 'ramadan', 'summer_clubs'];

// A نشاط عام للفوج is recorded by numbers, not by names: عدد الحضور لكل فرقة
const branchCountsOf = (sessionId) =>
  db
    .prepare(
      `SELECT c.branch_id, c.count, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
       FROM session_branch_counts c JOIN branches b ON b.id = c.branch_id
       WHERE c.session_id = ? ORDER BY b.sort_order, b.id`
    )
    .all(sessionId);

// [{ branch_id, count }] with existing فرق and counts >= 0, or null if the body is malformed
function parseBranchCounts(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const r of v) {
    const branchId = Number(r?.branch_id);
    const count = Number(r?.count);
    if (!Number.isInteger(branchId) || !Number.isInteger(count) || count < 0) return null;
    if (!db.prepare('SELECT id FROM branches WHERE id = ?').get(branchId)) return null;
    out.push({ branch_id: branchId, count });
  }
  return out;
}

// ضيوف نشاط القادة: أسماء حرّة، مقصوصة الأطراف، بلا فراغ و بلا تكرار. null = طلب فاسد.
const GUEST_NAME_MAX = 120;
function parseGuestName(v) {
  if (typeof v !== 'string') return null;
  const name = v.trim().replace(/\s+/g, ' ');
  return name && name.length <= GUEST_NAME_MAX ? name : null;
}
function parseGuestNames(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 200) return null;
  const names = v.map(parseGuestName);
  if (names.includes(null)) return null;
  return [...new Set(names)];
}
const insertGuest = db.prepare('INSERT INTO session_guests (session_id, name, created_by) VALUES (?, ?, ?)');
const guestsOf = (sessionId) =>
  db.prepare('SELECT id, name FROM session_guests WHERE session_id = ? ORDER BY id').all(sessionId);

const saveBranchCounts = db.transaction((sessionId, counts) => {
  db.prepare('DELETE FROM session_branch_counts WHERE session_id = ?').run(sessionId);
  const insert = db.prepare(
    'INSERT INTO session_branch_counts (session_id, branch_id, count) VALUES (?, ?, ?)'
  );
  for (const c of counts) insert.run(sessionId, c.branch_id, c.count);
});

// Sorting a نشاط by présence answers "which activity did they skip": the counts are
// already selected above, so ORDER BY reads them back by alias. `rate` divides by the
// marked roster, the same way a عنصر's own rate is computed — an unmarked نشاط has none,
// so NULLIF keeps it out of the way instead of ranking it as a perfect 0%.
const SESSION_SORTS = {
  date_desc: 's.date DESC, s.id DESC',
  date_asc: 's.date ASC, s.id ASC',
  present_desc: 'present_count DESC, s.date DESC',
  absent_desc: 'absent_count DESC, s.date DESC',
  rate_desc: 'rate IS NULL, rate DESC, s.date DESC',
  rate_asc: 'rate IS NULL, rate ASC, s.date DESC',
};

app.get('/api/sessions', requirePerm('sessions.read'), (req, res) => {
  const { q, branch, from, to, leader, activity_type: activityType, kind, group } = req.query;
  // القائد صاحب الحساب، ليُعرف من القائمة ما ينتظر تقييمه (-1: حساب بلا قائد)
  const me = req.user.leader_id ? intOr(req.user.leader_id) : -1;
  let sql = `SELECT s.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        COALESCE(${fullNameSQL('l')}, s.leader) AS leader,
        (SELECT GROUP_CONCAT(sb.branch_id) FROM session_branches sb WHERE sb.session_id = s.id) AS branch_ids,
        (SELECT GROUP_CONCAT(sg.group_id) FROM session_groups sg WHERE sg.session_id = s.id) AS group_ids,
        (SELECT COALESCE(SUM(c.count), 0) FROM session_branch_counts c WHERE c.session_id = s.id) AS branch_counts_total,
        -- حضور نشاط القادة يسكن session_leaders، و عناصر فرقه المدعوّة في attendance:
        -- الأعداد تجمع الاثنين، و ما سواه من الأنواع لا صفوف له في session_leaders تُعدّ
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'present')
          + (CASE WHEN s.kind = 'leaders'
              THEN (SELECT COUNT(*) FROM session_leaders sl WHERE sl.session_id = s.id AND sl.status = 'present')
              ELSE 0 END) AS present_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'absent')
          + (CASE WHEN s.kind = 'leaders'
              THEN (SELECT COUNT(*) FROM session_leaders sl WHERE sl.session_id = s.id AND sl.status = 'absent')
              ELSE 0 END) AS absent_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'excused') AS excused_count,
        -- Un taux seulement pour une séance qui compte (pointée ou validée) : une liste
        -- restée «absent» par défaut n'est pas un 0 %
        (CASE WHEN ${countedSessionSQL('s')} THEN (SELECT ROUND(100.0 * SUM(m.status = 'present') / NULLIF(COUNT(*), 0)) FROM (
           SELECT a.status FROM attendance a
            WHERE a.session_id = s.id AND a.status IN ('present', 'absent', 'excused')
           UNION ALL
           SELECT sl.status FROM session_leaders sl
            WHERE sl.session_id = s.id AND s.kind = 'leaders' AND sl.status IS NOT NULL) m) END) AS rate,
        ${countedSessionSQL('s')} AS counted,
        ${unconfirmedSessionSQL('s')} AS unconfirmed,
        ${todoEvalSQL('s')} AS todo_eval,
        ${todoFinancesSQL('s')} AS todo_finances,
        (SELECT COUNT(*) FROM session_guests g WHERE g.session_id = s.id) AS guest_count,
        -- مالية النشاط، فيُعرف من القائمة أربح أم خسر: اشتراكاته و تبرعاته، و مصاريفه
        -- مدفوعةً أو لم تُدفع بعد
        (SELECT COALESCE(SUM(a.paid), 0) FROM attendance a WHERE a.session_id = s.id) AS money_collected,
        (SELECT COALESCE(SUM(e.amount), 0) FROM treasury_entries e
          WHERE e.session_id = s.id AND e.direction = 'in') AS money_donations,
        (SELECT COALESCE(SUM(e.amount), 0) FROM treasury_entries e
          WHERE e.session_id = s.id AND e.direction = 'out') AS money_expenses,
        -- التقييم: عدد المقيِّمين و معدّلهم، هل لنوع النشاط استمارة، و هل ينتظر تقييم صاحب الحساب
        (SELECT COUNT(*) FROM session_evaluations ev WHERE ev.session_id = s.id) AS eval_count,
        (SELECT AVG(ev.average) FROM session_evaluations ev WHERE ev.session_id = s.id) AS eval_avg,
        EXISTS (SELECT 1 FROM eval_kind_forms k WHERE k.kind = s.kind) AS eval_form,
        EXISTS (SELECT 1 FROM session_leaders sl WHERE sl.session_id = s.id AND sl.leader_id = ${me}
                  AND COALESCE(sl.status, '') != 'absent') AS eval_participant,
        EXISTS (SELECT 1 FROM session_evaluations ev WHERE ev.session_id = s.id AND ev.leader_id = ${me}) AS eval_mine
       FROM sessions s LEFT JOIN branches b ON b.id = s.branch_id
       LEFT JOIN leaders l ON l.id = s.leader_id
       WHERE 1=1${sessionScopeSQL(req)}`;
  const params = [];
  // فلترة بفرقة: النشاط المشترك يظهر في قائمة كل فرقة يشملها، لا في الرئيسية وحدها
  if (branch) sql += ` AND ${sessionInBranchSQL(branch)}`;
  // فلترة بطليعة: الأنشطة التي شاركت فيها — نشاط فرقتها المفتوح للفرقة كلها، و النشاط
  // المحصور ببعض طلائعها إن كانت منها. حصّة طليعة أخرى من الفرقة نفسها تخرج.
  if (group) {
    const g = db.prepare('SELECT id, branch_id FROM branch_groups WHERE id = ?').get(intOr(group));
    if (!g) sql += ' AND 0';
    else
      sql += ` AND ${sessionInBranchSQL(g.branch_id)} AND (
          EXISTS (SELECT 1 FROM session_groups sg WHERE sg.session_id = s.id AND sg.group_id = ${g.id})
          OR NOT EXISTS (SELECT 1 FROM session_groups sg JOIN branch_groups bg ON bg.id = sg.group_id
                         WHERE sg.session_id = s.id AND bg.branch_id = ${g.branch_id}))`;
  }
  // Dates are stored as YYYY-MM-DD, so plain string comparison sorts correctly
  if (from) { sql += ' AND s.date >= ?'; params.push(from); }
  if (to) { sql += ' AND s.date <= ?'; params.push(to); }
  if (activityType) { sql += ' AND s.activity_type = ?'; params.push(activityType); }
  if (kind) { sql += ' AND s.kind = ?'; params.push(kind); }
  // «À régulariser» : ce qui reste à faire sur les séances passées récentes — présence
  // non confirmée, évaluation manquante, finances non saisies alors qu'un frais existe.
  // todo=attendance|eval|finances n'en garde qu'un ; todo=1 les trois.
  const todo = req.query.todo;
  if (todo) {
    const parts = {
      attendance: unconfirmedSessionSQL('s'),
      eval: todoEvalSQL('s'),
      finances: hasPerm(req, 'sessions.read.fees') ? todoFinancesSQL('s') : null,
    };
    const picked = parts[todo] !== undefined ? [parts[todo]] : Object.values(parts);
    const conds = picked.filter(Boolean);
    sql += ` AND s.date >= date('${todayISO()}', '-${TODO_WINDOW_DAYS} days') AND (${conds.length ? conds.join(' OR ') : '0'})`;
  }
  // "What did this قائد run" covers both roles: the animateur principal recorded on the
  // نشاط itself, and the مساعدين listed in session_leaders.
  if (leader) {
    sql += ` AND (s.leader_id = ? OR EXISTS (
               SELECT 1 FROM session_leaders sl WHERE sl.session_id = s.id AND sl.leader_id = ?))`;
    params.push(leader, leader);
  }
  if (q) {
    sql += ` AND (s.title LIKE ? OR COALESCE(${fullNameSQL('l')}, s.leader) LIKE ?
                  OR s.place LIKE ?
                  OR EXISTS (SELECT 1 FROM session_leaders sl JOIN leaders l2 ON l2.id = sl.leader_id
                             WHERE sl.session_id = s.id AND (${fullNameSQL('l2')}) LIKE ?)
                  OR EXISTS (SELECT 1 FROM session_guests g WHERE g.session_id = s.id AND g.name LIKE ?))`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY ${SESSION_SORTS[req.query.sort] || SESSION_SORTS.date_desc}`;
  const seesMoney = canSeeSessionExpenses(req);
  const seesFees = hasPerm(req, 'sessions.read.fees');
  const today = todayISO();
  const todoSince = db.prepare(`SELECT date(?, '-${TODO_WINDOW_DAYS} days') AS d`).get(today).d;
  const rows = db
    .prepare(sql)
    .all(...params)
    .map(
      ({
        money_collected: collected,
        money_donations: donations,
        money_expenses: expenses,
        eval_count: evalCount,
        eval_avg: evalAvg,
        eval_form: evalForm,
        eval_participant: evalParticipant,
        eval_mine: evalMine,
        counted,
        unconfirmed,
        todo_eval: todoEval,
        todo_finances: todoFinances,
        ...r
      }) => {
        // ينتظر تقييمه: قائد شارك، و النشاط مضى، و لم يقيّم — فلا يرى معدّل غيره قبل أن يقيّم
        const pending = !!evalParticipant && !evalMine && r.date <= today;
        return stripFee(req, {
          ...r,
          counted: !!counted,
          unconfirmed: !!unconfirmed,
          // Ce qui reste à régulariser sur la séance (fenêtre de TODO_WINDOW_DAYS jours)
          todo:
            r.date >= todoSince
              ? [
                  unconfirmed && 'attendance',
                  todoEval && 'eval',
                  todoFinances && seesFees && 'finances',
                ].filter(Boolean)
              : [],
          matalib: JSON.parse(r.matalib || '[]'),
          branch_ids: parseIdList(r.branch_ids),
          group_ids: parseIdList(r.group_ids),
          money: seesMoney ? { collected, donations, expenses, result: collected + donations - expenses } : null,
          eval:
            evalForm || evalCount
              ? {
                  count: evalCount,
                  average:
                    (pending && req.user.role !== 'admin') || !hasPerm(req, 'evaluations.read') ? null : round2(evalAvg),
                  pending,
                }
              : null,
        });
      }
    );
  res.json(rows);
});

app.post('/api/sessions', requirePerm('sessions.create'), (req, res) => {
  const { title, date, branch_id, leader, leader_id, fee, matalib, helper_ids, member_ids } = req.body;
  const kind = ['visit', 'leaders', 'group'].includes(req.body.kind) ? req.body.kind : 'activity';
  // نشاط قادة و نشاط عام للفوج belong to the whole فوج; every other kind still needs a فرقة
  const branchless = kind === 'leaders' || kind === 'group';
  // نفس الحصّة قد تُعطى لفرقتين معًا: الطلب يرسل branch_ids، و branch_id القديم يبقى
  // مقبولًا. الأولى في القائمة هي الفرقة الرئيسية المخزّنة في sessions.branch_id.
  // نشاط القادة يقبلها أيضًا، اختياريةً: فرق مدعوّة يُضاف عناصرها إلى لائحته، و هو
  // يبقى للفوج (branch_id NULL) فلا يُحسب نشاطًا لتلك الفرق و لا يمسّ معدّلاتها.
  const rawBranchIds = Array.isArray(req.body.branch_ids)
    ? req.body.branch_ids
    : [branch_id].filter((v) => v !== undefined && v !== null && v !== '');
  const branchIds = kind === 'group' ? [] : [...new Set(rawBranchIds.map(Number))];
  const branchId = branchless ? null : (branchIds[0] ?? null);
  if (!title || !String(title).trim() || !validISODate(date))
    return res.status(400).json({ error: 'invalid title or date' });
  if (!branchless && !branchId) return res.status(400).json({ error: 'branch_id required' });
  if (!branchIds.every((b) => Number.isInteger(b) && b > 0))
    return res.status(400).json({ error: 'invalid branch_ids' });
  const activityType = req.body.activity_type || null;
  if (activityType !== null && !ACTIVITY_TYPES.includes(activityType))
    return res.status(400).json({ error: 'invalid activity_type' });
  if (kind === 'group' && !activityType)
    return res.status(400).json({ error: 'activity_type required' });
  const branchCounts = kind === 'group' ? parseBranchCounts(req.body.branch_counts) : [];
  if (branchCounts === null) return res.status(400).json({ error: 'invalid branch_counts' });
  const leadersCount =
    kind === 'group' && req.body.leaders_count !== undefined && req.body.leaders_count !== null && req.body.leaders_count !== ''
      ? Number(req.body.leaders_count)
      : null;
  if (leadersCount !== null && (!Number.isInteger(leadersCount) || leadersCount < 0))
    return res.status(400).json({ error: 'invalid leaders_count' });
  // كل فرقة يشملها النشاط تُفحص على حدة: لا يُنشئ قائد نشاطًا لفرقة ليست له
  for (const b of branchIds) {
    if (!branchOk(req, b)) return res.status(403).json({ error: 'forbidden' });
    if (!db.prepare('SELECT id FROM branches WHERE id = ?').get(b))
      return res.status(400).json({ error: 'invalid branch_id' });
  }
  // قسم النشاط: قسم فرقه، و كلها من قسم واحد — نشاط يجمع الفتيان و الفتيات لا يُرى
  // كاملًا من أي من القسمين. بلا فرق (نشاط قادة، نشاط عام): قسم المستخدم، أو القسم
  // الذي اختاره الأدمن في النموذج، أو الفتيان كما كان الفوج.
  if (req.body.section !== undefined && req.body.section !== null && !parseSection(req.body.section))
    return res.status(400).json({ error: 'invalid section' });
  const branchSections = [...new Set(branchIds.map(sectionOfBranch))];
  if (branchSections.length > 1) return res.status(400).json({ error: 'mixed_sections' });
  const section = branchSections[0] || activeSection(req) || parseSection(req.body.section) || 'M';
  if (branchCounts.some((c) => sectionOfBranch(c.branch_id) !== section))
    return res.status(400).json({ error: 'invalid branch_counts' });
  // مجموعات النشاط — نشاط فرقة فقط. الفرقة التي اختيرت لها مجموعة أو أكثر لا يشارك
  // منها إلا عناصرها؛ و التي لم تُختر لها مجموعة تشارك كاملةً. لا اختيار = كل الفرق كاملةً.
  const rawGroupIds = kind === 'activity' && Array.isArray(req.body.group_ids) ? req.body.group_ids : [];
  const groupIds = [...new Set(rawGroupIds.map(Number))];
  if (!groupIds.every((g) => Number.isInteger(g) && g > 0))
    return res.status(400).json({ error: 'invalid group_ids' });
  for (const g of groupIds) {
    const row = db.prepare('SELECT branch_id FROM branch_groups WHERE id = ?').get(g);
    // مجموعة من فرقة خارج النشاط لا معنى لها: لا عنصر منها يحضر أصلًا
    if (!row || !branchIds.includes(Number(row.branch_id)))
      return res.status(400).json({ error: 'invalid group_ids' });
  }
  const nums = matalib === undefined || matalib === null ? [] : matalib;
  if (!Array.isArray(nums) || !nums.every((n) => Number.isInteger(n) && n >= 1))
    return res.status(400).json({ error: 'invalid matalib' });
  const unique = [...new Set(nums)].sort((a, b) => a - b);
  for (const b of branchIds) {
    const total = db.prepare('SELECT total_requirements FROM branches WHERE id = ?').get(b)?.total_requirements;
    if (unique.some((n) => n > total)) return res.status(400).json({ error: 'invalid matalib' });
  }
  if (fee !== undefined && fee !== null && (typeof fee !== 'number' || fee < 0))
    return res.status(400).json({ error: 'invalid fee' });
  // قادة النشاط من قسمه وحده
  let leaderRow = null;
  if (leader_id !== undefined && leader_id !== null) {
    leaderRow = db
      .prepare("SELECT * FROM leaders WHERE id = ? AND status = 'active' AND section = ?")
      .get(leader_id, section);
    if (!leaderRow) return res.status(400).json({ error: 'invalid leader_id' });
  }
  const helpers = helper_ids === undefined || helper_ids === null ? [] : helper_ids;
  if (!Array.isArray(helpers) || !helpers.every((h) => Number.isInteger(h)))
    return res.status(400).json({ error: 'invalid helper_ids' });
  for (const h of helpers) {
    if (!db.prepare("SELECT id FROM leaders WHERE id = ? AND status = 'active' AND section = ?").get(h, section))
      return res.status(400).json({ error: 'invalid helper_ids' });
  }
  // زيارة الأهل: the visited عناصر are marked present straight away, so the visit
  // lands in their file (and in the قادة files) without a second attendance step
  const visited = member_ids === undefined || member_ids === null ? [] : member_ids;
  if (!Array.isArray(visited) || !visited.every((m) => Number.isInteger(m)))
    return res.status(400).json({ error: 'invalid member_ids' });
  const visitedRows = [];
  for (const m of visited) {
    const row = db.prepare("SELECT id, branch_id, group_id, status FROM members WHERE id = ?").get(m);
    if (!row || row.status !== 'active' || !branchIds.includes(Number(row.branch_id)) || !branchOk(req, row.branch_id))
      return res.status(400).json({ error: 'invalid member_ids' });
    visitedRows.push(row);
  }
  if (kind === 'visit' && visited.length === 0)
    return res.status(400).json({ error: 'member_ids required for a visit' });
  // بند الخطة الذي ينفّذه هذا النشاط — نشاط فرقة فقط، و من خطة إحدى فرقه
  const planItemId = kind === 'activity' ? optionalId(req.body.plan_item_id) : null;
  if (planItemId !== null) {
    const item = db.prepare('SELECT branch_id FROM annual_plan WHERE id = ?').get(planItemId);
    if (!item || !branchIds.includes(Number(item.branch_id)))
      return res.status(400).json({ error: 'invalid plan_item_id' });
  }
  // بطاقة التحضير التي كُتبت لهذا النشاط: تُربط مع الإنشاء في المعاملة نفسها،
  // فلا نشاط بلا بطاقته حين يُنشأ من صفحتها. البطاقة من فرق النشاط وحدها.
  const prepCardId = kind === 'activity' ? optionalId(req.body.prep_card_id) : null;
  if (prepCardId !== null) {
    const card = db.prepare('SELECT id, branch_id FROM prep_cards WHERE id = ?').get(prepCardId);
    if (!card || !branchIds.includes(Number(card.branch_id)))
      return res.status(400).json({ error: 'invalid prep_card_id' });
    if (!branchOk(req, card.branch_id)) return res.status(403).json({ error: 'forbidden' });
  }
  // ضيوف نشاط القادة: أسماء حرّة لمن ليس في البرنامج
  const guestNames = kind === 'leaders' ? parseGuestNames(req.body.guest_names) : [];
  if (guestNames === null) return res.status(400).json({ error: 'invalid guest_names' });
  // `leader` keeps a plain-text name snapshot so old data and linked leaders display the same way
  const leaderName = leaderRow ? `${leaderRow.first_name} ${leaderRow.last_name}` : leader || null;
  const insertAnimator = db.prepare(
    'INSERT OR IGNORE INTO session_leaders (session_id, leader_id, role) VALUES (?, ?, ?)'
  );
  const insertVisited = db.prepare(
    `INSERT INTO attendance (session_id, member_id, status, branch_id, group_id)
     VALUES (?, ?, 'present', ?, ?)
     ON CONFLICT(session_id, member_id) DO UPDATE SET
       status = 'present', branch_id = excluded.branch_id, group_id = excluded.group_id`
  );
  let sessionId;
  db.transaction(() => {
    sessionId = db
      .prepare(
        `INSERT INTO sessions
          (title, date, branch_id, leader, leader_id, fee, matalib, start_time, place, activity_type, leaders_count, kind,
           plan_item_id, section, created_at, created_by, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`
      )
      .run(
        String(title).trim(),
        date,
        branchId,
        leaderName,
        leaderRow ? leaderRow.id : null,
        fee ?? null,
        JSON.stringify(kind === 'activity' ? unique : []),
        req.body.start_time || null,
        req.body.place || null,
        activityType,
        leadersCount,
        kind,
        planItemId,
        section,
        actorName(req),
        req.user.id
      )
      .lastInsertRowid;
    if (leaderRow) insertAnimator.run(sessionId, leaderRow.id, 'main');
    for (const h of helpers) {
      if (leaderRow && h === leaderRow.id) continue;
      insertAnimator.run(sessionId, h, 'helper');
    }
    for (const m of visitedRows) insertVisited.run(sessionId, m.id, m.branch_id, m.group_id);
    // فرق النشاط — الرئيسية منها مكرّرة في sessions.branch_id، و الجدول هو المرجع
    for (const b of branchIds)
      db.prepare('INSERT OR IGNORE INTO session_branches (session_id, branch_id) VALUES (?, ?)')
        .run(sessionId, b);
    for (const g of groupIds)
      db.prepare('INSERT OR IGNORE INTO session_groups (session_id, group_id) VALUES (?, ?)')
        .run(sessionId, g);
    // كل عناصر النشاط غائبون افتراضيًا: القائد يقلب الحاضرين وحدهم. المعدّلات لا
    // تحسب إلا الأنشطة التي حلّ تاريخها، فنشاطٌ مقبل لا يضرّ أحدًا. (After the group inserts —
    // the group-scope SQL reads session_groups for this very session.)
    // نشاط القادة يبني لائحة فرقه المدعوّة بالطريقة نفسها؛ بلا فرق مدعوّة لا لائحة.
    if (kind === 'activity' || (kind === 'leaders' && branchIds.length > 0)) {
      const rosterBranches = branchIds.map(intOr).join(',') || -1;
      db.prepare(
        `INSERT OR IGNORE INTO attendance (session_id, member_id, status, branch_id, group_id)
         SELECT ?, m.id, 'absent', m.branch_id, m.group_id FROM members m
         WHERE m.branch_id IN (${rosterBranches}) AND m.status = 'active'
           AND ${memberInSessionGroupsSQL(sessionId, 'm')}`
      ).run(sessionId);
    }
    if (planItemId !== null) {
      // البند يحقّقه نشاط واحد: إسناده لنشاط جديد يفكّ ربطه بسابقه
      const previous = db
        .prepare('SELECT session_id FROM session_plan_items WHERE plan_item_id = ?')
        .all(planItemId)
        .map((r) => r.session_id);
      db.prepare('DELETE FROM session_plan_items WHERE plan_item_id = ?').run(planItemId);
      db.prepare('INSERT INTO session_plan_items (session_id, plan_item_id) VALUES (?, ?)')
        .run(sessionId, planItemId);
      // البند قد يكون من خطة فرقة غير الرئيسية، فالعمود يُعاد حسابه لا يُفترض
      for (const sid of new Set([...previous, sessionId])) syncPrimaryPlanItem(sid);
    }
    // عدد الحضور لكل فرقة — kept out of the attendance table on purpose: these are
    // counts, and mixing them with named présence would corrupt every rate.
    for (const c of branchCounts)
      db.prepare('INSERT INTO session_branch_counts (session_id, branch_id, count) VALUES (?, ?, ?)')
        .run(sessionId, c.branch_id, c.count);
    if (prepCardId !== null)
      db.prepare("UPDATE prep_cards SET session_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(sessionId, prepCardId);
    for (const name of guestNames) insertGuest.run(sessionId, name, req.user.display_name || req.user.username);
  })();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  auditEvent(req, 'create', 'session', sessionId, null, {
    ...row,
    branch_ids: branchIdsOfSession(sessionId),
    group_ids: groupIdsOfSession(sessionId),
  });
  notifyAdmins(req, 'session_create', row);
  notifications.sessionCreated(req, row);
  res.status(201).json({
    ...row,
    matalib: JSON.parse(row.matalib),
    branch_ids: branchIdsOfSession(sessionId),
    group_ids: groupIdsOfSession(sessionId),
  });
});

// تعديل نشاط بعد إنشائه: تفاصيله وحدها — العنوان، اليوم و الساعة، المكان، الطبيعة،
// الأجرة، القائد المسؤول، المطالب، عدد القادة. نوعه و فرقه و مجموعاته تبقى كما هي:
// منها بُنيت لائحة الحضور، و تغييرها يمحو حضورًا مسجّلًا أو يخلط فرقًا لم تُدعَ.
app.put('/api/sessions/:id', requirePerm('sessions.edit'), (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(intOr(req.params.id));
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!sessionOk(req, s)) return res.status(403).json({ error: 'forbidden' });
  // نشاط مشترك يعدّله من يملك فرقه كلها، كما يُنشأ
  const branchIds = branchIdsOfSession(s.id);
  if (!branchIds.every((b) => branchOk(req, b))) return res.status(403).json({ error: 'forbidden' });
  const b = req.body || {};
  const title = optionalText(b.title, 200);
  if (!title || !validISODate(b.date)) return res.status(400).json({ error: 'invalid title or date' });
  const startTime = b.start_time === undefined || b.start_time === null || b.start_time === '' ? null : String(b.start_time).slice(0, 5);
  if (startTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return res.status(400).json({ error: 'invalid start_time' });
  const place = optionalText(b.place, 200);
  if (place === undefined) return res.status(400).json({ error: 'text too long' });
  const activityType = s.kind === 'visit' ? s.activity_type : b.activity_type || null;
  if (activityType !== null && !ACTIVITY_TYPES.includes(activityType))
    return res.status(400).json({ error: 'invalid activity_type' });
  if (s.kind === 'group' && !activityType) return res.status(400).json({ error: 'activity_type required' });
  // الأجرة مال: من لا يرى المبالغ لا يكتبها، و تعديله للنشاط لا يمحوها
  let fee = s.fee;
  if (hasPerm(req, 'sessions.read.fees') && 'fee' in b && s.kind !== 'visit' && s.kind !== 'group') {
    if (b.fee !== null && b.fee !== '' && (typeof b.fee !== 'number' || !Number.isFinite(b.fee) || b.fee < 0))
      return res.status(400).json({ error: 'invalid fee' });
    fee = b.fee === '' ? null : b.fee;
  }
  // القائد المسؤول من قسم النشاط؛ قائد أُرشف يبقى على نشاطه القديم
  let leaderRow = null;
  if (b.leader_id !== undefined && b.leader_id !== null && b.leader_id !== '') {
    leaderRow = db.prepare('SELECT * FROM leaders WHERE id = ? AND section = ?').get(intOr(b.leader_id), s.section);
    if (!leaderRow || (leaderRow.status !== 'active' && leaderRow.id !== s.leader_id))
      return res.status(400).json({ error: 'invalid leader_id' });
  }
  // المطالب لنشاط الفرقة وحده، و في حدود كل فرقة يشملها
  let matalib = JSON.parse(s.matalib || '[]');
  if (s.kind === 'activity' && b.matalib !== undefined) {
    const nums = b.matalib === null ? [] : b.matalib;
    if (!Array.isArray(nums) || !nums.every((n) => Number.isInteger(n) && n >= 1))
      return res.status(400).json({ error: 'invalid matalib' });
    matalib = [...new Set(nums)].sort((x, y) => x - y);
    for (const bid of branchIds) {
      const total = db.prepare('SELECT total_requirements FROM branches WHERE id = ?').get(bid)?.total_requirements;
      if (matalib.some((n) => n > total)) return res.status(400).json({ error: 'invalid matalib' });
    }
  }
  let leadersCount = s.leaders_count;
  if (s.kind === 'group' && b.leaders_count !== undefined) {
    leadersCount = b.leaders_count === null || b.leaders_count === '' ? null : Number(b.leaders_count);
    if (leadersCount !== null && (!Number.isInteger(leadersCount) || leadersCount < 0))
      return res.status(400).json({ error: 'invalid leaders_count' });
  }
  // `leader` keeps the plain-text snapshot, as at creation
  const leaderName = leaderRow ? `${leaderRow.first_name} ${leaderRow.last_name}` : leaderRow === null && s.leader_id ? null : s.leader;
  db.transaction(() => {
    db.prepare(
      `UPDATE sessions SET title = ?, date = ?, start_time = ?, place = ?, activity_type = ?, fee = ?,
         leader = ?, leader_id = ?, matalib = ?, leaders_count = ? WHERE id = ?`
    ).run(title, b.date, startTime, place, activityType, fee, leaderName, leaderRow ? leaderRow.id : null,
      JSON.stringify(matalib), leadersCount, s.id);
    // القائد المسؤول هو صفّ «main» بين قادة النشاط: السابق يخرج، و الجديد يُرفَّع — و إن كان
    // مساعدًا قبلًا يبقى حضوره المسجَّل
    if ((leaderRow?.id ?? null) !== s.leader_id) {
      db.prepare("DELETE FROM session_leaders WHERE session_id = ? AND role = 'main'").run(s.id);
      if (leaderRow)
        db.prepare(
          `INSERT INTO session_leaders (session_id, leader_id, role) VALUES (?, ?, 'main')
           ON CONFLICT(session_id, leader_id) DO UPDATE SET role = 'main'`
        ).run(s.id, leaderRow.id);
    }
  })();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(s.id);
  auditEvent(req, 'update', 'session', s.id, s, row);
  notifications.sessionChanged(req, s, row);
  res.json(stripFee(req, { ...row, matalib: JSON.parse(row.matalib), branch_ids: branchIds, group_ids: groupIdsOfSession(s.id) }));
});

// حذف نشاط — أدمن فقط. الحضور و المنشّطون و روابط الخطة تسقط معه (ON DELETE
// CASCADE)، و إشعاراته تحتفظ بعنوانه المنسوخ (SET NULL) فلا تنكسر.
app.delete('/api/sessions/:id', requirePerm('sessions.delete'), (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  // Granted to a قائد, it reaches the أنشطة of his فرق only
  if (!sessionOk(req, s)) return res.status(403).json({ error: 'forbidden' });
  const branchIds = branchIdsOfSession(s.id);
  // Its قادة, read before their rows go with it: a نشاط still ahead is cancelled for them
  const leaderIds = db.prepare('SELECT leader_id FROM session_leaders WHERE session_id = ?').all(s.id).map((r) => r.leader_id);
  db.transaction(() => {
    // بطاقة التحضير تبقى بعد نشاطها، مفكوكة الربط فقط. يدويًا كي لا يُعتمد على
    // ON DELETE SET NULL في عمود قد يكون أُضيف بـ ALTER.
    db.prepare('UPDATE prep_cards SET session_id = NULL WHERE session_id = ?').run(s.id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
  })();
  // Its history outlives it (no FK on audit_events.session_id): this is its last line
  auditEvent(req, 'delete', 'session', s.id, { ...s, branch_ids: branchIds }, null);
  notifications.sessionCancelled(req, s, branchIds, leaderIds);
  // صوره و ملفاته سقطت من الجدول مع النشاط: تبقى أن تُمحى من القرص
  fs.rm(ownerFilesDir('session', s.id), { recursive: true, force: true }, () => {});
  res.json({ ok: true });
});

app.get('/api/sessions/:id', requirePerm('sessions.read'), (req, res) => {
  const s = db
    .prepare(
      `SELECT s.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        COALESCE(${fullNameSQL('l')}, s.leader) AS leader
       FROM sessions s LEFT JOIN branches b ON b.id = s.branch_id
       LEFT JOIN leaders l ON l.id = s.leader_id
       WHERE s.id = ?`
    )
    .get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!sessionOk(req, s)) return res.status(403).json({ error: 'forbidden' });
  const branchIds = branchIdsOfSession(s.id);
  // النشاط المشترك يعرض فرق المستخدم وحدها: قائد فرقة لا يرى — و لا يضع — حضور غيرها
  const myBranchIds = myBranchesOfSession(req, s.id);
  const rosterList = myBranchIds.map(intOr).join(',') || -1;
  // A نشاط lists the whole فرقة to be marked; a زيارة الأهل concerns only the
  // عناصر actually visited, so the rest of the فرقة has no row here. A نشاط قادة
  // lists the عناصر of its invited فرق only (none invited = no rows), and a نشاط
  // عام للفوج has no عناصر roster at all.
  // النشاط المحصور بمجموعات لا يعرض إلا عناصرها: الفرقة كبيرة و الحصّة لا تسعها،
  // فالقائد يضع حضور مجموعته وحدها بدل التنقيب عن أسمائها في قائمة الفرقة كلها.
  const roster = s.kind === 'group' ? [] : db
    .prepare(
      `SELECT m.id, m.first_name, m.father_name, m.last_name, m.photo,
              COALESCE(a.branch_id, m.branch_id) AS branch_id,
              a.group_id, g.name AS group_name, NULLIF(a.status, 'unmarked') AS status,
              a.paid, a.reason
       FROM attendance a JOIN members m ON m.id = a.member_id
       LEFT JOIN branch_groups g ON g.id = a.group_id
       WHERE a.session_id = ? AND COALESCE(a.branch_id, m.branch_id) IN (${rosterList})
       ORDER BY COALESCE(a.branch_id, m.branch_id), m.last_name, m.first_name`
    )
    .all(s.id)
    .map((m) => ({
      ...m,
      // الغيابات المتتالية تُحسب من آخر ترقية: سجلّ الفرقة السابقة لا يلاحق العنصر
      consecutive_absences: attendanceStats(m.id, null, {
        from:
          db
            .prepare('SELECT MAX(effective_date) AS d FROM member_branch_history WHERE member_id = ?')
            .get(m.id).d || null,
        // borné à la date de la séance : sur une séance ancienne, la série d'alors
        until: s.date,
      }).consecutive_absences,
    }));
  // نشاط قادة: حضوره هو القادة أنفسهم، فاللائحة كل قائد نشيط من قسم النشاط — لا
  // المنشّطون المضافون يدًا وحدهم. قائد غير نشيط سُجّل حضوره من قبل يبقى ظاهرًا.
  const animators =
    s.kind === 'leaders'
      ? db
          .prepare(
            `SELECT l.id AS leader_id, sl.role, sl.status, l.first_name, l.father_name, l.last_name, l.photo
             FROM leaders l LEFT JOIN session_leaders sl ON sl.leader_id = l.id AND sl.session_id = ?
             WHERE l.section = ? AND (l.status = 'active' OR sl.status IS NOT NULL)
             ORDER BY sl.role = 'main' DESC, l.last_name, l.first_name`
          )
          .all(s.id, s.section)
      : db
          .prepare(
            `SELECT sl.leader_id, sl.role, sl.status, l.first_name, l.father_name, l.last_name, l.photo
             FROM session_leaders sl JOIN leaders l ON l.id = sl.leader_id
             WHERE sl.session_id = ?
             ORDER BY sl.role = 'helper', l.last_name, l.first_name`
          )
          .all(s.id);
  // الاشتراك الشهري لكل عنصر في اللائحة، لمن يراه: شهر النشاط، و ما تأخّر قبله
  const withDues = canSeeMemberDues(req) && roster.length > 0;
  // الأجرة و مبالغ الاشتراكات تسقط معًا عمّن لا يملك صلاحية رؤية المبالغ
  const payload = stripFee(req, {
    ...s,
    matalib: JSON.parse(s.matalib || '[]'),
    roster: withDues ? rosterDues(roster, s) : roster,
    animators,
    // حصيلة اشتراكات النشاط كاملًا — يحسبها البرنامج من الخانات، لا تُدخَل يدويًا
    subscriptions: sessionSubscriptions(s.id),
    member_dues: withDues
      ? { monthly: rateFor('member', s.date.slice(0, 7)), month: s.date.slice(0, 7), can_edit: canWriteMemberDues(req) }
      : null,
    // ما اشتُري للنشاط من الصندوق، و التبرعات التي وصلت فيه — لمن يرى مبالغ الأنشطة أو الصندوق
    expenses: canSeeSessionExpenses(req) ? sessionEntriesOf(s.id, 'out') : null,
    donations: canSeeSessionExpenses(req) ? sessionEntriesOf(s.id, 'in') : null,
    can_write_expenses: canWriteSessionExpenses(req),
    branch_counts: branchCountsOf(s.id),
    branch_ids: branchIds,
    // ضيوف نشاط القادة — أسماء حرّة من خارج البرنامج
    guests: guestsOf(s.id),
    // صور النشاط و ملفاته
    files: filesOf('session', s.id),
    // آخر من غيّر في النشاط، لرأس صفحته — و من أنشأه في created_by. السجلّ كاملًا في تبويبه
    last_change: lastChangeOf(req, s),
    // التقييم: عدد المقيِّمين و معدّلهم، و هل ينتظر تقييم صاحب الحساب — التفاصيل في تبويبه
    evaluation: evalSummaryOf(req, s),
    // بطاقات التحضير المربوطة بهذا النشاط — القائد يفتحها من صفحة نشاطها، إن كان يقرأ البطاقات
    prep_cards: hasPerm(req, 'prep.read')
      ? db.prepare('SELECT id, title, date FROM prep_cards WHERE session_id = ? ORDER BY id').all(s.id)
      : [],
    // الفرق التي يحقّ للمستخدم وضع حضورها في هذا النشاط
    my_branch_ids: myBranchIds,
    // La série d'absences qui met un عنصر en suivi (A2), pour le badge du pointage et du PDF
    absence_threshold: absenceThreshold(),
    // Validation de la présence (A1) : compte-t-elle, est-elle «non confirmée», et qui
    // peut la valider / la rouvrir (toutes les فرق de la séance, comme sa création)
    counted: !!db.prepare(`SELECT ${countedSessionSQL('s')} AS c FROM sessions s WHERE s.id = ?`).get(s.id).c,
    unconfirmed: !!db.prepare(`SELECT ${unconfirmedSessionSQL('s')} AS c FROM sessions s WHERE s.id = ?`).get(s.id).c,
    can_finalize:
      ['activity', 'leaders'].includes(s.kind) &&
      hasPerm(req, 'sessions.attendance') &&
      branchIds.every((b) => branchOk(req, b)),
    can_reopen:
      ['activity', 'leaders'].includes(s.kind) && hasPerm(req, 'sessions.edit') && branchIds.every((b) => branchOk(req, b)),
    // مجموعات النشاط بأسمائها — فارغة تعني أن كل فرقه تشارك كاملةً
    groups: db
      .prepare(
        `SELECT g.id, g.branch_id, g.name FROM session_groups sg
         JOIN branch_groups g ON g.id = sg.group_id
         WHERE sg.session_id = ? ORDER BY g.branch_id, g.sort_order, g.id`
      )
      .all(s.id),
    group_ids: groupIdsOfSession(s.id),
  });
  const out = stripRosterFees(req, payload);
  // مالية النشاط كاملًا: ما سُجّل فيه على أسطر لا يراها المستخدم — فرق أخرى من نشاط
  // مشترك، أو مبالغ محجوبة عنه — فتضيف الواجهة إليه ما تراه و تحسب الحصيلة حيّةً
  if (canSeeSessionExpenses(req)) {
    const seen = (f) => out.roster.reduce((n, m) => n + f(m), 0);
    const dues = db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM member_dues WHERE session_id = ?').get(s.id).n;
    // ما بقي على الحاضرين من أجرة النشاط، ليُعرف ما ستكون نتيجته إن دفعوا
    const outstanding = s.fee > 0
      ? db
          .prepare(
            `SELECT COALESCE(SUM(MAX(0, ? - COALESCE(paid, 0))), 0) AS n FROM attendance
             WHERE session_id = ? AND status = 'present'`
          )
          .get(s.fee, s.id).n
      : 0;
    out.money_elsewhere = {
      collected: sessionSubscriptions(s.id).collected - seen((m) => m.paid || 0),
      dues: dues - seen((m) => (m.dues?.here || []).reduce((a, h) => a + h.amount, 0)),
      outstanding:
        outstanding - (out.fee > 0 ? seen((m) => (m.status === 'present' ? Math.max(0, out.fee - (m.paid || 0)) : 0)) : 0),
    };
  }
  res.json(out);
});

// عدد الحضور لكل فرقة و عدد القادة في نشاط عام للفوج — corrected after the fact,
// the same way présence is marked on the other kinds of نشاط.
app.post('/api/sessions/:id/counts', requirePerm('sessions.attendance'), (req, res) => {
  const s = db
    .prepare('SELECT id, title, branch_id, kind, section, leaders_count FROM sessions WHERE id = ?')
    .get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!sessionOk(req, s)) return res.status(403).json({ error: 'forbidden' });
  if (s.kind !== 'group') return res.status(400).json({ error: 'not_a_group_activity' });
  const counts = parseBranchCounts(req.body?.branch_counts);
  // الأعداد لفرق قسم النشاط وحدها
  if (counts === null || counts.some((c) => sectionOfBranch(c.branch_id) !== s.section))
    return res.status(400).json({ error: 'invalid branch_counts' });
  const raw = req.body?.leaders_count;
  const leadersCount = raw === undefined || raw === null || raw === '' ? null : Number(raw);
  if (leadersCount !== null && (!Number.isInteger(leadersCount) || leadersCount < 0))
    return res.status(400).json({ error: 'invalid leaders_count' });
  const snapshot = (leaders) => ({
    branch_counts: branchCountsOf(s.id).map((c) => ({ branch_id: c.branch_id, count: c.count })),
    leaders_count: leaders ?? null,
  });
  const before = snapshot(s.leaders_count);
  db.transaction(() => {
    saveBranchCounts(s.id, counts);
    db.prepare('UPDATE sessions SET leaders_count = ? WHERE id = ?').run(leadersCount, s.id);
  })();
  auditEvent(req, 'counts', 'session', s.id, before, snapshot(leadersCount));
  notifyAdmins(req, 'counts', s);
  res.json({ branch_counts: branchCountsOf(s.id), leaders_count: leadersCount });
});

// Add / remove helpers and mark animator présence on a session
app.post('/api/sessions/:id/animators', requirePerm('sessions.attendance'), (req, res) => {
  const s = db
    .prepare('SELECT id, title, branch_id, kind, section, attendance_finalized_at FROM sessions WHERE id = ?')
    .get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!sessionOk(req, s)) return res.status(403).json({ error: 'forbidden' });
  const { leader_id, status, remove } = req.body;
  // Présence validée : celle des قادة d'un نشاط قادة est figée jusqu'à réouverture
  if (s.kind === 'leaders' && s.attendance_finalized_at && 'status' in (req.body || {}))
    return res.status(409).json({ error: 'attendance_finalized' });
  // منشّطو النشاط من قسمه وحده
  if (!db.prepare('SELECT id FROM leaders WHERE id = ? AND section = ?').get(leader_id, s.section))
    return res.status(400).json({ error: 'invalid leader_id' });
  const animatorRow = db.prepare(
    'SELECT leader_id, role, status FROM session_leaders WHERE session_id = ? AND leader_id = ?'
  );
  const prev = animatorRow.get(s.id, leader_id) || null;
  if (remove) {
    const r = db
      .prepare("DELETE FROM session_leaders WHERE session_id = ? AND leader_id = ? AND role = 'helper'")
      .run(s.id, leader_id);
    if (r.changes) auditEvent(req, 'animator', 'session', s.id, prev, null);
    notifyAdmins(req, 'animators', s);
    return res.json({ ok: true });
  }
  if (status !== null && status !== undefined && !['present', 'absent'].includes(status))
    return res.status(400).json({ error: 'invalid status' });
  // Marking an animator's présence goes through here too: only a new name is news to him
  const added = !prev;
  db.prepare(
    `INSERT INTO session_leaders (session_id, leader_id, role, status) VALUES (?, ?, 'helper', ?)
     ON CONFLICT(session_id, leader_id) DO UPDATE SET status = excluded.status`
  ).run(s.id, leader_id, status ?? null);
  if (added || (prev.status ?? null) !== (status ?? null))
    auditEvent(req, 'animator', 'session', s.id, prev, animatorRow.get(s.id, leader_id));
  notifyAdmins(req, 'animators', s);
  if (added) notifications.animatorAdded(req, s.id, leader_id);
  res.json({ ok: true });
});

// ضيوف نشاط القادة: يُضافون و يُحذفون بعد الإنشاء أيضًا — الضيف يُعرف غالبًا يوم النشاط
app.post('/api/sessions/:id/guests', requirePerm('sessions.attendance'), (req, res) => {
  const s = db.prepare('SELECT id, title, branch_id, kind FROM sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!sessionOk(req, s)) return res.status(403).json({ error: 'forbidden' });
  if (s.kind !== 'leaders') return res.status(400).json({ error: 'not_a_leaders_activity' });
  const name = parseGuestName(req.body?.name);
  if (name === null) return res.status(400).json({ error: 'invalid name' });
  const guestId = insertGuest.run(s.id, name, req.user.display_name || req.user.username).lastInsertRowid;
  auditEvent(req, 'guest', 'session', s.id, null, { id: guestId, name });
  notifyAdmins(req, 'animators', s);
  res.status(201).json({ guests: guestsOf(s.id) });
});

app.delete('/api/sessions/:id/guests/:guestId', requirePerm('sessions.attendance'), (req, res) => {
  const s = db.prepare('SELECT id, title, branch_id, kind FROM sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!sessionOk(req, s)) return res.status(403).json({ error: 'forbidden' });
  const guest = db
    .prepare('SELECT id, name FROM session_guests WHERE id = ? AND session_id = ?')
    .get(intOr(req.params.guestId), s.id);
  if (!guest) return res.status(404).json({ error: 'guest not found' });
  db.prepare('DELETE FROM session_guests WHERE id = ?').run(guest.id);
  auditEvent(req, 'guest', 'session', s.id, guest, null);
  notifyAdmins(req, 'animators', s);
  res.json({ guests: guestsOf(s.id) });
});

// ---------- الصور و الملفات: للنشاط و للمخيم / التكوين ----------
// الملف على القرص، لا في قاعدة البيانات: الصور ثقيلة و القاعدة تُنسخ كاملة في كل
// نسخة احتياطية. UPLOADS_DIR يضعها خارج المستودع إن شئت، و إلا server/uploads.
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
// nginx du VPS plafonne le corps à 12 Mo (client_max_body_size): on reste dessous
const FILE_MAX = 11 * 1024 * 1024;
const THUMB_MAX = 512 * 1024;
const FILES_PER_OWNER = 200;

// صاحب الملفات: جدولها، عمود الربط، و مجلّدها تحت UPLOADS_DIR
const FILE_OWNERS = {
  // read: who sees them, write: who adds and removes them
  session: { table: 'session_files', fk: 'session_id', dir: 'sessions', read: 'sessions.read', write: 'sessions.files' },
  event: { table: 'event_files', fk: 'event_id', dir: 'events', read: 'events.read', write: 'events.attendance' },
};
const ownerFilesDir = (owner, id) => path.join(UPLOADS_DIR, FILE_OWNERS[owner].dir, String(Number(id)));

// النوع من البايتات الأولى لا من الاسم و لا من ترويسة المتصفّح: ما يُخدم لاحقًا
// بهذا النوع هو ما كان فعلًا كذلك
function sniffUpload(buf, name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  const at = (i, bytes) => bytes.every((b, k) => buf[i + k] === b);
  if (at(0, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg', ext: '.jpg' };
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return { kind: 'image', mime: 'image/png', ext: '.png' };
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]))
    return { kind: 'image', mime: 'image/webp', ext: '.webp' };
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return { kind: 'image', mime: 'image/gif', ext: '.gif' };
  if (at(0, [0x25, 0x50, 0x44, 0x46])) return { kind: 'pdf', mime: 'application/pdf', ext: '.pdf' };
  // xlsx zip و xls حاوية OLE: الامتداد يفصل بينهما و بين docx و doc
  if (at(0, [0x50, 0x4b, 0x03, 0x04]) && (ext === '.xlsx' || ext === '.xlsm'))
    return { kind: 'excel', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext };
  if (at(0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) && ext === '.xls')
    return { kind: 'excel', mime: 'application/vnd.ms-excel', ext };
  return null;
}

function filesOf(owner, id) {
  const { table, fk } = FILE_OWNERS[owner];
  return db
    .prepare(
      `SELECT id, kind, original_name, mime, size, created_by, created_at, thumb_name IS NOT NULL AS has_thumb
       FROM ${table} WHERE ${fk} = ? ORDER BY id`
    )
    .all(id)
    .map((f) => ({ ...f, has_thumb: !!f.has_thumb }));
}

function loadSessionForFiles(req, res) {
  const s = db.prepare('SELECT id, title, branch_id, kind, section FROM sessions WHERE id = ?').get(intOr(req.params.id));
  if (!s) {
    res.status(404).json({ error: 'session not found' });
    return null;
  }
  if (!sessionOk(req, s)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return s;
}

/**
 * POST <base>/files, GET|DELETE <base>/files/:fid pour un propriétaire. `load` rend
 * sa ligne après contrôle de portée (ou null, la réponse 404/403 déjà envoyée).
 * Lire suit le droit de lecture de la page ; ajouter et retirer, celui de l'appel.
 */
function fileRoutes(owner, base, load) {
  const { table, fk, read, write } = FILE_OWNERS[owner];
  const findFile = (req, id) =>
    db.prepare(`SELECT * FROM ${table} WHERE id = ? AND ${fk} = ?`).get(intOr(req.params.fid), id);

  // الجسم خام: [مصغّر JPEG بطول X-Thumb-Length][الملف]. إرسال واحد، بلا multipart و لا
  // base64 الذي يزيد صور الهاتف ثلثًا
  app.post(
    `${base}/files`,
    requirePerm(write),
    express.raw({ type: () => true, limit: FILE_MAX + THUMB_MAX }),
    (req, res) => {
      const row = load(req, res);
      if (!row) return;
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      let name = '';
      try {
        name = decodeURIComponent(String(req.get('X-File-Name') || ''));
      } catch {
        /* اسم مشوَّه: يُرفض أدناه */
      }
      name = name.replace(/[\\/\x00-\x1f]/g, '_').trim().slice(0, 200);
      if (!name) return res.status(400).json({ error: 'invalid name' });
      const thumbLen = Number(req.get('X-Thumb-Length') || 0);
      if (!Number.isInteger(thumbLen) || thumbLen < 0 || thumbLen > THUMB_MAX || thumbLen >= body.length)
        return res.status(400).json({ error: 'invalid thumb' });
      const file = body.subarray(thumbLen);
      const thumb = thumbLen ? body.subarray(0, thumbLen) : null;
      if (file.length > FILE_MAX) return res.status(413).json({ error: 'file_too_large' });
      const type = sniffUpload(file, name);
      if (!type) return res.status(415).json({ error: 'unsupported_file' });
      if (thumb && (type.kind !== 'image' || sniffUpload(thumb, 't.jpg')?.mime !== 'image/jpeg'))
        return res.status(400).json({ error: 'invalid thumb' });
      const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${fk} = ?`).get(row.id).n;
      if (count >= FILES_PER_OWNER) return res.status(409).json({ error: 'too_many_files' });

      const dir = ownerFilesDir(owner, row.id);
      const stem = crypto.randomBytes(12).toString('hex');
      const storedName = stem + type.ext;
      const thumbName = thumb ? `${stem}.thumb.jpg` : null;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, storedName), file);
        if (thumb) fs.writeFileSync(path.join(dir, thumbName), thumb);
      } catch (err) {
        console.error(`${owner} file write failed`, err);
        return res.status(500).json({ error: 'write_failed' });
      }
      const fileId = db
        .prepare(
          `INSERT INTO ${table} (${fk}, kind, original_name, mime, size, stored_name, thumb_name, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(row.id, type.kind, name, type.mime, file.length, storedName, thumbName, req.user.display_name || req.user.username)
        .lastInsertRowid;
      auditEvent(req, 'add_file', owner, row.id, null, { file_id: fileId, name, kind: type.kind, size: file.length });
      res.status(201).json({ files: filesOf(owner, row.id) });
    }
  );

  // ?thumb=1: مصغّر الصورة — ?download=1: تنزيل بدل العرض
  app.get(`${base}/files/:fid`, requirePerm(read), (req, res) => {
    const row = load(req, res);
    if (!row) return;
    const f = findFile(req, row.id);
    if (!f) return res.status(404).json({ error: 'file not found' });
    const wantThumb = req.query.thumb === '1' && f.thumb_name;
    const filePath = path.join(ownerFilesDir(owner, row.id), wantThumb ? f.thumb_name : f.stored_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', wantThumb ? 'image/jpeg' : f.mime);
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(filePath);
  });

  app.delete(`${base}/files/:fid`, requirePerm(write), (req, res) => {
    const row = load(req, res);
    if (!row) return;
    const f = findFile(req, row.id);
    if (!f) return res.status(404).json({ error: 'file not found' });
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(f.id);
    auditEvent(req, 'remove_file', owner, row.id, { file_id: f.id, name: f.original_name, kind: f.kind, size: f.size }, null);
    for (const n of [f.stored_name, f.thumb_name].filter(Boolean))
      fs.rm(path.join(ownerFilesDir(owner, row.id), n), { force: true }, () => {});
    res.json({ files: filesOf(owner, row.id) });
  });
}

fileRoutes('session', '/api/sessions/:id', loadSessionForFiles);

app.post('/api/sessions/:id/attendance', requirePerm('sessions.attendance'), (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!sessionOk(req, s)) return res.status(403).json({ error: 'forbidden' });
  const records = req.body.records || [req.body];
  // الحضور يُكتب فرقةً فرقة: قائد الفرقة (أو مساعده) يضع حضور عناصره وحدهم، فلا
  // يملأ شخص واحد حضور كل الفرق في نشاط مشترك. الأدمن غير مقيّد.
  const writable = new Set(myBranchesOfSession(req, s.id));
  // المال صلاحية قائمة بذاتها: من لا يرى المبالغ لا يسجّل دفعًا
  const canSeeFees = hasPerm(req, 'sessions.read.fees');
  const memberBranch = db.prepare('SELECT branch_id, group_id FROM members WHERE id = ?');
  const upsertStatus = db.prepare(
    `INSERT INTO attendance (session_id, member_id, status) VALUES (?, ?, ?)
     ON CONFLICT(session_id, member_id) DO UPDATE SET status = excluded.status`
  );
  // الاشتراك يُكتب وحده: العنصر قد يدفع قبل أن يُنقَّط حضوره، و تصحيح المبلغ بعدها
  // لا يجوز أن يقلب حالته. NULL = لم يدفع.
  const upsertPaid = db.prepare(
    `INSERT INTO attendance (session_id, member_id, paid) VALUES (?, ?, ?)
     ON CONFLICT(session_id, member_id) DO UPDATE SET paid = excluded.paid`
  );
  // For the history: each عنصر whose status or payment really changed, as it was and as it
  // is — with the فرقة he counts in here, which decides who may read the line
  const attendanceRow = db.prepare('SELECT status, paid, reason, branch_id FROM attendance WHERE session_id = ? AND member_id = ?');
  const upsertReason = db.prepare(
    `INSERT INTO attendance (session_id, member_id, reason) VALUES (?, ?, ?)
     ON CONFLICT(session_id, member_id) DO UPDATE SET reason = excluded.reason`
  );
  const was = [];
  const now = [];
  const run = db.transaction(() => {
    for (const r of records) {
      const withStatus = r.status !== undefined;
      const withPaid = 'paid' in r;
      // Motif d'absence (A2) : libre même après validation, il ne change aucun chiffre
      const withReason = 'reason' in r;
      if (!r.member_id || (!withStatus && !withPaid && !withReason)) throw new Error('invalid record');
      if (withReason && r.reason !== null && !ABSENCE_REASONS.includes(r.reason)) throw new Error('invalid record');
      if (withStatus && !['present', 'absent', 'excused'].includes(r.status))
        throw new Error('invalid record');
      // Présence validée : les statuts sont figés jusqu'à réouverture (les paiements restent libres)
      if (withStatus && s.attendance_finalized_at) throw new Error('attendance_finalized');
      const paid = withPaid ? parsePaid(r.paid) : undefined;
      if (withPaid && paid === undefined) throw new Error('invalid paid');
      if (withPaid && !canSeeFees) throw new Error('forbidden_fees');
      const m = memberBranch.get(r.member_id);
      if (!m) throw new Error('invalid record');
      if (!writable.has(m.branch_id)) throw new Error('forbidden_branch');
      // عنصر خارج مجموعات النشاط ليس في قائمته أصلًا — الزيارة مستثناة، فحضورها
      // هو أسماء من زيرَ بعينهم، لا قائمة فرقة تُفلتر.
      if (s.kind !== 'visit' && !memberInSessionGroups(s.id, m)) throw new Error('forbidden_group');
      const prev = attendanceRow.get(s.id, r.member_id);
      const ref = { member_id: Number(r.member_id), branch_id: prev?.branch_id ?? m.branch_id };
      const from = { ...ref };
      const to = { ...ref };
      const prevStatus = prev?.status === 'unmarked' ? null : (prev?.status ?? null);
      if (withStatus && prevStatus !== r.status) [from.status, to.status] = [prevStatus, r.status];
      if (withPaid && (prev?.paid ?? null) !== paid) [from.paid, to.paid] = [prev?.paid ?? null, paid];
      // Un présent n'a pas de motif : le passer présent l'efface
      const reason = withStatus && r.status === 'present' ? null : withReason ? r.reason : undefined;
      if (reason !== undefined && (prev?.reason ?? null) !== reason) [from.reason, to.reason] = [prev?.reason ?? null, reason];
      if ('status' in to || 'paid' in to || 'reason' in to) {
        was.push(from);
        now.push(to);
      }
      if (withStatus) upsertStatus.run(s.id, r.member_id, r.status);
      if (withPaid) upsertPaid.run(s.id, r.member_id, paid);
      if (reason !== undefined && (prev || reason !== null)) upsertReason.run(s.id, r.member_id, reason);
    }
  });
  try {
    run();
  } catch (e) {
    // فرقة أو مجموعة خارج نطاق النشاط: منعٌ لا خطأ في البيانات
    return res
      .status(
        e.message === 'attendance_finalized'
          ? 409
          : ['forbidden_branch', 'forbidden_group', 'forbidden_fees'].includes(e.message)
            ? 403
            : 400
      )
      .json({ error: e.message });
  }
  if (now.length) auditEvent(req, 'attendance', 'session', s.id, { attendance: was }, { attendance: now });
  notifyAdmins(req, 'attendance', s);
  // الحصيلة تعود مع كل حفظ: البرنامج يجمعها، فلا يجمعها القائد على ورقة
  res.json({ ok: true, subscriptions: canSeeFees ? sessionSubscriptions(s.id) : null });
});

// ---------- Validation de la présence (A1) ----------
// «تثبيت الحضور» : qui a validé et quand, dans sessions.attendance_finalized_at/by. Une
// séance validée compte dans toutes les statistiques (countedSessionSQL) et sa présence
// ne se modifie plus qu'après «Rouvrir», réservé à sessions.edit. Les deux sont tracés
// dans l'Historique de la séance. Une séance commune se valide d'un bloc : il faut donc
// avoir toutes ses فرق (le pointage, lui, reste فرقة par فرقة).
function finalizeTarget(req, res) {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(intOr(req.params.id));
  if (!s) return void res.status(404).json({ error: 'session not found' });
  if (!sessionOk(req, s)) return void res.status(403).json({ error: 'forbidden' });
  if (!['activity', 'leaders'].includes(s.kind)) return void res.status(400).json({ error: 'not_pointed_kind' });
  if (!branchIdsOfSession(s.id).every((b) => branchOk(req, b))) return void res.status(403).json({ error: 'forbidden' });
  return s;
}
const finalizeState = (s) => ({
  attendance_finalized_at: s.attendance_finalized_at ?? null,
  attendance_finalized_by: s.attendance_finalized_by ?? null,
});

app.post('/api/sessions/:id/finalize', requirePerm('sessions.attendance'), (req, res) => {
  const s = finalizeTarget(req, res);
  if (!s) return;
  if (s.attendance_finalized_at) return res.status(409).json({ error: 'already_finalized' });
  // Une séance à venir n'a pas eu lieu : rien à valider
  if (s.date > todayISO()) return res.status(400).json({ error: 'future_session' });
  const by = req.user.display_name || req.user.username;
  db.prepare("UPDATE sessions SET attendance_finalized_at = datetime('now'), attendance_finalized_by = ? WHERE id = ?")
    .run(by, s.id);
  const after = db.prepare('SELECT * FROM sessions WHERE id = ?').get(s.id);
  auditEvent(req, 'finalize', 'session', s.id, finalizeState(s), finalizeState(after));
  res.json(finalizeState(after));
  // A2 : la séance compte désormais — les absents dont la série atteint un palier
  setImmediate(() => {
    try {
      absenceStreakAlerts(req, after);
    } catch (e) {
      console.error('absence streak alerts failed:', e.message);
    }
  });
});

// Après validation (A2) : chaque عنصر actif absent de cette séance dont la série
// d'absences — séances qui comptent, dans sa فرقة actuelle — atteint le seuil (palier 1)
// ou deux fois le seuil (palier 2, escalade à l'admin). Une seule alerte par palier et par
// série : la clé porte la première absence de la série, une nouvelle série réalerte.
function absenceStreakAlerts(req, s) {
  if (s.kind !== 'activity') return 0;
  const threshold = absenceThreshold();
  const absent = db
    .prepare(
      `SELECT m.id, m.first_name, m.father_name, m.last_name, m.branch_id, m.status
       FROM attendance a JOIN members m ON m.id = a.member_id
       WHERE a.session_id = ? AND a.status = 'absent' AND m.status = 'active'`
    )
    .all(s.id);
  let sent = 0;
  for (const m of absent) {
    const rows = attributedAttendance(m).rows.filter((r) => r.attributed_branch === m.branch_id);
    const streak = statsFromRows(rows).consecutive_absences;
    if (streak < threshold) continue;
    // Cette séance doit faire partie de la série (une ancienne validée plus tard n'alerte pas)
    if (!rows.slice(0, streak).some((r) => r.session_id === s.id)) continue;
    const level = streak >= threshold * 2 ? 2 : 1;
    const startId = rows[streak - 1].session_id;
    const lastContact = lastContactsOf([m.id]).get(m.id) || null;
    if (notifications.absenceStreak({ member: m, streak, level, startId, threshold, lastContact })) sent += 1;
  }
  return sent;
}

// Une fois (user_version 9), au premier démarrage avec A2 : les séries d'absences déjà en
// cours sont marquées « alertées » à leur palier actuel. Sinon, la première validation de
// présence après le déploiement enverrait d'un coup toutes les séries anciennes. Une série
// en cours n'alerte donc plus qu'en atteignant le palier suivant ; une nouvelle série alerte.
function seedAbsenceReminders() {
  if (db.pragma('user_version', { simple: true }) >= 9) return;
  const threshold = absenceThreshold();
  const mark = db.prepare('INSERT OR IGNORE INTO notification_reminders (key) VALUES (?)');
  const members = db.prepare("SELECT * FROM members WHERE status = 'active'").all();
  db.transaction(() => {
    for (const m of members) {
      const rows = attributedAttendance(m).rows.filter((r) => r.attributed_branch === m.branch_id);
      const streak = statsFromRows(rows).consecutive_absences;
      if (streak < threshold) continue;
      const startId = rows[streak - 1].session_id;
      const level = streak >= threshold * 2 ? 2 : 1;
      for (let l = 1; l <= level; l++) mark.run(`absence:${m.id}:${startId}:${l}`);
    }
    db.pragma('user_version = 9');
  })();
}

app.post('/api/sessions/:id/reopen', requirePerm('sessions.edit'), (req, res) => {
  const s = finalizeTarget(req, res);
  if (!s) return;
  if (!s.attendance_finalized_at) return res.status(409).json({ error: 'not_finalized' });
  db.prepare('UPDATE sessions SET attendance_finalized_at = NULL, attendance_finalized_by = NULL WHERE id = ?').run(s.id);
  auditEvent(req, 'reopen', 'session', s.id, finalizeState(s), finalizeState({}));
  res.json(finalizeState({}));
});

// «Mettre à jour la liste» : la liste d'une séance est figée à sa création. Ajoute les
// عناصر actifs de ses فرق (et طلائع) arrivés depuis, et signale ceux de la liste qui
// sont archivés ou ont changé de فرقة — sans les retirer : leur ligne est l'archive
// de ce jour-là. ?dry=1 ne fait que compter.
app.post('/api/sessions/:id/roster/sync', requirePerm('sessions.attendance'), (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(intOr(req.params.id));
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!sessionOk(req, s)) return res.status(403).json({ error: 'forbidden' });
  const branchIds = branchIdsOfSession(s.id);
  if (!(s.kind === 'activity' || (s.kind === 'leaders' && branchIds.length > 0)))
    return res.status(400).json({ error: 'no_roster' });
  if (s.attendance_finalized_at) return res.status(409).json({ error: 'attendance_finalized' });
  // Only the فرق this account marks: a shared séance's other roster is not his to touch
  const mine = myBranchesOfSession(req, s.id).map(intOr);
  const list = mine.join(',') || -1;
  const missing = db
    .prepare(
      `SELECT m.id, m.first_name, m.father_name, m.last_name, m.branch_id, m.group_id FROM members m
       WHERE m.branch_id IN (${list}) AND m.status = 'active'
         AND ${memberInSessionGroupsSQL(s.id, 'm')}
         AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = ? AND a.member_id = m.id)
       ORDER BY m.last_name, m.first_name`
    )
    .all(s.id);
  // Listed here, but archived since, or now in another فرقة than the one he counts in here
  const flagged = db
    .prepare(
      `SELECT m.id, m.first_name, m.father_name, m.last_name, m.status, m.branch_id,
              COALESCE(a.branch_id, m.branch_id) AS session_branch_id
       FROM attendance a JOIN members m ON m.id = a.member_id
       WHERE a.session_id = ? AND COALESCE(a.branch_id, m.branch_id) IN (${list})
         AND (m.status != 'active' OR m.branch_id != COALESCE(a.branch_id, m.branch_id))
       ORDER BY m.last_name, m.first_name`
    )
    .all(s.id)
    .map((m) => ({ ...m, reason: m.status !== 'active' ? 'archived' : 'transferred' }));
  const dry = req.query.dry === '1' || req.body?.dry === true;
  if (!dry && missing.length) {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO attendance (session_id, member_id, status, branch_id, group_id)
       VALUES (?, ?, 'absent', ?, ?)`
    );
    db.transaction(() => {
      for (const m of missing) insert.run(s.id, m.id, m.branch_id, m.group_id);
    })();
    auditEvent(req, 'roster_sync', 'session', s.id, null, {
      added: missing.map((m) => ({ member_id: m.id, branch_id: m.branch_id })),
    });
  }
  res.json({ added: missing, flagged, dry });
});

// ---------- سجلّ النشاط ----------
// من أنشأ النشاط، و من غيّر فيه ماذا و متى: أسطر audit_events التي تخصّه (session_id)،
// مقروءةً تغييراتٍ صغيرة. لكل سطر نوعه، و الحساب، و الوقت، و rows — كلٌّ منها
// { key, subject, from, to }: null في from = أُضيف، و في to = أُزيل. ما تخفيه الصفحة عن
// المستخدم يخفيه السجلّ أيضًا: المبالغ عمّن لا يراها، و عناصر فرقٍ لا يراها في نشاط مشترك.
// أسطر الحساب الواحد المتتالية من النوع نفسه، في ربع ساعة، تصير سطرًا واحدًا بحصيلتها:
// الحضور يُنقَّط ضغطةً لكل عنصر، و ثلاثون سطرًا «سجّل حضور فلان» تُغرق ما يهمّ.

const HISTORY_FIELDS = ['title', 'date', 'start_time', 'place', 'activity_type', 'fee', 'leader', 'matalib', 'leaders_count'];
const HISTORY_MERGE_S = 15 * 60;

const historyJSON = (v) => {
  try {
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const utcSeconds = (at) => Date.parse(`${String(at).replace(' ', 'T')}Z`) / 1000;

// One audit line as { type, rows } for this reader, or null when it shows him nothing
function historyEntry(ev, see) {
  const before = historyJSON(ev.before_json);
  const after = historyJSON(ev.after_json);
  // Lines recovered from the admin feed say who and when, never what
  if (after?.from_feed) {
    const type = { create: 'created', attendance: 'attendance', counts: 'counts', animator: 'animators' }[ev.action];
    return type ? { type, rows: [], vague: true } : null;
  }
  const row = (key, subject, from, to) => ({ key, subject, from: from ?? null, to: to ?? null });
  const one = (type, ...args) => ({ type, rows: [row(...args)] });
  if (ev.entity_type === 'session') {
    const x = after ?? before ?? {};
    switch (ev.action) {
      case 'create':
        return { type: 'created', rows: [] };
      case 'update':
        return {
          type: 'details',
          rows: HISTORY_FIELDS.filter((f) => f !== 'fee' || see.fees).map((f) =>
            f === 'matalib'
              ? row(`f:${f}`, { field: f }, historyJSON(before?.[f]), historyJSON(after?.[f]))
              : row(`f:${f}`, { field: f }, before?.[f], after?.[f])
          ),
        };
      case 'attendance': {
        const was = new Map((before?.attendance || []).map((r) => [r.member_id, r]));
        const rows = [];
        for (const r of after?.attendance || []) {
          if (!see.branch(r.branch_id)) continue;
          const p = was.get(r.member_id) || {};
          if ('status' in r) rows.push(row(`a:${r.member_id}`, { field: 'status', member_id: r.member_id }, p.status, r.status));
          if ('paid' in r && see.fees) rows.push(row(`p:${r.member_id}`, { field: 'paid', member_id: r.member_id }, p.paid, r.paid));
          if ('reason' in r) rows.push(row(`r:${r.member_id}`, { field: 'reason', member_id: r.member_id }, p.reason, r.reason));
        }
        return { type: 'attendance', rows };
      }
      case 'counts': {
        const byBranch = (v) => new Map((v?.branch_counts || []).map((c) => [c.branch_id, c.count]));
        const [was, now] = [byBranch(before), byBranch(after)];
        return {
          type: 'counts',
          rows: [
            ...[...new Set([...was.keys(), ...now.keys()])].map((b) =>
              row(`c:${b}`, { branch_id: b }, was.get(b) ?? 0, now.get(b) ?? 0)
            ),
            row('c:leaders', { field: 'leaders_count' }, before?.leaders_count, after?.leaders_count),
          ],
        };
      }
      case 'animator': {
        const state = (v) => v && { role: v.role, status: v.status ?? null };
        return one('animators', `l:${x.leader_id}`, { leader_id: x.leader_id }, state(before), state(after));
      }
      case 'guest':
        return one('guests', `g:${x.id}`, { name: x.name }, before?.name, after?.name);
      case 'finalize':
        return { type: 'finalized', rows: [] };
      case 'reopen':
        return { type: 'reopened', rows: [] };
      case 'roster_sync':
        return {
          type: 'roster',
          rows: (after?.added || [])
            .filter((r) => see.branch(r.branch_id))
            .map((r) => row(`r:${r.member_id}`, { member_id: r.member_id }, null, true)),
        };
      case 'add_file':
      case 'remove_file':
        return one('files', `file:${x.file_id}`, { name: x.name, kind: x.kind }, before && true, after && true);
      default:
        // 'delete': nobody reads the history of a نشاط that is gone
        return null;
    }
  }
  const x = after ?? before;
  if (!x) return null;
  if (ev.entity_type === 'treasury_entry') {
    if (!see.money) return null;
    const state = (v) =>
      v && { label: v.label, amount: v.amount, category: v.category, date: v.date, paid_on: v.paid_on, owed_to: v.owed_to };
    return one(x.direction === 'out' ? 'expenses' : 'donations', `e:${ev.entity_id}`, {}, state(before), state(after));
  }
  if (ev.entity_type === 'member_due') {
    if (!see.dues || !see.branch(x.branch_id)) return null;
    return one('dues', `d:${ev.entity_id}`, { member_id: x.member_id, month: x.month }, before?.amount, after?.amount);
  }
  if (ev.entity_type === 'session_evaluation') {
    // The marks stay in their tab, under its rules: here only who rated and when. `rev`
    // tells two versions apart, so a second save is a change and not a repeat
    return one('evaluation', `v:${ev.entity_id}`, { name: x.leader_name }, before && { rev: `${ev.id}-` }, after && { rev: ev.id });
  }
  return null;
}

// The نشاط's history for this reader, oldest first, before names are put on its rows
function historyItems(req, s) {
  const scope = allowedBranches(req) ? new Set(myBranchesOfSession(req, s.id)) : null;
  const see = {
    fees: hasPerm(req, 'sessions.read.fees'),
    money: canSeeSessionExpenses(req),
    dues: canSeeMemberDues(req),
    branch: (b) => !scope || scope.has(Number(b)),
  };
  const events = db
    .prepare(
      `SELECT id, actor_user_id, actor, action, entity_type, entity_id, before_json, after_json, created_at
       FROM audit_events WHERE session_id = ? ORDER BY created_at, id`
    )
    .all(s.id);
  const items = [];
  for (const ev of events) {
    const entry = historyEntry(ev, see);
    if (!entry) continue;
    const last = items[items.length - 1];
    if (
      last &&
      entry.type !== 'created' &&
      last.type === entry.type &&
      !!last.vague === !!entry.vague &&
      last.actor === ev.actor &&
      last.actor_user_id === ev.actor_user_id &&
      utcSeconds(ev.created_at) - utcSeconds(last.at) <= HISTORY_MERGE_S
    ) {
      // Same key twice in a burst: where it started, where it ended
      for (const r of entry.rows) {
        const seen = last.rows.find((y) => y.key === r.key);
        if (seen) seen.to = r.to;
        else last.rows.push(r);
      }
      last.at = ev.created_at;
      continue;
    }
    items.push({
      type: entry.type,
      actor: ev.actor,
      actor_user_id: ev.actor_user_id,
      at: ev.created_at,
      ...(entry.vague && { vague: true }),
      rows: entry.rows,
    });
  }
  // What a burst undid (absent, present, absent again) leaves nothing to say
  return items
    .map((i) => ({ ...i, rows: i.rows.filter((r) => !sameValue(r.from, r.to)) }))
    .filter((i) => ['created', 'finalized', 'reopened'].includes(i.type) || i.vague || i.rows.length > 0);
}

// Names on the rows, as they read today: a renamed عنصر reads under his new name
function nameHistoryRows(items) {
  const ids = { member_id: new Set(), leader_id: new Set(), branch_id: new Set() };
  for (const i of items)
    for (const r of i.rows) for (const k of Object.keys(ids)) if (r.subject[k]) ids[k].add(intOr(r.subject[k]));
  const byId = (sql, set) =>
    set.size ? new Map(db.prepare(sql.replace('(?)', `(${[...set].join(',')})`)).all().map((r) => [r.id, r])) : new Map();
  const members = byId(`SELECT id, ${fullNameSQL('m')} AS name FROM members m WHERE id IN (?)`, ids.member_id);
  const leaders = byId('SELECT id, first_name, father_name, last_name FROM leaders WHERE id IN (?)', ids.leader_id);
  const branches = byId('SELECT id, name_fr, name_ar FROM branches WHERE id IN (?)', ids.branch_id);
  for (const i of items)
    for (const r of i.rows) {
      const s = r.subject;
      if (s.member_id) s.name = members.get(intOr(s.member_id))?.name ?? null;
      if (s.leader_id) {
        const l = leaders.get(intOr(s.leader_id));
        s.name = l ? leaderFullName(l) : null;
      }
      if (s.branch_id) {
        const b = branches.get(intOr(s.branch_id));
        s.name_fr = b?.name_fr ?? null;
        s.name_ar = b?.name_ar ?? null;
      }
    }
  return items;
}

// Who changed the نشاط last, for its header — its creation is said on its own line
function lastChangeOf(req, s) {
  const items = historyItems(req, s).filter((i) => i.type !== 'created');
  const last = items[items.length - 1];
  return last ? { actor: last.actor, at: last.at } : null;
}

app.get('/api/sessions/:id/history', requirePerm('sessions.read'), (req, res) => {
  const s = db.prepare('SELECT id, branch_id, section FROM sessions WHERE id = ?').get(intOr(req.params.id));
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!sessionOk(req, s)) return res.status(403).json({ error: 'forbidden' });
  // Newest first, as it is read
  res.json({ items: nameHistoryRows(historyItems(req, s)).reverse() });
});

// ---------- تقييم الأنشطة ----------
// بعد النشاط يقيّمه كل قائد شارك فيه، بالاستمارة التي اختارها المسؤول لنوع النشاط (الإعدادات):
// مؤشرات علامتها من 1 إلى 5 مجمّعة في محاور، و أسئلة مفتوحة. النتيجة معدّل المقيِّمين —
// «تُجمع العلامات و تُقسم على عدد المقيِّمين» كما في استمارات دورات الجمعية.
const { EVAL_PRESETS } = require('./evalPresets');
// أنواع الأنشطة، ثم أنواع المخيمات و الدورات (event_ + EVENT_KINDS، المعرَّفة أبعد في الملف)
const EVAL_KINDS = ['activity', 'leaders', 'group', 'visit', 'event_camp', 'event_course', 'event_trip', 'event_other'];
const EVAL_ITEM_TYPES = ['axis', 'score', 'text'];
const EVAL_NAME_MAX = 120;
const EVAL_LABEL_MAX = 300;
const EVAL_TEXT_MAX = 2000;
const EVAL_ITEMS_MAX = 80;
// «أنشطة تنتظر تقييمك» في لوحة القيادة: ما مضى عليه أسبوعان يخرج منها، و يبقى قابلًا للتقييم
const EVAL_REMIND_DAYS = 14;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
// منزلتان تكفيان: الشاشة تعرض واحدة، و الحفظ لا يراكم كسور الفاصلة العائمة
const round2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
// leaderFullName (the الاسم الثلاثي) is shared with the محاضر, further down

const evalItemsOf = (formId) =>
  db
    .prepare(
      `SELECT id, position, type, label_ar, label_fr, archived FROM eval_items
        WHERE form_id = ? ORDER BY position, id`
    )
    .all(formId);

// من يقيّم النشاط: قادته — المسؤول و المساعدون — ما لم يُسجَّلوا غائبين. نشاط القادة لا صف
// فيه إلا لمن وُضع حضوره (و للمسؤول)، فمقيِّموه من حضر.
const evalParticipantsOf = (sessionId) =>
  db
    .prepare(
      `SELECT sl.leader_id, sl.role, l.first_name, l.father_name, l.last_name
         FROM session_leaders sl JOIN leaders l ON l.id = sl.leader_id
        WHERE sl.session_id = ? AND COALESCE(sl.status, '') != 'absent'
        ORDER BY sl.role = 'main' DESC, l.last_name, l.first_name`
    )
    .all(sessionId);

// What is evaluated: a نشاط here, a camp or a course further down (EVENT_EVAL). Each has its
// own tables of evaluations and answers; the forms are shared.
const SESSION_EVAL = {
  kind: 'session',
  table: 'session_evaluations',
  answers: 'session_evaluation_answers',
  fk: 'session_id',
  audit: 'session_evaluation',
  kindOf: (s) => s.kind,
  participantsOf: (s) => evalParticipantsOf(s.id),
  // Who leads it, told of each new evaluation: its القائد المسؤول
  leadersOf: (s) =>
    db.prepare("SELECT leader_id FROM session_leaders WHERE session_id = ? AND role = 'main'").all(s.id).map((r) => r.leader_id),
  // From the day of the نشاط
  isOpen: (s) => s.date <= todayISO(),
};

// الاستمارة التي يُقيَّم بها النشاط: استمارة تقييماته إن وُجدت — فكلّها بالاستمارة نفسها، و لو
// تغيّرت استمارة نوعه بعد أوّلها — و إلّا المعتمدة لنوعه الآن. null: نوع لا يُقيَّم.
function evalFormIdOf(s, target = SESSION_EVAL) {
  const used = db
    .prepare(
      `SELECT form_id FROM ${target.table} WHERE ${target.fk} = ? AND form_id IS NOT NULL ORDER BY id LIMIT 1`
    )
    .get(s.id);
  if (used) return used.form_id;
  return db.prepare('SELECT form_id FROM eval_kind_forms WHERE kind = ?').get(target.kindOf(s))?.form_id ?? null;
}

// Who is asking, against this نشاط: may he evaluate, has he, and may he see the results yet
function evalState(req, s, target = SESSION_EVAL) {
  const formId = evalFormIdOf(s, target);
  const evaluations = db
    .prepare(
      `SELECT id, form_id, leader_id, user_id, leader_name, average, created_at, updated_at
         FROM ${target.table} WHERE ${target.fk} = ? ORDER BY id`
    )
    .all(s.id);
  const participants = target.participantsOf(s);
  const isAdmin = req.user.role === 'admin';
  const me = req.user.leader_id ? Number(req.user.leader_id) : null;
  const isParticipant = me !== null && participants.some((p) => p.leader_id === me);
  // Under his قائد when the account has one; else (the admin) under the account itself
  const mine =
    (me !== null && evaluations.find((e) => e.leader_id === me)) ||
    evaluations.find((e) => e.leader_id === null && e.user_id === req.user.id) ||
    null;
  const open = target.isOpen(s);
  // قادة النشاط يقيّمونه، و المسؤول يقيّم أيّ نشاط و لو لم يقده — اختيارًا، لا ينتظره أحد
  const canEvaluate = (isParticipant || isAdmin) && open && !!formId;
  // قائد شارك و لم يقيّم بعد لا يرى علامات غيره قبل أن يضع علاماته، كي لا تميل إليها.
  // المسؤول يراها دائمًا.
  const hidden = isParticipant && !mine && !isAdmin;
  // Without evaluations.read, the results are never shown — one's own marks still are
  const forbidden = !hasPerm(req, 'evaluations.read');
  const average = round2(mean(evaluations.map((e) => e.average).filter((v) => v !== null)));
  return { formId, evaluations, participants, isParticipant, mine, open, canEvaluate, hidden, forbidden, average };
}

// What the نشاط page and its header need without loading the whole evaluation
function evalSummaryOf(req, s, target = SESSION_EVAL) {
  const st = evalState(req, s, target);
  if (!st.formId && !st.evaluations.length) return null;
  return {
    count: st.evaluations.length,
    participants: st.participants.length,
    average: st.hidden || st.forbidden ? null : st.average,
    can_evaluate: st.canEvaluate,
    // A قائد who led it is expected to rate it («À évaluer»); for the admin it is optional
    expected: st.isParticipant,
    done: !!st.mine,
    open: st.open,
  };
}

function evalPayload(req, s, target = SESSION_EVAL) {
  const st = evalState(req, s, target);
  const form = st.formId
    ? db.prepare('SELECT id, name_ar, name_fr, preset FROM eval_forms WHERE id = ?').get(st.formId)
    : null;
  const answers = db
    .prepare(
      `SELECT a.evaluation_id, a.item_id, a.score, a.text FROM ${target.answers} a
         JOIN ${target.table} ev ON ev.id = a.evaluation_id
        WHERE ev.${target.fk} = ? ORDER BY a.evaluation_id`
    )
    .all(s.id);
  const answered = new Set(answers.map((a) => a.item_id));
  // بنود الاستمارة القائمة، و ما أُرشف منها و أُجيب عنه هنا — فتبقى نتيجته مقروءة
  const items = form ? evalItemsOf(form.id).filter((it) => !it.archived || answered.has(it.id)) : [];
  const answersOf = (evaluationId) =>
    Object.fromEntries(
      answers
        .filter((a) => a.evaluation_id === evaluationId)
        .map((a) => [a.item_id, { score: a.score, text: a.text }])
    );
  const nameOf = (evaluationId) => st.evaluations.find((e) => e.id === evaluationId)?.leader_name;
  // Who gave which mark: the admin, or an account given evaluations.details
  const named = hasPerm(req, 'evaluations.details');
  const results = st.hidden || st.forbidden
    ? null
    : {
        count: st.evaluations.length,
        average: st.average,
        items: items
          .filter((it) => it.type !== 'axis')
          .map((it) => {
            const rows = answers.filter((a) => a.item_id === it.id);
            if (it.type === 'score') {
              const scores = rows.map((a) => a.score).filter((v) => v !== null);
              return {
                item_id: it.id,
                average: round2(mean(scores)),
                count: scores.length,
                dist: [1, 2, 3, 4, 5].map((n) => scores.filter((v) => v === n).length),
              };
            }
            // الأجوبة المفتوحة بلا أسماء، إلّا للمسؤول
            return {
              item_id: it.id,
              texts: rows
                .filter((a) => a.text)
                .map((a) => (named ? { text: a.text, leader_name: nameOf(a.evaluation_id) } : { text: a.text })),
            };
          }),
        // كل تقييم باسم صاحبه: للمسؤول وحده
        by_leader: named
          ? st.evaluations.map((e) => ({
              id: e.id,
              leader_id: e.leader_id,
              leader_name: e.leader_name,
              average: e.average,
              updated_at: e.updated_at,
              answers: answersOf(e.id),
            }))
          : null,
      };
  const done = new Set(st.evaluations.map((e) => e.leader_id));
  return {
    form: form && { ...form, items },
    open: st.open,
    can_evaluate: st.canEvaluate,
    // Led it, so his marks are awaited; the admin's are optional
    expected: st.isParticipant,
    // قادة النشاط و من قيّم منهم، ثم من قيّم و لم يعد بينهم (أُزيل أو سُجّل غائبًا بعدها):
    // تقييمه محسوب
    participants: [
      ...st.participants.map((p) => ({
        leader_id: p.leader_id,
        role: p.role,
        name: leaderFullName(p),
        done: done.has(p.leader_id),
      })),
      ...st.evaluations
        .filter((e) => !st.participants.some((p) => p.leader_id === e.leader_id))
        .map((e) => ({ leader_id: e.leader_id, role: null, name: e.leader_name, done: true })),
    ],
    mine: st.mine
      ? { id: st.mine.id, average: st.mine.average, updated_at: st.mine.updated_at, answers: answersOf(st.mine.id) }
      : null,
    results_hidden: st.hidden,
    results_forbidden: st.forbidden,
    results,
  };
}

const evalSessionOf = (req, res) => {
  const s = db
    .prepare('SELECT id, title, date, kind, branch_id, section FROM sessions WHERE id = ?')
    .get(req.params.id);
  if (!s) {
    res.status(404).json({ error: 'session not found' });
    return null;
  }
  if (!sessionOk(req, s)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return s;
};

app.get('/api/sessions/:id/evaluation', requirePerm('sessions.read'), (req, res) => {
  const s = evalSessionOf(req, res);
  if (s) res.json(evalPayload(req, s));
});

// تقييم صاحب الحساب — قائد شارك في النشاط (أو في المخيم)، أو المسؤول: يُنشأ أول مرّة و يُعدَّل
// بعدها. answers: [{ item_id, score | text }]؛ مؤشر بلا علامة يُترك (لا رأي)، لكن علامة واحدة
// على الأقل. null، أو { status, error } للردّ.
function saveEvaluation(req, s, target) {
  const st = evalState(req, s, target);
  if (!st.isParticipant && req.user.role !== 'admin') return { status: 403, error: 'not_a_participant' };
  if (!st.open) return { status: 409, error: 'eval_not_open' };
  if (!st.formId) return { status: 409, error: 'no_eval_form' };
  const live = new Map(
    evalItemsOf(st.formId)
      .filter((it) => !it.archived && it.type !== 'axis')
      .map((it) => [it.id, it])
  );
  if (!Array.isArray(req.body?.answers)) return { status: 400, error: 'invalid answers' };
  const rows = [];
  for (const a of req.body.answers) {
    const it = live.get(Number(a?.item_id));
    if (!it || rows.some((r) => r.item_id === it.id)) return { status: 400, error: 'invalid item_id' };
    if (it.type === 'score') {
      if (a.score === null || a.score === undefined || a.score === '') continue;
      const v = Number(a.score);
      if (!Number.isInteger(v) || v < 1 || v > 5) return { status: 400, error: 'invalid score' };
      rows.push({ item_id: it.id, score: v, text: null });
    } else {
      if (a.text !== null && a.text !== undefined && typeof a.text !== 'string')
        return { status: 400, error: 'invalid text' };
      const text = (a.text || '').trim();
      if (text.length > EVAL_TEXT_MAX) return { status: 400, error: 'text_too_long' };
      if (text) rows.push({ item_id: it.id, score: null, text });
    }
  }
  if (!rows.some((r) => r.score !== null)) return { status: 400, error: 'eval_empty' };
  // Signed with the قائد of the account; an admin account without one signs with its own name
  const leader = req.user.leader_id
    ? db.prepare('SELECT id, first_name, father_name, last_name FROM leaders WHERE id = ?').get(req.user.leader_id)
    : null;
  const author = req.user.display_name || req.user.username;
  const name = leader ? leaderFullName(leader) : author;
  const created = !st.mine;
  const evalRow = db.prepare(`SELECT * FROM ${target.table} WHERE id = ?`);
  const before = created ? null : evalRow.get(st.mine.id);
  let evaluationId;
  db.transaction(() => {
    evaluationId = created
      ? db
          .prepare(
            `INSERT INTO ${target.table} (${target.fk}, form_id, leader_id, user_id, leader_name, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(s.id, st.formId, leader?.id ?? null, req.user.id, name, author).lastInsertRowid
      : st.mine.id;
    // Answers to the form's live items are replaced; those to items archived since stay
    db.prepare(
      `DELETE FROM ${target.answers} WHERE evaluation_id = ?
         AND item_id IN (SELECT id FROM eval_items WHERE archived = 0)`
    ).run(evaluationId);
    const insert = db.prepare(
      `INSERT INTO ${target.answers} (evaluation_id, item_id, score, text) VALUES (?, ?, ?, ?)`
    );
    for (const r of rows) insert.run(evaluationId, r.item_id, r.score, r.text);
    const avg = db
      .prepare(`SELECT AVG(score) AS a FROM ${target.answers} WHERE evaluation_id = ? AND score IS NOT NULL`)
      .get(evaluationId).a;
    db.prepare(
      `UPDATE ${target.table} SET average = ?, leader_name = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(round2(avg), name, evaluationId);
  })();
  auditEvent(req, created ? 'create' : 'update', target.audit, evaluationId, before, evalRow.get(evaluationId));
  // Whoever leads it hears of a new one (the bell, if he asked for it)
  if (created) {
    const after = evalState(req, s, target);
    notifications.evaluationReceived(req, {
      kind: target.kind,
      id: s.id,
      title: s.title,
      section: s.section,
      leaderIds: target.leadersOf(s),
      count: after.evaluations.length,
      total: after.participants.length,
    });
  }
  return null;
}

// His own evaluation, withdrawn — under his قائد, or under the account for an admin without
// one — or, for the admin, anyone's (eid). false: nothing to delete.
function deleteEvaluation(req, s, target, eid = null) {
  const id = eid === null ? evalState(req, s, target).mine?.id : eid;
  const row = id && db.prepare(`SELECT * FROM ${target.table} WHERE id = ? AND ${target.fk} = ?`).get(id, s.id);
  if (!row) return false;
  db.prepare(`DELETE FROM ${target.table} WHERE id = ?`).run(row.id);
  auditEvent(req, 'delete', target.audit, row.id, row, null);
  return true;
}

app.put('/api/sessions/:id/evaluation', requirePerm('sessions.read'), (req, res) => {
  const s = evalSessionOf(req, res);
  if (!s) return;
  const err = saveEvaluation(req, s, SESSION_EVAL);
  if (err) return res.status(err.status).json({ error: err.error });
  res.json(evalPayload(req, s));
});

// القائد يسحب تقييمه، و المسؤول يحذف أيّ تقييم
app.delete('/api/sessions/:id/evaluation', requirePerm('sessions.read'), (req, res) => {
  const s = evalSessionOf(req, res);
  if (!s) return;
  if (!deleteEvaluation(req, s, SESSION_EVAL)) return res.status(404).json({ error: 'evaluation not found' });
  res.json(evalPayload(req, s));
});

app.delete('/api/sessions/:id/evaluations/:eid', requireAdmin, (req, res) => {
  const s = evalSessionOf(req, res);
  if (!s) return;
  if (!deleteEvaluation(req, s, SESSION_EVAL, intOr(req.params.eid)))
    return res.status(404).json({ error: 'evaluation not found' });
  res.json(evalPayload(req, s));
});

// ----- استمارات التقييم (الإعدادات، للمسؤول) -----

// undefined = invalid, null = empty
function evalLabel(v, max) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > max ? undefined : t || null;
}

function parseEvalForm(body) {
  const nameAr = evalLabel(body?.name_ar, EVAL_NAME_MAX);
  const nameFr = evalLabel(body?.name_fr, EVAL_NAME_MAX);
  if (nameAr === undefined || nameFr === undefined || (!nameAr && !nameFr)) return { error: 'invalid name' };
  const kinds = body?.kinds ?? [];
  if (!Array.isArray(kinds) || kinds.some((k) => !EVAL_KINDS.includes(k))) return { error: 'invalid kinds' };
  if (!Array.isArray(body?.items) || body.items.length === 0 || body.items.length > EVAL_ITEMS_MAX)
    return { error: 'invalid items' };
  const items = [];
  for (const it of body.items) {
    if (!EVAL_ITEM_TYPES.includes(it?.type)) return { error: 'invalid item type' };
    const labelAr = evalLabel(it.label_ar, EVAL_LABEL_MAX);
    const labelFr = evalLabel(it.label_fr, EVAL_LABEL_MAX);
    if (labelAr === undefined || labelFr === undefined || (!labelAr && !labelFr)) return { error: 'invalid item label' };
    const id = it.id === undefined || it.id === null ? null : Number(it.id);
    if (id !== null && !Number.isInteger(id)) return { error: 'invalid item id' };
    items.push({ id, type: it.type, label_ar: labelAr, label_fr: labelFr });
  }
  if (!items.some((it) => it.type === 'score')) return { error: 'eval_needs_score' };
  return {
    name_ar: nameAr,
    name_fr: nameFr,
    preset: EVAL_PRESETS.some((p) => p.key === body?.preset) ? body.preset : null,
    kinds: [...new Set(kinds)],
    items,
  };
}

// One form per kind of نشاط: ticking a kind here takes it away from the form that had it
function setEvalKinds(formId, kinds) {
  const keep = kinds.length ? ` AND kind NOT IN (${kinds.map((k) => `'${k}'`).join(',')})` : '';
  db.prepare(`DELETE FROM eval_kind_forms WHERE form_id = ?${keep}`).run(formId);
  const upsert = db.prepare(
    'INSERT INTO eval_kind_forms (kind, form_id) VALUES (?, ?) ON CONFLICT(kind) DO UPDATE SET form_id = excluded.form_id'
  );
  for (const k of kinds) upsert.run(k, formId);
}

// Answers given to an item, in a نشاط or in a camp: once there is one, the item keeps its type
// and is archived instead of deleted
const EVAL_ANSWERS_SQL = `SELECT item_id FROM session_evaluation_answers
  UNION ALL SELECT item_id FROM event_evaluation_answers`;

function evalFormsList() {
  const kinds = db.prepare('SELECT kind, form_id FROM eval_kind_forms').all();
  const usage = db
    .prepare(
      `SELECT form_id, COUNT(*) AS evaluations, COUNT(DISTINCT session_id) AS sessions
         FROM session_evaluations GROUP BY form_id`
    )
    .all();
  const eventUsage = db
    .prepare(
      `SELECT form_id, COUNT(*) AS evaluations, COUNT(DISTINCT event_id) AS events
         FROM event_evaluations GROUP BY form_id`
    )
    .all();
  const answeredOf = db.prepare(
    `SELECT a.item_id, COUNT(*) AS n FROM (${EVAL_ANSWERS_SQL}) a
       JOIN eval_items i ON i.id = a.item_id WHERE i.form_id = ? GROUP BY a.item_id`
  );
  return {
    forms: db
      .prepare('SELECT id, name_ar, name_fr, preset, created_at, updated_at FROM eval_forms WHERE archived = 0 ORDER BY id')
      .all()
      .map((f) => {
        const answered = new Map(answeredOf.all(f.id).map((r) => [r.item_id, r.n]));
        const used = usage.find((u) => u.form_id === f.id);
        const usedEv = eventUsage.find((u) => u.form_id === f.id);
        return {
          ...f,
          kinds: kinds.filter((k) => k.form_id === f.id).map((k) => k.kind),
          sessions: used?.sessions || 0,
          events: usedEv?.events || 0,
          evaluations: (used?.evaluations || 0) + (usedEv?.evaluations || 0),
          // answered: how many evaluations already gave this item a mark — its type is then fixed
          items: evalItemsOf(f.id)
            .filter((it) => !it.archived)
            .map(({ archived, ...it }) => ({ ...it, answered: answered.get(it.id) || 0 })),
        };
      }),
    presets: EVAL_PRESETS,
  };
}

app.get('/api/eval-forms', requireAdmin, (req, res) => {
  res.json(evalFormsList());
});

app.post('/api/eval-forms', requireAdmin, (req, res) => {
  const f = parseEvalForm(req.body);
  if (f.error) return res.status(400).json({ error: f.error });
  if (f.items.some((it) => it.id !== null)) return res.status(400).json({ error: 'invalid item id' });
  const formId = db.transaction(() => {
    const id = db
      .prepare('INSERT INTO eval_forms (name_ar, name_fr, preset, created_by) VALUES (?, ?, ?, ?)')
      .run(f.name_ar, f.name_fr, f.preset, req.user.display_name || req.user.username).lastInsertRowid;
    const insert = db.prepare('INSERT INTO eval_items (form_id, position, type, label_ar, label_fr) VALUES (?, ?, ?, ?, ?)');
    f.items.forEach((it, i) => insert.run(id, i, it.type, it.label_ar, it.label_fr));
    setEvalKinds(id, f.kinds);
    return id;
  })();
  auditEvent(req, 'create', 'eval_form', formId, null, { ...f, items: f.items.length });
  res.status(201).json({ ...evalFormsList(), id: formId });
});

app.put('/api/eval-forms/:id', requireAdmin, (req, res) => {
  const form = db.prepare('SELECT * FROM eval_forms WHERE id = ? AND archived = 0').get(req.params.id);
  if (!form) return res.status(404).json({ error: 'form not found' });
  const f = parseEvalForm(req.body);
  if (f.error) return res.status(400).json({ error: f.error });
  const existing = evalItemsOf(form.id).filter((it) => !it.archived);
  const byId = new Map(existing.map((it) => [it.id, it]));
  const answeredCount = (itemId) =>
    db.prepare(`SELECT COUNT(*) AS n FROM (${EVAL_ANSWERS_SQL}) WHERE item_id = ?`).get(itemId).n;
  const kept = new Set();
  for (const it of f.items) {
    if (it.id === null) continue;
    const old = byId.get(it.id);
    if (!old || kept.has(it.id)) return res.status(400).json({ error: 'invalid item id' });
    kept.add(it.id);
    // Marks already given to an indicator cannot become answers to a question
    if (old.type !== it.type && answeredCount(it.id) > 0) return res.status(409).json({ error: 'eval_item_type_locked' });
  }
  db.transaction(() => {
    db.prepare("UPDATE eval_forms SET name_ar = ?, name_fr = ?, updated_at = datetime('now') WHERE id = ?").run(
      f.name_ar,
      f.name_fr,
      form.id
    );
    const update = db.prepare('UPDATE eval_items SET position = ?, type = ?, label_ar = ?, label_fr = ? WHERE id = ?');
    const insert = db.prepare('INSERT INTO eval_items (form_id, position, type, label_ar, label_fr) VALUES (?, ?, ?, ?, ?)');
    f.items.forEach((it, i) =>
      it.id !== null
        ? update.run(i, it.type, it.label_ar, it.label_fr, it.id)
        : insert.run(form.id, i, it.type, it.label_ar, it.label_fr)
    );
    // Taken out of the form: gone, or archived when an evaluation already answered it
    for (const old of existing) {
      if (kept.has(old.id)) continue;
      if (answeredCount(old.id) > 0) db.prepare('UPDATE eval_items SET archived = 1 WHERE id = ?').run(old.id);
      else db.prepare('DELETE FROM eval_items WHERE id = ?').run(old.id);
    }
    setEvalKinds(form.id, f.kinds);
  })();
  auditEvent(req, 'update', 'eval_form', form.id, form, { ...f, items: f.items.length });
  res.json(evalFormsList());
});

// Deleted outright while unused; once a نشاط or a camp was evaluated with it, archived
// instead, so that it keeps its results
app.delete('/api/eval-forms/:id', requireAdmin, (req, res) => {
  const form = db.prepare('SELECT * FROM eval_forms WHERE id = ? AND archived = 0').get(req.params.id);
  if (!form) return res.status(404).json({ error: 'form not found' });
  const used = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM session_evaluations WHERE form_id = @id)
            + (SELECT COUNT(*) FROM event_evaluations WHERE form_id = @id) AS n`
    )
    .get({ id: form.id }).n;
  db.transaction(() => {
    db.prepare('DELETE FROM eval_kind_forms WHERE form_id = ?').run(form.id);
    if (used) db.prepare("UPDATE eval_forms SET archived = 1, updated_at = datetime('now') WHERE id = ?").run(form.id);
    else db.prepare('DELETE FROM eval_forms WHERE id = ?').run(form.id);
  })();
  auditEvent(req, 'delete', 'eval_form', form.id, form, null);
  res.json({ ...evalFormsList(), archived: used > 0 });
});

// ---------- تقييم المخيمات و الدورات ----------
// كتقييم النشاط، بالاستمارة المعتمدة لنوع المخيم (event_camp، event_course…). يقيّمه كل قائد
// أخذ فيه دورًا: قائده، و هيئته القيادية، و القادة المشاركون — «المدرّبون، و المتدرّبون الذين
// شاركوا في البرنامج، و قيادة النشاط التدريبي فيما بينهم» (تقييم قيادة الأنشطة التدريبية،
// منتدى مهدي الكشفي) — و المسؤول إن شاء. يُفتح في يومه الأخير: المخيم يُقيَّم كلّه.

// Took part: still on the list (not taken off it), and no présence marked for him yet or present at least once
const tookPartSQL = (p) => `(${p}.withdrawn_at IS NULL
    AND (NOT EXISTS (SELECT 1 FROM event_attendance a WHERE a.participant_id = ${p}.id)
      OR EXISTS (SELECT 1 FROM event_attendance a WHERE a.participant_id = ${p}.id AND a.status = 'present')))`;

// A قائد counts once, under his first role: قائد المخيم, then his post in the هيئة, then
// participant — and a participant marked absent from every جلسة did not take part
function eventEvaluatorsOf(eventId) {
  const rows = db
    .prepare(
      `SELECT x.leader_id, x.role, l.first_name, l.father_name, l.last_name FROM (
         SELECT e.leader_id, 'chief' AS role, 0 AS rank FROM events e WHERE e.id = @event AND e.leader_id IS NOT NULL
         UNION ALL
         SELECT st.leader_id, st.role, 1 FROM event_staff st WHERE st.event_id = @event AND st.leader_id IS NOT NULL
         UNION ALL
         SELECT p.leader_id, 'participant', 2 FROM event_participants p
          WHERE p.event_id = @event AND p.leader_id IS NOT NULL AND ${tookPartSQL('p')}
       ) x JOIN leaders l ON l.id = x.leader_id
       ORDER BY x.rank, l.last_name, l.first_name`
    )
    .all({ event: eventId });
  const seen = new Set();
  return rows.filter((r) => !seen.has(r.leader_id) && seen.add(r.leader_id));
}

// The same test in SQL, for the list: is the قائد `me` (an integer, or NULL) one of them
const eventEvaluatorSQL = (alias, me) => `(${alias}.leader_id = ${me}
    OR EXISTS (SELECT 1 FROM event_staff st WHERE st.event_id = ${alias}.id AND st.leader_id = ${me})
    OR EXISTS (SELECT 1 FROM event_participants p WHERE p.event_id = ${alias}.id AND p.leader_id = ${me}
               AND ${tookPartSQL('p')}))`;

const EVENT_EVAL = {
  kind: 'event',
  table: 'event_evaluations',
  answers: 'event_evaluation_answers',
  fk: 'event_id',
  audit: 'event_evaluation',
  kindOf: (ev) => `event_${ev.kind}`,
  participantsOf: (ev) => eventEvaluatorsOf(ev.id),
  leadersOf: (ev) => [ev.leader_id],
  // From its last day
  isOpen: (ev) => ev.end_date <= todayISO(),
};

// Written and withdrawn like a نشاط's evaluation: saveEvaluation / deleteEvaluation, with EVENT_EVAL
app.get('/api/events/:id/evaluation', requirePerm('events.read'), (req, res) => {
  const ev = loadEvent(req, res);
  if (ev) res.json(evalPayload(req, ev, EVENT_EVAL));
});

app.put('/api/events/:id/evaluation', requirePerm('events.read'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const err = saveEvaluation(req, ev, EVENT_EVAL);
  if (err) return res.status(err.status).json({ error: err.error });
  res.json(evalPayload(req, ev, EVENT_EVAL));
});

app.delete('/api/events/:id/evaluation', requirePerm('events.read'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  if (!deleteEvaluation(req, ev, EVENT_EVAL)) return res.status(404).json({ error: 'evaluation not found' });
  res.json(evalPayload(req, ev, EVENT_EVAL));
});

app.delete('/api/events/:id/evaluations/:eid', requireAdmin, (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  if (!deleteEvaluation(req, ev, EVENT_EVAL, intOr(req.params.eid)))
    return res.status(404).json({ error: 'evaluation not found' });
  res.json(evalPayload(req, ev, EVENT_EVAL));
});

// ---------- بطاقات التحضير ----------
// بطاقة يعدّها القائد قبل نشاط السبت: تفاصيل مسبقة عن النشاط. تُؤرشف بلا حذف،
// تبقى قابلة للتعديل في أي وقت، و تُحسب في سجلّ القائد الذي أعدّها. صلاحياتها
// صلاحيات الأنشطة نفسها: من يُنشئ نشاطًا يُعدّ بطاقته.

// الحقول النصية الحرة (الأهداف، الفقرات و الطرق التدريبية، الوسائل، الملاحظات) —
// تُخزَّن كما تُكتب، و الفارغ منها NULL
const PREP_TEXT_FIELDS = ['goals', 'segments', 'tools', 'notes'];

const publicPrepCard = (r) => ({ ...r, matalib: JSON.parse(r.matalib || '[]') });

// Validates the body and returns the column values shared by INSERT and UPDATE,
// or { error, status } when something is wrong.
function parsePrepCard(req) {
  const b = req.body;
  if (!b.title || !String(b.title).trim() || !validISODate(b.date))
    return { error: 'invalid title or date' };
  const branchId = Number(b.branch_id);
  if (!Number.isInteger(branchId) || !db.prepare('SELECT id FROM branches WHERE id = ?').get(branchId))
    return { error: 'invalid branch_id' };
  // لا يُعدّ قائد بطاقة لفرقة ليست له
  if (!branchOk(req, branchId)) return { error: 'forbidden', status: 403 };
  const nums = b.matalib === undefined || b.matalib === null ? [] : b.matalib;
  if (!Array.isArray(nums) || !nums.every((n) => Number.isInteger(n) && n >= 1))
    return { error: 'invalid matalib' };
  const total = db.prepare('SELECT total_requirements FROM branches WHERE id = ?').get(branchId).total_requirements;
  if (nums.some((n) => n > total)) return { error: 'invalid matalib' };
  // القائد الذي أعدّها من قسم فرقتها
  let leaderRow = null;
  if (b.leader_id !== undefined && b.leader_id !== null && b.leader_id !== '') {
    leaderRow = db
      .prepare("SELECT * FROM leaders WHERE id = ? AND status = 'active' AND section = ?")
      .get(b.leader_id, sectionOfBranch(branchId));
    if (!leaderRow) return { error: 'invalid leader_id' };
  }
  // النشاط الذي حُضِّرت له — اختياري: البطاقة تُكتب قبل أن يوجد النشاط غالبًا،
  // فتُربط لاحقًا عبر التعديل. لا يُربط نشاط خارج نطاق فرق المستخدم.
  let sessionId = null;
  if (b.session_id !== undefined && b.session_id !== null && b.session_id !== '') {
    sessionId = Number(b.session_id);
    const session = Number.isInteger(sessionId)
      ? db.prepare('SELECT id, branch_id FROM sessions WHERE id = ?').get(sessionId)
      : null;
    if (!session) return { error: 'invalid session_id' };
    if (!sessionOk(req, session)) return { error: 'forbidden', status: 403 };
  }
  return {
    // Column order shared by INSERT and UPDATE:
    // branch_id, leader_id, leader, title, date, start_time, place, matalib, goals, segments, tools, notes, session_id
    values: [
      branchId,
      leaderRow ? leaderRow.id : null,
      // Same snapshot rule as sessions: the name survives the قائد's deletion
      leaderRow ? `${leaderRow.first_name} ${leaderRow.last_name}` : null,
      String(b.title).trim(),
      b.date,
      b.start_time || null,
      b.place || null,
      JSON.stringify([...new Set(nums)].sort((a, z) => a - z)),
      ...PREP_TEXT_FIELDS.map((f) => b[f] || null),
      sessionId,
    ],
  };
}

const PREP_CARD_SELECT = `SELECT p.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
    COALESCE(${fullNameSQL('l')}, p.leader) AS leader,
    s.title AS session_title, s.date AS session_date
  FROM prep_cards p JOIN branches b ON b.id = p.branch_id
  LEFT JOIN leaders l ON l.id = p.leader_id
  LEFT JOIN sessions s ON s.id = p.session_id`;

app.get('/api/prep-cards', requirePerm('prep.read'), (req, res) => {
  const { q, branch, leader, from, to } = req.query;
  let sql = `${PREP_CARD_SELECT} WHERE 1=1${branchFilterSQL(req, 'p.branch_id')}`;
  const params = [];
  if (branch) sql += ` AND p.branch_id = ${intOr(branch)}`;
  if (leader) sql += ` AND p.leader_id = ${intOr(leader)}`;
  // Dates are stored as YYYY-MM-DD, so plain string comparison sorts correctly
  if (from) { sql += ' AND p.date >= ?'; params.push(from); }
  if (to) { sql += ' AND p.date <= ?'; params.push(to); }
  if (q) {
    sql += ` AND (p.title LIKE ? OR p.place LIKE ? OR COALESCE(${fullNameSQL('l')}, p.leader) LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY p.date DESC, p.id DESC';
  res.json(db.prepare(sql).all(...params).map(publicPrepCard));
});

app.get('/api/prep-cards/:id', requirePerm('prep.read'), (req, res) => {
  const row = db.prepare(`${PREP_CARD_SELECT} WHERE p.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'prep card not found' });
  if (!branchOk(req, row.branch_id)) return res.status(403).json({ error: 'forbidden' });
  res.json(publicPrepCard(row));
});

app.post('/api/prep-cards', requirePerm('prep.manage'), (req, res) => {
  const parsed = parsePrepCard(req);
  if (parsed.error) return res.status(parsed.status || 400).json({ error: parsed.error });
  const id = db
    .prepare(
      `INSERT INTO prep_cards
        (branch_id, leader_id, leader, title, date, start_time, place, matalib, goals, segments, tools, notes, session_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(...parsed.values, req.user.display_name || req.user.username).lastInsertRowid;
  const row = db.prepare(`${PREP_CARD_SELECT} WHERE p.id = ?`).get(id);
  res.status(201).json(publicPrepCard(row));
});

// قابلة للتعديل في أي وقت — نفس صلاحية الإنشاء، ضمن فرق القائد وحدها
app.put('/api/prep-cards/:id', requirePerm('prep.manage'), (req, res) => {
  const existing = db.prepare('SELECT * FROM prep_cards WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'prep card not found' });
  if (!branchOk(req, existing.branch_id)) return res.status(403).json({ error: 'forbidden' });
  const parsed = parsePrepCard(req);
  if (parsed.error) return res.status(parsed.status || 400).json({ error: parsed.error });
  db.prepare(
    `UPDATE prep_cards SET branch_id = ?, leader_id = ?, leader = ?, title = ?, date = ?,
       start_time = ?, place = ?, matalib = ?, goals = ?, segments = ?, tools = ?, notes = ?,
       session_id = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(...parsed.values, existing.id);
  const row = db.prepare(`${PREP_CARD_SELECT} WHERE p.id = ?`).get(existing.id);
  res.json(publicPrepCard(row));
});

// الحذف لمن مُنح prep.delete (الأدمن قبله): البطاقة أرشيف لا يمحوه صاحبه دون إذن، و ضمن فرقه
app.delete('/api/prep-cards/:id', requirePerm('prep.delete'), (req, res) => {
  const existing = db.prepare('SELECT id, branch_id FROM prep_cards WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'prep card not found' });
  if (!branchOk(req, existing.branch_id)) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM prep_cards WHERE id = ?').run(existing.id);
  res.status(204).end();
});

// ---------- المخيمات و الدورات ----------
// مخيم أو دورة أو رحلة: يوم أو أيام فيها جلسات عدّة، لمجموعة ثابتة من المشاركين، بقيمة
// اشتراك و مصاريف. صلاحياتها events.*: read لرؤيتها، manage لإنشائها و تعديل برنامجها و
// هيئتها و مشاركيها، attendance لحضور جلساتها و صورها، read.fees للمال كله — من لا يراه
// لا تصله أرقامه أصلًا — payments لقبض الاشتراكات، expenses للمصاريف و التبرعات، delete للحذف.

const EVENT_KINDS = ['camp', 'course', 'trip', 'other'];
const EXPENSE_CATEGORIES = ['transport', 'food', 'gear', 'venue', 'other'];
// مسؤوليات الهيئة القيادية، بترتيب عرضها — قائد المخيم في events.leader_id
const STAFF_ROLES = ['gathering', 'secretary', 'media', 'treasurer', 'gear', 'trainer', 'assistant', 'medic', 'other'];
const EVENT_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// نصّ اختياري مقصوص الأطراف: الفارغ NULL، و الأطول من الحدّ undefined (مرفوض)
function optionalText(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length <= max ? s : undefined;
}

// [ids] صحيحة موجبة بلا تكرار؛ null = طلب فاسد
const positiveIds = (v) =>
  v === undefined || v === null
    ? []
    : Array.isArray(v) && v.length <= 500 && v.every((n) => Number.isInteger(n) && n > 0)
      ? [...new Set(v)]
      : null;

const eventBranchIds = (eventId) =>
  db
    .prepare('SELECT branch_id FROM event_branches WHERE event_id = ? ORDER BY branch_id')
    .all(eventId)
    .map((r) => r.branch_id);

const eventGroupIds = (eventId) =>
  db
    .prepare('SELECT group_id FROM event_groups WHERE event_id = ? ORDER BY group_id')
    .all(eventId)
    .map((r) => r.group_id);

// نفس قاعدة النشاط: فرقةٌ اختيرت لها طليعة أو أكثر لا يُضاف منها إلا عناصر تلك الطلائع،
// و فرقةٌ لم تُختر لها طليعة تشارك كاملةً. مخيم بلا طلائع يقبل كل عناصر فرقه.
function memberInEventGroups(eventId, member) {
  const groups = db
    .prepare(
      `SELECT g.id, g.branch_id FROM event_groups eg JOIN branch_groups g ON g.id = eg.group_id
       WHERE eg.event_id = ?`
    )
    .all(eventId);
  if (!groups.some((g) => g.branch_id === member.branch_id)) return true;
  return groups.some((g) => g.id === member.group_id);
}

// كنطاق الأنشطة: قسم الطلب أولًا، ثم فرق الحساب المقيَّد — مخيم بلا فرق (الفوج كله) يمرّ
function eventScopeSQL(req, alias = 'e') {
  const section = activeSection(req);
  const bySection = section ? ` AND ${alias}.section = '${section}'` : '';
  const scope = allowedBranches(req);
  if (!scope) return bySection;
  const ids = [...scope].map(Number).filter(Number.isInteger);
  return `${bySection} AND (NOT EXISTS (SELECT 1 FROM event_branches eb WHERE eb.event_id = ${alias}.id)
      OR EXISTS (SELECT 1 FROM event_branches eb WHERE eb.event_id = ${alias}.id
                 AND eb.branch_id IN (${ids.length ? ids.join(',') : -1})))`;
}

function eventOk(req, ev) {
  const section = activeSection(req);
  if (section && ev.section !== section) return false;
  const scope = allowedBranches(req);
  if (!scope) return true;
  const ids = eventBranchIds(ev.id);
  return ids.length === 0 || ids.some((b) => scope.has(b));
}

// المخيم المطلوب بعد التحقّق من نطاقه، أو null بعد ردّ 404 / 403
function loadEvent(req, res) {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(intOr(req.params.id));
  if (!ev) {
    res.status(404).json({ error: 'event not found' });
    return null;
  }
  if (!eventOk(req, ev)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return ev;
}

// ما يُطلب من مشارك: مبلغه الخاص إن حُدّد (0 = معفى)، و إلا قيمة الاشتراك.
// الضيف لا يُطلب منه شيء: لا يُعدّ فيما ينتظره المخيم و لا فيمن لم يدفع.
const eventDueOf = (p, ev) => (p.guest_name ? 0 : (p.amount_due ?? ev.fee ?? 0));
const EVENT_DUE_SQL = (p, e) => `CASE WHEN ${p}.guest_name IS NOT NULL THEN 0 ELSE COALESCE(${p}.amount_due, ${e}.fee, 0) END`;

// حساب المخيم كله، من خانات المشاركين و التبرعات و المصاريف عند القراءة — لا مجموع يُخزَّن فيشيخ.
// العدّ بالحال: معفى، دفع (كامل المطلوب أو أكثر)، جزئي، لم يدفع؛ مخيم مجّاني لا حال فيه.
function eventSummary(ev) {
  const out = { participants: 0, expected: 0, collected: 0, outstanding: 0, paid: 0, partial: 0, unpaid: 0, exempt: 0 };
  // Whoever was taken off the list counts for nothing here: not as a participant, not as money due or paid
  for (const p of db
    .prepare('SELECT guest_name, amount_due, paid FROM event_participants WHERE event_id = ? AND withdrawn_at IS NULL')
    .all(ev.id)) {
    const due = eventDueOf(p, ev);
    const paid = p.paid ?? 0;
    out.participants += 1;
    out.expected += due;
    out.collected += paid;
    out.outstanding += Math.max(due - paid, 0);
    if (p.amount_due === 0 && !p.guest_name) out.exempt += 1;
    else if (due === 0) out.paid += paid > 0 ? 1 : 0;
    else if (paid >= due) out.paid += 1;
    else if (paid > 0) out.partial += 1;
    else out.unpaid += 1;
  }
  const sum = (table) =>
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM ${table} WHERE event_id = ?`).get(ev.id);
  const d = sum('event_donations');
  const x = sum('event_expenses');
  // Money from the caisses, and money handed back to them
  const f = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'to_event' THEN amount END), 0) AS funded,
         COALESCE(SUM(CASE WHEN direction = 'from_event' THEN amount END), 0) AS returned, COUNT(*) AS n
       FROM event_fundings WHERE event_id = ?`
    )
    .get(ev.id);
  return {
    ...out,
    donations: d.total,
    donation_count: d.n,
    expenses: x.total,
    expense_count: x.n,
    funded: f.funded,
    returned: f.returned,
    funding_count: f.n,
    balance: out.collected + d.total + f.funded - f.returned - x.total,
  };
}

// Les عناصر d'une شعبة d'adultes (العلياء, 18 ans et plus) partent sans autorisation parentale
const CONSENT_NEEDED_SQL = (m, b) => `(${m}.id IS NOT NULL AND COALESCE(${b}.min_age, 0) < 18)`;

// المشارك بشكل واحد أيًّا كان: اسم العنصر أو القائد، أو اسم الضيف وحده
const EVENT_PARTICIPANT_SQL = `
  SELECT p.id, p.member_id, p.leader_id, p.guest_name, p.amount_due, p.paid, p.paid_at, p.recorded_by,
    p.withdrawn_at, p.withdrawn_by,
    -- E1 : l'autorisation parentale ; le scan lui-même ne vient qu'à la demande
    p.consent_at, p.consent_by, p.consent_recorded_by, p.consent_scan IS NOT NULL AS consent_has_scan,
    ${CONSENT_NEEDED_SQL('m', 'b')} AS consent_needed,
    COALESCE(m.first_name, l.first_name) AS first_name,
    COALESCE(m.father_name, l.father_name) AS father_name,
    COALESCE(m.last_name, l.last_name) AS last_name,
    COALESCE(m.photo, l.photo) AS photo,
    COALESCE(m.status, l.status) AS status,
    m.branch_id, m.group_id, g.name AS group_name,
    b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
    -- E2 : la liste d'appel du dossier de camp — âge, groupe sanguin, téléphones (members.contact /
    -- leaders.contact, retirés sinon par participantOut)
    m.birth_date, m.sex, m.blood_type, m.father_phone, m.mother_phone, m.member_phone, l.phone AS leader_phone,
    -- دوره الجاري في طليعته (C1): العريف هو صلة الطليعة في المخيم
    (SELECT r.role FROM member_responsibilities r WHERE r.member_id = p.member_id AND r.end_date IS NULL
       AND r.role != 'other' ORDER BY r.id DESC LIMIT 1) AS member_role
  FROM event_participants p
  LEFT JOIN members m ON m.id = p.member_id
  LEFT JOIN branches b ON b.id = m.branch_id
  LEFT JOIN branch_groups g ON g.id = m.group_id
  LEFT JOIN leaders l ON l.id = p.leader_id
  WHERE p.event_id = ?`;

const stripParticipantFees = (req, p) =>
  hasPerm(req, 'events.read.fees') ? p : { ...p, amount_due: null, paid: null, paid_at: null, recorded_by: null };

// Un participant tel qu'il quitte le serveur : sans les montants (events.read.fees), sans les
// téléphones des parents (members.contact) ni celui du قائد (leaders.contact)
function participantOut(req, p) {
  if (!p) return p;
  const out = { ...stripParticipantFees(req, p) };
  if (!hasPerm(req, 'members.contact')) {
    out.father_phone = null;
    out.mother_phone = null;
    out.member_phone = null;
  }
  if (!hasPerm(req, 'leaders.contact')) out.leader_phone = null;
  return out;
}

const expensesOf = (eventId) =>
  db
    .prepare('SELECT * FROM event_expenses WHERE event_id = ? ORDER BY date IS NULL, date DESC, id DESC')
    .all(eventId);

// الهيئة القيادية بترتيب المسؤوليات، ثم بترتيب التعيين
const staffOf = (eventId) =>
  db
    .prepare(
      `SELECT st.id, st.role, st.title, st.leader_id, st.name,
         l.first_name, l.father_name, l.last_name, l.photo, l.status AS leader_status
       FROM event_staff st LEFT JOIN leaders l ON l.id = st.leader_id
       WHERE st.event_id = ? ORDER BY st.id`
    )
    .all(eventId)
    .sort((a, b) => STAFF_ROLES.indexOf(a.role) - STAFF_ROLES.indexOf(b.role));

// What the caisses gave this event, or got back from it — newest first
const fundingsOf = (eventId) =>
  db
    .prepare(
      `SELECT f.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
       FROM event_fundings f LEFT JOIN branches b ON b.id = f.branch_id
       WHERE f.event_id = ? ORDER BY f.date DESC, f.id DESC`
    )
    .all(eventId)
    .map((f) => ({
      id: f.id,
      direction: f.direction,
      amount: f.amount,
      date: f.date,
      label: f.label,
      section: f.section,
      box: boxKey(f.section, f.branch_id),
      branch_id: f.branch_id,
      branch_name_fr: f.branch_name_fr ?? null,
      branch_name_ar: f.branch_name_ar ?? null,
      created_by: f.created_by,
    }));

// The caisses of the event's قسم the caller holds, with what is in each: where money
// for it can come from or go back to. None for whoever does not write in caisses.
function eventFundingBoxes(req, ev) {
  if (!hasPerm(req, 'treasury.transfers')) return [];
  const openings = openingsOf([ev.section]);
  return treasuryBoxes(req)
    .filter((b) => b.visible && b.section === ev.section)
    .map(({ visible, ...box }) => {
      const l = boxLedger(box, openings);
      return { ...box, start: l.start, balance: l.balance };
    });
}

const donationsOf = (eventId) =>
  db
    .prepare('SELECT * FROM event_donations WHERE event_id = ? ORDER BY date IS NULL, date DESC, id DESC')
    .all(eventId);

// كل ما تعرضه صفحة المخيم في طلب واحد. عناصر الفرق الأخرى لا تصل الحساب المقيَّد —
// كلائحة النشاط المشترك — و القادة و الضيوف يراهم كل من يرى المخيم.
function eventPayload(req, ev) {
  const canFees = hasPerm(req, 'events.read.fees');
  ensureChecklist(ev);
  // E1 : la fiche santé des عناصر inscrits, pour members.health et les قادة du camp seulement
  const health = eventHealthMap(req, ev);
  // The list, and apart from it whoever was taken off it — a عنصر or قائد, whose file says he did
  // not take part. Same names for the same accounts; the second list reaches no count or payment.
  const peopleOf = (withdrawn) =>
    db
      .prepare(
        `${EVENT_PARTICIPANT_SQL} AND p.withdrawn_at IS ${withdrawn ? 'NOT ' : ''}NULL${branchFilterSQL(req, 'm.branch_id')}
         ORDER BY CASE WHEN p.member_id IS NOT NULL THEN 0 WHEN p.leader_id IS NOT NULL THEN 1 ELSE 2 END,
           b.sort_order, last_name, first_name, p.guest_name, p.id`
      )
      .all(ev.id)
      .map((p) => {
        const out = participantOut(req, p);
        out.consent_has_scan = !!p.consent_has_scan;
        out.consent_needed = !!p.consent_needed;
        if (health && p.member_id && health.has(p.member_id)) out.health = health.get(p.member_id);
        return out;
      });
  const participants = peopleOf(false);
  const withdrawn = peopleOf(true);
  const visible = new Set(participants.map((p) => p.id));
  return {
    ...ev,
    fee: canFees ? ev.fee : null,
    leader_name: ev.leader_id
      ? db.prepare(`SELECT ${fullNameSQL('l')} AS name FROM leaders l WHERE l.id = ?`).get(ev.leader_id)?.name ?? null
      : null,
    branch_ids: eventBranchIds(ev.id),
    group_ids: eventGroupIds(ev.id),
    staff: staffOf(ev.id),
    participants,
    withdrawn,
    // عدد المشاركين كلهم: الحساب المقيَّد يرى أسماء فرقه وحدها، و العدد يبقى عدد المخيم
    participant_total: db
      .prepare('SELECT COUNT(*) AS n FROM event_participants WHERE event_id = ? AND withdrawn_at IS NULL')
      .get(ev.id).n,
    // جلسة بلا ساعة تأتي بعد جلسات يومها المؤقّتة
    sessions: db
      .prepare("SELECT * FROM event_sessions WHERE event_id = ? ORDER BY date, COALESCE(start_time, '24:00'), id")
      .all(ev.id),
    attendance: db
      .prepare(
        `SELECT a.session_id, a.participant_id, a.status FROM event_attendance a
         JOIN event_sessions s ON s.id = a.session_id WHERE s.event_id = ?`
      )
      .all(ev.id)
      .filter((a) => visible.has(a.participant_id)),
    donations: canFees ? donationsOf(ev.id) : null,
    // صور المخيم و ملفاته، لكل من يراه
    files: filesOf('event', ev.id),
    expenses: canFees ? expensesOf(ev.id) : null,
    fundings: canFees ? fundingsOf(ev.id) : null,
    funding_boxes: canFees ? eventFundingBoxes(req, ev) : [],
    summary: canFees ? eventSummary(ev) : null,
    // تبويب التقييم و نقطته و العلامة في رأس الصفحة — null إن لم تكن لنوعه استمارة
    evaluation: evalSummaryOf(req, ev, EVENT_EVAL),
    // E1 : prêt à partir — autorisations, check-list sécurité, et qui peut quoi
    checklist: checklistOf(ev.id),
    readiness: eventReadiness(ev.id),
    health_visible: !!health,
    can_safety: hasPerm(req, 'events.manage') || isEventStaff(req, ev.id),
  };
}

// Validates the body shared by INSERT and UPDATE; `existing` is the event being edited.
function parseEvent(req, existing = null) {
  const b = req.body || {};
  const kind = b.kind === undefined ? (existing?.kind ?? 'camp') : b.kind;
  if (!EVENT_KINDS.includes(kind)) return { error: 'invalid kind' };
  const title = optionalText(b.title, 200);
  if (!title) return { error: 'invalid title' };
  if (!validISODate(b.start_date) || !validISODate(b.end_date) || b.end_date < b.start_date)
    return { error: 'invalid dates' };
  const place = optionalText(b.place, 200);
  const plan = optionalText(b.plan, 10000);
  if (place === undefined || plan === undefined) return { error: 'text too long' };
  // قيمة الاشتراك مال: من لا يراها لا يكتبها، و تعديله للمخيم لا يمحوها
  let fee = existing ? existing.fee : null;
  if (hasPerm(req, 'events.read.fees') && 'fee' in b) {
    fee = parsePaid(b.fee);
    if (fee === undefined) return { error: 'invalid fee' };
  }
  // الفرق المعنية. كل فرقة تُضاف من فرق المستخدم؛ و ما في المخيم من فرق لا يراها
  // (النموذج لم يعرضها له) يبقى كما كان، فلا يُسقطها حفظٌ لم يقصدها.
  const raw = Array.isArray(b.branch_ids) ? b.branch_ids : [];
  const picked = [...new Set(raw.map(Number))];
  const before = existing ? eventBranchIds(existing.id) : [];
  for (const id of picked) {
    if (!Number.isInteger(id) || !db.prepare('SELECT id FROM branches WHERE id = ?').get(id))
      return { error: 'invalid branch_ids' };
    if (!before.includes(id) && !branchOk(req, id)) return { error: 'forbidden', status: 403 };
  }
  const scope = allowedBranches(req);
  const branchIds = [...new Set([...picked, ...(scope ? before.filter((id) => !scope.has(id)) : [])])].sort(
    (x, y) => x - y
  );
  // لا يحفظ حسابٌ مقيَّد مخيمًا لم يعد يراه
  if (scope && branchIds.length && !branchIds.some((id) => scope.has(id))) return { error: 'forbidden', status: 403 };
  // الطلائع: كل طليعة من فرقة مختارة. و ما في المخيم من طلائع فرقٍ لا يراها الحساب المقيَّد
  // يبقى كما كان، كالفرق تمامًا.
  const pickedGroups = positiveIds(b.group_ids);
  if (pickedGroups === null) return { error: 'invalid group_ids' };
  const branchOfGroup = db.prepare('SELECT branch_id FROM branch_groups WHERE id = ?');
  for (const g of pickedGroups) {
    const row = branchOfGroup.get(g);
    if (!row || !branchIds.includes(row.branch_id)) return { error: 'invalid group_ids' };
    if (scope && !scope.has(row.branch_id)) return { error: 'forbidden', status: 403 };
  }
  const hiddenGroups = scope && existing
    ? eventGroupIds(existing.id).filter((g) => !scope.has(branchOfGroup.get(g)?.branch_id))
    : [];
  const groupIds = [...new Set([...pickedGroups, ...hiddenGroups])].sort((x, y) => x - y);
  // قسم المخيم: قسم فرقه، و إلا قسم الطلب، و إلا ما اختير في النموذج. ثابت بعد الإنشاء.
  if (b.section !== undefined && b.section !== null && b.section !== '' && !parseSection(b.section))
    return { error: 'invalid section' };
  const sections = [...new Set(branchIds.map(sectionOfBranch))];
  if (sections.length > 1) return { error: 'mixed_sections' };
  const section = existing ? existing.section : sections[0] || activeSection(req) || parseSection(b.section) || 'M';
  if (sections[0] && sections[0] !== section) return { error: 'mixed_sections' };
  let leaderId = null;
  if (b.leader_id !== undefined && b.leader_id !== null && b.leader_id !== '') {
    const l = db.prepare('SELECT id, status FROM leaders WHERE id = ? AND section = ?').get(intOr(b.leader_id), section);
    // قائد أُرشف يبقى على المخيم الذي قاده، و لا يُختار لمخيم جديد
    if (!l || (l.status !== 'active' && l.id !== existing?.leader_id)) return { error: 'invalid leader_id' };
    leaderId = l.id;
  }
  // أيام المخيم تبقى تسع برنامجه: لا تُقصَّر فتخرج منها جلسة مبرمجة
  if (existing) {
    const outside = db
      .prepare('SELECT COUNT(*) AS n FROM event_sessions WHERE event_id = ? AND (date < ? OR date > ?)')
      .get(existing.id, b.start_date, b.end_date).n;
    if (outside) return { error: 'sessions_outside_dates' };
  }
  return {
    values: { kind, title, start_date: b.start_date, end_date: b.end_date, place, fee, plan, leader_id: leaderId, section },
    branchIds,
    groupIds,
  };
}

const setEventBranches = (eventId, branchIds, groupIds = []) => {
  db.prepare('DELETE FROM event_branches WHERE event_id = ?').run(eventId);
  const insert = db.prepare('INSERT INTO event_branches (event_id, branch_id) VALUES (?, ?)');
  for (const b of branchIds) insert.run(eventId, b);
  db.prepare('DELETE FROM event_groups WHERE event_id = ?').run(eventId);
  const insertGroup = db.prepare('INSERT INTO event_groups (event_id, group_id) VALUES (?, ?)');
  for (const g of groupIds) insertGroup.run(eventId, g);
};

app.get('/api/events', requirePerm('events.read'), (req, res) => {
  const canFees = hasPerm(req, 'events.read.fees');
  const me = req.user.leader_id ? Number(req.user.leader_id) : 'NULL';
  const today = todayISO();
  let sql = `SELECT e.*, ${fullNameSQL('l')} AS leader_name,
      -- التقييم: عدد المقيِّمين و معدّلهم، هل لنوعه استمارة، و هل ينتظر تقييم صاحب الحساب
      (SELECT COUNT(*) FROM event_evaluations ev WHERE ev.event_id = e.id) AS eval_count,
      (SELECT AVG(ev.average) FROM event_evaluations ev WHERE ev.event_id = e.id) AS eval_avg,
      EXISTS (SELECT 1 FROM eval_kind_forms k WHERE k.kind = 'event_' || e.kind) AS eval_form,
      ${eventEvaluatorSQL('e', me)} AS eval_participant,
      EXISTS (SELECT 1 FROM event_evaluations ev WHERE ev.event_id = e.id AND ev.leader_id = ${me}) AS eval_mine,
      (SELECT GROUP_CONCAT(eb.branch_id) FROM event_branches eb WHERE eb.event_id = e.id) AS branch_ids,
      (SELECT GROUP_CONCAT(eg.group_id) FROM event_groups eg WHERE eg.event_id = e.id) AS group_ids,
      (SELECT COUNT(*) FROM event_participants p WHERE p.event_id = e.id AND p.withdrawn_at IS NULL) AS participant_count,
      (SELECT COUNT(*) FROM event_sessions s WHERE s.event_id = e.id) AS session_count,
      ${EVENT_READINESS_SQL('e')},
      (SELECT COALESCE(SUM(p.paid), 0) FROM event_participants p
         WHERE p.event_id = e.id AND p.withdrawn_at IS NULL) AS collected,
      (SELECT COALESCE(SUM(${EVENT_DUE_SQL('p', 'e')}), 0)
         FROM event_participants p WHERE p.event_id = e.id AND p.withdrawn_at IS NULL) AS expected,
      (SELECT COALESCE(SUM(MAX(${EVENT_DUE_SQL('p', 'e')} - COALESCE(p.paid, 0), 0)), 0)
         FROM event_participants p WHERE p.event_id = e.id AND p.withdrawn_at IS NULL) AS outstanding,
      -- E2 : qui doit encore, et combien de familles appeler (des frères et sœurs partagent le
      -- téléphone d'un parent : un seul appel)
      (SELECT COUNT(*) FROM event_participants p WHERE p.event_id = e.id AND p.withdrawn_at IS NULL
         AND COALESCE(p.paid, 0) < ${EVENT_DUE_SQL('p', 'e')}) AS unpaid_count,
      (SELECT COUNT(DISTINCT COALESCE(NULLIF(m.father_phone, ''), NULLIF(m.mother_phone, ''), 'p' || p.id))
         FROM event_participants p LEFT JOIN members m ON m.id = p.member_id
         WHERE p.event_id = e.id AND p.withdrawn_at IS NULL
           AND COALESCE(p.paid, 0) < ${EVENT_DUE_SQL('p', 'e')}) AS unpaid_families,
      (SELECT COALESCE(SUM(d.amount), 0) FROM event_donations d WHERE d.event_id = e.id) AS donations,
      (SELECT COALESCE(SUM(x.amount), 0) FROM event_expenses x WHERE x.event_id = e.id) AS expenses,
      (SELECT COALESCE(SUM(CASE WHEN f.direction = 'to_event' THEN f.amount ELSE -f.amount END), 0)
         FROM event_fundings f WHERE f.event_id = e.id) AS funded
    FROM events e LEFT JOIN leaders l ON l.id = e.leader_id
    WHERE 1=1${eventScopeSQL(req)}`;
  const params = [];
  if (EVENT_KINDS.includes(req.query.kind)) {
    sql += ' AND e.kind = ?';
    params.push(req.query.kind);
  }
  if (req.query.q) {
    // E2 : un participant aussi — un عنصر des فرق du compte, un قائد ou un invité
    sql += ` AND (e.title LIKE ? OR e.place LIKE ? OR ${fullNameSQL('l')} LIKE ?
      OR EXISTS (SELECT 1 FROM event_participants pq LEFT JOIN members mq ON mq.id = pq.member_id
        LEFT JOIN leaders lq ON lq.id = pq.leader_id
        WHERE pq.event_id = e.id AND pq.withdrawn_at IS NULL${branchFilterSQL(req, 'mq.branch_id')}
          AND (pq.guest_name LIKE ? OR ${fullNameSQL('mq')} LIKE ? OR ${fullNameSQL('lq')} LIKE ?)))`;
    const like = `%${req.query.q}%`;
    params.push(like, like, like, like, like, like);
  }
  sql += ' ORDER BY e.start_date DESC, e.id DESC';
  const money = ['fee', 'collected', 'expected', 'outstanding', 'unpaid_count', 'unpaid_families', 'donations', 'expenses', 'funded'];
  res.json(
    db
      .prepare(sql)
      .all(...params)
      .map(({ eval_count: evalCount, eval_avg: evalAvg, eval_form: evalForm, eval_participant: evalParticipant,
          eval_mine: evalMine, ...r }) => {
        // ينتظر تقييمه: قائد أخذ فيه دورًا، و بلغ يومه الأخير، و لم يقيّمه — فلا يرى معدّل غيره قبلها
        const pending = !!evalParticipant && !evalMine && r.end_date <= today;
        const out = {
          ...r,
          branch_ids: parseIdList(r.branch_ids),
          group_ids: parseIdList(r.group_ids),
          eval:
            evalForm || evalCount
              ? {
                  count: evalCount,
                  average:
                    (pending && req.user.role !== 'admin') || !hasPerm(req, 'evaluations.read') ? null : round2(evalAvg),
                  pending,
                }
              : null,
        };
        if (!canFees) for (const k of money) out[k] = null;
        return out;
      })
  );
});

app.get('/api/events/:id', requirePerm('events.read'), (req, res) => {
  const ev = loadEvent(req, res);
  if (ev) res.json(eventPayload(req, ev));
});

// صور المخيم أو التكوين و ملفاته (PDF، Excel) — بطريقة صور النشاط نفسها
fileRoutes('event', '/api/events/:id', loadEvent);

// مخيمات شخص واحد، لملفّه: ما شارك فيه، و للقائد ما كان مسؤوله و لو لم يكن مشاركًا.
// حضوره من جلساته المسجَّلة، و دفعه لمن يرى المبالغ. نطاق المخيمات نفسه كلائحتها.
// من أُزيل من لائحة مخيم يبقى فيه سطره، `withdrawn`: لم يشارك — لا حضور و لا دفع يُعرضان له.
function personEvents(req, column, id) {
  const canFees = hasPerm(req, 'events.read.fees');
  const asLeader = column === 'leader_id';
  return db
    .prepare(
      `SELECT e.id, e.kind, e.title, e.start_date, e.end_date, e.place, e.fee, e.section,
         CASE WHEN p.withdrawn_at IS NULL THEN p.id END AS participant_id, p.amount_due, p.paid,
         p.withdrawn_at IS NOT NULL AS withdrawn,
         ${asLeader ? 'e.leader_id = @id' : '0'} AS is_responsible,
         ${asLeader
           ? `(SELECT json_group_array(json_object('role', st.role, 'title', st.title)) FROM event_staff st
               WHERE st.event_id = e.id AND st.leader_id = @id)`
           : "'[]'"} AS roles,
         (SELECT COUNT(*) FROM event_sessions s WHERE s.event_id = e.id) AS session_count,
         (SELECT COUNT(*) FROM event_attendance a WHERE a.participant_id = p.id) AS marked,
         (SELECT COUNT(*) FROM event_attendance a WHERE a.participant_id = p.id AND a.status = 'present') AS present
       FROM events e
       LEFT JOIN event_participants p ON p.event_id = e.id AND p.${column} = @id
       WHERE (p.id IS NOT NULL${
         asLeader
           ? ' OR e.leader_id = @id OR EXISTS (SELECT 1 FROM event_staff st WHERE st.event_id = e.id AND st.leader_id = @id)'
           : ''
       })${eventScopeSQL(req)}
       ORDER BY e.start_date DESC, e.id DESC`
    )
    .all({ id })
    .map((r) => {
      const roles = JSON.parse(r.roles).sort((a, b) => STAFF_ROLES.indexOf(a.role) - STAFF_ROLES.indexOf(b.role));
      // A قائد taken off the list who still led it or held a post in it did take part, as that
      const off = !!r.withdrawn && !r.is_responsible && roles.length === 0;
      const counted = !r.withdrawn;
      return {
        ...r,
        withdrawn: off,
        is_responsible: !!r.is_responsible,
        roles,
        fee: canFees ? r.fee : null,
        amount_due: canFees && counted ? r.amount_due : null,
        paid: canFees && counted ? r.paid : null,
        marked: counted ? r.marked : 0,
        present: counted ? r.present : 0,
      };
    });
}

app.get('/api/members/:id/events', requirePerm('members.read'), requirePerm('events.read'), (req, res) => {
  const m = db.prepare('SELECT id, branch_id FROM members WHERE id = ?').get(intOr(req.params.id));
  if (!m) return res.status(404).json({ error: 'member not found' });
  if (!branchOk(req, m.branch_id)) return res.status(403).json({ error: 'forbidden' });
  res.json(personEvents(req, 'member_id', m.id));
});

app.get('/api/leaders/:id/events', requirePerm('leaders.read'), requirePerm('events.read'), (req, res) => {
  const l = db.prepare('SELECT id, section FROM leaders WHERE id = ?').get(intOr(req.params.id));
  if (!l) return res.status(404).json({ error: 'leader not found' });
  if (!leaderOk(req, l)) return res.status(403).json({ error: 'forbidden' });
  res.json(personEvents(req, 'leader_id', l.id));
});

app.post('/api/events', requirePerm('events.manage'), (req, res) => {
  const parsed = parseEvent(req);
  if (parsed.error) return res.status(parsed.status || 400).json({ error: parsed.error });
  const v = parsed.values;
  let id;
  db.transaction(() => {
    id = db
      .prepare(
        `INSERT INTO events (kind, title, start_date, end_date, place, fee, plan, leader_id, section, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(v.kind, v.title, v.start_date, v.end_date, v.place, v.fee, v.plan, v.leader_id, v.section,
        req.user.display_name || req.user.username).lastInsertRowid;
    setEventBranches(id, parsed.branchIds, parsed.groupIds);
  })();
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  auditEvent(req, 'create', 'event', id, null, { ...ev, branch_ids: parsed.branchIds, group_ids: parsed.groupIds });
  notifications.eventCreated(req, ev);
  notifications.eventRole(req, ev, ev.leader_id, 'chief');
  res.status(201).json(eventPayload(req, ev));
});

app.put('/api/events/:id', requirePerm('events.manage'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const parsed = parseEvent(req, ev);
  if (parsed.error) return res.status(parsed.status || 400).json({ error: parsed.error });
  const v = parsed.values;
  const branchesBefore = eventBranchIds(ev.id);
  const groupsBefore = eventGroupIds(ev.id);
  db.transaction(() => {
    db.prepare(
      `UPDATE events SET kind = ?, title = ?, start_date = ?, end_date = ?, place = ?, fee = ?, plan = ?,
         leader_id = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(v.kind, v.title, v.start_date, v.end_date, v.place, v.fee, v.plan, v.leader_id, ev.id);
    setEventBranches(ev.id, parsed.branchIds, parsed.groupIds);
  })();
  const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(ev.id);
  auditEvent(
    req,
    'update',
    'event',
    ev.id,
    { ...ev, branch_ids: branchesBefore, group_ids: groupsBefore },
    { ...updated, branch_ids: parsed.branchIds, group_ids: parsed.groupIds }
  );
  notifications.eventChanged(req, ev, updated);
  if (updated.leader_id !== ev.leader_id) notifications.eventRole(req, updated, updated.leader_id, 'chief');
  res.json(eventPayload(req, updated));
});

// المشاركون و البرنامج و الحضور و المصاريف تسقط معه (ON DELETE CASCADE)
app.delete('/api/events/:id', requirePerm('events.delete'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
  // صوره و ملفاته سقطت مع السطر (CASCADE): تبقى أن تُمحى من القرص
  fs.rm(ownerFilesDir('event', ev.id), { recursive: true, force: true }, () => {});
  auditEvent(req, 'delete', 'event', ev.id, ev, null);
  res.status(204).end();
});

// من يمكن إضافته: عناصر الفرق المعنية (أو فرق القسم كلها لمخيم الفوج) — و من فرق
// المستخدم وحدها — و قادة القسم الفعّالون، ما لم يكونوا مشاركين بعد. أسماء فقط.
app.get('/api/events/:id/candidates', requirePerm('events.manage'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const branchIds = eventBranchIds(ev.id);
  // أرقام الفرق من القاعدة و القسم مُتحقَّق منه، فدمجهما في النص آمن
  const pool = branchIds.length ? `m.branch_id IN (${branchIds.join(',')})` : `b.section = '${ev.section}'`;
  // Branches narrowed to some طلائع offer only those طلائع' عناصر; the others stay whole
  const groups = db
    .prepare(
      `SELECT g.id, g.branch_id FROM event_groups eg JOIN branch_groups g ON g.id = eg.group_id
       WHERE eg.event_id = ?`
    )
    .all(ev.id);
  const narrowed = [...new Set(groups.map((g) => g.branch_id))];
  const byGroup = groups.length
    ? ` AND (m.branch_id NOT IN (${narrowed.join(',')}) OR m.group_id IN (${groups.map((g) => g.id).join(',')}))`
    : '';
  const members = db
    .prepare(
      `SELECT m.id, m.first_name, m.father_name, m.last_name, m.branch_id, m.group_id, g.name AS group_name,
              b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
       FROM members m JOIN branches b ON b.id = m.branch_id LEFT JOIN branch_groups g ON g.id = m.group_id
       WHERE m.status = 'active' AND ${pool}${byGroup}${branchFilterSQL(req, 'm.branch_id')}
         AND NOT EXISTS (SELECT 1 FROM event_participants p WHERE p.event_id = ? AND p.member_id = m.id
                           AND p.withdrawn_at IS NULL)
       ORDER BY b.sort_order, b.id, m.last_name, m.first_name`
    )
    .all(ev.id);
  const leaders = db
    .prepare(
      `SELECT l.id, l.first_name, l.father_name, l.last_name FROM leaders l
       WHERE l.status = 'active' AND l.section = ?
         AND NOT EXISTS (SELECT 1 FROM event_participants p WHERE p.event_id = ? AND p.leader_id = l.id
                           AND p.withdrawn_at IS NULL)
       ORDER BY l.last_name, l.first_name`
    )
    .all(ev.section, ev.id);
  res.json({ members, leaders });
});

app.post('/api/events/:id/participants', requirePerm('events.manage'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const memberIds = positiveIds(req.body?.member_ids);
  const leaderIds = positiveIds(req.body?.leader_ids);
  const guestNames = parseGuestNames(req.body?.guest_names);
  if (memberIds === null || leaderIds === null || guestNames === null)
    return res.status(400).json({ error: 'invalid participants' });
  const branchIds = eventBranchIds(ev.id);
  const memberOf = db.prepare(
    'SELECT m.id, m.branch_id, m.group_id, m.status, b.section FROM members m JOIN branches b ON b.id = m.branch_id WHERE m.id = ?'
  );
  for (const id of memberIds) {
    const m = memberOf.get(id);
    if (
      !m ||
      m.status !== 'active' ||
      m.section !== ev.section ||
      (branchIds.length && !branchIds.includes(m.branch_id)) ||
      !memberInEventGroups(ev.id, m)
    )
      return res.status(400).json({ error: 'invalid member_ids' });
    if (!branchOk(req, m.branch_id)) return res.status(403).json({ error: 'forbidden_branch' });
  }
  for (const id of leaderIds)
    if (!db.prepare("SELECT id FROM leaders WHERE id = ? AND status = 'active' AND section = ?").get(id, ev.section))
      return res.status(400).json({ error: 'invalid leader_ids' });
  // الضيف نفسه لا يُسجَّل مرّتين، و لو كُتب اسمه بحالة أحرف أخرى
  const guests = new Set(
    db
      .prepare('SELECT guest_name FROM event_participants WHERE event_id = ? AND guest_name IS NOT NULL')
      .all(ev.id)
      .map((r) => r.guest_name.toLowerCase())
  );
  // Someone taken off the list earlier comes back on his own row, with what it held (payment,
  // présences) — not as a second one beside it. A row already on the list changes nothing.
  const reinstate = 'DO UPDATE SET withdrawn_at = NULL, withdrawn_by = NULL WHERE withdrawn_at IS NOT NULL';
  const insertMember = db.prepare(
    `INSERT INTO event_participants (event_id, member_id) VALUES (?, ?) ON CONFLICT(event_id, member_id) ${reinstate}`
  );
  const insertLeader = db.prepare(
    `INSERT INTO event_participants (event_id, leader_id) VALUES (?, ?) ON CONFLICT(event_id, leader_id) ${reinstate}`
  );
  const insertGuest = db.prepare('INSERT OR IGNORE INTO event_participants (event_id, guest_name) VALUES (?, ?)');
  let added = 0;
  // The قادة newly registered: each hears it
  const newLeaders = [];
  db.transaction(() => {
    for (const id of memberIds) added += insertMember.run(ev.id, id).changes;
    for (const id of leaderIds)
      if (insertLeader.run(ev.id, id).changes) {
        added += 1;
        newLeaders.push(id);
      }
    for (const name of guestNames) {
      if (guests.has(name.toLowerCase())) continue;
      guests.add(name.toLowerCase());
      added += insertGuest.run(ev.id, name).changes;
    }
  })();
  if (added)
    auditEvent(req, 'add_participants', 'event', ev.id, null, {
      member_ids: memberIds,
      leader_ids: leaderIds,
      guest_names: guestNames,
    });
  for (const id of newLeaders) notifications.eventRole(req, ev, id, 'participant');
  res.status(201).json(eventPayload(req, ev));
});

// المشارك المطلوب من هذا المخيم. الحساب المقيَّد لا يمسّ عناصر غير فرقه — كحضور النشاط المشترك.
function loadParticipant(req, res, ev) {
  const p = db
    .prepare(
      `SELECT p.*, m.branch_id FROM event_participants p LEFT JOIN members m ON m.id = p.member_id
       WHERE p.id = ? AND p.event_id = ?`
    )
    .get(intOr(req.params.pid), ev.id);
  if (!p) {
    res.status(404).json({ error: 'participant not found' });
    return null;
  }
  if (p.member_id && !branchOk(req, p.branch_id)) {
    res.status(403).json({ error: 'forbidden_branch' });
    return null;
  }
  return p;
}

// Taking someone off the list: a عنصر or قائد keeps his row, marked — his file then says he did not
// take part in this مخيم, and nothing counts him (money, présences, evaluators) until he is added
// again. A guest has no file to say it in, so he is simply struck off.
app.delete('/api/events/:id/participants/:pid', requirePerm('events.manage'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const p = loadParticipant(req, res, ev);
  if (!p) return;
  if (p.withdrawn_at) return res.json(eventPayload(req, ev));
  if (p.guest_name) db.prepare('DELETE FROM event_participants WHERE id = ?').run(p.id);
  else
    db.prepare("UPDATE event_participants SET withdrawn_at = datetime('now'), withdrawn_by = ? WHERE id = ?").run(
      req.user.display_name || req.user.username,
      p.id
    );
  auditEvent(req, 'remove_participant', 'event', ev.id, p, null);
  res.json(eventPayload(req, ev));
});

// الدفع: paid هو كل ما دفعه المشارك حتى الآن (NULL = لم يدفع). amount_due ما يُطلب منه
// إن خالف قيمة الاشتراك (0 = معفى، NULL = القيمة نفسها) — شرطٌ من شروط المخيم، فيضعه
// من يملك تعديله.
app.put('/api/events/:id/participants/:pid', requirePerm('events.payments'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const p = loadParticipant(req, res, ev);
  if (!p) return;
  // Off the list: nothing is due from him, nothing is taken
  if (p.withdrawn_at) return res.status(404).json({ error: 'participant not found' });
  const b = req.body || {};
  const sets = [];
  const params = [];
  if ('paid' in b) {
    const paid = parsePaid(b.paid);
    if (paid === undefined) return res.status(400).json({ error: 'invalid paid' });
    sets.push('paid = ?', "paid_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END", 'recorded_by = ?');
    params.push(paid, paid, req.user.display_name || req.user.username);
  }
  if ('amount_due' in b) {
    if (!hasPerm(req, 'events.manage')) return res.status(403).json({ error: 'forbidden' });
    const due = parsePaid(b.amount_due);
    if (due === undefined) return res.status(400).json({ error: 'invalid amount_due' });
    sets.push('amount_due = ?');
    params.push(due);
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  db.prepare(`UPDATE event_participants SET ${sets.join(', ')} WHERE id = ?`).run(...params, p.id);
  const after = db.prepare('SELECT * FROM event_participants WHERE id = ?').get(p.id);
  auditEvent(req, 'update', 'event_payment', p.id, p, after);
  res.json({
    participant: participantOut(req, db.prepare(`${EVENT_PARTICIPANT_SQL} AND p.id = ?`).get(ev.id, p.id)),
    summary: eventSummary(ev),
  });
});

// جلسة من البرنامج: يومها داخل أيام المخيم، و ساعتا البدء و الانتهاء اختياريتان — سهرة
// تنتهي بعد منتصف الليل مقبولة، فلا يُفرض أن تسبق الأولى الثانية.
function parseEventSession(req, ev) {
  const b = req.body || {};
  const title = optionalText(b.title, 200);
  if (!title) return { error: 'invalid title' };
  if (!validISODate(b.date)) return { error: 'invalid date' };
  if (b.date < ev.start_date || b.date > ev.end_date) return { error: 'date_outside_event' };
  const time = (v) => (v === undefined || v === null || v === '' ? null : String(v).slice(0, 5));
  const start = time(b.start_time);
  const end = time(b.end_time);
  if ((start && !EVENT_TIME_RE.test(start)) || (end && !EVENT_TIME_RE.test(end))) return { error: 'invalid time' };
  const responsible = optionalText(b.responsible, 120);
  const notes = optionalText(b.notes, 4000);
  if (responsible === undefined || notes === undefined) return { error: 'text too long' };
  return { values: [title, b.date, start, end, responsible, notes] };
}

const loadEventSession = (req, res, ev) => {
  const s = db.prepare('SELECT * FROM event_sessions WHERE id = ? AND event_id = ?').get(intOr(req.params.sid), ev.id);
  if (!s) res.status(404).json({ error: 'session not found' });
  return s || null;
};

app.post('/api/events/:id/sessions', requirePerm('events.manage'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const parsed = parseEventSession(req, ev);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  db.prepare(
    `INSERT INTO event_sessions (event_id, title, date, start_time, end_time, responsible, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(ev.id, ...parsed.values);
  res.status(201).json(eventPayload(req, ev));
});

app.put('/api/events/:id/sessions/:sid', requirePerm('events.manage'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const s = loadEventSession(req, res, ev);
  if (!s) return;
  const parsed = parseEventSession(req, ev);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  db.prepare(
    `UPDATE event_sessions SET title = ?, date = ?, start_time = ?, end_time = ?, responsible = ?, notes = ?
     WHERE id = ?`
  ).run(...parsed.values, s.id);
  res.json(eventPayload(req, ev));
});

// حضورها يسقط معها
app.delete('/api/events/:id/sessions/:sid', requirePerm('events.manage'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const s = loadEventSession(req, res, ev);
  if (!s) return;
  db.prepare('DELETE FROM event_sessions WHERE id = ?').run(s.id);
  auditEvent(req, 'delete', 'event_session', s.id, s, null);
  res.json(eventPayload(req, ev));
});

// حضور جلسة: records = [{ participant_id, status }]، و status = null يمسح التسجيل
app.post('/api/events/:id/sessions/:sid/attendance', requirePerm('events.attendance'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const s = loadEventSession(req, res, ev);
  if (!s) return;
  const records = Array.isArray(req.body?.records) ? req.body.records : [req.body || {}];
  if (records.length === 0 || records.length > 500) return res.status(400).json({ error: 'invalid records' });
  const participantOf = db.prepare(
    `SELECT p.id, p.member_id, m.branch_id FROM event_participants p LEFT JOIN members m ON m.id = p.member_id
     WHERE p.id = ? AND p.event_id = ? AND p.withdrawn_at IS NULL`
  );
  const upsert = db.prepare(
    `INSERT INTO event_attendance (session_id, participant_id, status) VALUES (?, ?, ?)
     ON CONFLICT(session_id, participant_id) DO UPDATE SET status = excluded.status`
  );
  const clear = db.prepare('DELETE FROM event_attendance WHERE session_id = ? AND participant_id = ?');
  try {
    db.transaction(() => {
      for (const r of records) {
        const status = r?.status ?? null;
        if (status !== null && !['present', 'absent', 'excused'].includes(status)) throw new Error('invalid status');
        const p = participantOf.get(intOr(r?.participant_id), ev.id);
        if (!p) throw new Error('invalid participant');
        if (p.member_id && !branchOk(req, p.branch_id)) throw new Error('forbidden_branch');
        if (status === null) clear.run(s.id, p.id);
        else upsert.run(s.id, p.id, status);
      }
    })();
  } catch (e) {
    return res.status(e.message === 'forbidden_branch' ? 403 : 400).json({ error: e.message });
  }
  res.json({ ok: true });
});

function parseExpense(req) {
  const b = req.body || {};
  const label = optionalText(b.label, 200);
  if (!label) return { error: 'invalid label' };
  const amount = parsePaid(b.amount);
  if (amount === undefined || amount === null) return { error: 'invalid amount' };
  const category = b.category === undefined || b.category === null || b.category === '' ? 'other' : b.category;
  if (!EXPENSE_CATEGORIES.includes(category)) return { error: 'invalid category' };
  const date = b.date === undefined || b.date === null || b.date === '' ? null : b.date;
  if (date !== null && !validISODate(date)) return { error: 'invalid date' };
  const paidBy = optionalText(b.paid_by, 120);
  if (paidBy === undefined) return { error: 'text too long' };
  return { values: [label, amount, category, date, paidBy] };
}

const loadExpense = (req, res, ev) => {
  const x = db.prepare('SELECT * FROM event_expenses WHERE id = ? AND event_id = ?').get(intOr(req.params.xid), ev.id);
  if (!x) res.status(404).json({ error: 'expense not found' });
  return x || null;
};

// المصاريف مال كذلك: تُكتب بصلاحية تعديل المخيم و رؤية المبالغ معًا
const requireEventMoney = [requirePerm('events.expenses')];
const expensesPayload = (ev) => ({ expenses: expensesOf(ev.id), summary: eventSummary(ev) });

app.post('/api/events/:id/expenses', ...requireEventMoney, (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const parsed = parseExpense(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const id = db
    .prepare(
      `INSERT INTO event_expenses (event_id, label, amount, category, date, paid_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(ev.id, ...parsed.values, req.user.display_name || req.user.username).lastInsertRowid;
  auditEvent(req, 'create', 'event_expense', id, null, db.prepare('SELECT * FROM event_expenses WHERE id = ?').get(id));
  res.status(201).json(expensesPayload(ev));
});

app.put('/api/events/:id/expenses/:xid', ...requireEventMoney, (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const x = loadExpense(req, res, ev);
  if (!x) return;
  const parsed = parseExpense(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  db.prepare('UPDATE event_expenses SET label = ?, amount = ?, category = ?, date = ?, paid_by = ? WHERE id = ?').run(
    ...parsed.values,
    x.id
  );
  auditEvent(req, 'update', 'event_expense', x.id, x, db.prepare('SELECT * FROM event_expenses WHERE id = ?').get(x.id));
  res.json(expensesPayload(ev));
});

app.delete('/api/events/:id/expenses/:xid', ...requireEventMoney, (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const x = loadExpense(req, res, ev);
  if (!x) return;
  db.prepare('DELETE FROM event_expenses WHERE id = ?').run(x.id);
  auditEvent(req, 'delete', 'event_expense', x.id, x, null);
  res.json(expensesPayload(ev));
});

// ---------- الهيئة القيادية ----------
// مسؤولية و صاحبها: قائد من قسم المخيم، أو اسم من خارج الفوج. القائد نفسه قد يجمع
// مسؤوليتين (أمين السر و الصندوق)، و المسؤولية الواحدة قد تُعطى لأكثر من واحد (المدرّبون).
function parseStaff(req, ev, existing = null) {
  const b = req.body || {};
  if (!STAFF_ROLES.includes(b.role)) return { error: 'invalid role' };
  const title = b.role === 'other' ? optionalText(b.title, 80) : null;
  if (title === undefined) return { error: 'text too long' };
  if (b.role === 'other' && !title) return { error: 'invalid title' };
  let leaderId = null;
  let name = null;
  if (b.leader_id !== undefined && b.leader_id !== null && b.leader_id !== '') {
    const l = db.prepare('SELECT id, status FROM leaders WHERE id = ? AND section = ?').get(intOr(b.leader_id), ev.section);
    // قائد أُرشف يبقى على مسؤوليته القديمة، و لا يُعيَّن لمسؤولية جديدة
    if (!l || (l.status !== 'active' && l.id !== existing?.leader_id)) return { error: 'invalid leader_id' };
    leaderId = l.id;
  } else {
    name = optionalText(b.name, 120);
    if (name === undefined) return { error: 'text too long' };
    if (!name) return { error: 'invalid name' };
  }
  if (leaderId) {
    const twice = db
      .prepare('SELECT id FROM event_staff WHERE event_id = ? AND role = ? AND leader_id = ? AND id != ?')
      .get(ev.id, b.role, leaderId, existing?.id ?? -1);
    if (twice && b.role !== 'other') return { error: 'staff_exists', status: 409 };
  }
  return { values: { role: b.role, title, leader_id: leaderId, name } };
}

const loadStaff = (req, res, ev) => {
  const st = db.prepare('SELECT * FROM event_staff WHERE id = ? AND event_id = ?').get(intOr(req.params.sid), ev.id);
  if (!st) res.status(404).json({ error: 'staff not found' });
  return st || null;
};

app.post('/api/events/:id/staff', requirePerm('events.manage'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const parsed = parseStaff(req, ev);
  if (parsed.error) return res.status(parsed.status || 400).json({ error: parsed.error });
  const v = parsed.values;
  const id = db
    .prepare('INSERT INTO event_staff (event_id, role, title, leader_id, name) VALUES (?, ?, ?, ?, ?)')
    .run(ev.id, v.role, v.title, v.leader_id, v.name).lastInsertRowid;
  auditEvent(req, 'create', 'event_staff', id, null, db.prepare('SELECT * FROM event_staff WHERE id = ?').get(id));
  notifications.eventRole(req, ev, v.leader_id, v.role, v.title);
  res.status(201).json({ staff: staffOf(ev.id) });
});

app.put('/api/events/:id/staff/:sid', requirePerm('events.manage'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const st = loadStaff(req, res, ev);
  if (!st) return;
  const parsed = parseStaff(req, ev, st);
  if (parsed.error) return res.status(parsed.status || 400).json({ error: parsed.error });
  const v = parsed.values;
  db.prepare('UPDATE event_staff SET role = ?, title = ?, leader_id = ?, name = ? WHERE id = ?').run(
    v.role, v.title, v.leader_id, v.name, st.id
  );
  auditEvent(req, 'update', 'event_staff', st.id, st, db.prepare('SELECT * FROM event_staff WHERE id = ?').get(st.id));
  // A new قائد in the post, or the same one given another post
  if (v.leader_id && (v.leader_id !== st.leader_id || v.role !== st.role))
    notifications.eventRole(req, ev, v.leader_id, v.role, v.title);
  res.json({ staff: staffOf(ev.id) });
});

app.delete('/api/events/:id/staff/:sid', requirePerm('events.manage'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const st = loadStaff(req, res, ev);
  if (!st) return;
  db.prepare('DELETE FROM event_staff WHERE id = ?').run(st.id);
  auditEvent(req, 'delete', 'event_staff', st.id, st, null);
  res.json({ staff: staffOf(ev.id) });
});

// ---------- Camp prêt à partir (E1) : santé, autorisations parentales, sécurité ----------

// Un قائد du camp : son chef, ou un membre de sa هيئة قيادية (le مسعف compris)
function isEventStaff(req, eventId) {
  const me = Number(req.user.leader_id);
  if (!Number.isInteger(me) || me <= 0) return false;
  return !!db
    .prepare(
      `SELECT 1 FROM events e WHERE e.id = @ev AND (e.leader_id = @me
         OR EXISTS (SELECT 1 FROM event_staff st WHERE st.event_id = e.id AND st.leader_id = @me))`
    )
    .get({ ev: eventId, me });
}

// La fiche santé d'un عنصر : members.health, ou قائد d'un camp en cours ou à venir (fini il y a
// moins de 3 jours) où il est inscrit. Rien d'autre ne l'ouvre.
function canReadHealth(req, memberId) {
  if (hasPerm(req, 'members.health')) return true;
  return hasPerm(req, 'events.read') && isStaffOfMember(req, memberId);
}

const healthOf = (m) => ({
  blood_type: m.blood_type ?? null,
  allergies: m.allergies ?? null,
  treatment: m.treatment ?? null,
  medical_notes: m.medical_notes ?? null,
  can_swim: m.can_swim === null || m.can_swim === undefined ? null : !!m.can_swim,
  emergency_name: m.emergency_name ?? null,
  emergency_phone: m.emergency_phone ?? null,
  updated_at: m.health_updated_at ?? null,
  updated_by: m.health_updated_by ?? null,
});

app.get('/api/members/:id/health', requirePerm('members.read'), (req, res) => {
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(intOr(req.params.id));
  if (!m) return res.status(404).json({ error: 'member not found' });
  if (!canReadHealth(req, m.id)) return res.status(403).json({ error: 'forbidden' });
  // Hors de ses فرق, seul un قائد d'un camp où il est inscrit passe
  if (!branchOk(req, m.branch_id) && !isStaffOfMember(req, m.id)) return res.status(403).json({ error: 'forbidden' });
  res.json({
    ...healthOf(m),
    can_edit: hasPerm(req, 'members.health') && hasPerm(req, 'members.edit') && branchOk(req, m.branch_id),
  });
});

// قائد d'un camp en cours ou à venir où l'عنصر est inscrit
function isStaffOfMember(req, memberId) {
  const me = Number(req.user.leader_id);
  if (!Number.isInteger(me) || me <= 0) return false;
  return !!db
    .prepare(
      `SELECT 1 FROM event_participants p JOIN events e ON e.id = p.event_id
       WHERE p.member_id = @m AND p.withdrawn_at IS NULL AND e.end_date >= date(@today, '-3 days')
         AND (e.leader_id = @me OR EXISTS (SELECT 1 FROM event_staff st WHERE st.event_id = e.id AND st.leader_id = @me))
       LIMIT 1`
    )
    .get({ m: memberId, me, today: todayISO() });
}

app.put('/api/members/:id/health', requirePerm('members.health'), requirePerm('members.edit'), (req, res) => {
  const existing = db.prepare('SELECT * FROM members WHERE id = ?').get(intOr(req.params.id));
  if (!existing) return res.status(404).json({ error: 'member not found' });
  if (!branchOk(req, existing.branch_id)) return res.status(403).json({ error: 'forbidden' });
  const b = req.body || {};
  const v = {
    allergies: optionalText(b.allergies, 1000),
    treatment: optionalText(b.treatment, 1000),
    medical_notes: optionalText(b.medical_notes, 2000),
    emergency_name: optionalText(b.emergency_name, 120),
    emergency_phone: optionalText(b.emergency_phone, 40),
  };
  if (Object.values(v).some((x) => x === undefined)) return res.status(400).json({ error: 'text too long' });
  if (b.can_swim !== undefined && b.can_swim !== null && typeof b.can_swim !== 'boolean')
    return res.status(400).json({ error: 'invalid can_swim' });
  const swim = b.can_swim === true ? 1 : b.can_swim === false ? 0 : null;
  // فصيلة الدم: هنا أيضًا، كي يُملأ الجزء الصحي كله في مكان واحد
  let blood = existing.blood_type;
  if ('blood_type' in b) {
    if (b.blood_type && !BLOOD_TYPES.includes(b.blood_type)) return res.status(400).json({ error: 'invalid blood_type' });
    blood = b.blood_type || null;
  }
  db.prepare(
    `UPDATE members SET allergies = ?, treatment = ?, medical_notes = ?, can_swim = ?, emergency_name = ?,
       emergency_phone = ?, blood_type = ?, health_updated_at = datetime('now'), health_updated_by = ? WHERE id = ?`
  ).run(v.allergies, v.treatment, v.medical_notes, swim, v.emergency_name, v.emergency_phone, blood,
    req.user.display_name || req.user.username, existing.id);
  const updated = db.prepare('SELECT * FROM members WHERE id = ?').get(existing.id);
  auditEvent(req, 'update', 'member_health', existing.id, healthOf(existing), healthOf(updated));
  res.json({ ...healthOf(updated), can_edit: true });
});

// La fiche santé des participants d'un camp, pour qui peut la lire : members.health, ou ses قادة
function eventHealthMap(req, ev) {
  if (!hasPerm(req, 'members.health') && !isEventStaff(req, ev.id)) return null;
  const out = new Map();
  for (const m of db
    .prepare(
      `SELECT m.* FROM members m JOIN event_participants p ON p.member_id = m.id
       WHERE p.event_id = ? AND p.withdrawn_at IS NULL`
    )
    .all(ev.id))
    out.set(m.id, healthOf(m));
  return out;
}

// La check-list sécurité par défaut d'un مخيم (montadamahdi, السلامة في المخيمات)
const SAFETY_ITEMS = ['kit', 'extinguisher', 'evacuation', 'assembly', 'site', 'first_aider'];
// Posée une seule fois par camp : un point supprimé reste supprimé
function ensureChecklist(ev) {
  if (!ev || ev.kind !== 'camp') return;
  const row = db.prepare('SELECT safety_seeded FROM events WHERE id = ?').get(ev.id);
  if (!row || row.safety_seeded) return;
  db.transaction(() => {
    const has = db.prepare('SELECT COUNT(*) AS n FROM event_checklist WHERE event_id = ?').get(ev.id).n;
    if (!has) {
      const insert = db.prepare('INSERT INTO event_checklist (event_id, item, sort_order) VALUES (?, ?, ?)');
      SAFETY_ITEMS.forEach((item, i) => insert.run(ev.id, item, i));
    }
    db.prepare('UPDATE events SET safety_seeded = 1 WHERE id = ?').run(ev.id);
  })();
}
// Au démarrage, les camps en cours et à venir reçoivent la leur
for (const ev of db
  .prepare("SELECT id, kind FROM events WHERE kind = 'camp' AND safety_seeded = 0 AND end_date >= ?")
  .all(todayISO()))
  ensureChecklist(ev);

const checklistOf = (eventId) =>
  db
    .prepare(
      `SELECT c.id, c.item, c.label, c.staff_id, c.done_at, c.done_by, c.sort_order,
         st.role AS staff_role, st.title AS staff_title, st.leader_id AS staff_leader_id,
         COALESCE(${fullNameSQL('l')}, st.name) AS staff_name
       FROM event_checklist c
       LEFT JOIN event_staff st ON st.id = c.staff_id
       LEFT JOIN leaders l ON l.id = st.leader_id
       WHERE c.event_id = ? ORDER BY c.sort_order, c.id`
    )
    .all(eventId);

// L'état «prêt à partir» : autorisations manquantes (عناصر inscrits), points de sécurité cochés
const EVENT_READINESS_SQL = (alias = 'e') => `
  (SELECT COUNT(*) FROM event_participants p LEFT JOIN members m ON m.id = p.member_id
     LEFT JOIN branches b ON b.id = m.branch_id
     WHERE p.event_id = ${alias}.id AND p.withdrawn_at IS NULL
     AND ${CONSENT_NEEDED_SQL('m', 'b')} AND p.consent_at IS NULL) AS consent_missing,
  (SELECT COUNT(*) FROM event_participants p LEFT JOIN members m ON m.id = p.member_id
     LEFT JOIN branches b ON b.id = m.branch_id
     WHERE p.event_id = ${alias}.id AND p.withdrawn_at IS NULL
     AND ${CONSENT_NEEDED_SQL('m', 'b')}) AS consent_total,
  (SELECT COUNT(*) FROM event_checklist c WHERE c.event_id = ${alias}.id) AS safety_total,
  (SELECT COUNT(*) FROM event_checklist c WHERE c.event_id = ${alias}.id AND c.done_at IS NOT NULL) AS safety_done`;

function eventReadiness(eventId) {
  return db.prepare(`SELECT ${EVENT_READINESS_SQL('e')} FROM events e WHERE e.id = ?`).get(eventId);
}

// Le scan de l'autorisation : une image ou un PDF, en data URL, comme les photos
function validScan(value) {
  const text = String(value);
  return text.length <= 2500000 && /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/i.test(text);
}

// Autorisation parentale : reçue le…, par… (le قائد qui l'a reçue), scan facultatif.
// Les قادة du camp la saisissent aussi, sans events.manage.
app.put('/api/events/:id/participants/:pid/consent', requirePerm('events.read'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  if (!hasPerm(req, 'events.manage') && !isEventStaff(req, ev.id)) return res.status(403).json({ error: 'forbidden' });
  const p = loadParticipant(req, res, ev);
  if (!p) return;
  if (p.withdrawn_at || !p.member_id) return res.status(404).json({ error: 'participant not found' });
  const b = req.body || {};
  const sets = [];
  const params = [];
  const removing = 'consent_at' in b && (b.consent_at === null || b.consent_at === '');
  if (removing) {
    // Retirée : la date, le nom et le scan partent ensemble
    sets.push('consent_at = NULL', 'consent_by = NULL', 'consent_scan = NULL', 'consent_recorded_by = NULL');
  } else {
    if ('consent_at' in b) {
      if (!validISODate(b.consent_at) || b.consent_at > todayISO()) return res.status(400).json({ error: 'invalid date' });
      const by = optionalText(b.consent_by, 120);
      if (by === undefined) return res.status(400).json({ error: 'text too long' });
      sets.push('consent_at = ?', 'consent_by = ?', 'consent_recorded_by = ?');
      params.push(b.consent_at, by || req.user.display_name || req.user.username, req.user.display_name || req.user.username);
    }
    if ('scan' in b) {
      if (b.scan === null || b.scan === '') sets.push('consent_scan = NULL');
      else {
        if (!validScan(b.scan)) return res.status(400).json({ error: 'invalid scan' });
        if (!p.consent_at && !('consent_at' in b)) return res.status(400).json({ error: 'consent_required' });
        sets.push('consent_scan = ?');
        params.push(b.scan);
      }
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  db.prepare(`UPDATE event_participants SET ${sets.join(', ')} WHERE id = ?`).run(...params, p.id);
  const after = db.prepare('SELECT * FROM event_participants WHERE id = ?').get(p.id);
  auditEvent(req, 'update', 'event_consent', p.id, p, after);
  res.json({
    participant: participantOut(req, db.prepare(`${EVENT_PARTICIPANT_SQL} AND p.id = ?`).get(ev.id, p.id)),
    readiness: eventReadiness(ev.id),
  });
});

app.get('/api/events/:id/participants/:pid/consent-scan', requirePerm('events.read'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const p = loadParticipant(req, res, ev);
  if (!p) return;
  if (!p.consent_scan) return res.status(404).json({ error: 'not found' });
  res.json({ scan: p.consent_scan });
});

const loadChecklistItem = (req, res, ev) => {
  const c = db.prepare('SELECT * FROM event_checklist WHERE id = ? AND event_id = ?').get(intOr(req.params.cid), ev.id);
  if (!c) res.status(404).json({ error: 'item not found' });
  return c || null;
};
// Le responsable d'un point : quelqu'un de la هيئة de ce camp, ou personne
function parseChecklistStaff(b, ev) {
  if (b.staff_id === undefined) return { skip: true };
  if (b.staff_id === null || b.staff_id === '') return { value: null };
  const st = db.prepare('SELECT id FROM event_staff WHERE id = ? AND event_id = ?').get(intOr(b.staff_id), ev.id);
  return st ? { value: st.id } : { error: 'invalid staff_id' };
}
const checklistReply = (ev) => ({ checklist: checklistOf(ev.id), readiness: eventReadiness(ev.id) });

app.post('/api/events/:id/checklist', requirePerm('events.manage'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const b = req.body || {};
  const item = SAFETY_ITEMS.includes(b.item) ? b.item : null;
  const label = item ? null : optionalText(b.label, 200);
  if (label === undefined) return res.status(400).json({ error: 'text too long' });
  if (!item && !label) return res.status(400).json({ error: 'invalid label' });
  const staff = parseChecklistStaff(b, ev);
  if (staff.error) return res.status(400).json({ error: staff.error });
  const order = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM event_checklist WHERE event_id = ?')
    .get(ev.id).n;
  const id = db
    .prepare('INSERT INTO event_checklist (event_id, item, label, staff_id, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(ev.id, item, label, staff.value ?? null, order).lastInsertRowid;
  auditEvent(req, 'create', 'event_checklist', id, null, db.prepare('SELECT * FROM event_checklist WHERE id = ?').get(id));
  res.status(201).json(checklistReply(ev));
});

// Cocher : un قائد du camp ou events.manage ; le libellé et le responsable : events.manage
app.put('/api/events/:id/checklist/:cid', requirePerm('events.read'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const c = loadChecklistItem(req, res, ev);
  if (!c) return;
  const manage = hasPerm(req, 'events.manage');
  const b = req.body || {};
  const sets = [];
  const params = [];
  if ('done' in b) {
    if (!manage && !isEventStaff(req, ev.id)) return res.status(403).json({ error: 'forbidden' });
    if (b.done) {
      if (!c.done_at) {
        sets.push("done_at = datetime('now')", 'done_by = ?');
        params.push(req.user.display_name || req.user.username);
      }
    } else sets.push('done_at = NULL', 'done_by = NULL');
  }
  if ('label' in b || 'staff_id' in b) {
    if (!manage) return res.status(403).json({ error: 'forbidden' });
    if ('label' in b && !c.item) {
      const label = optionalText(b.label, 200);
      if (!label) return res.status(400).json({ error: label === undefined ? 'text too long' : 'invalid label' });
      sets.push('label = ?');
      params.push(label);
    }
    const staff = parseChecklistStaff(b, ev);
    if (staff.error) return res.status(400).json({ error: staff.error });
    if (!staff.skip) {
      sets.push('staff_id = ?');
      params.push(staff.value);
    }
  }
  if (sets.length) {
    db.prepare(`UPDATE event_checklist SET ${sets.join(', ')} WHERE id = ?`).run(...params, c.id);
    auditEvent(req, 'update', 'event_checklist', c.id, c, db.prepare('SELECT * FROM event_checklist WHERE id = ?').get(c.id));
  }
  res.json(checklistReply(ev));
});

app.delete('/api/events/:id/checklist/:cid', requirePerm('events.manage'), (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const c = loadChecklistItem(req, res, ev);
  if (!c) return;
  db.prepare('DELETE FROM event_checklist WHERE id = ?').run(c.id);
  auditEvent(req, 'delete', 'event_checklist', c.id, c, null);
  res.json(checklistReply(ev));
});

// التبرعات: مبلغ و يوم و ملاحظة. لا اسم للمتبرّع — هكذا طُلبت.
function parseDonation(req) {
  const b = req.body || {};
  const amount = parsePaid(b.amount);
  if (!amount) return { error: 'invalid amount' };
  const date = b.date === undefined || b.date === null || b.date === '' ? null : b.date;
  if (date !== null && !validISODate(date)) return { error: 'invalid date' };
  const note = optionalText(b.note, 200);
  if (note === undefined) return { error: 'text too long' };
  return { values: [amount, date, note] };
}

const loadDonation = (req, res, ev) => {
  const d = db.prepare('SELECT * FROM event_donations WHERE id = ? AND event_id = ?').get(intOr(req.params.did), ev.id);
  if (!d) res.status(404).json({ error: 'donation not found' });
  return d || null;
};

const donationsPayload = (ev) => ({ donations: donationsOf(ev.id), summary: eventSummary(ev) });

app.post('/api/events/:id/donations', ...requireEventMoney, (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const parsed = parseDonation(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const id = db
    .prepare('INSERT INTO event_donations (event_id, amount, date, note, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(ev.id, ...parsed.values, req.user.display_name || req.user.username).lastInsertRowid;
  auditEvent(req, 'create', 'event_donation', id, null, db.prepare('SELECT * FROM event_donations WHERE id = ?').get(id));
  res.status(201).json(donationsPayload(ev));
});

app.put('/api/events/:id/donations/:did', ...requireEventMoney, (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const d = loadDonation(req, res, ev);
  if (!d) return;
  const parsed = parseDonation(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  db.prepare('UPDATE event_donations SET amount = ?, date = ?, note = ? WHERE id = ?').run(...parsed.values, d.id);
  auditEvent(req, 'update', 'event_donation', d.id, d, db.prepare('SELECT * FROM event_donations WHERE id = ?').get(d.id));
  res.json(donationsPayload(ev));
});

app.delete('/api/events/:id/donations/:did', ...requireEventMoney, (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const d = loadDonation(req, res, ev);
  if (!d) return;
  db.prepare('DELETE FROM event_donations WHERE id = ?').run(d.id);
  auditEvent(req, 'delete', 'event_donation', d.id, d, null);
  res.json(donationsPayload(ev));
});

// ---------- المخيم و الصناديق ----------
// مال يُؤخذ من صندوق للمخيم، أو يُعاد إليه منه. يكتبه من يمسك ذلك الصندوق و يرى مال
// المخيم؛ يظهر في الصندوق و في حساب المخيم معًا.

function parseFunding(req, ev) {
  const b = req.body || {};
  if (!['to_event', 'from_event'].includes(b.direction)) return { error: 'invalid direction' };
  const box = visibleBox(req, b.box);
  if (!box || box.section !== ev.section) return { error: 'invalid box' };
  const amount = parsePaid(b.amount);
  if (!amount) return { error: 'invalid amount' };
  if (!validISODate(b.date)) return { error: 'invalid date' };
  const label = optionalText(b.label, 200);
  if (label === undefined) return { error: 'text too long' };
  return {
    values: { section: box.section, branch_id: box.branch_id, direction: b.direction, amount, date: b.date, label },
  };
}

const fundingById = (id) => db.prepare('SELECT * FROM event_fundings WHERE id = ?').get(id);

// The line, when it belongs to this event and its caisse is one the caller holds
function loadFunding(req, res, ev) {
  const f = db.prepare('SELECT * FROM event_fundings WHERE id = ? AND event_id = ?').get(intOr(req.params.fid), ev.id);
  if (!f || !visibleBox(req, boxKey(f.section, f.branch_id))) {
    res.status(404).json({ error: 'funding not found' });
    return null;
  }
  return f;
}

const requireEventCaisse = [requirePerm('treasury.transfers'), requirePerm('events.read.fees')];
const fundingsPayload = (req, ev) => ({
  fundings: fundingsOf(ev.id),
  funding_boxes: eventFundingBoxes(req, ev),
  summary: eventSummary(ev),
});

app.post('/api/events/:id/fundings', ...requireEventCaisse, (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const parsed = parseFunding(req, ev);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.values;
  const id = db
    .prepare(
      `INSERT INTO event_fundings (event_id, section, branch_id, direction, amount, date, label, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(ev.id, v.section, v.branch_id, v.direction, v.amount, v.date, v.label, actorName(req)).lastInsertRowid;
  auditEvent(req, 'create', 'event_funding', id, null, fundingById(id));
  res.status(201).json(fundingsPayload(req, ev));
});

app.put('/api/events/:id/fundings/:fid', ...requireEventCaisse, (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const f = loadFunding(req, res, ev);
  if (!f) return;
  const parsed = parseFunding(req, ev);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.values;
  db.prepare(
    `UPDATE event_fundings SET section = ?, branch_id = ?, direction = ?, amount = ?, date = ?, label = ?,
       updated_by = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(v.section, v.branch_id, v.direction, v.amount, v.date, v.label, actorName(req), f.id);
  auditEvent(req, 'update', 'event_funding', f.id, f, fundingById(f.id));
  res.json(fundingsPayload(req, ev));
});

app.delete('/api/events/:id/fundings/:fid', ...requireEventCaisse, (req, res) => {
  const ev = loadEvent(req, res);
  if (!ev) return;
  const f = loadFunding(req, res, ev);
  if (!f) return;
  db.prepare('DELETE FROM event_fundings WHERE id = ?').run(f.id);
  auditEvent(req, 'delete', 'event_funding', f.id, f, null);
  res.json(fundingsPayload(req, ev));
});

// ---------- الاجتماعات ----------
// محضر كل اجتماع: الموضوع و سببه، الحضور، بنود جدول الأعمال و ما دار فيها، و القرارات
// بمسؤوليها و مهلها — ثم متابعة القرارات من اجتماع إلى آخر. صلاحياتها meetings.*: read
// لقراءة المحاضر، manage لكتابتها، followup لمتابعة قراراتها وحدها، delete لحذفها. النطاق
// كالأنشطة: قسم الطلب أولًا، ثم فرق الحساب المقيَّد — اجتماع الفوج (بلا فرقة) يمرّ.

const MEETING_KINDS = ['leaders', 'branch', 'amana', 'prep', 'review', 'parents', 'other'];
// أنواع قديمة: تبقى مقروءة في المحاضر التي كُتبت بها، و لا يُفتح بها اجتماع جديد (كالواجهة،
// client/src/lib/meetings.js LEGACY_MEETING_KINDS)
const LEGACY_MEETING_KINDS = ['prep', 'review', 'parents'];
const DECISION_STATUSES = ['open', 'done', 'dropped'];
const ATTENDANCE_STATUSES = ['present', 'absent', 'excused'];
const optionalISODate = (v) => (v === undefined || v === null || v === '' ? null : validISODate(v) ? v : undefined);
const leaderFullName = (l) => [l.first_name, l.father_name, l.last_name].filter(Boolean).join(' ');

// الفرق المعنية بالاجتماع في meeting_branches؛ لا صف = اجتماع الفوج. meetings.branch_id هو
// الفرقة الرئيسية فقط (أولى المختارة) — تعتمد عليها متابعة الاجتماع السابق، كما في الأنشطة.
const meetingBranchIds = (meetingId) =>
  db
    .prepare('SELECT branch_id FROM meeting_branches WHERE meeting_id = ? ORDER BY branch_id')
    .all(meetingId)
    .map((r) => r.branch_id);

// كنطاق الأنشطة: قسم الطلب أولًا، ثم فرق الحساب المقيَّد — اجتماع بلا فرق (الفوج) يمرّ
const meetingScopeSQL = (req, alias = 'm') => {
  const section = activeSection(req);
  const bySection = section ? ` AND ${alias}.section = '${section}'` : '';
  const scope = allowedBranches(req);
  if (!scope) return bySection;
  const ids = [...scope].map(Number).filter(Number.isInteger);
  return `${bySection} AND (NOT EXISTS (SELECT 1 FROM meeting_branches mb WHERE mb.meeting_id = ${alias}.id)
      OR EXISTS (SELECT 1 FROM meeting_branches mb WHERE mb.meeting_id = ${alias}.id
                 AND mb.branch_id IN (${ids.length ? ids.join(',') : -1})))`;
};

const meetingOk = (req, m) => {
  const section = activeSection(req);
  if (section && m.section !== section) return false;
  const scope = allowedBranches(req);
  if (!scope) return true;
  const ids = meetingBranchIds(m.id);
  return ids.length === 0 || ids.some((b) => scope.has(b));
};

// كل اجتماع مع فرقه ({ id, name_fr, name_ar }) و أرقامها
function withMeetingBranches(rows) {
  const by = new Map();
  const links = db
    .prepare(
      `SELECT mb.meeting_id, b.id, b.name_fr, b.name_ar FROM meeting_branches mb
       JOIN branches b ON b.id = mb.branch_id ORDER BY b.sort_order, b.id`
    )
    .all();
  for (const r of links) {
    if (!by.has(r.meeting_id)) by.set(r.meeting_id, []);
    by.get(r.meeting_id).push({ id: r.id, name_fr: r.name_fr, name_ar: r.name_ar });
  }
  return rows.map((m) => {
    const branches = by.get(m.id) || [];
    return { ...m, branches, branch_ids: branches.map((b) => b.id) };
  });
}

// الاجتماع المطلوب بعد التحقّق من نطاقه، أو null بعد ردّ 404 / 403
function loadMeeting(req, res) {
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(intOr(req.params.id));
  if (!m) {
    res.status(404).json({ error: 'meeting not found' });
    return null;
  }
  if (!meetingOk(req, m)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return m;
}

// الأسماء: القائد كما هو اليوم، و إلا الاسم المحفوظ معه، و إلا الاسم المكتوب لمن هو من خارج الفوج
const MEETING_COLUMNS = `m.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
    COALESCE(${fullNameSQL('c')}, m.chair_name) AS chair,
    COALESCE(${fullNameSQL('sec')}, m.secretary_name) AS secretary`;
const MEETING_JOINS = `FROM meetings m
    LEFT JOIN branches b ON b.id = m.branch_id
    LEFT JOIN leaders c ON c.id = m.chair_id
    LEFT JOIN leaders sec ON sec.id = m.secretary_id`;

// القادة أولًا بأسمائهم، ثم الضيوف بترتيب إضافتهم
const attendeesOf = (meetingId) =>
  db
    .prepare(
      `SELECT a.id, a.guest, a.leader_id, a.status, COALESCE(${fullNameSQL('l')}, a.name) AS name,
         l.first_name, l.father_name, l.last_name, l.photo, l.status AS leader_status
       FROM meeting_attendees a LEFT JOIN leaders l ON l.id = a.leader_id
       WHERE a.meeting_id = ?
       ORDER BY a.guest, CASE WHEN a.guest = 1 THEN a.id END, COALESCE(l.last_name, a.name), l.first_name, a.id`
    )
    .all(meetingId)
    .map((a) => ({ ...a, guest: !!a.guest }));

const itemsOf = (meetingId) =>
  db
    .prepare('SELECT id, position, title, discussion FROM meeting_items WHERE meeting_id = ? ORDER BY position, id')
    .all(meetingId);

const DECISION_COLUMNS = `d.id, d.meeting_id, d.position, d.text, d.leader_id, d.due_date, d.status, d.status_at,
    d.status_by, d.created_by, d.created_at, COALESCE(${fullNameSQL('o')}, d.owner) AS owner`;

const decisionsOf = (meetingId) =>
  db
    .prepare(
      `SELECT ${DECISION_COLUMNS} FROM meeting_decisions d LEFT JOIN leaders o ON o.id = d.leader_id
       WHERE d.meeting_id = ? ORDER BY d.position, d.id`
    )
    .all(meetingId);

// «متابعة تكاليف الجلسة الماضية»: قرارات الاجتماعات التي سبقته في نطاقه نفسه (اجتماعات
// الفوج، أو اجتماعات تشاركه فرقةً واحدة على الأقل من فرقه في meeting_branches — اجتماعٌ
// لعدّة فرق يتابع قرارات كل فرقه، لا الأولى وحدها): ما بقي قيد التنفيذ، و ما نُفِّذ أو أُلغي
// منذ الاجتماع السابق — ما أُغلق قبله تابعه محضرُ ذلك الاجتماع.
const SAME_SCOPE_SQL = `p.section = @section AND (CASE WHEN @branches = '[]'
    THEN NOT EXISTS (SELECT 1 FROM meeting_branches x WHERE x.meeting_id = p.id)
    ELSE EXISTS (SELECT 1 FROM meeting_branches x WHERE x.meeting_id = p.id
                 AND x.branch_id IN (SELECT value FROM json_each(@branches))) END)`;
const EARLIER_MEETING_SQL = `${SAME_SCOPE_SQL} AND (p.date < @date OR (p.date = @date AND p.id < @id))`;
const meetingScopeOf = (m) => ({
  section: m.section,
  branches: JSON.stringify(m.branch_ids || meetingBranchIds(m.id)),
  date: m.date,
  id: m.id,
});
function followupsOf(m) {
  const scope = meetingScopeOf(m);
  const previous = db
    .prepare(`SELECT p.date FROM meetings p WHERE ${EARLIER_MEETING_SQL} ORDER BY p.date DESC, p.id DESC LIMIT 1`)
    .get(scope);
  if (!previous) return [];
  return db
    .prepare(
      `SELECT ${DECISION_COLUMNS}, p.title AS meeting_title, p.date AS meeting_date
       FROM meeting_decisions d
       JOIN meetings p ON p.id = d.meeting_id
       LEFT JOIN leaders o ON o.id = d.leader_id
       WHERE ${EARLIER_MEETING_SQL} AND (d.status = 'open' OR d.status_at >= @since)
       ORDER BY p.date, p.id, d.position, d.id
       LIMIT 100`
    )
    .all({ ...scope, since: previous.date });
}

// «الاجتماع المقبل» (next_date): الاجتماع المفتوح في ذلك اليوم في النطاق نفسه، إن فُتح —
// و إلا تعرض الصفحة زرّ فتحه بما يُعرف عنه مسبقًا
const nextMeetingOf = (m) =>
  m.next_date
    ? db
        .prepare(`SELECT p.id FROM meetings p WHERE ${SAME_SCOPE_SQL} AND p.date = @next AND p.id != @id ORDER BY p.id LIMIT 1`)
        .get({ ...meetingScopeOf(m), next: m.next_date })?.id ?? null
    : null;

// اجتماع فرقة أو أكثر: قادتها في تشكيلة السنة الأخيرة — يقترحهم الحضور أولًا، و الباقون
// بطلب. [] لاجتماع الفوج أو لفرق لا تشكيلة لها بعد: الحضور يقترح القسم كله.
const meetingBranchLeaderIds = (branchIds) => {
  const year = latestYear();
  if (!year || !branchIds.length) return [];
  return db
    .prepare(
      `SELECT DISTINCT a.leader_id AS id FROM assignments a
       WHERE a.year = ? AND a.leader_id IS NOT NULL AND a.branch_id IN (SELECT value FROM json_each(?))`
    )
    .all(year, JSON.stringify(branchIds))
    .map((r) => r.id);
};

// المحضر كله في طلب واحد
const meetingPayload = (m) => {
  const row = withMeetingBranches([db.prepare(`SELECT ${MEETING_COLUMNS} ${MEETING_JOINS} WHERE m.id = ?`).get(m.id)])[0];
  return {
    ...row,
    attendees: attendeesOf(m.id),
    followups: followupsOf(row),
    next_meeting_id: nextMeetingOf(row),
    branch_leader_ids: meetingBranchLeaderIds(row.branch_ids),
    items: itemsOf(m.id),
    decisions: decisionsOf(m.id),
  };
};

// كل تعديل في المحضر — حضور، بند، قرار — تعديلٌ له: «آخر تعديل» يقوله
const touchMeeting = (req, id) =>
  db.prepare("UPDATE meetings SET updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(actorName(req), id);

// رئيس الاجتماع، أمين السر، المسؤول عن قرار: قائد من قسم الاجتماع — قائدٌ أُرشف يبقى
// حيث كان و لا يُختار من جديد — أو اسم من خارج الفوج. { id, name } أو null إن لم يُذكر أحد.
function parsePerson(rawId, rawName, section, keepId = null) {
  if (rawId !== undefined && rawId !== null && rawId !== '') {
    const l = db.prepare('SELECT * FROM leaders WHERE id = ? AND section = ?').get(intOr(rawId), section);
    if (!l || (l.status !== 'active' && l.id !== keepId)) return { error: 'invalid leader_id' };
    return { id: l.id, name: leaderFullName(l) };
  }
  const name = optionalText(rawName, 120);
  if (name === undefined) return { error: 'text too long' };
  return { id: null, name };
}

// Validates the body shared by INSERT and UPDATE; `existing` is the meeting being edited.
function parseMeeting(req, existing = null) {
  const b = req.body || {};
  const kind = b.kind === undefined ? (existing?.kind ?? 'leaders') : b.kind;
  if (!MEETING_KINDS.includes(kind)) return { error: 'invalid kind' };
  if (LEGACY_MEETING_KINDS.includes(kind) && kind !== existing?.kind) return { error: 'invalid kind' };
  const title = optionalText(b.title, 200);
  if (!title) return { error: 'invalid title' };
  if (!validISODate(b.date)) return { error: 'invalid date' };
  const [start, end] = [b.start_time, b.end_time].map((v) => (v === undefined || v === null || v === '' ? null : String(v)));
  if ((start && !EVENT_TIME_RE.test(start)) || (end && !EVENT_TIME_RE.test(end))) return { error: 'invalid time' };
  if (start && end && end < start) return { error: 'invalid_times' };
  const purpose = optionalText(b.purpose, 2000);
  const place = optionalText(b.place, 200);
  const notes = optionalText(b.notes, 10000);
  if (purpose === undefined || place === undefined || notes === undefined) return { error: 'text too long' };
  const nextDate = optionalISODate(b.next_date);
  if (nextDate === undefined) return { error: 'invalid next_date' };
  // الفرق المعنية: كل فرقة من فرق المستخدم؛ و ما في الاجتماع من فرق لا يراها (النموذج لم
  // يعرضها له) يبقى كما كان. بلا فرق: اجتماع الفوج. branch_id القديم يُقبل فرقةً وحيدة.
  const raw = Array.isArray(b.branch_ids)
    ? b.branch_ids
    : b.branch_id !== undefined && b.branch_id !== null && b.branch_id !== ''
      ? [b.branch_id]
      : [];
  const picked = [...new Set(raw.map(Number))];
  const before = existing ? meetingBranchIds(existing.id) : [];
  for (const id of picked) {
    if (!Number.isInteger(id) || !db.prepare('SELECT id FROM branches WHERE id = ?').get(id))
      return { error: 'invalid branch_ids' };
    if (!before.includes(id) && !branchOk(req, id)) return { error: 'forbidden', status: 403 };
  }
  const scope = allowedBranches(req);
  const branchIds = [...new Set([...picked, ...(scope ? before.filter((id) => !scope.has(id)) : [])])].sort(
    (x, y) => x - y
  );
  // لا يحفظ حسابٌ مقيَّد اجتماعًا لم يعد يراه
  if (scope && branchIds.length && !branchIds.some((id) => scope.has(id))) return { error: 'forbidden', status: 403 };
  const branchId = branchIds[0] ?? null;
  if (b.section !== undefined && b.section !== null && b.section !== '' && !parseSection(b.section))
    return { error: 'invalid section' };
  // قسم الاجتماع: قسم فرقته، و إلا قسم الطلب، و إلا ما اختير في النموذج. ثابت بعد الإنشاء
  const branchSections = [...new Set(branchIds.map(sectionOfBranch))];
  if (branchSections.length > 1) return { error: 'mixed_sections' };
  const branchSection = branchSections[0] || null;
  const section = existing ? existing.section : branchSection || activeSection(req) || parseSection(b.section) || 'M';
  if (branchSection && branchSection !== section) return { error: 'mixed_sections' };
  const chair = parsePerson(b.chair_id, b.chair_name, section, existing?.chair_id);
  if (chair.error) return { error: chair.error };
  const secretary = parsePerson(b.secretary_id, b.secretary_name, section, existing?.secretary_id);
  if (secretary.error) return { error: secretary.error };
  return {
    values: {
      kind,
      title,
      purpose,
      date: b.date,
      start_time: start,
      end_time: end,
      place,
      branch_id: branchId,
      section,
      chair_id: chair.id,
      chair_name: chair.name,
      secretary_id: secretary.id,
      secretary_name: secretary.name,
      notes,
      next_date: nextDate,
    },
    branchIds,
  };
}

const setMeetingBranches = (meetingId, branchIds) => {
  db.prepare('DELETE FROM meeting_branches WHERE meeting_id = ?').run(meetingId);
  const insert = db.prepare('INSERT INTO meeting_branches (meeting_id, branch_id) VALUES (?, ?)');
  for (const b of branchIds) insert.run(meetingId, b);
};

// جدول الأعمال يُكتب عند الإنشاء سطرًا لكل بند؛ ما دار فيها يُكتب بعدها
function parseAgenda(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 50) return null;
  const titles = v.map((x) => optionalText(x, 200));
  return titles.includes(undefined) ? null : titles.filter(Boolean);
}

app.get('/api/meetings', requirePerm('meetings.read'), (req, res) => {
  const { q, kind, branch, from, to } = req.query;
  const params = { today: todayISO() };
  const count = (table, where) => `(SELECT COUNT(*) FROM ${table} x WHERE x.meeting_id = m.id AND ${where})`;
  let sql = `SELECT ${MEETING_COLUMNS},
      ${count('meeting_attendees', "x.guest = 0 AND x.status = 'present'")} AS present_count,
      ${count('meeting_attendees', "x.guest = 0 AND x.status = 'absent'")} AS absent_count,
      ${count('meeting_attendees', "x.guest = 0 AND x.status = 'excused'")} AS excused_count,
      ${count('meeting_attendees', 'x.guest = 1')} AS guest_count,
      ${count('meeting_items', '1')} AS item_count,
      ${count('meeting_decisions', '1')} AS decision_count,
      ${count('meeting_decisions', "x.status = 'open'")} AS open_count,
      ${count('meeting_decisions', "x.status = 'open' AND x.due_date < @today")} AS overdue_count
    ${MEETING_JOINS}
    WHERE 1=1${meetingScopeSQL(req)}`;
  if (MEETING_KINDS.includes(kind)) {
    sql += ' AND m.kind = @kind';
    params.kind = kind;
  }
  // 'group' = اجتماعات الفوج وحدها
  if (branch === 'group') sql += ' AND NOT EXISTS (SELECT 1 FROM meeting_branches f WHERE f.meeting_id = m.id)';
  else if (branch)
    sql += ` AND EXISTS (SELECT 1 FROM meeting_branches f WHERE f.meeting_id = m.id AND f.branch_id = ${intOr(branch)})`;
  if (validISODate(from)) {
    sql += ' AND m.date >= @from';
    params.from = from;
  }
  if (validISODate(to)) {
    sql += ' AND m.date <= @to';
    params.to = to;
  }
  // ما قيل و ما تقرّر يُبحث فيه أيضًا: «ماذا قرّرنا في اللباس؟»
  if (q && String(q).trim()) {
    params.q = `%${String(q).trim()}%`;
    sql += ` AND (m.title LIKE @q OR m.purpose LIKE @q OR m.place LIKE @q OR m.notes LIKE @q
      OR EXISTS (SELECT 1 FROM meeting_items i WHERE i.meeting_id = m.id AND (i.title LIKE @q OR i.discussion LIKE @q))
      OR EXISTS (SELECT 1 FROM meeting_decisions d WHERE d.meeting_id = m.id AND d.text LIKE @q))`;
  }
  sql += " ORDER BY m.date DESC, COALESCE(m.start_time, '') DESC, m.id DESC";
  res.json(withMeetingBranches(db.prepare(sql).all(params)));
});

// متابعة القرارات عبر الاجتماعات: ما لم يُنفَّذ أولًا بمهله (الأقرب فالأبعد، و بلا مهلة
// آخرًا)، ثم المنفَّذ و الملغى من الأحدث. status: open | done | dropped | all
app.get('/api/meeting-decisions', requirePerm('meetings.read'), (req, res) => {
  const { status, q, leader } = req.query;
  const params = {};
  let sql = `SELECT ${DECISION_COLUMNS}, m.title AS meeting_title, m.date AS meeting_date, m.kind AS meeting_kind,
      m.section, m.branch_id, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
    FROM meeting_decisions d
    JOIN meetings m ON m.id = d.meeting_id
    LEFT JOIN branches b ON b.id = m.branch_id
    LEFT JOIN leaders o ON o.id = d.leader_id
    WHERE 1=1${meetingScopeSQL(req)}`;
  if (DECISION_STATUSES.includes(status)) {
    sql += ' AND d.status = @status';
    params.status = status;
  }
  if (leader) sql += ` AND d.leader_id = ${intOr(leader)}`;
  if (q && String(q).trim()) {
    params.q = `%${String(q).trim()}%`;
    sql += ` AND (d.text LIKE @q OR COALESCE(${fullNameSQL('o')}, d.owner) LIKE @q OR m.title LIKE @q)`;
  }
  sql += ` ORDER BY d.status != 'open', CASE WHEN d.status = 'open' THEN COALESCE(d.due_date, '9999-12-31') END,
      CASE WHEN d.status = 'open' THEN m.date END, COALESCE(d.status_at, m.date) DESC, m.date DESC, d.position, d.id`;
  res.json(db.prepare(sql).all(params));
});

app.get('/api/meetings/:id', requirePerm('meetings.read'), (req, res) => {
  const m = loadMeeting(req, res);
  if (m) res.json(meetingPayload(m));
});

app.post('/api/meetings', requirePerm('meetings.manage'), (req, res) => {
  const parsed = parseMeeting(req);
  if (parsed.error) return res.status(parsed.status || 400).json({ error: parsed.error });
  const agenda = parseAgenda(req.body?.agenda);
  if (!agenda) return res.status(400).json({ error: 'invalid agenda' });
  const v = parsed.values;
  let id;
  db.transaction(() => {
    id = db
      .prepare(
        `INSERT INTO meetings (kind, title, purpose, date, start_time, end_time, place, branch_id, section,
           chair_id, chair_name, secretary_id, secretary_name, notes, next_date, created_by, updated_by)
         VALUES (@kind, @title, @purpose, @date, @start_time, @end_time, @place, @branch_id, @section,
           @chair_id, @chair_name, @secretary_id, @secretary_name, @notes, @next_date, @actor, @actor)`
      )
      .run({ ...v, actor: actorName(req) }).lastInsertRowid;
    const insert = db.prepare('INSERT INTO meeting_items (meeting_id, position, title) VALUES (?, ?, ?)');
    agenda.forEach((title, i) => insert.run(id, i + 1, title));
    setMeetingBranches(id, parsed.branchIds);
  })();
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
  auditEvent(req, 'create', 'meeting', id, null, { ...m, branch_ids: parsed.branchIds, agenda });
  notifications.meetingCreated(req, m, parsed.branchIds);
  res.status(201).json(meetingPayload(m));
});

app.put('/api/meetings/:id', requirePerm('meetings.manage'), (req, res) => {
  const m = loadMeeting(req, res);
  if (!m) return;
  const parsed = parseMeeting(req, m);
  if (parsed.error) return res.status(parsed.status || 400).json({ error: parsed.error });
  const beforeUpdate = { ...m, branch_ids: meetingBranchIds(m.id) };
  db.transaction(() => {
    db.prepare(
      `UPDATE meetings SET kind = @kind, title = @title, purpose = @purpose, date = @date, start_time = @start_time,
         end_time = @end_time, place = @place, branch_id = @branch_id, chair_id = @chair_id, chair_name = @chair_name,
         secretary_id = @secretary_id, secretary_name = @secretary_name, notes = @notes, next_date = @next_date,
         updated_at = datetime('now'), updated_by = @actor
       WHERE id = @id`
    ).run({ ...parsed.values, actor: actorName(req), id: m.id });
    setMeetingBranches(m.id, parsed.branchIds);
  })();
  const updated = { ...db.prepare('SELECT * FROM meetings WHERE id = ?').get(m.id), branch_ids: parsed.branchIds };
  auditEvent(req, 'update', 'meeting', m.id, beforeUpdate, updated);
  notifications.meetingChanged(req, m, updated);
  res.json(meetingPayload(updated));
});

// الحضور و البنود و القرارات تسقط معه (ON DELETE CASCADE)
app.delete('/api/meetings/:id', requirePerm('meetings.delete'), (req, res) => {
  const m = loadMeeting(req, res);
  if (!m) return;
  const before = meetingPayload(m);
  db.prepare('DELETE FROM meetings WHERE id = ?').run(m.id);
  auditEvent(req, 'delete', 'meeting', m.id, before, null);
  res.status(204).end();
});

// الحضور كله دفعة واحدة، كما في نافذة التسجيل: قادة القسم بحالاتهم (من لا حالة له لم
// يُدعَ) ثم أسماء الضيوف. قائدٌ أُرشف يبقى إن كان في المحضر من قبل، و لا يُضاف من جديد.
app.put('/api/meetings/:id/attendance', requirePerm('meetings.manage'), (req, res) => {
  const m = loadMeeting(req, res);
  if (!m) return;
  const b = req.body || {};
  const leaders = Array.isArray(b.leaders) ? b.leaders : null;
  const guests = b.guests === undefined || b.guests === null ? [] : b.guests;
  if (!leaders || leaders.length > 500 || !Array.isArray(guests) || guests.length > 100)
    return res.status(400).json({ error: 'invalid attendance' });
  const before = new Set(
    db.prepare('SELECT leader_id FROM meeting_attendees WHERE meeting_id = ? AND leader_id IS NOT NULL').all(m.id).map((r) => r.leader_id)
  );
  const rows = [];
  const seen = new Set();
  for (const r of leaders) {
    const id = intOr(r?.leader_id);
    if (!ATTENDANCE_STATUSES.includes(r?.status) || seen.has(id)) return res.status(400).json({ error: 'invalid attendance' });
    const l = db.prepare('SELECT * FROM leaders WHERE id = ? AND section = ?').get(id, m.section);
    if (!l || (l.status !== 'active' && !before.has(l.id))) return res.status(400).json({ error: 'invalid leader_id' });
    seen.add(id);
    rows.push({ leader_id: l.id, name: leaderFullName(l), status: r.status });
  }
  const names = guests.map((g) => optionalText(g, 120));
  if (names.some((n) => !n)) return res.status(400).json({ error: 'invalid guest' });
  const old = attendeesOf(m.id);
  db.transaction(() => {
    // Rows whose قائد is gone (leader_id nulled) are not in the dialog: they stay as written
    db.prepare('DELETE FROM meeting_attendees WHERE meeting_id = ? AND (guest = 1 OR leader_id IS NOT NULL)').run(m.id);
    const insert = db.prepare(
      'INSERT INTO meeting_attendees (meeting_id, guest, leader_id, name, status) VALUES (?, ?, ?, ?, ?)'
    );
    for (const r of rows) insert.run(m.id, 0, r.leader_id, r.name, r.status);
    for (const n of names) insert.run(m.id, 1, null, n, 'present');
    touchMeeting(req, m.id);
  })();
  const attendees = attendeesOf(m.id);
  auditEvent(req, 'update', 'meeting_attendance', m.id, old, attendees);
  res.json({ attendees });
});

// ---- بنود جدول الأعمال ----
function parseItem(req) {
  const b = req.body || {};
  const title = optionalText(b.title, 200);
  if (!title) return { error: 'invalid title' };
  const discussion = optionalText(b.discussion, 20000);
  if (discussion === undefined) return { error: 'text too long' };
  return { values: { title, discussion } };
}

const loadItem = (req, res, m) => {
  const it = db.prepare('SELECT * FROM meeting_items WHERE id = ? AND meeting_id = ?').get(intOr(req.params.iid), m.id);
  if (!it) res.status(404).json({ error: 'item not found' });
  return it || null;
};

app.post('/api/meetings/:id/items', requirePerm('meetings.manage'), (req, res) => {
  const m = loadMeeting(req, res);
  if (!m) return;
  const parsed = parseItem(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (db.prepare('SELECT COUNT(*) AS n FROM meeting_items WHERE meeting_id = ?').get(m.id).n >= 50)
    return res.status(400).json({ error: 'too many items' });
  let id;
  db.transaction(() => {
    const next = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM meeting_items WHERE meeting_id = ?').get(m.id).p;
    id = db
      .prepare('INSERT INTO meeting_items (meeting_id, position, title, discussion) VALUES (?, ?, ?, ?)')
      .run(m.id, next, parsed.values.title, parsed.values.discussion).lastInsertRowid;
    touchMeeting(req, m.id);
  })();
  auditEvent(req, 'create', 'meeting_item', id, null, db.prepare('SELECT * FROM meeting_items WHERE id = ?').get(id));
  res.status(201).json({ items: itemsOf(m.id) });
});

app.put('/api/meetings/:id/items/:iid', requirePerm('meetings.manage'), (req, res) => {
  const m = loadMeeting(req, res);
  if (!m) return;
  const it = loadItem(req, res, m);
  if (!it) return;
  const parsed = parseItem(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  db.transaction(() => {
    db.prepare('UPDATE meeting_items SET title = ?, discussion = ? WHERE id = ?').run(
      parsed.values.title,
      parsed.values.discussion,
      it.id
    );
    touchMeeting(req, m.id);
  })();
  auditEvent(req, 'update', 'meeting_item', it.id, it, db.prepare('SELECT * FROM meeting_items WHERE id = ?').get(it.id));
  res.json({ items: itemsOf(m.id) });
});

// Removing one closes the gap: the points that follow move up a number
app.delete('/api/meetings/:id/items/:iid', requirePerm('meetings.manage'), (req, res) => {
  const m = loadMeeting(req, res);
  if (!m) return;
  const it = loadItem(req, res, m);
  if (!it) return;
  db.transaction(() => {
    db.prepare('DELETE FROM meeting_items WHERE id = ?').run(it.id);
    db.prepare('UPDATE meeting_items SET position = position - 1 WHERE meeting_id = ? AND position > ?').run(m.id, it.position);
    touchMeeting(req, m.id);
  })();
  auditEvent(req, 'delete', 'meeting_item', it.id, it, null);
  res.json({ items: itemsOf(m.id) });
});

// ---- القرارات ----
function parseDecision(req, m, existing = null) {
  const b = req.body || {};
  const text = optionalText(b.text, 2000);
  if (!text) return { error: 'invalid text' };
  const owner = parsePerson(b.leader_id, b.owner, m.section, existing?.leader_id);
  if (owner.error) return { error: owner.error };
  const due = optionalISODate(b.due_date);
  if (due === undefined) return { error: 'invalid due_date' };
  const status = b.status === undefined ? (existing?.status ?? 'open') : b.status;
  if (!DECISION_STATUSES.includes(status)) return { error: 'invalid status' };
  return { values: { text, leader_id: owner.id, owner: owner.name, due_date: due, status } };
}

const loadDecision = (req, res, m) => {
  const d = db.prepare('SELECT * FROM meeting_decisions WHERE id = ? AND meeting_id = ?').get(intOr(req.params.did), m.id);
  if (!d) res.status(404).json({ error: 'decision not found' });
  return d || null;
};

const decisionById = (id) =>
  db.prepare(`SELECT ${DECISION_COLUMNS} FROM meeting_decisions d LEFT JOIN leaders o ON o.id = d.leader_id WHERE d.id = ?`).get(id);

app.post('/api/meetings/:id/decisions', requirePerm('meetings.manage'), (req, res) => {
  const m = loadMeeting(req, res);
  if (!m) return;
  const parsed = parseDecision(req, m);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (db.prepare('SELECT COUNT(*) AS n FROM meeting_decisions WHERE meeting_id = ?').get(m.id).n >= 100)
    return res.status(400).json({ error: 'too many decisions' });
  const v = parsed.values;
  let id;
  db.transaction(() => {
    const next = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM meeting_decisions WHERE meeting_id = ?').get(m.id).p;
    id = db
      .prepare(
        `INSERT INTO meeting_decisions (meeting_id, position, text, leader_id, owner, due_date, status, status_at, status_by, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        m.id, next, v.text, v.leader_id, v.owner, v.due_date, v.status,
        v.status === 'open' ? null : todayISO(), v.status === 'open' ? null : actorName(req), actorName(req)
      ).lastInsertRowid;
    touchMeeting(req, m.id);
  })();
  auditEvent(req, 'create', 'meeting_decision', id, null, decisionById(id));
  notifications.decisionAssigned(req, m, decisionById(id));
  res.status(201).json({ decisions: decisionsOf(m.id) });
});

app.put('/api/meetings/:id/decisions/:did', requirePerm('meetings.manage'), (req, res) => {
  const m = loadMeeting(req, res);
  if (!m) return;
  const d = loadDecision(req, res, m);
  if (!d) return;
  const parsed = parseDecision(req, m, d);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.values;
  // The day a decision was carried out (or dropped) stays the day it first changed
  const changed = v.status !== d.status;
  db.transaction(() => {
    db.prepare(
      `UPDATE meeting_decisions SET text = ?, leader_id = ?, owner = ?, due_date = ?, status = ?, status_at = ?, status_by = ?
       WHERE id = ?`
    ).run(
      v.text, v.leader_id, v.owner, v.due_date, v.status,
      v.status === 'open' ? null : changed ? todayISO() : d.status_at,
      v.status === 'open' ? null : changed ? actorName(req) : d.status_by,
      d.id
    );
    touchMeeting(req, m.id);
  })();
  auditEvent(req, 'update', 'meeting_decision', d.id, d, decisionById(d.id));
  // Passed on to another قائد
  if (v.leader_id && v.leader_id !== d.leader_id) notifications.decisionAssigned(req, m, decisionById(d.id));
  res.json({ decisions: decisionsOf(m.id) });
});

// Only the state — the follow-up list ticks a decision off without reopening its form
app.put('/api/meetings/:id/decisions/:did/status', requirePerm('meetings.followup'), (req, res) => {
  const m = loadMeeting(req, res);
  if (!m) return;
  const d = loadDecision(req, res, m);
  if (!d) return;
  const status = req.body?.status;
  if (!DECISION_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' });
  if (status !== d.status) {
    db.transaction(() => {
      db.prepare('UPDATE meeting_decisions SET status = ?, status_at = ?, status_by = ? WHERE id = ?').run(
        status,
        status === 'open' ? null : todayISO(),
        status === 'open' ? null : actorName(req),
        d.id
      );
      touchMeeting(req, m.id);
    })();
    auditEvent(req, 'update', 'meeting_decision', d.id, d, decisionById(d.id));
  }
  res.json({ decision: decisionById(d.id), decisions: decisionsOf(m.id) });
});

app.delete('/api/meetings/:id/decisions/:did', requirePerm('meetings.manage'), (req, res) => {
  const m = loadMeeting(req, res);
  if (!m) return;
  const d = loadDecision(req, res, m);
  if (!d) return;
  db.transaction(() => {
    db.prepare('DELETE FROM meeting_decisions WHERE id = ?').run(d.id);
    db.prepare('UPDATE meeting_decisions SET position = position - 1 WHERE meeting_id = ? AND position > ?').run(m.id, d.position);
    touchMeeting(req, m.id);
  })();
  auditEvent(req, 'delete', 'meeting_decision', d.id, d, null);
  res.json({ decisions: decisionsOf(m.id) });
});

// ---------- الصناديق ----------
// صندوق للفوج في كل قسم، و صندوق لكل فرقة. لكلٍّ رصيد افتتاحه، ثم ما دخله و خرج منه
// منذ يومه؛ لا مجموع يُخزَّن: الحساب كله عند القراءة.
// - اشتراكات نشاط (خانات الدفع في الحضور): صندوق فرقته، أو صندوق الفوج لنشاط عام أو للقادة.
// - اشتراك القادة الشهري: صندوق الفوج. اشتراك العناصر الشهري: صندوق فرقة العنصر يوم دفعه.
// - التبرعات و المداخيل و المصاريف المكتوبة باليد: الصندوق الذي اختير. مصروف النشاط و
//   التبرّع الذي وصل فيه: صندوق فرقة نشاطه.
// - التحويل: يخرج من صندوق و يدخل آخر في القسم نفسه.
// - المخيمات و الدورات: ما أُخذ من صندوق لمخيم يخرج منه، و ما أُعيد منه يدخله
//   (event_fundings). بقية حساب المخيم في صفحته.
// - المطابقة: ما عُدّ في الصندوق فعلًا مقابل ما يقوله السجلّ؛ الفرق يدخله أو يخرج منه
//   (treasury_counts).
// من حُصر بفرق لا يرى و لا يكتب إلا صناديقها؛ صندوق الفوج لمن لم يُحصر بفرق. المخيمات
// تبقى في صفحتها إلا ما بينها و بين صندوق.

const TREASURY_OUT = ['gear', 'food', 'transport', 'venue', 'uniform', 'other'];
const TREASURY_IN = ['donation', 'other'];

const treasurySections = (req) => {
  const s = activeSection(req);
  return s ? [s] : SECTIONS;
};

const actorName = (req) => req.user.display_name || req.user.username;

// 'M' / 'F': a قسم's فوج box; 'b<id>': a فرقة's
const boxKey = (section, branchId) => (branchId ? `b${branchId}` : section);

// Every box of the أقسام on screen: each قسم's فوج box, then its فرق in age order. The
// caller sees the فوج's when not limited to فرق, and the فرق of their scope; the others
// are only somewhere money can be sent.
function treasuryBoxes(req) {
  const sections = treasurySections(req);
  const scope = allowedBranches(req);
  const wholeGroup = req.user.role === 'admin' || !req.user.branches;
  const branches = db
    .prepare(
      `SELECT id, name_fr, name_ar, section FROM branches
       WHERE section IN (${sections.map(() => '?').join(',')}) ORDER BY sort_order, id`
    )
    .all(...sections);
  return sections.flatMap((section) => [
    { key: section, section, branch_id: null, name_fr: null, name_ar: null, visible: wholeGroup },
    ...branches
      .filter((b) => b.section === section)
      .map((b) => ({
        key: `b${b.id}`,
        section,
        branch_id: b.id,
        name_fr: b.name_fr,
        name_ar: b.name_ar,
        visible: !scope || scope.has(b.id),
      })),
  ]);
}

// A box the caller sees — and, with treasury.entries / transfers / counts, writes in — or null
const visibleBox = (req, key) => treasuryBoxes(req).find((b) => b.visible && b.key === key) || null;

const openingsOf = (sections) =>
  db
    .prepare(`SELECT * FROM treasury_openings WHERE section IN (${sections.map(() => '?').join(',')})`)
    .all(...sections);

// The day a box starts and with how much: its own count, or — a فرقة's box never
// counted — the فوج's opening day, empty. null: not opened yet.
function boxStart(box, openings) {
  const own = openings.find((o) => o.section === box.section && (o.branch_id ?? null) === box.branch_id);
  if (own) return { date: own.date, amount: own.amount, inherited: false, set_by: own.set_by, set_at: own.set_at };
  const group = box.branch_id && openings.find((o) => o.section === box.section && o.branch_id === null);
  return group ? { date: group.date, amount: 0, inherited: true } : null;
}

// صندوق المصروف: صندوق فرقة النشاط ما دام مربوطًا به، و إلا ما كُتب فيه
const ENTRY_BRANCH_SQL = 'CASE WHEN e.session_id IS NOT NULL THEN s.branch_id ELSE e.branch_id END';

// مصروف أو مدخول مكتوب، بالشكل الذي يعرضه السجلّ
const ENTRY_SQL = `
  SELECT e.*, s.title AS session_title, ${ENTRY_BRANCH_SQL} AS spent_branch_id,
    b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
  FROM treasury_entries e
  LEFT JOIN sessions s ON s.id = e.session_id
  LEFT JOIN branches b ON b.id = ${ENTRY_BRANCH_SQL}`;

// date: the day it moved the box (paid_on), or the day of the مصروف while it is owed
const entryRow = (e) => ({
  key: `e${e.id}`,
  source: 'entry',
  id: e.id,
  direction: e.direction,
  category: e.category,
  label: e.label,
  amount: e.amount,
  date: e.paid_on ?? e.date,
  spent_on: e.date,
  paid_on: e.paid_on,
  owed_to: e.owed_to,
  section: e.section,
  box: boxKey(e.section, e.spent_branch_id),
  session_id: e.session_id,
  session_title: e.session_title ?? null,
  branch_id: e.spent_branch_id ?? null,
  branch_name_fr: e.branch_name_fr ?? null,
  branch_name_ar: e.branch_name_ar ?? null,
  created_by: e.created_by,
  updated_by: e.updated_by,
});

// A transfer, as one of its two boxes sees it
const transferRow = (t, direction) => ({
  key: `t${t.id}${direction}`,
  source: 'transfer',
  id: t.id,
  direction,
  category: 'transfer',
  label: t.label,
  amount: t.amount,
  date: t.date,
  section: t.section,
  box: boxKey(t.section, direction === 'out' ? t.from_branch_id : t.to_branch_id),
  from: boxKey(t.section, t.from_branch_id),
  to: boxKey(t.section, t.to_branch_id),
  created_by: t.created_by,
});

// What came in and went out of one box since it started — a debt not paid yet is not in it
function boxRows(box, from) {
  const bid = box.branch_id ?? 0;
  const entries = db
    .prepare(`${ENTRY_SQL} WHERE e.section = ? AND IFNULL(${ENTRY_BRANCH_SQL}, 0) = ? AND e.paid_on >= ?`)
    .all(box.section, bid, from)
    .map(entryRow);
  // اشتراكات نشاط: سطر واحد للنشاط، بيومه — الخانة لا تحفظ يوم الدفع، و الدفع يكون فيه
  const sessions = db
    .prepare(
      `SELECT s.id, s.title, s.date, COUNT(*) AS payers, SUM(a.paid) AS amount
       FROM attendance a JOIN sessions s ON s.id = a.session_id
       WHERE s.section = ? AND IFNULL(s.branch_id, 0) = ? AND s.date >= ? AND a.paid > 0
       GROUP BY s.id`
    )
    .all(box.section, bid, from)
    .map((s) => ({
      key: `s${s.id}`,
      source: 'session',
      direction: 'in',
      category: 'sessions',
      label: s.title,
      amount: s.amount,
      date: s.date,
      section: box.section,
      box: box.key,
      session_id: s.id,
      payers: s.payers,
    }));
  // اشتراك القادة، في صندوق الفوج: سطر لكل يوم تسجيل، بأسماء من دفع فيه و عدد أشهره
  const dues = new Map();
  if (!box.branch_id)
    for (const r of db
      .prepare(
        `SELECT date(d.paid_at) AS day, l.id AS leader_id, ${fullNameSQL('l')} AS name,
           COUNT(*) AS months, SUM(d.amount) AS amount
         FROM leader_dues d JOIN leaders l ON l.id = d.leader_id
         WHERE l.section = ? AND date(d.paid_at) >= ?
         GROUP BY day, l.id ORDER BY name`
      )
      .all(box.section, from)) {
      const row = dues.get(r.day) || {
        key: `d${box.section}${r.day}`,
        source: 'dues',
        direction: 'in',
        category: 'dues',
        amount: 0,
        date: r.day,
        section: box.section,
        box: box.key,
        leaders: [],
      };
      row.amount += r.amount;
      row.leaders.push({ id: r.leader_id, name: r.name, months: r.months });
      dues.set(r.day, row);
    }
  // اشتراك العناصر الشهري، في صندوق فرقة العنصر: سطر لكل نشاط جُمع فيه، و سطر لكل يوم
  // سُجّل فيه خارج نشاط — بأسماء من دفع و عدد الأشهر التي دفع عنها، كاملةً أو جزءًا منها
  const memberDues = new Map();
  for (const r of db
    .prepare(
      `SELECT d.paid_on AS day, d.session_id, s.title AS session_title, d.member_id,
         ${fullNameSQL('m')} AS name, COUNT(DISTINCT d.month) AS months, SUM(d.amount) AS amount
       FROM member_dues d LEFT JOIN sessions s ON s.id = d.session_id
       LEFT JOIN members m ON m.id = d.member_id
       WHERE d.section = ? AND IFNULL(d.branch_id, 0) = ? AND d.paid_on >= ?
       GROUP BY d.paid_on, d.session_id, d.member_id ORDER BY name`
    )
    .all(box.section, bid, from)) {
    const key = `${r.day}:${r.session_id ?? ''}`;
    const row = memberDues.get(key) || {
      key: `m:${box.key}:${key}`,
      source: 'member_dues',
      direction: 'in',
      category: 'member_dues',
      amount: 0,
      date: r.day,
      section: box.section,
      box: box.key,
      session_id: r.session_id,
      session_title: r.session_title ?? null,
      members: [],
    };
    row.amount += r.amount;
    row.members.push({ id: r.member_id, name: r.name, months: r.months });
    memberDues.set(key, row);
  }
  const transfers = db
    .prepare(
      `SELECT * FROM treasury_transfers
       WHERE section = ? AND date >= ? AND (IFNULL(from_branch_id, 0) = ? OR IFNULL(to_branch_id, 0) = ?)`
    )
    .all(box.section, from, bid, bid)
    .map((t) => transferRow(t, (t.from_branch_id ?? 0) === bid ? 'out' : 'in'));
  // مخيمات و دورات: ما أعطاها الصندوق، أو ما أعادته إليه
  const fundings = db
    .prepare(
      `SELECT f.*, e.title AS event_title, e.kind AS event_kind
       FROM event_fundings f LEFT JOIN events e ON e.id = f.event_id
       WHERE f.section = ? AND IFNULL(f.branch_id, 0) = ? AND f.date >= ?`
    )
    .all(box.section, bid, from)
    .map((f) => ({
      key: `f${f.id}`,
      source: 'event',
      id: f.id,
      direction: f.direction === 'to_event' ? 'out' : 'in',
      category: 'event',
      label: f.label,
      amount: f.amount,
      date: f.date,
      section: f.section,
      box: box.key,
      event_id: f.event_id,
      event_title: f.event_title ?? null,
      event_kind: f.event_kind ?? null,
      created_by: f.created_by,
    }));
  // مطابقات: فائض يدخل أو عجز يخرج، ليصير الرصيد ما عُدّ
  const counts = db
    .prepare('SELECT * FROM treasury_counts WHERE section = ? AND IFNULL(branch_id, 0) = ? AND date >= ?')
    .all(box.section, bid, from)
    .map((c) => countRow(c, box.key));
  return [...entries, ...sessions, ...dues.values(), ...memberDues.values(), ...transfers, ...fundings, ...counts];
}

// What the count found against the book, to the centime: positive, more than written
const countGap = (c) => Math.round((c.counted - c.expected) * 100) / 100;

const countRow = (c, box) => ({
  key: `c${c.id}`,
  source: 'count',
  id: c.id,
  direction: countGap(c) > 0 ? 'in' : 'out',
  category: 'count',
  label: c.reason,
  amount: Math.abs(countGap(c)),
  date: c.date,
  section: c.section,
  box,
  counted: c.counted,
  expected: c.expected,
  created_by: c.created_by,
  updated_by: c.updated_by,
});

// ما بقي دَينًا على صندوق، أقدمه أولًا. يوم الافتتاح لا يحدّه: دَين قديم يخرج يوم يُسدَّد.
const owedOf = (box) =>
  db
    .prepare(
      `${ENTRY_SQL} WHERE e.direction = 'out' AND e.paid_on IS NULL
         AND e.section = ? AND IFNULL(${ENTRY_BRANCH_SQL}, 0) = ?
       ORDER BY e.date, e.id`
    )
    .all(box.section, box.branch_id ?? 0)
    .map(entryRow);

const emptyFigures = () => ({
  income: { sessions: 0, member_dues: 0, dues: 0, donation: 0, other: 0, transfer: 0, event: 0, count: 0, total: 0 },
  expenses: { ...Object.fromEntries(TREASURY_OUT.map((c) => [c, 0])), transfer: 0, event: 0, count: 0, total: 0 },
});

const addToFigures = (f, r) => {
  const side = r.direction === 'in' ? f.income : f.expenses;
  side[r.category] += r.amount;
  side.total += r.amount;
};

const sumOf = (list, pick) => list.reduce((n, x) => n + pick(x), 0);

// One box: where it started, every movement since, and what it still owes
function boxLedger(box, openings) {
  const start = boxStart(box, openings);
  const f = emptyFigures();
  if (!start) return { start: null, rows: [], owed: [], balance: null, owedTotal: 0, ...f };
  const rows = boxRows(box, start.date);
  const owed = owedOf(box);
  for (const r of rows) addToFigures(f, r);
  return {
    start,
    rows,
    owed,
    balance: start.amount + f.income.total - f.expenses.total,
    owedTotal: sumOf(owed, (x) => x.amount),
    ...f,
  };
}

// Latest day first; within a day, its count on top — it was taken once the day's lines
// were in — then what was written by hand (newest first) before the computed lines
const rowOrder = (a, b) =>
  a.date !== b.date
    ? a.date < b.date
      ? 1
      : -1
    : (b.source === 'count') - (a.source === 'count') || (b.id ?? 0) - (a.id ?? 0);

// Every box the caller sees, each with its figures, and their movements and debts
// together. A box not opened yet has no figures and adds nothing.
function treasuryPayload(req) {
  const openings = openingsOf(treasurySections(req));
  const rows = [];
  const owed = [];
  const boxes = treasuryBoxes(req).map(({ visible, ...box }) => {
    if (!visible) return { ...box, visible: false };
    const l = boxLedger(box, openings);
    rows.push(...l.rows);
    owed.push(...l.owed);
    return {
      ...box,
      visible: true,
      start: l.start,
      balance: l.balance,
      owed: l.owedTotal,
      income: l.income,
      expenses: l.expenses,
    };
  });
  // All boxes together: a transfer between two of them moves nothing — marked, shown
  // once, and left out of what came in and went out
  const sides = new Map();
  for (const r of rows) if (r.source === 'transfer') sides.set(r.id, (sides.get(r.id) || 0) + 1);
  const summary = emptyFigures();
  for (const r of rows) {
    if (r.source === 'transfer' && sides.get(r.id) === 2) r.internal = true;
    else addToFigures(summary, r);
  }
  const opened = boxes.filter((b) => b.visible && b.start);
  return {
    boxes,
    summary: {
      ...summary,
      opening: sumOf(opened, (b) => b.start.amount),
      balance: sumOf(opened, (b) => b.balance),
      owed: sumOf(owed, (x) => x.amount),
    },
    rows: rows.sort(rowOrder),
    owed: owed.sort((a, b) => (a.spent_on !== b.spent_on ? (a.spent_on < b.spent_on ? -1 : 1) : a.id - b.id)),
    // What the caller may write in the caisses, action by action
    can_entries: hasPerm(req, 'treasury.entries'),
    can_transfers: hasPerm(req, 'treasury.transfers'),
    can_counts: hasPerm(req, 'treasury.counts'),
  };
}

app.get('/api/treasury', requirePerm('treasury.read'), (req, res) => {
  res.json(treasuryPayload(req));
});

// The box a write names: `box` from the body, else the فوج box of the قسم on screen
const bodyBox = (req) => visibleBox(req, req.body?.box ?? activeSection(req));

// رصيد الافتتاح: المبلغ الذي عُدّ في الصندوق صباح ذلك اليوم. يُصحَّح متى لزم.
app.put('/api/treasury/opening', requirePerm('treasury.counts'), (req, res) => {
  const box = bodyBox(req);
  if (!box) return res.status(400).json({ error: 'invalid box' });
  const amount = parsePaid(req.body?.amount);
  if (amount === undefined || amount === null) return res.status(400).json({ error: 'invalid amount' });
  if (!validISODate(req.body?.date)) return res.status(400).json({ error: 'invalid date' });
  const before =
    db
      .prepare('SELECT * FROM treasury_openings WHERE section = ? AND IFNULL(branch_id, 0) = ?')
      .get(box.section, box.branch_id ?? 0) || null;
  if (before)
    db.prepare("UPDATE treasury_openings SET date = ?, amount = ?, set_by = ?, set_at = datetime('now') WHERE id = ?").run(
      req.body.date,
      amount,
      actorName(req),
      before.id
    );
  else
    db.prepare('INSERT INTO treasury_openings (section, branch_id, date, amount, set_by) VALUES (?, ?, ?, ?, ?)').run(
      box.section,
      box.branch_id,
      req.body.date,
      amount,
      actorName(req)
    );
  const after = db
    .prepare('SELECT * FROM treasury_openings WHERE section = ? AND IFNULL(branch_id, 0) = ?')
    .get(box.section, box.branch_id ?? 0);
  auditEvent(req, before ? 'update' : 'create', 'treasury_opening', box.key, before, after);
  res.json(treasuryPayload(req));
});

// Validates an entry's body. `direction` comes from the row being edited, or the body
// on creation; a مصروف names what it is, an تبرّع may say nothing but its amount.
// A مصروف is paid (`paid` absent or true) or still owed (`paid: false`) to someone who
// must be named — a قائد who advanced it, a shop that gave credit. Paid, it left the box
// on `paid_on`, its own day when not given.
function parseTreasuryEntry(req, direction) {
  const b = req.body || {};
  if (!['in', 'out'].includes(direction)) return { error: 'invalid direction' };
  const categories = direction === 'out' ? TREASURY_OUT : TREASURY_IN;
  const category =
    b.category === undefined || b.category === null || b.category === ''
      ? direction === 'out'
        ? 'other'
        : 'donation'
      : b.category;
  if (!categories.includes(category)) return { error: 'invalid category' };
  const label = optionalText(b.label, 200);
  if (label === undefined) return { error: 'text too long' };
  if (direction === 'out' && !label) return { error: 'invalid label' };
  const amount = parsePaid(b.amount);
  if (!amount) return { error: 'invalid amount' };
  if (!validISODate(b.date)) return { error: 'invalid date' };
  if (direction === 'in')
    return { values: { direction, category, label, amount, date: b.date, paid_on: b.date, owed_to: null } };
  const owedTo = optionalText(b.owed_to, 120);
  if (owedTo === undefined) return { error: 'text too long' };
  if (b.paid !== undefined && typeof b.paid !== 'boolean') return { error: 'invalid paid' };
  const paid = b.paid !== false;
  if (!paid && !owedTo) return { error: 'invalid owed_to' };
  const paidOn = !paid ? null : b.paid_on === undefined || b.paid_on === null || b.paid_on === '' ? b.date : b.paid_on;
  if (paid && !validISODate(paidOn)) return { error: 'invalid date' };
  return { values: { direction, category, label, amount, date: b.date, paid_on: paidOn, owed_to: owedTo } };
}

// The line and its box, when the caller sees that box; otherwise a 404 is sent: another
// قسم's or another فرقة's box does not exist for them
function loadEntry(req, res) {
  const e = db
    .prepare(
      `SELECT e.*, ${ENTRY_BRANCH_SQL} AS box_branch
       FROM treasury_entries e LEFT JOIN sessions s ON s.id = e.session_id WHERE e.id = ?`
    )
    .get(intOr(req.params.xid));
  const box = e && visibleBox(req, boxKey(e.section, e.box_branch));
  if (!box) {
    res.status(404).json({ error: 'entry not found' });
    return [null, null];
  }
  delete e.box_branch;
  return [e, box];
}

const entryById = (id) => db.prepare('SELECT * FROM treasury_entries WHERE id = ?').get(id);

const insertEntry = (req, v, section, sessionId = null) => {
  const id = db
    .prepare(
      `INSERT INTO treasury_entries
         (direction, category, label, amount, date, paid_on, owed_to, session_id, branch_id, section, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      v.direction,
      v.category,
      v.label,
      v.amount,
      v.date,
      v.paid_on,
      v.owed_to,
      sessionId,
      v.branch_id ?? null,
      section,
      actorName(req)
    ).lastInsertRowid;
  const entry = entryById(id);
  auditEvent(req, 'create', 'treasury_entry', id, null, entry);
  notifications.treasuryEntry(req, { ...entry, id, section, branch_id: v.branch_id ?? null });
};

const updateEntry = (req, e, v) => {
  db.prepare(
    `UPDATE treasury_entries SET category = ?, label = ?, amount = ?, date = ?, paid_on = ?, owed_to = ?,
       branch_id = ?, section = ?, updated_by = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    v.category,
    v.label,
    v.amount,
    v.date,
    v.paid_on,
    v.owed_to,
    v.branch_id ?? null,
    v.section ?? e.section,
    actorName(req),
    e.id
  );
  auditEvent(req, 'update', 'treasury_entry', e.id, e, entryById(e.id));
};

const deleteEntry = (req, e) => {
  db.prepare('DELETE FROM treasury_entries WHERE id = ?').run(e.id);
  auditEvent(req, 'delete', 'treasury_entry', e.id, e, null);
};

app.post('/api/treasury/entries', requirePerm('treasury.entries'), (req, res) => {
  const box = bodyBox(req);
  if (!box) return res.status(400).json({ error: 'invalid box' });
  const parsed = parseTreasuryEntry(req, req.body?.direction);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  insertEntry(req, { ...parsed.values, branch_id: box.branch_id }, box.section);
  res.status(201).json(treasuryPayload(req));
});

// Moves a line to another box the caller holds, when asked. A نشاط's مصروف stays in
// its نشاط's فرقة's box.
app.put('/api/treasury/entries/:xid', requirePerm('treasury.entries'), (req, res) => {
  const [e, box] = loadEntry(req, res);
  if (!e) return;
  const parsed = parseTreasuryEntry(req, e.direction);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  let target = box;
  if (!e.session_id && req.body?.box !== undefined && req.body.box !== box.key) {
    target = visibleBox(req, req.body.box);
    if (!target) return res.status(400).json({ error: 'invalid box' });
  }
  updateEntry(req, e, {
    ...parsed.values,
    branch_id: e.session_id ? e.branch_id : target.branch_id,
    section: e.session_id ? e.section : target.section,
  });
  res.json(treasuryPayload(req));
});

// تسديد مصروف لم يُدفع: يخرج من صندوقه في ذلك اليوم (اليوم إن لم يُذكر)
app.post('/api/treasury/entries/:xid/pay', requirePerm('treasury.entries'), (req, res) => {
  const [e] = loadEntry(req, res);
  if (!e) return;
  if (e.direction !== 'out' || e.paid_on) return res.status(400).json({ error: 'not owed' });
  const date = req.body?.date || todayISO();
  if (!validISODate(date)) return res.status(400).json({ error: 'invalid date' });
  db.prepare(
    "UPDATE treasury_entries SET paid_on = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(date, actorName(req), e.id);
  auditEvent(req, 'update', 'treasury_entry', e.id, e, entryById(e.id));
  res.json(treasuryPayload(req));
});

app.delete('/api/treasury/entries/:xid', requirePerm('treasury.entries'), (req, res) => {
  const [e] = loadEntry(req, res);
  if (!e) return;
  deleteEntry(req, e);
  res.json(treasuryPayload(req));
});

// ---------- التحويلات ----------
// من صندوق يمسكه الكاتب إلى أيّ صندوق آخر في قسمه — فرقة تسلّم صندوق الفوج ما جمعت،
// أو الفوج يعطي فرقة ما تحتاج. يعدّله و يحذفه من يمسك الصندوق الذي خرج منه.

function parseTransfer(req) {
  const b = req.body || {};
  const boxes = treasuryBoxes(req);
  const from = boxes.find((x) => x.visible && x.key === b.from);
  if (!from) return { error: 'invalid from' };
  const to = boxes.find((x) => x.key === b.to);
  if (!to || to.section !== from.section || to.key === from.key) return { error: 'invalid to' };
  const amount = parsePaid(b.amount);
  if (!amount) return { error: 'invalid amount' };
  if (!validISODate(b.date)) return { error: 'invalid date' };
  const label = optionalText(b.label, 200);
  if (label === undefined) return { error: 'text too long' };
  return {
    values: {
      section: from.section,
      from_branch_id: from.branch_id,
      to_branch_id: to.branch_id,
      amount,
      date: b.date,
      label,
    },
  };
}

const transferById = (id) => db.prepare('SELECT * FROM treasury_transfers WHERE id = ?').get(id);

function loadTransfer(req, res) {
  const t = transferById(intOr(req.params.xid));
  if (!t || !visibleBox(req, boxKey(t.section, t.from_branch_id))) {
    res.status(404).json({ error: 'transfer not found' });
    return null;
  }
  return t;
}

app.post('/api/treasury/transfers', requirePerm('treasury.transfers'), (req, res) => {
  const parsed = parseTransfer(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.values;
  const id = db
    .prepare(
      `INSERT INTO treasury_transfers (section, from_branch_id, to_branch_id, amount, date, label, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(v.section, v.from_branch_id, v.to_branch_id, v.amount, v.date, v.label, actorName(req)).lastInsertRowid;
  auditEvent(req, 'create', 'treasury_transfer', id, null, transferById(id));
  res.status(201).json(treasuryPayload(req));
});

app.put('/api/treasury/transfers/:xid', requirePerm('treasury.transfers'), (req, res) => {
  const t = loadTransfer(req, res);
  if (!t) return;
  const parsed = parseTransfer(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.values;
  db.prepare(
    `UPDATE treasury_transfers SET section = ?, from_branch_id = ?, to_branch_id = ?, amount = ?, date = ?,
       label = ?, updated_by = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(v.section, v.from_branch_id, v.to_branch_id, v.amount, v.date, v.label, actorName(req), t.id);
  auditEvent(req, 'update', 'treasury_transfer', t.id, t, transferById(t.id));
  res.json(treasuryPayload(req));
});

app.delete('/api/treasury/transfers/:xid', requirePerm('treasury.transfers'), (req, res) => {
  const t = loadTransfer(req, res);
  if (!t) return;
  db.prepare('DELETE FROM treasury_transfers WHERE id = ?').run(t.id);
  auditEvent(req, 'delete', 'treasury_transfer', t.id, t, null);
  res.json(treasuryPayload(req));
});

// ---------- المطابقة ----------
// من يمسك الصندوق يعدّ ما فيه فعلًا و يكتبه مع السبب. ما يقوله السجلّ في آخر ذلك اليوم
// يُحفظ معه، و الفرق سطر في الصندوق فيصير رصيده ما عُدّ. إعادة المطابقة (تصحيح المبلغ
// أو اليوم) تعيد حساب ما يقوله السجلّ بدونها.

// What the book says a box held at the end of a day: its start and every line up to that
// day. Redoing count `redo`, it and any later count of the same day are left out.
// null: the box had not started yet.
function bookBalanceOn(box, date, redo = null) {
  const start = boxStart(box, openingsOf([box.section]));
  if (!start || date < start.date) return null;
  let n = start.amount;
  for (const r of boxRows(box, start.date)) {
    if (r.date > date) continue;
    if (redo && r.source === 'count' && r.date === date && r.id >= redo.id) continue;
    n += r.direction === 'in' ? r.amount : -r.amount;
  }
  return Math.round(n * 100) / 100;
}

// Validates a count against the book. The box is the body's on creation, the count's own
// when it is redone.
function parseCount(req, box, redo = null) {
  const b = req.body || {};
  const counted = parsePaid(b.counted);
  if (counted === undefined || counted === null) return { error: 'invalid amount' };
  if (!validISODate(b.date)) return { error: 'invalid date' };
  const reason = optionalText(b.reason, 200);
  if (reason === undefined) return { error: 'text too long' };
  if (!reason) return { error: 'invalid reason' };
  const expected = bookBalanceOn(box, b.date, redo);
  if (expected === null) return { error: 'before opening' };
  if (countGap({ counted, expected }) === 0) return { error: 'no difference' };
  return { values: { section: box.section, branch_id: box.branch_id, date: b.date, counted, expected, reason } };
}

const countById = (id) => db.prepare('SELECT * FROM treasury_counts WHERE id = ?').get(id);

// The count and its box, when the caller holds that box; otherwise a 404 is sent
function loadCount(req, res) {
  const c = countById(intOr(req.params.xid));
  const box = c && visibleBox(req, boxKey(c.section, c.branch_id));
  if (!box) {
    res.status(404).json({ error: 'count not found' });
    return [null, null];
  }
  return [c, box];
}

app.post('/api/treasury/counts', requirePerm('treasury.counts'), (req, res) => {
  const box = bodyBox(req);
  if (!box) return res.status(400).json({ error: 'invalid box' });
  const parsed = parseCount(req, box);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.values;
  const id = db
    .prepare(
      `INSERT INTO treasury_counts (section, branch_id, date, counted, expected, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(v.section, v.branch_id, v.date, v.counted, v.expected, v.reason, actorName(req)).lastInsertRowid;
  auditEvent(req, 'create', 'treasury_count', id, null, countById(id));
  res.status(201).json(treasuryPayload(req));
});

app.put('/api/treasury/counts/:xid', requirePerm('treasury.counts'), (req, res) => {
  const [c, box] = loadCount(req, res);
  if (!c) return;
  const parsed = parseCount(req, box, c);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.values;
  db.prepare(
    `UPDATE treasury_counts SET date = ?, counted = ?, expected = ?, reason = ?, updated_by = ?,
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(v.date, v.counted, v.expected, v.reason, actorName(req), c.id);
  auditEvent(req, 'update', 'treasury_count', c.id, c, countById(c.id));
  res.json(treasuryPayload(req));
});

app.delete('/api/treasury/counts/:xid', requirePerm('treasury.counts'), (req, res) => {
  const [c] = loadCount(req, res);
  if (!c) return;
  db.prepare('DELETE FROM treasury_counts WHERE id = ?').run(c.id);
  auditEvent(req, 'delete', 'treasury_count', c.id, c, null);
  res.json(treasuryPayload(req));
});

// ---------- مصاريف النشاط و تبرعاته ----------
// ما اشتُري لنشاط (لوازم، ضيافة…) يُكتب من صفحته، فيخرج من صندوق فرقته؛ و التبرّع الذي
// وصل فيه يدخل الصندوق نفسه، بلا اسم للمتبرّع. يكتبهما من يسجّل الدفع في النشاط (الحضور +
// رؤية المبالغ)، أو أمين المال.

// What was written for a نشاط in its box: its مصاريف (out), or what was given in it (in)
const sessionEntriesOf = (sessionId, direction) =>
  db
    .prepare(`${ENTRY_SQL} WHERE e.session_id = ? AND e.direction = ? ORDER BY e.date DESC, e.id DESC`)
    .all(sessionId, direction)
    .map(entryRow);

const canSeeSessionExpenses = (req) => hasPerm(req, 'sessions.read.fees') || hasPerm(req, 'treasury.read');
// The قائد who records the نشاط's money, or the أمين المال who records every caisse's
const canWriteSessionExpenses = (req) => hasPerm(req, 'sessions.money') || hasPerm(req, 'treasury.entries');

const requireSessionMoney = (req, res, next) =>
  canWriteSessionExpenses(req) ? next() : res.status(403).json({ error: 'forbidden' });

// النشاط بعد التحقّق من نطاقه، أو null بعد ردّ 404 / 403
function loadSessionForMoney(req, res) {
  const s = db.prepare('SELECT id, branch_id, section, date FROM sessions WHERE id = ?').get(intOr(req.params.id));
  if (!s) {
    res.status(404).json({ error: 'session not found' });
    return null;
  }
  if (!sessionOk(req, s)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return s;
}

const loadSessionEntry = (req, res, s, direction) => {
  const e = db
    .prepare('SELECT * FROM treasury_entries WHERE id = ? AND session_id = ? AND direction = ?')
    .get(intOr(req.params.xid), s.id, direction);
  if (!e) res.status(404).json({ error: direction === 'out' ? 'expense not found' : 'donation not found' });
  return e || null;
};

// يوم المصروف أو التبرّع يوم النشاط إن لم يُذكر: يُشترى له و يُعطى عادةً في يومه
const withSessionDate = (req, s) => {
  const b = req.body || {};
  return b.date === undefined || b.date === null || b.date === '' ? { ...req, body: { ...b, date: s.date } } : req;
};

// /expenses: مصاريف النشاط — /donations: تبرعاته. يردّ كلٌّ لائحته كاملة بعد الحفظ.
for (const [list, direction] of [
  ['expenses', 'out'],
  ['donations', 'in'],
]) {
  app.post(`/api/sessions/:id/${list}`, requirePerm('sessions.read'), requireSessionMoney, (req, res) => {
    const s = loadSessionForMoney(req, res);
    if (!s) return;
    const parsed = parseTreasuryEntry(withSessionDate(req, s), direction);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    insertEntry(req, { ...parsed.values, branch_id: s.branch_id }, s.section, s.id);
    res.status(201).json({ [list]: sessionEntriesOf(s.id, direction) });
  });

  app.put(`/api/sessions/:id/${list}/:xid`, requirePerm('sessions.read'), requireSessionMoney, (req, res) => {
    const s = loadSessionForMoney(req, res);
    if (!s) return;
    const e = loadSessionEntry(req, res, s, direction);
    if (!e) return;
    const parsed = parseTreasuryEntry(withSessionDate(req, s), direction);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    updateEntry(req, e, { ...parsed.values, branch_id: s.branch_id });
    res.json({ [list]: sessionEntriesOf(s.id, direction) });
  });

  app.delete(`/api/sessions/:id/${list}/:xid`, requirePerm('sessions.read'), requireSessionMoney, (req, res) => {
    const s = loadSessionForMoney(req, res);
    if (!s) return;
    const e = loadSessionEntry(req, res, s, direction);
    if (!e) return;
    deleteEntry(req, e);
    res.json({ [list]: sessionEntriesOf(s.id, direction) });
  });
}

// ---------- مالية الفرقة ----------
// كل ما صُرف لفرقة: مصاريف أنشطتها، و ما كُتب لها في الصندوق. منذ البداية، مدفوعًا أو
// لم يُدفع بعد — هي كلفة الفرقة، لا حركة الصندوق، فيوم الافتتاح لا يحدّها. و كل ما
// أُعطي لها: تبرعات أنشطتها، و ما كُتب تبرّعًا لصندوقها.
app.get('/api/branches/:id/money', requirePerm('branches.read'), (req, res) => {
  const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(intOr(req.params.id));
  if (!branch) return res.status(404).json({ error: 'branch not found' });
  if (!branchOk(req, branch.id) || !canSeeSessionExpenses(req)) return res.status(403).json({ error: 'forbidden' });
  const entriesOf = (where) =>
    db
      .prepare(`${ENTRY_SQL} WHERE ${where} AND ${ENTRY_BRANCH_SQL} = ? ORDER BY e.date DESC, e.id DESC`)
      .all(branch.id)
      .map(entryRow);
  const expenses = entriesOf("e.direction = 'out'");
  const donations = entriesOf("e.direction = 'in' AND e.category = 'donation'");
  const byCategory = Object.fromEntries(TREASURY_OUT.map((c) => [c, 0]));
  let total = 0;
  let owed = 0;
  for (const x of expenses) {
    byCategory[x.category] += x.amount;
    total += x.amount;
    if (!x.paid_on) owed += x.amount;
  }
  // The فرقة's own box, for whoever sees it: what is in it now, since when, and
  // whether the caller writes in it (a general مصروف or تبرّع of the فرقة, from this tab)
  const box = hasPerm(req, 'treasury.read') ? visibleBox(req, `b${branch.id}`) : null;
  const l = box && boxLedger(box, openingsOf([box.section]));
  res.json({
    expenses,
    donations,
    summary: { total, owed, paid: total - owed, by_category: byCategory },
    caisse: box
      ? {
          box: box.key,
          opened: !!l.start,
          start: l.start?.date ?? null,
          balance: l.balance,
          owed: l.owedTotal,
          can_write: hasPerm(req, 'treasury.entries'),
        }
      : null,
  });
});

// ---------- Dashboard ----------
// Everything the home page shows, in one request: what asks something of the قائد
// (unmarked pointage, next Saturday's plan and preparation card, unpaid
// subscriptions, عناصر who stopped coming), the key figures, présence day by day,
// and a فرقة-by-فرقة comparison. Each block is sent only with the permission of the
// page that details it, and every figure honours the caller's فرقة scope, so a
// restricted قائد's dashboard only talks about his own فرق.


// The weekly نشاط day: the next given weekday (0 = Sunday … 6 = Saturday, the default),
// or today when today is that day
function nextWeekday(iso, weekday = 6) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((weekday - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}
const nextSaturday = (iso) => nextWeekday(iso, 6);

// Bug 12 : le jour où une فرقة se réunit d'habitude — le jour de la semaine le plus
// fréquent parmi ses huit dernières أنشطة passées. Samedi à défaut : sans historique,
// quand aucun jour ne revient au moins deux fois (une sortie isolée ne fait pas une
// habitude), ou quand samedi est à égalité ; sinon, à égalité, le plus récent.
function usualWeekday(branchId, today) {
  const rows = db
    .prepare(
      `SELECT CAST(strftime('%w', s.date) AS INTEGER) AS wd FROM sessions s
        WHERE s.kind = 'activity' AND s.date <= ? AND ${sessionInBranchSQL(branchId)}
        ORDER BY s.date DESC, s.id DESC LIMIT 8`
    )
    .all(today);
  const n = new Map();
  for (const r of rows) n.set(r.wd, (n.get(r.wd) || 0) + 1);
  const top = Math.max(0, ...n.values());
  if (top < 2 || n.get(6) === top) return 6;
  return rows.find((r) => n.get(r.wd) === top).wd;
}

// Present over marked; null when nothing is marked, never a made-up 0%
const rateOf = (present, marked) => (marked ? Math.round((present / marked) * 100) : null);

// How far «À venir» looks for camps, دورات and meetings
const AGENDA_DAYS = 30;

app.get('/api/dashboard', (req, res) => {
  const today = todayISO();
  const canMembers = hasPerm(req, 'members.read');
  const canSessions = hasPerm(req, 'sessions.read');
  const canFees = canSessions && hasPerm(req, 'sessions.read.fees');
  const canPlan = hasPerm(req, 'branches.read');
  const year = currentScoutYear();
  const season = scoutYearRange(year);
  const ym = today.slice(0, 7);
  const prev = new Date(`${ym}-01T12:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevYm = prev.toISOString().slice(0, 7);
  // A presence row belongs to the فرقة the عنصر was in on the day (the roster snapshot)
  const scoped = sessionScopeSQL(req) + branchFilterSQL(req, 'COALESCE(a.branch_id, m.branch_id)');
  const tally = `COALESCE(SUM(a.status = 'present'), 0) AS present,
     COALESCE(SUM(a.status IN ('present', 'absent', 'excused')), 0) AS marked`;

  let month = null;
  let trend = [];
  if (canSessions) {
    const monthStmt = db.prepare(
      `SELECT ${tally}, COALESCE(SUM(a.paid), 0) AS collected
       FROM attendance a JOIN sessions s ON s.id = a.session_id JOIN members m ON m.id = a.member_id
       WHERE s.kind = 'activity' AND substr(s.date, 1, 7) = ? AND ${countedSessionSQL('s', '?')}${scoped}`
    );
    const activitiesSince = db.prepare(
      `SELECT COUNT(*) AS n FROM sessions s
       WHERE s.kind = 'activity' AND s.date >= ? AND s.date <= ?${sessionScopeSQL(req)}`
    );
    const cur = monthStmt.get(ym, today);
    const before = monthStmt.get(prevYm, today);
    month = {
      activities: activitiesSince.get(`${ym}-01`, today).n,
      season_activities: activitiesSince.get(season.from, today).n,
      present: cur.present,
      marked: cur.marked,
      rate: rateOf(cur.present, cur.marked),
      prev_month: prevYm,
      prev_rate: rateOf(before.present, before.marked),
      collected: canFees ? cur.collected : null,
    };
    // The last eight activity weeks, oldest first (bug 16). One point per week (Monday to
    // Sunday), all فرق together and weighted by their pointed عناصر: a small فرقة meeting
    // mid-week joins its week instead of making a point as heavy as a full Saturday.
    // `date` is the week's last activity day, `week` its Monday.
    trend = db
      .prepare(
        `SELECT date(s.date, 'weekday 0', '-6 days') AS week, MAX(s.date) AS date,
                COUNT(DISTINCT s.id) AS sessions, ${tally}
         FROM attendance a JOIN sessions s ON s.id = a.session_id JOIN members m ON m.id = a.member_id
         WHERE s.kind = 'activity' AND ${countedSessionSQL('s', '?')}${scoped}
         GROUP BY week HAVING marked > 0 ORDER BY week DESC LIMIT 8`
      )
      .all(today)
      .reverse()
      .map((r) => ({ ...r, rate: rateOf(r.present, r.marked) }));
  }

  const memberCount = db.prepare("SELECT COUNT(*) AS n FROM members WHERE branch_id = ? AND status = 'active'");
  const headOf = db.prepare(
    `SELECT ${fullNameSQL('l')} AS name FROM assignments a JOIN leaders l ON l.id = a.leader_id
     WHERE a.branch_id = ? AND a.year = (SELECT MAX(a2.year) FROM assignments a2 WHERE a2.branch_id = a.branch_id)
     ORDER BY a.sort_order, a.id LIMIT 1`
  );
  const upcomingPrep = db.prepare(
    'SELECT id, date FROM prep_cards WHERE branch_id = ? AND date >= ? ORDER BY date, id LIMIT 3'
  );
  const branches = db
    .prepare(
      `SELECT id, name_fr, name_ar, section FROM branches
        WHERE 1=1${branchFilterSQL(req, 'id')} ORDER BY ${sectionOrderSQL('section')}, sort_order, id`
    )
    .all()
    .map((b) => {
      const out = {
        ...b,
        member_count: canMembers ? memberCount.get(b.id).n : null,
        leader_name: headOf.get(b.id)?.name ?? null,
        // Bug 12 : son prochain jour de نشاط, selon le jour où elle se réunit d'habitude
        next_day: nextWeekday(today, usualWeekday(b.id, today)),
      };
      if (canSessions) {
        // Counted for this فرقة: a shared نشاط splits its roster by each عنصر's فرقة
        const inBranch = attendanceInBranchSQL(b.id);
        const ofBranch = sessionInBranchSQL(b.id);
        out.last_activity =
          db
            .prepare(
              `SELECT id, date FROM sessions s
               WHERE s.kind = 'activity' AND s.date <= ? AND ${ofBranch}
               ORDER BY s.date DESC, s.id DESC LIMIT 1`
            )
            .get(today) || null;
        const s = db
          .prepare(
            `SELECT ${tally} FROM attendance a JOIN sessions s ON s.id = a.session_id
             WHERE s.kind = 'activity' AND s.date >= ? AND ${countedSessionSQL('s', '?')} AND ${inBranch}`
          )
          .get(season.from, today);
        out.season = {
          activities: db
            .prepare(
              `SELECT COUNT(*) AS n FROM sessions s
               WHERE s.kind = 'activity' AND s.date >= ? AND s.date <= ? AND ${ofBranch}`
            )
            .get(season.from, today).n,
          rate: rateOf(s.present, s.marked),
        };
        out.trend = db
          .prepare(
            `SELECT s.date, ${tally} FROM attendance a JOIN sessions s ON s.id = a.session_id
             WHERE s.kind = 'activity' AND ${countedSessionSQL('s', '?')} AND ${inBranch}
             GROUP BY s.date HAVING marked > 0 ORDER BY s.date DESC LIMIT 8`
          )
          .all(today)
          .reverse()
          .map((r) => ({ date: r.date, rate: rateOf(r.present, r.marked) }));
        out.upcoming_prep = hasPerm(req, 'prep.read') ? upcomingPrep.all(b.id, today) : null;
      }
      if (canPlan) {
        // Achievement is derived from the أنشطة, as on the فرق page
        const plan = planFor(b.id, year);
        const due = plan.items.filter((i) => i.date <= today);
        const next = plan.items.find((i) => i.date >= today);
        out.plan = {
          due: due.length,
          due_done: due.filter((i) => i.session).length,
          next: next
            ? { date: next.date, title: next.title, done: !!next.session, session_id: next.session?.id ?? null }
            : null,
        };
      }
      return out;
    });

  // عناصر absent from their last three activities or more, in their current فرقة only —
  // the same count as the badge in Members and on the member's file
  let followup = null;
  if (canMembers && canSessions) {
    followup = [];
    const members = db
      .prepare(
        `SELECT m.id, m.first_name, m.father_name, m.last_name, m.branch_id,
                m.member_phone, m.father_phone, m.mother_phone,
                b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar, g.name AS group_name
         FROM members m JOIN branches b ON b.id = m.branch_id
         LEFT JOIN branch_groups g ON g.id = m.group_id
         WHERE m.status = 'active'${branchFilterSQL(req, 'm.branch_id')}`
      )
      .all();
    for (const m of members) {
      const rows = attributedAttendance(m).rows.filter((r) => r.attributed_branch === m.branch_id);
      const absences = statsFromRows(rows).consecutive_absences;
      if (absences < absenceThreshold()) continue;
      followup.push(
        stripContact(req, { ...m, absences, last_present: rows.find((r) => r.status === 'present')?.date || null })
      );
    }
    followup.sort(
      (a, b) =>
        b.absences - a.absences ||
        String(a.last_name).localeCompare(String(b.last_name)) ||
        String(a.first_name).localeCompare(String(b.first_name))
    );
    const contacts = lastContactsOf(followup.map((f) => f.id));
    for (const f of followup) f.last_contact = contacts.get(f.id) || null;
    for (const b of branches) b.followup_count = followup.filter((f) => f.branch_id === b.id).length;
  }

  // Past séances whose présence is not confirmed (they count nowhere until pointed or
  // validated): the ten latest to open, and the true total beside them (bug 10)
  const unconfirmedWhere = `${unconfirmedSessionSQL('s')}
           AND s.date >= date('${today}', '-${TODO_WINDOW_DAYS} days')${sessionScopeSQL(req)}`;
  const unmarked = canSessions
    ? db
        .prepare(
          `SELECT s.id AS session_id, s.title, s.date,
                  (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id) AS count
           FROM sessions s WHERE ${unconfirmedWhere}
           ORDER BY s.date DESC, s.id DESC LIMIT 10`
        )
        .all()
    : [];
  const unmarkedTotal = canSessions
    ? db.prepare(`SELECT COUNT(*) AS n FROM sessions s WHERE ${unconfirmedWhere}`).get().n
    : 0;

  // Paid activities of the last 60 days where someone present has no payment recorded
  const unpaid = canFees
    ? db
        .prepare(
          `SELECT s.id AS session_id, s.title, s.date,
                  COALESCE(SUM(a.status = 'present'), 0) AS present,
                  COALESCE(SUM(a.status = 'present' AND a.paid IS NULL), 0) AS unpaid
           FROM attendance a JOIN sessions s ON s.id = a.session_id JOIN members m ON m.id = a.member_id
           WHERE s.kind = 'activity' AND s.fee > 0 AND s.date <= ? AND s.date >= date(?, '-60 days')${scoped}
           GROUP BY s.id HAVING unpaid > 0 ORDER BY s.date DESC, s.id DESC`
        )
        .all(today, today)
    : [];

  // أنشطة الأسبوعين الأخيرين التي شارك فيها القائد صاحب الحساب و لم يقيّمها بعد
  const toEvaluate =
    canSessions && req.user.leader_id
      ? db
          .prepare(
            `SELECT s.id AS session_id, s.title, s.date, s.kind
             FROM session_leaders sl JOIN sessions s ON s.id = sl.session_id
             WHERE sl.leader_id = ? AND COALESCE(sl.status, '') != 'absent'
               AND s.date <= ? AND s.date >= date(?, '-${EVAL_REMIND_DAYS} days')
               AND NOT EXISTS (SELECT 1 FROM session_evaluations ev
                                WHERE ev.session_id = s.id AND ev.leader_id = sl.leader_id)
               AND (EXISTS (SELECT 1 FROM eval_kind_forms k WHERE k.kind = s.kind)
                    OR EXISTS (SELECT 1 FROM session_evaluations ev WHERE ev.session_id = s.id))${sessionScopeSQL(req)}
             ORDER BY s.date DESC, s.id DESC LIMIT 10`
          )
          .all(req.user.leader_id, today, today)
      : [];

  // و المخيمات و الدورات التي أخذ فيها دورًا، انتهت في الأسبوعين الأخيرين، و لم يقيّمها بعد
  const me = Number(req.user.leader_id);
  const eventsToEvaluate =
    hasPerm(req, 'events.read') && Number.isInteger(me) && me > 0
      ? db
          .prepare(
            `SELECT e.id AS event_id, e.title, e.kind, e.end_date FROM events e
             WHERE ${eventEvaluatorSQL('e', me)}
               AND e.end_date <= @today AND e.end_date >= date(@today, '-${EVAL_REMIND_DAYS} days')
               AND NOT EXISTS (SELECT 1 FROM event_evaluations ev WHERE ev.event_id = e.id AND ev.leader_id = @me)
               AND (EXISTS (SELECT 1 FROM eval_kind_forms k WHERE k.kind = 'event_' || e.kind)
                    OR EXISTS (SELECT 1 FROM event_evaluations ev WHERE ev.event_id = e.id))${eventScopeSQL(req)}
             ORDER BY e.end_date DESC, e.id DESC LIMIT 10`
          )
          .all({ today, me })
      : [];

  // E1 : les camps des trois semaines à venir qui ne sont pas prêts à partir — autorisations
  // parentales manquantes ou check-list sécurité incomplète
  const eventsToPrepare = hasPerm(req, 'events.read')
    ? db
        .prepare(
          `SELECT * FROM (SELECT e.id AS event_id, e.title, e.kind, e.start_date, ${EVENT_READINESS_SQL('e')}
             FROM events e WHERE e.start_date >= @today AND e.start_date <= date(@today, '+21 days')${eventScopeSQL(req)})
           WHERE consent_missing > 0 OR safety_done < safety_total
           ORDER BY start_date, event_id LIMIT 10`
        )
        .all({ today })
    : [];

  // À venir : les camps, دورات et sorties en cours ou qui commencent dans les 30 jours, avec
  // leurs inscrits et leur état «prêt à partir» ; les réunions déjà ouvertes à une date à
  // venir, et celles qu'une réunion a annoncées (next_date) sans qu'on les ait encore ouvertes
  // — tant qu'aucune réunion plus récente du même cadre ne les a remplacées
  const agendaEvents = hasPerm(req, 'events.read')
    ? db
        .prepare(
          `SELECT e.id AS event_id, e.kind, e.title, e.start_date, e.end_date, e.place,
                  (SELECT COUNT(*) FROM event_participants p
                    WHERE p.event_id = e.id AND p.withdrawn_at IS NULL) AS participants,
                  ${EVENT_READINESS_SQL('e')}
           FROM events e
           WHERE e.end_date >= @today AND e.start_date <= date(@today, '+${AGENDA_DAYS} days')${eventScopeSQL(req)}
           ORDER BY e.start_date, e.id LIMIT 8`
        )
        .all({ today })
    : null;
  let agendaMeetings = null;
  if (hasPerm(req, 'meetings.read')) {
    const scheduled = db
      .prepare(
        `SELECT m.id AS meeting_id, m.kind, m.title, m.date, m.start_time, m.place
         FROM meetings m
         WHERE m.date >= @today AND m.date <= date(@today, '+${AGENDA_DAYS} days')${meetingScopeSQL(req)}
         ORDER BY m.date, COALESCE(m.start_time, ''), m.id LIMIT 8`
      )
      .all({ today });
    const later = db.prepare(
      `SELECT 1 FROM meetings p WHERE ${SAME_SCOPE_SQL} AND (p.date > @date OR (p.date = @date AND p.id > @id)) LIMIT 1`
    );
    const announced = db
      .prepare(
        `SELECT m.id, m.kind, m.title, m.date, m.next_date, m.section
         FROM meetings m
         WHERE m.next_date >= @today AND m.next_date <= date(@today, '+${AGENDA_DAYS} days')${meetingScopeSQL(req)}
         ORDER BY m.next_date, m.id LIMIT 8`
      )
      .all({ today })
      .filter((m) => !nextMeetingOf(m) && !later.get(meetingScopeOf(m)))
      .map((m) => ({ meeting_id: m.id, kind: m.kind, title: m.title, date: m.next_date, from_date: m.date, announced: true }));
    agendaMeetings = [...scheduled, ...announced].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  }

  // H1 : les تكاليف des réunions. Celles du قائد du compte, toutes celles encore à faire — la
  // plus pressée d'abord, sans échéance en dernier ; et, pour qui suit les décisions, celles
  // des autres dont l'échéance est passée : les siennes sont déjà dans la première liste
  const mine = Number.isInteger(me) && me > 0 ? me : -1;
  const openDecisionSQL = `SELECT ${DECISION_COLUMNS}, m.title AS meeting_title, m.date AS meeting_date
       FROM meeting_decisions d JOIN meetings m ON m.id = d.meeting_id LEFT JOIN leaders o ON o.id = d.leader_id
       WHERE d.status = 'open'`;
  const myDecisions =
    hasPerm(req, 'meetings.read') && mine > 0
      ? db
          .prepare(
            `${openDecisionSQL} AND d.leader_id = @me${meetingScopeSQL(req)}
             ORDER BY COALESCE(d.due_date, '9999-12-31'), m.date, d.position, d.id LIMIT 30`
          )
          .all({ me: mine })
      : null;
  const lateDecisionsWhere = `AND d.due_date < @today AND d.leader_id IS NOT @me${meetingScopeSQL(req)}`;
  const lateDecisions = hasPerm(req, 'meetings.followup')
    ? db
        .prepare(`${openDecisionSQL} ${lateDecisionsWhere} ORDER BY d.due_date, m.date, d.position, d.id LIMIT 10`)
        .all({ today, me: mine })
    : null;
  const lateDecisionsTotal = lateDecisions
    ? db
        .prepare(
          `SELECT COUNT(*) AS n FROM meeting_decisions d JOIN meetings m ON m.id = d.meeting_id
           WHERE d.status = 'open' ${lateDecisionsWhere}`
        )
        .get({ today, me: mine }).n
    : 0;

  const recent = canSessions
    ? db
        .prepare(
          `SELECT s.id, s.title, s.date, s.kind, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
             (SELECT COUNT(*) FROM session_branches sb WHERE sb.session_id = s.id) AS branch_count,
             -- نشاط القادة: القادة أنفسهم + عناصر فرقه المدعوّة
             (CASE WHEN s.kind = 'leaders'
                THEN (SELECT COUNT(*) FROM session_leaders sl WHERE sl.session_id = s.id AND sl.status = 'present')
                   + (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'present')
                WHEN s.kind = 'group'
                THEN (SELECT COALESCE(SUM(c.count), 0) FROM session_branch_counts c WHERE c.session_id = s.id)
                ELSE (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'present') END) AS present_count,
             (CASE WHEN s.kind = 'leaders'
                THEN (SELECT COUNT(*) FROM session_leaders sl WHERE sl.session_id = s.id AND sl.status = 'absent')
                   + (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status IN ('absent', 'excused'))
                ELSE (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status IN ('absent', 'excused')) END) AS absent_count,
             (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'unmarked') AS unmarked_count,
             ${unconfirmedSessionSQL('s')} AS unconfirmed
           FROM sessions s LEFT JOIN branches b ON b.id = s.branch_id
           WHERE s.date <= ?${sessionScopeSQL(req)}
           ORDER BY s.date DESC, s.id DESC LIMIT 4`
        )
        .all(today)
    : [];

  let promotions = null;
  if (hasPerm(req, 'promotions.read')) {
    const pending = pendingPromotions().filter((p) => branchOk(req, p.current_branch.id));
    promotions = {
      count: pending.length,
      sample: pending
        .slice(0, 3)
        .map((p) => ({ id: p.id, first_name: p.first_name, father_name: p.father_name, last_name: p.last_name })),
      // Bug 8 : ceux que le ترفيع ne peut pas voir, faute de date de naissance
      missing_birth_date: db.prepare(`SELECT COUNT(*) AS n ${missingBirthDateSQL(req)}`).get().n,
    };
  }
  // B1 : فترة التجربة — combien, et qui est prêt pour le تكريس
  let admissions = null;
  if (hasPerm(req, 'members.read')) {
    const list = pendingAdmissions(req);
    admissions = {
      trial_count: list.length,
      ready: list.filter((a) => a.ready).map((a) => ({
        id: a.id,
        first_name: a.first_name,
        father_name: a.father_name,
        last_name: a.last_name,
        branch_name_fr: a.branch_name_fr,
        branch_name_ar: a.branch_name_ar,
        trial_days: a.trial_days,
      })),
    };
  }

  res.json({
    today,
    next_day: nextSaturday(today),
    year,
    members: canMembers
      ? db
          .prepare(`SELECT COUNT(*) AS n FROM members m WHERE m.status = 'active'${branchFilterSQL(req, 'm.branch_id')}`)
          .get().n
      : null,
    leaders: hasPerm(req, 'leaders.read')
      ? db.prepare(`SELECT COUNT(*) AS n FROM leaders l WHERE status = 'active'${leaderScopeSQL(req)}`).get().n
      : null,
    month,
    trend,
    branches,
    followup,
    unmarked,
    unmarked_total: unmarkedTotal,
    unpaid,
    to_evaluate: toEvaluate,
    events_to_evaluate: eventsToEvaluate,
    events_to_prepare: eventsToPrepare,
    agenda: { events: agendaEvents, meetings: agendaMeetings, days: AGENDA_DAYS },
    my_decisions: myDecisions,
    late_decisions: lateDecisions,
    late_decisions_total: lateDecisionsTotal,
    recent,
    promotions,
    admissions,
    // G1 : cotisations en retard, par فرقة — actifs seulement (les archivés sont en
    // trésorerie), et seulement qui doit un mois passé : le mois en cours non encore payé,
    // c'est tout le monde au début du mois
    dues_arrears: canSeeMemberDues(req)
      ? (() => {
          const a = duesArrears(req);
          const late = a.members;
          const by = new Map();
          for (const r of late) {
            if (!by.has(r.branch_id))
              by.set(r.branch_id, {
                id: r.branch_id,
                name_fr: r.branch_name_fr,
                name_ar: r.branch_name_ar,
                members: 0,
                amount: 0,
              });
            const b = by.get(r.branch_id);
            b.members += 1;
            b.amount += r.owed;
          }
          return {
            members: late.length,
            amount: late.reduce((n, r) => n + r.owed, 0),
            branches: [...by.values()],
          };
        })()
      : null,
    // فرق فيها ما يُنبَّه عليه: طليعة بلا عريف، عدد خارج الحدّين، فرقة تحتاج قسمة (C1)
    staffing: canPlan
      ? db
          .prepare(`SELECT id, name_fr, name_ar FROM branches WHERE 1=1${branchFilterSQL(req, 'id')} ORDER BY sort_order, id`)
          .all()
          .map((b) => ({ ...b, ...staffingAlerts(b.id) }))
          .filter((b) => b.count > 0)
      : [],
    birthdays: upcomingBirthdays().filter((b) =>
      b.kind === 'leader'
        ? leaderOk(req, b) && hasPerm(req, 'leaders.read')
        : branchOk(req, b.branch_id) && hasPerm(req, 'members.read')
    ),
  });
});

// ---------- Rapport périodique à la قيادة (I1) ----------
// Un seul rapport pour rendre compte d'un mois ou d'un trimestre : une فرقة (id) ou tout
// le فوج visible (0). Il agrège ce que les autres modules calculent déjà — présence
// validée (A1), suivi et contacts (A2), admissions (B1), arriérés (G1), camps, caisses —
// chaque partie seulement pour un compte qui a le droit de la voir.
const REPORT_MAX_DAYS = 400;
const shiftISO = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const reportRecipient = () => appSettingStmt.get('report_recipient')?.value || '';

// Le mois écoulé par défaut : c'est celui qu'on rend au début du suivant
function reportPeriod(q) {
  let from = typeof q.from === 'string' ? q.from : '';
  let to = typeof q.to === 'string' ? q.to : '';
  if (!from && !to) {
    const first = `${todayISO().slice(0, 7)}-01`;
    to = shiftISO(first, -1);
    from = `${to.slice(0, 7)}-01`;
  }
  if (!validISODate(from) || !validISODate(to) || from > to) return null;
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1;
  if (days > REPORT_MAX_DAYS) return null;
  // Des mois entiers (mois, trimestre) : comparés aux mêmes mois juste avant ; sinon, au
  // même nombre de jours
  const monthEnd = (iso) => shiftISO(iso, 1).endsWith('-01');
  let prevFrom = shiftISO(from, -days);
  if (from.endsWith('-01') && monthEnd(to)) {
    const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
    const d = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1 - months, 1));
    prevFrom = d.toISOString().slice(0, 10);
  }
  return { from, to, days, prev: { from: prevFrom, to: shiftISO(from, -1) } };
}

// Présence d'une فرقة sur une période : les seules séances qui comptent (countedSessionSQL)
function branchAttendance(branchId, from, to) {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(a.status = 'present'), 0) AS present,
              COALESCE(SUM(a.status = 'absent'), 0) AS absent,
              COALESCE(SUM(a.status = 'excused'), 0) AS excused
       FROM attendance a JOIN sessions s ON s.id = a.session_id
       WHERE s.kind = 'activity' AND a.status != 'unmarked' AND s.date BETWEEN ? AND ?
         AND ${countedSessionSQL('s')} AND ${attendanceInBranchSQL(branchId)}`
    )
    .get(from, to);
  const marked = r.present + r.absent + r.excused;
  return { ...r, marked, rate: marked ? Math.round((r.present / marked) * 100) : null };
}

// Séries d'absences en cours des عناصر actifs d'une فرقة, en une requête
function streaksOf(branchId) {
  const rows = db
    .prepare(
      `SELECT a.member_id, a.status FROM attendance a
       JOIN sessions s ON s.id = a.session_id JOIN members m ON m.id = a.member_id
       WHERE m.branch_id = ? AND m.status = 'active' AND s.kind = 'activity' AND a.status != 'unmarked'
         AND ${countedSessionSQL('s')}
       ORDER BY a.member_id, s.date DESC, s.id DESC`
    )
    .all(branchId);
  const out = new Map();
  const done = new Set();
  for (const r of rows) {
    if (done.has(r.member_id)) continue;
    if (r.status === 'absent') out.set(r.member_id, (out.get(r.member_id) || 0) + 1);
    else done.add(r.member_id);
  }
  return out;
}

function periodReport(req, branchId, p) {
  const today = todayISO();
  const section = activeSection(req);
  const all = getBranches().filter((b) => branchOk(req, b.id) && (!section || b.section === section));
  // Le فوج : les فرق vides (aucun عنصر actif, aucune séance) n'encombrent pas le rapport
  const branches = branchId
    ? getBranches().filter((b) => b.id === branchId)
    : all.filter(
        (b) =>
          db.prepare("SELECT 1 FROM members WHERE branch_id = ? AND status = 'active' LIMIT 1").get(b.id) ||
          db
            .prepare(`SELECT 1 FROM sessions s WHERE s.date BETWEEN ? AND ? AND ${sessionInBranchSQL(b.id)} LIMIT 1`)
            .get(p.from, p.to)
      );
  const ids = branches.map((b) => b.id);
  const idList = ids.length ? ids.join(',') : '-1';
  const threshold = absenceThreshold();
  const canMembers = hasPerm(req, 'members.read');
  const followup = [];

  const rows = branches.map((b) => {
    const s = db
      .prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(${countedSessionSQL('s')}), 0) AS counted,
           COALESCE(SUM(${unconfirmedSessionSQL('s')}), 0) AS unconfirmed,
           COALESCE(SUM(s.date >= '${today}' AND NOT ${countedSessionSQL('s')}), 0) AS planned
         FROM sessions s WHERE s.kind = 'activity' AND s.date BETWEEN ? AND ? AND ${sessionInBranchSQL(b.id)}`
      )
      .get(p.from, p.to);
    const visits = db
      .prepare(
        `SELECT COUNT(*) AS n FROM sessions s WHERE s.kind = 'visit' AND s.date BETWEEN ? AND ? AND ${sessionInBranchSQL(b.id)}`
      )
      .get(p.from, p.to).n;
    const m = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM members WHERE branch_id = @b AND status = 'active') AS active,
           (SELECT COUNT(*) FROM members WHERE branch_id = @b AND join_date BETWEEN @f AND @t) AS joined,
           (SELECT COUNT(*) FROM members WHERE branch_id = @b AND status != 'active'
              AND substr(archived_at, 1, 10) BETWEEN @f AND @t) AS archived,
           (SELECT COUNT(*) FROM promotions WHERE old_branch_id = @b AND reversed_at IS NULL
              AND substr(promoted_at, 1, 10) BETWEEN @f AND @t) AS promoted_out,
           (SELECT COUNT(*) FROM promotions WHERE new_branch_id = @b AND reversed_at IS NULL
              AND substr(promoted_at, 1, 10) BETWEEN @f AND @t) AS promoted_in,
           (SELECT COUNT(*) FROM members WHERE branch_id = @b AND status = 'active' AND admission_status = 'trial') AS trial,
           (SELECT COUNT(*) FROM members WHERE branch_id = @b AND invested_at BETWEEN @f AND @t) AS invested`
      )
      .get({ b: b.id, f: p.from, t: p.to });
    // À suivre : la série d'absences en cours atteint le seuil (A2)
    const streaks = streaksOf(b.id);
    const followIds = [...streaks].filter(([, n]) => n >= threshold).map(([id]) => id);
    const last = lastContactsOf(followIds);
    const contacts = db
      .prepare(
        `SELECT COUNT(*) AS n, COUNT(DISTINCT c.member_id) AS members FROM member_contacts c
         JOIN members m ON m.id = c.member_id
         WHERE m.branch_id = ? AND substr(c.contacted_at, 1, 10) BETWEEN ? AND ?`
      )
      .get(b.id, p.from, p.to);
    if (canMembers && followIds.length)
      for (const pm of db
        .prepare(`SELECT id, first_name, father_name, last_name FROM members WHERE id IN (${followIds.join(',')})`)
        .all())
        followup.push({
          ...pm,
          branch_id: b.id,
          branch_name_fr: b.name_fr,
          branch_name_ar: b.name_ar,
          absences: streaks.get(pm.id),
          last_contact: last.get(pm.id)?.contacted_at || null,
          last_contact_by: last.get(pm.id)?.contacted_by || null,
        });
    return {
      id: b.id,
      name_fr: b.name_fr,
      name_ar: b.name_ar,
      section: b.section,
      sessions: { ...s, visits },
      attendance: branchAttendance(b.id, p.from, p.to),
      prev_attendance: branchAttendance(b.id, p.prev.from, p.prev.to),
      members: m,
      followup: {
        count: followIds.length,
        contacted: followIds.filter((id) => (last.get(id)?.contacted_at || '').slice(0, 10) >= p.from).length,
        contacts: contacts.n,
        contacted_members: contacts.members,
      },
    };
  });
  followup.sort((a, b) => b.absences - a.absences);

  // Totaux : séances distinctes (une séance commune à deux فرق compte une fois)
  const distinct = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(${countedSessionSQL('s')}), 0) AS counted,
         COALESCE(SUM(${unconfirmedSessionSQL('s')}), 0) AS unconfirmed,
         COALESCE(SUM(s.date >= '${today}' AND NOT ${countedSessionSQL('s')}), 0) AS planned
       FROM sessions s WHERE s.kind = 'activity' AND s.date BETWEEN ? AND ?
         AND EXISTS (SELECT 1 FROM session_branches sb WHERE sb.session_id = s.id AND sb.branch_id IN (${idList}))`
    )
    .get(p.from, p.to);
  const sumRows = (pick) => rows.reduce((n, r) => n + pick(r), 0);
  const rateOf = (key) => {
    const marked = sumRows((r) => r[key].marked);
    return marked ? Math.round((sumRows((r) => r[key].present) / marked) * 100) : null;
  };
  const leaderSessions = branchId
    ? null
    : db
        .prepare(
          `SELECT COUNT(*) AS n FROM sessions s WHERE s.kind IN ('leaders', 'group') AND s.date BETWEEN ? AND ?${sessionScopeSQL(req)}`
        )
        .get(p.from, p.to).n;

  const out = {
    period: p,
    today,
    branch_id: branchId || 0,
    branch: branchId ? { id: branches[0].id, name_fr: branches[0].name_fr, name_ar: branches[0].name_ar } : null,
    recipient: reportRecipient(),
    threshold,
    branches: rows,
    totals: {
      sessions: distinct,
      leader_sessions: leaderSessions,
      rate: rateOf('attendance'),
      prev_rate: rateOf('prev_attendance'),
      active: sumRows((r) => r.members.active),
      joined: sumRows((r) => r.members.joined),
      archived: sumRows((r) => r.members.archived),
      promoted_out: sumRows((r) => r.members.promoted_out),
      promoted_in: sumRows((r) => r.members.promoted_in),
      trial: sumRows((r) => r.members.trial),
      invested: sumRows((r) => r.members.invested),
      followup: sumRows((r) => r.followup.count),
      followup_contacted: sumRows((r) => r.followup.contacted),
      contacts: sumRows((r) => r.followup.contacts),
    },
    followup: canMembers ? followup : null,
    admissions: null,
    dues: null,
    events: null,
    treasury: null,
    overdue: null,
  };

  // Admissions : prêts pour le تكريس (B1)
  if (canMembers) {
    const ready = pendingAdmissions(req).filter((a) => ids.includes(a.branch_id) && a.ready);
    out.admissions = {
      ready: ready.map((a) => ({
        id: a.id,
        first_name: a.first_name,
        father_name: a.father_name,
        last_name: a.last_name,
        branch_name_fr: a.branch_name_fr,
        branch_name_ar: a.branch_name_ar,
        trial_days: a.trial_days,
      })),
    };
  }

  // Cotisations : encaissé sur la période, arriérés à ce jour (G1)
  if (canSeeMemberDues(req)) {
    const arrears = duesArrears(req, {});
    const by = new Map();
    for (const r of arrears.members) {
      const x = by.get(r.branch_id) || { members: 0, amount: 0 };
      x.members++;
      x.amount += r.owed;
      by.set(r.branch_id, x);
    }
    const col = new Map(
      db
        .prepare(
          `SELECT COALESCE(d.branch_id, m.branch_id) AS bid, COALESCE(SUM(d.amount), 0) AS amount
           FROM member_dues d LEFT JOIN members m ON m.id = d.member_id
           WHERE COALESCE(d.branch_id, m.branch_id) IN (${idList}) AND d.paid_on BETWEEN ? AND ? GROUP BY bid`
        )
        .all(p.from, p.to)
        .map((r) => [r.bid, r.amount])
    );
    out.dues = {
      rate: arrears.rate,
      branches: rows.map((r) => ({
        id: r.id,
        name_fr: r.name_fr,
        name_ar: r.name_ar,
        collected: col.get(r.id) || 0,
        late_members: by.get(r.id)?.members || 0,
        owed: by.get(r.id)?.amount || 0,
      })),
    };
  }

  // Camps et دورات qui touchent la période
  if (hasPerm(req, 'events.read')) {
    const fees = hasPerm(req, 'events.read.fees');
    const bid = intOr(branchId);
    const branchSQL = branchId
      ? ` AND (NOT EXISTS (SELECT 1 FROM event_branches eb WHERE eb.event_id = e.id)
             OR EXISTS (SELECT 1 FROM event_branches eb WHERE eb.event_id = e.id AND eb.branch_id = ${bid}))`
      : '';
    out.events = db
      .prepare(
        `SELECT e.id, e.kind, e.title, e.start_date, e.end_date, e.place,
           (SELECT COUNT(*) FROM event_participants pp JOIN members pm ON pm.id = pp.member_id
             WHERE pp.event_id = e.id AND pp.withdrawn_at IS NULL
               ${branchId ? `AND pm.branch_id = ${bid}` : ''}) AS members,
           (SELECT COUNT(*) FROM event_participants pp
             WHERE pp.event_id = e.id AND pp.withdrawn_at IS NULL AND pp.member_id IS NULL) AS others
           ${fees ? `, (SELECT COALESCE(SUM(pp.paid), 0) FROM event_participants pp WHERE pp.event_id = e.id AND pp.withdrawn_at IS NULL) AS paid` : ''}
         FROM events e WHERE e.start_date <= ? AND e.end_date >= ?${eventScopeSQL(req)}${branchSQL}
         ORDER BY e.start_date, e.id`
      )
      .all(p.to, p.from);
  }

  // Caisses : ouverture, entrées, sorties et clôture sur la période
  if (hasPerm(req, 'treasury.read')) {
    const openings = openingsOf(treasurySections(req));
    out.treasury = treasuryBoxes(req)
      .filter((b) => b.visible && (branchId ? b.branch_id === branchId : !b.branch_id || ids.includes(b.branch_id)))
      .map(({ visible: _v, ...box }) => {
        const start = boxStart(box, openings);
        if (!start || start.date > p.to) return { ...box, opened: false };
        let income = 0;
        let expenses = 0;
        for (const r of boxRows(box, start.date)) {
          if (r.date < p.from || r.date > p.to) continue;
          if (r.direction === 'in') income += r.amount;
          else expenses += r.amount;
        }
        return {
          ...box,
          opened: true,
          opening: start.date >= p.from ? start.amount : bookBalanceOn(box, shiftISO(p.from, -1)),
          income,
          expenses,
          closing: bookBalanceOn(box, p.to),
        };
      });
  }

  // تكاليف en retard (محاضر)
  if (hasPerm(req, 'meetings.read')) {
    const branchSQL = branchId
      ? ` AND (NOT EXISTS (SELECT 1 FROM meeting_branches mb WHERE mb.meeting_id = m.id)
             OR EXISTS (SELECT 1 FROM meeting_branches mb WHERE mb.meeting_id = m.id AND mb.branch_id = ${intOr(branchId)}))`
      : '';
    out.overdue = db
      .prepare(
        `SELECT d.id, d.text, d.due_date, d.meeting_id, m.title AS meeting_title,
           COALESCE(${fullNameSQL('l')}, d.owner) AS owner
         FROM meeting_decisions d JOIN meetings m ON m.id = d.meeting_id
         LEFT JOIN leaders l ON l.id = d.leader_id
         WHERE d.status = 'open' AND d.due_date IS NOT NULL AND d.due_date < ?${meetingScopeSQL(req)}${branchSQL}
         ORDER BY d.due_date LIMIT 50`
      )
      .all(today);
  }
  return out;
}

app.get('/api/reports/period', requirePerm('branches.read'), (req, res) => {
  const p = reportPeriod(req.query);
  if (!p) return res.status(400).json({ error: 'invalid period' });
  const branchId = req.query.branch && req.query.branch !== '0' ? intOr(req.query.branch) : 0;
  if (branchId && !db.prepare('SELECT 1 FROM branches WHERE id = ?').get(branchId))
    return res.status(404).json({ error: 'not found' });
  if (branchId && (!branchOk(req, branchId) || (activeSection(req) && sectionOfBranch(branchId) !== activeSection(req))))
    return res.status(403).json({ error: 'forbidden' });
  res.json(periodReport(req, branchId, p));
});

// Le destinataire mémorisé (المرسَل إليه) : lu par tous, posé par l'admin
app.get('/api/settings/report', (req, res) => res.json({ recipient: reportRecipient() }));
app.put('/api/settings/report', requireAdmin, (req, res) => {
  const v = optionalText(req.body?.recipient, 120);
  if (v === undefined) return res.status(400).json({ error: 'text too long' });
  const before = reportRecipient();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('report_recipient', ?, datetime('now'), ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(v || '', req.user.display_name || req.user.username);
  auditEvent(req, 'update', 'app_setting', 'report_recipient', { value: before }, { value: v || '' });
  res.json({ recipient: reportRecipient() });
});

// Production: serve the built client if present (npm run build at repo root)
const clientDist = path.join(__dirname, '..', 'client', 'dist');

// ---------- تصدير PDF ----------
// Chromium opens the app's own /print/<kind>/<id> sheet with the caller's token and
// prints it. The sheet's API calls run under that same token, so the file holds
// exactly what the caller may see on screen — no separate permission model.
const PDF_KINDS = {
  sessions: 'sessions.read',
  members: 'members.read',
  leaders: 'leaders.read',
  branches: 'branches.read',
  // قائمة لا بطاقة: «الترفيعات في الانتظار»، و الرقم فرقةٌ لا عنصر — 0 يعني كل الفرق
  promotions: 'promotions.read',
  // القوائم: الرقم فرقةٌ (0 = كل الفرق)، و المرشِّحات الحالية للصفحة تُمرَّر في الاستعلام
  'members-list': 'members.read',
  'leaders-list': 'leaders.read',
  'sessions-list': 'sessions.read',
  'prep-list': 'prep.read',
  // خطة الفرقة السنوية: الرقم فرقة، و ?year= السنة الكشفية
  plan: 'branches.read',
  prep: 'prep.read',
  // الصناديق: الرقم 0، و ?box= الصندوق المختار (بلا box: كلها) و ?flow= in|out كما في الصفحة
  treasury: 'treasury.read',
  // مالية الفرقة: الرقم فرقة. ما يُرى منها (المبالغ، الصندوق) يقرّره /branches/:id/money
  'branch-money': 'branches.read',
  // محضر اجتماع، ثم قائمة الاجتماعات (الرقم 0 و المرشِّحات في الاستعلام) و متابعة القرارات
  meeting: 'meetings.read',
  'meetings-list': 'meetings.read',
  'meeting-decisions': 'meetings.read',
  // E2 : le dossier de camp (?variant=report : le rapport à la قيادة), puis ses restes à payer
  event: 'events.read',
  'event-unpaid': 'events.read.fees',
  // G1 : la feuille de relance des cotisations en retard — le numéro est une فرقة (0 = toutes), ?year=
  'dues-arrears': 'members.dues.read',
  // I1 : le rapport périodique à la قيادة — le numéro est une فرقة (0 = le فوج), ?from=&to=&recipient=
  period: 'branches.read',
};
// Filters the list sheets read from the query string — nothing else reaches Chromium's URL
const printQuery = (q) => {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(q || {}))
    if (k !== 'lang' && /^[a-z_]{1,32}$/.test(k) && typeof v === 'string' && v.length <= 120) out.set(k, v);
  const s = out.toString();
  return s ? `?${s}` : '';
};
// Where Chromium finds the app: the served build in production, Vite in dev
const clientBaseUrl = () =>
  process.env.CLIENT_URL ||
  (fs.existsSync(clientDist) ? `http://127.0.0.1:${process.env.PORT || 3001}` : 'http://127.0.0.1:5173');

app.get('/api/export/:kind/:id.pdf', async (req, res) => {
  const perm = PDF_KINDS[req.params.kind];
  if (!perm) return res.status(404).json({ error: 'not found' });
  if (!hasPerm(req, perm)) return res.status(403).json({ error: 'forbidden' });
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  const lang = req.query.lang === 'ar' ? 'ar' : 'fr';
  try {
    const { pdf, title } = await renderPdf({
      url: `${clientBaseUrl()}/print/${req.params.kind}/${req.params.id}${printQuery(req.query)}`,
      token: req.token,
      lang,
      // The sheet reads the same قسم the admin is looking at (a restricted account's
      // own قسم wins on the server anyway)
      section: activeSection(req),
    });
    // The tab title ("Fiche du membre — Ali Ahmad") names the file
    const name = `${(title || 'export')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)}.pdf`;
    // Plain-ASCII fallback for old clients: accents stripped, other scripts dropped
    const ascii = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]+/g, '')
      .replace(/"/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
    );
    res.send(pdf);
  } catch (err) {
    console.error('pdf export failed:', err.message);
    if (err.code === 'pdf_page_error') return res.status(502).json({ error: 'pdf_page_error' });
    if (chromiumMissing(err)) return res.status(501).json({ error: 'pdf_unavailable' });
    res.status(500).json({ error: 'pdf_failed' });
  }
});
if (fs.existsSync(clientDist)) {
  // Hashed asset filenames change on every build, so they can be cached hard.
  // index.html must NOT be cached: a stale copy keeps pointing phones at the
  // previous bundle, which looks exactly like "the update never shipped".
  app.use(
    express.static(clientDist, {
      index: false,
      setHeaders(res, filePath) {
        res.setHeader(
          'Cache-Control',
          /[/\\]assets[/\\]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache'
        );
      },
    })
  );
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
    // A chunk of a previous build (a tab opened before the deploy): a plain 404. Sent
    // as index.html it fails as a script with a MIME error; either way the page
    // reloads once onto the new build (main.jsx)
    if (req.path.startsWith('/assets/')) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

seedAbsenceReminders();

const PORT = process.env.PORT || 3001;
// Corps trop lourd (JSON ou fichier de séance) : une erreur JSON que l'écran sait lire,
// pas la page HTML d'Express avec sa pile
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'file_too_large' });
  next(err);
});

app.listen(PORT, async () => {
  console.log(`API server listening on http://localhost:${PORT}`);
  // Windows lets this server take [::]:PORT while another project already holds
  // 0.0.0.0:PORT. Nothing fails, but the Vite proxy and Puppeteer dial 127.0.0.1 and
  // reach that other API: every call comes back 401. Stop here instead.
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, {
      headers: { 'X-Instance-Probe': instanceProbe },
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 204) return;
    console.error(
      `\n127.0.0.1:${PORT} is answered by another program, not this server.\n` +
        `Stop it, or move this app: PORT=3011 for the server, API_URL=http://127.0.0.1:3011 for Vite.\n`
    );
    process.exit(1);
  } catch {
    /* nothing on IPv4 at all (IPv6-only host): no clash to report */
  }
});
