import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useFetch, useUrlFilters } from '../hooks';
import { useSection } from '../section';
import { fmtAmount, fmtDate, todayISO } from '../utils';
import {
  FLOWS,
  INCOME_SOURCES,
  OUT_FIGURES,
  bookBalanceOn,
  boxName,
  fmtMonth,
  ledgerView,
  resultTone,
  rowText,
  sessionMeta,
} from '../lib/treasury';
import { signed } from '../lib/events';
import AmountInput from '../components/AmountInput';
import DatePicker from '../components/DatePicker';
import ExportPdfButton from '../components/ExportPdfButton';
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
  Select,
  Skeleton,
  useConfirm,
  useToast,
  IconCalendar,
  IconChevronDown,
  IconCoins,
  IconHandHeart,
  IconInbox,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconScale,
  IconShield,
  IconUsers,
  IconTent,
  IconTransfer,
  IconTrash,
  IconWallet,
} from '../components/ui';

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

const tileClass = (on) =>
  cn(
    'focus-ring flex min-w-[9rem] flex-1 shrink-0 snap-start cursor-pointer flex-col justify-between gap-3 rounded-xl border p-3 text-start transition-[border-color,background-color,box-shadow] duration-150',
    on
      ? 'border-primary bg-card shadow-sm ring-1 ring-primary'
      : 'border-border bg-card shadow-xs hover:border-primary/35 hover:bg-accent/40'
  );

/** One caisse in the switcher — or all of them: what is in it, and what it still owes */
function BoxTile({ label, balance, owed, opened, selected, onSelect, t }) {
  const ref = useRef(null);
  // Opened on a caisse further along the row (from a فرقة's page): brought into view
  // sideways only, never dragging the page down to it
  useEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (selected && box && box.top >= 0 && box.bottom <= window.innerHeight)
      ref.current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);
  return (
    <button ref={ref} type="button" aria-pressed={selected} onClick={onSelect} className={tileClass(selected)}>
      <span className={cn('truncate text-sm font-semibold', selected && 'text-primary')}>{label}</span>
      <span className="leading-none">
        {opened ? (
          <span className={cn('block text-xl font-bold leading-none tabular-nums', balance < 0 && 'text-destructive')}>
            <span dir="ltr">{money(balance)}</span>
          </span>
        ) : (
          <span className="block text-sm leading-none text-muted-foreground">{t('treasury.boxNotOpen')}</span>
        )}
        {owed > 0 && (
          <span className="mt-1.5 block text-xs font-medium text-warning">
            {t('treasury.owedSummary', { amount: fmtAmount(owed) })}
          </span>
        )}
      </span>
    </button>
  );
}

// A line of the balance that the أمين المال can tap to correct a box's opening
const lineButton =
  'focus-ring -mx-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-start transition-colors hover:bg-accent hover:text-accent-foreground sm:min-h-8';

/**
 * The three numbers of one caisse, or of all of them together: what is in it now, what
 * came in and what went out since it was opened. Under one box's balance, when and
 * with how much it started. Beside it, the أمين المال balances it against a count.
 */
