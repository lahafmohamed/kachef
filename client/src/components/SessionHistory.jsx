import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFetch } from '../hooks';
import { fmtDueMonth } from './LeaderDues';
import { activityTypeKey, branchName, fmtAmount, fmtDate, fmtTime } from '../utils';
import { toISO } from '../lib/date';
import {
  Badge,
  Card,
  cn,
  EmptyState,
  ErrorState,
  Skeleton,
  IconArrow,
  IconCalendar,
  IconCamera,
  IconClock,
  IconCoins,
  IconFileSheet,
  IconFileText,
  IconHandHeart,
  IconLock,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconStar,
  IconUserCheck,
  IconUsers,
} from './ui';

/*
 * Historique d'une séance : qui l'a créée, et qui y a changé quoi, quand
 * (GET /api/sessions/:id/history). Le serveur lit le journal d'audit, regroupe les
 * pointages d'un même compte, et cache ce que la page cache à ce lecteur (montants,
 * éléments d'une branche qu'il ne voit pas). Chaque ligne : le compte, ce qui a changé,
 * l'heure, puis le détail « avant → après ».
 */

// ---------- time ----------

// audit_events.created_at is UTC «YYYY-MM-DD HH:MM:SS»
export const atDate = (at) => new Date(`${String(at).replace(' ', 'T')}Z`);
// ar-LB: the Levantine month names the فوج uses; Latin digits in both languages
const intlLocale = (lng) => (lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR');
const formats = {};
const cached = (key, make) => (formats[key] ??= make());
// The ar formatter's bidi marks reverse segments inside dir="ltr" islands
const unmark = (s) => s.replace(/[‎‏؜]/g, '');

const fmtClock = (d, lng) =>
  unmark(
    cached(`clock${lng}`, () =>
      new Intl.DateTimeFormat(intlLocale(lng), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    ).format(d)
  );

function fmtDay(d, lng, t) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (toISO(d) === toISO(today)) return t('history.today');
  if (toISO(d) === toISO(yesterday)) return t('history.yesterday');
  const year = d.getFullYear() !== today.getFullYear();
  return unmark(
    cached(`day${lng}${year}`, () =>
      new Intl.DateTimeFormat(intlLocale(lng), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        ...(year && { year: 'numeric' }),
      })
    ).format(d)
  );
}

/** The local day of a UTC timestamp, as dates read everywhere else (03/10/2026). */
export const fmtAtDate = (at) => fmtDate(toISO(atDate(at)));

/** «il y a 5 min», «il y a 2 h» within a day; «le 04/10/2026» after. */
export function fmtWhen(at, lng, t) {
  const d = atDate(at);
  const minutes = Math.round((Date.now() - d.getTime()) / 60000);
  if (minutes < 1) return t('push.justNow');
  const rel = cached(`rel${lng}`, () => new Intl.RelativeTimeFormat(intlLocale(lng), { numeric: 'auto', style: 'short' }));
  if (minutes < 60) return rel.format(-minutes, 'minute');
  if (minutes < 24 * 60) return rel.format(-Math.round(minutes / 60), 'hour');
  return t('history.onDate', { date: fmtAtDate(at) });
}

// ---------- one line ----------

const TYPE_ICONS = {
  created: IconPlus,
  details: IconPencil,
  attendance: IconUserCheck,
  counts: IconUsers,
  animators: IconUsers,
  guests: IconUsers,
  files: IconCamera,
  expenses: IconReceipt,
  donations: IconHandHeart,
  dues: IconCoins,
  evaluation: IconStar,
  finalized: IconLock,
  reopened: IconLock,
  roster: IconUsers,
};
const FILE_ICONS = { image: IconCamera, pdf: IconFileText, excel: IconFileSheet };
const STATUS = {
  present: ['success', 'session.present'],
  absent: ['destructive', 'session.absent'],
  excused: ['warning', 'session.excused'],
};
// Above this many rows a line folds, keeping the first ones
const FOLD_AT = 6;
const FOLDED = 5;
// A person is withdrawn and a monthly due cancelled; anything else is deleted
const REMOVAL_WORD = {
  animators: 'history.withdrawal',
  guests: 'history.withdrawal',
  evaluation: 'history.withdrawal',
  dues: 'history.cancellation',
};

