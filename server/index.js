const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, seed, seedLeaders, migrate, migrateAmanaHelpers, tachkilaTemplate } = require('./db');

migrate();
seed();
seedLeaders();

const app = express();
app.use(express.json({ limit: '10mb' }));

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

// Granular permission catalog, grouped by page. Dashboard is always allowed;
// التشكيلة / settings / admin stay admin-only regardless.
const PERM_GROUPS = {
  members: [
    'members.read',
    'members.create',
    'members.edit',
    'members.delete',
    'members.contact',
    // زيادة أو إلغاء مطلب لأي عنصر بشكل يدوي
    'members.matalib',
  ],
  sessions: ['sessions.read', 'sessions.create', 'sessions.attendance', 'sessions.read.fees'],
  // Reading الفرق, plus writing الخطة السنوية of a فرقة and its مجموعات.
  // branches.groups also moves عناصر between مجموعات: تقسيم الفرقة عمل قائدها،
  // و هو تنظيم داخلي لا يمسّ ملف العنصر، فلا يُشترط له members.edit.
  branches: ['branches.read', 'branches.plan', 'branches.groups'],
  promotions: ['promotions.read', 'promotions.apply'],
  // Reading التشكيلة, plus filling in بطاقة تقدم القائد. Creating, assigning and
  // deleting توصيفات stays admin-only.
  leaders: ['leaders.read', 'leaders.progress'],
};
const ALL_PERMS = Object.values(PERM_GROUPS).flat();

// What the old "view" level of a page used to show (it displayed phones and fees)
const LEGACY_VIEW = {
  members: ['members.read', 'members.contact'],
  sessions: ['sessions.read', 'sessions.read.fees'],
  branches: ['branches.read'],
  promotions: ['promotions.read'],
  leaders: ['leaders.read'],
};

// perms went array-of-pages → {page: level} → array of granular keys.
// Whatever shape is stored, normalize to the granular array.
function normalizePerms(raw) {
  if (!raw) return null;
  const out = new Set();
  if (Array.isArray(raw)) {
    for (const k of raw) {
      if (PERM_GROUPS[k]) PERM_GROUPS[k].forEach((p) => out.add(p)); // legacy page name = full page
      else if (ALL_PERMS.includes(k)) out.add(k);
    }
  } else if (typeof raw === 'object') {
    for (const [page, level] of Object.entries(raw)) {
      if (!PERM_GROUPS[page]) continue;
      if (level === 'edit') PERM_GROUPS[page].forEach((p) => out.add(p));
      else if (level === 'view') LEGACY_VIEW[page].forEach((p) => out.add(p));
    }
  }
  return [...out];
}

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  display_name: u.display_name,
  role: u.role,
  // null = every فرقة; otherwise the branch ids this account may see
  branches: u.branches ? JSON.parse(u.branches) : null,
  // null = full access; otherwise the granular permission keys granted
  perms: u.perms ? normalizePerms(JSON.parse(u.perms)) : null,
  // القائد صاحب الحساب إن وُلّد من صفحة القادة
  leader_id: u.leader_id ?? null,
});

const hasPerm = (req, key) =>
  req.user.role === 'admin' || !req.user.perms || req.user.perms.includes(key);

const requirePerm = (key) => (req, res, next) =>
  hasPerm(req, key) ? next() : res.status(403).json({ error: 'forbidden' });

// One of several permissions is enough — used where the same action is reachable
// from more than one page (adding a quartier while registering or while editing).
const requireAnyPerm = (...keys) => (req, res, next) =>
  keys.some((k) => hasPerm(req, k)) ? next() : res.status(403).json({ error: 'forbidden' });

// Coordinates are personal data: without members.contact they never leave the server
const CONTACT_FIELDS = ['member_phone', 'father_phone', 'mother_phone', 'address_abidjan', 'address_lebanon'];
function stripContact(req, m) {
  if (hasPerm(req, 'members.contact')) return m;
  const out = { ...m };
  for (const f of CONTACT_FIELDS) if (f in out) out[f] = null;
  return out;
}

// Money is its own permission, like contact info
const stripFee = (req, s) => (hasPerm(req, 'sessions.read.fees') ? s : { ...s, fee: null });

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = username && db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!u || !verifyPassword(String(password || ''), u.password_hash))
    return res.status(401).json({ error: 'invalid_credentials' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO auth_tokens (token, user_id) VALUES (?, ?)').run(token, u.id);
  res.json({ token, user: publicUser(u) });
});

// Every other /api route requires a valid token
app.use('/api', (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const u =
    token &&
    db
      .prepare('SELECT u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?')
      .get(token);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  req.user = publicUser(u);
  req.token = token;
  next();
});

app.post('/api/auth/logout', (req, res) => {
  db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(req.token);
  res.status(204).end();
});

app.get('/api/auth/me', (req, res) => res.json(req.user));

const requireAdmin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'admin_only' });

// null = unrestricted; otherwise the Set of allowed branch ids
const allowedBranches = (req) =>
  req.user.role === 'admin' || !req.user.branches ? null : new Set(req.user.branches);

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
      OR (SELECT m2.branch_id FROM members m2 WHERE m2.id = ${aAlias}.member_id) = ${id}))`;
};

// SQL fragment limiting أنشطة to the caller's فرق — نشاط بلا فرقة (قادة / فوج) يمرّ
function sessionScopeSQL(req, alias = 's') {
  const scope = allowedBranches(req);
  if (!scope) return '';
  const ids = [...scope].map(Number).filter(Number.isInteger);
  const list = ids.length ? ids.join(',') : -1;
  return ` AND (${alias}.branch_id IS NULL OR EXISTS (
      SELECT 1 FROM session_branches sb WHERE sb.session_id = ${alias}.id AND sb.branch_id IN (${list})))`;
}

// هل يرى المستخدم هذا النشاط؟ تكفي فرقة واحدة مشتركة بينه و بين فرق النشاط
function sessionOk(req, session) {
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

// مجموعات فرقة، و عدد عناصرها النشطين
const groupsOfBranch = (branchId) =>
  db
    .prepare(
      `SELECT g.id, g.branch_id, g.name, g.sort_order,
        (SELECT COUNT(*) FROM members m WHERE m.group_id = g.id AND m.status = 'active') AS member_count
       FROM branch_groups g WHERE g.branch_id = ? ORDER BY g.sort_order, g.id`
    )
    .all(branchId);

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
  return v.length ? JSON.stringify(v) : null;
}

// Same contract as parseBranchList: null = unrestricted, undefined = invalid input.
// Accepts every historical shape; stores the granular key array.
function parsePermList(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v) && !v.every((k) => typeof k === 'string' && (ALL_PERMS.includes(k) || PERM_GROUPS[k])))
    return undefined;
  if (!Array.isArray(v) && typeof v !== 'object') return undefined;
  const keys = normalizePerms(v);
  // Every permission granted = no restriction
  return keys.length === ALL_PERMS.length ? null : JSON.stringify(keys);
}

app.get('/api/users', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY username').all().map(publicUser));
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, display_name, role } = req.body;
  if (!username || !String(username).trim()) return res.status(400).json({ error: 'username required' });
  if (!password || String(password).length < 4) return res.status(400).json({ error: 'password too short' });
  if (!['admin', 'user'].includes(role || 'user')) return res.status(400).json({ error: 'invalid role' });
  const branches = parseBranchList(req.body.branches);
  if (branches === undefined) return res.status(400).json({ error: 'invalid branches' });
  const perms = parsePermList(req.body.perms);
  if (perms === undefined) return res.status(400).json({ error: 'invalid perms' });
  try {
    const info = db
      .prepare(
        'INSERT INTO users (username, password_hash, display_name, role, branches, perms) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        String(username).trim(),
        hashPassword(String(password)),
        display_name || null,
        role || 'user',
        branches,
        perms
      );
    res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)));
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
  // The last admin cannot be demoted, or the admin page becomes unreachable
  if (u.role === 'admin' && role !== 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (admins <= 1) return res.status(400).json({ error: 'last_admin' });
  }
  const branches =
    req.body.branches === undefined ? u.branches : parseBranchList(req.body.branches);
  if (branches === undefined && req.body.branches !== undefined)
    return res.status(400).json({ error: 'invalid branches' });
  const perms = req.body.perms === undefined ? u.perms : parsePermList(req.body.perms);
  if (perms === undefined && req.body.perms !== undefined)
    return res.status(400).json({ error: 'invalid perms' });
  let password_hash = u.password_hash;
  if (req.body.password) {
    if (String(req.body.password).length < 4) return res.status(400).json({ error: 'password too short' });
    password_hash = hashPassword(String(req.body.password));
    // A password change kicks that user's devices out
    db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(u.id);
  }
  db.prepare(
    'UPDATE users SET display_name = ?, role = ?, branches = ?, perms = ?, password_hash = ? WHERE id = ?'
  ).run(req.body.display_name ?? u.display_name, role, branches, perms, password_hash, u.id);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)));
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'cannot_delete_self' });
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'user not found' });
  res.status(204).end();
});

const todayISO = () => new Date().toISOString().slice(0, 10);

function calcAge(birthDate, ref = new Date()) {
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

function pendingPromotions() {
  const branches = getBranches();
  const byId = Object.fromEntries(branches.map((b) => [b.id, b]));
  const members = db.prepare("SELECT * FROM members WHERE status = 'active'").all();
  const out = [];
  for (const m of members) {
    const cur = byId[m.branch_id];
    if (!cur || cur.max_age === null) continue;
    const age = calcAge(m.birth_date);
    if (age <= cur.max_age) continue;
    const target = targetBranchFor(age, branches);
    if (!target || target.id === cur.id) continue;
    out.push({
      id: m.id,
      first_name: m.first_name,
      father_name: m.father_name,
      last_name: m.last_name,
      photo: m.photo,
      age,
      current_branch: cur,
      target_branch: target,
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

  return db
    .prepare(
      `SELECT m.id, m.first_name, m.father_name, m.last_name, m.photo, m.birth_date, m.branch_id,
              b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
         FROM members m LEFT JOIN branches b ON b.id = m.branch_id
        WHERE m.status = 'active' AND substr(m.birth_date, 6, 5) IN (?, ?)`
    )
    .all(md(now), md(tomorrow))
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
         AND ${sessionInBranchSQL(branchId)}`
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

