import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  cn,
  Button,
  IconHome,
  IconUsers,
  IconCalendar,
  IconTrendingUp,
  IconSettings,
  IconLanguages,
} from './ui';

const NAV_ITEMS = [
  { to: '/', key: 'nav.dashboard', Icon: IconHome, end: true },
  { to: '/members', key: 'nav.members', Icon: IconUsers },
  { to: '/sessions', key: 'nav.sessions', Icon: IconCalendar },
  { to: '/promotions', key: 'nav.promotions', Icon: IconTrendingUp },
  { to: '/settings', key: 'nav.settings', Icon: IconSettings },
];

function NavItems({ vertical }) {
  const { t } = useTranslation();
  return NAV_ITEMS.map(({ to, key, Icon, end }) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap',
          vertical ? 'w-full' : '',
          isActive
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        )
      }
    >
      <Icon />
      {t(key)}
    </NavLink>
  ));
}

function LangToggle() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => i18n.changeLanguage(isAr ? 'fr' : 'ar')}
      className="gap-2"
    >
      <IconLanguages />
      {isAr ? 'Français' : 'العربية'}
    </Button>
  );
}

function Brand() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 font-bold">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow-sm">
        ⚜
      </span>
      <span className="bg-gradient-to-r from-emerald-700 to-teal-600 bg-clip-text text-transparent">
        {t('app.name')}
      </span>
    </div>
  );
}

export default function Layout({ children }) {
  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-40 hidden w-60 flex-col border-e border-border bg-card lg:flex">
        <div className="border-b border-border px-5 py-4">
          <Brand />
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          <NavItems vertical />
        </nav>
        <div className="border-t border-border p-3">
          <LangToggle />
        </div>
      </aside>

      {/* Mobile header + nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Brand />
          <LangToggle />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          <NavItems />
        </nav>
      </header>

      <div className="lg:ps-60">
        <div className="dot-grid pointer-events-none absolute inset-x-0 top-0 h-64 -z-10" />
        <main className="relative mx-auto max-w-6xl p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
