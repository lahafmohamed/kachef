// ---------- الإشعارات ----------
// A notification reaches an account two ways: its inbox (the bell, inside the app) and
// Web Push on every device where it said yes, so a قائد hears about a new نشاط of his
// فرقة with the app closed. Who hears what is decided here, from the account itself —
// its فرق (users.branches), its قسم, its permissions, its own choices — so whatever
// hides a فرقة or a قسم on screen hides its notifications too.
//
// Texts are written here once, in both languages: the push leaves in the language its
// device shows, the bell reads in the reader's. Nothing waits on the push services: a
// request writes the inbox rows and answers, the pushes go out after it.

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { db, sectionDef } = require('./db');

const LANGS = ['ar', 'fr'];
// Per account: the bell is a recent log, not an archive
const INBOX_MAX = 100;
const LIST_LIMIT = 50;
// 8 pm in Abidjan (GMT all year): the Saturday نشاط is long over, the evening still young
const REMINDER_HOUR = Number(process.env.NOTIFY_REMINDER_HOUR ?? 20);
// Birthdays are news of the morning
const BIRTHDAY_HOUR = Number(process.env.NOTIFY_BIRTHDAY_HOUR ?? 7);
// A قائد's own monthly اشتراك, once a month, a few days in
const DUES_REMINDER_DAY = Number(process.env.NOTIFY_DUES_DAY ?? 5);
const DUES_REMINDER_HOUR = 10;
const DUES_START = '2026-01';
// بطاقة التحضير of the next planned نشاط, this many days before it
const PREP_DAYS_AHEAD = 2;
const REMINDER_EVERY_MS = 10 * 60 * 1000;
const DAY_S = 24 * 60 * 60;
const DEVICES_MAX = 10;

// What an account can be told, and whether it hears it before choosing anything.
// `group`: where the settings list it. `perm`: a type never reaches an account that could
// not open what it points to — one key, several (any of them), or null (every account).
// `leader`: personal to a قائد — only for accounts tied to their قائد file.
const TYPES = {
  // ----- الأنشطة -----
  session_created: { group: 'sessions', perm: 'sessions.read', on: () => true },
  session_changed: { group: 'sessions', perm: 'sessions.read', on: () => true },
  session_cancelled: { group: 'sessions', perm: 'sessions.read', on: () => true },
  session_animator: { group: 'sessions', perm: 'sessions.read', leader: true, on: () => true },
  // The قادة of the فرقة are the ones who mark it: on for an account tied to فرق, off
  // for the admin and the accounts that see every فرقة, who would get one per فرقة.
  attendance_missing: { group: 'sessions', perm: 'sessions.attendance', on: (u) => ownBranches(u) !== null },
  // Same reasoning: the بطاقة is written by the فرقة's قادة
  prep_missing: { group: 'sessions', perm: 'prep.manage', on: (u) => ownBranches(u) !== null },
  // ----- المخيمات و الدورات -----
  event_created: { group: 'events', perm: 'events.read', on: () => true },
  event_changed: { group: 'events', perm: 'events.read', on: () => true },
  event_role: { group: 'events', perm: 'events.read', leader: true, on: () => true },
  event_reminder: { group: 'events', perm: 'events.read', leader: true, on: () => true },
  // ----- الاجتماعات -----
  meeting_created: { group: 'meetings', perm: 'meetings.read', on: () => true },
  decision_assigned: { group: 'meetings', perm: 'meetings.read', leader: true, on: () => true },
  decision_due: { group: 'meetings', perm: 'meetings.read', leader: true, on: () => true },
  // ----- التقييم -----
  evaluation_pending: { group: 'evaluations', perm: ['sessions.read', 'events.read'], leader: true, on: () => true },
  // Quiet until asked for: a نشاط of twelve قادة would ring twelve times
  evaluation_received: { group: 'evaluations', perm: 'evaluations.read', leader: true, on: () => false },
  // ----- العناصر و القادة -----
  birthday: { group: 'people', perm: ['members.read', 'leaders.read'], on: (u) => ownBranches(u) !== null },
  member_created: { group: 'people', perm: 'members.read', on: () => false },
  // ----- المال -----
  treasury_entry: { group: 'money', perm: 'treasury.read', on: () => false },
  leader_dues: { group: 'money', perm: null, leader: true, on: () => false },
};

