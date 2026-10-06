import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useFetch } from '../hooks';
import { avatarName, fmtAmount, fmtDate, memberName } from '../utils';
import { toDate } from '../lib/date';
import SearchInput from './SearchInput';
import {
  Avatar,
  Badge,
  Card,
  cn,
  EmptyState,
  ErrorState,
  Select,
  Skeleton,
  useToast,
  IconCheck,
  IconCoins,
  IconSearch,
} from './ui';

// ar-LB gives the Levantine month names (أيلول، تشرين...) the فوج actually uses
const intlLocale = (lng) => (lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR');
export const fmtDueMonth = (month, lng, style = 'short') =>
  new Intl.DateTimeFormat(intlLocale(lng), { month: style }).format(toDate(`${month}-01`));

/** Months already owed: reached, and not before the dues started. */
export const dueMonths = (months, currentMonth, startMonth) =>
  months.filter((m) => m >= startMonth && m <= currentMonth);

/**
 * One month of one قائد's or عنصر's dues. `paid`: what was given for it — a قائد's month
 * is always whole, an عنصر's may be a part of it (`full: false`), shown with its amount.
 * A month not reached yet is still payable (an advance) but reads quieter than one that
 * is owed. A tap toggles the month paid (`onToggle`) — or, where months are picked
 * rather than ticked (`selected` given), picks it.
 */
export function DueCell({ month, paid, owed, editable, onToggle, lng, t, name, selected }) {
  const full = !!paid && paid.full !== false;
  const part = paid && !full ? paid.amount : null;
  const label = `${fmtDueMonth(month, lng, 'long')} ${month.slice(0, 4)} — ${
    full
      ? t('dues.paid')
      : part
        ? t('dues.partPaid', { amount: fmtAmount(part), left: fmtAmount(paid.left) })
        : owed
          ? t('dues.unpaid')
          : t('dues.notYet')
  }`;
  // Who wrote it, and an عنصر's payment taken in a نشاط also says which one
  const lines = paid?.payments
    ? paid.payments.map((p) =>
        [fmtAmount(p.amount), p.session_title || fmtDate(p.paid_on), p.recorded_by && t('treasury.recordedBy', { name: p.recorded_by })]
          .filter(Boolean)
          .join(' · ')
      )
    : paid
      ? [t('dues.recordedBy', { name: paid.recorded_by || '—', amount: fmtAmount(paid.amount) }), paid.session_title]
      : [];
  const title = [label, ...lines].filter(Boolean).join('\n');
  const cls = cn(
    'flex h-9 w-9 items-center justify-center rounded-lg border text-xs transition-[color,background-color,border-color,box-shadow,scale]',
    full
      ? 'border-success/40 bg-success/15 text-success'
      : part
        ? 'border-warning/40 bg-warning/12 text-warning'
        : owed
          ? 'border-destructive/30 bg-destructive/5 text-destructive/70'
          : 'border-dashed border-border text-muted-foreground/50',
    selected && 'ring-2 ring-primary'
  );
  const mark = full ? (
    <IconCheck className="h-4 w-4" />
  ) : part ? (
    <span className="text-[10px] font-semibold tabular-nums">{fmtAmount(part, { unit: false })}</span>
  ) : (
    '·'
  );
  if (!editable)
    return (
      <span className={cls} title={title} role="img" aria-label={label}>
        {mark}
      </span>
    );
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      aria-pressed={selected === undefined ? full : selected}
      aria-label={name ? `${name} — ${label}` : label}
      className={cn(cls, 'focus-ring active:scale-[0.94] hover:border-primary/50')}
    >
      {mark}
    </button>
  );
}

/** The year picker shared by the table and the قائد's own card. */
export function DuesYearSelect({ years, value, onChange, t }) {
  return (
    <Select className="w-auto" value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('dues.year')}>
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </Select>
  );
}

/**
 * اشتراك القادة الشهري: كل قائد × أشهر السنة الكشفية الاثنا عشر (أيلول ← آب).
 * الخانة الخضراء شهر مدفوع، الحمراء شهر حلّ و لم يُدفع، و المنقّطة شهر لم يأتِ بعد.
 */
