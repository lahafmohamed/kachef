// ---------- Fiche à compléter ----------
// Les fiches incomplètes (lieu de naissance, groupe sanguin, téléphones…) se remplissent
// par la famille elle-même : le قائد envoie par WhatsApp un lien personnel, propre à un
// عنصر, et la famille y répond sans compte. Le lien est la seule clé — long, aléatoire,
// limité dans le temps, révocable, valable pour une seule réponse.
//
// Rien de ce que la famille écrit ne touche la fiche directement : la réponse attend
// qu'un قائد la relise et choisisse champ par champ ce qu'il reporte. La page publique ne
// montre jamais ce que la fiche contient déjà — un lien qui circule ne fait rien lire,
// il ne peut que proposer.

const crypto = require('crypto');

const LINK_DAYS = 30;
const PUBLIC_WINDOW_MS = 10 * 60 * 1000;
const PUBLIC_MAX_HITS = 60;
const RESPONDENTS = ['self', 'father', 'mother', 'other'];
const RECIPIENTS = ['member', 'father', 'mother'];
const PHONE_OF = { member: 'member_phone', father: 'father_phone', mother: 'mother_phone' };

// Ce que la famille peut renseigner, dans l'ordre du formulaire. `contact` : téléphones et
// adresse (members.contact) ; `health` : le volet santé (members.health). Un champ n'est
// demandé que s'il est vide sur la fiche.
const FIELDS = {
  birth_date: { kind: 'date' },
  birth_place: { kind: 'text', max: 120 },
  father_name: { kind: 'text', max: 80 },
  mother_name: { kind: 'text', max: 120 },
  school: { kind: 'text', max: 120 },
  address_abidjan: { kind: 'text', max: 200, contact: true },
  member_phone: { kind: 'phone', contact: true },
  father_phone: { kind: 'phone', contact: true },
  mother_phone: { kind: 'phone', contact: true },
  blood_type: { kind: 'blood' },
  allergies: { kind: 'text', max: 1000, health: true },
  treatment: { kind: 'text', max: 1000, health: true },
  can_swim: { kind: 'bool', health: true },
  emergency_name: { kind: 'text', max: 120, health: true },
  emergency_phone: { kind: 'phone', health: true },
};
const FIELD_KEYS = Object.keys(FIELDS);
const HEALTH_KEYS = FIELD_KEYS.filter((k) => FIELDS[k].health);

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

// Vide sur la fiche. Allergies et traitement vides sont une réponse («rien») dès que la
// fiche santé a été remplie une fois : on ne les redemande pas.
function isMissing(m, key, ref = new Date()) {
  if (key === 'can_swim') return m.can_swim === null || m.can_swim === undefined;
  if ((key === 'allergies' || key === 'treatment') && m.health_updated_at) return false;
  // Le téléphone personnel d'un enfant de moins de 14 ans n'a pas de sens
  if (key === 'member_phone' && m.birth_date) {
    const age = ageOf(m.birth_date, ref);
    if (age !== null && age < 14) return false;
  }
  return blank(m[key]);
}

function ageOf(birthDate, ref = new Date()) {
  const b = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(b.getTime())) return null;
  let age = ref.getFullYear() - b.getFullYear();
  const mo = ref.getMonth() - b.getMonth();
  if (mo < 0 || (mo === 0 && ref.getDate() < b.getDate())) age--;
  return age;
}

