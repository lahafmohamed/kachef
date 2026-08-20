const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.SCOUT_DB || path.join(__dirname, 'scout.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Decided before the CREATE below runs: the curated lists are seeded from the old
// free-text values exactly once, on the boot that introduces them. Re-seeding later
// would resurrect entries an admin deleted on purpose, and emptying a list on purpose
// must stay emptied.
const lookupsTableIsNew = !db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lookup_values'")
  .get();

db.exec(`
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  min_age INTEGER NOT NULL,
  max_age INTEGER,
  sort_order INTEGER NOT NULL,
  total_requirements INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  father_name TEXT,
  mother_name TEXT,
  birth_date TEXT NOT NULL,
  birth_place TEXT,
  address_abidjan TEXT,
  address_lebanon TEXT,
  school TEXT,
  sex TEXT NOT NULL CHECK (sex IN ('M', 'F')),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  member_phone TEXT,
  parent_phone TEXT,
  join_date TEXT NOT NULL,
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
);

-- مطالب added or cancelled by hand for one عنصر. Attendance stays the normal way a
-- مطلب is earned; a row here overrides it in one direction or the other.
CREATE TABLE IF NOT EXISTS member_matalib (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('granted', 'revoked')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  UNIQUE(member_id, branch_id, number)
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  old_branch_id INTEGER NOT NULL REFERENCES branches(id),
  new_branch_id INTEGER NOT NULL REFERENCES branches(id),
  promoted_at TEXT NOT NULL,
  matalib TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  -- NULL for a نشاط قادة or a نشاط عام للفوج: they belong to the فوج, not to one فرقة
  branch_id INTEGER REFERENCES branches(id),
  leader TEXT,
  leader_id INTEGER,
  fee REAL,
  matalib TEXT NOT NULL DEFAULT '[]',
  -- زمان و مكان النشاط, filled by the قائد alongside the title
  start_time TEXT,
  place TEXT,
  -- طبيعة النشاط: weekly | cultural | ashura | ramadan | summer_clubs
  activity_type TEXT,
  -- نشاط عام للفوج only: عدد حضور القادة (a count, there is no قادة roster to mark)
  leaders_count INTEGER,
  -- بند الخطة السنوية الذي ينفّذه هذا النشاط، يختاره القائد عند الإنشاء.
  -- SET NULL: حذف بند من الخطة لا يحذف النشاط، يفكّ الربط فقط.
  plan_item_id INTEGER REFERENCES annual_plan(id) ON DELETE SET NULL,
  -- 'activity' = نشاط فرقة, 'visit' = زيارة الأهل (présence = who was visited),
  -- 'leaders' = نشاط قادة (no عناصر, présence is the قادة themselves),
  -- 'group' = نشاط عام للفوج (حضور مسجّل بالعدد لكل فرقة, لا بالأسماء)
  kind TEXT NOT NULL DEFAULT 'activity' CHECK (kind IN ('activity', 'visit', 'leaders', 'group'))
);

-- نشاط عام للفوج: عدد الحضور لكل فرقة بالتفصيل
CREATE TABLE IF NOT EXISTS session_branch_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(session_id, branch_id)
);

CREATE TABLE IF NOT EXISTS leaders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
);

-- فرقة القادة: the مطالب list a قائد is followed on. Its content is agreed with
-- السيد علي, so the catalog is data an admin edits, not something hard-coded here.
CREATE TABLE IF NOT EXISTS leader_matalib (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- بطاقة تقدم القائد: one row = one مطلب this قائد achieved in that سنة.
-- The card is yearly, so the same مطلب can be followed again the next year.
CREATE TABLE IF NOT EXISTS leader_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leader_id INTEGER NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,
  matlab_id INTEGER NOT NULL REFERENCES leader_matalib(id) ON DELETE CASCADE,
  year TEXT NOT NULL,
  achieved_at TEXT NOT NULL DEFAULT (date('now')),
  note TEXT,
  UNIQUE(leader_id, matlab_id, year)
);

-- التشكيلة: yearly role assignments (قائد فرقة أو أمانة). One row = one توصيف.
-- leader_id is nullable: a توصيف exists as an empty slot until a قائد is assigned to it.
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year TEXT NOT NULL,
  leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  role_type TEXT NOT NULL DEFAULT 'amana' CHECK (role_type IN ('branch', 'amana')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- قفل التشكيلة: while a row exists for a year, that year's assignments are frozen.
-- Only an admin can add or remove the row.
CREATE TABLE IF NOT EXISTS tachkila_locks (
  year TEXT PRIMARY KEY,
  locked_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked_by TEXT
);

-- Animators of a session: one main (animateur principal) + helpers, with their own présence
CREATE TABLE IF NOT EXISTS session_leaders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  leader_id INTEGER NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'helper' CHECK (role IN ('main', 'helper')),
  status TEXT CHECK (status IN ('present', 'absent')),
  UNIQUE(session_id, leader_id)
);

-- Login accounts. branches is a JSON array of branch ids the user may see;
-- NULL means every فرقة (no restriction). Admins always see everything.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  branches TEXT,
  -- JSON array of page keys the account may open (members, sessions, branches,
  -- promotions); NULL = every page. Admins ignore it.
  perms TEXT
);

-- One row per active login; deleting it logs the device out
CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'excused')),
  UNIQUE(session_id, member_id)
);

-- إشعارات للأدمن: قائد أضاف نشاطًا أو عدّل حضوره/منشّطيه/أعداده. Rows are written only
-- for non-admin actors. session_title is a snapshot so the line still reads after the
-- نشاط itself changes; the FK only nulls the link.
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('session_create', 'attendance', 'counts', 'animators')),
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  session_title TEXT,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  kind TEXT,
  actor TEXT,
  actor_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "آخر اطّلاع" لكل أدمن — everything newer than seen_at counts as unread for him
CREATE TABLE IF NOT EXISTS notification_seen (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seen_at TEXT NOT NULL
);

-- الخطة السنوية للفوج، مفصّلة فرقةً فرقة: كل صف = يوم مبرمج و اسم النشاط المتوقع فيه،
-- ضمن سنة كشفية ("2025-2026" = أيلول حتى آب). عادةً كل سبت فيه نشاط، و يمكن برمجة أي
-- يوم آخر. A row is only the intent: achievement is derived from the أنشطة, never stored.
CREATE TABLE IF NOT EXISTS annual_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year TEXT NOT NULL,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  title TEXT NOT NULL
);

-- Referential lists an admin curates (quartiers d'Abidjan, régions du Liban, écoles).
-- Registration picks from them instead of typing free text, so "Zone 4" is always
-- spelled the same way and filtering on it actually returns everybody.
-- The members columns stay plain TEXT: the list constrains new input, it does not
-- own the data, so deleting an entry never rewrites a member's file.
CREATE TABLE IF NOT EXISTS lookup_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('residence_abidjan', 'residence_lebanon', 'school')),
  -- NOCASE so "Zone 4" and "zone 4" collide on the UNIQUE index instead of
  -- becoming two entries that split the same people across two filters
  label TEXT NOT NULL COLLATE NOCASE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(kind, label)
);
`);

// Default مطالب (requirements) totals per branch, from the scout program reference
const REQUIREMENT_DEFAULTS = { 'البراعم': 99, 'الأشبال': 144, 'الكشافة': 166, 'الجوالة': 174 };

// ---------- نموذج التشكيلة ----------
// The standard توصيفات of a فوج. Opening a new تشكيلة year creates every one of them as an
// empty slot, so the whole organigram is visible from the start. Rows stay editable afterwards:
// titles can be renamed, extra مساعدين added, and unused ones deleted.
const AMANAT_TEMPLATE = [
  'عميد الفوج',
  'نائب عميد الفوج',
  'أمين السر',
  'أمين المال',
  'أمين الأنشطة',
  'أمين التدريب',
  'أمين الإعلام',
  'أمين التجهيزات',
  // توصيفات فوجية لا علاقة لها بالفرق: يعملون مع الأمانة المعنية
  'إعلامي',
  'أنشطة',
  'تدريب',
  'تجهيزات',
];

// Applied to every فرقة, using its Arabic name: قائد الجوالة الأساسي، قائد الجوالة المتقدم...
const BRANCH_ROLES_TEMPLATE = [
  (b) => `قائد ${b} الأساسي`,
  (b) => `قائد ${b} المتقدم`,
  (b) => `مساعد قائد ${b} المتقدم`,
  (b) => `قائد ${b} الأول`,
  (b) => `مساعد قائد ${b} الأول`,
];

// [{ title, branch_id, role_type, sort_order }] — الأمانات first, then فرقة by فرقة in age order.
// Branch slots start at 100 so أمانات always sort ahead of them and a whole فرقة keeps its block.
function tachkilaTemplate() {
  const rows = AMANAT_TEMPLATE.map((title, i) => ({
    title,
    branch_id: null,
    role_type: 'amana',
    sort_order: i,
  }));
  const branches = db.prepare('SELECT id, name_ar FROM branches ORDER BY sort_order, id').all();
  branches.forEach((b, bi) => {
    BRANCH_ROLES_TEMPLATE.forEach((makeTitle, ri) => {
      rows.push({
        title: makeTitle(b.name_ar),
        branch_id: b.id,
        role_type: 'branch',
        sort_order: 100 + bi * 10 + ri,
      });
    });
  });
  return rows;
}

// Addresses and schools were free text before the curated lists existed. Their distinct
// values become the first version of each list, so nothing typed so far is lost when the
// fields turn into pickers.
function seedLookupsFromMembers() {
  if (!lookupsTableIsNew) return;
  const insert = db.prepare('INSERT OR IGNORE INTO lookup_values (kind, label) VALUES (?, ?)');
  const seed = (kind, col) => {
    const rows = db
      .prepare(
        `SELECT DISTINCT TRIM(${col}) AS v FROM members
          WHERE ${col} IS NOT NULL AND TRIM(${col}) != '' ORDER BY v`
      )
      .all();
    for (const r of rows) insert.run(kind, r.v);
  };
  db.transaction(() => {
    seed('residence_abidjan', 'address_abidjan');
    seed('residence_lebanon', 'address_lebanon');
    seed('school', 'school');
  })();
}

function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// Empty توصيف slots need a nullable leader_id, and deleting a قائد must free his slot instead of
// destroying it. SQLite cannot relax NOT NULL or change a foreign key in place: rebuild the table.
function migrateAssignments() {
  ensureColumn('assignments', 'sort_order', 'sort_order INTEGER NOT NULL DEFAULT 0');
  const leaderCol = db.prepare('PRAGMA table_info(assignments)').all().find((c) => c.name === 'leader_id');
  if (!leaderCol || leaderCol.notnull === 0) return;
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE assignments_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year TEXT NOT NULL,
        leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
        role_type TEXT NOT NULL DEFAULT 'amana' CHECK (role_type IN ('branch', 'amana')),
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO assignments_new (id, year, leader_id, title, branch_id, role_type, sort_order)
        SELECT id, year, leader_id, title, branch_id, role_type, sort_order FROM assignments;
      DROP TABLE assignments;
      ALTER TABLE assignments_new RENAME TO assignments;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

// Two things SQLite cannot change in place, both needing a full rebuild:
//   - branch_id must be nullable (a نشاط قادة / نشاط عام belongs to no فرقة)
//   - the kind CHECK must accept 'group' (نشاط عام للفوج)
// Called after the new columns are added, so every row keeps all its data.
function migrateSessions() {
  const cols = db.prepare('PRAGMA table_info(sessions)').all();
  const branchCol = cols.find((c) => c.name === 'branch_id');
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get()?.sql || '';
  if (branchCol && branchCol.notnull === 0 && ddl.includes("'group'")) return;
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE sessions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        branch_id INTEGER REFERENCES branches(id),
        leader TEXT,
        leader_id INTEGER,
        fee REAL,
        matalib TEXT NOT NULL DEFAULT '[]',
        start_time TEXT,
        place TEXT,
        activity_type TEXT,
        leaders_count INTEGER,
        kind TEXT NOT NULL DEFAULT 'activity' CHECK (kind IN ('activity', 'visit', 'leaders', 'group'))
      );
      INSERT INTO sessions_new
        (id, title, date, branch_id, leader, leader_id, fee, matalib, start_time, place, activity_type, leaders_count, kind)
        SELECT id, title, date, branch_id, leader, leader_id, fee, matalib, start_time, place, activity_type, leaders_count, kind
        FROM sessions;
      DROP TABLE sessions;
      ALTER TABLE sessions_new RENAME TO sessions;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

// الخطة كانت بالشهر، صارت باليوم: كل سبت (أو أي يوم) صف مستقل. الصفوف القديمة تُنقل
// إلى أول يوم من شهرها — the month is the only thing that version ever knew.
function migrateAnnualPlan() {
  const cols = db.prepare('PRAGMA table_info(annual_plan)').all().map((c) => c.name);
  if (!cols.includes('month')) return;
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE annual_plan_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year TEXT NOT NULL,
        branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        title TEXT NOT NULL
      );
      INSERT INTO annual_plan_new (id, year, branch_id, date, title)
        SELECT id, year, branch_id,
          -- أيلول..كانون الأول تقع في السنة الأولى من السنة الكشفية، والباقي في الثانية
          (CASE WHEN month >= 9 THEN substr(year, 1, 4) ELSE substr(year, 6, 4) END)
            || '-' || substr('0' || month, -2) || '-01',
          title
        FROM annual_plan;
      DROP TABLE annual_plan;
      ALTER TABLE annual_plan_new RENAME TO annual_plan;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

// Upgrade databases created before the مطالب / activity-details feature
function migrate() {
  ensureColumn('branches', 'total_requirements', 'total_requirements INTEGER NOT NULL DEFAULT 0');
  ensureColumn('sessions', 'leader', 'leader TEXT');
  ensureColumn('sessions', 'fee', 'fee REAL');
  ensureColumn('sessions', 'matalib', "matalib TEXT NOT NULL DEFAULT '[]'");
  // زيارة الأهل shares the sessions table but must stay out of every attendance rate
  ensureColumn('sessions', 'kind', "kind TEXT NOT NULL DEFAULT 'activity'");
  // Plain INTEGER (no FK): leader deletion nulls it manually, keeping the name snapshot in `leader`
  ensureColumn('sessions', 'leader_id', 'leader_id INTEGER');
  // زمان، مكان، طبيعة النشاط — filled by the قائد next to the title
  ensureColumn('sessions', 'start_time', 'start_time TEXT');
  ensureColumn('sessions', 'place', 'place TEXT');
  ensureColumn('sessions', 'activity_type', 'activity_type TEXT');
  // نشاط عام للفوج: عدد حضور القادة
  ensureColumn('sessions', 'leaders_count', 'leaders_count INTEGER');
  migrateSessions();
  // Added after migrateSessions on purpose: its rebuild only knows the older column set
  ensureColumn(
    'sessions',
    'plan_item_id',
    'plan_item_id INTEGER REFERENCES annual_plan(id) ON DELETE SET NULL'
  );
  migrateAnnualPlan();
  ensureColumn('promotions', 'matalib', "matalib TEXT NOT NULL DEFAULT '[]'");
  migrateAssignments();
  // Registration form fields added after the first release — all nullable so old rows stay valid
  ensureColumn('members', 'father_name', 'father_name TEXT');
  ensureColumn('members', 'mother_name', 'mother_name TEXT');
  ensureColumn('members', 'birth_place', 'birth_place TEXT');
  ensureColumn('members', 'address_abidjan', 'address_abidjan TEXT');
  ensureColumn('members', 'address_lebanon', 'address_lebanon TEXT');
  ensureColumn('members', 'member_phone', 'member_phone TEXT');
  // المدرسة: added for the school filter, nullable so old rows stay valid
  ensureColumn('members', 'school', 'school TEXT');
  // فصيلة الدم: required on the form from now on, but nullable in SQL — the rows
  // registered before it existed stay valid until someone next edits them
  ensureColumn('members', 'blood_type', 'blood_type TEXT');
  seedLookupsFromMembers();
  // Old count-based column: counts cannot be mapped to specific numbers, drop it
  const sessionCols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  if (sessionCols.includes('requirements')) db.exec('ALTER TABLE sessions DROP COLUMN requirements');

  const setTotal = db.prepare(
    'UPDATE branches SET total_requirements = ? WHERE name_ar = ? AND total_requirements = 0'
  );
  for (const [ar, total] of Object.entries(REQUIREMENT_DEFAULTS)) setTotal.run(total, ar);

  // Sessions created before session_leaders: register the linked leader as main animator
  db.exec(`
    INSERT OR IGNORE INTO session_leaders (session_id, leader_id, role)
    SELECT s.id, s.leader_id, 'main' FROM sessions s
    WHERE s.leader_id IS NOT NULL AND EXISTS (SELECT 1 FROM leaders l WHERE l.id = s.leader_id)
  `);

  ensureColumn('users', 'perms', 'perms TEXT');
  // First run: an admin must exist or nobody can log in. Default credentials
  // admin / admin123 — change them from the admin page right away.
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('admin123', salt, 64).toString('hex');
    db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, branches) VALUES ('admin', ?, 'Admin', 'admin', NULL)"
    ).run(`${salt}:${hash}`);
    console.log('Created default admin account: admin / admin123 — change the password!');
  }

  const hasBranches = db.prepare('SELECT COUNT(*) AS n FROM branches').get().n > 0;
  const hasBaraem = db.prepare('SELECT id FROM branches WHERE name_ar = ?').get('البراعم');
  if (hasBranches && !hasBaraem) {
    db.prepare(
      'INSERT INTO branches (name_fr, name_ar, min_age, max_age, sort_order, total_requirements) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('Baraem', 'البراعم', 6, 7, 0, 99);
  }
}

