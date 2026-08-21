import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, setToken, clearToken, getToken } from './api';
import { Button, Dialog } from './components/ui';

const AuthContext = createContext(null);

const USER_KEY = 'auth.user';

/** Matches the server's idle window; the server stays the authority. */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
/** How long before the cut-off the "still there?" prompt appears. */
const WARN_BEFORE_MS = 60 * 1000;
/** Deliberate gestures only — a stray mouse move should not keep a session alive. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

/**
 * Holds the logged-in user (id, username, display_name, role, branches).
 * `branches: null` means the account sees every فرقة; an array restricts it.
 * The user object is cached in sessionStorage so a reload doesn't flash the
 * login screen, then revalidated against /auth/me in the background. Session
 * storage — not local — so closing the tab ends the session.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return getToken() ? JSON.parse(sessionStorage.getItem(USER_KEY)) : null;
    } catch {
      return null;
    }
  });
  // Why the login screen is showing again: 'idle', 'session_expired' or null
  const [endedReason, setEndedReason] = useState(null);

  useEffect(() => {
    const onExpired = (e) => {
      setUser(null);
      sessionStorage.removeItem(USER_KEY);
      setEndedReason(e.detail?.reason || 'session_expired');
    };
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
        sessionStorage.setItem(USER_KEY, JSON.stringify(u));
      })
      .catch(() => {}); // 401 already handled by the api layer
  }, []);

  async function login(username, password) {
    const { token, user: u } = await api.post('/auth/login', { username, password });
    setToken(token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(u));
    setEndedReason(null);
    setUser(u);
  }

  /** `reason` is 'idle' when the inactivity timer fired, null when the user chose to leave.
   *  Call sites wired straight to onClick hand us an event — only strings count. */
  async function logout(reason = null) {
    const why = typeof reason === 'string' ? reason : null;
    try {
      await api.post('/auth/logout');
    } catch {
      /* token already dead — logging out locally is enough */
    }
    clearToken();
    sessionStorage.removeItem(USER_KEY);
    setEndedReason(why);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, endedReason }}>
      {children}
      <IdleGuard />
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

/**
 * Granular permission check ("members.read", "sessions.attendance", ...).
 * The server sends perms already normalized to the granular array; a stale
 * cached user may still carry an older shape, so page-name arrays and
 * {page: level} objects are read generously until /auth/me refreshes it.
 */
function has(user, key) {
  if (!user) return false;
  if (user.role === 'admin' || !user.perms) return true;
  const p = user.perms;
  const page = key.split('.')[0];
  if (Array.isArray(p)) return p.includes(key) || p.includes(page);
  return p[page] === 'edit' || (p[page] === 'view' && !/create|edit|delete|apply|attendance/.test(key));
}

export function usePerms() {
  const { user } = useAuth();
  return { has: (key) => has(user, key), can: (key) => has(user, key) };
}

/**
 * Signs the user out after IDLE_TIMEOUT_MS without a deliberate gesture, with a
 * one-minute warning first so nobody loses a half-typed form without notice.
 * The server enforces the same window; this only makes it visible and prompt.
 */
function IdleGuard() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [secondsLeft, setSecondsLeft] = useState(null); // non-null while warning
  const lastActivity = useRef(Date.now());
  const warning = useRef(false);
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    if (!user) {
      warning.current = false;
      setSecondsLeft(null);
      return;
    }
    lastActivity.current = Date.now();

    // Once the prompt is up, only its buttons may extend the session — a click
    // somewhere behind the dialog shouldn't silently cancel the warning.
    const bump = () => {
      if (!warning.current) lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, bump, { passive: true }));

    const tick = setInterval(() => {
      const left = IDLE_TIMEOUT_MS - (Date.now() - lastActivity.current);
      if (left <= 0) {
        warning.current = false;
        setSecondsLeft(null);
        logoutRef.current('idle');
      } else if (left <= WARN_BEFORE_MS) {
        warning.current = true;
        setSecondsLeft(Math.ceil(left / 1000));
      } else if (warning.current) {
        warning.current = false;
        setSecondsLeft(null);
      }
    }, 1000);

    return () => {
      clearInterval(tick);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [user]);

  function stay() {
    warning.current = false;
    lastActivity.current = Date.now();
    setSecondsLeft(null);
    api.get('/auth/me').catch(() => {}); // refresh the server-side idle clock too
  }

  if (secondsLeft === null) return null;

  return (
    <Dialog open onClose={stay} title={t('auth.idleTitle')} size="sm">
      {/* Announced once, without a per-second stream of screen-reader chatter */}
      <p role="alert" className="text-sm text-muted-foreground">
        {t('auth.idleBody')}
      </p>
      <p aria-hidden="true" className="mt-4 text-center text-3xl font-bold tabular-nums">
        {secondsLeft}
      </p>
      {/* Staying comes first in the DOM so the dialog's initial focus lands on
          the safe choice, while flex-row-reverse keeps it on the right */}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <Button variant="brand" onClick={stay}>
          {t('auth.idleStay')}
        </Button>
        <Button variant="outline" onClick={() => logout(null)}>
          {t('auth.signOut')}
        </Button>
      </div>
    </Dialog>
  );
}