const added = (r) => r.from === null;
const removed = (r) => r.to === null;
// Lines named once whatever they hold; the others (lists) say whether they added or removed
const ONE_NAME = new Set(['created', 'details', 'attendance', 'counts', 'animators', 'finalized', 'reopened']);

// What happened, in the reader's language: for a list, the verb comes from its rows
function itemLabel(item, t, kind) {
  if (item.type === 'animators' && kind === 'leaders') return t('history.type.leadersAttendance');
  if (ONE_NAME.has(item.type)) return t(`history.type.${item.type}`);
  const rows = item.rows;
  const verb = rows.length && rows.every(added) ? 'add' : rows.length && rows.every(removed) ? 'remove' : 'edit';
  return t(`history.type.${item.type}.${verb}`, { count: Math.max(rows.length, 1) });
}

// How many things it touched: one عنصر whose status and payment both changed is one
const itemCount = (item) => new Set(item.rows.map((r) => r.subject.member_id ?? r.key)).size;

function Change({ from, to }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="text-muted-foreground">{from}</span>
      <IconArrow aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
      <span className="sr-only">{t('history.becomes')}</span>
      <span className="font-medium text-foreground">{to}</span>
    </span>
  );
}

function StatusValue({ status, badge }) {
  const { t } = useTranslation();
  const [variant, key] = STATUS[status] || ['outline', 'session.unmarked'];
  return badge ? <Badge variant={variant}>{t(key)}</Badge> : <span>{t(key)}</span>;
}

// A field of the séance as it reads on its page
function fieldValue(field, v, t, lng) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return t('history.none');
  switch (field) {
    case 'date':
      return <bdi className="tabular-nums">{fmtDate(v)}</bdi>;
    case 'start_time':
      return <bdi className="tabular-nums">{fmtTime(v)}</bdi>;
    case 'activity_type':
      return activityTypeKey(v) ? t(activityTypeKey(v)) : v;
    case 'fee':
      return <bdi className="tabular-nums">{fmtAmount(v)}</bdi>;
    case 'matalib':
      return <bdi className="tabular-nums">{v.join(lng === 'ar' ? '، ' : ', ')}</bdi>;
    case 'leaders_count':
      return <span className="tabular-nums">{v}</span>;
    default:
      return <bdi className="[overflow-wrap:anywhere]">{v}</bdi>;
  }
}

const money = (v, t) => (v === null || v === undefined ? t('session.notPaid') : <bdi className="tabular-nums">{fmtAmount(v)}</bdi>);

// A caisse line (dépense or don) changed: what its other fields became
function entryNotes(from, to, t) {
  const notes = [];
  if ((from.label || '') !== (to.label || ''))
    notes.push([
      t('treasury.expenseLabel'),
      <Change key="l" from={<bdi>{from.label || t('history.none')}</bdi>} to={<bdi>{to.label || t('history.none')}</bdi>} />,
    ]);
  if (from.category !== to.category)
    notes.push([t('treasury.category'), <Change key="c" from={t(`treasury.cat_${from.category}`)} to={t(`treasury.cat_${to.category}`)} />]);
  if (from.date !== to.date)
    notes.push([t('history.field.date'), <Change key="d" from={fmtDate(from.date)} to={fmtDate(to.date)} />]);
  if (from.paid_on !== to.paid_on || from.owed_to !== to.owed_to)
    notes.push([
      null,
      to.paid_on ? t('treasury.paidOnRow', { date: fmtDate(to.paid_on) }) : t('treasury.owedRowTo', { name: to.owed_to || '—' }),
    ]);
  return notes;
}

