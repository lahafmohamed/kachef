import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { displayError } from '../lib/errors';
import { useFetch } from '../hooks';
import { participantName, staffRoleLabel } from '../lib/events';
import { contactPhones } from '../lib/campFile';
import { avatarName, fmtDate, fmtPhone, memberName, todayISO } from '../utils';
import DatePicker from './DatePicker';
import { telHref } from './MemberParts';
import {
  cn,
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  useConfirm,
  useToast,
  IconAlert,
  IconCheck,
  IconClipboard,
  IconDroplet,
  IconFileText,
  IconPencil,
  IconPhone,
  IconPlus,
  IconShield,
  IconTrash,
  IconUsers,
  ProgressBar,
} from './ui';

// ---------- Camp prêt à partir (E1) ----------
// La fiche santé de l'عنصر, l'autorisation parentale par participant et la check-list
// sécurité du camp. Le serveur décide qui lit la santé : ce qui n'arrive pas ne s'affiche pas.

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const SCAN_MAX = 1.8 * 1024 * 1024;

/** Ce qu'un قائد doit savoir avant de partir : allergie, traitement, contre-indication, ne nage pas */
export const healthAlert = (h) => !!h && !!(h.allergies || h.treatment || h.medical_notes || h.can_swim === false);

/**
 * «Prêt» ou ce qui manque : autorisations parentales et points de sécurité.
 * Rien quand le camp n'a ni عنصر inscrit ni check-list.
 */
export function readinessFacts(t, r) {
  if (!r || (!r.consent_total && !r.safety_total)) return null;
  const parts = [];
  if (r.consent_missing > 0) parts.push(t('safety.consentMissing', { count: r.consent_missing }));
  if (r.safety_total && r.safety_done < r.safety_total)
    parts.push(t('safety.safetyScore', { done: r.safety_done, total: r.safety_total }));
  return { ready: parts.length === 0, parts };
}

export function ReadinessBadge({ r, className }) {
  const { t } = useTranslation();
  const f = readinessFacts(t, r);
  if (!f) return null;
  return f.ready ? (
    <Badge variant="success" className={className}>
      <IconShield className="h-3.5 w-3.5" aria-hidden="true" />
      {t('safety.ready')}
    </Badge>
  ) : (
    <Badge variant="warning" className={cn('max-w-full whitespace-normal', className)}>
      <IconAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {f.parts.join(' · ')}
    </Badge>
  );
}

function Fact({ label, children, wide = false }) {
  const empty = children == null || children === '' || children === false;
  return (
    <div className={cn('min-w-0', wide && 'col-span-2')}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 text-sm break-words whitespace-pre-line', empty ? 'text-muted-foreground' : 'font-medium')}>
        {empty ? '—' : children}
      </dd>
    </div>
  );
}

const swimLabel = (t, v) => (v === true ? t('safety.swimYes') : v === false ? t('safety.swimNo') : null);

/* ============================================================
   Fiche عنصر : onglet الصحة
   ============================================================ */

