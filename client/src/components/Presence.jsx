import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, getToken } from '../api';
import { useAuth } from '../auth';
import { Popover, PopoverContent, PopoverTrigger } from './shadcn/popover';
import { cn, Spinner } from './ui';

/*
 * «En ligne»: who has the app open right now, and on which page. Every account's app
 * tells the server where it is (usePresenceBeacon, mounted once in Layout); only the
 * admin reads the list, behind a small pill at the top of the screen (PresenceButton).
 * The server keeps it in memory only (server/presence.js).
 */

// How often an app in front says it is still there; the server drops it after 75 s of silence
const BEAT_MS = 30_000;
// How often the admin's pill refreshes its count; faster while its list is open
const LIST_POLL_MS = 30_000;
const OPEN_POLL_MS = 10_000;
// Pages load lazily: wait for the heading to be on screen before naming the page
const SETTLE_MS = 1200;

// A detail page («Séance du 8 novembre», a عنصر's name) is named by its own heading. A
// list page is named by its tab alone, in the reader's language — its heading would only
// say the same thing again, in the language of whoever is on it.
function pageTitle(pathname) {
  if (pathname.split('/').filter(Boolean).length < 2) return null;
  return document.querySelector('#main h1')?.textContent?.trim() || null;
}

const beat = (pathname) => {
  if (document.visibilityState !== 'visible') return;
  api.post('/presence', { path: pathname, title: pageTitle(pathname) }).catch(() => {});
};

// The app went to the background or is closing: off the list now rather than in 75 s.
// A bare fetch with keepalive: it has to leave while the page is going away.
function leave() {
  const token = getToken();
  if (!token) return;
  fetch('/api/presence', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(
    () => {}
  );
}

/** Tells the server, while the app is in front, which page this account is on. */
export function usePresenceBeacon() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  // The admin looking through «Voir en tant que» is not that account using the app
  const on = !!user && !user.impersonated_by;

  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => beat(pathRef.current), BEAT_MS);
    const onVisibility = () => (document.visibilityState === 'visible' ? beat(pathRef.current) : leave());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', leave);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', leave);
    };
  }, [on, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- the account, not its object

  useEffect(() => {
    if (!on) return undefined;
    const id = setTimeout(() => beat(pathname), SETTLE_MS);
    return () => clearTimeout(id);
  }, [on, user?.id, pathname]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------- the list, shared: the sidebar's pill and the phone bar's read one copy ----------

let items = null; // null until the first answer
const listeners = new Set();
let mounted = 0;
let opened = 0;
let timer = null;

function load() {
  if (document.visibilityState !== 'visible') return;
  api
    .get('/presence')
    .then((r) => {
      if (!mounted) return;
      items = r.items || [];
      listeners.forEach((l) => l());
    })
    .catch(() => {}); // a failed poll keeps the previous list
}

function schedule() {
  clearInterval(timer);
  timer = mounted ? setInterval(load, opened ? OPEN_POLL_MS : LIST_POLL_MS) : null;
}

function usePresenceList(enabled, open) {
  useEffect(() => {
    if (!enabled) return undefined;
    if (mounted++ === 0) {
      load();
      document.addEventListener('visibilitychange', load);
    }
    schedule();
    return () => {
      if (--mounted === 0) {
        document.removeEventListener('visibilitychange', load);
        items = null; // the next admin starts from his own list
      }
      schedule();
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !open) return undefined;
    opened += 1;
    load();
    schedule();
    return () => {
      opened -= 1;
      schedule();
    };
  }, [enabled, open]);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items
  );
}

// ---------- the pill ----------

const LOCALES = { ar: 'ar-u-nu-latn', fr: 'fr-FR' };
const formats = {};
const unitFormat = (lng, unit) =>
  (formats[`${lng}${unit}`] ??= new Intl.NumberFormat(LOCALES[lng] || LOCALES.fr, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
  }));

// «depuis 4 min» / «منذ 4 د»: how long on this page
function fmtStay(ms, lng, t) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return t('presence.justNow');
  const time =
    minutes < 60 ? unitFormat(lng, 'minute').format(minutes) : unitFormat(lng, 'hour').format(Math.floor(minutes / 60));
  return t('presence.since', { time });
}

const initialsOf = (name) => name.slice(0, 2).toUpperCase();

/**
 * The admin's «en ligne» pill: a dot and how many other accounts have the app open.
 * Its list says who, on which page, for how long — each row opens that page.
 * `navItems`: the app's tabs (Layout's NAV_ITEMS), which name a page by its path.
 * `side`: 'bottom' under the phone bar, 'top' above the sidebar's footer.
 */
export function PresenceButton({ navItems, side = 'bottom', className }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const isAdmin = user?.role === 'admin' && !user.impersonated_by;
  const list = usePresenceList(isAdmin, open);
  if (!isAdmin) return null;

  const count = list?.length ?? 0;
  const label = t('presence.open', { count });
  const areaOf = (path) => {
    const item = navItems
      .filter(({ to, end }) => (end ? path === to : path === to || path.startsWith(`${to}/`)))
      .sort((a, b) => b.to.length - a.to.length)[0];
    return item ? t(item.key) : t('presence.otherPage');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            'focus-ring flex h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2.5 text-sm font-semibold tabular-nums transition-colors',
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground lg:h-9 lg:min-w-9',
            className
          )}
        >
          <span
            aria-hidden="true"
            className={cn('h-2 w-2 shrink-0 rounded-full', count > 0 ? 'bg-success' : 'bg-muted-foreground/40')}
          />
          <span aria-hidden="true">{list === null ? '–' : count}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="end"
        sideOffset={side === 'top' ? 8 : 6}
        aria-label={t('presence.title')}
        className="w-80 p-1.5"
      >
        <div className="flex items-baseline justify-between gap-2 px-2.5 pb-2 pt-1.5">
          <span className="text-sm font-semibold">{t('presence.title')}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{list === null ? '' : count}</span>
        </div>
        <div role="separator" className="-mx-1.5 mb-1.5 h-px bg-border" />
        {list === null ? (
          <div className="flex justify-center px-2.5 py-6 text-muted-foreground">
            <Spinner />
          </div>
        ) : count === 0 ? (
          <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">{t('presence.empty')}</p>
        ) : (
          <ul className="max-h-[min(24rem,var(--radix-popover-content-available-height))] space-y-0.5 overflow-y-auto">
            {list.map((p) => {
              const area = areaOf(p.path);
              const where = p.title ? `${area} · ${p.title}` : area;
              return (
                <li key={p.user_id}>
                  <Link
                    to={p.path}
                    onClick={() => setOpen(false)}
                    className="focus-ring flex min-h-12 items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <span
                      aria-hidden="true"
                      className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
                    >
                      {initialsOf(p.name)}
                      <span className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-popover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{p.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {fmtStay(p.on_page_ms, i18n.language, t)}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {where}
                        {p.devices > 1 && ` · ${t('presence.devices', { count: p.devices })}`}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <p className="px-2.5 pb-1 pt-2 text-xs text-muted-foreground">{t('presence.hint')}</p>
      </PopoverContent>
    </Popover>
  );
}
