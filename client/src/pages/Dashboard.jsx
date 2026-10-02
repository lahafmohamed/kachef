import { useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFetch } from '../hooks';
import { useAuth } from '../auth';
import { LeaderDuesCard } from '../components/LeaderDues';
import { avatarName, branchName, fmtAmount, fmtDate, fmtPhone, memberName } from '../utils';
import {
  cn,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  PageHeader,
  SkeletonPage,
  Table,
  Td,
  Th,
  IconAlert,
  IconArrow,
  IconCake,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconClipboard,
  IconClock,
  IconCoins,
  IconPhone,
  IconTrendingUp,
  IconUserCheck,
} from '../components/ui';

/* ============================================================
   Helpers
   ============================================================ */

/** A فرقة worth a line on the dashboard: it has عناصر, or it held activities this season. */
const isLive = (b) => (b.member_count ?? 0) > 0 || (b.season?.activities ?? 0) > 0;

/** Whole days from one YYYY-MM-DD to another. */
const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

const sum = (rows, key) => rows.reduce((n, r) => n + (r[key] || 0), 0);

const rateText = (rate) => (rate == null ? '—' : `${rate}%`);

/**
 * Isolates text people typed — names, titles, فرقة names — inside a composed
 * line. An Arabic title in a French line (or a Latin name in an Arabic one)
 * otherwise drags the dates, counts and separators around it into its own
 * direction: «+1» reads «1+», and «فرقة · طليعة» swaps sides.
 */
const bidi = (s) => (s ? `⁨${s}⁩` : s);

// The ar formatter adds bidi marks that reverse segments inside the UI's ltr islands
const clean = (s) => s.replace(/[‎‏؜]/g, '');
const formats = {};
const intl = (locale, opts) =>
  (formats[locale + JSON.stringify(opts)] ??= new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts }));
const noon = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);

/** Date wording for the dashboard, in the active language (Latin digits in both). */
function useFmt() {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  return useMemo(() => {
    const locale = ar ? 'ar-u-nu-latn' : 'fr-FR';
    // «samedi 3 octobre» · «السبت، 3 أكتوبر»
    const day = (iso) => clean(intl(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(noon(iso)));
    return {
      date: (iso) => fmtDate(iso),
      day,
      dayCap: (iso) => {
        const s = day(iso);
        return ar ? s : s.charAt(0).toUpperCase() + s.slice(1);
      },
      short: (iso) => clean(intl(locale, { day: '2-digit', month: '2-digit' }).format(noon(iso))),
      month: (ym) => clean(intl(locale, { month: 'long' }).format(noon(`${ym}-15`))),
      ago: (n) => (n <= 0 ? t('common.today') : n === 1 ? t('dashboard.yesterday') : t('dashboard.daysAgo', { count: n })),
    };
  }, [ar, t]);
}

/**
 * Link that first sets the destination page's remembered preference — the فرقة
 * the الفرق page opens on, the sort of the Members list — so the page lands
 * exactly where the dashboard pointed.
 */
function PrefLink({ pref, onClick, ...props }) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        if (pref) {
          try {
            localStorage.setItem(pref[0], JSON.stringify(pref[1]));
          } catch {
            /* storage blocked — the page simply opens on its default */
          }
        }
        onClick?.(e);
      }}
    />
  );
}

/* ============================================================
   To-do list — derived from the facts the server sends
   ============================================================ */

/**
 * Everything that asks something of the قائد, most pressing first: `now`
 * (overdue or today), `week` (before the next Saturday), `watch`. Each entry
 * either points at one page (`to`) or opens a sub-list (`items`).
 */
