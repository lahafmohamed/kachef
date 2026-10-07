import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';
import { branchName } from '../utils';
import { disablePush, enablePush, refreshPush, registerServiceWorker, testPush, usePushDevice } from '../lib/push';
import {
  cn,
  Button,
  Card,
  Dialog,
  EmptyState,
  SegmentedControl,
  Skeleton,
  useToast,
  IconAlert,
  IconBell,
  IconCalendar,
  IconClipboard,
  IconInbox,
  IconSettings,
  IconTent,
  IconUserCheck,
} from './ui';

/*
 * Notifications, for every account: the bell and its inbox, the settings sheet
 * (this device's push, and which kinds to hear about), and the one-time invitation
 * on the dashboard. What reaches whom is the server's call (server/push.js); texts
 * arrive written in both languages and are shown in the reader's.
 */

// ---------- time ----------

const LOCALES = { ar: 'ar-u-nu-latn', fr: 'fr-FR' };
const formats = {};
const cached = (key, make) => (formats[key] ??= make());

// created_at is UTC «YYYY-MM-DD HH:MM:SS». Under a minute: `justNow`; under a day:
// «il y a 5 min» / «قبل 5 دقائق»; older: day and hour. Latin digits in both languages.
function fmtAgo(createdAt, lng, justNow) {
  const locale = LOCALES[lng] || LOCALES.fr;
  const at = new Date(createdAt.replace(' ', 'T') + 'Z');
  const minutes = Math.round((Date.now() - at.getTime()) / 60000);
  const rel = cached(`rel${locale}`, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }));
  if (minutes < 1) return justNow;
  if (minutes < 60) return rel.format(-minutes, 'minute');
  if (minutes < 24 * 60) return rel.format(-Math.round(minutes / 60), 'hour');
  return cached(`abs${locale}`, () =>
    new Intl.DateTimeFormat(lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
  )
    .format(at)
    .replace(/[‎‏؜]/g, '');
}

// ---------- device ----------

/** Switching push on, with the answer said out loud. Call `enable` straight from a click. */
function useEnablePush() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function enable() {
    setBusy(true);
    try {
      const answer = await enablePush(i18n.language);
      if (answer === 'granted') toast.success(t('push.enabled'));
      else if (answer === 'denied') toast.error(t('push.blocked'));
    } catch {
      toast.error(t('push.enableFailed'));
    } finally {
      setBusy(false);
    }
  }
  return { enable, busy };
}

/**
 * Keeps this device's state current while the app is open: on sign-in, on a language
 * change (the server writes this device's notifications in it), and on coming back
 * to the tab — the permission may have been changed in the browser meanwhile.
 */
export function usePushSync() {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return undefined;
    refreshPush(i18n.language);
    const onVisible = () => document.visibilityState === 'visible' && refreshPush(i18n.language);
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user?.id, i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps -- the account, not its object
}

/**
 * Inside the router: registers the service worker, opens the page a tapped
 * notification points to in the tab already open (it keeps its session), and
 * refreshes the bell the moment a push lands.
 */
export function PushBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    registerServiceWorker();
    if (!('serviceWorker' in navigator)) return undefined;
    const onMessage = (e) => {
      if (e.data?.type === 'notification-click' && typeof e.data.url === 'string' && e.data.url.startsWith('/'))
        navigate(e.data.url);
      if (e.data?.type === 'notification-push') window.dispatchEvent(new Event('notifications:changed'));
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);
  return null;
}

// ---------- the bell ----------

const TYPE_ICONS = {
  session_created: IconCalendar,
  session_changed: IconCalendar,
  session_animator: IconUserCheck,
  attendance_missing: IconClipboard,
  event_created: IconTent,
};

