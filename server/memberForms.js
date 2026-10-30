// ---------- Fiche à compléter ----------
// Les fiches incomplètes (lieu de naissance, groupe sanguin, téléphones…) se remplissent,
// et les fiches fausses se corrigent, par la personne elle-même : un lien personnel, envoyé
// par WhatsApp, ouvre sans compte la fiche en question. Deux sortes de fiches : celle d'un عنصر (la famille
// répond, un قائد de sa فرقة relit) et celle d'un قائد (il répond lui-même, l'admin relit
// — le dossier des قادة est à lui seul). Le lien est la seule clé — long, aléatoire,
// limité dans le temps, révocable, valable pour une seule réponse.
//
// La page montre ce que la fiche contient déjà (choix de la قيادة, 2026-10-30 : une
// information mal saisie se voit et se corrige) — le lien donne donc à lire la fiche, et
// c'est pourquoi il est personnel, fermé dès la réponse, limité dans le temps et révocable.
// Rien de ce qui est écrit ne touche la fiche directement : chaque ajout ou correction
// attend qu'on le relise et qu'on choisisse champ par champ ce qu'on reporte. Une réponse
// qui ne change rien est une confirmation : elle se clôt seule, sans relecture.

const crypto = require('crypto');

const LINK_DAYS = 30;
const PUBLIC_WINDOW_MS = 10 * 60 * 1000;
const PUBLIC_MAX_HITS = 60;
const RESPONDENTS = ['self', 'father', 'mother', 'other'];

// Ce qu'on peut renseigner, dans l'ordre du formulaire. `contact` : téléphones et adresse
// (members.contact) ; `health` : le volet santé (members.health).
const MEMBER_FIELDS = {
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
// Les دورات restent à l'admin : leurs noms sont ceux de la قيادة, pas des mots à deviner
const LEADER_FIELDS = {
  birth_date: { kind: 'date' },
  birth_place: { kind: 'text', max: 120 },
  father_name: { kind: 'text', max: 80 },
  marital_status: { kind: 'enum', options: ['single', 'married'] },
  phone: { kind: 'phone' },
  address_abidjan: { kind: 'text', max: 200 },
  address_lebanon: { kind: 'text', max: 200 },
  blood_type: { kind: 'blood' },
  join_year: { kind: 'year' },
  years_ghadir: { kind: 'int' },
  years_total: { kind: 'int' },
  education: { kind: 'text', max: 300 },
};
const HEALTH_KEYS = Object.keys(MEMBER_FIELDS).filter((k) => MEMBER_FIELDS[k].health);
// Demande d'inscription (2026-10-30) : pas encore de fiche, la famille remplit tout. Nom,
// prénom, sexe et date de naissance sont exigés — sans eux pas d'عنصر, ni de طليعة par âge.
const SIGNUP_FIELDS = {
  first_name: { kind: 'text', max: 80, required: true },
  last_name: { kind: 'text', max: 80, required: true },
  sex: { kind: 'enum', options: ['M', 'F'], required: true },
  birth_date: { kind: 'date', required: true },
  ...Object.fromEntries(Object.entries(MEMBER_FIELDS).filter(([k]) => k !== 'birth_date')),
};
// Ce qui va dans l'INSERT de l'عنصر ; le reste (santé) suit en UPDATE
const SIGNUP_MEMBER_COLUMNS = [
  'first_name', 'last_name', 'sex', 'birth_date', 'birth_place', 'father_name', 'mother_name', 'school',
  'address_abidjan', 'member_phone', 'father_phone', 'mother_phone', 'blood_type',
];

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

function ageOf(birthDate, ref = new Date()) {
  const b = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(b.getTime())) return null;
  let age = ref.getFullYear() - b.getFullYear();
  const mo = ref.getMonth() - b.getMonth();
  if (mo < 0 || (mo === 0 && ref.getDate() < b.getDate())) age--;
  return age;
}

// Un champ qui a un sens pour cette fiche : le téléphone personnel d'un enfant de moins de
// 14 ans n'en a pas
function memberApplicable(m, key, ref = new Date()) {
  if (key === 'member_phone' && m.birth_date) {
    const age = ageOf(m.birth_date, ref);
    if (age !== null && age < 14) return false;
  }
  return true;
}
// Vide sur la fiche d'un عنصر. Allergies et traitement vides sont une réponse («rien») dès
// que la fiche santé a été remplie une fois : on ne les redemande pas.
function memberMissing(m, key, ref = new Date()) {
  if (!memberApplicable(m, key, ref)) return false;
  if (key === 'can_swim') return m.can_swim === null || m.can_swim === undefined;
  if ((key === 'allergies' || key === 'treatment') && m.health_updated_at) return false;
  return blank(m[key]);
}
const leaderMissing = (l, key) => blank(l[key]);

