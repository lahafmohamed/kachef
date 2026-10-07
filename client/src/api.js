const BASE = '/api';

const TOKEN_KEY = 'auth.token';

// sessionStorage, not localStorage: the session dies with the tab, so a shared or
// stolen machine cannot walk back into an account that was left open yesterday.
export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (t) => sessionStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

// الأقسام: 'M' الفتيان، 'F' الفتيات، 'FR' الفرنكوفون الفتيان، 'FRF' الفرنكوفونيات (see section.jsx). Twin of SECTION_DEFS
// in server/db.js — a new قسم is one line in each, plus its names in the locales
// (section.<code>, section.name<code>). gender: who its عناصر are (null = mixed), and
// whether its titles take the feminine (قائدة).
export const SECTION_DEFS = [
  { code: 'M', gender: 'M' },
  { code: 'F', gender: 'F' },
  { code: 'FR', gender: 'M' },
  { code: 'FRF', gender: 'F' },
];
export const SECTIONS = SECTION_DEFS.map((s) => s.code);
export const sectionGender = (code) => SECTION_DEFS.find((s) => s.code === code)?.gender ?? null;
export const isFeminine = (code) => sectionGender(code) === 'F';
const VIEW_KEY = 'view.section';

/** The قسم picked in the switcher, or '' for both. Tab-scoped, like the session token. */
export function getViewSection() {
  try {
    const v = sessionStorage.getItem(VIEW_KEY);
    return SECTIONS.includes(v) ? v : '';
  } catch {
    return '';
  }
}

export function setViewSection(v) {
  try {
    if (SECTIONS.includes(v)) sessionStorage.setItem(VIEW_KEY, v);
    else sessionStorage.removeItem(VIEW_KEY);
  } catch {
    /* private mode — the pick just lasts until the next reload */
  }
}

/**
 * Token, plus the قسم the screen is narrowed to. `section` overrides the switcher
 * for one call — '' asks for both أقسام, which a form choosing between them needs
 * (the server ignores the header for an account locked into one قسم anyway).
 */
function authHeaders(section) {
  const token = getToken();
  const s = section === undefined ? getViewSection() : section;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(s ? { 'X-Section': s } : {}),
  };
}

async function request(path, { section, ...options } = {}) {
  const res = await fetch(BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(section),
    },
    ...options,
  });
  if (!res.ok) throw await failure(res, path);
  return res.status === 204 ? null : res.json();
}

/** The error for a failed response — and the trip back to the login screen on a dead token. */
async function failure(res, path) {
  const body = await res.json().catch(() => ({}));
  // Expired or revoked token: bounce the whole app back to the login screen,
  // telling it whether the session simply timed out so it can say so.
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    clearToken();
    window.dispatchEvent(
      new CustomEvent('auth:expired', { detail: { reason: body.error || 'unauthorized' } })
    );
  }
  const err = new Error(body.error || res.statusText);
  err.status = res.status;
  // The rest of the payload rides along: a 409 names the record it collided with
  err.body = body;
  return err;
}

/** GET a file (PDF export) with the session token: { blob, filename }. */
async function download(path) {
  const res = await fetch(BASE + path, { headers: authHeaders() });
  if (!res.ok) throw await failure(res, path);
  const disposition = res.headers.get('Content-Disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  return { blob: await res.blob(), filename: m ? decodeURIComponent(m[1]) : null };
}

/** POST raw bytes (a file upload), with extra headers; JSON back. */
async function upload(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...authHeaders(), ...headers },
    body,
  });
  if (!res.ok) throw await failure(res, path);
  return res.json();
}

export const api = {
  get: (path, opts) => request(path, opts),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: (path) => request(path, { method: 'DELETE' }),
  download,
  upload,
};
