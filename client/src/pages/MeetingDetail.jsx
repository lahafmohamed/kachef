import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth, usePerms } from '../auth';
import { useBack, useFetch } from '../hooks';
import { isFeminine, useSection } from '../section';
import {
  DECISION_STATUSES,
  attendanceCounts,
  attendeesByStatus,
  decisionCounts,
  fmtLongDate,
  gendered,
  LEGACY_MEETING_KINDS,
  meetingScope,
  meetingShareText,
  shareText,
  timeRange,
  userText,
} from '../lib/meetings';
import { avatarName, branchName, fmtDate, memberName } from '../utils';
import DatePicker from '../components/DatePicker';
import ExportPdfButton from '../components/ExportPdfButton';
import MeetingFormDialog, { ERRORS, PersonField, personBody } from '../components/MeetingForm';
import { DecisionCheck, DecisionMeta, MeetingKindBadge, attendanceLine } from '../components/MeetingParts';
import SearchInput from '../components/SearchInput';
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
  SegmentedControl,
  SkeletonPage,
  Textarea,
  useConfirm,
  useToast,
  IconBack,
  IconCalendar,
  IconCheckAll,
  IconClock,
  IconInbox,
  IconPencil,
  IconPin,
  IconPlus,
  IconWhatsApp,
  IconTrash,
  IconUserCheck,
  IconX,
} from '../components/ui';

// created_at / updated_at are UTC "YYYY-MM-DD HH:MM:SS" — show the local date
const stampDate = (v) => (v ? fmtDate(v.slice(0, 10)) : '');

const STATUSES = [
  { value: 'present', key: 'session.present', tone: 'success' },
  { value: 'absent', key: 'session.absent', tone: 'destructive-soft' },
  { value: 'excused', key: 'session.excused', tone: 'warning-soft' },
];

// The groups of the attendance card, in the order the minutes list them
const GROUPS = [
  { key: 'present', label: 'meeting.groupPresent', dot: 'bg-success' },
  { key: 'excused', label: 'meeting.groupExcused', dot: 'bg-warning' },
  { key: 'absent', label: 'meeting.groupAbsent', dot: 'bg-destructive' },
  { key: 'guests', label: 'meeting.groupGuests', dot: 'bg-info' },
];

/** A dashed «add» line closing a list: the next point goes where the eye already is */
function AddRow({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-accent-foreground"
    >
      <IconPlus />
      {children}
    </button>
  );
}

/* ============================================================
   الحضور
   ============================================================ */

