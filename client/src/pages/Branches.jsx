import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFetch, useLocalStorage } from '../hooks';
import { branchName, fmtDate } from '../utils';
import SearchInput from '../components/SearchInput';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgressBar,
  Select,
  Skeleton,
  SkeletonPage,
  IconAward,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconInbox,
  IconShield,
  IconUsers,
} from '../components/ui';

/** One labelled number of the فرقة sheet — kept flat so four fit on a phone row. */
function Metric({ icon, label, value, hint }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="tabular mt-1 text-2xl font-bold leading-none">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground/80">{hint}</div>}
    </div>
  );
}

/** A نشاط row: header always visible, participants unfolded on demand. */
function SessionRow({ s }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <li className="px-4 py-3 sm:px-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="focus-ring flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md text-start"
      >
        <div className="min-w-40 flex-1">
          <div className="font-medium">{s.title}</div>
          <div className="text-xs text-muted-foreground">
            {fmtDate(s.date)}
            {s.leader && ` · ${s.leader}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="success">
            {s.present.length} {t('session.present')}
          </Badge>
          <Badge variant="destructive">
            {s.absent.length} {t('session.absent')}
          </Badge>
          <IconChevronDown className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-s-2 border-border ps-3">
          {s.matalib.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">{t('branch.matalib')}:</span>{' '}
              <span dir="ltr">{s.matalib.join(' · ')}</span>
            </div>
          )}
          {s.animators.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">{t('branch.animators')}:</span>{' '}
              {s.animators.map((a) => `${a.first_name} ${a.last_name}`).join(' · ')}
            </div>
          )}
          {s.present.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('branch.noParticipants')}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {s.present.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/members/${m.id}`}
                    className="focus-ring flex items-center gap-2 rounded-full border border-border py-1 pe-3 ps-1 text-xs transition-colors hover:bg-accent/50"
                  >
                    <Avatar photo={m.photo} name={`${m.first_name} ${m.last_name}`} className="h-6 w-6" />
                    {m.first_name} {m.last_name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {s.absent.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">{t('session.absent')}:</span>{' '}
              {s.absent.map((m) => `${m.first_name} ${m.last_name}`).join(' · ')}
            </p>
          )}
          <Link
            to={`/sessions/${s.id}`}
            className="focus-ring inline-block rounded text-xs font-medium text-primary hover:underline"
          >
            {t('branch.openSession')}
          </Link>
        </div>
      )}
    </li>
  );
}

/** أنشطة of the selected فرقة, newest first, paged so a long history stays usable. */
function BranchSessions({ branchId }) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(10);
  const [query, setQuery] = useState('');
  const res = useFetch(`/branches/${branchId}/sessions`);

  if (res.loading)
    return (
      <div className="space-y-3 p-4 sm:p-5">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  if (res.error)
    return (
      <div className="p-4">
        <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />
      </div>
    );

  const all = res.data || [];
  if (all.length === 0)
    return <EmptyState icon={<IconCalendar className="h-6 w-6" />} title={t('session.noSessions')} />;

  // Search covers what a قائد would look for: the نشاط, its date, its animator,
  // and the names of who took part — so "find the outing Yassine went to" works.
  const q = query.trim().toLowerCase();
  const sessions = !q
    ? all
    : all.filter((s) =>
        [
          s.title,
          s.date,
          s.leader,
          ...s.present.map((m) => `${m.first_name} ${m.last_name}`),
          ...s.absent.map((m) => `${m.first_name} ${m.last_name}`),
          ...s.animators.map((a) => `${a.first_name} ${a.last_name}`),
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );

  return (
    <>
      <div className="px-4 pb-3 pt-1 sm:px-5">
        <SearchInput
          value={query}
          onChange={(v) => {
            setQuery(v);
            setLimit(10);
          }}
          autoFocusHotkey={false}
          placeholder={t('branch.searchSessions')}
        />
      </div>
      {sessions.length === 0 ? (
        <EmptyState icon={<IconCalendar className="h-6 w-6" />} title={t('common.noResults')} />
      ) : (
        <ul className="divide-y divide-border">
          {sessions.slice(0, limit).map((s) => (
            <SessionRow key={s.id} s={s} />
          ))}
        </ul>
      )}
      {sessions.length > limit && (
        <div className="p-4 sm:p-5">
          <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + 20)}>
            {t('branch.showMore', { count: sessions.length - limit })}
          </Button>
        </div>
      )}
    </>
  );
}

