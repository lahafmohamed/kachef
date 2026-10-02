import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from './api';

/**
 * GET a path with real loading / error / reload states.
 * Every page used to `.catch(console.error)`, which left users staring at
 * "Loading…" forever when the request failed. This surfaces the failure.
 */
export function useFetch(path, { skip = false, section } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!skip);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(
    async ({ quiet = false } = {}) => {
      if (skip || !path) return;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        // `section` overrides the قسم switcher for this one list ('' = both أقسام)
        const res = await api.get(path, { section });
        if (alive.current) setData(res);
      } catch (err) {
        if (alive.current) setError(err.message || 'error');
      } finally {
        if (alive.current) setLoading(false);
      }
    },
    [path, skip, section]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** Debounce any fast-changing value (search inputs). */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * Back navigation that still works when a detail page is opened directly
 * (shared link, refresh, PWA cold start) — falls back to a known route
 * instead of leaving the app.
 */
export function useBack(fallback = '/') {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, location.key, fallback]);
}

/**
 * A list's filters, kept in its URL: «back» from a detail page lands on the same
 * list, and a link (the dashboard, an export) can open it already filtered.
 * `patch` builds on the live address, not the router's snapshot: two writes in the
 * same tick (two debounced fields landing together) would otherwise each start
 * from the same URL, and the second would drop the first's change. '' removes a key.
 */
export function useUrlFilters() {
  const [sp, setSp] = useSearchParams();
  const patch = useCallback(
    (changes) => {
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(changes)) v === '' || v == null ? next.delete(k) : next.set(k, String(v));
      setSp(next, { replace: true });
    },
    [setSp]
  );
  return [sp, patch];
}

/**
 * A text field mirrored into the URL. Typing stays on local state — the router
 * applies URL changes in a transition, and a controlled input fed from there
 * drops keystrokes — and the URL follows 250ms later. A change made elsewhere
 * (a chip, «clear») flows back into the field.
 */
export function useUrlField(sp, patch, key) {
  const fromUrl = sp.get(key) || '';
  const [value, setValue] = useState(fromUrl);
  const pushed = useRef(fromUrl);
  const debounced = useDebounced(value, 250);
  useEffect(() => {
    if (debounced === pushed.current) return;
    pushed.current = debounced;
    patch({ [key]: debounced });
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (fromUrl === pushed.current) return; // our own write coming back
    pushed.current = fromUrl;
    setValue(fromUrl);
  }, [fromUrl]);
  return [value, setValue];
}

/** Persist simple UI preferences (filters, view mode) across visits. */
export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota or private mode — preference just won't persist */
    }
  }, [key, value]);
  return [value, setValue];
}
