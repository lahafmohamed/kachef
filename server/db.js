const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.SCOUT_DB || path.join(__dirname, 'scout.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
  birth_date TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('M', 'F')),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  parent_phone TEXT,
  join_date TEXT NOT NULL,
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
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
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  leader TEXT,
  fee REAL,
  matalib TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS leaders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
);

-- التشكيلة: yearly role assignments (قائد فرقة أو أمانة). One row = one توصيف.
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year TEXT NOT NULL,
  leader_id INTEGER NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  role_type TEXT NOT NULL DEFAULT 'amana' CHECK (role_type IN ('branch', 'amana'))
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

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'excused')),
  UNIQUE(session_id, member_id)
);
`);

// Default مطالب (requirements) totals per branch, from the scout program reference
const REQUIREMENT_DEFAULTS = { 'البراعم': 99, 'الأشبال': 144, 'الكشافة': 166, 'الجوالة': 174 };

function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// Upgrade databases created before the مطالب / activity-details feature
function migrate() {
  ensureColumn('branches', 'total_requirements', 'total_requirements INTEGER NOT NULL DEFAULT 0');
  ensureColumn('sessions', 'leader', 'leader TEXT');
  ensureColumn('sessions', 'fee', 'fee REAL');
  ensureColumn('sessions', 'matalib', "matalib TEXT NOT NULL DEFAULT '[]'");
  // Plain INTEGER (no FK): leader deletion nulls it manually, keeping the name snapshot in `leader`
  ensureColumn('sessions', 'leader_id', 'leader_id INTEGER');
  ensureColumn('promotions', 'matalib', "matalib TEXT NOT NULL DEFAULT '[]'");
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

  const branchByAr = (ar) => db.prepare('SELECT id FROM branches WHERE name_ar = ?').get(ar)?.id ?? null;

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

  const year = '2025-2026';
  const insertAssignment = db.prepare(
    'INSERT INTO assignments (year, leader_id, title, branch_id, role_type) VALUES (?, ?, ?, ?, ?)'
  );
  insertAssignment.run(year, ids[0], 'قائد الفوج', null, 'amana');
  insertAssignment.run(year, ids[1], 'أمين المال', null, 'amana');
  insertAssignment.run(year, ids[2], 'قائد فرقة البراعم', branchByAr('البراعم'), 'branch');
  insertAssignment.run(year, ids[3], 'قائد فرقة الأشبال', branchByAr('الأشبال'), 'branch');
  insertAssignment.run(year, ids[4], 'قائد فرقة الكشافة', branchByAr('الكشافة'), 'branch');
  insertAssignment.run(year, ids[5], 'قائد فرقة الجوالة', branchByAr('الجوالة'), 'branch');
}

module.exports = { db, seed, seedLeaders, migrate };
