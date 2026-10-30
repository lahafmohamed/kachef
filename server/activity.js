// Statistiques d'activité — who uses the app, and for what.
//
// Every authenticated API call that succeeds is written to activity_log as one line:
// the account, the moment, the area of the app (sessions, members, caisses…) and a
// named action (sessions.attendance, members.create…). The audit journal only knows
// the writes; this journal also knows the reads, which is how an account that only
// looks is told apart from one that never opens the app at all.
//
// The classification is by the Express route pattern (req.route.path), never by the
// raw URL, so ids never leak into the action name. Routes that fire on their own —
// the session check, the notification poll, the lookups behind every form — are not
// activity and are skipped.

// Routes the client calls by itself, not because the person did something
const IGNORED = [
  /^\/api\/auth\//,
  /^\/api\/me\//,
  /^\/api\/notifications/,
  /^\/api\/activity/,
  /^\/api\/users\/username-suggestion$/,
  /^\/api\/members\/filters$/,
  /^\/api\/push/,
];
// Loaded as form data behind other pages: a read of them is not a visit
const IGNORED_READS = [/^\/api\/lookups/, /^\/api\/due-rates$/, /^\/api\/branches$/, /^\/api\/leaders$/];

// First path segment → area. Areas are the pages of the sidebar, plus the dashboard,
// the admin page and the PDF exports.
const AREA_OF = {
  dashboard: 'dashboard',
  reports: 'dashboard',
  branches: 'branches',
  plans: 'branches',
  members: 'members',
  'member-dues': 'members',
  'member-forms': 'members',
  'member-signups': 'members',
  'signup-links': 'members',
  'leader-forms': 'leaders',
  'leader-signups': 'leaders',
  'leader-signup-links': 'leaders',
  sessions: 'sessions',
  'prep-cards': 'prep',
  events: 'events',
  meetings: 'meetings',
  'meeting-decisions': 'meetings',
  treasury: 'treasury',
  promotions: 'promotions',
  leaders: 'leaders',
  'leader-matalib': 'leaders',
  'leader-dues': 'leaders',
  tachkila: 'leaders',
  'amana-rolls': 'leaders',
  amanat: 'leaders',
  settings: 'settings',
  'eval-forms': 'settings',
  lookups: 'settings',
  'due-rates': 'settings',
  users: 'admin',
  export: 'export',
};

const AREAS = [
  'dashboard', 'branches', 'members', 'sessions', 'prep', 'events', 'meetings',
  'treasury', 'promotions', 'leaders', 'settings', 'admin', 'export',
];

