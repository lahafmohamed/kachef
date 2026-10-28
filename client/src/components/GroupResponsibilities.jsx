import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { displayError } from '../lib/errors';
import { useFetch } from '../hooks';
import { avatarName, fmtDate, memberName, todayISO } from '../utils';
import DatePicker from './DatePicker';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  Input,
  Label,
  Select,
  Skeleton,
  useConfirm,
  useToast,
  IconAlert,
} from './ui';

// مسؤوليات الطليعة (C1): العريف الأول، العريف، المساعد، و دور حرّ. الأدوار الثلاثة
// الأولى لها صاحب واحد في الطليعة، و الخادم يغلق سلفه بنفسه.
export const RESP_ROLES = ['arif_awwal', 'arif', 'musaid', 'other'];
export const LEAD_ROLES = ['arif_awwal', 'arif'];

export const respLabel = (t, r) => (r.role === 'other' ? r.label : t(`resp.role.${r.role}`));

// The badge that says a عنصر's role, wherever his name is listed
export function RoleBadges({ items, className }) {
  const { t } = useTranslation();
  if (!items?.length) return null;
  return items.map((r, i) => (
    <Badge key={`${r.role}-${r.label || ''}-${i}`} variant={r.role === 'other' ? 'outline' : 'info'} className={className}>
      {respLabel(t, r)}
    </Badge>
  ));
}

/**
 * The alerts of a فرقة's size, one line each: طليعة without عريف, too small or too
 * big, a فرقة over its maximum, active عناصر in no طليعة.
 */
export function staffingLines(t, s) {
  if (!s) return [];
  const names = (list) => list.map((g) => `${g.name} (${g.count})`).join(t('member.listSep'));
  const lines = [];
  if (s.no_lead.length) lines.push(t('resp.alertNoLead', { names: s.no_lead.map((g) => g.name).join(t('member.listSep')) }));
  if (s.small.length) lines.push(t('resp.alertSmall', { min: s.limits.group_min, names: names(s.small) }));
  if (s.large.length) lines.push(t('resp.alertLarge', { max: s.limits.group_max, names: names(s.large) }));
  if (s.over_unit) lines.push(t('resp.alertUnit', { count: s.active, max: s.limits.unit_max }));
  if (s.unassigned) lines.push(t('resp.alertUnassigned', { count: s.unassigned }));
  return lines;
}

