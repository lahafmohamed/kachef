import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFetch } from '../hooks';
import { branchName, fmtAmount, fmtDate, fmtPhone, memberName } from '../utils';
import { parentPhones } from '../lib/campFile';
import { telHref } from './MemberParts';
import { arrearsMonths, groupArrears } from '../lib/arrears';
import ExportPdfButton from './ExportPdfButton';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  ErrorState,
  SegmentedControl,
  Select,
  Skeleton,
  IconCalendarCheck,
  IconChevronDown,
  IconPhone,
} from './ui';

// A فرقة shows its five biggest debts first; the rest is a tap away
const FOLD = 5;

function ArrearsRow({ r, t, lng }) {
  const phone = parentPhones(r)[0];
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2.5 sm:px-5">
      <div className="min-w-0 flex-1">
        <Link
          to={`/members/${r.id}?tab=dues`}
          dir="auto"
          className="focus-ring line-clamp-2 rounded-sm text-sm font-medium hover:text-primary"
        >
          {memberName(r)}
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {[
            r.group_name,
            arrearsMonths(r.months, lng),
            r.last_paid_on
              ? t('arrears.lastPaid', { date: fmtDate(r.last_paid_on) })
              : t('arrears.neverPaid'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      {phone && (
        <a
          href={telHref(phone.number)}
          aria-label={t('arrears.callParent', { name: memberName(r), number: fmtPhone(phone.number) })}
          title={fmtPhone(phone.number)}
          className="focus-ring inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-primary sm:h-9 sm:w-9"
        >
          <IconPhone className="h-4 w-4" />
        </a>
      )}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold tabular-nums text-destructive">{fmtAmount(r.owed)}</span>
        <Badge variant="destructive">{t('arrears.monthsChip', { count: r.months.length })}</Badge>
      </div>
    </li>
  );
}

function ArrearsGroup({ g, t, lng }) {
  const [all, setAll] = useState(false);
  const shown = all ? g.rows : g.rows.slice(0, FOLD);
  return (
    <section aria-label={branchName(g, lng)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-y border-border bg-muted/30 px-4 py-2 sm:px-5">
        <h3 className="text-sm font-semibold">
          <bdi>{branchName(g, lng)}</bdi>
        </h3>
        <p className="text-xs font-medium tabular-nums text-muted-foreground">
          {t('arrears.groupLine', { count: g.rows.length, amount: fmtAmount(g.amount) })}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {shown.map((r) => (
          <ArrearsRow key={r.id} r={r} t={t} lng={lng} />
        ))}
      </ul>
      {g.rows.length > FOLD && (
        <div className="border-t border-border px-2 py-1">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setAll(!all)} aria-expanded={all}>
            {all ? t('arrears.showLess') : t('arrears.showAll', { count: g.rows.length - FOLD })}
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * Cotisations en retard (G1), par فرقة: who owes which months, how much, when he last
 * paid, and his parents' number one tap away — the treasurer's calling sheet, exported
 * as PDF or Excel. The عناصر archived with a debt stay below, folded: their debt no
 * longer disappears with them.
 */
export default function DuesArrearsCard() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [branch, setBranch] = useState('');
  const [year, setYear] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  // '' : en retard (un mois passé non réglé) ; '1' : aussi qui ne doit que ce mois-ci
  const [current, setCurrent] = useState('');
  const query = new URLSearchParams(Object.entries({ year, current }).filter(([, v]) => v)).toString();
  const res = useFetch(`/member-dues/arrears${query ? `?${query}` : ''}`);
  const data = res.data;

  if (res.error)
    return <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />;
  if (res.loading && !data) return <Skeleton className="h-64 rounded-2xl" />;

  const allGroups = groupArrears(data.members);
  const keep = (r) => !branch || String(r.branch_id) === branch;
  const groups = allGroups.filter((g) => !branch || String(g.id) === branch);
  const rows = data.members.filter(keep);
  const archived = data.archived.filter(keep);
  const amount = rows.reduce((n, r) => n + r.owed, 0);
  const archivedAmount = archived.reduce((n, r) => n + r.owed, 0);
  const first = 2026;
  const last = Number(data.current_month.slice(0, 4));
  const years = Array.from({ length: last - first + 1 }, (_, i) => String(last - i));
  // Branch choices: every فرقة with a debt, active or archived
  const choices = [
    ...new Map(
      [...data.members, ...data.archived].map((r) => [
        r.branch_id,
        { id: r.branch_id, name_fr: r.branch_name_fr, name_ar: r.branch_name_ar },
      ])
    ).values(),
  ];

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <CardTitle>{t('arrears.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length
              ? t('arrears.summary', { count: rows.length, amount: fmtAmount(amount) })
              : t('arrears.noneShort')}
          </p>
        </div>
        <ExportPdfButton
          kind="dues-arrears"
          id={branch || 0}
          query={query}
          compact
          className="shrink-0"
        />
        <div className="order-last flex w-full flex-wrap items-center gap-2">
          <SegmentedControl
            size="sm"
            label={t('arrears.title')}
            value={current}
            onChange={setCurrent}
            options={[
              { value: '', label: t('arrears.filterLate') },
              { value: '1', label: t('arrears.filterAllOwed') },
            ]}
            className="flex w-full sm:w-auto"
          />
          {choices.length > 1 && (
            <Select
              aria-label={t('member.branch')}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="min-w-0 flex-1 sm:w-56 sm:flex-none"
            >
              <option value="">{t('arrears.allBranches')}</option>
              {choices.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {branchName(g, lng)}
                </option>
              ))}
            </Select>
          )}
          {years.length > 1 && (
            <Select
              aria-label={t('dues.year')}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-36"
            >
              <option value="">{t('arrears.allYears')}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
        {rows.length === 0 ? (
          <EmptyState icon={<IconCalendarCheck className="h-6 w-6" />} title={t('arrears.none')}>
            {t('arrears.noneHint', { amount: fmtAmount(data.rate) })}
          </EmptyState>
        ) : (
          groups.map((g) => <ArrearsGroup key={g.id} g={g} t={t} lng={lng} />)
        )}
        {archived.length > 0 && (
          <div className="border-t border-border">
            <button
              type="button"
              aria-expanded={showArchived}
              onClick={() => setShowArchived(!showArchived)}
              className="focus-ring flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-2 text-start text-sm transition-colors hover:bg-accent/50 sm:px-5"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{t('arrears.archivedTitle')}</span>
                <span className="block text-xs text-muted-foreground">
                  {t('arrears.archivedLine', { count: archived.length, amount: fmtAmount(archivedAmount) })}
                </span>
              </span>
              <IconChevronDown className={cn('shrink-0 text-muted-foreground transition-transform', showArchived && 'rotate-180')} />
            </button>
            {showArchived && (
              <ul className="divide-y divide-border border-t border-border">
                {archived.map((r) => (
                  <ArrearsRow key={r.id} r={r} t={t} lng={lng} />
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
