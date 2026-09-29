import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, usePerms } from '../auth';
import { useBack, useFetch } from '../hooks';
import ExportPdfButton from '../components/ExportPdfButton';
import {
  activityTypeKey,
  avatarName,
  branchName,
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
  'prep-list': { perm: 'sessions.read', label: 'print.reportPrepList', back: '/prep-cards' },
  plan: { perm: 'branches.read', label: 'print.reportPlan', back: '/branches' },
  prep: { perm: 'sessions.read', label: 'print.reportPrep', back: '/prep-cards' },
};

const pct = (num, den) => (den ? `${Math.round((num / den) * 100)}%` : '—');

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
      <header className="flex items-center justify-between gap-4 border-b-2 border-primary pb-3">
        <div className="flex items-center gap-3">
          <img src="/logo-mark.png" alt="" width={56} height={56} className="h-14 w-14 shrink-0" />
          <div>
            <div className="text-lg font-bold leading-tight text-primary">{t('app.name')}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {kindLabel}
            </div>
          </div>
        </div>
        <div className="text-end text-[11px] leading-relaxed text-muted-foreground">
          <div className="tabular-nums">{t('print.generatedOn', { date: today })}</div>
          {user && <div>{t('print.generatedBy', { name: user.display_name || user.username })}</div>}
        </div>
      </header>

      {children}

      <footer className="mt-10 flex justify-between border-t border-border pt-2 text-[10px] text-muted-foreground">
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

