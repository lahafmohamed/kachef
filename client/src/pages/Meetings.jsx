import { Fragment, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useFetch, useUrlField, useUrlFilters } from '../hooks';
import { isFeminine, useSection } from '../section';
import { toDate } from '../lib/date';
import { MEETING_KINDS, timeRange, userText } from '../lib/meetings';
import { branchName, fmtDate, todayISO } from '../utils';
import DateRangePicker from '../components/DateRangePicker';
import ExportPdfButton from '../components/ExportPdfButton';
import FilterSelect from '../components/FilterSelect';
import MeetingFormDialog from '../components/MeetingForm';
import { DecisionCheck, DecisionMeta, MeetingKindBadge, attendanceLine } from '../components/MeetingParts';
import { UnderlineTabs } from '../components/MemberParts';
import SearchInput from '../components/SearchInput';
import {
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  useToast,
  IconFilter,
  IconMessages,
  IconPlus,
  IconShield,
  IconX,
} from '../components/ui';

// ar-LB: the Levantine month names (أيلول، تشرين…) the فوج uses, Latin digits
const intlLocale = (lng) => (lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR');
const fmtMonth = (key, lng) =>
  new Intl.DateTimeFormat(intlLocale(lng), { month: 'long', year: 'numeric' }).format(toDate(`${key}-01`));
const fmtMonthShort = (iso, lng) => new Intl.DateTimeFormat(intlLocale(lng), { month: 'short' }).format(toDate(iso));

const VIEWS = ['meetings', 'decisions'];
// The follow-up list opens on what is still to do; «all» adds the dropped ones
const DECISION_FILTERS = ['open', 'done', 'all'];

function ListSkeleton() {
  return (
    <Card className="divide-y divide-border" aria-busy="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex gap-4 p-4">
          <Skeleton className="h-10 w-10 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </Card>
  );
}

/**
 * The aside of a meeting line: who came, then what was decided and what of it is late.
 * A meeting still to come says how many points its agenda holds instead.
 */
function MeetingFigures({ m, t, upcoming }) {
  const counts = { present: m.present_count, absent: m.absent_count, excused: m.excused_count, guests: m.guest_count };
  const marked = counts.present + counts.absent + counts.excused + counts.guests > 0;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {upcoming ? (
        <p>{m.item_count ? t('meeting.itemCount', { count: m.item_count }) : t('meeting.noAgendaYet')}</p>
      ) : (
        <p>
          {marked
            ? attendanceLine(counts, t, m.section).map((x, i) => (
                <Fragment key={i}>
                  {i > 0 && ' · '}
                  <span className="whitespace-nowrap">{x}</span>
                </Fragment>
              ))
            : t('meeting.attendanceNotTaken')}
        </p>
      )}
      {m.decision_count > 0 ? (
        <p>
          <span className="whitespace-nowrap font-medium text-foreground">
            {t('meeting.decisionCount', { count: m.decision_count })}
          </span>
          {m.overdue_count > 0 ? (
            <span className="whitespace-nowrap font-medium text-destructive">
              {' · '}
              {t('meeting.overdueCount', { count: m.overdue_count })}
            </span>
          ) : m.open_count > 0 ? (
            <span className="whitespace-nowrap">
              {' · '}
              {t('meeting.openCount', { count: m.open_count })}
            </span>
          ) : (
            <span className="whitespace-nowrap text-success">
              {' · '}
              {t('meeting.allDone')}
            </span>
          )}
        </p>
      ) : (
        !upcoming && <p>{t('meeting.noDecisionYet')}</p>
      )}
    </div>
  );
}

