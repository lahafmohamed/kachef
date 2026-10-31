import { displayError } from '../lib/errors';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, isFeminine } from '../api';
import { usePerms, useAuth } from '../auth';
import { useBack, useFetch } from '../hooks';
import { toDate } from '../lib/date';
import { fmtLongDate, gendered, userText } from '../lib/meetings';
import { DecisionMeta, MeetingKindBadge } from '../components/MeetingParts';
import EventParticipations from '../components/EventParticipations';
import ExportPdfButton from '../components/ExportPdfButton';
import { LeaderDuesCard } from '../components/LeaderDues';
import { AttendanceStrip, CodeTag, RateValue, UnderlineTabs, WhatsAppTile, phoneNumbers, telHref, waHref } from '../components/MemberParts';
import { avatarName, branchName, fmtDate, fmtPhone, memberName } from '../utils';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ProgressBar,
  Select,
  SkeletonPage,
  cn,
  useToast,
  IconAward,
  IconBack,
  IconCalendar,
  IconCheck,
  IconClipboard,
  IconPhone,
  IconShield,
} from '../components/ui';

const TABS = ['activities', 'card', 'dues', 'events', 'meetings', 'amana', 'profile', 'history'];

// His state on a meeting's list, as the minutes show it
const MEETING_STATUS = {
  present: { key: 'session.present', variant: 'success' },
  excused: { key: 'session.excused', variant: 'warning' },
  absent: { key: 'session.absent', variant: 'destructive' },
};

// الدورات التدريبية، بترتيب تدرّجها — مطابقة لـ TRAINING_COURSES في الخادم
const TRAINING_COURSES = ['qaid', 'chara', 'mudarrib', 'qaid_tadrib', 'moed_haqiba'];