// Birth date such that the member is exactly `age` years old (birthday 10 days ago)
function birthDateForAge(age) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setDate(d.getDate() - 10);
  return d.toISOString().slice(0, 10);
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM branches').get().n;
  if (count > 0) return;

  const insertBranch = db.prepare(
    'INSERT INTO branches (name_fr, name_ar, min_age, max_age, sort_order, total_requirements) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertBranch.run('Baraem', 'البراعم', 6, 7, 0, 99);
  const louveteaux = insertBranch.run('Louveteaux', 'الأشبال', 8, 11, 1, 144).lastInsertRowid;
  const scouts = insertBranch.run('Scouts', 'الكشافة', 12, 16, 2, 166).lastInsertRowid;
  const routiers = insertBranch.run('Routiers', 'الجوالة', 17, null, 3, 174).lastInsertRowid;

  const insertMember = db.prepare(`
    INSERT INTO members (first_name, last_name, birth_date, sex, branch_id, parent_phone, join_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
  `);
  insertMember.run('Yassine', 'Ben Ali', birthDateForAge(9), 'M', louveteaux, '+216 20 111 222', '2023-09-15');
  insertMember.run('Amina', 'Trabelsi', birthDateForAge(10), 'F', louveteaux, '+216 22 333 444', '2024-01-10');
  // Deliberately overdue: 12 years old, still in Louveteaux -> shows up in pending promotions
  insertMember.run('Omar', 'Gharbi', birthDateForAge(12), 'M', louveteaux, '+216 55 555 666', '2022-10-01');
  insertMember.run('Salma', 'Haddad', birthDateForAge(14), 'F', scouts, '+216 98 777 888', '2021-09-20');
  insertMember.run('Karim', 'Bouzid', birthDateForAge(18), 'M', routiers, '+216 29 999 000', '2019-09-05');
}

