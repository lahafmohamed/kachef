import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { SECTIONS, getViewSection, setViewSection as storeViewSection } from './api';
import { useAuth } from './auth';

/**
 * القسمان: 'M' الفتيان، 'F' الفتيات. An account locked into one قسم (user.section)
 * sees nothing of the other; the server enforces it on every request. An admin, or
 * an account open on both, sees both and may narrow the whole app to one with the
 * switcher — the choice rides on every request as X-Section (api.js).
 */
export { SECTIONS };

const SectionContext = createContext(null);

export function SectionProvider({ children }) {
  const { user } = useAuth();
  const [view, setView] = useState(getViewSection);
  const change = useCallback((v) => {
    storeViewSection(v);
    setView(v);
  }, []);

  // A pick belongs to whoever made it: signing out (or another account signing in
  // on this tab) starts again from both أقسام
  const lastUser = useRef(user?.id ?? null);
  useEffect(() => {
    const id = user?.id ?? null;
    if (id === lastUser.current) return;
    lastUser.current = id;
    change('');
  }, [user?.id, change]);

  return <SectionContext.Provider value={{ view, setView: change }}>{children}</SectionContext.Provider>;
}

/**
 * fixed     — the قسم the account is locked into, or null (admin, or open on both)
 * section   — the قسم everything on screen belongs to: the fixed one, else the
 *             switcher's pick, else null for both
 * canSwitch — whether the switcher is offered at all
 */
export function useSection() {
  const { user } = useAuth();
  const ctx = useContext(SectionContext);
  const fixed = user && user.role !== 'admin' ? user.section || null : null;
  const view = ctx?.view || '';
  return {
    fixed,
    canSwitch: !!user && !fixed,
    section: fixed || view || null,
    view,
    setView: ctx?.setView ?? (() => {}),
  };
}