module.exports = function setupMemberForms(app, publicApi, deps) {
  const {
    db, hasPerm, requirePerm, branchOk, branchFilterSQL, auditEvent, notifications,
    validISODate, validPhone, BLOOD_TYPES, todayISO, intOr,
  } = deps;

  db.exec(`
    CREATE TABLE IF NOT EXISTS member_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      -- les champs demandés (JSON), figés à l'envoi
      fields TEXT NOT NULL,
      -- à qui le lien est parti : member | father | mother ; NULL = lien copié
      recipient TEXT,
      lang TEXT NOT NULL DEFAULT 'ar',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      created_by_id INTEGER,
      -- quand le قائد l'a fait partir (WhatsApp ou copié) : un lien jamais envoyé n'est qu'un brouillon
      sent_at TEXT,
      expires_at TEXT NOT NULL,
      opened_at TEXT,
      submitted_at TEXT,
      -- la réponse (JSON {champ: valeur}) et qui l'a donnée : self | father | mother | other
      answers TEXT,
      respondent TEXT,
      reviewed_at TEXT,
      reviewed_by TEXT,
      outcome TEXT CHECK (outcome IN ('applied', 'rejected')),
      -- les champs reportés sur la fiche (JSON)
      applied TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_member_forms_member ON member_forms(member_id, created_at);
  `);

  // Permissions du قائد : il voit et envoie ce qu'il peut lire lui-même
  const allowedKeys = (req) =>
    FIELD_KEYS.filter(
      (k) => (!FIELDS[k].contact || hasPerm(req, 'members.contact')) && (!FIELDS[k].health || hasPerm(req, 'members.health'))
    );

  const nowSQL = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  function statusOf(f, now = nowSQL()) {
    if (f.outcome) return f.outcome;
    if (f.submitted_at) return 'submitted';
    if (f.revoked_at) return 'revoked';
    if (f.expires_at < now) return 'expired';
    if (f.opened_at) return 'opened';
    return f.sent_at ? 'sent' : 'draft';
  }
  const isLive = (f) => ['draft', 'sent', 'opened'].includes(statusOf(f));

  const formView = (f, { withToken = false } = {}) => ({
    id: f.id,
    status: statusOf(f),
    fields: JSON.parse(f.fields),
    recipient: f.recipient,
    lang: f.lang,
    created_at: f.created_at,
    created_by: f.created_by,
    sent_at: f.sent_at,
    expires_at: f.expires_at,
    opened_at: f.opened_at,
    submitted_at: f.submitted_at,
    reviewed_at: f.reviewed_at,
    reviewed_by: f.reviewed_by,
    ...(withToken && isLive(f) ? { token: f.token } : {}),
  });

  // ---------- Valeurs ----------

  // Une valeur de la famille, nettoyée : undefined = rien répondu, Error = refusée
  function cleanValue(key, raw) {
    const def = FIELDS[key];
    if (def.kind === 'bool') {
      if (raw === undefined || raw === null || raw === '') return undefined;
      return typeof raw === 'boolean' ? raw : new Error('invalid');
    }
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'string') return new Error('invalid');
    const s = raw.trim().replace(/\s+/g, ' ');
    if (!s) return undefined;
    if (def.kind === 'date') {
      if (!validISODate(s) || s > todayISO() || s < '1940-01-01') return new Error('invalid');
      return s;
    }
    if (def.kind === 'phone') return s.length <= 40 && validPhone(s) ? s : new Error('invalid');
    if (def.kind === 'blood') return BLOOD_TYPES.includes(s) ? s : new Error('invalid');
    return s.length <= def.max ? s : new Error('too_long');
  }

  // ---------- Page publique ----------

  // Par adresse : le lien est déjà impossible à deviner, ceci arrête qui essaierait quand même
  const hits = new Map();
  function throttled(req) {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const row = hits.get(key);
    if (!row || now - row.startedAt > PUBLIC_WINDOW_MS) {
      hits.set(key, { count: 1, startedAt: now });
      if (hits.size > 5000) for (const [k, v] of hits) if (now - v.startedAt > PUBLIC_WINDOW_MS) hits.delete(k);
      return false;
    }
    row.count += 1;
    return row.count > PUBLIC_MAX_HITS;
  }

  publicApi.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (throttled(req)) {
      res.setHeader('Retry-After', String(PUBLIC_WINDOW_MS / 1000));
      return res.status(429).json({ error: 'too_many_requests' });
    }
    next();
  });

  const formByToken = (token) =>
    typeof token === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(token)
      ? db.prepare('SELECT * FROM member_forms WHERE token = ?').get(token)
      : null;

  // Les champs encore à demander : ceux du lien, moins ce qu'un قائد a rempli entre-temps
  const stillAsked = (f, m) => JSON.parse(f.fields).filter((k) => FIELDS[k] && isMissing(m, k));

  publicApi.get('/fiche/:token', (req, res) => {
    const f = formByToken(req.params.token);
    if (!f) return res.status(404).json({ error: 'not_found' });
    const status = statusOf(f);
    const m = db
      .prepare(
        `SELECT m.*, b.name_ar AS branch_ar, b.name_fr AS branch_fr, b.section
           FROM members m JOIN branches b ON b.id = m.branch_id WHERE m.id = ?`
      )
      .get(f.member_id);
    if (!m) return res.status(404).json({ error: 'not_found' });
    const base = {
      status,
      lang: f.lang,
      // Prénom et nom seulement : la famille sait de qui il s'agit, rien d'autre ne sort
      member: { first_name: m.first_name, last_name: m.last_name, sex: m.sex, branch_ar: m.branch_ar, branch_fr: m.branch_fr },
    };
    if (!isLive(f)) return res.json(base);
    if (!f.opened_at) db.prepare("UPDATE member_forms SET opened_at = datetime('now') WHERE id = ?").run(f.id);
    res.json({ ...base, status: 'open', expires_at: f.expires_at, fields: stillAsked(f, m), blood_types: BLOOD_TYPES });
  });

  publicApi.post('/fiche/:token', (req, res) => {
    const f = formByToken(req.params.token);
    if (!f) return res.status(404).json({ error: 'not_found' });
    if (!isLive(f)) return res.status(409).json({ error: 'closed', status: statusOf(f) });
    const body = req.body || {};
    if (!RESPONDENTS.includes(body.respondent)) return res.status(400).json({ error: 'invalid_respondent' });
    const raw = body.answers && typeof body.answers === 'object' ? body.answers : {};
    const asked = JSON.parse(f.fields);
    const answers = {};
    const errors = {};
    for (const key of asked) {
      if (!FIELDS[key]) continue;
      const v = cleanValue(key, raw[key]);
      if (v instanceof Error) errors[key] = v.message;
      else if (v !== undefined) answers[key] = v;
    }
    if (Object.keys(errors).length) return res.status(400).json({ error: 'invalid_answers', fields: errors });
    if (!Object.keys(answers).length) return res.status(400).json({ error: 'empty' });
    // Une seule réponse par lien, même si deux envois se croisent
    const done = db
      .prepare(
        `UPDATE member_forms SET answers = ?, respondent = ?, submitted_at = datetime('now')
          WHERE id = ? AND submitted_at IS NULL AND revoked_at IS NULL`
      )
      .run(JSON.stringify(answers), body.respondent, f.id);
    if (!done.changes) return res.status(409).json({ error: 'closed' });
    const m = db.prepare('SELECT id, first_name, father_name, last_name, branch_id FROM members WHERE id = ?').get(f.member_id);
    if (m) notifications.memberFormSubmitted(m, { formId: f.id, count: Object.keys(answers).length });
    res.json({ status: 'submitted' });
  });

  // ---------- Côté قادة ----------

  const canUse = [requirePerm('members.edit'), requirePerm('members.contact')];

  const latestFormSQL = `
    SELECT f.* FROM member_forms f
     WHERE f.id = (SELECT MAX(f2.id) FROM member_forms f2 WHERE f2.member_id = ?)`;

  // Les عناصر actifs de mes فرق, ce qui manque à chacun, et où en est son dernier lien
  app.get('/api/member-forms', ...canUse, (req, res) => {
    const branch = req.query.branch ? intOr(req.query.branch) : null;
    if (branch !== null && !branchOk(req, branch)) return res.status(403).json({ error: 'forbidden' });
    const keys = allowedKeys(req);
    const rows = db
      .prepare(
        `SELECT m.*, b.section FROM members m JOIN branches b ON b.id = m.branch_id
          WHERE m.status = 'active' ${branch !== null ? 'AND m.branch_id = @branch' : ''}
          ${branchFilterSQL(req, 'm.branch_id')}
          ORDER BY b.sort_order, m.last_name, m.first_name`
      )
      .all(branch !== null ? { branch } : {});
    const latest = db.prepare(latestFormSQL);
    const now = new Date();
    const members = rows.map((m) => {
      const f = latest.get(m.id);
      return {
        id: m.id,
        first_name: m.first_name,
        father_name: m.father_name,
        last_name: m.last_name,
        sex: m.sex,
        photo: m.photo,
        branch_id: m.branch_id,
        section: m.section,
        birth_date: m.birth_date,
        phones: { member: m.member_phone, father: m.father_phone, mother: m.mother_phone },
        missing: keys.filter((k) => isMissing(m, k, now)),
        form: f ? formView(f, { withToken: true }) : null,
      };
    });
    const pending = db
      .prepare(
        `SELECT COUNT(*) AS n FROM member_forms f JOIN members m ON m.id = f.member_id
          WHERE f.submitted_at IS NOT NULL AND f.outcome IS NULL ${branchFilterSQL(req, 'm.branch_id')}`
      )
      .get().n;
    res.json({ members, pending, link_days: LINK_DAYS });
  });

  // Un lien pour un عنصر : le lien encore valable s'il y en a un, sinon un nouveau
  app.post('/api/member-forms', ...canUse, (req, res) => {
    const b = req.body || {};
    const m = db.prepare('SELECT m.*, b.section FROM members m JOIN branches b ON b.id = m.branch_id WHERE m.id = ?').get(intOr(b.member_id));
    if (!m) return res.status(404).json({ error: 'member not found' });
    if (!branchOk(req, m.branch_id)) return res.status(403).json({ error: 'forbidden' });
    if (m.status !== 'active') return res.status(400).json({ error: 'member_inactive' });
    const recipient = b.recipient === null || b.recipient === undefined ? null : b.recipient;
    if (recipient !== null && !RECIPIENTS.includes(recipient)) return res.status(400).json({ error: 'invalid recipient' });
    const lang = ['ar', 'fr'].includes(b.lang) ? b.lang : 'ar';

    const prev = db.prepare(latestFormSQL).get(m.id);
    if (prev && isLive(prev) && !b.renew) {
      db.prepare('UPDATE member_forms SET recipient = COALESCE(?, recipient), lang = ? WHERE id = ?').run(recipient, lang, prev.id);
      return res.json(formView(db.prepare('SELECT * FROM member_forms WHERE id = ?').get(prev.id), { withToken: true }));
    }
    // Une réponse pas encore relue : on la traite avant d'en demander une autre
    if (prev && statusOf(prev) === 'submitted') return res.status(409).json({ error: 'pending_review' });
    const fields = allowedKeys(req).filter((k) => isMissing(m, k));
    if (!fields.length) return res.status(400).json({ error: 'nothing_missing' });

    const token = crypto.randomBytes(24).toString('base64url');
    const id = db.transaction(() => {
      if (prev && isLive(prev)) db.prepare("UPDATE member_forms SET revoked_at = datetime('now') WHERE id = ?").run(prev.id);
      return db
        .prepare(
          `INSERT INTO member_forms (member_id, token, fields, recipient, lang, created_by, created_by_id, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`
        )
        .run(m.id, token, JSON.stringify(fields), recipient, lang, req.user.display_name || req.user.username,
          req.user.id, `+${LINK_DAYS} days`).lastInsertRowid;
    })();
    const f = db.prepare('SELECT * FROM member_forms WHERE id = ?').get(id);
    auditEvent(req, 'create', 'member_form', m.id, null, { form_id: f.id, fields, recipient });
    res.status(201).json(formView(f, { withToken: true }));
  });

  const formInScope = (req) => {
    const f = db.prepare('SELECT * FROM member_forms WHERE id = ?').get(intOr(req.params.id));
    if (!f) return { error: [404, 'form not found'] };
    const m = db.prepare('SELECT * FROM members WHERE id = ?').get(f.member_id);
    if (!m) return { error: [404, 'member not found'] };
    if (!branchOk(req, m.branch_id)) return { error: [403, 'forbidden'] };
    return { f, m };
  };

  // Le lien part : par WhatsApp, à tel destinataire, ou copié pour un autre canal
  app.post('/api/member-forms/:id/sent', ...canUse, (req, res) => {
    const { f, error } = formInScope(req);
    if (error) return res.status(error[0]).json({ error: error[1] });
    if (!isLive(f)) return res.status(409).json({ error: 'not_live' });
    const b = req.body || {};
    const recipient = b.recipient === null || b.recipient === undefined ? null : b.recipient;
    if (recipient !== null && !RECIPIENTS.includes(recipient)) return res.status(400).json({ error: 'invalid recipient' });
    const lang = ['ar', 'fr'].includes(b.lang) ? b.lang : f.lang;
    db.prepare("UPDATE member_forms SET sent_at = datetime('now'), recipient = COALESCE(?, recipient), lang = ? WHERE id = ?").run(
      recipient, lang, f.id
    );
    res.json(formView(db.prepare('SELECT * FROM member_forms WHERE id = ?').get(f.id), { withToken: true }));
  });

  app.post('/api/member-forms/:id/revoke', ...canUse, (req, res) => {
    const { f, error } = formInScope(req);
    if (error) return res.status(error[0]).json({ error: error[1] });
    if (!isLive(f)) return res.status(409).json({ error: 'not_live' });
    db.prepare("UPDATE member_forms SET revoked_at = datetime('now') WHERE id = ?").run(f.id);
    auditEvent(req, 'revoke', 'member_form', f.member_id, null, { form_id: f.id });
    res.json(formView(db.prepare('SELECT * FROM member_forms WHERE id = ?').get(f.id)));
  });

  // Les réponses à relire, avec en regard ce que la fiche contient aujourd'hui
  app.get('/api/member-forms/pending', ...canUse, (req, res) => {
    const keys = new Set(allowedKeys(req));
    const rows = db
      .prepare(
        `SELECT f.*, m.first_name, m.father_name, m.last_name, m.sex, m.photo, m.branch_id
           FROM member_forms f JOIN members m ON m.id = f.member_id
          WHERE f.submitted_at IS NOT NULL AND f.outcome IS NULL ${branchFilterSQL(req, 'm.branch_id')}
          ORDER BY f.submitted_at`
      )
      .all();
    const memberStmt = db.prepare('SELECT * FROM members WHERE id = ?');
    res.json(
      rows.map((f) => {
        const m = memberStmt.get(f.member_id);
        const answers = JSON.parse(f.answers || '{}');
        // Ce que ce compte ne peut pas lire ne sort pas — et ne sera pas reporté par lui
        const visible = Object.keys(answers).filter((k) => keys.has(k));
        return {
          ...formView(f),
          respondent: f.respondent,
          member: { id: m.id, first_name: m.first_name, father_name: m.father_name, last_name: m.last_name, sex: m.sex, photo: m.photo, branch_id: m.branch_id },
          answers: visible.map((k) => ({
            key: k,
            value: answers[k],
            current: k === 'can_swim' ? (m.can_swim === null ? null : !!m.can_swim) : (m[k] ?? null),
          })),
          hidden: Object.keys(answers).length - visible.length,
        };
      })
    );
  });

  // Reporte les champs choisis (éventuellement corrigés par le قائد) sur la fiche
  app.post('/api/member-forms/:id/apply', ...canUse, (req, res) => {
    const { f, m, error } = formInScope(req);
    if (error) return res.status(error[0]).json({ error: error[1] });
    if (!f.submitted_at || f.outcome) return res.status(409).json({ error: 'not_pending' });
    const answers = JSON.parse(f.answers || '{}');
    const keys = new Set(allowedKeys(req));
    const pick = Array.isArray(req.body?.fields) ? req.body.fields : [];
    const edits = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {};
    const values = {};
    for (const key of pick) {
      if (!Object.hasOwn(answers, key) || !keys.has(key)) continue;
      const v = cleanValue(key, Object.hasOwn(edits, key) ? edits[key] : answers[key]);
      if (v instanceof Error) return res.status(400).json({ error: 'invalid_value', field: key });
      if (v !== undefined) values[key] = v;
    }
    const applied = Object.keys(values);
    if (!applied.length) return res.status(400).json({ error: 'nothing_selected' });

    const by = req.user.display_name || req.user.username;
    const touchesHealth = applied.some((k) => HEALTH_KEYS.includes(k));
    db.transaction(() => {
      const cols = applied.map((k) => `${k} = @${k}`);
      if (touchesHealth) cols.push("health_updated_at = datetime('now')", 'health_updated_by = @by');
      const params = { id: m.id, by };
      for (const k of applied) params[k] = k === 'can_swim' ? (values[k] ? 1 : 0) : values[k];
      // Les noms de colonnes viennent de FIELDS, jamais de la requête
      db.prepare(`UPDATE members SET ${cols.join(', ')} WHERE id = @id`).run(params);
      db.prepare(
        `UPDATE member_forms SET outcome = 'applied', applied = ?, reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?`
      ).run(JSON.stringify(applied), by, f.id);
    })();
    const updated = db.prepare('SELECT * FROM members WHERE id = ?').get(m.id);
    const pickOf = (row) => Object.fromEntries(applied.map((k) => [k, row[k] ?? null]));
    auditEvent(req, 'update', 'member', m.id, pickOf(m), { ...pickOf(updated), via: 'member_form', form_id: f.id });
    res.json({ applied });
  });

  app.post('/api/member-forms/:id/reject', ...canUse, (req, res) => {
    const { f, error } = formInScope(req);
    if (error) return res.status(error[0]).json({ error: error[1] });
    if (!f.submitted_at || f.outcome) return res.status(409).json({ error: 'not_pending' });
    db.prepare(
      `UPDATE member_forms SET outcome = 'rejected', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?`
    ).run(req.user.display_name || req.user.username, f.id);
    auditEvent(req, 'reject', 'member_form', f.member_id, null, { form_id: f.id });
    res.status(204).end();
  });
};

module.exports.FIELDS = FIELDS;
module.exports.isMissing = isMissing;
