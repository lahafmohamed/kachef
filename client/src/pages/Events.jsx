import { Fragment, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePerms } from '../auth';
import { useFetch, useUrlField, useUrlFilters } from '../hooks';
import { isFeminine, useSection } from '../section';
import { branchName, fmtAmount, todayISO } from '../utils';
import {
  EVENT_KINDS,
  KIND_BADGE,
  dayNumber,
  eventPhase,
  eventScopeLabels,
  fmtDateRange,
  fmtMonthShort,
  signed,
} from '../lib/events';
import { fmtScore, scoreTone } from '../lib/evaluations';
import EventFormDialog from '../components/EventForm';
import { ReadinessBadge } from '../components/CampSafety';
import FilterSelect from '../components/FilterSelect';
import SearchInput from '../components/SearchInput';
import {
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  useToast,
  IconPlus,
  IconStar,
  IconTent,
} from '../components/ui';

// Ongoing first, then what is coming (nearest first), then the archive (latest first)
const PHASES = ['ongoing', 'upcoming', 'past'];

// A scout year «2025-2026» runs September 1st to August 31st, as on the server
function scoutYearOf(iso) {
  const y = Number(iso.slice(0, 4));
  const start = Number(iso.slice(5, 7)) >= 9 ? y : y - 1;
  return `${start}-${start + 1}`;
}

// The year filter: next year (a camp gets planned ahead), this one, and five back
function yearOptions(today) {
  const start = Number(scoutYearOf(today).slice(0, 4)) + 1;
  return Array.from({ length: 7 }, (_, i) => `${start - i}-${start - i + 1}`);
}

/** The filtered list in one line: how many, how many took part, and — for who sees it — the money */
function Totals({ list, t, canFees }) {
  const sum = (k) => list.reduce((n, e) => n + (e[k] || 0), 0);
  const facts = [
    t('event.totalEvents', { count: list.length }),
    t('event.participantCount', { count: sum('participant_count') }),
    canFees && t('event.totalCollected', { amount: fmtAmount(sum('collected')) }),
    canFees && sum('outstanding') > 0 && t('event.totalOutstanding', { amount: fmtAmount(sum('outstanding')) }),
  ].filter(Boolean);
  return (
    <p className="px-1 text-sm text-muted-foreground">
      {facts.map((f, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          <span className={cn('whitespace-nowrap tabular-nums', i === 3 && 'font-medium text-destructive')}>{f}</span>
        </Fragment>
      ))}
    </p>
  );
}

/**
 * The money of one event at a glance: collected against expected, then what is left
 * with the donations and what the caisses gave (less what went back), once the
 * expenses are paid.
 */