export function StaffingAlerts({ staffing, canEdit, onLimits }) {
  const { t } = useTranslation();
  const lines = staffingLines(t, staffing);
  if (!staffing) return null;
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-border bg-warning/5 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1 space-y-1">
        {lines.length ? (
          lines.map((l) => (
            <p key={l} className="flex items-start gap-2 text-sm">
              <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span className="min-w-0">{l}</span>
            </p>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{t('resp.alertNone')}</p>
        )}
        <p className="text-xs tabular-nums text-muted-foreground">
          {t('resp.limitsLine', {
            min: staffing.limits.group_min,
            max: staffing.limits.group_max,
            unit: staffing.limits.unit_max,
          })}
        </p>
      </div>
      {canEdit && (
        <Button size="sm" variant="ghost" className="shrink-0" onClick={onLimits}>
          {t('resp.limitsEdit')}
        </Button>
      )}
    </div>
  );
}

export function LimitsDialog({ branchId, limits, open, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(limits || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setForm(limits || {});
      setError(null);
    }
  }, [open, limits]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    const body = {
      group_min: Number(form.group_min),
      group_max: Number(form.group_max),
      unit_max: Number(form.unit_max),
    };
    if (!(body.group_min >= 1 && body.group_max >= body.group_min && body.unit_max >= 1))
      return setError(t('resp.limitsInvalid'));
    setSaving(true);
    try {
      await api.put(`/branches/${branchId}/group-limits`, body);
      toast.success(t('resp.limitsSaved'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message === 'invalid limits' ? t('resp.limitsInvalid') : displayError(err));
    } finally {
      setSaving(false);
    }
  }

  const field = (k, label, max) => (
    <div className="space-y-1.5">
      <Label htmlFor={`lim_${k}`}>{label}</Label>
      <Input id={`lim_${k}`} type="number" inputMode="numeric" min="1" max={max} required value={form[k] ?? ''} onChange={set(k)} />
    </div>
  );

  return (
    <Dialog open={open} onClose={onClose} title={t('resp.limitsTitle')} description={t('resp.limitsHint')} size="sm">
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {field('group_min', t('resp.groupMin'), 99)}
          {field('group_max', t('resp.groupMax'), 99)}
        </div>
        {field('unit_max', t('resp.unitMax'), 999)}
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

const ERRORS = {
  responsibility_exists: 'resp.errExists',
  member_without_group: 'resp.errNoGroup',
  'invalid start_date': 'resp.errDate',
  'label required': 'resp.errLabel',
};

/**
 * One طليعة's مسؤوليات: who holds what now, since when; giving a role; and what
 * came before. Ending keeps the line, dated; «محو» is only for a line typed by mistake.
 */
export function ResponsibilitiesDialog({ branchId, group, members, canEdit, onClose, onChange }) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const res = useFetch(group ? `/branches/${branchId}/responsibilities` : null);
  const [form, setForm] = useState({ member_id: '', role: 'arif', label: '', start_date: todayISO() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (group) {
      setForm({ member_id: '', role: 'arif', label: '', start_date: todayISO() });
      setError(null);
    }
  }, [group]);

  const inGroup = (r) => group && r.group_id === group.id;
  const current = (res.data?.current || []).filter(inGroup);
  const history = (res.data?.history || []).filter(inGroup);
  const roster = (members || []).filter((m) => group && m.group_id === group.id && m.status === 'active');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function changed() {
    res.reload({ quiet: true });
    onChange?.();
  }

  async function assign(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post(`/branches/${branchId}/responsibilities`, {
        member_id: Number(form.member_id),
        role: form.role,
        label: form.role === 'other' ? form.label : null,
        start_date: form.start_date,
      });
      toast.success(t('resp.assigned'));
      setForm((f) => ({ ...f, member_id: '', label: '' }));
      changed();
    } catch (err) {
      setError(ERRORS[err.message] ? t(ERRORS[err.message]) : displayError(err));
    } finally {
      setSaving(false);
    }
  }

  async function end(r) {
    const ok = await confirm({
      title: t('resp.end'),
      message: t('resp.endConfirm', { role: respLabel(t, r), name: memberName(r) }),
      confirmLabel: t('resp.end'),
      destructive: false,
    });
    if (!ok) return;
    try {
      await api.post(`/branches/${branchId}/responsibilities/${r.id}/end`, {});
      toast.success(t('resp.ended'));
      changed();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function remove(r) {
    if (
      !(await confirm({
        title: t('resp.remove'),
        message: t('resp.removeConfirm', { role: respLabel(t, r), name: memberName(r) }),
        confirmLabel: t('resp.remove'),
      }))
    )
      return;
    try {
      await api.del(`/branches/${branchId}/responsibilities/${r.id}`);
      changed();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const row = (r, past = false) => (
    <li key={r.id} className="flex items-center gap-3 py-2">
      <Avatar photo={r.photo} name={avatarName(r)} className="h-8 w-8" />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <bdi className="truncate font-medium">{memberName(r)}</bdi>
          <Badge variant={past ? 'outline' : r.role === 'other' ? 'outline' : 'info'}>{respLabel(t, r)}</Badge>
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {past
            ? t('resp.period', { from: fmtDate(r.start_date), to: fmtDate(r.end_date) }) +
              (r.end_reason ? ` · ${t(`resp.reason.${r.end_reason}`)}` : '')
            : t('resp.since', { date: fmtDate(r.start_date) })}
        </p>
      </div>
      {canEdit &&
        (past ? (
          <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground" onClick={() => remove(r)}>
            {t('resp.remove')}
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => end(r)}>
            {t('resp.end')}
          </Button>
        ))}
    </li>
  );

  return (
    <Dialog
      open={!!group}
      onClose={onClose}
      title={group ? t('resp.titleOf', { name: group.name }) : ''}
      description={t('resp.hint')}
      size="lg"
    >
      {res.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <div className="space-y-5">
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">{t('resp.current')}</h3>
            {current.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground">{t('resp.none')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {current.map((r) => row(r))}
              </ul>
            )}
          </section>

          {canEdit && (
            <form onSubmit={assign} className="space-y-3 rounded-lg border border-border p-3 sm:p-4">
              <h3 className="text-sm font-semibold">{t('resp.assign')}</h3>
              {roster.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('resp.noRoster')}</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="resp_member">{t('resp.member')}</Label>
                      <Select id="resp_member" required value={form.member_id} onChange={set('member_id')} placeholder={t('resp.pickMember')}>
                        {roster.map((m) => (
                          <option key={m.id} value={m.id}>
                            {memberName(m)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="resp_role">{t('resp.roleLabel')}</Label>
                      <Select id="resp_role" required value={form.role} onChange={set('role')}>
                        {RESP_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t(`resp.role.${r}`)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {form.role === 'other' && (
                      <div className="space-y-1.5">
                        <Label htmlFor="resp_label">{t('resp.customLabel')}</Label>
                        <Input
                          id="resp_label"
                          required
                          maxLength={40}
                          placeholder={t('resp.customPlaceholder')}
                          value={form.label}
                          onChange={set('label')}
                        />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="resp_start">{t('resp.startDate')}</Label>
                      <DatePicker id="resp_start" required clearable={false} value={form.start_date} onChange={set('start_date')} />
                    </div>
                  </div>
                  {LEAD_ROLES.includes(form.role) || form.role === 'musaid' ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">{t('resp.replaceHint')}</p>
                  ) : null}
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <div className="flex justify-end">
                    <Button type="submit" variant="brand" size="sm" loading={saving} disabled={!form.member_id}>
                      {t('resp.assignSubmit')}
                    </Button>
                  </div>
                </>
              )}
            </form>
          )}

          {history.length > 0 && (
            <section className="space-y-1">
              <h3 className="text-sm font-semibold">{t('resp.history')}</h3>
              <ul className="divide-y divide-border">
                {history.map((r) => row(r, true))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}
