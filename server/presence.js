// ---------- En ligne ----------
// Who has the app open right now, and on which page — for the admin's «en ligne» pill.
// Each open app says where it is (POST /api/presence) when its page changes and every
// 30 s while it is in front; a hidden or closed app says it leaves (DELETE), and one
// that goes silent drops out after ONLINE_MS anyway. Kept in memory only: nothing of it
// is history, and a restart simply starts from an empty list that refills in 30 s.
//
// Keyed by session token, not by account: the same قائد on his phone and a laptop is two
// open apps; the list shows him once, on the page he touched last.

const ONLINE_MS = 75 * 1000;
const PATH_MAX = 300;
const TITLE_MAX = 160;

const byToken = new Map(); // token -> { userId, path, title, since, at }

function prune(now = Date.now()) {
  for (const [token, p] of byToken) if (now - p.at > ONLINE_MS) byToken.delete(token);
}

/** A session that ended (sign-out): its app is gone with it. */
function forget(token) {
  if (token) byToken.delete(token);
}

function setupPresence(app, { db, requireAdmin }) {
  // { path: '/sessions/12', title: 'Séance du 8 novembre' } — the page's own heading
  app.post('/api/presence', (req, res) => {
    // The admin looking through «Voir en tant que» is not that account using the app
    if (req.impersonator) return res.status(204).end();
    const path = typeof req.body?.path === 'string' ? req.body.path.slice(0, PATH_MAX) : '';
    if (!path.startsWith('/')) return res.status(400).json({ error: 'invalid path' });
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, TITLE_MAX) || null : null;
    const now = Date.now();
    const prev = byToken.get(req.token);
    byToken.set(req.token, {
      userId: req.user.id,
      path,
      title,
      // How long on this page: kept while the page stays the same
      since: prev && prev.path === path ? prev.since : now,
      at: now,
    });
    prune(now);
    res.status(204).end();
  });

  app.delete('/api/presence', (req, res) => {
    if (!req.impersonator) forget(req.token);
    res.status(204).end();
  });

  // Every other account with the app open, by name: an order that jumped with each
  // 30 s heartbeat would move the row under the admin's finger
  app.get('/api/presence', requireAdmin, (req, res) => {
    const now = Date.now();
    prune(now);
    const latest = new Map(); // userId -> { ...entry, devices }
    for (const p of byToken.values()) {
      if (p.userId === req.user.id) continue;
      const seen = latest.get(p.userId);
      if (!seen) latest.set(p.userId, { ...p, devices: 1 });
      else {
        const devices = seen.devices + 1;
        latest.set(p.userId, p.at > seen.at ? { ...p, devices } : { ...seen, devices });
      }
    }
    const ids = [...latest.keys()];
    const users = ids.length
      ? db
          .prepare(
            `SELECT id, username, display_name, role, section FROM users
             WHERE active = 1 AND id IN (${ids.map(() => '?').join(',')})`
          )
          .all(...ids)
      : [];
    const items = users
      .map((u) => {
        const p = latest.get(u.id);
        return {
          user_id: u.id,
          name: u.display_name || u.username,
          role: u.role,
          section: u.role === 'admin' ? null : u.section ?? null,
          path: p.path,
          title: p.title,
          devices: p.devices,
          // Ages, not clocks: the phone's clock may be off, the server's own is not
          on_page_ms: now - p.since,
          seen_ms: now - p.at,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ items });
  });
}

module.exports = { setupPresence, forget };