// Visits are deliberately excluded: a زيارة الأهل is not an activity the عنصر
// attended, so counting it would inflate every présence rate.
function attendanceStats(memberId, branchId) {
  const rows = db
    .prepare(
      `SELECT a.status, s.date, s.title, s.matalib, s.id AS session_id
       FROM attendance a JOIN sessions s ON s.id = a.session_id
       WHERE a.member_id = ? AND s.kind = 'activity'
       ORDER BY s.date DESC, s.id DESC`
    )
    .all(memberId)
    .map((r) => ({ ...r, matalib: JSON.parse(r.matalib || '[]') }));
  const total = rows.length;
  const present = rows.filter((r) => r.status === 'present').length;
  let streak = 0;
  for (const r of rows) {
    if (r.status === 'absent') streak++;
    else break;
  }
  const earned = branchId ? earnedNumbersInBranch(memberId, branchId) : [];
  return {
    history: rows,
    total,
    present,
    rate: total ? Math.round((present / total) * 100) : null,
    consecutive_absences: streak,
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
          WHERE a.branch_id = b.id AND a.year = (SELECT MAX(year) FROM assignments)
          ORDER BY a.sort_order, a.id LIMIT 1) AS leader_name,
        (SELECT a.leader_id FROM assignments a
          WHERE a.branch_id = b.id AND a.year = (SELECT MAX(year) FROM assignments)
            AND a.leader_id IS NOT NULL
          ORDER BY a.sort_order, a.id LIMIT 1) AS leader_id
       FROM branches b WHERE 1=1${branchFilterSQL(req, 'b.id')} ORDER BY b.sort_order`
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
  const branches = db
    .prepare(`SELECT * FROM branches WHERE 1=1${branchFilterSQL(req, 'id')} ORDER BY sort_order, id`)
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
         FROM sessions s WHERE ${sessionInBranchSQL(id)}`
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
         WHERE s.kind = 'activity' AND ${attendanceInBranchSQL(id)}`
      )
      .get();
  const leadersStmt = db.prepare(
    `SELECT a.id, a.title, a.leader_id, l.first_name, l.father_name, l.last_name, l.photo
     FROM assignments a LEFT JOIN leaders l ON l.id = a.leader_id
     WHERE a.branch_id = ? AND a.year = ?
     ORDER BY a.sort_order, a.id`
  );
  const mataliOf = (id) =>
    db.prepare(`SELECT matalib FROM sessions s WHERE kind = 'activity' AND ${sessionInBranchSQL(id)}`).all();
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
      `SELECT s.id, s.title, s.date, s.leader, s.matalib, s.kind
       FROM sessions s WHERE ${sessionInBranchSQL(branch.id)} ORDER BY s.date DESC, s.id DESC`
    )
    .all()
    .map((s) => ({ ...s, matalib: JSON.parse(s.matalib || '[]') }));

  const attendeesStmt = db.prepare(
    `SELECT a.status, m.id, m.first_name, m.father_name, m.last_name, m.photo
     FROM attendance a JOIN members m ON m.id = a.member_id
     WHERE a.session_id = ? ORDER BY m.last_name, m.first_name`
  );
  const animatorsStmt = db.prepare(
    `SELECT l.id, l.first_name, l.father_name, l.last_name, sl.role, sl.status
     FROM session_leaders sl JOIN leaders l ON l.id = sl.leader_id
     WHERE sl.session_id = ? ORDER BY sl.role = 'helper', l.last_name`
  );

  res.json(
    sessions.map((s) => {
      const attendees = attendeesStmt.all(s.id);
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

// Titles compare trimmed and case-folded, so a stray space or capital never
// costs the فرقة its achievement
const planTitleKey = (t) => String(t || '').trim().toLowerCase();

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
    .prepare('SELECT id, year, branch_id, date, title FROM annual_plan WHERE branch_id = ? AND year = ? ORDER BY date, id')
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
      if (!byTitle.has(k)) byTitle.set(k, s);
    }
  }
  const rows = items.map((i) => {
    const s = byPlan.get(i.id) || byTitle.get(planTitleKey(i.title)) || null;
    return {
      ...i,
      session: s ? { id: s.id, title: s.title, date: s.date, linked: s.linked_item_id === i.id } : null,
    };
  });
  const doneCount = rows.filter((r) => r.session).length;
  return {
    year,
    years: planYears(),
    items: rows,
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
app.get('/api/branches/:id/plan/options', requirePerm('sessions.create'), (req, res) => {
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'invalid date' });
    if (!date.startsWith(month)) return res.status(400).json({ error: 'date_outside_month' });
    if (date < range.from || date > range.to)
      return res.status(400).json({ error: 'date_outside_year' });
    items.push({ id: Number.isInteger(r?.id) ? r.id : null, date, title });
  }

  const existing = db
    .prepare('SELECT id FROM annual_plan WHERE branch_id = ? AND year = ? AND substr(date, 1, 7) = ?')
    .all(branch.id, year, month);
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

function validateBranchBody(body, { requireNames }) {
  const { min_age, max_age, total_requirements, name_fr, name_ar } = body;
  if (!Number.isInteger(min_age) || min_age < 0) return 'invalid min_age';
  if (max_age !== null && max_age !== undefined && (!Number.isInteger(max_age) || max_age < min_age))
    return 'invalid max_age';
  if (!Number.isInteger(total_requirements) || total_requirements < 0)
    return 'invalid total_requirements';
  if (requireNames || name_fr !== undefined) {
    if (typeof name_fr !== 'string' || !name_fr.trim()) return 'invalid name_fr';
  }
  if (requireNames || name_ar !== undefined) {
    if (typeof name_ar !== 'string' || !name_ar.trim()) return 'invalid name_ar';
  }
  return null;
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
    // العناصر غير النشطين يظهرون أيضًا: توزيعهم محفوظ، و عودتهم لا تحتاج إعادة توزيع
    members: db
      .prepare(
        `SELECT id, first_name, father_name, last_name, photo, status, group_id FROM members
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
  const next =
    db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM branch_groups WHERE branch_id = ?')
      .get(branch.id).n;
  try {
    const id = db
      .prepare('INSERT INTO branch_groups (branch_id, name, sort_order) VALUES (?, ?, ?)')
      .run(branch.id, name, next).lastInsertRowid;
    res.status(201).json(db.prepare('SELECT * FROM branch_groups WHERE id = ?').get(id));
  } catch (e) {
    // UNIQUE(branch_id, name) — مجموعتان بنفس الاسم في فرقة واحدة لا تُميَّزان
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'group_exists' });
    throw e;
  }
});

