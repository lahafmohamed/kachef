import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useFetch } from '../hooks';
import { useSection } from '../section';
import { branchName, memberName, todayISO } from '../utils';
import { MEETING_KINDS, gendered } from '../lib/meetings';
import Combobox from './Combobox';
import DatePicker from './DatePicker';
import SectionField from './SectionField';
import TimePicker from './TimePicker';
import { Button, Dialog, ErrorState, Input, Label, SegmentedControl, Select, Textarea } from './ui';

const nobody = { id: null, name: '' };

const emptyMeeting = (previous) => ({
  kind: 'leaders',
  title: '',
  purpose: '',
  date: todayISO(),
  start_time: '',
  end_time: '',
  place: previous?.place || '',
  branch_id: '',
  // '' = not picked yet: the قسم on screen, else the last meeting's, else الفتيان. Its
  // فرقة wins once picked.
  section: previous?.section || '',
  // The same people usually chair and write it up: the last meeting's, to change if not
  chair: previous ? { id: previous.chair_id, name: previous.chair || '' } : nobody,
  secretary: previous ? { id: previous.secretary_id, name: previous.secretary || '' } : nobody,
  agenda: '',
  notes: '',
  next_date: '',
});

const fromMeeting = (m) => ({
  kind: m.kind,
  title: m.title,
  purpose: m.purpose || '',
  date: m.date,
  start_time: m.start_time || '',
  end_time: m.end_time || '',
  place: m.place || '',
  branch_id: m.branch_id ? String(m.branch_id) : '',
  section: m.section,
  chair: { id: m.chair_id, name: m.chair || '' },
  secretary: { id: m.secretary_id, name: m.secretary || '' },
  agenda: '',
  notes: m.notes || '',
  next_date: m.next_date || '',
});

/**
 * A person of the minutes — who chaired, who wrote it, who carries a decision out: a
 * قائد picked from the suggestions, or a name typed for someone from outside the فوج.
 * A typed name that is exactly a قائد's counts as him (personBody).
 */
export function PersonField({ id, value, onChange, leaders, placeholder }) {
  const { t } = useTranslation();
  const options = leaders.map((l) => ({ value: memberName(l), label: memberName(l), id: l.id }));
  const outside = !value.id && value.name.trim() && !options.some((o) => o.label === value.name.trim());
  return (
    <div className="space-y-1">
      <Combobox
        id={id}
        value={value.name}
        placeholder={placeholder}
        onChange={(e) => onChange({ id: null, name: e.target.value })}
        onPick={(o) => onChange({ id: o.id, name: o.label })}
        options={options}
      />
      {outside && <p className="text-xs text-muted-foreground">{t('meeting.outsidePerson')}</p>}
    </div>
  );
}

/** { <key>_id, <key>_name } for the server: a قائد by id, else the name as typed */
export function personBody(key, p, leaders) {
  const name = p.name.trim();
  const id = p.id ?? leaders.find((l) => memberName(l) === name)?.id ?? null;
  return id ? { [`${key}_id`]: id, [`${key}_name`]: null } : { [`${key}_id`]: null, [`${key}_name`]: name || null };
}

// The server's refusals the قائد can act on, in words
export const ERRORS = {
  mixed_sections: 'section.mixed',
  invalid_times: 'meeting.errTimes',
  forbidden: 'event.errForbiddenBranch',
  'invalid leader_id': 'meeting.errLeader',
};

/**
 * Opening a meeting's minutes (initial = null) or correcting their heading: what kind
 * of meeting, its subject and why, when and where, for the whole فوج or one فرقة, who
 * chaired it and who wrote it up. A new one may list its agenda, a point per line; the
 * notes and the next meeting's date come at the end, from the edit. The قسم is settled
 * at creation — the attendance is made of its قادة — so an edit never moves it.
 */
