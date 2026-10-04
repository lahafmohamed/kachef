import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useFetch } from '../hooks';
import { ACTIVITY_TYPES, branchName, memberName } from '../utils';
import DatePicker from './DatePicker';
import SearchSelect from './SearchSelect';
import TimePicker from './TimePicker';
import {
  Badge,
  Button,
  cn,
  Dialog,
  Input,
  Label,
  RequirementGrid,
  Select,
  IconChevronDown,
  IconLock,
} from './ui';

const KIND_LABEL = { visit: 'session.kindVisit', leaders: 'session.kindLeaders', group: 'session.kindGroup' };

// The form as the session stands, so a reopened dialog starts from what is saved
const formOf = (s) => ({
  title: s.title || '',
  date: s.date,
  start_time: s.start_time || '',
  place: s.place || '',
  activity_type: s.activity_type || '',
  fee: s.fee === null || s.fee === undefined ? '' : String(s.fee),
  leader_id: s.leader_id ? String(s.leader_id) : '',
  matalib: [...(s.matalib || [])].sort((a, b) => a - b),
  leaders_count: s.leaders_count === null || s.leaders_count === undefined ? '' : String(s.leaders_count),
});

/**
 * تعديل نشاط بعد إنشائه: تفاصيله وحدها — ماذا (العنوان، النوع)، متى و أين، من يقوده و
 * بكم، و المطالب. فرقه و طلائعه و نوعه تُعرض ثابتة في أعلاه: منها بُنيت لائحة الحضور،
 * و الخادم يرفض تغييرها.
 */
