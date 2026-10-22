import { Fragment, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ReadinessBadge, readinessFacts } from '../components/CampSafety';
import { DecisionCheck, DecisionMeta } from '../components/MeetingParts';
import { userText } from '../lib/meetings';
import { useFetch } from '../hooks';
import { api } from '../api';
import { useAuth, usePerms } from '../auth';
import { LeaderDuesCard } from '../components/LeaderDues';
import PeriodReportButton from '../components/PeriodReport';
import { branchName, fmtAmount, fmtDate, memberName } from '../utils';
import {
  cn,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  IconAlert,
  IconArrow,
  IconAward,
  IconCake,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconClipboard,
  IconClock,
  IconCoins,
  IconListChecks,
  IconMessages,
  IconStar,
  IconShield,
  IconTent,
  IconTrendingUp,
  IconUserCheck,
  IconUsers,
  IconX,
  IconSettings,
  Dialog,
  useToast,
} from '../components/ui';
import { staffingLines } from '../components/GroupResponsibilities';
import { FollowupList } from '../components/Followup';

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

/** «samedi 17 octobre» stays on one line: split, it reads as two facts. */
const unbroken = (s) => s.replace(/ /g, '\u00a0');

/**
 * A composed line («date · présents : 12 · sans paiement : 4») that breaks
 * between its facts, never inside a short one: «sans / paiement : 4», or a name
 * split over two lines, reads as two facts. The no-break space before each «·»
 * keeps a separator from starting a line.
 */
function Facts({ text }) {
  if (typeof text !== 'string') return text;
  return text.split(' · ').map((part, i) => (
    <Fragment key={i}>
      {i > 0 && '\u00a0· '}
      {part.replace(/[\u2066-\u2069]/g, '').length <= 24 ? <span className="whitespace-nowrap">{part}</span> : part}
    </Fragment>
  ));
}

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
    // ar-LB: the Levantine month names (تشرين الأول…) the فوج uses everywhere else
    const locale = ar ? 'ar-LB-u-nu-latn' : 'fr-FR';
    // «samedi 3 octobre» · «السبت، 3 تشرين الأول»
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
            // One [key, value] pair, or several: the فرقة and the tab it opens on
            for (const [k, v] of Array.isArray(pref[0]) ? pref : [pref]) localStorage.setItem(k, JSON.stringify(v));
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
 * either points at one page (`to`) or opens a sub-list (`items`). `decided`: the
 * تكاليف ticked off (or opened again) on this visit, id → status.
 */