// [method or '*', route pattern, action]. First match wins; the action's area is its
// prefix. Keys have exactly one dot (area.action): the client nests them in i18n.
const W = 'POST|PUT|PATCH';
const RULES = [
  // sessions
  ['GET', '/api/sessions', 'sessions.list'],
  ['GET', '/api/sessions/:id', 'sessions.open'],
  ['POST', '/api/sessions', 'sessions.create'],
  ['PUT', '/api/sessions/:id', 'sessions.edit'],
  ['DELETE', '/api/sessions/:id', 'sessions.delete'],
  ['POST', '/api/sessions/:id/attendance', 'sessions.attendance'],
  ['POST', '/api/sessions/:id/animators', 'sessions.animators'],
  ['POST', '/api/sessions/:id/counts', 'sessions.counts'],
  ['*', '/api/sessions/:id/guests', 'sessions.guests'],
  ['*', '/api/sessions/:id/guests/:guestId', 'sessions.guests'],
  ['POST', '/api/sessions/:id/finalize', 'sessions.finalize'],
  ['POST', '/api/sessions/:id/reopen', 'sessions.reopen'],
  ['POST', '/api/sessions/:id/roster/sync', 'sessions.roster'],
  ['GET', '/api/sessions/:id/evaluation', 'sessions.evaluation_read'],
  ['PUT', '/api/sessions/:id/evaluation', 'sessions.evaluate'],
  ['DELETE', '/api/sessions/:id/evaluation', 'sessions.evaluation_delete'],
  ['DELETE', '/api/sessions/:id/evaluations/:eid', 'sessions.evaluation_delete'],
  ['GET', '/api/sessions/:id/history', 'sessions.history'],
  // members
  ['GET', '/api/members', 'members.list'],
  ['GET', '/api/members/:id', 'members.open'],
  ['POST', '/api/members', 'members.create'],
  ['PUT', '/api/members/:id', 'members.edit'],
  ['DELETE', '/api/members/:id', 'members.delete'],
  ['POST', '/api/members/archive', 'members.archive'],
  ['POST', '/api/members/:id/restore', 'members.restore'],
  ['POST', '/api/members/:id/matalib', 'members.matalib'],
  ['GET', '/api/members/:id/health', 'members.health_read'],
  ['PUT', '/api/members/:id/health', 'members.health'],
  ['GET', '/api/members/:id/contacts', 'members.contacts_read'],
  ['*', '/api/members/:id/contacts', 'members.contacts'],
  ['*', '/api/members/:id/contacts/:cid', 'members.contacts'],
  ['GET', '/api/members/:id/dues', 'members.dues_read'],
  ['*', '/api/members/:id/dues/:month', 'members.dues'],
  ['POST', '/api/members/:id/dues/settle', 'members.dues'],
  ['DELETE', '/api/members/:id/dues/payments/:pid', 'members.dues'],
  ['PUT', '/api/members/:id/dues-rate', 'members.dues_rate'],
  ['GET', '/api/members/:id/events', 'members.events'],
  ['GET', '/api/member-dues/arrears', 'members.arrears'],
  ['GET', '/api/member-forms', 'members.forms_read'],
  ['GET', '/api/member-forms/pending', 'members.forms_read'],
  ['POST', '/api/member-forms', 'members.forms_send'],
  ['POST', '/api/member-forms/:id/sent', 'members.forms_send'],
  ['POST', '/api/member-forms/:id/revoke', 'members.forms_send'],
  ['POST', '/api/member-forms/:id/apply', 'members.forms_review'],
  ['POST', '/api/member-forms/:id/reject', 'members.forms_review'],
  ['GET', '/api/signup-links', 'members.signups_read'],
  ['POST', '/api/signup-links', 'members.signups_send'],
  ['PUT', '/api/signup-links/:id', 'members.signups_send'],
  ['GET', '/api/member-signups', 'members.signups_read'],
  ['GET', '/api/member-signups/pending', 'members.signups_read'],
  ['POST', '/api/member-signups', 'members.signups_send'],
  ['POST', '/api/member-signups/:id/sent', 'members.signups_send'],
  ['POST', '/api/member-signups/:id/revoke', 'members.signups_send'],
  ['POST', '/api/member-signups/:id/apply', 'members.signups_review'],
  ['POST', '/api/member-signups/:id/reject', 'members.signups_review'],
  ['GET', '/api/leader-forms', 'leaders.forms_read'],
  ['GET', '/api/leader-forms/pending', 'leaders.forms_read'],
  ['POST', '/api/leader-forms', 'leaders.forms_send'],
  ['POST', '/api/leader-forms/:id/sent', 'leaders.forms_send'],
  ['POST', '/api/leader-forms/:id/revoke', 'leaders.forms_send'],
  ['POST', '/api/leader-forms/:id/apply', 'leaders.forms_review'],
  ['POST', '/api/leader-forms/:id/reject', 'leaders.forms_review'],
  ['GET', '/api/leader-signup-links', 'leaders.signups_read'],
  ['POST', '/api/leader-signup-links', 'leaders.signups_send'],
  ['PUT', '/api/leader-signup-links/:id', 'leaders.signups_send'],
  ['GET', '/api/leader-signups', 'leaders.signups_read'],
  ['GET', '/api/leader-signups/pending', 'leaders.signups_read'],
  ['POST', '/api/leader-signups', 'leaders.signups_send'],
  ['POST', '/api/leader-signups/:id/sent', 'leaders.signups_send'],
  ['POST', '/api/leader-signups/:id/revoke', 'leaders.signups_send'],
  ['POST', '/api/leader-signups/:id/apply', 'leaders.signups_review'],
  ['POST', '/api/leader-signups/:id/reject', 'leaders.signups_review'],
  // branches
  ['GET', '/api/branches/overview', 'branches.open'],
  ['GET', '/api/branches/:id/sessions', 'branches.sessions'],
  ['GET', '/api/branches/:id/money', 'branches.money'],
  ['GET', '/api/branches/:id/plan', 'branches.plan_read'],
  ['GET', '/api/branches/:id/plan/options', 'branches.plan_read'],
  ['GET', '/api/branches/:id/plan/sessions', 'branches.plan_read'],
  ['GET', '/api/plans/overview', 'branches.plan_read'],
  ['*', '/api/branches/:id/plan/:itemId/session', 'branches.plan'],
  ['*', '/api/branches/:id/plan/month', 'branches.plan'],
  ['*', '/api/branches/:id/plan/restore', 'branches.plan'],
  ['*', '/api/branches/:id/plan/validate', 'branches.plan'],
  ['GET', '/api/branches/:id/groups', 'branches.groups_read'],
  ['*', '/api/branches/:id/groups', 'branches.groups'],
  ['*', '/api/branches/:id/groups/:gid', 'branches.groups'],
  ['*', '/api/branches/:id/groups/assign', 'branches.groups'],
  ['*', '/api/branches/:id/groups/by-age', 'branches.groups'],
  ['*', '/api/branches/:id/group-limits', 'branches.groups'],
  ['*', '/api/branches/:id/matalib', 'branches.matalib'],
  ['*', '/api/branches/:id/matalib/copy', 'branches.matalib'],
  ['GET', '/api/branches/:id/responsibilities', 'branches.resp_read'],
  ['*', '/api/branches/:id/responsibilities', 'branches.resp'],
  ['*', '/api/branches/:id/responsibilities/:rid', 'branches.resp'],
  ['*', '/api/branches/:id/responsibilities/:rid/end', 'branches.resp'],
  ['POST', '/api/branches', 'branches.manage'],
  ['PUT', '/api/branches/:id', 'branches.manage'],
  ['DELETE', '/api/branches/:id', 'branches.manage'],
  // prep cards
  ['GET', '/api/prep-cards', 'prep.list'],
  ['GET', '/api/prep-cards/:id', 'prep.open'],
  ['POST', '/api/prep-cards', 'prep.create'],
  ['PUT', '/api/prep-cards/:id', 'prep.edit'],
  ['DELETE', '/api/prep-cards/:id', 'prep.delete'],
  // camps & courses
  ['GET', '/api/events', 'events.list'],
  ['GET', '/api/events/:id', 'events.open'],
  ['POST', '/api/events', 'events.create'],
  ['POST', '/api/events/:id/duplicate', 'events.create'],
  ['PUT', '/api/events/:id', 'events.edit'],
  ['DELETE', '/api/events/:id', 'events.delete'],
  ['GET', '/api/events/:id/candidates', 'events.participants_read'],
  ['*', '/api/events/:id/participants', 'events.participants'],
  ['*', '/api/events/:id/participants/:pid', 'events.participants'],
  ['PUT', '/api/events/:id/participants/:pid/checkin', 'events.checkin'],
  ['PUT', '/api/events/:id/participants/:pid/consent', 'events.consent'],
  ['GET', '/api/events/:id/participants/:pid/consent-scan', 'events.consent_read'],
  ['*', '/api/events/:id/sessions', 'events.program'],
  ['*', '/api/events/:id/sessions/:sid', 'events.program'],
  ['POST', '/api/events/:id/sessions/:sid/attendance', 'events.attendance'],
  ['*', '/api/events/:id/staff', 'events.staff'],
  ['*', '/api/events/:id/staff/:sid', 'events.staff'],
  ['*', '/api/events/:id/expenses', 'events.expenses'],
  ['*', '/api/events/:id/expenses/:xid', 'events.expenses'],
  ['*', '/api/events/:id/donations', 'events.donations'],
  ['*', '/api/events/:id/donations/:did', 'events.donations'],
  ['*', '/api/events/:id/fundings', 'events.fundings'],
  ['*', '/api/events/:id/fundings/:fid', 'events.fundings'],
  ['*', '/api/events/:id/checklist', 'events.checklist'],
  ['*', '/api/events/:id/checklist/:cid', 'events.checklist'],
  ['GET', '/api/events/:id/evaluation', 'events.evaluation_read'],
  ['PUT', '/api/events/:id/evaluation', 'events.evaluate'],
  ['DELETE', '/api/events/:id/evaluation', 'events.evaluation_delete'],
  ['DELETE', '/api/events/:id/evaluations/:eid', 'events.evaluation_delete'],
  // meetings
  ['GET', '/api/meetings', 'meetings.list'],
  ['GET', '/api/meetings/:id', 'meetings.open'],
  ['POST', '/api/meetings', 'meetings.create'],
  ['PUT', '/api/meetings/:id', 'meetings.edit'],
  ['DELETE', '/api/meetings/:id', 'meetings.delete'],
  ['PUT', '/api/meetings/:id/attendance', 'meetings.attendance'],
  ['*', '/api/meetings/:id/items', 'meetings.agenda'],
  ['*', '/api/meetings/:id/items/:iid', 'meetings.agenda'],
  ['*', '/api/meetings/:id/decisions', 'meetings.decisions'],
  ['*', '/api/meetings/:id/decisions/:did', 'meetings.decisions'],
  ['PUT', '/api/meetings/:id/decisions/:did/status', 'meetings.followup'],
  ['GET', '/api/meeting-decisions', 'meetings.decisions_read'],
  // treasury
  ['GET', '/api/treasury', 'treasury.open'],
  ['*', '/api/treasury/entries', 'treasury.entries'],
  ['*', '/api/treasury/entries/:xid', 'treasury.entries'],
  ['POST', '/api/treasury/entries/:xid/pay', 'treasury.pay'],
  ['*', '/api/treasury/transfers', 'treasury.transfers'],
  ['*', '/api/treasury/transfers/:xid', 'treasury.transfers'],
  ['*', '/api/treasury/counts', 'treasury.counts'],
  ['*', '/api/treasury/counts/:xid', 'treasury.counts'],
  ['PUT', '/api/treasury/opening', 'treasury.opening'],
  // promotions
  ['GET', '/api/promotions/pending', 'promotions.open'],
  ['GET', '/api/promotions/history', 'promotions.history'],
  ['GET', '/api/promotions/missing-birth-date', 'promotions.open'],
  ['GET', '/api/promotions/group-realign', 'promotions.open'],
  ['POST', '/api/promotions/validate', 'promotions.apply'],
  ['POST', '/api/promotions/:id/reverse', 'promotions.reverse'],
  // leadership
  ['GET', '/api/leaders/:id', 'leaders.open'],
  ['POST', '/api/leaders', 'leaders.create'],
  ['PUT', '/api/leaders/:id', 'leaders.edit'],
  ['DELETE', '/api/leaders/:id', 'leaders.delete'],
  ['POST', '/api/leaders/:id/account', 'leaders.account'],
  ['POST', '/api/leaders/:id/progress', 'leaders.progress'],
  ['GET', '/api/leaders/:id/dues', 'leaders.dues_read'],
  ['GET', '/api/leader-dues', 'leaders.dues_read'],
  ['PUT', '/api/leaders/:id/dues/:month', 'leaders.dues'],
  ['GET', '/api/leaders/:id/events', 'leaders.events'],
  ['GET', '/api/tachkila', 'leaders.tachkila_read'],
  ['*', '/api/tachkila', 'leaders.tachkila'],
  ['*', '/api/tachkila/:id', 'leaders.tachkila'],
  ['*', '/api/tachkila/copy', 'leaders.tachkila'],
  ['*', '/api/tachkila/fill', 'leaders.tachkila'],
  ['*', '/api/tachkila/lock', 'leaders.tachkila'],
  ['GET', '/api/leader-matalib', 'leaders.matalib_read'],
  ['*', '/api/leader-matalib', 'leaders.matalib'],
  ['*', '/api/leader-matalib/:id', 'leaders.matalib'],
  ['GET', '/api/amanat/:id/rolls', 'leaders.amana_read'],
  ['GET', '/api/amana-rolls/:id', 'leaders.amana_read'],
  ['*', '/api/amanat/:id/rolls', 'leaders.amana'],
  ['*', '/api/amana-rolls/:id', 'leaders.amana'],
  ['*', '/api/amana-rolls/:id/finalize', 'leaders.amana'],
  ['*', '/api/amana-rolls/:id/reopen', 'leaders.amana'],
  // settings
  ['GET', '/api/settings/followup', 'settings.open'],
  ['GET', '/api/settings/report', 'settings.open'],
  ['PUT', '/api/settings/followup', 'settings.edit'],
  ['PUT', '/api/settings/report', 'settings.edit'],
  ['GET', '/api/eval-forms', 'settings.eval_read'],
  ['*', '/api/eval-forms', 'settings.eval'],
  ['*', '/api/eval-forms/:id', 'settings.eval'],
  ['*', '/api/lookups', 'settings.lookups'],
  ['*', '/api/lookups/:id', 'settings.lookups'],
  ['*', '/api/due-rates', 'settings.dues'],
  ['*', '/api/due-rates/:id', 'settings.dues'],
  // accounts
  ['GET', '/api/users', 'admin.users_read'],
  ['POST', '/api/users', 'admin.users_create'],
  ['PUT', '/api/users/:id', 'admin.users_edit'],
  ['DELETE', '/api/users/:id', 'admin.users_delete'],
  ['POST', '/api/users/sync-branches', 'admin.users_sync'],
  // dashboard & exports
  ['GET', '/api/dashboard', 'dashboard.open'],
  ['GET', '/api/reports/period', 'dashboard.report'],
  ['GET', '/api/export/:kind/:id.pdf', 'export.pdf'],
].map(([m, p, a]) => [m === '*' ? null : new Set(m.split('|')), p, a]);

