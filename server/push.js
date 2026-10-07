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
const REMINDER_EVERY_MS = 10 * 60 * 1000;
const DAY_S = 24 * 60 * 60;
const DEVICES_MAX = 10;

// What an account can be told, and whether it hears it before choosing anything.
// `perm`: a type never reaches an account that could not open what it points to.
// `leader`: personal to a قائد — only for accounts tied to their قائد file.
const TYPES = {
  session_created: { perm: 'sessions.read', on: () => true },
  session_changed: { perm: 'sessions.read', on: () => true },
  session_animator: { perm: 'sessions.read', leader: true, on: () => true },
  // The قادة of the فرقة are the ones who mark it: on for an account tied to فرق, off
  // for the admin and the accounts that see every فرقة, who would get one per فرقة.
  attendance_missing: { perm: 'sessions.attendance', on: (u) => ownBranches(u) !== null },
  event_created: { perm: 'sessions.read', on: () => true },
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

module.exports = function setupNotifications(app, { canUser }) {
  // Types this account can receive at all — the settings list shows only these
  const typesFor = (u) =>
    Object.keys(TYPES).filter((type) => canUser(u, TYPES[type].perm) && (!TYPES[type].leader || u.leader_id));

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

  function runReminders() {
    try {
      attendanceReminders();
    } catch (e) {
      console.error('notification reminders failed:', e.message);
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
    types: typesFor(u).map((type) => ({ type, enabled: wants(u, type), default: TYPES[type].on(u) })),
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

  return { sessionCreated, sessionChanged, animatorAdded, eventCreated, attendanceReminders };
};
