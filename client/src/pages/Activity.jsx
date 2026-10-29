import { Fragment, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFetch } from '../hooks';
import { fmtDate } from '../utils';
import { PERM_GROUPS } from '../lib/perms';
import { atDate, fmtAtDate, fmtWhen } from '../components/SessionHistory';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  cn,
  IconAlert,
  IconBack,
  IconCheck,
  IconClock,
  IconEye,
  IconKey,
  IconPencil,
  IconTrendingUp,
} from '../components/ui';

/*
 * Statistiques d'activité (admin) : quel compte utilise l'application, combien, pour
 * quoi — et les droits qu'il détient sans jamais s'en servir, ce qu'il faut lui dire.
 * Le serveur journalise chaque appel réussi d'un compte connecté (GET /api/activity
 * et /api/activity/users/:id, server/activity.js) ; les lectures comptent comme
 * « consultations », les écritures comme « saisies ».
 */

const PERIODS = [7, 30, 90, 365];

// The page of an area, for the trail's links. Areas without a detail page link nowhere.
const AREA_ROUTES = {
  sessions: '/sessions',
  members: '/members',
  events: '/events',
  meetings: '/meetings',
  prep: '/prep-cards',
  leaders: '/leaders',
};

const KIND_ICONS = { read: IconEye, write: IconPencil, login: IconKey };

const nameOf = (u) => u.display_name || u.username;

/** t('activity.action.sessions.attendance'), or the generic reading of the verb. */
function useLabels() {
  const { t } = useTranslation();
  const area = (a) => t(`activity.area.${a}`, { defaultValue: a });
  const action = (key) => {
    const [a, verb] = key.split('.');
    const generic = { read: 'genericRead', write: 'genericWrite', delete: 'genericDelete', list: 'genericList', open: 'genericOpen' }[verb];
    return t(`activity.action.${a}.${verb}`, {
      defaultValue: generic ? t(`activity.${generic}`, { area: area(a) }) : key,
    });
  };
  const perm = (key) => t(`admin.perm.${key.replace(/\./g, '_')}`, { defaultValue: key });
  return { area, action, perm };
}

// ---------- small parts ----------

