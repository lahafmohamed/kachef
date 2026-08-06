const express = require('express');
const path = require('path');
const fs = require('fs');
const { db, seed, seedLeaders, migrate } = require('./db');

migrate();
seed();
seedLeaders();

const app = express();
app.use(express.json({ limit: '10mb' }));

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
      `SELECT m.id, m.first_name, m.last_name, m.photo, m.birth_date,
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
       WHERE a.member_id = ? AND a.status = 'present' AND s.branch_id = ?`
    )
    .all(memberId, branchId);
  const set = new Set();
  for (const r of rows) JSON.parse(r.matalib || '[]').forEach((n) => set.add(n));
  return [...set].sort((a, b) => a - b);
}

function attendanceStats(memberId, branchId) {
  const rows = db
    .prepare(
      `SELECT a.status, s.date, s.title, s.matalib, s.id AS session_id
       FROM attendance a JOIN sessions s ON s.id = a.session_id
       WHERE a.member_id = ?
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
          ORDER BY a.id LIMIT 1) AS leader_name,
        (SELECT a.leader_id FROM assignments a
          WHERE a.branch_id = b.id AND a.year = (SELECT MAX(year) FROM assignments)
          ORDER BY a.id LIMIT 1) AS leader_id
       FROM branches b ORDER BY b.sort_order`
    )
    .all();
  res.json(rows);
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

app.post('/api/branches', (req, res) => {
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

app.put('/api/branches/:id', (req, res) => {
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

app.delete('/api/branches/:id', (req, res) => {
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

app.get('/api/members', (req, res) => {
  const { branch, q, status } = req.query;
  let sql = `SELECT m.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
             FROM members m JOIN branches b ON b.id = m.branch_id WHERE 1=1`;
  const params = [];
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

app.get('/api/members/:id', (req, res) => {
  const m = db
    .prepare(
      `SELECT m.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        b.total_requirements AS branch_total_requirements
       FROM members m JOIN branches b ON b.id = m.branch_id WHERE m.id = ?`
    )
    .get(req.params.id);
  if (!m) return res.status(404).json({ error: 'member not found' });
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
    promotions,
  });
});

app.post('/api/members', (req, res) => {
  const err = validateMember(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  const info = db
    .prepare(
      `INSERT INTO members (first_name, last_name, birth_date, sex, branch_id, parent_phone, join_date, photo, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.first_name, b.last_name, b.birth_date, b.sex, b.branch_id,
      b.parent_phone || null, b.join_date, b.photo || null, b.status || 'active'
    );
  res.status(201).json(db.prepare('SELECT * FROM members WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/members/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'member not found' });
  const err = validateMember(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  db.prepare(
    `UPDATE members SET first_name = ?, last_name = ?, birth_date = ?, sex = ?, branch_id = ?,
     parent_phone = ?, join_date = ?, photo = ?, status = ? WHERE id = ?`
  ).run(
    b.first_name, b.last_name, b.birth_date, b.sex, b.branch_id,
    b.parent_phone || null, b.join_date, b.photo || null, b.status || 'active', req.params.id
  );
  res.json(db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id));
});

app.delete('/api/members/:id', (req, res) => {
  const info = db.prepare('DELETE FROM members WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'member not found' });
  res.status(204).end();
});

// ---------- Promotions ----------

app.get('/api/promotions/pending', (req, res) => {
  res.json(pendingPromotions());
});

app.post('/api/promotions/validate', (req, res) => {
  const ids = req.body.member_ids;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: 'member_ids required' });
  const pending = pendingPromotions();
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

app.get('/api/promotions/history', (req, res) => {
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
       ORDER BY p.promoted_at DESC, p.id DESC`
    )
    .all()
    .map((p) => ({ ...p, matalib: JSON.parse(p.matalib || '[]') }));
  res.json(rows);
});

// ---------- Leaders & التشكيلة ----------

const latestYear = () =>
  db.prepare('SELECT MAX(year) AS y FROM assignments').get().y || null;

// Assignments (with leader + branch names) for a given تشكيلة year
function assignmentsForYear(year) {
  if (!year) return [];
  return db
    .prepare(
      `SELECT a.*, l.first_name, l.last_name, l.photo,
        b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
       FROM assignments a
       JOIN leaders l ON l.id = a.leader_id
       LEFT JOIN branches b ON b.id = a.branch_id
       WHERE a.year = ?
       ORDER BY a.role_type = 'amana', COALESCE(b.sort_order, 999), a.id`
    )
    .all(year);
}

app.get('/api/leaders', (req, res) => {
  const rows = db
    .prepare(
      `SELECT l.*,
        (SELECT COUNT(*) FROM sessions s WHERE s.leader_id = l.id) AS sessions_count,
        (SELECT COUNT(*) FROM session_leaders sl WHERE sl.leader_id = l.id AND sl.status = 'present') AS present_count,
        (SELECT COUNT(*) FROM session_leaders sl WHERE sl.leader_id = l.id AND sl.status = 'absent') AS absent_count
       FROM leaders l ORDER BY l.last_name, l.first_name`
    )
    .all();
  const year = latestYear();
  const roles = {};
  for (const a of assignmentsForYear(year)) {
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
      `SELECT s.id, s.title, s.date, s.matalib, sl.role, sl.status AS my_status,
        b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'present') AS present_count
       FROM session_leaders sl
       JOIN sessions s ON s.id = sl.session_id
       JOIN branches b ON b.id = s.branch_id
       WHERE sl.leader_id = ? ORDER BY s.date DESC, s.id DESC`
    )
    .all(l.id)
    .map((r) => ({ ...r, matalib: JSON.parse(r.matalib || '[]') }));
  const year = latestYear();
  const attendance = {
    present: sessions.filter((s) => s.my_status === 'present').length,
    absent: sessions.filter((s) => s.my_status === 'absent').length,
    unmarked: sessions.filter((s) => !s.my_status).length,
  };
  res.json({
    ...l,
    year,
    current_roles: assignments.filter((a) => a.year === year),
    assignments,
    sessions,
    attendance,
  });
});

function validateLeader(body) {
  if (!body.first_name || !body.last_name) return 'first_name and last_name required';
  if (!['active', 'inactive'].includes(body.status || 'active')) return 'invalid status';
  return null;
}

app.post('/api/leaders', (req, res) => {
  const err = validateLeader(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  const info = db
    .prepare('INSERT INTO leaders (first_name, last_name, phone, photo, status) VALUES (?, ?, ?, ?, ?)')
    .run(b.first_name, b.last_name, b.phone || null, b.photo || null, b.status || 'active');
  res.status(201).json(db.prepare('SELECT * FROM leaders WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/leaders/:id', (req, res) => {
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

app.delete('/api/leaders/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM leaders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'leader not found' });
  const run = db.transaction(() => {
    // Sessions keep the leader name as plain text, only the link is removed
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
  res.json({ years, year, assignments: assignmentsForYear(year) });
});

function validateAssignment(body) {
  if (!body.year || !String(body.year).trim()) return 'year required';
  if (!body.title || !String(body.title).trim()) return 'title required';
  if (!db.prepare('SELECT id FROM leaders WHERE id = ?').get(body.leader_id)) return 'invalid leader_id';
  if (body.branch_id !== undefined && body.branch_id !== null) {
    if (!db.prepare('SELECT id FROM branches WHERE id = ?').get(body.branch_id)) return 'invalid branch_id';
  }
  return null;
}

app.post('/api/tachkila', (req, res) => {
  const err = validateAssignment(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  const branchId = b.branch_id ?? null;
  const info = db
    .prepare('INSERT INTO assignments (year, leader_id, title, branch_id, role_type) VALUES (?, ?, ?, ?, ?)')
    .run(String(b.year).trim(), b.leader_id, String(b.title).trim(), branchId, branchId ? 'branch' : 'amana');
  res.status(201).json(db.prepare('SELECT * FROM assignments WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/tachkila/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'assignment not found' });
  const body = { ...existing, ...req.body };
  const err = validateAssignment(body);
  if (err) return res.status(400).json({ error: err });
  const branchId = body.branch_id ?? null;
  db.prepare(
    'UPDATE assignments SET year = ?, leader_id = ?, title = ?, branch_id = ?, role_type = ? WHERE id = ?'
  ).run(String(body.year).trim(), body.leader_id, String(body.title).trim(), branchId, branchId ? 'branch' : 'amana', req.params.id);
  res.json(db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id));
});

app.delete('/api/tachkila/:id', (req, res) => {
  const info = db.prepare('DELETE FROM assignments WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'assignment not found' });
  res.status(204).end();
});

// New تشكيلة year seeded from a previous one (titles carry over, editable afterwards)
app.post('/api/tachkila/copy', (req, res) => {
  const { from_year, to_year } = req.body;
  if (!to_year || !String(to_year).trim()) return res.status(400).json({ error: 'to_year required' });
  const target = String(to_year).trim();
  const exists = db.prepare('SELECT COUNT(*) AS n FROM assignments WHERE year = ?').get(target).n;
  if (exists > 0) return res.status(400).json({ error: 'year_exists' });
  let copied = 0;
  if (from_year) {
    const src = db.prepare('SELECT * FROM assignments WHERE year = ?').all(from_year);
    const insert = db.prepare(
      'INSERT INTO assignments (year, leader_id, title, branch_id, role_type) VALUES (?, ?, ?, ?, ?)'
    );
    const run = db.transaction(() => {
      for (const a of src) {
        insert.run(target, a.leader_id, a.title, a.branch_id, a.role_type);
        copied++;
      }
    });
    run();
  }
  res.status(201).json({ year: target, copied });
});

// ---------- Sessions & attendance ----------

app.get('/api/sessions', (req, res) => {
  const { q, branch, from, to } = req.query;
  let sql = `SELECT s.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        COALESCE(l.first_name || ' ' || l.last_name, s.leader) AS leader,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'present') AS present_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'absent') AS absent_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'excused') AS excused_count
       FROM sessions s JOIN branches b ON b.id = s.branch_id
       LEFT JOIN leaders l ON l.id = s.leader_id
       WHERE 1=1`;
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

app.post('/api/sessions', (req, res) => {
  const { title, date, branch_id, leader, leader_id, fee, matalib, helper_ids } = req.body;
  if (!title || !date || !branch_id) return res.status(400).json({ error: 'title, date, branch_id required' });
  if (!db.prepare('SELECT id FROM branches WHERE id = ?').get(branch_id))
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
  // `leader` keeps a plain-text name snapshot so old data and linked leaders display the same way
  const leaderName = leaderRow ? `${leaderRow.first_name} ${leaderRow.last_name}` : leader || null;
  const insertAnimator = db.prepare(
    'INSERT OR IGNORE INTO session_leaders (session_id, leader_id, role) VALUES (?, ?, ?)'
  );
  let sessionId;
  db.transaction(() => {
    sessionId = db
      .prepare(
        'INSERT INTO sessions (title, date, branch_id, leader, leader_id, fee, matalib) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(title, date, branch_id, leaderName, leaderRow ? leaderRow.id : null, fee ?? null, JSON.stringify(unique))
      .lastInsertRowid;
    if (leaderRow) insertAnimator.run(sessionId, leaderRow.id, 'main');
    for (const h of helpers) {
      if (leaderRow && h === leaderRow.id) continue;
      insertAnimator.run(sessionId, h, 'helper');
    }
  })();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  res.status(201).json({ ...row, matalib: JSON.parse(row.matalib) });
});

app.get('/api/sessions/:id', (req, res) => {
  const s = db
    .prepare(
      `SELECT s.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        COALESCE(l.first_name || ' ' || l.last_name, s.leader) AS leader
       FROM sessions s JOIN branches b ON b.id = s.branch_id
       LEFT JOIN leaders l ON l.id = s.leader_id
       WHERE s.id = ?`
    )
    .get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  const roster = db
    .prepare(
      `SELECT m.id, m.first_name, m.last_name, m.photo, a.status
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
app.post('/api/sessions/:id/animators', (req, res) => {
  const s = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
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

app.post('/api/sessions/:id/attendance', (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
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

app.get('/api/stats', (req, res) => {
  const total_active = db.prepare("SELECT COUNT(*) AS n FROM members WHERE status = 'active'").get().n;
  const branches = db
    .prepare(
      `SELECT b.id, b.name_fr, b.name_ar,
        (SELECT l.first_name || ' ' || l.last_name FROM assignments a JOIN leaders l ON l.id = a.leader_id
          WHERE a.branch_id = b.id AND a.year = (SELECT MAX(year) FROM assignments)
          ORDER BY a.id LIMIT 1) AS leader_name,
        (SELECT a.leader_id FROM assignments a
          WHERE a.branch_id = b.id AND a.year = (SELECT MAX(year) FROM assignments)
          ORDER BY a.id LIMIT 1) AS leader_id,
        (SELECT COUNT(*) FROM members m WHERE m.branch_id = b.id AND m.status = 'active') AS member_count,
        (SELECT COUNT(*) FROM sessions s WHERE s.branch_id = b.id) AS activities_count,
        (SELECT COUNT(DISTINCT a.member_id) FROM attendance a
          JOIN sessions s ON s.id = a.session_id
          WHERE s.branch_id = b.id AND a.status = 'present') AS participants_count
       FROM branches b ORDER BY b.sort_order`
    )
    .all();
  const ym = todayISO().slice(0, 7);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(a.status = 'present'), 0) AS present
       FROM attendance a JOIN sessions s ON s.id = a.session_id
       WHERE substr(s.date, 1, 7) = ?`
    )
    .get(ym);
  res.json({
    total_active,
    branches,
    pending_promotions: pendingPromotions().length,
    month_rate: row.total ? Math.round((row.present / row.total) * 100) : null,
    birthdays: upcomingBirthdays(),
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
