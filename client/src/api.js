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
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Expired or revoked token: bounce the whole app back to the login screen,
    // telling it whether the session simply timed out so it can say so.
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      clearToken();
      window.dispatchEvent(
        new CustomEvent('auth:expired', { detail: { reason: body.error || 'unauthorized' } })
      );
    }
    throw new Error(body.error || res.statusText);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: (path) => request(path, { method: 'DELETE' }),
};
