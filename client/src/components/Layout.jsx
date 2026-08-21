import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth, usePerms } from '../auth';
import { branchName } from '../utils';
import {
  cn,
  Button,
  Dialog,
  EmptyState,
  Skeleton,
  useTheme,
  IconAward,
  IconBell,
  IconHome,
  IconInbox,
  IconUsers,
  IconCalendar,
  IconTrendingUp,
  IconSettings,
  IconLanguages,
  IconLock,
  IconLogout,
  IconMore,
  IconShield,
  IconSun,
  IconMoon,
} from './ui';

const NAV_ITEMS = [
  { to: '/', key: 'nav.dashboard', short: 'nav.dashboardShort', Icon: IconHome, end: true },
  { to: '/branches', key: 'nav.branches', short: 'nav.branches', Icon: IconAward, perm: 'branches.read' },
  { to: '/members', key: 'nav.members', short: 'nav.members', Icon: IconUsers, perm: 'members.read' },
  { to: '/sessions', key: 'nav.sessions', short: 'nav.sessions', Icon: IconCalendar, perm: 'sessions.read' },
  { to: '/promotions', key: 'nav.promotions', short: 'nav.promotions', Icon: IconTrendingUp, perm: 'promotions.read' },
  { to: '/leaders', key: 'nav.leaders', short: 'nav.leaders', Icon: IconShield, perm: 'leaders.read' },
  { to: '/settings', key: 'nav.settings', short: 'nav.settings', Icon: IconSettings, admin: true },
  { to: '/admin', key: 'nav.admin', short: 'nav.admin', Icon: IconLock, admin: true },
];

// Settings and user management only exist for admins; the other pages
// follow the per-account permission levels (null = everything).
function useNavItems() {
  const { user } = useAuth();
  const { can } = usePerms();
  return NAV_ITEMS.filter((item) => {
    if (item.admin) return user?.role === 'admin';
    return !item.perm || can(item.perm);
  });
}

function SidebarNav() {
  const { t } = useTranslation();
  return useNavItems().map(({ to, key, Icon, end }) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'focus-ring group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
          isActive
            ? 'ring-inset-light bg-primary text-primary-foreground shadow-brand'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Rail marker on the inline-start edge — reads in RTL too */}
          <span
            className={cn(
              'absolute -start-3 h-5 w-1 rounded-e-full bg-primary transition-all duration-200',
              isActive ? 'opacity-0' : 'scale-y-0 opacity-0 group-hover:scale-y-100 group-hover:opacity-100'
            )}
          />
          <Icon className={cn('h-[1.15rem] w-[1.15rem] transition-transform', !isActive && 'group-hover:scale-110')} />
          <span className="truncate">{t(key)}</span>
        </>
      )}
    </NavLink>
  ));
}

/* Shared look for one tab in the bottom bar. */
function TabInner({ Icon, label, active }) {
  return (
    <>
      {/* Active pill sits behind the icon so the tap target stays full-height */}
      <span
        className={cn(
          'flex h-8 w-11 items-center justify-center rounded-full transition-all duration-200',
          active ? 'bg-primary/14 scale-100 ring-1 ring-primary/20' : 'scale-90 bg-transparent'
        )}
      >
        <Icon className="h-[1.2rem] w-[1.2rem]" />
      </span>
      <span className="max-w-full truncate">{label}</span>
    </>
  );
}

const tabClass = (active) =>
  cn(
    'focus-ring relative flex h-[4.25rem] w-full flex-col items-center justify-center gap-1 px-0.5 text-[0.6875rem] font-medium leading-tight transition-colors',
    active ? 'text-primary' : 'text-muted-foreground'
  );

/**
 * Thumb-reachable tab bar — the primary navigation on phones.
 * Never more than five tabs: with six-plus destinations (admins see eight)
 * the first four stay put and the rest move behind a «More» sheet, so every
 * tab keeps a usable width on 320px-class phones.
 */
function BottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const items = useNavItems();
  const [moreOpen, setMoreOpen] = useState(false);

  const hasOverflow = items.length > 5;
  const visible = hasOverflow ? items.slice(0, 4) : items;
  const overflow = hasOverflow ? items.slice(4) : [];
  const isItemActive = ({ to, end }) =>
    end ? location.pathname === to : location.pathname.startsWith(to);
  const moreActive = overflow.some(isItemActive);

  return (
    <nav
      aria-label={t('nav.primary')}
      className="glass safe-b fixed inset-x-0 bottom-0 z-40 border-t border-border lg:hidden"
    >
      <ul className="flex items-stretch">
        {visible.map(({ to, short, Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink to={to} end={end} className={({ isActive }) => tabClass(isActive)}>
              {({ isActive }) => <TabInner Icon={Icon} label={t(short)} active={isActive} />}
            </NavLink>
          </li>
        ))}
        {hasOverflow && (
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={tabClass(moreActive)}
            >
              <TabInner Icon={IconMore} label={t('nav.more')} active={moreActive} />
            </button>
          </li>
        )}
      </ul>

      {hasOverflow && (
        <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title={t('nav.more')} size="sm">
          <ul className="space-y-1">
            {overflow.map((item) => {
              const { to, key, Icon } = item;
              const active = isItemActive(item);
              return (
                <li key={to}>
                  <Link
                    to={to}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'focus-ring flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary/12 text-primary'
                        : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="h-5 w-5" />
                    {t(key)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Dialog>
      )}
    </nav>
  );
}

function LangToggle({ compact }) {
  const { i18n, t } = useTranslation();
  const isAr = i18n.language === 'ar';
  return (
    <Button
      variant="outline"
      size={compact ? 'icon' : 'sm'}
      onClick={() => i18n.changeLanguage(isAr ? 'fr' : 'ar')}
      aria-label={t('nav.switchLang')}
      title={t('nav.switchLang')}
      className={compact ? '' : 'w-full gap-2'}
    >
      <IconLanguages />
      {!compact && (isAr ? 'Français' : 'العربية')}
    </Button>
  );
}

function ThemeToggle({ compact }) {
  const { theme, toggle } = useTheme();
  const { t } = useTranslation();
  const dark = theme === 'dark';
  return (
    <Button
      variant="outline"
      size={compact ? 'icon' : 'sm'}
      onClick={toggle}
      aria-label={t(dark ? 'nav.lightMode' : 'nav.darkMode')}
      title={t(dark ? 'nav.lightMode' : 'nav.darkMode')}
      className={compact ? '' : 'w-full gap-2'}
    >
      {dark ? <IconSun /> : <IconMoon />}
      {!compact && t(dark ? 'nav.lightMode' : 'nav.darkMode')}
    </Button>
  );
}

// created_at is UTC "YYYY-MM-DD HH:MM:SS" — parse as such, show local, latin digits
const notifTimeFormats = {};
function fmtNotifTime(createdAt, lng) {
  const locale = lng === 'ar' ? 'ar-u-nu-latn' : 'fr-FR';
  const f = (notifTimeFormats[locale] ??= new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }));
  return f.format(new Date(createdAt.replace(' ', 'T') + 'Z')).replace(/[‎‏؜]/g, '');
}

/**
 * جرس إشعارات الأدمن: ما فعله القادة على الأنشطة — إضافة، حضور، منشّطون، أعداد.
 * Polls the unread count once a minute; opening the panel marks everything seen.
 * Rendered only for admins — the server refuses everyone else anyway.
 */
function NotificationsBell({ compact }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState(null);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    const poll = () =>
      api
        .get('/notifications')
        .then((d) => alive && setUnread(d.unread_count))
        .catch(() => {}); // a failed poll just keeps the previous badge
    poll();
    const id = setInterval(poll, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [isAdmin]);

  if (!isAdmin) return null;

  async function openPanel() {
    setOpen(true);
    setItems(null);
    try {
      const d = await api.get('/notifications');
      setItems(d.items);
      // Everything shown is now seen — the badge restarts from zero
      await api.post('/notifications/seen');
      setUnread(0);
    } catch {
      setItems([]);
    }
  }

  const badge =
    unread > 0 ? (
      <span
        aria-hidden="true"
        className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.625rem] font-bold leading-none text-destructive-foreground"
      >
        {unread > 9 ? '9+' : unread}
      </span>
    ) : null;

  const label = unread > 0 ? t('notif.openUnread', { count: unread }) : t('notif.title');

  return (
    <>
      {compact ? (
        <Button variant="outline" size="icon" onClick={openPanel} aria-label={label} title={label} className="relative">
          <IconBell />
          {badge}
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={openPanel} className="w-full gap-2">
          <span className="relative inline-flex">
            <IconBell />
            {badge}
          </span>
          {t('notif.title')}
        </Button>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title={t('notif.title')}>
        {items === null ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<IconInbox className="h-6 w-6" />} title={t('notif.empty')} />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((n) => {
              const body = (
                <>
                  <span
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      n.unread ? 'bg-primary' : 'bg-transparent'
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      {t(`notif.${n.type}`, { actor: n.actor })}
                      {n.session_title && <span className="font-medium"> «{n.session_title}»</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {[branchName(n, i18n.language), fmtNotifTime(n.created_at, i18n.language)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={n.id}>
                  {n.session_id ? (
                    <Link
                      to={`/sessions/${n.session_id}`}
                      onClick={() => setOpen(false)}
                      className="focus-ring flex items-start gap-2.5 rounded-md px-1 py-2.5 transition-colors hover:bg-accent/50"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-2.5 px-1 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>
    </>
  );
}

function Brand({ className }) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {/* The source logo is portrait, with the wordmark under the emblem — this
          crop centres on the emblem alone, which is all that reads at 36px. */}
      <img
        src="/logo.png"
        alt={t('app.name')}
        width={90}
        height={90}
        className="h-11 w-11 shrink-0 rounded-lg object-cover object-[50%_18%] lg:h-[90px] lg:w-[90px] lg:rounded-none"
      />
      <span className="truncate text-base font-bold tracking-tight text-primary">
        {t('app.name')}
      </span>
    </div>
  );
}

/** Who is signed in + the way out. Compact icon-only variant for the mobile bar. */
function UserMenu({ compact }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  if (!user) return null;
  if (compact)
    return (
      <Button variant="outline" size="icon" onClick={logout} aria-label={t('auth.signOut')} title={t('auth.signOut')}>
        <IconLogout />
      </Button>
    );
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1 text-sm">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
          {(user.display_name || user.username).slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{user.display_name || user.username}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {t(user.role === 'admin' ? 'admin.roleAdmin' : 'admin.roleUser')}
          </span>
        </span>
      </div>
      <Button variant="outline" size="sm" onClick={logout} className="w-full gap-2">
        <IconLogout />
        {t('auth.signOut')}
      </Button>
    </div>
  );
}

export default function Layout({ children }) {
  const { t } = useTranslation();

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only-focusable focus-ring fixed start-4 top-4 z-[70] rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg"
      >
        {t('nav.skipToContent')}
      </a>

      {/* ---------- Desktop sidebar ---------- */}
      <aside className="fixed inset-y-0 start-0 z-40 hidden w-64 flex-col border-e border-border bg-card lg:flex">
        <div className="flex h-[106px] items-center border-b border-border px-5">
          <Brand />
        </div>
        <nav aria-label={t('nav.primary')} className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          <SidebarNav />
        </nav>
        <div className="flex flex-col gap-2 border-t border-border p-3">
          <UserMenu />
          <NotificationsBell />
          <LangToggle />
          <ThemeToggle />
        </div>
      </aside>

      {/* ---------- Mobile top bar ---------- */}
      {/* Slim (64px) so content owns the screen; the brand crop reads fine at 44px */}
      <header className="glass safe-t sticky top-0 z-30 border-b border-border lg:hidden">
        <div className="flex h-16 items-center justify-between gap-2 px-3 sm:px-4">
          <Brand className="min-w-0" />
          <div className="flex shrink-0 items-center gap-1">
            <NotificationsBell compact />
            <ThemeToggle compact />
            <LangToggle compact />
            <UserMenu compact />
          </div>
        </div>
      </header>

      <div className="relative lg:ps-64">
        <main
          id="main"
          className="relative mx-auto max-w-6xl p-4 pb-[calc(var(--bottomnav-h)+1.5rem)] sm:p-6 lg:p-8 lg:pb-10"
        >
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
