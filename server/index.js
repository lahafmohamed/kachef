const express = require('express');
const path = require('path');
const fs = require('fs');
const { db, seed, migrate } = require('./db');

migrate();
seed();

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
        (SELECT COUNT(*) FROM members m WHERE m.branch_id = b.id AND m.status = 'active') AS member_count
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

// ---------- Sessions & attendance ----------

app.get('/api/sessions', (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'present') AS present_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'absent') AS absent_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'excused') AS excused_count
       FROM sessions s JOIN branches b ON b.id = s.branch_id
       ORDER BY s.date DESC, s.id DESC`
    )
    .all()
    .map((r) => ({ ...r, matalib: JSON.parse(r.matalib || '[]') }));
  res.json(rows);
});

app.post('/api/sessions', (req, res) => {
  const { title, date, branch_id, leader, fee, matalib } = req.body;
  if (!title || !date || !branch_id) return res.status(400).json({ error: 'title, date, branch_id required' });
  if (!db.prepare('SELECT id FROM branches WHERE id = ?').get(branch_id))
    return res.status(400).json({ error: 'invalid branch_id' });
  const nums = matalib === undefined || matalib === null ? [] : matalib;
  if (!Array.isArray(nums) || !nums.every((n) => Number.isInteger(n) && n >= 1))
    return res.status(400).json({ error: 'invalid matalib' });
  const unique = [...new Set(nums)].sort((a, b) => a - b);
  if (fee !== undefined && fee !== null && (typeof fee !== 'number' || fee < 0))
    return res.status(400).json({ error: 'invalid fee' });
  const info = db
    .prepare('INSERT INTO sessions (title, date, branch_id, leader, fee, matalib) VALUES (?, ?, ?, ?, ?, ?)')
    .run(title, date, branch_id, leader || null, fee ?? null, JSON.stringify(unique));
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ...row, matalib: JSON.parse(row.matalib) });
});

app.get('/api/sessions/:id', (req, res) => {
  const s = db
    .prepare(
      `SELECT s.*, b.name_fr AS branch_name_fr, b.name_ar AS branch_name_ar
       FROM sessions s JOIN branches b ON b.id = s.branch_id WHERE s.id = ?`
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
  res.json({ ...s, matalib: JSON.parse(s.matalib || '[]'), roster });
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
  });
});

// Production: serve the built client if present (npm run build at repo root)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
