import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFetch } from '../hooks';
import { usePerms } from '../auth';
import { avatarName, branchName, fmtDate, memberName } from '../utils';
import {
  Avatar,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  ProgressBar,
  SkeletonPage,
  StatTile,
  IconArrow,
  IconCake,
  IconCalendar,
  IconInbox,
  IconTrendingUp,
  IconUsers,
} from '../components/ui';

function StatCard({ to, ...tile }) {
  return (
    <Card interactive={!!to} className="overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <StatTile {...tile} />
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  // Mirrors the server rule. Skip fetches that would 403.
  const { can } = usePerms();
  const stats = useFetch('/stats');
  const sessions = useFetch('/sessions', { skip: !can('sessions.read') });

  if (stats.loading) return <SkeletonPage />;
  if (stats.error)
    return (
      <ErrorState message={t('error.loadFailed')} onRetry={stats.reload} retryLabel={t('error.retry')} />
    );

  const s = stats.data;
  const total = s.total_active;
  const recent = (sessions.data || []).slice(0, 4);
  const rateTone =
    s.month_rate === null ? 'plain' : s.month_rate >= 75 ? 'success' : s.month_rate >= 50 ? 'warning' : 'destructive';

  // A tile whose page the account cannot open would dead-end on 403 — drop it
  const tiles = [
    can('members.read') && {
      to: '/members',
      icon: <IconUsers className="h-5 w-5" />,
      label: t('dashboard.totalMembers'),
      value: total,
      hint: t('dashboard.activeMembers'),
    },
    can('promotions.read') && {
      to: '/promotions',
      icon: <IconTrendingUp className="h-5 w-5" />,
      label: t('dashboard.pendingPromotions'),
      value: s.pending_promotions,
      tone: s.pending_promotions > 0 ? 'warning' : 'brand',
      hint: s.pending_promotions > 0 ? t('dashboard.needsReview') : t('dashboard.allClear'),
    },
    can('sessions.read') && {
      to: '/sessions',
      icon: <IconCalendar className="h-5 w-5" />,
      label: t('dashboard.monthSessions'),
      value: s.month_sessions ?? 0,
      tone: 'brand',
      hint: t('dashboard.thisMonth'),
    },
    can('sessions.read') && {
      to: '/sessions',
      icon: <IconTrendingUp className="h-5 w-5" />,
      label: t('dashboard.monthRate'),
      value: s.month_rate !== null ? `${s.month_rate}%` : t('dashboard.noData'),
      tone: rateTone,
    },
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('dashboard.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.subtitle')}</p>
      </div>

      {/* Birthdays — today first, then tomorrow. Sits above the stats because
          it is time-critical: miss the day and the reminder is worthless. */}
      {s.birthdays?.length > 0 && (
        <div className="animate-fade-up space-y-2 rounded-xl border border-warning/35 bg-warning/10 p-3 sm:p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-warning">
            <IconCake className="h-4.5 w-4.5" />
            {t('birthday.title')}
          </div>
          <ul className="space-y-1.5">
            {s.birthdays.map((b) => (
              // Un chef et un membre peuvent partager le même id numérique
              <li key={`${b.kind || 'member'}-${b.id}`}>
                <Link
                  to={b.kind === 'leader' ? `/leaders/${b.id}` : `/members/${b.id}`}
                  className="focus-ring flex items-center gap-3 rounded-lg bg-card/70 px-3 py-2 transition-colors hover:bg-card"
                >
                  <Avatar photo={b.photo} name={avatarName(b)} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {memberName(b)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('birthday.turning', { age: b.turning })} ·{' '}
                      {b.kind === 'leader'
                        ? t('branch.leaders')
                        : branchName({ name_fr: b.branch_name_fr, name_ar: b.branch_name_ar }, i18n.language)}
                    </div>
                  </div>
                  <Badge variant={b.when === 'today' ? 'warning' : 'outline'}>
                    {t(b.when === 'today' ? 'birthday.today' : 'birthday.tomorrow')}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="stagger grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
        {/* Two tiles link to /sessions, so the label is the stable key */}
        {tiles.map((tile) => (
          <Link key={tile.label} to={tile.to} className="focus-ring rounded-xl">
            <StatCard {...tile} />
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.byBranch')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {s.branches.length === 0 ? (
            <EmptyState icon={<IconInbox className="h-6 w-6" />} title={t('dashboard.noBranches')} />
          ) : (
            s.branches.map((b) => {
              const pct = total ? Math.round((b.member_count / total) * 100) : 0;
              const name = branchName(b, i18n.language);
              return (
                <div key={b.id}>
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold">{name}</span>
                      {b.leader_name && (
                        <Link
                          to={`/leaders/${b.leader_id}`}
                          className="focus-ring rounded text-xs text-muted-foreground hover:text-primary hover:underline"
                        >
                          {t('leader.branchLeader')} · {b.leader_name}
                        </Link>
                      )}
                    </div>
                    <span className="tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">{b.member_count}</span> · {pct}%
                    </span>
                  </div>
                  <ProgressBar value={pct} label={name} />
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    {t('dashboard.branchActivity', {
                      activities: b.activities_count,
                      participants: b.participants_count,
                      total: b.member_count,
                    })}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {can('sessions.read') && (
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t('dashboard.recentSessions')}</CardTitle>
          <Link
            to="/sessions"
            className="focus-ring flex items-center gap-1 rounded text-sm font-medium text-primary hover:underline"
          >
            {t('dashboard.seeAll')}
            <IconArrow className="h-3.5 w-3.5 rtl:rotate-180" />
          </Link>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {sessions.error ? (
            <div className="px-4 py-2">
              <ErrorState message={t('error.loadFailed')} onRetry={sessions.reload} retryLabel={t('error.retry')} />
            </div>
          ) : sessions.loading ? (
            <div className="space-y-3 p-4 sm:p-5">
              <div className="skeleton h-12 rounded-md" />
              <div className="skeleton h-12 rounded-md" />
            </div>
          ) : recent.length === 0 ? (
            <EmptyState icon={<IconCalendar className="h-6 w-6" />} title={t('session.noSessions')} />
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((x) => (
                <li key={x.id}>
                  <Link
                    to={`/sessions/${x.id}`}
                    className="focus-ring flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-accent/50 sm:px-5"
                  >
                    <div className="min-w-40 flex-1">
                      <div className="font-medium">{x.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(x.date)} · {branchName(x, i18n.language)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="success">
                        {x.present_count} {t('session.present')}
                      </Badge>
                      <Badge variant="destructive">
                        {x.absent_count} {t('session.absent')}
                      </Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
