import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useFetch, useLocalStorage } from '../hooks';
import { toDate, toISO } from '../lib/date';
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
  Input,
  PageHeader,
  ProgressBar,
  Select,
  Skeleton,
  SkeletonPage,
  useToast,
  IconAward,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconInbox,
  IconPlus,
  IconShield,
  IconTrash,
  IconTrendingUp,
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
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
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

// Scout-year order: أيلول opens the year, آب closes it
const SCOUT_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

// ar-LB gives the Levantine month names (أيلول، تشرين...) the فوج actually uses
const monthName = (m, lng) =>
  new Intl.DateTimeFormat(lng === 'ar' ? 'ar-LB' : 'fr-FR', { month: 'long' }).format(
    new Date(2000, m - 1, 1)
  );

// "2025-2026" + شهر 9 → "2025-09"، و شهر 3 → "2026-03": أيلول..كانون الأول من السنة
// الأولى، و الباقي من الثانية.
const monthKey = (year, month) =>
  `${month >= 9 ? year.slice(0, 4) : year.slice(5)}-${String(month).padStart(2, '0')}`;

/** كل أيام الشهر، من الأول إلى الآخر. */
function daysOf(key) {
  const [y, m] = key.split('-').map(Number);
  const out = [];
  for (const d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d.setDate(d.getDate() + 1))
    out.push(toISO(d));
  return out;
}

// كل سبوت الشهر — the plan's default rows: normally every سبت carries a نشاط
const saturdaysOf = (key) => daysOf(key).filter((d) => toDate(d).getDay() === 6);

// "sam. 06/09" — weekday and day, latin digits in both locales
const dayLabelFormats = {};
function fmtDay(iso, lng) {
  const locale = lng === 'ar' ? 'ar-u-nu-latn' : 'fr-FR';
  const f = (dayLabelFormats[locale] ??= new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }));
  return f.format(toDate(iso)).replace(/[‎‏؜]/g, '');
}