function InboxItem({ n, onOpen }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const text = n.text?.[lng] || n.text?.ar || n.text?.fr || { title: '', body: '' };
  // The second line of a body says who did it: it reads as a footnote
  const [first, ...rest] = String(text.body || '').split('\n');
  const Icon = TYPE_ICONS[n.type] || IconBell;
  const body = (
    <>
      <span
        className={cn(
          'relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          n.unread ? 'bg-primary/12 text-primary' : 'bg-secondary text-muted-foreground'
        )}
      >
        <Icon className="h-[1.1rem] w-[1.1rem]" />
        {n.unread && (
          <span className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 text-sm leading-snug', n.unread ? 'font-semibold' : 'font-medium')}>
            {n.unread && <span className="sr-only">{t('push.unread')} — </span>}
            {text.title}
          </span>
          <time dateTime={n.created_at.replace(' ', 'T') + 'Z'} className="shrink-0 text-xs text-muted-foreground">
            {fmtAgo(n.created_at, lng, t('push.justNow'))}
          </time>
        </span>
        {first && (
          <span className="mt-0.5 block text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]">{first}</span>
        )}
        {rest.length > 0 && <span className="mt-0.5 block text-xs text-muted-foreground">{rest.join(' ')}</span>}
      </span>
    </>
  );
  return (
    <li>
      {n.url ? (
        <Link
          to={n.url}
          onClick={onOpen}
          className="focus-ring flex items-start gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-accent/50"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-start gap-3 px-2 py-3">{body}</div>
      )}
    </li>
  );
}

// The admin's log of what the قادة did on the أنشطة (server notifyAdmins)
function ActivityItem({ n, onOpen }) {
  const { t, i18n } = useTranslation();
  const body = (
    <>
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.unread ? 'bg-primary' : 'bg-transparent')} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm">
          {n.unread && <span className="sr-only">{t('push.unread')} — </span>}
          {t(`notif.${n.type}`, { actor: n.actor })}
          {n.session_title && <span className="font-medium"> «{n.session_title}»</span>}
        </span>
        <span className="block text-xs text-muted-foreground">
          {[branchName(n, i18n.language), fmtAgo(n.created_at, i18n.language, t('push.justNow'))]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
    </>
  );
  return (
    <li>
      {n.session_id ? (
        <Link
          to={`/sessions/${n.session_id}`}
          onClick={onOpen}
          className="focus-ring flex items-start gap-2.5 rounded-md px-1 py-2.5 transition-colors hover:bg-accent/50"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-start gap-2.5 px-1 py-2.5">{body}</div>
      )}
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3 py-1">
      <Skeleton className="h-14" />
      <Skeleton className="h-14" />
      <Skeleton className="h-14" />
    </div>
  );
}

/** Push is not on here yet: the inbox offers it where the notifications are read. */
function PushCallout({ onSettings }) {
  const { t } = useTranslation();
  const { state } = usePushDevice();
  const { enable, busy } = useEnablePush();
  if (state !== 'off' && state !== 'ios-install') return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-primary/20 bg-primary/6 p-3">
      <IconBell className="h-5 w-5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 basis-48 text-sm">
        {t(state === 'off' ? 'push.callout' : 'push.calloutIos')}
      </p>
      {state === 'off' ? (
        <Button size="sm" onClick={enable} loading={busy}>
          {t('push.enable')}
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onSettings}>
          {t('push.how')}
        </Button>
      )}
    </div>
  );
}

