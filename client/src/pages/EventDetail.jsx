import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, isFeminine } from '../api';
import { usePerms } from '../auth';
import { useBack, useFetch } from '../hooks';
import { avatarName, branchName, fmtAmount, fmtDate, fmtPhone, fmtTime, memberName, todayISO } from '../utils';
import { toDate } from '../lib/date';
import {
  CORE_STAFF,
  EXPENSE_CATEGORIES,
  KIND_BADGE,
  STAFF_ROLES,
  chiefLabel,
  PAY_BADGE,
  dayNumber,
  dueOf,
  eventPhase,
  eventScopeLabels,
  fmtDateRange,
  participantKind,
  participantName,
  payState,
  signed,
  staffRoleLabel,
} from '../lib/events';
import AmountInput from '../components/AmountInput';
import Combobox from '../components/Combobox';
import DatePicker from '../components/DatePicker';
import EventFormDialog from '../components/EventForm';
import FilterSelect from '../components/FilterSelect';
import SearchInput from '../components/SearchInput';
import SearchSelect from '../components/SearchSelect';
import TimePicker from '../components/TimePicker';
import { UnderlineTabs, WhatsAppTile, telHref, waHref } from '../components/MemberParts';
import AttachedFiles from '../components/AttachedFiles';
import { EventEvaluation } from '../components/SessionEvaluation';
import { EventSafetyTab, readinessFacts } from '../components/CampSafety';
import ExportPdfButton from '../components/ExportPdfButton';
import { familyCount, remainingOf, unpaidFamilies, unpaidOf } from '../lib/campFile';
import { fmtScore, scoreTone } from '../lib/evaluations';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  ProgressBar,
  SegmentedControl,
  Select,
  SkeletonPage,
  Textarea,
  useConfirm,
  useToast,
  IconBack,
  IconCalendar,
  IconCheckAll,
  IconChevronDown,
  IconClipboard,
  IconCoins,
  IconHandHeart,
  IconPencil,
  IconPhone,
  IconPin,
  IconPlus,
  IconSearch,
  IconShield,
  IconStar,
  IconTent,
  IconTrash,
  IconUsers,
  IconWallet,
  IconX,
} from '../components/ui';

const TABS = ['program', 'staff', 'participants', 'safety', 'money', 'eval', 'files'];

// The same three marks as a نشاط; absence starts quiet, présence stands out
const STATUSES = [
  { value: 'present', key: 'session.present', tone: 'success', badge: 'success' },
  { value: 'absent', key: 'session.absent', tone: 'destructive-soft', badge: 'destructive' },
  { value: 'excused', key: 'session.excused', tone: 'warning-soft', badge: 'warning' },
];