function MeetingRow({ m, lng, t, bothSections, today }) {
  const upcoming = m.date > today;
  const meta = [timeRange(m), m.place, m.chair && t('meeting.chairedBy', { name: m.chair })].filter(Boolean);
  return (
    <li>
      <Link
        to={`/meetings/${m.id}`}
        className="focus-ring group grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-accent/40 sm:grid-cols-[3.25rem_minmax(0,1fr)_14rem] sm:items-center sm:px-5"
      >
        <div className="self-start text-center">
          <span className="sr-only">{fmtDate(m.date)}</span>
          <span aria-hidden="true" className="block text-2xl font-semibold leading-none tabular-nums">
            {Number(m.date.slice(8, 10))}
          </span>
          <span aria-hidden="true" className="mt-1 block text-xs text-muted-foreground">
            {fmtMonthShort(m.date, lng)}
          </span>
        </div>

        <div className="min-w-0 space-y-1.5">
          <p className="font-semibold [overflow-wrap:anywhere] group-hover:text-primary">
            <bdi>{userText(m.title)}</bdi>
          </p>
          {meta.length > 0 && (
            <p className="text-sm text-muted-foreground max-sm:line-clamp-2 sm:truncate" title={meta.join(' · ')}>
              {meta.map((x, i) => (
                <Fragment key={i}>
                  {i > 0 && ' · '}
                  <bdi className={x.length <= 24 ? 'whitespace-nowrap' : undefined}>{x}</bdi>
                </Fragment>
              ))}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <MeetingKindBadge kind={m.kind} t={t} />
            {bothSections && (
              <Badge variant={isFeminine(m.section) ? 'info' : 'outline'}>{t(`section.${m.section}`)}</Badge>
            )}
            {m.branch_id ? (
              <Badge variant="outline">{branchName(m, lng)}</Badge>
            ) : (
              <Badge variant="outline">{t('meeting.wholeGroup')}</Badge>
            )}
          </div>
        </div>

        <div className="col-start-2 sm:col-start-3">
          <MeetingFigures m={m} t={t} upcoming={upcoming} />
        </div>
      </Link>
    </li>
  );
}

/** Upcoming meetings first, nearest first; then the minutes, month by month, latest first. */
function groupMeetings(list, today) {
  const upcoming = list.filter((m) => m.date > today).reverse();
  const months = [];
  for (const m of list) {
    if (m.date > today) continue;
    const key = m.date.slice(0, 7);
    if (months.at(-1)?.key !== key) months.push({ key, rows: [] });
    months.at(-1).rows.push(m);
  }
  return { upcoming, months };
}

/**
 * One decision on the follow-up list: its tick, what was decided, who carries it out
 * and by when, and the meeting it comes from. A tick keeps the line where it is —
 * a wrong tap is undone on the spot — and the list sorts itself again on the next visit.
 */
function DecisionRow({ d, t, lng, today, canWrite, busy, onToggle, bothSections }) {
  const scope = [d.branch_id && branchName(d, lng), bothSections && t(`section.${d.section}`)].filter(Boolean);
  return (
    <li className="flex items-start gap-2 px-2 py-2 sm:px-3">
      <DecisionCheck
        status={d.status}
        busy={busy}
        onToggle={canWrite ? () => onToggle(d) : null}
        label={t(d.status === 'done' ? 'meeting.markOpen' : 'meeting.markDone', { text: d.text })}
      />
      <div className="min-w-0 flex-1 py-2">
        <p
          className={cn(
            'text-sm font-medium [overflow-wrap:anywhere]',
            d.status !== 'open' && 'text-muted-foreground',
            d.status === 'dropped' && 'line-through'
          )}
        >
          <bdi>{userText(d.text)}</bdi>
        </p>
        <DecisionMeta d={d} t={t} today={today} />
        {/* Where it was decided, a line of its own: the meeting opens from here */}
        <p className="mt-0.5 text-xs text-muted-foreground">
          <Link
            to={`/meetings/${d.meeting_id}`}
            className="focus-ring rounded underline-offset-2 hover:text-primary hover:underline"
          >
            <span className="tabular-nums">{fmtDate(d.meeting_date)}</span> · <bdi>{userText(d.meeting_title)}</bdi>
          </Link>
          {scope.map((x) => (
            <Fragment key={x}>
              {' · '}
              <span className="whitespace-nowrap">{x}</span>
            </Fragment>
          ))}
        </p>
      </div>
    </li>
  );
}

function DecisionsView({ t, lng, canWrite, bothSections, onCount }) {
  const toast = useToast();
  const [sp, patch] = useUrlFilters();
  const [q, setQ] = useUrlField(sp, patch, 'dq');
  const status = DECISION_FILTERS.includes(sp.get('status')) ? sp.get('status') : 'open';
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (sp.get('dq')) params.set('q', sp.get('dq'));
  const res = useFetch(`/meeting-decisions?${params}`);
  const [busy, setBusy] = useState(null);
  const today = todayISO();
  const list = res.data || [];

  async function toggle(d) {
    const next = d.status === 'done' ? 'open' : 'done';
    setBusy(d.id);
    // On screen at once; a refusal puts it back
    res.setData((rows) => rows.map((x) => (x.id === d.id ? { ...x, status: next, status_at: next === 'done' ? today : null } : x)));
    try {
      const r = await api.put(`/meetings/${d.meeting_id}/decisions/${d.id}/status`, { status: next });
      res.setData((rows) => rows.map((x) => (x.id === d.id ? { ...x, ...r.decision } : x)));
      onCount?.();
    } catch (err) {
      res.setData((rows) => rows.map((x) => (x.id === d.id ? d : x)));
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder={t('meeting.searchDecisions')} />
        <SegmentedControl
          label={t('meeting.decisionFilter')}
          value={status}
          onChange={(v) => patch({ status: v === 'open' ? '' : v })}
          options={DECISION_FILTERS.map((s) => ({ value: s, label: t(`meeting.decisionFilter_${s}`) }))}
          className="flex w-full sm:w-auto sm:[&>button]:whitespace-nowrap"
        />
      </div>

      {res.error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />
      ) : res.loading ? (
        <ListSkeleton />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<IconMessages className="h-6 w-6" />} title={t(sp.get('dq') ? 'common.noResults' : `meeting.noDecisions_${status}`)}>
            {t(sp.get('dq') ? 'common.noResultsHint' : 'meeting.noDecisionsHint')}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {list.map((d) => (
              <DecisionRow
                key={d.id}
                d={d}
                t={t}
                lng={lng}
                today={today}
                canWrite={canWrite}
                busy={busy === d.id}
                onToggle={toggle}
                bothSections={bothSections}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * الاجتماعات: the minutes of every meeting — what it was about, who came, what was said
 * on each point and what was decided — then the decisions themselves, followed up from
 * one meeting to the next until they are carried out.
 */
export default function Meetings() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const navigate = useNavigate();
  const toast = useToast();
  const { has } = usePerms();
  const editable = has('sessions.create');
  const { section } = useSection();

  const [sp, patch] = useUrlFilters();
  const view = VIEWS.includes(sp.get('view')) ? sp.get('view') : 'meetings';
  const [q, setQ] = useUrlField(sp, patch, 'q');
  const kind = MEETING_KINDS.includes(sp.get('kind')) ? sp.get('kind') : '';
  const branch = sp.get('branch') || '';
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';
  const [showFilters, setShowFilters] = useState(false);
  const [creating, setCreating] = useState(false);

  const params = new URLSearchParams();
  if (sp.get('q')) params.set('q', sp.get('q'));
  if (kind) params.set('kind', kind);
  if (branch) params.set('branch', branch);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const meetings = useFetch(`/meetings?${params}`);
  const branches = useFetch('/branches');
  // The tab says how many decisions wait, whatever the list below is filtered on
  const pending = useFetch('/meeting-decisions?status=open');
  const branchList = (branches.data || []).filter((b) => !section || b.section === section);
  const list = meetings.data || [];
  const today = todayISO();
  const { upcoming, months } = groupMeetings(list, today);

  const activeFilters = [kind, branch, from || to].filter(Boolean).length;
  const filtering = activeFilters > 0 || !!sp.get('q');
  const clear = () => {
    setQ('');
    patch({ q: '', kind: '', branch: '', from: '', to: '' });
  };

  // A meeting is usually chaired and written up by the same two: the form starts from the last one
  const previous = list.find((m) => m.date <= today) || list[0] || null;

  const exportQuery = (() => {
    if (view === 'decisions') {
      const qs = new URLSearchParams();
      const status = DECISION_FILTERS.includes(sp.get('status')) ? sp.get('status') : 'open';
      if (status !== 'all') qs.set('status', status);
      if (sp.get('dq')) qs.set('q', sp.get('dq'));
      return qs.toString();
    }
    return params.toString();
  })();

  const tabs = [
    { id: 'meetings', label: t('meeting.tabMeetings') },
    { id: 'decisions', label: t('meeting.tabDecisions'), count: pending.data ? pending.data.length : null },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('meeting.title')} description={filtering && view === 'meetings' ? t('meeting.resultCount', { count: list.length }) : t('meeting.subtitle')}>
        <ExportPdfButton
          kind={view === 'decisions' ? 'meeting-decisions' : 'meetings-list'}
          id={0}
          query={exportQuery}
          compact
        />
        {editable && (
          <Button variant="brand" onClick={() => setCreating(true)}>
            <IconPlus />
            {t('meeting.new')}
          </Button>
        )}
      </PageHeader>

      <UnderlineTabs
        items={tabs}
        value={view}
        onChange={(v) => patch({ view: v === 'meetings' ? '' : v })}
        label={t('meeting.title')}
        idPrefix="meetings-tab"
        panelId="meetings-panel"
        // The month headers below stick under the app bar: a stuck tab row would cover them
        sticky={false}
      />

      <div id="meetings-panel" role="tabpanel" aria-labelledby={`meetings-tab-${view}`} className="space-y-4">
        {view === 'decisions' ? (
          <DecisionsView t={t} lng={lng} canWrite={editable} bothSections={!section} onCount={pending.reload} />
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex gap-2">
                <SearchInput value={q} onChange={setQ} placeholder={t('meeting.searchPlaceholder')} />
                <Button
                  variant="outline"
                  size="icon"
                  className="relative shrink-0 sm:hidden"
                  aria-expanded={showFilters}
                  aria-label={t('session.filters')}
                  onClick={() => setShowFilters((v) => !v)}
                >
                  <IconFilter />
                  {activeFilters > 0 && (
                    <span className="absolute -end-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[0.6875rem] font-bold text-primary-foreground">
                      {activeFilters}
                    </span>
                  )}
                </Button>
              </div>
              <div
                className={cn(
                  'flex-col gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center',
                  showFilters ? 'flex' : 'hidden'
                )}
              >
                <FilterSelect
                  value={kind}
                  onChange={(v) => patch({ kind: v })}
                  allLabel={t('meeting.allKinds')}
                  ariaLabel={t('meeting.kind')}
                  className="sm:w-auto sm:min-w-44"
                  options={MEETING_KINDS.map((k) => ({ value: k, label: t(`meeting.kind_${k}`) }))}
                />
                <FilterSelect
                  value={branch}
                  onChange={(v) => patch({ branch: v })}
                  allLabel={t('meeting.allScopes')}
                  ariaLabel={t('meeting.scope')}
                  className="sm:w-auto sm:min-w-44"
                  icon={<IconShield className="opacity-60" />}
                  options={[
                    { value: 'group', label: t('meeting.wholeGroupOnly') },
                    ...branchList.map((b) => ({ value: b.id, label: branchName(b, lng) })),
                  ]}
                />
                <DateRangePicker value={{ from, to }} onChange={({ from: f, to: tt }) => patch({ from: f, to: tt })} />
                {filtering && (
                  <Button variant="ghost" size="sm" onClick={clear}>
                    <IconX />
                    {t('common.clearFilters')}
                  </Button>
                )}
              </div>
            </div>

            {meetings.error ? (
              <ErrorState message={t('error.loadFailed')} onRetry={meetings.reload} retryLabel={t('error.retry')} />
            ) : meetings.loading ? (
              <ListSkeleton />
            ) : list.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<IconMessages className="h-6 w-6" />}
                  title={t(filtering ? 'common.noResults' : 'meeting.empty')}
                  action={
                    filtering ? (
                      <Button variant="outline" onClick={clear}>
                        {t('common.clearFilters')}
                      </Button>
                    ) : editable ? (
                      <Button variant="brand" onClick={() => setCreating(true)}>
                        <IconPlus />
                        {t('meeting.new')}
                      </Button>
                    ) : null
                  }
                >
                  {t(filtering ? 'common.noResultsHint' : 'meeting.emptyHint')}
                </EmptyState>
              </Card>
            ) : (
              <div className="space-y-6">
                {upcoming.length > 0 && (
                  <section aria-labelledby="meetings-upcoming" className="space-y-2">
                    <h2 id="meetings-upcoming" className="px-1 text-base font-semibold">
                      {t('meeting.upcoming')}
                    </h2>
                    <Card className="overflow-hidden">
                      <ul className="divide-y divide-border">
                        {upcoming.map((m) => (
                          <MeetingRow key={m.id} m={m} lng={lng} t={t} bothSections={!section} today={today} />
                        ))}
                      </ul>
                    </Card>
                  </section>
                )}
                {months.map(({ key, rows }) => (
                  <section key={key} aria-labelledby={`meetings-${key}`} className="space-y-2">
                    {/* Sticks under the phone top bar (4rem + notch), at the top on desktop */}
                    <div className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-10 -mx-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 bg-background px-1 py-2 lg:top-0">
                      <h2 id={`meetings-${key}`} className="text-base font-semibold">
                        {fmtMonth(key, lng)}
                      </h2>
                      <p className="text-xs text-muted-foreground">{t('meeting.monthCount', { count: rows.length })}</p>
                    </div>
                    <Card className="overflow-hidden">
                      <ul className="divide-y divide-border">
                        {rows.map((m) => (
                          <MeetingRow key={m.id} m={m} lng={lng} t={t} bothSections={!section} today={today} />
                        ))}
                      </ul>
                    </Card>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {editable && (
        <MeetingFormDialog
          open={creating}
          initial={null}
          previous={previous}
          onClose={() => setCreating(false)}
          onSaved={(m) => {
            setCreating(false);
            toast.success(t('meeting.created'));
            navigate(`/meetings/${m.id}`);
          }}
        />
      )}
    </div>
  );
}
