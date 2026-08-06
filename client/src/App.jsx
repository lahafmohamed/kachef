import { Component, useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DirectionProvider } from '@radix-ui/react-direction';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
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
        <Layout>
          <ScrollToTop />
          <ErrorBoundary title={t('error.crashTitle')} retryLabel={t('error.reload')}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/members" element={<Members />} />
              <Route path="/members/:id" element={<MemberDetail />} />
              <Route path="/sessions" element={<Sessions />} />
              <Route path="/sessions/:id" element={<SessionDetail />} />
              <Route path="/promotions" element={<Promotions />} />
              <Route path="/leaders" element={<Leaders />} />
              <Route path="/leaders/:id" element={<LeaderDetail />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </Layout>
      </ConfirmProvider>
    </ToastProvider>
    </DirectionProvider>
  );
}
