const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, seed, seedLeaders, migrate, tachkilaTemplate } = require('./db');

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

// The pages an account can be restricted to. Dashboard is always allowed;
// التشكيلة / settings / admin stay admin-only regardless.
const PERM_KEYS = ['members', 'sessions', 'branches', 'promotions'];
const PERM_LEVELS = ['none', 'view', 'edit'];

// perms grew from an array of page keys to {page: none|view|edit}. Old rows
// keep the array shape in the DB; a listed page meant full access.
function normalizePerms(raw) {
  if (!raw) return null;
  const out = {};
  for (const k of PERM_KEYS)
    out[k] = Array.isArray(raw)
      ? raw.includes(k) ? 'edit' : 'none'
      : PERM_LEVELS.includes(raw[k]) ? raw[k] : 'none';
  return out;
}

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  display_name: u.display_name,
  role: u.role,
  // null = every فرقة; otherwise the branch ids this account may see
  branches: u.branches ? JSON.parse(u.branches) : null,
  // null = full access; otherwise {page: none|view|edit}
  perms: u.perms ? normalizePerms(JSON.parse(u.perms)) : null,
});

function hasPerm(req, key, level = 'view') {
  if (req.user.role === 'admin' || !req.user.perms) return true;
  const v = req.user.perms[key] || 'none';
  return level === 'view' ? v !== 'none' : v === 'edit';
}

const requirePerm = (key) => (req, res, next) =>
  hasPerm(req, key) ? next() : res.status(403).json({ error: 'forbidden' });

const requireEdit = (key) => (req, res, next) =>
  hasPerm(req, key, 'edit') ? next() : res.status(403).json({ error: 'forbidden' });

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

// ---------- Users (admin) ----------

function parseBranchList(v) {
  if (v === null || v === undefined || v === '') return null;
  if (!Array.isArray(v) || !v.every((n) => Number.isInteger(n))) return undefined;
  return v.length ? JSON.stringify(v) : null;
}

