import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms, useAuth } from '../auth';
import { useBack, useFetch } from '../hooks';
import { toDate } from '../lib/date';
import ExportPdfButton from '../components/ExportPdfButton';
import { AttendanceStrip, RateValue, UnderlineTabs, phoneNumbers, telHref } from '../components/MemberParts';
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

const TABS = ['activities', 'card', 'profile', 'history'];

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

/** Mixed scripts in one line: each part keeps its own direction. */
function Parts({ parts }) {
  return parts.filter(Boolean).map((p, i) => (
    <span key={i}>
      {i > 0 && <span aria-hidden="true"> · </span>}
      <bdi>{p}</bdi>
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
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

// A نشاط of the القادة themselves has no فرقة: the API sends no branch name for it
const isLeadersOnly = (s) => !s.branch_name_fr && !s.branch_name_ar;

/** The أنشطة this قائد animated, grouped by month, newest first — each line opens its نشاط. */
function ActivityList({ rows, lang, t }) {
  const months = [];
  for (const s of rows) {
    const key = s.date.slice(0, 7);
    if (months.at(-1)?.key !== key) months.push({ key, rows: [] });
    months.at(-1).rows.push(s);
  }
  return (
    <div>
      {months.map(({ key, rows: mrows }) => (
        <section key={key} aria-labelledby={`act-${key}`}>
          <div className="flex items-baseline justify-between gap-3 border-y border-border bg-muted/40 px-4 py-1.5 first:border-t-0 sm:px-5">
            <h3 id={`act-${key}`} className="text-xs font-semibold text-muted-foreground">
              {fmtMonth(`${key}-01`, lang)}
            </h3>
            <span className="text-xs tabular-nums text-muted-foreground">
              {mrows.filter((s) => s.my_status === 'present').length}/{mrows.length}
            </span>
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
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      <Parts
                        parts={[
                          isLeadersOnly(s) ? t('session.kindLeaders') : branchName(s, lang),
                          t(s.role === 'main' ? 'session.mainAnimator' : 'session.helper'),
                          s.present_count > 0 && `${s.present_count} ${t('session.present')}`,
                        ]}
                      />
                    </span>
                  </span>
                  {s.my_status ? (
                    <Badge variant={s.my_status === 'present' ? 'success' : 'destructive'} className="shrink-0">
                      {t(s.my_status === 'present' ? 'session.present' : 'session.absent')}
                    </Badge>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">—</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
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
    <ol className="grid gap-2 sm:grid-cols-5">
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
  const [sp, setSp] = useSearchParams();
  const tab = TABS.includes(sp.get('tab')) ? sp.get('tab') : 'activities';
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
    reload,
  } = useFetch(`/leaders/${id}${cardYear ? `?year=${encodeURIComponent(cardYear)}` : ''}`);

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
      toast.error(err.message);
    }
  }

  if (loading && !leader) return <SkeletonPage rows={4} />;
  if (error)
    return <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />;

  const name = memberName(leader);
  const active = leader.status === 'active';
  const age = ageOf(leader.birth_date);
  const phones = phoneNumbers(leader.phone);
  const roles = leader.current_roles;

  // Présence as an animator: marked أنشطة only — an unmarked one says nothing yet
  const att = leader.attendance || { present: 0, absent: 0 };
  const marked = att.present + att.absent;
  const rate = marked ? Math.round((att.present / marked) * 100) : null;
  const recent = leader.sessions
    .filter((s) => s.my_status === 'present' || s.my_status === 'absent')
    .slice(0, 10)
    .map((s) => ({ date: s.date, status: s.my_status }));
  const led = leader.sessions.filter((s) => s.role === 'main').length;

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
              <span>
                <Parts
                  parts={[
                    ...(roles.length ? roles.map((r) => r.title) : [t('leader.noRole')]),
                    age != null && `${age} ${t('common.years')}`,
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
          <ul className="grid gap-2 sm:flex sm:flex-wrap">
            {phones.map((n) => (
              <li key={n} className="min-w-0">
                <a
                  href={telHref(n)}
                  aria-label={`${t('member.call')} ${name} — ${fmtPhone(n)}`}
                  className="focus-ring flex min-h-12 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 shadow-xs transition-colors hover:border-primary/35 hover:bg-accent sm:pe-4"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <IconPhone className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="block text-xs text-muted-foreground">{t('leader.phone')}</span>
                    <span dir="ltr" className="block whitespace-nowrap text-sm font-medium tabular-nums rtl:text-right">
                      {fmtPhone(n)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- The four figures a قائد المسؤول checks ---------- */}
      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-4">
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
          <p className="text-2xl font-bold tabular-nums">{leader.sessions.length}</p>
          <p className="text-xs text-muted-foreground">
            {led > 0 ? t('leader.ledShort', { count: led }) : t('leader.noActivities')}
          </p>
        </Stat>
        <Stat label={t('leader.colService')}>
          <p className="text-2xl font-bold tabular-nums">
            {leader.years_ghadir ?? '—'}
            {leader.years_ghadir != null && (
              <span className="text-base font-medium text-muted-foreground"> {t('common.years')}</span>
            )}
          </p>
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
          {tab === 'activities' && (
            <>
              <Card className="overflow-hidden">
                {leader.sessions.length === 0 ? (
                  <EmptyState icon={<IconShield className="h-6 w-6" />} title={t('leader.noActivities')} />
                ) : (
                  <ActivityList rows={leader.sessions} lang={lang} t={t} />
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
                                v.members?.length > 0 && v.members.map(memberName).join(t('member.listSep')),
                              ]}
                            />
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
                      {age != null && ` · ${age} ${t('common.years')}`}
                    </span>
                  )}
                </Fact>
                <Fact label={t('leader.maritalStatus')}>
                  {leader.marital_status && t(leader.marital_status === 'married' ? 'leader.married' : 'leader.single')}
                </Fact>
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
                <h3 className="text-sm font-semibold">{t('leader.trainingLevel')}</h3>
                <CourseLadder courses={leader.training_level || []} t={t} />
              </section>
            </Card>
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
