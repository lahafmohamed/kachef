import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  cn,
  Button,
  useTheme,
  IconHome,
  IconUsers,
  IconCalendar,
  IconTrendingUp,
  IconSettings,
  IconLanguages,
  IconShield,
  IconSun,
  IconMoon,
} from './ui';

const NAV_ITEMS = [
  { to: '/', key: 'nav.dashboard', short: 'nav.dashboardShort', Icon: IconHome, end: true },
  { to: '/members', key: 'nav.members', short: 'nav.members', Icon: IconUsers },
  { to: '/sessions', key: 'nav.sessions', short: 'nav.sessions', Icon: IconCalendar },
  { to: '/promotions', key: 'nav.promotions', short: 'nav.promotions', Icon: IconTrendingUp },
  { to: '/leaders', key: 'nav.leaders', short: 'nav.leaders', Icon: IconShield },
  { to: '/settings', key: 'nav.settings', short: 'nav.settings', Icon: IconSettings },
];

function SidebarNav() {
  const { t } = useTranslation();
  return NAV_ITEMS.map(({ to, key, Icon, end }) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'focus-ring group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        )
      }
    >
      {({ isActive }) => (
        <>
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
  return (
    <nav
      aria-label={t('nav.primary')}
      className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-lg lg:hidden"
    >
      <ul className="flex items-stretch">
        {NAV_ITEMS.map(({ to, short, Icon, end }) => (
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
                      isActive ? 'bg-primary/12 scale-100' : 'scale-90 bg-transparent'
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
      <span className="bg-brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-white shadow-sm">
        ⚜
      </span>
      <span className="text-brand-gradient truncate text-base font-bold tracking-tight">
        {t('app.name')}
      </span>
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
        <div className="flex h-16 items-center border-b border-border px-5">
          <Brand />
        </div>
        <nav aria-label={t('nav.primary')} className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          <SidebarNav />
        </nav>
        <div className="flex flex-col gap-2 border-t border-border p-3">
          <LangToggle />
          <ThemeToggle />
        </div>
      </aside>

      {/* ---------- Mobile top bar ---------- */}
      <header className="safe-t sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur-lg lg:hidden">
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <Brand />
          <div className="flex items-center gap-1.5">
            <ThemeToggle compact />
            <LangToggle compact />
          </div>
        </div>
      </header>

      <div className="lg:ps-64">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 overflow-hidden">
          <div className="dot-grid h-full w-full" />
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