/** One change inside a line: what it is about, then before → after. */
function HistoryRow({ r, type, mixed, kind }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const s = r.subject;
  const gone = removed(r);
  // Who or what the row is about
  let subject;
  let change = null;
  let notes = [];
  const unknown = t('history.unknown');
  switch (type) {
    case 'details':
      subject = <span className="text-muted-foreground">{t(`history.field.${s.field}`)}</span>;
      change = <Change from={fieldValue(s.field, r.from, t, lng)} to={fieldValue(s.field, r.to, t, lng)} />;
      break;
    case 'attendance':
      subject = <bdi>{s.name || unknown}</bdi>;
      change =
        s.field === 'paid' ? (
          <Change from={money(r.from, t)} to={money(r.to, t)} />
        ) : s.field === 'reason' ? (
          <Change
            from={r.from ? t(`followup.reason.${r.from}`) : t('history.none')}
            to={r.to ? t(`followup.reason.${r.to}`) : t('history.none')}
          />
        ) : (
          <Change from={<StatusValue status={r.from} />} to={<StatusValue status={r.to} badge />} />
        );
      break;
    case 'counts':
      subject = s.branch_id ? (
        <bdi>{branchName(s, lng) || unknown}</bdi>
      ) : (
        <span className="text-muted-foreground">{t('history.field.leaders_count')}</span>
      );
      change = (
        <Change
          from={<span className="tabular-nums">{r.from ?? t('history.none')}</span>}
          to={<span className="tabular-nums">{r.to ?? t('history.none')}</span>}
        />
      );
      break;
    case 'animators':
      subject = <bdi>{s.name || unknown}</bdi>;
      if (kind === 'leaders')
        change = <Change from={<StatusValue status={r.from?.status} />} to={<StatusValue status={r.to?.status} badge />} />;
      else if (added(r))
        change = (
          <Change
            from={t('history.none')}
            to={
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {t('session.helper')}
                {r.to.status && <StatusValue status={r.to.status} badge />}
              </span>
            }
          />
        );
      else if (!gone) change = <Change from={<StatusValue status={r.from.status} />} to={<StatusValue status={r.to.status} badge />} />;
      break;
    case 'files': {
      const Icon = FILE_ICONS[s.kind] || IconFileText;
      subject = (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <bdi className="min-w-0 [overflow-wrap:anywhere]">{s.name}</bdi>
        </span>
      );
      break;
    }
    case 'expenses':
    case 'donations': {
      const v = r.to || r.from;
      const label = v.label || t(type === 'donations' ? 'treasury.donation' : `treasury.cat_${v.category}`);
      subject = <bdi className="[overflow-wrap:anywhere]">{label}</bdi>;
      if (added(r) || gone) {
        change = <bdi className={cn('tabular-nums', !gone && 'font-medium')}>{fmtAmount(v.amount)}</bdi>;
        if (added(r) && !v.paid_on) notes = [[null, t('treasury.owedRowTo', { name: v.owed_to || '—' })]];
      } else {
        change =
          r.from.amount !== r.to.amount ? (
            <Change from={<bdi className="tabular-nums">{fmtAmount(r.from.amount)}</bdi>} to={<bdi className="tabular-nums">{fmtAmount(r.to.amount)}</bdi>} />
          ) : (
            <bdi className="tabular-nums">{fmtAmount(r.to.amount)}</bdi>
          );
        notes = entryNotes(r.from, r.to, t);
      }
      break;
    }
    case 'dues':
      subject = <bdi>{s.name || unknown}</bdi>;
      change = (
        <span className="tabular-nums">
          {fmtDueMonth(s.month, lng, 'long')} {s.month.slice(0, 4)} · <bdi>{fmtAmount(r.to ?? r.from)}</bdi>
        </span>
      );
      break;
    default:
      // guests, evaluations: a name, added or taken back
      subject = <bdi className="[overflow-wrap:anywhere]">{s.name || unknown}</bdi>;
  }
  // A removed row says so in words (the strike-through is not read aloud); inside a line
  // that both adds and removes, an added one does too
  const mark = gone ? t(REMOVAL_WORD[type] || 'history.removal') : mixed && added(r) ? t('history.addition') : null;
  return (
    <li className="text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className={cn('min-w-0', gone && 'text-muted-foreground line-through decoration-muted-foreground/60')}>
          {subject}
        </span>
        {/* At the line's end even when a long name pushes it below: amounts and marks
            stay in one column instead of jumping from end to start row by row */}
        {(change || mark) && (
          <span className={cn('ms-auto inline-flex flex-wrap items-center gap-x-2 gap-y-0.5', gone && 'text-muted-foreground')}>
            {change && <span className={cn(gone && 'line-through decoration-muted-foreground/60')}>{change}</span>}
            {mark && <span className="text-xs text-muted-foreground">{mark}</span>}
          </span>
        )}
      </div>
      {notes.map(([label, value], i) => (
        <p key={i} className="mt-0.5 text-xs text-muted-foreground">
          {label && t('history.noteLabel', { label })}
          {value}
        </p>
      ))}
    </li>
  );
}