// Same contract as parseBranchList: null = unrestricted, undefined = invalid input.
// Accepts the legacy array shape and the {page: none|view|edit} object.
function parsePermList(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) {
    if (!v.every((k) => PERM_KEYS.includes(k))) return undefined;
    v = Object.fromEntries(PERM_KEYS.map((k) => [k, v.includes(k) ? 'edit' : 'none']));
  }
  if (typeof v !== 'object') return undefined;
  const out = {};
  for (const k of PERM_KEYS) {
    const lv = v[k] ?? 'none';
    if (!PERM_LEVELS.includes(lv)) return undefined;
    out[k] = lv;
  }
  // Full edit everywhere is the same as no restriction
  return PERM_KEYS.every((k) => out[k] === 'edit') ? null : JSON.stringify(out);
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
      `SELECT m.id, m.first_name, m.last_name, m.photo, m.birth_date, m.branch_id,
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

// Distinct matalib numbers earned by a member in sessions of a given branch
function earnedNumbersInBranch(memberId, branchId) {
  const rows = db
    .prepare(
      `SELECT s.matalib FROM attendance a JOIN sessions s ON s.id = a.session_id
       WHERE a.member_id = ? AND a.status = 'present' AND s.branch_id = ? AND s.kind = 'activity'`
    )
    .all(memberId, branchId);
  const set = new Set();
  for (const r of rows) JSON.parse(r.matalib || '[]').forEach((n) => set.add(n));
  return [...set].sort((a, b) => a - b);
}

// زيارات الأهل a member received, newest first, with the قادة who took part
function familyVisits(memberId) {
  return db
    .prepare(
      `SELECT s.id AS session_id, s.title, s.date,
        (SELECT GROUP_CONCAT(l.first_name || ' ' || l.last_name, ' · ')
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
        (SELECT l.first_name || ' ' || l.last_name FROM assignments a JOIN leaders l ON l.id = a.leader_id
          WHERE a.branch_id = b.id AND a.year = (SELECT MAX(year) FROM assignments)
          ORDER BY a.sort_order, a.id LIMIT 1) AS leader_name,
        (SELECT a.leader_id FROM assignments a
          WHERE a.branch_id = b.id AND a.year = (SELECT MAX(year) FROM assignments)
            AND a.leader_id IS NOT NULL
          ORDER BY a.sort_order, a.id LIMIT 1) AS leader_id
       FROM branches b WHERE 1=1${branchFilterSQL(req, 'b.id')} ORDER BY b.sort_order`
    )
    .all();
  res.json(rows);
});

// Everything the الفرق tab shows about one فرقة: عناصر، قادة، أنشطة، حضور، مطالب.
// One endpoint for the whole list — a فرقة is never looked at alone in that page.
app.get('/api/branches/overview', requirePerm('branches'), (req, res) => {
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
  const sessionsStmt = db.prepare(
    `SELECT
       COALESCE(SUM(kind = 'activity'), 0) AS total,
       COALESCE(SUM(kind = 'activity' AND substr(date, 1, 7) = ?), 0) AS this_month,
       COALESCE(SUM(kind = 'visit'), 0) AS visits
     FROM sessions WHERE branch_id = ?`
  );
  const attendanceStmt = db.prepare(
    `SELECT
       COALESCE(SUM(a.status = 'present'), 0) AS present,
       COALESCE(SUM(a.status = 'absent'), 0) AS absent,
       COALESCE(SUM(a.status = 'excused'), 0) AS excused
     FROM attendance a JOIN sessions s ON s.id = a.session_id
     WHERE s.branch_id = ? AND s.kind = 'activity'`
  );
  const leadersStmt = db.prepare(
    `SELECT a.id, a.title, a.leader_id, l.first_name, l.last_name, l.photo
     FROM assignments a LEFT JOIN leaders l ON l.id = a.leader_id
     WHERE a.branch_id = ? AND a.year = ?
     ORDER BY a.sort_order, a.id`
  );
  const mataliOfBranch = db.prepare("SELECT matalib FROM sessions WHERE branch_id = ? AND kind = 'activity'");
  const lastSessionStmt = db.prepare(
    "SELECT id, title, date FROM sessions WHERE branch_id = ? AND kind = 'activity' ORDER BY date DESC, id DESC LIMIT 1"
  );

  const rows = branches.map((b) => {
    const members = membersStmt.get(b.id);
    const sessions = sessionsStmt.get(ym, b.id);
    const att = attendanceStmt.get(b.id);
    const marked = att.present + att.absent + att.excused;
    // A مطلب counts as covered once any نشاط of the فرقة has worked on it
    const covered = new Set();
    for (const r of mataliOfBranch.all(b.id))
      JSON.parse(r.matalib || '[]').forEach((n) => covered.add(n));
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
      last_session: lastSessionStmt.get(b.id) || null,
    };
  });
  res.json(rows);
});

// أنشطة a فرقة with, for each one, who took part. Loaded on demand: the الفرق page
// shows one فرقة at a time, so the participant lists of the others are never fetched.
app.get('/api/branches/:id/sessions', requirePerm('branches'), (req, res) => {
  const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'branch not found' });
  if (!branchOk(req, branch.id)) return res.status(403).json({ error: 'forbidden' });
  const sessions = db
    .prepare(
      `SELECT s.id, s.title, s.date, s.leader, s.matalib, s.kind
       FROM sessions s WHERE s.branch_id = ? ORDER BY s.date DESC, s.id DESC`
    )
    .all(branch.id)
    .map((s) => ({ ...s, matalib: JSON.parse(s.matalib || '[]') }));

  const attendeesStmt = db.prepare(
    `SELECT a.status, m.id, m.first_name, m.last_name, m.photo
     FROM attendance a JOIN members m ON m.id = a.member_id
     WHERE a.session_id = ? ORDER BY m.last_name, m.first_name`
  );
  const animatorsStmt = db.prepare(
    `SELECT l.id, l.first_name, l.last_name, sl.role, sl.status
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
    db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE branch_id = ?').get(id).n +
    db.prepare('SELECT COUNT(*) AS n FROM promotions WHERE old_branch_id = ? OR new_branch_id = ?').get(id, id).n;
  if (inUse > 0) return res.status(400).json({ error: 'branch_in_use' });
  db.prepare('DELETE FROM branches WHERE id = ?').run(id);
  res.status(204).end();
});

// ---------- Members ----------

