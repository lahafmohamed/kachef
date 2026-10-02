import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '../utils';
import { IconWhatsApp, cn } from './ui';

/** Présence tone — the same 75 / 50 thresholds in the list and on the profile. */
export const rateTone = (rate) =>
  rate == null ? null : rate >= 75 ? 'success' : rate >= 50 ? 'warning' : 'destructive';

// Spelled out so Tailwind sees every class
const TONE_TEXT = { success: 'text-success', warning: 'text-warning', destructive: 'text-destructive' };

/**
 * dir="ltr" isolates the figure: after Arabic letters, bidi reads the digits as an
 * Arabic number and the «%» drifts to their left («%35»).
 */
export function RateValue({ rate, className }) {
  if (rate == null) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return (
    <span dir="ltr" className={cn('font-semibold tabular-nums', TONE_TEXT[rateTone(rate)], className)}>
      {rate}%
    </span>
  );
}

// Shape carries the status, colour only repeats it: dot = present, ring = absent,
// diamond = excused. Readable in grayscale and by the colour-blind.
const MARK = {
  present: 'rounded-full bg-success',
  absent: 'rounded-full ring-[1.5px] ring-inset ring-destructive/80',
  excused: 'rotate-45 scale-[0.8] rounded-[1px] bg-warning',
};
const MARK_SIZE = { sm: 'h-2 w-2', md: 'h-2.5 w-2.5' };
const STATUS_KEY = { present: 'session.present', absent: 'session.absent', excused: 'session.excused' };

/**
 * The last activities as a row of marks — the columns of the paper register.
 * `recent` comes newest first and is drawn oldest first, so the newest mark sits
 * at the reading end (right in French, left in Arabic) and a run of absences
 * reads as the trailing rings.
 */
export function AttendanceStrip({ recent, size = 'sm', className }) {
  const { t } = useTranslation();
  if (!recent?.length) return null;
  const n = (s) => recent.filter((r) => r.status === s).length;
  const summary = [
    n('present') && t('member.presentN', { count: n('present') }),
    n('absent') && t('member.absentN', { count: n('absent') }),
    n('excused') && t('member.excusedN', { count: n('excused') }),
  ]
    .filter(Boolean)
    .join(t('member.listSep'));
  return (
    <span
      role="img"
      aria-label={t('member.recentAria', { count: recent.length, summary })}
      title={recent.map((r) => `${fmtDate(r.date)} · ${t(STATUS_KEY[r.status])}`).join('\n')}
      className={cn('inline-flex items-center', size === 'md' ? 'gap-1' : 'gap-[3px]', className)}
    >
      {[...recent].reverse().map((r, i) => (
        <span key={i} className={cn('shrink-0', MARK_SIZE[size], MARK[r.status])} />
      ))}
    </span>
  );
}

/** Every number in a phone field — a cell sometimes holds two ("0708904643/0708904644", or glued). */
export function phoneNumbers(value) {
  if (!value) return [];
  return String(value)
    .split(/\s*[/,;]\s*/)
    .flatMap((n) => {
      const digits = n.replace(/[\s.-]/g, '');
      return /^(\d{10}){2,}$/.test(digits) ? digits.match(/\d{10}/g) : [n.trim()];
    })
    .filter(Boolean);
}

export const telHref = (n) => `tel:${String(n).replace(/[^\d+]/g, '')}`;

/**
 * WhatsApp chat link. wa.me wants the full international number: a +/00 prefix is
 * already international, a bare 10-digit number is Ivorian (+225, leading 0 kept).
 */
export function waHref(n) {
  const s = String(n).trim();
  let digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.length === 10) digits = `225${digits}`;
  return `https://wa.me/${digits}`;
}

/** Square companion to a call tile: same height, opens the chat in WhatsApp. */
export function WhatsAppTile({ href, label }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className="focus-ring flex min-h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-[#25D366] shadow-xs transition-colors hover:border-[#25D366]/40 hover:bg-[#25D366]/10"
    >
      <IconWhatsApp className="h-5 w-5" />
    </a>
  );
}

/** Who can be called about this person, in the order a قائد tries them. */
export function contactsOf(m) {
  if (m.kind === 'leader') {
    const numbers = phoneNumbers(m.phone);
    return numbers.length ? [{ who: 'self', numbers }] : [];
  }
  return [
    ['father', m.father_phone],
    ['mother', m.mother_phone],
    ['self', m.member_phone],
  ]
    .map(([who, v]) => ({ who, numbers: phoneNumbers(v) }))
    .filter((c) => c.numbers.length);
}

const CALL_KEY = {
  father: 'dashboard.followup.callFather',
  mother: 'dashboard.followup.callMother',
  self: 'dashboard.followup.callSelf',
};
const WHO_KEY = { father: 'member.fatherShort', mother: 'member.motherShort', self: 'dashboard.followup.self' };
export const callLabel = (t, who, name) => t(CALL_KEY[who], { name });
export const whoLabel = (t, who) => t(WHO_KEY[who]);

/**
 * Underlined tabs with roving focus (arrows follow the reading direction).
 * Scrolls sideways on phones rather than wrapping, and keeps the chosen tab in view.
 */
export function UnderlineTabs({ items, value, onChange, label, idPrefix, panelId, className }) {
  const refs = useRef({});

  // Sideways only: a tab row below the fold must not drag the page down to itself.
  // Re-run when tabs arrive — ones loaded after mount can push the chosen one out.
  useEffect(() => {
    const el = refs.current[value];
    const box = el?.parentElement?.getBoundingClientRect();
    if (box && box.top >= 0 && box.bottom <= window.innerHeight)
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value, items.length]);

  function onKeyDown(e) {
    const rtl = document.documentElement.dir === 'rtl';
    const ids = items.map((x) => x.id);
    const i = ids.indexOf(value);
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
    let next = null;
    if (step) next = ids[(i + step + ids.length) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    if (next == null) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'no-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0',
        className
      )}
    >
      {items.map((x) => {
        const on = x.id === value;
        return (
          <button
            key={x.id}
            ref={(el) => (refs.current[x.id] = el)}
            type="button"
            role="tab"
            id={`${idPrefix}-${x.id}`}
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(x.id)}
            className={cn(
              'focus-ring -mb-px inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-t-lg border-b-2 px-3 text-sm font-medium transition-colors sm:px-4',
              on ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {x.label}
            {x.count != null && (
              <span
                className={cn(
                  'min-w-6 rounded-full px-1.5 py-px text-center text-xs font-medium tabular-nums',
                  on ? 'bg-primary/12 text-primary' : 'bg-secondary text-muted-foreground',
                  !on && x.count === 0 && 'opacity-60'
                )}
              >
                {x.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
