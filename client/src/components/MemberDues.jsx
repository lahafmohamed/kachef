import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useFetch } from '../hooks';
import { fmtAmount, fmtDate, memberName } from '../utils';
import { DuesBody, fmtDueMonth } from './LeaderDues';
import {
  Badge,
  Button,
  cn,
  Dialog,
  ErrorState,
  SegmentedControl,
  Skeleton,
  useToast,
  IconCalendar,
  IconCalendarCheck,
} from './ui';

// «octobre» / «تشرين الأول», and «Octobre» where it opens a line
const monthName = (month, lng) => fmtDueMonth(month, lng, 'long');
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// What an عنصر gives at once goes by 500: a quarter of the month, half, three quarters,
// all of it — and, should a month be left with some other sum, that sum
const STEP = 500;
const amountChoices = (left) => {
  const out = [];
  for (let v = STEP; v < left; v += STEP) out.push(v);
  out.push(left);
  return out;
};

/**
 * The month picked in an عنصر's dues: what was given for it and when — each payment can
 * be taken back — and, while some of it is left, how much he gives now: all that is left
 * by default, or a part of it.
 */
function DuesMonth({ data, month, session, busy, onCollect, onUndo }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const info = data.paid[month] || null;
  const left = info ? info.left : data.monthly;
  const [amount, setAmount] = useState(left);
  // Another month picked, or a payment in or out: back to all that is left
  useEffect(() => setAmount(left), [month, left]);
  const canEdit = !!data.can_edit;
  const owed = data.active !== false && month >= data.start_month && month <= data.current_month;
  const name = capitalize(monthName(month, lng));

  // Where a payment was taken: here, in another نشاط, or outside one — and by whom
  const where = (p) =>
    [
      session && p.session_id === session.id
        ? t('session.duesPaidHere')
        : p.session_title
          ? t('session.duesPaidIn', { date: fmtDate(p.paid_on), title: p.session_title })
          : t('session.duesPaidOn', { date: fmtDate(p.paid_on) }),
      p.recorded_by && t('treasury.recordedBy', { name: p.recorded_by }),
    ]
      .filter(Boolean)
      .join(' · ');

  // A form's width on a wide profile: amounts spread over a whole card read apart
  return (
    <div className="max-w-xl space-y-3">
      {info && (
        <div
          className={cn(
            'space-y-2 rounded-xl border p-3',
            info.full ? 'border-success/30 bg-success/8' : 'border-warning/30 bg-warning/8'
          )}
        >
          <p className={cn('flex items-center gap-2 font-medium', info.full ? 'text-success' : 'text-warning')}>
            {info.full ? (
              <IconCalendarCheck className="h-5 w-5 shrink-0" />
            ) : (
              <IconCalendar className="h-5 w-5 shrink-0" />
            )}
            <span className="min-w-0">
              {info.full
                ? `${t('session.duesMonthPaid', { month: name })} · ${fmtAmount(info.amount)}`
                : t('session.duesMonthPart', { month: name, amount: fmtAmount(info.amount), left: fmtAmount(left) })}
            </span>
          </p>
          <ul className="divide-y divide-border/60">
            {info.payments.map((p) => (
              <li key={p.id} className="flex min-h-11 items-center gap-3 py-1 sm:min-h-9">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  <span className="font-semibold tabular-nums text-foreground">{fmtAmount(p.amount)}</span>
                  {' · '}
                  {where(p)}
                </p>
                {canEdit && (
                  <Button variant="destructive-ghost" size="sm" disabled={busy} onClick={() => onUndo(p)}>
                    {t('session.duesUndo')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {canEdit && left > 0 && (
        <div className="space-y-2">
          {left > STEP && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">{t('session.duesAmount')}</p>
              <SegmentedControl
                label={t('session.duesAmount')}
                value={amount}
                onChange={setAmount}
                options={amountChoices(left).map((v) => ({ value: v, label: fmtAmount(v, { unit: false }) }))}
                className="flex w-full tabular-nums"
              />
            </div>
          )}
          <Button className="w-full" loading={busy} onClick={() => onCollect(month, amount)}>
            <IconCalendarCheck />
            {t('session.duesCollect', { month: monthName(month, lng), amount: fmtAmount(amount) })}
          </Button>
          {!owed && !info && <p className="text-xs text-muted-foreground">{t('session.duesNotOwed')}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * An عنصر's monthly dues: the month picked — given in full or in part, each payment a tap
 * from being taken back — over his whole year, where a tap picks another month (one owed
 * from before, or paid ahead). In a نشاط (`session`) it opens on the نشاط's month, and
 * what is given is taken in it, on its day; elsewhere on this month, taken today. `bare`:
 * inside a dialog; otherwise a card titled `title`. `onSaved(month, paid)` follows every
 * change, `onCollected(month)` each payment taken.
 */
export function MemberDuesPanel({ memberId, name, session = null, bare = false, title, onSaved, onCollected }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const opening = session?.member_dues.month ?? null;
  const [year, setYear] = useState(opening ? opening.slice(0, 4) : '');
  // null: this month, once the server has said which it is
  const [month, setMonth] = useState(opening);
  const [busy, setBusy] = useState(false);
  const res = useFetch(`/members/${memberId}/dues${year ? `?year=${encodeURIComponent(year)}` : ''}`);
  const data = res.data;

  if (res.error)
    return <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />;
  if (res.loading && !data) return <Skeleton className={cn('rounded-2xl', bare ? 'h-96' : 'h-72')} />;

  const picked = month && month.startsWith(data.year) ? month : data.current_month.startsWith(data.year) ? data.current_month : data.months[0];

  // The year changes, the month stays: October of the year before is a tap away
  const pickYear = (y) => {
    setYear(y);
    setMonth(`${y}-${picked.slice(5)}`);
  };

  // The month after a change, and his whole account with it — here and behind
  const apply = (r) => {
    res.setData((d) => ({ ...d, paid: { ...d.paid, [r.month]: r.paid || undefined }, summary: r.summary }));
    onSaved?.(r.month, r.paid);
  };

  async function collect(m, amount) {
    setBusy(true);
    try {
      const r = await api.post(`/members/${memberId}/dues/${m}`, { amount, session_id: session?.id ?? null });
      apply(r);
      toast.success(t('session.duesCollected', { amount: fmtAmount(amount), name, month: monthName(m, lng) }));
      onCollected?.(m);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function undo(p) {
    setBusy(true);
    try {
      const r = await api.del(`/members/${memberId}/dues/payments/${p.id}`);
      apply(r);
      toast.success(t('session.duesUndone', { amount: fmtAmount(p.amount), month: monthName(r.month, lng) }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const panel = (
    <DuesMonth data={data} month={picked} session={session} busy={busy} onCollect={collect} onUndo={undo} />
  );
  const hint = (
    <p className="text-xs text-muted-foreground">
      {data.can_edit ? t(session ? 'session.duesHint' : 'dues.memberHint') : t('dues.memberLegend')}
    </p>
  );
  const body = (children) => (
    <DuesBody data={data} title={title} bare={bare} onYear={pickYear} onCell={setMonth} selected={picked}>
      {children}
    </DuesBody>
  );
  // In a dialog the month comes first: taking it is why the dialog was opened
  if (bare)
    return (
      <div className="space-y-5">
        {panel}
        {body(null)}
        {hint}
      </div>
    );
  return body(
    <>
      {panel}
      {hint}
    </>
  );
}

/** اشتراك العنصر الشهري, on his profile: what he paid, what he still owes, month by month. */
export function MemberDuesCard({ member }) {
  const { t } = useTranslation();
  return <MemberDuesPanel memberId={member.id} name={memberName(member)} title={t('dues.title')} />;
}

/**
 * The نشاط's month of an عنصر's dues, on his roster line: green once that month is paid
 * — here or elsewhere — amber with what was given while only a part of it is, a quiet
 * calendar while nothing is; a tap opens the dialog. The month's name shows from sm up;
 * on a phone the line already holds the name, the نشاط's coin and the présence control,
 * and the card above the roster names the month — a part paid still shows its amount.
 * An account that only reads sees a month paid or begun, nothing otherwise.
 */
export function DuesChip({ m, month, editable, onOpen }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const info = m.dues.month;
  const full = !!info?.full;
  const part = info && !full ? info.amount : null;
  const short = fmtDueMonth(month, lng);
  const label = t('session.duesOf', {
    name: memberName(m),
    month: `${monthName(month, lng)} ${month.slice(0, 4)}`,
    state: full
      ? t('dues.paid')
      : part
        ? t('dues.partPaid', { amount: fmtAmount(part), left: fmtAmount(info.left) })
        : m.dues.owes
          ? t('dues.unpaid')
          : t('dues.notYet'),
  });
  const amount = part && <span className="tabular-nums">{fmtAmount(part, { unit: false })}</span>;
  if (!editable)
    return full || part ? (
      <Badge variant={full ? 'success' : 'warning'} title={label}>
        {full ? <IconCalendarCheck className="h-3 w-3" /> : <IconCalendar className="h-3 w-3" />}
        {short}
        {part && <> · {amount}</>}
      </Badge>
    ) : null;
  const Icon = full ? IconCalendarCheck : IconCalendar;
  return (
    <Button
      variant={full || part ? 'secondary' : 'ghost'}
      size="sm"
      onClick={onOpen}
      aria-label={label}
      title={label}
      className={cn(
        'gap-1.5 sm:w-auto sm:px-3',
        part ? 'px-2.5' : 'w-11 px-0',
        full ? 'text-success' : part ? 'text-warning' : 'text-muted-foreground'
      )}
    >
      <Icon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
      <span className="sr-only sm:not-sr-only">{short}</span>
      {part && (
        <span aria-hidden="true" className="sm:before:content-['·_']">
          {amount}
        </span>
      )}
    </Button>
  );
}

/**
 * An عنصر's monthly dues, opened from a نشاط: its month first — the usual case, taken
 * in one tap, in full or in part — then his whole year, for months owed from before or
 * paid ahead. Whatever is given here is taken in this نشاط, on its day, into his فرقة's
 * box. `member` is his roster line (null: closed); `onSaved(memberId, month, paid)`
 * follows every change, so the line behind stays right. Taking the نشاط's month closes
 * the dialog: the next عنصر is waiting.
 */
export function MemberDuesDialog({ member, session, onClose, onSaved }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={!!member}
      onClose={onClose}
      title={t('dues.title')}
      description={member ? memberName(member) : ''}
      footer={
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      }
    >
      {member && (
        <MemberDuesPanel
          key={member.id}
          bare
          memberId={member.id}
          name={memberName(member)}
          session={session}
          onSaved={(month, paid) => onSaved(member.id, month, paid)}
          onCollected={(month) => month === session.member_dues.month && onClose()}
        />
      )}
    </Dialog>
  );
}
