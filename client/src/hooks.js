import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';

/**
 * GET a path with real loading / error / reload states.
 * Every page used to `.catch(console.error)`, which left users staring at
 * "Loading…" forever when the request failed. This surfaces the failure.
 */
export function useFetch(path, { skip = false } = {}) {
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
        const res = await api.get(path);
        if (alive.current) setData(res);
      } catch (err) {
        if (alive.current) setError(err.message || 'error');
      } finally {
        if (alive.current) setLoading(false);
      }
    },
    [path, skip]
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
