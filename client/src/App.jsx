import { Component, useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DirectionProvider } from '@radix-ui/react-direction';
import Layout from './components/Layout';
import { AuthProvider, useAuth, usePerms } from './auth';
import Login from './pages/Login';
import Admin from './pages/Admin';
import Dashboard from './pages/Dashboard';
import Branches from './pages/Branches';
import Members from './pages/Members';
import MemberDetail from './pages/MemberDetail';
import Sessions from './pages/Sessions';
import SessionDetail from './pages/SessionDetail';
import Promotions from './pages/Promotions';
import Leaders from './pages/Leaders';
import LeaderDetail from './pages/LeaderDetail';
import Settings from './pages/Settings';
import {
  Button,
  ConfirmProvider,
  EmptyState,
  ToastProvider,
  IconAlert,
  IconHome,
  IconInbox,
} from './components/ui';

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
    return (
      <EmptyState icon={<IconAlert className="h-6 w-6 text-destructive" />} title={this.props.title}>
        <span className="font-mono text-xs">{this.state.error.message}</span>
        <span className="mt-4 block">
          <Button variant="outline" onClick={() => window.location.reload()}>
            {this.props.retryLabel}
          </Button>
        </span>
      </EmptyState>
    );
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

  // No session → nothing but the login screen, whatever the URL says
  if (!user) return <Login />;

  const isAdmin = user.role === 'admin';
  // Mirrors the server rule; the server enforces it again on every request
  const { can } = usePerms();

  return (
    <Layout>
      <ScrollToTop />
      <ErrorBoundary title={t('error.crashTitle')} retryLabel={t('error.reload')}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {can('branches') && <Route path="/branches" element={<Branches />} />}
          {can('members') && <Route path="/members" element={<Members />} />}
          {can('members') && <Route path="/members/:id" element={<MemberDetail />} />}
          {can('sessions') && <Route path="/sessions" element={<Sessions />} />}
          {can('sessions') && <Route path="/sessions/:id" element={<SessionDetail />} />}
          {can('promotions') && <Route path="/promotions" element={<Promotions />} />}
          {isAdmin && <Route path="/leaders" element={<Leaders />} />}
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
          <Shell />
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
    </DirectionProvider>
  );
}