function buildTodos(d, t, f, lng) {
  const todos = [];
  const live = d.branches.filter(isLive);
  const bname = (b) => branchName(b, lng);
  const birthdayItem = (b) => ({
    key: `${b.kind || 'member'}-${b.id}`,
    label: memberName(b),
    meta: [
      t('birthday.turning', { age: b.turning }),
      b.kind === 'leader'
        ? t('branch.leaders')
        : bidi(branchName({ name_fr: b.branch_name_fr, name_ar: b.branch_name_ar }, lng)),
    ].join(' · '),
    to: b.kind === 'leader' ? `/leaders/${b.id}` : `/members/${b.id}`,
  });

  const today = d.birthdays.filter((b) => b.when === 'today');
  if (today.length)
    todos.push({
      key: 'birthday-today',
      level: 'now',
      Icon: IconCake,
      title: t('dashboard.todo.birthdayToday'),
      items: today.map(birthdayItem),
    });

  if (d.unmarked.length)
    todos.push({
      key: 'unmarked',
      level: 'now',
      Icon: IconUserCheck,
      title: t('dashboard.todo.unmarked'),
      count: sum(d.unmarked, 'count'),
      items: d.unmarked.map((u) => ({
        key: u.session_id,
        label: u.title,
        meta: t('dashboard.todo.unmarkedMeta', { date: f.date(u.date), count: u.count }),
        // Straight to the rows still to mark
        to: `/sessions/${u.session_id}?status=unmarked`,
      })),
    });

  // Nothing on the plan between today and Saturday: the weekly نشاط has no subject yet
  const planned = live.filter((b) => b.plan);
  const notPlanned = planned.filter((b) => !b.plan.next || b.plan.next.date > d.next_day);
  if (notPlanned.length)
    todos.push({
      key: 'plan',
      level: 'week',
      Icon: IconCalendar,
      title: t('dashboard.todo.notPlanned', { day: f.day(d.next_day) }),
      items: notPlanned.map((b) => ({
        key: b.id,
        label: bname(b),
        meta: b.plan.next
          ? t('dashboard.todo.nextPlanned', { date: f.date(b.plan.next.date) })
          : t('dashboard.todo.planEmpty'),
        to: '/branches',
        pref: ['branches.selected', b.id],
      })),
    });

  const noPrep = planned.filter(
    (b) =>
      b.upcoming_prep &&
      b.plan.next &&
      b.plan.next.date <= d.next_day &&
      !b.plan.next.done &&
      !b.upcoming_prep.some((p) => p.date === b.plan.next.date)
  );
  if (noPrep.length)
    todos.push({
      key: 'prep',
      level: 'week',
      Icon: IconClipboard,
      title: t('dashboard.todo.noPrep'),
      items: noPrep.map((b) => ({
        key: b.id,
        label: b.plan.next.title,
        meta: t('dashboard.todo.noPrepMeta', { branch: bidi(bname(b)), date: f.date(b.plan.next.date) }),
        to: '/prep-cards',
      })),
    });

  const tomorrow = d.birthdays.filter((b) => b.when === 'tomorrow');
  if (tomorrow.length)
    todos.push({
      key: 'birthday-tomorrow',
      level: 'week',
      Icon: IconCake,
      title: t('dashboard.todo.birthdayTomorrow'),
      items: tomorrow.map(birthdayItem),
    });

  if (d.unpaid.length)
    todos.push({
      key: 'unpaid',
      level: 'week',
      Icon: IconCoins,
      title: t('dashboard.todo.unpaid'),
      count: sum(d.unpaid, 'unpaid'),
      items: d.unpaid.map((u) => ({
        key: u.session_id,
        label: u.title,
        meta: t('dashboard.todo.unpaidMeta', { date: f.date(u.date), present: u.present, unpaid: u.unpaid }),
        // Straight to who came without paying
        to: `/sessions/${u.session_id}?status=unpaid`,
      })),
    });

  if (d.followup?.length)
    todos.push({
      key: 'followup',
      level: 'watch',
      Icon: IconAlert,
      title: t('dashboard.todo.followup'),
      count: d.followup.length,
      meta: t('dashboard.todo.followupMeta'),
      followup: d.followup,
    });

  if (d.promotions?.count) {
    const more = d.promotions.count - d.promotions.sample.length;
    todos.push({
      key: 'promotions',
      level: 'watch',
      Icon: IconTrendingUp,
      title: t('dashboard.pendingPromotions'),
      count: d.promotions.count,
      meta: [
        ...d.promotions.sample.map((p) => bidi(memberName(p))),
        more > 0 && t('dashboard.todo.more', { count: more }),
      ]
        .filter(Boolean)
        .join(' · '),
      to: '/promotions',
    });
  }

  // A فرقة with عناصر and no نشاط for two weeks — or none at all this season
  const idle = live.filter(
    (b) =>
      'last_activity' in b &&
      (b.member_count ?? 0) > 0 &&
      (!b.last_activity || daysBetween(b.last_activity.date, d.today) > 14)
  );
  if (idle.length)
    todos.push({
      key: 'idle',
      level: 'watch',
      Icon: IconClock,
      title: t('dashboard.todo.idle'),
      items: idle.map((b) => ({
        key: b.id,
        label: bname(b),
        meta: b.last_activity
          ? t('dashboard.todo.idleSince', { date: f.date(b.last_activity.date) })
          : t('dashboard.todo.idleNever'),
        to: '/branches',
        pref: ['branches.selected', b.id],
      })),
    });

  return todos;
}