/** Share bar: one hue, the figure beside it says the value. */
function Meter({ value, className, tone = 'bg-primary' }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <span aria-hidden="true" className={cn('block h-1.5 overflow-hidden rounded-full bg-muted', className)}>
      <span className={cn('block h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
    </span>
  );
}

function Figure({ value, label, className }) {
  return (
    <div className={cn('rounded-xl bg-muted/50 px-3 py-2.5', className)}>
      <div className="tabular text-2xl font-bold leading-none tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/** Bar list: one row per item, label, share bar, figures. */
function BarList({ items, max, labelOf, figureOf, hintOf }) {
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <span className="truncate text-sm">{labelOf(it)}</span>
          <span className="tabular text-sm font-medium">{figureOf(it)}</span>
          <Meter value={max ? (it.total / max) * 100 : 0} />
          <span className="text-xs text-muted-foreground">{hintOf?.(it)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One cell per day of the period, darker with more activity — a week per cell past
 * 90 days so a year still fits a phone. Hover or focus names the day and its figure.
 */
function DayStrip({ days, daily, figureOf, label }) {
  const { t } = useTranslation();
  const cells = useMemo(() => {
    const by = new Map(daily.map((d) => [d.day, d]));
    const out = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ day: iso, value: figureOf(by.get(iso)) });
    }
    if (days <= 90) return out;
    const weeks = [];
    for (let i = 0; i < out.length; i += 7) {
      const chunk = out.slice(i, i + 7);
      weeks.push({ day: chunk[0].day, to: chunk[chunk.length - 1].day, value: chunk.reduce((s, c) => s + c.value, 0) });
    }
    return weeks;
  }, [days, daily, figureOf]);
  const max = Math.max(1, ...cells.map((c) => c.value));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{fmtDate(cells[0].day)}</span>
        <span>{label}</span>
        <span>{t('activity.today')}</span>
      </div>
      <ul className="flex gap-px" aria-label={label}>
        {cells.map((c) => {
          const title = `${fmtDate(c.day)}${c.to ? ` → ${fmtDate(c.to)}` : ''} : ${c.value}`;
          return (
            <li key={c.day} className="min-w-0 flex-1">
              <span
                tabIndex={0}
                title={title}
                aria-label={title}
                className="focus-ring block h-7 rounded-[3px] bg-primary"
                style={{ opacity: c.value ? 0.25 + 0.75 * (c.value / max) : 0.06 }}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- ranking ----------

function AccountRow({ u, rank, max, onOpen }) {
  const { t, i18n } = useTranslation();
  const L = useLabels();
  const total = u.reads + u.writes;
  const idle = total === 0;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(u)}
        className="focus-ring grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-accent sm:px-5"
      >
        <span className="relative">
          <Avatar name={nameOf(u)} className={cn(idle && 'opacity-50')} />
          <span className="tabular absolute -start-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-card bg-card px-1 text-[0.6875rem] font-semibold text-muted-foreground shadow-xs">
            {rank}
          </span>
        </span>
        <span className="min-w-0 space-y-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={cn('truncate font-medium', idle && 'text-muted-foreground')}>{nameOf(u)}</span>
            {u.role === 'admin' && <Badge variant="outline">{t('admin.roleAdmin')}</Badge>}
            {!u.active && <Badge variant="secondary">{t('admin.inactive')}</Badge>}
            {u.unused.length > 0 && (
              <Badge variant="warning" className="hidden sm:inline-flex">
                {t('activity.unusedCount', { count: u.unused.length })}
              </Badge>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {idle
              ? u.last_seen_ever
                ? t('activity.lastSeenEver', { when: fmtWhen(u.last_seen_ever, i18n.language, t) })
                : t('activity.neverSeen')
              : t('activity.rowMeta', {
                  days: u.active_days,
                  logins: u.logins,
                  when: fmtWhen(u.last_at, i18n.language, t),
                })}
          </span>
          {!idle && (
            <span className="flex items-center gap-2">
              <Meter value={(total / max) * 100} className="w-28 shrink-0 sm:w-40" />
              <span className="truncate text-xs text-muted-foreground">
                {u.areas
                  .slice(0, 3)
                  .map((a) => L.area(a.area))
                  .join(' · ')}
              </span>
            </span>
          )}
        </span>
        <span className="tabular text-end">
          <span className={cn('block text-lg font-semibold leading-tight', idle && 'text-muted-foreground')}>
            {u.writes}
          </span>
          <span className="block text-[0.6875rem] text-muted-foreground">{t('activity.writes', { count: u.writes })}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t('activity.readsShort', { count: u.reads })}</span>
        </span>
      </button>
    </li>
  );
}

// ---------- detail ----------

/** Consecutive lines of the same action on the same thing fold into one «× n». */
function foldTrail(rows) {
  const out = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.action === r.action && last.entity_id === r.entity_id && Math.abs(atDate(last.created_at) - atDate(r.created_at)) < 15 * 60000) {
      last.times += 1;
      continue;
    }
    out.push({ ...r, times: 1 });
  }
  return out;
}

function TrailLine({ r }) {
  const { i18n } = useTranslation();
  const L = useLabels();
  const Icon = KIND_ICONS[r.kind] || IconEye;
  const entity = r.entity
    ? `${i18n.language === 'ar' && r.entity.label_ar ? r.entity.label_ar : r.entity.label}${r.entity.date ? ` · ${fmtDate(r.entity.date)}` : ''}`
    : r.entity_id && r.area !== 'export'
      ? `#${r.entity_id}`
      : r.area === 'export' && r.entity_id
        ? r.entity_id
        : null;
  const to = AREA_ROUTES[r.area] && r.entity_id && /^\d+$/.test(r.entity_id) ? `${AREA_ROUTES[r.area]}/${r.entity_id}` : null;
  const clock = atDate(r.created_at).toLocaleTimeString(i18n.language === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return (
    <li className="flex items-start gap-2.5 py-1.5 text-sm">
      <span dir="ltr" className="tabular w-11 shrink-0 pt-px text-xs text-muted-foreground">
        {clock}
      </span>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', r.kind === 'write' ? 'text-primary' : 'text-muted-foreground')} />
      <span className="min-w-0 flex-1">
        <span className={cn(r.kind === 'write' && 'font-medium')}>{r.kind === 'login' ? L.action('app.login') : L.action(r.action)}</span>
        {r.times > 1 && <span className="tabular ms-1 text-xs text-muted-foreground">× {r.times}</span>}
        {entity && (
          <span className="block truncate text-xs text-muted-foreground">
            {to ? (
              <Link to={to} className="focus-ring rounded hover:underline">
                {entity}
              </Link>
            ) : (
              entity
            )}
          </span>
        )}
      </span>
    </li>
  );
}

function AccountDetail({ id, days }) {
  const { t, i18n } = useTranslation();
  const L = useLabels();
  const { data, loading, error, reload } = useFetch(`/activity/users/${id}?days=${days}`);
  const [allTrail, setAllTrail] = useState(false);

  if (loading)
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  if (error || !data) return <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />;

  const { summary, areas, actions, daily, trail, unused } = data;
  const total = summary.reads + summary.writes;
  const areaItems = areas.map((a) => ({ key: a.area, total: a.reads + a.writes, ...a }));
  const actionItems = actions.slice(0, 10).map((a) => ({ key: a.action, total: a.n, ...a }));
  const unusedGroups = PERM_GROUPS.map((g) => ({ id: g.id, keys: g.keys.filter((k) => unused.includes(k)) })).filter(
    (g) => g.keys.length
  );
  const folded = foldTrail(trail);
  const shown = allTrail ? folded : folded.slice(0, 40);
  const byDay = [];
  for (const r of shown) {
    const day = fmtAtDate(r.created_at);
    const last = byDay[byDay.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else byDay.push({ day, rows: [r] });
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure value={summary.active_days} label={t('activity.kpi.activeDays')} />
        <Figure value={summary.logins} label={t('activity.kpi.logins')} />
        <Figure value={summary.writes} label={t('activity.kpi.writes')} />
        <Figure value={summary.reads} label={t('activity.kpi.reads')} />
      </div>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <IconClock className="h-4 w-4" />
        {summary.last_at
          ? t('activity.lastActivity', { when: fmtWhen(summary.last_at, i18n.language, t) })
          : summary.last_seen_ever
            ? t('activity.lastSeenEver', { when: fmtWhen(summary.last_seen_ever, i18n.language, t) })
            : t('activity.neverSeen')}
      </p>

      {total === 0 ? (
        <EmptyState icon={<IconClock className="h-6 w-6" />} title={t('activity.noActivityTitle')}>
          {t('activity.noActivityHint', { count: days })}
        </EmptyState>
      ) : (
        <>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('activity.byDay')}</h3>
            <DayStrip days={days} daily={daily} figureOf={(d) => (d ? d.reads + d.writes : 0)} label={t('activity.hits')} />
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('activity.byArea')}</h3>
            <BarList
              items={areaItems}
              max={areaItems[0]?.total}
              labelOf={(a) => L.area(a.area)}
              figureOf={(a) => a.total}
              hintOf={(a) => t('activity.readsWrites', { reads: a.reads, writes: a.writes })}
            />
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('activity.topActions')}</h3>
            <BarList
              items={actionItems}
              max={actionItems[0]?.total}
              labelOf={(a) => L.action(a.action)}
              figureOf={(a) => a.n}
              hintOf={(a) => fmtWhen(a.last_at, i18n.language, t)}
            />
          </section>
        </>
      )}

      {/* The point of the page: what this account could do and never did */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('activity.unusedTitle')}</h3>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">{t('activity.unusedNoData')}</p>
        ) : unusedGroups.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-success">
            <IconCheck className="h-4 w-4" />
            {t('activity.unusedNone')}
          </p>
        ) : (
          <div className="rounded-xl border border-warning/35 bg-warning/10 px-4 py-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <IconAlert className="h-4 w-4 text-warning" />
              {t('activity.unusedHint', { count: days })}
            </p>
            <dl className="space-y-2">
              {unusedGroups.map((g) => (
                <div key={g.id} className="text-sm">
                  <dt className="text-xs font-semibold text-muted-foreground">{t(`admin.permGroup.${g.id}`)}</dt>
                  <dd className="mt-0.5 flex flex-wrap gap-1.5">
                    {g.keys.map((k) => (
                      <Badge key={k} variant="outline" className="whitespace-normal bg-card">
                        {L.perm(k)}
                      </Badge>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </section>

      {trail.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('activity.trail')}</h3>
          {byDay.map((d) => (
            <Fragment key={d.day}>
              <h4 className="pt-2 text-xs font-semibold text-muted-foreground">{d.day}</h4>
              <ul className="divide-y divide-border/60">
                {d.rows.map((r) => (
                  <TrailLine key={r.id} r={r} />
                ))}
              </ul>
            </Fragment>
          ))}
          {folded.length > 40 && (
            <Button variant="outline" size="sm" onClick={() => setAllTrail((v) => !v)}>
              {allTrail ? t('history.showLess') : t('history.showAll', { count: folded.length })}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}

// ---------- page ----------

function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-24 rounded-2xl" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}

export default function Activity() {
  const { t, i18n } = useTranslation();
  const L = useLabels();
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [open, setOpen] = useState(null);
  const { data, loading, error, reload } = useFetch(`/activity?days=${days}`);

  const users = data?.users || [];
  const ranked = useMemo(
    () =>
      [...users]
        .filter((u) => u.active || u.reads + u.writes > 0)
        .sort((a, b) => b.reads + b.writes - (a.reads + a.writes) || b.writes - a.writes || b.logins - a.logins),
    [users]
  );
  const used = ranked.filter((u) => u.reads + u.writes > 0);
  const idle = ranked.filter((u) => u.reads + u.writes === 0);
  const totals = used.reduce(
    (s, u) => ({ reads: s.reads + u.reads, writes: s.writes + u.writes, logins: s.logins + u.logins }),
    { reads: 0, writes: 0, logins: 0 }
  );
  const max = Math.max(1, ...used.map((u) => u.reads + u.writes));
  const areaItems = (data?.areas || [])
    .map((a) => ({ key: a.area, total: a.reads + a.writes, ...a }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-6">
      <PageHeader title={t('activity.title')} description={t('activity.subtitle')}>
        <Button variant="outline" size="sm" onClick={() => navigate('/admin')}>
          <IconBack className="rtl:-scale-x-100" />
          {t('nav.admin')}
        </Button>
        <SegmentedControl
          size="sm"
          label={t('activity.period')}
          value={days}
          onChange={setDays}
          options={PERIODS.map((d) => ({ value: d, label: t(d === 365 ? 'activity.periodYear' : 'activity.periodShort', { count: d }) }))}
        />
      </PageHeader>

      {loading ? (
        <PageSkeleton />
      ) : error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4 sm:p-5">
              <span className="text-sm text-muted-foreground">{t('activity.kpi.activeAccounts')}</span>
              <span className="tabular mt-1 block text-3xl font-bold leading-tight tracking-tight">
                {used.length}
                <span className="text-base font-medium text-muted-foreground"> / {ranked.length}</span>
              </span>
              <span className="text-xs text-muted-foreground">{t('activity.kpi.activeAccountsHint', { count: days })}</span>
            </Card>
            <Card className="p-4 sm:p-5">
              <span className="text-sm text-muted-foreground">{t('activity.kpi.logins')}</span>
              <span className="tabular mt-1 block text-3xl font-bold leading-tight tracking-tight">{totals.logins}</span>
            </Card>
            <Card className="p-4 sm:p-5">
              <span className="text-sm text-muted-foreground">{t('activity.kpi.writes')}</span>
              <span className="tabular mt-1 block text-3xl font-bold leading-tight tracking-tight">{totals.writes}</span>
              <span className="text-xs text-muted-foreground">{t('activity.kpi.writesHint')}</span>
            </Card>
            <Card className="p-4 sm:p-5">
              <span className="text-sm text-muted-foreground">{t('activity.kpi.reads')}</span>
              <span className="tabular mt-1 block text-3xl font-bold leading-tight tracking-tight">{totals.reads}</span>
              <span className="text-xs text-muted-foreground">{t('activity.kpi.readsHint')}</span>
            </Card>
          </div>

          {data.tracking_since && (
            <p className="text-xs text-muted-foreground">
              {t('activity.trackingSince', { date: fmtAtDate(data.tracking_since) })}
            </p>
          )}

          {used.length === 0 ? (
            <Card>
              <EmptyState icon={<IconTrendingUp className="h-6 w-6" />} title={t('activity.emptyTitle')}>
                {data.tracking_since ? t('activity.emptyHint', { count: days }) : t('activity.emptyFirst')}
              </EmptyState>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t('activity.byDay')}</CardTitle>
                  <CardDescription>{t('activity.byDayHint')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <DayStrip days={days} daily={data.daily} figureOf={(d) => d?.hits || 0} label={t('activity.hits')} />
                </CardContent>
              </Card>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('activity.ranking')}</CardTitle>
                    <CardDescription>{t('activity.rankingHint')}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
                    <ul className="divide-y divide-border">
                      {used.map((u, i) => (
                        <AccountRow key={u.id} u={u} rank={i + 1} max={max} onOpen={setOpen} />
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>{t('activity.areasTitle')}</CardTitle>
                      <CardDescription>{t('activity.areasHint')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <BarList
                        items={areaItems}
                        max={areaItems[0]?.total}
                        labelOf={(a) => L.area(a.area)}
                        figureOf={(a) => a.total}
                        hintOf={(a) => t('activity.areaUsers', { count: a.users })}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>{t('activity.idleTitle', { count: idle.length })}</CardTitle>
                      <CardDescription>{t('activity.idleHint', { count: days })}</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
                      {idle.length === 0 ? (
                        <p className="flex items-center gap-2 px-5 pb-3 text-sm text-success">
                          <IconCheck className="h-4 w-4" />
                          {t('activity.idleNone')}
                        </p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {idle.map((u) => (
                            <li key={u.id}>
                              <button
                                type="button"
                                onClick={() => setOpen(u)}
                                className="focus-ring flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-accent sm:px-5"
                              >
                                <Avatar name={nameOf(u)} className="h-8 w-8 opacity-60" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">{nameOf(u)}</span>
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {u.last_seen_ever
                                      ? t('activity.lastSeenEver', { when: fmtWhen(u.last_seen_ever, i18n.language, t) })
                                      : t('activity.neverSeen')}
                                  </span>
                                </span>
                                {u.role === 'admin' && <Badge variant="outline">{t('admin.roleAdmin')}</Badge>}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? nameOf(open) : ''}
        description={
          open
            ? [
                open.role === 'admin' ? t('admin.roleAdmin') : t('admin.roleUser'),
                open.leader_name,
                t('activity.periodDays', { count: days }),
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        size="lg"
        autoFocus={false}
      >
        {open && <AccountDetail id={open.id} days={days} />}
      </Dialog>
    </div>
  );
}
