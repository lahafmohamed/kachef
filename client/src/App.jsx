import { Component, Suspense, lazy, useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DirectionProvider } from '@radix-ui/react-direction';
import Layout from './components/Layout';
import { AuthProvider, useAuth, usePerms } from './auth';
import { SectionProvider, useSection } from './section';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ChangePasswordGate from './pages/ChangePassword';
import {
  Button,
  ConfirmProvider,
  EmptyState,
  SkeletonPage,
  ToastProvider,
  IconAlert,
  IconHome,
  IconInbox,
} from './components/ui';

/*
 * One chunk per page. A phone downloads and parses the shell, the sign-in screen and
 * the dashboard — the first screen of every visit — before it shows anything; every
 * other page arrives on its first visit, or earlier from the prefetch below — in this
 * order, the weekly attendance first. The perm mirrors the page's route, so a
 * restricted account never fetches what it can't open.
 */
const PAGES = {
  sessions: [() => import('./pages/Sessions'), 'sessions.read'],
  sessionDetail: [() => import('./pages/SessionDetail'), 'sessions.read'],
  members: [() => import('./pages/Members'), 'members.read'],
  memberDetail: [() => import('./pages/MemberDetail'), 'members.read'],
  branches: [() => import('./pages/Branches'), 'branches.read'],
  prepCards: [() => import('./pages/PrepCards'), 'sessions.read'],
  prepCardDetail: [() => import('./pages/PrepCardDetail'), 'sessions.read'],
  events: [() => import('./pages/Events'), 'sessions.read'],
  eventDetail: [() => import('./pages/EventDetail'), 'sessions.read'],
  meetings: [() => import('./pages/Meetings'), 'sessions.read'],
  meetingDetail: [() => import('./pages/MeetingDetail'), 'sessions.read'],
  treasury: [() => import('./pages/Treasury'), 'treasury.read'],
  leaders: [() => import('./pages/Leaders'), 'leaders.read'],
  leaderDetail: [() => import('./pages/LeaderDetail'), null],
  promotions: [() => import('./pages/Promotions'), 'promotions.read'],
  settings: [() => import('./pages/Settings'), 'admin'],
  admin: [() => import('./pages/Admin'), 'admin'],
};

const Branches = lazy(PAGES.branches[0]);
const Members = lazy(PAGES.members[0]);
const MemberDetail = lazy(PAGES.memberDetail[0]);
const Sessions = lazy(PAGES.sessions[0]);
const SessionDetail = lazy(PAGES.sessionDetail[0]);
const PrepCards = lazy(PAGES.prepCards[0]);
const PrepCardDetail = lazy(PAGES.prepCardDetail[0]);
const Events = lazy(PAGES.events[0]);
const EventDetail = lazy(PAGES.eventDetail[0]);
const Meetings = lazy(PAGES.meetings[0]);
const MeetingDetail = lazy(PAGES.meetingDetail[0]);
const Treasury = lazy(PAGES.treasury[0]);
const Promotions = lazy(PAGES.promotions[0]);
const Leaders = lazy(PAGES.leaders[0]);
const LeaderDetail = lazy(PAGES.leaderDetail[0]);
const Settings = lazy(PAGES.settings[0]);
const Admin = lazy(PAGES.admin[0]);
// Not prefetched: the sheet behind the PDF export, opened on screen only when the
// server has no Chromium. Chromium itself waits for `.print-sheet`, chunk included.
const PrintReport = lazy(() => import('./pages/PrintReport'));

let prefetched = false;

/**
 * Once the first screen is up, fetch the pages this account may open: a tap on the tab
 * bar then finds its page already downloaded, and a navigation never waits on the
 * network. Not straight away — the main thread sits idle while the dashboard waits for
 * its data, and two dozen downloads would compete with that one request on a slow
 * phone network — and one page at a time, so a page the user does open is never
 * queued behind the rest. Skipped when the phone asks to save data: pages then load on
 * their first visit, the old page staying on screen meanwhile (the router navigates in
 * a transition).
 */