// Tint of the icon square: what is overdue reads hot, what can wait reads cool.
// The words carry the meaning; the tint only repeats it.
const LEVEL_TONES = {
  now: 'bg-destructive/12 text-destructive',
  week: 'bg-warning/15 text-warning',
  watch: 'bg-info/12 text-info',
};

/**
 * One to-do. A single destination makes the whole row a link; several make it a
 * disclosure whose sub-list opens under it (the follow-up to-do opens the people).
 */
function TodoRow({ todo }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const single = !todo.followup && todo.items?.length === 1 ? todo.items[0] : null;
  const target = todo.to ? todo : single;
  const meta = single ? [bidi(single.label), single.meta].filter(Boolean).join(' · ') : todo.meta;
  // A sub-list says how many it holds before it is opened
  const count = todo.count ?? (!target && todo.items?.length > 1 ? todo.items.length : null);
  const { Icon } = todo;

  // Rows run edge to edge inside a clipped card: the focus ring is drawn inside them
  const rowCls =
    'focus-ring flex w-full items-start gap-3 px-4 py-2.5 text-start transition-colors hover:bg-accent/50 focus-visible:[outline-offset:-2px]!';
  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', LEVEL_TONES[todo.level])}
      >
        <Icon className="h-[1.1rem] w-[1.1rem]" />
      </span>
      <span className="min-w-0 flex-1 py-px">
        <span className="block font-medium [overflow-wrap:anywhere]">{todo.title}</span>
        {meta && (
          <span className="mt-0.5 block text-sm text-muted-foreground [overflow-wrap:anywhere]">{meta}</span>
        )}
      </span>
      {/* Counts sit in their own column, level with the icon, so a long title
          wraps on its own instead of pushing the number onto a line alone */}
      {count != null && (
        <Badge variant="secondary" className="mt-1.5 shrink-0">
          {count}
        </Badge>
      )}
      {target ? (
        <IconArrow className="mt-2.5 text-muted-foreground rtl:rotate-180" />
      ) : (
        <IconChevronDown
          className={cn(
            'mt-2.5 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
            open && 'rotate-180'
          )}
        />
      )}
    </>
  );

  if (target)
    return (
      <li>
        <PrefLink to={target.to} pref={target.pref} className={rowCls}>
          {body}
        </PrefLink>
      </li>
    );

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className={cn(rowCls, 'cursor-pointer')}
      >
        {body}
      </button>
      <div id={regionId} hidden={!open} className="border-t border-border bg-muted/40">
        {todo.followup ? (
          <div className="px-4 py-1">
            <FollowUpList items={todo.followup} initial={5} />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {todo.items.map((item) => (
              <li key={item.key}>
                <PrefLink
                  to={item.to}
                  pref={item.pref}
                  className="focus-ring flex items-center gap-3 py-2.5 ps-16 pe-4 text-sm transition-colors hover:bg-accent/60 focus-visible:[outline-offset:-2px]!"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium [overflow-wrap:anywhere]">{item.label}</span>
                    {item.meta && <span className="block text-muted-foreground">{item.meta}</span>}
                  </span>
                  <IconArrow className="text-muted-foreground rtl:rotate-180" />
                </PrefLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/* ============================================================
   Follow-up — عناصر absent three activities in a row or more
   ============================================================ */

// First dialable number in a phone field (a field sometimes holds two numbers)
function telOf(raw) {
  const m = String(raw || '').match(/\+?\d[\d\s.-]{6,}\d/);
  return m ? m[0].replace(/[^\d+]/g, '') : null;
}

function FollowUpList({ items, initial = 5 }) {
  const { t, i18n } = useTranslation();
  const f = useFmt();
  const [all, setAll] = useState(false);
  const listId = useId();
  if (!items?.length) return <p className="py-2 text-sm text-muted-foreground">{t('dashboard.followup.none')}</p>;
  const shown = all ? items : items.slice(0, initial);

  return (
    <div>
      <ul id={listId} className="divide-y divide-border">
        {shown.map((m) => {
          const name = memberName(m);
          // The عنصر's own number is offered only when neither parent has one
          const calls = [
            ['father', m.father_phone, 'callFather'],
            ['mother', m.mother_phone, 'callMother'],
            !telOf(m.father_phone) && !telOf(m.mother_phone) && ['self', m.member_phone, 'callSelf'],
          ].filter((c) => c && telOf(c[1]));
          return (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={avatarName(m)} className="h-9 w-9 max-[359px]:hidden" />
              <Link to={`/members/${m.id}`} className="focus-ring min-w-0 flex-1 rounded-md">
                <span className="block font-medium [overflow-wrap:anywhere]">{name}</span>
                <span className="block text-xs text-muted-foreground">
                  {[branchName(m, i18n.language), m.group_name].filter(Boolean).map(bidi).join(' · ')}
                </span>
                <span className="block text-xs text-muted-foreground">
                  <span className="font-medium text-destructive">
                    {t('member.consecutiveAbsences', { count: m.absences })}
                  </span>
                  {' · '}
                  {m.last_present
                    ? t('dashboard.followup.lastPresent', { date: f.date(m.last_present) })
                    : t('dashboard.followup.never')}
                </span>
              </Link>
              {calls.length > 0 && (
                <div className="flex shrink-0 flex-col gap-1.5 min-[400px]:flex-row">
                  {calls.map(([who, phone, key]) => {
                    const label = t(`dashboard.followup.${who}`);
                    return (
                      <a
                        key={who}
                        href={`tel:${telOf(phone)}`}
                        // Starts with the visible word, so voice control can say it
                        aria-label={`${label} — ${t(`dashboard.followup.${key}`, { name })}`}
                        title={fmtPhone(phone)}
                        className="focus-ring inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium shadow-xs transition-colors hover:border-primary/35 hover:bg-accent hover:text-accent-foreground active:scale-[0.96] sm:h-8"
                      >
                        <IconPhone className="h-3.5 w-3.5 max-sm:hidden" />
                        {label}
                      </a>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
        {items.length > initial && (
          <Button
            variant="ghost"
            size="sm"
            className="-ms-3"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll((v) => !v)}
          >
            {all ? t('dashboard.followup.showLess') : t('dashboard.followup.showAll', { count: items.length })}
          </Button>
        )}
        {/* The same عناصر as a filtered list: cut by فرقة, exported as a calling sheet */}
        <Link
          to="/members?follow=1"
          className="focus-ring inline-flex min-h-11 items-center gap-1 rounded text-sm font-medium text-primary hover:underline sm:min-h-0"
        >
          {t('dashboard.followup.openMembers')}
          <IconArrow className="h-3.5 w-3.5 rtl:rotate-180" />
        </Link>
      </div>
    </div>
  );
}

/* ============================================================
   Présence charts
   ============================================================ */

// De-emphasis gray for the earlier bars: the latest day carries the accent.
// 75% keeps the gray above 3:1 against the card in both themes.
const deemph = { '--dash-deemph': 'color-mix(in oklab, var(--muted-foreground) 75%, var(--card))' };

/**
 * Présence per activity day, one column each, the latest emphasised. Each column
 * is focusable (one tab stop, arrow keys move) and names its own value, so the
 * list itself is the table view; hover and focus show the same tooltip.
 */
function TrendChart({ points, height = 176 }) {
  const { t } = useTranslation();
  const f = useFmt();
  const last = points.length - 1;
  const [active, setActive] = useState(last);
  const [shown, setShown] = useState(null);
  const refs = useRef([]);

  if (!points.length)
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('dashboard.trend.empty')}</p>;

  function onKeyDown(e) {
    const rtl = document.documentElement.dir === 'rtl';
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
    let next = null;
    if (step) next = Math.min(last, Math.max(0, active + step));
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  }

  return (
    <div style={deemph}>
      <div className="relative" style={{ height }}>
        {/* Hairline grid at 50 and 100 — the baseline is the list's own bottom border */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {[100, 50].map((v) => (
            <div key={v} className="absolute inset-x-0 border-t border-border" style={{ bottom: `${v}%` }}>
              <span className="absolute -top-2 end-0 bg-card ps-1.5 text-[0.6875rem] leading-4 tabular-nums text-muted-foreground">
                {v}%
              </span>
            </div>
          ))}
        </div>
        <ul
          aria-label={t('dashboard.trend.title')}
          onKeyDown={onKeyDown}
          className="relative flex h-full items-end gap-2 border-b border-border pe-10"
        >
          {points.map((p, i) => {
            const latest = i === last;
            const open = shown === i;
            const edge = i === 0 ? 'start-0' : latest ? 'end-0' : 'left-1/2 -translate-x-1/2';
            return (
              <li
                key={p.date}
                ref={(el) => (refs.current[i] = el)}
                tabIndex={i === active ? 0 : -1}
                aria-label={t('dashboard.trend.bar', {
                  date: f.date(p.date),
                  rate: p.rate,
                  present: p.present,
                  marked: p.marked,
                })}
                onPointerEnter={() => setShown(i)}
                onPointerLeave={() => setShown((s) => (s === i ? null : s))}
                onFocus={() => {
                  setActive(i);
                  setShown(i);
                }}
                onBlur={() => setShown((s) => (s === i ? null : s))}
                className="focus-ring group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-sm"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'w-full max-w-6 rounded-t-[4px] transition-colors duration-150',
                    latest
                      ? 'bg-primary group-hover:bg-primary-hover group-focus-visible:bg-primary-hover'
                      : 'bg-[var(--dash-deemph)] group-hover:bg-muted-foreground group-focus-visible:bg-muted-foreground'
                  )}
                  style={{ height: `${Math.max(p.rate, 1.5)}%` }}
                />
                {latest && !open && (
                  <span
                    aria-hidden="true"
                    className="absolute text-xs font-semibold tabular-nums text-foreground"
                    style={{ bottom: `calc(${p.rate}% + 0.25rem)` }}
                  >
                    {p.rate}%
                  </span>
                )}
                {open && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute z-10 w-max max-w-44 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md',
                      edge
                    )}
                    style={{ bottom: `calc(${p.rate}% + 0.5rem)` }}
                  >
                    <span className="block text-sm font-semibold tabular-nums">{p.rate}%</span>
                    <span className="block text-muted-foreground">{f.dayCap(p.date)}</span>
                    <span className="block text-muted-foreground">
                      {t('dashboard.trend.tip', { present: p.present, marked: p.marked })}
                    </span>
                    {p.sessions > 1 && (
                      <span className="block text-muted-foreground">
                        {t('dashboard.trend.sessions', { count: p.sessions })}
                      </span>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div aria-hidden="true" className="mt-1.5 flex gap-2 pe-10">
        {points.map((p) => (
          <span key={p.date} className="min-w-0 flex-1 truncate text-center text-[0.6875rem] tabular-nums text-muted-foreground">
            {f.short(p.date)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Ratio bar beside a number that already states it — decoration, hidden from AT. */
function Meter({ value, className }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <span aria-hidden="true" className={cn('block h-2 overflow-hidden rounded-full bg-muted', className)}>
      <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Sparkline for a figure: context only, the figure beside it states the value. */
function Spark({ points, className }) {
  if (!points?.length) return null;
  const last = points.length - 1;
  return (
    <span aria-hidden="true" className={cn('flex h-8 items-end gap-0.5', className)} style={deemph}>
      {points.map((p, i) => (
        <span
          key={p.date}
          className={cn('w-1.5 rounded-t-[2px]', i === last ? 'bg-primary' : 'bg-[var(--dash-deemph)]')}
          style={{ height: `${Math.max(p.rate ?? 0, 4)}%` }}
        />
      ))}
    </span>
  );
}

/* ============================================================
   Page parts
   ============================================================ */

function RecentList({ items }) {
  const { t, i18n } = useTranslation();
  const f = useFmt();
  return (
    <ul className="divide-y divide-border">
      {items.map((x) => {
        const where =
          x.kind === 'leaders'
            ? t('session.kindLeaders')
            : x.kind === 'group'
              ? t('session.kindGroup')
              : [
                  x.kind === 'visit' && t('session.kindVisit'),
                  bidi(branchName(x, i18n.language)) + (x.branch_count > 1 ? ` +${x.branch_count - 1}` : ''),
                ]
                  .filter(Boolean)
                  .join(' · ');
        const counted = x.kind === 'activity' || x.kind === 'leaders';
        return (
          <li key={x.id}>
            <Link
              to={`/sessions/${x.id}`}
              className="focus-ring -mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent/50"
            >
              <span className="min-w-40 flex-1">
                <span className="block font-medium [overflow-wrap:anywhere]">{x.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {f.date(x.date)} · {where}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {x.unmarked_count > 0 && (
                  <Badge variant="warning">{t('dashboard.recent.unmarked', { count: x.unmarked_count })}</Badge>
                )}
                <Badge variant="secondary">
                  {counted
                    ? t('dashboard.recent.result', { present: x.present_count, marked: x.present_count + x.absent_count })
                    : `${x.present_count} ${t('session.present')}`}
                </Badge>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Kpi({ label, value, context, spark, to }) {
  const body = (
    <Card interactive={!!to} className="flex h-full flex-col gap-1 p-4 sm:p-5">
      {/* Two lines kept on phones: a label that wraps beside one that doesn't
          would drop its number below its neighbour's */}
      <span className="text-sm text-muted-foreground max-sm:min-h-[2lh]">{label}</span>
      <span className="text-3xl font-bold leading-tight tracking-tight">{value}</span>
      {context && <span className="text-xs text-muted-foreground">{context}</span>}
      {spark?.length > 1 && <Spark points={spark} className="mt-auto h-9 pt-2" />}
    </Card>
  );
  return to ? (
    <Link to={to} className="focus-ring block rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Tableau de bord — organised by figure and by فرقة. The key numbers lead;
 * présence, a فرقة-by-فرقة comparison and the latest activities fill the main
 * column, and what asks for an action rides alone in a side rail. On a phone
 * the rail comes up right under the figures, before the charts: it is the part
 * that asks for something.
 * Each block is only there when the account may open the page it summarises —
 * the server leaves the rest out.
 */
export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const f = useFmt();
  const { user } = useAuth();
  const res = useFetch('/dashboard');
  const d = res.data;
  const todos = useMemo(() => (d ? buildTodos(d, t, f, i18n.language) : []), [d, t, f, i18n.language]);

  if (res.loading) return <SkeletonPage />;
  if (res.error)
    return <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />;

  const lng = i18n.language;
  const live = d.branches.filter(isLive);
  const empty = d.branches.filter((b) => !isLive(b));
  const month = f.month(d.today.slice(0, 7));

  const delta =
    d.month?.rate != null && d.month.prev_rate != null
      ? t('dashboard.vsPrev', {
          delta: `${d.month.rate - d.month.prev_rate >= 0 ? '+' : '−'}${Math.abs(d.month.rate - d.month.prev_rate)}`,
          month: f.month(d.month.prev_month),
        })
      : null;

  const kpis = [
    d.members != null && {
      key: 'members',
      label: t('dashboard.members'),
      value: d.members,
      context: d.leaders != null && t('dashboard.leadersExtra', { count: d.leaders }),
      to: '/members',
    },
    // Early in a month nothing is marked yet: lead with the month just closed
    // instead of a dash over «0 sur 0», and say why
    d.month &&
      (d.month.rate == null && d.month.prev_rate != null
        ? {
            key: 'rate',
            label: t('dashboard.monthRate', { month: f.month(d.month.prev_month) }),
            value: rateText(d.month.prev_rate),
            context: t('dashboard.monthRateNone', { month }),
            spark: d.trend,
          }
        : {
            key: 'rate',
            label: t('dashboard.monthRate', { month }),
            value: rateText(d.month.rate),
            context:
              delta ||
              (d.month.marked
                ? t('dashboard.monthRateContext', { present: d.month.present, marked: d.month.marked })
                : t('dashboard.monthRateNone', { month })),
            spark: d.trend,
          }),
    d.month && {
      key: 'activities',
      label: t('dashboard.monthActivities', { month }),
      value: d.month.activities,
      context: t('dashboard.seasonActivities', { count: d.month.season_activities }),
      to: '/sessions',
    },
    // Money is its own permission: without it the fourth figure is the promotions queue
    d.month?.collected != null
      ? {
          key: 'collected',
          label: t('dashboard.collected', { month }),
          value: fmtAmount(d.month.collected),
          context: t('dashboard.collectedContext'),
        }
      : d.promotions && {
          key: 'promotions',
          label: t('dashboard.pendingPromotions'),
          value: d.promotions.count,
          to: '/promotions',
        },
  ].filter(Boolean);

  const lastCell = (b) =>
    b.last_activity ? (
      <>
        <Link
          to={`/sessions/${b.last_activity.id}`}
          className="focus-ring rounded font-medium tabular-nums hover:text-primary hover:underline"
        >
          {f.date(b.last_activity.date)}
        </Link>
        <span className="block text-xs text-muted-foreground">
          {f.ago(daysBetween(b.last_activity.date, d.today))}
        </span>
      </>
    ) : (
      <span className="text-muted-foreground">{t('dashboard.branches.noActivity')}</span>
    );
  const planCell = (b) =>
    b.plan.due ? (
      <span className="block min-w-16">
        <span className="block text-xs tabular-nums">
          {t('dashboard.branches.planDone', { done: b.plan.due_done, due: b.plan.due })}
        </span>
        <Meter value={(b.plan.due_done / b.plan.due) * 100} className="mt-1 h-1.5" />
      </span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  const followCell = (b) =>
    b.followup_count > 0 ? (
      <Badge variant="destructive">{b.followup_count}</Badge>
    ) : (
      <span className="tabular-nums text-muted-foreground">0</span>
    );
  const hasSessions = !!d.month;
  const hasPlan = live.some((b) => b.plan);
  const hasFollowup = d.followup != null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dashboard.title')}
        description={[t('dashboard.season', { year: d.year }), f.dayCap(d.today)].join(' · ')}
      />

      {/* Le قائد voit tout de suite ce qu'il a payé et ce qu'il doit encore */}
      {user?.leader_id && <LeaderDuesCard endpoint="/me/dues" compact />}

      {kpis.length > 0 && (
        <section aria-label={t('dashboard.figures')} className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {kpis.map(({ key, ...k }) => (
            <Kpi key={key} {...k} />
          ))}
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-3 xl:items-start">
        {/* First in the source so a phone reaches it right after the figures;
            placed in the end column from xl up — any narrower and a third of
            the width leaves its titles breaking mid-word */}
        <aside className="space-y-4 xl:col-start-3 xl:row-start-1">
          <section aria-labelledby="dashboard-todo">
            <Card className="overflow-hidden">
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle id="dashboard-todo">{t('dashboard.todo.title')}</CardTitle>
                {todos.length > 0 && <Badge variant="secondary">{todos.length}</Badge>}
              </CardHeader>
              {todos.length > 0 ? (
                <ul className="divide-y divide-border border-t border-border">
                  {todos.map((todo) => (
                    <TodoRow key={todo.key} todo={todo} />
                  ))}
                </ul>
              ) : (
                <CardContent className="flex items-start gap-2 text-sm">
                  <IconCheck className="mt-0.5 text-success" />
                  <span>{t('dashboard.todo.allClear')}</span>
                </CardContent>
              )}
            </Card>
          </section>
        </aside>

        <div className="space-y-4 xl:col-span-2 xl:col-start-1 xl:row-start-1">
          {hasSessions && (
            <section aria-labelledby="dashboard-trend">
              <Card>
                <CardHeader>
                  <CardTitle id="dashboard-trend">{t('dashboard.trend.title')}</CardTitle>
                  <CardDescription>{t('dashboard.trend.hint')}</CardDescription>
                </CardHeader>
                <CardContent className="pt-3">
                  <TrendChart points={d.trend} />
                </CardContent>
              </Card>
            </section>
          )}

          {live.length > 0 && (
            <section aria-labelledby="dashboard-branches">
              <Card className="@container overflow-hidden">
                <CardHeader>
                  <CardTitle id="dashboard-branches">{t('dashboard.branches.title')}</CardTitle>
                </CardHeader>

                {/* One row per فرقة, columns to compare down — once the card itself
                    is wide enough. Keyed to the card, not the viewport: beside the
                    rail on a laptop it is narrower than the same table on a tablet.
                    Headers may wrap; they, not the figures, set the width. */}
                <Table className="hidden border-t border-border @min-[37rem]:block">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 [&>th]:h-auto [&>th]:py-2.5 [&>th]:leading-4 [&>th]:whitespace-normal">
                      <Th className="ps-5">{t('dashboard.branches.branch')}</Th>
                      <Th className="text-end">{t('dashboard.branches.members')}</Th>
                      {hasSessions && <Th>{t('dashboard.branches.seasonRate')}</Th>}
                      {hasSessions && <Th>{t('dashboard.branches.lastActivity')}</Th>}
                      {hasFollowup && <Th className="text-end">{t('dashboard.branches.followup')}</Th>}
                      {hasPlan && <Th className="pe-5">{t('dashboard.branches.plan')}</Th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {live.map((b) => (
                      <tr key={b.id} className="transition-colors hover:bg-accent/30">
                        <Td className="ps-5">
                          <PrefLink
                            to="/branches"
                            pref={['branches.selected', b.id]}
                            className="focus-ring rounded font-medium hover:text-primary hover:underline"
                          >
                            {branchName(b, lng)}
                          </PrefLink>
                          {/* One line: a wrapped name splits mid-name in a narrow column */}
                          {b.leader_name && (
                            <span
                              className="block max-w-40 truncate text-xs text-muted-foreground"
                              title={b.leader_name}
                            >
                              {b.leader_name}
                            </span>
                          )}
                        </Td>
                        <Td className="text-end tabular-nums">{b.member_count ?? '—'}</Td>
                        {hasSessions && (
                          <Td>
                            <span className="flex items-center gap-3">
                              <span className="w-10 font-medium tabular-nums">{rateText(b.season?.rate)}</span>
                              {/* Dropped first when the card is tight: the rate beside it says it */}
                              <Spark points={b.trend} className="h-6 @max-[44rem]:hidden" />
                            </span>
                          </Td>
                        )}
                        {hasSessions && <Td>{lastCell(b)}</Td>}
                        {hasFollowup && <Td className="text-end">{followCell(b)}</Td>}
                        {hasPlan && <Td className="pe-5">{b.plan ? planCell(b) : '—'}</Td>}
                      </tr>
                    ))}
                  </tbody>
                </Table>

                {/* Narrow card: the same facts, one block per فرقة */}
                <ul className="divide-y divide-border border-t border-border @min-[37rem]:hidden">
                  {live.map((b) => (
                    <li key={b.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <PrefLink
                          to="/branches"
                          pref={['branches.selected', b.id]}
                          className="focus-ring min-w-0 rounded font-semibold hover:text-primary hover:underline"
                        >
                          {branchName(b, lng)}
                        </PrefLink>
                        <Spark points={b.trend} className="h-6" />
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                        <div>
                          <dt className="text-xs text-muted-foreground">{t('dashboard.branches.members')}</dt>
                          <dd className="font-medium tabular-nums">{b.member_count ?? '—'}</dd>
                        </div>
                        {hasSessions && (
                          <div>
                            <dt className="text-xs text-muted-foreground">{t('dashboard.branches.seasonRate')}</dt>
                            <dd className="font-medium tabular-nums">{rateText(b.season?.rate)}</dd>
                          </div>
                        )}
                        {hasSessions && (
                          <div>
                            <dt className="text-xs text-muted-foreground">{t('dashboard.branches.lastActivity')}</dt>
                            <dd>{lastCell(b)}</dd>
                          </div>
                        )}
                        {hasFollowup && (
                          <div>
                            <dt className="text-xs text-muted-foreground">{t('dashboard.branches.followup')}</dt>
                            <dd>{followCell(b)}</dd>
                          </div>
                        )}
                        {b.plan && (
                          <div className="col-span-2">
                            <dt className="text-xs text-muted-foreground">{t('dashboard.branches.plan')}</dt>
                            <dd>{planCell(b)}</dd>
                          </div>
                        )}
                      </dl>
                    </li>
                  ))}
                </ul>

                {empty.length > 0 && (
                  <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
                    {t('dashboard.branches.empty', {
                      names: empty.map((b) => bidi(branchName(b, lng))).join(lng === 'ar' ? '، ' : ', '),
                    })}
                  </p>
                )}
              </Card>
            </section>
          )}

          {/* Context rather than a request, so it follows the figures in the main
              column — the rail keeps only what asks for an action */}
          {d.recent.length > 0 && (
            <section aria-labelledby="dashboard-recent">
              <Card>
                <CardHeader className="flex-row items-baseline justify-between gap-3">
                  <CardTitle id="dashboard-recent">{t('dashboard.recentSessions')}</CardTitle>
                  <Link to="/sessions" className="focus-ring rounded text-sm font-medium text-primary hover:underline">
                    {t('dashboard.seeAll')}
                  </Link>
                </CardHeader>
                <CardContent className="pb-2 sm:pb-3">
                  <RecentList items={d.recent} />
                </CardContent>
              </Card>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