// ---------- VAPID ----------
// The key pair that signs every push. A push service only delivers to a subscription
// made with the same public key. Environment first, else a file beside the database,
// created on the first boot — never inside the database: a copy of the VPS base on a
// laptop must not be able to reach the قادة's phones.
function loadVapidKeys() {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = process.env;
  if (publicKey && privateKey) return { publicKey, privateKey };
  const file = process.env.VAPID_FILE || path.join(path.dirname(path.resolve(db.name)), 'vapid.json');
  try {
    const keys = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (keys.publicKey && keys.privateKey) return { publicKey: keys.publicKey, privateKey: keys.privateKey };
    throw new Error('incomplete key file');
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // Replacing a damaged file would silently cut every subscribed device: say it, run without push
      console.error(`push disabled — cannot read ${file}: ${e.message}`);
      return null;
    }
  }
  try {
    const keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(file, JSON.stringify(keys, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return keys;
  } catch (e) {
    console.error(`push disabled — cannot write ${file}: ${e.message}`);
    return null;
  }
}

const vapid = loadVapidKeys();
if (vapid) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://kachef.nolyxci.com', vapid.publicKey, vapid.privateKey);

// ---------- Who ----------

const activeUsers = db.prepare(
  'SELECT id, username, display_name, role, branches, perms, section, leader_id FROM users WHERE active = 1'
);

// null = every فرقة: the admin, or an account with no فرقة restriction. Reads a users
// row (JSON text) as well as req.user (already parsed).
function ownBranches(u) {
  if (u.role === 'admin' || u.branches === null || u.branches === undefined) return null;
  if (Array.isArray(u.branches)) return u.branches.map(Number);
  try {
    const ids = JSON.parse(u.branches);
    return Array.isArray(ids) ? ids.map(Number) : null;
  } catch {
    return [];
  }
}

const seesSection = (u, section) => u.role === 'admin' || !u.section || u.section === section;

const prefRow = db.prepare('SELECT enabled FROM notification_prefs WHERE user_id = ? AND type = ?');
function wants(u, type) {
  const row = prefRow.get(u.id, type);
  return row ? !!row.enabled : TYPES[type].on(u);
}

module.exports = function setupNotifications(app, { canUser, nextPlanned }) {
  const allowedBy = (u, perm) =>
    perm === null || (Array.isArray(perm) ? perm.some((p) => canUser(u, p)) : canUser(u, perm));
  // Types this account can receive at all — the settings list shows only these
  const typesFor = (u) =>
    Object.keys(TYPES).filter((type) => allowedBy(u, TYPES[type].perm) && (!TYPES[type].leader || u.leader_id));

  // One account, about something of `section`: may it hear this type, and does it want to?
  // `perm`: the right the thing itself needs, when the type covers several modules.
  const hears = (u, type, section, perm = null) =>
    seesSection(u, section) && typesFor(u).includes(type) && wants(u, type) && (!perm || canUser(u, perm));

  const usersOfLeaders = (leaderIds) => {
    const ids = [...new Set(leaderIds.filter(Boolean).map(Number))];
    return ids.length
      ? db
          .prepare(
            `SELECT id, username, display_name, role, branches, perms, section, leader_id FROM users
             WHERE active = 1 AND leader_id IN (${ids.map(() => '?').join(',')})`
          )
          .all(...ids)
      : [];
  };

  /**
   * The accounts that follow something of `section` touching `branchIds`: accounts tied
   * to one of those فرق, plus every account that sees the whole قسم. No فرق = something
   * of the whole قسم (نشاط قادة، نشاط فوجي، مخيم الفوج), which everyone in it follows.
   */
  function audience({ section, branchIds = [], type, except = null }) {
    return activeUsers.all().filter((u) => {
      if (u.id === except || !seesSection(u, section)) return false;
      if (!typesFor(u).includes(type) || !wants(u, type)) return false;
      const own = ownBranches(u);
      return own === null || branchIds.length === 0 || branchIds.some((b) => own.includes(b));
    });
  }

  // ---------- Texts ----------

  const LOCALES = { ar: 'ar-LB-u-nu-latn', fr: 'fr-FR' };
  const formats = {};
  const fmt = (lang, opts, date) =>
    (formats[`${lang}${Object.keys(opts)}`] ??= new Intl.DateTimeFormat(LOCALES[lang], { ...opts, timeZone: 'UTC' }))
      .format(date)
      .replace(/[‎‏؜]/g, '');
  // «samedi 11 octobre» / «السبت 11 تشرين الأول» — Latin digits, as everywhere in the app.
  // Two pieces, since the Arabic format puts a comma after the day name.
  function fmtDay(iso, lang) {
    const d = new Date(`${iso}T12:00:00Z`);
    return `${fmt(lang, { weekday: 'long' }, d)} ${fmt(lang, { day: 'numeric', month: 'long' }, d)}`;
  }
  // A no-break space ties the hour to its word: «الساعة» never ends a line without it
  const fmtWhen = (date, time, lang) =>
    !time
      ? fmtDay(date, lang)
      : lang === 'ar'
        ? `${fmtDay(date, lang)}، الساعة ${time}`
        : `${fmtDay(date, lang)} à ${time}`;
  const fmtRange = (from, to, lang) =>
    from === to
      ? fmtDay(from, lang)
      : lang === 'ar'
        ? `من ${fmtDay(from, lang)} إلى ${fmtDay(to, lang)}`
        : `du ${fmtDay(from, lang)} au ${fmtDay(to, lang)}`;

  const branchRow = db.prepare('SELECT name_ar, name_fr FROM branches WHERE id = ?');
  const branchNames = (ids, lang) =>
    ids
      .map((id) => branchRow.get(id))
      .filter(Boolean)
      .map((b) => (lang === 'ar' ? b.name_ar || b.name_fr : b.name_fr || b.name_ar))
      .join(lang === 'ar' ? '، ' : ', ');

  const actorName = (user) => user.display_name || user.username;
  // Arabic verbs agree with whoever acted: a قائدة of قسم الفتيات «أضافت»
  const feminine = (user) => user?.role !== 'admin' && sectionDef(user?.section)?.gender === 'F';
  const titleWith = (head, scope) => (scope ? `${head} · ${scope}` : head);
  const joinLine = (...parts) => parts.filter(Boolean).join(' · ');

  const branchIdsOf = (sessionId) =>
    db
      .prepare('SELECT branch_id FROM session_branches WHERE session_id = ? ORDER BY branch_id')
      .all(sessionId)
      .map((r) => r.branch_id);

  // ---------- Delivery ----------

  const insertInbox = db.prepare('INSERT INTO user_notifications (user_id, type, text, url) VALUES (?, ?, ?, ?)');
  const trimInbox = db.prepare(
    `DELETE FROM user_notifications WHERE user_id = ? AND id <= COALESCE(
       (SELECT id FROM user_notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?), 0)`
  );

  /**
   * One notification to these accounts: the inbox rows now, the pushes right after.
   * `text(lang, user)` writes it — per reader, for the rare text that speaks to him.
   * `tag` folds notifications about the same thing into one on the phone.
   */
  function deliver(users, { type, url, tag, ttl, text }) {
    if (!users.length) return;
    const texts = new Map(users.map((u) => [u.id, Object.fromEntries(LANGS.map((l) => [l, text(l, u)]))]));
    db.transaction(() => {
      for (const u of users) {
        insertInbox.run(u.id, type, JSON.stringify(texts.get(u.id)), url ?? null);
        trimInbox.run(u.id, u.id, INBOX_MAX);
      }
    })();
    setImmediate(() =>
      sendPushes(texts, { url, tag, ttl }).catch((e) => console.error('push send failed:', e.message))
    );
  }

  const subsOfUsers = (ids) =>
    !vapid || !ids.length
      ? []
      : db
          .prepare(
            `SELECT * FROM push_subscriptions WHERE vapid_key = ? AND user_id IN (${ids.map(() => '?').join(',')})`
          )
          .all(vapid.publicKey, ...ids);

  // texts: Map user_id -> { ar: {title, body}, fr: {...} }
  async function sendPushes(texts, { url, tag, ttl = 2 * DAY_S }) {
    const subs = subsOfUsers([...texts.keys()]);
    const results = await Promise.all(
      subs.map((s) => {
        const t = texts.get(s.user_id)[s.lang] || texts.get(s.user_id).ar;
        return pushTo(s, { title: t.title, body: t.body, url, tag, lang: s.lang }, { ttl, topic: tag });
      })
    );
    return { sent: results.filter(Boolean).length, failed: results.filter((r) => !r).length };
  }

  // One push to one device. A subscription the push service says is gone (the app was
  // uninstalled, the permission withdrawn) is forgotten; any other failure is counted,
  // and a device that has failed for weeks on end is dropped too.
  async function pushTo(s, payload, { ttl = 2 * DAY_S, topic } = {}) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...payload, dir: payload.lang === 'ar' ? 'rtl' : 'ltr' }),
        // A topic replaces a push still waiting for the phone with its newer version
        { TTL: ttl, urgency: 'normal', ...(topic ? { topic } : {}) }
      );
      db.prepare("UPDATE push_subscriptions SET last_sent_at = datetime('now'), failures = 0 WHERE id = ?").run(s.id);
      return true;
    } catch (e) {
      const status = e.statusCode;
      if (status === 404 || status === 410 || s.failures >= 49)
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      else db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').run(s.id);
      let host = '?';
      try {
        host = new URL(s.endpoint).host;
      } catch {
        /* stays '?' */
      }
      console.warn(`push to ${host} failed: ${status || e.message}`);
      return false;
    }
  }

  // ---------- Notifications ----------

  const KIND_NEW = {
    activity: { fr: 'Nouvelle séance', ar: 'نشاط جديد' },
    leaders: { fr: 'Nouvelle activité chefs', ar: 'نشاط قيادي جديد' },
    group: { fr: 'Nouvelle activité générale', ar: 'نشاط فوجي جديد' },
  };

  const animatorUsers = db.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, u.branches, u.perms, u.section, u.leader_id, sl.role AS animator_role
     FROM session_leaders sl JOIN users u ON u.leader_id = sl.leader_id
     WHERE sl.session_id = ? AND u.active = 1`
  );

  function animatorText(session, branchIds, role) {
    return (lang, u) => {
      const fem = feminine(u);
      const head =
        lang === 'ar'
          ? role === 'main'
            ? fem ? 'أنتِ القائدة المسؤولة' : 'أنت القائد المسؤول'
            : fem ? 'أنتِ قائدة مساعدة' : 'أنت قائد مساعد'
          : role === 'main'
            ? 'Vous êtes animateur principal'
            : 'Vous êtes animateur aide';
      return {
        title: head,
        body: joinLine(`«${session.title}»`, branchNames(branchIds, lang), fmtWhen(session.date, session.start_time, lang)),
      };
    };
  }

  // The قادة named on a نشاط by someone else hear it personally; `onlyLeaderIds` narrows
  // it to the ones just added. Returns who was told, so the general notice skips them.
  function notifyAnimators(req, session, branchIds, onlyLeaderIds = null) {
    const told = new Set();
    const rows = animatorUsers
      .all(session.id)
      .filter((u) => u.id !== req.user.id && (!onlyLeaderIds || onlyLeaderIds.includes(u.leader_id)));
    for (const u of rows) {
      if (!typesFor(u).includes('session_animator') || !seesSection(u, session.section) || !wants(u, 'session_animator'))
        continue;
      told.add(u.id);
      deliver([u], {
        type: 'session_animator',
        url: `/sessions/${session.id}`,
        tag: `s${session.id}`,
        text: animatorText(session, branchIds, u.animator_role),
      });
    }
    return told;
  }

  /** A new نشاط: its فرقة's قادة, and whoever follows the whole قسم. Visits stay quiet. */
  function sessionCreated(req, session) {
    if (!KIND_NEW[session.kind]) return;
    const branchIds = session.kind === 'activity' ? branchIdsOf(session.id) : [];
    const told = notifyAnimators(req, session, branchIds);
    const users = audience({ section: session.section, branchIds, type: 'session_created', except: req.user.id }).filter(
      (u) => !told.has(u.id)
    );
    const actor = actorName(req.user);
    const fem = feminine(req.user);
    deliver(users, {
      type: 'session_created',
      url: `/sessions/${session.id}`,
      tag: `s${session.id}`,
      text: (lang) => ({
        title: titleWith(KIND_NEW[session.kind][lang], branchNames(branchIds, lang)),
        body: `${joinLine(`«${session.title}»`, fmtWhen(session.date, session.start_time, lang), session.place)}\n${
          lang === 'ar' ? `${fem ? 'أضافته' : 'أضافه'} ${actor}` : `Ajoutée par ${actor}`
        }`,
      }),
    });
  }

  const todayISO = () => new Date().toISOString().slice(0, 10);

  /**
   * An edited نشاط: a new day, hour or place matters to whoever was coming — while it is
   * still ahead. Fixing the date of last week's نشاط is bookkeeping, not news. A new
   * القائد المسؤول hears it personally.
   */
  function sessionChanged(req, before, after) {
    if (!KIND_NEW[after.kind]) return;
    const today = todayISO();
    if (after.date < today && before.date < today) return;
    const branchIds = after.kind === 'activity' ? branchIdsOf(after.id) : [];
    const told =
      after.leader_id && after.leader_id !== before.leader_id
        ? notifyAnimators(req, after, branchIds, [after.leader_id])
        : new Set();
    const moved = after.date !== before.date || (after.start_time || null) !== (before.start_time || null);
    const newPlace = after.place && after.place !== before.place;
    if (!moved && !newPlace) return;
    const users = audience({ section: after.section, branchIds, type: 'session_changed', except: req.user.id }).filter(
      (u) => !told.has(u.id)
    );
    const actor = actorName(req.user);
    const fem = feminine(req.user);
    deliver(users, {
      type: 'session_changed',
      url: `/sessions/${after.id}`,
      tag: `s${after.id}`,
      text: (lang) => {
        const head =
          lang === 'ar' ? (moved ? 'تغيّر موعد نشاط' : 'تغيّر مكان نشاط') : moved ? 'Séance déplacée' : 'Lieu modifié';
        const what = moved
          ? lang === 'ar'
            ? `الموعد الجديد: ${joinLine(fmtWhen(after.date, after.start_time, lang), after.place)}`
            : `nouvelle date : ${joinLine(fmtWhen(after.date, after.start_time, lang), after.place)}`
          : lang === 'ar'
            ? `المكان الجديد: ${after.place}`
            : `nouveau lieu : ${after.place}`;
        return {
          title: titleWith(head, branchNames(branchIds, lang)),
          body: `«${after.title}» · ${what}\n${lang === 'ar' ? `${fem ? 'عدّلته' : 'عدّله'} ${actor}` : `Modifiée par ${actor}`}`,
        };
      },
    });
  }

  /** A قائد added as helper to a نشاط still ahead — afterwards it only records who helped. */
  function animatorAdded(req, sessionId, leaderId) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session || !KIND_NEW[session.kind] || session.date < todayISO()) return;
    notifyAnimators(req, session, session.kind === 'activity' ? branchIdsOf(session.id) : [], [Number(leaderId)]);
  }

  const EVENT_NEW = {
    camp: { fr: 'Nouveau camp', ar: 'مخيم جديد' },
    course: { fr: 'Nouvelle formation', ar: 'دورة جديدة' },
    trip: { fr: 'Nouvelle sortie', ar: 'رحلة جديدة' },
    other: { fr: 'Nouvel événement', ar: 'فعالية جديدة' },
  };

  /** A new مخيم / دورة / رحلة: its فرق's قادة, or the whole قسم for one of the فوج. */
  function eventCreated(req, ev) {
    const branchIds = db
      .prepare('SELECT branch_id FROM event_branches WHERE event_id = ? ORDER BY branch_id')
      .all(ev.id)
      .map((r) => r.branch_id);
    const users = audience({ section: ev.section, branchIds, type: 'event_created', except: req.user.id });
    const actor = actorName(req.user);
    const fem = feminine(req.user);
    deliver(users, {
      type: 'event_created',
      url: `/events/${ev.id}`,
      tag: `e${ev.id}`,
      ttl: 7 * DAY_S,
      text: (lang) => ({
        title: titleWith((EVENT_NEW[ev.kind] || EVENT_NEW.other)[lang], branchNames(branchIds, lang)),
        body: `${joinLine(`«${ev.title}»`, fmtRange(ev.start_date, ev.end_date, lang), ev.place)}\n${
          lang === 'ar' ? `${fem ? 'أضافته' : 'أضافه'} ${actor}` : `Ajouté par ${actor}`
        }`,
      }),
    });
  }

  /**
   * A نشاط still ahead was deleted: it will not take place. Whoever followed it hears it,
   * and its قادة too even when they follow other فرق. `leaderIds`: its قادة, read before
   * the rows went with it.
   */
  function sessionCancelled(req, session, branchIds, leaderIds) {
    if (!KIND_NEW[session.kind] || session.date < todayISO()) return;
    const ids = session.kind === 'activity' ? branchIds : [];
    const users = audience({ section: session.section, branchIds: ids, type: 'session_cancelled', except: req.user.id });
    const told = new Set(users.map((u) => u.id));
    for (const u of usersOfLeaders(leaderIds))
      if (u.id !== req.user.id && !told.has(u.id) && hears(u, 'session_cancelled', session.section)) {
        told.add(u.id);
        users.push(u);
      }
    const actor = actorName(req.user);
    const fem = feminine(req.user);
    deliver(users, {
      type: 'session_cancelled',
      url: '/sessions',
      tag: `s${session.id}`,
      text: (lang) => ({
        title: titleWith(lang === 'ar' ? 'أُلغي نشاط' : 'Séance annulée', branchNames(ids, lang)),
        body: `${joinLine(`«${session.title}»`, fmtWhen(session.date, session.start_time, lang))}\n${
          lang === 'ar' ? `${fem ? 'ألغته' : 'ألغاه'} ${actor}` : `Annulée par ${actor}`
        }`,
      }),
    });
  }

  // The مخيم's words: «المخيم» names it in Arabic, and its gender agrees with the verbs
  const EVENT_WORD = {
    camp: { ar: 'المخيم', fem: false, fr: 'le camp', frIn: 'au camp' },
    course: { ar: 'الدورة', fem: true, fr: 'la formation', frIn: 'à la formation' },
    trip: { ar: 'الرحلة', fem: true, fr: 'la sortie', frIn: 'à la sortie' },
    other: { ar: 'الفعالية', fem: true, fr: "l'événement", frIn: "à l'événement" },
  };
  const eventWord = (ev) => EVENT_WORD[ev.kind] || EVENT_WORD.other;
  const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const eventBranchIdsOf = (eventId) =>
    db
      .prepare('SELECT branch_id FROM event_branches WHERE event_id = ? ORDER BY branch_id')
      .all(eventId)
      .map((r) => r.branch_id);

  /** A مخيم not over yet moved to other days or another place. */
  function eventChanged(req, before, after) {
    const today = todayISO();
    if (after.end_date < today && before.end_date < today) return;
    const moved = after.start_date !== before.start_date || after.end_date !== before.end_date;
    const newPlace = after.place && after.place !== before.place;
    if (!moved && !newPlace) return;
    const branchIds = eventBranchIdsOf(after.id);
    const users = audience({ section: after.section, branchIds, type: 'event_changed', except: req.user.id });
    const actor = actorName(req.user);
    const fem = feminine(req.user);
    const w = eventWord(after);
    deliver(users, {
      type: 'event_changed',
      url: `/events/${after.id}`,
      tag: `e${after.id}`,
      ttl: 7 * DAY_S,
      text: (lang) => ({
        title: titleWith(
          lang === 'ar'
            ? `${moved ? 'تغيّر موعد' : 'تغيّر مكان'} ${w.ar}`
            : moved
              ? `${capital(w.fr)} change de dates`
              : `${capital(w.fr)} change de lieu`,
          branchNames(branchIds, lang)
        ),
        body: `${joinLine(`«${after.title}»`, fmtRange(after.start_date, after.end_date, lang), after.place)}\n${
          lang === 'ar' ? `${fem ? 'عدّلته' : 'عدّله'} ${actor}` : `Modifié par ${actor}`
        }`,
      }),
    });
  }

  // الهيئة القيادية, as the مخيم's page names its posts — a قائدة's in the feminine
  const STAFF_WORD = {
    gathering: { ar: 'قائد التجمع', arF: 'قائدة التجمع', fr: 'chef de rassemblement', frF: 'cheffe de rassemblement' },
    secretary: { ar: 'أمين السر', arF: 'أمينة السر', fr: 'secrétaire', frF: 'secrétaire' },
    media: { ar: 'أمين الإعلام', arF: 'أمينة الإعلام', fr: 'responsable médias', frF: 'responsable médias' },
    treasurer: { ar: 'أمين الصندوق', arF: 'أمينة الصندوق', fr: 'trésorier', frF: 'trésorière' },
    gear: { ar: 'أمين التجهيزات', arF: 'أمينة التجهيزات', fr: 'responsable matériel', frF: 'responsable matériel' },
    trainer: { ar: 'مدرّب', arF: 'مدرّبة', fr: 'formateur', frF: 'formatrice' },
    assistant: { ar: 'معاون', arF: 'معاونة', fr: 'assistant', frF: 'assistante' },
    medic: { ar: 'مسعف', arF: 'مسعفة', fr: 'secouriste', frF: 'secouriste' },
  };
  const CHIEF_FR = {
    camp: ['chef du camp', 'cheffe du camp'],
    course: ['chef de la formation', 'cheffe de la formation'],
    trip: ['chef de la sortie', 'cheffe de la sortie'],
    other: ['chef responsable', 'cheffe responsable'],
  };

  /**
   * A قائد given a place in a مخيم still ahead or going on, by someone else: its chief
   * (role 'chief'), a post of its هيئة (role = the post, `title` for «other»), or a
   * participant (role 'participant').
   */
  function eventRole(req, ev, leaderId, role, title = null) {
    if (!leaderId || ev.end_date < todayISO()) return;
    const users = usersOfLeaders([leaderId]).filter(
      (u) => u.id !== req.user.id && hears(u, 'event_role', ev.section)
    );
    const w = eventWord(ev);
    deliver(users, {
      type: 'event_role',
      url: `/events/${ev.id}`,
      tag: `e${ev.id}`,
      ttl: 7 * DAY_S,
      text: (lang, u) => {
        const fem = feminine(u);
        let head;
        if (role === 'chief')
          head =
            lang === 'ar'
              ? `${fem ? 'أنتِ قائدة' : 'أنت قائد'} ${w.ar}`
              : `Vous êtes ${(CHIEF_FR[ev.kind] || CHIEF_FR.other)[fem ? 1 : 0]}`;
        else if (role === 'participant')
          head =
            lang === 'ar'
              ? `${fem ? 'سُجِّلتِ' : 'سُجِّلتَ'} في ${w.ar}`
              : `Vous êtes ${fem ? 'inscrite' : 'inscrit'} ${w.frIn}`;
        else {
          const s = STAFF_WORD[role];
          const post = s ? (lang === 'ar' ? (fem ? s.arF : s.ar) : fem ? s.frF : s.fr) : title || '';
          head = lang === 'ar' ? `${fem ? 'أنتِ' : 'أنت'} ${post} في ${w.ar}` : `Vous êtes ${post} — ${w.fr}`;
        }
        return { title: head, body: joinLine(`«${ev.title}»`, fmtRange(ev.start_date, ev.end_date, lang), ev.place) };
      },
    });
  }

  // A new محضر or a planned اجتماع, for whoever follows its فرق (or its whole قسم)
  function meetingCreated(req, m, branchIds) {
    const users = audience({ section: m.section, branchIds, type: 'meeting_created', except: req.user.id });
    const actor = actorName(req.user);
    const fem = feminine(req.user);
    deliver(users, {
      type: 'meeting_created',
      url: `/meetings/${m.id}`,
      tag: `m${m.id}`,
      ttl: 7 * DAY_S,
      text: (lang) => ({
        title: titleWith(lang === 'ar' ? 'اجتماع جديد' : 'Nouvelle réunion', branchNames(branchIds, lang)),
        body: `${joinLine(`«${m.title}»`, fmtWhen(m.date, m.start_time, lang), m.place)}\n${
          lang === 'ar' ? `${fem ? 'أضافته' : 'أضافه'} ${actor}` : `Ajoutée par ${actor}`
        }`,
      }),
    });
  }

  const decisionBody = (d, meetingTitle, lang) =>
    joinLine(
      `«${d.text}»`,
      d.due_date ? (lang === 'ar' ? `قبل ${fmtDay(d.due_date, lang)}` : `pour le ${fmtDay(d.due_date, lang)}`) : null,
      meetingTitle
    );

  /** An مقرّر handed to a قائد (new, or passed on to him), by someone else. */
  function decisionAssigned(req, m, d) {
    if (!d.leader_id || d.status !== 'open') return;
    const users = usersOfLeaders([d.leader_id]).filter(
      (u) => u.id !== req.user.id && hears(u, 'decision_assigned', m.section)
    );
    deliver(users, {
      type: 'decision_assigned',
      url: `/meetings/${m.id}`,
      tag: `d${d.id}`,
      ttl: 7 * DAY_S,
      text: (lang) => ({ title: lang === 'ar' ? 'تكليف جديد' : 'Nouvelle tâche', body: decisionBody(d, m.title, lang) }),
    });
  }

  /**
   * A new evaluation of a نشاط or a مخيم, for whoever leads it (its القائد المسؤول, its
   * قائد المخيم). Without the evaluator's name: the marks stay anonymous to them.
   */
  function evaluationReceived(req, { kind, id, title, section, leaderIds, count, total }) {
    const users = usersOfLeaders(leaderIds).filter(
      (u) => u.id !== req.user.id && Number(u.leader_id) !== Number(req.user.leader_id) &&
        hears(u, 'evaluation_received', section, kind === 'session' ? 'sessions.read' : 'events.read')
    );
    deliver(users, {
      type: 'evaluation_received',
      url: kind === 'session' ? `/sessions/${id}?tab=eval` : `/events/${id}?tab=eval`,
      tag: `${kind === 'session' ? 's' : 'e'}${id}-eval`,
      text: (lang) => ({
        title:
          lang === 'ar'
            ? kind === 'session' ? 'تقييم جديد لنشاطك' : 'تقييم جديد'
            : kind === 'session' ? 'Nouvelle évaluation de votre séance' : 'Nouvelle évaluation',
        body: joinLine(
          `«${title}»`,
          lang === 'ar' ? `المقيِّمون: ${count} من ${total}` : `évaluateurs : ${count} sur ${total}`
        ),
      }),
    });
  }

  /** A new عنصر in a فرقة, for its other قادة. */
  function memberCreated(req, m) {
    const section = db.prepare('SELECT section FROM branches WHERE id = ?').get(m.branch_id)?.section;
    if (!section) return;
    const users = audience({ section, branchIds: [m.branch_id], type: 'member_created', except: req.user.id });
    const actor = actorName(req.user);
    const fem = feminine(req.user);
    const name = [m.first_name, m.father_name, m.last_name].filter(Boolean).join(' ');
    deliver(users, {
      type: 'member_created',
      url: `/members/${m.id}`,
      tag: `mb${m.id}`,
      text: (lang) => ({
        title: titleWith(lang === 'ar' ? 'عنصر جديد' : 'Nouveau membre', branchNames([m.branch_id], lang)),
        body: `${name}\n${lang === 'ar' ? `${fem ? 'سجّلته' : 'سجّله'} ${actor}` : `Inscrit par ${actor}`}`,
      }),
    });
  }

  const fmtAmount = (n) => `${new Intl.NumberFormat('fr-FR').format(n).replace(/\s/g, ' ')} F`;

  /**
   * An expense or an income written in a caisse, for whoever reads that caisse: a فرقة's
   * by the accounts of that فرقة (or of every one), the فوج's by those of every فرقة.
   */
  function treasuryEntry(req, e) {
    const users = activeUsers.all().filter((u) => {
      if (u.id === req.user.id || !hears(u, 'treasury_entry', e.section)) return false;
      const own = ownBranches(u);
      return own === null || (e.branch_id !== null && own.includes(e.branch_id));
    });
    const actor = actorName(req.user);
    const fem = feminine(req.user);
    const box = (lang) =>
      e.branch_id ? branchNames([e.branch_id], lang) : lang === 'ar' ? 'صندوق الفوج' : 'Caisse du groupe';
    deliver(users, {
      type: 'treasury_entry',
      url: '/treasury',
      tag: `t${e.id}`,
      text: (lang) => ({
        title: titleWith(
          e.direction === 'out'
            ? lang === 'ar' ? 'مصروف جديد' : 'Nouvelle dépense'
            : lang === 'ar' ? 'مدخول جديد' : 'Nouvelle entrée',
          box(lang)
        ),
        body: `${joinLine(e.label, fmtAmount(e.amount))}\n${
          lang === 'ar' ? `${fem ? 'سجّلته' : 'سجّله'} ${actor}` : `Enregistrée par ${actor}`
        }`,
      }),
    });
  }

  // ---------- Reminders ----------
  // The evening of a فرقة's نشاط, its قادة hear it if nobody is marked present yet: the
  // roster starts all absent, so an untouched one reads as a نشاط nobody came to, and
  // every rate is wrong until someone marks it. Once per نشاط, and only after it has
  // been seen unmarked for half an hour: one created this evening is being marked now.
  // (Nothing in sessions says when a row was created — updated_at is filled at boot.)
  const markReminder = db.prepare('INSERT OR IGNORE INTO notification_reminders (key) VALUES (?)');
  const reminderAt = db.prepare('SELECT sent_at FROM notification_reminders WHERE key = ?');
  const GRACE_MS = 30 * 60 * 1000;

  function attendanceReminders(now = new Date()) {
    if (now.getUTCHours() < REMINDER_HOUR) return 0;
    const today = now.toISOString().slice(0, 10);
    db.prepare("DELETE FROM notification_reminders WHERE sent_at < datetime('now', '-60 days')").run();
    const unmarked = db
      .prepare(
        `SELECT s.* FROM sessions s
         WHERE s.kind = 'activity' AND s.date = ?
           AND NOT EXISTS (SELECT 1 FROM notification_reminders r WHERE r.key = 'attendance:' || s.id)
           AND EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id AND a.status IN ('present', 'excused'))`
      )
      .all(today);
    let sent = 0;
    for (const s of unmarked) {
      const seen = reminderAt.get(`attendance-seen:${s.id}`);
      if (!seen) {
        markReminder.run(`attendance-seen:${s.id}`);
        continue;
      }
      if (now.getTime() - Date.parse(seen.sent_at.replace(' ', 'T') + 'Z') < GRACE_MS) continue;
      // Claimed before sending: a crash halfway never sends the same reminder twice
      if (markReminder.run(`attendance:${s.id}`).changes === 0) continue;
      sent += 1;
      const branchIds = branchIdsOf(s.id);
      deliver(audience({ section: s.section, branchIds, type: 'attendance_missing' }), {
        type: 'attendance_missing',
        url: `/sessions/${s.id}`,
        tag: `s${s.id}`,
        ttl: 12 * 60 * 60,
        text: (lang) => ({
          title: titleWith(lang === 'ar' ? 'الحضور لم يُسجَّل بعد' : 'Présence à saisir', branchNames(branchIds, lang)),
          body:
            lang === 'ar'
              ? `«${s.title}»: لم يُسجَّل أي عنصر حاضرًا بعد.`
              : `«${s.title}» : personne n'est encore marqué présent.`,
        }),
      });
    }
    return sent;
  }

  const isoDay = (now, offset) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  // Claimed before sending: a crash halfway never sends the same reminder twice
  const claim = (key) => markReminder.run(key).changes > 0;

  // Who takes part in a مخيم, by قائد: its chief, its هيئة, the قادة who registered (and were
  // not taken off the list) and were not marked absent from every جلسة — the same as its evaluators
  const eventLeaderIds = (eventId) =>
    db
      .prepare(
        `SELECT leader_id FROM events WHERE id = @id AND leader_id IS NOT NULL
         UNION SELECT leader_id FROM event_staff WHERE event_id = @id AND leader_id IS NOT NULL
         UNION SELECT p.leader_id FROM event_participants p WHERE p.event_id = @id AND p.leader_id IS NOT NULL
           AND p.withdrawn_at IS NULL
           AND (NOT EXISTS (SELECT 1 FROM event_attendance a WHERE a.participant_id = p.id)
                OR EXISTS (SELECT 1 FROM event_attendance a WHERE a.participant_id = p.id AND a.status = 'present'))`
      )
      .all({ id: eventId })
      .map((r) => r.leader_id);

  /** The evening before a مخيم starts, the قادة who take part in it. */
  function eventReminders(now = new Date()) {
    if (now.getUTCHours() < REMINDER_HOUR) return 0;
    let sent = 0;
    for (const ev of db.prepare('SELECT * FROM events WHERE start_date = ?').all(isoDay(now, 1))) {
      if (!claim(`event-start:${ev.id}`)) continue;
      const w = eventWord(ev);
      const users = usersOfLeaders(eventLeaderIds(ev.id)).filter((u) => hears(u, 'event_reminder', ev.section));
      sent += users.length;
      deliver(users, {
        type: 'event_reminder',
        url: `/events/${ev.id}`,
        tag: `e${ev.id}`,
        ttl: DAY_S,
        text: (lang) => ({
          title:
            lang === 'ar'
              ? `${w.fem ? 'تبدأ' : 'يبدأ'} ${w.ar} غدًا`
              : `${capital(w.fr)} ${ev.kind === 'trip' ? 'a lieu' : 'commence'} demain`,
          body: joinLine(`«${ev.title}»`, ev.place),
        }),
      });
    }
    return sent;
  }

  /** An open مقرّر due tomorrow, and once more the day after its date has passed. */
  function decisionReminders(now = new Date()) {
    if (now.getUTCHours() < REMINDER_HOUR) return 0;
    let sent = 0;
    const rows = db
      .prepare(
        `SELECT d.*, m.title AS meeting_title, m.section FROM meeting_decisions d JOIN meetings m ON m.id = d.meeting_id
         WHERE d.status = 'open' AND d.leader_id IS NOT NULL AND d.due_date IN (?, ?)`
      )
      .all(isoDay(now, 1), isoDay(now, -1));
    for (const d of rows) {
      const late = d.due_date < now.toISOString().slice(0, 10);
      if (!claim(`decision-${late ? 'late' : 'due'}:${d.id}`)) continue;
      const users = usersOfLeaders([d.leader_id]).filter((u) => hears(u, 'decision_due', d.section));
      sent += users.length;
      deliver(users, {
        type: 'decision_due',
        url: `/meetings/${d.meeting_id}`,
        tag: `d${d.id}`,
        ttl: DAY_S,
        text: (lang) => ({
          title: late
            ? lang === 'ar' ? 'تكليف متأخّر' : 'Tâche en retard'
            : lang === 'ar' ? 'تكليف موعده غدًا' : 'Tâche à rendre demain',
          body: decisionBody(d, d.meeting_title, lang),
        }),
      });
    }
    return sent;
  }

  /**
   * The evening after a نشاط, its قادة who have not rated it yet; the evening after a
   * مخيم's last day, the same for its قادة. Only where a form is set for its kind (or it
   * was rated already).
   */
  function evaluationReminders(now = new Date()) {
    if (now.getUTCHours() < REMINDER_HOUR) return 0;
    const yesterday = isoDay(now, -1);
    let sent = 0;
    const sessions = db
      .prepare(
        `SELECT s.* FROM sessions s WHERE s.date = ?
           AND (EXISTS (SELECT 1 FROM eval_kind_forms k WHERE k.kind = s.kind)
                OR EXISTS (SELECT 1 FROM session_evaluations ev WHERE ev.session_id = s.id))`
      )
      .all(yesterday);
    for (const s of sessions) {
      const leaderIds = db
        .prepare(
          `SELECT sl.leader_id FROM session_leaders sl WHERE sl.session_id = ? AND COALESCE(sl.status, '') != 'absent'
             AND NOT EXISTS (SELECT 1 FROM session_evaluations ev WHERE ev.session_id = sl.session_id AND ev.leader_id = sl.leader_id)`
        )
        .all(s.id)
        .map((r) => r.leader_id);
      const users = usersOfLeaders(leaderIds).filter(
        (u) => hears(u, 'evaluation_pending', s.section, 'sessions.read') && claim(`eval:s${s.id}:${u.id}`)
      );
      sent += users.length;
      deliver(users, {
        type: 'evaluation_pending',
        url: `/sessions/${s.id}?tab=eval`,
        tag: `s${s.id}-eval`,
        ttl: 2 * DAY_S,
        text: (lang) => ({
          title: lang === 'ar' ? 'قيِّم نشاط الأمس' : "Évaluez la séance d'hier",
          body: `«${s.title}»`,
        }),
      });
    }
    const events = db
      .prepare(
        `SELECT e.* FROM events e WHERE e.end_date = ?
           AND (EXISTS (SELECT 1 FROM eval_kind_forms k WHERE k.kind = 'event_' || e.kind)
                OR EXISTS (SELECT 1 FROM event_evaluations ev WHERE ev.event_id = e.id))`
      )
      .all(yesterday);
    for (const ev of events) {
      const rated = new Set(
        db.prepare('SELECT leader_id FROM event_evaluations WHERE event_id = ? AND leader_id IS NOT NULL').all(ev.id).map((r) => r.leader_id)
      );
      const w = eventWord(ev);
      const users = usersOfLeaders(eventLeaderIds(ev.id).filter((id) => !rated.has(id))).filter(
        (u) => hears(u, 'evaluation_pending', ev.section, 'events.read') && claim(`eval:e${ev.id}:${u.id}`)
      );
      sent += users.length;
      deliver(users, {
        type: 'evaluation_pending',
        url: `/events/${ev.id}?tab=eval`,
        tag: `e${ev.id}-eval`,
        ttl: 3 * DAY_S,
        text: (lang) => ({
          title: lang === 'ar' ? `قيِّم ${w.ar}` : `Évaluez ${w.fr}`,
          body: `«${ev.title}»`,
        }),
      });
    }
    return sent;
  }

  /**
   * The next planned نشاط of a فرقة, PREP_DAYS_AHEAD days away, without its بطاقة التحضير
   * yet: its قادة hear it once.
   */
  function prepReminders(now = new Date()) {
    if (now.getUTCHours() < REMINDER_HOUR || !nextPlanned) return 0;
    const today = now.toISOString().slice(0, 10);
    const target = isoDay(now, PREP_DAYS_AHEAD);
    let sent = 0;
    for (const b of db.prepare('SELECT id, section FROM branches').all()) {
      const next = nextPlanned(b.id, today);
      if (!next || next.date !== target) continue;
      if (db.prepare('SELECT 1 FROM prep_cards WHERE branch_id = ? AND date = ?').get(b.id, target)) continue;
      if (!claim(`prep:${b.id}:${target}`)) continue;
      const users = audience({ section: b.section, branchIds: [b.id], type: 'prep_missing' });
      sent += users.length;
      deliver(users, {
        type: 'prep_missing',
        url: '/prep-cards',
        tag: `prep${b.id}`,
        ttl: 2 * DAY_S,
        text: (lang) => ({
          title: titleWith(lang === 'ar' ? 'بطاقة التحضير لم تُكتب بعد' : 'Fiche de préparation à rédiger', branchNames([b.id], lang)),
          body: joinLine(`«${next.title}»`, fmtDay(next.date, lang)),
        }),
      });
    }
    return sent;
  }

  /**
   * The morning's birthdays: the عناصر of the فرق an account follows, and the قادة of its
   * قسم — one notification each, with their names.
   */
  function birthdayReminders(now = new Date()) {
    if (now.getUTCHours() < BIRTHDAY_HOUR) return 0;
    const today = now.toISOString().slice(0, 10);
    if (!claim(`birthday:${today}`)) return 0;
    const md = today.slice(5);
    const members = db
      .prepare(
        `SELECT m.first_name, m.father_name, m.last_name, m.branch_id, b.section FROM members m
         JOIN branches b ON b.id = m.branch_id WHERE m.status = 'active' AND substr(m.birth_date, 6, 5) = ?`
      )
      .all(md);
    const leaders = db
      .prepare(
        `SELECT first_name, father_name, last_name, section FROM leaders
         WHERE status = 'active' AND substr(birth_date, 6, 5) = ?`
      )
      .all(md);
    if (!members.length && !leaders.length) return 0;
    const fullName = (p) => [p.first_name, p.last_name].filter(Boolean).join(' ');
    const names = new Map();
    for (const u of activeUsers.all()) {
      if (!typesFor(u).includes('birthday') || !wants(u, 'birthday')) continue;
      const own = ownBranches(u);
      const list = [
        ...(canUser(u, 'members.read')
          ? members.filter((m) => seesSection(u, m.section) && (own === null || own.includes(m.branch_id)))
          : []),
        ...(canUser(u, 'leaders.read') ? leaders.filter((l) => seesSection(u, l.section)) : []),
      ].map(fullName);
      if (list.length) names.set(u.id, list);
    }
    const users = activeUsers.all().filter((u) => names.has(u.id));
    deliver(users, {
      type: 'birthday',
      url: '/',
      tag: `birthday-${today}`,
      ttl: 16 * 60 * 60,
      text: (lang, u) => {
        const list = names.get(u.id);
        const shown = list.slice(0, 4).join(lang === 'ar' ? '، ' : ', ');
        const more = list.length - 4;
        return {
          title:
            lang === 'ar'
              ? list.length > 1 ? 'أعياد ميلاد اليوم' : 'عيد ميلاد اليوم'
              : list.length > 1 ? "Anniversaires aujourd'hui" : "Anniversaire aujourd'hui",
          body: more > 0 ? (lang === 'ar' ? `${shown} و ${more} آخرون` : `${shown} et ${more} autres`) : shown,
        };
      },
    });
    return users.length;
  }

  /** A قائد whose اشتراك of the month is not recorded yet, a few days into the month. */
  function duesReminders(now = new Date()) {
    if (now.getUTCDate() !== DUES_REMINDER_DAY || now.getUTCHours() < DUES_REMINDER_HOUR) return 0;
    const month = now.toISOString().slice(0, 7);
    if (month < DUES_START) return 0;
    const users = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.role, u.branches, u.perms, u.section, u.leader_id FROM users u
         WHERE u.active = 1 AND u.leader_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM leader_dues d WHERE d.leader_id = u.leader_id AND d.month = ?)`
      )
      .all(month)
      .filter((u) => typesFor(u).includes('leader_dues') && wants(u, 'leader_dues') && claim(`dues:${month}:${u.id}`));
    const monthName = (lang) => fmt(lang, { month: 'long', year: 'numeric' }, new Date(`${month}-15T12:00:00Z`));
    deliver(users, {
      type: 'leader_dues',
      url: '/',
      tag: `dues-${month}`,
      ttl: 3 * DAY_S,
      text: (lang) => ({
        title: lang === 'ar' ? 'اشتراك الشهر' : 'Cotisation du mois',
        body:
          lang === 'ar'
            ? `لم يُسجَّل اشتراك ${monthName(lang)} بعد.`
            : `La cotisation de ${monthName(lang)} n'est pas encore enregistrée.`,
      }),
    });
    return users.length;
  }

  function runReminders() {
    for (const job of [
      attendanceReminders,
      eventReminders,
      decisionReminders,
      evaluationReminders,
      prepReminders,
      birthdayReminders,
      duesReminders,
    ])
      try {
        job();
      } catch (e) {
        console.error(`notification reminders (${job.name}) failed:`, e.message);
      }
  }
  setTimeout(runReminders, 60 * 1000).unref();
  setInterval(runReminders, REMINDER_EVERY_MS).unref();

  // ---------- Devices ----------

  // Only the push services of the browsers people use — never an address of our own
  // network: the server POSTs to whatever endpoint is stored here.
  const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
  const B64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;
  const keyBytes = (v) => (typeof v === 'string' && B64URL_RE.test(v) ? Buffer.from(v, 'base64url').length : 0);

  function parseSubscription(body) {
    const b = body || {};
    let url;
    try {
      url = new URL(String(b.endpoint || ''));
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || String(b.endpoint).length > 2048) return null;
    if (!PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
      console.warn(`push subscription refused: unknown push service ${url.hostname}`);
      return null;
    }
    // A P-256 public key (65 bytes uncompressed) and a 16-byte auth secret
    if (keyBytes(b.keys?.p256dh) !== 65 || keyBytes(b.keys?.auth) !== 16) return null;
    return {
      endpoint: String(b.endpoint),
      p256dh: b.keys.p256dh,
      auth: b.keys.auth,
      lang: LANGS.includes(b.lang) ? b.lang : 'ar',
    };
  }

  app.get('/api/push/key', (req, res) => res.json({ publicKey: vapid?.publicKey ?? null }));

  // This device, for this account: created or refreshed
  app.post('/api/push/subscriptions', (req, res) => {
    if (!vapid) return res.status(503).json({ error: 'push_unavailable' });
    const sub = parseSubscription(req.body);
    if (!sub) return res.status(400).json({ error: 'invalid subscription' });
    db.transaction(() => {
      db.prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, vapid_key, lang)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint, user_id) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
           vapid_key = excluded.vapid_key, lang = excluded.lang, last_seen_at = datetime('now'), failures = 0`
      ).run(req.user.id, sub.endpoint, sub.p256dh, sub.auth, vapid.publicKey, sub.lang);
      // A phone changed every year leaves its old subscription behind: keep the latest few
      db.prepare(
        `DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN
          (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY last_seen_at DESC, id DESC LIMIT ?)`
      ).run(req.user.id, req.user.id, DEVICES_MAX);
    })();
    res.status(201).json({ subscribed: true });
  });

  // On each start of the app: is this device still on for this account? Refreshes its
  // language and keys if so, never creates — switching it on is the account's choice.
  app.post('/api/push/subscriptions/sync', (req, res) => {
    const sub = vapid && parseSubscription(req.body);
    if (!sub) return res.json({ subscribed: false });
    const r = db
      .prepare(
        `UPDATE push_subscriptions SET p256dh = ?, auth = ?, lang = ?, last_seen_at = datetime('now')
         WHERE endpoint = ? AND user_id = ? AND vapid_key = ?`
      )
      .run(sub.p256dh, sub.auth, sub.lang, sub.endpoint, req.user.id, vapid.publicKey);
    res.json({ subscribed: r.changes > 0 });
  });

  // Off for this account on this device. The browser keeps its subscription: another
  // account signed in on the same phone may still use it.
  app.post('/api/push/unsubscribe', (req, res) => {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(
      String(req.body?.endpoint || ''),
      req.user.id
    );
    res.status(204).end();
  });

  // A push to this device (or to all of the account's devices), answered once it left
  app.post('/api/push/test', async (req, res) => {
    const endpoint = req.body?.endpoint ? String(req.body.endpoint) : null;
    const subs = subsOfUsers([req.user.id]).filter((s) => !endpoint || s.endpoint === endpoint);
    if (!subs.length) return res.status(404).json({ error: 'no_device' });
    const results = await Promise.all(
      subs.map((s) =>
        pushTo(
          s,
          s.lang === 'ar'
            ? { title: 'الإشعارات مفعّلة', body: 'هكذا ستصلك أخبار الأنشطة الجديدة.', url: '/', tag: 'test', lang: 'ar' }
            : { title: 'Notifications activées', body: 'Vous serez prévenu ainsi des nouvelles séances.', url: '/', tag: 'test', lang: 'fr' },
          { ttl: 60 * 60 }
        )
      )
    );
    const sent = results.filter(Boolean).length;
    res.status(sent ? 200 : 502).json({ sent, failed: results.length - sent });
  });

  // ---------- Inbox ----------

  const unreadOf = (userId) =>
    db.prepare('SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;

  // The admin's log of what the قادة did (notifyAdmins in index.js). Its «X added a نشاط»
  // lines are not counted when the same news already came to the inbox, or the bell
  // would count one نشاط twice.
  function activityUnread(req) {
    if (req.user.role !== 'admin') return null;
    const seen =
      db.prepare('SELECT seen_at FROM notification_seen WHERE user_id = ?').get(req.user.id)?.seen_at || '';
    const skipCreated = wants(req.user, 'session_created');
    return db
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT type, created_at FROM notifications ORDER BY created_at DESC, id DESC LIMIT ${LIST_LIMIT})
         WHERE created_at > ? AND NOT (? AND type = 'session_create')`
      )
      .get(seen, skipCreated ? 1 : 0).n;
  }

  app.get('/api/me/notifications/count', (req, res) => {
    res.json({ unread: unreadOf(req.user.id), activity_unread: activityUnread(req) });
  });

  app.get('/api/me/notifications', (req, res) => {
    const items = db
      .prepare(
        `SELECT id, type, text, url, created_at, read_at FROM user_notifications
         WHERE user_id = ? ORDER BY id DESC LIMIT ${LIST_LIMIT}`
      )
      .all(req.user.id)
      .map((n) => ({ ...n, text: JSON.parse(n.text), unread: !n.read_at }));
    res.json({ items, unread: unreadOf(req.user.id), activity_unread: activityUnread(req) });
  });

  // Everything read (opening the bell), or just the given ids
  app.post('/api/me/notifications/read', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
    if (ids && ids.length)
      db.prepare(
        `UPDATE user_notifications SET read_at = datetime('now')
         WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`
      ).run(req.user.id, ...ids);
    else
      db.prepare("UPDATE user_notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(
        req.user.id
      );
    res.json({ unread: unreadOf(req.user.id) });
  });

  // ---------- Preferences ----------

  const prefsPayload = (u) => ({
    types: typesFor(u).map((type) => ({ type, group: TYPES[type].group, enabled: wants(u, type), default: TYPES[type].on(u) })),
    push_available: !!vapid,
  });

  const userRow = db.prepare(
    'SELECT id, username, display_name, role, branches, perms, section, leader_id FROM users WHERE id = ?'
  );

  app.get('/api/me/notification-prefs', (req, res) => res.json(prefsPayload(userRow.get(req.user.id))));

  // { type: true|false, ... } — a choice equal to the default leaves no row behind
  app.put('/api/me/notification-prefs', (req, res) => {
    const u = userRow.get(req.user.id);
    const allowed = typesFor(u);
    const body = req.body || {};
    const entries = Object.entries(body);
    if (!entries.length || entries.some(([type, v]) => !allowed.includes(type) || typeof v !== 'boolean'))
      return res.status(400).json({ error: 'invalid prefs' });
    db.transaction(() => {
      for (const [type, enabled] of entries) {
        if (enabled === TYPES[type].on(u))
          db.prepare('DELETE FROM notification_prefs WHERE user_id = ? AND type = ?').run(u.id, type);
        else
          db.prepare(
            `INSERT INTO notification_prefs (user_id, type, enabled) VALUES (?, ?, ?)
             ON CONFLICT(user_id, type) DO UPDATE SET enabled = excluded.enabled`
          ).run(u.id, type, enabled ? 1 : 0);
      }
    })();
    res.json(prefsPayload(u));
  });

  return {
    sessionCreated,
    sessionChanged,
    sessionCancelled,
    animatorAdded,
    eventCreated,
    eventChanged,
    eventRole,
    meetingCreated,
    decisionAssigned,
    evaluationReceived,
    memberCreated,
    treasuryEntry,
    // The reminders, callable with a given time (tests)
    attendanceReminders,
    eventReminders,
    decisionReminders,
    evaluationReminders,
    prepReminders,
    birthdayReminders,
    duesReminders,
  };
};