function HistoryItem({ item, kind }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const d = atDate(item.at);
  const Icon = TYPE_ICONS[item.type] || IconPencil;
  const rows = item.rows;
  const fold = rows.length > FOLD_AT && !open;
  const shown = fold ? rows.slice(0, FOLDED) : rows;
  const mixed = rows.some(added) && rows.some(removed);
  const count = itemCount(item);
  return (
    <li className="flex gap-3 px-4 py-3 sm:px-5">
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          item.type === 'created' ? 'bg-primary/12 text-primary' : 'bg-secondary text-muted-foreground'
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      {/* A readable measure on wide screens: a value 900px away from its name loses it */}
      <div className="min-w-0 flex-1 sm:max-w-2xl">
        <div className="flex items-baseline gap-2">
          {/* Who: the account, as the admin named it */}
          <p className="min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere]">
            <bdi>{item.actor || t('history.unknown')}</bdi>
          </p>
          <time dateTime={d.toISOString()} className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {fmtClock(d, i18n.language)}
          </time>
        </div>
        <p className="text-sm text-muted-foreground">
          {itemLabel(item, t, kind)}
          {count > 1 && <span className="tabular-nums"> · {count}</span>}
        </p>
        {item.vague && <p className="mt-1 text-xs text-muted-foreground">{t('history.noDetail')}</p>}
        {shown.length > 0 && (
          <ul className="mt-2 space-y-1.5 border-s-2 border-border ps-3">
            {shown.map((r) => (
              <HistoryRow key={r.key} r={r} type={item.type} mixed={mixed} kind={kind} />
            ))}
          </ul>
        )}
        {rows.length > FOLD_AT && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="focus-ring -ms-1 mt-1 inline-flex min-h-11 items-center rounded px-1 text-xs font-medium text-primary hover:underline sm:min-h-9"
          >
            {open ? t('history.showLess') : t('history.showAll', { count: rows.length })}
          </button>
        )}
      </div>
    </li>
  );
}

// ---------- the tab ----------

export default function SessionHistory({ session }) {
  const { t, i18n } = useTranslation();
  const { data, loading, error, reload } = useFetch(`/sessions/${session.id}/history`);

  if (loading && !data)
    return (
      <Card aria-busy="true" className="divide-y divide-border">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3 p-4 sm:px-5">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </Card>
    );
  if (error) return <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />;

  const items = data?.items || [];
  // Its creation is the oldest line; a séance older than the history has none
  const knownCreation = items.some((i) => i.type === 'created');
  if (items.length === 0)
    return (
      <Card>
        <EmptyState icon={<IconClock className="h-6 w-6" />} title={t('history.emptyTitle')}>
          {t('history.emptyHint')}
        </EmptyState>
      </Card>
    );

  const days = [];
  for (const item of items) {
    const key = toISO(atDate(item.at));
    if (days.at(-1)?.key !== key) days.push({ key, label: fmtDay(atDate(item.at), i18n.language, t), items: [] });
    days.at(-1).items.push(item);
  }

  return (
    <Card className="overflow-hidden">
      {days.map((day, i) => (
        <section key={day.key} aria-labelledby={`history-${day.key}`}>
          {/* The card's own edge closes the first one at the top */}
          <div
            className={cn(
              'flex items-center gap-1.5 border-b border-border bg-muted/40 px-4 py-1.5 sm:px-5',
              i > 0 && 'border-t'
            )}
          >
            <IconCalendar aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 id={`history-${day.key}`} className="text-xs font-semibold text-muted-foreground">
              {day.label}
            </h3>
          </div>
          <ol className="divide-y divide-border">
            {day.items.map((item, i) => (
              <HistoryItem key={`${item.at}-${item.type}-${i}`} item={item} kind={session.kind} />
            ))}
          </ol>
        </section>
      ))}
      {!knownCreation && (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">{t('history.beforeTracking')}</p>
      )}
    </Card>
  );
}
