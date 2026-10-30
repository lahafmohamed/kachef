import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { displayError } from '../lib/errors';
import { useAuth, usePerms } from '../auth';
import { useFetch } from '../hooks';
import { avatarName, branchName, fmtDate, fmtPhone, memberName } from '../utils';
import DatePicker from './DatePicker';
import { phoneNumbers, telHref, waHref } from './MemberParts';
import {
  cn,
  Avatar,
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  useConfirm,
  useToast,
  IconArrow,
  IconCalendar,
  IconPencil,
  IconPhone,
  IconPlus,
  IconTrash,
  IconWhatsApp,
} from './ui';

// ---------- Suivi des absences (A2) ----------
// Le motif d'un absent ou d'un excusé, et le journal des contacts avec la famille
// (سجل المتابعة) : mêmes listes que le serveur (ABSENCE_REASONS, CONTACT_CHANNELS).

export const ABSENCE_REASONS = ['illness', 'travel', 'study', 'family', 'dropout', 'other'];
export const CONTACT_CHANNELS = ['call', 'whatsapp', 'visit', 'other'];

/** La série d'absences qui demande un appel : réglée par l'admin, 3 par défaut. */
export function useAbsenceThreshold() {
  const { user } = useAuth();
  return user?.absence_threshold ?? 3;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysSince = (iso) =>
  Math.max(0, Math.round((Date.parse(`${todayISO()}T12:00:00Z`) - Date.parse(`${String(iso).slice(0, 10)}T12:00:00Z`)) / 86400000));

/** Une relance prévue et pas encore échue : la ligne passe au second plan. */
export const contactSnoozed = (c) => !!c?.next_date && c.next_date > todayISO();

/** «تواصل معه فلان قبل 3 أيام · المتابعة في 20/10» — ou «لم يُتّصل بأهله بعد». */
export function LastContactLine({ contact, className }) {
  const { t } = useTranslation();
  if (!contact)
    return <span className={cn('text-xs text-muted-foreground', className)}>{t('followup.notContacted')}</span>;
  const n = daysSince(contact.contacted_at);
  const when = n === 0 ? t('followup.today') : t('followup.daysAgo', { count: n });
  return (
    <span className={cn('text-xs text-muted-foreground', className)}>
      {t('followup.contactedBy', { when, name: contact.contacted_by })}
      {contact.next_date && (
        <>
          {' · '}
          <span className={cn(!contactSnoozed(contact) && 'font-medium text-warning')}>
            {contactSnoozed(contact)
              ? t('followup.nextOn', { date: fmtDate(contact.next_date) })
              : t('followup.nextDue', { date: fmtDate(contact.next_date) })}
          </span>
        </>
      )}
    </span>
  );
}

/** wa.me with a prefilled message to the family. */
export const waFollowupHref = (phone, text) => `${waHref(phone)}?text=${encodeURIComponent(text)}`;

export function followupMessage(t, m, absences) {
  return t('followup.waMessage', { name: m.first_name || memberName(m), count: absences || 0 });
}

/** The family's numbers, father and mother first; the عنصر's own only when neither has one. */
function familyPhones(m) {
  const parents = [
    ['father', phoneNumbers(m.father_phone)[0]],
    ['mother', phoneNumbers(m.mother_phone)[0]],
  ].filter(([, n]) => n);
  if (parents.length) return parents;
  const own = phoneNumbers(m.member_phone)[0];
  return own ? [['self', own]] : [];
}

// ---------- Saisie d'un contact ----------

const emptyContact = () => ({ contacted_at: todayISO(), channel: 'call', reason: '', note: '', next_date: '' });

/**
 * Note un contact avec la famille (ou le corrige). Le motif «انقطاع» propose ensuite
 * l'archivage, à qui peut archiver.
 */
export function ContactDialog({ open, member, contact, defaultChannel, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { has } = usePerms();
  const [form, setForm] = useState(emptyContact);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [openedFor, setOpenedFor] = useState(null);
  // Reset on each opening: a new contact starts from today, an edit from its line
  const key = open ? `${member?.id}:${contact?.id ?? 'new'}` : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    if (open) {
      setForm(
        contact
          ? {
              contacted_at: contact.contacted_at,
              channel: contact.channel,
              reason: contact.reason || '',
              note: contact.note || '',
              next_date: contact.next_date || '',
            }
          : { ...emptyContact(), channel: defaultChannel || 'call' }
      );
      setError('');
    }
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  async function save(e) {
    e.preventDefault();
    if (form.next_date && form.next_date < form.contacted_at) return setError(t('followup.errNextDate'));
    setSaving(true);
    setError('');
    const body = { ...form, reason: form.reason || null, next_date: form.next_date || null };
    try {
      const saved = contact
        ? await api.put(`/members/${member.id}/contacts/${contact.id}`, body)
        : await api.post(`/members/${member.id}/contacts`, body);
      toast.success(t('followup.saved'));
      onSaved?.(saved);
      onClose();
      if (!contact && saved.reason === 'dropout' && has('members.delete') && member.status !== 'archived') {
        const ok = await confirm({
          title: t('followup.archiveTitle'),
          message: t('followup.archiveMessage', { name: memberName(member) }),
          confirmLabel: t('followup.archiveConfirm'),
        });
        if (ok) {
          await api.del(`/members/${member.id}`);
          toast.success(t('followup.archived'));
          onSaved?.(saved, { archived: true });
        }
      }
    } catch (err) {
      setError(displayError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={contact ? t('followup.editTitle') : t('followup.newTitle')}
      description={member ? memberName(member) : ''}
      size="sm"
    >
      <form onSubmit={save} className="space-y-4">
        <Field label={t('followup.date')}>
          {(p) => <DatePicker {...p} value={form.contacted_at} onChange={set('contacted_at')} clearable={false} required />}
        </Field>
        <Field label={t('followup.channelLabel')}>
          {() => (
            <SegmentedControl
              className="w-full"
              columns={2}
              label={t('followup.channelLabel')}
              value={form.channel}
              onChange={(v) => setForm((f) => ({ ...f, channel: v }))}
              options={CONTACT_CHANNELS.map((c) => ({ value: c, label: t(`followup.channel.${c}`) }))}
            />
          )}
        </Field>
        <Field label={t('followup.reasonLabel')}>
          {(p) => (
            <Select {...p} value={form.reason} onChange={set('reason')}>
              <option value="">{t('followup.reasonNone')}</option>
              {ABSENCE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`followup.reason.${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('followup.note')}>
          {(p) => <Textarea {...p} rows={3} maxLength={1000} value={form.note} onChange={set('note')} />}
        </Field>
        <Field label={t('followup.nextDate')} hint={t('followup.nextDateHint')}>
          {(p) => <DatePicker {...p} value={form.next_date} onChange={set('next_date')} />}
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="brand" loading={saving}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------- Fil de la fiche عنصر ----------

/**
 * سجل المتابعة on the member's file: every contact with the family and every زيارة
 * الأهل, newest first, with a WhatsApp message ready to send.
 */
export function FollowupLog({ member, absences, onArchived }) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { has } = usePerms();
  const res = useFetch(`/members/${member.id}/contacts`);
  const [dialog, setDialog] = useState(null);
  const canWrite = !!res.data?.can_write;
  const phones = has('members.contact') ? familyPhones(member) : [];

  async function remove(c) {
    if (!(await confirm({ title: t('common.delete'), message: t('followup.confirmDelete') }))) return;
    try {
      await api.del(`/members/${member.id}/contacts/${c.id}`);
      res.reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  }

  const feed = [
    ...(res.data?.items || []).map((c) => ({ ...c, kind: 'contact', date: c.contacted_at })),
    ...(res.data?.visits || []).map((v) => ({ ...v, kind: 'visit', id: `v${v.session_id}` })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return (
    <div className="space-y-4">
      {(canWrite || phones.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <Button variant="brand" size="sm" onClick={() => setDialog({})}>
              <IconPlus className="h-4 w-4" />
              {t('followup.add')}
            </Button>
          )}
          {phones.map(([who, n]) => (
            <a
              key={who}
              href={waFollowupHref(n, followupMessage(t, member, absences))}
              target="_blank"
              rel="noopener noreferrer"
              title={fmtPhone(n)}
              className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium shadow-xs transition-colors hover:border-[#25D366]/40 hover:bg-[#25D366]/10 sm:min-h-8"
            >
              <IconWhatsApp className="h-4 w-4 text-[#25D366]" />
              {t('followup.waTo', { who: t(`dashboard.followup.${who}`) })}
            </a>
          ))}
        </div>
      )}
      {res.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : feed.length === 0 ? (
        <EmptyState icon={<IconPhone className="h-6 w-6" />} title={t('followup.empty')}>
          {t('followup.emptyHint')}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {feed.map((e) =>
            e.kind === 'visit' ? (
              <li key={e.id} className="flex items-start gap-3 p-3">
                <Badge variant="info" className="mt-0.5 shrink-0">
                  {t('followup.channel.visit')}
                </Badge>
                <div className="min-w-0 flex-1">
                  <Link to={`/sessions/${e.session_id}`} className="focus-ring rounded font-medium hover:underline">
                    {e.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    <span className="tabular-nums">{fmtDate(e.date)}</span>
                    {e.leaders && ` · ${e.leaders}`}
                  </p>
                </div>
              </li>
            ) : (
              <li key={e.id} className="flex items-start gap-3 p-3">
                <Badge variant={e.channel === 'whatsapp' ? 'success' : 'secondary'} className="mt-0.5 shrink-0">
                  {t(`followup.channel.${e.channel}`)}
                </Badge>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm">
                    <span className="font-medium tabular-nums">{fmtDate(e.contacted_at)}</span>
                    {' · '}
                    <bdi>{e.contacted_by}</bdi>
                    {e.reason && (
                      <>
                        {' · '}
                        <span className={cn(e.reason === 'dropout' && 'font-medium text-destructive')}>
                          {t(`followup.reason.${e.reason}`)}
                        </span>
                      </>
                    )}
                  </p>
                  {e.note && <p className="text-sm whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">{e.note}</p>}
                  {e.next_date && (
                    <p className={cn('flex items-center gap-1 text-xs', contactSnoozed(e) ? 'text-muted-foreground' : 'font-medium text-warning')}>
                      <IconCalendar className="h-3.5 w-3.5" />
                      {contactSnoozed(e)
                        ? t('followup.nextOn', { date: fmtDate(e.next_date) })
                        : t('followup.nextDue', { date: fmtDate(e.next_date) })}
                    </p>
                  )}
                </div>
                {e.can_edit && (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" aria-label={t('common.edit')} onClick={() => setDialog({ contact: e })}>
                      <IconPencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={t('common.delete')} onClick={() => remove(e)}>
                      <IconTrash className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            )
          )}
        </ul>
      )}
      <ContactDialog
        open={!!dialog}
        member={member}
        contact={dialog?.contact}
        onClose={() => setDialog(null)}
        onSaved={(_, opts) => {
          res.reload({ quiet: true });
          if (opts?.archived) onArchived?.();
        }}
      />
    </div>
  );
}

// ---------- Liste de suivi (tableau de bord, onglet متابعة de la فرقة) ----------

/**
 * عناصر whose absences reached the threshold: their streak, when they last came, who
 * last called the family — and the call, the WhatsApp message, the note of the call.
 * A row whose follow-up is planned and not yet due goes to the end, dimmed.
 */
export function FollowupList({ items, initial = 5, onChanged, moreLink = '/members?follow=1' }) {
  const { t, i18n } = useTranslation();
  const { has } = usePerms();
  const [all, setAll] = useState(false);
  const [logging, setLogging] = useState(null);
  // Contacts noted here, shown at once without reading the whole list back
  const [noted, setNoted] = useState({});
  const listId = useId();
  if (!items?.length) return <p className="py-2 text-sm text-muted-foreground">{t('followup.none')}</p>;
  items = items.map((m) => (noted[m.id] ? { ...m, last_contact: noted[m.id] } : m));
  const ordered = [...items.filter((m) => !contactSnoozed(m.last_contact)), ...items.filter((m) => contactSnoozed(m.last_contact))];
  const shown = all ? ordered : ordered.slice(0, initial);
  const canLog = has('members.followup');

  return (
    <div>
      <ul id={listId} className="divide-y divide-border">
        {shown.map((m) => {
          const name = memberName(m);
          const phones = familyPhones(m);
          const snoozed = contactSnoozed(m.last_contact);
          return (
            <li key={m.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5', snoozed && 'opacity-60')}>
              <Avatar name={avatarName(m)} className="h-9 w-9 max-[359px]:hidden" />
              <Link to={`/members/${m.id}?tab=followup`} className="focus-ring min-w-0 flex-1 basis-48 rounded-md">
                <span className="block font-medium [overflow-wrap:anywhere]">{name}</span>
                <span className="block text-xs text-muted-foreground">
                  {[branchName(m, i18n.language), m.group_name].filter(Boolean).join(' · ')}
                </span>
                <span className="block text-xs text-muted-foreground">
                  <span className="font-medium text-destructive">
                    {t('member.consecutiveAbsences', { count: m.absences })}
                  </span>
                  {m.last_present !== undefined && (
                    <>
                      {' · '}
                      {m.last_present
                        ? t('dashboard.followup.lastPresent', { date: fmtDate(m.last_present) })
                        : t('dashboard.followup.never')}
                    </>
                  )}
                </span>
                <LastContactLine contact={m.last_contact} className="block" />
              </Link>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {phones.map(([who, n]) => {
                  const label = t(`dashboard.followup.${who}`);
                  return (
                    <a
                      key={who}
                      href={telHref(n)}
                      aria-label={`${label} — ${t(`dashboard.followup.call${who === 'self' ? 'Self' : who === 'father' ? 'Father' : 'Mother'}`, { name })}`}
                      title={fmtPhone(n)}
                      className="focus-ring inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium shadow-xs transition-colors hover:border-primary/35 hover:bg-accent hover:text-accent-foreground active:scale-[0.97] sm:h-8"
                    >
                      <IconPhone className="h-3.5 w-3.5 max-sm:hidden" />
                      {label}
                    </a>
                  );
                })}
                {phones[0] && (
                  <a
                    href={waFollowupHref(phones[0][1], followupMessage(t, m, m.absences))}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${t('member.whatsapp')} — ${name}`}
                    title={fmtPhone(phones[0][1])}
                    className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-[#25D366] shadow-xs transition-colors hover:border-[#25D366]/40 hover:bg-[#25D366]/10 sm:h-8 sm:w-8"
                  >
                    <IconWhatsApp className="h-4 w-4" />
                  </a>
                )}
                {canLog && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-8"
                    aria-label={`${t('followup.log')} — ${name}`}
                    onClick={() => setLogging(m)}
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                    {t('followup.log')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
        {ordered.length > initial && (
          <Button
            variant="ghost"
            size="sm"
            className="-ms-3"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll((v) => !v)}
          >
            {all ? t('dashboard.followup.showLess') : t('dashboard.followup.showAll', { count: ordered.length })}
          </Button>
        )}
        {moreLink && (
          <Link
            to={moreLink}
            className="focus-ring inline-flex min-h-11 items-center gap-1 rounded text-sm font-medium text-primary hover:underline sm:min-h-0"
          >
            {t('dashboard.followup.openMembers')}
            <IconArrow className="h-3.5 w-3.5 rtl:rotate-180" />
          </Link>
        )}
      </div>
      <ContactDialog
        open={!!logging}
        member={logging}
        onClose={() => setLogging(null)}
        onSaved={(c) => {
          setNoted((n) => ({ ...n, [c.member_id]: c }));
          onChanged?.();
        }}
      />
    </div>
  );
}

/** The «متابعة» tab of a فرقة: its عناصر to follow, as on the dashboard. */
export function BranchFollowup({ branchId }) {
  const { t } = useTranslation();
  const threshold = useAbsenceThreshold();
  const res = useFetch(`/members?follow=1&branch=${branchId}`);
  if (res.loading)
    return (
      <div className="space-y-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  const items = (res.data || []).map((m) => ({
    ...m,
    absences: m.attendance?.absences,
    last_present: m.attendance?.last_present ?? null,
  }));
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t('followup.branchHint', { count: threshold })}</p>
      {items.length === 0 ? (
        <EmptyState icon={<IconPhone className="h-6 w-6" />} title={t('followup.branchEmpty')}>
          {t('followup.branchEmptyHint', { count: threshold })}
        </EmptyState>
      ) : (
        <FollowupList
          items={items}
          initial={50}
          moreLink={`/members?follow=1&branch=${branchId}`}
          onChanged={() => res.reload({ quiet: true })}
        />
      )}
    </div>
  );
}
