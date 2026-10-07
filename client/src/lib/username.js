// Mirrors the server's USERNAME_RE: what a login name may look like. Kept out of the
// pages that use it (الإدارة، القادة): a page module that also exports constants cannot
// be hot-reloaded in place, and Vite reloads everything that imports it instead.
export const USERNAME_RE = /^[a-z][a-z0-9._-]{2,31}$/;
export const USERNAME_PATTERN = '[a-z][a-z0-9._\\-]{2,31}';