function AttendanceCard({ m, t, canEdit, onEdit }) {
  const c = attendanceCounts(m.attendees);
  const groups = attendeesByStatus(m.attendees);
  const taken = m.attendees.length > 0;
  return (
    <Card>
      {/* Not taken yet: the line under the title says so, and the button follows it on a
          phone, as the counts do once it is taken — no card body left holding one sentence */}
      <CardHeader className={cn('gap-3 sm:flex-row sm:items-center sm:justify-between', !taken && 'pb-4 sm:pb-5')}>
        <div className="min-w-0">
          <CardTitle>{t('meeting.attendance')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {taken ? attendanceLine(c, t, m.section).join(' · ') : t('meeting.attendanceEmpty')}
          </p>
        </div>
        {canEdit && (
          <Button size="sm" variant={taken ? 'outline' : 'brand'} onClick={onEdit} className="w-full sm:w-auto">
            <IconUserCheck />
            {t(taken ? 'meeting.editAttendance' : 'meeting.takeAttendance')}
          </Button>
        )}
      </CardHeader>
      {taken && (
        <CardContent>
          <div className="space-y-4">
            {GROUPS.filter((g) => groups[g.key].length > 0).map((g) => (
              <div key={g.key}>
                <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', g.dot)} />
                  {gendered(t, g.label, m.section)}
                  <span className="tabular-nums">{groups[g.key].length}</span>
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {groups[g.key].map((a) => (
                    <li
                      key={a.id}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card py-1 pe-3 ps-1 text-sm"
                    >
                      <Avatar
                        photo={a.photo}
                        name={a.first_name ? avatarName(a) : a.name}
                        className="h-6 w-6 text-[0.6875rem]"
                      />
                      <bdi className="truncate">{a.name}</bdi>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Roll call of the meeting: every قائد of its قسم with three states, and none for who was
 * not called to it — tapping the lit state again takes him off. Archived قادة show only
 * when they are already on the minutes. Guests are names, present by being there.
 */
function AttendanceDialog({ m, open, onClose, onSaved, leaders, t }) {
  const toast = useToast();
  const [marks, setMarks] = useState({});
  const [guests, setGuests] = useState([]);
  const [guestName, setGuestName] = useState('');
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  // اجتماع فرقة: قادتها في التشكيلة أولًا (m.branch_leader_ids)، و قادة القسم كلهم بطلب
  const [showAll, setShowAll] = useState(false);
  const { i18n } = useTranslation();

  useEffect(() => {
    if (!open) return;
    setShowAll(false);
    const next = {};
    for (const a of m.attendees) if (!a.guest && a.leader_id) next[a.leader_id] = a.status;
    setMarks(next);
    setGuests(m.attendees.filter((a) => a.guest).map((a) => a.name));
    setGuestName('');
    setQ('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const sectionPool = leaders.filter((l) => l.section === m.section && (l.status === 'active' || marks[l.id]));
  const ownIds = new Set(m.branch_leader_ids || []);
  // Narrowed only when it leaves someone out — a قائد already marked always stays
  const narrowed = ownIds.size > 0 && sectionPool.some((l) => !ownIds.has(l.id) && !marks[l.id]);
  const pool = narrowed && !showAll ? sectionPool.filter((l) => ownIds.has(l.id) || marks[l.id]) : sectionPool;
  const query = q.trim().toLowerCase();
  const shown = query ? pool.filter((l) => memberName(l).toLowerCase().includes(query)) : pool;
  const c = { present: 0, absent: 0, excused: 0, guests: guests.length };
  for (const s of Object.values(marks)) c[s]++;

  const mark = (id, v) => setMarks((prev) => ({ ...prev, [id]: prev[id] === v ? undefined : v }));
  const allPresent = () =>
    setMarks((prev) => ({ ...prev, ...Object.fromEntries(shown.map((l) => [l.id, 'present'])) }));

  function addGuest(e) {
    e.preventDefault();
    const name = guestName.trim();
    if (!name) return;
    setGuests((g) => [...g, name]);
    setGuestName('');
  }

  async function save() {
    setSaving(true);
    try {
      const body = {
        leaders: Object.entries(marks)
          .filter(([, s]) => s)
          .map(([id, status]) => ({ leader_id: Number(id), status })),
        guests,
      };
      onSaved(await api.put(`/meetings/${m.id}/attendance`, body));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('meeting.attendance')}
      description={t('meeting.attendanceHint')}
      size="lg"
      autoFocus={false}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{attendanceLine(c, t, m.section).join(' · ')}</p>
          <div className="ms-auto flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={save} loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {pool.length > 8 && <SearchInput value={q} onChange={setQ} placeholder={t('session.searchLeader')} autoFocusHotkey={false} />}
          <Button variant="outline" size="sm" onClick={allPresent} disabled={!shown.length} className="sm:ms-auto">
            <IconCheckAll />
            {t('meeting.allPresent')}
          </Button>
        </div>

        {narrowed && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              {showAll
                ? null
                : t('meeting.branchLeadersOnly', { branches: meetingScope(m, i18n.language, t) })}
            </span>
            <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setShowAll((v) => !v)}>
              {showAll ? t('meeting.showBranchLeaders') : t('meeting.showAllLeaders')}
            </Button>
          </div>
        )}

        {pool.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('meeting.noLeaders')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {shown.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <Avatar photo={l.photo} name={`${l.first_name} ${l.last_name}`} className="h-8 w-8" />
                <span className={cn('min-w-32 flex-1 text-sm font-medium', !marks[l.id] && 'text-muted-foreground')}>
                  {memberName(l)}
                </span>
                <SegmentedControl
                  size="sm"
                  className="w-full sm:w-auto sm:[&>button]:whitespace-nowrap"
                  label={memberName(l)}
                  value={marks[l.id] || ''}
                  onChange={(v) => mark(l.id, v)}
                  options={STATUSES.map((s) => ({ ...s, label: t(s.key) }))}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <Label htmlFor="mt_guest">{t('meeting.guests')}</Label>
          <form onSubmit={addGuest} className="flex gap-2">
            <Input
              id="mt_guest"
              autoComplete="off"
              maxLength={120}
              placeholder={t('meeting.guestPlaceholder')}
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={!guestName.trim()}>
              <IconPlus />
              {t('meeting.addGuest')}
            </Button>
          </form>
          {guests.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {guests.map((g, i) => (
                <li
                  key={`${g}-${i}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-card py-0.5 pe-0.5 ps-3 text-sm"
                >
                  <span className="truncate">{g}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-8 w-8 rounded-full sm:h-7 sm:w-7"
                    aria-label={`${t('common.delete')} — ${g}`}
                    onClick={() => setGuests((list) => list.filter((_, j) => j !== i))}
                  >
                    <IconX />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/* ============================================================
   جدول الأعمال
   ============================================================ */

function AgendaCard({ m, t, canEdit, onAdd, onEdit }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('meeting.agenda')}
          {m.items.length > 0 && <span className="ms-2 font-normal tabular-nums text-muted-foreground">{m.items.length}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {m.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('meeting.agendaEmpty')}</p>
        ) : (
          <ol className="space-y-4">
            {m.items.map((it, i) => (
              <li key={it.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/12 text-sm font-semibold tabular-nums text-primary"
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {/* The pencil keeps its 44px but not the row's height (-my): what was said sits
                      right under its point, not halfway to the next one. Its column (-me) is the
                      decisions' pencils' column. */}
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="pt-0.5 font-semibold [overflow-wrap:anywhere]">
                      <span className="sr-only">{i + 1}. </span>
                      <bdi>{userText(it.title)}</bdi>
                    </h3>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onEdit(it)}
                        aria-label={`${t('common.edit')} — ${it.title}`}
                        className="-my-2 -me-2.5 shrink-0 text-muted-foreground sm:-my-0.5 sm:-me-1.5"
                      >
                        <IconPencil />
                      </Button>
                    )}
                  </div>
                  {it.discussion ? (
                    <p
                      dir="auto"
                      className="mt-1.5 whitespace-pre-wrap text-start text-sm leading-relaxed [overflow-wrap:anywhere]"
                    >
                      {userText(it.discussion)}
                    </p>
                  ) : canEdit ? (
                    // 44px to tap on a phone through the ::before, without the gap a min-height opened
                    <button
                      type="button"
                      onClick={() => onEdit(it)}
                      className="focus-ring relative -mx-1 mt-1.5 rounded px-1 text-start text-sm text-muted-foreground underline-offset-4 before:absolute before:inset-x-0 before:-inset-y-3 before:content-[''] hover:text-primary hover:underline sm:before:content-none"
                    >
                      {t('meeting.writeDiscussion')}
                    </button>
                  ) : (
                    <p className="mt-1.5 text-sm text-muted-foreground">{t('meeting.noDiscussion')}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        {canEdit && <AddRow onClick={onAdd}>{t('meeting.addItem')}</AddRow>}
      </CardContent>
    </Card>
  );
}

function ItemDialog({ m, item, open, onClose, onSaved, t }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ title: '', discussion: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const discussionRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setForm({ title: item?.title || '', discussion: item?.discussion || '' });
    setError(null);
    // A point that has its title: the cursor goes where the writing is
    if (!item) return undefined;
    const id = setTimeout(() => discussionRef.current?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(id);
  }, [open, item]);

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = { title: form.title, discussion: form.discussion || null };
      const res = item
        ? await api.put(`/meetings/${m.id}/items/${item.id}`, body)
        : await api.post(`/meetings/${m.id}/items`, body);
      onSaved(res, item ? 'meeting.itemSaved' : 'meeting.itemAdded');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !(await confirm({
        title: t('meeting.removeItem'),
        message: t('meeting.removeItemConfirm', { title: item.title }),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      onSaved(await api.del(`/meetings/${m.id}/items/${item.id}`), 'meeting.itemRemoved');
    } catch (err) {
      toast.error(err.message);
    }
  }

  const number = item ? m.items.findIndex((x) => x.id === item.id) + 1 : m.items.length + 1;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('meeting.itemTitle', { n: number })}
      size="lg"
      autoFocus={!item}
      footer={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            {item ? (
              <Button variant="destructive-ghost" onClick={remove} aria-label={t('meeting.removeItem')} className="px-2.5 sm:px-3">
                <IconTrash />
                <span className="max-sm:sr-only">{t('common.delete')}</span>
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" form="meeting-item-form" loading={saving}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      }
    >
      <form id="meeting-item-form" onSubmit={save} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="it_title">{t('meeting.itemName')}</Label>
          <Input
            id="it_title"
            required
            maxLength={200}
            autoComplete="off"
            placeholder={t('meeting.itemPlaceholder')}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="it_discussion">{t('meeting.discussion')}</Label>
          <Textarea
            ref={discussionRef}
            id="it_discussion"
            dir="auto"
            rows={8}
            maxLength={20000}
            placeholder={t('meeting.discussionPlaceholder')}
            value={form.discussion}
            onChange={(e) => setForm((f) => ({ ...f, discussion: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">{t('meeting.discussionHint')}</p>
        </div>
      </form>
    </Dialog>
  );
}

/* ============================================================
   القرارات
   ============================================================ */

/**
 * One decision of the minutes: its tick, what was decided, who carries it out and by
 * when. `number`: its place in this meeting's list; `from`: the earlier meeting it
 * comes from, on the follow-up card. Writers get the pencil, on this meeting's own; the
 * tick is the follow-up's (meetings.followup), which may be granted alone — and the
 * قائد's own on a تكليف handed to him. canFollow(d) says which.
 */
function DecisionItem({ d, t, today, number, canEdit, canFollow, busy, onToggle, onEdit }) {
  return (
    // Tick, first line and pencil share one centre line: 26px down on a phone (44px
    // targets), 22px on a pointer screen
    <li className="flex items-start gap-1.5 py-1">
      <DecisionCheck
        status={d.status}
        busy={busy}
        onToggle={canFollow(d) ? () => onToggle(d) : null}
        label={t(d.status === 'done' ? 'meeting.markOpen' : 'meeting.markDone', { text: d.text })}
      />
      <div className="min-w-0 flex-1 pb-2 pt-3 sm:pt-2">
        <p
          className={cn(
            'text-sm font-medium [overflow-wrap:anywhere]',
            d.status !== 'open' && 'text-muted-foreground',
            d.status === 'dropped' && 'line-through'
          )}
        >
          {number && <span className="me-1.5 tabular-nums text-muted-foreground">{number}.</span>}
          <bdi>{userText(d.text)}</bdi>
        </p>
        <DecisionMeta d={d} t={t} today={today} />
      </div>
      {canEdit && onEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onEdit(d)}
          aria-label={`${t('common.edit')} — ${d.text}`}
          className="shrink-0 text-muted-foreground sm:mt-0.5"
        >
          <IconPencil />
        </Button>
      )}
    </li>
  );
}

/**
 * «متابعة تكاليف الجلسة الماضية»: what earlier meetings of the same فوج or فرقة decided and
 * is still to do, with what got done since the last one — ticked off here, in the meeting.
 */
function FollowupsCard({ m, t, today, canFollow, busy, onToggle }) {
  if (!m.followups.length) return null;
  const left = m.followups.filter((d) => d.status === 'open').length;
  // Sent oldest meeting first: one heading per meeting, its decisions under it
  const groups = [];
  for (const d of m.followups) {
    if (groups.at(-1)?.id !== d.meeting_id) groups.push({ id: d.meeting_id, date: d.meeting_date, title: d.meeting_title, rows: [] });
    groups.at(-1).rows.push(d);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('meeting.followups')}
          <span className="ms-2 font-normal tabular-nums text-muted-foreground">{m.followups.length}</span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {left ? t('meeting.followupsLeft', { count: left }) : t('meeting.followupsAllDone')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.map((g) => (
          <section key={g.id} aria-label={t('meeting.fromMeeting', { date: fmtDate(g.date), title: g.title })}>
            {/* A link to that meeting: 44px to tap on a phone */}
            <Link
              to={`/meetings/${g.id}`}
              className="focus-ring flex min-h-11 w-fit max-w-full items-center rounded text-xs font-medium text-muted-foreground hover:text-primary hover:underline sm:min-h-0"
            >
              <span>
                <span className="tabular-nums">{fmtDate(g.date)}</span> · <bdi>{userText(g.title)}</bdi>
              </span>
            </Link>
            {/* -mx: the ticks line up with the card's title, the pencils with the agenda's */}
            <ul className="-mx-2.5 divide-y divide-border sm:-mx-1.5 sm:mt-1">
              {g.rows.map((d) => (
                <DecisionItem
                  key={d.id}
                  d={d}
                  t={t}
                  today={today}
                  canFollow={canFollow}
                  busy={busy === d.id}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

function DecisionsCard({ m, t, today, canEdit, canFollow, busy, onToggle, onAdd, onEdit }) {
  const c = decisionCounts(m.decisions, today);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('meeting.decisions')}
          {c.total > 0 && <span className="ms-2 font-normal tabular-nums text-muted-foreground">{c.total}</span>}
        </CardTitle>
        {c.total > 0 && (
          <p className="text-sm text-muted-foreground">
            {[
              c.done > 0 && t('meeting.doneCount', { count: c.done }),
              c.open > 0 && t('meeting.openCount', { count: c.open }),
            ]
              .filter(Boolean)
              .join(' · ')}
            {c.overdue > 0 && (
              <span className="font-medium text-destructive">
                {' · '}
                {t('meeting.overdueCount', { count: c.overdue })}
              </span>
            )}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {m.decisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('meeting.decisionsEmpty')}</p>
        ) : (
          <ol className="-mx-2.5 divide-y divide-border sm:-mx-1.5">
            {m.decisions.map((d, i) => (
              <DecisionItem
                key={d.id}
                d={d}
                t={t}
                today={today}
                number={i + 1}
                canEdit={canEdit}
                canFollow={canFollow}
                busy={busy === d.id}
                onToggle={onToggle}
                onEdit={onEdit}
              />
            ))}
          </ol>
        )}
        {canEdit && <AddRow onClick={onAdd}>{t('meeting.addDecision')}</AddRow>}
      </CardContent>
    </Card>
  );
}

function DecisionDialog({ m, decision, open, onClose, onSaved, leaders, t }) {
  const toast = useToast();
  const confirm = useConfirm();
  const blank = { text: '', owner: { id: null, name: '' }, due_date: '', status: 'open' };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      decision
        ? {
            text: decision.text,
            owner: { id: decision.leader_id, name: decision.owner || '' },
            due_date: decision.due_date || '',
            status: decision.status,
          }
        : blank
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, decision]);

  const pool = leaders.filter((l) => l.section === m.section && (l.status === 'active' || l.id === decision?.leader_id));

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { leader_id, leader_name } = personBody('leader', form.owner, pool);
      const body = { text: form.text, leader_id, owner: leader_name, due_date: form.due_date || null, status: form.status };
      const res = decision
        ? await api.put(`/meetings/${m.id}/decisions/${decision.id}`, body)
        : await api.post(`/meetings/${m.id}/decisions`, body);
      onSaved(res, decision ? 'meeting.decisionSaved' : 'meeting.decisionAdded');
    } catch (err) {
      setError(ERRORS[err.message] ? t(ERRORS[err.message]) : err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !(await confirm({
        title: t('meeting.removeDecision'),
        message: t('meeting.removeDecisionConfirm'),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      onSaved(await api.del(`/meetings/${m.id}/decisions/${decision.id}`), 'meeting.decisionRemoved');
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={decision ? t('meeting.editDecision') : t('meeting.addDecision')}
      footer={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            {decision ? (
              <Button
                variant="destructive-ghost"
                onClick={remove}
                aria-label={t('meeting.removeDecision')}
                className="px-2.5 sm:px-3"
              >
                <IconTrash />
                <span className="max-sm:sr-only">{t('common.delete')}</span>
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" form="meeting-decision-form" loading={saving}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      }
    >
      <form id="meeting-decision-form" onSubmit={save} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="dc_text">{t('meeting.decisionText')}</Label>
          <Textarea
            id="dc_text"
            dir="auto"
            required
            rows={3}
            maxLength={2000}
            placeholder={t('meeting.decisionPlaceholder')}
            value={form.text}
            onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="dc_owner">{t('meeting.owner')}</Label>
            <PersonField
              id="dc_owner"
              value={form.owner}
              onChange={(p) => setForm((f) => ({ ...f, owner: p }))}
              leaders={pool}
              placeholder={t('meeting.ownerPlaceholder')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dc_due">{t('meeting.dueDate')}</Label>
            <DatePicker id="dc_due" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
          </div>
        </div>
        {decision && (
          <div className="space-y-1.5">
            <Label>{t('meeting.status')}</Label>
            <SegmentedControl
              label={t('meeting.status')}
              value={form.status}
              onChange={(v) => setForm((f) => ({ ...f, status: v }))}
              options={DECISION_STATUSES.map((s) => ({
                value: s,
                label: t(`meeting.status_${s}`),
                tone: s === 'done' ? 'success' : s === 'dropped' ? 'warning-soft' : 'default',
              }))}
              className="flex w-full"
            />
          </div>
        )}
      </form>
    </Dialog>
  );
}

/* ============================================================
   Page
   ============================================================ */

/**
 * محضر اجتماع: what the meeting was about and why, who came, what was said on each point
 * of the agenda, and what was decided — who carries it out, by when, and whether it was
 * done. Read top to bottom as the minutes are; each part is filled in on its own, in the
 * meeting or after it, by whoever may create activities. Deleting is the admin's alone.
 */
export default function MeetingDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const navigate = useNavigate();
  const back = useBack('/meetings');
  const toast = useToast();
  const confirm = useConfirm();
  const { has } = usePerms();
  const canEdit = has('meetings.manage');
  const { user } = useAuth();
  const followAll = has('meetings.followup');
  // The follow-up ticks every تكليف; a قائد without it, those handed to him
  const canFollow = (d) => followAll || (!!user?.leader_id && Number(d.leader_id) === Number(user.leader_id));
  const canDelete = has('meetings.delete');
  const { section } = useSection();

  const { data: m, setData: setM, loading, error, errorStatus, reload } = useFetch(`/meetings/${id}`);
  const leaders = useFetch('/leader-options', { skip: !canEdit });
  const [editing, setEditing] = useState(false);
  // «تحضير الاجتماع المقبل»: a new meeting on next_date, same فرق, place and people
  const [preparingNext, setPreparingNext] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  // { item } / { decision } — null = closed; null inside = a new one
  const [itemDialog, setItemDialog] = useState(null);
  const [decisionDialog, setDecisionDialog] = useState(null);
  const [busy, setBusy] = useState(null);

  const backButton = (
    <Button variant="ghost" size="sm" onClick={back} className="-ms-2">
      <IconBack className="rtl:rotate-180" />
      {t('common.back')}
    </Button>
  );

  if (loading) return <SkeletonPage rows={4} />;
  // The way back stays above the error: an installed app has no browser «back» to fall
  // back on. Minutes deleted since the link was shared, or out of this account's reach,
  // say so — «check your connection» and a retry would send the reader nowhere.
  if (error)
    return (
      <div className="space-y-4">
        <div className="flex">{backButton}</div>
        {/* The server's answers for minutes that are not there to show (404 / 403): no retry helps */}
        {errorStatus === 404 || errorStatus === 403 ? (
          <EmptyState icon={<IconInbox className="h-6 w-6" />} title={t('error.notFoundTitle')}>
            {t('error.notFoundBody')}
          </EmptyState>
        ) : (
          <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />
        )}
      </div>
    );

  const today = new Date().toISOString().slice(0, 10);
  const time = timeRange(m);

  async function removeMeeting() {
    if (
      !(await confirm({
        title: t('meeting.delete'),
        message: t('meeting.deleteConfirm', { title: m.title }),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      await api.del(`/meetings/${m.id}`);
      toast.success(t('meeting.deleted'));
      navigate('/meetings', { replace: true });
    } catch (err) {
      toast.error(err.message);
    }
  }

  /**
   * Ticks a decision off, or opens it again — one of this meeting's, or one followed up
   * from an earlier meeting. On screen at once; a refusal puts it back.
   */
  async function toggle(d) {
    const next = d.status === 'done' ? 'open' : 'done';
    const key = d.meeting_id === m.id ? 'decisions' : 'followups';
    const prev = m[key];
    setBusy(d.id);
    setM((x) => ({
      ...x,
      [key]: x[key].map((y) => (y.id === d.id ? { ...y, status: next, status_at: next === 'done' ? today : null } : y)),
    }));
    try {
      const r = await api.put(`/meetings/${d.meeting_id}/decisions/${d.id}/status`, { status: next });
      setM((x) => ({ ...x, [key]: x[key].map((y) => (y.id === d.id ? { ...y, ...r.decision } : y)) }));
    } catch (err) {
      setM((x) => ({ ...x, [key]: prev }));
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    const url = `${window.location.origin}/meetings/${m.id}`;
    const r = await shareText(meetingShareText(m, t, lng, url));
    if (r === 'copied') toast.success(t('meeting.shareCopied'));
    else if (r === 'failed') toast.error(t('meeting.shareFailed'));
  }

  // «تحضير الاجتماع المقبل»: its agenda opens on the follow-up of what is still to do —
  // this meeting's تكاليف and the earlier ones it followed up
  const openDecisions = [...(m.followups || []), ...m.decisions].filter((d) => d.status === 'open');
  const nextAgenda = openDecisions.length
    ? [
        t('meeting.suggestFollowup'),
        ...openDecisions.map((d) => t('meeting.followupItem', { text: d.owner ? `${d.text} (${d.owner})` : d.text })),
      ].join('\n')
    : '';

  const people = [
    m.chair && [gendered(t, 'meeting.chair', m.section), m.chair],
    m.secretary && [gendered(t, 'meeting.secretary', m.section), m.secretary],
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      {/* Same bar as an activity's: icon-only actions on phones */}
      <div className="flex items-center justify-between gap-2">
        {backButton}
        <div className="flex items-center gap-2">
          {/* Upcoming: the convocation; held: what was decided — for the WhatsApp group */}
          <Button
            variant="outline"
            size="sm"
            onClick={share}
            aria-label={t(m.date >= today && !m.decisions.length ? 'meeting.convene' : 'meeting.share')}
            className="w-11 px-0 sm:w-auto sm:px-3"
          >
            <IconWhatsApp className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">
              {t(m.date >= today && !m.decisions.length ? 'meeting.convene' : 'meeting.share')}
            </span>
          </Button>
          <ExportPdfButton kind="meeting" id={m.id} compact />
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
          {canDelete && (
            <Button
              variant="destructive-ghost"
              size="sm"
              onClick={removeMeeting}
              aria-label={t('common.delete')}
              className="w-11 px-0 sm:w-auto sm:px-3"
            >
              <IconTrash />
              <span className="sr-only sm:not-sr-only">{t('common.delete')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* ---------- En-tête du compte rendu ---------- */}
      <Card className="overflow-hidden">
        <div className="h-1.5 bg-primary" />
        <CardContent className="space-y-3 p-4 sm:p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('meeting.minutes')}</p>
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold tracking-tight [overflow-wrap:anywhere] sm:text-2xl">
              <bdi>{userText(m.title)}</bdi>
            </h1>
            {m.purpose && (
              <p
                dir="auto"
                className="whitespace-pre-wrap text-start text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere] sm:text-base"
              >
                {userText(m.purpose)}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <MeetingKindBadge kind={m.kind} t={t} />
            {m.branches.length > 0 ? (
              m.branches.map((b) => (
                <Badge key={b.id} variant="outline">
                  {branchName(b, lng)}
                </Badge>
              ))
            ) : (
              <Badge variant="outline">{t('meeting.wholeGroup')}</Badge>
            )}
            {!section && <Badge variant={isFeminine(m.section) ? 'info' : 'outline'}>{t(`section.${m.section}`)}</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <span className="flex items-center gap-1.5">
              <IconCalendar className="h-4 w-4 text-muted-foreground" />
              {fmtLongDate(m.date, lng)}
            </span>
            {time && (
              <span className="flex items-center gap-1.5 tabular-nums">
                <IconClock className="h-4 w-4 text-muted-foreground" />
                {/* No ltr island, as for date ranges: in Arabic the start reads first, on the right */}
                {time}
              </span>
            )}
            {m.place && (
              <span className="flex items-center gap-1.5">
                <IconPin className="h-4 w-4 text-muted-foreground" />
                <bdi>{m.place}</bdi>
              </span>
            )}
          </div>
          {people.length > 0 && (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-border pt-3 text-sm sm:grid-cols-2">
              {people.map(([label, name]) => (
                <div key={label} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium [overflow-wrap:anywhere]">
                    <bdi>{name}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      <AttendanceCard m={m} t={t} canEdit={canEdit} onEdit={() => setAttendanceOpen(true)} />

      <FollowupsCard m={m} t={t} today={today} canFollow={canFollow} busy={busy} onToggle={toggle} />

      <AgendaCard
        m={m}
        t={t}
        canEdit={canEdit}
        onAdd={() => setItemDialog({ item: null })}
        onEdit={(it) => setItemDialog({ item: it })}
      />

      <DecisionsCard
        m={m}
        t={t}
        today={today}
        canEdit={canEdit}
        canFollow={canFollow}
        busy={busy}
        onToggle={toggle}
        onAdd={() => setDecisionDialog({ decision: null })}
        onEdit={(d) => setDecisionDialog({ decision: d })}
      />

      {(m.notes || m.next_date) && (
        <Card>
          <CardHeader>
            <CardTitle>{t('meeting.closing')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {m.notes && (
              <p dir="auto" className="whitespace-pre-wrap text-start text-sm leading-relaxed [overflow-wrap:anywhere]">
                {userText(m.notes)}
              </p>
            )}
            {m.next_date && (
              // A date too long for the label's line goes under the label, whole — not under the icon
              <p className="flex items-start gap-1.5 text-sm">
                <IconCalendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="text-muted-foreground">{t('meeting.nextDate')}</span>{' '}
                  <span className="whitespace-nowrap font-medium">{fmtLongDate(m.next_date, lng)}</span>
                </span>
              </p>
            )}
            {m.next_date && m.next_meeting_id ? (
              <Button variant="outline" size="sm" onClick={() => navigate(`/meetings/${m.next_meeting_id}`)}>
                <IconCalendar />
                {t('meeting.openNext')}
              </Button>
            ) : (
              m.next_date &&
              canEdit &&
              m.next_date >= today && (
                <Button variant="outline" size="sm" onClick={() => setPreparingNext(true)}>
                  <IconPlus />
                  {t('meeting.prepareNext')}
                </Button>
              )
            )}
          </CardContent>
        </Card>
      )}
      {canEdit && !m.notes && !m.next_date && <AddRow onClick={() => setEditing(true)}>{t('meeting.addClosing')}</AddRow>}

      {/* سطر الأرشيف: من كتب المحضر و متى، و آخر تعديل إن اختلف */}
      <p className="text-xs text-muted-foreground">
        {[
          m.created_by && t('meeting.createdBy', { name: m.created_by, date: stampDate(m.created_at) }),
          m.updated_at !== m.created_at &&
            (m.updated_by
              ? t('meeting.updatedBy', { name: m.updated_by, date: stampDate(m.updated_at) })
              : t('prep.updatedAt', { date: stampDate(m.updated_at) })),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {canEdit && (
        <>
          <MeetingFormDialog
            open={preparingNext}
            initial={null}
            seed={{
              kind: LEGACY_MEETING_KINDS.includes(m.kind) ? 'leaders' : m.kind,
              date: m.next_date,
              start_time: m.start_time || '',
              end_time: m.end_time || '',
              place: m.place || '',
              branch_ids: m.branch_ids || [],
              section: m.section,
              chair: { id: m.chair_id, name: m.chair || '' },
              secretary: { id: m.secretary_id, name: m.secretary || '' },
              agenda: nextAgenda,
            }}
            onClose={() => setPreparingNext(false)}
            onSaved={(payload) => {
              setPreparingNext(false);
              toast.success(t('meeting.created'));
              navigate(`/meetings/${payload.id}`);
            }}
          />
          <MeetingFormDialog
            open={editing}
            initial={m}
            onClose={() => setEditing(false)}
            onSaved={(payload) => {
              setEditing(false);
              setM(payload);
              toast.success(t('meeting.updated'));
            }}
          />
          <AttendanceDialog
            m={m}
            open={attendanceOpen}
            onClose={() => setAttendanceOpen(false)}
            onSaved={({ attendees }) => {
              setAttendanceOpen(false);
              setM((x) => ({ ...x, attendees }));
              toast.success(t('meeting.attendanceSaved'));
            }}
            leaders={leaders.data || []}
            t={t}
          />
          <ItemDialog
            m={m}
            item={itemDialog?.item ?? null}
            open={!!itemDialog}
            onClose={() => setItemDialog(null)}
            onSaved={({ items }, msg) => {
              setItemDialog(null);
              setM((x) => ({ ...x, items }));
              toast.success(t(msg));
            }}
            t={t}
          />
          <DecisionDialog
            m={m}
            decision={decisionDialog?.decision ?? null}
            open={!!decisionDialog}
            onClose={() => setDecisionDialog(null)}
            onSaved={({ decisions }, msg) => {
              setDecisionDialog(null);
              setM((x) => ({ ...x, decisions }));
              toast.success(t(msg));
            }}
            leaders={leaders.data || []}
            t={t}
          />
        </>
      )}
    </div>
  );
}
