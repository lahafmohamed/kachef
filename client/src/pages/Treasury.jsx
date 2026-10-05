import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useFetch, useUrlFilters } from '../hooks';
import { useSection } from '../section';
import { fmtAmount, fmtDate, todayISO } from '../utils';
import { INCOME_SOURCES, OUT_CATEGORIES, byMonth, fmtMonth } from '../lib/treasury';
import DatePicker from '../components/DatePicker';
import SectionField from '../components/SectionField';
import TreasuryEntryDialog from '../components/TreasuryEntryDialog';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  SegmentedControl,
  Skeleton,
  useToast,
  IconCalendar,
  IconCoins,
  IconHandHeart,
  IconInbox,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconShield,
  IconWallet,
} from '../components/ui';

const FLOWS = ['in', 'out'];

// A deficit carries its sign: «−2 500» reads as one with or without colour
const money = (n) => (n < 0 ? `−${fmtAmount(-n)}` : fmtAmount(n));

function Figure({ label, children, className }) {
  return (
    <div className={cn('min-w-0 space-y-2 bg-card p-4 sm:p-5', className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Where a total comes from, largest first — each line a label and its amount */
function Breakdown({ items, empty }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <dl className="space-y-1 text-sm">
      {items.map((i) => (
        <div key={i.key} className="flex items-baseline justify-between gap-3">
          <dt className="min-w-0 text-muted-foreground">{i.label}</dt>
          <dd className="shrink-0 font-medium tabular-nums">{fmtAmount(i.amount)}</dd>
        </div>
      ))}
    </dl>
  );
}

// A line of the balance that the أمين المال can tap to correct or open a قسم's box
const lineButton =
  'focus-ring -mx-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-start transition-colors hover:bg-accent hover:text-accent-foreground sm:min-h-8';

/**
 * The three numbers: what is in the box now, what came in and what went out since it
 * was opened — and, under the balance, when each box was opened and with how much.
 */
function Figures({ data, both, canManage, onOpening, t }) {
  const s = data.summary;
  const income = INCOME_SOURCES.map((k) => ({ key: k, label: t(`treasury.in_${k}`), amount: s.income[k] })).filter(
    (i) => i.amount > 0
  );
  const spent = OUT_CATEGORIES.map((k) => ({ key: k, label: t(`treasury.cat_${k}`), amount: s.expenses[k] }))
    .filter((i) => i.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  return (
    <Card className="grid grid-cols-1 gap-px overflow-hidden bg-border sm:grid-cols-2 lg:grid-cols-3">
      <Figure label={t('treasury.balance')} className="sm:col-span-2 lg:col-span-1">
        <p className={cn('text-3xl font-bold tracking-tight tabular-nums', s.balance < 0 && 'text-destructive')}>
          <span dir="ltr">{money(s.balance)}</span>
        </p>
        {s.balance < 0 && <p className="text-xs font-medium text-destructive">{t('treasury.deficit')}</p>}
        {s.owed > 0 && (
          <p className="text-xs font-medium text-warning">
            <bdi className="whitespace-nowrap">{t('treasury.owedSummary', { amount: fmtAmount(s.owed) })}</bdi>
            {' · '}
            {/* A deficit's «−» isolated left-to-right: in Arabic it would otherwise trail the figure */}
            <bdi className="whitespace-nowrap">
              {t('treasury.afterOwed', { amount: `⁦${money(s.balance - s.owed)}⁩` })}
            </bdi>
          </p>
        )}
        <ul className="text-xs text-muted-foreground">
          {data.sections.map(({ section, opening }) => {
            const name = t(`section.${section}`);
            const text = opening
              ? t(both ? 'treasury.sectionOpenedOn' : 'treasury.openedOn', {
                  section: name,
                  date: fmtDate(opening.date),
                  amount: fmtAmount(opening.amount),
                })
              : t('treasury.sectionNotOpen', { section: name });
            return (
              <li key={section}>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => onOpening({ section, current: opening })}
                    aria-label={opening ? `${t('treasury.editOpening')} — ${text}` : `${t('treasury.openSection')} — ${text}`}
                    className={lineButton}
                  >
                    {text}
                    {opening ? (
                      <IconPencil className="h-3.5 w-3.5" />
                    ) : (
                      <span className="font-medium text-primary">{t('treasury.openSection')}</span>
                    )}
                  </button>
                ) : (
                  <span className="block py-1">{text}</span>
                )}
              </li>
            );
          })}
        </ul>
      </Figure>
      <Figure label={t('treasury.income')}>
        <p className="text-2xl font-bold tabular-nums">{fmtAmount(s.income.total)}</p>
        <Breakdown items={income} empty={t('treasury.nothingYet')} />
      </Figure>
      <Figure label={t('treasury.expenses')}>
        <p className="text-2xl font-bold tabular-nums">{fmtAmount(s.expenses.total)}</p>
        <Breakdown items={spent} empty={t('treasury.nothingYet')} />
      </Figure>
    </Card>
  );
}

const ROW_CLASS =
  'focus-ring flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-accent/40 focus-visible:[outline-offset:-2px]! sm:px-5';

/**
 * One movement: a نشاط's اشتراكات (one line per نشاط), a day of اشتراكات القادة (who
 * paid, how many months), or a line written by hand. What is written by hand opens for
 * correction; the computed lines lead to where they are recorded.
 */
function JournalRow({ r, t, lng, tagSection, canManage, canSessions, canDues, onEdit }) {
  const isIn = r.direction === 'in';
  const Icon =
    r.source === 'session'
      ? IconCalendar
      : r.source === 'dues'
        ? IconShield
        : !isIn
          ? IconReceipt
          : r.category === 'donation'
            ? IconHandHeart
            : IconCoins;
  const title =
    r.source === 'session'
      ? r.label
      : r.source === 'dues'
        ? t('treasury.duesRow')
        : r.label || t(r.category === 'donation' ? 'treasury.donation' : 'treasury.otherIncome');
  const meta = [fmtDate(r.date)];
  if (r.source === 'session') meta.push(t('treasury.sessionFees'), t('treasury.payers', { count: r.payers }));
  else if (r.source === 'dues') {
    // A whole month of اشتراكات can land on one day: three names, then how many more
    const months = r.leaders.reduce((n, l) => n + l.months, 0);
    const names = r.leaders
      .slice(0, 3)
      .map((l) => l.name)
      .join(lng === 'ar' ? '، ' : ', ');
    // «+2» isolated left-to-right: after Arabic names it would otherwise read «2+»
    const more = r.leaders.length - 3;
    meta.push(t('treasury.monthsPaid', { count: months }), more > 0 ? `${names} ⁦+${more}⁩` : names);
  } else {
    // An unnamed تبرّع is already titled «تبرّع»: its kind would only repeat it
    if (!isIn || r.label) meta.push(t(isIn ? `treasury.type_${r.category}` : `treasury.cat_${r.category}`));
    if (r.owed_to) meta.push(t('treasury.paidRowTo', { name: r.owed_to }));
    if (r.spent_on !== r.date) meta.push(t('treasury.spentOn', { date: fmtDate(r.spent_on) }));
    if (r.session_title) meta.push(t('treasury.forSession', { title: r.session_title }));
    if (r.created_by) meta.push(t('treasury.recordedBy', { name: r.created_by }));
  }

  const body = (
    <>
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          isIn ? 'bg-success/12 text-success' : 'bg-muted text-muted-foreground'
        )}
      >
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{title}</span>
          {tagSection && <Badge variant={r.section === 'F' ? 'info' : 'outline'}>{t(`section.${r.section}`)}</Badge>}
        </span>
        <Meta items={meta} />
      </span>
      <span dir="ltr" className={cn('shrink-0 font-semibold tabular-nums', isIn && 'text-success')}>
        {isIn ? '+' : '−'}
        {fmtAmount(r.amount)}
      </span>
    </>
  );

  if (r.source === 'entry' && canManage)
    return (
      <button
        type="button"
        onClick={() => onEdit(r)}
        aria-label={`${t('common.edit')} — ${title} ${fmtAmount(r.amount)}`}
        className={ROW_CLASS}
      >
        {body}
      </button>
    );
  if (r.source === 'session' && canSessions)
    return (
      <Link to={`/sessions/${r.session_id}`} className={ROW_CLASS}>
        {body}
      </Link>
    );
  if (r.source === 'dues' && canDues)
    return (
      <Link to="/leaders?tab=dues" className={ROW_CLASS}>
        {body}
      </Link>
    );
  return <div className="flex items-center gap-3 px-4 py-3 sm:px-5">{body}</div>;
}

