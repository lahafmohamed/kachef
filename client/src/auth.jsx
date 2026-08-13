import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, clearToken, getToken } from './api';

const AuthContext = createContext(null);

const USER_KEY = 'auth.user';

/**
 * Holds the logged-in user (id, username, display_name, role, branches).
 * `branches: null` means the account sees every فرقة; an array restricts it.
 * The user object is cached in localStorage so a reload doesn't flash the
 * login screen, then revalidated against /auth/me in the background.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return getToken() ? JSON.parse(localStorage.getItem(USER_KEY)) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  // Revalidate the cached user: role or scope may have changed server-side
  useEffect(() => {
    if (!getToken()) return;
    api
      .get('/auth/me')
      .then((u) => {
        setUser(u);
        localStorage.setItem(USER_KEY, JSON.stringify(u));
      })
      .catch(() => {}); // 401 already handled by the api layer
  }, []);

  async function login(username, password) {
    const { token, user: u } = await api.post('/auth/login', { username, password });
    setToken(token);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setUser(u);
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* token already dead — logging out locally is enough */
    }
    clearToken();
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** Access level for a page: none | view | edit. Admin or null perms = edit everywhere. */
function permLevel(user, key) {
  if (!user) return 'none';
  if (user.role === 'admin' || !user.perms) return 'edit';
  const p = user.perms;
  // Legacy array shape: a listed page meant full access
  if (Array.isArray(p)) return p.includes(key) ? 'edit' : 'none';
  return p[key] || 'none';
}

/** `can(page)` = may open it; `canEdit(page)` = may also create/modify/delete. */
export function usePerms() {
  const { user } = useAuth();
  return {
    can: (key) => permLevel(user, key) !== 'none',
    canEdit: (key) => permLevel(user, key) === 'edit',
  };
}
