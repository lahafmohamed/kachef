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
// Inscription d'un قائد (2026-10-30) : il remplit lui-même toute sa fiche. Nom, prénom, date
// de naissance et téléphone sont exigés — c'est par ce numéro que la قيادة le joint.
const LEADER_SIGNUP_FIELDS = {
  first_name: { kind: 'text', max: 80, required: true },
  father_name: { kind: 'text', max: 80 },
  last_name: { kind: 'text', max: 80, required: true },
  birth_date: { kind: 'date', required: true },
  phone: { kind: 'phone', required: true },
  ...Object.fromEntries(Object.entries(LEADER_FIELDS).filter(([k]) => !['birth_date', 'father_name', 'phone'].includes(k))),
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
    notifications, validISODate, validPhone, BLOOD_TYPES, todayISO, intOr, createMember, createLeader, ageGroupIdFor,
    sectionDef, sectionOfBranch,
  } = deps;

  const formColumns = (fk, ref) => `
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${ref ? `${fk} INTEGER NOT NULL REFERENCES ${ref}(id) ON DELETE CASCADE` : `${fk} TEXT NOT NULL`},
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
    -- Lien d'inscription permanent : un seul lien pour toute une فرقة (posté dans le groupe
    -- WhatsApp des parents) ; chaque envoi y crée sa propre demande dans member_signups.
    -- Désactivable et réactivable à volonté.
    CREATE TABLE IF NOT EXISTS signup_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      label TEXT,
      fields TEXT NOT NULL,
      lang TEXT NOT NULL DEFAULT 'ar',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      created_by_id INTEGER,
      toggled_at TEXT,
      toggled_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_signup_links_branch ON signup_links(branch_id);
    -- Les mêmes pour un nouveau قائد, rattaché à un قسم ; leader_id = le قائد créé
    CREATE TABLE IF NOT EXISTS leader_signup_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      label TEXT,
      fields TEXT NOT NULL,
      lang TEXT NOT NULL DEFAULT 'ar',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      created_by_id INTEGER,
      toggled_at TEXT,
      toggled_by TEXT
    );
    CREATE TABLE IF NOT EXISTS leader_signups (
      ${formColumns('section', null)},
      label TEXT,
      phone TEXT,
      leader_id INTEGER REFERENCES leaders(id) ON DELETE SET NULL,
      link_id INTEGER REFERENCES leader_signup_links(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_leader_signups_section ON leader_signups(section, created_at);
  `);
  // La demande venue d'un lien permanent garde la trace de ce lien
  if (!db.prepare('PRAGMA table_info(member_signups)').all().some((c) => c.name === 'link_id'))
    db.exec('ALTER TABLE member_signups ADD COLUMN link_id INTEGER REFERENCES signup_links(id) ON DELETE SET NULL');

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

  // { kind, f } pour une fiche, { signup, f } pour une demande, { shared, f } pour un lien
  // permanent — le jeton cherché dans chaque table
  function byToken(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    for (const kind of KINDS) {
      const f = db.prepare(`SELECT * FROM ${kind.table} WHERE token = ?`).get(token);
      if (f) return { kind, f };
    }
    for (const sk of SIGNUP_KINDS) {
      const f = db.prepare(`SELECT * FROM ${sk.table} WHERE token = ?`).get(token);
      if (f) return { signup: sk, f };
      const l = db.prepare(`SELECT * FROM ${sk.linkTable} WHERE token = ?`).get(token);
      if (l) return { shared: sk, f: l };
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
    if (hit.signup) return hit.signup.page(res, hit.f);
    if (hit.shared) return hit.shared.sharedPage(res, hit.f);
    const { kind, f } = hit;
    const p = kind.get(f[kind.fk]);
    if (!p) return res.status(404).json({ error: 'not_found' });
    const base = {
      kind: kind.name,
      status: statusOf(f),
      lang: f.lang,
      // Prénom, nom et identifiant seulement : on sait de qui il s'agit, rien d'autre ne sort
      person: {
        first_name: p.first_name,
        last_name: p.last_name,
        code: p.code ?? null,
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
    if (hit.signup) return hit.signup.answer(req, res, hit.f);
    if (hit.shared) return hit.shared.sharedAnswer(req, res, hit.f);
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

  // Un lien posté dans un groupe peut circuler : au plus SHARED_MAX demandes par adresse et
  // par heure, en plus de la limite générale de la page
  const SHARED_WINDOW_MS = 60 * 60 * 1000;
  const SHARED_MAX = 10;
  const sharedHits = new Map();
  function sharedThrottled(req, linkKey) {
    const key = `${linkKey}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const now = Date.now();
    const row = sharedHits.get(key);
    if (!row || now - row.startedAt > SHARED_WINDOW_MS) {
      sharedHits.set(key, { count: 1, startedAt: now });
      if (sharedHits.size > 5000) for (const [k, v] of sharedHits) if (now - v.startedAt > SHARED_WINDOW_MS) sharedHits.delete(k);
      return false;
    }
    row.count += 1;
    return row.count > SHARED_MAX;
  }

  // ---------- Demandes d'inscription ----------
  // Quelqu'un qu'on n'a pas encore. Un عنصر : le قائد envoie un lien rattaché à une فرقة, la
  // famille remplit toute la fiche, un قائد la relit, choisit la فرقة et l'inscrit — avec
  // les règles mêmes du formulaire «Nouveau membre» (doublons, طليعة par âge, قسم). Un قائد
  // (2026-10-30) : le lien est rattaché à un قسم, il remplit lui-même sa fiche, l'admin la
  // relit et l'ajoute aux قادة. Lien personnel (une réponse) ou lien permanent (posté dans
  // un groupe WhatsApp, chaque envoi devient sa propre demande, désactivable à volonté).
  // Les deux sortes ne diffèrent que par ce qui suit ; tout le reste est le même code.

  const branchRow = (id) => db.prepare('SELECT id, name_ar, name_fr, section FROM branches WHERE id = ?').get(id);
  const langFor = (section) => (['FR', 'FRF'].includes(section) ? 'fr' : 'ar');

  const SIGNUP_KINDS = [
    {
      name: 'signup',
      table: 'member_signups',
      linkTable: 'signup_links',
      // La colonne qui rattache la demande : une فرقة
      scope: 'branch_id',
      FIELDS: SIGNUP_FIELDS,
      route: '/api/member-signups',
      linkRoute: '/api/signup-links',
      audit: 'member_signup',
      guard: [requirePerm('members.create'), requirePerm('members.contact')],
      keysFor: (req) => Object.keys(SIGNUP_FIELDS).filter((k) => !SIGNUP_FIELDS[k].health || hasPerm(req, 'members.health')),
      // { value, section } pour le rattachement demandé, ou null
      parseScope: (raw) => {
        const b = branchRow(intOr(raw));
        return b ? { value: b.id, section: b.section } : null;
      },
      sectionOf: (value) => branchRow(value)?.section ?? null,
      inScope: (req, value) => branchOk(req, value),
      filterSQL: (req, col) => branchFilterSQL(req, col),
      person: (value) => {
        const b = branchRow(value);
        return { sex: sectionDef(b?.section)?.gender ?? null, branch_ar: b?.name_ar, branch_fr: b?.name_fr };
      },
      phoneOf: (a) => a.father_phone || a.mother_phone || a.member_phone || null,
      // Les عناصر de même nom déjà inscrits dans le قسم (doublon ?)
      duplicates: (req, answers, f) =>
        db
          .prepare(
            `SELECT m.id, m.first_name, m.father_name, m.last_name, m.birth_date, m.branch_id, m.status
               FROM members m JOIN branches b ON b.id = m.branch_id
              WHERE lower(trim(m.first_name)) = lower(trim(?)) AND lower(trim(m.last_name)) = lower(trim(?)) AND b.section = ?
              LIMIT 5`
          )
          .all(answers.first_name || '', answers.last_name || '', sectionOfBranch(f.branch_id))
          .filter((m) => branchOk(req, m.branch_id)),
      // Inscrit l'عنصر dans la فرقة choisie : { id } ou { status, error }
      create(req, scope, values) {
        // Un قسم d'un seul sexe n'accueille pas l'autre
        const gender = sectionDef(scope.section)?.gender;
        if (gender && values.sex !== gender) return { status: 400, error: 'sex_outside_section' };
        const body = Object.fromEntries(SIGNUP_MEMBER_COLUMNS.filter((k) => k in values).map((k) => [k, values[k]]));
        const result = createMember(req, {
          ...body,
          branch_id: scope.value,
          group_id: ageGroupIdFor(values.birth_date, scope.value),
          join_date: todayISO(),
          status: 'active',
        });
        if (!result.created) return result;
        const health = HEALTH_KEYS.filter((k) => k in values);
        if (health.length) {
          const params = { id: result.created.id, by: by(req) };
          for (const k of health) params[k] = k === 'can_swim' ? (values[k] ? 1 : 0) : values[k];
          db.prepare(
            `UPDATE members SET ${health.map((k) => `${k} = @${k}`).join(', ')}, health_updated_at = datetime('now'), health_updated_by = @by WHERE id = @id`
          ).run(params);
        }
        return { id: result.created.id };
      },
      createdKey: 'member_id',
      notify: (answers, f, id) =>
        notifications.memberFormSubmitted(
          { kind: 'signup', first_name: answers.first_name, father_name: answers.father_name, last_name: answers.last_name, branch_id: f.branch_id },
          { formId: id, count: Object.keys(answers).length }
        ),
    },
    {
      name: 'leader_signup',
      table: 'leader_signups',
      linkTable: 'leader_signup_links',
      // Un قائد n'a pas de فرقة : son قسم
      scope: 'section',
      FIELDS: LEADER_SIGNUP_FIELDS,
      route: '/api/leader-signups',
      linkRoute: '/api/leader-signup-links',
      audit: 'leader_signup',
      // Le dossier des قادة est à l'admin seul
      guard: [requireAdmin],
      keysFor: () => Object.keys(LEADER_SIGNUP_FIELDS),
      parseScope: (raw) => (sectionDef(raw) ? { value: raw, section: raw } : null),
      sectionOf: (value) => value,
      inScope: (req, value) => leaderOk(req, { section: value }),
      filterSQL: (req, col) => leaderScopeSQL(req, col.split('.')[0]),
      person: (value) => ({ sex: sectionDef(value)?.gender ?? null, section: value }),
      phoneOf: (a) => a.phone || null,
      duplicates: (req, answers) =>
        db
          .prepare(
            `SELECT id, first_name, father_name, last_name, birth_date, section, status FROM leaders
              WHERE lower(trim(first_name)) = lower(trim(?)) AND lower(trim(last_name)) = lower(trim(?))
              LIMIT 5`
          )
          .all(answers.first_name || '', answers.last_name || '')
          .filter((l) => leaderOk(req, l)),
      create(req, scope, values) {
        const result = createLeader(req, values, scope.value);
        return result.created ? { id: result.created.id } : result;
      },
      createdKey: 'leader_id',
      notify: (answers, f, id) =>
        notifications.memberFormSubmitted(
          { kind: 'leader_signup', first_name: answers.first_name, father_name: answers.father_name, last_name: answers.last_name, section: f.section },
          { formId: id, count: Object.keys(answers).length }
        ),
    },
  ];

  for (const sk of SIGNUP_KINDS) {
    const { table, linkTable, scope, FIELDS, route, linkRoute, guard, audit } = sk;
    const signupById = db.prepare(`SELECT * FROM ${table} WHERE id = ?`);
    const linkById = db.prepare(`SELECT * FROM ${linkTable} WHERE id = ?`);
    // Un قائد répond pour lui-même
    const respondentOf = (body) => (sk.name === 'leader_signup' ? 'self' : body.respondent);

    // Les réponses d'une demande, nettoyées : { answers } ou { errors }
    function signupAnswers(fields, raw) {
      const answers = {};
      const errors = {};
      for (const key of fields) {
        const def = FIELDS[key];
        if (!def) continue;
        const v = cleanValue(def, raw[key]);
        if (v instanceof Error) errors[key] = v.message;
        else if (v !== undefined) answers[key] = v;
        else if (def.required) errors[key] = 'required';
      }
      return Object.keys(errors).length ? { errors } : { answers };
    }

    const pageBase = (f) => ({
      kind: sk.name,
      lang: f.lang,
      person: { first_name: '', last_name: '', ...sk.person(f[scope]) },
    });
    const openPage = (fields) => ({
      status: 'open',
      fields,
      missing: fields,
      values: {},
      required: fields.filter((k) => FIELDS[k].required),
      blood_types: BLOOD_TYPES,
    });

    sk.page = (res, f) => {
      const base = { ...pageBase(f), status: statusOf(f) };
      base.person.first_name = f.label || '';
      if (!isLive(f)) return res.json(base);
      if (!f.opened_at) db.prepare(`UPDATE ${table} SET opened_at = datetime('now') WHERE id = ?`).run(f.id);
      res.json({ ...base, ...openPage(JSON.parse(f.fields).filter((k) => FIELDS[k])), expires_at: f.expires_at });
    };

    sk.answer = (req, res, f) => {
      if (!isLive(f)) return res.status(409).json({ error: 'closed', status: statusOf(f) });
      const body = req.body || {};
      const respondent = respondentOf(body);
      if (!RESPONDENTS.includes(respondent)) return res.status(400).json({ error: 'invalid_respondent' });
      const raw = body.answers && typeof body.answers === 'object' ? body.answers : {};
      const { answers, errors } = signupAnswers(JSON.parse(f.fields), raw);
      if (errors) return res.status(400).json({ error: 'invalid_answers', fields: errors });
      const done = db
        .prepare(
          `UPDATE ${table} SET answers = ?, respondent = ?, submitted_at = datetime('now')
            WHERE id = ? AND submitted_at IS NULL AND revoked_at IS NULL`
        )
        .run(JSON.stringify(answers), respondent, f.id);
      if (!done.changes) return res.status(409).json({ error: 'closed' });
      sk.notify(answers, f, f.id);
      res.json({ status: 'submitted' });
    };

    // ----- Lien permanent -----

    sk.sharedPage = (res, l) => {
      const base = { ...pageBase(l), shared: true };
      if (!l.active) return res.json({ ...base, status: 'disabled' });
      res.json({ ...base, ...openPage(JSON.parse(l.fields).filter((k) => FIELDS[k])) });
    };

    // Chaque envoi devient une demande à part, comme si un lien personnel y avait conduit
    sk.sharedAnswer = (req, res, l) => {
      if (!l.active) return res.status(409).json({ error: 'closed', status: 'disabled' });
      const body = req.body || {};
      const respondent = respondentOf(body);
      if (!RESPONDENTS.includes(respondent)) return res.status(400).json({ error: 'invalid_respondent' });
      const raw = body.answers && typeof body.answers === 'object' ? body.answers : {};
      const { answers, errors } = signupAnswers(JSON.parse(l.fields), raw);
      if (errors) return res.status(400).json({ error: 'invalid_answers', fields: errors });
      if (sharedThrottled(req, `${linkTable}:${l.id}`)) {
        res.setHeader('Retry-After', String(SHARED_WINDOW_MS / 1000));
        return res.status(429).json({ error: 'too_many_requests' });
      }
      const label = [answers.first_name, answers.last_name].filter(Boolean).join(' ').slice(0, 80);
      const id = db
        .prepare(
          `INSERT INTO ${table} (${scope}, link_id, token, fields, lang, label, phone, created_by, created_by_id,
             expires_at, answers, respondent, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, datetime('now'))`
        )
        .run(l[scope], l.id, crypto.randomBytes(24).toString('base64url'), l.fields, l.lang, label, sk.phoneOf(answers),
          l.created_by, l.created_by_id, JSON.stringify(answers), respondent).lastInsertRowid;
      sk.notify(answers, l, id);
      res.json({ status: 'submitted' });
    };

    const linkView = (l) => {
      const n = db
        .prepare(
          `SELECT COUNT(*) AS total, SUM(outcome IS NULL) AS pending, SUM(outcome = 'applied') AS registered
             FROM ${table} WHERE link_id = ?`
        )
        .get(l.id);
      return {
        id: l.id,
        [scope]: l[scope],
        token: l.token,
        label: l.label,
        lang: l.lang,
        active: !!l.active,
        created_at: l.created_at,
        created_by: l.created_by,
        toggled_at: l.toggled_at,
        toggled_by: l.toggled_by,
        requests: n.total || 0,
        pending: n.pending || 0,
        registered: n.registered || 0,
      };
    };

    app.get(linkRoute, ...guard, (req, res) => {
      const rows = db
        .prepare(`SELECT * FROM ${linkTable} f WHERE 1=1 ${sk.filterSQL(req, `f.${scope}`)} ORDER BY active DESC, created_at DESC`)
        .all();
      res.json(rows.map(linkView));
    });

    app.post(linkRoute, ...guard, (req, res) => {
      const b = req.body || {};
      const at = sk.parseScope(b[scope]);
      if (!at) return res.status(400).json({ error: `invalid ${scope}` });
      if (!sk.inScope(req, at.value)) return res.status(403).json({ error: 'forbidden' });
      const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 80) : null;
      const lang = ['ar', 'fr'].includes(b.lang) ? b.lang : langFor(at.section);
      const id = db
        .prepare(`INSERT INTO ${linkTable} (${scope}, token, label, fields, lang, created_by, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(at.value, crypto.randomBytes(24).toString('base64url'), label, JSON.stringify(sk.keysFor(req)), lang, by(req), req.user.id)
        .lastInsertRowid;
      auditEvent(req, 'create', `${audit === 'member_signup' ? 'signup' : audit}_link`, id, null, { [scope]: at.value, label });
      res.status(201).json(linkView(linkById.get(id)));
    });

    // Activer / désactiver, renommer, changer la langue
    app.put(`${linkRoute}/:id`, ...guard, (req, res) => {
      const l = linkById.get(intOr(req.params.id));
      if (!l) return res.status(404).json({ error: 'not found' });
      if (!sk.inScope(req, l[scope])) return res.status(403).json({ error: 'forbidden' });
      const b = req.body || {};
      if (b.active !== undefined && typeof b.active !== 'boolean') return res.status(400).json({ error: 'invalid active' });
      const active = b.active === undefined ? l.active : b.active ? 1 : 0;
      const label = b.label === undefined ? l.label : typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 80) : null;
      const lang = ['ar', 'fr'].includes(b.lang) ? b.lang : l.lang;
      const toggled = active !== l.active;
      db.prepare(
        `UPDATE ${linkTable} SET active = ?, label = ?, lang = ?,
           toggled_at = CASE WHEN ? THEN datetime('now') ELSE toggled_at END,
           toggled_by = CASE WHEN ? THEN ? ELSE toggled_by END
         WHERE id = ?`
      ).run(active, label, lang, toggled ? 1 : 0, toggled ? 1 : 0, by(req), l.id);
      if (toggled)
        auditEvent(req, active ? 'enable' : 'disable', `${audit === 'member_signup' ? 'signup' : audit}_link`, l.id, null, { [scope]: l[scope] });
      res.json(linkView(linkById.get(l.id)));
    });

    // ----- Lien personnel et relecture -----

    const signupView = (f, opts) => ({
      ...formView(f, opts),
      link_id: f.link_id ?? null,
      [scope]: f[scope],
      label: f.label,
      phone: f.phone,
      [sk.createdKey]: f[sk.createdKey],
    });
    const signupInScope = (req) => {
      const f = signupById.get(intOr(req.params.id));
      if (!f) return { error: [404, 'not found'] };
      if (!sk.inScope(req, f[scope])) return { error: [403, 'forbidden'] };
      return { f };
    };

    // Les liens d'inscription de mon périmètre : ceux encore ouverts, et ceux des 60 derniers jours
    app.get(route, ...guard, (req, res) => {
      const rows = db
        .prepare(
          `SELECT f.* FROM ${table} f WHERE 1=1 ${sk.filterSQL(req, `f.${scope}`)}
             AND (f.submitted_at IS NULL OR f.outcome IS NULL OR f.created_at >= datetime('now', '-60 days'))
           ORDER BY f.created_at DESC`
        )
        .all();
      res.json(rows.map((f) => signupView(f, { withToken: true })));
    });

    app.post(route, ...guard, (req, res) => {
      const b = req.body || {};
      const at = sk.parseScope(b[scope]);
      if (!at) return res.status(400).json({ error: `invalid ${scope}` });
      if (!sk.inScope(req, at.value)) return res.status(403).json({ error: 'forbidden' });
      const phone = typeof b.phone === 'string' && b.phone.trim() ? b.phone.trim() : null;
      if (phone && (phone.length > 40 || !validPhone(phone))) return res.status(400).json({ error: 'invalid phone' });
      const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 80) : null;
      const lang = ['ar', 'fr'].includes(b.lang) ? b.lang : langFor(at.section);
      const id = db
        .prepare(
          `INSERT INTO ${table} (${scope}, token, fields, lang, label, phone, created_by, created_by_id, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`
        )
        .run(at.value, crypto.randomBytes(24).toString('base64url'), JSON.stringify(sk.keysFor(req)), lang, label, phone, by(req),
          req.user.id, `+${LINK_DAYS} days`)
        .lastInsertRowid;
      const f = signupById.get(id);
      auditEvent(req, 'create', audit, f.id, null, { [scope]: at.value, label, phone });
      res.status(201).json(signupView(f, { withToken: true }));
    });

    app.post(`${route}/:id/sent`, ...guard, (req, res) => {
      const { f, error } = signupInScope(req);
      if (error) return res.status(error[0]).json({ error: error[1] });
      if (!isLive(f)) return res.status(409).json({ error: 'not_live' });
      const lang = ['ar', 'fr'].includes(req.body?.lang) ? req.body.lang : f.lang;
      db.prepare(`UPDATE ${table} SET sent_at = datetime('now'), lang = ? WHERE id = ?`).run(lang, f.id);
      res.json(signupView(signupById.get(f.id), { withToken: true }));
    });

    app.post(`${route}/:id/revoke`, ...guard, (req, res) => {
      const { f, error } = signupInScope(req);
      if (error) return res.status(error[0]).json({ error: error[1] });
      if (!isLive(f)) return res.status(409).json({ error: 'not_live' });
      db.prepare(`UPDATE ${table} SET revoked_at = datetime('now') WHERE id = ?`).run(f.id);
      auditEvent(req, 'revoke', audit, f.id, null, { [scope]: f[scope] });
      res.json(signupView(signupById.get(f.id)));
    });

    // Les demandes reçues, avec les doublons possibles
    app.get(`${route}/pending`, ...guard, (req, res) => {
      const keys = new Set(sk.keysFor(req));
      const rows = db
        .prepare(
          `SELECT f.* FROM ${table} f WHERE f.submitted_at IS NOT NULL AND f.outcome IS NULL
             ${sk.filterSQL(req, `f.${scope}`)} ORDER BY f.submitted_at`
        )
        .all();
      res.json(
        rows.map((f) => {
          const answers = JSON.parse(f.answers || '{}');
          const visible = Object.keys(answers).filter((k) => keys.has(k));
          return {
            ...signupView(f),
            respondent: f.respondent,
            answers: visible.map((k) => ({ key: k, value: answers[k], current: null })),
            hidden: Object.keys(answers).length - visible.length,
            duplicates: sk.duplicates(req, answers, f),
          };
        })
      );
    });

    // Inscrit la personne : les réponses (corrigées au besoin), là où on l'a rattachée
    app.post(`${route}/:id/apply`, ...guard, (req, res) => {
      const { f, error } = signupInScope(req);
      if (error) return res.status(error[0]).json({ error: error[1] });
      if (!f.submitted_at || f.outcome) return res.status(409).json({ error: 'not_pending' });
      const at = sk.parseScope(req.body?.[scope] === undefined ? f[scope] : req.body[scope]);
      if (!at) return res.status(400).json({ error: `invalid ${scope}` });
      if (!sk.inScope(req, at.value)) return res.status(403).json({ error: 'forbidden' });
      const answers = JSON.parse(f.answers || '{}');
      const keys = new Set(sk.keysFor(req));
      const edits = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {};
      const values = {};
      for (const key of Object.keys(FIELDS)) {
        if (!keys.has(key)) continue;
        if (!Object.hasOwn(answers, key) && !Object.hasOwn(edits, key)) continue;
        const v = cleanValue(FIELDS[key], Object.hasOwn(edits, key) ? edits[key] : answers[key]);
        if (v instanceof Error) return res.status(400).json({ error: 'invalid_value', field: key });
        if (v !== undefined) values[key] = v;
        else if (FIELDS[key].required) return res.status(400).json({ error: 'invalid_value', field: key });
      }
      let result;
      db.transaction(() => {
        result = sk.create(req, at, values);
        if (!result.id) return;
        db.prepare(
          `UPDATE ${table} SET outcome = 'applied', ${sk.createdKey} = ?, ${scope} = ?, reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?`
        ).run(result.id, at.value, by(req), f.id);
      })();
      const { id, status, ...err } = result;
      if (!id) return res.status(status).json(err);
      res.status(201).json({ [sk.createdKey]: id });
    });

    app.post(`${route}/:id/reject`, ...guard, (req, res) => {
      const { f, error } = signupInScope(req);
      if (error) return res.status(error[0]).json({ error: error[1] });
      if (!f.submitted_at || f.outcome) return res.status(409).json({ error: 'not_pending' });
      db.prepare(`UPDATE ${table} SET outcome = 'rejected', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?`).run(by(req), f.id);
      auditEvent(req, 'reject', audit, f.id, null, { [scope]: f[scope] });
      res.status(204).end();
    });
  }
};

module.exports.MEMBER_FIELDS = MEMBER_FIELDS;
module.exports.LEADER_FIELDS = LEADER_FIELDS;
module.exports.SIGNUP_FIELDS = SIGNUP_FIELDS;
module.exports.LEADER_SIGNUP_FIELDS = LEADER_SIGNUP_FIELDS;