function Figures({ fig, box, name, canManage, onOpening, onCount, t }) {
  const income = INCOME_SOURCES.map((k) => ({ key: k, label: t(`treasury.in_${k}`), amount: fig.income[k] })).filter(
    (i) => i.amount > 0
  );
  const spent = OUT_FIGURES.map((k) => ({ key: k, label: t(`treasury.cat_${k}`), amount: fig.expenses[k] }))
    .filter((i) => i.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const start = box?.start;
  const startText =
    start &&
    (start.inherited
      ? t('treasury.startedWithGroup', { date: fmtDate(start.date) })
      : t('treasury.openedOn', { date: fmtDate(start.date), amount: fmtAmount(start.amount) }));
  return (
    <Card className="grid grid-cols-1 gap-px overflow-hidden bg-border sm:grid-cols-2 lg:grid-cols-3">
      <Figure label={name ? `${t('treasury.balance')} · ${name}` : t('treasury.balance')} className="sm:col-span-2 lg:col-span-1">
        {/* A long balance pushes the button under it rather than past the card */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className={cn('min-w-0 text-3xl font-bold tracking-tight tabular-nums', fig.balance < 0 && 'text-destructive')}>
            <span dir="ltr">{money(fig.balance)}</span>
          </p>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => onCount(box)} className="shrink-0">
              <IconScale />
              {t('treasury.countAction')}
            </Button>
          )}
        </div>
        {fig.balance < 0 && <p className="text-xs font-medium text-destructive">{t('treasury.deficit')}</p>}
        {fig.owed > 0 && (
          <p className="text-xs font-medium text-warning">
            <bdi className="whitespace-nowrap">{t('treasury.owedSummary', { amount: fmtAmount(fig.owed) })}</bdi>
            {' · '}
            {/* A deficit's «−» isolated left-to-right: in Arabic it would otherwise trail the figure */}
            <bdi className="whitespace-nowrap">
              {t('treasury.afterOwed', { amount: `⁦${money(fig.balance - fig.owed)}⁩` })}
            </bdi>
          </p>
        )}
        {startText &&
          (canManage ? (
            <button
              type="button"
              onClick={() => onOpening(box)}
              aria-label={`${t('treasury.editOpening')} — ${startText}`}
              className={cn(lineButton, 'text-xs text-muted-foreground')}
            >
              {startText}
              {start.inherited ? (
                <span className="font-medium text-primary">{t('treasury.setOwnCount')}</span>
              ) : (
                <IconPencil className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <p className="py-1 text-xs text-muted-foreground">{startText}</p>
          ))}
      </Figure>
      <Figure label={t('treasury.income')}>
        <p className="text-2xl font-bold tabular-nums">{fmtAmount(fig.income.total)}</p>
        <Breakdown items={income} empty={t('treasury.nothingYet')} />
      </Figure>
      <Figure label={t('treasury.expenses')}>
        <p className="text-2xl font-bold tabular-nums">{fmtAmount(fig.expenses.total)}</p>
        <Breakdown items={spent} empty={t('treasury.nothingYet')} />
      </Figure>
    </Card>
  );
}

const ROW_BASE =
  'focus-ring flex w-full items-center gap-3 text-start transition-colors hover:bg-accent/40 focus-visible:[outline-offset:-2px]!';
const ROW_CLASS = `${ROW_BASE} px-4 py-3 sm:px-5`;
// A line opened under a نشاط's: its text under the نشاط's title (past the icon), its
// amount under the total (short of the chevron)
const NESTED_PAD = 'py-2.5 ps-16 pe-11 sm:ps-[4.25rem] sm:pe-12';

/**
 * One movement: a نشاط's اشتراكات (one line per نشاط), a day of اشتراكات القادة (who
 * paid, how many months), the عناصر' monthly dues taken in a نشاط or on a day outside
 * one, a transfer, money given to or back from a camp, or a line written by hand, or
 * what a count found more or less than the book. What is written here opens for
 * correction; the other lines lead to where they are recorded.
 * `direction` 'move': a transfer between two caisses on screen, which moves nothing.
 * `nested`: one of a نشاط's movements, opened under its line — which already says the
 * day and the نشاط, and stands for the icon. A مصروف of it still owed is one of them.
 */
function JournalRow({ r, t, lng, names, tag, canEdit, canSessions, canDues, canMembers, onEdit, nested = false }) {
  const { title, meta, isIn, move, owed } = rowText(r, { t, lng, names, nested });
  const Icon =
    r.source === 'transfer'
      ? IconTransfer
      : r.source === 'count'
        ? IconScale
        : r.source === 'event'
        ? IconTent
        : r.source === 'session'
        ? IconCalendar
        : r.source === 'dues'
          ? IconShield
          : r.source === 'member_dues'
            ? IconUsers
            : !isIn
            ? IconReceipt
            : r.category === 'donation'
              ? IconHandHeart
              : IconCoins;
  const rowClass = nested ? `${ROW_BASE} ${NESTED_PAD}` : ROW_CLASS;
  const body = (
    <>
      {!nested && (
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            isIn ? 'bg-success/12 text-success' : 'bg-muted text-muted-foreground'
          )}
        >
          <Icon />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{title}</span>
          {tag && <Badge variant="outline">{tag}</Badge>}
          {owed && <Badge variant="warning">{t('treasury.statusOwed')}</Badge>}
        </span>
        <Meta items={meta} />
      </span>
      <span
        dir="ltr"
        className={cn(
          'shrink-0 font-semibold tabular-nums',
          isIn && 'text-success',
          (move || owed) && 'text-muted-foreground'
        )}
      >
        {move ? '' : isIn ? '+' : '−'}
        {fmtAmount(r.amount)}
      </span>
    </>
  );

  if (['entry', 'transfer', 'count'].includes(r.source) && canEdit)
    return (
      <button
        type="button"
        onClick={() => onEdit(r)}
        aria-label={`${t('common.edit')} — ${title} ${fmtAmount(r.amount)}`}
        className={rowClass}
      >
        {body}
      </button>
    );
  // Written and corrected on the camp's page, where its money is
  if (r.source === 'event' && r.event_id && canSessions)
    return (
      <Link to={`/events/${r.event_id}?tab=money`} className={ROW_CLASS}>
        {body}
      </Link>
    );
  if (r.source === 'session' && canSessions)
    return (
      <Link to={`/sessions/${r.session_id}`} className={rowClass}>
        {body}
      </Link>
    );
  if (r.source === 'dues' && canDues)
    return (
      <Link to="/leaders?tab=dues" className={ROW_CLASS}>
        {body}
      </Link>
    );
  // Dues taken in a نشاط lead to it; outside one, a single عنصر's to his card
  if (r.source === 'member_dues' && r.session_id && canSessions)
    return (
      <Link to={`/sessions/${r.session_id}`} className={ROW_CLASS}>
        {body}
      </Link>
    );
  if (r.source === 'member_dues' && !r.session_id && r.members.length === 1 && r.members[0].id && canMembers)
    return (
      <Link to={`/members/${r.members[0].id}?tab=dues`} className={ROW_CLASS}>
        {body}
      </Link>
    );
  return <div className={cn('flex items-center gap-3', nested ? NESTED_PAD : 'px-4 py-3 sm:px-5')}>{body}</div>;
}

/**
 * A نشاط as one line: what it brought in, what it cost and what it left — won, lost or
 * even, as its own page says. Tapped, it opens on its movements — each corrected there
 * like any line, a مصروف still owed among them — and on the way to the نشاط.
 * `flow`: the journal shows only what came in or went out — the نشاط's share of it then.
 */
function SessionRow({ g, flow, t, tag, canSessions, rowProps }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const tone = resultTone(g.result);
  const meta = sessionMeta(g, flow, t);
  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={id} className={ROW_CLASS}>
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            g.result > 0 ? 'bg-success/12 text-success' : g.result < 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
          )}
        >
          <IconCalendar />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{g.session_title}</span>
            {tag && <Badge variant="outline">{tag}</Badge>}
          </span>
          <Meta items={meta} />
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span dir="ltr" className={cn('font-semibold tabular-nums', tone.className)}>
            {signed(g.result)}
          </span>
          {/* The word first — the colour only repeats it; filtered, the sum is no result */}
          {!flow && <span className={cn('text-xs font-medium', tone.className)}>{t(tone.key)}</span>}
        </span>
        <IconChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div id={id} className="border-t border-border bg-muted/25">
          <ul className="divide-y divide-border">
            {g.items.map((r) => (
              <li key={r.key}>
                <JournalRow r={r} t={t} nested {...rowProps(r)} />
              </li>
            ))}
          </ul>
          {canSessions && (
            <Link
              to={`/sessions/${g.session_id}`}
              className={`focus-ring flex min-h-11 items-center border-t border-border text-xs font-medium text-primary hover:underline focus-visible:[outline-offset:-2px]! ${NESTED_PAD}`}
            >
              {t('treasury.openSession')}
            </Link>
          )}
        </div>
      )}
    </>
  );
}

