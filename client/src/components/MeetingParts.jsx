import { Fragment } from 'react';
import { fmtDate } from '../utils';
import { MEETING_KIND_BADGE, gendered, isOverdue } from '../lib/meetings';
import { Badge, cn, IconCheck, IconX } from './ui';

/** What kind of meeting, as a tinted badge */
export function MeetingKindBadge({ kind, t, className }) {
  return (
    <Badge variant={MEETING_KIND_BADGE[kind] || 'outline'} className={className}>
      {t(`meeting.kind_${kind}`)}
    </Badge>
  );
}

/**
 * The round tick of a decision: empty while it is to be done, filled once done, crossed
 * once dropped. A button for whoever may write — tapping it ticks the decision off or
 * opens it again — a plain mark for everyone else. 44px of target on phones.
 */
export function DecisionCheck({ status, onToggle, label, busy = false }) {
  const done = status === 'done';
  const dropped = status === 'dropped';
  const mark = (
    <span
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-full border-2 transition-[background-color,border-color,color] duration-150',
        done
          ? 'border-success bg-success text-success-foreground'
          : dropped
            ? 'border-muted-foreground/30 bg-muted text-muted-foreground'
            : 'border-muted-foreground/45 bg-card text-transparent group-hover:border-success group-hover:text-success/60'
      )}
    >
      {dropped ? <IconX className="h-3.5 w-3.5" strokeWidth={3} /> : <IconCheck className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
  if (!onToggle || dropped)
    return (
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center sm:h-9 sm:w-9">
        {mark}
      </span>
    );
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      disabled={busy}
      onClick={onToggle}
      className="focus-ring group flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-[scale] duration-150 active:scale-[0.92] disabled:cursor-wait sm:h-9 sm:w-9"
    >
      {mark}
    </button>
  );
}

/**
 * Who carries a decision out and by when — the deadline in red once passed while it is
 * still to do — or the day it was done or dropped. `extra`: more facts after those (the
 * meeting it came from, on the follow-up list). Each fact stays whole when the line wraps.
 */
export function DecisionMeta({ d, t, today, extra = [] }) {
  const late = isOverdue(d, today);
  const facts = [
    d.owner && <span key="owner">{d.owner}</span>,
    d.status === 'open' && d.due_date && (
      <span key="due" className={cn('tabular-nums', late && 'font-medium text-destructive')}>
        {late ? t('meeting.overdueSince', { date: fmtDate(d.due_date) }) : t('meeting.dueBy', { date: fmtDate(d.due_date) })}
      </span>
    ),
    d.status === 'done' && d.status_at && (
      <span key="done" className="tabular-nums text-success">
        {t('meeting.doneOn', { date: fmtDate(d.status_at) })}
      </span>
    ),
    d.status === 'dropped' && (
      <span key="dropped">{d.status_at ? t('meeting.droppedOn', { date: fmtDate(d.status_at) }) : t('meeting.status_dropped')}</span>
    ),
    ...extra,
  ].filter(Boolean);
  if (!facts.length) return null;
  return (
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
      {facts.map((f, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          <bdi className="whitespace-nowrap max-sm:whitespace-normal">{f}</bdi>
        </Fragment>
      ))}
    </p>
  );
}

/**
 * «6 présents · 1 absent · 2 excusés · 1 invité» — counts that are 0 stay out, but the
 * présents. In the feminine for قسم الفتيات.
 */
export function attendanceLine(c, t, section) {
  return [
    gendered(t, 'meeting.presentCount', section, { count: c.present }),
    c.absent > 0 && gendered(t, 'meeting.absentCount', section, { count: c.absent }),
    c.excused > 0 && gendered(t, 'meeting.excusedCount', section, { count: c.excused }),
    c.guests > 0 && t('meeting.guestCount', { count: c.guests }),
  ].filter(Boolean);
}