export default function Branches() {
  const { t, i18n } = useTranslation();
  const res = useFetch('/branches/overview');
  const [selectedId, setSelectedId] = useLocalStorage('branches.selected', null);

  if (res.loading) return <SkeletonPage />;
  if (res.error)
    return <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />;

  const branches = res.data || [];
  if (branches.length === 0)
    return (
      <div className="space-y-6">
        <PageHeader title={t('branch.pageTitle')} description={t('branch.pageSubtitle')} />
        <EmptyState icon={<IconInbox className="h-6 w-6" />} title={t('dashboard.noBranches')} />
      </div>
    );

  // One فرقة at a time. A stale saved id (فرقة deleted) falls back to the first one.
  const b = branches.find((x) => x.id === selectedId) || branches[0];
  const name = branchName(b, i18n.language);
  const ages = b.max_age ? `${b.min_age}–${b.max_age} ${t('branch.years')}` : `${b.min_age}+`;
  const matalibPct = b.matalib.total
    ? Math.round((b.matalib.covered_count / b.matalib.total) * 100)
    : 0;
  // Empty توصيفات are hidden here: this page answers "who is in this فرقة", not "what is missing"
  const leaders = b.leaders.filter((l) => l.leader_id);

  return (
    <div className="space-y-6">
      <PageHeader title={t('branch.pageTitle')} description={t('branch.pageSubtitle')} />

      <div className="flex flex-wrap items-center gap-2">
        {/* Chips on a wide screen, a plain select on a phone — same state either way */}
        <div className="hidden flex-wrap gap-2 sm:flex">
          {branches.map((x) => (
            <Button
              key={x.id}
              size="sm"
              variant={x.id === b.id ? 'brand' : 'outline'}
              onClick={() => setSelectedId(x.id)}
            >
              {branchName(x, i18n.language)}
              <Badge variant="outline">{x.members.active}</Badge>
            </Button>
          ))}
        </div>
        <Select
          className="sm:hidden"
          value={b.id}
          onChange={(e) => setSelectedId(Number(e.target.value))}
          aria-label={t('member.branch')}
        >
          {branches.map((x) => (
            <option key={x.id} value={x.id}>
              {branchName(x, i18n.language)} ({x.members.active})
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{name}</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{ages}</Badge>
            {b.last_session && (
              <Badge variant="outline">
                {t('branch.lastSession')} · {fmtDate(b.last_session.date)}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <Metric
              icon={<IconUsers className="h-3.5 w-3.5" />}
              label={t('branch.members')}
              value={b.members.active}
              hint={t('branch.sexSplit', { male: b.members.male, female: b.members.female })}
            />
            <Metric
              icon={<IconCalendar className="h-3.5 w-3.5" />}
              label={t('branch.activities')}
              value={b.sessions_count}
              hint={t('branch.thisMonth', { count: b.sessions_month })}
            />
            <Metric
              icon={<IconCheck className="h-3.5 w-3.5" />}
              label={t('branch.attendanceRate')}
              value={b.attendance.rate !== null ? `${b.attendance.rate}%` : t('dashboard.noData')}
              hint={t('branch.presentAbsent', {
                present: b.attendance.present,
                absent: b.attendance.absent,
              })}
            />
            <Metric
              icon={<IconAward className="h-3.5 w-3.5" />}
              label={t('branch.matalib')}
              value={`${b.matalib.covered_count}/${b.matalib.total}`}
              hint={t('branch.matalibHint')}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="font-medium">{t('branch.matalibProgress')}</span>
              <span className="tabular-nums text-muted-foreground">{matalibPct}%</span>
            </div>
            <ProgressBar value={matalibPct} label={t('branch.matalibProgress')} />
            {b.matalib.covered_count > 0 && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground" dir="ltr">
                {b.matalib.covered.join(' · ')}
              </p>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <IconShield className="h-4 w-4 text-muted-foreground" />
              {t('branch.leaders')}
              {b.year && <span className="text-xs text-muted-foreground">· {b.year}</span>}
            </div>
            {leaders.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('branch.noLeaders')}</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {leaders.map((l) => (
                  <li key={l.id}>
                    <Link
                      to={`/leaders/${l.leader_id}`}
                      className="focus-ring flex items-center gap-3 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-accent/50"
                    >
                      <Avatar photo={l.photo} name={`${l.first_name} ${l.last_name}`} className="h-9 w-9" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {l.first_name} {l.last_name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{l.title}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t('branch.sessionsTitle')}</CardTitle>
          <Badge variant="outline">{b.sessions_count}</Badge>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {/* key: switching فرقة must refetch, not reuse the previous list */}
          <BranchSessions key={b.id} branchId={b.id} />
        </CardContent>
      </Card>
    </div>
  );
}