// Demo leaders + تشكيلة assignments; separate guard so it also fills databases seeded before this feature
function seedLeaders() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM leaders').get().n;
  if (count > 0) return;

  const insertLeader = db.prepare(
    "INSERT INTO leaders (first_name, last_name, phone, status) VALUES (?, ?, ?, ?)"
  );
  const leaders = [
    ['Mohamed', 'Lahaf', '+216 21 100 200', 'active'],
    ['Fatma', 'Jendoubi', '+216 22 210 320', 'active'],
    ['Ahmed', 'Mansouri', '+216 50 430 540', 'active'],
    ['Nour', 'Khelifi', '+216 97 650 760', 'active'],
    ['Sami', 'Ayari', '+216 23 870 980', 'active'],
    ['Rania', 'Belhadj', '+216 58 090 100', 'active'],
    ['Hedi', 'Chaabane', '+216 24 111 213', 'inactive'],
  ];
  const ids = leaders.map((l) => insertLeader.run(...l).lastInsertRowid);

  // The full organigram is created, then a few slots are filled — the rest stay empty on purpose
  const year = '2025-2026';
  const insertAssignment = db.prepare(
    'INSERT INTO assignments (year, leader_id, title, branch_id, role_type, sort_order) VALUES (?, NULL, ?, ?, ?, ?)'
  );
  const run = db.transaction(() => {
    for (const r of tachkilaTemplate()) insertAssignment.run(year, r.title, r.branch_id, r.role_type, r.sort_order);
  });
  run();

  const assign = db.prepare('UPDATE assignments SET leader_id = ? WHERE year = ? AND title = ?');
  const demo = [
    [ids[0], 'عميد الفوج'],
    [ids[1], 'أمين المال'],
    [ids[2], 'قائد البراعم الأساسي'],
    [ids[3], 'قائد الأشبال الأساسي'],
    [ids[4], 'قائد الكشافة الأساسي'],
    [ids[5], 'قائد الجوالة الأساسي'],
  ];
  for (const [leaderId, title] of demo) assign.run(leaderId, year, title);
}

module.exports = { db, seed, seedLeaders, migrate, tachkilaTemplate };