export default function SessionEditDialog({ session, branches, open, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const { has } = usePerms();
  const canFees = has('sessions.read.fees');
  const leaders = useFetch('/leader-options', { skip: !open });
  const [form, setForm] = useState(null);
  const [initial, setInitial] = useState(null);
  // The 100-odd مطالب stay folded behind their summary until asked for
  const [showMatalib, setShowMatalib] = useState(false);
  const gridRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    if (!open) return;
    setError(null);
    setShowMatalib(false);
    const f = formOf(session);
    setForm(f);
    setInitial(f);
  }, [open, session]);

  // Opened, the section comes to the top — its label and «إخفاء» with the first rows of
  // the grid — since on a short screen the grid would open below the fold
  useEffect(() => {
    if (!showMatalib || !gridRef.current) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    gridRef.current.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [showMatalib]);

  if (!form) return <Dialog open={false} onClose={onClose} title="" />;

  const kind = session.kind || 'activity';
  const isVisit = kind === 'visit';
  const isGroup = kind === 'group';
  const isLeadersOnly = kind === 'leaders';
  const showFee = canFees && !isVisit && !isGroup;
  // المطالب على قدر أصغر فرق النشاط: مطلب يتعدّاه لا يُقبل في نشاط مشترك
  const totals = (session.branch_ids || [])
    .map((id) => branches.find((b) => b.id === id)?.total_requirements)
    .filter((n) => n > 0);
  const total = totals.length ? Math.min(...totals) : 0;
  const leaderOptions = (leaders.data || [])
    .filter((l) => l.section === session.section && (l.status === 'active' || l.id === session.leader_id))
    .map((l) => ({ value: l.id, label: memberName(l) }));
  const leaderLabel = t(isVisit || isLeadersOnly ? 'session.visitMainLeader' : 'session.leader');
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  // What the نشاط is built on, named — not just «stays the same»
  const scope = [
    ...(KIND_LABEL[kind] ? [t(KIND_LABEL[kind])] : []),
    ...(session.branch_ids || []).map((id) => branchName(branches.find((b) => b.id === id) || {}, i18n.language)).filter(Boolean),
    ...(session.groups || []).map((g) => g.name),
  ];

  async function save(e) {
    e.preventDefault();
    setError(null);
    if (isGroup && !form.activity_type) return setError(t('common.fillRequired'));
    setSaving(true);
    try {
      const body = {
        title: form.title,
        date: form.date,
        start_time: form.start_time || null,
        place: form.place || null,
        activity_type: form.activity_type || null,
        leader_id: form.leader_id === '' ? null : Number(form.leader_id),
        ...(kind === 'activity' ? { matalib: form.matalib.filter((n) => n <= total) } : {}),
        ...(isGroup ? { leaders_count: form.leaders_count === '' ? null : Number(form.leaders_count) } : {}),
        ...(showFee ? { fee: form.fee === '' ? null : Number(form.fee) } : {}),
      };
      onSaved(await api.put(`/sessions/${session.id}`, body));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const toggleMatlab = (n) =>
    setForm((f) => ({
      ...f,
      matalib: f.matalib.includes(n) ? f.matalib.filter((x) => x !== n) : [...f.matalib, n].sort((a, b) => a - b),
    }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('session.editTitle')}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {/* Nothing to save until something changed: the button says so by itself */}
          <Button type="submit" form="session-edit-form" loading={saving} disabled={!dirty}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <form id="session-edit-form" onSubmit={save} className="space-y-5">
        {scope.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg bg-muted/50 px-3 py-2">
            <IconLock className="h-3.5 w-3.5 text-muted-foreground" />
            {scope.map((x) => (
              <Badge key={x} variant="outline" className="bg-card">
                {x}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground">{t('session.editHint')}</span>
          </div>
        )}

        {/* What */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className={cn('space-y-1.5', isVisit ? 'sm:col-span-3' : 'sm:col-span-2')}>
            <Label htmlFor="se_title">{t(isGroup ? 'session.occasion' : 'session.sessionTitle')}</Label>
            <Input id="se_title" required maxLength={200} autoComplete="off" value={form.title} onChange={set('title')} />
          </div>
          {!isVisit && (
            <div className="space-y-1.5">
              <Label htmlFor="se_nature">{t('session.nature')}</Label>
              <Select id="se_nature" required={isGroup} value={form.activity_type} onChange={set('activity_type')}>
                <option value="">—</option>
                {ACTIVITY_TYPES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {t(a.key)}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {/* When and where — date and time share a row even on a phone */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="se_date">{t('common.date')}</Label>
            <DatePicker id="se_date" required clearable={false} value={form.date} onChange={set('date')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="se_time">{t('session.time')}</Label>
            <TimePicker id="se_time" value={form.start_time} onChange={set('start_time')} />
          </div>
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="se_place">{t('session.place')}</Label>
            <Input id="se_place" maxLength={200} autoComplete="off" value={form.place} onChange={set('place')} />
          </div>
        </div>

        {/* Who leads it, and what it costs */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className={cn('space-y-1.5', showFee || isGroup ? 'sm:col-span-2' : 'sm:col-span-3')}>
            <Label htmlFor="se_leader">{leaderLabel}</Label>
            <SearchSelect
              id="se_leader"
              value={form.leader_id}
              onChange={set('leader_id')}
              options={leaderOptions}
              placeholder={t('leader.selectLeader')}
              searchPlaceholder={t('session.searchLeader')}
              emptyLabel={t('member.noListValue')}
              ariaLabel={leaderLabel}
            />
          </div>
          {showFee && (
            <div className="space-y-1.5">
              <Label htmlFor="se_fee">{t('session.fee')}</Label>
              <Input
                id="se_fee"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="—"
                className="tabular-nums"
                value={form.fee}
                onChange={set('fee')}
              />
            </div>
          )}
          {isGroup && (
            <div className="space-y-1.5">
              <Label htmlFor="se_leaders_count">{t('session.leadersCount')}</Label>
              <Input
                id="se_leaders_count"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                className="tabular-nums"
                value={form.leaders_count}
                onChange={set('leaders_count')}
              />
            </div>
          )}
        </div>

        {/* المطالب: the picked numbers in a line; the full grid opens in place, in the
            dialog's own scroll — never a scroll box inside the scrolling dialog */}
        {kind === 'activity' && total > 0 && (
          <div ref={gridRef} className="space-y-3 border-t border-border pt-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <Label>{t('session.requirements')}</Label>
                {form.matalib.length ? (
                  <div className="flex flex-wrap gap-1">
                    {form.matalib.map((n) => (
                      <span
                        key={n}
                        className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-primary/10 px-1.5 text-xs font-semibold tabular-nums text-primary"
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('session.noMatalibPicked')}</p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                aria-expanded={showMatalib}
                aria-controls="se_matalib"
                onClick={() => setShowMatalib((v) => !v)}
                className="shrink-0"
              >
                {t(showMatalib ? 'session.matalibDone' : 'session.matalibPick')}
                <IconChevronDown className={cn('transition-transform', showMatalib && 'rotate-180')} />
              </Button>
            </div>
            {showMatalib && (
              <div id="se_matalib">
                <RequirementGrid
                  total={total}
                  selected={form.matalib}
                  onToggle={toggleMatlab}
                  label={t('session.requirements')}
                />
              </div>
            )}
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
