// The permission catalog of the accounts page — the twin of the server's PERM_GROUPS,
// PERM_DEPENDENCIES and ACCOUNT_PRESETS (server/index.js), which have the last word.
// Each key's wording is admin.perm.<key with _ for .>, and admin.permHint.<…> when the
// label alone does not say everything it opens.

export const PERM_GROUPS = [
  {
    id: 'members',
    keys: [
      'members.read',
      'members.contact',
      'members.health',
      'members.followup',
      'members.create',
      'members.edit',
      'members.matalib',
      'members.admission',
      'members.delete',
      'members.dues.read',
      'members.dues.record',
      'members.dues.exempt',
    ],
  },
  {
    id: 'sessions',
    keys: [
      'sessions.read',
      'sessions.create',
      'sessions.edit',
      'sessions.attendance',
      'sessions.files',
      'sessions.read.fees',
      'sessions.money',
      'sessions.delete',
    ],
  },
  { id: 'prep', keys: ['prep.read', 'prep.manage', 'prep.delete'] },
  {
    id: 'events',
    keys: [
      'events.read',
      'events.manage',
      'events.attendance',
      'events.read.fees',
      'events.payments',
      'events.expenses',
      'events.delete',
    ],
  },
  { id: 'meetings', keys: ['meetings.read', 'meetings.manage', 'meetings.followup', 'meetings.delete'] },
  { id: 'evaluations', keys: ['evaluations.read', 'evaluations.details'] },
  { id: 'branches', keys: ['branches.read', 'branches.plan', 'branches.groups'] },
  { id: 'promotions', keys: ['promotions.read', 'promotions.apply'] },
  { id: 'leaders', keys: ['leaders.read', 'leaders.contact', 'leaders.progress.self', 'leaders.progress.manage'] },
  { id: 'dues', keys: ['leaders.dues', 'leaders.dues.record'] },
  { id: 'treasury', keys: ['treasury.read', 'treasury.entries', 'treasury.transfers', 'treasury.counts'] },
];

export const ALL_PERM_KEYS = PERM_GROUPS.flatMap((g) => g.keys);

// What each permission builds on: ticking one ticks its prerequisites, unticking one
// unticks what needs it — the form never shows a set the server would not keep
export const PERM_DEPENDENCIES = {
  'members.create': ['members.read'],
  'members.edit': ['members.read'],
  'members.delete': ['members.read'],
  'members.contact': ['members.read'],
  'members.followup': ['members.read'],
  'members.health': ['members.read'],
  'members.matalib': ['members.read'],
  'members.admission': ['members.read'],
  'members.dues.read': ['members.read'],
  'members.dues.record': ['members.dues.read'],
  'members.dues.exempt': ['members.dues.read'],
  'sessions.create': ['sessions.read'],
  'sessions.edit': ['sessions.read'],
  'sessions.attendance': ['sessions.read'],
  'sessions.files': ['sessions.read'],
  'sessions.read.fees': ['sessions.read'],
  'sessions.money': ['sessions.read.fees'],
  'sessions.delete': ['sessions.read'],
  'prep.manage': ['prep.read'],
  'prep.delete': ['prep.read'],
  'events.manage': ['events.read'],
  'events.attendance': ['events.read'],
  'events.read.fees': ['events.read'],
  'events.payments': ['events.read.fees'],
  'events.expenses': ['events.read.fees'],
  'events.delete': ['events.read'],
  'meetings.manage': ['meetings.read'],
  'meetings.followup': ['meetings.read'],
  'meetings.delete': ['meetings.read'],
  'evaluations.details': ['evaluations.read'],
  'branches.plan': ['branches.read'],
  'branches.groups': ['branches.read'],
  'promotions.apply': ['promotions.read', 'members.read'],
  'leaders.contact': ['leaders.read'],
  'leaders.progress.self': ['leaders.read'],
  'leaders.progress.manage': ['leaders.read'],
  'leaders.dues': ['leaders.read'],
  'leaders.dues.record': ['leaders.dues'],
  'treasury.entries': ['treasury.read'],
  'treasury.transfers': ['treasury.read'],
  'treasury.counts': ['treasury.read'],
};

// Ready-made sets, the same as a قائد's account gets from the قادة page (leader.preset_*).
// null = every right.
export const PERM_PRESETS = {
  branch: [
    'members.read', 'members.create', 'members.edit', 'members.contact', 'members.followup', 'members.health', 'members.matalib', 'members.admission',
    'sessions.read', 'sessions.create', 'sessions.edit', 'sessions.attendance', 'sessions.files',
    'prep.read', 'prep.manage',
    'events.read', 'events.manage', 'events.attendance',
    'meetings.read', 'meetings.manage', 'meetings.followup',
    'evaluations.read',
    'branches.read', 'branches.plan', 'branches.groups',
    'promotions.read',
    'leaders.read', 'leaders.contact', 'leaders.progress.self',
  ],
  amana: [
    'members.read',
    'sessions.read', 'sessions.create', 'sessions.edit', 'sessions.attendance', 'sessions.files',
    'prep.read', 'prep.manage',
    'events.read', 'events.manage', 'events.attendance',
    'meetings.read', 'meetings.manage', 'meetings.followup',
    'evaluations.read',
    'branches.read',
    'promotions.read',
    'leaders.read', 'leaders.contact', 'leaders.progress.self',
  ],
  readonly: [
    'members.read', 'sessions.read', 'prep.read', 'events.read', 'meetings.read', 'evaluations.read',
    'branches.read', 'promotions.read', 'leaders.read', 'leaders.contact',
  ],
  full: null,
};
export const PERM_PRESET_KEYS = Object.keys(PERM_PRESETS);

// What a new account starts with: everything but the money handed out by hand (the
// caisses, the dues) and what deletes or names — those are ticked one by one
const NOT_BY_DEFAULT = /^(treasury\.|leaders\.dues)|\.delete$|^evaluations\.details$/;
export const DEFAULT_PERMS = ALL_PERM_KEYS.filter((k) => !NOT_BY_DEFAULT.test(k));

export const permLabelKey = (key) => `admin.perm.${key.replace(/\./g, '_')}`;
export const permHintKey = (key) => `admin.permHint.${key.replace(/\./g, '_')}`;

export function withPerm(perms, key) {
  const out = new Set(perms);
  const add = (k) => {
    if (out.has(k)) return;
    out.add(k);
    (PERM_DEPENDENCIES[k] || []).forEach(add);
  };
  out.delete(key);
  add(key);
  return [...out];
}

export function withoutPerm(perms, key) {
  const out = new Set(perms);
  const drop = (k) => {
    if (!out.delete(k)) return;
    for (const [dependent, needs] of Object.entries(PERM_DEPENDENCIES)) if (needs.includes(k)) drop(dependent);
  };
  drop(key);
  return [...out];
}

/** The keys of a preset, every prerequisite included (null = all of them). */
export const presetPerms = (name) => {
  const keys = PERM_PRESETS[name];
  return keys === null ? [...ALL_PERM_KEYS] : keys.reduce(withPerm, []);
};
