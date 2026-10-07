import { useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, usePerms } from '../auth';
import { SECTIONS, isFeminine, useSection } from '../section';
import { ChangePasswordDialog } from '../pages/ChangePassword';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './shadcn/popover';
import { NotificationsBell, NotificationSettingsDialog, PushPrompt, usePushSync } from './Notifications';
import {
  cn,
  Dialog,
  SegmentedControl,
  useTheme,
  IconAward,
  IconBell,
  IconChevronDown,
  IconHome,
  IconUsers,
  IconCalendar,
  IconClipboard,
  IconTrendingUp,
  IconSettings,
  IconLanguages,
  IconLock,
  IconKey,
  IconLogout,
  IconMessages,
  IconMore,
  IconShield,
  IconSun,
  IconMoon,
  IconSwap,
  IconTent,
  IconWallet,
} from './ui';

const NAV_ITEMS = [
  { to: '/', key: 'nav.dashboard', short: 'nav.dashboardShort', Icon: IconHome, end: true },
  { to: '/branches', key: 'nav.branches', short: 'nav.branches', Icon: IconAward, perm: 'branches.read' },
  { to: '/members', key: 'nav.members', short: 'nav.members', Icon: IconUsers, perm: 'members.read' },
  { to: '/sessions', key: 'nav.sessions', short: 'nav.sessions', Icon: IconCalendar, perm: 'sessions.read' },
  { to: '/prep-cards', key: 'nav.prepCards', short: 'nav.prepCardsShort', Icon: IconClipboard, perm: 'sessions.read' },
  { to: '/events', key: 'nav.events', short: 'nav.eventsShort', Icon: IconTent, perm: 'sessions.read' },
  { to: '/meetings', key: 'nav.meetings', short: 'nav.meetings', Icon: IconMessages, perm: 'sessions.read' },
  { to: '/treasury', key: 'nav.treasury', short: 'nav.treasury', Icon: IconWallet, perm: 'treasury.read' },
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
          'focus-ring group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-[color,background-color,box-shadow] duration-150',
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
              'absolute -start-3 h-5 w-1 rounded-e-full bg-primary transition-[opacity,scale] duration-200',
              isActive ? 'opacity-0' : 'scale-y-0 opacity-0 group-hover:scale-y-100 group-hover:opacity-100'
            )}
          />
          <Icon className="h-[1.15rem] w-[1.15rem]" />
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
          'flex h-8 w-11 items-center justify-center rounded-full transition-[background-color,scale,box-shadow] duration-200',
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