const MEMBER_FIELDS = ['first_name', 'last_name', 'birth_date', 'sex', 'branch_id', 'join_date'];

function validateMember(body) {
  for (const f of MEMBER_FIELDS) {
    if (body[f] === undefined || body[f] === null || body[f] === '') return `missing field: ${f}`;
  }
  if (!['M', 'F'].includes(body.sex)) return 'invalid sex';
  if (!['active', 'inactive'].includes(body.status || 'active')) return 'invalid status';
  if (!db.prepare('SELECT id FROM branches WHERE id = ?').get(body.branch_id)) return 'invalid branch_id';
  return null;
}

app.get('/api/members', requirePerm('members'), (req, res) => {
  const { branch, q, status } = req.query;
  let sql = `SELECT m.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
             FROM members m JOIN branches b ON b.id = m.branch_id WHERE 1=1`;
  const params = [];
  sql += branchFilterSQL(req, 'm.branch_id');
  if (branch) { sql += ' AND m.branch_id = ?'; params.push(branch); }
  if (status) { sql += ' AND m.status = ?'; params.push(status); }
  if (q) {
    sql += " AND (m.first_name LIKE ? OR m.last_name LIKE ? OR (m.first_name || ' ' || m.last_name) LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY m.last_name, m.first_name';
  const rows = db.prepare(sql).all(...params).map((m) => ({ ...m, age: calcAge(m.birth_date) }));
  res.json(rows);
});

app.get('/api/members/:id', requirePerm('members'), (req, res) => {
  const m = db
    .prepare(
      `SELECT m.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        b.total_requirements AS branch_total_requirements
       FROM members m JOIN branches b ON b.id = m.branch_id WHERE m.id = ?`
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
  res.json({
    ...m,
    age: calcAge(m.birth_date),
    stats: attendanceStats(m.id, m.branch_id),
    visits: familyVisits(m.id),
    promotions,
  });
});

app.post('/api/members', requireEdit('members'), (req, res) => {
  const err = validateMember(req.body);
  if (err) return res.status(400).json({ error: err });
  if (!branchOk(req, req.body.branch_id)) return res.status(403).json({ error: 'forbidden' });
  const b = req.body;
  const info = db
    .prepare(
      `INSERT INTO members (first_name, last_name, father_name, mother_name, birth_date, birth_place,
        address_abidjan, address_lebanon, sex, branch_id, member_phone, parent_phone, join_date, photo, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.first_name, b.last_name, b.father_name || null, b.mother_name || null,
      b.birth_date, b.birth_place || null, b.address_abidjan || null, b.address_lebanon || null,
      b.sex, b.branch_id, b.member_phone || null, b.parent_phone || null,
      b.join_date, b.photo || null, b.status || 'active'
    );
  res.status(201).json(db.prepare('SELECT * FROM members WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/members/:id', requireEdit('members'), (req, res) => {
  const existing = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'member not found' });
  const err = validateMember(req.body);
  if (err) return res.status(400).json({ error: err });
  // Both the member's current فرقة and the one being assigned must be in scope
  if (!branchOk(req, existing.branch_id) || !branchOk(req, req.body.branch_id))
    return res.status(403).json({ error: 'forbidden' });
  const b = req.body;
  db.prepare(
    `UPDATE members SET first_name = ?, last_name = ?, father_name = ?, mother_name = ?,
     birth_date = ?, birth_place = ?, address_abidjan = ?, address_lebanon = ?, sex = ?, branch_id = ?,
     member_phone = ?, parent_phone = ?, join_date = ?, photo = ?, status = ? WHERE id = ?`
  ).run(
    b.first_name, b.last_name, b.father_name || null, b.mother_name || null,
    b.birth_date, b.birth_place || null, b.address_abidjan || null, b.address_lebanon || null,
    b.sex, b.branch_id, b.member_phone || null, b.parent_phone || null,
    b.join_date, b.photo || null, b.status || 'active', req.params.id
  );
  res.json(db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id));
});

app.delete('/api/members/:id', requireEdit('members'), (req, res) => {
  const existing = db.prepare('SELECT branch_id FROM members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'member not found' });
  if (!branchOk(req, existing.branch_id)) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM members WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Promotions ----------

app.get('/api/promotions/pending', requirePerm('promotions'), (req, res) => {
  // A scoped قائد only sees promotions leaving one of his فرق
  res.json(pendingPromotions().filter((p) => branchOk(req, p.current_branch.id)));
});

app.post('/api/promotions/validate', requireEdit('promotions'), (req, res) => {
  const ids = req.body.member_ids;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: 'member_ids required' });
  const pending = pendingPromotions().filter((p) => branchOk(req, p.current_branch.id));
  const byId = Object.fromEntries(pending.map((p) => [p.id, p]));
  const insert = db.prepare(
    'INSERT INTO promotions (member_id, old_branch_id, new_branch_id, promoted_at, matalib) VALUES (?, ?, ?, ?, ?)'
  );
  const update = db.prepare('UPDATE members SET branch_id = ? WHERE id = ?');
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

app.get('/api/promotions/history', requirePerm('promotions'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.promoted_at, p.member_id, p.matalib,
        m.first_name, m.last_name,
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
      `SELECT a.*, l.first_name, l.last_name, l.photo,
        b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
       FROM assignments a
       LEFT JOIN leaders l ON l.id = a.leader_id
       LEFT JOIN branches b ON b.id = a.branch_id
       WHERE a.year = ?
       ORDER BY a.role_type = 'amana', COALESCE(b.sort_order, 999), a.sort_order, a.id`
    )
    .all(year);
}

app.get('/api/leaders', (req, res) => {
  const rows = db
    .prepare(
      `SELECT l.*,
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
  res.json(rows.map((l) => ({ ...l, roles: roles[l.id] || [], year })));
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
    `SELECT m.id, m.first_name, m.last_name FROM attendance a JOIN members m ON m.id = a.member_id
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
  res.json({
    ...l,
    year,
    current_roles: assignments.filter((a) => a.year === year),
    assignments,
    sessions: activities,
    visits,
    attendance,
  });
});

function validateLeader(body) {
  if (!body.first_name || !body.last_name) return 'first_name and last_name required';
  if (!['active', 'inactive'].includes(body.status || 'active')) return 'invalid status';
  return null;
}

app.post('/api/leaders', requireAdmin, (req, res) => {
  const err = validateLeader(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  const info = db
    .prepare('INSERT INTO leaders (first_name, last_name, phone, photo, status) VALUES (?, ?, ?, ?, ?)')
    .run(b.first_name, b.last_name, b.phone || null, b.photo || null, b.status || 'active');
  res.status(201).json(db.prepare('SELECT * FROM leaders WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/leaders/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM leaders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'leader not found' });
  const err = validateLeader(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  db.prepare(
    'UPDATE leaders SET first_name = ?, last_name = ?, phone = ?, photo = ?, status = ? WHERE id = ?'
  ).run(b.first_name, b.last_name, b.phone || null, b.photo || null, b.status || 'active', req.params.id);
  // Refresh the name snapshot on sessions this leader animated
  db.prepare('UPDATE sessions SET leader = ? WHERE leader_id = ?').run(
    `${b.first_name} ${b.last_name}`, req.params.id
  );
  res.json(db.prepare('SELECT * FROM leaders WHERE id = ?').get(req.params.id));
});

app.delete('/api/leaders/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT id FROM leaders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'leader not found' });
  const run = db.transaction(() => {
    // Sessions keep the leader name as plain text, only the link is removed.
    // His توصيفات survive too (FK ON DELETE SET NULL): the slots stay in the تشكيلة, unassigned.
    db.prepare('UPDATE sessions SET leader_id = NULL WHERE leader_id = ?').run(req.params.id);
    db.prepare('DELETE FROM leaders WHERE id = ?').run(req.params.id);
  });
  run();
  res.status(204).end();
});

app.get('/api/tachkila', (req, res) => {
  const years = db
    .prepare('SELECT DISTINCT year FROM assignments ORDER BY year DESC')
    .all()
    .map((r) => r.year);
  const year = req.query.year || years[0] || null;
  const template = tachkilaTemplate();
  const titles = new Set(
    (year ? db.prepare('SELECT title FROM assignments WHERE year = ?').all(year) : []).map((r) => r.title.trim())
  );
  res.json({
    years,
    year,
    assignments: assignmentsForYear(year),
    // Standard titles, plus how many of them this year is still missing (offer to fill them in)
    template: template.map((r) => r.title),
    missing_count: year ? template.filter((r) => !titles.has(r.title)).length : template.length,
  });
});

// '' from an unselected <select> means "no one assigned yet", not an invalid id
const optionalId = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

function validateAssignment(body) {
  if (!body.year || !String(body.year).trim()) return 'year required';
  if (!body.title || !String(body.title).trim()) return 'title required';
  const leaderId = optionalId(body.leader_id);
  if (leaderId !== null && !db.prepare('SELECT id FROM leaders WHERE id = ?').get(leaderId))
    return 'invalid leader_id';
  const branchId = optionalId(body.branch_id);
  if (branchId !== null && !db.prepare('SELECT id FROM branches WHERE id = ?').get(branchId))
    return 'invalid branch_id';
  return null;
}

app.post('/api/tachkila', requireAdmin, (req, res) => {
  const err = validateAssignment(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  const branchId = optionalId(b.branch_id);
  const info = db
    .prepare(
      'INSERT INTO assignments (year, leader_id, title, branch_id, role_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      String(b.year).trim(),
      optionalId(b.leader_id),
      String(b.title).trim(),
      branchId,
      branchId ? 'branch' : 'amana',
      Number.isInteger(b.sort_order) ? b.sort_order : 0
    );
  res.status(201).json(db.prepare('SELECT * FROM assignments WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/tachkila/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'assignment not found' });
  const body = { ...existing, ...req.body };
  const err = validateAssignment(body);
  if (err) return res.status(400).json({ error: err });
  const branchId = optionalId(body.branch_id);
  db.prepare(
    `UPDATE assignments SET year = ?, leader_id = ?, title = ?, branch_id = ?, role_type = ?, sort_order = ?
     WHERE id = ?`
  ).run(
    String(body.year).trim(),
    optionalId(body.leader_id),
    String(body.title).trim(),
    branchId,
    branchId ? 'branch' : 'amana',
    Number.isInteger(body.sort_order) ? body.sort_order : existing.sort_order,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id));
});

app.delete('/api/tachkila/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM assignments WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'assignment not found' });
  res.status(204).end();
});

const insertAssignmentRow = () =>
  db.prepare(
    'INSERT INTO assignments (year, leader_id, title, branch_id, role_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  );

// New تشكيلة year. `mode` decides what it starts with:
//   template (default) — every standard توصيف of the فوج as an empty slot
//   copy               — same توصيفات AND same قادة as `from_year`
//   empty              — nothing, build it by hand
app.post('/api/tachkila/copy', requireAdmin, (req, res) => {
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
        'SELECT leader_id, title, branch_id, role_type, sort_order FROM assignments WHERE year = ? ORDER BY sort_order, id'
      )
      .all(from_year);
  } else if (mode === 'template') {
    rows = tachkilaTemplate().map((r) => ({ ...r, leader_id: null }));
  }

  const insert = insertAssignmentRow();
  const run = db.transaction(() => {
    for (const r of rows)
      insert.run(target, r.leader_id ?? null, r.title, r.branch_id, r.role_type, r.sort_order ?? 0);
  });
  run();
  res.status(201).json({ year: target, created: rows.length });
});

// Add the standard توصيفات an existing year is missing — for تشكيلات made before this template,
// or after a new فرقة was created. Existing rows are matched by title and left untouched.
app.post('/api/tachkila/fill', requireAdmin, (req, res) => {
  const year = String(req.body.year || '').trim();
  if (!year) return res.status(400).json({ error: 'year required' });
  const titles = new Set(
    db.prepare('SELECT title FROM assignments WHERE year = ?').all(year).map((r) => r.title.trim())
  );
  const missing = tachkilaTemplate().filter((r) => !titles.has(r.title));
  const insert = insertAssignmentRow();
  const run = db.transaction(() => {
    for (const r of missing) insert.run(year, null, r.title, r.branch_id, r.role_type, r.sort_order);
  });
  run();
  res.status(201).json({ year, added: missing.length });
});

// ---------- Sessions & attendance ----------

app.get('/api/sessions', requirePerm('sessions'), (req, res) => {
  const { q, branch, from, to } = req.query;
  let sql = `SELECT s.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        COALESCE(l.first_name || ' ' || l.last_name, s.leader) AS leader,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'present') AS present_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'absent') AS absent_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'excused') AS excused_count
       FROM sessions s LEFT JOIN branches b ON b.id = s.branch_id
       LEFT JOIN leaders l ON l.id = s.leader_id
       WHERE 1=1${branchFilterSQL(req, 's.branch_id')}`;
  const params = [];
  if (branch) { sql += ' AND s.branch_id = ?'; params.push(branch); }
  // Dates are stored as YYYY-MM-DD, so plain string comparison sorts correctly
  if (from) { sql += ' AND s.date >= ?'; params.push(from); }
  if (to) { sql += ' AND s.date <= ?'; params.push(to); }
  if (q) {
    sql += ` AND (s.title LIKE ? OR COALESCE(l.first_name || ' ' || l.last_name, s.leader) LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY s.date DESC, s.id DESC';
  const rows = db
    .prepare(sql)
    .all(...params)
    .map((r) => ({ ...r, matalib: JSON.parse(r.matalib || '[]') }));
  res.json(rows);
});

app.post('/api/sessions', requireEdit('sessions'), (req, res) => {
  const { title, date, branch_id, leader, leader_id, fee, matalib, helper_ids, member_ids } = req.body;
  const kind = ['visit', 'leaders'].includes(req.body.kind) ? req.body.kind : 'activity';
  // A نشاط قادة has no فرقة; every other kind still needs one
  const branchId = kind === 'leaders' ? null : branch_id;
  if (!title || !date) return res.status(400).json({ error: 'title, date required' });
  if (kind !== 'leaders' && !branchId) return res.status(400).json({ error: 'branch_id required' });
  if (!branchOk(req, branchId)) return res.status(403).json({ error: 'forbidden' });
  if (branchId && !db.prepare('SELECT id FROM branches WHERE id = ?').get(branchId))
    return res.status(400).json({ error: 'invalid branch_id' });
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
        'INSERT INTO sessions (title, date, branch_id, leader, leader_id, fee, matalib, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        title,
        date,
        branchId,
        leaderName,
        leaderRow ? leaderRow.id : null,
        fee ?? null,
        JSON.stringify(kind === 'activity' ? unique : []),
        kind
      )
      .lastInsertRowid;
    if (leaderRow) insertAnimator.run(sessionId, leaderRow.id, 'main');
    for (const h of helpers) {
      if (leaderRow && h === leaderRow.id) continue;
      insertAnimator.run(sessionId, h, 'helper');
    }
    for (const m of visited) insertVisited.run(sessionId, m);
  })();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  res.status(201).json({ ...row, matalib: JSON.parse(row.matalib) });
});