/**
 * What is still owed: مصاريف a قائد advanced or a shop gave on credit. They stay out
 * of their caisse until it pays them — the oldest first.
 */
function OwedCard({ owed, total, t, tagOf, canManage, onEdit, onPay }) {
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
            const tag = tagOf(x);
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
                    {tag && <Badge variant="outline">{tag}</Badge>}
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

/** What the caisse will hold after, or that it does not hold that much */
function LeftAfter({ after, t }) {
  if (after === null || after === undefined) return null;
  return (
    <p className={cn('text-sm', after < 0 ? 'font-medium text-destructive' : 'text-muted-foreground')}>
      {after < 0 ? t('treasury.boxShort') : t('treasury.leftAfter', { amount: money(after) })}
    </p>
  );
}

/**
 * Paying what is owed, out of its own caisse: the day it left (today unless told
 * otherwise), and what the caisse holds once it has.
 */
function PayDialog({ entry, box, boxLabel, onClose, onSaved, t }) {
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

  const openingDate = box?.start?.date;
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
              <p className="text-xs text-muted-foreground">
                {t('treasury.owedRowTo', { name: entry.owed_to })} · {boxLabel}
              </p>
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
          <LeftAfter after={box?.start ? box.balance - entry.amount : null} t={t} />
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
 * Moving money from a caisse the قائد holds to another of its قسم: a فرقة handing the
 * فوج what it collected, the فوج giving a فرقة what it needs. Both caisses change; the
 * total does not.
 */
function TransferDialog({ open, transfer, boxes, defaultFrom, nameOf, onClose, onSaved, t }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ from: '', to: '', amount: '', date: '', label: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const held = boxes.filter((b) => b.visible);
  const targetsOf = (fromKey) => {
    const from = boxes.find((b) => b.key === fromKey);
    return from ? boxes.filter((b) => b.section === from.section && b.key !== from.key) : [];
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (transfer) {
      setForm({
        from: transfer.from,
        to: transfer.to,
        amount: String(transfer.amount),
        date: transfer.date,
        label: transfer.label || '',
      });
      return;
    }
    const from = defaultFrom || held[0]?.key || '';
    const targets = targetsOf(from);
    // A فرقة hands its money to the فوج; the فوج gives to a فرقة
    const to = targets.find((b) => !b.branch_id)?.key || targets[0]?.key || '';
    setForm({ from, to, amount: '', date: todayISO(), label: '' });
  }, [open, transfer]); // eslint-disable-line react-hooks/exhaustive-deps -- the boxes on opening

  function setFrom(e) {
    const from = e.target.value;
    setForm((f) => {
      const targets = targetsOf(from);
      return { ...f, from, to: targets.some((b) => b.key === f.to) ? f.to : targets[0]?.key || '' };
    });
  }

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        from: form.from,
        to: form.to,
        amount: Number(form.amount),
        date: form.date,
        label: form.label.trim() || null,
      };
      const res = transfer
        ? await api.put(`/treasury/transfers/${transfer.id}`, body)
        : await api.post('/treasury/transfers', body);
      onSaved(res, transfer ? 'treasury.transferUpdated' : 'treasury.transferAdded');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !(await confirm({
        title: t('treasury.editTransfer'),
        message: t('treasury.deleteTransferConfirm', { amount: fmtAmount(transfer.amount) }),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      onSaved(await api.del(`/treasury/transfers/${transfer.id}`), 'treasury.transferDeleted');
    } catch (err) {
      toast.error(err.message);
    }
  }

  const from = boxes.find((b) => b.key === form.from);
  // Editing: what the transfer already took out goes back before the new amount leaves
  const back = transfer && transfer.from === form.from && from?.start && transfer.date >= from.start.date ? transfer.amount : 0;
  const after = from?.start && form.amount ? from.balance + back - Number(form.amount) : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(transfer ? 'treasury.editTransfer' : 'treasury.transferTitle')}
      footer={
        <div className="flex items-center justify-between gap-2">
          {transfer ? (
            <Button variant="destructive-ghost" onClick={remove}>
              <IconTrash />
              {t('common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="treasury-transfer-form" loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <form id="treasury-transfer-form" onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="tr_from">{t('treasury.transferFrom')}</Label>
            <Select id="tr_from" value={form.from} onChange={setFrom}>
              {held.map((b) => (
                <option key={b.key} value={b.key}>
                  {nameOf(b.key)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr_to">{t('treasury.transferTo')}</Label>
            <Select id="tr_to" value={form.to} onChange={set('to')}>
              {targetsOf(form.from).map((b) => (
                <option key={b.key} value={b.key}>
                  {nameOf(b.key)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr_amount">{t('treasury.amount')}</Label>
            <AmountInput
              id="tr_amount"
              required
              value={form.amount}
              onChange={set('amount')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr_date">{t('common.date')}</Label>
            <DatePicker id="tr_date" required clearable={false} value={form.date} onChange={set('date')} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tr_label">{t('treasury.transferNote')}</Label>
          <Input
            id="tr_label"
            maxLength={200}
            autoComplete="off"
            placeholder={t('treasury.transferNoteHint')}
            value={form.label}
            onChange={set('label')}
          />
        </div>
        <LeftAfter after={after} t={t} />
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/**
 * Opening a caisse, or correcting its opening: the amount counted in it on the morning
 * of a day. Everything recorded from that day on is added to it. A فرقة's caisse that
 * started empty with the فوج's gets its own count here. `box` null: the form asks
 * which caisse.
 */
function OpeningDialog({ open, box, boxes, nameOf, onClose, onSaved, t }) {
  const [form, setForm] = useState({ box: '', amount: '', date: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const held = boxes.filter((b) => b.visible);
  const current = box?.start && !box.start.inherited ? box.start : null;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm({
      box: box?.key || held[0]?.key || '',
      amount: current ? String(current.amount) : '',
      date: current?.date || todayISO(),
    });
  }, [open, box]); // eslint-disable-line react-hooks/exhaustive-deps -- the boxes on opening

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await api.put('/treasury/opening', {
        box: form.box,
        amount: Number(form.amount),
        date: form.date,
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
      title={box ? `${t('treasury.openingTitle')} — ${nameOf(box.key)}` : t('treasury.openingTitle')}
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
        {!box && held.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="op_box">{t('treasury.box')}</Label>
            <Select id="op_box" value={form.box} onChange={(e) => setForm((f) => ({ ...f, box: e.target.value }))}>
              {held.map((b) => (
                <option key={b.key} value={b.key}>
                  {nameOf(b.key)}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="op_amount">{t('treasury.openingAmount')}</Label>
            <AmountInput
              id="op_amount"
              required
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

/**
 * Balancing a caisse: the amount really in it, counted on a day, against what its lines
 * say it holds by then. The gap is written into the caisse with its reason, so its
 * balance becomes what was counted. `box` null: the form asks which caisse. `count`:
 * a balancing redone — the book is reckoned without it.
 */
function CountDialog({ open, count, box, boxes, rows, nameOf, onClose, onSaved, t }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ box: '', counted: '', date: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const opened = boxes.filter((b) => b.visible && b.start);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      count
        ? { box: count.box, counted: String(count.counted), date: count.date, reason: count.label || '' }
        : { box: box?.key || opened[0]?.key || '', counted: '', date: todayISO(), reason: '' }
    );
  }, [open, count]); // eslint-disable-line react-hooks/exhaustive-deps -- the boxes on opening

  const target = boxes.find((b) => b.key === form.box);
  const book = bookBalanceOn(target, rows, form.date, count);
  const counted = form.counted === '' ? null : Number(form.counted);
  const gap = book === null || counted === null || !Number.isFinite(counted) ? null : Math.round((counted - book) * 100) / 100;
  const early = target?.start && form.date && form.date < target.start.date;

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = { box: form.box, counted, date: form.date, reason: form.reason.trim() };
      const res = count
        ? await api.put(`/treasury/counts/${count.id}`, body)
        : await api.post('/treasury/counts', body);
      onSaved(res, count ? 'treasury.countUpdated' : 'treasury.countSaved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !(await confirm({
        title: t('treasury.editCount'),
        message: t('treasury.deleteCountConfirm', { amount: fmtAmount(count.amount) }),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      onSaved(await api.del(`/treasury/counts/${count.id}`), 'treasury.countDeleted');
    } catch (err) {
      toast.error(err.message);
    }
  }

  const title = count ? t('treasury.editCount') : t('treasury.countTitle');
  const fixed = count || box;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={fixed && target ? `${title} — ${nameOf(target.key)}` : title}
      description={t('treasury.countIntro')}
      footer={
        <div className="flex items-center justify-between gap-2">
          {count ? (
            <Button variant="destructive-ghost" onClick={remove}>
              <IconTrash />
              {t('common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="treasury-count-form" loading={saving} disabled={!!early || gap === 0}>
              {count ? t('common.save') : t('treasury.countAction')}
            </Button>
          </div>
        </div>
      }
    >
      <form id="treasury-count-form" onSubmit={save} className="space-y-4">
        {!fixed && opened.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="ct_box">{t('treasury.box')}</Label>
            <Select id="ct_box" value={form.box} onChange={set('box')}>
              {opened.map((b) => (
                <option key={b.key} value={b.key}>
                  {nameOf(b.key)}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ct_amount">{t('treasury.countedAmount')}</Label>
            <AmountInput
              id="ct_amount"
              required
              value={form.counted}
              onChange={set('counted')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct_date">{t('treasury.openingDate')}</Label>
            <DatePicker id="ct_date" required clearable={false} value={form.date} onChange={set('date')} />
          </div>
        </div>
        {early ? (
          <p role="alert" className="text-sm font-medium text-warning">
            {t('treasury.countBeforeOpening', { date: fmtDate(target.start.date) })}
          </p>
        ) : (
          book !== null && (
            <dl className="divide-y divide-border rounded-lg border border-border text-sm">
              <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                <dt className="text-muted-foreground">{t('treasury.countBook')}</dt>
                <dd dir="ltr" className="font-medium tabular-nums">
                  {money(book)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                <dt className="text-muted-foreground">{t('treasury.countCounted')}</dt>
                <dd dir="ltr" className="font-medium tabular-nums">
                  {counted === null ? '—' : fmtAmount(counted)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                <dt className="font-medium">{t('treasury.countGap')}</dt>
                <dd
                  className={cn(
                    'font-semibold tabular-nums',
                    gap > 0 && 'text-success',
                    gap < 0 && 'text-destructive'
                  )}
                >
                  {gap === null ? (
                    '—'
                  ) : gap === 0 ? (
                    fmtAmount(0)
                  ) : (
                    <>
                      <span dir="ltr">
                        {gap > 0 ? '+' : '−'}
                        {fmtAmount(Math.abs(gap))}
                      </span>{' '}
                      <span className="font-medium">{t(gap > 0 ? 'treasury.countOver' : 'treasury.countShort')}</span>
                    </>
                  )}
                </dd>
              </div>
            </dl>
          )
        )}
        {gap === 0 && <p className="text-sm font-medium text-success">{t('treasury.countExact')}</p>}
        {gap !== null && gap !== 0 && (
          <p className="text-sm text-muted-foreground">{t('treasury.countAfter', { amount: fmtAmount(counted) })}</p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ct_reason">{t('treasury.countReason')}</Label>
          <Input
            id="ct_reason"
            required
            maxLength={200}
            autoComplete="off"
            placeholder={t('treasury.countReasonHint')}
            value={form.reason}
            onChange={set('reason')}
          />
        </div>
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
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[5.25rem] min-w-[9rem] flex-1 rounded-xl" />
        ))}
      </div>
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
 * الصناديق: a caisse for the فوج and one for each فرقة. Each tile says what is in one;
 * picked, it shows what came in and went out since it was opened, what it still owes,
 * then every movement month by month — «Toutes» puts them together. The أمين المال
 * writes the مصاريف, the تبرعات and the transfers here; اشتراكات الأنشطة go to their
 * فرقة's caisse on their own, اشتراكات القادة to the فوج's, a نشاط's مصاريف from its page.
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
  // { box } while a caisse is opened or its opening corrected (box null: asked)
  const [openingDialog, setOpeningDialog] = useState(null);
  // The owed مصروف being paid
  const [paying, setPaying] = useState(null);
  // { transfer } while one is written or corrected
  const [transferDialog, setTransferDialog] = useState(null);
  // { box, count } while a caisse is balanced (box null: asked) or a balancing redone
  const [countDialog, setCountDialog] = useState(null);

  const data = ledger.data;
  const canManage = !!data?.can_manage;
  // The caisse on screen: one asked for in the address, else all of them together —
  // or the only one there is; its lines in the direction asked for
  const { boxes, byKey, held, multi, sel, owed, rows, months, fig } = ledgerView(data, {
    box: sp.get('box') || '',
    flow,
  });
  const nameOf = (key) => boxName(byKey[key], t, lng, { both });
  const shortOf = (b) => boxName(b, t, lng, { both, short: true });
  const names = {
    short: (key) => shortOf(byKey[key]),
    inline: (key) => boxName(byKey[key], t, lng, { both, inline: true }),
  };
  const anyOpen = held.some((b) => b.start);
  const openings = Object.fromEntries(held.filter((b) => b.start).map((b) => [b.key, b.start.date]));

  // All caisses on screen: each line says whose it is
  const tagOf = (r) => (!sel && multi && r.direction !== 'move' ? shortOf(byKey[r.box]) : null);
  // A transfer is corrected by whoever holds the caisse it left
  const canEditRow = (r) => canManage && (r.source !== 'transfer' || !!byKey[r.from]?.visible);
  // Somewhere to send money: another caisse of a held one's قسم
  const canTransfer = held.some((h) => boxes.some((b) => b.section === h.section && b.key !== h.key));
  const writeBox = sel?.key || held.find((b) => b.start)?.key || held[0]?.key;
  // What a journal line needs besides itself, whether on its own or under its نشاط
  const rowProps = (r) => ({
    lng,
    names,
    canEdit: canEditRow(r),
    canSessions: has('sessions.read'),
    canDues: has('leaders.dues'),
    canMembers: has('members.read'),
    onEdit: (x) =>
      x.source === 'transfer'
        ? setTransferDialog({ transfer: x })
        : x.source === 'count'
          ? setCountDialog({ box: null, count: x })
          : setEntryDialog({ direction: x.direction, entry: x }),
  });

  const saved = (res, key) => {
    setEntryDialog(null);
    setOpeningDialog(null);
    setPaying(null);
    setTransferDialog(null);
    setCountDialog(null);
    ledger.setData(res);
    toast.success(t(key));
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('treasury.title')} description={t('treasury.subtitle')}>
        {canManage && anyOpen && (
          <>
            <Button variant="outline" onClick={() => setEntryDialog({ direction: 'in', entry: null })}>
              <IconHandHeart />
              {t('treasury.addIncome')}
            </Button>
            {canTransfer && (
              <Button
                variant="outline"
                onClick={() => setTransferDialog({ transfer: null })}
                aria-label={t('treasury.transferTitle')}
              >
                <IconTransfer />
                {/* Three actions outgrow a phone's row: the icon alone there */}
                <span className="hidden sm:inline">{t('treasury.addTransfer')}</span>
              </Button>
            )}
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
      ) : !anyOpen ? (
        <Card>
          <EmptyState
            icon={<IconWallet className="h-6 w-6" />}
            title={t('treasury.notOpenTitle')}
            action={
              canManage && (
                <Button variant="brand" onClick={() => setOpeningDialog({ box: null })}>
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
          {multi && (
            // Swiped sideways on a phone; a grid from tablet up
            <div
              role="group"
              aria-label={t('treasury.title')}
              className="no-scrollbar relative -mx-4 flex snap-x gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] sm:overflow-visible sm:p-0"
            >
              <BoxTile
                label={t('treasury.allBoxes')}
                balance={data.summary.balance}
                owed={data.summary.owed}
                opened
                selected={!sel}
                onSelect={() => patch({ box: '' })}
                t={t}
              />
              {held.map((b) => (
                <BoxTile
                  key={b.key}
                  label={shortOf(b)}
                  balance={b.balance}
                  owed={b.owed}
                  opened={!!b.start}
                  selected={sel?.key === b.key}
                  onSelect={() => patch({ box: b.key })}
                  t={t}
                />
              ))}
            </div>
          )}

          {sel && !sel.start ? (
            <Card>
              <EmptyState
                icon={<IconWallet className="h-6 w-6" />}
                title={t('treasury.boxNotOpenTitle', { name: nameOf(sel.key) })}
                action={
                  canManage && (
                    <Button variant="brand" onClick={() => setOpeningDialog({ box: sel })}>
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
              <Figures
                fig={fig}
                box={sel}
                // No tiles to say whose caisse this is: the only one the قائد holds
                name={!multi && sel ? shortOf(sel) : null}
                canManage={canManage}
                onOpening={(box) => setOpeningDialog({ box })}
                onCount={(box) => setCountDialog({ box, count: null })}
                t={t}
              />

              {owed.length > 0 && (
                <OwedCard
                  owed={owed}
                  total={owed.reduce((n, x) => n + x.amount, 0)}
                  t={t}
                  tagOf={tagOf}
                  canManage={canManage}
                  onEdit={(entry) => setEntryDialog({ direction: 'out', entry })}
                  onPay={setPaying}
                />
              )}

              <Card>
                {/* Phone: title and export on one line, the filter under them. Wider:
                    title, filter, export */}
                <CardHeader className="flex-row flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
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
                    className="order-last flex w-full sm:order-none sm:w-auto"
                  />
                  {/* The file holds what is on screen: the caisse picked (or all of
                      them) and the direction the journal shows */}
                  <ExportPdfButton
                    kind="treasury"
                    id={0}
                    query={new URLSearchParams(Object.entries({ box: sel?.key || '', flow }).filter(([, v]) => v)).toString()}
                    compact
                    className="shrink-0"
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
                              {r.source === 'session_group' ? (
                                <SessionRow
                                  g={r}
                                  flow={flow}
                                  t={t}
                                  tag={tagOf(r)}
                                  canSessions={has('sessions.read')}
                                  rowProps={rowProps}
                                />
                              ) : (
                                <JournalRow r={r} t={t} tag={tagOf(r)} {...rowProps(r)} />
                              )}
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
            boxes={held}
            defaultBox={writeBox}
            bothSections={both}
            onSaved={saved}
          />
          <PayDialog
            entry={paying}
            box={paying ? byKey[paying.box] : null}
            boxLabel={paying ? names.short(paying.box) : ''}
            onClose={() => setPaying(null)}
            onSaved={saved}
            t={t}
          />
          <TransferDialog
            open={!!transferDialog}
            transfer={transferDialog?.transfer ?? null}
            boxes={boxes}
            defaultFrom={sel?.key}
            nameOf={names.short}
            onClose={() => setTransferDialog(null)}
            onSaved={saved}
            t={t}
          />
          <CountDialog
            open={!!countDialog}
            count={countDialog?.count ?? null}
            box={countDialog?.box ?? null}
            boxes={boxes}
            rows={data?.rows || []}
            nameOf={names.short}
            onClose={() => setCountDialog(null)}
            onSaved={saved}
            t={t}
          />
          <OpeningDialog
            open={!!openingDialog}
            box={openingDialog?.box ?? null}
            boxes={boxes}
            nameOf={names.short}
            onClose={() => setOpeningDialog(null)}
            onSaved={saved}
            t={t}
          />
        </>
      )}
    </div>
  );
}