// ar-LB: the Levantine month names (أيلول، تشرين…) the فوج uses, Latin digits
const intlLocale = (lng) => (lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR');
const fmtDay = (iso, lng) =>
  new Intl.DateTimeFormat(intlLocale(lng), { weekday: 'long', day: 'numeric', month: 'long' })
    .format(toDate(iso))
    .replace(/[‎‏؜]/g, '');

// Every day of the event, first to last
function eventDays(ev) {
  const out = [];
  const d = toDate(ev.start_date);
  const last = toDate(ev.end_date);
  while (d <= last && out.length < 400) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// The server's refusals that read as something to fix, in words
function errorText(t, err) {
  const known = {
    forbidden_branch: 'session.forbiddenBranch',
    date_outside_event: 'event.errDateOutside',
    sessions_outside_dates: 'event.errSessionsOutside',
    staff_exists: 'event.errStaffExists',
  };
  return known[err.message] ? t(known[err.message]) : err.message;
}

const timeRange = (s) =>
  s.start_time && s.end_time ? `${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}` : fmtTime(s.start_time);

// Name search that accepts the parts in any order: «سالم محمد» finds «محمد سالم»
function nameMatcher(query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (p) => {
    if (!words.length) return true;
    const name = (p.guest_name || memberName(p)).toLowerCase();
    return words.every((w) => name.includes(w));
  };
}

function Figure({ label, children, className }) {
  return (
    <div className={cn('min-w-0 space-y-2 bg-card p-4', className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function ShareBar({ value, tone = 'primary' }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-muted">
      <span
        className={cn('block h-full rounded-full', tone === 'success' ? 'bg-success' : 'bg-primary')}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/**
 * The event's numbers: who takes part, what came in against what is expected, what
 * was given, what went out, and what is left. Money only for who may see amounts.
 */
function EventFigures({ ev, t }) {
  const s = ev.summary;
  if (!s)
    return (
      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-border">
        <Figure label={t('event.participants')}>
          <p className="text-2xl font-bold tabular-nums">{ev.participant_total}</p>
        </Figure>
        <Figure label={t('event.sessions')}>
          <p className="text-2xl font-bold tabular-nums">{ev.sessions.length}</p>
        </Figure>
      </Card>
    );
  const pct = s.expected ? (100 * s.collected) / s.expected : 0;
  const states = [
    s.paid && t('event.statePaidCount', { count: s.paid }),
    s.partial && t('event.statePartialCount', { count: s.partial }),
    s.unpaid && t('event.stateUnpaidCount', { count: s.unpaid }),
    s.exempt && t('event.stateExemptCount', { count: s.exempt }),
  ].filter(Boolean);
  // «مجّاني» only when it is: a camp with a fee and nobody on its list yet asks nothing
  // so far, it is not free
  const free = !(ev.fee > 0);
  // Money from the caisses gets its own figure once there is any: six figures then
  // fill three rows on a phone, so the balance no longer takes a whole one
  const funds = s.funding_count > 0;
  return (
    <Card className={cn('grid grid-cols-2 gap-px overflow-hidden bg-border', funds ? 'lg:grid-cols-6' : 'lg:grid-cols-5')}>
      <Figure label={t('event.participants')}>
        <p className="text-2xl font-bold tabular-nums">{s.participants}</p>
        {/* Each state stays whole: a half-cut «لم / يدفعوا» across two lines reads as nothing */}
        {(states.length > 0 || free) && (
          <p className="text-xs text-muted-foreground">
            {states.length
              ? states.map((x, i) => (
                  // The separator stays outside the unbreakable part: the line breaks there
                  <Fragment key={x}>
                    {i > 0 && ' · '}
                    <span className="whitespace-nowrap">{x}</span>
                  </Fragment>
                ))
              : t('event.free')}
          </p>
        )}
      </Figure>
      {/* The expected sum on its own line: «117,500 / 190,000» at this size breaks in two on a phone */}
      <Figure label={t('event.collected')}>
        <p className="text-2xl font-bold tabular-nums">{fmtAmount(s.collected)}</p>
        {s.expected > 0 && <ShareBar value={pct} tone={s.outstanding === 0 ? 'success' : 'primary'} />}
        {(s.expected > 0 || free) && (
          <p className="text-xs text-muted-foreground">
            {s.expected > 0 ? (
              <>
                <span className="whitespace-nowrap">{t('event.ofExpected', { amount: fmtAmount(s.expected) })}</span>
                {' · '}
                <span className={cn('whitespace-nowrap', s.outstanding > 0 && 'font-medium text-warning')}>
                  {s.outstanding > 0
                    ? t('event.outstandingShort', { amount: fmtAmount(s.outstanding) })
                    : t('event.allCollected')}
                </span>
              </>
            ) : (
              t('event.free')
            )}
          </p>
        )}
      </Figure>
      {/* What came in beside what went out: on a phone the two share a row */}
      <Figure label={t('event.donations')}>
        <p className="text-2xl font-bold tabular-nums">{fmtAmount(s.donations)}</p>
        <p className="text-xs text-muted-foreground">{t('event.donationCount', { count: s.donation_count })}</p>
      </Figure>
      {funds && (
        <Figure label={t('event.fromCaisses')}>
          <p className="text-2xl font-bold tabular-nums">
            <span dir="ltr">{signed(s.funded - s.returned)}</span>
          </p>
          {s.returned > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('event.fundingTakenReturned', { taken: fmtAmount(s.funded), returned: fmtAmount(s.returned) })}
            </p>
          )}
        </Figure>
      )}
      <Figure label={t('event.expenses')}>
        <p className="text-2xl font-bold tabular-nums">{fmtAmount(s.expenses)}</p>
        <p className="text-xs text-muted-foreground">{t('event.expenseCount', { count: s.expense_count })}</p>
      </Figure>
      {/* Last figure: the bottom line of the account — the whole width on a phone when it
          would sit alone on its row */}
      <Figure label={t('event.balance')} className={funds ? undefined : 'col-span-2 lg:col-span-1'}>
        <p
          className={cn(
            'text-2xl font-bold tabular-nums',
            s.balance < 0 ? 'text-destructive' : s.balance > 0 ? 'text-success' : ''
          )}
        >
          <span dir="ltr">{signed(s.balance)}</span>
        </p>
        {/* An even account — nothing in, nothing out yet — is neither a surplus nor a deficit */}
        {(s.outstanding > 0 || s.balance !== 0) && (
          <p className="text-xs text-muted-foreground">
            {s.outstanding > 0 ? (
              <>
                {t('event.projected')}{' '}
                <span dir="ltr" className="whitespace-nowrap font-medium tabular-nums">
                  {signed(s.expected + s.donations + s.funded - s.returned - s.expenses)}
                </span>
              </>
            ) : (
              t(s.balance < 0 ? 'event.deficit' : 'event.surplus')
            )}
          </p>
        )}
      </Figure>
    </Card>
  );
}

/** Read-only présence for an account that cannot mark it */
function StatusBadge({ status, t }) {
  const s = STATUSES.find((x) => x.value === status);
  return s ? <Badge variant={s.badge}>{t(s.key)}</Badge> : <Badge variant="outline">{t('session.unmarked')}</Badge>;
}

/**
 * Who a participant is, under the name: فرقة and طليعة, قائد (قائدة in قسم الفتيات), or
 * ضيف — then `extra` (his présence). The فرقة is left out when every عنصر is from the
 * same one: twelve «الكشافة» down a list say nothing.
 */
function ParticipantLine({ p, t, lng, section, showBranch = true, showGroup = true, extra = null }) {
  const kind = participantKind(p);
  const parts =
    kind === 'member'
      ? [showBranch && branchName(p, lng), showGroup && p.group_name, p.member_role && t(`resp.role.${p.member_role}`)]
      : [t(kind === 'leader' ? (isFeminine(section) ? 'event.kindLeaderF' : 'event.kindLeader') : 'event.kindGuest')];
  if (p.status === 'inactive') parts.push(t('member.inactive'));
  if (extra) parts.push(extra);
  const facts = parts.filter(Boolean);
  if (!facts.length) return null;
  // Each fact whole and isolated, the line breaking between them: an Arabic طليعة beside
  // «3/5 séances» would otherwise swap places, and «سداسي الأ…» says nothing
  return (
    <span className="block text-xs text-muted-foreground">
      {facts.map((x, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          <bdi className={x.length <= 24 ? 'whitespace-nowrap' : '[overflow-wrap:anywhere]'}>{x}</bdi>
        </Fragment>
      ))}
    </span>
  );
}

// More than one فرقة among the عناصر taking part: only then is the فرقة worth naming
const mixedBranches = (ev) => new Set(ev.participants.filter((p) => p.member_id).map((p) => p.branch_id)).size > 1;

function ParticipantAvatar({ p }) {
  return <Avatar photo={p.photo} name={p.guest_name || avatarName(p)} className="h-9 w-9" />;
}

/* ============================================================
   البرنامج: الجلسات يومًا يومًا
   ============================================================ */

function ProgramTab({ ev, t, lng, canEdit, onAdd, onEdit, onOpen, onEditPlan }) {
  const today = todayISO();
  const ids = new Set(ev.participants.map((p) => p.id));
  const marksOf = (sid) => ev.attendance.filter((a) => a.session_id === sid && ids.has(a.participant_id));
  const days = [];
  for (const s of ev.sessions) {
    if (days.at(-1)?.date !== s.date) days.push({ date: s.date, sessions: [] });
    days.at(-1).sessions.push(s);
  }

  return (
    <div className="space-y-4">
      {ev.plan ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle>{t('event.plan')}</CardTitle>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={onEditPlan} className="-my-1">
                <IconPencil />
                {t('common.edit')}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {/* auto: an Arabic plan keeps its own direction on the French screen, and vice versa */}
            <p dir="auto" className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
              {ev.plan}
            </p>
          </CardContent>
        </Card>
      ) : (
        canEdit && (
          <button
            type="button"
            onClick={onEditPlan}
            className="focus-ring flex min-h-12 w-full items-center gap-2.5 rounded-2xl border border-dashed border-border px-4 py-3 text-start text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/40 hover:text-foreground"
          >
            <IconClipboard className="h-4 w-4" />
            <span>
              <span className="font-medium text-foreground">{t('event.addPlan')}</span>
              <span className="block text-xs">{t('event.planHint')}</span>
            </span>
          </button>
        )
      )}

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>
              {t('event.program')}
              <span className="ms-2 font-normal tabular-nums text-muted-foreground">{ev.sessions.length}</span>
            </CardTitle>
            {ev.sessions.length > 0 && ev.participants.length > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">{t('event.programHint')}</p>
            )}
          </div>
          {canEdit && ev.sessions.length > 0 && (
            <Button size="sm" variant="outline" onClick={onAdd} className="w-full sm:w-auto">
              <IconPlus />
              {t('event.addSession')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
          {ev.sessions.length === 0 ? (
            <EmptyState
              icon={<IconCalendar className="h-6 w-6" />}
              title={t('event.noSessions')}
              action={
                canEdit && (
                  <Button variant="brand" onClick={onAdd}>
                    <IconPlus />
                    {t('event.addSession')}
                  </Button>
                )
              }
            >
              {t('event.noSessionsHint')}
            </EmptyState>
          ) : (
            days.map((day) => (
              <section key={day.date} aria-label={fmtDay(day.date, lng)}>
                <div className="flex flex-wrap items-baseline gap-x-2 border-y border-border bg-muted/30 px-4 py-2 sm:px-5">
                  <span className="text-sm font-semibold">{t('event.dayN', { n: dayNumber(ev, day.date) })}</span>
                  <span className="text-xs text-muted-foreground">{fmtDay(day.date, lng)}</span>
                </div>
                <ul className="divide-y divide-border">
                  {day.sessions.map((s) => {
                    const marks = marksOf(s.id);
                    const present = marks.filter((a) => a.status === 'present').length;
                    const total = ev.participants.length;
                    return (
                      <li key={s.id} className="flex items-start gap-1">
                        <button
                          type="button"
                          onClick={() => onOpen(s)}
                          className="focus-ring group grid min-w-0 flex-1 grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3 px-4 py-3 text-start transition-colors hover:bg-accent/40 focus-visible:[outline-offset:-2px]! sm:px-5"
                        >
                          <span className="pt-0.5 text-sm tabular-nums">
                            {s.start_time ? (
                              <>
                                <span className="block font-medium">{fmtTime(s.start_time)}</span>
                                {s.end_time && (
                                  <span className="block text-xs text-muted-foreground">{fmtTime(s.end_time)}</span>
                                )}
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                          <span className="min-w-0 space-y-1">
                            <span className="block font-medium group-hover:text-primary">{s.title}</span>
                            {s.responsible && (
                              <span className="block text-sm text-muted-foreground">{s.responsible}</span>
                            )}
                            {s.notes && (
                              <span
                                dir="auto"
                                className="line-clamp-2 block whitespace-pre-line text-sm text-muted-foreground [overflow-wrap:anywhere]"
                              >
                                {s.notes}
                              </span>
                            )}
                            {total > 0 &&
                              (marks.length > 0 ? (
                                <span className="flex flex-wrap gap-1.5 pt-0.5">
                                  <Badge variant="success">
                                    {t('event.presentOf', { present, total })}
                                  </Badge>
                                  {marks.length < total && (
                                    <Badge variant="outline">
                                      {t('event.unmarkedCount', { count: total - marks.length })}
                                    </Badge>
                                  )}
                                </span>
                              ) : (
                                s.date <= today && (
                                  <span className="flex pt-0.5">
                                    <Badge variant="warning">{t('session.notMarked')}</Badge>
                                  </span>
                                )
                              ))}
                          </span>
                        </button>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onEdit(s)}
                            className="me-2 mt-2 shrink-0 text-muted-foreground sm:me-3"
                            aria-label={`${t('common.edit')} — ${s.title}`}
                          >
                            <IconPencil />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Add or edit one جلسة of the program — its day is one of the event's days. */
function SessionDialog({ ev, session, open, onClose, onSaved, leaders, t, lng }) {
  const toast = useToast();
  const confirm = useConfirm();
  const blank = { title: '', date: ev.start_date, start_time: '', end_time: '', responsible: '', notes: '' };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Every opening starts from the جلسة tapped, or from an empty one on day 1 — or on
  // today, when the event is under way
  useEffect(() => {
    if (!open) return;
    setError(null);
    const today = todayISO();
    setForm(
      session
        ? {
            title: session.title,
            date: session.date,
            start_time: session.start_time || '',
            end_time: session.end_time || '',
            responsible: session.responsible || '',
            notes: session.notes || '',
          }
        : { ...blank, date: today >= ev.start_date && today <= ev.end_date ? today : ev.start_date }
    );
  }, [open, session]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = eventDays(ev);
  // A month-long دورة would make a long list: past a month, a calendar instead
  const pickFromList = days.length <= 31;

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        ...form,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        responsible: form.responsible || null,
        notes: form.notes || null,
      };
      const payload = session
        ? await api.put(`/events/${ev.id}/sessions/${session.id}`, body)
        : await api.post(`/events/${ev.id}/sessions`, body);
      onSaved(payload, session ? 'event.sessionUpdated' : 'event.sessionAdded');
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !(await confirm({
        title: t('event.deleteSession'),
        message: t('event.deleteSessionConfirm', { title: session.title }),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      onSaved(await api.del(`/events/${ev.id}/sessions/${session.id}`), 'event.sessionDeleted');
    } catch (err) {
      toast.error(errorText(t, err));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(session ? 'event.editSession' : 'event.addSession')}
      footer={
        <div className="flex items-center justify-between gap-2">
          {session ? (
            <Button variant="destructive-ghost" onClick={remove}>
              <IconTrash />
              {t('common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="event-session-form" loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <form id="event-session-form" onSubmit={save} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="es_title">{t('event.sessionTitle')}</Label>
          <Input
            id="es_title"
            required
            maxLength={200}
            autoComplete="off"
            placeholder={t('event.sessionTitleHint')}
            value={form.title}
            onChange={set('title')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="es_date">{t('event.day')}</Label>
          {pickFromList ? (
            <Select id="es_date" required value={form.date} onChange={set('date')}>
              {days.map((d, i) => (
                <option key={d} value={d}>
                  {`${t('event.dayN', { n: i + 1 })} — ${fmtDay(d, lng)}`}
                </option>
              ))}
            </Select>
          ) : (
            <DatePicker id="es_date" required clearable={false} value={form.date} onChange={set('date')} />
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="es_start">{t('event.startTime')}</Label>
            <TimePicker id="es_start" value={form.start_time} onChange={set('start_time')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="es_end">{t('event.endTime')}</Label>
            <TimePicker id="es_end" value={form.end_time} onChange={set('end_time')} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="es_resp">{t('event.responsible')}</Label>
          {/* قائد of the قسم, or a trainer from outside the فوج typed by hand */}
          <Combobox
            id="es_resp"
            maxLength={120}
            placeholder={t('event.responsibleHint')}
            value={form.responsible}
            options={leaders.filter((l) => l.section === ev.section && l.status === 'active').map((l) => memberName(l))}
            onChange={set('responsible')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="es_notes">{t('event.sessionNotes')}</Label>
          <Textarea id="es_notes" rows={4} maxLength={4000} value={form.notes} onChange={set('notes')} />
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/** One filter of the attendance list, as the Members page draws its طليعة chips */
function FilterChip({ on, onClick, label, count }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'focus-ring inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors sm:h-8 sm:px-3 sm:text-xs',
        on
          ? 'border-primary/30 bg-accent text-accent-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      {label}
      <span className={cn('tabular-nums', !on && 'opacity-70')}>{count}</span>
    </button>
  );
}

/** A row of chips: one line that scrolls sideways on a phone, wrapping on a wider screen */
function ChipRow({ label, chips, value, onChange }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      {chips.map((c) => (
        <FilterChip key={c.value || 'all'} on={c.value === value} onClick={() => onChange(c.value)} label={c.label} count={c.count} />
      ))}
    </div>
  );
}

// «who» filter values: '' everyone, 'b:<id>' the عناصر of a فرقة, the قادة, the ضيوف
const whoMatch = (who) => (p) =>
  !who ||
  (who === 'leaders'
    ? participantKind(p) === 'leader'
    : who === 'guests'
      ? participantKind(p) === 'guest'
      : participantKind(p) === 'member' && `b:${p.branch_id}` === who);

// «group» filter values: '' every طليعة, '<id>', 'none' = بلا طليعة. A طليعة is of عناصر only.
const groupMatch = (group) => (p) =>
  !group || (participantKind(p) === 'member' && (group === 'none' ? !p.group_id : String(p.group_id) === group));

/**
 * حضور جلسة: the participants of the event, marked present / absent / excused. Tap
 * by tap, the screen goes first and the server follows (a refusal rolls it back).
 * The list narrows to a فرقة, its طلائع, the قادة or the ضيوف; the bulk buttons then
 * mark only what is shown.
 */
function AttendanceDialog({ ev, session, open, onClose, onMark, canMark, onAddPeople, t, lng }) {
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  // Kept from one جلسة to the next: a قائد marks his own فرقة, session after session
  const [who, setWho] = useState('');
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setQuery('');
  }, [open, session?.id]);
  if (!session) return <Dialog open={false} onClose={onClose} title="" />;

  const statusOf = new Map(
    ev.attendance.filter((a) => a.session_id === session.id).map((a) => [a.participant_id, a.status])
  );
  const people = ev.participants;
  const members = people.filter((p) => participantKind(p) === 'member');
  const count = (st) => people.filter((p) => statusOf.get(p.id) === st).length;
  const marked = people.filter((p) => statusOf.has(p.id)).length;

  // Who: each فرقة in the server's order, then the قادة and the ضيوف — only what is there
  const branchRows = [...new Map(members.map((p) => [p.branch_id, p])).values()];
  const whoOptions = [
    ...branchRows.map((p) => ({ value: `b:${p.branch_id}`, label: branchName(p, lng) })),
    { value: 'leaders', label: t(isFeminine(ev.section) ? 'event.group_leaderF' : 'event.group_leader') },
    { value: 'guests', label: t('event.group_guest') },
  ]
    .map((o) => ({ ...o, count: people.filter(whoMatch(o.value)).length }))
    .filter((o) => o.count > 0);
  const whoNow = whoOptions.some((o) => o.value === who) ? who : '';
  const whoChips = whoOptions.length > 1 ? [{ value: '', label: t('member.tabAll'), count: people.length }, ...whoOptions] : null;

  // طلائع once the list is a single فرقة — the one picked, or the only one taking part.
  // Across فرق they would pile up, and two «طليعة 1» could not be told apart.
  const branchId = whoNow.startsWith('b:') ? Number(whoNow.slice(2)) : !whoNow && branchRows.length === 1 ? branchRows[0].branch_id : null;
  const pool = branchId === null ? [] : members.filter((p) => p.branch_id === branchId);
  const groups = [...new Map(pool.filter((p) => p.group_id).map((p) => [p.group_id, p.group_name])).entries()]
    .map(([id, name]) => ({ value: String(id), label: name, count: pool.filter((p) => p.group_id === id).length }))
    .sort((a, b) => a.label.localeCompare(b.label, lng));
  const unassigned = pool.filter((p) => !p.group_id).length;
  const groupChips = groups.length
    ? [
        { value: '', label: t('member.allGroups'), count: pool.length },
        ...groups,
        ...(unassigned ? [{ value: 'none', label: t('member.noGroup'), count: unassigned }] : []),
      ]
    : null;
  const groupNow = groupChips?.some((c) => c.value === group) ? group : '';

  const shown = people.filter((p) => whoMatch(whoNow)(p) && groupMatch(groupNow)(p) && nameMatcher(query)(p));
  const untouched = shown.filter((p) => !statusOf.has(p.id));
  const filtered = !!(whoNow || groupNow || query.trim());
  const showBranch = mixedBranches(ev) && !branchId;
  const hasToolbar = people.length > 8 || whoChips || groupChips;

  function pickWho(v) {
    setWho(v);
    setGroup('');
  }
  function clearFilters() {
    setQuery('');
    setWho('');
    setGroup('');
  }

  async function markRest(status) {
    // The count, not «الجميع»: with a فرقة picked, «everyone» would read as the whole camp
    const label = t(status === 'present' ? 'session.markRestPresent' : 'session.markRestAbsent', {
      count: untouched.length,
    });
    const ok = await confirm({
      title: label,
      message: t(status === 'present' ? 'event.markShownPresentConfirm' : 'event.markShownAbsentConfirm'),
      destructive: false,
      confirmLabel: label,
    });
    if (!ok) return;
    setBusy(true);
    await onMark(
      session.id,
      untouched.map((p) => ({ participant_id: p.id, status }))
    );
    setBusy(false);
  }

  const description = [
    t('event.dayN', { n: dayNumber(ev, session.date) }),
    fmtDay(session.date, lng),
    timeRange(session),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    // No focus on the search box at opening: on a phone it would cover the list with the keyboard
    <Dialog open={open} onClose={onClose} title={session.title} description={description} size="lg" autoFocus={false}>
      {people.length === 0 ? (
        <EmptyState
          icon={<IconUsers className="h-6 w-6" />}
          title={t('event.noParticipants')}
          action={
            onAddPeople && (
              <Button variant="brand" onClick={onAddPeople}>
                <IconPlus />
                {t('event.addParticipants')}
              </Button>
            )
          }
        >
          {t('event.attendanceNeedsPeople')}
        </EmptyState>
      ) : (
        <>
          {/* Each block above the list closes with its own full-width line, so the stuck
              toolbar meets the header with one line and the rows with another */}
          <div className="-mx-4 space-y-3 border-b border-border px-4 pb-4 sm:-mx-5 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium tabular-nums">
                {t('session.marked', { marked, total: people.length })}
              </span>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="success">
                  {t('session.tallyPresent')} <span className="tabular-nums">{count('present')}</span>
                </Badge>
                <Badge variant="destructive">
                  {t('session.tallyAbsent')} <span className="tabular-nums">{count('absent')}</span>
                </Badge>
                <Badge variant="warning">
                  {t('session.tallyExcused')} <span className="tabular-nums">{count('excused')}</span>
                </Badge>
              </div>
            </div>
            <ProgressBar value={(100 * marked) / people.length} label={t('session.attendance')} />
          </div>

          {/* Search and filters stay in sight while the list scrolls under them: with
              forty names, going back up to switch فرقة would cost the whole list */}
          {hasToolbar && (
            <div className="sticky -top-4 z-10 -mx-4 space-y-2.5 border-b border-border bg-card px-4 py-3 sm:-top-5 sm:-mx-5 sm:px-5">
              {people.length > 8 && (
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  autoFocusHotkey={false}
                  placeholder={t('event.searchParticipant')}
                />
              )}
              {whoChips && <ChipRow label={t('event.filterPeople')} chips={whoChips} value={whoNow} onChange={pickWho} />}
              {groupChips && (
                <ChipRow label={t('session.filterByGroup')} chips={groupChips} value={groupNow} onChange={setGroup} />
              )}
            </div>
          )}

          {/* The bulk buttons say how many they touch: what the filters show, nothing hidden */}
          {canMark && untouched.length > 0 && (
            <div className="-mx-4 flex flex-wrap gap-2 border-b border-border px-4 py-3 sm:-mx-5 sm:px-5">
              <Button variant="outline" size="sm" loading={busy} onClick={() => markRest('present')}>
                <IconCheckAll />
                {t('session.markRestPresent', { count: untouched.length })}
              </Button>
              <Button variant="outline" size="sm" loading={busy} onClick={() => markRest('absent')}>
                {t('session.markRestAbsent', { count: untouched.length })}
              </Button>
            </div>
          )}

          {/* While narrowed, the list keeps its room: a dialog that shrank around one name
              would re-centre and slide the next chip from under the finger */}
          <div className={cn(filtered && 'min-h-[50dvh]')}>
            {shown.length === 0 ? (
              <EmptyState
                icon={<IconSearch className="h-6 w-6" />}
                title={t('common.noResults')}
                action={
                  filtered && (
                    <Button variant="outline" onClick={clearFilters}>
                      {t('common.clearFilters')}
                    </Button>
                  )
                }
              />
            ) : (
              <ul className="-mx-4 divide-y divide-border sm:-mx-5">
                {shown.map((p) => {
                  const status = statusOf.get(p.id) ?? null;
                  return (
                    <li
                      key={p.id}
                      className={cn(
                        'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 transition-colors sm:px-5',
                        !status && 'bg-warning/5'
                      )}
                    >
                      <ParticipantAvatar p={p} />
                      <div className="min-w-32 flex-1">
                        <span className="block truncate font-medium">{participantName(p)}</span>
                        <ParticipantLine
                          p={p}
                          t={t}
                          lng={lng}
                          section={ev.section}
                          showBranch={showBranch}
                          showGroup={!groupNow || groupNow === 'none'}
                        />
                      </div>
                      <div className="w-full sm:w-auto sm:shrink-0">
                        {canMark ? (
                          <SegmentedControl
                            className="w-full sm:w-auto sm:[&>button]:whitespace-nowrap"
                            label={participantName(p)}
                            value={status}
                            onChange={(v) => onMark(session.id, [{ participant_id: p.id, status: v }])}
                            options={STATUSES.map((s) => ({ ...s, label: t(s.key) }))}
                          />
                        ) : (
                          <StatusBadge status={status} t={t} />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}

/* ============================================================
   الهيئة القيادية
   ============================================================ */

/**
 * Who holds what in the camp: قائد المخيم first, then each post. The usual posts stand
 * as empty slots until someone holds them, so the قائد sees at a glance what is left
 * to fill; the others appear once added.
 */
function StaffTab({ ev, t, canEdit, canLeaders, onAssign, onEdit, onEditChief }) {
  const rows = [
    {
      key: 'chief',
      label: chiefLabel(t, ev.kind, ev.section),
      person: ev.leader_id ? { leader_id: ev.leader_id, name: ev.leader_name } : null,
      edit: onEditChief,
    },
  ];
  for (const role of STAFF_ROLES) {
    const held = ev.staff.filter((st) => st.role === role);
    for (const st of held)
      rows.push({
        key: st.id,
        label: staffRoleLabel(t, st.role, st.title, ev.section),
        person: { leader_id: st.leader_id, name: st.leader_id ? memberName(st) : st.name, photo: st.photo, outside: !st.leader_id },
        edit: () => onEdit(st),
      });
    if (!held.length && CORE_STAFF.includes(role))
      rows.push({ key: role, label: staffRoleLabel(t, role, null, ev.section), person: null, edit: () => onAssign(role) });
  }

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>{t('event.tabStaff')}</CardTitle>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => onAssign(null)} className="w-full sm:w-auto">
            <IconPlus />
            {t('event.addStaff')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((r) => (
            // The post on its own column from sm up, so the names line up and read as a roster
            <li
              key={r.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:px-5"
            >
              <span className="col-span-2 text-sm text-muted-foreground sm:col-span-1">{r.label}</span>
              {r.person ? (
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar photo={r.person.photo} name={r.person.name} className="h-8 w-8" />
                  <span className="min-w-0">
                    {r.person.leader_id && canLeaders ? (
                      <Link
                        to={`/leaders/${r.person.leader_id}`}
                        className="focus-ring block truncate rounded font-medium hover:text-primary hover:underline"
                      >
                        {r.person.name}
                      </Link>
                    ) : (
                      <span className="block truncate font-medium">{r.person.name}</span>
                    )}
                    {r.person.outside && <span className="block text-xs text-muted-foreground">{t('event.outside')}</span>}
                  </span>
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">{t('event.unassigned')}</span>
              )}
              {canEdit &&
                (r.person ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={r.edit}
                    aria-label={`${t('common.edit')} — ${r.label}`}
                    className="text-muted-foreground"
                  >
                    <IconPencil />
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={r.edit}>
                    {t('event.assign')}
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function StaffDialog({ ev, staff, presetRole, open, onClose, onSaved, leaders, t }) {
  const toast = useToast();
  const confirm = useConfirm();
  const blank = { role: 'gathering', title: '', mode: 'leader', leader_id: '', name: '' };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const fem = isFeminine(ev.section);
  const g = (key) => t(fem ? [`${key}F`, key] : key);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      staff
        ? {
            role: staff.role,
            title: staff.title || '',
            mode: staff.leader_id ? 'leader' : 'outside',
            leader_id: staff.leader_id ? String(staff.leader_id) : '',
            name: staff.name || '',
          }
        : { ...blank, role: presetRole || 'gathering' }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, staff, presetRole]);

  // The قادة of the camp's قسم; an archived one stays on the post he already held
  const leaderOptions = leaders
    .filter((l) => l.section === ev.section && (l.status === 'active' || l.id === staff?.leader_id))
    .map((l) => ({ value: l.id, label: memberName(l) }));

  async function save(e) {
    e.preventDefault();
    setError(null);
    if (form.mode === 'leader' && !form.leader_id) return setError(g('event.pickLeader'));
    setSaving(true);
    try {
      const body = {
        role: form.role,
        title: form.role === 'other' ? form.title : null,
        leader_id: form.mode === 'leader' ? Number(form.leader_id) : null,
        name: form.mode === 'outside' ? form.name : null,
      };
      const res = staff
        ? await api.put(`/events/${ev.id}/staff/${staff.id}`, body)
        : await api.post(`/events/${ev.id}/staff`, body);
      onSaved(res, 'event.staffSaved');
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const role = staffRoleLabel(t, staff.role, staff.title, ev.section);
    if (
      !(await confirm({
        title: t('event.removeStaff'),
        message: t('event.removeStaffConfirm', { name: staff.leader_id ? memberName(staff) : staff.name, role }),
        confirmLabel: t('event.removeStaff'),
      }))
    )
      return;
    try {
      onSaved(await api.del(`/events/${ev.id}/staff/${staff.id}`), 'event.staffRemoved');
    } catch (err) {
      toast.error(errorText(t, err));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      // Named after the post being filled — «تعيين أمين الإعلام» — and following the pick
      title={
        staff
          ? t('event.editStaff')
          : form.role === 'other'
            ? t('event.addStaff')
            : t('event.assignRole', { role: staffRoleLabel(t, form.role, null, ev.section) })
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          {staff ? (
            <Button variant="destructive-ghost" onClick={remove}>
              <IconTrash />
              {t('event.removeStaff')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="event-staff-form" loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <form id="event-staff-form" onSubmit={save} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="st_role">{t('event.staffRole')}</Label>
          <Select id="st_role" value={form.role} onChange={set('role')}>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {r === 'other' ? t('event.role_other') : staffRoleLabel(t, r, null, ev.section)}
              </option>
            ))}
          </Select>
        </div>
        {form.role === 'other' && (
          <div className="space-y-1.5">
            <Label htmlFor="st_title">{t('event.staffTitle')}</Label>
            <Input
              id="st_title"
              required
              maxLength={80}
              autoComplete="off"
              placeholder={t('event.staffTitleHint')}
              value={form.title}
              onChange={set('title')}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label>{t('event.staffWho')}</Label>
          <SegmentedControl
            className="w-full"
            label={t('event.staffWho')}
            value={form.mode}
            onChange={(v) => setForm((f) => ({ ...f, mode: v }))}
            options={[
              { value: 'leader', label: g('event.personLeader') },
              { value: 'outside', label: t('event.personOutside') },
            ]}
          />
        </div>
        {form.mode === 'leader' ? (
          <SearchSelect
            id="st_leader"
            value={form.leader_id}
            onChange={set('leader_id')}
            options={leaderOptions}
            placeholder={g('event.pickLeader')}
            searchPlaceholder={t('session.searchLeader')}
            emptyLabel={t('member.noListValue')}
            ariaLabel={g('event.pickLeader')}
          />
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="st_name">{t('event.staffName')}</Label>
            <Input id="st_name" required maxLength={120} autoComplete="off" value={form.name} onChange={set('name')} />
            <p className="text-xs text-muted-foreground">{t('event.staffOutsideHint')}</p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/* ============================================================
   المشاركون و الدفع
   ============================================================ */

/** What a participant paid, as a chip: tapping it opens the payment when allowed. */
function PayChip({ p, ev, t, onOpen }) {
  const state = payState(p, ev);
  // A guest is never charged: nothing to show or to record for him
  if (state === 'free' && (!onOpen || p.guest_name)) return null;
  const due = dueOf(p, ev);
  const label = {
    paid: fmtAmount(p.paid),
    partial: `${fmtAmount(p.paid, { unit: false })} / ${fmtAmount(due)}`,
    unpaid: t('session.notPaid'),
    exempt: t('event.exempt'),
    free: t('event.free'),
  }[state];
  const name = participantName(p);
  if (!onOpen)
    return (
      <Badge variant={PAY_BADGE[state]}>
        {state === 'paid' || state === 'partial' ? <IconCoins className="h-3 w-3" /> : null}
        <span className="tabular-nums">{label}</span>
      </Badge>
    );
  return (
    <Button
      variant={state === 'unpaid' || state === 'free' ? 'outline' : 'secondary'}
      size="sm"
      onClick={onOpen}
      aria-label={t('event.paymentOf', { name })}
      className={cn(
        'gap-1.5 tabular-nums',
        state === 'paid' && 'text-success',
        state === 'partial' && 'text-warning',
        state === 'exempt' && 'text-info',
        (state === 'unpaid' || state === 'free') && 'text-muted-foreground'
      )}
    >
      {/* The amount says it is money: on a phone the coin's room goes to the name */}
      <IconCoins className="hidden h-3.5 w-3.5 sm:block" />
      {label}
    </Button>
  );
}

const PAY_FILTERS = ['paid', 'partial', 'unpaid', 'exempt'];

function ParticipantsTab({ ev, t, lng, canEdit, canPay, canFees, links, onAdd, onPay, onRemove, onRestore, onRemind }) {
  const [query, setQuery] = useState('');
  const [payFilter, setPayFilter] = useState('');
  const people = ev.participants;
  const ids = new Set(people.map((p) => p.id));
  // Attended out of the جلسات already marked for him — a جلسة nobody marked yet says nothing
  const attended = (p) => ev.attendance.filter((a) => a.participant_id === p.id && a.status === 'present').length;
  const markedFor = (p) => ev.attendance.filter((a) => a.participant_id === p.id).length;
  const anyMarks = ev.attendance.some((a) => ids.has(a.participant_id));
  const match = nameMatcher(query);
  const filtered = people.filter((p) => match(p) && (!payFilter || payState(p, ev) === payFilter));
  const payOptions = PAY_FILTERS.map((s) => ({
    value: s,
    label: `${t(`event.state_${s}`)} · ${people.filter((p) => payState(p, ev) === s).length}`,
  })).filter((o, i) => people.some((p) => payState(p, ev) === PAY_FILTERS[i]) || o.value === payFilter);
  const groups = ['member', 'leader', 'guest']
    .map((kind) => ({ kind, rows: filtered.filter((p) => participantKind(p) === kind) }))
    .filter((g) => g.rows.length > 0);
  const hidden = ev.participant_total - people.length;
  const showBranch = mixedBranches(ev);
  // A free event asks nothing: no payment chip on every row, unless money was recorded anyway
  const showPay = canFees && (ev.fee > 0 || people.some((p) => p.paid !== null || p.amount_due !== null));
  // E2 : qui doit encore, et la feuille de relance avec les téléphones des parents
  const unpaid = showPay ? unpaidOf(ev) : [];
  const unpaidTotal = unpaid.reduce((n, p) => n + remainingOf(p, ev), 0);

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>
          {t('event.participants')}
          <span className="ms-2 font-normal tabular-nums text-muted-foreground">{people.length}</span>
        </CardTitle>
        {canEdit && people.length > 0 && (
          <Button size="sm" variant="outline" onClick={onAdd} className="w-full sm:w-auto">
            <IconPlus />
            {t('event.addParticipants')}
          </Button>
        )}
      </CardHeader>
      {people.length > 0 && (
        <div className="flex flex-col gap-2 px-4 pb-3 sm:flex-row sm:items-center sm:px-5">
          <SearchInput
            value={query}
            onChange={setQuery}
            autoFocusHotkey={false}
            placeholder={t('event.searchParticipant')}
            className="sm:max-w-xs"
          />
          {showPay && payOptions.length > 0 && (
            <FilterSelect
              value={payFilter}
              onChange={setPayFilter}
              allLabel={t('event.allPayments')}
              ariaLabel={t('event.payment')}
              className="sm:w-auto sm:min-w-44"
              options={payOptions}
            />
          )}
        </div>
      )}
      {unpaid.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 sm:px-5">
          <p className="text-sm font-medium tabular-nums text-destructive">
            {t('campFile.unpaidLine', { amount: fmtAmount(unpaidTotal), count: familyCount(unpaid) })}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onRemind}>
              <IconPhone />
              {t('campFile.remind')}
            </Button>
            <ExportPdfButton kind="event-unpaid" id={ev.id} />
          </div>
        </div>
      )}
      {hidden > 0 && (
        <p className="px-4 pb-3 text-xs text-muted-foreground sm:px-5">{t('event.ownBranchesOnly', { count: hidden })}</p>
      )}
      <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
        {people.length === 0 ? (
          <EmptyState
            icon={<IconUsers className="h-6 w-6" />}
            title={t('event.noParticipants')}
            action={
              canEdit && (
                <Button variant="brand" onClick={onAdd}>
                  <IconPlus />
                  {t('event.addParticipants')}
                </Button>
              )
            }
          >
            {t('event.noParticipantsHint')}
          </EmptyState>
        ) : groups.length === 0 ? (
          <EmptyState icon={<IconSearch className="h-6 w-6" />} title={t('common.noResults')} />
        ) : (
          groups.map(({ kind, rows }) => (
            <section key={kind}>
              <div className="flex items-center gap-2 border-y border-border bg-muted/30 px-4 py-2 sm:px-5">
                <span className="text-sm font-semibold">
                  {t(kind === 'leader' && isFeminine(ev.section) ? 'event.group_leaderF' : `event.group_${kind}`)}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{rows.length}</span>
              </div>
              <ul className="divide-y divide-border">
                {rows.map((p) => {
                  const name = participantName(p);
                  const to =
                    kind === 'member' && links.members
                      ? `/members/${p.member_id}`
                      : kind === 'leader' && links.leaders
                        ? `/leaders/${p.leader_id}`
                        : null;
                  // One line on a phone too: name and who he is on the inline-start, his
                  // payment and the way out of the list on the inline-end. The name wraps
                  // rather than ending in «أحمد عب…» beside the payment.
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                      <ParticipantAvatar p={p} />
                      <div className="min-w-0 flex-1">
                        {to ? (
                          <Link
                            to={to}
                            className="focus-ring block rounded font-medium [overflow-wrap:anywhere] hover:text-primary hover:underline"
                          >
                            {name}
                          </Link>
                        ) : (
                          <span className="block font-medium [overflow-wrap:anywhere]">{name}</span>
                        )}
                        <ParticipantLine
                          p={p}
                          t={t}
                          lng={lng}
                          section={ev.section}
                          showBranch={showBranch}
                          extra={anyMarks && t('event.attended', { present: attended(p), total: markedFor(p) })}
                        />
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {showPay && <PayChip p={p} ev={ev} t={t} onOpen={canPay ? () => onPay(p) : null} />}
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => onRemove(p)}
                            aria-label={`${t('event.removeParticipant')} — ${name}`}
                          >
                            <IconX />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </CardContent>
      <WithdrawnParticipants
        ev={ev}
        t={t}
        lng={lng}
        canEdit={canEdit}
        canFees={canFees}
        links={links}
        showBranch={showBranch}
        onRestore={onRestore}
      />
    </Card>
  );
}

/**
 * من أُزيل من اللائحة: لم يشارك، و ملفّه يقول ذلك. زرّ واحد يعيده بدفعه و حضوره كما كانا — لمن
 * أُزيل خطأً. Folded away: it is the exception, not the list.
 */
function WithdrawnParticipants({ ev, t, lng, canEdit, canFees, links, showBranch, onRestore }) {
  const rows = ev.withdrawn || [];
  if (rows.length === 0) return null;
  return (
    <details className="group border-t border-border">
      <summary className="focus-ring flex cursor-pointer select-none list-none items-center gap-2 px-4 py-3 hover:bg-accent/40 focus-visible:[outline-offset:-2px]! sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold">{t('event.withdrawn')}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{rows.length}</span>
        <IconChevronDown className="ms-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <p className="px-4 pb-3 text-xs text-muted-foreground sm:px-5">{t('event.withdrawnHint')}</p>
      <ul className="divide-y divide-border border-t border-border">
        {rows.map((p) => {
          const name = participantName(p);
          const kind = participantKind(p);
          const to =
            kind === 'member' && links.members
              ? `/members/${p.member_id}`
              : kind === 'leader' && links.leaders
                ? `/leaders/${p.leader_id}`
                : null;
          // Who took him off and when — and the payment that no longer counts, until he is back
          const trail = [
            p.withdrawn_by && t('event.withdrawnBy', { name: p.withdrawn_by, date: fmtDate(p.withdrawn_at) }),
            canFees && p.paid > 0 && t('event.withdrawnPaid', { amount: fmtAmount(p.paid) }),
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <ParticipantAvatar p={p} />
              <div className="min-w-0 flex-1">
                {to ? (
                  <Link
                    to={to}
                    className="focus-ring block rounded font-medium [overflow-wrap:anywhere] hover:text-primary hover:underline"
                  >
                    {name}
                  </Link>
                ) : (
                  <span className="block font-medium [overflow-wrap:anywhere]">{name}</span>
                )}
                <ParticipantLine p={p} t={t} lng={lng} section={ev.section} showBranch={showBranch} />
                {trail && <span className="block text-xs text-muted-foreground">{trail}</span>}
              </div>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => onRestore(p)}
                  aria-label={t('event.restoreParticipant', { name })}
                >
                  {t('event.restore')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * إضافة مشاركين: عناصر الفرق المعنية، قادة القسم، و ضيوف بأسمائهم. Three lists in one
 * dialog, one save — a camp is usually filled in a single sitting.
 */
function AddParticipantsDialog({ ev, open, onClose, onAdded, t, lng }) {
  const candidates = useFetch(open ? `/events/${ev.id}/candidates` : null, { skip: !open });
  const [mode, setMode] = useState('member');
  const [members, setMembers] = useState([]);
  const [leaders, setLeaders] = useState([]);
  const [guests, setGuests] = useState([]);
  const [guestInput, setGuestInput] = useState('');
  const [query, setQuery] = useState('');
  const [branch, setBranch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setMode('member');
    setMembers([]);
    setLeaders([]);
    setGuests([]);
    setGuestInput('');
    setQuery('');
    setBranch('');
    setError(null);
  }, [open]);

  const data = candidates.data || { members: [], leaders: [] };
  const match = nameMatcher(query);
  const poolBranches = [...new Map(data.members.map((m) => [m.branch_id, m])).values()];
  // Ticked rows never hide behind a search: a selection must not look lost
  const shownMembers = data.members.filter(
    (m) => (!branch || m.branch_id === Number(branch)) && (members.includes(m.id) || match(m))
  );
  const shownLeaders = data.leaders.filter((l) => leaders.includes(l.id) || match(l));
  const pendingGuest = guestInput.trim().replace(/\s+/g, ' ');
  const guestList = pendingGuest && !guests.includes(pendingGuest) ? [...guests, pendingGuest] : guests;
  const total = members.length + leaders.length + guestList.length;

  const toggle = (setter) => (id) => setter((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  // اختيار الكل only touches the rows on screen
  function toggleAll(rows, picked, setter) {
    const ids = rows.map((r) => r.id);
    const all = ids.length > 0 && ids.every((id) => picked.includes(id));
    setter((xs) => (all ? xs.filter((x) => !ids.includes(x)) : [...new Set([...xs, ...ids])]));
  }

  function addGuest() {
    if (!pendingGuest) return;
    setGuests((g) => (g.includes(pendingGuest) ? g : [...g, pendingGuest]));
    setGuestInput('');
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const payload = await api.post(`/events/${ev.id}/participants`, {
        member_ids: members,
        leader_ids: leaders,
        guest_names: guestList,
      });
      onAdded(payload, total);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setSaving(false);
    }
  }

  const picker = (rows, picked, setter, line, empty) => {
    const allPicked = rows.length > 0 && rows.every((r) => picked.includes(r.id));
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">
            {t('session.selectedCount', { count: picked.length })}
          </span>
          {rows.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="-my-1 px-2 text-primary"
              aria-pressed={allPicked}
              onClick={() => toggleAll(rows, picked, setter)}
            >
              {t(allPicked ? 'common.clearSelection' : 'common.selectAll')}
            </Button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {query ? t('common.noResults') : empty}
          </p>
        ) : (
          <div className="max-h-[45dvh] overflow-y-auto rounded-lg border border-border p-1.5">
            {rows.map((r) => (
              <label
                key={r.id}
                className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm hover:bg-accent/60 sm:min-h-9"
              >
                <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(setter)(r.id)} />
                <span className="min-w-0 flex-1 truncate">{memberName(r)}</span>
                {line && <span className="shrink-0 truncate text-xs text-muted-foreground">{line(r)}</span>}
              </label>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('event.addParticipants')}
      size="lg"
      footer={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={save} loading={saving} disabled={total === 0}>
              {total > 0 ? t('event.addCount', { count: total }) : t('event.addParticipants')}
            </Button>
          </div>
        </div>
      }
    >
      {candidates.error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={candidates.reload} retryLabel={t('error.retry')} />
      ) : (
        <div className="space-y-4">
          <SegmentedControl
            label={t('event.addParticipants')}
            value={mode}
            onChange={(v) => {
              setMode(v);
              setQuery('');
            }}
            className="flex w-full"
            options={[
              { value: 'member', label: `${t('event.group_member')}${members.length ? ` · ${members.length}` : ''}` },
              {
                value: 'leader',
                label: `${t(isFeminine(ev.section) ? 'event.group_leaderF' : 'event.group_leader')}${leaders.length ? ` · ${leaders.length}` : ''}`,
              },
              { value: 'guest', label: `${t('event.group_guest')}${guestList.length ? ` · ${guestList.length}` : ''}` },
            ]}
          />
          {mode !== 'guest' && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <SearchInput
                value={query}
                onChange={setQuery}
                autoFocusHotkey={false}
                placeholder={t(mode === 'member' ? 'session.searchMember' : 'session.searchLeader')}
              />
              {mode === 'member' && poolBranches.length > 1 && (
                <FilterSelect
                  value={branch}
                  onChange={setBranch}
                  allLabel={t('member.allBranches')}
                  ariaLabel={t('member.branch')}
                  className="sm:w-auto sm:min-w-40"
                  options={poolBranches.map((m) => ({ value: m.branch_id, label: branchName(m, lng) }))}
                />
              )}
            </div>
          )}
          {candidates.loading ? (
            <div className="space-y-2" aria-busy="true">
              <div className="skeleton h-9 rounded-md" />
              <div className="skeleton h-9 rounded-md" />
              <div className="skeleton h-9 rounded-md" />
            </div>
          ) : mode === 'member' ? (
            picker(
              shownMembers,
              members,
              setMembers,
              (m) => [poolBranches.length > 1 && branchName(m, lng), m.group_name].filter(Boolean).join(' · '),
              t('event.noMoreMembers')
            )
          ) : mode === 'leader' ? (
            picker(shownLeaders, leaders, setLeaders, null, t('event.noMoreLeaders'))
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  autoComplete="off"
                  maxLength={120}
                  aria-label={t('session.guestPlaceholder')}
                  placeholder={t('session.guestPlaceholder')}
                  value={guestInput}
                  onChange={(e) => setGuestInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addGuest();
                    }
                  }}
                />
                <Button variant="outline" onClick={addGuest} disabled={!pendingGuest}>
                  <IconPlus />
                  {t('session.addGuest')}
                </Button>
              </div>
              {guests.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {guests.map((name) => (
                    <li
                      key={name}
                      className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-card ps-3 text-sm sm:min-h-9"
                    >
                      {name}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full text-muted-foreground"
                        onClick={() => setGuests((g) => g.filter((x) => x !== name))}
                        aria-label={`${t('common.delete')} — ${name}`}
                      >
                        <IconX className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{t('event.guestsHint')}</p>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

/**
 * اشتراك مشارك: ما دفعه حتى الآن (تراكمي — دفعة ثانية تُكتب مجموعًا)، و لمن ينظّم
 * المخيم ما يُطلب منه: قيمة الاشتراك، أو معفى، أو مبلغ خاص.
 */
function PaymentDialog({ ev, participant: p, open, onClose, onSaved, canEdit, t }) {
  const toast = useToast();
  const [paid, setPaid] = useState('');
  const [dueMode, setDueMode] = useState('fee');
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !p) return;
    const due = dueOf(p, ev);
    // Most pay the whole amount at once: the field opens on it, a confirmation away
    setPaid(p.paid !== null && p.paid !== undefined ? String(p.paid) : due > 0 ? String(due) : '');
    setDueMode(p.amount_due === null || p.amount_due === undefined ? 'fee' : p.amount_due === 0 ? 'exempt' : 'custom');
    setCustom(p.amount_due ? String(p.amount_due) : '');
  }, [open, p]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return <Dialog open={false} onClose={onClose} title="" />;
  const name = participantName(p);
  const nextDue = dueMode === 'exempt' ? 0 : dueMode === 'custom' ? Number(custom) || 0 : (ev.fee ?? 0);

  async function save(e) {
    e.preventDefault();
    const raw = paid.trim();
    const amount = raw === '' ? null : Number(raw);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return;
    const body = { paid: amount };
    if (canEdit) {
      const due = dueMode === 'fee' ? null : dueMode === 'exempt' ? 0 : Number(custom);
      if (dueMode === 'custom' && (!custom.trim() || !Number.isFinite(due) || due < 0)) return;
      if (due !== (p.amount_due ?? null)) body.amount_due = due;
    }
    setSaving(true);
    try {
      onSaved(await api.put(`/events/${ev.id}/participants/${p.id}`, body));
    } catch (err) {
      toast.error(errorText(t, err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('event.paymentOf', { name })}
      description={t('event.dueLine', { amount: fmtAmount(dueOf(p, ev)) })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="event-payment-form" loading={saving}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <form id="event-payment-form" onSubmit={save} className="space-y-4">
        {canEdit && (
          <div className="space-y-1.5">
            <Label>{t('event.dueLabel')}</Label>
            <SegmentedControl
              label={t('event.dueLabel')}
              value={dueMode}
              onChange={setDueMode}
              className="flex w-full"
              options={[
                { value: 'fee', label: ev.fee ? t('event.dueStandard') : t('event.free') },
                { value: 'exempt', label: t('event.exempt') },
                { value: 'custom', label: t('event.dueCustom') },
              ]}
            />
            {dueMode === 'custom' && (
              <AmountInput
                aria-label={t('event.dueCustom')}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                required
              />
            )}
            <p className="text-xs text-muted-foreground">{t('event.dueHint')}</p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ep_paid">{t('event.paidLabel')}</Label>
          <AmountInput
            id="ep_paid"
            autoFocus
            placeholder={t('session.notPaid')}
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {nextDue > 0 && (
              <Button variant="outline" size="sm" onClick={() => setPaid(String(nextDue))}>
                {t('event.payFull', { amount: fmtAmount(nextDue) })}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setPaid('')}>
              {t('session.notPaid')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('event.paidHint')}</p>
        </div>
        {p.recorded_by && p.paid_at && (
          <p className="text-xs text-muted-foreground">
            {t('event.recordedBy', { name: p.recorded_by, date: fmtDate(p.paid_at.slice(0, 10)) })}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/* ============================================================
   المصاريف
   ============================================================ */

function ExpensesTab({ ev, t, canWrite, onAdd, onEdit }) {
  const list = ev.expenses || [];
  const total = list.reduce((n, x) => n + x.amount, 0);
  const byCategory = EXPENSE_CATEGORIES.map((c) => ({
    c,
    sum: list.filter((x) => x.category === c).reduce((n, x) => n + x.amount, 0),
  }))
    .filter((r) => r.sum > 0)
    .sort((a, b) => b.sum - a.sum);

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle>
            {t('event.expenses')}
            {list.length > 0 && (
              <span className="ms-2 font-normal tabular-nums text-muted-foreground">{fmtAmount(total)}</span>
            )}
          </CardTitle>
          {byCategory.length > 1 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {byCategory.map((r) => `${t(`event.cat_${r.c}`)} ${fmtAmount(r.sum)}`).join(' · ')}
            </p>
          )}
        </div>
        {canWrite && list.length > 0 && (
          <Button size="sm" variant="outline" onClick={onAdd} className="w-full sm:w-auto">
            <IconPlus />
            {t('event.addExpense')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
        {list.length === 0 ? (
          <EmptyState
            icon={<IconCoins className="h-6 w-6" />}
            title={t('event.noExpenses')}
            action={
              canWrite && (
                <Button variant="brand" onClick={onAdd}>
                  <IconPlus />
                  {t('event.addExpense')}
                </Button>
              )
            }
          >
            {t('event.noExpensesHint')}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {list.map((x) => {
              const meta = [t(`event.cat_${x.category}`), x.date && fmtDate(x.date), x.paid_by && t('event.paidByLine', { name: x.paid_by })]
                .filter(Boolean)
                .join(' · ');
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{x.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{meta}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{fmtAmount(x.amount)}</span>
                </>
              );
              return (
                <li key={x.id}>
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => onEdit(x)}
                      aria-label={`${t('common.edit')} — ${x.label}`}
                      className="focus-ring flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-accent/40 focus-visible:[outline-offset:-2px]! sm:px-5"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3 sm:px-5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ExpenseDialog({ ev, expense, open, onClose, onSaved, t }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ label: '', amount: '', category: 'other', date: '', paid_by: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      expense
        ? {
            label: expense.label,
            amount: String(expense.amount),
            category: expense.category,
            date: expense.date || '',
            paid_by: expense.paid_by || '',
          }
        : { label: '', amount: '', category: 'other', date: todayISO(), paid_by: '' }
    );
  }, [open, expense]);

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = { ...form, amount: Number(form.amount), date: form.date || null, paid_by: form.paid_by || null };
      const res = expense
        ? await api.put(`/events/${ev.id}/expenses/${expense.id}`, body)
        : await api.post(`/events/${ev.id}/expenses`, body);
      onSaved(res, expense ? 'event.expenseUpdated' : 'event.expenseAdded');
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !(await confirm({
        title: t('event.deleteExpense'),
        message: t('event.deleteExpenseConfirm', { label: expense.label, amount: fmtAmount(expense.amount) }),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      onSaved(await api.del(`/events/${ev.id}/expenses/${expense.id}`), 'event.expenseDeleted');
    } catch (err) {
      toast.error(errorText(t, err));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(expense ? 'event.editExpense' : 'event.addExpense')}
      footer={
        <div className="flex items-center justify-between gap-2">
          {expense ? (
            <Button variant="destructive-ghost" onClick={remove}>
              <IconTrash />
              {t('common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="event-expense-form" loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <form id="event-expense-form" onSubmit={save} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ex_label">{t('event.expenseLabel')}</Label>
          <Input
            id="ex_label"
            required
            maxLength={200}
            autoComplete="off"
            placeholder={t('event.expenseLabelHint')}
            value={form.label}
            onChange={set('label')}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ex_amount">{t('event.amount')}</Label>
            <AmountInput
              id="ex_amount"
              required
              value={form.amount}
              onChange={set('amount')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ex_cat">{t('event.category')}</Label>
            <Select id="ex_cat" value={form.category} onChange={set('category')}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`event.cat_${c}`)}
                </option>
              ))}
            </Select>
          </div>
          {/* The whole width on a phone: half of it cut the date to «16/10/20…» beside its
              clear button, and «paid by» to half its hint */}
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="ex_date">{t('common.date')}</Label>
            <DatePicker id="ex_date" value={form.date} onChange={set('date')} />
          </div>
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="ex_by">{t('event.paidBy')}</Label>
            <Input
              id="ex_by"
              maxLength={120}
              autoComplete="off"
              placeholder={t('event.paidByHint')}
              value={form.paid_by}
              onChange={set('paid_by')}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/* ============================================================
   الصناديق
   ============================================================ */

// The caisse a line comes from or goes to: the فوج's, or a فرقة's
const caisseName = (f, t, lng) => (f.branch_id ? branchName(f, lng) : t('treasury.groupShort'));
const withSign = (n) => (n < 0 ? `−${fmtAmount(-n)}` : fmtAmount(n));

/**
 * Money between the فوج's caisses and this event: taken from the group's or a فرقة's
 * caisse for it, or handed back once it is over. Each line is in that caisse too.
 * Written by whoever holds the caisse (`ev.funding_boxes`).
 */
function FundingsCard({ ev, t, lng, onAdd, onEdit }) {
  const list = ev.fundings || [];
  const boxes = ev.funding_boxes || [];
  const held = (f) => boxes.some((b) => b.key === f.box);
  const net = list.reduce((n, f) => n + (f.direction === 'to_event' ? f.amount : -f.amount), 0);
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle>
            {t('event.fundings')}
            {list.length > 0 && (
              <span className="ms-2 font-normal tabular-nums text-muted-foreground">
                <span dir="ltr">{signed(net)}</span>
              </span>
            )}
          </CardTitle>
          {list.length === 0 && <p className="mt-1 text-sm text-muted-foreground">{t('event.fundingsHint')}</p>}
        </div>
        {boxes.length > 0 && (
          // Side by side while both fit; on a narrow phone «Rendre à une caisse» takes the next
          // line instead of running out of the card
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onAdd('to_event')} className="flex-1 sm:flex-none">
              <IconPlus />
              {t('event.fundingTake')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAdd('from_event')} className="flex-1 sm:flex-none">
              {t('event.fundingReturn')}
            </Button>
          </div>
        )}
      </CardHeader>
      {list.length > 0 && (
        <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
          <ul className="divide-y divide-border border-t border-border">
            {list.map((f) => {
              const into = f.direction === 'to_event';
              const title = t(into ? 'event.fundingFromRow' : 'event.fundingToRow', { name: caisseName(f, t, lng) });
              const meta = [fmtDate(f.date), f.label, f.created_by && t('treasury.recordedBy', { name: f.created_by })]
                .filter(Boolean)
                .join(' · ');
              const body = (
                <>
                  <IconWallet className="text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{title}</span>
                    <span className="block text-xs text-muted-foreground">{meta}</span>
                  </span>
                  <span dir="ltr" className={cn('shrink-0 font-semibold tabular-nums', into && 'text-success')}>
                    {into ? '+' : '−'}
                    {fmtAmount(f.amount)}
                  </span>
                </>
              );
              return (
                <li key={f.id}>
                  {held(f) ? (
                    <button
                      type="button"
                      onClick={() => onEdit(f)}
                      aria-label={`${t('common.edit')} — ${title} ${fmtAmount(f.amount)}`}
                      className="focus-ring flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-accent/40 focus-visible:[outline-offset:-2px]! sm:px-5"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3 sm:px-5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Taking money from a caisse for the event, or handing it back to one: which caisse,
 * how much, which day. Taking says what the caisse keeps after.
 */
function FundingDialog({ ev, funding, direction, open, onClose, onSaved, t, lng }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ box: '', amount: '', date: '', label: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const boxes = ev.funding_boxes || [];
  const dir = funding?.direction || direction;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (funding) {
      setForm({ box: funding.box, amount: String(funding.amount), date: funding.date, label: funding.label || '' });
      return;
    }
    // A camp of one فرقة is first paid for by that فرقة's caisse
    const own = boxes.find((b) => b.branch_id && ev.branch_ids?.length === 1 && b.branch_id === ev.branch_ids[0]);
    setForm({ box: (own || boxes[0])?.key || '', amount: '', date: todayISO(), label: '' });
  }, [open, funding]); // eslint-disable-line react-hooks/exhaustive-deps -- the caisses on opening

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        direction: dir,
        box: form.box,
        amount: Number(form.amount),
        date: form.date,
        label: form.label.trim() || null,
      };
      const res = funding
        ? await api.put(`/events/${ev.id}/fundings/${funding.id}`, body)
        : await api.post(`/events/${ev.id}/fundings`, body);
      onSaved(res, funding ? 'event.fundingUpdated' : 'event.fundingAdded');
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !(await confirm({
        title: t('event.fundingEdit'),
        message: t('event.deleteFundingConfirm', { amount: fmtAmount(funding.amount) }),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      onSaved(await api.del(`/events/${ev.id}/fundings/${funding.id}`), 'event.fundingDeleted');
    } catch (err) {
      toast.error(errorText(t, err));
    }
  }

  const box = boxes.find((b) => b.key === form.box);
  // Editing: what the line already took out of this caisse goes back before the new amount
  const back =
    funding && funding.direction === 'to_event' && funding.box === form.box && box?.start && funding.date >= box.start.date
      ? funding.amount
      : 0;
  const after = dir === 'to_event' && box?.start && form.amount ? box.balance + back - Number(form.amount) : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(funding ? 'event.fundingEdit' : dir === 'to_event' ? 'event.fundingTitleTake' : 'event.fundingTitleReturn')}
      footer={
        <div className="flex items-center justify-between gap-2">
          {funding ? (
            <Button variant="destructive-ghost" onClick={remove}>
              <IconTrash />
              {t('common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="event-funding-form" loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <form id="event-funding-form" onSubmit={save} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fd_box">{t(dir === 'to_event' ? 'treasury.transferFrom' : 'treasury.transferTo')}</Label>
          <Select id="fd_box" value={form.box} onChange={set('box')}>
            {boxes.map((b) => (
              <option key={b.key} value={b.key}>
                {caisseName(b, t, lng)}
              </option>
            ))}
          </Select>
          {box?.start && (
            <p className="text-xs text-muted-foreground">
              {t('event.fundingInBox')} <span dir="ltr" className="tabular-nums">{withSign(box.balance)}</span>
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="fd_amount">{t('event.amount')}</Label>
            <AmountInput
              id="fd_amount"
              required
              value={form.amount}
              onChange={set('amount')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fd_date">{t('common.date')}</Label>
            <DatePicker id="fd_date" required clearable={false} value={form.date} onChange={set('date')} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fd_label">{t('treasury.transferNote')}</Label>
          <Input
            id="fd_label"
            maxLength={200}
            autoComplete="off"
            placeholder={t('event.fundingNoteHint')}
            value={form.label}
            onChange={set('label')}
          />
        </div>
        {after !== null && (
          <p className={cn('text-sm', after < 0 ? 'font-medium text-destructive' : 'text-muted-foreground')}>
            {after < 0 ? t('treasury.boxShort') : t('treasury.leftAfter', { amount: withSign(after) })}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/* ============================================================
   التبرعات
   ============================================================ */

/** Anonymous on purpose: an amount, a day, a note — never who gave it. */
function DonationsCard({ ev, t, canWrite, onAdd, onEdit }) {
  const list = ev.donations || [];
  const total = list.reduce((n, d) => n + d.amount, 0);
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle>
            {t('event.donations')}
            {list.length > 0 && (
              <span className="ms-2 font-normal tabular-nums text-muted-foreground">{fmtAmount(total)}</span>
            )}
          </CardTitle>
          {list.length === 0 && <p className="mt-1 text-sm text-muted-foreground">{t('event.noDonations')}</p>}
        </div>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={onAdd} className="w-full sm:w-auto">
            <IconPlus />
            {t('event.addDonation')}
          </Button>
        )}
      </CardHeader>
      {list.length > 0 && (
        <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
          <ul className="divide-y divide-border border-t border-border">
            {list.map((d) => {
              const title = d.note || t('event.donation');
              const body = (
                <>
                  <IconHandHeart className="text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{title}</span>
                    {d.date && <span className="block text-xs text-muted-foreground">{fmtDate(d.date)}</span>}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{fmtAmount(d.amount)}</span>
                </>
              );
              return (
                <li key={d.id}>
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => onEdit(d)}
                      aria-label={`${t('common.edit')} — ${title} ${fmtAmount(d.amount)}`}
                      className="focus-ring flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-accent/40 focus-visible:[outline-offset:-2px]! sm:px-5"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3 sm:px-5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function DonationDialog({ ev, donation, open, onClose, onSaved, t }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ amount: '', date: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      donation
        ? { amount: String(donation.amount), date: donation.date || '', note: donation.note || '' }
        : { amount: '', date: todayISO(), note: '' }
    );
  }, [open, donation]);

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = { amount: Number(form.amount), date: form.date || null, note: form.note || null };
      const res = donation
        ? await api.put(`/events/${ev.id}/donations/${donation.id}`, body)
        : await api.post(`/events/${ev.id}/donations`, body);
      onSaved(res, donation ? 'event.donationUpdated' : 'event.donationAdded');
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !(await confirm({
        title: t('event.deleteDonation'),
        message: t('event.deleteDonationConfirm', { amount: fmtAmount(donation.amount) }),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      onSaved(await api.del(`/events/${ev.id}/donations/${donation.id}`), 'event.donationDeleted');
    } catch (err) {
      toast.error(errorText(t, err));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(donation ? 'event.editDonation' : 'event.addDonation')}
      footer={
        <div className="flex items-center justify-between gap-2">
          {donation ? (
            <Button variant="destructive-ghost" onClick={remove}>
              <IconTrash />
              {t('common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="event-donation-form" loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <form id="event-donation-form" onSubmit={save} className="space-y-4">
        {/* Stacked on a phone: at half width the date was cut beside its clear button */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="dn_amount">{t('event.amount')}</Label>
            <AmountInput
              id="dn_amount"
              required
              value={form.amount}
              onChange={set('amount')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dn_date">{t('common.date')}</Label>
            <DatePicker id="dn_date" value={form.date} onChange={set('date')} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dn_note">{t('event.donationNote')}</Label>
          <Input
            id="dn_note"
            maxLength={200}
            autoComplete="off"
            placeholder={t('event.donationNoteHint')}
            value={form.note}
            onChange={set('note')}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t('event.donationAnon')}</p>
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/* ============================================================
   Dupliquer, relancer
   ============================================================ */

// Day arithmetic on ISO dates, at noon so no clock change moves the day
const isoAt = (iso) => Date.parse(`${iso}T12:00:00Z`);
const isoShift = (iso, days) => new Date(isoAt(iso) + days * 86400000).toISOString().slice(0, 10);
const isoDelta = (from, to) => Math.round((isoAt(to) - isoAt(from)) / 86400000);

/**
 * Le camp de l'an dernier refait : un titre et un premier jour, le reste suit côté serveur
 * (فرق, طلائع, programme, هيئة قيادية, check-list), décalé d'autant de jours. Proposé un an
 * plus tard, les années du titre avancées d'autant («مخيم 2025» → «مخيم 2026»).
 */
function DuplicateDialog({ ev, open, onClose, onDone, t }) {
  const [form, setForm] = useState({ title: '', start_date: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const y = Number(ev.start_date.slice(0, 4)) + 1;
    // 29 February has no twin next year: the 28th then
    const next = `${y}${ev.start_date.slice(4)}`;
    setForm({
      title: ev.title.replace(/\b(19|20)\d{2}\b/g, (m) => String(Number(m) + 1)),
      start_date: next.endsWith('-02-29') ? `${y}-02-28` : next,
    });
  }, [open, ev]);

  const end = form.start_date ? isoShift(ev.end_date, isoDelta(ev.start_date, form.start_date)) : null;

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      onDone(await api.post(`/events/${ev.id}/duplicate`, { title: form.title.trim(), start_date: form.start_date }));
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('event.duplicateTitle')}
      description={t('event.duplicateHint')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="event-duplicate-form" loading={saving}>
            {t('event.duplicate')}
          </Button>
        </div>
      }
    >
      <form id="event-duplicate-form" onSubmit={save} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="dup_title">{t('event.name')}</Label>
          <Input
            id="dup_title"
            required
            maxLength={200}
            autoComplete="off"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dup_start">{t('event.startDate')}</Label>
          <DatePicker
            id="dup_start"
            required
            clearable={false}
            value={form.start_date}
            onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
          />
          {end && end !== form.start_date && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {t('event.duplicateEnd', { date: fmtDateRange(form.start_date, end) })}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/** «Ali», «Ali et Sara», «Ali, Sara et Hadi» — in the screen's language */
function joinNames(names, lng) {
  try {
    return new Intl.ListFormat(lng, { type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}

/**
 * Relancer les impayés : famille par famille (frères et sœurs = un seul message), le reste dû
 * de tous ses enfants, un appel ou un WhatsApp déjà rédigé. Sans members.contact, aucun numéro
 * n'arrive : la feuille PDF reste le moyen.
 */
function RemindDialog({ ev, open, onClose, canContact, t, lng }) {
  const families = unpaidFamilies(ev);
  const total = families.reduce((n, f) => n + f.amount, 0);
  const message = (f) =>
    t('campFile.remindMessage', {
      name: joinNames(f.people.map(participantName), lng),
      amount: fmtAmount(f.amount),
      title: ev.title,
    });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('campFile.remindTitle')}
      description={t('campFile.unpaidLine', { amount: fmtAmount(total), count: families.length })}
      autoFocus={false}
    >
      {!canContact ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('campFile.remindNoContact')}</p>
          <ExportPdfButton kind="event-unpaid" id={ev.id} />
        </div>
      ) : (
        <ul className="-mx-1 divide-y divide-border">
          {families.map((f) => (
            <li key={f.key} className="space-y-2 px-1 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                  <bdi>{joinNames(f.people.map(participantName), lng)}</bdi>
                </p>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-destructive">{fmtAmount(f.amount)}</span>
              </div>
              {f.phones.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('campFile.remindNoPhone')}</p>
              ) : (
                f.phones.slice(0, 2).map((ph) => (
                  <div key={ph.number} className="flex gap-2">
                    <a
                      href={telHref(ph.number)}
                      className="focus-ring flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border bg-card px-3 text-sm font-medium shadow-xs transition-colors hover:bg-accent/60"
                    >
                      <IconPhone className="h-4 w-4 shrink-0 text-primary" />
                      <span dir="ltr" className="truncate tabular-nums">
                        {fmtPhone(ph.number)}
                      </span>
                      {ph.mother && <span className="text-xs text-muted-foreground">{t('member.motherShort')}</span>}
                    </a>
                    <WhatsAppTile
                      href={`${waHref(ph.number)}?text=${encodeURIComponent(message(f))}`}
                      label={t('campFile.remindWhatsApp', { number: fmtPhone(ph.number) })}
                    />
                  </div>
                ))
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/* ============================================================
   الصفحة
   ============================================================ */

/**
 * مخيم أو دورة: الترويسة و أرقامه، ثم ثلاث لوحات — البرنامج (جلسات يومًا يومًا، و
 * حضور كل جلسة من لائحة المشاركين نفسها)، المشاركون و دفعهم، و المالية (المصاريف و التبرعات).
 */
export default function EventDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const navigate = useNavigate();
  const back = useBack('/events');
  const toast = useToast();
  const confirm = useConfirm();
  const { has } = usePerms();
  // Each part of the مخيم has its own right (events.*)
  const canEdit = has('events.manage');
  const canMark = has('events.attendance');
  const canFees = has('events.read.fees');
  const canPay = has('events.payments');
  const canSpend = has('events.expenses');
  const canDelete = has('events.delete');

  const { data: ev, setData: setEv, loading, error, errorStatus, reload } = useFetch(`/events/${id}`);
  const branches = useFetch('/branches');
  const leaders = useFetch('/leader-options', { skip: !canEdit });

  const [sp, setSp] = useSearchParams();
  // «expenses» was the money tab's name before the donations joined it
  const wanted = sp.get('tab') === 'expenses' ? 'money' : sp.get('tab');
  // التقييم: تبويب حين يكون لنوعه استمارة (أو قُيِّم من قبل). «بانتظارك» لقائد أخذ فيه دورًا و لم
  // يقيّمه بعد، و قد بلغ يومه الأخير — لا للمسؤول: تقييمه اختيار لا ينتظره أحد
  const evaluation = ev?.evaluation ?? null;
  const evalPending = !!evaluation?.can_evaluate && !!evaluation.expected && !evaluation.done;
  const tab =
    TABS.includes(wanted) && (wanted !== 'money' || canFees) && (wanted !== 'eval' || evaluation) ? wanted : 'program';
  const setTab = (v) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        v === 'program' ? n.delete('tab') : n.set('tab', v);
        return n;
      },
      { replace: true }
    );

  const [editing, setEditing] = useState(false);
  // { session } — null = closed; session null inside = a new one
  const [sessionDialog, setSessionDialog] = useState(null);
  const [attendanceFor, setAttendanceFor] = useState(null);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(null);
  const [expenseDialog, setExpenseDialog] = useState(null);
  const [donationDialog, setDonationDialog] = useState(null);
  // { funding, direction } — money taken from or handed back to a caisse
  const [fundingDialog, setFundingDialog] = useState(null);
  // { staff, role } — null = closed; staff null = a new post, role = the slot it fills
  const [staffDialog, setStaffDialog] = useState(null);
  const [duplicating, setDuplicating] = useState(false);
  const [reminding, setReminding] = useState(false);

  if (loading) return <SkeletonPage rows={5} />;
  // A مخيم that is gone (deleted, or an old link) is no connection problem: a retry cannot
  // bring it back — the way out can. (errorStatus: the HTTP status of a failed load.)
  if (errorStatus === 404 || errorStatus === 403)
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={back} className="-ms-2">
          <IconBack className="rtl:rotate-180" />
          {t('common.back')}
        </Button>
        <Card>
          <EmptyState icon={<IconTent className="h-6 w-6" />} title={t('error.notFoundTitle')}>
            {t('error.notFoundBody')}
          </EmptyState>
        </Card>
      </div>
    );
  if (error)
    return <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />;

  const branchList = branches.data || [];
  const named = eventScopeLabels(ev, branchList, lng);
  const today = todayISO();
  const phase = eventPhase(ev, today);
  const totalDays = dayNumber(ev, ev.end_date);

  /** Optimistic: the marks land on screen first, a refusal puts them back. */
  async function mark(sessionId, records) {
    if (!records.length) return;
    const prev = ev;
    const touched = new Set(records.map((r) => r.participant_id));
    setEv((e) => ({
      ...e,
      attendance: [
        ...e.attendance.filter((a) => !(a.session_id === sessionId && touched.has(a.participant_id))),
        ...records.filter((r) => r.status).map((r) => ({ session_id: sessionId, ...r })),
      ],
    }));
    try {
      await api.post(`/events/${ev.id}/sessions/${sessionId}/attendance`, { records });
    } catch (err) {
      setEv(prev);
      toast.error(errorText(t, err));
    }
  }

  async function removeParticipant(p) {
    const name = participantName(p);
    const paidSome = p.paid > 0;
    // A عنصر or قائد stays on record as «did not take part»; a guest has no file, he is struck off
    const kept = !p.guest_name;
    const key = `event.${kept ? 'withdraw' : 'remove'}${paidSome ? 'Paid' : ''}Confirm`;
    if (
      !(await confirm({
        title: t('event.removeParticipant'),
        message: t(isFeminine(ev.section) ? [`${key}F`, key] : key, {
          name,
          title: ev.title,
          amount: fmtAmount(p.paid),
        }),
        confirmLabel: t('event.remove'),
      }))
    )
      return;
    try {
      setEv(await api.del(`/events/${ev.id}/participants/${p.id}`));
      toast.success(t('event.participantRemoved', { name }));
    } catch (err) {
      toast.error(errorText(t, err));
    }
  }

  // Putting someone taken off the list back on goes through the same route as adding him
  async function restoreParticipant(p) {
    const name = participantName(p);
    try {
      setEv(
        await api.post(
          `/events/${ev.id}/participants`,
          p.member_id ? { member_ids: [p.member_id] } : { leader_ids: [p.leader_id] }
        )
      );
      toast.success(t('event.participantRestored', { name }));
    } catch (err) {
      toast.error(errorText(t, err));
    }
  }

  async function removeEvent() {
    if (
      !(await confirm({
        title: t('event.delete'),
        message: t('event.deleteConfirm', { title: ev.title }),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      await api.del(`/events/${ev.id}`);
      toast.success(t('event.deleted'));
      navigate('/events', { replace: true });
    } catch (err) {
      toast.error(err.message);
    }
  }

  const tabs = [
    { id: 'program', label: t('event.tabProgram'), count: ev.sessions.length },
    { id: 'staff', label: t('event.tabStaff'), count: ev.staff.length + (ev.leader_id ? 1 : 0) },
    { id: 'participants', label: t('event.tabParticipants'), count: ev.participants.length },
    // E1 : prêt à partir — un point quand il manque une autorisation ou un point de sécurité
    {
      id: 'safety',
      label:
        readinessFacts(t, ev.readiness)?.ready === false ? (
          <>
            {t('safety.tab')}
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-warning" />
            <span className="sr-only">— {t('safety.notReady')}</span>
          </>
        ) : (
          t('safety.tab')
        ),
    },
    ...(canFees
      ? [
          {
            id: 'money',
            label: t('event.tabMoney'),
            count: ev.expenses.length + ev.donations.length + (ev.fundings?.length || 0),
          },
        ]
      : []),
    ...(evaluation
      ? [
          {
            id: 'eval',
            // A dot while it waits for this قائد's marks — the word goes to readers
            label: evalPending ? (
              <>
                {t('session.tabEval')}
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary" />
                <span className="sr-only">— {t('eval.toDo')}</span>
              </>
            ) : (
              t('session.tabEval')
            ),
            count: evaluation.count > 0 ? evaluation.count : null,
          },
        ]
      : []),
    // صور المخيم و ملفاته: لكل من يراه، و يضيفها من يسجّل الحضور
    { id: 'files', label: t('event.tabFiles'), count: ev.files?.length || 0 },
  ];
  const openSession = attendanceFor ? ev.sessions.find((s) => s.id === attendanceFor) : null;

  return (
    <div className="space-y-4">
      {/* Same header as an activity's: icon-only actions on phones */}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={back} className="-ms-2">
          <IconBack className="rtl:rotate-180" />
          {t('common.back')}
        </Button>
        <div className="flex items-center gap-2">
          {/* E2 : le dossier de camp (liste d'appel, encadrement, programme, bilan, check-list),
              et sa variante «rapport à la قيادة» */}
          <ExportPdfButton
            kind="event"
            id={ev.id}
            compact
            extra={[{ query: 'variant=report', title: t('campFile.reportVariant'), hint: t('campFile.reportHint') }]}
          />
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              aria-label={t('common.edit')}
              className="w-11 px-0 sm:w-auto sm:px-3"
            >
              <IconPencil />
              <span className="sr-only sm:not-sr-only">{t('common.edit')}</span>
            </Button>
          )}
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDuplicating(true)}
              aria-label={t('event.duplicate')}
              className="w-11 px-0 sm:w-auto sm:px-3"
            >
              <IconClipboard />
              <span className="sr-only sm:not-sr-only">{t('event.duplicate')}</span>
            </Button>
          )}
          {canDelete && (
            <Button
              variant="destructive-ghost"
              size="sm"
              onClick={removeEvent}
              aria-label={t('common.delete')}
              className="w-11 px-0 sm:w-auto sm:px-3"
            >
              <IconTrash />
              <span className="sr-only sm:not-sr-only">{t('common.delete')}</span>
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={KIND_BADGE[ev.kind]}>{t(`event.kind_${ev.kind}`)}</Badge>
          {phase === 'ongoing' && (
            <Badge variant="success">{t('event.todayIsDay', { n: dayNumber(ev, today), total: totalDays })}</Badge>
          )}
          {phase === 'upcoming' && (
            <Badge variant="outline">{t('event.startsIn', { count: 1 - dayNumber(ev, today) })}</Badge>
          )}
        </div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{ev.title}</h1>
        {/* On a phone the leader's name and the mark are finger-sized (44px) without pushing
            the lines apart; the 12px between lines keeps one's target off the other's words */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-sm text-muted-foreground sm:gap-y-1">
          <span className="flex items-center gap-1.5 tabular-nums">
            <IconCalendar className="h-3.5 w-3.5" />
            {fmtDateRange(ev.start_date, ev.end_date)}
            {totalDays > 1 && <> · {t('event.dayCount', { count: totalDays })}</>}
          </span>
          {ev.place && (
            <span className="flex items-center gap-1.5">
              <IconPin className="h-3.5 w-3.5" />
              {ev.place}
            </span>
          )}
          {ev.leader_name && (
            <span className="flex items-center gap-1.5">
              <IconShield className="h-3.5 w-3.5" />
              {ev.leader_id && has('leaders.read') ? (
                <Link
                  to={`/leaders/${ev.leader_id}`}
                  className="focus-ring -my-3 flex min-h-11 items-center rounded font-medium text-foreground hover:text-primary hover:underline sm:-my-1 sm:min-h-8"
                >
                  {ev.leader_name}
                </Link>
              ) : (
                <span className="font-medium text-foreground">{ev.leader_name}</span>
              )}
            </span>
          )}
          {canFees && (
            <span className="flex items-center gap-1.5">
              <IconCoins className="h-3.5 w-3.5" />
              {ev.fee ? (
                <span>
                  {t('event.fee')} <span className="font-medium tabular-nums text-foreground">{fmtAmount(ev.fee)}</span>
                </span>
              ) : (
                t('event.free')
              )}
            </span>
          )}
          {/* The mark its قادة gave — or, for one who has not rated it yet, the way to do it.
              Hidden from him until then, like on the tab. */}
          {(evalPending || (evaluation?.count > 0 && evaluation.average !== null)) && (
            <button
              type="button"
              onClick={() => setTab('eval')}
              className={cn(
                'focus-ring -my-3 flex min-h-11 items-center gap-1.5 rounded py-1 font-medium hover:underline sm:-my-1 sm:min-h-8',
                evalPending ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <IconStar className="h-3.5 w-3.5" />
              {evalPending ? (
                t('eval.toDo')
              ) : (
                <>
                  <span className="sr-only">{t('session.tabEval')}</span>
                  <span dir="ltr" className={cn('font-semibold tabular-nums', scoreTone(evaluation.average).text)}>
                    {fmtScore(evaluation.average, lng)}/5
                  </span>
                </>
              )}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {named.length ? (
            named.map((b) => <Badge key={b.id}>{b.label}</Badge>)
          ) : (
            <Badge variant="secondary">{t('event.wholeGroup')}</Badge>
          )}
        </div>
      </div>

      <EventFigures ev={ev} t={t} />

      <UnderlineTabs
        items={tabs}
        value={tab}
        onChange={setTab}
        label={ev.title}
        idPrefix="event-tab"
        panelId="event-panel"
      />

      <div id="event-panel" role="tabpanel" aria-labelledby={`event-tab-${tab}`}>
        {tab === 'program' && (
          <ProgramTab
            ev={ev}
            t={t}
            lng={lng}
            canEdit={canEdit}
            onAdd={() => setSessionDialog({ session: null })}
            onEdit={(s) => setSessionDialog({ session: s })}
            onOpen={(s) => setAttendanceFor(s.id)}
            onEditPlan={() => setEditing(true)}
          />
        )}
        {tab === 'staff' && (
          <StaffTab
            ev={ev}
            t={t}
            canEdit={canEdit}
            canLeaders={has('leaders.read')}
            onAssign={(role) => setStaffDialog({ staff: null, role })}
            onEdit={(st) => setStaffDialog({ staff: st, role: null })}
            onEditChief={() => setEditing(true)}
          />
        )}
        {tab === 'participants' && (
          <ParticipantsTab
            ev={ev}
            t={t}
            lng={lng}
            canEdit={canEdit}
            canPay={canPay}
            canFees={canFees}
            links={{ members: has('members.read'), leaders: has('leaders.read') }}
            onAdd={() => setAdding(true)}
            onPay={setPaying}
            onRemove={removeParticipant}
            onRestore={restoreParticipant}
            onRemind={() => setReminding(true)}
          />
        )}
        {tab === 'safety' && (
          <EventSafetyTab
            ev={ev}
            setEv={setEv}
            canEdit={canEdit}
            canMark={canMark}
            links={{ members: has('members.read') }}
          />
        )}
        {tab === 'money' && canFees && (
          <div className="space-y-4">
            <ExpensesTab
              ev={ev}
              t={t}
              canWrite={canSpend}
              onAdd={() => setExpenseDialog({ expense: null })}
              onEdit={(x) => setExpenseDialog({ expense: x })}
            />
            <DonationsCard
              ev={ev}
              t={t}
              canWrite={canSpend}
              onAdd={() => setDonationDialog({ donation: null })}
              onEdit={(d) => setDonationDialog({ donation: d })}
            />
            <FundingsCard
              ev={ev}
              t={t}
              lng={lng}
              onAdd={(direction) => setFundingDialog({ funding: null, direction })}
              onEdit={(f) => setFundingDialog({ funding: f, direction: f.direction })}
            />
          </div>
        )}
        {tab === 'eval' && evaluation && (
          <div className="space-y-4">
            <EventEvaluation event={ev} onChange={(summary) => setEv((e) => ({ ...e, evaluation: summary }))} />
          </div>
        )}
        {tab === 'files' && (
          <div className="space-y-4">
            <AttachedFiles
              base={`/events/${ev.id}`}
              files={ev.files}
              editable={canMark}
              onChange={(files) => setEv((e) => ({ ...e, files }))}
            />
          </div>
        )}
      </div>

      {canEdit && (
        <EventFormDialog
          open={editing}
          initial={ev}
          onClose={() => setEditing(false)}
          onSaved={(payload) => {
            setEditing(false);
            setEv(payload);
            toast.success(t('event.updated'));
          }}
        />
      )}
      {canEdit && (
        <DuplicateDialog
          ev={ev}
          t={t}
          open={duplicating}
          onClose={() => setDuplicating(false)}
          onDone={(copy) => {
            setDuplicating(false);
            toast.success(t('event.duplicated'));
            navigate(`/events/${copy.id}`);
          }}
        />
      )}
      {canFees && (
        <RemindDialog
          ev={ev}
          t={t}
          lng={lng}
          open={reminding}
          onClose={() => setReminding(false)}
          canContact={has('members.contact')}
        />
      )}

      <SessionDialog
        ev={ev}
        session={sessionDialog?.session ?? null}
        open={!!sessionDialog}
        onClose={() => setSessionDialog(null)}
        onSaved={(payload, msg) => {
          setSessionDialog(null);
          setEv(payload);
          toast.success(t(msg));
        }}
        leaders={leaders.data || []}
        t={t}
        lng={lng}
      />

      <AttendanceDialog
        ev={ev}
        session={openSession}
        open={!!openSession}
        onClose={() => setAttendanceFor(null)}
        onMark={mark}
        canMark={canMark}
        onAddPeople={
          canEdit
            ? () => {
                setAttendanceFor(null);
                setTab('participants');
                setAdding(true);
              }
            : null
        }
        t={t}
        lng={lng}
      />

      <AddParticipantsDialog
        ev={ev}
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(payload, count) => {
          setAdding(false);
          setEv(payload);
          toast.success(t('event.participantsAdded', { count }));
        }}
        t={t}
        lng={lng}
      />

      <PaymentDialog
        ev={ev}
        participant={paying}
        open={!!paying}
        onClose={() => setPaying(null)}
        canEdit={canEdit}
        onSaved={({ participant, summary }) => {
          setPaying(null);
          setEv((e) => ({ ...e, summary, participants: e.participants.map((x) => (x.id === participant.id ? participant : x)) }));
          toast.success(t('event.paymentSaved'));
        }}
        t={t}
      />

      {canFees && (
        <ExpenseDialog
          ev={ev}
          expense={expenseDialog?.expense ?? null}
          open={!!expenseDialog}
          onClose={() => setExpenseDialog(null)}
          onSaved={({ expenses, summary }, msg) => {
            setExpenseDialog(null);
            setEv((e) => ({ ...e, expenses, summary }));
            toast.success(t(msg));
          }}
          t={t}
        />
      )}

      {canEdit && (
        <StaffDialog
          ev={ev}
          staff={staffDialog?.staff ?? null}
          presetRole={staffDialog?.role ?? null}
          open={!!staffDialog}
          onClose={() => setStaffDialog(null)}
          onSaved={({ staff }, msg) => {
            setStaffDialog(null);
            setEv((e) => ({ ...e, staff }));
            toast.success(t(msg));
          }}
          leaders={leaders.data || []}
          t={t}
        />
      )}

      {canFees && (
        <DonationDialog
          ev={ev}
          donation={donationDialog?.donation ?? null}
          open={!!donationDialog}
          onClose={() => setDonationDialog(null)}
          onSaved={({ donations, summary }, msg) => {
            setDonationDialog(null);
            setEv((e) => ({ ...e, donations, summary }));
            toast.success(t(msg));
          }}
          t={t}
        />
      )}

      {canFees && (
        <FundingDialog
          ev={ev}
          funding={fundingDialog?.funding ?? null}
          direction={fundingDialog?.direction ?? 'to_event'}
          open={!!fundingDialog}
          onClose={() => setFundingDialog(null)}
          onSaved={({ fundings, funding_boxes, summary }, msg) => {
            setFundingDialog(null);
            setEv((e) => ({ ...e, fundings, funding_boxes, summary }));
            toast.success(t(msg));
          }}
          t={t}
          lng={lng}
        />
      )}
    </div>
  );
}