export default function LeaderDues() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const [year, setYear] = useState('');
  const [query, setQuery] = useState('');
  const [show, setShow] = useState('');
  const res = useFetch(`/leader-dues${year ? `?year=${encodeURIComponent(year)}` : ''}`);
  const data = res.data;

  if (res.error)
    return <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />;
  if (res.loading && !data) return <Skeleton className="h-96 rounded-2xl" />;

  const { months, monthly, current_month: currentMonth } = data;
  const owedMonths = dueMonths(months, currentMonth, data.start_month);
  const rows = data.leaders.map((l) => {
    const paidCount = months.filter((m) => l.paid[m]).length;
    const late = l.status === 'active' ? owedMonths.filter((m) => !l.paid[m]).length : 0;
    return { ...l, paidCount, late };
  });
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter(
    (l) =>
      words.every((w) => memberName(l).toLowerCase().includes(w)) &&
      (show === 'late' ? l.late > 0 : show === 'ok' ? l.late === 0 : true)
  );

  const collected = rows.reduce((n, l) => n + Object.values(l.paid).reduce((s, p) => s + (p.amount || 0), 0), 0);
  const active = rows.filter((l) => l.status === 'active');
  const lateLeaders = active.filter((l) => l.late > 0).length;
  const owedTotal = active.reduce((n, l) => n + l.late * monthly, 0);

  async function toggle(leader, month) {
    const wasPaid = !!leader.paid[month];
    const patch = (paid) =>
      res.setData((d) => ({
        ...d,
        leaders: d.leaders.map((l) =>
          l.id === leader.id ? { ...l, paid: { ...l.paid, [month]: paid || undefined } } : l
        ),
      }));
    patch(wasPaid ? null : { amount: monthly, recorded_by: null });
    try {
      const r = await api.put(`/leaders/${leader.id}/dues/${month}`, { paid: !wasPaid });
      patch(r.paid);
    } catch (err) {
      patch(wasPaid ? leader.paid[month] : null);
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-4">
        <div className="space-y-1 bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('dues.monthly')}</p>
          <p className="text-xl font-bold tabular-nums">{fmtAmount(monthly)}</p>
          <p className="text-xs text-muted-foreground">{t('dues.perYear', { amount: fmtAmount(monthly * 12) })}</p>
        </div>
        <div className="space-y-1 bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('dues.collected')}</p>
          <p className="text-xl font-bold tabular-nums text-success">{fmtAmount(collected)}</p>
          <p className="text-xs text-muted-foreground">{data.year}</p>
        </div>
        <div className="space-y-1 bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('dues.owed')}</p>
          <p className={cn('text-xl font-bold tabular-nums', owedTotal > 0 && 'text-destructive')}>
            {fmtAmount(owedTotal)}
          </p>
          <p className="text-xs text-muted-foreground">{t('dues.owedHint')}</p>
        </div>
        <div className="space-y-1 bg-card p-4">
          <p className="text-xs text-muted-foreground">{t('dues.lateLeaders')}</p>
          <p className="text-xl font-bold tabular-nums">
            {lateLeaders}
            <span className="text-base font-medium text-muted-foreground"> / {active.length}</span>
          </p>
          <p className="text-xs text-muted-foreground">{t('dues.upToDate', { count: active.length - lateLeaders })}</p>
        </div>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput
          value={query}
          onChange={setQuery}
          autoFocusHotkey={false}
          placeholder={t('session.searchLeader')}
          className="sm:w-72 sm:flex-none"
        />
        <Select className="sm:w-auto" value={show} onChange={(e) => setShow(e.target.value)} aria-label={t('dues.filter')}>
          <option value="">{t('dues.filterAll')}</option>
          <option value="late">{t('dues.filterLate')}</option>
          <option value="ok">{t('dues.filterOk')}</option>
        </Select>
        <span className="grow" />
        <DuesYearSelect years={data.years} value={data.year} onChange={setYear} t={t} />
      </div>

      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState
            icon={rows.length ? <IconSearch className="h-6 w-6" /> : <IconCoins className="h-6 w-6" />}
            title={t(rows.length ? 'common.noResults' : 'dues.empty')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="sticky start-0 z-10 bg-card px-4 py-3 text-start font-medium">{t('leader.leadersList')}</th>
                  {months.map((m) => (
                    <th
                      key={m}
                      scope="col"
                      className={cn('px-0.5 py-3 text-center font-medium', m === currentMonth && 'text-primary')}
                    >
                      {fmtDueMonth(m, lng)}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-end font-medium">{t('dues.paidMonths')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id} className="group">
                    <th
                      scope="row"
                      className="sticky start-0 z-10 border-t border-border bg-card px-4 py-2 text-start font-normal group-hover:bg-accent/40"
                    >
                      <Link
                        to={`/leaders/${l.id}`}
                        className="focus-ring flex min-w-36 max-w-48 items-center gap-2.5 rounded-md font-medium hover:text-primary sm:min-w-44 sm:max-w-none"
                      >
                        <Avatar photo={l.photo} name={avatarName(l)} className="h-8 w-8" />
                        <span className="truncate">{memberName(l)}</span>
                        {l.status !== 'active' && <Badge variant="outline">{t('leader.statusInactive')}</Badge>}
                      </Link>
                    </th>
                    {months.map((m) => (
                      <td key={m} className="border-t border-border px-0.5 py-2 group-hover:bg-accent/40">
                        <div className="flex justify-center">
                          <DueCell
                            month={m}
                            paid={l.paid[m]}
                            owed={owedMonths.includes(m) && l.status === 'active'}
                            editable
                            onToggle={() => toggle(l, m)}
                            lng={lng}
                            t={t}
                            name={memberName(l)}
                          />
                        </div>
                      </td>
                    ))}
                    <td className="whitespace-nowrap border-t border-border px-4 py-2 text-end group-hover:bg-accent/40">
                      <span className="font-semibold tabular-nums">{l.paidCount}/12</span>
                      {l.late > 0 ? (
                        <span className="block text-xs text-destructive">
                          {t('dues.lateCount', { count: l.late, amount: fmtAmount(l.late * monthly) })}
                        </span>
                      ) : (
                        <span className="block text-xs text-success">{t('dues.ok')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">{t('dues.legend')}</p>
    </div>
  );
}

/**
 * The dues of one قائد: what he has paid, what he still owes, and the 12 months of the
 * year picked. `endpoint` is '/me/dues' on his own home page, `/leaders/:id/dues`
 * on a profile. Only who holds leaders.dues can tick a month.
 */
export function LeaderDuesCard({ endpoint, compact = false }) {
  const { t } = useTranslation();
  return (
    <DuesCard
      endpoint={endpoint}
      title={t(compact ? 'dues.mine' : 'dues.title')}
      writeUrl={(data, month) => `/leaders/${data.leader_id}/dues/${month}`}
    />
  );
}

/**
 * A قائد's monthly dues, read from `endpoint`: paid so far, still owed, and the 12 months
 * of the year picked, each a tap away from paid or not. `writeUrl(data, month)` is where
 * a tap is saved. `bare`: no card and no heading, inside something that has them.
 */
export function DuesCard({ endpoint, title, writeUrl, bare = false }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [year, setYear] = useState('');
  const res = useFetch(`${endpoint}${year ? `?year=${encodeURIComponent(year)}` : ''}`);
  const data = res.data;
  if (res.error)
    return <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />;
  if (res.loading && !data) return <Skeleton className={cn('rounded-2xl', bare ? 'h-72' : 'h-40')} />;
  // Account not tied to a قائد: nothing to show on the home page
  if (!data) return null;

  async function toggle(month) {
    const was = data.paid[month] || null;
    const set = (p, sum) =>
      res.setData((d) => ({ ...d, paid: { ...d.paid, [month]: p || undefined }, summary: sum || d.summary }));
    set(was ? null : { amount: data.monthly, recorded_by: null });
    try {
      const r = await api.put(writeUrl(data, month), { paid: !was });
      set(r.paid, r.summary);
    } catch (err) {
      set(was);
      toast.error(err.message);
    }
  }

  return <DuesBody data={data} title={title} bare={bare} onYear={setYear} onCell={data.can_edit ? toggle : null} />;
}

/**
 * One person's monthly dues as read from the server — a قائد's or an عنصر's: paid so
 * far, still owed, and the 12 months of the year, each a tap (`onCell(month)`) away
 * from whatever the caller does with it; no `onCell`, the months only read. `selected`:
 * the month picked, where months are picked rather than ticked. `children` come under
 * the heading. `bare`: no card and no heading, inside a dialog that has them.
 */
export function DuesBody({ data, title, bare = false, onYear, onCell = null, selected, children }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { months, monthly, current_month: currentMonth, paid, summary } = data;
  // An عنصر no longer active is asked for nothing; what he paid stays green
  const inactive = data.active === false;
  const owed = inactive ? [] : dueMonths(months, currentMonth, data.start_month);
  // A month paid in part is not paid yet
  const paidCount = months.filter((m) => paid[m] && paid[m].full !== false).length;
  const paidThisYear = months.reduce((n, m) => n + (paid[m]?.amount || 0), 0);
  const unpaid = summary.unpaid_months;
  const monthLabel = (m) => `${fmtDueMonth(m, lng, 'long')} ${m.slice(0, 4)}`;

  const Wrapper = bare ? 'div' : Card;
  return (
    <Wrapper className={cn('space-y-4', !bare && 'p-4 sm:p-5')}>
      {/* The text wraps before the year picker leaves its line */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {!bare && <h2 className="text-base font-semibold">{title}</h2>}
          <p className="text-sm text-muted-foreground">
            {t('dues.monthlyShort', { amount: fmtAmount(monthly) })}
            {/* An عنصر who joined later owes from his own first month */}
            {data.member_id && !inactive && ` · ${t('dues.since', { month: monthLabel(data.start_month) })}`}
          </p>
        </div>
        <DuesYearSelect years={data.years} value={data.year} onChange={onYear} t={t} />
      </div>
      {inactive && <p className="text-sm text-muted-foreground">{t('dues.inactive')}</p>}
      {children}

      {/* Ce que le قائد cherche d'abord : a-t-il encore quelque chose à payer ? */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
        <div className="space-y-0.5 bg-card p-3">
          <p className="text-xs text-muted-foreground">{t('dues.paidIn', { year: data.year })}</p>
          <p className="text-lg font-bold tabular-nums text-success">{fmtAmount(paidThisYear)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {paidCount}/12 · {t('dues.paidTotal', { amount: fmtAmount(summary.paid_total) })}
          </p>
        </div>
        <div className="space-y-0.5 bg-card p-3">
          <p className="text-xs text-muted-foreground">{t('dues.stillOwed')}</p>
          <p className={cn('text-lg font-bold tabular-nums', summary.owed_total > 0 ? 'text-destructive' : 'text-success')}>
            {summary.owed_total > 0 ? fmtAmount(summary.owed_total) : t('dues.ok')}
          </p>
          <p className="text-xs text-muted-foreground">
            {unpaid.length > 0
              ? t('dues.monthsUnpaid', { count: unpaid.length })
              : t('dues.nothingOwed', { month: monthLabel(currentMonth) })}
          </p>
        </div>
      </div>

      {/* Six across at most inside a dialog: twelve 36px cells do not fit its width */}
      <ul className={cn('grid grid-cols-4 gap-2 sm:grid-cols-6', !bare && 'lg:grid-cols-12')}>
        {months.map((m) => (
          <li key={m} className="flex flex-col items-center gap-1">
            <span className={cn('text-xs', m === currentMonth ? 'font-semibold text-primary' : 'text-muted-foreground')}>
              {fmtDueMonth(m, lng)}
            </span>
            <DueCell
              month={m}
              paid={paid[m]}
              owed={owed.includes(m)}
              editable={!!onCell}
              onToggle={() => onCell(m)}
              lng={lng}
              t={t}
              name=""
              selected={selected === undefined ? undefined : selected === m}
            />
          </li>
        ))}
      </ul>

      {unpaid.length > 0 && (
        <p className="text-sm text-destructive">
          <span className="font-medium">{t('dues.unpaidList')}</span> {unpaid.map(monthLabel).join(lng === 'ar' ? '، ' : ', ')}
        </p>
      )}
    </Wrapper>
  );
}