export default function MeetingFormDialog({ open, initial, previous = null, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const { section: onScreen } = useSection();
  const branches = useFetch('/branches', { skip: !open });
  const leaders = useFetch('/leader-options', { skip: !open });
  const [form, setForm] = useState(() => emptyMeeting(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Every opening starts from the saved meeting, or from a blank one dated today
  useEffect(() => {
    if (!open) return;
    setForm(initial ? fromMeeting(initial) : emptyMeeting(previous));
    setError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchList = branches.data || [];
  const branchSection = branchList.find((b) => String(b.id) === form.branch_id)?.section;
  const formSection = initial?.section || onScreen || branchSection || form.section || 'M';
  const sectionBranches = branchList.filter((b) => b.section === formSection);
  const keep = [form.chair.id, form.secretary.id];
  const leaderList = (leaders.data || []).filter(
    (l) => l.section === formSection && (l.status === 'active' || keep.includes(l.id))
  );
  const loadFailed = branches.error || leaders.error;

  // The last meeting's chair or secretary may have been archived since: not offered again
  useEffect(() => {
    if (!open || initial || !leaders.data) return;
    const gone = (p) => p.id && !leaders.data.some((l) => l.id === p.id && l.status === 'active');
    setForm((f) =>
      gone(f.chair) || gone(f.secretary)
        ? { ...f, chair: gone(f.chair) ? nobody : f.chair, secretary: gone(f.secretary) ? nobody : f.secretary }
        : f
    );
  }, [open, initial, leaders.data]);

  // Another قسم: its own فرق and قادة, so whatever was picked from the old one goes
  function pickSection(s) {
    if (s === formSection) return;
    setForm((f) => ({ ...f, section: s, branch_id: '', chair: nobody, secretary: nobody }));
  }

  async function save(e) {
    e.preventDefault();
    setError(null);
    if (form.start_time && form.end_time && form.end_time < form.start_time) {
      setError(t('meeting.errTimes'));
      return;
    }
    setSaving(true);
    try {
      const body = {
        kind: form.kind,
        title: form.title,
        purpose: form.purpose || null,
        date: form.date,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        place: form.place || null,
        branch_id: form.branch_id ? Number(form.branch_id) : null,
        // Read by the server only when the meeting has no فرقة to take it from
        section: formSection,
        ...personBody('chair', form.chair, leaderList),
        ...personBody('secretary', form.secretary, leaderList),
        ...(initial
          ? { notes: form.notes || null, next_date: form.next_date || null }
          : { agenda: form.agenda.split('\n').map((l) => l.trim()).filter(Boolean) }),
      };
      const saved = initial ? await api.put(`/meetings/${initial.id}`, body) : await api.post('/meetings', body);
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
      title={initial ? t('meeting.editTitle') : t('meeting.new')}
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
            <Button type="submit" form="meeting-form" loading={saving} disabled={!!loadFailed}>
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
        <form id="meeting-form" onSubmit={save} className="space-y-4">
          {/* Both أقسام on screen: settled first, it decides which فرق and قادة follow */}
          {!initial && !onScreen && <SectionField value={formSection} onChange={pickSection} />}

          <div className="space-y-1.5">
            <Label>{t('meeting.kind')}</Label>
            <SegmentedControl
              label={t('meeting.kind')}
              value={form.kind}
              onChange={(v) => setForm((f) => ({ ...f, kind: v }))}
              options={MEETING_KINDS.map((k) => ({ value: k, label: t(`meeting.kind_${k}`) }))}
              columns={3}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mt_title">{t('meeting.subject')}</Label>
            <Input
              id="mt_title"
              required
              maxLength={200}
              autoComplete="off"
              placeholder={t(`meeting.subjectPlaceholder_${form.kind}`)}
              value={form.title}
              onChange={set('title')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mt_purpose">{t('meeting.purpose')}</Label>
            <Textarea
              id="mt_purpose"
              dir="auto"
              rows={2}
              maxLength={2000}
              placeholder={t('meeting.purposeHint')}
              value={form.purpose}
              onChange={set('purpose')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="mt_date">{t('common.date')}</Label>
              <DatePicker id="mt_date" required clearable={false} value={form.date} onChange={set('date')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt_start">{t('meeting.startTime')}</Label>
              <TimePicker id="mt_start" value={form.start_time} onChange={set('start_time')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt_end">{t('meeting.endTime')}</Label>
              <TimePicker id="mt_end" value={form.end_time} onChange={set('end_time')} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mt_place">{t('session.place')}</Label>
              <Input id="mt_place" maxLength={200} autoComplete="off" value={form.place} onChange={set('place')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt_branch">{t('meeting.scope')}</Label>
              <Select id="mt_branch" value={form.branch_id} onChange={set('branch_id')}>
                <option value="">{t('meeting.wholeGroup')}</option>
                {sectionBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {branchName(b, i18n.language)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt_chair">{gendered(t, 'meeting.chair', formSection)}</Label>
              <PersonField
                id="mt_chair"
                value={form.chair}
                onChange={(p) => setForm((f) => ({ ...f, chair: p }))}
                leaders={leaderList}
                placeholder={t('meeting.personPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt_secretary">{gendered(t, 'meeting.secretary', formSection)}</Label>
              <PersonField
                id="mt_secretary"
                value={form.secretary}
                onChange={(p) => setForm((f) => ({ ...f, secretary: p }))}
                leaders={leaderList}
                placeholder={t('meeting.personPlaceholder')}
              />
            </div>
          </div>

          {initial ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mt_notes">{t('meeting.notes')}</Label>
                <Textarea
                  id="mt_notes"
                  dir="auto"
                  rows={3}
                  maxLength={10000}
                  value={form.notes}
                  onChange={set('notes')}
                />
              </div>
              <div className="space-y-1.5 sm:max-w-[50%] sm:pe-2">
                <Label htmlFor="mt_next">{t('meeting.nextDate')}</Label>
                <DatePicker id="mt_next" value={form.next_date} onChange={set('next_date')} />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="mt_agenda">{t('meeting.agenda')}</Label>
              <Textarea
                id="mt_agenda"
                dir="auto"
                rows={4}
                placeholder={t('meeting.agendaPlaceholder')}
                value={form.agenda}
                onChange={set('agenda')}
              />
              <p className="text-xs text-muted-foreground">{t('meeting.agendaHint')}</p>
            </div>
          )}
        </form>
      )}
    </Dialog>
  );
}