app.put('/api/branches/:id/groups/:gid', requirePerm('branches.groups'), (req, res) => {
  const branch = branchForGroups(req, res, 'branches.groups');
  if (!branch) return;
  const g = db.prepare('SELECT * FROM branch_groups WHERE id = ? AND branch_id = ?')
    .get(req.params.gid, branch.id);
  if (!g) return res.status(404).json({ error: 'group not found' });
  const name = groupName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    db.prepare('UPDATE branch_groups SET name = ? WHERE id = ?').run(name, g.id);
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

app.post('/api/branches', requireAdmin, (req, res) => {
  const err = validateBranchBody(req.body, { requireNames: true });
  if (err) return res.status(400).json({ error: err });
  const { name_fr, name_ar, min_age, max_age, total_requirements } = req.body;
  // sort_order mirrors min_age so branches always list in age order
  const info = db
    .prepare(
      'INSERT INTO branches (name_fr, name_ar, min_age, max_age, sort_order, total_requirements) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(name_fr.trim(), name_ar.trim(), min_age, max_age ?? null, min_age, total_requirements);
  res.status(201).json(db.prepare('SELECT * FROM branches WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/branches/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'branch not found' });
  const err = validateBranchBody(req.body, { requireNames: false });
  if (err) return res.status(400).json({ error: err });
  const { min_age, max_age, total_requirements, name_fr, name_ar } = req.body;
  db.prepare(
    `UPDATE branches SET name_fr = ?, name_ar = ?, min_age = ?, max_age = ?, sort_order = ?, total_requirements = ?
     WHERE id = ?`
  ).run(
    name_fr !== undefined ? name_fr.trim() : existing.name_fr,
    name_ar !== undefined ? name_ar.trim() : existing.name_ar,
    min_age,
    max_age ?? null,
    min_age,
    total_requirements,
    req.params.id
  );
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
    db.prepare('SELECT COUNT(*) AS n FROM promotions WHERE old_branch_id = ? OR new_branch_id = ?').get(id, id).n;
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

const MEMBER_FIELDS = ['first_name', 'last_name', 'birth_date', 'sex', 'branch_id', 'join_date', 'blood_type'];

// فصيلة الدم — a closed list: a group outing needs it readable at a glance, and a
// free-text field would fill up with "O positif", "o+", "O +" for the same thing.
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function validateMember(body) {
  for (const f of MEMBER_FIELDS) {
    if (body[f] === undefined || body[f] === null || body[f] === '') return `missing field: ${f}`;
  }
  if (!BLOOD_TYPES.includes(body.blood_type)) return 'invalid blood_type';
  if (!['M', 'F'].includes(body.sex)) return 'invalid sex';
  if (!['active', 'inactive'].includes(body.status || 'active')) return 'invalid status';
  if (!db.prepare('SELECT id FROM branches WHERE id = ?').get(body.branch_id)) return 'invalid branch_id';
  return null;
}

// Age is derived from birth_date, so sorting by age is sorting by birth_date:
// the oldest عنصر is the one born first.
const MEMBER_SORTS = {
  name: 'm.last_name, m.first_name',
  age_desc: 'm.birth_date ASC, m.last_name',
  age_asc: 'm.birth_date DESC, m.last_name',
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

app.get('/api/members', requirePerm('members.read'), (req, res) => {
  const {
    branch, q, status, school, residence,
    residence_lebanon: residenceLebanon,
    blood, age_min: ageMin, age_max: ageMax,
    parent_phone: parentPhone,
    joined_from: joinedFrom, joined_to: joinedTo,
  } = req.query;
  const canContact = hasPerm(req, 'members.contact');
  let sql = `SELECT m.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
               g.name AS group_name
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
    .map((m) => stripContact(req, { ...m, age: calcAge(m.birth_date) }));
  res.json(rows);
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
      `SELECT p.id, p.promoted_at, p.matalib,
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
  res.json(
    stripContact(req, {
      ...m,
      age: calcAge(m.birth_date),
      stats: attendanceStats(m.id, m.branch_id),
      visits: familyVisits(m.id),
      // مطالب زيدت أو أُلغيت يدويًا — the UI marks them apart from the ones earned in أنشطة
      manual_matalib: manualMatalib(m.id, m.branch_id),
      promotions,
    })
  );
});

app.post('/api/members', requirePerm('members.create'), (req, res) => {
  const err = validateMember(req.body);
  if (err) return res.status(400).json({ error: err });
  if (!branchOk(req, req.body.branch_id)) return res.status(403).json({ error: 'forbidden' });
  const b = req.body;
  const groupId = resolveGroupId(b.group_id, b.branch_id);
  if (groupId === undefined) return res.status(400).json({ error: 'invalid group_id' });
  const info = db
    .prepare(
      `INSERT INTO members (first_name, last_name, father_name, mother_name, birth_date, birth_place,
        address_abidjan, address_lebanon, school, blood_type, sex, branch_id, group_id, member_phone,
        father_phone, mother_phone, join_date, photo, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.first_name, b.last_name, b.father_name || null, b.mother_name || null,
      b.birth_date, b.birth_place || null, b.address_abidjan || null, b.address_lebanon || null,
      b.school || null, b.blood_type, b.sex, b.branch_id, groupId, b.member_phone || null,
      b.father_phone || null, b.mother_phone || null, b.join_date, b.photo || null, b.status || 'active'
    );
  res.status(201).json(db.prepare('SELECT * FROM members WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/members/:id', requirePerm('members.edit'), (req, res) => {
  const existing = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'member not found' });
  const err = validateMember(req.body);
  if (err) return res.status(400).json({ error: err });
  // Both the member's current فرقة and the one being assigned must be in scope
  if (!branchOk(req, existing.branch_id) || !branchOk(req, req.body.branch_id))
    return res.status(403).json({ error: 'forbidden' });
  const b = req.body;
  // مجموعات الفرقة الجديدة وحدها مقبولة: نقل عنصر إلى فرقة أخرى يُخرجه من مجموعته
  // القديمة، إلا أن يكون الطلب نفسه قد اختار له مجموعة من الفرقة الجديدة.
  const groupId = resolveGroupId(b.group_id, b.branch_id);
  if (groupId === undefined) return res.status(400).json({ error: 'invalid group_id' });
  db.prepare(
    `UPDATE members SET first_name = ?, last_name = ?, father_name = ?, mother_name = ?,
     birth_date = ?, birth_place = ?, address_abidjan = ?, address_lebanon = ?, school = ?, blood_type = ?,
     sex = ?, branch_id = ?, group_id = ?, member_phone = ?, father_phone = ?, mother_phone = ?,
     join_date = ?, photo = ?, status = ? WHERE id = ?`
  ).run(
    b.first_name, b.last_name, b.father_name || null, b.mother_name || null,
    b.birth_date, b.birth_place || null, b.address_abidjan || null, b.address_lebanon || null,
    b.school || null, b.blood_type, b.sex, b.branch_id, groupId, b.member_phone || null,
    b.father_phone || null, b.mother_phone || null, b.join_date, b.photo || null,
    b.status || 'active', req.params.id
  );
  res.json(db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id));
});

app.delete('/api/members/:id', requirePerm('members.delete'), (req, res) => {
  const existing = db.prepare('SELECT branch_id FROM members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'member not found' });
  if (!branchOk(req, existing.branch_id)) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM members WHERE id = ?').run(req.params.id);
  res.status(204).end();
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
  res.json({
    earned_numbers: earnedNumbersInBranch(m.id, m.branch_id),
    manual_matalib: manualMatalib(m.id, m.branch_id),
  });
});

// ---------- Promotions ----------

app.get('/api/promotions/pending', requirePerm('promotions.read'), (req, res) => {
  // A scoped قائد only sees promotions leaving one of his فرق
  res.json(pendingPromotions().filter((p) => branchOk(req, p.current_branch.id)));
});

app.post('/api/promotions/validate', requirePerm('promotions.apply'), (req, res) => {
  const ids = req.body.member_ids;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: 'member_ids required' });
  const pending = pendingPromotions().filter((p) => branchOk(req, p.current_branch.id));
  const byId = Object.fromEntries(pending.map((p) => [p.id, p]));
  const insert = db.prepare(
    'INSERT INTO promotions (member_id, old_branch_id, new_branch_id, promoted_at, matalib) VALUES (?, ?, ?, ?, ?)'
  );
  // الترقية تنقل العنصر إلى فرقة أخرى، و المجموعة تخصّ فرقتها: يخرج منها ليُوزَّع
  // من جديد في فرقته الجديدة.
  const update = db.prepare('UPDATE members SET branch_id = ?, group_id = NULL WHERE id = ?');
  let promoted = 0;
  const run = db.transaction(() => {
    for (const id of ids) {
      const p = byId[id];
      if (!p) continue;
      const acquired = earnedNumbersInBranch(p.id, p.current_branch.id);
      insert.run(p.id, p.current_branch.id, p.target_branch.id, todayISO(), JSON.stringify(acquired));
      update.run(p.target_branch.id, p.id);
      promoted++;
    }
  });
  run();
  res.json({ promoted });
});

app.get('/api/promotions/history', requirePerm('promotions.read'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.promoted_at, p.member_id, p.matalib,
        m.first_name, m.father_name, m.last_name,
        ob.name_fr AS old_name_fr, ob.name_ar AS old_name_ar,
        nb.name_fr AS new_name_fr, nb.name_ar AS new_name_ar
       FROM promotions p
       JOIN members m ON m.id = p.member_id
       JOIN branches ob ON ob.id = p.old_branch_id
       JOIN branches nb ON nb.id = p.new_branch_id
       WHERE 1=1${branchFilterSQL(req, 'p.old_branch_id')}
       ORDER BY p.promoted_at DESC, p.id DESC`
    )
    .all()
    .map((p) => ({ ...p, matalib: JSON.parse(p.matalib || '[]') }));
  res.json(rows);
});

// ---------- Leaders & التشكيلة ----------

const latestYear = () =>
  db.prepare('SELECT MAX(year) AS y FROM assignments').get().y || null;

// Assignments (with leader + branch names) for a given تشكيلة year.
// LEFT JOIN on leaders: a توصيف with no قائد yet is a real row, it just shows up unassigned.
function assignmentsForYear(year) {
  if (!year) return [];
  return db
    .prepare(
      `SELECT a.*, l.first_name, l.father_name, l.last_name, l.photo,
        b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar, g.name AS group_name
       FROM assignments a
       LEFT JOIN leaders l ON l.id = a.leader_id
       LEFT JOIN branches b ON b.id = a.branch_id
       LEFT JOIN branch_groups g ON g.id = a.group_id
       WHERE a.year = ?
       ORDER BY a.role_type = 'amana', COALESCE(b.sort_order, 999), a.sort_order, a.id`
    )
    .all(year);
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
// بالقائد، بكلمة سرّ تُعرض مرّة واحدة، و بصلاحيات من قالب جاهز — فليس كل قائد
// يرى كل شيء. الضبط الدقيق بعد ذلك من صفحة الأدمن كما كان.
const ACCOUNT_PRESETS = {
  // قائد فرقة: يدير عناصره و أنشطته و خطة فرقته و مجموعاتها، و يقرأ ما حوله.
  // بلا حذف عناصر، بلا تثبيت ترقيات، بلا أرقام مالية — هذه للأدمن.
  branch: [
    'members.read', 'members.create', 'members.edit', 'members.contact', 'members.matalib',
    'sessions.read', 'sessions.create', 'sessions.attendance',
    'branches.read', 'branches.plan', 'branches.groups',
    'promotions.read',
    'leaders.read', 'leaders.progress',
  ],
  // أمين: يرى الفوج كله و يسجّل أنشطة و حضورًا، بلا لمس ملفات العناصر
  amana: [
    'members.read',
    'sessions.read', 'sessions.create', 'sessions.attendance',
    'branches.read',
    'promotions.read',
    'leaders.read', 'leaders.progress',
  ],
  // قراءة فقط — اطّلاع بلا أي كتابة
  readonly: ['members.read', 'sessions.read', 'branches.read', 'promotions.read', 'leaders.read'],
  // كل الصلاحيات و كل الفرق، من غير إدارة الحسابات (ليس أدمن)
  full: null,
};

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

app.post('/api/leaders/:id/account', requireAdmin, (req, res) => {
  const leader = db.prepare('SELECT * FROM leaders WHERE id = ?').get(req.params.id);
  if (!leader) return res.status(404).json({ error: 'leader not found' });
  // حساب واحد لكل قائد: الثاني التباسٌ لا فائدة
  if (db.prepare('SELECT id FROM users WHERE leader_id = ?').get(leader.id))
    return res.status(409).json({ error: 'account_exists' });
  const username = String(req.body?.username || '').trim();
  if (!username) return res.status(400).json({ error: 'username required' });
  const preset = req.body?.preset;
  if (!Object.prototype.hasOwnProperty.call(ACCOUNT_PRESETS, preset))
    return res.status(400).json({ error: 'invalid preset' });
  const branches = parseBranchList(req.body?.branches);
  if (branches === undefined) return res.status(400).json({ error: 'invalid branches' });
  const password = generatePassword();
  const perms = ACCOUNT_PRESETS[preset];
  let info;
  try {
    info = db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, branches, perms, leader_id) VALUES (?, ?, ?, 'user', ?, ?, ?)"
      )
      .run(
        username,
        hashPassword(password),
        [leader.first_name, leader.father_name, leader.last_name].filter(Boolean).join(' '),
        branches,
        perms ? JSON.stringify(perms) : null,
        leader.id
      );
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'username_taken' });
    throw e;
  }
  // كلمة السرّ تُعاد هنا وحدها و لا تُخزَّن إلا مجزّأة: من أضاعها يولّد غيرها من صفحة الأدمن
  res.status(201).json({
    user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)),
    password,
  });
});

app.post('/api/leaders/:id/progress', requirePerm('leaders.progress'), (req, res) => {
  const l = db.prepare('SELECT id FROM leaders WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'leader not found' });
  const year = normYear(req.body?.year) || defaultCardYear();
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

app.get('/api/leaders', (req, res) => {
  const rows = db
    .prepare(
      `SELECT l.*,
        (SELECT u.id FROM users u WHERE u.leader_id = l.id LIMIT 1) AS account_user_id,
        (SELECT u.username FROM users u WHERE u.leader_id = l.id LIMIT 1) AS account_username,
        (SELECT COUNT(*) FROM sessions s WHERE s.leader_id = l.id AND s.kind != 'visit') AS sessions_count,
        (SELECT COUNT(*) FROM session_leaders sl JOIN sessions s ON s.id = sl.session_id
          WHERE sl.leader_id = l.id AND sl.status = 'present' AND s.kind != 'visit') AS present_count,
        (SELECT COUNT(*) FROM session_leaders sl JOIN sessions s ON s.id = sl.session_id
          WHERE sl.leader_id = l.id AND sl.status = 'absent' AND s.kind != 'visit') AS absent_count,
        (SELECT COUNT(*) FROM session_leaders sl JOIN sessions s ON s.id = sl.session_id
          WHERE sl.leader_id = l.id AND s.kind = 'visit') AS visits_count
       FROM leaders l ORDER BY l.last_name, l.first_name`
    )
    .all();
  const year = latestYear();
  const roles = {};
  for (const a of assignmentsForYear(year)) {
    if (!a.leader_id) continue;
    (roles[a.leader_id] = roles[a.leader_id] || []).push({
      title: a.title,
      role_type: a.role_type,
      branch_id: a.branch_id,
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
      ...publicLeader(l),
      roles: roles[l.id] || [],
      year,
      card: { year: cardYear, total: cardTotal, done_count: doneByLeader[l.id] || 0 },
    }))
  );
});

app.get('/api/leaders/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM leaders WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'leader not found' });
  const assignments = db
    .prepare(
      `SELECT a.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
       FROM assignments a LEFT JOIN branches b ON b.id = a.branch_id
       WHERE a.leader_id = ? ORDER BY a.year DESC, a.id`
    )
    .all(l.id);
  // All sessions where the leader is animator (main or helper), with their own présence
  const sessions = db
    .prepare(
      `SELECT s.id, s.title, s.date, s.matalib, s.kind, sl.role, sl.status AS my_status,
        b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'present') AS present_count
       FROM session_leaders sl
       JOIN sessions s ON s.id = sl.session_id
       LEFT JOIN branches b ON b.id = s.branch_id
       WHERE sl.leader_id = ? ORDER BY s.date DESC, s.id DESC`
    )
    .all(l.id)
    .map((r) => ({ ...r, matalib: JSON.parse(r.matalib || '[]') }));
  const year = latestYear();
  // زيارات الأهل are listed on their own: they are not أنشطة this قائد animated
  const activities = sessions.filter((s) => s.kind !== 'visit');
  const visitedNames = db.prepare(
    `SELECT m.id, m.first_name, m.father_name, m.last_name FROM attendance a JOIN members m ON m.id = a.member_id
     WHERE a.session_id = ? AND a.status = 'present' ORDER BY m.last_name, m.first_name`
  );
  const visits = sessions
    .filter((s) => s.kind === 'visit')
    .map((s) => ({ ...s, members: visitedNames.all(s.id) }));
  const attendance = {
    present: activities.filter((s) => s.my_status === 'present').length,
    absent: activities.filter((s) => s.my_status === 'absent').length,
    unmarked: activities.filter((s) => !s.my_status).length,
  };
  // بطاقة تقدم القائد — one سنة at a time, picked with ?year=
  const years = cardYears();
  const selectedYear = years.includes(normYear(req.query.year)) ? normYear(req.query.year) : years[0];
  res.json({
    ...publicLeader(l),
    year,
    current_roles: assignments.filter((a) => a.year === year),
    assignments,
    sessions: activities,
    visits,
    attendance,
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
  if (!body.first_name || !body.last_name) return 'first_name and last_name required';
  if (!['active', 'inactive'].includes(body.status || 'active')) return 'invalid status';
  if (body.marital_status && !MARITAL_STATUSES.includes(body.marital_status))
    return 'invalid marital_status';
  // سنة الانتساب: أربعة أرقام. الحدّ الأعلى مفتوح عمدًا — لا يُرفض إدخال سنة قادمة
  // بسبب ساعة خاطئة على الجهاز.
  if (body.join_year && !/^[0-9]{4}$/.test(String(body.join_year).trim()))
    return 'invalid join_year';
  if (leaderYearCount(body.years_ghadir) === undefined) return 'invalid years_ghadir';
  if (leaderYearCount(body.years_total) === undefined) return 'invalid years_total';
  if (parseTrainingCourses(body.training_level) === undefined) return 'invalid training_level';
  return null;
}

// القيم التي تدخل في INSERT/UPDATE، بالترتيب نفسه في الاثنين
const leaderValues = (b) => [
  b.first_name,
  b.last_name,
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
  const info = db
    .prepare(
      `INSERT INTO leaders (${LEADER_COLUMNS.join(', ')})
       VALUES (${LEADER_COLUMNS.map(() => '?').join(', ')})`
    )
    .run(...leaderValues(b));
  res.status(201).json(publicLeader(db.prepare('SELECT * FROM leaders WHERE id = ?').get(info.lastInsertRowid)));
});

app.put('/api/leaders/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM leaders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'leader not found' });
  const err = validateLeader(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  db.prepare(
    `UPDATE leaders SET ${LEADER_COLUMNS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`
  ).run(...leaderValues(b), req.params.id);
  // Refresh the name snapshot on sessions this leader animated — الاسم الثلاثي حين
  // يوجد اسم الأب، كما يُعرض القائد في كل مكان آخر
  db.prepare('UPDATE sessions SET leader = ? WHERE leader_id = ?').run(
    [b.first_name, b.father_name, b.last_name].filter(Boolean).join(' '), req.params.id
  );
  res.json(publicLeader(db.prepare('SELECT * FROM leaders WHERE id = ?').get(req.params.id)));
});

app.delete('/api/leaders/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT id FROM leaders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'leader not found' });
  // Deleting him would empty his توصيفات — refuse while one of them sits in a frozen year
  const held = db
    .prepare(
      'SELECT 1 FROM assignments a JOIN tachkila_locks k ON k.year = a.year WHERE a.leader_id = ? LIMIT 1'
    )
    .get(req.params.id);
  if (held) return res.status(423).json({ error: 'year_locked' });
  const run = db.transaction(() => {
    // Sessions keep the leader name as plain text, only the link is removed.
    // His توصيفات survive too (FK ON DELETE SET NULL): the slots stay in the تشكيلة, unassigned.
    db.prepare('UPDATE sessions SET leader_id = NULL WHERE leader_id = ?').run(req.params.id);
    // حسابه يبقى مفكوك الربط: سحب الدخول قرار أدمن صريح لا أثر جانبي لحذف ملف
    db.prepare('UPDATE users SET leader_id = NULL WHERE leader_id = ?').run(req.params.id);
    db.prepare('DELETE FROM leaders WHERE id = ?').run(req.params.id);
  });
  run();
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
  if (!year) return res.status(400).json({ error: 'year required' });
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
    .prepare('SELECT DISTINCT year FROM assignments ORDER BY year DESC')
    .all()
    .map((r) => r.year);
  const year = req.query.year || years[0] || null;
  const template = tachkilaTemplate();
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
    assignments: assignmentsForYear(year),
    // Standard titles, plus how many of them this year is still missing (offer to fill them in)
    template: template.map((r) => r.title),
    missing_count: year ? template.filter((r) => !titles.has(r.title)).length : template.length,
  });
});

// '' from an unselected <select> means "no one assigned yet", not an invalid id
const optionalId = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

function validateAssignment(body, selfId = null) {
  if (!body.year || !String(body.year).trim()) return 'year required';
  if (!body.title || !String(body.title).trim()) return 'title required';
  const leaderId = optionalId(body.leader_id);
  if (leaderId !== null && !db.prepare('SELECT id FROM leaders WHERE id = ?').get(leaderId))
    return 'invalid leader_id';
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
      .prepare('SELECT year, role_type, parent_id FROM assignments WHERE id = ?')
      .get(parentId);
    if (
      !parent ||
      parent.role_type !== 'amana' ||
      parent.parent_id !== null ||
      parent.year !== String(body.year).trim()
    )
      return 'invalid parent_id';
  }
  return null;
}

app.post('/api/tachkila', requireAdmin, rejectLocked((req) => req.body?.year), (req, res) => {
  const err = validateAssignment(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  const branchId = optionalId(b.branch_id);
  const info = db
    .prepare(
      'INSERT INTO assignments (year, leader_id, title, branch_id, group_id, parent_id, role_type, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      String(b.year).trim(),
      optionalId(b.leader_id),
      String(b.title).trim(),
      branchId,
      resolveGroupId(b.group_id, branchId) ?? null,
      branchId ? null : optionalId(b.parent_id),
      branchId ? 'branch' : 'amana',
      Number.isInteger(b.sort_order) ? b.sort_order : 0
    );
  res.status(201).json(db.prepare('SELECT * FROM assignments WHERE id = ?').get(info.lastInsertRowid));
});

app.put(
  '/api/tachkila/:id',
  requireAdmin,
  rejectLocked((req) => [assignmentYear(req), req.body?.year]),
  (req, res) => {
    const existing = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'assignment not found' });
    const body = { ...existing, ...req.body };
    const err = validateAssignment(body, req.params.id);
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
      `UPDATE assignments SET year = ?, leader_id = ?, title = ?, branch_id = ?, group_id = ?, parent_id = ?, role_type = ?, sort_order = ?
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
      req.params.id
    );
    res.json(db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id));
  }
);

app.delete('/api/tachkila/:id', requireAdmin, rejectLocked(assignmentYear), (req, res) => {
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
    'INSERT INTO assignments (year, leader_id, title, branch_id, group_id, parent_id, role_type, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

// New تشكيلة year. `mode` decides what it starts with:
//   template (default) — every standard توصيف of the فوج as an empty slot
//   copy               — same توصيفات AND same قادة as `from_year`
//   empty              — nothing, build it by hand
app.post('/api/tachkila/copy', requireAdmin, rejectLocked((req) => req.body?.to_year), (req, res) => {
  const { from_year, to_year, mode = 'template' } = req.body;
  if (!to_year || !String(to_year).trim()) return res.status(400).json({ error: 'to_year required' });
  if (!['template', 'copy', 'empty'].includes(mode)) return res.status(400).json({ error: 'invalid mode' });
  const target = String(to_year).trim();
  const exists = db.prepare('SELECT COUNT(*) AS n FROM assignments WHERE year = ?').get(target).n;
  if (exists > 0) return res.status(400).json({ error: 'year_exists' });

  let rows = [];
  if (mode === 'copy') {
    if (!from_year) return res.status(400).json({ error: 'from_year required' });
    rows = db
      .prepare(
        'SELECT id, leader_id, title, branch_id, group_id, parent_id, role_type, sort_order FROM assignments WHERE year = ? ORDER BY sort_order, id'
      )
      .all(from_year);
  } else if (mode === 'template') {
    rows = tachkilaTemplate().map((r) => ({ ...r, leader_id: null }));
  }

  const insert = insertAssignmentRow();
  const run = db.transaction(() => {
    // التبعية تُنسخ على مرحلتين: الصفوف كلها أولًا، ثم parent_id يُعاد ربطه بأرقام
    // السنة الجديدة — الأرقام القديمة تخصّ سنة المصدر و لا معنى لها هنا.
    const idMap = new Map();
    for (const r of rows) {
      const info = insert.run(
        target, r.leader_id ?? null, r.title, r.branch_id, r.group_id ?? null, null,
        r.role_type, r.sort_order ?? 0
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
app.post('/api/tachkila/fill', requireAdmin, rejectLocked((req) => req.body?.year), (req, res) => {
  const year = String(req.body.year || '').trim();
  if (!year) return res.status(400).json({ error: 'year required' });
  const titles = new Set(
    db.prepare('SELECT title FROM assignments WHERE year = ?').all(year).map((r) => r.title.trim())
  );
  const missing = tachkilaTemplate().filter((r) => !titles.has(r.title));
  const insert = insertAssignmentRow();
  const run = db.transaction(() => {
    for (const r of missing) insert.run(year, null, r.title, r.branch_id, null, null, r.role_type, r.sort_order);
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
  const { q, branch, from, to, leader, activity_type: activityType, kind } = req.query;
  let sql = `SELECT s.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        COALESCE(${fullNameSQL('l')}, s.leader) AS leader,
        (SELECT GROUP_CONCAT(sb.branch_id) FROM session_branches sb WHERE sb.session_id = s.id) AS branch_ids,
        (SELECT GROUP_CONCAT(sg.group_id) FROM session_groups sg WHERE sg.session_id = s.id) AS group_ids,
        (SELECT COALESCE(SUM(c.count), 0) FROM session_branch_counts c WHERE c.session_id = s.id) AS branch_counts_total,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'present') AS present_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'absent') AS absent_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'excused') AS excused_count,
        (SELECT ROUND(100.0 * SUM(a.status = 'present') / NULLIF(COUNT(*), 0))
           FROM attendance a WHERE a.session_id = s.id) AS rate
       FROM sessions s LEFT JOIN branches b ON b.id = s.branch_id
       LEFT JOIN leaders l ON l.id = s.leader_id
       WHERE 1=1${sessionScopeSQL(req)}`;
  const params = [];
  // فلترة بفرقة: النشاط المشترك يظهر في قائمة كل فرقة يشملها، لا في الرئيسية وحدها
  if (branch) sql += ` AND ${sessionInBranchSQL(branch)}`;
  // Dates are stored as YYYY-MM-DD, so plain string comparison sorts correctly
  if (from) { sql += ' AND s.date >= ?'; params.push(from); }
  if (to) { sql += ' AND s.date <= ?'; params.push(to); }
  if (activityType) { sql += ' AND s.activity_type = ?'; params.push(activityType); }
  if (kind) { sql += ' AND s.kind = ?'; params.push(kind); }
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
                             WHERE sl.session_id = s.id AND (${fullNameSQL('l2')}) LIKE ?))`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY ${SESSION_SORTS[req.query.sort] || SESSION_SORTS.date_desc}`;
  const rows = db
    .prepare(sql)
    .all(...params)
    .map((r) =>
      stripFee(req, {
        ...r,
        matalib: JSON.parse(r.matalib || '[]'),
        branch_ids: parseIdList(r.branch_ids),
        group_ids: parseIdList(r.group_ids),
      })
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
  const rawBranchIds = Array.isArray(req.body.branch_ids)
    ? req.body.branch_ids
    : [branch_id].filter((v) => v !== undefined && v !== null && v !== '');
  const branchIds = branchless ? [] : [...new Set(rawBranchIds.map(Number))];
  const branchId = branchless ? null : (branchIds[0] ?? null);
  if (!title || !date) return res.status(400).json({ error: 'title, date required' });
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
  if (fee !== undefined && fee !== null && (typeof fee !== 'number' || fee < 0))
    return res.status(400).json({ error: 'invalid fee' });
  let leaderRow = null;
  if (leader_id !== undefined && leader_id !== null) {
    leaderRow = db.prepare('SELECT * FROM leaders WHERE id = ?').get(leader_id);
    if (!leaderRow) return res.status(400).json({ error: 'invalid leader_id' });
  }
  const helpers = helper_ids === undefined || helper_ids === null ? [] : helper_ids;
  if (!Array.isArray(helpers) || !helpers.every((h) => Number.isInteger(h)))
    return res.status(400).json({ error: 'invalid helper_ids' });
  for (const h of helpers) {
    if (!db.prepare('SELECT id FROM leaders WHERE id = ?').get(h))
      return res.status(400).json({ error: 'invalid helper_ids' });
  }
  // زيارة الأهل: the visited عناصر are marked present straight away, so the visit
  // lands in their file (and in the قادة files) without a second attendance step
  const visited = member_ids === undefined || member_ids === null ? [] : member_ids;
  if (!Array.isArray(visited) || !visited.every((m) => Number.isInteger(m)))
    return res.status(400).json({ error: 'invalid member_ids' });
  for (const m of visited) {
    if (!db.prepare('SELECT id FROM members WHERE id = ?').get(m))
      return res.status(400).json({ error: 'invalid member_ids' });
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
  // `leader` keeps a plain-text name snapshot so old data and linked leaders display the same way
  const leaderName = leaderRow ? `${leaderRow.first_name} ${leaderRow.last_name}` : leader || null;
  const insertAnimator = db.prepare(
    'INSERT OR IGNORE INTO session_leaders (session_id, leader_id, role) VALUES (?, ?, ?)'
  );
  const insertVisited = db.prepare(
    `INSERT INTO attendance (session_id, member_id, status) VALUES (?, ?, 'present')
     ON CONFLICT(session_id, member_id) DO UPDATE SET status = 'present'`
  );
  let sessionId;
  db.transaction(() => {
    sessionId = db
      .prepare(
        `INSERT INTO sessions
          (title, date, branch_id, leader, leader_id, fee, matalib, start_time, place, activity_type, leaders_count, kind, plan_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        title,
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
        planItemId
      )
      .lastInsertRowid;
    if (leaderRow) insertAnimator.run(sessionId, leaderRow.id, 'main');
    for (const h of helpers) {
      if (leaderRow && h === leaderRow.id) continue;
      insertAnimator.run(sessionId, h, 'helper');
    }
    for (const m of visited) insertVisited.run(sessionId, m);
    // فرق النشاط — الرئيسية منها مكرّرة في sessions.branch_id، و الجدول هو المرجع
    for (const b of branchIds)
      db.prepare('INSERT OR IGNORE INTO session_branches (session_id, branch_id) VALUES (?, ?)')
        .run(sessionId, b);
    for (const g of groupIds)
      db.prepare('INSERT OR IGNORE INTO session_groups (session_id, group_id) VALUES (?, ?)')
        .run(sessionId, g);
    // كل عناصر النشاط غائبون افتراضيًا: القائد يقلب الحاضرين فقط، فمن لم
    // يُلمس يبقى غيابًا مسجّلًا لا فراغًا منسيًّا. (After the group inserts —
    // the group-scope SQL reads session_groups for this very session.)
    if (kind === 'activity') {
      const rosterBranches = branchIds.map(intOr).join(',') || -1;
      db.prepare(
        `INSERT OR IGNORE INTO attendance (session_id, member_id, status)
         SELECT ?, m.id, 'absent' FROM members m
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
  })();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  notifyAdmins(req, 'session_create', row);
  res.status(201).json({
    ...row,
    matalib: JSON.parse(row.matalib),
    branch_ids: branchIdsOfSession(sessionId),
    group_ids: groupIdsOfSession(sessionId),
  });
});

// حذف نشاط — أدمن فقط. الحضور و المنشّطون و روابط الخطة تسقط معه (ON DELETE
// CASCADE)، و إشعاراته تحتفظ بعنوانه المنسوخ (SET NULL) فلا تنكسر.
app.delete('/api/sessions/:id', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
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
  // and a نشاط عام للفوج have no عناصر roster at all.
  // النشاط المحصور بمجموعات لا يعرض إلا عناصرها: الفرقة كبيرة و الحصّة لا تسعها،
  // فالقائد يضع حضور مجموعته وحدها بدل التنقيب عن أسمائها في قائمة الفرقة كلها.
  const groupScope = memberInSessionGroupsSQL(s.id, 'm');
  const roster = ['leaders', 'group'].includes(s.kind) ? [] : db
    .prepare(
      s.kind === 'visit'
        ? `SELECT m.id, m.first_name, m.father_name, m.last_name, m.photo, m.branch_id, m.group_id,
                  g.name AS group_name, a.status
           FROM attendance a JOIN members m ON m.id = a.member_id
           LEFT JOIN branch_groups g ON g.id = m.group_id
           WHERE a.session_id = ? AND m.branch_id IN (${rosterList})
           ORDER BY m.branch_id, m.last_name, m.first_name`
        : `SELECT m.id, m.first_name, m.father_name, m.last_name, m.photo, m.branch_id, m.group_id,
                  g.name AS group_name, a.status
           FROM members m
           LEFT JOIN attendance a ON a.member_id = m.id AND a.session_id = ?
           LEFT JOIN branch_groups g ON g.id = m.group_id
           WHERE m.branch_id IN (${rosterList}) AND m.status = 'active' AND ${groupScope}
           ORDER BY m.branch_id, m.last_name, m.first_name`
    )
    .all(s.id)
    .map((m) => ({ ...m, consecutive_absences: attendanceStats(m.id).consecutive_absences }));
  const animators = db
    .prepare(
      `SELECT sl.leader_id, sl.role, sl.status, l.first_name, l.father_name, l.last_name, l.photo
       FROM session_leaders sl JOIN leaders l ON l.id = sl.leader_id
       WHERE sl.session_id = ?
       ORDER BY sl.role = 'helper', l.last_name, l.first_name`
    )
    .all(s.id);
  res.json(
    stripFee(req, {
      ...s,
      matalib: JSON.parse(s.matalib || '[]'),
      roster,
      animators,
      branch_counts: branchCountsOf(s.id),
      branch_ids: branchIds,
      // الفرق التي يحقّ للمستخدم وضع حضورها في هذا النشاط
      my_branch_ids: myBranchIds,
      // مجموعات النشاط بأسمائها — فارغة تعني أن كل فرقه تشارك كاملةً
      groups: db
        .prepare(
          `SELECT g.id, g.branch_id, g.name FROM session_groups sg
           JOIN branch_groups g ON g.id = sg.group_id
           WHERE sg.session_id = ? ORDER BY g.branch_id, g.sort_order, g.id`
        )
        .all(s.id),
      group_ids: groupIdsOfSession(s.id),
    })
  );
});

// عدد الحضور لكل فرقة و عدد القادة في نشاط عام للفوج — corrected after the fact,
// the same way présence is marked on the other kinds of نشاط.
app.post('/api/sessions/:id/counts', requirePerm('sessions.attendance'), (req, res) => {
  const s = db.prepare('SELECT id, title, branch_id, kind FROM sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (s.kind !== 'group') return res.status(400).json({ error: 'not_a_group_activity' });
  const counts = parseBranchCounts(req.body?.branch_counts);
  if (counts === null) return res.status(400).json({ error: 'invalid branch_counts' });
  const raw = req.body?.leaders_count;
  const leadersCount = raw === undefined || raw === null || raw === '' ? null : Number(raw);
  if (leadersCount !== null && (!Number.isInteger(leadersCount) || leadersCount < 0))
    return res.status(400).json({ error: 'invalid leaders_count' });
  db.transaction(() => {
    saveBranchCounts(s.id, counts);
    db.prepare('UPDATE sessions SET leaders_count = ? WHERE id = ?').run(leadersCount, s.id);
  })();
  notifyAdmins(req, 'counts', s);
  res.json({ branch_counts: branchCountsOf(s.id), leaders_count: leadersCount });
});

// Add / remove helpers and mark animator présence on a session
app.post('/api/sessions/:id/animators', requirePerm('sessions.attendance'), (req, res) => {
  const s = db.prepare('SELECT id, title, branch_id, kind FROM sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!sessionOk(req, s)) return res.status(403).json({ error: 'forbidden' });
  const { leader_id, status, remove } = req.body;
  if (!db.prepare('SELECT id FROM leaders WHERE id = ?').get(leader_id))
    return res.status(400).json({ error: 'invalid leader_id' });
  if (remove) {
    db.prepare("DELETE FROM session_leaders WHERE session_id = ? AND leader_id = ? AND role = 'helper'")
      .run(s.id, leader_id);
    notifyAdmins(req, 'animators', s);
    return res.json({ ok: true });
  }
  if (status !== null && status !== undefined && !['present', 'absent'].includes(status))
    return res.status(400).json({ error: 'invalid status' });
  db.prepare(
    `INSERT INTO session_leaders (session_id, leader_id, role, status) VALUES (?, ?, 'helper', ?)
     ON CONFLICT(session_id, leader_id) DO UPDATE SET status = excluded.status`
  ).run(s.id, leader_id, status ?? null);
  notifyAdmins(req, 'animators', s);
  res.json({ ok: true });
});

app.post('/api/sessions/:id/attendance', requirePerm('sessions.attendance'), (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!sessionOk(req, s)) return res.status(403).json({ error: 'forbidden' });
  const records = req.body.records || [req.body];
  // الحضور يُكتب فرقةً فرقة: قائد الفرقة (أو مساعده) يضع حضور عناصره وحدهم، فلا
  // يملأ شخص واحد حضور كل الفرق في نشاط مشترك. الأدمن غير مقيّد.
  const writable = new Set(myBranchesOfSession(req, s.id));
  const memberBranch = db.prepare('SELECT branch_id, group_id FROM members WHERE id = ?');
  const upsert = db.prepare(
    `INSERT INTO attendance (session_id, member_id, status) VALUES (?, ?, ?)
     ON CONFLICT(session_id, member_id) DO UPDATE SET status = excluded.status`
  );
  const run = db.transaction(() => {
    for (const r of records) {
      if (!r.member_id || !['present', 'absent', 'excused'].includes(r.status))
        throw new Error('invalid record');
      const m = memberBranch.get(r.member_id);
      if (!m) throw new Error('invalid record');
      if (!writable.has(m.branch_id)) throw new Error('forbidden_branch');
      // عنصر خارج مجموعات النشاط ليس في قائمته أصلًا — الزيارة مستثناة، فحضورها
      // هو أسماء من زيرَ بعينهم، لا قائمة فرقة تُفلتر.
      if (s.kind !== 'visit' && !memberInSessionGroups(s.id, m)) throw new Error('forbidden_group');
      upsert.run(s.id, r.member_id, r.status);
    }
  });
  try {
    run();
  } catch (e) {
    // فرقة أو مجموعة خارج نطاق النشاط: منعٌ لا خطأ في البيانات
    return res
      .status(['forbidden_branch', 'forbidden_group'].includes(e.message) ? 403 : 400)
      .json({ error: e.message });
  }
  notifyAdmins(req, 'attendance', s);
  res.json({ ok: true });
});

// ---------- Dashboard stats ----------

// Every figure honours the caller's فرقة scope, so a restricted قائد's dashboard
// only talks about his own فرق.
app.get('/api/stats', (req, res) => {
  const total_active = db
    .prepare(`SELECT COUNT(*) AS n FROM members m WHERE m.status = 'active'${branchFilterSQL(req, 'm.branch_id')}`)
    .get().n;
  const branches = db
    .prepare(
      `SELECT b.id, b.name_fr, b.name_ar,
        (SELECT ${fullNameSQL('l')} FROM assignments a JOIN leaders l ON l.id = a.leader_id
          WHERE a.branch_id = b.id AND a.year = (SELECT MAX(year) FROM assignments)
          ORDER BY a.sort_order, a.id LIMIT 1) AS leader_name,
        (SELECT a.leader_id FROM assignments a
          WHERE a.branch_id = b.id AND a.year = (SELECT MAX(year) FROM assignments)
            AND a.leader_id IS NOT NULL
          ORDER BY a.sort_order, a.id LIMIT 1) AS leader_id,
        (SELECT COUNT(*) FROM members m WHERE m.branch_id = b.id AND m.status = 'active') AS member_count,
        -- النشاط المشترك يُحتسب لكل فرقة يشملها، و حضوره يُوزَّع حسب فرقة العنصر
        (SELECT COUNT(*) FROM sessions s
          WHERE s.kind = 'activity'
            AND EXISTS (SELECT 1 FROM session_branches sb WHERE sb.session_id = s.id AND sb.branch_id = b.id)
        ) AS activities_count,
        (SELECT COUNT(DISTINCT a.member_id) FROM attendance a
          JOIN sessions s ON s.id = a.session_id
          JOIN members m ON m.id = a.member_id
          WHERE a.status = 'present' AND s.kind = 'activity'
            AND EXISTS (SELECT 1 FROM session_branches sb WHERE sb.session_id = s.id AND sb.branch_id = b.id)
            AND ((SELECT COUNT(*) FROM session_branches sb2 WHERE sb2.session_id = s.id) = 1
                 OR m.branch_id = b.id)
        ) AS participants_count
       FROM branches b WHERE 1=1${branchFilterSQL(req, 'b.id')} ORDER BY b.sort_order`
    )
    .all();
  const ym = todayISO().slice(0, 7);
  const row = db
    .prepare(
      // في النشاط المشترك يهمّ القائدَ حضور عناصره هو، فالصف يُنسب لفرقة العنصر
      `SELECT COUNT(*) AS total, COALESCE(SUM(a.status = 'present'), 0) AS present
       FROM attendance a JOIN sessions s ON s.id = a.session_id
       JOIN members m ON m.id = a.member_id
       WHERE substr(s.date, 1, 7) = ? AND s.kind = 'activity'${sessionScopeSQL(req)}${branchFilterSQL(req, 'm.branch_id')}`
    )
    .get(ym);
  // Activities held this month, whatever their attendance state
  const month_sessions = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sessions s
       WHERE substr(s.date, 1, 7) = ? AND s.kind = 'activity'${sessionScopeSQL(req)}`
    )
    .get(ym).n;
  res.json({
    total_active,
    branches,
    month_sessions,
    pending_promotions: pendingPromotions().filter((p) => branchOk(req, p.current_branch.id)).length,
    month_rate: row.total ? Math.round((row.present / row.total) * 100) : null,
    birthdays: upcomingBirthdays().filter((b) => branchOk(req, b.branch_id)),
  });
});

// Production: serve the built client if present (npm run build at repo root)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
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
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