/** `sub` names the قسم on screen under the app name, when there is one to name. */
function Brand({ className, sub }) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <img
        src="/logo-mark.png"
        alt={t('app.name')}
        width={90}
        height={90}
        className="h-11 w-11 shrink-0 lg:h-[90px] lg:w-[90px]"
      />
      <span className="min-w-0">
        <span className="block truncate text-base font-bold tracking-tight text-primary">{t('app.name')}</span>
        {sub && <span className="block truncate text-xs font-medium text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}

/**
 * الكل / الفتيان / الفتيات / الفرنكوفون — for an admin, or an account open on all أقسام. App
 * remounts every page on a new pick, so it all loads again for that قسم. A detail
 * page or a filtered list of the old قسم would only answer «forbidden» or nothing,
 * so the switch lands on the list page of the same tab.
 */
function SectionSwitcher({ onSwitched }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { canSwitch, view, setView } = useSection();
  if (!canSwitch) return null;
  const options = [{ value: '', label: t('section.all') }, ...SECTIONS.map((s) => ({ value: s, label: t(`section.${s}`) }))];
  return (
    <SegmentedControl
      size="sm"
      label={t('section.label')}
      value={view}
      onChange={(v) => {
        if (v === view) return;
        setView(v);
        navigate(`/${pathname.split('/')[1] || ''}`);
        onSwitched?.();
      }}
      className="flex w-full"
      // Five names do not fit side by side in the sidebar: two by two, «Tout» on its own row
      columns={options.length > 3 ? 2 : undefined}
      options={options}
    />
  );
}

function MenuItem({ icon, children, ...props }) {
  return (
    <button
      type="button"
      className="focus-ring flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-start text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
      {...props}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

// Up/Down step through a popover's items the way a menu does; Tab keeps working too.
function menuArrowKeys(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = [...e.currentTarget.querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  const next = e.key === 'ArrowDown' ? i + 1 : (i === -1 ? items.length : i) - 1;
  items[(next + items.length) % items.length]?.focus();
}

const initialsOf = (name) => name.slice(0, 2).toUpperCase();

/** Password, notifications, language, theme and the way out: the account popover, sidebar and phone bar alike. */
function AccountItems({ onChangePassword, onNotifications }) {
  const { t, i18n } = useTranslation();
  const { logout } = useAuth();
  const { theme, toggle } = useTheme();
  const isAr = i18n.language === 'ar';
  const dark = theme === 'dark';
  return (
    <>
      <MenuItem icon={<IconKey />} onClick={onChangePassword}>
        {t('auth.changePassword')}
      </MenuItem>
      <MenuItem icon={<IconBell />} onClick={onNotifications}>
        {t('push.settings')}
      </MenuItem>
      <MenuItem icon={<IconLanguages />} onClick={() => i18n.changeLanguage(isAr ? 'fr' : 'ar')}>
        {isAr ? 'Français' : 'العربية'}
      </MenuItem>
      <MenuItem icon={<IconSwap on={dark} onIcon={<IconSun />} offIcon={<IconMoon />} />} onClick={toggle}>
        {t(dark ? 'nav.lightMode' : 'nav.darkMode')}
      </MenuItem>
      <div role="separator" className="-mx-1.5 my-1.5 h-px bg-border" />
      <MenuItem icon={<IconLogout />} onClick={logout}>
        {t('auth.signOut')}
      </MenuItem>
    </>
  );
}

/** Opening and closing for an account popover, plus the dialogs it leads to (password, notifications). */
function useAccountPopover() {
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(null); // 'password' | 'notifications'
  const triggerRef = useRef(null);
  function openDialog(which) {
    // Park focus on the trigger before the dialog opens: the dialog hands focus
    // back to whatever held it when it opened, and this item is about to unmount.
    triggerRef.current?.focus();
    setOpen(false);
    setDialogOpen(which);
  }
  const close = () => setDialogOpen(null);
  const dialog = (
    <>
      <ChangePasswordDialog open={dialogOpen === 'password'} onClose={close} />
      <NotificationSettingsDialog open={dialogOpen === 'notifications'} onClose={close} />
    </>
  );
  return {
    open,
    setOpen,
    triggerRef,
    changePassword: () => openDialog('password'),
    openNotifications: () => openDialog('notifications'),
    dialog,
  };
}

const popoverMotion =
  'origin-(--radix-popover-content-transform-origin) p-1.5 data-[state=open]:animate-[dialog-in_var(--dur-base)_var(--ease-out-soft)] data-[state=closed]:animate-[dialog-out_var(--dur-fast)_ease-out_both]';

/**
 * Phone bar: the same account menu behind the signed-in user's initials. Five
 * icon buttons left the app name a few letters wide; two leave it whole. The
 * bell stays out of the menu for the same reason as in the sidebar.
 */
/** «قائد · قسم الفتيات»: the role, and the قسم an account is locked into. */
function useRoleLine() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { fixed } = useSection();
  // حساب في قسم الفتيات حسابُ قائدة
  const role = t(
    user?.role === 'admin' ? 'admin.roleAdmin' : isFeminine(fixed) ? 'section.roleUserF' : 'admin.roleUser'
  );
  return fixed ? `${role} · ${t(`section.name${fixed}`)}` : role;
}

function AccountButton() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { canSwitch } = useSection();
  const roleLine = useRoleLine();
  const { open, setOpen, triggerRef, changePassword, openNotifications, dialog } = useAccountPopover();
  if (!user) return null;
  const name = user.display_name || user.username;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`${t('nav.account')} — ${name}`}
          className="focus-ring group flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full"
        >
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-secondary text-xs font-semibold text-secondary-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground group-data-[state=open]:bg-accent group-data-[state=open]:text-accent-foreground"
          >
            {initialsOf(name)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={12}
        aria-label={t('nav.account')}
        onKeyDown={menuArrowKeys}
        className={cn('w-64', popoverMotion)}
      >
        {/* Who is signed in: the bar itself only shows the initials */}
        <div className="px-2.5 pb-2 pt-1.5 text-sm">
          <span className="block truncate font-medium">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{roleLine}</span>
        </div>
        <div role="separator" className="-mx-1.5 mb-1.5 h-px bg-border" />
        {/* No sidebar on a phone: the قسم switcher lives here, the bar names the pick */}
        {canSwitch && (
          <>
            <div className="space-y-1.5 px-1 pb-2 pt-0.5">
              <span className="block px-1.5 text-xs font-medium text-muted-foreground">{t('section.label')}</span>
              <SectionSwitcher onSwitched={() => setOpen(false)} />
            </div>
            <div role="separator" className="-mx-1.5 mb-1.5 h-px bg-border" />
          </>
        )}
        <AccountItems onChangePassword={changePassword} onNotifications={openNotifications} />
      </PopoverContent>
      {dialog}
    </Popover>
  );
}

/**
 * Sidebar footer: a single row saying who is signed in, with whatever is passed
 * as children (the bell) beside it. Password, language, theme and sign-out open
 * from that row in a popover instead of stacking up as full-width buttons, so
 * the nav above keeps the height. The bell stays outside on purpose — an unread
 * count hidden behind a click is a count nobody sees.
 */
function AccountMenu({ children }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const roleLine = useRoleLine();
  const { open, setOpen, triggerRef, changePassword, openNotifications, dialog } = useAccountPopover();
  if (!user) return null;

  const name = user.display_name || user.username;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Anchored on the whole row so the panel spans it, bell included */}
      <PopoverAnchor asChild>
        <div className="flex items-center gap-1">
          <PopoverTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              className="focus-ring group flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-xl p-1.5 text-start transition-colors hover:bg-accent data-[state=open]:bg-accent"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
              >
                {initialsOf(name)}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate font-medium">{name}</span>
                <span className="block truncate text-xs text-muted-foreground">{roleLine}</span>
              </span>
              {/* Points up while closed: the panel opens above the row */}
              <IconChevronDown className="rotate-180 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-data-[state=open]:rotate-0" />
            </button>
          </PopoverTrigger>
          {children}
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        sideOffset={8}
        aria-label={t('nav.account')}
        onKeyDown={menuArrowKeys}
        className={cn('w-(--radix-popover-trigger-width)', popoverMotion)}
      >
        <AccountItems onChangePassword={changePassword} onNotifications={openNotifications} />
      </PopoverContent>
      {dialog}
    </Popover>
  );
}

