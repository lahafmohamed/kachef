import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { displayError } from '../lib/errors';
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
  Skeleton,
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
  // طلائع الفرق المختارة. لا طليعة لفرقة = الفرقة كاملةً.
  group_ids: [],
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
  group_ids: e.group_ids || [],
  section: e.section,
});

// The server's refusals that the قائد can act on, in words
const ERRORS = {
  mixed_sections: 'section.mixed',
  sessions_outside_dates: 'event.errSessionsOutside',
  'invalid dates': 'event.errDates',
  forbidden: 'event.errForbiddenBranch',
};

// A فرقة or a طليعة to tick: the check slides in when picked
function ToggleChip({ on, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-[color,background-color,border-color,scale] active:scale-[0.97] sm:min-h-9',
        on
          ? 'border-primary bg-primary-soft font-medium text-primary'
          : 'border-input bg-card text-muted-foreground hover:bg-accent'
      )}
    >
      <IconSwap on={on} onIcon={<IconCheck className="h-3.5 w-3.5" />} className="h-3.5 w-3.5" collapse />
      {children}
    </button>
  );
}

/**
 * المخيم أو الدورة: إنشاء (initial = null) أو تعديل، في نافذة أزرارها ثابتة أسفلها —
 * النموذج طويل، و الحفظ يبقى في متناول الإبهام. The money field shows only to who may
 * see amounts; the server keeps the fee untouched for anyone else. The قسم is settled at
 * creation: participants come from it, so an edit never moves it.
 */
