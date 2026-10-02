import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';
import { branchName, fmtDate, memberName, todayISO } from '../utils';
import DatePicker from './DatePicker';
import SearchSelect from './SearchSelect';
import TimePicker from './TimePicker';
import { Button, Input, Label, RequirementGrid, Select, Textarea } from './ui';

/**
 * نموذج بطاقة التحضير — يخدم الإنشاء و التعديل معًا: initial فارغ يعني بطاقة
 * جديدة (POST)، و بطاقة قائمة تعني تعديلًا (PUT على رقمها). الحقول النصية الطويلة
 * (الأهداف، الفقرات و الطرق التدريبية، الوسائل، الملاحظات) نص حر متعدد الأسطر.
 */
const EMPTY = {
  branch_id: '',
  leader_id: '',
  session_id: '',
  title: '',
  date: todayISO(),
  start_time: '',
  place: '',
  matalib: [],
  goals: '',
  segments: '',
  tools: '',
  notes: '',
};

const fromCard = (c) => ({
  branch_id: String(c.branch_id),
  leader_id: c.leader_id ? String(c.leader_id) : '',
  session_id: c.session_id ? String(c.session_id) : '',
  title: c.title,
  date: c.date,
  start_time: c.start_time || '',
  place: c.place || '',
  matalib: c.matalib || [],
  goals: c.goals || '',
  segments: c.segments || '',
  tools: c.tools || '',
  notes: c.notes || '',
});