function usePrefetchPages(signedIn) {
  const { user } = useAuth();
  const { can } = usePerms();
  useEffect(() => {
    if (!signedIn || prefetched || navigator.connection?.saveData) return undefined;
    let idle = null;
    const run = async () => {
      prefetched = true;
      for (const [load, perm] of Object.values(PAGES)) {
        const allowed = perm === 'admin' ? user?.role === 'admin' : !perm || can(perm);
        // Ignored here. The browser remembers a failed import, so after a dropped
        // connection that page fails again when opened — and main.jsx reloads once
        if (allowed) await load().catch(() => {});
      }
    };
    const timer = setTimeout(() => {
      if ('requestIdleCallback' in window) idle = requestIdleCallback(run, { timeout: 5000 });
      else run();
    }, 3000);
    return () => {
      clearTimeout(timer);
      if (idle !== null) cancelIdleCallback(idle);
    };
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps -- once per session
}

/** Keeps deep-linked pages from opening halfway down the previous scroll. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

function NotFound() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={<IconInbox className="h-6 w-6" />}
      title={t('error.notFoundTitle')}
      action={
        <Button variant="outline" onClick={() => navigate('/', { replace: true })}>
          <IconHome />
          {t('error.backHome')}
        </Button>
      }
    >
      {t('error.notFoundBody')}
    </EmptyState>
  );
}

/** A render error in one page shouldn't blank the whole app. */
class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const screen = (
      <EmptyState icon={<IconAlert className="h-6 w-6 text-destructive" />} title={this.props.title}>
        <span className="font-mono text-xs">{this.state.error.message}</span>
        <span className="mt-4 block">
          <Button variant="outline" onClick={() => window.location.reload()}>
            {this.props.retryLabel}
          </Button>
        </span>
      </EmptyState>
    );
    // On a print sheet the marker tells the PDF export to give up now, rather than
    // wait out its timeout for a `.print-sheet` that will never come
    return this.props.printError ? <div data-print-error="">{screen}</div> : screen;
  }
}

/** Routes only an admin may open; anyone else lands back on the dashboard. */
function AdminRoute({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (user?.role !== 'admin') navigate('/', { replace: true });
  }, [user, navigate]);
  return user?.role === 'admin' ? children : null;
}

function Shell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Mirrors the server rule; the server enforces it again on every request
  const { can } = usePerms();
  const location = useLocation();
  // Switching قسم remounts the pages, so every list and figure is fetched again for it
  const { view } = useSection();
  const onPrintSheet = location.pathname.startsWith('/print/');
  // Never on a print sheet: there the server's Chromium waits for the network to go
  // quiet before printing, and every PDF would wait for the whole app to download
  usePrefetchPages(!!user && !user.must_change_password && !onPrintSheet);

  // No session → nothing but the login screen, whatever the URL says
  if (!user) return <Login />;
  // A generated password is a bootstrap credential: the server serves no data
  // until it is replaced, so the app shows nothing else either
  if (user.must_change_password) return <ChangePasswordGate />;

  const isAdmin = user.role === 'admin';

  // Printable sheets (PDF export) render without the app chrome: no sidebar,
  // tab bar or header on the paper. Each sheet re-checks its page's permission.
  if (onPrintSheet)
    return (
      <ErrorBoundary printError title={t('error.crashTitle')} retryLabel={t('error.reload')}>
        {/* The sheet draws its own toolbar and loading state */}
        <Suspense fallback={null}>
          <Routes>
            <Route path="/print/:kind/:id" element={<PrintReport />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    );

  return (
    <Layout>
      <ScrollToTop />
      <ErrorBoundary key={view || 'all'} title={t('error.crashTitle')} retryLabel={t('error.reload')}>
        {/* A page's first visit: the shell stays put and the page area shows the
            skeleton until its chunk is in. Later visits switch straight over. */}
        <Suspense fallback={<SkeletonPage />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            {can('branches.read') && <Route path="/branches" element={<Branches />} />}
            {can('members.read') && <Route path="/members" element={<Members />} />}
            {can('members.read') && <Route path="/members/:id" element={<MemberDetail />} />}
            {can('sessions.read') && <Route path="/sessions" element={<Sessions />} />}
            {can('sessions.read') && <Route path="/sessions/:id" element={<SessionDetail />} />}
            {can('sessions.read') && <Route path="/prep-cards" element={<PrepCards />} />}
            {can('sessions.read') && <Route path="/prep-cards/:id" element={<PrepCardDetail />} />}
            {can('sessions.read') && <Route path="/events" element={<Events />} />}
            {can('sessions.read') && <Route path="/events/:id" element={<EventDetail />} />}
            {can('sessions.read') && <Route path="/meetings" element={<Meetings />} />}
            {can('sessions.read') && <Route path="/meetings/:id" element={<MeetingDetail />} />}
            {can('treasury.read') && <Route path="/treasury" element={<Treasury />} />}
            {can('promotions.read') && <Route path="/promotions" element={<Promotions />} />}
            {can('leaders.read') && <Route path="/leaders" element={<Leaders />} />}
            <Route path="/leaders/:id" element={<LeaderDetail />} />
            {isAdmin && <Route path="/settings" element={<Settings />} />}
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <Admin />
                </AdminRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}

export default function App() {
  const { t, i18n } = useTranslation();

  return (
    // Radix reads direction from this provider — without it, popovers and
    // select menus would align LTR even in Arabic.
    <DirectionProvider dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
    <ToastProvider>
      <ConfirmProvider
        labels={{
          confirmTitle: t('common.confirmTitle'),
          confirm: t('common.confirm'),
          cancel: t('common.cancel'),
        }}
      >
        <AuthProvider>
          <SectionProvider>
            <Shell />
          </SectionProvider>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
    </DirectionProvider>
  );
}