/** A line's facts, each kept whole: the line breaks between them, never inside a short one */
function Meta({ items }) {
  return (
    <span className="block text-xs text-muted-foreground">
      {items.map((m, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          <bdi className={m.length <= 24 ? 'whitespace-nowrap' : undefined}>{m}</bdi>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * What is still owed: مصاريف a قائد advanced or a shop gave on credit. They stay out
 * of the balance until the أمين المال pays them — the oldest first.
 */
function OwedCard({ owed, total, t, tagSection, canManage, onEdit, onPay }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('treasury.owedTitle')}
          <span className="ms-2 font-normal tabular-nums text-warning">{fmtAmount(total)}</span>
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('treasury.owedSubtitle')}</p>
      </CardHeader>
      <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
        <ul className="divide-y divide-border border-t border-border">
          {owed.map((x) => {
            const meta = [
              t('treasury.owedRowTo', { name: x.owed_to }),
              fmtDate(x.spent_on),
              t(`treasury.cat_${x.category}`),
              x.session_title && t('treasury.forSession', { title: x.session_title }),
            ].filter(Boolean);
            const body = (
              <>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                  <IconReceipt />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{x.label}</span>
                    {tagSection && (
                      <Badge variant={x.section === 'F' ? 'info' : 'outline'}>{t(`section.${x.section}`)}</Badge>
                    )}
                  </span>
                  <Meta items={meta} />
                </span>
                <span dir="ltr" className="shrink-0 font-semibold tabular-nums">
                  {fmtAmount(x.amount)}
                </span>
              </>
            );
            return (
              <li key={x.key} className="flex items-center">
                {canManage ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onEdit(x)}
                      aria-label={`${t('common.edit')} — ${x.label} ${fmtAmount(x.amount)}`}
                      className={cn(ROW_CLASS, 'min-w-0 flex-1 pe-2 sm:pe-3')}
                    >
                      {body}
                    </button>
                    <div className="shrink-0 pe-4 sm:pe-5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onPay(x)}
                        aria-label={`${t('treasury.pay')} — ${x.label} ${fmtAmount(x.amount)}`}
                      >
                        {t('treasury.pay')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 sm:px-5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Paying what is owed: the day it left the box (today unless told otherwise), and what
 * the قسم's box holds once it has.
 */
function PayDialog({ entry, onClose, onSaved, balance, openingDate, t }) {
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!entry) return;
    setError(null);
    setDate(todayISO());
  }, [entry]);

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      onSaved(await api.post(`/treasury/entries/${entry.id}/pay`, { date }), 'treasury.expensePaid');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const after = balance === null || balance === undefined || !entry ? null : balance - entry.amount;
  return (
    <Dialog
      open={!!entry}
      onClose={onClose}
      title={t('treasury.payTitle')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="treasury-pay-form" loading={saving}>
            {t('treasury.payConfirm')}
          </Button>
        </div>
      }
    >
      {entry && (
        <form id="treasury-pay-form" onSubmit={save} className="space-y-4">
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0">
              <p className="font-medium">{entry.label}</p>
              <p className="text-xs text-muted-foreground">{t('treasury.owedRowTo', { name: entry.owed_to })}</p>
            </div>
            <p dir="ltr" className="shrink-0 font-semibold tabular-nums">
              {fmtAmount(entry.amount)}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay_date">{t('treasury.paidOn')}</Label>
            <DatePicker
              id="pay_date"
              required
              clearable={false}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {after !== null && (
            <p className={cn('text-sm', after < 0 ? 'font-medium text-destructive' : 'text-muted-foreground')}>
              {after < 0 ? t('treasury.payShort') : t('treasury.payAfter', { amount: money(after) })}
            </p>
          )}
          {openingDate && date && date < openingDate && (
            <p className="text-sm font-medium text-warning">
              {t('treasury.beforeOpening', { date: fmtDate(openingDate) })}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
        </form>
      )}
    </Dialog>
  );
}

/**
 * Opening a قسم's box, or correcting its opening: the amount counted in it on the
 * morning of a day. Everything recorded from that day on is added to it.
 */
function OpeningDialog({ open, onClose, onSaved, section, current, t }) {
  const [form, setForm] = useState({ amount: '', date: '', section: 'M' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Both أقسام on screen and no قسم named yet: the form asks whose box this is
  const pickSection = !section;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm({
      amount: current ? String(current.amount) : '',
      date: current?.date || todayISO(),
      section: section || 'M',
    });
  }, [open, section, current]);

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await api.put('/treasury/opening', {
        amount: Number(form.amount),
        date: form.date,
        section: pickSection ? form.section : section,
      });
      onSaved(res, current ? 'treasury.openingUpdated' : 'treasury.openingSaved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={section ? `${t('treasury.openingTitle')} — ${t(`section.${section}`)}` : t('treasury.openingTitle')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="treasury-opening-form" loading={saving}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <form id="treasury-opening-form" onSubmit={save} className="space-y-4">
        {pickSection && (
          <SectionField value={form.section} onChange={(v) => setForm((f) => ({ ...f, section: v }))} />
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="op_amount">{t('treasury.openingAmount')}</Label>
            <Input
              id="op_amount"
              required
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              className="tabular-nums"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="op_date">{t('treasury.openingDate')}</Label>
            <DatePicker
              id="op_date"
              required
              clearable={false}
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('treasury.openingHint')}</p>
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Card className="grid grid-cols-1 gap-px overflow-hidden bg-border sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={cn('space-y-3 bg-card p-4 sm:p-5', i === 0 && 'sm:col-span-2 lg:col-span-1')}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </Card>
      <Card className="divide-y divide-border">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </Card>
    </div>
  );
}

/**
 * الصندوق: what the فوج has now, what came in and went out since the box was opened,
 * then every movement month by month. The أمين المال writes the مصاريف and the
 * تبرعات here; اشتراكات الأنشطة and اشتراكات القادة arrive on their own from where
 * they are recorded, and a نشاط's مصاريف from its page.
 */
export default function Treasury() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const { has } = usePerms();
  const { section } = useSection();
  const both = !section;
  const ledger = useFetch('/treasury');
  const [sp, patch] = useUrlFilters();
  const flow = FLOWS.includes(sp.get('flow')) ? sp.get('flow') : '';
  // { direction, entry } while a line is written or corrected
  const [entryDialog, setEntryDialog] = useState(null);
  // { section, current } while a box is opened or its opening corrected
  const [openingDialog, setOpeningDialog] = useState(null);
  // The owed مصروف being paid
  const [paying, setPaying] = useState(null);

  const data = ledger.data;
  const canManage = !!data?.can_manage;
  const sections = data?.sections || [];
  const opened = sections.filter((s) => s.opening);
  const openings = Object.fromEntries(opened.map((s) => [s.section, s.opening.date]));
  const rows = (data?.rows || []).filter((r) => !flow || r.direction === flow);
  const owed = data?.owed || [];
  const months = byMonth(rows);
  // Both أقسام on screen: each line says whose box it is — once both have lines
  const tagSection = new Set([...rows, ...owed].map((r) => r.section)).size > 1;

  const saved = (res, key) => {
    setEntryDialog(null);
    setOpeningDialog(null);
    setPaying(null);
    ledger.setData(res);
    toast.success(t(key));
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('treasury.title')} description={t('treasury.subtitle')}>
        {canManage && opened.length > 0 && (
          <>
            <Button variant="outline" onClick={() => setEntryDialog({ direction: 'in', entry: null })}>
              <IconHandHeart />
              {t('treasury.addIncome')}
            </Button>
            {/* «Ajouter une dépense» beside «Don ou recette» outgrows a phone's row */}
            <Button variant="brand" onClick={() => setEntryDialog({ direction: 'out', entry: null })}>
              <IconPlus />
              <span className="sm:hidden">{t('treasury.addExpenseShort')}</span>
              <span className="hidden sm:inline">{t('treasury.addExpense')}</span>
            </Button>
          </>
        )}
      </PageHeader>

      {ledger.error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={ledger.reload} retryLabel={t('error.retry')} />
      ) : ledger.loading || !data ? (
        <LoadingState />
      ) : opened.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconWallet className="h-6 w-6" />}
            title={t('treasury.notOpenTitle')}
            action={
              canManage && (
                <Button variant="brand" onClick={() => setOpeningDialog({ section, current: null })}>
                  <IconWallet />
                  {t('treasury.openAction')}
                </Button>
              )
            }
          >
            {t(canManage ? 'treasury.notOpenHint' : 'treasury.notOpenReadonly')}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Figures data={data} both={both} canManage={canManage} onOpening={setOpeningDialog} t={t} />

          {owed.length > 0 && (
            <OwedCard
              owed={owed}
              total={data.summary.owed}
              t={t}
              tagSection={tagSection}
              canManage={canManage}
              onEdit={(entry) => setEntryDialog({ direction: 'out', entry })}
              onPay={setPaying}
            />
          )}

          <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle>{t('treasury.journal')}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('treasury.movementCount', { count: rows.length })}
                </p>
              </div>
              <SegmentedControl
                size="sm"
                label={t('treasury.journal')}
                value={flow}
                onChange={(v) => patch({ flow: v })}
                options={[
                  { value: '', label: t('treasury.filterAll') },
                  { value: 'in', label: t('treasury.filterIn') },
                  { value: 'out', label: t('treasury.filterOut') },
                ]}
                className="flex w-full sm:w-auto"
              />
            </CardHeader>
            <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
              {rows.length === 0 ? (
                <EmptyState
                  icon={<IconInbox className="h-6 w-6" />}
                  title={t(
                    flow === 'in'
                      ? 'treasury.emptyFilterIn'
                      : flow === 'out'
                        ? 'treasury.emptyFilterOut'
                        : 'treasury.emptyJournal'
                  )}
                >
                  {!flow && t('treasury.emptyJournalHint')}
                </EmptyState>
              ) : (
                months.map((m) => (
                  <section key={m.key} aria-label={fmtMonth(m.key, lng)}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-y border-border bg-muted/30 px-4 py-2 sm:px-5">
                      <h3 className="text-sm font-semibold">{fmtMonth(m.key, lng)}</h3>
                      <p dir="ltr" className="flex gap-3 text-xs font-medium tabular-nums">
                        {m.in > 0 && <span className="text-success">+{fmtAmount(m.in)}</span>}
                        {m.out > 0 && <span className="text-muted-foreground">−{fmtAmount(m.out)}</span>}
                      </p>
                    </div>
                    <ul className="divide-y divide-border">
                      {m.rows.map((r) => (
                        <li key={r.key}>
                          <JournalRow
                            r={r}
                            t={t}
                            lng={lng}
                            tagSection={tagSection}
                            canManage={canManage}
                            canSessions={has('sessions.read')}
                            canDues={has('leaders.dues')}
                            onEdit={(entry) => setEntryDialog({ direction: entry.direction, entry })}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}

      {canManage && (
        <>
          <TreasuryEntryDialog
            open={!!entryDialog}
            onClose={() => setEntryDialog(null)}
            direction={entryDialog?.direction || 'out'}
            entry={entryDialog?.entry ?? null}
            endpoint="/treasury/entries"
            openings={openings}
            section={section}
            pickSection={both}
            onSaved={saved}
          />
          <PayDialog
            entry={paying}
            onClose={() => setPaying(null)}
            onSaved={saved}
            balance={sections.find((s) => s.section === paying?.section)?.balance}
            openingDate={paying ? openings[paying.section] : null}
            t={t}
          />
          <OpeningDialog
            open={!!openingDialog}
            onClose={() => setOpeningDialog(null)}
            section={openingDialog?.section ?? null}
            current={openingDialog?.current ?? null}
            onSaved={saved}
            t={t}
          />
        </>
      )}
    </div>
  );
}