app.get('/api/sessions/:id', requirePerm('sessions'), (req, res) => {
  const s = db
    .prepare(
      `SELECT s.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        COALESCE(l.first_name || ' ' || l.last_name, s.leader) AS leader
       FROM sessions s LEFT JOIN branches b ON b.id = s.branch_id
       LEFT JOIN leaders l ON l.id = s.leader_id
       WHERE s.id = ?`
    )
    .get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!branchOk(req, s.branch_id)) return res.status(403).json({ error: 'forbidden' });
  // A نشاط lists the whole فرقة to be marked; a زيارة الأهل concerns only the
  // عناصر actually visited, so the rest of the فرقة has no row here.
  const roster = db
    .prepare(
      s.kind === 'visit'
        ? `SELECT m.id, m.first_name, m.last_name, m.photo, a.status
           FROM attendance a JOIN members m ON m.id = a.member_id
           WHERE a.session_id = ? AND m.branch_id = ?
           ORDER BY m.last_name, m.first_name`
        : `SELECT m.id, m.first_name, m.last_name, m.photo, a.status
           FROM members m
           LEFT JOIN attendance a ON a.member_id = m.id AND a.session_id = ?
           WHERE m.branch_id = ? AND m.status = 'active'
           ORDER BY m.last_name, m.first_name`
    )
    .all(s.id, s.branch_id)
    .map((m) => ({ ...m, consecutive_absences: attendanceStats(m.id).consecutive_absences }));
  const animators = db
    .prepare(
      `SELECT sl.leader_id, sl.role, sl.status, l.first_name, l.last_name, l.photo
       FROM session_leaders sl JOIN leaders l ON l.id = sl.leader_id
       WHERE sl.session_id = ?
       ORDER BY sl.role = 'helper', l.last_name, l.first_name`
    )
    .all(s.id);
  res.json({ ...s, matalib: JSON.parse(s.matalib || '[]'), roster, animators });
});