/** صف واحد من جدول الشهر: يوم + النشاط المبرمج فيه + حالته. */
function PlanRow({ row, index, days, canEdit, onTitle, onDate, onRemove }) {
  const { t, i18n } = useTranslation();
  const isSaturday = toDate(row.date)?.getDay() === 6;

  return (
    <li className="grid grid-cols-[7.5rem_1fr] items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:grid-cols-[9rem_1fr_auto]">
      {/* An extra day stays changeable; the Saturdays of the month are fixed rows */}
      {row.extra && canEdit ? (
        <Select
          value={row.date}
          onChange={(e) => onDate(index, e.target.value)}
          aria-label={t('common.date')}
          className="h-9 sm:h-9"
        >
          {days.map((d) => (
            <option key={d} value={d}>
              {fmtDay(d, i18n.language)}
            </option>
          ))}
        </Select>
      ) : (
        <span className="flex items-center gap-1.5 text-sm tabular-nums">
          {isSaturday && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />}
          <span className={isSaturday ? 'font-medium' : 'text-muted-foreground'}>
            {fmtDay(row.date, i18n.language)}
          </span>
        </span>
      )}

      {canEdit ? (
        <Input
          value={row.title}
          onChange={(e) => onTitle(index, e.target.value)}
          placeholder={t('branch.planActivityHint')}
          autoComplete="off"
          className="h-9 sm:h-9"
          aria-label={t('branch.planActivity')}
        />
      ) : (
        <span className="text-sm">{row.title || <span className="text-muted-foreground">—</span>}</span>
      )}

      <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
        {row.session ? (
          <Link
            to={`/sessions/${row.session.id}`}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/12 px-2 py-0.5 text-xs font-medium text-success"
          >
            <IconCheck className="h-3 w-3" />
            {fmtDate(row.session.date)}
          </Link>
        ) : row.title.trim() ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <IconClock className="h-3 w-3" />
            {t('branch.planNotDone')}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t('branch.planFree')}</span>
        )}
        {canEdit && row.extra && (
          <Button size="icon-sm" variant="ghost" onClick={() => onRemove(index)} aria-label={t('common.delete')}>
            <IconTrash />
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * الخطة السنوية لفرقة واحدة، شهرًا بشهر: سبوت الشهر جاهزة كصفوف، القائد يكتب اسم
 * النشاط في كل سطر و يحفظ الشهر دفعة واحدة، و يضيف أي يوم آخر عند الحاجة.
 * التحقيق يُحسب في السيرفر: بند الخطة يخضرّ متى رُبط به نشاط أو أُنشئ نشاط بنفس الاسم.
 */
function AnnualPlan({ branchId }) {
  const { t, i18n } = useTranslation();
  const { can } = usePerms();
  const toast = useToast();
  const [year, setYear] = useState('');
  // Opens on the month the قائد is living in, not on أيلول
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const res = useFetch(`/branches/${branchId}/plan${year ? `?year=${encodeURIComponent(year)}` : ''}`);
  const canEdit = can('branches.plan');

  const plan = res.data;
  const key = plan ? monthKey(plan.year, month) : null;

  // The draft is rebuilt whenever the month or the saved plan changes: every سبت is
  // offered even when empty, saved days join them, and the whole month sorts by date.
  useEffect(() => {
    if (!plan || !key) return;
    const saved = plan.items.filter((i) => i.date.startsWith(key));
    const byDate = new Map(
      saved.map((i) => [i.date, { ...i, extra: toDate(i.date).getDay() !== 6 }])
    );
    for (const d of saturdaysOf(key))
      if (!byDate.has(d)) byDate.set(d, { id: null, date: d, title: '', session: null, extra: false });
    setRows([...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)));
    setDirty(false);
  }, [plan, key]);

  const edit = (fn) => {
    setRows(fn);
    setDirty(true);
  };
  const setTitle = (i, v) => edit((r) => r.map((x, n) => (n === i ? { ...x, title: v } : x)));
  const setDate = (i, v) => edit((r) => r.map((x, n) => (n === i ? { ...x, date: v } : x)));
  const removeRow = (i) => edit((r) => r.filter((_, n) => n !== i));

  // A new day defaults to the first day of the month nothing is planned on yet
  function addDay() {
    const taken = new Set(rows.map((r) => r.date));
    const free = daysOf(key).find((d) => !taken.has(d));
    if (!free) return;
    edit((r) =>
      [...r, { id: null, date: free, title: '', session: null, extra: true }].sort((a, b) =>
        a.date.localeCompare(b.date)
      )
    );
  }

  async function save() {
    setSaving(true);
    try {
      const fresh = await api.put(`/branches/${branchId}/plan/month`, {
        year: plan.year,
        month: key,
        items: rows
          .filter((r) => r.date && r.title.trim())
          .map((r) => ({ ...(r.id ? { id: r.id } : {}), date: r.date, title: r.title.trim() })),
      });
      res.setData(fresh);
      setDirty(false);
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const monthDone = rows.filter((r) => r.session).length;
  const monthPlanned = rows.filter((r) => r.title.trim()).length;
  // Days still selectable for an extra row: the free ones, plus the row's own date
  const takenDates = new Set(rows.filter((r) => !r.extra).map((r) => r.date));

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <IconTrendingUp className="h-4 w-4 text-muted-foreground" />
          {t('branch.planTitle')}
        </CardTitle>
        {plan && (
          <div className="flex flex-wrap items-center gap-2">
            {plan.total > 0 && (
              <Badge variant="outline">
                {t('branch.planProgress', { done: plan.done_count, total: plan.total })}
              </Badge>
            )}
            <Select
              className="w-auto"
              value={plan.year}
              onChange={(e) => setYear(e.target.value)}
              aria-label={t('common.year')}
            >
              {plan.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {res.loading && <Skeleton className="h-40" />}
        {res.error && (
          <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />
        )}

        {plan && (
          <>
            {plan.total > 0 && (
              <div>
                <div className="mb-1.5 flex items-baseline justify-between text-sm">
                  <span className="font-medium">{t('branch.planRate')}</span>
                  <span className="tabular-nums text-muted-foreground">{plan.rate}%</span>
                </div>
                <ProgressBar value={plan.rate} label={t('branch.planRate')} />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Select
                className="w-auto"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                aria-label={t('common.month')}
              >
                {SCOUT_MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {monthName(m, i18n.language)}
                  </option>
                ))}
              </Select>
              <Badge variant={monthDone === monthPlanned && monthPlanned > 0 ? 'success' : 'outline'}>
                {t('branch.planProgress', { done: monthDone, total: monthPlanned })}
              </Badge>
              <span className="grow" />
              {canEdit && (
                <>
                  <Button size="sm" variant="outline" onClick={addDay}>
                    <IconPlus />
                    {t('branch.planAddDay')}
                  </Button>
                  <Button size="sm" variant="brand" onClick={save} loading={saving} disabled={!dirty}>
                    {t('common.save')}
                  </Button>
                </>
              )}
            </div>

            <div className="overflow-hidden rounded-xl border border-border">
              <div className="hidden grid-cols-[9rem_1fr_auto] gap-3 border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
                <span>{t('common.date')}</span>
                <span>{t('branch.planActivity')}</span>
                <span>{t('branch.planState')}</span>
              </div>
              {rows.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {t('branch.planEmptyMonth')}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {rows.map((row, i) => (
                    <PlanRow
                      key={`${row.id ?? 'new'}-${i}`}
                      row={row}
                      index={i}
                      days={daysOf(key).filter((d) => d === row.date || !takenDates.has(d))}
                      canEdit={canEdit}
                      onTitle={setTitle}
                      onDate={setDate}
                      onRemove={removeRow}
                    />
                  ))}
                </ul>
              )}
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">{t('branch.planHint')}</p>
          </>
        )}
      </CardContent>
    </Card>
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
              <Badge
                variant="outline"
                className={
                  x.id === b.id ? 'border-primary-foreground/35 text-primary-foreground' : undefined
                }
              >
                {x.members.active}
              </Badge>
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

      {/* key: switching فرقة must refetch its own plan, not show the previous one */}
      <AnnualPlan key={`plan-${b.id}`} branchId={b.id} />

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