export default function EventFormDialog({ open, initial, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const { has } = usePerms();
  const canFees = has('events.read.fees');
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
  // Only the picked فرق that were split into طلائع offer them
  const groupedBranches = sectionBranches.filter((b) => form.branch_ids.includes(b.id) && (b.groups || []).length > 0);
  const shownGroupIds = new Set(branchList.flatMap((b) => (b.groups || []).map((g) => g.id)));
  const leaderOptions = (leaders.data || [])
    .filter((l) => l.section === formSection && (l.status === 'active' || l.id === Number(form.leader_id)))
    .map((l) => ({ value: l.id, label: memberName(l) }));
  const loadFailed = branches.error || leaders.error;
  // First opening only: the lists are kept between openings. Saved before the فرق
  // arrive, an event would silently go to the whole فوج.
  const loadingLists = !loadFailed && (!branches.data || !leaders.data);
  const labelGroups = groupedBranches.length > 1;

  function pickSection(s) {
    if (s === formSection) return;
    setForm((f) => ({ ...f, section: s, branch_ids: [], group_ids: [], leader_id: '' }));
  }

  // Un-ticking a فرقة drops its طلائع with it: the server refuses a طليعة of a فرقة not picked
  function toggleBranch(id) {
    setForm((f) => {
      if (!f.branch_ids.includes(id)) return { ...f, branch_ids: [...f.branch_ids, id] };
      const dropped = new Set((branchList.find((b) => b.id === id)?.groups || []).map((g) => g.id));
      return {
        ...f,
        branch_ids: f.branch_ids.filter((x) => x !== id),
        group_ids: f.group_ids.filter((g) => !dropped.has(g)),
      };
    });
  }

  function toggleGroup(id) {
    setForm((f) => ({
      ...f,
      group_ids: f.group_ids.includes(id) ? f.group_ids.filter((x) => x !== id) : [...f.group_ids, id],
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
        // Those of a فرقة this account cannot see are not sent: the server keeps them as they were
        group_ids: form.group_ids.filter((g) => shownGroupIds.has(g)).map(Number),
        // Read by the server only when the event has no فرقة to take it from
        section: formSection,
        ...(canFees ? { fee: form.fee === '' ? null : Number(form.fee) } : {}),
      };
      const saved = initial ? await api.put(`/events/${initial.id}`, body) : await api.post('/events', body);
      onSaved(saved);
    } catch (err) {
      setError(ERRORS[err.message] ? t(ERRORS[err.message]) : displayError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? `${t('common.edit')} — ${initial.title}` : t('event.new')}
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
            <Button type="submit" form="event-form" loading={saving} disabled={!!loadFailed || loadingLists}>
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
        // Rows as in the séance's edit dialog: what, when and where, who leads it and
        // what it costs — then who may take part, then the plan
        <form id="event-form" onSubmit={save} className="space-y-5">
          {/* Both أقسام on screen: settled first, it decides which فرق and قادة follow */}
          {!initial && !onScreen && <SectionField value={formSection} onChange={pickSection} />}

          {/* What */}
          <div className="space-y-4">
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
          </div>

          {/* When and where — the two days share a row even on a phone */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ev_start">{t('event.startDate')}</Label>
              <DatePicker id="ev_start" required clearable={false} value={form.start_date} onChange={pickStart} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev_end">{t('event.endDate')}</Label>
              <DatePicker id="ev_end" required clearable={false} value={form.end_date} onChange={set('end_date')} />
            </div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="ev_place">{t('session.place')}</Label>
              <Input id="ev_place" maxLength={200} autoComplete="off" value={form.place} onChange={set('place')} />
            </div>
          </div>

          {/* Who leads it, and what it costs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className={cn('space-y-1.5', canFees ? 'sm:col-span-2' : 'sm:col-span-3')}>
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
          </div>

          {/* Who may take part: the فرق, then the طلائع of those split into some */}
          {!branches.data && (
            <div className="space-y-1.5 border-t border-border pt-5" aria-busy="true">
              <Skeleton className="h-4 w-32" />
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-11 w-24 rounded-full sm:h-9" />
                ))}
              </div>
            </div>
          )}
          {sectionBranches.length > 0 && (
            <div className="space-y-4 border-t border-border pt-5">
              <div className="space-y-1.5">
                <Label>{t('event.branches')}</Label>
                <div className="flex flex-wrap gap-2" role="group" aria-label={t('event.branches')}>
                  {sectionBranches.map((b) => (
                    <ToggleChip key={b.id} on={form.branch_ids.includes(b.id)} onClick={() => toggleBranch(b.id)}>
                      {branchName(b, i18n.language)}
                    </ToggleChip>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {form.branch_ids.length ? t('event.branchesHint') : t('event.wholeGroupHint')}
                </p>
              </div>

              {/* الطلائع: تظهر لكل فرقة مختارة قُسِّمت إليها. لا اختيار = الفرقة كاملةً. */}
              {groupedBranches.length > 0 && (
                <div className="space-y-1.5">
                  <Label>{t('event.groups')}</Label>
                  {/* Each فرقة's name over its طلائع on a phone; from sm up beside them, in
                      a column as wide as the longest name so the chips line up */}
                  <div
                    className={cn(
                      'space-y-3',
                      labelGroups && 'sm:grid sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-2 sm:space-y-0'
                    )}
                  >
                    {groupedBranches.map((b) => (
                      <div key={b.id} className="flex flex-col gap-1.5 sm:contents">
                        {labelGroups && (
                          <span className="text-xs text-muted-foreground sm:flex sm:min-h-9 sm:items-center">
                            {branchName(b, i18n.language)}
                          </span>
                        )}
                        <div
                          className="flex flex-wrap gap-2"
                          role="group"
                          aria-label={`${t('event.groups')} — ${branchName(b, i18n.language)}`}
                        >
                          {b.groups.map((g) => (
                            <ToggleChip key={g.id} on={form.group_ids.includes(g.id)} onClick={() => toggleGroup(g.id)}>
                              {g.name}
                              <span className="text-xs tabular-nums">{g.member_count}</span>
                            </ToggleChip>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('event.groupsHint')}</p>
                </div>
              )}
            </div>
          )}

          {/* Empty, the plan keeps the page's direction: «auto» on nothing reads as LTR
              and set the Arabic hint against the left edge */}
          <div className="space-y-1.5 border-t border-border pt-5">
            <Label htmlFor="ev_plan">{t('event.plan')}</Label>
            <Textarea
              id="ev_plan"
              dir={form.plan ? 'auto' : undefined}
              rows={4}
              maxLength={10000}
              placeholder={t('event.planHint')}
              value={form.plan}
              onChange={set('plan')}
            />
          </div>
        </form>
      )}
    </Dialog>
  );
}
