import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useFetch } from '../hooks';
import { useSection } from '../section';
import { branchName, memberName, todayISO } from '../utils';
import { EVENT_KINDS, chiefLabel } from '../lib/events';
import AmountInput from './AmountInput';
import DatePicker from './DatePicker';
import SearchSelect from './SearchSelect';
import SectionField from './SectionField';
import {
  Button,
  Dialog,
  ErrorState,
  IconCheck,
  IconSwap,
  Input,
  Label,
  SegmentedControl,
  Textarea,
  cn,
} from './ui';

const emptyEvent = () => ({
  kind: 'camp',
  title: '',
  start_date: todayISO(),
  end_date: todayISO(),
  place: '',
  fee: '',
  plan: '',
  leader_id: '',
  branch_ids: [],
  // '' = not picked yet: the قسم on screen, else الفتيان. Its فرق win once picked.
  section: '',
});

const fromEvent = (e) => ({
  kind: e.kind,
  title: e.title,
  start_date: e.start_date,
  end_date: e.end_date,
  place: e.place || '',
  fee: e.fee === null || e.fee === undefined ? '' : String(e.fee),
  plan: e.plan || '',
  leader_id: e.leader_id ? String(e.leader_id) : '',
  branch_ids: e.branch_ids || [],
  section: e.section,
});

// The server's refusals that the قائد can act on, in words
const ERRORS = {
  mixed_sections: 'section.mixed',
  sessions_outside_dates: 'event.errSessionsOutside',
  'invalid dates': 'event.errDates',
  forbidden: 'event.errForbiddenBranch',
};

/**
 * المخيم أو الدورة: إنشاء (initial = null) أو تعديل، في نافذة أزرارها ثابتة أسفلها —
 * النموذج طويل، و الحفظ يبقى في متناول الإبهام. The money field shows only to who may
 * see amounts; the server keeps the fee untouched for anyone else. The قسم is settled at
 * creation: participants come from it, so an edit never moves it.
 */
