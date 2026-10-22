import { Fragment, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePerms } from '../auth';
import { useDebounced, useFetch } from '../hooks';
import ExportPdfButton from '../components/ExportPdfButton';
import { branchName, fmtDate, fmtTime, memberName } from '../utils';
import DateRangePicker from '../components/DateRangePicker';
import FilterSelect from '../components/FilterSelect';
import PrepCardForm from '../components/PrepCardForm';
import SearchInput from '../components/SearchInput';
import SearchSelect from '../components/SearchSelect';
import {
  Badge,
  Button,
  Card,
  cn,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  useToast,
  IconClipboard,
  IconFilter,
  IconPlus,
  IconShield,
  IconX,
} from '../components/ui';

/**
 * أرشيف بطاقات التحضير: البطاقة تُعدّ قبل نشاط السبت بتفاصيله المسبقة، تبقى هنا
 * مؤرشفة و قابلة للتعديل في أي وقت، و تُحسب في سجلّ القائد الذي أعدّها.
 */
export default function PrepCards() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { has } = usePerms();
  const editable = has('prep.manage');

  const [q, setQ] = useState('');
  const [branch, setBranch] = useState('');
  const [leaderFilter, setLeaderFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [creating, setCreating] = useState(false);
  // What a new card starts with: nothing from the header button, a نشاط's فرقة, date and
  // title from a link (?new=1&branch=&date=&title=&session=), or a whole card duplicated
  // (router state). Read once, then cleared, so a refresh doesn't reopen the dialog.
  const [defaults, setDefaults] = useState(null);
  const location = useLocation();
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const copy = location.state?.prepDefaults;
    if (sp.get('new') !== '1' && !copy) return;
    navigate(location.pathname, { replace: true, state: null });
    if (!editable) return;
    setDefaults(
      copy || {
        branch_id: sp.get('branch') || undefined,
        date: sp.get('date') || undefined,
        title: sp.get('title') || undefined,
        session_id: sp.get('session') || undefined,
      }
    );
    setCreating(true);
  }, [location, navigate, editable]);
  const openBlank = () => {
    setDefaults(null);
    setCreating(true);
  };

  const dq = useDebounced(q, 250);
  const params = new URLSearchParams();
  if (dq) params.set('q', dq);
  if (branch) params.set('branch', branch);
  if (leaderFilter) params.set('leader', leaderFilter);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const cards = useFetch(`/prep-cards?${params}`);
  const branches = useFetch('/branches');
  const leaders = useFetch('/leaders');

  const branchList = branches.data || [];
  const leaderList = leaders.data || [];
  const list = cards.data || [];

  const activeFilters = [branch, leaderFilter, from, to].filter(Boolean).length;
  const filtering = activeFilters > 0 || !!q;

  function clearFilters() {
    setQ('');
    setBranch('');
    setLeaderFilter('');
    setFrom('');
    setTo('');
  }

  // The short facts of a card (time, place, and on phones who prepared it), joined
  // by «·». Each one is isolated and kept whole, so a place written in the other
  // script never reorders its neighbours and a name never breaks across lines.
  const facts = (c, withLeader = false) =>
    [fmtTime(c.start_time), c.place, withLeader && c.leader].filter(Boolean);
  const factLine = (items) =>
    items.map((x, i) => (
      <Fragment key={i}>
        {i > 0 && ' · '}
        <bdi className={x.length <= 24 ? 'whitespace-nowrap' : undefined}>{x}</bdi>
      </Fragment>
    ));

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('prep.title')}
        description={filtering ? t('prep.resultCount', { count: list.length }) : t('prep.subtitle')}
      >
        {(() => {
          const q = new URLSearchParams(params);
          q.delete('branch');
          return <ExportPdfButton kind="prep-list" id={params.get('branch') || 0} query={q.toString()} compact />;
        })()}
        {editable && (
          <Button variant="brand" onClick={openBlank}>
            <IconPlus />
            {t('prep.newCard')}
          </Button>
        )}
      </PageHeader>

      <div className="space-y-2">
        <div className="flex gap-2">
          <SearchInput value={q} onChange={setQ} placeholder={t('prep.searchPlaceholder')} />
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
            value={branch}
            onChange={setBranch}
            allLabel={t('member.allBranches')}
            ariaLabel={t('member.branch')}
            className="sm:w-auto sm:min-w-44"
            icon={<IconShield className="opacity-60" />}
            options={branchList.map((b) => ({ value: b.id, label: branchName(b, i18n.language) }))}
          />
          <SearchSelect
            value={leaderFilter}
            onChange={(e) => setLeaderFilter(e.target.value)}
            options={leaderList.map((l) => ({ value: l.id, label: memberName(l) }))}
            clearLabel={t('prep.allAuthors')}
            placeholder={t('prep.allAuthors')}
            searchPlaceholder={t('session.searchLeader')}
            emptyLabel={t('member.noListValue')}
            ariaLabel={t('prep.author')}
            className="sm:w-auto sm:min-w-48"
          />
          <DateRangePicker
            value={{ from, to }}
            onChange={({ from: f, to: tt }) => {
              setFrom(f);
              setTo(tt);
            }}
          />
          {filtering && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <IconX />
              {t('common.clearFilters')}
            </Button>
          )}
        </div>
      </div>

      {cards.error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={cards.reload} retryLabel={t('error.retry')} />
      ) : cards.loading ? (
        <Card className="divide-y divide-border">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="space-y-2 p-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconClipboard className="h-6 w-6" />}
            title={t(filtering ? 'common.noResults' : 'prep.noCards')}
            action={
              filtering ? (
                <Button variant="outline" onClick={clearFilters}>
                  {t('common.clearFilters')}
                </Button>
              ) : editable ? (
                // Outline: the header's «بطاقة تحضير جديدة» stays the one filled action on screen
                <Button variant="outline" onClick={openBlank}>
                  <IconPlus />
                  {t('prep.newCard')}
                </Button>
              ) : null
            }
          >
            {t(filtering ? 'common.noResultsHint' : 'prep.noCardsHint')}
          </EmptyState>
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <Card className="md:hidden">
            <ul className="divide-y divide-border">
              {list.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/prep-cards/${c.id}`}
                    className="focus-ring block px-4 py-3 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                        <bdi>{c.title}</bdi>
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {fmtDate(c.date)}
                      </span>
                    </div>
                    {/* One line of facts, then one row of badges: mixed in a single wrapping
                        row, the name ran into the place with nothing between them */}
                    {facts(c, true).length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">{factLine(facts(c, true))}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge>{branchName(c, i18n.language)}</Badge>
                      {c.session_id && <Badge variant="success">{t('prep.linked')}</Badge>}
                      {c.matalib.length > 0 && (
                        <Badge variant="warning">
                          {t('session.matalibCount', { count: c.matalib.length })}
                        </Badge>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          {/* Desktop table */}
          <Card className="hidden md:block">
            <Table>
              <thead className="border-b border-border">
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('session.sessionTitle')}</Th>
                  <Th>{t('member.branch')}</Th>
                  <Th>{t('prep.author')}</Th>
                  <Th>{t('session.requirementsShort')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((c) => (
                  <tr key={c.id} className="group transition-colors hover:bg-accent/40">
                    <Td className="whitespace-nowrap tabular-nums">{fmtDate(c.date)}</Td>
                    <Td>
                      <Link
                        to={`/prep-cards/${c.id}`}
                        className="focus-ring rounded font-medium group-hover:text-primary"
                      >
                        <bdi>{c.title}</bdi>
                      </Link>
                      {c.session_id && (
                        <Badge variant="success" className="ms-2">
                          {t('prep.linked')}
                        </Badge>
                      )}
                      {facts(c).length > 0 && (
                        <span className="block text-xs text-muted-foreground">{factLine(facts(c))}</span>
                      )}
                    </Td>
                    <Td>
                      <Badge>{branchName(c, i18n.language)}</Badge>
                    </Td>
                    <Td className="text-muted-foreground">{c.leader ? <bdi>{c.leader}</bdi> : '—'}</Td>
                    <Td>
                      <Badge variant={c.matalib.length ? 'warning' : 'outline'}>{c.matalib.length}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title={t('prep.newCard')}>
        {branches.error || leaders.error ? (
          <ErrorState
            message={t('error.loadFailed')}
            onRetry={() => {
              if (branches.error) branches.reload();
              if (leaders.error) leaders.reload();
            }}
            retryLabel={t('error.retry')}
          />
        ) : (
          <PrepCardForm
            initial={null}
            defaults={defaults}
            branches={branchList}
            leaders={leaderList}
            onCancel={() => setCreating(false)}
            onSaved={(card) => {
              setCreating(false);
              toast.success(t('prep.created'));
              navigate(`/prep-cards/${card.id}`);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