// Pages built as wide tables take the width of a big screen; every other page keeps
// the 1152px column, where a line of text stays readable
const WIDE_PAGES = ['/leaders'];

export default function Layout({ children }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const wide = WIDE_PAGES.includes(pathname);
  const { fixed, canSwitch, section } = useSection();
  // Under the app name: always the قسم an account is locked into; on a phone also the
  // admin's pick, since the switcher itself sits behind the account button there
  const lockedName = fixed ? t(`section.name${fixed}`) : null;
  const pickedName = section ? t(`section.name${section}`) : null;
  usePushSync();

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
          <Brand sub={lockedName} />
        </div>
        {canSwitch && (
          <div className="space-y-1.5 border-b border-border px-3 pb-3 pt-2.5">
            <span className="block px-1 text-xs font-medium text-muted-foreground">{t('section.label')}</span>
            <SectionSwitcher />
          </div>
        )}
        <nav aria-label={t('nav.primary')} className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          <SidebarNav />
        </nav>
        <div className="border-t border-border p-3">
          <AccountMenu>
            <NotificationsBell variant="ghost" />
          </AccountMenu>
        </div>
      </aside>

      {/* ---------- Mobile top bar ---------- */}
      {/* Slim (64px) so content owns the screen; the brand crop reads fine at 44px.
          Bell and account menu only, so the app name is never cut short. The bell
          is a round ghost beside the round initials — a bordered square there read
          as a second, unrelated control. */}
      <header data-app-bar className="glass safe-t sticky top-0 z-30 border-b border-border lg:hidden">
        <div className="flex h-16 items-center justify-between gap-2 px-3 sm:px-4">
          <Brand className="min-w-0" sub={pickedName} />
          <div className="flex shrink-0 items-center gap-1">
            <NotificationsBell variant="ghost" className="rounded-full" iconClassName="h-5 w-5" />
            <AccountButton />
          </div>
        </div>
      </header>

      <div className="relative lg:ps-64">
        <main
          id="main"
          className={cn(
            'relative mx-auto p-4 pb-[calc(var(--bottomnav-h)+1.5rem)] sm:p-6 lg:p-8 lg:pb-10',
            wide ? 'max-w-[100rem]' : 'max-w-6xl'
          )}
        >
          {/* Once, above the dashboard: switch push on for this device */}
          {pathname === '/' && <PushPrompt className="mb-6" />}
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