module.exports = function setupMemberForms(app, publicApi, deps) {
  const {
    db, hasPerm, requirePerm, requireAdmin, branchOk, branchFilterSQL, leaderScopeSQL, leaderOk, auditEvent,
    notifications, validISODate, validPhone, BLOOD_TYPES, todayISO, intOr, createMember, ageGroupIdFor, sectionDef,
    sectionOfBranch,
  } = deps;

  const formColumns = (fk, ref) => `
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${fk} INTEGER NOT NULL REFERENCES ${ref}(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      -- les champs demandés (JSON), figés à l'envoi
      fields TEXT NOT NULL,
      -- à qui le lien est parti : member | father | mother (un عنصر), self (un قائد) ; NULL = copié
      recipient TEXT,
      lang TEXT NOT NULL DEFAULT 'ar',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      created_by_id INTEGER,
      -- quand il est parti (WhatsApp ou copié) : un lien jamais envoyé n'est qu'un brouillon
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
      revoked_at TEXT`;
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_forms (${formColumns('member_id', 'members')});
    CREATE INDEX IF NOT EXISTS idx_member_forms_member ON member_forms(member_id, created_at);
    CREATE TABLE IF NOT EXISTS leader_forms (${formColumns('leader_id', 'leaders')});
    CREATE INDEX IF NOT EXISTS idx_leader_forms_leader ON leader_forms(leader_id, created_at);
    -- Demande d'inscription : la فرقة visée tient lieu de fiche (le قائد la change à la
    -- validation s'il le faut) ; member_id = l'عنصر créé en la validant
    CREATE TABLE IF NOT EXISTS member_signups (
      ${formColumns('branch_id', 'branches')},
      -- pour le message et la liste : le prénom connu, le numéro où le lien est parti
      label TEXT,
      phone TEXT,
      member_id INTEGER REFERENCES members(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_member_signups_branch ON member_signups(branch_id, created_at);
  `);

  const by = (req) => req.user.display_name || req.user.username;
  const nowSQL = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  function statusOf(f, now = nowSQL()) {
    // Rien changé : la personne a confirmé sa fiche telle quelle
    if (f.outcome === 'applied' && f.applied === '[]') return 'confirmed';
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

  // Une valeur saisie, nettoyée : undefined = rien répondu, Error = refusée
  function cleanValue(def, raw) {
    if (def.kind === 'bool') {
      if (raw === undefined || raw === null || raw === '') return undefined;
      return typeof raw === 'boolean' ? raw : new Error('invalid');
    }
    if (raw === undefined || raw === null) return undefined;
    if (def.kind === 'int' && typeof raw === 'number') raw = String(raw);
    if (typeof raw !== 'string') return new Error('invalid');
    const s = raw.trim().replace(/\s+/g, ' ');
    if (!s) return undefined;
    if (def.kind === 'date') {
      if (!validISODate(s) || s > todayISO() || s < '1940-01-01') return new Error('invalid');
      return s;
    }
    if (def.kind === 'phone') return s.length <= 40 && validPhone(s) ? s : new Error('invalid');
    if (def.kind === 'blood') return BLOOD_TYPES.includes(s) ? s : new Error('invalid');
    if (def.kind === 'enum') return def.options.includes(s) ? s : new Error('invalid');
    if (def.kind === 'year') {
      const y = Number(s);
      return /^\d{4}$/.test(s) && y >= 1950 && y <= new Date().getFullYear() ? s : new Error('invalid');
    }
    if (def.kind === 'int') return /^\d{1,2}$/.test(s) ? Number(s) : new Error('invalid');
    return s.length <= def.max ? s : new Error('too_long');
  }

  // ---------- Les deux sortes de fiches ----------
  // Ce qui change de l'une à l'autre : la table, qui voit et relit, ce qu'on demande, où
  // part le lien. Tout le reste — liens, réponses, relecture — est le même code.

  const memberKind = {
    name: 'member',
    table: 'member_forms',
    fk: 'member_id',
    route: '/api/member-forms',
    FIELDS: MEMBER_FIELDS,
    guard: [requirePerm('members.edit'), requirePerm('members.contact')],
    // Ce que ce compte peut lire lui-même, il peut le demander et le reporter
    keysFor: (req) =>
      Object.keys(MEMBER_FIELDS).filter(
        (k) => (!MEMBER_FIELDS[k].contact || hasPerm(req, 'members.contact')) && (!MEMBER_FIELDS[k].health || hasPerm(req, 'members.health'))
      ),
    applicable: memberApplicable,
    isMissing: memberMissing,
    recipients: { member: 'member_phone', father: 'father_phone', mother: 'mother_phone' },
    get: (id) =>
      db
        .prepare('SELECT m.*, b.section, b.name_ar AS branch_ar, b.name_fr AS branch_fr FROM members m JOIN branches b ON b.id = m.branch_id WHERE m.id = ?')
        .get(id),
    inScope: (req, m) => branchOk(req, m.branch_id),
    list: (req, branch) =>
      db
        .prepare(
          `SELECT m.*, b.section FROM members m JOIN branches b ON b.id = m.branch_id
            WHERE m.status = 'active' ${branch !== null ? 'AND m.branch_id = @branch' : ''}
            ${branchFilterSQL(req, 'm.branch_id')}
            ORDER BY b.sort_order, m.last_name, m.first_name`
        )
        .all(branch !== null ? { branch } : {}),
    scopeSQL: (req) => `JOIN members p ON p.id = f.member_id WHERE 1=1 ${branchFilterSQL(req, 'p.branch_id')}`,
    row: (m) => ({
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
    }),
    current: (m, k) => (k === 'can_swim' ? (m.can_swim === null ? null : !!m.can_swim) : (m[k] ?? null)),
    write(req, m, values) {
      const applied = Object.keys(values);
      const cols = applied.map((k) => `${k} = @${k}`);
      if (applied.some((k) => HEALTH_KEYS.includes(k))) cols.push("health_updated_at = datetime('now')", 'health_updated_by = @by');
      const params = { id: m.id, by: by(req) };
      for (const k of applied) params[k] = k === 'can_swim' ? (values[k] ? 1 : 0) : values[k];
      // Les noms de colonnes viennent de FIELDS, jamais de la requête
      db.prepare(`UPDATE members SET ${cols.join(', ')} WHERE id = @id`).run(params);
    },
    audit: 'member',
    notify: (m, info) => notifications.memberFormSubmitted({ ...m, kind: 'member' }, info),
  };

  const leaderKind = {
    name: 'leader',
    table: 'leader_forms',
    fk: 'leader_id',
    route: '/api/leader-forms',
    FIELDS: LEADER_FIELDS,
    // Le dossier des قادة est à l'admin seul (PUT /api/leaders/:id)
    guard: [requireAdmin],
    keysFor: () => Object.keys(LEADER_FIELDS),
    applicable: () => true,
    isMissing: leaderMissing,
    recipients: { self: 'phone' },
    get: (id) => db.prepare('SELECT * FROM leaders WHERE id = ?').get(id),
    inScope: (req, l) => leaderOk(req, l),
    list: (req) =>
      db
        .prepare(`SELECT l.* FROM leaders l WHERE l.status = 'active' ${leaderScopeSQL(req, 'l')} ORDER BY l.last_name, l.first_name`)
        .all(),
    scopeSQL: (req) => `JOIN leaders p ON p.id = f.leader_id WHERE 1=1 ${leaderScopeSQL(req, 'p')}`,
    row: (l) => ({
      id: l.id,
      first_name: l.first_name,
      father_name: l.father_name,
      last_name: l.last_name,
      photo: l.photo,
      section: l.section,
      birth_date: l.birth_date,
      phones: { self: l.phone },
    }),
    current: (l, k) => l[k] ?? null,
    write(req, l, values) {
      const applied = Object.keys(values);
      const params = { id: l.id, ...values };
      db.prepare(`UPDATE leaders SET ${applied.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run(params);
      // Le nom gardé sur les نشاطات qu'il a menées suit le nom trilitère
      if (applied.includes('father_name')) {
        const u = db.prepare('SELECT first_name, father_name, last_name FROM leaders WHERE id = ?').get(l.id);
        db.prepare('UPDATE sessions SET leader = ? WHERE leader_id = ?').run(
          [u.first_name, u.father_name, u.last_name].filter(Boolean).join(' '), l.id
        );
      }
    },
    audit: 'leader',
    notify: (l, info) => notifications.memberFormSubmitted({ ...l, kind: 'leader' }, info),
  };
  const KINDS = [memberKind, leaderKind];
  const signupKind = { name: 'signup', table: 'member_signups' };

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

  // { kind, f } pour un jeton, cherché dans les deux tables
  function byToken(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    for (const kind of [...KINDS, signupKind]) {
      const f = db.prepare(`SELECT * FROM ${kind.table} WHERE token = ?`).get(token);
      if (f) return { kind, f };
    }
    return null;
  }

  // Les champs du lien qui ont encore un sens pour la fiche
  const shownFields = (kind, f, p) => JSON.parse(f.fields).filter((k) => kind.FIELDS[k] && kind.applicable(p, k));
  // Même valeur que la fiche : pas une correction
  const sameAs = (current, v) =>
    current !== null && current !== undefined && (typeof v === 'boolean' ? current === v : String(current).trim() === String(v));

  publicApi.get('/fiche/:token', (req, res) => {
    const hit = byToken(req.params.token);
    if (!hit) return res.status(404).json({ error: 'not_found' });
    if (hit.kind === signupKind) return signupPage(res, hit.f);
    const { kind, f } = hit;
    const p = kind.get(f[kind.fk]);
    if (!p) return res.status(404).json({ error: 'not_found' });
    const base = {
      kind: kind.name,
      status: statusOf(f),
      lang: f.lang,
      // Prénom et nom seulement : on sait de qui il s'agit, rien d'autre ne sort
      person: {
        first_name: p.first_name,
        last_name: p.last_name,
        sex: p.sex ?? (p.section === 'F' || p.section === 'FRF' ? 'F' : 'M'),
        branch_ar: p.branch_ar ?? null,
        branch_fr: p.branch_fr ?? null,
      },
    };
    if (!isLive(f)) return res.json(base);
    if (!f.opened_at) db.prepare(`UPDATE ${kind.table} SET opened_at = datetime('now') WHERE id = ?`).run(f.id);
    const fields = shownFields(kind, f, p);
    const missing = fields.filter((k) => kind.isMissing(p, k));
    // Ce que la fiche contient déjà, pour qu'on le vérifie ; un champ rempli sans valeur
    // (allergies «rien») part à null
    const values = Object.fromEntries(fields.filter((k) => !missing.includes(k)).map((k) => [k, kind.current(p, k)]));
    res.json({ ...base, status: 'open', expires_at: f.expires_at, fields, missing, values, blood_types: BLOOD_TYPES });
  });

  publicApi.post('/fiche/:token', (req, res) => {
    const hit = byToken(req.params.token);
    if (!hit) return res.status(404).json({ error: 'not_found' });
    if (hit.kind === signupKind) return signupAnswer(req, res, hit.f);
    const { kind, f } = hit;
    if (!isLive(f)) return res.status(409).json({ error: 'closed', status: statusOf(f) });
    const body = req.body || {};
    // Un قائد répond pour lui-même
    const respondent = kind.name === 'leader' ? 'self' : body.respondent;
    if (!RESPONDENTS.includes(respondent)) return res.status(400).json({ error: 'invalid_respondent' });
    const raw = body.answers && typeof body.answers === 'object' ? body.answers : {};
    const p = kind.get(f[kind.fk]);
    if (!p) return res.status(404).json({ error: 'not_found' });
    const answers = {};
    const errors = {};
    for (const key of shownFields(kind, f, p)) {
      const v = cleanValue(kind.FIELDS[key], raw[key]);
      if (v instanceof Error) errors[key] = v.message;
      // Ce qui reprend la fiche telle quelle n'est ni un ajout ni une correction
      else if (v !== undefined && !sameAs(kind.current(p, key), v)) answers[key] = v;
    }
    if (Object.keys(errors).length) return res.status(400).json({ error: 'invalid_answers', fields: errors });
    const confirmed = !Object.keys(answers).length;
    // Une seule réponse par lien, même si deux envois se croisent. Rien changé : la fiche est
    // confirmée telle quelle, il n'y a rien à relire.
    const done = db
      .prepare(
        `UPDATE ${kind.table} SET answers = ?, respondent = ?, submitted_at = datetime('now')
           ${confirmed ? ", outcome = 'applied', applied = '[]', reviewed_at = datetime('now')" : ''}
          WHERE id = ? AND submitted_at IS NULL AND revoked_at IS NULL`
      )
      .run(JSON.stringify(answers), respondent, f.id);
    if (!done.changes) return res.status(409).json({ error: 'closed' });
    if (!confirmed) kind.notify(p, { formId: f.id, count: Object.keys(answers).length });
    res.json({ status: confirmed ? 'confirmed' : 'submitted' });
  });

  // ---------- Côté قيادة ----------

  for (const kind of KINDS) {
    const { table, fk, route, guard, FIELDS } = kind;
    const latest = db.prepare(`SELECT * FROM ${table} WHERE id = (SELECT MAX(id) FROM ${table} WHERE ${fk} = ?)`);
    const byId = db.prepare(`SELECT * FROM ${table} WHERE id = ?`);

    // Les fiches actives de mon périmètre, ce qui manque à chacune, et où en est son dernier lien
    app.get(route, ...guard, (req, res) => {
      const branch = kind.name === 'member' && req.query.branch ? intOr(req.query.branch) : null;
      if (branch !== null && !branchOk(req, branch)) return res.status(403).json({ error: 'forbidden' });
      const keys = kind.keysFor(req);
      const now = new Date();
      const people = kind.list(req, branch).map((p) => {
        const f = latest.get(p.id);
        return {
          ...kind.row(p),
          missing: keys.filter((k) => kind.isMissing(p, k, now)),
          form: f ? formView(f, { withToken: true }) : null,
        };
      });
      const pending = db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} f ${kind.scopeSQL(req)} AND f.submitted_at IS NOT NULL AND f.outcome IS NULL`)
        .get().n;
      res.json({ people, pending, link_days: LINK_DAYS });
    });

    // Un lien pour une fiche : celui encore valable s'il y en a un, sinon un nouveau
    app.post(route, ...guard, (req, res) => {
      const b = req.body || {};
      const p = kind.get(intOr(b[fk]));
      if (!p) return res.status(404).json({ error: 'not found' });
      if (!kind.inScope(req, p)) return res.status(403).json({ error: 'forbidden' });
      if (p.status !== 'active') return res.status(400).json({ error: 'inactive' });
      const lang = ['ar', 'fr'].includes(b.lang) ? b.lang : ['FR', 'FRF'].includes(p.section) ? 'fr' : 'ar';

      const prev = latest.get(p.id);
      if (prev && isLive(prev)) return res.json(formView(prev, { withToken: true }));
      // Une réponse pas encore relue : on la traite avant d'en demander une autre
      if (prev && statusOf(prev) === 'submitted') return res.status(409).json({ error: 'pending_review' });
      // Toute la fiche : ce qui manque à remplir, le reste à vérifier
      const fields = kind.keysFor(req).filter((k) => kind.applicable(p, k));

      const token = crypto.randomBytes(24).toString('base64url');
      const id = db
        .prepare(
          `INSERT INTO ${table} (${fk}, token, fields, lang, created_by, created_by_id, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`
        )
        .run(p.id, token, JSON.stringify(fields), lang, by(req), req.user.id, `+${LINK_DAYS} days`).lastInsertRowid;
      const f = byId.get(id);
      auditEvent(req, 'create', `${kind.name}_form`, p.id, null, { form_id: f.id, fields });
      res.status(201).json(formView(f, { withToken: true }));
    });

    const inScope = (req) => {
      const f = byId.get(intOr(req.params.id));
      if (!f) return { error: [404, 'form not found'] };
      const p = kind.get(f[fk]);
      if (!p) return { error: [404, 'not found'] };
      if (!kind.inScope(req, p)) return { error: [403, 'forbidden'] };
      return { f, p };
    };

    // Le lien part : par WhatsApp, à tel destinataire, ou copié pour un autre canal
    app.post(`${route}/:id/sent`, ...guard, (req, res) => {
      const { f, error } = inScope(req);
      if (error) return res.status(error[0]).json({ error: error[1] });
      if (!isLive(f)) return res.status(409).json({ error: 'not_live' });
      const b = req.body || {};
      const recipient = b.recipient === null || b.recipient === undefined ? null : b.recipient;
      if (recipient !== null && !Object.hasOwn(kind.recipients, recipient)) return res.status(400).json({ error: 'invalid recipient' });
      const lang = ['ar', 'fr'].includes(b.lang) ? b.lang : f.lang;
      db.prepare(`UPDATE ${table} SET sent_at = datetime('now'), recipient = COALESCE(?, recipient), lang = ? WHERE id = ?`).run(
        recipient, lang, f.id
      );
      res.json(formView(byId.get(f.id), { withToken: true }));
    });

    app.post(`${route}/:id/revoke`, ...guard, (req, res) => {
      const { f, error } = inScope(req);
      if (error) return res.status(error[0]).json({ error: error[1] });
      if (!isLive(f)) return res.status(409).json({ error: 'not_live' });
      db.prepare(`UPDATE ${table} SET revoked_at = datetime('now') WHERE id = ?`).run(f.id);
      auditEvent(req, 'revoke', `${kind.name}_form`, f[fk], null, { form_id: f.id });
      res.json(formView(byId.get(f.id)));
    });

    // Les réponses à relire, avec en regard ce que la fiche contient aujourd'hui
    app.get(`${route}/pending`, ...guard, (req, res) => {
      const keys = new Set(kind.keysFor(req));
      const rows = db
        .prepare(`SELECT f.* FROM ${table} f ${kind.scopeSQL(req)} AND f.submitted_at IS NOT NULL AND f.outcome IS NULL ORDER BY f.submitted_at`)
        .all();
      res.json(
        rows.map((f) => {
          const p = kind.get(f[fk]);
          const answers = JSON.parse(f.answers || '{}');
          // Ce que ce compte ne peut pas lire ne sort pas — et ne sera pas reporté par lui
          const visible = Object.keys(answers).filter((k) => keys.has(k));
          return {
            ...formView(f),
            respondent: f.respondent,
            person: kind.row(p),
            answers: visible.map((k) => ({ key: k, value: answers[k], current: kind.current(p, k) })),
            hidden: Object.keys(answers).length - visible.length,
          };
        })
      );
    });

    // Reporte les champs choisis (éventuellement corrigés) sur la fiche
    app.post(`${route}/:id/apply`, ...guard, (req, res) => {
      const { f, p, error } = inScope(req);
      if (error) return res.status(error[0]).json({ error: error[1] });
      if (!f.submitted_at || f.outcome) return res.status(409).json({ error: 'not_pending' });
      const answers = JSON.parse(f.answers || '{}');
      const keys = new Set(kind.keysFor(req));
      const pick = Array.isArray(req.body?.fields) ? req.body.fields : [];
      const edits = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {};
      const values = {};
      for (const key of pick) {
        if (!Object.hasOwn(answers, key) || !keys.has(key)) continue;
        const v = cleanValue(FIELDS[key], Object.hasOwn(edits, key) ? edits[key] : answers[key]);
        if (v instanceof Error) return res.status(400).json({ error: 'invalid_value', field: key });
        if (v !== undefined) values[key] = v;
      }
      const applied = Object.keys(values);
      if (!applied.length) return res.status(400).json({ error: 'nothing_selected' });

      db.transaction(() => {
        kind.write(req, p, values);
        db.prepare(
          `UPDATE ${table} SET outcome = 'applied', applied = ?, reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?`
        ).run(JSON.stringify(applied), by(req), f.id);
      })();
      const updated = kind.get(p.id);
      const pickOf = (row) => Object.fromEntries(applied.map((k) => [k, row[k] ?? null]));
      auditEvent(req, 'update', kind.audit, p.id, pickOf(p), { ...pickOf(updated), via: `${kind.name}_form`, form_id: f.id });
      res.json({ applied });
    });

    app.post(`${route}/:id/reject`, ...guard, (req, res) => {
      const { f, error } = inScope(req);
      if (error) return res.status(error[0]).json({ error: error[1] });
      if (!f.submitted_at || f.outcome) return res.status(409).json({ error: 'not_pending' });
      db.prepare(`UPDATE ${table} SET outcome = 'rejected', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?`).run(
        by(req), f.id
      );
      auditEvent(req, 'reject', `${kind.name}_form`, f[fk], null, { form_id: f.id });
      res.status(204).end();
    });
  }

  // ---------- Demande d'inscription ----------
  // Un عنصر qu'on n'a pas encore : le قائد envoie un lien rattaché à une فرقة, la famille
  // remplit toute la fiche, et un قائد la relit, choisit la فرقة et l'inscrit — avec les
  // règles mêmes du formulaire «Nouveau membre» (doublons, طليعة par âge, قسم).

  const branchRow = (id) => db.prepare('SELECT id, name_ar, name_fr, section FROM branches WHERE id = ?').get(id);
  const signupById = db.prepare('SELECT * FROM member_signups WHERE id = ?');

  function signupPage(res, f) {
    const b = branchRow(f.branch_id);
    const base = {
      kind: 'signup',
      status: statusOf(f),
      lang: f.lang,
      person: { first_name: f.label || '', last_name: '', sex: sectionDef(b?.section)?.gender ?? null, branch_ar: b?.name_ar, branch_fr: b?.name_fr },
    };
    if (!isLive(f)) return res.json(base);
    if (!f.opened_at) db.prepare("UPDATE member_signups SET opened_at = datetime('now') WHERE id = ?").run(f.id);
    const fields = JSON.parse(f.fields).filter((k) => SIGNUP_FIELDS[k]);
    res.json({
      ...base,
      status: 'open',
      expires_at: f.expires_at,
      fields,
      missing: fields,
      values: {},
      required: fields.filter((k) => SIGNUP_FIELDS[k].required),
      blood_types: BLOOD_TYPES,
    });
  }

  function signupAnswer(req, res, f) {
    if (!isLive(f)) return res.status(409).json({ error: 'closed', status: statusOf(f) });
    const body = req.body || {};
    if (!RESPONDENTS.includes(body.respondent)) return res.status(400).json({ error: 'invalid_respondent' });
    const raw = body.answers && typeof body.answers === 'object' ? body.answers : {};
    const answers = {};
    const errors = {};
    for (const key of JSON.parse(f.fields)) {
      const def = SIGNUP_FIELDS[key];
      if (!def) continue;
      const v = cleanValue(def, raw[key]);
      if (v instanceof Error) errors[key] = v.message;
      else if (v !== undefined) answers[key] = v;
      else if (def.required) errors[key] = 'required';
    }
    if (Object.keys(errors).length) return res.status(400).json({ error: 'invalid_answers', fields: errors });
    const done = db
      .prepare(
        `UPDATE member_signups SET answers = ?, respondent = ?, submitted_at = datetime('now')
          WHERE id = ? AND submitted_at IS NULL AND revoked_at IS NULL`
      )
      .run(JSON.stringify(answers), body.respondent, f.id);
    if (!done.changes) return res.status(409).json({ error: 'closed' });
    notifications.memberFormSubmitted(
      { kind: 'signup', first_name: answers.first_name, father_name: answers.father_name, last_name: answers.last_name, branch_id: f.branch_id },
      { formId: f.id, count: Object.keys(answers).length }
    );
    res.json({ status: 'submitted' });
  }

  const signupGuard = [requirePerm('members.create'), requirePerm('members.contact')];
  const signupKeysFor = (req) =>
    Object.keys(SIGNUP_FIELDS).filter((k) => !SIGNUP_FIELDS[k].health || hasPerm(req, 'members.health'));
  const signupView = (f, opts) => ({
    ...formView(f, opts),
    branch_id: f.branch_id,
    label: f.label,
    phone: f.phone,
    member_id: f.member_id,
  });
  const signupInScope = (req) => {
    const f = signupById.get(intOr(req.params.id));
    if (!f) return { error: [404, 'not found'] };
    if (!branchOk(req, f.branch_id)) return { error: [403, 'forbidden'] };
    return { f };
  };

  // Les liens d'inscription de mes فرق : ceux encore ouverts, et ceux des 60 derniers jours
  app.get('/api/member-signups', ...signupGuard, (req, res) => {
    const rows = db
      .prepare(
        `SELECT f.* FROM member_signups f WHERE 1=1 ${branchFilterSQL(req, 'f.branch_id')}
           AND (f.submitted_at IS NULL OR f.outcome IS NULL OR f.created_at >= datetime('now', '-60 days'))
         ORDER BY f.created_at DESC`
      )
      .all();
    res.json(rows.map((f) => signupView(f, { withToken: true })));
  });

  app.post('/api/member-signups', ...signupGuard, (req, res) => {
    const b = req.body || {};
    const branch = branchRow(intOr(b.branch_id));
    if (!branch) return res.status(400).json({ error: 'invalid branch_id' });
    if (!branchOk(req, branch.id)) return res.status(403).json({ error: 'forbidden' });
    const phone = typeof b.phone === 'string' && b.phone.trim() ? b.phone.trim() : null;
    if (phone && (phone.length > 40 || !validPhone(phone))) return res.status(400).json({ error: 'invalid phone' });
    const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 80) : null;
    const lang = ['ar', 'fr'].includes(b.lang) ? b.lang : ['FR', 'FRF'].includes(branch.section) ? 'fr' : 'ar';
    const token = crypto.randomBytes(24).toString('base64url');
    const id = db
      .prepare(
        `INSERT INTO member_signups (branch_id, token, fields, lang, label, phone, created_by, created_by_id, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`
      )
      .run(branch.id, token, JSON.stringify(signupKeysFor(req)), lang, label, phone, by(req), req.user.id, `+${LINK_DAYS} days`)
      .lastInsertRowid;
    const f = signupById.get(id);
    auditEvent(req, 'create', 'member_signup', f.id, null, { branch_id: branch.id, label, phone });
    res.status(201).json(signupView(f, { withToken: true }));
  });

  app.post('/api/member-signups/:id/sent', ...signupGuard, (req, res) => {
    const { f, error } = signupInScope(req);
    if (error) return res.status(error[0]).json({ error: error[1] });
    if (!isLive(f)) return res.status(409).json({ error: 'not_live' });
    const lang = ['ar', 'fr'].includes(req.body?.lang) ? req.body.lang : f.lang;
    db.prepare("UPDATE member_signups SET sent_at = datetime('now'), lang = ? WHERE id = ?").run(lang, f.id);
    res.json(signupView(signupById.get(f.id), { withToken: true }));
  });

  app.post('/api/member-signups/:id/revoke', ...signupGuard, (req, res) => {
    const { f, error } = signupInScope(req);
    if (error) return res.status(error[0]).json({ error: error[1] });
    if (!isLive(f)) return res.status(409).json({ error: 'not_live' });
    db.prepare("UPDATE member_signups SET revoked_at = datetime('now') WHERE id = ?").run(f.id);
    auditEvent(req, 'revoke', 'member_signup', f.id, null, { branch_id: f.branch_id });
    res.json(signupView(signupById.get(f.id)));
  });

  // Les demandes reçues, avec les عناصر de même nom déjà inscrits dans le قسم (doublon ?)
  app.get('/api/member-signups/pending', ...signupGuard, (req, res) => {
    const keys = new Set(signupKeysFor(req));
    const rows = db
      .prepare(
        `SELECT f.* FROM member_signups f WHERE f.submitted_at IS NOT NULL AND f.outcome IS NULL
           ${branchFilterSQL(req, 'f.branch_id')} ORDER BY f.submitted_at`
      )
      .all();
    const sameName = db.prepare(
      `SELECT m.id, m.first_name, m.father_name, m.last_name, m.birth_date, m.branch_id, m.status
         FROM members m JOIN branches b ON b.id = m.branch_id
        WHERE lower(trim(m.first_name)) = lower(trim(?)) AND lower(trim(m.last_name)) = lower(trim(?)) AND b.section = ?
        LIMIT 5`
    );
    res.json(
      rows.map((f) => {
        const answers = JSON.parse(f.answers || '{}');
        const visible = Object.keys(answers).filter((k) => keys.has(k));
        return {
          ...signupView(f),
          respondent: f.respondent,
          answers: visible.map((k) => ({ key: k, value: answers[k], current: null })),
          hidden: Object.keys(answers).length - visible.length,
          duplicates: sameName
            .all(answers.first_name || '', answers.last_name || '', sectionOfBranch(f.branch_id))
            .filter((m) => branchOk(req, m.branch_id)),
        };
      })
    );
  });

  // Inscrit l'عنصر : les réponses (corrigées au besoin) dans la فرقة choisie
  app.post('/api/member-signups/:id/apply', ...signupGuard, (req, res) => {
    const { f, error } = signupInScope(req);
    if (error) return res.status(error[0]).json({ error: error[1] });
    if (!f.submitted_at || f.outcome) return res.status(409).json({ error: 'not_pending' });
    const branchId = req.body?.branch_id === undefined ? f.branch_id : intOr(req.body.branch_id);
    const branch = branchRow(branchId);
    if (!branch) return res.status(400).json({ error: 'invalid branch_id' });
    if (!branchOk(req, branch.id)) return res.status(403).json({ error: 'forbidden' });
    const answers = JSON.parse(f.answers || '{}');
    const keys = new Set(signupKeysFor(req));
    const edits = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {};
    const values = {};
    for (const key of Object.keys(SIGNUP_FIELDS)) {
      if (!keys.has(key)) continue;
      if (!Object.hasOwn(answers, key) && !Object.hasOwn(edits, key)) continue;
      const v = cleanValue(SIGNUP_FIELDS[key], Object.hasOwn(edits, key) ? edits[key] : answers[key]);
      if (v instanceof Error) return res.status(400).json({ error: 'invalid_value', field: key });
      if (v !== undefined) values[key] = v;
      else if (SIGNUP_FIELDS[key].required) return res.status(400).json({ error: 'invalid_value', field: key });
    }
    // Un قسم d'un seul sexe n'accueille pas l'autre
    const gender = sectionDef(branch.section)?.gender;
    if (gender && values.sex !== gender) return res.status(400).json({ error: 'sex_outside_section' });

    const body = Object.fromEntries(SIGNUP_MEMBER_COLUMNS.filter((k) => k in values).map((k) => [k, values[k]]));
    let result;
    db.transaction(() => {
      result = createMember(req, {
        ...body,
        branch_id: branch.id,
        group_id: ageGroupIdFor(values.birth_date, branch.id),
        join_date: todayISO(),
        status: 'active',
      });
      if (!result.created) return;
      const health = HEALTH_KEYS.filter((k) => k in values);
      if (health.length) {
        const params = { id: result.created.id, by: by(req) };
        for (const k of health) params[k] = k === 'can_swim' ? (values[k] ? 1 : 0) : values[k];
        db.prepare(
          `UPDATE members SET ${health.map((k) => `${k} = @${k}`).join(', ')}, health_updated_at = datetime('now'), health_updated_by = @by WHERE id = @id`
        ).run(params);
      }
      db.prepare(
        `UPDATE member_signups SET outcome = 'applied', member_id = ?, branch_id = ?, reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?`
      ).run(result.created.id, branch.id, by(req), f.id);
    })();
    const { created, status, ...err } = result;
    if (!created) return res.status(status).json(err);
    res.status(201).json({ member_id: created.id });
  });

  app.post('/api/member-signups/:id/reject', ...signupGuard, (req, res) => {
    const { f, error } = signupInScope(req);
    if (error) return res.status(error[0]).json({ error: error[1] });
    if (!f.submitted_at || f.outcome) return res.status(409).json({ error: 'not_pending' });
    db.prepare(`UPDATE member_signups SET outcome = 'rejected', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?`).run(by(req), f.id);
    auditEvent(req, 'reject', 'member_signup', f.id, null, { branch_id: f.branch_id });
    res.status(204).end();
  });
};

module.exports.MEMBER_FIELDS = MEMBER_FIELDS;
module.exports.LEADER_FIELDS = LEADER_FIELDS;
module.exports.SIGNUP_FIELDS = SIGNUP_FIELDS;