function NotificationsPanel({ open, onClose, counts, onSettings, isAdmin }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('mine');
  const [mine, setMine] = useState(null); // null loading · 'error' · []
  const [activity, setActivity] = useState(null);
  // Each list is marked read once per opening, the first time it is on screen
  const marked = useRef({ mine: false, activity: false });

  // Opening: the tab that has news first, both lists fetched fresh
  useEffect(() => {
    if (!open) return;
    setTab(isAdmin && !counts.unread && counts.activity_unread ? 'activity' : 'mine');
    setMine(null);
    setActivity(null);
    marked.current = { mine: false, activity: false };
    api
      .get('/me/notifications')
      .then((d) => setMine(d.items))
      .catch(() => setMine('error'));
    if (isAdmin)
      api
        .get('/notifications')
        .then((d) => setActivity(d.items))
        .catch(() => setActivity('error'));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- once per opening

  // What is on screen is now read: the badge restarts from zero. The rows keep their
  // dot until the panel closes, so the reader still sees which ones were new.
  useEffect(() => {
    if (!open) return;
    if (tab === 'mine' && Array.isArray(mine) && !marked.current.mine) {
      marked.current.mine = true;
      if (mine.some((n) => n.unread))
        api
          .post('/me/notifications/read', {})
          .then(() => setCounts((c) => ({ ...c, unread: 0 })))
          .catch(() => {});
    }
    if (tab === 'activity' && Array.isArray(activity) && !marked.current.activity) {
      marked.current.activity = true;
      api
        .post('/notifications/seen')
        .then(() => setCounts((c) => ({ ...c, activity_unread: 0 })))
        .catch(() => {});
    }
  }, [open, tab, mine, activity]);

  const list = tab === 'mine' ? mine : activity;
  const countLabel = (label, n) =>
    n > 0 ? (
      <span className="inline-flex items-center gap-1.5">
        {label}
        <span className="rounded-full bg-current/15 px-1.5 text-[0.6875rem] font-bold tabular-nums">{n > 9 ? '9+' : n}</span>
      </span>
    ) : (
      label
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('notif.title')}
      autoFocus={false}
      footer={
        <Button variant="ghost" size="sm" onClick={onSettings} className="-ms-2">
          <IconSettings />
          {t('push.settings')}
        </Button>
      }
    >
      {isAdmin && (
        <SegmentedControl
          label={t('notif.title')}
          value={tab}
          onChange={setTab}
          className="mb-3 flex w-full"
          options={[
            { value: 'mine', label: countLabel(t('push.tabMine'), counts.unread) },
            { value: 'activity', label: countLabel(t('push.tabActivity'), counts.activity_unread) },
          ]}
        />
      )}
      {tab === 'mine' && <PushCallout onSettings={onSettings} />}
      {list === null ? (
        <ListSkeleton />
      ) : list === 'error' ? (
        <EmptyState icon={<IconAlert className="h-6 w-6" />} title={t('error.loadFailed')} />
      ) : list.length === 0 ? (
        <EmptyState icon={<IconInbox className="h-6 w-6" />} title={t('push.empty')}>
          {tab === 'mine' ? t('push.emptyHint') : null}
        </EmptyState>
      ) : (
        <ul className={cn('-mx-2', tab === 'activity' && 'divide-y divide-border')}>
          {list.map((n) =>
            tab === 'mine' ? (
              <InboxItem key={n.id} n={n} onOpen={onClose} />
            ) : (
              <ActivityItem key={n.id} n={n} onOpen={onClose} />
            )
          )}
        </ul>
      )}
    </Dialog>
  );
}

// ---------- the unread count ----------
// One count for the whole app: the layout mounts two bells (sidebar, phone bar), and
// they share one poll — once a minute while the tab is in view, at once when a push
// lands (PushBridge) or the tab comes back.

const NO_COUNTS = { unread: 0, activity_unread: 0 };
let counts = NO_COUNTS;
const countListeners = new Set();
let pollers = 0;
let stopPolling = null;

function setCounts(next) {
  counts = typeof next === 'function' ? next(counts) : next;
  countListeners.forEach((l) => l());
}

function startPolling() {
  let alive = true;
  const poll = () => {
    if (document.visibilityState === 'hidden') return;
    api
      .get('/me/notifications/count')
      .then((c) => alive && setCounts({ unread: c.unread || 0, activity_unread: c.activity_unread || 0 }))
      .catch(() => {}); // a failed poll keeps the previous badge
  };
  poll();
  const id = setInterval(poll, 60_000);
  window.addEventListener('notifications:changed', poll);
  document.addEventListener('visibilitychange', poll);
  return () => {
    alive = false;
    clearInterval(id);
    window.removeEventListener('notifications:changed', poll);
    document.removeEventListener('visibilitychange', poll);
  };
}

function useNotificationCounts(userId) {
  useEffect(() => {
    if (!userId) return undefined;
    if (pollers++ === 0) stopPolling = startPolling();
    return () => {
      if (--pollers === 0) {
        stopPolling?.();
        stopPolling = null;
        setCounts(NO_COUNTS); // the next account starts from its own count
      }
    };
  }, [userId]);
  return useSyncExternalStore(
    (l) => {
      countListeners.add(l);
      return () => countListeners.delete(l);
    },
    () => counts
  );
}

/**
 * The bell, for every account: the notifications meant for it, plus — for an admin —
 * the log of what the قادة did.
 */
export function NotificationsBell({ variant = 'outline', className, iconClassName }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const counts = useNotificationCounts(user?.id);

  if (!user) return null;

  const unread = counts.unread + counts.activity_unread;
  // On an outlined button the count rides the corner; a ghost one has no visible
  // corner, so the count sits on the bell itself instead of floating off it
  const badge =
    unread > 0 ? (
      <span
        aria-hidden="true"
        className={cn(
          'absolute flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-destructive px-1 text-[0.6875rem] font-bold leading-none tabular-nums text-destructive-foreground ring-2 ring-card',
          variant === 'ghost' ? 'end-1 top-1' : '-end-1 -top-1'
        )}
      >
        {unread > 9 ? '9+' : unread}
      </span>
    ) : null;
  const label = unread > 0 ? t('notif.openUnread', { count: unread }) : t('notif.title');

  return (
    <>
      <Button
        variant={variant}
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className={cn('relative', className)}
      >
        <IconBell className={iconClassName} />
        {badge}
      </Button>
      <NotificationsPanel
        open={open}
        onClose={() => setOpen(false)}
        counts={counts}
        isAdmin={isAdmin}
        onSettings={() => {
          setOpen(false);
          setSettingsOpen(true);
        }}
      />
      <NotificationSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

// ---------- settings ----------

/** An on/off switch: the row's label names it, the change applies at once. */
function Switch({ id, checked, onChange, disabled, describedBy }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'focus-ring relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200',
        'disabled:cursor-default disabled:opacity-50',
        checked ? 'border-primary bg-primary' : 'border-border bg-muted'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'block h-5 w-5 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
          checked ? 'translate-x-6 rtl:-translate-x-6' : 'translate-x-0.5 rtl:-translate-x-0.5'
        )}
      />
    </button>
  );
}