export function MemberHealthCard({ member }) {
  const { t } = useTranslation();
  const res = useFetch(`/members/${member.id}/health`);
  const [editing, setEditing] = useState(false);
  if (res.loading)
    return (
      <Card className="space-y-3 p-4 sm:p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  if (res.error) return <ErrorState message={res.error} onRetry={res.errorStatus === 403 ? undefined : res.reload} />;
  const h = res.data;
  const alert = healthAlert(h);
  return (
    <Card className="divide-y divide-border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t('safety.healthTitle')}</h3>
          <p className="text-xs text-muted-foreground">
            {h.updated_at
              ? t('safety.healthUpdated', { date: fmtDate(h.updated_at.slice(0, 10)), name: h.updated_by || '' })
              : t('safety.healthNever')}
          </p>
        </div>
        {h.can_edit && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <IconPencil />
            {t('common.edit')}
          </Button>
        )}
      </div>
      {alert && (
        <p className="flex items-start gap-2 px-4 py-3 text-sm text-warning sm:px-5">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('safety.alertHint')}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 p-4 sm:gap-x-6 sm:p-5">
        <Fact label={t('member.bloodType')}>{h.blood_type && <span dir="ltr">{h.blood_type}</span>}</Fact>
        <Fact label={t('safety.canSwim')}>{swimLabel(t, h.can_swim)}</Fact>
        <Fact label={t('safety.allergies')} wide>
          {h.allergies}
        </Fact>
        <Fact label={t('safety.treatment')} wide>
          {h.treatment}
        </Fact>
        <Fact label={t('safety.medicalNotes')} wide>
          {h.medical_notes}
        </Fact>
        <Fact label={t('safety.emergencyName')}>{h.emergency_name}</Fact>
        <Fact label={t('safety.emergencyPhone')}>
          {h.emergency_phone && (
            <a href={telHref(h.emergency_phone)} dir="ltr" className="focus-ring rounded-sm tabular-nums text-primary hover:underline">
              {fmtPhone(h.emergency_phone)}
            </a>
          )}
        </Fact>
      </dl>
      {h.can_edit && (
        <HealthDialog
          open={editing}
          onClose={() => setEditing(false)}
          member={member}
          health={h}
          onSaved={(next) => res.setData(next)}
        />
      )}
    </Card>
  );
}

function HealthDialog({ open, onClose, member, health, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [wasOpen, setWasOpen] = useState(false);
  // Reset on every opening, from what is stored
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm({
        blood_type: health.blood_type || '',
        allergies: health.allergies || '',
        treatment: health.treatment || '',
        medical_notes: health.medical_notes || '',
        can_swim: health.can_swim === true ? 'yes' : health.can_swim === false ? 'no' : 'unknown',
        emergency_name: health.emergency_name || '',
        emergency_phone: health.emergency_phone || '',
      });
      setError('');
    }
  }
  if (!form) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const saved = await api.put(`/members/${member.id}/health`, {
        ...form,
        blood_type: form.blood_type || null,
        can_swim: form.can_swim === 'yes' ? true : form.can_swim === 'no' ? false : null,
      });
      toast.success(t('safety.healthSaved'));
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(displayError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('safety.healthEdit')} description={memberName(member)} size="md">
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('member.bloodType')}>
            {(p) => (
              <Select {...p} value={form.blood_type} onChange={set('blood_type')}>
                <option value="">—</option>
                {BLOOD_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('safety.canSwim')}>
            {() => (
              <SegmentedControl
                className="w-full"
                label={t('safety.canSwim')}
                value={form.can_swim}
                onChange={(v) => setForm((f) => ({ ...f, can_swim: v }))}
                options={[
                  { value: 'yes', label: t('safety.swimYes') },
                  { value: 'no', label: t('safety.swimNo') },
                  { value: 'unknown', label: t('safety.swimUnknown') },
                ]}
              />
            )}
          </Field>
        </div>
        <Field label={t('safety.allergies')} hint={t('safety.allergiesHint')}>
          {(p) => <Textarea {...p} rows={2} maxLength={1000} value={form.allergies} onChange={set('allergies')} />}
        </Field>
        <Field label={t('safety.treatment')} hint={t('safety.treatmentHint')}>
          {(p) => <Textarea {...p} rows={2} maxLength={1000} value={form.treatment} onChange={set('treatment')} />}
        </Field>
        <Field label={t('safety.medicalNotes')} hint={t('safety.medicalNotesHint')}>
          {(p) => <Textarea {...p} rows={2} maxLength={2000} value={form.medical_notes} onChange={set('medical_notes')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('safety.emergencyName')}>
            {(p) => <Input {...p} maxLength={120} value={form.emergency_name} onChange={set('emergency_name')} />}
          </Field>
          <Field label={t('safety.emergencyPhone')}>
            {(p) => (
              <Input
                {...p}
                type="tel"
                dir="ltr"
                inputMode="tel"
                maxLength={40}
                value={form.emergency_phone}
                onChange={set('emergency_phone')}
              />
            )}
          </Field>
        </div>
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

/* ============================================================
   Fiche camp : onglet «الجاهزية»
   ============================================================ */

const staffName = (st) => (st.leader_id ? memberName(st) : st.name);

// ---------- Appel du car : départ et retour ----------

const LEGS = ['out', 'back'];

// The chip a participant falls under: his طليعة, «sans طليعة», or the قادة and guests together
const chipOf = (p) => (p.member_id ? (p.group_id ? `g${p.group_id}` : 'none') : 'others');

// «14:32», from the server's UTC datetime('now')
function clockOf(v) {
  const d = new Date(`${String(v).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5);
}

/** A طليعة chip, as the attendance list draws them */
function CountChip({ on, onClick, label, count }) {
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

/**
 * L'appel au car, téléphone en main : un tap par enfant qui monte, le compteur «32/35 à bord»,
 * la طليعة à l'écran, et les manquants avec le numéro des parents à appeler. Le pointage part
 * tout de suite au serveur ; un refus le reprend.
 */
function HeadcountDialog({ ev, setEv, people, canMark, open, onClose }) {
  const { t } = useTranslation();
  const toast = useToast();
  // From the camp's last day on, the call is the return one
  const [leg, setLeg] = useState(() => (todayISO() >= ev.end_date ? 'back' : 'out'));
  const [chip, setChip] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const at = `${leg}_at`;
  const by = `${leg}_by`;

  const groups = new Map();
  for (const p of people) {
    const key = chipOf(p);
    if (!groups.has(key))
      groups.set(key, {
        value: key,
        label: key === 'none' ? t('campFile.noGroup') : key === 'others' ? t('campFile.leadersGuests') : p.group_name,
        people: [],
      });
    groups.get(key).people.push(p);
  }
  const ordered = [...groups.values()].sort(
    (x, y) =>
      (x.value[0] === 'g' ? 0 : x.value === 'none' ? 1 : 2) - (y.value[0] === 'g' ? 0 : y.value === 'none' ? 1 : 2) ||
      String(x.label).localeCompare(String(y.label), undefined, { numeric: true })
  );
  const aboardOf = (list) => list.filter((p) => p[at]).length;
  const chips =
    ordered.length > 1
      ? [
          { value: '', label: t('safety.chipAll'), count: `${aboardOf(people)}/${people.length}` },
          ...ordered.map((g) => ({ value: g.value, label: g.label, count: `${aboardOf(g.people)}/${g.people.length}` })),
        ]
      : null;
  const scope = chip && groups.has(chip) ? groups.get(chip).people : people;
  const aboard = aboardOf(scope);
  const missing = scope.filter((p) => !p[at]);
  const rows = missingOnly ? missing : scope;

  const patch = (id, fields) =>
    setEv((e) => ({ ...e, participants: e.participants.map((x) => (x.id === id ? { ...x, ...fields } : x)) }));

  async function toggle(p) {
    const done = !p[at];
    const before = { [at]: p[at], [by]: p[by] };
    patch(p.id, { [at]: done ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, [by]: null });
    try {
      const { participant } = await api.put(`/events/${ev.id}/participants/${p.id}/checkin`, { leg, done });
      patch(p.id, { [at]: participant[at], [by]: participant[by] });
    } catch (err) {
      patch(p.id, before);
      toast.error(err.message);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('safety.headcountTitle')} description={t('safety.headcountHint')} size="lg" autoFocus={false}>
      <div className="space-y-4">
        <SegmentedControl
          className="flex w-full"
          label={t('safety.headcountTitle')}
          value={leg}
          onChange={setLeg}
          options={LEGS.map((l) => ({ value: l, label: t(`safety.leg_${l}`) }))}
        />
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-2xl font-semibold tabular-nums" aria-live="polite">
              {t('safety.onBoard', { done: aboard, total: scope.length })}
            </p>
            {aboard === scope.length && scope.length > 0 && (
              <span className="text-sm font-medium text-success">{t('safety.allAboard')}</span>
            )}
          </div>
          <ProgressBar value={scope.length ? (100 * aboard) / scope.length : 0} label={t('safety.headcountTitle')} />
        </div>
        {chips && (
          <div
            role="group"
            aria-label={t('safety.chipGroup')}
            className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
          >
            {chips.map((c) => (
              <CountChip key={c.value || 'all'} on={c.value === chip} onClick={() => setChip(c.value)} label={c.label} count={c.count} />
            ))}
          </div>
        )}
        <SegmentedControl
          className="flex w-full"
          size="sm"
          label={t('safety.headcountShow')}
          value={missingOnly ? 'missing' : 'all'}
          onChange={(v) => setMissingOnly(v === 'missing')}
          options={[
            { value: 'all', label: t('safety.showAll', { count: scope.length }) },
            { value: 'missing', label: t('safety.showMissing', { count: missing.length }) },
          ]}
        />
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('safety.allAboard')}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((p) => {
              const on = !!p[at];
              const phone = on ? null : contactPhones(p)[0];
              const name = participantName(p);
              return (
                <li key={p.id} className="flex items-stretch gap-2">
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={!canMark}
                    onClick={() => toggle(p)}
                    className={cn(
                      'focus-ring flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl border px-3 py-2 text-start transition-colors',
                      on ? 'border-success/40 bg-success/10' : 'border-border bg-card',
                      canMark ? 'cursor-pointer active:scale-[0.99]' : 'cursor-default',
                      canMark && !on && 'hover:bg-accent/60'
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2',
                        on ? 'border-success bg-success text-success-foreground' : 'border-input bg-background'
                      )}
                    >
                      {on && <IconCheck className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        <bdi>{name}</bdi>
                      </span>
                      {(p.group_name || !p.member_id) && (
                        <span className="block truncate text-xs text-muted-foreground">
                          <bdi>{p.group_name || t('campFile.leadersGuests')}</bdi>
                        </span>
                      )}
                    </span>
                    {on && (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground" title={p[by] || undefined}>
                        {clockOf(p[at])}
                      </span>
                    )}
                  </button>
                  {phone && (
                    <a
                      href={telHref(phone.number)}
                      aria-label={t('safety.callFor', { name, number: fmtPhone(phone.number) })}
                      title={fmtPhone(phone.number)}
                      className="focus-ring flex w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary shadow-xs transition-colors hover:bg-accent/60"
                    >
                      <IconPhone className="h-5 w-5" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

export function EventSafetyTab({ ev, setEv, canEdit, canMark, links }) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [consentFor, setConsentFor] = useState(null);
  const [counting, setCounting] = useState(false);
  // Who boards the car: the list, without whoever was taken off it
  const headcount = ev.participants.filter((p) => !p.withdrawn_at);
  const [itemDialog, setItemDialog] = useState(null);
  const [busy, setBusy] = useState(null);
  const canAct = !!ev.can_safety;
  // العلياء (18 ans et plus) n'ont pas d'autorisation parentale à fournir
  const members = ev.participants.filter((p) => p.consent_needed);
  // Missing first: the list is the one to go through before leaving
  const consentRows = [...members].sort((a, b) => !!a.consent_at - !!b.consent_at);
  const facts = readinessFacts(t, ev.readiness);
  const r = ev.readiness || {};

  const apply = (out) => setEv((e) => ({ ...e, ...out }));

  async function toggle(item) {
    setBusy(item.id);
    try {
      apply(await api.put(`/events/${ev.id}/checklist/${item.id}`, { done: !item.done_at }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(item) {
    const ok = await confirm({
      title: t('safety.removeItemTitle'),
      message: t('safety.removeItemMessage', { label: itemLabel(t, item) }),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      apply(await api.del(`/events/${ev.id}/checklist/${item.id}`));
    } catch (err) {
      toast.error(err.message);
    }
  }

  const healthRows = ev.health_visible ? members.filter((p) => p.health) : [];
  const alerts = healthRows.filter((p) => healthAlert(p.health));
  const blank = healthRows.filter(
    (p) => !p.health.updated_at && !p.health.blood_type && !p.health.emergency_phone
  ).length;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold">{t('safety.readinessTitle')}</h3>
          <p className="text-sm text-muted-foreground tabular-nums">
            {[
              r.consent_total ? t('safety.consentCount', { done: r.consent_total - r.consent_missing, total: r.consent_total }) : null,
              r.safety_total ? t('safety.safetyScore', { done: r.safety_done, total: r.safety_total }) : null,
            ]
              .filter(Boolean)
              .join(' · ') || t('safety.nothingYet')}
          </p>
        </div>
        {facts && <ReadinessBadge r={ev.readiness} />}
      </Card>

      {/* ----- Appel départ / retour ----- */}
      {headcount.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm font-semibold">{t('safety.headcountTitle')}</h3>
            <p className="text-sm text-muted-foreground tabular-nums">
              {LEGS.map((leg) =>
                t('safety.legCount', {
                  leg: t(`safety.leg_${leg}`),
                  done: headcount.filter((p) => p[`${leg}_at`]).length,
                  total: headcount.length,
                })
              ).join(' · ')}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setCounting(true)} className="w-full sm:w-auto">
            <IconUsers />
            {t(canMark ? 'safety.headcountOpen' : 'safety.headcountView')}
          </Button>
        </Card>
      )}

      {/* ----- Check-list sécurité ----- */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t('safety.checklistTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('safety.checklistHint')}</p>
          </div>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setItemDialog({ item: null })}>
              <IconPlus />
              {t('safety.addItem')}
            </Button>
          )}
        </div>
        {ev.checklist.length === 0 ? (
          <EmptyState icon={<IconShield className="h-6 w-6" />} title={t('safety.checklistEmpty')} />
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {ev.checklist.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <button
                  type="button"
                  disabled={!canAct || busy === item.id}
                  onClick={() => toggle(item)}
                  aria-pressed={!!item.done_at}
                  aria-label={itemLabel(t, item)}
                  className={cn(
                    'focus-ring mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors',
                    item.done_at ? 'border-success bg-success text-success-foreground' : 'border-input bg-background',
                    canAct ? 'cursor-pointer' : 'cursor-default opacity-80'
                  )}
                >
                  {item.done_at && <IconCheck className="h-4 w-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium', item.done_at && 'text-muted-foreground line-through')}>
                    <bdi>{itemLabel(t, item)}</bdi>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      item.staff_id
                        ? t('safety.responsible', {
                            name: item.staff_name,
                            role: staffRoleLabel(t, item.staff_role, item.staff_title, ev.section),
                          })
                        : t('safety.noResponsible'),
                      item.done_at && t('safety.doneBy', { name: item.done_by, date: fmtDate(item.done_at.slice(0, 10)) }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-9 px-0"
                      aria-label={t('common.edit')}
                      onClick={() => setItemDialog({ item })}
                    >
                      <IconPencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-9 px-0 text-destructive"
                      aria-label={t('common.delete')}
                      onClick={() => remove(item)}
                    >
                      <IconTrash />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ----- Autorisations parentales ----- */}
      <Card>
        <div className="px-4 pt-4 sm:px-5">
          <h3 className="text-sm font-semibold">{t('safety.consentTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('safety.consentHint')}</p>
        </div>
        {consentRows.length === 0 ? (
          <EmptyState icon={<IconClipboard className="h-6 w-6" />} title={t('safety.consentEmpty')} />
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {consentRows.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <Avatar photo={p.photo} name={avatarName(p)} className="h-9 w-9" />
                <div className="min-w-0 flex-1">
                  {links?.members ? (
                    <Link to={`/members/${p.member_id}`} className="focus-ring block truncate rounded-sm text-sm font-medium hover:underline">
                      <bdi>{memberName(p)}</bdi>
                    </Link>
                  ) : (
                    <p className="truncate text-sm font-medium">
                      <bdi>{memberName(p)}</bdi>
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {p.consent_at ? (
                      <>
                        {t('safety.consentReceived', { date: fmtDate(p.consent_at), name: p.consent_by || '' })}
                        {p.consent_has_scan && ` · ${t('safety.scanAttached')}`}
                      </>
                    ) : (
                      <bdi>{p.group_name || ''}</bdi>
                    )}
                  </p>
                </div>
                {p.consent_at ? (
                  <Badge variant="success">{t('safety.consentOk')}</Badge>
                ) : (
                  <Badge variant="outline">{t('safety.consentNone')}</Badge>
                )}
                {canAct && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-9 px-0"
                    aria-label={t('safety.consentEdit', { name: memberName(p) })}
                    onClick={() => setConsentFor(p)}
                  >
                    <IconPencil />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ----- Santé : members.health ou قادة du camp ----- */}
      {ev.health_visible && members.length > 0 && (
        <Card>
          <div className="px-4 pt-4 sm:px-5">
            <h3 className="text-sm font-semibold">{t('safety.healthCampTitle')}</h3>
            <p className="text-xs text-muted-foreground">
              {[t('safety.healthAlerts', { count: alerts.length }), blank ? t('safety.healthBlank', { count: blank }) : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {alerts.length === 0 ? (
            <EmptyState icon={<IconDroplet className="h-6 w-6" />} title={t('safety.noAlerts')} />
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {alerts.map((p) => (
                <li key={p.id} className="space-y-1 px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      <bdi>{memberName(p)}</bdi>
                    </span>
                    {p.health.blood_type && (
                      <Badge variant="outline" className="text-foreground">
                        <IconDroplet className="h-3.5 w-3.5" aria-hidden="true" />
                        <span dir="ltr">{p.health.blood_type}</span>
                      </Badge>
                    )}
                    {p.health.can_swim === false && <Badge variant="info">{t('safety.swimNo')}</Badge>}
                  </div>
                  <dl className="space-y-0.5 text-sm">
                    {p.health.allergies && <HealthLine label={t('safety.allergies')} value={p.health.allergies} />}
                    {p.health.treatment && <HealthLine label={t('safety.treatment')} value={p.health.treatment} />}
                    {p.health.medical_notes && <HealthLine label={t('safety.medicalNotes')} value={p.health.medical_notes} />}
                    {p.health.emergency_phone && (
                      <HealthLine
                        label={t('safety.emergencyPhone')}
                        value={
                          <a href={telHref(p.health.emergency_phone)} dir="ltr" className="tabular-nums text-primary hover:underline">
                            {fmtPhone(p.health.emergency_phone)}
                          </a>
                        }
                      />
                    )}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <HeadcountDialog
        ev={ev}
        setEv={setEv}
        people={headcount}
        canMark={!!canMark}
        open={counting}
        onClose={() => setCounting(false)}
      />
      {canAct && (
        <ConsentDialog
          ev={ev}
          participant={consentFor}
          onClose={() => setConsentFor(null)}
          onSaved={({ participant, readiness }) =>
            setEv((e) => ({
              ...e,
              readiness,
              participants: e.participants.map((x) => (x.id === participant.id ? { ...x, ...participant, consent_has_scan: !!participant.consent_has_scan } : x)),
            }))
          }
        />
      )}
      {canEdit && (
        <ChecklistItemDialog ev={ev} state={itemDialog} onClose={() => setItemDialog(null)} onSaved={apply} />
      )}
    </div>
  );
}

function HealthLine({ label, value }) {
  return (
    <div className="flex flex-wrap gap-x-1.5">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
    </div>
  );
}

export const itemLabel = (t, item) => (item.item ? t(`safety.item.${item.item}`) : item.label);

function ConsentDialog({ ev, participant: p, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [current, setCurrent] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (p && current !== p.id) {
    setCurrent(p.id);
    setForm({ consent_at: p.consent_at || todayISO(), consent_by: p.consent_by || '', scan: undefined, scanName: '' });
    setError('');
  }
  if (!p && current !== null) setCurrent(null);
  if (!p || !form) return null;

  async function send(body) {
    setSaving(true);
    setError('');
    try {
      const out = await api.put(`/events/${ev.id}/participants/${p.id}/consent`, body);
      toast.success(t('safety.consentSaved'));
      onSaved(out);
      onClose();
    } catch (err) {
      setError(displayError(err));
    } finally {
      setSaving(false);
    }
  }

  function pickScan(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > SCAN_MAX) return setError(t('safety.scanTooBig'));
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, scan: reader.result, scanName: file.name }));
    reader.readAsDataURL(file);
  }

  async function viewScan() {
    const tab = window.open('', '_blank');
    try {
      const { scan } = await api.get(`/events/${ev.id}/participants/${p.id}/consent-scan`);
      const blob = await (await fetch(scan)).blob();
      if (tab) tab.location.href = URL.createObjectURL(blob);
    } catch (err) {
      tab?.close();
      toast.error(err.message);
    }
  }

  return (
    <Dialog open={!!p} onClose={onClose} title={t('safety.consentDialog')} description={memberName(p)} size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const body = { consent_at: form.consent_at, consent_by: form.consent_by || null };
          if (form.scan !== undefined) body.scan = form.scan;
          send(body);
        }}
        className="space-y-4"
      >
        <Field label={t('safety.consentDate')}>
          {(props) => (
            <DatePicker
              {...props}
              value={form.consent_at}
              onChange={(v) => setForm((f) => ({ ...f, consent_at: v?.target ? v.target.value : v }))}
              clearable={false}
              required
            />
          )}
        </Field>
        <Field label={t('safety.consentBy')} hint={t('safety.consentByHint')}>
          {(props) => (
            <Input
              {...props}
              maxLength={120}
              value={form.consent_by}
              onChange={(e) => setForm((f) => ({ ...f, consent_by: e.target.value }))}
            />
          )}
        </Field>
        <Field label={t('safety.scan')} hint={t('safety.scanHint')}>
          {(props) => (
            <div className="space-y-2">
              <input
                {...props}
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={pickScan}
                className="block w-full text-sm file:me-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
              />
              {p.consent_has_scan && form.scan === undefined && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={viewScan}>
                    <IconFileText />
                    {t('safety.viewScan')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, scan: null }))}>
                    <IconTrash />
                    {t('safety.removeScan')}
                  </Button>
                </div>
              )}
              {form.scan === null && <p className="text-xs text-muted-foreground">{t('safety.scanWillGo')}</p>}
            </div>
          )}
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {p.consent_at ? (
            <Button type="button" variant="ghost" className="text-destructive" disabled={saving} onClick={() => send({ consent_at: null })}>
              {t('safety.consentRemove')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="brand" loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function ChecklistItemDialog({ ev, state, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [key, setKey] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const open = !!state;
  const k = state ? state.item?.id ?? 'new' : null;
  if (k !== key) {
    setKey(k);
    if (state) {
      setForm({ label: state.item ? (state.item.item ? '' : state.item.label) : '', staff_id: state.item?.staff_id ?? '' });
      setError('');
    }
  }
  if (!open || !form) return null;
  const item = state.item;

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const body = { staff_id: form.staff_id === '' ? null : Number(form.staff_id) };
    if (!item || !item.item) body.label = form.label;
    try {
      const out = item
        ? await api.put(`/events/${ev.id}/checklist/${item.id}`, body)
        : await api.post(`/events/${ev.id}/checklist`, body);
      toast.success(t('safety.itemSaved'));
      onSaved(out);
      onClose();
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
      title={item ? t('safety.editItem') : t('safety.addItem')}
      description={item?.item ? itemLabel(t, item) : undefined}
      size="sm"
    >
      <form onSubmit={save} className="space-y-4">
        {(!item || !item.item) && (
          <Field label={t('safety.itemLabel')}>
            {(p) => (
              <Input
                {...p}
                required
                maxLength={200}
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            )}
          </Field>
        )}
        <Field label={t('safety.itemResponsible')} hint={ev.staff.length ? null : t('safety.noStaffHint')}>
          {(p) => (
            <Select {...p} value={String(form.staff_id ?? '')} onChange={(e) => setForm((f) => ({ ...f, staff_id: e.target.value }))}>
              <option value="">{t('safety.noResponsible')}</option>
              {ev.staff.map((st) => (
                <option key={st.id} value={st.id}>
                  {`${staffName(st)} — ${staffRoleLabel(t, st.role, st.title, ev.section)}`}
                </option>
              ))}
            </Select>
          )}
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
