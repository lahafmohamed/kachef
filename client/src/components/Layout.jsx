import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, usePerms } from '../auth';
import {
  cn,
  Button,
  useTheme,
  IconAward,
  IconHome,
  IconUsers,
  IconCalendar,
  IconTrendingUp,
  IconSettings,
  IconLanguages,
  IconLock,
  IconLogout,
  IconShield,
  IconSun,
  IconMoon,
} from './ui';

const NAV_ITEMS = [
  { to: '/', key: 'nav.dashboard', short: 'nav.dashboardShort', Icon: IconHome, end: true },
  { to: '/branches', key: 'nav.branches', short: 'nav.branches', Icon: IconAward, perm: 'branches' },
  { to: '/members', key: 'nav.members', short: 'nav.members', Icon: IconUsers, perm: 'members' },
  { to: '/sessions', key: 'nav.sessions', short: 'nav.sessions', Icon: IconCalendar, perm: 'sessions' },
  { to: '/promotions', key: 'nav.promotions', short: 'nav.promotions', Icon: IconTrendingUp, perm: 'promotions' },
  { to: '/leaders', key: 'nav.leaders', short: 'nav.leaders', Icon: IconShield, admin: true },
  { to: '/settings', key: 'nav.settings', short: 'nav.settings', Icon: IconSettings, admin: true },
  { to: '/admin', key: 'nav.admin', short: 'nav.admin', Icon: IconLock, admin: true },
];

// التشكيلة, settings and user management only exist for admins; the other pages
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

/* Thumb-reachable tab bar — the primary navigation on phones. */
function BottomNav() {
  const { t } = useTranslation();
  const items = useNavItems();
  return (
    <nav
      aria-label={t('nav.primary')}
      className="glass safe-b fixed inset-x-0 bottom-0 z-40 border-t border-border lg:hidden"
    >
      <ul className="flex items-stretch">
        {items.map(({ to, short, Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'focus-ring relative flex h-[4.25rem] flex-col items-center justify-center gap-1 px-0.5 text-[0.625rem] font-medium leading-tight transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* Active pill sits behind the icon so the tap target stays full-height */}
                  <span
                    className={cn(
                      'flex h-8 w-11 items-center justify-center rounded-full transition-all duration-200',
                      isActive ? 'bg-primary/14 scale-100 ring-1 ring-primary/20' : 'scale-90 bg-transparent'
                    )}
                  >
                    <Icon className="h-[1.2rem] w-[1.2rem]" />
                  </span>
                  <span className="max-w-full truncate">{t(short)}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
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
        className="h-20 w-20 shrink-0 object-cover object-[50%_18%] lg:h-[90px] lg:w-[90px]"
      />
      <span className="text-brand-gradient truncate text-base font-bold tracking-tight">
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
          <LangToggle />
          <ThemeToggle />
        </div>
      </aside>

      {/* ---------- Mobile top bar ---------- */}
      <header className="glass safe-t sticky top-0 z-30 border-b border-border lg:hidden">
        <div className="flex h-24 items-center justify-between gap-2 px-4">
          <Brand />
          <div className="flex items-center gap-1.5">
            <ThemeToggle compact />
            <LangToggle compact />
            <UserMenu compact />
          </div>
        </div>
      </header>

      {/* `isolate` keeps the -z-10 backdrop above the body background instead of
          disappearing behind it (no positioned ancestor would otherwise exist). */}
      <div className="relative isolate lg:ps-64">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 overflow-hidden">
          <div className="aurora h-full w-full" />
        </div>
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
