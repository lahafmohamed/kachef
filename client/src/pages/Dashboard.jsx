import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { branchName } from '../utils';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  IconUsers,
  IconTrendingUp,
  IconCalendar,
} from '../components/ui';

function StatCard({ icon, label, value, to }) {
  const inner = (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          {icon}
        </div>
        <div>
          <div className="bg-gradient-to-r from-emerald-700 to-teal-500 bg-clip-text text-3xl font-bold text-transparent">
            {value}
          </div>
          <div className="text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get('/stats').then(setStats).catch(console.error);
  }, []);

  if (!stats) return <p className="text-muted-foreground">{t('common.loading')}</p>;

  const total = stats.total_active;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          icon={<IconUsers className="h-5 w-5" />}
          label={t('dashboard.totalMembers')}
          value={total}
          to="/members"
        />
        <StatCard
          icon={<IconTrendingUp className="h-5 w-5" />}
          label={t('dashboard.pendingPromotions')}
          value={stats.pending_promotions}
          to="/promotions"
        />
        <StatCard
          icon={<IconCalendar className="h-5 w-5" />}
          label={t('dashboard.monthRate')}
          value={stats.month_rate !== null ? `${stats.month_rate}%` : t('dashboard.noData')}
          to="/sessions"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.byBranch')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {stats.branches.map((b) => {
            const pct = total ? Math.round((b.member_count / total) * 100) : 0;
            return (
              <div key={b.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{branchName(b, i18n.language)}</span>
                  <span className="text-muted-foreground">
                    {b.member_count} · {pct}%
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-teal-400 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('dashboard.branchActivity', {
                    activities: b.activities_count,
                    participants: b.participants_count,
                    total: b.member_count,
                  })}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