// Add / remove helpers and mark animator présence on a session
app.post('/api/sessions/:id/animators', requireEdit('sessions'), (req, res) => {
  const s = db.prepare('SELECT id, branch_id FROM sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!branchOk(req, s.branch_id)) return res.status(403).json({ error: 'forbidden' });
  const { leader_id, status, remove } = req.body;
  if (!db.prepare('SELECT id FROM leaders WHERE id = ?').get(leader_id))
    return res.status(400).json({ error: 'invalid leader_id' });
  if (remove) {
    db.prepare("DELETE FROM session_leaders WHERE session_id = ? AND leader_id = ? AND role = 'helper'")
      .run(s.id, leader_id);
    return res.json({ ok: true });
  }
  if (status !== null && status !== undefined && !['present', 'absent'].includes(status))
    return res.status(400).json({ error: 'invalid status' });
  db.prepare(
    `INSERT INTO session_leaders (session_id, leader_id, role, status) VALUES (?, ?, 'helper', ?)
     ON CONFLICT(session_id, leader_id) DO UPDATE SET status = excluded.status`
  ).run(s.id, leader_id, status ?? null);
  res.json({ ok: true });
});

app.post('/api/sessions/:id/attendance', requireEdit('sessions'), (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  if (!branchOk(req, s.branch_id)) return res.status(403).json({ error: 'forbidden' });
  const records = req.body.records || [req.body];
  const upsert = db.prepare(
    `INSERT INTO attendance (session_id, member_id, status) VALUES (?, ?, ?)
     ON CONFLICT(session_id, member_id) DO UPDATE SET status = excluded.status`
  );
  const run = db.transaction(() => {
    for (const r of records) {
      if (!r.member_id || !['present', 'absent', 'excused'].includes(r.status))
        throw new Error('invalid record');
      upsert.run(s.id, r.member_id, r.status);
    }
  });
  try {
    run();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
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
        (SELECT l.first_name || ' ' || l.last_name FROM assignments a JOIN leaders l ON l.id = a.leader_id
          WHERE a.branch_id = b.id AND a.year = (SELECT MAX(year) FROM assignments)
          ORDER BY a.sort_order, a.id LIMIT 1) AS leader_name,
        (SELECT a.leader_id FROM assignments a
          WHERE a.branch_id = b.id AND a.year = (SELECT MAX(year) FROM assignments)
            AND a.leader_id IS NOT NULL
          ORDER BY a.sort_order, a.id LIMIT 1) AS leader_id,
        (SELECT COUNT(*) FROM members m WHERE m.branch_id = b.id AND m.status = 'active') AS member_count,
        (SELECT COUNT(*) FROM sessions s WHERE s.branch_id = b.id AND s.kind = 'activity') AS activities_count,
        (SELECT COUNT(DISTINCT a.member_id) FROM attendance a
          JOIN sessions s ON s.id = a.session_id
          WHERE s.branch_id = b.id AND a.status = 'present' AND s.kind = 'activity') AS participants_count
       FROM branches b WHERE 1=1${branchFilterSQL(req, 'b.id')} ORDER BY b.sort_order`
    )
    .all();
  const ym = todayISO().slice(0, 7);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(a.status = 'present'), 0) AS present
       FROM attendance a JOIN sessions s ON s.id = a.session_id
       WHERE substr(s.date, 1, 7) = ? AND s.kind = 'activity'${branchFilterSQL(req, 's.branch_id')}`
    )
    .get(ym);
  // Activities held this month, whatever their attendance state
  const month_sessions = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sessions s
       WHERE substr(s.date, 1, 7) = ? AND s.kind = 'activity'${branchFilterSQL(req, 's.branch_id')}`
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