function buildTodos(d, t, f, lng, decided = {}) {
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
      // Séances, not عناصر — and every one of them, not just the ten listed (bug 10)
      count: d.unmarked_total ?? d.unmarked.length,
      items: [
        ...d.unmarked.map((u) => ({
          key: u.session_id,
          label: u.title,
          meta: t('dashboard.todo.unmarkedMeta', { date: f.date(u.date), count: u.count }),
          to: `/sessions/${u.session_id}`,
        })),
        // More than the ten shown: the journal's «À régulariser» lists them all
        ...((d.unmarked_total ?? 0) > d.unmarked.length
          ? [
              {
                key: 'more',
                label: t('dashboard.todo.unmarkedAll', { count: d.unmarked_total }),
                to: '/sessions?todo=attendance',
              },
            ]
          : []),
      ],
    });

  // H1 : ce que les réunions ont confié au قائد du compte, coché d'ici même. Ce qui est
  // coché pendant la visite reste dans la liste, coché, jusqu'au prochain chargement ;
  // le plus pressé de ce qui reste fixe le niveau
  if (d.my_decisions?.length) {
    const status = (x) => decided[x.id] ?? x.status;
    const open = d.my_decisions.filter((x) => status(x) === 'open');
    const late = open.filter((x) => x.due_date && x.due_date < d.today);
    const next = open.find((x) => x.due_date && x.due_date >= d.today);
    todos.push({
      key: 'my-decisions',
      level: late.length ? 'now' : next && daysBetween(d.today, next.due_date) <= 7 ? 'week' : 'watch',
      Icon: IconListChecks,
      title: t('dashboard.todo.myDecisions'),
      count: open.length || null,
      meta: open.length
        ? [
            late.length > 0 && t('meeting.overdueCount', { count: late.length }),
            next && t('dashboard.todo.nextDue', { date: f.date(next.due_date) }),
            !late.length && !next && t('dashboard.todo.noDue'),
          ]
            .filter(Boolean)
            .join(' · ')
        : t('dashboard.todo.myDecisionsDone'),
      // Ticked here: done today, as the server records it
      decisions: d.my_decisions.map((x) =>
        status(x) === x.status ? x : { ...x, status: status(x), status_at: status(x) === 'done' ? d.today : null }
      ),
    });
  }

  // Nothing on the plan between today and the فرقة's next نشاط day — the weekday it
  // usually meets on, Saturday by default (bug 12): that نشاط has no subject yet
  const planned = live.filter((b) => b.plan);
  const dayOf = (b) => b.next_day || d.next_day;
  const notPlanned = planned.filter((b) => !b.plan.next || b.plan.next.date > dayOf(b));
  const oneDay = new Set(notPlanned.map(dayOf)).size === 1;
  if (notPlanned.length)
    todos.push({
      key: 'plan',
      level: 'week',
      Icon: IconCalendar,
      title: oneDay
        ? t('dashboard.todo.notPlanned', { day: unbroken(f.day(dayOf(notPlanned[0]))) })
        : t('dashboard.todo.notPlannedNext'),
      items: notPlanned.map((b) => ({
        key: b.id,
        label: oneDay ? bname(b) : `${bidi(bname(b))} · ${f.day(dayOf(b))}`,
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
      b.plan.next.date <= dayOf(b) &&
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

  // G1 : cotisations en retard, par فرقة — straight to the فرقة's late list
  if (d.dues_arrears?.members)
    todos.push({
      key: 'dues-arrears',
      level: 'watch',
      Icon: IconCoins,
      title: t('dashboard.todo.duesArrears'),
      count: d.dues_arrears.members,
      items: d.dues_arrears.branches.map((b) => ({
        key: b.id,
        label: bname(b),
        meta: t('arrears.groupLine', { count: b.members, amount: fmtAmount(b.amount) }),
        to: `/members?branch=${b.id}&dues=late`,
      })),
    });

  // أنشطة قادها صاحب الحساب في الأسبوعين الأخيرين و لم يقيّمها بعد
  if (d.to_evaluate?.length)
    todos.push({
      key: 'evaluate',
      level: 'week',
      Icon: IconStar,
      title: t('dashboard.todo.evaluate'),
      count: d.to_evaluate.length,
      items: d.to_evaluate.map((s) => ({
        key: s.session_id,
        label: s.title,
        meta: f.date(s.date),
        // Straight to the form
        to: `/sessions/${s.session_id}?tab=eval`,
      })),
    });

  // E1 : les camps des trois semaines à venir pas encore prêts à partir
  if (d.events_to_prepare?.length)
    todos.push({
      key: 'prepare-events',
      level: 'week',
      Icon: IconShield,
      title: t('dashboard.todo.prepareEvents'),
      count: d.events_to_prepare.length,
      items: d.events_to_prepare.map((e) => ({
        key: e.event_id,
        label: e.title,
        meta: [f.date(e.start_date), ...(readinessFacts(t, e)?.parts || [])].join(' · '),
        to: `/events/${e.event_id}?tab=safety`,
      })),
    });

  // و المخيمات و الدورات التي أخذ فيها دورًا، انتهت في الأسبوعين الأخيرين
  if (d.events_to_evaluate?.length)
    todos.push({
      key: 'evaluate-events',
      level: 'week',
      Icon: IconStar,
      title: t('dashboard.todo.evaluateEvents'),
      count: d.events_to_evaluate.length,
      items: d.events_to_evaluate.map((e) => ({
        key: e.event_id,
        label: e.title,
        meta: `${t(`event.kind_${e.kind}`)} · ${f.date(e.end_date)}`,
        to: `/events/${e.event_id}?tab=eval`,
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

  // H1 : les تكاليف des autres dont l'échéance est passée, pour qui suit les décisions —
  // les dix plus anciennes, chacune vers sa réunion, et le vrai total
  if (d.late_decisions?.length)
    todos.push({
      key: 'late-decisions',
      level: 'watch',
      Icon: IconMessages,
      title: t('dashboard.todo.lateDecisions'),
      count: d.late_decisions_total ?? d.late_decisions.length,
      items: [
        ...d.late_decisions.map((x) => ({
          key: x.id,
          label: userText(x.text),
          meta: [
            x.owner && bidi(x.owner),
            t('meeting.overdueSince', { date: f.date(x.due_date) }),
            bidi(userText(x.meeting_title)),
          ]
            .filter(Boolean)
            .join(' · '),
          to: `/meetings/${x.meeting_id}`,
        })),
        ...((d.late_decisions_total ?? 0) > d.late_decisions.length
          ? [{ key: 'more', label: t('dashboard.todo.lateDecisionsAll'), to: '/meetings' }]
          : []),
      ],
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
        more > 0 && bidi(t('dashboard.todo.more', { count: more })),
      ]
        .filter(Boolean)
        .join(' · '),
      to: '/promotions',
    });
  }

  // B1 : prêts pour le تكريس (durée et مطالب القبول complètes), sinon combien sont en essai
  if (d.admissions?.ready?.length)
    todos.push({
      key: 'admission-ready',
      level: 'week',
      Icon: IconAward,
      title: t('admission.todoReady'),
      count: d.admissions.ready.length,
      items: d.admissions.ready.map((a) => ({
        key: a.id,
        label: memberName(a),
        meta: [
          bidi(branchName({ name_fr: a.branch_name_fr, name_ar: a.branch_name_ar }, lng)),
          a.trial_days != null && t('admission.trialDay', { count: a.trial_days }),
        ]
          .filter(Boolean)
          .join(' · '),
        to: `/members/${a.id}?tab=admission`,
      })),
    });
  else if (d.admissions?.trial_count)
    todos.push({
      key: 'admission-trial',
      level: 'watch',
      Icon: IconAward,
      title: t('admission.todoTrial'),
      count: d.admissions.trial_count,
      meta: t('admission.todoTrialMeta'),
      to: '/promotions#admissions',
    });

  // Bug 8 : sans date de naissance, le ترفيع ne les voit jamais
  if (d.promotions?.missing_birth_date)
    todos.push({
      key: 'missing-birth-date',
      level: 'watch',
      Icon: IconAlert,
      title: t('admission.todoMissingBirth'),
      count: d.promotions.missing_birth_date,
      meta: t('admission.todoMissingBirthMeta'),
      to: '/promotions#missing-birth-date',
    });

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

  // طليعة بلا عريف، عدد خارج الحدّين، فرقة تحتاج قسمة، نشطون بلا طليعة (C1)
  if (d.staffing?.length)
    todos.push({
      key: 'staffing',
      level: 'watch',
      Icon: IconUsers,
      title: t('dashboard.todo.staffing'),
      items: d.staffing.map((b) => ({
        key: b.id,
        label: bname(b),
        meta: staffingLines(t, b).join(' · '),
        to: '/branches',
        pref: [
          ['branches.selected', b.id],
          ['branches.tab', 'groups'],
        ],
      })),
    });

  return todos;
}

/** Every kind of to-do, in list order, for the «Personnaliser» panel. */
const TODO_TYPES = [
  ['birthday-today', 'dashboard.todo.birthdayToday'],
  ['unmarked', 'dashboard.todo.unmarked'],
  ['my-decisions', 'dashboard.todo.myDecisions'],
  ['plan', 'dashboard.todo.notPlannedNext'],
  ['prep', 'dashboard.todo.noPrep'],
  ['birthday-tomorrow', 'dashboard.todo.birthdayTomorrow'],
  ['unpaid', 'dashboard.todo.unpaid'],
  ['dues-arrears', 'dashboard.todo.duesArrears'],
  ['evaluate', 'dashboard.todo.evaluate'],
  ['prepare-events', 'dashboard.todo.prepareEvents'],
  ['evaluate-events', 'dashboard.todo.evaluateEvents'],
  ['followup', 'dashboard.todo.followup'],
  ['late-decisions', 'dashboard.todo.lateDecisions'],
  ['promotions', 'dashboard.pendingPromotions'],
  ['admission-ready', 'admission.todoReady'],
  ['admission-trial', 'admission.todoTrial'],
  ['missing-birth-date', 'admission.todoMissingBirth'],
  ['idle', 'dashboard.todo.idle'],
  ['staffing', 'dashboard.todo.staffing'],
];

/**
 * What a to-do holds right now. A masked to-do stays masked while this holds,
 * and comes back on its own once something new joins it (another séance, a
 * new name): masking says «seen», not «never again».
 */
const todoSig = (todo) => {
  const list = todo.items || todo.followup || todo.decisions;
  return [todo.count ?? '', ...(list ? list.map((i) => i.key ?? i.id) : [todo.meta ?? ''])].join('|');
};

// Tint of the icon square: what is overdue reads hot, what can wait reads cool.
// The words carry the meaning; the tint only repeats it.
const LEVEL_TONES = {
  now: 'bg-destructive/12 text-destructive',
  week: 'bg-warning/15 text-warning',
  watch: 'bg-info/12 text-info',
};

/**
 * «Mes تكاليف» opened: each one with its tick — a button for who follows decisions up
 * (meetings.followup), a plain mark otherwise — and the text, which opens its meeting.
 * Tick and text line up with the to-do's icon and title above: the tick's circle sits
 * on the icon's centre line, the text where the title starts.
 */
function DecisionList({ decisions, today, canFollow, busy, onToggle }) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y divide-border">
      {decisions.map((x) => (
        <li key={x.id} className="flex items-start gap-2 ps-3 pe-4 sm:gap-3 sm:ps-5 sm:pe-5">
          <DecisionCheck
            status={x.status}
            busy={busy === x.id}
            onToggle={canFollow ? () => onToggle(x) : null}
            label={t(x.status === 'done' ? 'meeting.markOpen' : 'meeting.markDone', { text: x.text })}
          />
          <Link
            to={`/meetings/${x.meeting_id}`}
            className="focus-ring group/decision flex min-w-0 flex-1 items-start gap-3 rounded-md py-3 text-sm sm:py-2"
          >
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block font-medium [overflow-wrap:anywhere] group-hover/decision:text-primary',
                  x.status !== 'open' && 'text-muted-foreground'
                )}
              >
                <bdi>{userText(x.text)}</bdi>
              </span>
              {/* Mine, so no owner: the deadline, then the meeting it came from */}
              <DecisionMeta
                d={{ ...x, owner: null }}
                t={t}
                today={today}
                extra={[<span key="meeting">{userText(x.meeting_title)}</span>]}
              />
            </span>
            <IconArrow className="mt-0.5 shrink-0 text-muted-foreground rtl:rotate-180" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * One to-do. A single destination makes the whole row a link; several make it a
 * disclosure whose sub-list opens under it (the follow-up to-do opens the people,
 * «Mes تكاليف» its decisions, each with its tick).
 */
function TodoRow({ todo, onDismiss, decisionProps }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const single = !todo.followup && !todo.decisions && todo.items?.length === 1 ? todo.items[0] : null;
  const target = todo.to ? todo : single;
  const meta = single ? [bidi(single.label), single.meta].filter(Boolean).join(' · ') : todo.meta;
  // A sub-list says how many it holds before it is opened
  const count = todo.count ?? (!target && todo.items?.length > 1 ? todo.items.length : null);
  const { Icon } = todo;

  // Rows run edge to edge inside a clipped card: the focus ring is drawn inside them.
  // Their inset follows the card header's (p-4, sm:p-5) so icon and title line up.
  // The end inset leaves room for the «Masquer» button laid over the row.
  const rowCls =
    'focus-ring flex w-full items-start gap-3 ps-4 pe-12 py-2.5 text-start transition-colors hover:bg-accent/50 focus-visible:[outline-offset:-2px]! sm:ps-5 sm:pe-13';
  // Outside the link or disclosure (a button can't sit inside either). Shown on
  // hover or focus where there is a mouse; always there on touch screens.
  const dismiss = (
    <button
      type="button"
      onClick={() => onDismiss(todo)}
      aria-label={t('dashboard.todo.dismissOne', { title: todo.title })}
      title={t('dashboard.todo.dismiss')}
      className={cn(
        'focus-ring absolute end-2 top-3 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground sm:end-3',
        'opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/todo:opacity-100 pointer-coarse:opacity-100',
        'before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""]'
      )}
    >
      <IconX className="h-4 w-4" />
    </button>
  );
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
          <span className="mt-0.5 block text-sm text-muted-foreground [overflow-wrap:anywhere]">
            <Facts text={meta} />
          </span>
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
      <li className="group/todo relative">
        <PrefLink to={target.to} pref={target.pref} className={rowCls}>
          {body}
        </PrefLink>
        {dismiss}
      </li>
    );

  return (
    <li className="group/todo relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className={cn(rowCls, 'cursor-pointer')}
      >
        {body}
      </button>
      {dismiss}
      <div id={regionId} hidden={!open} className="border-t border-border bg-muted/40">
        {todo.followup ? (
          <div className="px-4 py-1 sm:px-5">
            <FollowupList items={todo.followup} initial={5} />
          </div>
        ) : todo.decisions ? (
          <DecisionList decisions={todo.decisions} {...decisionProps} />
        ) : (
          <ul className="divide-y divide-border">
            {todo.items.map((item) => (
              <li key={item.key}>
                <PrefLink
                  to={item.to}
                  pref={item.pref}
                  // Indented to the title above: row inset + icon (2.25rem) + gap (0.75rem)
                  className="focus-ring flex items-center gap-3 py-2.5 ps-16 pe-4 text-sm transition-colors hover:bg-accent/60 focus-visible:[outline-offset:-2px]! sm:ps-[4.25rem] sm:pe-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium [overflow-wrap:anywhere]">{item.label}</span>
                    {item.meta && (
                      <span className="block text-muted-foreground">
                        <Facts text={item.meta} />
                      </span>
                    )}
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


/* ============================================================
   À venir — the month ahead, day by day
   ============================================================ */

// Within one day: camps and دورات first, then the أنشطة, then meetings
const AGENDA_ORDER = { event: 0, plan: 1, meeting: 2 };
// Rows shown before «Afficher tout»: the next week or so, on most months
const AGENDA_ROWS = 6;

/**
 * What the coming month holds, one group per day: camps, دورات and sorties (starting, or
 * already under way — those open the list, under «En cours»), meetings opened ahead or
 * announced by the last one, and each فرقة's next نشاط on the plan with the state of its
 * بطاقة التحضير. A day's several أنشطة fold into one row that opens on them.
 */
function buildAgenda(d, lng) {
  const horizon = d.agenda?.days ?? 30;
  const rows = [];
  const plans = new Map();
  for (const b of d.branches.filter(isLive)) {
    const n = b.plan?.next;
    if (!n || daysBetween(d.today, n.date) > horizon) continue;
    // The بطاقة's state only for who reads them (upcoming_prep is null otherwise)
    const prep = b.upcoming_prep?.find((p) => p.date === n.date) ?? null;
    const state = n.done ? 'done' : !b.upcoming_prep ? null : prep ? 'prep' : 'noPrep';
    if (!plans.has(n.date)) plans.set(n.date, []);
    plans.get(n.date).push({
      key: b.id,
      branch: branchName(b, lng),
      title: n.title,
      state,
      // The séance once there is one, else its بطاقة, else the فرقة's plan
      to: n.session_id ? `/sessions/${n.session_id}` : prep ? `/prep-cards/${prep.id}` : '/branches',
      pref:
        n.session_id || prep
          ? null
          : [
              ['branches.selected', b.id],
              ['branches.tab', 'plan'],
            ],
    });
  }
  for (const [date, items] of plans) rows.push({ key: `plan-${date}`, type: 'plan', date, items });
  for (const e of d.agenda?.events || [])
    rows.push({ key: `event-${e.event_id}`, type: 'event', date: e.start_date, ongoing: e.start_date < d.today, e });
  for (const m of d.agenda?.meetings || [])
    rows.push({ key: `meeting-${m.meeting_id}${m.announced ? '-next' : ''}`, type: 'meeting', date: m.date, m });
  rows.sort(
    (x, y) => !!y.ongoing - !!x.ongoing || x.date.localeCompare(y.date) || AGENDA_ORDER[x.type] - AGENDA_ORDER[y.type]
  );
  const days = [];
  for (const r of rows) {
    const day = r.ongoing ? 'ongoing' : r.date;
    if (days.at(-1)?.day !== day) days.push({ day, rows: [] });
    days.at(-1).rows.push(r);
  }
  return days;
}

/** The state of a planned نشاط: its séance exists, its بطاقة is written, or not yet. */
function PlanState({ state }) {
  const { t } = useTranslation();
  if (state === 'done') return <Badge variant="secondary">{t('dashboard.agenda.sessionCreated')}</Badge>;
  if (state === 'prep') return <Badge variant="success">{t('dashboard.agenda.prepReady')}</Badge>;
  if (state === 'noPrep') return <Badge variant="warning">{t('dashboard.agenda.noPrep')}</Badge>;
  return null;
}

// Same frame as a to-do row, so both lists read alike: icon column, title, a meta line
// that may carry a badge, the arrow or chevron at the end
const agendaRowCls =
  'focus-ring flex w-full items-start gap-3 px-4 py-2.5 text-start transition-colors hover:bg-accent/50 focus-visible:[outline-offset:-2px]! sm:px-5';

function AgendaLine({ Icon, title, meta, badge, end }) {
  return (
    <>
      <Icon aria-hidden="true" className="mt-0.5 h-[1.1rem] w-[1.1rem] shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium [overflow-wrap:anywhere]">{title}</span>
        {(meta || badge) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {meta && (
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <Facts text={meta} />
              </span>
            )}
            {badge}
          </span>
        )}
      </span>
      {end}
    </>
  );
}

const arrowEnd = <IconArrow className="mt-0.5 shrink-0 text-muted-foreground rtl:rotate-180" />;

function AgendaRow({ r }) {
  const { t } = useTranslation();
  const f = useFmt();
  const [open, setOpen] = useState(false);
  const regionId = useId();

  if (r.type === 'event') {
    const { e } = r;
    const ready = readinessFacts(t, e);
    const meta = [
      t(`event.kind_${e.kind}`),
      // Weeks away at most: day and month say it, the year is noise
      (r.ongoing || e.end_date !== e.start_date) && t('dashboard.agenda.until', { date: f.short(e.end_date) }),
      e.place && bidi(userText(e.place)),
      e.participants > 0 && t('event.participantCount', { count: e.participants }),
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <li>
        {/* A camp not ready to leave opens on its safety tab, as in «À traiter» */}
        <Link to={`/events/${e.event_id}${ready && !ready.ready ? '?tab=safety' : ''}`} className={agendaRowCls}>
          <AgendaLine
            Icon={IconTent}
            title={<bdi>{userText(e.title)}</bdi>}
            meta={meta}
            badge={<ReadinessBadge r={e} />}
            end={arrowEnd}
          />
        </Link>
      </li>
    );
  }

  if (r.type === 'meeting') {
    const { m } = r;
    // Announced only: its kind names it, and the meeting that set the date opens it
    const meta = m.announced
      ? t('dashboard.agenda.announced', { date: f.short(m.from_date) })
      : [t(`meeting.kind_${m.kind}`), m.start_time, m.place && bidi(userText(m.place))].filter(Boolean).join(' · ');
    return (
      <li>
        <Link to={`/meetings/${m.meeting_id}`} className={agendaRowCls}>
          <AgendaLine
            Icon={IconMessages}
            title={m.announced ? t(`meeting.kind_${m.kind}`) : <bdi>{userText(m.title)}</bdi>}
            meta={meta}
            end={arrowEnd}
          />
        </Link>
      </li>
    );
  }

  // أنشطة on the plan: one فرقة is a row of its own, several fold into one
  const { items } = r;
  if (items.length === 1) {
    const [x] = items;
    return (
      <li>
        <PrefLink to={x.to} pref={x.pref} className={agendaRowCls}>
          <AgendaLine
            Icon={IconCalendar}
            title={<bdi>{userText(x.title)}</bdi>}
            meta={bidi(x.branch)}
            badge={<PlanState state={x.state} />}
            end={arrowEnd}
          />
        </PrefLink>
      </li>
    );
  }
  const noPrep = items.filter((x) => x.state === 'noPrep').length;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className={cn(agendaRowCls, 'cursor-pointer')}
      >
        <AgendaLine
          Icon={IconCalendar}
          title={t('dashboard.agenda.activities', { count: items.length })}
          meta={items.map((x) => bidi(x.branch)).join(' · ')}
          badge={noPrep > 0 && <Badge variant="warning">{t('dashboard.agenda.noPrepCount', { count: noPrep })}</Badge>}
          end={
            <IconChevronDown
              className={cn(
                'mt-0.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
                open && 'rotate-180'
              )}
            />
          }
        />
      </button>
      <ul id={regionId} hidden={!open} className="divide-y divide-border border-y border-border bg-muted/40">
        {items.map((x) => (
          <li key={x.key}>
            <PrefLink
              to={x.to}
              pref={x.pref}
              // Indented to the title above: row inset + icon (1.1rem) + gap (0.75rem)
              className="focus-ring flex items-start gap-3 py-2.5 ps-[2.85rem] pe-4 text-sm transition-colors hover:bg-accent/60 focus-visible:[outline-offset:-2px]! sm:ps-[3.1rem] sm:pe-5"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium [overflow-wrap:anywhere]">
                  <bdi>{userText(x.title)}</bdi>
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                  <span>{x.branch}</span>
                  <PlanState state={x.state} />
                </span>
              </span>
              {arrowEnd}
            </PrefLink>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * The «À venir» card. Each day says when it is from today («Demain», «Dans 3 jours»):
 * the date alone makes the reader count. The first days show, the rest on demand.
 */
function AgendaCard({ days, today }) {
  const { t } = useTranslation();
  const f = useFmt();
  const [all, setAll] = useState(false);
  const total = days.reduce((n, day) => n + day.rows.length, 0);
  // Whole days only: a day cut in half would read as all it holds
  let shown = days;
  if (!all && total > AGENDA_ROWS) {
    shown = [];
    let n = 0;
    for (const day of days) {
      if (n > 0 && n + day.rows.length > AGENDA_ROWS) break;
      shown.push(day);
      n += day.rows.length;
    }
  }
  const hidden = total - shown.reduce((n, day) => n + day.rows.length, 0);

  const dayLabel = (day) => {
    if (day === 'ongoing') return t('event.phase_ongoing');
    const n = daysBetween(today, day);
    if (n === 0) return `${t('common.today')} · ${f.day(day)}`;
    if (n === 1) return `${t('dashboard.agenda.tomorrow')} · ${f.day(day)}`;
    return `${f.dayCap(day)} · ${t('dashboard.agenda.inDays', { count: n })}`;
  };

  return (
    <section aria-labelledby="dashboard-agenda">
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle id="dashboard-agenda">{t('dashboard.agenda.title')}</CardTitle>
          <CardDescription>{t('dashboard.agenda.hint')}</CardDescription>
        </CardHeader>
        {days.length ? (
          <ol className="divide-y divide-border border-t border-border">
            {shown.map((day) => (
              <li key={day.day}>
                <h3 className="px-4 pt-3 pb-0.5 text-xs font-medium text-muted-foreground sm:px-5">
                  <Facts text={dayLabel(day.day)} />
                </h3>
                <ul>
                  {day.rows.map((r) => (
                    <AgendaRow key={r.key} r={r} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : (
          <CardContent className="text-sm text-muted-foreground">{t('dashboard.agenda.empty')}</CardContent>
        )}
        {(hidden > 0 || all) && (
          <div className="border-t border-border px-4 py-2.5 sm:px-5">
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className='focus-ring relative rounded text-sm font-medium text-primary before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[""] hover:underline'
            >
              {all ? t('dashboard.followup.showLess') : t('dashboard.agenda.showMore', { count: hidden })}
            </button>
          </div>
        )}
      </Card>
    </section>
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

  // A «05/10» needs ~37px a column; seven or more days on a phone leave ~28px,
  // so a narrow chart labels every other day, counting back from the latest
  const thin = points.length > 6;

  return (
    <div className="@container" style={deemph}>
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
                  // Short lines that never wrap: at 1× zoom, max-content rounding
                  // used to drop the «10» of «الحضور: 9 من 10» onto a line alone
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute z-10 w-max rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-md',
                      edge
                    )}
                    style={{ bottom: `calc(${p.rate}% + 0.5rem)` }}
                  >
                    <span className="block text-sm font-semibold tabular-nums">{p.rate}%</span>
                    <span className="block text-muted-foreground">
                      {p.week ? t('dashboard.trend.week', { date: f.date(p.week) }) : f.dayCap(p.date)}
                    </span>
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
        {/* Centred and never cut: a label a hair wider than its bar spills
            evenly into the gaps either side instead of ending in «05/…» */}
        {points.map((p, i) => (
          <span
            key={p.date}
            className={cn(
              'flex min-w-0 flex-1 justify-center whitespace-nowrap text-[0.6875rem] tabular-nums text-muted-foreground',
              thin && (last - i) % 2 === 1 && '@max-[20.5rem]:invisible'
            )}
          >
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

/**
 * Sparkline for a figure: context only, the figure beside it states the value. One or
 * two bars draw no trend and read as a rendering glitch, so it waits for a third.
 */
function Spark({ points, className }) {
  if (!points || points.length < 3) return null;
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
                  bidi(branchName(x, i18n.language)) + (x.branch_count > 1 ? ` ${bidi(`+${x.branch_count - 1}`)}` : ''),
                ]
                  .filter(Boolean)
                  .join(' · ');
        const counted = x.kind === 'activity' || x.kind === 'leaders';
        return (
          <li key={x.id}>
            <Link
              to={`/sessions/${x.id}`}
              className="focus-ring -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent/50"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium [overflow-wrap:anywhere]">{x.title}</span>
                <span className="block text-xs text-muted-foreground">
                  <Facts text={`${f.date(x.date)} · ${where}`} />
                </span>
              </span>
              {/* The figures keep their own column at the row's end: dropped under
                  the title on some rows only, they read as a ragged list */}
              <span className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                {x.unconfirmed ? (
                  <Badge variant="warning">{t('session.unconfirmed')}</Badge>
                ) : (
                  x.unmarked_count > 0 && (
                    <Badge variant="warning">{t('dashboard.recent.unmarked', { count: x.unmarked_count })}</Badge>
                  )
                )}
                <Badge variant="secondary">
                  {counted
                    ? t('dashboard.recent.result', { present: x.present_count, marked: x.present_count + x.absent_count })
                    : t('dashboard.recent.present', { count: x.present_count })}
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
  // A long figure («127 000 F») shrinks to its tile on a phone instead of running
  // past the padding — it cannot wrap, its spaces are no-break. Short ones, and
  // every figure in a wider tile, stay at the full 1.875rem.
  const chars = Math.max(1, String(value).replace(/[\u2066-\u2069]/g, '').length);
  const body = (
    <Card interactive={!!to} className="@container flex h-full flex-col gap-1 p-4 sm:p-5">
      {/* Two lines kept on phones: a label that wraps beside one that doesn't
          would drop its number below its neighbour's */}
      <span className="text-sm text-muted-foreground max-sm:min-h-[2lh]">{label}</span>
      <span
        className="text-3xl font-bold leading-tight tracking-tight"
        style={{ fontSize: `min(1.875rem, ${(180 / chars).toFixed(1)}cqi)` }}
      >
        {value}
      </span>
      {context && <span className="text-xs text-muted-foreground">{context}</span>}
      <Spark points={spark} className="mt-auto h-9 pt-2" />
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
 * Loading placeholder in the page's own shape — the figures two by two on a
 * phone, four abreast from xl, then the rail and the main column — so nothing
 * jumps when the numbers land.
 */
function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-start">
        <Skeleton className="h-72 rounded-2xl xl:col-start-3 xl:row-start-1" />
        <Skeleton className="h-72 rounded-2xl xl:col-span-2 xl:col-start-1 xl:row-start-1" />
      </div>
    </div>
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
  const { can } = usePerms();
  const res = useFetch('/dashboard');
  const d = res.data;
  const [sp] = useSearchParams();
  const reportMonth = sp.get('report');
  // تكاليف ticked off (or opened again) on this visit: id → status
  const [decided, setDecided] = useState({});
  const [decisionBusy, setDecisionBusy] = useState(null);
  const todos = useMemo(
    () => (d ? buildTodos(d, t, f, i18n.language, decided) : []),
    [d, t, f, i18n.language, decided]
  );
  const agenda = useMemo(() => (d ? buildAgenda(d, i18n.language) : []), [d, i18n.language]);
  // Kept on the server, so they follow the account to every device: kinds turned
  // off for good, and to-dos masked until they change (key → what they held)
  const todoPrefs = useFetch('/me/settings/dashboard.todo');
  const hiddenKinds = todoPrefs.data?.hidden ?? [];
  const masked = todoPrefs.data?.masked ?? {};
  const [customizing, setCustomizing] = useState(false);
  const toast = useToast();
  // Shown at once, saved behind; a failed save puts the previous choice back
  const saveTodoPrefs = (patch) => {
    const prev = todoPrefs.data;
    const next = { hidden: hiddenKinds, masked, ...patch };
    todoPrefs.setData(next);
    api.put('/me/settings/dashboard.todo', next).catch(() => {
      todoPrefs.setData(prev);
      toast.error(t('dashboard.todo.saveFailed'));
    });
    return next;
  };
  const kept = todos.filter((todo) => !hiddenKinds.includes(todo.key));
  const shownTodos = kept.filter((todo) => masked[todo.key] !== todoSig(todo));
  const maskedCount = kept.length - shownTodos.length;
  const setHiddenKinds = (hidden) => saveTodoPrefs({ hidden });
  const setMasked = (m) => saveTodoPrefs({ masked: m });
  const dismissTodo = (todo) => {
    // Only what is still on the list is kept: a to-do gone and back is new again
    setMasked({
      ...Object.fromEntries(todos.filter((x) => masked[x.key] === todoSig(x)).map((x) => [x.key, masked[x.key]])),
      [todo.key]: todoSig(todo),
    });
    toast.info(t('dashboard.todo.dismissed'));
  };
  const toggleKind = (key) =>
    setHiddenKinds(hiddenKinds.includes(key) ? hiddenKinds.filter((k) => k !== key) : [...hiddenKinds, key]);
  // A تكليف ticked here is ticked at once; a refusal puts it back and says why
  const toggleDecision = async (x) => {
    const next = x.status === 'done' ? 'open' : 'done';
    setDecided((s) => ({ ...s, [x.id]: next }));
    setDecisionBusy(x.id);
    try {
      await api.put(`/meetings/${x.meeting_id}/decisions/${x.id}/status`, { status: next });
    } catch (err) {
      setDecided((s) => ({ ...s, [x.id]: x.status }));
      toast.error(err.message);
    } finally {
      setDecisionBusy(null);
    }
  };
  const decisionProps = {
    today: d?.today,
    canFollow: can('meetings.followup'),
    busy: decisionBusy,
    onToggle: toggleDecision,
  };

  // Settings too: otherwise masked to-dos flash in, then vanish
  if (res.loading || todoPrefs.loading) return <DashboardSkeleton />;
  if (res.error)
    return (
      <div className="space-y-6">
        {/* The title stays: the home screen still says where it is */}
        <PageHeader title={t('dashboard.title')} />
        <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />
      </div>
    );

  const lng = i18n.language;
  const live = d.branches.filter(isLive);
  const empty = d.branches.filter((b) => !isLive(b));
  const month = f.month(d.today.slice(0, 7));

  const delta =
    d.month?.rate != null && d.month.prev_rate != null
      ? t('dashboard.vsPrev', {
          // Isolated, so an Arabic line keeps the sign before the digits: «−2», not «2−»
          delta: bidi(`${d.month.rate - d.month.prev_rate >= 0 ? '+' : '−'}${Math.abs(d.month.rate - d.month.prev_rate)}`),
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
          // The pseudo-element takes the 17px line to a thumb's height, as on «Voir tout»
          className='focus-ring relative rounded font-medium tabular-nums before:absolute before:-inset-x-1 before:-inset-y-3 before:content-[""] hover:text-primary hover:underline'
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
  // Shown as soon as the account reads one of what it gathers, even with nothing ahead:
  // «Rien de prévu» is an answer too
  const hasAgenda = !!(d.agenda?.events || d.agenda?.meetings || hasPlan);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dashboard.title')}
        description={[t('dashboard.season', { year: d.year }), f.dayCap(d.today)].join(' · ')}
      >
        {/* I1 : le rappel du 1er du mois ouvre ici, sur le mois écoulé (?report=YYYY-MM) */}
        <PeriodReportButton month={/^\d{4}-\d{2}$/.test(reportMonth || '') ? reportMonth : null} />
      </PageHeader>

      {/* Le قائد voit tout de suite ce qu'il a payé et ce qu'il doit encore */}
      {user?.leader_id && <LeaderDuesCard endpoint="/me/dues" compact />}

      {kpis.length > 0 && (
        <section aria-label={t('dashboard.figures')} className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {kpis.map(({ key, ...k }) => (
            <Kpi key={key} {...k} />
          ))}
        </section>
      )}

      {/* grid-cols-1, not the implicit auto column: an auto track grows to its
          widest child's min-content (the chart's eight date labels), and the
          whole column — «À traiter» included — then ran past a phone's edge */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-start">
        {/* First in the source so a phone reaches it right after the figures;
            placed in the end column from xl up — any narrower and a third of
            the width leaves its titles breaking mid-word */}
        <aside className="space-y-4 xl:col-start-3 xl:row-start-1">
          <section aria-labelledby="dashboard-todo">
            <Card className="overflow-hidden">
              <CardHeader className="flex-row items-center gap-2">
                <CardTitle id="dashboard-todo" className="me-auto">
                  {t('dashboard.todo.title')}
                </CardTitle>
                {shownTodos.length > 0 && <Badge variant="secondary">{shownTodos.length}</Badge>}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="-my-1.5 -me-1.5 text-muted-foreground"
                  onClick={() => setCustomizing(true)}
                  aria-label={t('dashboard.todo.customize')}
                  title={t('dashboard.todo.customize')}
                >
                  <IconSettings className="h-4 w-4" />
                </Button>
              </CardHeader>
              {shownTodos.length > 0 ? (
                <ul className="divide-y divide-border border-t border-border">
                  {shownTodos.map((todo) => (
                    <TodoRow key={todo.key} todo={todo} onDismiss={dismissTodo} decisionProps={decisionProps} />
                  ))}
                </ul>
              ) : (
                <CardContent className="flex items-start gap-2 text-sm">
                  <IconCheck className="mt-0.5 text-success" />
                  <span>{t('dashboard.todo.allClear')}</span>
                </CardContent>
              )}
              {maskedCount > 0 && (
                <div className="border-t border-border px-4 py-2.5 text-sm text-muted-foreground sm:px-5">
                  {t('dashboard.todo.maskedCount', { count: maskedCount })}
                  {' · '}
                  <button
                    type="button"
                    onClick={() => setMasked({})}
                    className="focus-ring rounded font-medium text-primary hover:underline"
                  >
                    {t('dashboard.todo.showMasked')}
                  </button>
                </div>
              )}
            </Card>
            <Dialog
              open={customizing}
              onClose={() => setCustomizing(false)}
              title={t('dashboard.todo.customize')}
              description={t('dashboard.todo.customizeHint')}
              size="sm"
              autoFocus={false}
              footer={
                <div className="flex flex-wrap justify-end gap-2">
                  {hiddenKinds.length > 0 && (
                    <Button variant="ghost" onClick={() => setHiddenKinds([])} className="me-auto">
                      {t('dashboard.todo.showAll')}
                    </Button>
                  )}
                  <Button onClick={() => setCustomizing(false)}>{t('common.close')}</Button>
                </div>
              }
            >
              <ul className="divide-y divide-border">
                {TODO_TYPES.map(([key, label]) => (
                  <li key={key}>
                    <label className="flex cursor-pointer items-center gap-3 py-2.5 text-sm">
                      <input type="checkbox" checked={!hiddenKinds.includes(key)} onChange={() => toggleKind(key)} />
                      <span className="flex-1">{t(label)}</span>
                      {todos.some((x) => x.key === key) && (
                        <span className="text-xs text-muted-foreground">{t('dashboard.todo.currentlyThere')}</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </Dialog>
          </section>
        </aside>

        <div className="space-y-4 xl:col-span-2 xl:col-start-1 xl:row-start-1">
          {/* What comes next leads the main column: on a phone it follows «À traiter»,
              before the figures of what already happened */}
          {hasAgenda && <AgendaCard days={agenda} today={d.today} />}

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
                          className='focus-ring relative min-w-0 rounded font-semibold before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-[""] hover:text-primary hover:underline'
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
                  {/* The pseudo-element takes the hit area to a thumb's size; the
                      header keeps its height */}
                  <Link
                    to="/sessions"
                    className='focus-ring relative rounded text-sm font-medium text-primary before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[""] hover:underline'
                  >
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