function MoneyMeter({ e, t }) {
  if (!e.expected && !e.expenses && !e.collected && !e.donations && !e.funded)
    return <p className="text-xs text-muted-foreground">{t(e.fee ? 'event.noPaymentsYet' : 'event.free')}</p>;
  const pct = e.expected ? Math.min(100, Math.round((100 * e.collected) / e.expected)) : null;
  const balance = e.collected + e.donations + (e.funded || 0) - e.expenses;
  // A cut amount is a wrong one: the line wraps between the figures, each kept whole
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t('event.collected')}{' '}
          <span className="whitespace-nowrap font-medium tabular-nums text-foreground">
            {fmtAmount(e.collected, { unit: !(e.expected > 0) })}
          </span>
          {e.expected > 0 && <span className="whitespace-nowrap tabular-nums"> / {fmtAmount(e.expected)}</span>}
        </p>
        {pct !== null && <span className="text-sm font-semibold tabular-nums">{pct}%</span>}
      </div>
      {pct !== null && (
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span className="bg-success" style={{ width: `${pct}%` }} />
        </div>
      )}
      {/* E2 : ce qui reste à encaisser, et combien de familles appeler */}
      {e.outstanding > 0 && (
        <p className="text-xs font-medium tabular-nums text-destructive">
          {t('campFile.unpaidLine', { amount: fmtAmount(e.outstanding), count: e.unpaid_families || e.unpaid_count || 0 })}
        </p>
      )}
      {(e.expenses > 0 || e.donations > 0 || !!e.funded) && (
        <p className="text-xs text-muted-foreground">
          {t('event.balance')}{' '}
          <span
            dir="ltr"
            className={cn('whitespace-nowrap font-medium tabular-nums', balance < 0 ? 'text-destructive' : 'text-success')}
          >
            {signed(balance)}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * The قادة's mark, among the row's badges: «★ 4,3/5». For a قائد who took part and has not
 * rated it yet, «À évaluer» instead — the server hides the others' average from him.
 */
function EvalBadge({ e, t, lang }) {
  const ev = e.eval;
  if (!ev) return null;
  if (ev.pending)
    return (
      <Badge variant="outline" className="border-primary/40 text-primary">
        <IconStar className="h-3 w-3" />
        {t('eval.toDo')}
      </Badge>
    );
  if (!ev.count || ev.average === null) return null;
  return (
    <Badge variant="outline">
      <IconStar className="h-3 w-3 text-muted-foreground" />
      <span className="sr-only">{t('eval.listLabel', { count: ev.count })}</span>
      <span dir="ltr" className={scoreTone(ev.average).text}>
        {fmtScore(ev.average, lang)}
        <span className="font-normal text-muted-foreground">/5</span>
      </span>
    </Badge>
  );
}

function EventRow({ e, lang, t, branchList, showMoney, bothSections }) {
  const days = dayNumber(e, e.end_date);
  // The dates first, always there: digits only, so they stay un-isolated below
  const meta = [
    fmtDateRange(e.start_date, e.end_date),
    days > 1 && t('event.dayCount', { count: days }),
    e.place,
    e.leader_name,
  ].filter(Boolean);
  const named = eventScopeLabels(e, branchList, lang);
  return (
    <li>
      <Link
        to={`/events/${e.id}`}
        className={cn(
          'focus-ring group grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-accent/40 sm:items-center sm:px-5',
          showMoney ? 'sm:grid-cols-[3.25rem_minmax(0,1fr)_14rem]' : 'sm:grid-cols-[3.25rem_minmax(0,1fr)]'
        )}
      >
        <div className="self-start text-center">
          <span aria-hidden="true" className="block text-2xl font-semibold leading-none tabular-nums">
            {Number(e.start_date.slice(8, 10))}
          </span>
          <span aria-hidden="true" className="mt-1 block text-xs text-muted-foreground">
            {fmtMonthShort(e.start_date, lang)}
          </span>
        </div>

        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 font-semibold [overflow-wrap:anywhere] group-hover:text-primary">
              <bdi>{e.title}</bdi>
            </span>
            <Badge variant={KIND_BADGE[e.kind]}>{t(`event.kind_${e.kind}`)}</Badge>
          </div>
          {/* Wraps on a phone, where a cut place name is a lost one; one line from sm up.
              A short fact stays whole and the dot holds on to the fact before it, like a
              comma (no-break space), so the line breaks between two facts and never opens
              on a lone «·». The
              place and the قائد keep their own direction (an Arabic name on the French
              screen); the dates stay in the line's, so the first day leads on both. */}
          <p className="text-sm text-muted-foreground sm:truncate" title={meta.join(' · ')}>
            {meta.map((m, i) => (
              <Fragment key={i}>
                {i > 0 && '\u00a0· '}
                {i === 0 ? (
                  <span className="whitespace-nowrap tabular-nums">{m}</span>
                ) : (
                  <bdi className={m.length <= 24 ? 'whitespace-nowrap' : undefined}>{m}</bdi>
                )}
              </Fragment>
            ))}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {bothSections && <Badge variant={isFeminine(e.section) ? 'info' : 'outline'}>{t(`section.${e.section}`)}</Badge>}
            {named.length ? (
              // A فرقة with its طلائع can outgrow a phone row: it wraps inside the badge
              named.map((b) => (
                <Badge key={b.id} className="max-w-full whitespace-normal">
                  {b.label}
                </Badge>
              ))
            ) : (
              <Badge variant="secondary">{t('event.wholeGroup')}</Badge>
            )}
            <Badge variant="outline">{t('event.participantCount', { count: e.participant_count })}</Badge>
            <Badge variant="outline">{t('event.sessionCount', { count: e.session_count })}</Badge>
            <EvalBadge e={e} t={t} lang={lang} />
            {/* E1 : prêt à partir, tant que le camp n'est pas fini */}
            {e.end_date >= todayISO() && <ReadinessBadge r={e} />}
          </div>
        </div>

        {showMoney && (
          <div className="col-start-2 sm:col-start-3">
            <MoneyMeter e={e} t={t} />
          </div>
        )}
      </Link>
    </li>
  );
}

/**
 * المخيمات و الدورات: ما يجري الآن، ثم القادم، ثم الأرشيف. كل مخيم يقول أيامه و فرقه و
 * عدد مشاركيه و جلساته، و حسابه لمن يرى المبالغ.
 */
export default function Events() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { has } = usePerms();
  const editable = has('events.manage');
  const canFees = has('events.read.fees');
  const { section } = useSection();

  const [sp, patch] = useUrlFilters();
  const [q, setQ] = useUrlField(sp, patch, 'q');
  const kind = EVENT_KINDS.includes(sp.get('kind')) ? sp.get('kind') : '';
  const years = yearOptions(todayISO());
  const year = years.includes(sp.get('year')) ? sp.get('year') : '';
  const branchId = /^\d+$/.test(sp.get('branch') || '') ? sp.get('branch') : '';
  // E2 : les camps où quelqu'un doit encore — pour qui voit les montants
  const unpaidOnly = canFees && sp.get('pay') === 'unpaid';
  const params = new URLSearchParams();
  if (sp.get('q')) params.set('q', sp.get('q'));
  if (kind) params.set('kind', kind);
  if (year) params.set('year', year);
  if (branchId) params.set('branch_id', branchId);

  const events = useFetch(`/events?${params}`);
  const branches = useFetch('/branches');
  const [creating, setCreating] = useState(false);

  const branchList = branches.data || [];
  // The فرق of the قسم on screen; both قسمان for an admin who sees both
  const branchOptions = branchList
    .filter((b) => !section || !b.section || b.section === section)
    .map((b) => ({ value: String(b.id), label: branchName(b, i18n.language) }));
  const list = (events.data || []).filter((e) => !unpaidOnly || e.unpaid_count > 0);
  const filtering = !!(sp.get('q') || kind || year || branchId || unpaidOnly);
  const today = todayISO();
  const groups = PHASES.map((phase) => {
    const rows = list.filter((e) => eventPhase(e, today) === phase);
    // The server sends latest first; what is coming reads nearest first
    if (phase !== 'past') rows.reverse();
    return { phase, rows };
  }).filter((g) => g.rows.length > 0);

  const clear = () => {
    setQ('');
    patch({ q: '', kind: '', year: '', branch: '', pay: '' });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('event.title')}
        description={filtering ? t('event.resultCount', { count: list.length }) : t('event.subtitle')}
      >
        {editable && (
          <Button variant="brand" onClick={() => setCreating(true)}>
            <IconPlus />
            {t('event.new')}
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-0 sm:basis-64">
          <SearchInput value={q} onChange={setQ} placeholder={t('event.searchPlaceholder')} />
        </div>
        <FilterSelect
          value={kind}
          onChange={(v) => patch({ kind: v })}
          allLabel={t('event.allKinds')}
          ariaLabel={t('event.kind')}
          className="w-full sm:w-auto sm:min-w-40"
          options={EVENT_KINDS.map((k) => ({ value: k, label: t(`event.kind_${k}`) }))}
        />
        <FilterSelect
          value={year}
          onChange={(v) => patch({ year: v })}
          allLabel={t('event.allYears')}
          ariaLabel={t('event.scoutYear')}
          className="w-[calc(50%-0.25rem)] sm:w-auto sm:min-w-36"
          options={years.map((y) => ({ value: y, label: y }))}
        />
        {branchOptions.length > 1 && (
          <FilterSelect
            value={branchId}
            onChange={(v) => patch({ branch: v })}
            allLabel={t('event.allBranches')}
            ariaLabel={t('event.branch')}
            className="w-[calc(50%-0.25rem)] sm:w-auto sm:min-w-40"
            options={branchOptions}
          />
        )}
        {canFees && (
          <FilterSelect
            value={unpaidOnly ? 'unpaid' : ''}
            onChange={(v) => patch({ pay: v })}
            allLabel={t('event.allPayments')}
            ariaLabel={t('event.payment')}
            className="w-full sm:w-auto sm:min-w-40"
            options={[{ value: 'unpaid', label: t('campFile.unpaidFilter') }]}
          />
        )}
      </div>

      {events.error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={events.reload} retryLabel={t('error.retry')} />
      ) : events.loading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-5 w-40" />
          <Card className="divide-y divide-border">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex gap-4 p-4">
                <Skeleton className="h-10 w-10 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </Card>
        </div>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconTent className="h-6 w-6" />}
            title={t(filtering ? 'common.noResults' : 'event.empty')}
            action={
              filtering ? (
                <Button variant="outline" onClick={clear}>
                  {t('common.clearFilters')}
                </Button>
              ) : editable ? (
                <Button variant="brand" onClick={() => setCreating(true)}>
                  <IconPlus />
                  {t('event.new')}
                </Button>
              ) : null
            }
          >
            {t(filtering ? 'common.noResultsHint' : 'event.emptyHint')}
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-6">
          <Totals list={list} t={t} canFees={canFees} />
          {groups.map(({ phase, rows }) => (
            <section key={phase} aria-labelledby={`phase-${phase}`} className="space-y-2">
              <h2 id={`phase-${phase}`} className="px-1 text-base font-semibold">
                {t(`event.phase_${phase}`)}
              </h2>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-border">
                  {rows.map((e) => (
                    <EventRow
                      key={e.id}
                      e={e}
                      lang={i18n.language}
                      t={t}
                      branchList={branchList}
                      showMoney={canFees}
                      bothSections={!section}
                    />
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}

      {editable && (
        <EventFormDialog
          open={creating}
          initial={null}
          onClose={() => setCreating(false)}
          onSaved={(ev) => {
            setCreating(false);
            toast.success(t('event.created'));
            navigate(`/events/${ev.id}`);
          }}
        />
      )}
    </div>
  );
}
