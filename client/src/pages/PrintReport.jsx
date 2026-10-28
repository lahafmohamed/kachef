import { Fragment, useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
// The paper's own faces, static where the app's are variable: Chromium writes a variable
// font into a PDF as Type 3 drawings, which made every export slow to print and heavy to
// download. Same files, same glyphs and features — only the four weights the sheets use.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/noto-sans-arabic/400.css';
import '@fontsource/noto-sans-arabic/500.css';
import '@fontsource/noto-sans-arabic/600.css';
import '@fontsource/noto-sans-arabic/700.css';
import { useTranslation } from 'react-i18next';
import { useAuth, usePerms } from '../auth';
import { useBack, useFetch } from '../hooks';
import { useSection } from '../section';
import ExportPdfButton from '../components/ExportPdfButton';
import { phoneNumbers } from '../components/MemberParts';
import {
  FLOWS,
  INCOME_SOURCES,
  OUT_CATEGORIES,
  OUT_FIGURES,
  boxName,
  byMonth,
  fmtMonth,
  ledgerView,
  boxPeriodLabel,
  periodOfQuery,
  resultTone,
  rowText,
  sessionMeta,
} from '../lib/treasury';
import {
  chiefLabel,
  dayNumber,
  dueOf,
  eventScopeLabels,
  fmtDateRange,
  participantName,
  payState,
  signed,
  staffRoleLabel,
} from '../lib/events';
import { familyCount, parentPhones, remainingOf, rosterByGroup, unpaidOf } from '../lib/campFile';
import {
  attendanceCounts,
  attendeesByStatus,
  decisionCounts,
  fmtLongDate,
  gendered,
  isOverdue,
  meetingScope,
  timeRange,
  userText,
} from '../lib/meetings';
import { attendanceLine } from '../components/MeetingParts';
import { arrearsMonths, arrearsQuery, groupArrears } from '../lib/arrears';
import { isCountedSession } from '../lib/attendance';
import { periodLabel, periodQuery, rateDelta } from '../lib/periodReport';
import {
  LEADER_FILTER_KEYS,
  activityTypeKey,
  avatarName,
  branchName,
  filterLeaders,
  fmtAmount,
  fmtDate,
  fmtPhone,
  fmtTime,
  memberName,
  todayISO,
} from '../utils';
import {
  Avatar,
  Button,
  cn,
  EmptyState,
  ErrorState,
  SkeletonPage,
  IconAlert,
  IconBack,
} from '../components/ui';

/**
 * تصدير PDF: ورقة واحدة لكل نشاط / عنصر / قائد / فرقة. السيرفر يفتح هذه الصفحة
 * نفسها في Chromium و يطبعها إلى ملف PDF يُحمَّل — لا مكتبة PDF: تشكيل الحروف
 * العربية و اتجاه الكتابة و فواصل الصفحات يأتيان من المتصفح.
 *
 * Every sheet is a plain document: no buttons, no collapsed sections, no
 * mobile/desktop duplicates — what the page shows is what the file holds. A
 * person can open it too, as a preview; the toolbar is hidden from the PDF.
 */

const KINDS = {
  sessions: { perm: 'sessions.read', label: 'print.reportSession', back: '/sessions' },
  members: { perm: 'members.read', label: 'print.reportMember', back: '/members' },
  leaders: { perm: null, label: 'print.reportLeader', back: '/leaders' },
  branches: { perm: 'branches.read', label: 'print.reportBranch', back: '/branches' },
  // الوحيدة التي ترقيمها ليس رقم بطاقة بل رقم فرقة، و 0 فيها تعني كل الفرق
  promotions: { perm: 'promotions.read', label: 'print.reportPromotions', back: '/promotions' },
  // Lists: the id is a فرقة (0 = all), the page's filters ride in the query string
  'members-list': { perm: 'members.read', label: 'print.reportMembersList', back: '/members' },
  'leaders-list': { perm: 'leaders.read', label: 'print.reportLeadersList', back: '/leaders' },
  'sessions-list': { perm: 'sessions.read', label: 'print.reportSessionsList', back: '/sessions' },
  'prep-list': { perm: 'prep.read', label: 'print.reportPrepList', back: '/prep-cards' },
  plan: { perm: 'branches.read', label: 'print.reportPlan', back: '/branches' },
  prep: { perm: 'prep.read', label: 'print.reportPrep', back: '/prep-cards' },
  // الصناديق: id 0, the caisse (?box=) and direction (?flow=) the page showed
  treasury: { perm: 'treasury.read', label: 'print.reportTreasury', back: '/treasury' },
  // A فرقة's money tab: the id is the فرقة
  'branch-money': { perm: 'branches.read', label: 'print.reportBranchMoney', back: '/branches' },
  // محضر اجتماع; then the list (id 0, the page's filters in the query) and the follow-up
  meeting: { perm: 'meetings.read', label: 'print.reportMeeting', back: '/meetings' },
  'meetings-list': { perm: 'meetings.read', label: 'print.reportMeetingsList', back: '/meetings' },
  'meeting-decisions': { perm: 'meetings.read', label: 'print.reportMeetingDecisions', back: '/meetings' },
  // E2 : le dossier d'un camp (?variant=report : le rapport à la قيادة), et ses restes à payer
  event: { perm: 'events.read', label: 'print.reportEvent', back: '/events' },
  'event-unpaid': { perm: 'events.read.fees', label: 'print.reportEventUnpaid', back: '/events' },
  // G1 : les cotisations en retard — le numéro est une فرقة (0 = toutes), ?year= & ?current=1
  'dues-arrears': { perm: 'members.dues.read', label: 'print.reportDuesArrears', back: '/treasury' },
  // I1 : le rapport périodique à la قيادة — le numéro est une فرقة (0 = le فوج), ?from=&to=&recipient=
  period: { perm: 'branches.read', label: 'print.reportPeriod', back: '/' },
  // حضور الأمانة : le numéro est le توصيف de son أمين
  'amana-presence': { perm: 'leaders.read', label: 'print.reportAmanaPresence', back: '/leaders' },
};

const pct = (num, den) => (den ? `${Math.round((num / den) * 100)}%` : '—');

// مطالب numbers as the pages list them: in Arabic the first reads first, on the right
const listSep = (lng) => (lng === 'ar' ? '، ' : ', ');

/** Present / absent / excused / untouched counts of a roster, with the rate the app uses. */
function countStatuses(list) {
  const c = { present: 0, absent: 0, excused: 0, unmarked: 0 };
  for (const p of list) c[p.status && c[p.status] !== undefined ? p.status : 'unmarked']++;
  const marked = c.present + c.absent + c.excused;
  return { ...c, marked, rate: pct(c.present, marked) };
}

/* ============================================================
   Paper primitives
   ============================================================ */

function Sheet({ kindLabel, children }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const today = fmtDate(todayISO());
  return (
    <article className="print-sheet mx-auto w-full max-w-[210mm] rounded-xl bg-card px-6 py-6 text-[13px] leading-snug text-card-foreground shadow-md sm:px-[14mm] sm:py-[12mm]">
      {/* On a phone preview the «generated on» lines drop under the brand instead of
          squeezing the group's name onto two lines; on paper they stay at the end */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b-2 border-primary pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/logo-mark.png" alt="" width={56} height={56} className="h-12 w-12 shrink-0 sm:h-14 sm:w-14" />
          <div className="min-w-0">
            <div className="text-lg font-bold leading-tight text-primary">{t('app.name')}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {kindLabel}
            </div>
          </div>
        </div>
        <div className="text-start text-[11px] leading-relaxed text-muted-foreground sm:text-end">
          <div className="tabular-nums">{t('print.generatedOn', { date: today })}</div>
          {user && <div>{t('print.generatedBy', { name: user.display_name || user.username })}</div>}
        </div>
      </header>

      {children}

      {/* Never a page of its own: when it does not fit, it takes the block above along */}
      <footer className="mt-8 flex break-before-avoid justify-between gap-4 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <span>
          {t('app.name')} · {kindLabel}
        </span>
        <span className="tabular-nums">{today}</span>
      </footer>
    </article>
  );
}

function H1({ children, className }) {
  return (
    <h1 className={cn('mt-5 text-2xl font-bold leading-tight tracking-tight', className)}>{children}</h1>
  );
}

// Arabic has no capitals to carry a small heading: one size up, without the tracking
function H2({ children, aside }) {
  return (
    <div className="avoid-break mb-2 mt-6 flex break-after-avoid items-baseline justify-between gap-3 border-b border-border pb-1">
      <h2 className="text-[12px] font-bold uppercase tracking-wider text-primary rtl:text-[13px] rtl:tracking-normal">
        {children}
      </h2>
      {aside !== null && aside !== undefined && (
        <span className="text-[11px] tabular-nums text-muted-foreground">{aside}</span>
      )}
    </div>
  );
}

const TAG_TONES = {
  default: 'border-primary/30 bg-primary/8 text-primary',
  neutral: 'border-border bg-muted text-foreground',
  success: 'border-success/40 bg-success/10 text-success',
  destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
  warning: 'border-warning/40 bg-warning/10 text-warning',
};

function Tag({ children, tone = 'default', className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium',
        TAG_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

function Tags({ children }) {
  return <div className="mt-2 flex flex-wrap items-center gap-1.5">{children}</div>;
}

/** Label / value pairs; an empty value drops its pair rather than printing a blank. */
function Facts({ items }) {
  const rows = items.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false);
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
      {rows.map(([label, value, ltr]) => (
        <div key={label} className="avoid-break min-w-0">
          <dt className="text-[11px] text-muted-foreground first-letter:uppercase">{label}</dt>
          <dd className="break-words font-medium">
            {ltr ? (
              <span dir="ltr" className="tabular-nums">
                {value}
              </span>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The figures in one row on paper: five get five columns rather than four and one
 * left alone underneath. Two per row on a phone, an odd last one across both.
 */
function Stats({ items }) {
  const odd = items.length % 2 === 1;
  return (
    <div className={cn('avoid-break grid grid-cols-2 gap-2', items.length === 5 ? 'sm:grid-cols-5' : 'sm:grid-cols-4')}>
      {items.map((s, i) => (
        <div
          key={s.label}
          className={cn(
            'min-w-0 rounded-lg border border-border px-3 py-2',
            odd && i === items.length - 1 && 'col-span-2 sm:col-span-1'
          )}
        >
          <div className={cn('text-xl font-bold leading-none tabular-nums', s.cls)}>{s.value}</div>
          <div className="mt-1 text-[11px] leading-tight text-muted-foreground first-letter:uppercase">{s.label}</div>
          {s.hint && <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{s.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/** Check / cross / ring, drawn — a glyph would depend on the fonts installed where the PDF is made. */
function Mark({ kind, className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('inline-block h-3 w-3 shrink-0 align-[-1px]', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'check' && <path d="M20 6 9 17l-5-5" />}
      {kind === 'x' && <path d="M18 6 6 18M6 6l12 12" />}
      {kind === 'circle' && <circle cx="12" cy="12" r="7" />}
    </svg>
  );
}

// A mark next to the word, so a black-and-white print still reads at a glance
const STATUS = {
  present: { key: 'session.present', mark: 'check', cls: 'text-success' },
  absent: { key: 'session.absent', mark: 'x', cls: 'text-destructive' },
  excused: { key: 'session.excused', mark: 'circle', cls: 'text-warning' },
};

function Status({ status }) {
  const { t } = useTranslation();
  const s = STATUS[status];
  if (!s) return <span className="whitespace-nowrap text-muted-foreground">— {t('session.unmarked')}</span>;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap font-semibold', s.cls)}>
      <Mark kind={s.mark} />
      {t(s.key)}
    </span>
  );
}

// The header rule is an opaque grey: a translucent one doubles up where two cells meet,
// leaving a dark tick at every column joint of the PDF
function Table({ head, children, className }) {
  return (
    // A phone's preview is narrower than the paper: a wide table scrolls inside the sheet
    // there instead of pushing the whole page sideways. Paper is always wider than sm, so
    // the file never sees the scroller
    <div className="max-sm:overflow-x-auto">
      <table className={cn('w-full border-collapse text-[12px]', className)}>
        <thead>
          <tr className="border-b border-muted-foreground">
            {head.map((h, i) => {
              const label = typeof h === 'string' ? h : h.label;
              const cls = typeof h === 'string' ? undefined : h.className;
              return (
                <th
                  key={i}
                  scope="col"
                  className={cn(
                    'py-1.5 pe-3 text-start align-bottom text-[11px] font-semibold uppercase tracking-wide text-muted-foreground last:pe-0',
                    cls
                  )}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

// The last column ends flush with the table, under the heading's aside — no gutter left
// after it
const td = 'py-1.5 pe-3 align-top last:pe-0';
const tdNum = `${td} whitespace-nowrap tabular-nums`;

function MatalibGrid({ total, selected }) {
  const set = new Set(selected);
  return (
    <div className="avoid-break flex flex-wrap gap-1">
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <span
          key={n}
          className={cn(
            'flex h-7 w-8 items-center justify-center rounded border text-[11px] font-semibold tabular-nums',
            set.has(n)
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-muted text-muted-foreground'
          )}
        >
          {n}
        </span>
      ))}
    </div>
  );
}

function Signature({ label }) {
  return (
    <div className="avoid-break mt-8 grid grid-cols-2 gap-8">
      <div />
      <div>
        <div className="h-12 border-b border-muted-foreground" />
        <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function PersonHeader({ person, children }) {
  return (
    <div className="mt-5 flex items-start gap-4">
      <Avatar photo={person.photo} name={avatarName(person)} className="h-16 w-16 text-xl" />
      <div className="min-w-0 flex-1">
        <H1 className="mt-0">{memberName(person)}</H1>
        {children}
      </div>
    </div>
  );
}

function LoadError({ onRetry }) {
  const { t } = useTranslation();
  return (
    <div data-print-error="">
      <ErrorState message={t('error.loadFailed')} onRetry={onRetry} retryLabel={t('error.retry')} />
    </div>
  );
}

/* ============================================================
   بطاقة النشاط
   ============================================================ */

function SessionReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const res = useFetch(`/sessions/${id}`);
  const branches = useFetch('/branches');
  const session = res.data;
  useEffect(() => {
    if (session) onReady(session.title);
  }, [session, onReady]);

  if (res.loading || branches.loading) return <SkeletonPage rows={6} />;
  if (res.error || !session) return <LoadError onRetry={res.reload} />;

  const list = branches.data || [];
  const sessionBranches = (session.branch_ids?.length ? session.branch_ids : [session.branch_id])
    .map((bid) => list.find((b) => b.id === bid))
    .filter(Boolean);
  const nameOfBranch = (bid) => branchName(list.find((b) => b.id === bid) || session, lng);
  const kindKey =
    { visit: 'session.kindVisit', leaders: 'session.kindLeaders', group: 'session.kindGroup' }[
      session.kind
    ] || null;
  const isLeaders = session.kind === 'leaders';
  const isGroup = session.kind === 'group';
  const isVisit = session.kind === 'visit';
  const roster = session.roster || [];
  const animators = session.animators || [];
  const counts = countStatuses(isLeaders ? animators : roster);
  // نشاط القادة قد يدعو فرقًا: لائحتها تُعدّ على حدة، فلا تختلط بحضور القادة
  const rosterCounts = isLeaders ? countStatuses(roster) : counts;
  const guests = session.guests || [];
  const rosterBranchIds = [...new Set(roster.map((m) => m.branch_id))];
  const branchCounts = session.branch_counts || [];
  const groupTotal = branchCounts.reduce((n, c) => n + (Number(c.count) || 0), 0);
  const natureKey = activityTypeKey(session.activity_type);

  // خانة الاشتراك تُطبع حين يكون فيها ما يُطبع: نشاط بلا اشتراكات (أو مستخدم لا يرى
  // المبالغ، فتصله فارغة) يبقى جدوله كما كان
  const showPaid = roster.some((m) => m.paid !== null && m.paid !== undefined);
  const rosterCollected = roster.reduce((n, m) => n + (m.paid || 0), 0);

  const summary = [
    { value: counts.present, label: t('print.presentCount'), cls: 'text-success' },
    { value: counts.absent, label: t('print.absentCount'), cls: 'text-destructive' },
    ...(isLeaders ? [] : [{ value: counts.excused, label: t('print.excusedCount'), cls: 'text-warning' }]),
    { value: counts.unmarked, label: t('print.unmarkedCount'), cls: 'text-muted-foreground' },
    ...(isLeaders ? [{ value: counts.rate, label: t('print.rate'), cls: 'text-primary' }] : []),
    // حصيلة الاشتراكات، محسوبة من خانات اللائحة
    ...(showPaid
      ? [
          {
            value: fmtAmount(rosterCollected),
            label: t('session.subscriptions'),
            cls: 'text-success',
            hint: t('session.paidCount', {
              paid: roster.filter((m) => m.paid !== null && m.paid !== undefined).length,
              total: roster.length,
            }),
          },
        ]
      : []),
  ];

  const rosterTable = (rows) => (
    <Table
      head={[
        '#',
        t('member.name'),
        t('member.group'),
        // Figures end-aligned against a status that starts its column: a wider gutter
        // between them, or the two headings read as one
        ...(showPaid ? [{ label: t('session.subscriptions'), className: 'pe-6 text-end' }] : []),
        t('member.status'),
      ]}
    >
      {rows.map((m, i) => (
        <tr key={m.id}>
          <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
          <td className={cn(td, 'font-medium')}>
            {memberName(m)}
            {m.consecutive_absences >= (session.absence_threshold ?? 3) && (
              <Tag tone="destructive" className="ms-2">
                {t('member.consecutiveAbsences', { count: m.consecutive_absences })}
              </Tag>
            )}
          </td>
          <td className={cn(td, 'text-muted-foreground')}>{m.group_name || '—'}</td>
          {showPaid && (
            <td className={cn(tdNum, 'w-24 pe-6 text-end font-medium')}>
              {m.paid !== null && m.paid !== undefined ? fmtAmount(m.paid) : '—'}
            </td>
          )}
          <td className={td}>
            <Status status={m.status} />
          </td>
        </tr>
      ))}
    </Table>
  );

  return (
    <Sheet kindLabel={kindLabel}>
      <H1>{session.title}</H1>
      <Tags>
        <Tag tone="neutral">{fmtDate(session.date)}</Tag>
        {session.start_time && <Tag tone="neutral">{fmtTime(session.start_time)}</Tag>}
        {session.place && <Tag tone="neutral">{session.place}</Tag>}
        {session.branch_id
          ? (sessionBranches.length ? sessionBranches : [session]).map((b, i) => (
              <Tag key={b.id ?? i}>{branchName(b, lng)}</Tag>
            ))
          : kindKey && <Tag>{t(kindKey)}</Tag>}
        {/* نشاط القادة: فرقه المدعوّة بعد نوعه */}
        {!session.branch_id &&
          sessionBranches.map((b) => (
            <Tag key={b.id} tone="neutral">
              {branchName(b, lng)}
            </Tag>
          ))}
        {session.branch_id && kindKey && <Tag tone="warning">{t(kindKey)}</Tag>}
        {(session.groups || []).map((g) => (
          <Tag key={g.id} tone="neutral">
            {g.name}
          </Tag>
        ))}
        {natureKey && <Tag tone="neutral">{t(natureKey)}</Tag>}
      </Tags>

      <div className="mt-4">
        <Facts
          items={[
            [t('session.leader'), session.leader],
            // In francs, as the page and the roster's column show it
            [t('session.fee'), session.fee !== null && session.fee !== undefined ? fmtAmount(session.fee) : null],
            [t('session.requirementsShort'), session.matalib?.length ? session.matalib.join(listSep(lng)) : null],
            [
              t('print.linkedPrepCards'),
              session.prep_cards?.length ? session.prep_cards.map((c) => c.title).join(' · ') : null,
            ],
          ]}
        />
      </div>
      {session.attendance_finalized_at && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {t('print.finalized', {
            date: fmtDate(session.attendance_finalized_at),
            name: session.attendance_finalized_by || '—',
          })}
        </p>
      )}

      {/* ---------- نشاط عام للفوج: الحضور بالأعداد ---------- */}
      {isGroup && (
        <>
          <H2 aside={`${t('print.total')} · ${groupTotal}`}>{t('session.branchCounts')}</H2>
          <Table head={[t('member.branch'), { label: t('print.presentCount'), className: 'text-end' }]}>
            {branchCounts.map((c) => (
              <tr key={c.branch_id}>
                <td className={cn(td, 'font-medium')}>{nameOfBranch(c.branch_id)}</td>
                <td className={cn(tdNum, 'text-end')}>{c.count}</td>
              </tr>
            ))}
            {session.leaders_count !== null && session.leaders_count !== undefined && (
              <tr>
                <td className={cn(td, 'font-medium')}>{t('session.leadersCount')}</td>
                <td className={cn(tdNum, 'text-end')}>{session.leaders_count}</td>
              </tr>
            )}
          </Table>
        </>
      )}

      {!isGroup && (
        <>
          <H2>{t('print.summary')}</H2>
          <Stats items={summary} />
        </>
      )}

      {/* ---------- قادة النشاط / حضور القادة ---------- */}
      {animators.length > 0 && (
        <>
          <H2
            aside={
              isLeaders ? t('session.marked', { marked: counts.marked, total: animators.length }) : null
            }
          >
            {t(isLeaders ? 'session.leadersAttendance' : 'session.animators')}
          </H2>
          <Table head={['#', t('member.name'), t('session.role'), t('session.myPresence')]}>
            {animators.map((a, i) => (
              <tr key={a.leader_id}>
                <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
                <td className={cn(td, 'font-medium')}>{memberName(a)}</td>
                <td className={td}>
                  {a.role ? t(a.role === 'main' ? 'session.mainAnimator' : 'session.helper') : '—'}
                </td>
                <td className={td}>
                  <Status status={a.status} />
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {/* ---------- ضيوف نشاط القادة ---------- */}
      {isLeaders && guests.length > 0 && (
        <>
          <H2 aside={guests.length}>{t('session.guests')}</H2>
          <Table head={['#', t('member.name')]}>
            {guests.map((g, i) => (
              <tr key={g.id}>
                <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
                <td className={cn(td, 'font-medium')}>{g.name}</td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {/* ---------- لائحة العناصر — في نشاط القادة: عناصر الفرق المدعوّة ---------- */}
      {!isGroup && (!isLeaders || roster.length > 0) && (
        <>
          <H2 aside={t('session.marked', { marked: rosterCounts.marked, total: roster.length })}>
            {t(isVisit ? 'session.visitedMembers' : isLeaders ? 'session.invitedRoster' : 'session.roster')}
          </H2>
          {roster.length === 0 ? (
            <p className="text-muted-foreground">{t('session.emptyRoster')}</p>
          ) : rosterBranchIds.length > 1 ? (
            rosterBranchIds.map((bid) => {
              const rows = roster.filter((m) => m.branch_id === bid);
              const c = countStatuses(rows);
              return (
                <div key={bid} className="mb-4">
                  <div className="avoid-break mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="font-semibold">{nameOfBranch(bid)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {c.present} {t('session.present')} · {c.absent} {t('session.absent')} · {c.excused}{' '}
                      {t('session.excused')}
                    </span>
                  </div>
                  {rosterTable(rows)}
                </div>
              );
            })
          ) : (
            rosterTable(roster)
          )}
        </>
      )}

      <Signature label={t('print.signatureLeader')} />
    </Sheet>
  );
}

/* ============================================================
   بطاقة العنصر
   ============================================================ */

function AttendanceRows({ history }) {
  const { t } = useTranslation();
  return (
    <Table head={[t('common.date'), t('session.sessionTitle'), t('member.status')]}>
      {history.map((h) => (
        <tr key={h.session_id}>
          <td className={cn(tdNum, 'w-24 text-muted-foreground')}>{fmtDate(h.date)}</td>
          <td className={cn(td, 'font-medium')}>{h.title}</td>
          <td className={cn(td, 'w-28')}>
            <Status status={h.status} />
          </td>
        </tr>
      ))}
    </Table>
  );
}

function MemberReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const res = useFetch(`/members/${id}`);
  const m = res.data;
  useEffect(() => {
    if (m) onReady(memberName(m));
  }, [m, onReady]);

  if (res.loading) return <SkeletonPage rows={6} />;
  if (res.error || !m) return <LoadError onRetry={res.reload} />;

  const { stats } = m;
  const total = m.branch_total_requirements || 0;
  const earned = Math.min(stats.requirements_earned, total);
  const rateCls =
    stats.rate === null
      ? 'text-foreground'
      : stats.rate >= 75
        ? 'text-success'
        : stats.rate >= 50
          ? 'text-warning'
          : 'text-destructive';

  return (
    <Sheet kindLabel={kindLabel}>
      <PersonHeader person={m}>
        <Tags>
          <Tag>{branchName(m, lng)}</Tag>
          {m.group_name && <Tag tone="neutral">{m.group_name}</Tag>}
          <Tag tone={m.status === 'active' ? 'success' : 'neutral'}>
            {t(m.status === 'active' ? 'member.active' : 'member.inactive')}
          </Tag>
          <Tag tone="neutral">
            {m.age != null && `${t('common.age', { count: m.age })} · `}
            {t(m.sex === 'M' ? 'member.male' : 'member.female')}
          </Tag>
        </Tags>
      </PersonHeader>

      <H2>{t('print.identity')}</H2>
      <Facts
        items={[
          [t('member.birthDate'), fmtDate(m.birth_date), true],
          [t('member.birthPlace'), m.birth_place],
          [t('member.joinDate'), fmtDate(m.join_date), true],
          [t('member.school'), m.school],
          [t('member.bloodType'), m.blood_type, true],
          [t('member.fatherName'), m.father_name],
          [t('member.motherName'), m.mother_name],
        ]}
      />

      {/* الحقول التي يحجبها السيرفر عمّن لا يملك صلاحية التواصل لا تصل أصلًا، فلا تُطبع */}
      {(m.address_abidjan || m.address_lebanon || m.member_phone || m.father_phone || m.mother_phone) && (
        <>
          <H2>{t('print.contacts')}</H2>
          <Facts
            items={[
              [t('member.addressAbidjan'), m.address_abidjan],
              [t('member.addressLebanon'), m.address_lebanon],
              [t('member.memberPhone'), fmtPhone(m.member_phone), true],
              [t('member.fatherPhone'), fmtPhone(m.father_phone), true],
              [t('member.motherPhone'), fmtPhone(m.mother_phone), true],
            ]}
          />
        </>
      )}

      <H2>{t('print.summary')}</H2>
      <Stats
        items={[
          {
            value: stats.rate !== null ? `${stats.rate}%` : '—',
            label: t('member.attendanceRate'),
            cls: rateCls,
          },
          { value: stats.present, label: t('leader.timesPresent'), cls: 'text-success' },
          { value: stats.total, label: t('branch.activities') },
          {
            value: stats.consecutive_absences,
            label: t('print.consecutive'),
            cls: stats.consecutive_absences >= (m.absence_threshold ?? 3) ? 'text-destructive' : undefined,
          },
          // المجموع التراكمي لاشتراكاته — يغيب عمّن لا يرى المبالغ، فلا يصله الحقل
          ...(m.subscriptions
            ? [
                {
                  value: fmtAmount(m.subscriptions.total),
                  label: t('member.subscriptionsPaid'),
                  cls: 'text-success',
                },
              ]
            : []),
        ]}
      />

      {total > 0 && (
        <>
          <H2 aside={`${t('member.requirementsOf', { earned, total })} · ${pct(earned, total)}`}>
            {t('member.requirementsProgress')}
          </H2>
          <MatalibGrid total={total} selected={stats.earned_numbers} />
          {m.manual_matalib?.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              <span className="font-medium">{t('member.matalibManual')} :</span>{' '}
              {m.manual_matalib
                .map(
                  (x) =>
                    `${x.number} ${t(x.state === 'granted' ? 'member.matalibGranted' : 'member.matalibRevoked')}${
                      x.updated_by ? ` (${t('member.matalibBy', { name: x.updated_by })})` : ''
                    }`
                )
                .join(' · ')}
            </p>
          )}
        </>
      )}

      {m.promotions?.length > 0 && (
        <>
          <H2>{t('promotion.history')}</H2>
          <Table head={[t('common.date'), t('member.branch'), t('session.requirementsShort')]}>
            {m.promotions.map((p) => (
              <tr key={p.id}>
                <td className={cn(tdNum, 'w-24 text-muted-foreground', p.reversed_at && 'line-through')}>
                  {fmtDate(p.promoted_at)}
                </td>
                <td className={cn(td, 'font-medium')}>
                  {lng === 'ar' ? p.old_name_ar : p.old_name_fr} →{' '}
                  {lng === 'ar' ? p.new_name_ar : p.new_name_fr}
                  {p.reversed_at && (
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      · {t('promotion.reversedOn', { date: fmtDate(p.reversed_at.slice(0, 10)) })}
                    </span>
                  )}
                </td>
                <td className={tdNum}>
                  {t('member.requirementsOf', { earned: p.matalib.length, total: p.old_total_requirements })}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {m.visits?.length > 0 && (
        <>
          <H2 aside={m.visits.length}>{t('session.familyVisits')}</H2>
          <Table head={[t('common.date'), t('session.sessionTitle'), t('session.visitParticipants')]}>
            {m.visits.map((v) => (
              <tr key={v.session_id}>
                <td className={cn(tdNum, 'w-24 text-muted-foreground')}>{fmtDate(v.date)}</td>
                <td className={cn(td, 'font-medium')}>{v.title}</td>
                <td className={cn(td, 'text-muted-foreground')}>{v.leaders || '—'}</td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {/* الاشتراكات المدفوعة تراكميًّا — تُطبع لمن يرى المبالغ وحده */}
      {m.subscriptions?.count > 0 && (
        <>
          <H2 aside={t('member.subscriptionsCount', { count: m.subscriptions.count })}>
            {t('member.subscriptions')}
          </H2>
          <Table
            head={[
              t('common.date'),
              t('session.sessionTitle'),
              { label: t('member.amount'), className: 'text-end' },
            ]}
          >
            {m.subscriptions.history.map((r) => (
              <tr key={r.session_id}>
                <td className={cn(tdNum, 'w-24 text-muted-foreground')}>{fmtDate(r.date)}</td>
                <td className={cn(td, 'font-medium')}>{r.title}</td>
                <td className={cn(tdNum, 'w-28 text-end font-medium')}>{fmtAmount(r.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-muted-foreground">
              <td className={cn(td, 'font-bold')} colSpan={2}>
                {t('member.subscriptionsTotal')}
              </td>
              <td className={cn(tdNum, 'text-end font-bold text-success')}>
                {fmtAmount(m.subscriptions.total)}
              </td>
            </tr>
          </Table>
        </>
      )}

      <H2
        aside={
          stats.total > 0 ? t('member.sessionsAttended', { present: stats.present, total: stats.total }) : null
        }
      >
        {t('member.attendanceHistory')}
      </H2>
      {stats.history.length === 0 ? (
        <p className="text-muted-foreground">{t('member.noAttendance')}</p>
      ) : (
        <AttendanceRows history={stats.history} />
      )}

      {(m.former_attendance || [])
        .filter((f) => f.total > 0)
        .map((f) => (
          <div key={`${f.branch_id}-${f.until}`}>
            <H2
              aside={`${t('member.sessionsAttended', { present: f.present, total: f.total })}${
                f.rate !== null ? ` · ${f.rate}%` : ''
              }`}
            >
              {t('member.formerAttendance', {
                branch: branchName({ name_fr: f.branch_name_fr, name_ar: f.branch_name_ar }, lng),
              })}{' '}
              · {t('member.formerUntil', { date: fmtDate(f.until) })}
            </H2>
            <AttendanceRows history={f.history} />
          </div>
        ))}
    </Sheet>
  );
}

/* ============================================================
   بطاقة القائد
   ============================================================ */

function LeaderReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const res = useFetch(`/leaders/${id}`);
  const l = res.data;
  useEffect(() => {
    if (l) onReady(memberName(l));
  }, [l, onReady]);

  if (res.loading) return <SkeletonPage rows={6} />;
  if (res.error || !l) return <LoadError onRetry={res.reload} />;

  const card = l.card || { year: '', total: 0, done_count: 0, items: [] };
  const byYear = [];
  for (const a of l.assignments || []) {
    const g = byYear.find((x) => x.year === a.year);
    if (g) g.roles.push(a);
    else byYear.push({ year: a.year, roles: [a] });
  }
  const roleLabel = (r) => `${r.title}${r.branch_id ? ` · ${branchName(r, lng)}` : ''}`;
  const sessions = l.sessions || [];
  const present = l.attendance?.present ?? 0;
  const absent = l.attendance?.absent ?? 0;

  return (
    <Sheet kindLabel={kindLabel}>
      <PersonHeader person={l}>
        <Tags>
          <Tag tone={l.status === 'active' ? 'success' : 'neutral'}>
            {t(l.status === 'active' ? 'member.active' : 'member.inactive')}
          </Tag>
          {l.current_roles?.length ? (
            l.current_roles.map((r) => (
              <Tag key={r.id} tone={r.role_type === 'branch' ? 'default' : 'warning'}>
                {r.title}
              </Tag>
            ))
          ) : (
            <Tag tone="neutral">{t('leader.noRole')}</Tag>
          )}
          {l.year && <Tag tone="neutral">{l.year}</Tag>}
        </Tags>
      </PersonHeader>

      <H2>{t('leader.profile')}</H2>
      <Facts
        items={[
          [t('leader.phone'), fmtPhone(l.phone), true],
          [t('member.birthDate'), fmtDate(l.birth_date), true],
          [
            t('leader.maritalStatus'),
            l.marital_status ? t(l.marital_status === 'married' ? 'leader.married' : 'leader.single') : null,
          ],
          [t('member.addressAbidjan'), l.address_abidjan],
          [t('member.addressLebanon'), l.address_lebanon],
          [t('leader.joinYear'), l.join_year, true],
          [t('leader.yearsGhadir'), l.years_ghadir ?? null, true],
          [t('leader.yearsTotal'), l.years_total ?? null, true],
          [
            t('leader.trainingLevel'),
            l.training_level?.length ? l.training_level.map((c) => t(`leader.course_${c}`)).join(' · ') : null,
          ],
          [t('leader.education'), l.education],
        ]}
      />

      <H2>{t('print.summary')}</H2>
      <Stats
        items={[
          { value: sessions.length, label: t('leader.sessionsLed'), cls: 'text-primary' },
          { value: present, label: t('leader.timesPresent'), cls: 'text-success' },
          { value: absent, label: t('leader.timesAbsent'), cls: 'text-destructive' },
          { value: pct(present, present + absent), label: t('print.rate') },
        ]}
      />

      <H2 aside={card.total > 0 ? t('leader.cardProgress', { done: card.done_count, total: card.total }) : null}>
        {t('leader.card')}
        {/* Isolated, or after Arabic words the year range prints backwards (2026-2025) */}
        {card.year && (
          <>
            {' · '}
            <span dir="ltr">{card.year}</span>
          </>
        )}
      </H2>
      {card.total === 0 ? (
        <p className="text-muted-foreground">{t('leader.cardEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {card.items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-1.5">
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold',
                  item.done
                    ? 'border-success bg-success text-success-foreground'
                    : 'border-border bg-muted text-transparent'
                )}
              >
                <Mark kind="check" className="h-3.5 w-3.5" />
              </span>
              <span className="w-6 shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {item.number}
              </span>
              <span className={cn('flex-1', item.done && 'font-medium')}>{item.label}</span>
              {item.achieved_at && (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {fmtDate(item.achieved_at)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {byYear.length > 0 && (
        <>
          <H2>{t('leader.rolesHistory')}</H2>
          <Table head={[t('leader.year'), t('leader.role')]}>
            {byYear.map((g) => (
              <tr key={g.year}>
                {/* The island inside the cell: on the cell itself it turned the column
                    left-aligned in Arabic, the year running into the role */}
                <td className={cn(tdNum, 'w-24 font-semibold')}>
                  <span dir="ltr">{g.year}</span>
                </td>
                <td className={td}>{g.roles.map(roleLabel).join(' · ')}</td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {l.prep_cards?.length > 0 && (
        <>
          <H2 aside={l.prep_cards.length}>{t('prep.leaderSection')}</H2>
          <Table head={[t('common.date'), t('session.sessionTitle'), t('member.branch')]}>
            {l.prep_cards.map((c) => (
              <tr key={c.id}>
                <td className={cn(tdNum, 'w-24 text-muted-foreground')}>{fmtDate(c.date)}</td>
                <td className={cn(td, 'font-medium')}>{c.title}</td>
                <td className={td}>{branchName(c, lng)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {l.visits?.length > 0 && (
        <>
          <H2 aside={l.visits.length}>{t('session.familyVisits')}</H2>
          <Table
            head={[t('common.date'), t('session.sessionTitle'), t('session.role'), t('session.visitedMembers')]}
          >
            {l.visits.map((v) => (
              <tr key={v.id}>
                <td className={cn(tdNum, 'w-24 text-muted-foreground')}>{fmtDate(v.date)}</td>
                <td className={cn(td, 'font-medium')}>
                  {v.title}
                  <span className="text-muted-foreground"> · {branchName(v, lng)}</span>
                </td>
                <td className={td}>{t(v.role === 'main' ? 'session.mainAnimator' : 'session.helper')}</td>
                <td className={cn(td, 'text-muted-foreground')}>
                  {v.members?.length ? v.members.map(memberName).join(' · ') : '—'}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      <H2 aside={sessions.length}>{t('leader.activitiesLed')}</H2>
      {sessions.length === 0 ? (
        <p className="text-muted-foreground">{t('leader.noActivities')}</p>
      ) : (
        <Table
          head={[
            t('common.date'),
            t('session.sessionTitle'),
            t('member.branch'),
            t('session.role'),
            t('session.myPresence'),
            // How many were there, not a status
            { label: t('print.presentCount'), className: 'text-end' },
          ]}
        >
          {sessions.map((s) => (
            <tr key={s.id}>
              <td className={cn(tdNum, 'w-24 text-muted-foreground')}>{fmtDate(s.date)}</td>
              <td className={cn(td, 'font-medium')}>{s.title}</td>
              <td className={td}>{s.branch_id ? branchName(s, lng) : t('session.kindLeaders')}</td>
              <td className={td}>{t(s.role === 'main' ? 'session.mainAnimator' : 'session.helper')}</td>
              <td className={td}>{s.my_status ? <Status status={s.my_status} /> : '—'}</td>
              <td className={cn(tdNum, 'text-end')}>{s.present_count}</td>
            </tr>
          ))}
        </Table>
      )}
    </Sheet>
  );
}

/* ============================================================
   تقرير الفرقة
   ============================================================ */

function BranchReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const overview = useFetch('/branches/overview');
  const sessionsRes = useFetch(`/branches/${id}/sessions`);
  // The roster and the plan are extras: an account allowed to read الفرق but not
  // العناصر still gets the rest of the report, without those two sections.
  const membersRes = useFetch(`/members?branch=${encodeURIComponent(id)}`);
  const planRes = useFetch(`/branches/${id}/plan`);
  const b = (overview.data || []).find((x) => String(x.id) === String(id));
  const name = b ? branchName(b, lng) : '';
  useEffect(() => {
    if (b) onReady(name);
  }, [b, name, onReady]);

  if (overview.loading || sessionsRes.loading || membersRes.loading || planRes.loading)
    return <SkeletonPage rows={6} />;
  if (overview.error || sessionsRes.error) return <LoadError onRetry={overview.reload} />;
  if (!b)
    return (
      <div data-print-error="">
        <EmptyState icon={<IconAlert className="h-6 w-6 text-destructive" />} title={t('error.notFoundTitle')} />
      </div>
    );

  const sessions = sessionsRes.data || [];
  const members = membersRes.data || [];
  const plan = planRes.data;
  const today = todayISO();

  // Présence per عنصر, computed from the participant lists the فرقة page already
  // loads: the same rows the عنصر page counts, so both print the same figures.
  const perMember = new Map();
  for (const s of sessions) {
    if (s.kind !== 'activity' || !isCountedSession(s, today)) continue;
    for (const k of ['present', 'absent', 'excused'])
      for (const m of s[k] || []) {
        const st = perMember.get(m.id) || { present: 0, absent: 0, excused: 0 };
        st[k]++;
        perMember.set(m.id, st);
      }
  }
  const active = members.filter((m) => m.status === 'active');
  const inactive = members.filter((m) => m.status !== 'active');
  const leaders = (b.leaders || []).filter((l) => l.leader_id);
  const ages = b.all_ages
    ? t('branch.allAges')
    : b.max_age
      ? `${b.min_age}–${b.max_age} ${t('branch.years')}`
      : `${b.min_age}+`;
  const activities = sessions.filter((s) => s.kind !== 'visit');
  const visits = sessions.filter((s) => s.kind === 'visit');

  return (
    <Sheet kindLabel={kindLabel}>
      <H1>{name}</H1>
      <Tags>
        <Tag tone="neutral">{ages}</Tag>
        {b.year && <Tag tone="neutral">{b.year}</Tag>}
        {b.last_session && (
          <Tag tone="neutral">
            {t('branch.lastSession')} · {fmtDate(b.last_session.date)}
          </Tag>
        )}
      </Tags>

      <H2>{t('print.summary')}</H2>
      <Stats
        items={[
          {
            value: b.members.active,
            label: t('branch.members'),
            hint: t('branch.sexSplit', { male: b.members.male, female: b.members.female }),
          },
          {
            value: b.sessions_count,
            label: t('branch.activities'),
            hint: t('branch.thisMonth', { count: b.sessions_month }),
          },
          {
            value: b.attendance.rate !== null ? `${b.attendance.rate}%` : '—',
            label: t('branch.attendanceRate'),
            hint: t('branch.presentAbsent', { present: b.attendance.present, absent: b.attendance.absent }),
            cls: 'text-primary',
          },
          {
            value: `${b.matalib.covered_count}/${b.matalib.total}`,
            label: t('branch.matalib'),
            hint: t('branch.matalibHint'),
          },
        ]}
      />

      <H2>{t('branch.leaders')}</H2>
      {leaders.length === 0 ? (
        <p className="text-muted-foreground">{t('branch.noLeaders')}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {leaders.map((l) => (
            <li key={l.id} className="flex items-baseline gap-2">
              <span className="font-medium">{memberName(l)}</span>
              <span className="text-[11px] text-muted-foreground">{l.title}</span>
            </li>
          ))}
        </ul>
      )}

      {b.matalib.total > 0 && (
        <>
          <H2
            aside={`${b.matalib.covered_count}/${b.matalib.total} · ${pct(b.matalib.covered_count, b.matalib.total)}`}
          >
            {t('print.matalibCovered')}
          </H2>
          <MatalibGrid total={b.matalib.total} selected={b.matalib.covered} />
        </>
      )}

      {!membersRes.error && (
        <>
          <H2 aside={t('print.membersInGroup', { count: active.length })}>{t('print.activeMembers')}</H2>
          {active.length === 0 ? (
            <p className="text-muted-foreground">{t('member.noMembers')}</p>
          ) : (
            <Table
              head={[
                '#',
                t('member.name'),
                t('member.age'),
                t('member.sex'),
                t('member.group'),
                t('member.joinDate'),
                { label: t('print.presences'), className: 'text-end' },
                { label: t('print.rate'), className: 'text-end' },
              ]}
            >
              {active.map((m, i) => {
                const st = perMember.get(m.id) || { present: 0, absent: 0, excused: 0 };
                const marked = st.present + st.absent + st.excused;
                return (
                  <tr key={m.id}>
                    <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
                    <td className={cn(td, 'font-medium')}>{memberName(m)}</td>
                    <td className={tdNum}>{m.age ?? '—'}</td>
                    <td className={td}>{t(m.sex === 'M' ? 'member.male' : 'member.female')}</td>
                    <td className={cn(td, 'text-muted-foreground')}>{m.group_name || '—'}</td>
                    <td className={cn(tdNum, 'text-muted-foreground')}>{fmtDate(m.join_date) || '—'}</td>
                    <td className={cn(tdNum, 'text-end')}>
                      {st.present}/{marked}
                    </td>
                    <td className={cn(tdNum, 'text-end font-medium')}>{pct(st.present, marked)}</td>
                  </tr>
                );
              })}
            </Table>
          )}
          {inactive.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              <span className="font-medium">
                {t('print.inactiveMembers')} ({inactive.length}) :
              </span>{' '}
              {inactive.map(memberName).join(' · ')}
            </p>
          )}
        </>
      )}

      {plan && plan.total > 0 && (
        <>
          <H2
            aside={`${t('branch.planProgress', { done: plan.done_count, total: plan.total })}${
              plan.rate !== null ? ` · ${plan.rate}%` : ''
            }`}
          >
            {t('branch.planTitle')} · <span dir="ltr">{plan.year}</span>
          </H2>
          <Table head={[t('common.date'), t('branch.planActivity'), t('branch.planState')]}>
            {plan.items.map((item) => (
              <tr key={item.id}>
                <td className={cn(tdNum, 'w-24 text-muted-foreground')}>{fmtDate(item.date)}</td>
                <td className={cn(td, 'font-medium')}>{item.title}</td>
                <td className={td}>
                  {item.session ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-success">
                      <Mark kind="check" />
                      {t('print.planDone', { date: fmtDate(item.session.date) })}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t('branch.planNotDone')}</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      <H2 aside={activities.length}>{t('print.activities')}</H2>
      {activities.length === 0 ? (
        <p className="text-muted-foreground">{t('branch.noParticipants')}</p>
      ) : (
        <Table
          head={[
            t('common.date'),
            t('session.sessionTitle'),
            t('session.leader'),
            t('session.requirementsShort'),
            { label: <Mark kind="check" />, className: 'text-end text-success' },
            { label: <Mark kind="x" />, className: 'text-end text-destructive' },
            { label: <Mark kind="circle" />, className: 'text-end text-warning' },
          ]}
        >
          {activities.map((s) => (
            <tr key={s.id}>
              <td className={cn(tdNum, 'w-24 text-muted-foreground')}>{fmtDate(s.date)}</td>
              <td className={cn(td, 'font-medium')}>{s.title}</td>
              <td className={cn(td, 'text-muted-foreground')}>
                {s.animators?.length ? s.animators.map(memberName).join(' · ') : s.leader || '—'}
              </td>
              <td className={cn(tdNum, 'text-muted-foreground')}>
                {s.matalib?.length ? s.matalib.join(listSep(lng)) : ''}
              </td>
              <td className={cn(tdNum, 'text-end text-success')}>{s.present.length}</td>
              <td className={cn(tdNum, 'text-end text-destructive')}>{s.absent.length}</td>
              <td className={cn(tdNum, 'text-end text-warning')}>{s.excused.length}</td>
            </tr>
          ))}
        </Table>
      )}

      {visits.length > 0 && (
        <>
          <H2 aside={visits.length}>{t('session.familyVisits')}</H2>
          <Table head={[t('common.date'), t('session.sessionTitle'), t('session.visitedMembers')]}>
            {visits.map((s) => (
              <tr key={s.id}>
                <td className={cn(tdNum, 'w-24 text-muted-foreground')}>{fmtDate(s.date)}</td>
                <td className={cn(td, 'font-medium')}>{s.title}</td>
                <td className={cn(td, 'text-muted-foreground')}>
                  {s.present.length ? s.present.map(memberName).join(' · ') : '—'}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      <Signature label={t('print.signatureBranch')} />
    </Sheet>
  );
}

/* ============================================================
   قائمة الترفيعات في الانتظار
   ============================================================ */

/**
 * ليست بطاقة شخص بل قائمة أسماء: من بلغ سنّ الفرقة الأعلى و ينتظر الترفيع.
 * الرقم في الرابط رقم فرقة لا رقم عنصر — 0 يعني كل الفرق، و هو ما يجعل الورقة
 * تحمل نفس ما تعرضه صفحة الترفيع بفلترها.
 */
function PromotionsReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const all = String(id) === '0';
  const pending = useFetch('/promotions/pending');
  const branches = useFetch('/branches');

  const branchList = branches.data || [];
  const b = branchList.find((x) => String(x.id) === String(id));
  const name = all ? t('promotion.allBranches') : b ? branchName(b, lng) : '';
  const known = all || !!b;
  useEffect(() => {
    if (known) onReady(name);
  }, [known, name, onReady]);

  if (pending.loading || branches.loading) return <SkeletonPage rows={6} />;
  if (pending.error || branches.error) return <LoadError onRetry={pending.reload} />;
  if (!known)
    return (
      <div data-print-error="">
        <EmptyState icon={<IconAlert className="h-6 w-6 text-destructive" />} title={t('error.notFoundTitle')} />
      </div>
    );

  // ترتيب الورقة ترتيب الفوج: الفرق بحسب موقعها، ثم الأسماء داخل كل فرقة
  const rank = new Map(branchList.map((x, i) => [String(x.id), i]));
  const list = (pending.data || [])
    .filter((p) => all || String(p.current_branch.id) === String(id))
    .sort(
      (x, y) =>
        (rank.get(String(x.current_branch.id)) ?? 0) - (rank.get(String(y.current_branch.id)) ?? 0) ||
        memberName(x).localeCompare(memberName(y), lng)
    );

  // عمود «الفرقة الحالية» لا معنى له حين تكون الورقة لفرقة واحدة
  const head = [
    { label: '#', className: 'w-8' },
    t('promotion.member'),
    { label: t('member.age'), className: 'w-14' },
    ...(all ? [t('promotion.oldBranch')] : []),
    t('promotion.newBranch'),
    { label: t('session.requirementsShort'), className: 'w-28' },
  ];

  return (
    <Sheet kindLabel={kindLabel}>
      <H1>{name}</H1>
      <Tags>
        <Tag tone="neutral">{t('promotion.pendingCount', { count: list.length })}</Tag>
        <Tag tone="neutral">{fmtDate(todayISO())}</Tag>
      </Tags>

      <H2>{t('promotion.pending')}</H2>
      {list.length === 0 ? (
        <p className="text-muted-foreground">{t('promotion.noPending')}</p>
      ) : (
        <Table head={head}>
          {list.map((p, i) => (
            <tr key={p.id}>
              <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
              <td className={cn(td, 'font-medium')}>{memberName(p)}</td>
              <td className={tdNum}>{p.age}</td>
              {all && (
                <td className={cn(td, 'text-muted-foreground')}>{branchName(p.current_branch, lng)}</td>
              )}
              <td className={cn(td, 'font-medium')}>{branchName(p.target_branch, lng)}</td>
              <td className={cn(tdNum, !p.ready && 'font-semibold')}>
                {p.total ? `${p.earned_count}/${p.total} · ${p.pct}%` : ''}
                {p.total && !p.ready ? ` (${t('matalib.below')})` : ''}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Signature label={t('print.signatureLeader')} />
    </Sheet>
  );
}

/* ============================================================
   Lists, annual plan, prep cards
   ============================================================ */

const SESSION_KIND_KEYS = {
  activity: 'session.kindActivity',
  visit: 'session.kindVisit',
  leaders: 'session.kindLeaders',
  group: 'session.kindGroup',
};

function NotFound() {
  const { t } = useTranslation();
  return (
    <div data-print-error="">
      <EmptyState icon={<IconAlert className="h-6 w-6 text-destructive" />} title={t('error.notFoundTitle')} />
    </div>
  );
}

function ListSheet({ kindLabel, title, count, head, rows, empty, signature = true }) {
  const { t } = useTranslation();
  return (
    <Sheet kindLabel={kindLabel}>
      <H1>{title}</H1>
      <Tags>
        <Tag tone="neutral">{count}</Tag>
        <Tag tone="neutral">{fmtDate(todayISO())}</Tag>
      </Tags>
      {/* The count is said once, with its noun, in the tag above — not again as a bare
          figure at the end of the heading */}
      <H2>{kindLabel}</H2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{empty}</p>
      ) : (
        <Table head={head}>{rows}</Table>
      )}
      {signature && <Signature label={t('print.signatureLeader')} />}
    </Sheet>
  );
}

/** The فرقة a list sheet is about: id 0 means all of them. */
function useListBranch(id, onReady) {
  const { t, i18n } = useTranslation();
  const all = String(id) === '0';
  const branches = useFetch('/branches');
  const b = (branches.data || []).find((x) => String(x.id) === String(id));
  const name = all ? t('member.allBranches') : b ? branchName(b, i18n.language) : '';
  const known = all || !!b;
  useEffect(() => {
    if (known) onReady(name);
  }, [known, name, onReady]);
  return { all, name, known, branches };
}

/**
 * رقم ولي الأمر في القائمة: الأب أولًا، و الأم إن غاب — و أوّل رقم من خانة تحمل
 * رقمين. من لا يملك members.contact وصلته الخانتان فارغتين، فالشرطة هي الصحيح.
 */
function parentPhone(m) {
  const father = phoneNumbers(m.father_phone)[0];
  if (father) return { number: father, mother: false };
  const mother = phoneNumbers(m.mother_phone)[0];
  return mother ? { number: mother, mother: true } : null;
}

function MembersListReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [sp] = useSearchParams();
  const { all, name, known, branches } = useListBranch(id, onReady);
  const qs = new URLSearchParams(sp);
  if (!all) qs.set('branch', id);
  const res = useFetch(`/members?${qs}`);

  if (res.loading || branches.loading) return <SkeletonPage rows={6} />;
  if (res.error || branches.error) return <LoadError onRetry={res.reload} />;
  if (!known) return <NotFound />;

  const list = res.data || [];
  return (
    <ListSheet
      kindLabel={kindLabel}
      title={name}
      count={t('member.subtitle', { count: list.length })}
      empty={t('member.noMembers')}
      head={[
        { label: '#', className: 'w-8' },
        t('member.name'),
        { label: t('member.age'), className: 'w-12' },
        ...(all ? [t('member.branch')] : []),
        t('member.group'),
        t('member.parentPhone'),
        t('member.status'),
      ]}
      rows={list.map((m, i) => {
        const phone = parentPhone(m);
        return (
          <tr key={m.id}>
            <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
            <td className={cn(td, 'font-medium')}>{memberName(m)}</td>
            <td className={tdNum}>{m.age ?? '—'}</td>
            {all && <td className={td}>{branchName(m, lng)}</td>}
            <td className={cn(td, 'text-muted-foreground')}>{m.group_name || '—'}</td>
            <td className={cn(tdNum, 'text-muted-foreground')}>
              {phone ? (
                <>
                  {/* LTR island: in an Arabic sheet the digit pairs would print reversed */}
                  <span dir="ltr">{fmtPhone(phone.number)}</span>
                  {phone.mother && <span className="text-[11px]"> ({t('member.motherShort')})</span>}
                </>
              ) : (
                '—'
              )}
            </td>
            <td className={td}>{t(m.status === 'active' ? 'member.active' : 'member.inactive')}</td>
          </tr>
        );
      })}
    />
  );
}

function LeadersListReport({ onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [sp] = useSearchParams();
  const res = useFetch('/leaders');
  const title = t('leader.leadersList');
  useEffect(() => {
    onReady(title);
  }, [title, onReady]);

  if (res.loading) return <SkeletonPage rows={6} />;
  if (res.error) return <LoadError onRetry={res.reload} />;

  // The page's filters came along in the query: the sheet keeps the same قادة
  const list = filterLeaders(res.data || [], Object.fromEntries(LEADER_FILTER_KEYS.map((k) => [k, sp.get(k) || ''])));
  return (
    <ListSheet
      kindLabel={kindLabel}
      title={title}
      count={t('leader.totalShort', { count: list.length })}
      empty={t('leader.noLeaders')}
      head={[{ label: '#', className: 'w-8' }, t('member.name'), t('leader.role'), t('leader.phone')]}
      rows={list.map((l, i) => (
        <tr key={l.id}>
          <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
          <td className={cn(td, 'font-medium')}>{memberName(l)}</td>
          <td className={td}>
            {(l.roles || []).length
              ? l.roles
                  .map((r) => [r.title, r.branch_id ? branchName(r, lng) : null].filter(Boolean).join(' · '))
                  .join(' / ')
              : '—'}
          </td>
          <td className={cn(tdNum, 'text-muted-foreground')}>
            {/* LTR island: in an Arabic sheet the digit pairs printed reversed — a wrong
                number. A cell holding two numbers gets both, each in pairs. */}
            {phoneNumbers(l.phone).length ? (
              <span dir="ltr">{phoneNumbers(l.phone).map((n) => fmtPhone(n)).join(' / ')}</span>
            ) : (
              '—'
            )}
          </td>
        </tr>
      ))}
    />
  );
}

function SessionsListReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [sp] = useSearchParams();
  const { all, name, known, branches } = useListBranch(id, onReady);
  const qs = new URLSearchParams(sp);
  if (!all) qs.set('branch', id);
  const res = useFetch(`/sessions?${qs}`);

  if (res.loading || branches.loading) return <SkeletonPage rows={6} />;
  if (res.error || branches.error) return <LoadError onRetry={res.reload} />;
  if (!known) return <NotFound />;

  const list = res.data || [];
  return (
    <ListSheet
      kindLabel={kindLabel}
      title={name}
      count={t('session.monthCount', { count: list.length })}
      empty={t('session.noSessions')}
      signature={false}
      head={[
        { label: '#', className: 'w-8' },
        t('common.date'),
        t('session.sessionTitle'),
        t('session.kind'),
        t('member.branch'),
        { label: t('print.presences'), className: 'text-end' },
      ]}
      rows={list.map((s, i) => (
        <tr key={s.id}>
          <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
          <td className={tdNum}>{fmtDate(s.date)}</td>
          <td className={cn(td, 'font-medium')}>{s.title}</td>
          <td className={td}>{t(SESSION_KIND_KEYS[s.kind] || SESSION_KIND_KEYS.activity)}</td>
          <td className={cn(td, 'text-muted-foreground')}>
            {s.kind === 'leaders' || s.kind === 'group' ? '—' : branchName(s, lng)}
          </td>
          <td className={cn(tdNum, 'text-end')}>{s.present_count ?? 0}</td>
        </tr>
      ))}
    />
  );
}

function PrepListReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [sp] = useSearchParams();
  const qs = new URLSearchParams(sp);
  if (String(id) !== '0') qs.set('branch', id);
  const res = useFetch(`/prep-cards?${qs}`);
  const title = t('prep.title');
  useEffect(() => {
    onReady(title);
  }, [title, onReady]);

  if (res.loading) return <SkeletonPage rows={6} />;
  if (res.error) return <LoadError onRetry={res.reload} />;

  const list = res.data || [];
  return (
    <ListSheet
      kindLabel={kindLabel}
      title={title}
      count={t('prep.resultCount', { count: list.length })}
      empty={t('prep.noCards')}
      signature={false}
      head={[
        { label: '#', className: 'w-8' },
        t('common.date'),
        t('session.sessionTitle'),
        t('member.branch'),
        t('prep.author'),
      ]}
      rows={list.map((c, i) => (
        <tr key={c.id}>
          <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
          <td className={tdNum}>{fmtDate(c.date)}</td>
          <td className={cn(td, 'font-medium')}>{c.title}</td>
          <td className={td}>{branchName(c, lng)}</td>
          <td className={cn(td, 'text-muted-foreground')}>{c.leader || '—'}</td>
        </tr>
      ))}
    />
  );
}

function PlanReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [sp] = useSearchParams();
  const year = sp.get('year');
  const res = useFetch(`/branches/${id}/plan${year ? `?year=${encodeURIComponent(year)}` : ''}`);
  const branches = useFetch('/branches');
  const b = (branches.data || []).find((x) => String(x.id) === String(id));
  const plan = res.data;
  const title = b && plan ? `${branchName(b, lng)} — ${plan.year}` : '';
  useEffect(() => {
    if (title) onReady(title);
  }, [title, onReady]);

  if (res.loading || branches.loading) return <SkeletonPage rows={6} />;
  if (!b || !plan) return res.error && res.errorStatus !== 404 ? <LoadError onRetry={res.reload} /> : <NotFound />;

  return (
    <ListSheet
      kindLabel={kindLabel}
      // The year isolated on the sheet (after an Arabic name it would print backwards);
      // the plain string still names the file
      title={
        <>
          {branchName(b, lng)} — <span dir="ltr">{plan.year}</span>
        </>
      }
      count={`${plan.done_count}/${plan.total}${plan.rate !== null ? ` · ${plan.rate}%` : ''}${
        plan.validation ? ` · ${t('branch.planRespect')} ${plan.summary.respect ?? 0}%` : ` · ${t('branch.planDraftShort')}`
      }`}
      empty={t('branch.planFree')}
      head={[
        { label: '#', className: 'w-8' },
        t('common.date'),
        t('session.sessionTitle'),
        t('print.planStatus'),
      ]}
      rows={[
        ...plan.items.map((item) => ({ item, date: item.date })),
        // بنود معتمدة حُذفت بعد الاعتماد: تُطبع في يومها، مشطوبة
        ...(plan.removed || []).map((base) => ({ base, date: base.date })),
      ]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(({ item, base }) =>
          item ? (
            <tr key={item.id}>
              <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{plan.items.indexOf(item) + 1}</td>
              <td className={tdNum}>{fmtDate(item.date)}</td>
              <td className={cn(td, 'font-medium')}>
                {item.title}
                {item.changed && (
                  <div className="text-[11px] font-normal text-muted-foreground">
                    {t('branch.planWas')} {item.base.title}
                    {item.base.date !== item.date && ` · ${fmtDate(item.base.date)}`}
                  </div>
                )}
                {plan.validation && !item.base && (
                  <div className="text-[11px] font-normal text-muted-foreground">{t('branch.planAdded')}</div>
                )}
              </td>
              {/* Done reads as on the فرقة report: a check in green, so it holds in black and white */}
              <td className={td}>
                {item.session ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-success">
                    <Mark kind="check" />
                    {t('print.planDone', { date: fmtDate(item.session.date) })}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t('branch.planNotDone')}</span>
                )}
              </td>
            </tr>
          ) : (
            <tr key={`removed-${base.id}`}>
              <td className={cn(tdNum, 'w-8')} />
              <td className={cn(tdNum, 'text-muted-foreground')}>{fmtDate(base.date)}</td>
              <td className={cn(td, 'text-muted-foreground line-through')}>{base.title}</td>
              <td className={cn(td, 'text-muted-foreground')}>{t('branch.planRemoved')}</td>
            </tr>
          )
        )}
    />
  );
}

function PrepReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const res = useFetch(`/prep-cards/${id}`);
  const c = res.data;
  useEffect(() => {
    if (c) onReady(c.title);
  }, [c, onReady]);

  if (res.loading) return <SkeletonPage rows={6} />;
  if (res.error || !c) return <LoadError onRetry={res.reload} />;

  const texts = [
    ['prep.goals', c.goals],
    ['prep.segments', c.segments],
    ['prep.tools', c.tools],
    ['prep.notes', c.notes],
  ].filter(([, v]) => v && String(v).trim());

  return (
    <Sheet kindLabel={kindLabel}>
      <H1>{c.title}</H1>
      <Tags>
        <Tag>{branchName(c, lng)}</Tag>
        <Tag tone="neutral">{fmtDate(c.date)}</Tag>
        {c.start_time && <Tag tone="neutral">{fmtTime(c.start_time)}</Tag>}
        {c.place && <Tag tone="neutral">{c.place}</Tag>}
      </Tags>
      <div className="mt-4">
        <Facts
          items={[
            [t('prep.author'), c.leader || '—'],
            [t('prep.matalib'), (c.matalib || []).join(listSep(lng)) || null],
          ]}
        />
      </div>
      {texts.map(([key, v]) => (
        <div key={key}>
          <H2>{t(key)}</H2>
          <p className="whitespace-pre-line leading-relaxed">{v}</p>
        </div>
      ))}
    </Sheet>
  );
}

/* ============================================================
   الاجتماعات
   ============================================================ */

// The attendance of the minutes, group by group, in the order they are read out
const MEETING_GROUPS = [
  { key: 'present', label: 'meeting.groupPresent' },
  { key: 'excused', label: 'meeting.groupExcused' },
  { key: 'absent', label: 'meeting.groupAbsent' },
  { key: 'guests', label: 'meeting.groupGuests' },
];

/** Where a decision stands, in words and a mark — late in red while it is still to do */
function DecisionState({ d, today }) {
  const { t } = useTranslation();
  if (d.status === 'done')
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-success">
        <Mark kind="check" />
        {d.status_at ? t('meeting.doneOn', { date: fmtDate(d.status_at) }) : t('meeting.status_done')}
      </span>
    );
  if (d.status === 'dropped')
    return <span className="whitespace-nowrap text-muted-foreground">{t('meeting.status_dropped')}</span>;
  return isOverdue(d, today) ? (
    <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-destructive">
      <Mark kind="x" />
      {t('meeting.overdue')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground">
      <Mark kind="circle" />
      {t('meeting.status_open')}
    </span>
  );
}

/** Two signature lines side by side: who chaired, who wrote it up */
function Signatures({ labels }) {
  return (
    <div className="avoid-break mt-8 grid grid-cols-2 gap-8">
      {labels.map((label) => (
        <div key={label}>
          <div className="h-12 border-b border-muted-foreground" />
          <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * محضر الاجتماع, in the association's order: the heading (subject, why, when, where,
 * who chaired, who wrote it), the attendance, the follow-up of what earlier meetings
 * decided, each point of the agenda with what was said, the decisions with whom they
 * fall to and by when, the recommendations, the next meeting — then both signatures.
 */
function MeetingReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const res = useFetch(`/meetings/${id}`);
  const m = res.data;
  // The file is named after it: the ISO day keeps a folder of minutes in date order
  useEffect(() => {
    if (m) onReady(`${m.title} — ${m.date}`);
  }, [m, onReady]);

  if (res.loading) return <SkeletonPage rows={6} />;
  if (res.error || !m) return <LoadError onRetry={res.reload} />;

  const today = todayISO();
  const groups = attendeesByStatus(m.attendees);
  const counts = attendanceCounts(m.attendees);
  const dc = decisionCounts(m.decisions, today);
  const sep = lng === 'ar' ? '، ' : ', ';
  const decisionHead = [
    { label: '#', className: 'w-8' },
    t('meeting.decisionText'),
    t('meeting.owner'),
    t('meeting.dueDate'),
    t('meeting.status'),
  ];
  const decisionRows = (list, from) =>
    list.map((d, i) => (
      <tr key={d.id} className="avoid-break">
        <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
        <td className={cn(td, 'font-medium', d.status === 'dropped' && 'text-muted-foreground line-through')}>
          <bdi>{userText(d.text)}</bdi>
          {from && (
            <div className="text-[11px] font-normal text-muted-foreground">
              {t('meeting.fromMeeting', { date: fmtDate(d.meeting_date), title: d.meeting_title })}
            </div>
          )}
        </td>
        <td className={cn(td, 'sm:whitespace-nowrap')}>{d.owner || '—'}</td>
        <td className={tdNum}>{d.due_date ? fmtDate(d.due_date) : '—'}</td>
        <td className={td}>
          <DecisionState d={d} today={today} />
        </td>
      </tr>
    ));

  return (
    <Sheet kindLabel={kindLabel}>
      <H1>
        <bdi>{userText(m.title)}</bdi>
      </H1>
      {m.purpose && (
        <p dir="auto" className="mt-1.5 whitespace-pre-line text-start leading-relaxed text-muted-foreground">
          {userText(m.purpose)}
        </p>
      )}
      <Tags>
        <Tag>{t(`meeting.kind_${m.kind}`)}</Tag>
        <Tag tone="neutral">{meetingScope(m, lng, t)}</Tag>
      </Tags>
      <div className="mt-4">
        <Facts
          items={[
            [t('common.date'), fmtLongDate(m.date, lng)],
            // No ltr island, as on the page: in Arabic the start reads first, on the right
            [t('session.time'), timeRange(m)],
            [t('session.place'), m.place],
            [gendered(t, 'meeting.chair', m.section), m.chair],
            [gendered(t, 'meeting.secretary', m.section), m.secretary],
          ]}
        />
      </div>

      <H2 aside={m.attendees.length ? attendanceLine(counts, t, m.section).join(' · ') : null}>
        {t('meeting.attendance')}
      </H2>
      {m.attendees.length === 0 ? (
        <p className="text-muted-foreground">{t('meeting.attendanceEmpty')}</p>
      ) : (
        <dl className="space-y-1.5">
          {MEETING_GROUPS.filter((g) => groups[g.key].length > 0).map((g) => (
            <div key={g.key} className="avoid-break grid grid-cols-[8rem_minmax(0,1fr)] gap-3">
              <dt className="text-[11px] font-semibold text-muted-foreground">
                {gendered(t, g.label, m.section)} <span className="tabular-nums">({groups[g.key].length})</span>
              </dt>
              <dd>{groups[g.key].map((a) => a.name).join(sep)}</dd>
            </div>
          ))}
        </dl>
      )}

      {m.followups.length > 0 && (
        <>
          <H2 aside={t('meeting.followupsLeft', { count: m.followups.filter((d) => d.status === 'open').length })}>
            {t('meeting.followups')}
          </H2>
          <Table head={decisionHead}>{decisionRows(m.followups, true)}</Table>
        </>
      )}

      <H2 aside={m.items.length || null}>{t('meeting.agenda')}</H2>
      {m.items.length === 0 ? (
        <p className="text-muted-foreground">{t('meeting.agendaEmpty')}</p>
      ) : (
        <ol className="space-y-3">
          {m.items.map((it, i) => (
            <li key={it.id} className="avoid-break">
              <p className="font-semibold">
                <span className="tabular-nums text-primary">{i + 1}.</span> <bdi>{userText(it.title)}</bdi>
              </p>
              {it.discussion ? (
                <p dir="auto" className="mt-0.5 whitespace-pre-line text-start leading-relaxed">
                  {userText(it.discussion)}
                </p>
              ) : (
                <p className="mt-0.5 text-muted-foreground">{t('meeting.noDiscussion')}</p>
              )}
            </li>
          ))}
        </ol>
      )}

      <H2
        aside={
          dc.total
            ? [
                t('meeting.decisionCount', { count: dc.total }),
                dc.overdue > 0 && t('meeting.overdueCount', { count: dc.overdue }),
              ]
                .filter(Boolean)
                .join(' · ')
            : null
        }
      >
        {t('meeting.decisions')}
      </H2>
      {m.decisions.length === 0 ? (
        <p className="text-muted-foreground">{t('meeting.decisionsEmpty')}</p>
      ) : (
        <Table head={decisionHead}>{decisionRows(m.decisions, false)}</Table>
      )}

      {m.notes && (
        <>
          <H2>{t('meeting.notes')}</H2>
          <p dir="auto" className="whitespace-pre-line text-start leading-relaxed">
            {userText(m.notes)}
          </p>
        </>
      )}
      {/* The closing of the minutes stays in one piece: the signatures never start a
          page on their own */}
      <div className="avoid-break">
        {m.next_date && (
          <p className="mt-5">
            <span className="text-muted-foreground">{t('meeting.nextDate')}</span>{' '}
            <span className="font-semibold">{fmtLongDate(m.next_date, lng)}</span>
          </p>
        )}
        <Signatures
          labels={[gendered(t, 'meeting.signChair', m.section), gendered(t, 'meeting.signSecretary', m.section)]}
        />
      </div>
    </Sheet>
  );
}

function MeetingsListReport({ onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [sp] = useSearchParams();
  const res = useFetch(`/meetings?${sp}`);
  const title = t('meeting.title');
  useEffect(() => {
    onReady(title);
  }, [title, onReady]);

  if (res.loading) return <SkeletonPage rows={6} />;
  if (res.error) return <LoadError onRetry={res.reload} />;

  const list = res.data || [];
  return (
    <ListSheet
      kindLabel={kindLabel}
      title={title}
      count={t('meeting.resultCount', { count: list.length })}
      empty={t('meeting.empty')}
      signature={false}
      head={[
        { label: '#', className: 'w-8' },
        t('common.date'),
        t('meeting.subject'),
        t('meeting.scope'),
        t('meeting.chair'),
        t('meeting.attendance'),
        t('meeting.decisions'),
      ]}
      rows={list.map((m, i) => (
        <tr key={m.id}>
          <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
          <td className={tdNum}>{fmtDate(m.date)}</td>
          <td className={cn(td, 'font-medium')}>
            <bdi>{userText(m.title)}</bdi>
            <div className="text-[11px] font-normal text-muted-foreground">{t(`meeting.kind_${m.kind}`)}</div>
          </td>
          <td className={td}>{meetingScope(m, lng, t)}</td>
          <td className={cn(td, 'text-muted-foreground')}>{m.chair || '—'}</td>
          <td className={tdNum}>
            {m.present_count + m.absent_count + m.excused_count + m.guest_count
              ? gendered(t, 'meeting.presentCount', m.section, { count: m.present_count })
              : '—'}
          </td>
          <td className={tdNum}>
            {m.decision_count ? t('meeting.decisionCount', { count: m.decision_count }) : '—'}
            {m.overdue_count > 0 && (
              <div className="text-[11px] font-semibold text-destructive">
                {t('meeting.overdueCount', { count: m.overdue_count })}
              </div>
            )}
          </td>
        </tr>
      ))}
    />
  );
}

function MeetingDecisionsReport({ onReady, kindLabel }) {
  const { t } = useTranslation();
  const [sp] = useSearchParams();
  const status = ['open', 'done'].includes(sp.get('status')) ? sp.get('status') : 'all';
  const res = useFetch(`/meeting-decisions?${sp}`);
  const title = t(`meeting.listTitle_${status}`);
  useEffect(() => {
    onReady(title);
  }, [title, onReady]);

  if (res.loading) return <SkeletonPage rows={6} />;
  if (res.error) return <LoadError onRetry={res.reload} />;

  const today = todayISO();
  const list = res.data || [];
  return (
    <ListSheet
      kindLabel={kindLabel}
      title={title}
      count={t('meeting.decisionCount', { count: list.length })}
      empty={t(`meeting.noDecisions_${status}`)}
      signature={false}
      // The columns of the minutes' own follow-up table, the meeting under each decision:
      // a column of its own left every cell too narrow — names and titles broke anywhere
      head={[
        { label: '#', className: 'w-8' },
        t('meeting.decisionText'),
        t('meeting.owner'),
        t('meeting.dueDate'),
        t('meeting.status'),
      ]}
      rows={list.map((d, i) => (
        <tr key={d.id} className="avoid-break">
          <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
          <td className={cn(td, 'font-medium', d.status === 'dropped' && 'text-muted-foreground')}>
            <bdi className={d.status === 'dropped' ? 'line-through' : undefined}>{userText(d.text)}</bdi>
            <div className="text-[11px] font-normal text-muted-foreground">
              {t('meeting.fromMeeting', { date: fmtDate(d.meeting_date), title: userText(d.meeting_title) })}
            </div>
          </td>
          {/* A name kept whole on paper; the phone preview, narrower, may wrap it */}
          <td className={cn(td, 'sm:whitespace-nowrap')}>{d.owner || '—'}</td>
          <td className={tdNum}>{d.due_date ? fmtDate(d.due_date) : '—'}</td>
          <td className={td}>
            <DecisionState d={d} today={today} />
          </td>
        </tr>
      ))}
    />
  );
}

/* ============================================================
   الصناديق و مالية الفرقة
   ============================================================ */

// A deficit carries its sign, as on the page — isolated left-to-right, or an Arabic
// sheet prints the «−» after the figure
const moneyText = (n) => (n < 0 ? `−${fmtAmount(-n)}` : fmtAmount(n));
const money = (n) => <span dir="ltr">{moneyText(n)}</span>;

/** Where a total comes from or went, largest first: a label and its amount per line */
function MoneyBreakdown({ items }) {
  return (
    <dl className="avoid-break space-y-1">
      {items.map((i) => (
        <div key={i.key} className="flex items-baseline justify-between gap-3 border-b border-dotted border-border pb-1">
          <dt className="min-w-0 text-muted-foreground">{i.label}</dt>
          <dd className="shrink-0 font-medium tabular-nums">{fmtAmount(i.amount)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A line's facts under its title, each kept whole */
function MoneyMeta({ items }) {
  if (!items.length) return null;
  return <div className="text-[11px] leading-snug text-muted-foreground">{items.join(' · ')}</div>;
}

/** A movement's amount: «+» in green for what came in, «−» for what went out, neither for a move */
function Signed({ value, direction, muted, className }) {
  return (
    <span
      dir="ltr"
      className={cn(
        'font-semibold tabular-nums',
        direction === 'in' && !muted && 'text-success',
        muted && 'text-muted-foreground',
        className
      )}
    >
      {direction === 'in' ? '+' : direction === 'out' ? '−' : ''}
      {fmtAmount(value)}
    </span>
  );
}

/** A month's heading inside a money table: its name, what came in and what went out */
function MonthRow({ month, lng, cols }) {
  return (
    <tr className="bg-muted/60">
      <td colSpan={cols - 1} className={cn(td, 'ps-2 font-semibold')}>
        {fmtMonth(month.key, lng)}
      </td>
      <td className={cn(tdNum, 'text-end text-[11px] font-medium')}>
        <span dir="ltr" className="inline-flex gap-2">
          {month.in > 0 && <span className="text-success">+{fmtAmount(month.in)}</span>}
          {month.out > 0 && <span className="text-muted-foreground">−{fmtAmount(month.out)}</span>}
        </span>
      </td>
    </tr>
  );
}

/**
 * الصناديق: what the page shows, on paper — the caisse picked in its address (?box=,
 * none: all of them together) and the direction its journal shows (?flow=in|out). Its
 * figures, what each caisse holds when all are together, where the money came from
 * and went, what is still owed, then every movement month by month: each نشاط one
 * line with its result, its movements under it.
 */
function TreasuryReport({ onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [sp] = useSearchParams();
  const { section } = useSection();
  const both = !section;
  const res = useFetch('/treasury');
  const flow = FLOWS.includes(sp.get('flow')) ? sp.get('flow') : '';
  // La période de la page (G2), ?from=&to= : ses seules lignes, ses soldes d'ouverture et de clôture
  const { from, to } = periodOfQuery(sp);
  const { byKey, held, multi, sel, owed, rows, months, fig, balanceOf } = ledgerView(res.data, {
    box: sp.get('box') || '',
    flow,
    from,
    to,
    today: todayISO(),
  });
  const period = fig?.period;
  const names = {
    short: (key) => boxName(byKey[key], t, lng, { both, short: true }),
    inline: (key) => boxName(byKey[key], t, lng, { both, inline: true }),
  };
  const flowLabel = flow ? t(flow === 'in' ? 'treasury.filterIn' : 'treasury.filterOut') : '';
  const title = !res.data ? '' : sel ? boxName(sel, t, lng, { both }) : t('print.treasuryAll');
  const ready = title && (flowLabel ? `${title} · ${flowLabel}` : title);
  useEffect(() => {
    if (ready) onReady(ready);
  }, [ready, onReady]);

  if (res.loading) return <SkeletonPage rows={6} />;
  if (res.error) return <LoadError onRetry={res.reload} />;

  const startOf = (box) =>
    box.start &&
    (box.start.inherited
      ? t('treasury.startedWithGroup', { date: fmtDate(box.start.date) })
      : t('treasury.openedOn', { date: fmtDate(box.start.date), amount: fmtAmount(box.start.amount) }));
  // All caisses together: each line says whose it is
  const tagOf = (r) =>
    !sel && multi && r.direction !== 'move' ? <Tag tone="neutral">{names.short(r.box)}</Tag> : null;
  const notOpen = sel ? !sel.start : !held.some((b) => b.start);

  if (notOpen)
    return (
      <Sheet kindLabel={kindLabel}>
        <H1>{title}</H1>
        <p className="mt-4 text-muted-foreground">{t('treasury.notOpenReadonly')}</p>
      </Sheet>
    );

  const income = INCOME_SOURCES.map((k) => ({ key: k, label: t(`treasury.in_${k}`), amount: fig.income[k] }))
    .filter((i) => i.amount > 0);
  const spent = OUT_FIGURES.map((k) => ({ key: k, label: t(`treasury.cat_${k}`), amount: fig.expenses[k] }))
    .filter((i) => i.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const showIn = flow !== 'out';
  const showOut = flow !== 'in';
  const count = rows.length;

  return (
    <Sheet kindLabel={kindLabel}>
      <H1>{title}</H1>
      <Tags>
        {flowLabel && <Tag>{t('print.treasuryOnly', { what: flowLabel })}</Tag>}
        {period && <Tag>{boxPeriodLabel(period, t)}</Tag>}
        {sel && startOf(sel) && (!period || period.started) && <Tag tone="neutral">{startOf(sel)}</Tag>}
        <Tag tone="neutral">{fmtDate(todayISO())}</Tag>
      </Tags>

      <div className="mt-5">
        <Stats
          items={[
            period &&
              !period.started && {
                label: t('treasury.openingOn', { date: fmtDate(period.openingDate) }),
                value: money(period.opening),
              },
            {
              label: period ? t('treasury.balanceOn', { date: fmtDate(period.closingDate) }) : t('treasury.balance'),
              value: money(fig.balance),
              cls: fig.balance < 0 ? 'text-destructive' : undefined,
              hint: fig.balance < 0 ? t('treasury.deficit') : null,
            },
            showIn && { label: t('treasury.income'), value: fmtAmount(fig.income.total), cls: 'text-success' },
            showOut && { label: t('treasury.expenses'), value: fmtAmount(fig.expenses.total) },
            showOut &&
              fig.owed > 0 &&
              // Les dettes sont celles d'aujourd'hui : pas à côté du solde d'une période close
              (!period || period.closingDate === todayISO()) && {
                label: t('treasury.owedTitle'),
                value: fmtAmount(fig.owed),
                cls: 'text-warning',
                hint: t('treasury.afterOwed', { amount: `⁦${moneyText(fig.balance - fig.owed)}⁩` }),
              },
          ].filter(Boolean)}
        />
      </div>

      {!sel && multi && (
        <>
          <H2 aside={held.length}>{t('print.treasuryBoxes')}</H2>
          <Table
            head={[
              t('treasury.box'),
              t('print.treasuryStart'),
              { label: t('treasury.owedTitle'), className: 'text-end' },
              { label: t('treasury.balance'), className: 'text-end' },
            ]}
          >
            {held.map((b) => (
              <tr key={b.key}>
                <td className={cn(td, 'font-medium')}>{names.short(b.key)}</td>
                <td className={cn(td, 'text-muted-foreground')}>{startOf(b) || t('treasury.boxNotOpen')}</td>
                <td className={cn(tdNum, 'text-end text-warning')}>{b.start && b.owed > 0 ? fmtAmount(b.owed) : ''}</td>
                <td className={cn(tdNum, 'text-end font-semibold', balanceOf(b) < 0 && 'text-destructive')}>
                  {b.start && balanceOf(b) !== null ? money(balanceOf(b)) : '—'}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {(showIn && income.length > 0) || (showOut && spent.length > 0) ? (
        <div className={cn('grid grid-cols-1 gap-x-8', showIn && showOut && 'sm:grid-cols-2')}>
          {showIn && income.length > 0 && (
            <div>
              <H2>{t('treasury.income')}</H2>
              <MoneyBreakdown items={income} />
            </div>
          )}
          {showOut && spent.length > 0 && (
            <div>
              <H2>{t('treasury.expenses')}</H2>
              <MoneyBreakdown items={spent} />
            </div>
          )}
        </div>
      ) : null}

      {showOut && owed.length > 0 && (
        <>
          <H2 aside={fmtAmount(fig.owed)}>{t('treasury.owedTitle')}</H2>
          <Table
            head={[
              { label: t('common.date'), className: 'w-20' },
              t('print.treasuryExpense'),
              t('treasury.owedTo'),
              { label: t('treasury.amount'), className: 'text-end' },
            ]}
          >
            {owed.map((x) => (
              <tr key={x.key}>
                <td className={tdNum}>{fmtDate(x.spent_on)}</td>
                <td className={td}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{x.label}</span>
                    {tagOf(x)}
                  </div>
                  <MoneyMeta
                    items={[
                      t(`treasury.cat_${x.category}`),
                      x.session_title && t('treasury.forSession', { title: x.session_title }),
                    ].filter(Boolean)}
                  />
                </td>
                <td className={td}>{x.owed_to}</td>
                <td className={cn(tdNum, 'text-end font-semibold')}>
                  <span dir="ltr">{fmtAmount(x.amount)}</span>
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      <H2 aside={t('treasury.movementCount', { count })}>{t('treasury.journal')}</H2>
      {count === 0 ? (
        <p className="text-muted-foreground">
          {t(flow === 'in' ? 'treasury.emptyFilterIn' : flow === 'out' ? 'treasury.emptyFilterOut' : 'treasury.emptyJournal')}
        </p>
      ) : (
        <Table
          head={[
            { label: t('common.date'), className: 'w-20' },
            t('print.treasuryMovement'),
            { label: t('treasury.amount'), className: 'text-end' },
          ]}
        >
          {months.map((m) => (
            <Fragment key={m.key}>
              <MonthRow month={m} lng={lng} cols={3} />
              {m.rows.map((r) => {
                if (r.source === 'session_group') {
                  const tone = resultTone(r.result);
                  // Its movements under its title, each with its own amount; its
                  // result in the amount column
                  return (
                    <tr key={r.key}>
                      <td className={tdNum}>{fmtDate(r.date)}</td>
                      <td className={td}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{r.session_title}</span>
                          {tagOf(r)}
                        </div>
                        <MoneyMeta items={sessionMeta(r, flow, t).slice(1)} />
                        <ul className="mt-1 space-y-0.5 border-s-2 border-border ps-2 text-[11px]">
                          {r.items.map((x) => {
                            const it = rowText(x, { t, lng, names, nested: true });
                            return (
                              <li key={x.key} className="flex items-baseline justify-between gap-3">
                                <span className="min-w-0">
                                  {it.title}
                                  {it.owed && <Tag tone="warning" className="ms-1.5 px-1.5 py-0">{t('treasury.statusOwed')}</Tag>}
                                  {it.meta.length > 0 && <span className="text-muted-foreground"> · {it.meta.join(' · ')}</span>}
                                </span>
                                <Signed value={x.amount} direction={x.direction} muted className="shrink-0 font-medium" />
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                      <td className={cn(tdNum, 'text-end')}>
                        <span dir="ltr" className={cn('font-semibold', tone.className)}>
                          {signed(r.result)}
                        </span>
                        {!flow && <div className={cn('text-[11px] font-medium', tone.className)}>{t(tone.key)}</div>}
                      </td>
                    </tr>
                  );
                }
                const it = rowText(r, { t, lng, names });
                return (
                  <tr key={r.key}>
                    <td className={tdNum}>{fmtDate(r.date)}</td>
                    <td className={td}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{it.title}</span>
                        {tagOf(r)}
                        {it.owed && <Tag tone="warning">{t('treasury.statusOwed')}</Tag>}
                      </div>
                      <MoneyMeta items={it.meta.slice(1)} />
                    </td>
                    <td className={cn(tdNum, 'text-end')}>
                      <Signed value={r.amount} direction={r.direction} muted={it.move || it.owed} />
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </Table>
      )}
      <Signature label={t('print.signatureTreasurer')} />
    </Sheet>
  );
}

/**
 * مالية الفرقة, as its tab shows it: what its caisse holds, what was given to it and
 * what it cost — paid or still owed, by kind and month by month.
 */
function BranchMoneyReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const res = useFetch(`/branches/${id}/money`);
  const branches = useFetch('/branches');
  const b = (branches.data || []).find((x) => String(x.id) === String(id));
  const name = b ? branchName(b, lng) : '';
  useEffect(() => {
    if (name) onReady(name);
  }, [name, onReady]);

  if (res.loading || branches.loading) return <SkeletonPage rows={6} />;
  if (res.error || branches.error) return <LoadError onRetry={res.reload} />;
  if (!b) return <NotFound />;

  const { expenses, donations, summary, caisse } = res.data;
  const given = donations.reduce((n, x) => n + x.amount, 0);
  const categories = OUT_CATEGORIES.map((k) => ({ key: k, label: t(`treasury.cat_${k}`), amount: summary.by_category[k] }))
    .filter((c) => c.amount > 0)
    .sort((a, c) => c.amount - a.amount);
  // Month of the مصروف itself, not of its payment: what the فرقة cost, when
  const months = byMonth(expenses.map((x) => ({ ...x, date: x.spent_on })));

  return (
    <Sheet kindLabel={kindLabel}>
      <H1>{name}</H1>
      <Tags>
        {caisse && !caisse.opened && <Tag tone="neutral">{`${t('branch.caisse')} : ${t('branch.caisseNotOpen')}`}</Tag>}
        <Tag tone="neutral">{fmtDate(todayISO())}</Tag>
      </Tags>

      <div className="mt-5">
        <Stats
          items={[
            caisse?.opened && {
              label: t('branch.caisse'),
              value: money(caisse.balance),
              cls: caisse.balance < 0 ? 'text-destructive' : undefined,
            },
            { label: t('branch.donations'), value: fmtAmount(given), cls: 'text-success' },
            {
              label: t('branch.expensesTotal'),
              value: fmtAmount(summary.total),
              hint: t('branch.expensesCount', { count: expenses.length }),
            },
            summary.owed > 0 && { label: t('treasury.owedTitle'), value: fmtAmount(summary.owed), cls: 'text-warning' },
          ].filter(Boolean)}
        />
      </div>

      {expenses.length === 0 && donations.length === 0 && (
        <p className="mt-6 text-muted-foreground">{t('branch.moneyEmpty')}</p>
      )}

      {donations.length > 0 && (
        <>
          <H2 aside={fmtAmount(given)}>{t('branch.donations')}</H2>
          <Table
            head={[
              { label: t('common.date'), className: 'w-20' },
              t('treasury.donation'),
              { label: t('treasury.amount'), className: 'text-end' },
            ]}
          >
            {donations.map((x) => (
              <tr key={x.key}>
                <td className={tdNum}>{fmtDate(x.date)}</td>
                <td className={td}>
                  <span className="font-medium">{x.label || t('treasury.donation')}</span>
                  <MoneyMeta items={[x.session_title && t('treasury.forSession', { title: x.session_title })].filter(Boolean)} />
                </td>
                <td className={cn(tdNum, 'text-end')}>
                  <Signed value={x.amount} direction="in" />
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {categories.length > 0 && (
        <>
          <H2>{t('branch.expensesByCategory')}</H2>
          <MoneyBreakdown items={categories} />
        </>
      )}

      {expenses.length > 0 && (
        <>
          <H2 aside={t('branch.expensesCount', { count: expenses.length })}>{t('treasury.expenses')}</H2>
          <Table
            head={[
              { label: t('common.date'), className: 'w-20' },
              t('print.treasuryExpense'),
              { label: t('treasury.amount'), className: 'text-end' },
            ]}
          >
            {months.map((m) => (
              <Fragment key={m.key}>
                <MonthRow month={m} lng={lng} cols={3} />
                {m.rows.map((x) => {
                  const owedNow = !x.paid_on;
                  return (
                    <tr key={x.key}>
                      <td className={tdNum}>{fmtDate(x.spent_on)}</td>
                      <td className={td}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{x.label}</span>
                          {owedNow && <Tag tone="warning">{t('treasury.statusOwed')}</Tag>}
                        </div>
                        <MoneyMeta
                          items={[
                            t(`treasury.cat_${x.category}`),
                            x.session_title && t('treasury.forSession', { title: x.session_title }),
                            x.owed_to && t(owedNow ? 'treasury.owedRowTo' : 'treasury.paidRowTo', { name: x.owed_to }),
                          ].filter(Boolean)}
                        />
                      </td>
                      <td className={cn(tdNum, 'text-end font-semibold')}>
                        <span dir="ltr">{fmtAmount(x.amount)}</span>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </Table>
        </>
      )}
      <Signature label={t('print.signatureBranch')} />
    </Sheet>
  );
}

/* ============================================================
   E2 — ملف المخيم : liste d'appel, encadrement, programme, bilan, check-list
   ============================================================ */

/** Les numéros d'une personne, chacun dans son îlot LTR ; «(الأم)» après celui de la mère */
function PhoneList({ phones }) {
  const { t } = useTranslation();
  if (!phones.length) return '—';
  return phones.map((ph, i) => (
    <div key={i} className="whitespace-nowrap">
      <span dir="ltr">{fmtPhone(ph.number)}</span>
      {ph.mother && <span className="text-[11px]"> ({t('member.motherShort')})</span>}
    </div>
  ));
}

const leaderPhones = (p) => phoneNumbers(p.leader_phone).map((number) => ({ number, mother: false }));

/** «Payé», «En partie · reste 3 000», «Non payé · reste 5 000», «Exempté» */
function PayCell({ p, ev }) {
  const { t } = useTranslation();
  const state = payState(p, ev);
  if (state === 'free') return <span className="text-muted-foreground">—</span>;
  const left = remainingOf(p, ev);
  const tone = state === 'paid' || state === 'exempt' ? 'text-success' : state === 'partial' ? 'text-warning' : 'text-destructive';
  return (
    <span className={cn('font-medium', tone)}>
      {t(state === 'exempt' ? 'event.exempt' : state === 'unpaid' ? 'event.notPaid' : `event.state_${state}`)}
      {left > 0 && (
        <span className="block whitespace-nowrap text-[11px] font-normal tabular-nums text-muted-foreground">
          {t('event.outstandingShort', { amount: fmtAmount(left) })}
        </span>
      )}
    </span>
  );
}

function EventReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [sp] = useSearchParams();
  const report = sp.get('variant') === 'report';
  const res = useFetch(`/events/${id}`);
  const branches = useFetch('/branches');
  const ev = res.data;
  useEffect(() => {
    if (ev) onReady(report ? `${ev.title} — ${t('campFile.reportVariant')}` : ev.title);
  }, [ev, report, onReady, t]);

  if (res.loading || branches.loading) return <SkeletonPage rows={8} />;
  if (res.error || !ev) return <LoadError onRetry={res.reload} />;

  const fees = !!ev.summary;
  const people = ev.participants;
  // Pas de colonne «Autorisation» quand personne n'en doit (un camp des seuls العلياء)
  const consents = people.some((p) => p.consent_needed);
  const members = people.filter((p) => p.member_id);
  const others = people.filter((p) => !p.member_id);
  const roster = rosterByGroup(people);
  const scope = eventScopeLabels(ev, branches.data || [], lng);
  const chief = chiefLabel(t, ev.kind, ev.section);
  const marked = ev.attendance.length;
  const present = ev.attendance.filter((a) => a.status === 'present').length;
  const r = ev.readiness || {};
  const sum = ev.summary;
  const staffName = (st) => (st.leader_id ? memberName(st) : st.name);
  const label = report ? t('campFile.reportVariant') : kindLabel;
  const presentBySession = new Map();
  const presentByPerson = new Map();
  for (const a of ev.attendance)
    if (a.status === 'present') {
      presentBySession.set(a.session_id, (presentBySession.get(a.session_id) || 0) + 1);
      presentByPerson.set(a.participant_id, (presentByPerson.get(a.participant_id) || 0) + 1);
    }
  // «3/5» : les séances où il était présent, sur toutes celles du programme
  const presences = (p) => `${presentByPerson.get(p.id) || 0}/${ev.sessions.length}`;

  const callHead = [
    { label: '#', className: 'w-7' },
    t('member.name'),
    ...(consents ? [t('campFile.consent')] : []),
    ...(fees ? [t('event.payment')] : []),
    { label: t('campFile.presences'), className: 'w-16' },
  ];

  return (
    <Sheet kindLabel={label}>
      <H1>
        <bdi>{ev.title}</bdi>
      </H1>
      <Tags>
        <Tag>{t(`event.kind_${ev.kind}`)}</Tag>
        {scope.length ? (
          scope.map((s) => (
            <Tag key={s.id} tone="neutral">
              {s.label}
            </Tag>
          ))
        ) : (
          <Tag tone="neutral">{t('event.wholeGroup')}</Tag>
        )}
      </Tags>

      {/* I1 : l'en-tête normalisé d'un rapport (التقرير الجيد) — destinataire, émetteur, date, objet */}
      {report && (
        <div className="avoid-break mt-4 rounded-lg border border-border px-4 py-3">
          <Facts
            items={[
              [t('campFile.to'), t('campFile.toValue')],
              [t('campFile.from'), ev.leader_name ? `${chief} — ${ev.leader_name}` : chief],
              [t('common.date'), fmtDate(todayISO())],
              [t('campFile.subject'), t('campFile.subjectValue', { title: ev.title })],
            ]}
          />
        </div>
      )}

      <div className="mt-4">
        <Facts
          items={[
            [t('campFile.dates'), `${fmtDateRange(ev.start_date, ev.end_date)} · ${t('event.dayCount', { count: dayNumber(ev, ev.end_date) })}`],
            [t('session.place'), ev.place],
            [chief, ev.leader_name],
            [t('event.fee'), fees && ev.fee ? fmtAmount(ev.fee) : null],
          ]}
        />
      </div>

      <div className="mt-4">
        <Stats
          items={[
            { label: t('event.participants'), value: people.length, hint: t('campFile.split', { members: members.length, others: others.length }) },
            { label: t('campFile.attendanceRate'), value: pct(present, marked) },
            { label: t('campFile.consentStat'), value: r.consent_total ? `${r.consent_total - r.consent_missing}/${r.consent_total}` : '—' },
            { label: t('campFile.safetyStat'), value: r.safety_total ? `${r.safety_done}/${r.safety_total}` : '—' },
            ...(fees
              ? [{ label: t('campFile.remaining'), value: fmtAmount(sum.outstanding), cls: sum.outstanding > 0 ? 'text-destructive' : undefined }]
              : []),
          ]}
        />
      </div>

      {report && ev.plan && (
        <>
          <H2>{t('event.plan')}</H2>
          <p dir="auto" className="whitespace-pre-line text-start leading-relaxed">
            {ev.plan}
          </p>
        </>
      )}

      <H2 aside={ev.staff.length + (ev.leader_id ? 1 : 0) || null}>{t('event.tabStaff')}</H2>
      <Table head={[t('event.staffRole'), t('member.name')]}>
        {ev.leader_name && (
          <tr>
            <td className={cn(td, 'w-1/3 text-muted-foreground')}>{chief}</td>
            <td className={cn(td, 'font-medium')}>{ev.leader_name}</td>
          </tr>
        )}
        {ev.staff.map((st) => (
          <tr key={st.id}>
            <td className={cn(td, 'w-1/3 text-muted-foreground')}>{staffRoleLabel(t, st.role, st.title, ev.section)}</td>
            <td className={cn(td, 'font-medium')}>{staffName(st) || '—'}</td>
          </tr>
        ))}
      </Table>

      {report ? (
        // Le rapport à la قيادة : les effectifs, pas les téléphones ni la santé
        <>
          <H2 aside={t('event.participantCount', { count: people.length })}>{t('event.participants')}</H2>
          <Table head={[t('member.branch'), t('member.group'), { label: t('campFile.count'), className: 'w-16' }]}>
            {roster.flatMap((b) =>
              b.groups.map((g) => (
                <tr key={`${b.key}-${g.key}`}>
                  <td className={td}>{branchName(b.branch, lng) || '—'}</td>
                  <td className={cn(td, 'text-muted-foreground')}>{g.name || t('campFile.noGroup')}</td>
                  <td className={tdNum}>{g.people.length}</td>
                </tr>
              ))
            )}
            {others.length > 0 && (
              <tr>
                <td className={td} colSpan={2}>
                  {t('campFile.leadersGuests')}
                </td>
                <td className={tdNum}>{others.length}</td>
              </tr>
            )}
          </Table>
        </>
      ) : (
        <>
          <H2 aside={t('event.participantCount', { count: members.length })}>{t('campFile.callList')}</H2>
          {members.length === 0 ? (
            <p className="text-muted-foreground">{t('event.noParticipants')}</p>
          ) : (
            roster.map((b) => (
              <div key={b.key} className="mt-3">
                <h3 className="mb-1 text-[13px] font-bold">{branchName(b.branch, lng) || '—'}</h3>
                {b.groups.map((g) => (
                  <div key={g.key} className="mb-3">
                    <div className="avoid-break break-after-avoid text-[12px] font-semibold text-muted-foreground">
                      {g.name || t('campFile.noGroup')} <span className="tabular-nums">({g.people.length})</span>
                    </div>
                    <Table head={callHead}>
                      {g.people.map((p, i) => {
                        return (
                          <tr key={p.id} className="avoid-break">
                            <td className={cn(tdNum, 'w-7 text-muted-foreground')}>{i + 1}</td>
                            <td className={cn(td, 'font-medium')}>
                              {memberName(p)}
                              {p.member_role && (
                                <span className="block text-[11px] font-normal text-primary">{t(`resp.role.${p.member_role}`)}</span>
                              )}
                            </td>
                            {consents && (
                              <td className={td}>
                                {!p.consent_needed ? (
                                  <span className="text-muted-foreground">{t('campFile.consentNotNeeded')}</span>
                                ) : p.consent_at ? (
                                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-success">
                                    <Mark kind="check" />
                                    <span className="tabular-nums">{fmtDate(p.consent_at)}</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-destructive">
                                    <Mark kind="x" />
                                    {t('campFile.consentMissing')}
                                  </span>
                                )}
                              </td>
                            )}
                            {fees && (
                              <td className={td}>
                                <PayCell p={p} ev={ev} />
                              </td>
                            )}
                            <td className={tdNum}>
                              <span dir="ltr">{presences(p)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </Table>
                  </div>
                ))}
              </div>
            ))
          )}

          {others.length > 0 && (
            <>
              <H2 aside={others.length}>{t('campFile.leadersGuests')}</H2>
              <Table
                head={[
                  { label: '#', className: 'w-7' },
                  t('member.name'),
                  ...(fees ? [t('event.payment')] : []),
                  { label: t('campFile.presences'), className: 'w-16' },
                ]}
              >
                {others.map((p, i) => (
                  <tr key={p.id} className="avoid-break">
                    <td className={cn(tdNum, 'w-7 text-muted-foreground')}>{i + 1}</td>
                    <td className={cn(td, 'font-medium')}>
                      {participantName(p)}
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {t(p.leader_id ? 'event.kindLeader' : 'event.kindGuest')}
                      </span>
                    </td>
                    {fees && (
                      <td className={td}>
                        <PayCell p={p} ev={ev} />
                      </td>
                    )}
                    <td className={tdNum}>
                      <span dir="ltr">{presences(p)}</span>
                    </td>
                  </tr>
                ))}
              </Table>
            </>
          )}
        </>
      )}

      <H2 aside={ev.sessions.length || null}>{t('event.program')}</H2>
      {ev.sessions.length === 0 ? (
        <p className="text-muted-foreground">{t('event.noSessions')}</p>
      ) : (
        <Table
          head={[
            { label: t('event.day'), className: 'w-16' },
            { label: t('session.time'), className: 'w-24' },
            t('event.sessionTitle'),
            t('event.responsible'),
            { label: t('session.present'), className: 'w-16' },
          ]}
        >
          {ev.sessions.map((s) => (
            <tr key={s.id} className="avoid-break">
              <td className={tdNum}>
                {t('event.dayN', { n: dayNumber(ev, s.date) })}
                <span className="block text-[11px] text-muted-foreground">{fmtDate(s.date)}</span>
              </td>
              <td className={tdNum}>{[fmtTime(s.start_time), fmtTime(s.end_time)].filter(Boolean).join(' – ') || '—'}</td>
              <td className={cn(td, 'font-medium')}>
                <bdi>{s.title}</bdi>
              </td>
              <td className={cn(td, 'text-muted-foreground')}>{s.responsible || '—'}</td>
              <td className={tdNum}>{presentBySession.get(s.id) || '—'}</td>
            </tr>
          ))}
        </Table>
      )}

      {fees && (
        <>
          <H2>{t('campFile.money')}</H2>
          <Table head={[t('campFile.line'), { label: t('event.amount'), className: 'w-32' }]}>
            {[
              [t('campFile.expected'), fmtAmount(sum.expected)],
              [t('event.collected'), fmtAmount(sum.collected)],
              [t('campFile.remaining'), fmtAmount(sum.outstanding)],
              [t('event.donations'), fmtAmount(sum.donations)],
              [t('event.fromCaisses'), signed(sum.funded - sum.returned)],
              [t('event.expenses'), fmtAmount(sum.expenses)],
            ].map(([k, v]) => (
              <tr key={k}>
                <td className={td}>{k}</td>
                <td className={tdNum}>
                  <span dir="ltr">{v}</span>
                </td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className={td}>{t('event.balance')}</td>
              <td className={cn(tdNum, sum.balance < 0 ? 'text-destructive' : 'text-success')}>
                <span dir="ltr">{signed(sum.balance)}</span>
              </td>
            </tr>
          </Table>
        </>
      )}

      {ev.checklist.length > 0 && (
        <>
          <H2 aside={`${r.safety_done ?? 0}/${r.safety_total ?? ev.checklist.length}`}>{t('safety.checklistTitle')}</H2>
          <Table
            head={[
              t('safety.itemLabel'),
              t('safety.itemResponsible'),
              t('campFile.state'),
              ...(report ? [] : [{ label: t('campFile.checkSign'), className: 'w-24' }]),
            ]}
          >
            {ev.checklist.map((c) => (
              <tr key={c.id} className="avoid-break">
                <td className={cn(td, 'font-medium')}>{c.item ? t(`safety.item.${c.item}`) : c.label}</td>
                <td className={cn(td, 'text-muted-foreground')}>{c.staff_name || '—'}</td>
                <td className={td}>
                  {c.done_at ? (
                    <span className="text-success">
                      <Mark kind="check" /> {t('safety.doneBy', { name: c.done_by || '—', date: fmtDate(c.done_at) })}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                {!report && <td className={td} />}
              </tr>
            ))}
          </Table>
        </>
      )}

      <Signatures labels={[chief, t('campFile.signHead')]} />
    </Sheet>
  );
}

/** Les restes à payer d'un camp, avec les téléphones des parents : la feuille de relance */
function EventUnpaidReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const res = useFetch(`/events/${id}`);
  const ev = res.data;
  useEffect(() => {
    if (ev) onReady(ev.title);
  }, [ev, onReady]);

  if (res.loading) return <SkeletonPage rows={6} />;
  if (res.error || !ev) return <LoadError onRetry={res.reload} />;

  const list = unpaidOf(ev);
  const total = list.reduce((n, p) => n + remainingOf(p, ev), 0);
  return (
    <Sheet kindLabel={kindLabel}>
      <H1>
        <bdi>{ev.title}</bdi>
      </H1>
      <Tags>
        <Tag tone="neutral">{fmtDateRange(ev.start_date, ev.end_date)}</Tag>
        {list.length > 0 && (
          <Tag tone="destructive">
            {t('campFile.unpaidLine', { amount: fmtAmount(total), count: familyCount(list) })}
          </Tag>
        )}
      </Tags>
      <H2 aside={list.length || null}>{kindLabel}</H2>
      {list.length === 0 ? (
        <p className="text-muted-foreground">{t('event.allCollected')}</p>
      ) : (
        <Table
          head={[
            { label: '#', className: 'w-7' },
            t('member.name'),
            t('member.parentPhone'),
            { label: t('event.dueLabel'), className: 'w-20' },
            { label: t('campFile.paid'), className: 'w-20' },
            { label: t('campFile.remaining'), className: 'w-20' },
          ]}
        >
          {list.map((p, i) => (
            <tr key={p.id} className="avoid-break">
              <td className={cn(tdNum, 'w-7 text-muted-foreground')}>{i + 1}</td>
              <td className={cn(td, 'font-medium')}>
                {participantName(p)}
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {p.member_id
                    ? [branchName(p, lng), p.group_name].filter(Boolean).join(' · ')
                    : t(p.leader_id ? 'event.kindLeader' : 'event.kindGuest')}
                </span>
              </td>
              <td className={cn(tdNum, 'text-muted-foreground')}>
                <PhoneList phones={p.member_id ? parentPhones(p) : leaderPhones(p)} />
              </td>
              <td className={tdNum}>{fmtAmount(dueOf(p, ev))}</td>
              <td className={tdNum}>{fmtAmount(p.paid ?? 0)}</td>
              <td className={cn(tdNum, 'font-semibold text-destructive')}>{fmtAmount(remainingOf(p, ev))}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className={td} />
            <td className={td} colSpan={4}>
              {t('campFile.total')}
            </td>
            <td className={cn(tdNum, 'text-destructive')}>{fmtAmount(total)}</td>
          </tr>
        </Table>
      )}
      <Signature label={t('event.role_treasurer')} />
    </Sheet>
  );
}

/** G1 : la feuille de relance des cotisations en retard, par فرقة, avec les téléphones */
function DuesArrearsReport({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [sp] = useSearchParams();
  const q = arrearsQuery(id, sp);
  const res = useFetch(`/member-dues/arrears${q ? `?${q}` : ''}`);
  const data = res.data;
  const one = Number(id) ? [...(data?.members || []), ...(data?.archived || [])][0] : null;
  const title = !data
    ? ''
    : [one ? branchName({ name_fr: one.branch_name_fr, name_ar: one.branch_name_ar }, lng) : t('arrears.allBranches'), data.year]
        .filter(Boolean)
        .join(' · ');
  useEffect(() => {
    if (title) onReady(title);
  }, [title, onReady]);

  if (res.loading) return <SkeletonPage rows={6} />;
  if (res.error || !data) return <LoadError onRetry={res.reload} />;

  const table = (rows) => (
    <Table
      head={[
        { label: '#', className: 'w-7' },
        t('member.name'),
        t('member.parentPhone'),
        t('arrears.monthsCol'),
        { label: t('arrears.lastPaidCol'), className: 'w-20' },
        { label: t('arrears.owedCol'), className: 'w-20' },
      ]}
    >
      {rows.map((r, i) => (
        <tr key={r.id} className="avoid-break">
          <td className={cn(tdNum, 'w-7 text-muted-foreground')}>{i + 1}</td>
          <td className={cn(td, 'font-medium')}>
            {memberName(r)}
            {r.group_name && <span className="block text-[11px] font-normal text-muted-foreground">{r.group_name}</span>}
          </td>
          <td className={cn(tdNum, 'text-muted-foreground')}>
            <PhoneList phones={parentPhones(r)} />
          </td>
          <td className={td}>{arrearsMonths(r.months, lng)}</td>
          <td className={tdNum}>{r.last_paid_on ? fmtDate(r.last_paid_on) : '—'}</td>
          <td className={cn(tdNum, 'font-semibold text-destructive')}>{fmtAmount(r.owed)}</td>
        </tr>
      ))}
      <tr className="font-bold">
        <td className={td} />
        <td className={td} colSpan={4}>
          {t('campFile.total')}
        </td>
        <td className={cn(tdNum, 'text-destructive')}>{fmtAmount(rows.reduce((n, r) => n + r.owed, 0))}</td>
      </tr>
    </Table>
  );

  return (
    <Sheet kindLabel={kindLabel}>
      <H1>
        <bdi>{title}</bdi>
      </H1>
      <Tags>
        <Tag tone="neutral">{t('dues.monthlyShort', { amount: fmtAmount(data.rate) })}</Tag>
        {data.with_current && <Tag tone="neutral">{t('arrears.filterAllOwed')}</Tag>}
        {data.members.length > 0 && (
          <Tag tone="destructive">
            {t('arrears.summary', { count: data.totals.members, amount: fmtAmount(data.totals.amount) })}
          </Tag>
        )}
      </Tags>
      {data.members.length === 0 ? (
        <p className="text-muted-foreground">{t('arrears.none')}</p>
      ) : (
        groupArrears(data.members).map((g) => (
          <Fragment key={g.id}>
            <H2 aside={g.rows.length}>{branchName(g, lng)}</H2>
            {table(g.rows)}
          </Fragment>
        ))
      )}
      {data.archived.length > 0 && (
        <>
          <H2 aside={data.archived.length}>{t('arrears.archivedTitle')}</H2>
          {table(data.archived)}
        </>
      )}
      <Signature label={t('event.role_treasurer')} />
    </Sheet>
  );
}

/**
 * I1 : le rapport périodique à la قيادة, avec l'en-tête du التقرير الجيد (destinataire,
 * émetteur, date, objet, période) et les signatures. Le numéro est une فرقة (0 = le فوج).
 * Chaque partie n'apparaît que pour un compte qui la voit sur l'écran.
 */
function PeriodReportSheet({ id, onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [sp] = useSearchParams();
  const q = new URLSearchParams(periodQuery(sp));
  if (Number(id)) q.set('branch', id);
  const res = useFetch(`/reports/period?${q}`);
  const d = res.data;
  const period = d ? periodLabel(d.period.from, d.period.to, t, lng) : '';
  const sender = d ? (d.branch ? branchName(d.branch, lng) : t('periodReport.wholeGroup')) : '';
  const title = d ? `${sender} · ${period}` : '';
  useEffect(() => {
    if (title) onReady(title);
  }, [title, onReady]);

  if (res.loading) return <SkeletonPage rows={8} />;
  if (res.error || !d) return <LoadError onRetry={res.reload} />;

  const tot = d.totals;
  const many = d.branches.length > 1;
  const recipient = sp.get('recipient') || d.recipient || t('campFile.toValue');
  const delta = rateDelta(tot.rate, tot.prev_rate);
  const pctOf = (v) => (v === null || v === undefined ? '—' : `${v}%`);
  const signedDelta = (v) => (v === null ? '' : ` (${v > 0 ? '+' : ''}${v})`);
  const dash = (v) => v || '—';
  // Always left to right: «−3 / +5» must not turn into «5+ / 3−» on an Arabic sheet
  const promo = (m) =>
    m.promoted_out || m.promoted_in ? <span dir="ltr">{`−${m.promoted_out} / +${m.promoted_in}`}</span> : '—';
  const owedTotal = d.dues ? d.dues.branches.reduce((n, b) => n + b.owed, 0) : 0;
  const boxesOpen = (d.treasury || []).some((b) => b.opened);
  const nameOf = (m) => branchName({ name_fr: m.branch_name_fr, name_ar: m.branch_name_ar }, lng);

  return (
    <Sheet kindLabel={kindLabel}>
      <div className="avoid-break mt-4 rounded-lg border border-border px-4 py-3">
        <Facts
          items={[
            [t('campFile.to'), recipient],
            [t('campFile.from'), sender],
            [t('common.date'), fmtDate(d.today)],
            [t('campFile.subject'), t('periodReport.subjectValue', { period })],
            [t('periodReport.period'), `${fmtDate(d.period.from)} – ${fmtDate(d.period.to)}`, true],
          ]}
        />
      </div>
      <H1>
        <bdi>{t('periodReport.heading', { period })}</bdi>
      </H1>

      <div className="mt-4">
        <Stats
          items={[
            {
              label: t('periodReport.sessionsCounted'),
              value: `${tot.sessions.counted}/${tot.sessions.total}`,
              hint: tot.sessions.unconfirmed ? t('periodReport.unconfirmedHint', { count: tot.sessions.unconfirmed }) : null,
              cls: tot.sessions.unconfirmed ? 'text-warning' : undefined,
            },
            {
              label: t('periodReport.attendanceRate'),
              value: pctOf(tot.rate),
              hint: tot.prev_rate !== null ? t('periodReport.prevRate', { rate: `${tot.prev_rate}%${signedDelta(delta)}` }) : null,
            },
            { label: t('periodReport.activeMembers'), value: tot.active },
            {
              label: t('periodReport.toFollow'),
              value: tot.followup,
              hint: tot.followup ? t('periodReport.contactedHint', { count: tot.followup_contacted }) : null,
              cls: tot.followup ? 'text-destructive' : undefined,
            },
          ]}
        />
      </div>

      <H2 aside={tot.leader_sessions ? t('periodReport.leaderSessions', { count: tot.leader_sessions }) : null}>
        {t('periodReport.activitiesTitle')}
      </H2>
      <Table
        head={[
          t('member.branch'),
          { label: t('periodReport.colCounted'), className: 'w-16' },
          { label: t('periodReport.colUnconfirmed'), className: 'w-16' },
          { label: t('periodReport.colPlanned'), className: 'w-14' },
          { label: t('periodReport.colRate'), className: 'w-14' },
          { label: t('periodReport.colPrevRate'), className: 'w-16' },
          { label: t('periodReport.colVisits'), className: 'w-14' },
        ]}
      >
        {d.branches.map((b) => (
          <tr key={b.id} className="avoid-break">
            <td className={cn(td, 'font-medium')}>{branchName(b, lng)}</td>
            <td className={tdNum}>{`${b.sessions.counted}/${b.sessions.total}`}</td>
            <td className={cn(tdNum, b.sessions.unconfirmed > 0 && 'font-semibold text-warning')}>
              {dash(b.sessions.unconfirmed)}
            </td>
            <td className={tdNum}>{dash(b.sessions.planned)}</td>
            <td className={cn(tdNum, 'font-semibold')}>{pctOf(b.attendance.rate)}</td>
            <td className={cn(tdNum, 'text-muted-foreground')}>{pctOf(b.prev_attendance.rate)}</td>
            <td className={tdNum}>{dash(b.sessions.visits)}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-1 text-[11px] text-muted-foreground">{t('periodReport.countedNote')}</p>

      <H2>{t('periodReport.membersTitle')}</H2>
      <Table
        head={[
          t('member.branch'),
          { label: t('periodReport.colActive'), className: 'w-14' },
          { label: t('periodReport.colJoined'), className: 'w-14' },
          { label: t('periodReport.colPromoted'), className: 'w-16' },
          { label: t('periodReport.colArchived'), className: 'w-14' },
        ]}
      >
        {d.branches.map((b) => (
          <tr key={b.id} className="avoid-break">
            <td className={cn(td, 'font-medium')}>{branchName(b, lng)}</td>
            <td className={cn(tdNum, 'font-semibold')}>{b.members.active}</td>
            <td className={tdNum}>{dash(b.members.joined)}</td>
            <td className={tdNum}>{promo(b.members)}</td>
            <td className={tdNum}>{dash(b.members.archived)}</td>
          </tr>
        ))}
        {many && (
          <tr className="font-bold">
            <td className={td}>{t('campFile.total')}</td>
            <td className={tdNum}>{tot.active}</td>
            <td className={tdNum}>{dash(tot.joined)}</td>
            <td className={tdNum}>{promo(tot)}</td>
            <td className={tdNum}>{dash(tot.archived)}</td>
          </tr>
        )}
      </Table>

      {d.followup && (
        <>
          <H2 aside={t('periodReport.contactsAside', { count: tot.contacts })}>
            {t('periodReport.followupTitle', { count: d.threshold })}
          </H2>
          {d.followup.length === 0 ? (
            <p className="text-muted-foreground">{t('periodReport.followupNone')}</p>
          ) : (
            <Table
              head={[
                { label: '#', className: 'w-7' },
                t('member.name'),
                many && t('member.branch'),
                { label: t('periodReport.colAbsences'), className: 'w-16' },
                t('periodReport.colLastContact'),
              ].filter(Boolean)}
            >
              {d.followup.map((m, i) => (
                <tr key={m.id} className="avoid-break">
                  <td className={cn(tdNum, 'w-7 text-muted-foreground')}>{i + 1}</td>
                  <td className={cn(td, 'font-medium')}>{memberName(m)}</td>
                  {many && <td className={td}>{nameOf(m)}</td>}
                  <td className={cn(tdNum, 'font-semibold text-destructive')}>{m.absences}</td>
                  <td className={cn(td, 'text-muted-foreground')}>
                    {m.last_contact
                      ? `${fmtDate(m.last_contact.slice(0, 10))} · ${m.last_contact_by}`
                      : t('periodReport.notContacted')}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}

      {d.events && (
        <>
          <H2 aside={d.events.length || null}>{t('periodReport.eventsTitle')}</H2>
          {d.events.length === 0 ? (
            <p className="text-muted-foreground">{t('periodReport.eventsNone')}</p>
          ) : (
            <Table
              head={[
                t('periodReport.colEvent'),
                t('campFile.dates'),
                { label: t('periodReport.colParticipants'), className: 'w-16' },
                d.events.some((e) => 'paid' in e) && { label: t('periodReport.colPaid'), className: 'w-20' },
              ].filter(Boolean)}
            >
              {d.events.map((e) => (
                <tr key={e.id} className="avoid-break">
                  <td className={cn(td, 'font-medium')}>
                    {e.title}
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {[t(`event.kind_${e.kind}`), e.place].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className={tdNum}>{fmtDateRange(e.start_date, e.end_date)}</td>
                  <td className={tdNum}>{e.members + e.others}</td>
                  {'paid' in e && <td className={tdNum}>{fmtAmount(e.paid)}</td>}
                </tr>
              ))}
            </Table>
          )}
        </>
      )}

      {d.treasury && d.treasury.length > 0 && !boxesOpen && (
        <>
          <H2>{t('periodReport.treasuryTitle')}</H2>
          <p className="text-muted-foreground">{t('periodReport.boxesNotOpen')}</p>
        </>
      )}
      {boxesOpen && (
        <>
          <H2>{t('periodReport.treasuryTitle')}</H2>
          <Table
            head={[
              t('periodReport.colBox'),
              { label: t('periodReport.colOpening'), className: 'w-20' },
              { label: t('periodReport.colIn'), className: 'w-20' },
              { label: t('periodReport.colOut'), className: 'w-20' },
              { label: t('periodReport.colClosing'), className: 'w-20' },
            ]}
          >
            {d.treasury.map((b) => (
              <tr key={b.key} className="avoid-break">
                <td className={cn(td, 'font-medium')}>{boxName(b, t, lng)}</td>
                {b.opened ? (
                  <>
                    <td className={tdNum}>{fmtAmount(b.opening ?? 0)}</td>
                    <td className={cn(tdNum, 'text-success')}>{fmtAmount(b.income)}</td>
                    <td className={cn(tdNum, 'text-destructive')}>{fmtAmount(b.expenses)}</td>
                    <td className={cn(tdNum, 'font-semibold')}>{fmtAmount(b.closing ?? 0)}</td>
                  </>
                ) : (
                  <td className={cn(td, 'text-muted-foreground')} colSpan={4}>
                    {t('periodReport.boxNotOpen')}
                  </td>
                )}
              </tr>
            ))}
          </Table>
          {d.treasury.length > 1 && (
            <p className="mt-1 text-[11px] text-muted-foreground">{t('periodReport.transfersNote')}</p>
          )}
        </>
      )}

      {d.dues && (
        <>
          <H2 aside={t('dues.monthlyShort', { amount: fmtAmount(d.dues.rate) })}>{t('periodReport.duesTitle')}</H2>
          <Table
            head={[
              t('member.branch'),
              { label: t('periodReport.colCollected'), className: 'w-24' },
              { label: t('periodReport.colLate'), className: 'w-20' },
              { label: t('periodReport.colOwed'), className: 'w-24' },
            ]}
          >
            {d.dues.branches.map((b) => (
              <tr key={b.id} className="avoid-break">
                <td className={cn(td, 'font-medium')}>{branchName(b, lng)}</td>
                <td className={tdNum}>{fmtAmount(b.collected)}</td>
                <td className={tdNum}>{dash(b.late_members)}</td>
                <td className={cn(tdNum, b.owed > 0 && 'font-semibold text-destructive')}>{fmtAmount(b.owed)}</td>
              </tr>
            ))}
            {many && (
              <tr className="font-bold">
                <td className={td}>{t('campFile.total')}</td>
                <td className={tdNum}>{fmtAmount(d.dues.branches.reduce((n, b) => n + b.collected, 0))}</td>
                <td className={tdNum}>{d.dues.branches.reduce((n, b) => n + b.late_members, 0)}</td>
                <td className={cn(tdNum, owedTotal > 0 && 'text-destructive')}>{fmtAmount(owedTotal)}</td>
              </tr>
            )}
          </Table>
          <p className="mt-1 text-[11px] text-muted-foreground">{t('periodReport.duesNote')}</p>
        </>
      )}

      {d.overdue && d.overdue.length > 0 && (
        <>
          <H2 aside={d.overdue.length}>{t('periodReport.overdueTitle')}</H2>
          <Table
            head={[t('periodReport.colTask'), t('periodReport.colOwner'), { label: t('periodReport.colDue'), className: 'w-20' }]}
          >
            {d.overdue.map((x) => (
              <tr key={x.id} className="avoid-break">
                <td className={td}>
                  {x.text}
                  <span className="block text-[11px] text-muted-foreground">{x.meeting_title}</span>
                </td>
                <td className={td}>{x.owner || '—'}</td>
                <td className={cn(tdNum, 'text-destructive')}>{fmtDate(x.due_date)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {/* Observations and signatures stay together: a page holding only the signatures
          would read as signing nothing */}
      <div className="avoid-break">
        <H2>{t('periodReport.observations')}</H2>
        <div className="space-y-7 pt-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="border-b border-dashed border-muted-foreground/60" />
          ))}
        </div>
        <Signatures
          labels={[d.branch ? t('periodReport.signChief') : t('periodReport.signSender'), t('periodReport.signDean')]}
        />
      </div>
    </Sheet>
  );
}

/* ============================================================
   حضور الأمانة
   ============================================================ */

/**
 * The register of an أمانة: one line per day, one column per قائد of its team, his rate
 * under his column — the sheet its أمين used to keep on paper. A blank cell: he was not
 * on that day's list (not yet in the team, or no longer).
 */
function AmanaPresenceReport({ id, onReady, kindLabel }) {
  const { t } = useTranslation();
  const res = useFetch(`/amanat/${id}/rolls?entries=1`);
  const data = res.data;
  useEffect(() => {
    if (data) onReady(data.amana.title);
  }, [data, onReady]);

  if (res.loading) return <SkeletonPage rows={6} />;
  if (res.error) return <LoadError onRetry={res.reload} />;

  const { amana, members } = data;
  // Oldest first, the way a register fills up
  const rolls = [...data.rolls].reverse();
  const cell = new Map(data.entries.map((e) => [`${e.roll_id}:${e.leader_id}`, e.status]));
  const total = countStatuses(data.entries);
  return (
    <Sheet kindLabel={kindLabel}>
      <H1>
        <bdi>{amana.title}</bdi>
      </H1>
      <p className="mt-1 text-muted-foreground">
        <span dir="ltr">{amana.year}</span> · {t('amanaRoll.days', { count: rolls.length })}
      </p>
      <div className="mt-4">
        <Stats
          items={[
            { label: t('session.tallyPresent'), value: total.present, cls: 'text-success' },
            { label: t('session.tallyExcused'), value: total.excused, cls: 'text-warning' },
            { label: t('session.tallyAbsent'), value: total.absent, cls: 'text-destructive' },
            { label: t('leader.colPresence'), value: total.rate },
          ]}
        />
      </div>

      <H2 aside={t('amanaRoll.days', { count: rolls.length })}>{t('amanaRoll.register')}</H2>
      {rolls.length === 0 || members.length === 0 ? (
        <p className="text-muted-foreground">{t('amanaRoll.emptyTitle')}</p>
      ) : (
        <Table
          head={[
            t('common.date'),
            ...members.map((m) => ({ label: <bdi>{avatarName(m)}</bdi>, className: 'text-center normal-case tracking-normal' })),
          ]}
        >
          {rolls.map((r) => (
            <tr key={r.id} className="avoid-break">
              <td className={cn(tdNum, 'whitespace-nowrap')}>{fmtDate(r.date)}</td>
              {members.map((m) => {
                const st = cell.get(`${r.id}:${m.leader_id}`);
                const s = STATUS[st];
                return (
                  <td key={m.leader_id} className={cn(td, 'text-center')}>
                    {s ? (
                      <span className={s.cls} title={t(s.key)}>
                        <Mark kind={s.mark} />
                      </span>
                    ) : st === 'unmarked' ? (
                      <span className="text-muted-foreground">—</span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="border-t-2 border-muted-foreground font-semibold">
            <td className={td}>{t('leader.colPresence')}</td>
            {members.map((m) => (
              <td key={m.leader_id} className={cn(tdNum, 'text-center')}>
                {pct(m.present, m.present + m.absent + m.excused)}
              </td>
            ))}
          </tr>
        </Table>
      )}
      {/* The marks, spelled out once: the cells carry no words */}
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {['present', 'excused', 'absent'].map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={STATUS[k].cls}>
              <Mark kind={STATUS[k].mark} />
            </span>
            {t(STATUS[k].key)}
          </span>
        ))}
        <span>— {t('session.unmarked')}</span>
      </p>
      <Signature label={gendered(t, 'amanaRoll.signature', amana.section)} />
    </Sheet>
  );
}

const REPORTS = {
  'amana-presence': AmanaPresenceReport,
  period: PeriodReportSheet,
  'dues-arrears': DuesArrearsReport,
  event: EventReport,
  'event-unpaid': EventUnpaidReport,
  treasury: TreasuryReport,
  'branch-money': BranchMoneyReport,
  sessions: SessionReport,
  members: MemberReport,
  leaders: LeaderReport,
  branches: BranchReport,
  promotions: PromotionsReport,
  'members-list': MembersListReport,
  'leaders-list': LeadersListReport,
  'sessions-list': SessionsListReport,
  'prep-list': PrepListReport,
  plan: PlanReport,
  prep: PrepReport,
  meeting: MeetingReport,
  'meetings-list': MeetingsListReport,
  'meeting-decisions': MeetingDecisionsReport,
};

/* ============================================================
   Page: toolbar + sheet. The same URL is what the server prints to PDF.
   ============================================================ */

export default function PrintReport() {
  const { kind, id } = useParams();
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const { can } = usePerms();
  const cfg = KINDS[kind];
  const back = useBack(cfg?.back || '/');
  const [ready, setReady] = useState(null);
  const onReady = useCallback((title) => setReady(title), []);
  const kindLabel = cfg ? t(cfg.label) : '';

  // Opened from a scrolled detail page: the sheet must start at its header
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // The server names the PDF after the tab title
  useEffect(() => {
    if (!ready) return undefined;
    const prev = document.title;
    document.title = `${kindLabel} — ${ready}`;
    return () => {
      document.title = prev;
    };
  }, [ready, kindLabel]);

  const allowed = cfg && (!cfg.perm || can(cfg.perm));
  const Report = allowed ? REPORTS[kind] : null;

  return (
    <div
      className="print-light min-h-dvh bg-muted text-foreground print:min-h-0 print:bg-white"
      dir={i18n.dir()}
    >
      <div className="no-print glass sticky top-0 z-10 border-b border-border">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
          <Button variant="ghost" size="sm" onClick={back} className="-ms-2">
            <IconBack className="rtl:rotate-180" />
            {t('common.back')}
          </Button>
          <p className="hidden min-w-0 flex-1 text-xs text-muted-foreground sm:block">{t('print.hint')}</p>
          {allowed && <ExportPdfButton kind={kind} id={id} query={searchParams.toString()} variant="brand" className="ms-auto" />}
        </div>
      </div>

      <div className="px-2 py-4 sm:px-4 sm:py-6 print:p-0">
        {Report ? (
          <Report id={id} onReady={onReady} kindLabel={kindLabel} />
        ) : (
          <div data-print-error="">
            <EmptyState icon={<IconAlert className="h-6 w-6 text-destructive" />} title={t('print.notAllowed')} />
          </div>
        )}
      </div>
    </div>
  );
}