export default function PrepCardForm({ initial, branches, leaders, onSaved, onCancel }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [form, setForm] = useState(() => (initial ? fromCard(initial) : EMPTY));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const branchList = branches || [];
  const leaderList = leaders || [];
  const selectedBranch = branchList.find((b) => b.id === Number(form.branch_id));

  // أنشطة الفرقة المختارة — للربط الاختياري بالنشاط الذي حُضِّرت له البطاقة.
  // تُحمَّل عند اختيار الفرقة فقط: القائمة الكاملة طويلة بلا داعٍ.
  const sessions = useFetch(form.branch_id ? `/sessions?branch=${form.branch_id}` : null, {
    skip: !form.branch_id,
  });
  const sessionOptions = (sessions.data || []).map((s) => ({
    value: s.id,
    label: `${s.title} — ${fmtDate(s.date)}`,
  }));
  // بطاقة قديمة مربوطة بنشاط خارج قائمة الفرقة الحالية: يبقى خيارها ظاهرًا بدل أن يضيع
  if (
    initial?.session_id &&
    String(form.session_id) === String(initial.session_id) &&
    !sessionOptions.some((o) => String(o.value) === String(initial.session_id))
  )
    sessionOptions.unshift({
      value: initial.session_id,
      label: `${initial.session_title || ''} — ${fmtDate(initial.session_date)}`,
    });

  // بطاقة جديدة: الفرقة الأولى مسبقًا، و القائد صاحب الحساب إن وُجد و إلا قائد الفرقة
  useEffect(() => {
    if (initial || !branchList.length || form.branch_id) return;
    const b = branchList[0];
    setForm((f) => ({
      ...f,
      branch_id: String(b.id),
      leader_id: String(user?.leader_id || b.leader_id || ''),
    }));
  }, [initial, branchList, form.branch_id, user]);

  // تغيير الفرقة يُسقط المطالب و النشاط المربوط: كلاهما يخصّ فرقة بعينها. و فرقة
  // من القسم الآخر تُسقط القائد أيضًا: من يعدّ البطاقة من قسم فرقتها
  function pickBranch(id) {
    const next = branchList.find((b) => b.id === Number(id))?.section;
    setForm((f) => {
      const keepLeader = leaderList.find((l) => l.id === Number(f.leader_id))?.section === next;
      return { ...f, branch_id: id, matalib: [], session_id: '', leader_id: keepLeader ? f.leader_id : '' };
    });
  }

  function toggleMatlab(n) {
    setForm((f) => ({
      ...f,
      matalib: f.matalib.includes(n) ? f.matalib.filter((x) => x !== n) : [...f.matalib, n],
    }));
  }

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        ...form,
        branch_id: Number(form.branch_id),
        leader_id: form.leader_id === '' ? null : Number(form.leader_id),
        session_id: form.session_id === '' ? null : Number(form.session_id),
        start_time: form.start_time || null,
        place: form.place || null,
        goals: form.goals || null,
        segments: form.segments || null,
        tools: form.tools || null,
        notes: form.notes || null,
      };
      const card = initial
        ? await api.put(`/prep-cards/${initial.id}`, body)
        : await api.post('/prep-cards', body);
      onSaved(card);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pc_title">{t('session.sessionTitle')}</Label>
        <Input
          id="pc_title"
          required
          autoComplete="off"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pc_date">{t('common.date')}</Label>
          <DatePicker
            id="pc_date"
            required
            clearable={false}
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc_time">{t('session.time')}</Label>
          <TimePicker
            id="pc_time"
            value={form.start_time}
            onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc_place">{t('session.place')}</Label>
          <Input
            id="pc_place"
            autoComplete="off"
            value={form.place}
            onChange={(e) => setForm((f) => ({ ...f, place: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc_branch">{t('member.branch')}</Label>
          <Select id="pc_branch" required value={form.branch_id} onChange={(e) => pickBranch(e.target.value)}>
            {branchList.map((b) => (
              <option key={b.id} value={b.id}>
                {branchName(b, i18n.language)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pc_leader">{t('prep.author')}</Label>
          <Select
            id="pc_leader"
            required
            value={form.leader_id}
            onChange={(e) => setForm((f) => ({ ...f, leader_id: e.target.value }))}
          >
            <option value="" disabled>
              {t('leader.selectLeader')}
            </option>
            {leaderList
              .filter(
                (l) =>
                  (l.status === 'active' && (!selectedBranch || l.section === selectedBranch.section)) ||
                  l.id === Number(form.leader_id)
              )
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {memberName(l)}
                </option>
              ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pc_session">{t('prep.session')}</Label>
          {/* اختياري: البطاقة تُكتب قبل السبت و النشاط يُنشأ بعده غالبًا، فتُربط لاحقًا */}
          <SearchSelect
            id="pc_session"
            value={form.session_id}
            onChange={(e) => setForm((f) => ({ ...f, session_id: e.target.value }))}
            options={sessionOptions}
            clearLabel={t('prep.noSession')}
            placeholder={t('prep.noSession')}
            searchPlaceholder={t('session.searchPlaceholder')}
            emptyLabel={t('common.noResults')}
            ariaLabel={t('prep.session')}
          />
          <p className="text-xs text-muted-foreground">{t('prep.sessionHint')}</p>
        </div>
      </div>

      {selectedBranch?.total_requirements > 0 && (
        <div className="space-y-1.5">
          <Label>
            {t('prep.matalib')}
            <span className="ms-2 font-normal text-muted-foreground">
              {t('session.selectedCount', { count: form.matalib.length })}
            </span>
          </Label>
          <div className="max-h-56 overflow-y-auto rounded-md border border-border p-2">
            <RequirementGrid
              total={selectedBranch.total_requirements}
              selected={form.matalib}
              onToggle={toggleMatlab}
              label={t('prep.matalib')}
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="pc_goals">{t('prep.goals')}</Label>
        <Textarea
          id="pc_goals"
          rows={3}
          value={form.goals}
          onChange={(e) => setForm((f) => ({ ...f, goals: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pc_segments">{t('prep.segments')}</Label>
        <Textarea
          id="pc_segments"
          rows={6}
          placeholder={t('prep.segmentsHint')}
          value={form.segments}
          onChange={(e) => setForm((f) => ({ ...f, segments: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pc_tools">{t('prep.tools')}</Label>
        <Textarea
          id="pc_tools"
          rows={2}
          value={form.tools}
          onChange={(e) => setForm((f) => ({ ...f, tools: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pc_notes">{t('prep.notes')}</Label>
        <Textarea
          id="pc_notes"
          rows={2}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={saving}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