// ar-LB gives the Levantine month names (أيلول، تشرين...) the فوج uses — the same
// headers as the عنصر profile. Latin digits, as everywhere else.
const intlLocale = (lng) => (lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR');
const fmtMonth = (iso, lng) =>
  new Intl.DateTimeFormat(intlLocale(lng), { month: 'long', year: 'numeric' }).format(toDate(iso));
const fmtWeekday = (iso, lng) => new Intl.DateTimeFormat(intlLocale(lng), { weekday: 'short' }).format(toDate(iso));

function ageOf(iso) {
  if (!iso) return null;
  const b = toDate(iso);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
  return age;
}

/**
 * Mixed scripts in one line: each part keeps its own direction. A short part also
 * stays whole, so a wrapped line breaks between two facts, never inside one. The «·»
 * holds on to the part before it (a no-break space), like a comma, so no wrapped line
 * opens on a lone «·».
 */
function Parts({ parts }) {
  return parts.filter(Boolean).map((p, i) => (
    <span key={i}>
      {i > 0 && <span aria-hidden="true">{'\u00a0· '}</span>}
      <bdi className={String(p).length <= 24 ? 'whitespace-nowrap' : undefined}>{p}</bdi>
    </span>
  ));
}

/** One figure of the profile's summary band — the same band as the عنصر profile. */
function Stat({ label, children, className }) {
  return (
    <div className={cn('min-w-0 space-y-2 bg-card p-4', className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Label over value; a field nobody filled in says so instead of vanishing. */
function Fact({ label, children, className }) {
  const empty = children == null || children === '' || children === false;
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 break-words text-sm', empty ? 'text-muted-foreground' : 'font-medium')}>
        {empty ? '—' : children}
      </dd>
    </div>
  );
}

function FactGroup({ title, children }) {
  return (
    <section className="space-y-3 p-4 sm:p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

// A نشاط of the القادة themselves has no فرقة: the API sends no branch name for it
const isLeadersOnly = (s) => !s.branch_name_fr && !s.branch_name_ar;

/** The أنشطة this قائد animated, grouped by month, newest first — each line opens its نشاط. */
function ActivityList({ rows, lang, feminine, t }) {
  const months = [];
  for (const s of rows) {
    const key = s.date.slice(0, 7);
    if (months.at(-1)?.key !== key) months.push({ key, rows: [] });
    months.at(-1).rows.push(s);
  }
  return (
    <div>
      {months.map(({ key, rows: mrows }) => {
        // As in the figures above: marked أنشطة only — an unmarked one says nothing yet
        const present = mrows.filter((s) => s.my_status === 'present').length;
        const marked = mrows.filter((s) => s.my_status).length;
        return (
          <section key={key} aria-labelledby={`act-${key}`}>
            <div className="flex items-baseline justify-between gap-3 border-y border-border bg-muted/40 px-4 py-1.5 first:border-t-0 sm:px-5">
              <h2 id={`act-${key}`} className="text-xs font-semibold text-muted-foreground">
                {fmtMonth(`${key}-01`, lang)}
              </h2>
              {marked > 0 && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  <span aria-hidden="true">
                    {present}/{marked}
                  </span>
                  <span className="sr-only">{t('leader.monthPresence', { present, marked })}</span>
                </span>
              )}
            </div>
            <ul className="divide-y divide-border">
              {mrows.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/sessions/${s.id}`}
                    className="focus-ring flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 sm:px-5"
                  >
                    <span className="w-9 shrink-0 text-center">
                      <span className="sr-only">{fmtDate(s.date)}</span>
                      <span aria-hidden="true" className="block text-lg font-semibold leading-none tabular-nums">
                        {Number(s.date.slice(8, 10))}
                      </span>
                      <span aria-hidden="true" className="mt-0.5 block text-[0.6875rem] text-muted-foreground">
                        {fmtWeekday(s.date, lang)}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{s.title}</span>
                      <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        <Parts
                          parts={[
                            isLeadersOnly(s) ? t('session.kindLeaders') : branchName(s, lang),
                            t(s.role === 'main' ? 'session.mainAnimator' : 'session.helper'),
                            s.present_count > 0 &&
                              t(feminine ? ['meeting.presentCountF', 'meeting.presentCount'] : 'meeting.presentCount', {
                                count: s.present_count,
                              }),
                          ]}
                        />
                      </span>
                    </span>
                    {s.my_status ? (
                      <Badge variant={s.my_status === 'present' ? 'success' : 'destructive'} className="shrink-0">
                        {t(s.my_status === 'present' ? 'session.present' : 'session.absent')}
                      </Badge>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">{t('session.unmarked')}</span>
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * بطاقة تقدم القائد: مطالب القادة للسنة، مطلبًا مطلبًا. لمن يملك التعديل السطرُ كلّه
 * زرّ — الإصبع لا يحتاج أن يصيب المربّع الصغير.
 */
function ProgressCard({ card, years, canEdit, onYear, onToggle, t }) {
  const pct = card.total ? Math.round((card.done_count / card.total) * 100) : 0;
  return (
    <Card className="overflow-hidden">
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{t(canEdit ? 'leader.cardHint' : 'leader.cardReadOnly')}</p>
            {card.total > 0 && (
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {card.done_count}
                <span className="text-base font-medium text-muted-foreground"> / {card.total}</span>
              </p>
            )}
          </div>
          {years.length > 0 && (
            <Select value={card.year} onChange={(e) => onYear(e.target.value)} aria-label={t('leader.cardYear')} className="w-auto">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          )}
        </div>
        {card.total > 0 && <ProgressBar value={pct} label={t('leader.card')} className="h-2" />}
      </div>

      {card.total === 0 ? (
        <EmptyState icon={<IconAward className="h-6 w-6" />} title={t('leader.cardEmpty')} className="border-t border-border">
          {t('leader.cardEmptyHint')}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {card.items.map((item) => {
            const inner = (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors',
                    item.done ? 'border-success bg-success text-success-foreground' : 'border-input bg-card'
                  )}
                >
                  {item.done && <IconCheck className="h-3.5 w-3.5" />}
                </span>
                <span className="w-6 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{item.number}</span>
                <span className={cn('min-w-0 flex-1 text-sm leading-snug', item.done ? 'font-medium' : 'text-foreground/90')}>
                  {item.label}
                </span>
                {item.achieved_at && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDate(item.achieved_at)}</span>
                )}
              </>
            );
            const row = cn('flex w-full items-center gap-3 px-4 py-3 text-start sm:px-5', item.done && 'bg-success/5');
            return (
              <li key={item.id}>
                {canEdit ? (
                  <button
                    type="button"
                    aria-pressed={item.done}
                    onClick={() => onToggle(item)}
                    className={cn(row, 'focus-ring min-h-12 cursor-pointer transition-colors hover:bg-accent/40')}
                  >
                    {inner}
                  </button>
                ) : (
                  <div className={row}>
                    <span className="sr-only">{t(item.done ? 'leader.cardDone' : 'leader.cardNotDone')}</span>
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** The five courses as a ladder, lowest first: each step taken or still ahead. */
function CourseLadder({ courses, t }) {
  const have = new Set(courses);
  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5">
      {TRAINING_COURSES.map((c, i) => {
        const on = have.has(c);
        return (
          <li
            key={c}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 sm:flex-col sm:items-start sm:gap-2',
              on ? 'border-primary/30 bg-accent' : 'border-dashed border-border'
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              )}
            >
              {on ? <IconCheck className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cn('text-sm leading-snug', on ? 'font-medium text-accent-foreground' : 'text-muted-foreground')}>
              {t(`leader.courseShort.${c}`)}
              <span className="sr-only"> — {t(on ? 'leader.courseTaken' : 'leader.courseNotTaken')}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The قائد in the meetings: how often he came over the last twelve months, the absences
 * without word in a row, the تكاليف handed to him still to do, and his last ten meetings.
 */
function LeaderMeetings({ data, section, t }) {
  const a = data.attendance;
  const d = data.decisions;
  const today = new Date().toISOString().slice(0, 10);
  const called = a.present + a.excused + a.absent;
  return (
    <>
      <Card className="grid grid-cols-3 gap-px overflow-hidden bg-border">
        {[
          ['present', 'text-success'],
          ['excused', 'text-warning'],
          ['absent', 'text-destructive'],
        ].map(([k, tone]) => (
          <Stat key={k} label={t(MEETING_STATUS[k].key)}>
            <p className={cn('text-2xl font-bold tabular-nums', a[k] > 0 ? tone : 'text-muted-foreground')}>{a[k]}</p>
          </Stat>
        ))}
      </Card>
      <p className="-mt-2 text-xs text-muted-foreground">
        {called ? t('leader.meetingsSince', { count: called }) : t('leader.meetingsNone')}
        {data.absent_streak >= 2 && (
          <span className="font-medium text-destructive">
            {' · '}
            {t('leader.meetingsStreak', { count: data.absent_streak })}
          </span>
        )}
      </p>

      {/* التكاليف: what is still his to do, the late ones first by date */}
      <Card className="overflow-hidden">
        <div className="px-4 pb-3 pt-4 sm:px-5">
          <h2 className="text-base font-semibold">{t('leader.meetingsTasks')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {d.open + d.done === 0
              ? t('leader.meetingsTasksNone')
              : [d.open > 0 && t('meeting.openCount', { count: d.open }), d.done > 0 && t('meeting.doneCount', { count: d.done })]
                  .filter(Boolean)
                  .join(' · ')}
            {d.late > 0 && (
              <span className="font-medium text-destructive">
                {' · '}
                {t('meeting.overdueCount', { count: d.late })}
              </span>
            )}
          </p>
        </div>
        {d.open_list.length > 0 && (
          <ul className="divide-y divide-border border-t border-border">
            {d.open_list.map((x) => (
              <li key={x.id}>
                <Link
                  to={`/meetings/${x.meeting_id}`}
                  className="focus-ring block px-4 py-3 transition-colors hover:bg-accent/40 sm:px-5"
                >
                  <span className="block text-sm font-medium [overflow-wrap:anywhere]">
                    <bdi>{userText(x.text)}</bdi>
                  </span>
                  <DecisionMeta
                    d={x}
                    t={t}
                    today={today}
                    extra={[
                      <span key="from">
                        {t('meeting.fromMeeting', { date: fmtDate(x.meeting_date), title: userText(x.meeting_title) })}
                      </span>,
                    ]}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data.recent.length > 0 && (
        <Card className="overflow-hidden">
          <h2 className="px-4 pb-3 pt-4 text-base font-semibold sm:px-5">{t('leader.meetingsRecent')}</h2>
          <ul className="divide-y divide-border border-t border-border">
            {data.recent.map((m) => (
              <li key={m.id}>
                <Link
                  to={`/meetings/${m.id}`}
                  className="focus-ring flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium [overflow-wrap:anywhere]">
                      <bdi>{userText(m.title)}</bdi>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="tabular-nums">{fmtDate(m.date)}</span>
                      <MeetingKindBadge kind={m.kind} t={t} />
                      {m.chair && <span>{gendered(t, 'meeting.chair', section)}</span>}
                      {m.secretary && <span>{gendered(t, 'meeting.secretary', section)}</span>}
                    </span>
                  </span>
                  {MEETING_STATUS[m.status] && (
                    <Badge variant={MEETING_STATUS[m.status].variant} className="shrink-0">
                      {t(MEETING_STATUS[m.status].key)}
                    </Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/**
 * The قائد in his أمانة: what its أمين marked for him on the days the team went along
 * with the فرق — the figures of the chosen période, the absences without word in a
 * row, and the last sheets.
 */
function LeaderAmanaPresence({ data, section, lang, t }) {
  const a = data.attendance;
  const marked = a.present + a.excused + a.absent;
  const rate = marked ? Math.round((a.present / marked) * 100) : null;
  return (
    <>
      <Card className="grid grid-cols-3 gap-px overflow-hidden bg-border">
        {[
          ['present', 'text-success'],
          ['excused', 'text-warning'],
          ['absent', 'text-destructive'],
        ].map(([k, tone]) => (
          <Stat key={k} label={t(MEETING_STATUS[k].key)}>
            <p className={cn('text-2xl font-bold tabular-nums', a[k] > 0 ? tone : 'text-muted-foreground')}>{a[k]}</p>
          </Stat>
        ))}
      </Card>
      {/* Inline, not flex: each «·» holds on to the part before it, so a wrapped line
          never opens on a lone one */}
      <p className="-mt-2 text-xs text-muted-foreground">
        {marked ? t('amanaRoll.periodDays', { count: marked }) : t('amanaRoll.periodNone')}
        {rate !== null && (
          <>
            {' · '}
            <RateValue rate={rate} className="text-xs" />
          </>
        )}
        {data.absent_streak >= 2 && (
          <>
            {' · '}
            <span className="font-medium text-destructive">
              {gendered(t, 'amanaRoll.streak', section, { count: data.absent_streak })}
            </span>
          </>
        )}
      </p>

      <Card className="overflow-hidden">
        <h2 className="px-4 pb-3 pt-4 text-base font-semibold sm:px-5">{t('amanaRoll.recent')}</h2>
        <ul className="divide-y divide-border border-t border-border">
          {data.recent.map((r) => (
            <li key={r.roll_id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{fmtLongDate(r.date, lang)}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  <Parts parts={[r.title, r.reason && t(`followup.reason.${r.reason}`)]} />
                </span>
              </span>
              <Badge variant={MEETING_STATUS[r.status].variant} className="shrink-0">
                {t(MEETING_STATUS[r.status].key)}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export default function LeaderDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const back = useBack('/leaders');
  const toast = useToast();
  const { has } = usePerms();
  const { user } = useAuth();
  // Filling in بطاقة تقدم القائد is its own permission; everyone else reads it
  const canEditCard =
    has('leaders.progress.manage') || (has('leaders.progress.self') && Number(user?.leader_id) === Number(id));
  // '' = the year the server picks (the latest تشكيلة year)
  const [cardYear, setCardYear] = useState('');
  // Bug 13 : les chiffres de l'année scoute en cours, ou ('all') depuis toujours
  const [statsPeriod, setStatsPeriod] = useState('');
  const [sp, setSp] = useSearchParams();
  // الاشتراك الشهري: لمن يملك صلاحيته، و للقائد نفسه في صفحته
  const canSeeDues = has('leaders.dues') || Number(user?.leader_id) === Number(id);
  // المخيمات و الدورات: لمن يرى المخيمات
  const canEvents = has('events.read');
  // الاجتماعات: لمن يقرأ المحاضر
  const canMeetings = has('meetings.read');
  const allowed = (v) =>
    (v !== 'dues' || canSeeDues) && (v !== 'events' || canEvents) && (v !== 'meetings' || canMeetings);
  const tab = TABS.includes(sp.get('tab')) && allowed(sp.get('tab')) ? sp.get('tab') : 'activities';
  const setTab = (next) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        next === 'activities' ? n.delete('tab') : n.set('tab', next);
        return n;
      },
      { replace: true }
    );
  const {
    data: leader,
    setData: setLeader,
    loading,
    error,
    errorStatus,
    reload,
  } = useFetch(
    `/leaders/${id}?${new URLSearchParams({
      ...(cardYear ? { year: cardYear } : {}),
      ...(statsPeriod ? { period: statsPeriod } : {}),
    })}`
  );
  const events = useFetch(`/leaders/${id}/events`, { skip: !canEvents });

  async function toggleMatlab(item) {
    try {
      const card = await api.post(`/leaders/${id}/progress`, {
        year: leader.card.year,
        matlab_id: item.id,
        done: !item.done,
      });
      setLeader((l) => ({ ...l, card }));
      toast.success(t('leader.cardUpdated'));
    } catch (err) {
      toast.error(displayError(err));
    }
  }

  if (loading && !leader) return <SkeletonPage rows={4} />;
  // A قائد that is not there to show — an old link, or one outside this account's قسم
  // (404 / 403): no retry brings him back, the way out does
  if (errorStatus === 404 || errorStatus === 403)
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={back} className="-ms-2">
          <IconBack className="rtl:rotate-180" />
          {t('leader.leadersList')}
        </Button>
        <Card>
          <EmptyState icon={<IconShield className="h-6 w-6" />} title={t('error.notFoundTitle')}>
            {t('error.notFoundBody')}
          </EmptyState>
        </Card>
      </div>
    );
  if (error)
    return <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />;

  const name = memberName(leader);
  const active = leader.status === 'active';
  const age = ageOf(leader.birth_date);
  const phones = phoneNumbers(leader.phone);
  const roles = leader.current_roles;

  // Présence as an animator: marked أنشطة only — an unmarked one says nothing yet
  // The figures cover the chosen période (the server's stats_period); the list keeps it all
  const att = leader.attendance || { present: 0, absent: 0 };
  const marked = att.present + att.absent;
  const rate = marked ? Math.round((att.present / marked) * 100) : null;
  const statsRange = leader.stats_period;
  const inPeriod = (s) => !statsRange?.from || (s.date >= statsRange.from && s.date <= statsRange.to);
  const recent = leader.sessions
    .filter((s) => (s.my_status === 'present' || s.my_status === 'absent') && inPeriod(s))
    .slice(0, 10)
    .map((s) => ({ date: s.date, status: s.my_status }));
  const done = att.sessions ?? leader.sessions.length;
  const led = att.led ?? leader.sessions.filter((s) => s.role === 'main').length;

  // بطاقة تقدم القائد for the selected سنة — empty until the مطالب list is filled in
  const card = leader.card || { year: '', total: 0, done_count: 0, items: [] };

  // Role history by year, newest first
  const byYear = [];
  for (const a of leader.assignments) {
    const g = byYear.find((x) => x.year === a.year);
    if (g) g.roles.push(a);
    else byYear.push({ year: a.year, roles: [a] });
  }
  const visits = leader.visits || [];
  const preps = leader.prep_cards || [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={back} className="-ms-2">
          <IconBack className="rtl:rotate-180" />
          {t('leader.leadersList')}
        </Button>
        <ExportPdfButton kind="leaders" id={leader.id} compact />
      </div>

      {/* ---------- Who: name, المسؤولية this year, and the number to call ---------- */}
      <section aria-labelledby="leader-name" className="space-y-4">
        <div className="flex items-start gap-4">
          <Avatar
            photo={leader.photo}
            name={avatarName(leader)}
            className={cn(
              'h-16 w-16 bg-accent text-lg text-accent-foreground sm:h-20 sm:w-20 sm:text-xl',
              !active && 'opacity-60 grayscale'
            )}
          />
          <div className="min-w-0 flex-1 pt-1">
            {/* <bdi>, not dir="auto" on the heading: an Arabic name keeps its letter
                order, but stays aligned with the page — next to its avatar in French */}
            <h1 id="leader-name" className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              <bdi>{name}</bdi>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
              <CodeTag code={leader.code} className="rounded-md border border-border px-1.5 py-0.5 text-foreground" />
              <span>
                <Parts
                  parts={[
                    ...(roles.length ? roles.map((r) => r.title) : [t('leader.noRole')]),
                    age != null && t('common.age', { count: age }),
                    leader.join_year && t('leader.since', { year: leader.join_year }),
                  ]}
                />
              </span>
              {!active && <Badge variant="secondary">{t('member.inactive')}</Badge>}
            </div>
          </div>
        </div>

        {/* One tile per number: a قائد's phone field sometimes holds two */}
        {phones.length > 0 && (
          <ul className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            {phones.map((n) => (
              <li key={n} className="flex min-w-0 gap-2">
                <a
                  href={telHref(n)}
                  aria-label={`${t('member.call')} ${name} — ${fmtPhone(n)}`}
                  className="focus-ring flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 shadow-xs transition-colors hover:border-primary/35 hover:bg-accent sm:pe-4"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                    <IconPhone className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="block text-xs text-muted-foreground">{t('leader.phone')}</span>
                    <span dir="ltr" className="block whitespace-nowrap text-sm font-medium tabular-nums rtl:text-right">
                      {fmtPhone(n)}
                    </span>
                  </span>
                </a>
                <WhatsAppTile href={waHref(n)} label={`${t('member.whatsapp')} ${name} — ${fmtPhone(n)}`} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- The four figures a قائد المسؤول checks ---------- */}
      <div className="flex justify-end">
        <Select
          value={statsPeriod}
          onChange={(e) => setStatsPeriod(e.target.value)}
          aria-label={t('statsPeriod.label')}
          className="w-auto"
        >
          <option value="">{t('statsPeriod.thisYear')}</option>
          <option value="all">{t('statsPeriod.allTime')}</option>
        </Select>
      </div>
      <Card className="-mt-3 grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-4">
        <Stat label={t('leader.colPresence')}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <RateValue rate={rate} className="text-2xl font-bold" />
            {marked > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('member.presentOf', { present: att.present, total: marked })}
              </span>
            )}
          </div>
          <AttendanceStrip recent={recent} size="md" />
        </Stat>
        <Stat label={t('leader.colActivities')}>
          <p className="text-2xl font-bold tabular-nums">{done}</p>
          <p className="text-xs text-muted-foreground">
            {/* «none yet» only when there is none at all: one he only helped in still counts */}
            {done > 0 ? t('leader.ledShort', { count: led }) : t('leader.noActivities')}
          </p>
        </Stat>
        <Stat label={t('leader.colService')}>
          {/* Not filled in: the same muted «—» as an empty بطاقة or présence */}
          {leader.years_ghadir != null ? (
            <p className="text-2xl font-bold tabular-nums">
              {leader.years_ghadir}
              <span className="text-base font-medium text-muted-foreground"> {t('common.yearsUnit', { count: leader.years_ghadir })}</span>
            </p>
          ) : (
            <p className="text-2xl font-bold text-muted-foreground">—</p>
          )}
          <p className="text-xs text-muted-foreground">
            {leader.years_total > leader.years_ghadir
              ? t('leader.totalShort', { count: leader.years_total })
              : leader.join_year
                ? t('leader.since', { year: leader.join_year })
                : ' '}
          </p>
        </Stat>
        <Stat label={t('leader.colCard')}>
          {card.total > 0 ? (
            <>
              <p className="text-2xl font-bold tabular-nums">
                {card.done_count}
                <span className="text-base font-medium text-muted-foreground"> / {card.total}</span>
              </p>
              <ProgressBar
                value={Math.round((card.done_count / card.total) * 100)}
                label={t('leader.card')}
                className="h-2"
              />
            </>
          ) : (
            <p className="text-2xl font-bold text-muted-foreground">—</p>
          )}
        </Stat>
      </Card>

      <div className="space-y-4">
        <UnderlineTabs
          items={[
            { id: 'activities', label: t('leader.colActivities'), count: leader.sessions.length + visits.length },
            { id: 'card', label: t('leader.colCard'), count: card.total ? `${card.done_count}/${card.total}` : null },
            ...(canSeeDues ? [{ id: 'dues', label: t('dues.tab') }] : []),
            // A camp he was taken off the list of is in his file, but not among those he took part in
            ...(canEvents
              ? [{ id: 'events', label: t('nav.events'), count: events.data?.filter((e) => !e.withdrawn).length || null }]
              : []),
            ...(leader.meetings
              ? [{ id: 'meetings', label: t('meeting.title') }]
              : []),
            // حضور الأمانة: only for a قائد his أمين has already marked
            ...(leader.amana_presence ? [{ id: 'amana', label: t('amanaRoll.tab') }] : []),
            { id: 'profile', label: t('member.profile') },
            { id: 'history', label: t('member.history') },
          ]}
          value={tab}
          onChange={setTab}
          label={name}
          idPrefix="leader-tab"
          panelId="leader-panel"
        />

        <div id="leader-panel" role="tabpanel" aria-labelledby={`leader-tab-${tab}`} className="space-y-4">
          {tab === 'dues' && <LeaderDuesCard endpoint={`/leaders/${leader.id}/dues`} />}
          {tab === 'activities' && (
            <>
              <Card className="overflow-hidden">
                {leader.sessions.length === 0 ? (
                  <EmptyState icon={<IconShield className="h-6 w-6" />} title={t('leader.noActivities')}>
                    {t('leader.noActivitiesHint')}
                  </EmptyState>
                ) : (
                  <ActivityList rows={leader.sessions} lang={lang} feminine={isFeminine(leader.section)} t={t} />
                )}
              </Card>

              {/* زيارات الأهل — listed apart from the أنشطة this قائد animated */}
              {visits.length > 0 && (
                <Card className="overflow-hidden">
                  <div className="flex items-baseline justify-between gap-2 px-4 pb-3 pt-4 sm:px-5">
                    <h2 className="text-base font-semibold">{t('session.familyVisits')}</h2>
                    <span className="text-sm tabular-nums text-muted-foreground">{visits.length}</span>
                  </div>
                  <ul className="divide-y divide-border border-t border-border">
                    {visits.map((v) => (
                      <li key={v.id}>
                        <Link
                          to={`/sessions/${v.id}`}
                          className="focus-ring block px-4 py-3 transition-colors hover:bg-accent/40 sm:px-5"
                        >
                          <span className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-sm font-medium">{v.title}</span>
                            <span className="text-xs tabular-nums text-muted-foreground">{fmtDate(v.date)}</span>
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            <Parts
                              parts={[
                                branchName(v, lang),
                                t(v.role === 'main' ? 'session.mainAnimator' : 'session.helper'),
                              ]}
                            />
                            {/* The عناصر visited: a long list wraps between two names, never inside one */}
                            {v.members?.length > 0 && (
                              <>
                                <span aria-hidden="true">{'\u00a0· '}</span>
                                {v.members.map((m, i) => (
                                  <span key={m.id}>
                                    {i > 0 && t('member.listSep')}
                                    <bdi className="whitespace-nowrap">{memberName(m)}</bdi>
                                  </span>
                                ))}
                              </>
                            )}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}

          {tab === 'card' && (
            <ProgressCard
              card={card}
              years={leader.card_years || []}
              canEdit={canEditCard}
              onYear={setCardYear}
              onToggle={toggleMatlab}
              t={t}
            />
          )}

          {tab === 'profile' && (
            <Card className="divide-y divide-border">
              <FactGroup title={t('member.sectionIdentity')}>
                <Fact label={t('member.birthDate')}>
                  {leader.birth_date && (
                    <span className="tabular-nums">
                      {fmtDate(leader.birth_date)}
                      {age != null && ` · ${t('common.age', { count: age })}`}
                    </span>
                  )}
                </Fact>
                <Fact label={t('member.birthPlace')}>{leader.birth_place}</Fact>
                <Fact label={t('leader.maritalStatus')}>
                  {leader.marital_status && t(leader.marital_status === 'married' ? 'leader.married' : 'leader.single')}
                </Fact>
                <Fact label={t('member.bloodType')}>{leader.blood_type && <span dir="ltr">{leader.blood_type}</span>}</Fact>
                <Fact label={t('member.addressAbidjan')}>{leader.address_abidjan}</Fact>
                <Fact label={t('member.addressLebanon')}>{leader.address_lebanon}</Fact>
              </FactGroup>
              <FactGroup title={t('leader.sectionPath')}>
                <Fact label={t('leader.joinYear')}>
                  {leader.join_year && <span className="tabular-nums">{leader.join_year}</span>}
                </Fact>
                <Fact label={t('leader.yearsGhadir')}>
                  {leader.years_ghadir != null && <span className="tabular-nums">{leader.years_ghadir}</span>}
                </Fact>
                <Fact label={t('leader.yearsTotal')}>
                  {leader.years_total != null && <span className="tabular-nums">{leader.years_total}</span>}
                </Fact>
                <Fact label={t('leader.education')}>{leader.education}</Fact>
              </FactGroup>
              <section className="space-y-3 p-4 sm:p-5">
                <h2 className="text-sm font-semibold">{t('leader.trainingLevel')}</h2>
                <CourseLadder courses={leader.training_level || []} t={t} />
              </section>
            </Card>
          )}

          {tab === 'events' && canEvents && <EventParticipations state={events} feminine={isFeminine(leader.section)} />}

          {tab === 'meetings' && leader.meetings && <LeaderMeetings data={leader.meetings} section={leader.section} t={t} />}

          {tab === 'amana' && leader.amana_presence && (
            <LeaderAmanaPresence data={leader.amana_presence} section={leader.section} lang={lang} t={t} />
          )}

          {tab === 'history' && (
            <>
              {byYear.length === 0 && preps.length === 0 && (
                <Card>
                  <EmptyState icon={<IconCalendar className="h-6 w-6" />} title={t('leader.historyEmpty')} />
                </Card>
              )}

              {/* One line per سنة: what this قائد held in the تشكيلة that year */}
              {byYear.length > 0 && (
                <Card className="overflow-hidden">
                  <h2 className="px-4 pb-3 pt-4 text-base font-semibold sm:px-5">{t('leader.rolesHistory')}</h2>
                  <ol className="divide-y divide-border border-t border-border">
                    {byYear.map((g) => (
                      <li key={g.year} className="flex flex-wrap gap-x-6 gap-y-2 px-4 py-3 sm:px-5">
                        <div className="w-28 shrink-0">
                          <span className="block font-semibold tabular-nums" dir="ltr">
                            {g.year}
                          </span>
                          {g.year === leader.year && (
                            <span className="text-xs font-medium text-primary">{t('leader.currentRoles')}</span>
                          )}
                        </div>
                        <ul className="min-w-0 flex-1 space-y-1.5">
                          {g.roles.map((r) => (
                            <li key={r.id} className="text-sm">
                              <span className="font-medium">{r.title}</span>
                              <span className="text-muted-foreground">
                                {' · '}
                                {r.branch_id ? branchName(r, lang) : t('leader.amanat')}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                </Card>
              )}

              {/* بطاقات التحضير التي أعدّها — تشهد في سجلّه أنه حضّر لأنشطته قبل السبت */}
              {preps.length > 0 && (
                <Card className="overflow-hidden">
                  <div className="flex items-baseline justify-between gap-2 px-4 pb-3 pt-4 sm:px-5">
                    <h2 className="flex items-center gap-2 text-base font-semibold">
                      <IconClipboard className="h-4 w-4 text-muted-foreground" />
                      {t('prep.leaderSection')}
                    </h2>
                    <span className="text-sm tabular-nums text-muted-foreground">{preps.length}</span>
                  </div>
                  <ul className="divide-y divide-border border-t border-border">
                    {preps.map((c) => (
                      <li key={c.id}>
                        <Link
                          to={`/prep-cards/${c.id}`}
                          className="focus-ring flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 transition-colors hover:bg-accent/40 sm:px-5"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{c.title}</span>
                            <span className="block text-xs text-muted-foreground">{branchName(c, lang)}</span>
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDate(c.date)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