export default function EventFormDialog({ open, initial, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const { has } = usePerms();
  const canFees = has('sessions.read.fees');
  const { section: onScreen } = useSection();
  const branches = useFetch('/branches', { skip: !open });
  const leaders = useFetch('/leader-options', { skip: !open });
  const [form, setForm] = useState(emptyEvent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Every opening starts from the saved event, or from a blank one dated today
  useEffect(() => {
    if (!open) return;
    setForm(initial ? fromEvent(initial) : emptyEvent());
    setError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchList = branches.data || [];
  const firstBranchSection = branchList.find((b) => b.id === form.branch_ids[0])?.section;
  const formSection = initial?.section || onScreen || firstBranchSection || form.section || 'M';
  const sectionBranches = branchList.filter((b) => b.section === formSection);
  const leaderOptions = (leaders.data || [])
    .filter((l) => l.section === formSection && (l.status === 'active' || l.id === Number(form.leader_id)))
    .map((l) => ({ value: l.id, label: memberName(l) }));
  const loadFailed = branches.error || leaders.error;

  function pickSection(s) {
    if (s === formSection) return;
    setForm((f) => ({ ...f, section: s, branch_ids: [], leader_id: '' }));
  }

  function toggleBranch(id) {
    setForm((f) => ({
      ...f,
      branch_ids: f.branch_ids.includes(id) ? f.branch_ids.filter((x) => x !== id) : [...f.branch_ids, id],
    }));
  }

  // The last day follows the first until it is picked on its own: most events are
  // set up starting from the first day
  function pickStart(e) {
    const v = e.target.value;
    setForm((f) => ({ ...f, start_date: v, end_date: !f.end_date || f.end_date < v ? v : f.end_date }));
  }

  async function save(e) {
    e.preventDefault();
    setError(null);
    if (form.end_date < form.start_date) {
      setError(t('event.errDates'));
      return;
    }
    setSaving(true);
    try {
      const body = {
        kind: form.kind,
        title: form.title,
        start_date: form.start_date,
        end_date: form.end_date,
        place: form.place || null,
        plan: form.plan || null,
        leader_id: form.leader_id === '' ? null : Number(form.leader_id),
        branch_ids: form.branch_ids.map(Number),
        // Read by the server only when the event has no فرقة to take it from
        section: formSection,
        ...(canFees ? { fee: form.fee === '' ? null : Number(form.fee) } : {}),
      };
      const saved = initial ? await api.put(`/events/${initial.id}`, body) : await api.post('/events', body);
      onSaved(saved);
    } catch (err) {
      setError(ERRORS[err.message] ? t(ERRORS[err.message]) : err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? `${t('common.edit')} — ${initial.title}` : t('event.new')}
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
            <Button type="submit" form="event-form" loading={saving} disabled={!!loadFailed}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      {loadFailed ? (
        <ErrorState
          message={t('error.loadFailed')}
          onRetry={() => {
            if (branches.error) branches.reload();
            if (leaders.error) leaders.reload();
          }}
          retryLabel={t('error.retry')}
        />
      ) : (
        <form id="event-form" onSubmit={save} className="space-y-4">
          {/* Both أقسام on screen: settled first, it decides which فرق and قادة follow */}
          {!initial && !onScreen && <SectionField value={formSection} onChange={pickSection} />}

          <div className="space-y-1.5">
            <Label>{t('event.kind')}</Label>
            <SegmentedControl
              label={t('event.kind')}
              value={form.kind}
              onChange={(v) => setForm((f) => ({ ...f, kind: v }))}
              options={EVENT_KINDS.map((k) => ({ value: k, label: t(`event.kind_${k}`) }))}
              className="flex w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev_title">{t('event.name')}</Label>
            <Input
              id="ev_title"
              required
              maxLength={200}
              autoComplete="off"
              placeholder={t(`event.namePlaceholder_${form.kind}`)}
              value={form.title}
              onChange={set('title')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ev_start">{t('event.startDate')}</Label>
              <DatePicker id="ev_start" required clearable={false} value={form.start_date} onChange={pickStart} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev_end">{t('event.endDate')}</Label>
              <DatePicker id="ev_end" required clearable={false} value={form.end_date} onChange={set('end_date')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev_place">{t('session.place')}</Label>
              <Input id="ev_place" maxLength={200} autoComplete="off" value={form.place} onChange={set('place')} />
            </div>
            {canFees && (
              <div className="space-y-1.5">
                <Label htmlFor="ev_fee">{t('event.fee')}</Label>
                <AmountInput
                  id="ev_fee"
                  placeholder={t('event.free')}
                  value={form.fee}
                  onChange={set('fee')}
                />
                <p className="text-xs text-muted-foreground">{t('event.feeHint')}</p>
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ev_leader">{chiefLabel(t, form.kind, formSection)}</Label>
              <SearchSelect
                id="ev_leader"
                value={form.leader_id}
                onChange={set('leader_id')}
                options={leaderOptions}
                clearLabel={t('event.noLeader')}
                placeholder={t('event.noLeader')}
                searchPlaceholder={t('session.searchLeader')}
                emptyLabel={t('member.noListValue')}
                ariaLabel={chiefLabel(t, form.kind, formSection)}
              />
            </div>
          </div>

          {sectionBranches.length > 0 && (
            <div className="space-y-1.5">
              <Label>{t('event.branches')}</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t('event.branches')}>
                {sectionBranches.map((b) => {
                  const on = form.branch_ids.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleBranch(b.id)}
                      className={cn(
                        'focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-[color,background-color,border-color,scale] active:scale-[0.96] sm:min-h-9',
                        on
                          ? 'border-primary bg-primary/10 font-medium text-primary'
                          : 'border-input bg-card text-muted-foreground hover:bg-accent'
                      )}
                    >
                      <IconSwap
                        on={on}
                        onIcon={<IconCheck className="h-3.5 w-3.5" />}
                        className="h-3.5 w-3.5"
                        collapse
                      />
                      {branchName(b, i18n.language)}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {form.branch_ids.length ? t('event.branchesHint') : t('event.wholeGroupHint')}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ev_plan">{t('event.plan')}</Label>
            <Textarea
              id="ev_plan"
              dir="auto"
              rows={5}
              maxLength={10000}
              value={form.plan}
              onChange={set('plan')}
            />
            <p className="text-xs text-muted-foreground">{t('event.planHint')}</p>
          </div>
        </form>
      )}
    </Dialog>
  );
}