const DEVICE_COPY = {
  on: { icon: IconBell, tone: 'text-success bg-success/12', title: 'push.state.on', hint: 'push.state.onHint' },
  off: { icon: IconBell, tone: 'text-muted-foreground bg-secondary', title: 'push.state.off', hint: 'push.state.offHint' },
  denied: { icon: IconAlert, tone: 'text-warning bg-warning/15', title: 'push.state.denied', hint: 'push.state.deniedHint' },
  'ios-install': { icon: IconBell, tone: 'text-primary bg-primary/12', title: 'push.state.iosInstall', hint: 'push.state.iosInstallHint' },
  unsupported: { icon: IconAlert, tone: 'text-muted-foreground bg-secondary', title: 'push.state.unsupported', hint: 'push.state.unsupportedHint' },
  unavailable: { icon: IconAlert, tone: 'text-muted-foreground bg-secondary', title: 'push.state.unavailable', hint: 'push.state.unavailableHint' },
  error: { icon: IconAlert, tone: 'text-destructive bg-destructive/10', title: 'push.state.error', hint: 'push.state.errorHint' },
};

function DeviceCard() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { state } = usePushDevice();
  const { enable, busy } = useEnablePush();
  const [working, setWorking] = useState(null); // 'test' | 'off'

  if (state === 'loading') return <Skeleton className="h-20 rounded-xl" />;
  const copy = DEVICE_COPY[state] || DEVICE_COPY.error;
  const Icon = copy.icon;

  async function sendTest() {
    setWorking('test');
    try {
      await testPush();
      toast.success(t('push.testSent'));
    } catch {
      toast.error(t('push.testFailed'));
    } finally {
      setWorking(null);
    }
  }
  async function turnOff() {
    setWorking('off');
    try {
      await disablePush();
      toast.success(t('push.disabled'));
    } catch {
      toast.error(t('push.disableFailed'));
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="rounded-xl border border-border p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', copy.tone)}>
          <Icon className="h-[1.1rem] w-[1.1rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t(copy.title)}</p>
          <p className="mt-0.5 text-sm text-muted-foreground [text-wrap:pretty]">{t(copy.hint)}</p>
        </div>
      </div>
      {(state === 'on' || state === 'off' || state === 'error') && (
        <div className="mt-3 flex flex-wrap gap-2 sm:ps-12">
          {state === 'on' && (
            <>
              <Button size="sm" variant="outline" onClick={sendTest} loading={working === 'test'} disabled={!!working}>
                {t('push.test')}
              </Button>
              <Button size="sm" variant="ghost" onClick={turnOff} loading={working === 'off'} disabled={!!working}>
                {t('push.disable')}
              </Button>
            </>
          )}
          {state === 'off' && (
            <Button size="sm" onClick={enable} loading={busy}>
              {t('push.enableHere')}
            </Button>
          )}
          {state === 'error' && (
            <Button size="sm" variant="outline" onClick={() => refreshPush(i18n.language)}>
              {t('error.retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function TypeRow({ type, enabled, hint, onChange, saving }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-medium">{t(`push.type.${type}`)}</span>
        {hint && (
          <span id={`${id}-hint`} className="mt-0.5 block text-xs text-muted-foreground [text-wrap:pretty]">
            {hint}
          </span>
        )}
      </label>
      <Switch
        id={id}
        checked={enabled}
        onChange={onChange}
        disabled={saving}
        describedBy={hint ? `${id}-hint` : undefined}
      />
    </li>
  );
}

/** What this account hears about (for the bell and every device), and this device's push. */
export function NotificationSettingsDialog({ open, onClose }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const prefs = useFetch('/me/notification-prefs', { skip: !open });
  const restricted = Array.isArray(user?.branches) && user?.role !== 'admin';
  const branches = useFetch('/branches', { skip: !open || !restricted });
  const [saving, setSaving] = useState(null);

  const mine = restricted
    ? (branches.data || []).filter((b) => user.branches.includes(b.id)).map((b) => branchName(b, i18n.language))
    : [];
  const hints = {
    session_created:
      restricted && mine.length
        ? t('push.typeHint.session_createdBranches', { branches: mine.join(i18n.language === 'ar' ? '، ' : ', ') })
        : t('push.typeHint.session_createdAll'),
    session_animator: t('push.typeHint.session_animator'),
    attendance_missing: t('push.typeHint.attendance_missing'),
  };

  async function toggle(type, enabled) {
    const previous = prefs.data;
    // Applied at once; put back if the server refuses
    prefs.setData((d) => ({ ...d, types: d.types.map((x) => (x.type === type ? { ...x, enabled } : x)) }));
    setSaving(type);
    try {
      prefs.setData(await api.put('/me/notification-prefs', { [type]: enabled }));
    } catch {
      prefs.setData(previous);
      toast.error(t('push.prefSaveFailed'));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('push.settings')} description={t('push.settingsHint')}>
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('push.deviceTitle')}</h3>
          <DeviceCard />
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('push.typesTitle')}</h3>
          {prefs.loading || !prefs.data ? (
            prefs.error ? (
              <EmptyState icon={<IconAlert className="h-6 w-6" />} title={t('error.loadFailed')} className="py-8" />
            ) : (
              <Skeleton className="h-40 rounded-xl" />
            )
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {prefs.data.types.map((p) => (
                <TypeRow
                  key={p.type}
                  type={p.type}
                  enabled={p.enabled}
                  hint={hints[p.type]}
                  saving={saving === p.type}
                  onChange={(v) => toggle(p.type, v)}
                />
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{t('push.typesNote')}</p>
        </section>
      </div>
    </Dialog>
  );
}

// ---------- dashboard invitation ----------

const LATER_KEY = 'push.prompt.later';
const LATER_DAYS = 30;

function askedRecently() {
  try {
    const at = Number(localStorage.getItem(LATER_KEY)) || 0;
    return Date.now() - at < LATER_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * Once, on the dashboard: push can be switched on here and is not. «Plus tard» puts
 * it away for a month on this device; the bell and the settings still offer it.
 */
export function PushPrompt({ className }) {
  const { t } = useTranslation();
  const { state } = usePushDevice();
  const { enable, busy } = useEnablePush();
  const [hidden, setHidden] = useState(askedRecently);
  if (hidden || state !== 'off') return null;
  function later() {
    try {
      localStorage.setItem(LATER_KEY, String(Date.now()));
    } catch {
      /* private mode: hidden until the next visit */
    }
    setHidden(true);
  }
  return (
    <Card className={cn('flex flex-wrap items-center gap-x-4 gap-y-3 p-4', className)}>
      <span className="bg-brand-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-primary ring-1 ring-primary/15">
        <IconBell className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-sm font-semibold">{t('push.prompt.title')}</p>
        <p className="mt-0.5 text-sm text-muted-foreground [text-wrap:pretty]">{t('push.prompt.body')}</p>
      </div>
      <div className="flex w-full gap-2 sm:w-auto">
        <Button variant="ghost" size="sm" onClick={later} className="flex-1 sm:flex-none">
          {t('push.prompt.later')}
        </Button>
        <Button size="sm" onClick={enable} loading={busy} className="flex-1 sm:flex-none">
          {t('push.enable')}
        </Button>
      </div>
    </Card>
  );
}
