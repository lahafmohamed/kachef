import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useBack, useFetch } from '../hooks';
import { toDate } from '../lib/date';
import { avatarName, birthdayWhen, branchName, fmtAmount, fmtDate, fmtPhone, memberName } from '../utils';
import ExportPdfButton from '../components/ExportPdfButton';
import MemberFormDialog from '../components/MemberForm';
import { AttendanceStrip, RateValue, UnderlineTabs, WhatsAppTile, callLabel, contactsOf, telHref, waHref, whoLabel } from '../components/MemberParts';
import SearchInput from '../components/SearchInput';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ProgressBar,
  RequirementGrid,
  Select,
  SkeletonPage,
  cn,
  useConfirm,
  useToast,
  IconAlert,
  IconArchive,
  IconArchiveRestore,
  IconArrow,
  IconAward,
  IconBack,
  IconCake,
  IconCalendar,
  IconCoins,
  IconDroplet,
  IconHome,
  IconPencil,
  IconPhone,
  IconX,
} from '../components/ui';

const STATUS_BADGE = {
  present: ['success', 'session.present'],
  absent: ['destructive', 'session.absent'],
  excused: ['warning', 'session.excused'],
};

const TABS = ['attendance', 'matalib', 'profile', 'history'];

// ar-LB gives the Levantine month names (أيلول، تشرين...) the فوج uses — the same
// headers as the activities journal. Latin digits, as everywhere else.
const intlLocale = (lng) => (lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR');
const fmtMonth = (iso, lng) =>
  new Intl.DateTimeFormat(intlLocale(lng), { month: 'long', year: 'numeric' }).format(toDate(iso));
const fmtWeekday = (iso, lng) => new Intl.DateTimeFormat(intlLocale(lng), { weekday: 'short' }).format(toDate(iso));

/** Mixed scripts in one line: each part keeps its own direction. */
function Parts({ parts }) {
  return parts.filter(Boolean).map((p, i) => (
    <span key={i}>
      {i > 0 && <span aria-hidden="true"> · </span>}
      <bdi>{p}</bdi>
    </span>
  ));
}

/** One figure of the profile's summary band. */
function Stat({ label, children, className }) {
  return (
    <div className={cn('min-w-0 space-y-2 bg-card p-4', className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Présence lines grouped by month, newest first — each line opens its نشاط. */
function AttendanceList({ rows, lang, t }) {
  const months = [];
  for (const h of rows) {
    const key = h.date.slice(0, 7);
    if (months.at(-1)?.key !== key) months.push({ key, rows: [] });
    months.at(-1).rows.push(h);
  }
  return (
    <div>
      {months.map(({ key, rows: mrows }) => (
        <section key={key} aria-labelledby={`att-${key}`}>
          <div className="flex items-baseline justify-between gap-3 border-y border-border bg-muted/40 px-4 py-1.5 sm:px-5">
            <h3 id={`att-${key}`} className="text-xs font-semibold text-muted-foreground">
              {fmtMonth(`${key}-01`, lang)}
            </h3>
            <span className="text-xs tabular-nums text-muted-foreground">
              {mrows.filter((h) => h.status === 'present').length}/{mrows.length}
            </span>
          </div>
          <ul className="divide-y divide-border">
            {mrows.map((h) => {
              const [variant, key] = STATUS_BADGE[h.status];
              return (
                <li key={h.session_id}>
                  <Link
                    to={`/sessions/${h.session_id}`}
                    className="focus-ring flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 sm:px-5"
                  >
                    <span className="w-9 shrink-0 text-center">
                      <span className="sr-only">{fmtDate(h.date)}</span>
                      <span aria-hidden="true" className="block text-lg font-semibold leading-none tabular-nums">
                        {Number(h.date.slice(8, 10))}
                      </span>
                      <span aria-hidden="true" className="mt-0.5 block text-[0.6875rem] text-muted-foreground">
                        {fmtWeekday(h.date, lang)}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium">{h.title}</span>
                    <Badge variant={variant} className="shrink-0">
                      {t(key)}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Label over value; a field nobody filled in says so instead of vanishing. */
function Fact({ label, children }) {
  const empty = children == null || children === '' || children === false;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 text-sm', empty ? 'text-muted-foreground' : 'font-medium')}>{empty ? '—' : children}</dd>
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

function PhoneValue({ value }) {
  if (!value) return null;
  return (
    <a href={telHref(value)} dir="ltr" className="focus-ring rounded-sm tabular-nums text-primary hover:underline">
      {fmtPhone(value)}
    </a>
  );
}

export default function MemberDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const back = useBack('/members');
  const toast = useToast();
  const confirm = useConfirm();
  const { has } = usePerms();
  // A قائد with this permission may add a مطلب the عنصر earned outside a نشاط,
  // or cancel one that was credited by mistake.
  const canEditMatalib = has('members.matalib');
  const canModify = has('members.edit');
  const canContact = has('members.contact');
  // L'archivage se fait ici seulement, fiche ouverte : depuis une liste de 200
  // lignes, un clic de travers suffisait à sortir quelqu'un des activités.
  const canArchive = has('members.delete');
  const [sp, setSp] = useSearchParams();
  const tab = TABS.includes(sp.get('tab')) ? sp.get('tab') : 'attendance';
  const setTab = (next) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        next === 'attendance' ? n.delete('tab') : n.set('tab', next);
        return n;
      },
      { replace: true }
    );
  const [editing, setEditing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  // '' | present | absent | excused — «which ones did he miss?» is the question parents ask
  const [historyStatus, setHistoryStatus] = useState('');
  const { data: member, setData: setMember, loading, error, reload } = useFetch(`/members/${id}`);

  // state: 'granted' | 'revoked' | 'auto' (auto drops the manual correction)
  async function setMatlab(number, state) {
    try {
      const res = await api.post(`/members/${id}/matalib`, { number, state });
      setMember((m) => ({
        ...m,
        stats: { ...m.stats, earned_numbers: res.earned_numbers, requirements_earned: res.earned_numbers.length },
        manual_matalib: res.manual_matalib,
      }));
      toast.success(t('member.matalibUpdated'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  // عنصرٌ مؤرشف يعود كما كان، بفرقته و سجلّه: إن تجاوز سنّها عاد إلى قائمة الترفيعات
  async function restore() {
    setRestoring(true);
    try {
      const updated = await api.post(`/members/${id}/restore`);
      setMember((m) => ({ ...m, status: updated.status, archived_at: null, archived_by: null }));
      toast.success(t('member.restored'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRestoring(false);
    }
  }

  async function archive() {
    if (!(await confirm({ title: t('member.archive'), message: t('member.archiveConfirm'), confirmLabel: t('member.archive') })))
      return;
    setArchiving(true);
    try {
      await api.del(`/members/${id}`);
      // Le bandeau «archivé le … par …» vient du serveur : on relit la fiche
      await reload({ quiet: true });
      toast.success(t('member.archived'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setArchiving(false);
    }
  }

  if (loading) return <SkeletonPage rows={4} />;
  if (error) return <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />;

  const { stats } = member;
  const active = member.status === 'active';
  const name = memberName(member);
  const bday = birthdayWhen(member.birth_date);
  const total = member.branch_total_requirements || 0;
  const earned = Math.min(stats.requirements_earned, total);
  const reqPct = total ? Math.min(100, Math.round((stats.requirements_earned / total) * 100)) : 0;
  // الاشتراكات المدفوعة تراكميًّا — يحسبها السيرفر من خانات الأنشطة. تصل NULL لمن
  // لا يملك صلاحية رؤية المبالغ، فيختفي كل ما يخصّها.
  const subs = member.subscriptions;
  const contacts = contactsOf(member);
  const lastPresent = stats.history.find((h) => h.status === 'present')?.date;
  const branchLabel = branchName(member, lang);
  const recent = stats.history.slice(0, 8).map((h) => ({ date: h.date, status: h.status }));

  // Search the présence log by نشاط title or date (typing "06/2026" narrows to a month)
  const hq = historyQuery.trim().toLowerCase();
  const history = stats.history.filter(
    (h) =>
      (!historyStatus || h.status === historyStatus) &&
      (!hq || [h.title, h.date, fmtDate(h.date)].some((v) => String(v || '').toLowerCase().includes(hq)))
  );
  // Each mark with its count; a mark he never got is not offered
  const historyStatuses = ['present', 'absent', 'excused']
    .map((s) => ({ value: s, count: stats.history.filter((h) => h.status === s).length }))
    .filter((s) => s.count > 0);
  const former = (member.former_attendance || []).filter((f) => f.total > 0);

  const statCount = 1 + (total > 0 ? 1 : 0) + (subs ? 1 : 0);
  const missing = [
    member.birth_date,
    member.father_name,
    member.school,
    ...(canContact ? [member.father_phone || member.mother_phone, member.address_abidjan] : []),
  ].filter((v) => !v).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={back} className="-ms-2">
          <IconBack className="rtl:rotate-180" />
          {t('member.title')}
        </Button>
        <div className="flex items-center gap-2">
          <ExportPdfButton kind="members" id={member.id} compact />
          {canArchive && active && (
            <Button
              variant="outline"
              size="sm"
              loading={archiving}
              onClick={archive}
              aria-label={t('member.archive')}
              className="w-11 px-0 sm:w-auto sm:px-3"
            >
              {!archiving && <IconArchive />}
              <span className="sr-only sm:not-sr-only">{t('member.archive')}</span>
            </Button>
          )}
        </div>
      </div>

      {!active && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/35 bg-warning/10 px-4 py-3">
          <IconArchive className="h-5 w-5 text-warning" />
          <div className="min-w-40 flex-1">
            <p className="text-sm font-medium">
              {member.archived_at
                ? t(member.archived_by ? 'member.archivedOnBy' : 'member.archivedOn', {
                    date: fmtDate(member.archived_at.slice(0, 10)),
                    name: member.archived_by,
                  })
                : t('member.inactive')}
            </p>
            <p className="text-xs text-muted-foreground">{t('member.archivedHint')}</p>
          </div>
          {canModify && (
            <Button size="sm" variant="outline" loading={restoring} onClick={restore}>
              <IconArchiveRestore />
              {t('member.restore')}
            </Button>
          )}
        </div>
      )}

      {/* ---------- Who: name, place in the فوج, and the numbers to call ---------- */}
      <section aria-labelledby="member-name" className="space-y-4">
        <div className="flex items-start gap-4">
          <Avatar
            photo={member.photo}
            name={avatarName(member)}
            className={cn(
              'h-16 w-16 bg-accent text-lg text-accent-foreground sm:h-20 sm:w-20 sm:text-xl',
              !active && 'opacity-60 grayscale'
            )}
          />
          <div className="min-w-0 flex-1 pt-1">
            <h1 id="member-name" dir="auto" className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl rtl:text-right">
              {name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
              <span>
                <Parts
                  parts={[
                    branchLabel,
                    member.group_name,
                    member.age != null && `${member.age} ${t('common.years')}`,
                    t(member.sex === 'M' ? 'member.male' : 'member.female'),
                  ]}
                />
              </span>
              {/* Right under the name: on an outing it is what gets looked up first */}
              {member.blood_type && (
                <Badge variant="outline" className="text-foreground" title={t('member.bloodType')}>
                  <IconDroplet className="h-3 w-3 text-destructive" />
                  <span className="sr-only">{t('member.bloodType')}</span>
                  <span dir="ltr">{member.blood_type}</span>
                </Badge>
              )}
              {!active && <Badge variant="secondary">{t('member.inactive')}</Badge>}
            </div>
          </div>
          {canModify && (
            <Button
              variant="outline"
              onClick={() => setEditing(true)}
              aria-label={t('common.edit')}
              className="w-11 shrink-0 px-0 sm:w-auto sm:px-4"
            >
              <IconPencil />
              <span className="sr-only sm:not-sr-only">{t('common.edit')}</span>
            </Button>
          )}
        </div>

        {/* One tile per number, full width on phones: two side by side left a 360px
            screen cutting the digits — and a phone number with an ellipsis is useless */}
        {contacts.length > 0 && (
          <ul className="grid gap-2 sm:flex sm:flex-wrap">
            {contacts.flatMap((c) =>
              c.numbers.map((n, i) => (
                <li key={`${c.who}-${i}`} className="flex min-w-0 gap-2">
                  <a
                    href={telHref(n)}
                    aria-label={`${callLabel(t, c.who, member.first_name)} — ${fmtPhone(n)}`}
                    className="focus-ring flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 shadow-xs transition-colors hover:border-primary/35 hover:bg-accent sm:pe-4"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <IconPhone className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block text-xs text-muted-foreground">{whoLabel(t, c.who)}</span>
                      <span dir="ltr" className="block whitespace-nowrap text-sm font-medium tabular-nums rtl:text-right">
                        {fmtPhone(n)}
                      </span>
                    </span>
                  </a>
                  <WhatsAppTile href={waHref(n)} label={`${t('member.whatsapp')} — ${fmtPhone(n)}`} />
                </li>
              ))
            )}
          </ul>
        )}
      </section>

      {bday && (
        <p role="status" className="flex items-center gap-2.5 rounded-xl border border-warning/35 bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
          <IconCake className="h-5 w-5 shrink-0" />
          {t(bday === 'today' ? 'birthday.isToday' : 'birthday.isTomorrow', {
            name: member.first_name,
            age: member.age + (bday === 'today' ? 0 : 1),
          })}
        </p>
      )}

      {active && stats.consecutive_absences >= 3 && (
        <p role="alert" className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          <IconAlert className="h-5 w-5 shrink-0" />
          {t('member.consecutiveAbsences', { count: stats.consecutive_absences })}
          <span className="font-normal">
            {' · '}
            {lastPresent
              ? t('dashboard.followup.lastPresent', { date: fmtDate(lastPresent) })
              : t('dashboard.followup.never')}
          </span>
        </p>
      )}

      {/* ---------- The three figures a قائد checks, one glance ---------- */}
      <Card
        className={cn(
          'grid grid-cols-2 gap-px overflow-hidden bg-border',
          statCount === 3 ? 'sm:grid-cols-3' : statCount === 1 ? 'grid-cols-1' : ''
        )}
      >
        <Stat label={t('member.attendanceRate')}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <RateValue rate={stats.rate} className="text-2xl font-bold" />
            {stats.total > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('member.presentOf', { present: stats.present, total: stats.total })}
              </span>
            )}
          </div>
          <AttendanceStrip recent={recent} size="md" />
        </Stat>
        {total > 0 && (
          <Stat label={t('member.requirementsProgress')}>
            <p className="text-2xl font-bold tabular-nums">
              {earned}
              <span className="text-base font-medium text-muted-foreground"> / {total}</span>
            </p>
            <ProgressBar value={reqPct} label={t('member.requirementsProgress')} className="h-2" />
          </Stat>
        )}
        {subs && (
          <Stat label={t('member.subscriptionsPaid')} className={statCount === 3 ? 'col-span-2 sm:col-span-1' : ''}>
            <p className="text-2xl font-bold tabular-nums text-foreground">{fmtAmount(subs.total)}</p>
            <p className="text-xs text-muted-foreground">
              {subs.count > 0 ? t('member.subscriptionsCount', { count: subs.count }) : t('member.noSubscriptions')}
            </p>
          </Stat>
        )}
      </Card>

      <div className="space-y-4">
        <UnderlineTabs
          items={[
            { id: 'attendance', label: t('member.attendance') },
            { id: 'matalib', label: t('member.matalib') },
            { id: 'profile', label: t('member.profile') },
            { id: 'history', label: t('member.history') },
          ]}
          value={tab}
          onChange={setTab}
          label={name}
          idPrefix="member-tab"
          panelId="member-panel"
        />

        <div id="member-panel" role="tabpanel" aria-labelledby={`member-tab-${tab}`} className="space-y-4">
          {tab === 'attendance' && (
            <>
              <Card className="overflow-hidden">
                {stats.history.length === 0 ? (
                  <EmptyState icon={<IconCalendar className="h-6 w-6" />} title={t('member.noAttendance')} />
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5">
                      <p className="text-sm text-muted-foreground">
                        {t('member.sessionsAttended', { present: stats.present, total: stats.total })}
                      </p>
                      {stats.history.length > 8 && (
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                          <SearchInput
                            value={historyQuery}
                            onChange={setHistoryQuery}
                            autoFocusHotkey={false}
                            placeholder={t('member.searchHistory')}
                            className="w-full flex-none sm:w-72"
                          />
                          {historyStatuses.length > 1 && (
                            <Select
                              className="sm:w-auto"
                              value={historyStatus}
                              onChange={(e) => setHistoryStatus(e.target.value)}
                              aria-label={t('member.status')}
                            >
                              <option value="">{t('member.allStatuses')}</option>
                              {historyStatuses.map((s) => (
                                <option key={s.value} value={s.value}>
                                  {`${t(STATUS_BADGE[s.value][1])} · ${s.count}`}
                                </option>
                              ))}
                            </Select>
                          )}
                        </div>
                      )}
                    </div>
                    {history.length === 0 ? (
                      <EmptyState icon={<IconCalendar className="h-6 w-6" />} title={t('common.noResults')} />
                    ) : (
                      <AttendanceList rows={history} lang={lang} t={t} />
                    )}
                  </>
                )}
              </Card>

              {/* La promotion remet le taux à zéro ; chaque période passée garde son bloc */}
              {former.map((f) => (
                <Card key={`${f.branch_id}-${f.until}`} className="overflow-hidden">
                  <details className="group">
                    <summary className="focus-ring flex cursor-pointer select-none list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3.5 hover:bg-accent/40 sm:px-5 [&::-webkit-details-marker]:hidden">
                      <span className="font-semibold">
                        {t('member.formerAttendance', {
                          branch: branchName({ name_fr: f.branch_name_fr, name_ar: f.branch_name_ar }, lang),
                        })}
                      </span>
                      <Badge variant="outline">{t('member.formerUntil', { date: fmtDate(f.until) })}</Badge>
                      <span className="ms-auto flex items-center gap-2 text-sm text-muted-foreground">
                        {t('member.sessionsAttended', { present: f.present, total: f.total })}
                        <RateValue rate={f.rate} />
                      </span>
                    </summary>
                    <AttendanceList rows={f.history} lang={lang} t={t} />
                  </details>
                </Card>
              ))}
            </>
          )}

          {tab === 'matalib' &&
            (total > 0 ? (
              <Card className="space-y-4 p-4 sm:p-5">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm text-muted-foreground">{t('member.requirementsOf', { earned, total })}</p>
                    <span className="text-sm font-semibold tabular-nums">{reqPct}%</span>
                  </div>
                  <ProgressBar value={reqPct} label={t('member.requirementsProgress')} />
                  {canEditMatalib && <p className="text-xs text-muted-foreground">{t('member.matalibEditHint')}</p>}
                </div>
                <RequirementGrid
                  total={total}
                  selected={stats.earned_numbers}
                  label={t('member.requirementsProgress')}
                  onToggle={
                    canEditMatalib
                      ? (n) => setMatlab(n, stats.earned_numbers.includes(n) ? 'revoked' : 'granted')
                      : undefined
                  }
                />
                {/* مطالب corrected by hand — shown apart so what came from أنشطة stays readable */}
                {member.manual_matalib?.length > 0 && (
                  <div className="space-y-1.5 border-t border-border pt-3">
                    <p className="text-xs font-medium text-muted-foreground">{t('member.matalibManual')}</p>
                    <ul className="flex flex-wrap gap-1.5">
                      {member.manual_matalib.map((m) => (
                        <li key={m.number}>
                          <Badge variant={m.state === 'granted' ? 'success' : 'destructive'}>
                            <span className="tabular-nums">{m.number}</span>
                            <span>{t(m.state === 'granted' ? 'member.matalibGranted' : 'member.matalibRevoked')}</span>
                            {m.updated_by && <span className="opacity-80">{t('member.matalibBy', { name: m.updated_by })}</span>}
                            {canEditMatalib && (
                              <button
                                type="button"
                                onClick={() => setMatlab(m.number, 'auto')}
                                aria-label={t('member.matalibReset')}
                                title={t('member.matalibReset')}
                                className="focus-ring -me-2 -my-1.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-black/10"
                              >
                                <IconX className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            ) : (
              <Card>
                <EmptyState icon={<IconAward className="h-6 w-6" />} title={t('member.noMatalib')} />
              </Card>
            ))}

          {tab === 'profile' && (
            <Card className="divide-y divide-border">
              {canModify && missing > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                  <p className="text-sm text-muted-foreground">{t('member.missingFields', { count: missing })}</p>
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    <IconPencil />
                    {t('member.complete')}
                  </Button>
                </div>
              )}
              <FactGroup title={t('member.sectionIdentity')}>
                <Fact label={t('member.birthDate')}>
                  {member.birth_date && (
                    <span className="tabular-nums">
                      {fmtDate(member.birth_date)} · {member.age} {t('common.years')}
                    </span>
                  )}
                </Fact>
                <Fact label={t('member.birthPlace')}>{member.birth_place}</Fact>
                <Fact label={t('member.sex')}>{t(member.sex === 'M' ? 'member.male' : 'member.female')}</Fact>
                <Fact label={t('member.bloodType')}>{member.blood_type && <span dir="ltr">{member.blood_type}</span>}</Fact>
              </FactGroup>
              <FactGroup title={t('member.sectionEnrolment')}>
                <Fact label={t('member.branch')}>{branchLabel}</Fact>
                <Fact label={t('member.group')}>{member.group_name}</Fact>
                <Fact label={t('member.joinDate')}>
                  {member.join_date && <span className="tabular-nums">{fmtDate(member.join_date)}</span>}
                </Fact>
                <Fact label={t('member.status')}>{t(active ? 'member.active' : 'member.inactive')}</Fact>
              </FactGroup>
              <FactGroup title={t(canContact ? 'member.sectionFamily' : 'member.sectionFamilyNoContact')}>
                <Fact label={t('member.fatherName')}>{member.father_name}</Fact>
                <Fact label={t('member.motherName')}>{member.mother_name}</Fact>
                {canContact && (
                  <>
                    <Fact label={t('member.fatherPhone')}>
                      {member.father_phone && <PhoneValue value={member.father_phone} />}
                    </Fact>
                    <Fact label={t('member.motherPhone')}>
                      {member.mother_phone && <PhoneValue value={member.mother_phone} />}
                    </Fact>
                    <Fact label={t('member.memberPhone')}>
                      {member.member_phone && <PhoneValue value={member.member_phone} />}
                    </Fact>
                  </>
                )}
              </FactGroup>
              <FactGroup title={t(canContact ? 'member.sectionHome' : 'member.school')}>
                {canContact && (
                  <>
                    <Fact label={t('member.addressAbidjan')}>{member.address_abidjan}</Fact>
                    <Fact label={t('member.addressLebanon')}>{member.address_lebanon}</Fact>
                  </>
                )}
                <Fact label={t('member.school')}>{member.school}</Fact>
              </FactGroup>
            </Card>
          )}

          {tab === 'history' && (
            <>
              {member.promotions.length === 0 && !member.visits?.length && !subs?.count && (
                <Card>
                  <EmptyState icon={<IconAward className="h-6 w-6" />} title={t('member.historyEmpty')} />
                </Card>
              )}

              {member.promotions.length > 0 && (
                <Card className="overflow-hidden">
                  <h2 className="px-4 pt-4 pb-3 text-base font-semibold sm:px-5">{t('promotion.history')}</h2>
                  <ul className="divide-y divide-border border-t border-border">
                    {member.promotions.map((p) => (
                      <li key={p.id}>
                        <details className="group">
                          <summary className="focus-ring flex cursor-pointer select-none list-none flex-wrap items-center gap-2 px-4 py-3 text-sm hover:bg-accent/40 sm:px-5 [&::-webkit-details-marker]:hidden">
                            <IconAward className="h-4 w-4 text-primary" />
                            <span className="tabular-nums text-muted-foreground">{fmtDate(p.promoted_at)}</span>
                            <Badge variant="secondary">{lang === 'ar' ? p.old_name_ar : p.old_name_fr}</Badge>
                            <IconArrow className="h-3.5 w-3.5 text-muted-foreground rtl:rotate-180" />
                            <Badge>{lang === 'ar' ? p.new_name_ar : p.new_name_fr}</Badge>
                            <span className="ms-auto font-medium tabular-nums text-primary">
                              {t('member.requirementsOf', { earned: p.matalib.length, total: p.old_total_requirements })}
                            </span>
                          </summary>
                          <div className="border-t border-border p-4 sm:p-5">
                            <RequirementGrid total={p.old_total_requirements} selected={p.matalib} />
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {/* الاشتراكات المدفوعة: المجموع التراكمي و تفصيله نشاطًا نشاطًا */}
              {subs?.count > 0 && (
                <Card className="overflow-hidden">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 pb-3 sm:px-5">
                    <h2 className="flex items-center gap-2 text-base font-semibold">
                      <IconCoins className="h-4 w-4 text-muted-foreground" />
                      {t('member.subscriptions')}
                    </h2>
                    <span className="text-sm text-muted-foreground">
                      {t('member.subscriptionsCount', { count: subs.count })}
                    </span>
                  </div>
                  <ul className="divide-y divide-border border-t border-border">
                    {subs.history.map((r) => (
                      <li key={r.session_id}>
                        <Link
                          to={`/sessions/${r.session_id}`}
                          className="focus-ring flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/40 sm:px-5"
                        >
                          <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{fmtDate(r.date)}</span>
                          <span className="min-w-0 flex-1 font-medium">{r.title}</span>
                          <span className="shrink-0 font-medium tabular-nums">{fmtAmount(r.amount)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between gap-3 border-t-2 border-border px-4 py-3 text-sm sm:px-5">
                    <span className="font-semibold">{t('member.subscriptionsTotal')}</span>
                    <span className="font-bold tabular-nums">{fmtAmount(subs.total)}</span>
                  </div>
                </Card>
              )}

              {/* زيارات الأهل — apart from présence on purpose: a visit is not an
                  activity the عنصر attended, it is something the قادة did for the family */}
              {member.visits?.length > 0 && (
                <Card className="overflow-hidden">
                  <h2 className="flex items-center gap-2 px-4 pt-4 pb-3 text-base font-semibold sm:px-5">
                    <IconHome className="h-4 w-4 text-muted-foreground" />
                    {t('session.familyVisits')}
                  </h2>
                  <ul className="divide-y divide-border border-t border-border">
                    {member.visits.map((v) => (
                      <li key={v.session_id}>
                        <Link
                          to={`/sessions/${v.session_id}`}
                          className="focus-ring flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-accent/40 sm:px-5"
                        >
                          <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{fmtDate(v.date)}</span>
                          <span className="min-w-0 flex-1 font-medium">{v.title}</span>
                          {v.leaders && <span className="text-xs text-muted-foreground">{v.leaders}</span>}
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

      <MemberFormDialog
        open={editing}
        member={member}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          reload({ quiet: true });
        }}
      />
    </div>
  );
}