function H2({ children, aside }) {
  return (
    <div className="avoid-break mb-2 mt-6 flex items-baseline justify-between gap-3 border-b border-border pb-1">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-primary">{children}</h2>
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
          <dt className="text-[10.5px] text-muted-foreground">{label}</dt>
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

function Stats({ items }) {
  return (
    <div className="avoid-break grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((s) => (
        <div key={s.label} className="rounded-lg border border-border px-3 py-2">
          <div className={cn('text-xl font-bold leading-none tabular-nums', s.cls)}>{s.value}</div>
          <div className="mt-1 text-[10.5px] leading-tight text-muted-foreground">{s.label}</div>
          {s.hint && <div className="text-[10px] leading-tight text-muted-foreground">{s.hint}</div>}
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

function Table({ head, children, className }) {
  return (
    <table className={cn('w-full border-collapse text-[12px]', className)}>
      <thead>
        <tr className="border-b border-foreground/50">
          {head.map((h, i) => {
            const label = typeof h === 'string' ? h : h.label;
            const cls = typeof h === 'string' ? undefined : h.className;
            return (
              <th
                key={i}
                scope="col"
                className={cn(
                  'py-1.5 pe-3 text-start text-[10px] font-semibold uppercase tracking-wide text-muted-foreground',
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
  );
}

const td = 'py-1.5 pe-3 align-top';
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
    <div className="avoid-break mt-10 grid grid-cols-2 gap-8">
      <div />
      <div>
        <div className="h-12 border-b border-foreground/50" />
        <div className="mt-1 text-[10.5px] text-muted-foreground">{label}</div>
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
        ...(showPaid ? [{ label: t('session.subscriptions'), className: 'text-end' }] : []),
        t('member.status'),
      ]}
    >
      {rows.map((m, i) => (
        <tr key={m.id}>
          <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
          <td className={cn(td, 'font-medium')}>
            {memberName(m)}
            {m.consecutive_absences >= 3 && (
              <Tag tone="destructive" className="ms-2">
                {t('member.consecutiveAbsences', { count: m.consecutive_absences })}
              </Tag>
            )}
          </td>
          <td className={cn(td, 'text-muted-foreground')}>{m.group_name || '—'}</td>
          {showPaid && (
            <td className={cn(tdNum, 'w-24 text-end font-medium')}>
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
            [t('session.fee'), session.fee !== null && session.fee !== undefined ? session.fee : null],
            [
              t('session.requirementsShort'),
              session.matalib?.length ? session.matalib.join(' · ') : null,
              true,
            ],
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

      {/* ---------- لائحة العناصر ---------- */}
      {!isLeaders && !isGroup && (
        <>
          <H2 aside={t('session.marked', { marked: counts.marked, total: roster.length })}>
            {t(isVisit ? 'session.visitedMembers' : 'session.roster')}
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
            {m.age != null && `${m.age} ${t('common.years')} · `}
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
            cls: stats.consecutive_absences >= 3 ? 'text-destructive' : undefined,
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
                <td className={cn(tdNum, 'w-24 text-muted-foreground')}>{fmtDate(p.promoted_at)}</td>
                <td className={cn(td, 'font-medium')}>
                  {lng === 'ar' ? p.old_name_ar : p.old_name_fr} →{' '}
                  {lng === 'ar' ? p.new_name_ar : p.new_name_fr}
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
            <tr className="border-t border-foreground/50">
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
        {card.year ? ` · ${card.year}` : ''}
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
                <td className={cn(tdNum, 'w-24 font-semibold')} dir="ltr">
                  {g.year}
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
            { label: t('session.present'), className: 'text-end' },
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
    if (s.kind !== 'activity' || s.date > today) continue;
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
              <td className={cn(tdNum, 'text-muted-foreground')} dir="ltr">
                {s.matalib?.length ? s.matalib.join(' ') : ''}
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
  ];

  return (
    <Sheet kindLabel={kindLabel}>
      <H1>{name}</H1>
      <Tags>
        <Tag tone="neutral">{t('promotion.pendingCount', { count: list.length })}</Tag>
        <Tag tone="neutral">{fmtDate(todayISO())}</Tag>
      </Tags>

      <H2 aside={list.length || null}>{t('promotion.pending')}</H2>
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
      <H2 aside={rows.length || null}>{kindLabel}</H2>
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
      rows={list.map((m, i) => (
        <tr key={m.id}>
          <td className={cn(tdNum, 'w-8 text-muted-foreground')}>{i + 1}</td>
          <td className={cn(td, 'font-medium')}>{memberName(m)}</td>
          <td className={tdNum}>{m.age ?? '—'}</td>
          {all && <td className={td}>{branchName(m, lng)}</td>}
          <td className={cn(td, 'text-muted-foreground')}>{m.group_name || '—'}</td>
          <td className={cn(tdNum, 'text-muted-foreground')}>{fmtPhone(m.parent_phone) || '—'}</td>
          <td className={td}>{t(m.status === 'active' ? 'member.active' : 'member.inactive')}</td>
        </tr>
      ))}
    />
  );
}

function LeadersListReport({ onReady, kindLabel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const res = useFetch('/leaders');
  const title = t('leader.leadersList');
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
      count={String(list.length)}
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
          <td className={cn(tdNum, 'text-muted-foreground')}>{fmtPhone(l.phone) || '—'}</td>
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
      count={String(list.length)}
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
      count={String(list.length)}
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
  if (!b || !plan) return res.error && res.error.status !== 404 ? <LoadError onRetry={res.reload} /> : <NotFound />;

  return (
    <ListSheet
      kindLabel={kindLabel}
      title={title}
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
                  <div className="text-xs font-normal text-muted-foreground">
                    {t('branch.planWas')} {item.base.title}
                    {item.base.date !== item.date && ` · ${fmtDate(item.base.date)}`}
                  </div>
                )}
                {plan.validation && !item.base && (
                  <div className="text-xs font-normal text-muted-foreground">{t('branch.planAdded')}</div>
                )}
              </td>
              <td className={cn(td, item.session ? 'text-success' : 'text-muted-foreground')}>
                {item.session ? t('print.planDone', { date: fmtDate(item.session.date) }) : t('branch.planNotDone')}
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
      <Facts
        items={[
          [t('prep.author'), c.leader || '—'],
          [t('prep.matalib'), (c.matalib || []).join('، ') || null],
        ]}
      />
      {texts.map(([key, v]) => (
        <div key={key}>
          <H2>{t(key)}</H2>
          <p className="whitespace-pre-line leading-relaxed">{v}</p>
        </div>
      ))}
    </Sheet>
  );
}

const REPORTS = {
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
