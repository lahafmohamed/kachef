const BASE = '/api';

const TOKEN_KEY = 'auth.token';

// sessionStorage, not localStorage: the session dies with the tab, so a shared or
// stolen machine cannot walk back into an account that was left open yesterday.
export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (t) => sessionStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  return err;
}

/** GET a file (PDF export) with the session token: { blob, filename }. */
async function download(path) {
  const token = getToken();
  const res = await fetch(BASE + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw await failure(res, path);
  const disposition = res.headers.get('Content-Disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  return { blob: await res.blob(), filename: m ? decodeURIComponent(m[1]) : null };
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: (path) => request(path, { method: 'DELETE' }),
  download,
};