const byRoute = new Map();
for (const [methods, path, action] of RULES) {
  if (!byRoute.has(path)) byRoute.set(path, []);
  byRoute.get(path).push([methods, action]);
}

/**
 * The line to write for one finished request, or null when it is not activity.
 * `routePath` is req.route.path — the pattern, with its :params.
 */
function classifyActivity(method, routePath) {
  if (!routePath || IGNORED.some((re) => re.test(routePath))) return null;
  if (method === 'GET' && IGNORED_READS.some((re) => re.test(routePath))) return null;
  const write = method !== 'GET' && method !== 'HEAD';
  let action = null;
  for (const [methods, a] of byRoute.get(routePath) || []) {
    if (!methods || methods.has(method)) {
      action = a;
      break;
    }
  }
  if (!action) {
    const seg = routePath.split('/')[2] || '';
    const area = AREA_OF[seg];
    if (!area) return null;
    action = `${area}.${method === 'DELETE' ? 'delete' : write ? 'write' : 'read'}`;
  }
  return { area: action.split('.')[0], action, kind: write ? 'write' : 'read' };
}

// Each right of the accounts page, and the actions that use it. A right the account
// holds but never used over the period is what to tell its holder about. Read rights
// map to areas: holding members.read and never opening the members is the same gap.
const PERM_ACTIONS = {
  'members.read': { area: 'members' },
  'members.create': ['members.create'],
  'members.edit': ['members.edit'],
  'members.matalib': ['members.matalib'],
  'members.health': ['members.health', 'members.health_read'],
  'members.contact': ['members.contacts', 'members.contacts_read'],
  'members.dues.read': ['members.dues_read', 'members.arrears', 'members.dues'],
  'members.dues.record': ['members.dues'],
  'sessions.read': { area: 'sessions' },
  'sessions.create': ['sessions.create'],
  'sessions.edit': ['sessions.edit'],
  'sessions.attendance': ['sessions.attendance', 'sessions.animators', 'sessions.counts', 'sessions.guests'],
  'prep.read': { area: 'prep' },
  'prep.manage': ['prep.create', 'prep.edit'],
  'events.read': { area: 'events' },
  'events.manage': ['events.create', 'events.edit', 'events.participants', 'events.program', 'events.staff', 'events.checklist'],
  'events.attendance': ['events.attendance', 'events.checkin'],
  'events.expenses': ['events.expenses', 'events.donations', 'events.fundings'],
  'meetings.read': { area: 'meetings' },
  'meetings.manage': ['meetings.create', 'meetings.edit', 'meetings.attendance', 'meetings.agenda', 'meetings.decisions'],
  'meetings.followup': ['meetings.followup'],
  'evaluations.read': ['sessions.evaluation_read', 'events.evaluation_read'],
  'branches.read': { area: 'branches' },
  'branches.plan': ['branches.plan'],
  'branches.groups': ['branches.groups', 'branches.resp'],
  'promotions.read': { area: 'promotions' },
  'promotions.apply': ['promotions.apply', 'promotions.reverse'],
  'leaders.read': { area: 'leaders' },
  'leaders.progress.self': ['leaders.progress'],
  'leaders.progress.manage': ['leaders.progress'],
  'leaders.attendance': ['leaders.amana', 'leaders.amana_read'],
  'leaders.dues': ['leaders.dues_read', 'leaders.dues'],
  'leaders.dues.record': ['leaders.dues'],
  'treasury.read': { area: 'treasury' },
  'treasury.entries': ['treasury.entries', 'treasury.pay'],
  'treasury.transfers': ['treasury.transfers'],
  'treasury.counts': ['treasury.counts', 'treasury.opening'],
};

/**
 * The rights an account holds and never exercised: `held(key)` says whether it has
 * the right, `areas` / `actions` are the Sets it touched over the period.
 */
function unusedPerms(held, areas, actions) {
  const out = [];
  for (const [key, use] of Object.entries(PERM_ACTIONS)) {
    if (!held(key)) continue;
    const used = Array.isArray(use) ? use.some((a) => actions.has(a)) : areas.has(use.area);
    if (!used) out.push(key);
  }
  return out;
}

module.exports = { classifyActivity, unusedPerms, AREAS, PERM_ACTIONS };
