import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  const editable = has('sessions.create');

  const [q, setQ] = useState('');
  const [branch, setBranch] = useState('');
  const [leaderFilter, setLeaderFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [creating, setCreating] = useState(false);

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

  const meta = (c) =>
    [fmtTime(c.start_time), c.place].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('prep.title')}
        description={filtering ? t('prep.resultCount', { count: list.length }) : t('prep.subtitle')}
      >
        {(() => {
          const q = new URLSearchParams(params);
          q.delete('branch');
          return <ExportPdfButton kind="prep-list" id={params.get('branch') || 0} query={q.toString()} />;
        })()}
        {editable && (
          <Button variant="brand" onClick={() => setCreating(true)}>
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
                <Button variant="brand" onClick={() => setCreating(true)}>
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
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{c.title}</span>
                      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {fmtDate(c.date)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge>{branchName(c, i18n.language)}</Badge>
                      {c.session_id && <Badge variant="success">{t('prep.linked')}</Badge>}
                      {c.matalib.length > 0 && (
                        <Badge variant="warning">
                          {c.matalib.length} {t('session.requirementsShort')}
                        </Badge>
                      )}
                      {meta(c) && (
                        <span className="truncate text-xs text-muted-foreground" title={meta(c)}>
                          {meta(c)}
                        </span>
                      )}
                      {c.leader && (
                        <span className="truncate text-xs text-muted-foreground" title={c.leader}>
                          {c.leader}
                        </span>
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
                    <Td className="tabular-nums">{fmtDate(c.date)}</Td>
                    <Td>
                      <Link
                        to={`/prep-cards/${c.id}`}
                        className="focus-ring rounded font-medium group-hover:text-primary"
                      >
                        {c.title}
                      </Link>
                      {c.session_id && (
                        <Badge variant="success" className="ms-2">
                          {t('prep.linked')}
                        </Badge>
                      )}
                      {meta(c) && (
                        <span className="block text-xs text-muted-foreground">{meta(c)}</span>
                      )}
                    </Td>
                    <Td>
                      <Badge>{branchName(c, i18n.language)}</Badge>
                    </Td>
                    <Td className="text-muted-foreground">{c.leader || '—'}</Td>
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
