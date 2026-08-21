import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch, useLocalStorage } from '../hooks';
import { avatarName, branchName, fileToDataUrl, memberName } from '../utils';
import Combobox from '../components/Combobox';
import DatePicker from '../components/DatePicker';
import SearchSelect from '../components/SearchSelect';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  cn,
  useConfirm,
  useToast,
  IconCheck,
  IconKey,
  IconLock,
  IconPencil,
  IconPlus,
  IconShield,
  IconTrash,
  IconUsers,
  IconX,
} from '../components/ui';

const EMPTY_LEADER = {
  first_name: '',
  father_name: '',
  last_name: '',
  birth_date: '',
  phone: '',
  address_abidjan: '',
  address_lebanon: '',
  marital_status: '',
  join_year: '',
  years_ghadir: '',
  years_total: '',
  education: '',
  training_level: [],
  photo: null,
  status: 'active',
};
const EMPTY_ASSIGNMENT = { leader_id: '', title: '', branch_id: '', group_id: '', parent_id: '', sort_order: 0 };

function FormActions({ onCancel, saving }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
      <Button variant="outline" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" loading={saving}>
        {t('common.save')}
      </Button>
    </div>
  );
}

// الدورات التدريبية، بترتيب تدرّجها — مطابقة لـ TRAINING_COURSES في الخادم
const TRAINING_COURSES = ['qaid', 'chara', 'mudarrib', 'qaid_tadrib', 'moed_haqiba'];

function LeaderForm({ initial, lookups, onCreateLookup, onSaved, onCancel }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function toggleCourse(c) {
    setForm((f) => {
      const have = f.training_level || [];
      return { ...f, training_level: have.includes(c) ? have.filter((x) => x !== c) : [...have, c] };
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (initial.id) await api.put(`/leaders/${initial.id}`, form);
      else await api.post('/leaders', form);
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="l_first">{t('member.firstName')}</Label>
          <Input id="l_first" required autoComplete="off" value={form.first_name} onChange={set('first_name')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="l_father">{t('member.fatherName')}</Label>
          <Input id="l_father" autoComplete="off" value={form.father_name || ''} onChange={set('father_name')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="l_last">{t('member.lastName')}</Label>
          <Input id="l_last" required autoComplete="off" value={form.last_name} onChange={set('last_name')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="l_birth">{t('member.birthDate')}</Label>
          <DatePicker
            id="l_birth"
            toYear={new Date().getFullYear()}
            value={form.birth_date || ''}
            onChange={set('birth_date')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="l_phone">{t('leader.phone')}</Label>
          <Input id="l_phone" type="tel" inputMode="tel" dir="ltr" value={form.phone || ''} onChange={set('phone')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="l_marital">{t('leader.maritalStatus')}</Label>
          <Select id="l_marital" value={form.marital_status || ''} onChange={set('marital_status')}>
            <option value="">{t('member.noValue')}</option>
            <option value="single">{t('leader.single')}</option>
            <option value="married">{t('leader.married')}</option>
          </Select>
        </div>
      </div>

      {/* نفس القوائم المنسَّقة التي يُسجَّل بها العناصر: حيّ واحد يُكتب بطريقتين
          يفرّق أهله على فلترين */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="l_abidjan">{t('member.addressAbidjan')}</Label>
          <SearchSelect
            id="l_abidjan"
            value={form.address_abidjan || ''}
            onChange={set('address_abidjan')}
            options={lookups.residence_abidjan}
            placeholder={t('member.pickValue')}
            searchPlaceholder={t('member.searchOrAdd')}
            emptyLabel={t('member.noListValue')}
            clearLabel={t('member.noValue')}
            onCreate={(label) => onCreateLookup('residence_abidjan', label)}
            createLabel={(v) => t('member.addListValue', { value: v })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="l_lebanon">{t('member.addressLebanon')}</Label>
          <SearchSelect
            id="l_lebanon"
            value={form.address_lebanon || ''}
            onChange={set('address_lebanon')}
            options={lookups.residence_lebanon}
            placeholder={t('member.pickValue')}
            searchPlaceholder={t('member.searchOrAdd')}
            emptyLabel={t('member.noListValue')}
            clearLabel={t('member.noValue')}
            onCreate={(label) => onCreateLookup('residence_lebanon', label)}
            createLabel={(v) => t('member.addListValue', { value: v })}
          />
        </div>
      </div>

      {/* التوصيف الحالي ليس حقلًا يُكتب: التشكيلة تحمله سنةً سنة، و نسخه هنا يجعل
          الملفّ يناقضها أول ما تتغيّر. يُعرض هنا للقراءة فقط. */}
      <div className="space-y-1.5">
        <Label>{t('leader.currentRole')}</Label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
          {initial.roles?.length ? (
            initial.roles.map((r, i) => (
              <Badge key={i} variant={r.role_type === 'branch' ? 'default' : 'warning'}>
                {r.title}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">{t('leader.noRole')}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('leader.currentRoleHint')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="l_join_year">{t('leader.joinYear')}</Label>
          <Input
            id="l_join_year"
            inputMode="numeric"
            dir="ltr"
            maxLength={4}
            placeholder="2015"
            value={form.join_year || ''}
            onChange={set('join_year')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="l_years_ghadir">{t('leader.yearsGhadir')}</Label>
          <Input
            id="l_years_ghadir"
            type="number"
            inputMode="numeric"
            min="0"
            max="99"
            dir="ltr"
            value={form.years_ghadir ?? ''}
            onChange={set('years_ghadir')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="l_years_total">{t('leader.yearsTotal')}</Label>
          <Input
            id="l_years_total"
            type="number"
            inputMode="numeric"
            min="0"
            max="99"
            dir="ltr"
            value={form.years_total ?? ''}
            onChange={set('years_total')}
          />
          <p className="text-xs text-muted-foreground">{t('leader.yearsTotalHint')}</p>
        </div>
      </div>

      {/* الدورات التدريبية: قائد قد يكون خضع لأكثر من دورة، فهي تأشير لا اختيار واحد */}
      <div className="space-y-1.5">
        <Label className="block">{t('leader.trainingLevel')}</Label>
        <div className="grid gap-1 rounded-lg border border-border p-2 sm:grid-cols-2">
          {TRAINING_COURSES.map((c) => (
            <label
              key={c}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm hover:bg-accent/60 sm:min-h-9"
            >
              <input
                type="checkbox"
                checked={(form.training_level || []).includes(c)}
                onChange={() => toggleCourse(c)}
              />
              {t(`leader.course_${c}`)}
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="l_education">{t('leader.education')}</Label>
        <Input
          id="l_education"
          autoComplete="off"
          placeholder={t('leader.educationHint')}
          value={form.education || ''}
          onChange={set('education')}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="l_photo">{t('member.photo')}</Label>
        <div className="flex flex-wrap items-center gap-3">
          {form.photo && <Avatar photo={form.photo} name={form.first_name} className="h-14 w-14" />}
          <Input
            id="l_photo"
            type="file"
            accept="image/*"
            capture="environment"
            className="flex-1 py-2 file:me-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-secondary-foreground"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const photo = await fileToDataUrl(file);
              setForm((f) => ({ ...f, photo }));
            }}
          />
          {form.photo && (
            <Button variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, photo: null }))}>
              {t('member.removePhoto')}
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="l_status">{t('member.status')}</Label>
        <Select id="l_status" value={form.status} onChange={set('status')}>
          <option value="active">{t('member.active')}</option>
          <option value="inactive">{t('member.inactive')}</option>
        </Select>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <FormActions onCancel={onCancel} saving={saving} />
    </form>
  );
}

function AssignmentForm({ initial, year, leaders, branches, template, amanaRoots = [], onSaved, onCancel }) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState(initial);
  // مجموعات الفرقة المختارة — /branches يرسلها مع كل فرقة
  const formGroups = branches.find((b) => String(b.id) === String(form.branch_id))?.groups || [];
  // الأمانات الجذور التي يمكن أن يتبعها هذا التوصيف — لا نفسه، و لا تابعٌ لغيره
  const parentOptions = amanaRoots.filter((a) => a.id !== initial.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const body = {
      year,
      // Empty means the توصيف stays in the تشكيلة as a slot waiting for a قائد
      leader_id: form.leader_id === '' ? null : Number(form.leader_id),
      title: form.title,
      branch_id: form.branch_id === '' ? null : Number(form.branch_id),
      group_id: form.group_id === '' || form.group_id == null ? null : Number(form.group_id),
      parent_id: form.parent_id === '' || form.parent_id == null ? null : Number(form.parent_id),
      sort_order: Number(form.sort_order) || 0,
    };
    try {
      if (initial.id) await api.put(`/tachkila/${initial.id}`, body);
      else await api.post('/tachkila', body);
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="a_leader">{t('leader.selectLeader')}</Label>
        <Select
          id="a_leader"
          value={form.leader_id ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, leader_id: e.target.value }))}
        >
          <option value="">{t('leader.unassigned')}</option>
          {leaders.map((l) => (
            <option key={l.id} value={l.id}>
              {memberName(l)}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a_title">{t('leader.assignmentTitle')}</Label>
        <Combobox
          id="a_title"
          required
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          options={[
            ...template,
            ...branches.map((b) => `${t('leader.branchLeader')} ${branchName(b, i18n.language)}`),
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a_branch">{t('leader.linkedBranch')}</Label>
        <Select
          id="a_branch"
          value={form.branch_id ?? ''}
          onChange={(e) =>
            // المجموعة تخصّ فرقتها و التبعية تخصّ الأمانات: تغيير الفرقة يُسقط الاثنين
            setForm((f) => ({ ...f, branch_id: e.target.value, group_id: '', parent_id: e.target.value ? '' : f.parent_id }))
          }
        >
          <option value="">{t('leader.noBranch')}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {branchName(b, i18n.language)}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{t('leader.amanaHint')}</p>
      </div>
      {/* الأمانة فريق: الأمين و معه قادة يساعدونه. توصيفُ مساعدةٍ «يتبع» أمانته
          فيتعلّق تحتها في الهيكلية. للأمانات وحدها، و مستوى واحد فقط. */}
      {form.branch_id === '' && parentOptions.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="a_parent">{t('leader.linkedParent')}</Label>
          <Select
            id="a_parent"
            value={form.parent_id ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))}
          >
            <option value="">{t('leader.noParent')}</option>
            {parentOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">{t('leader.parentHint')}</p>
        </div>
      )}
      {/* المجموعة: تظهر للفرق المقسَّمة وحدها. توصيفٌ بلا مجموعة يخصّ الفرقة كلها،
          و توصيف المجموعة (قائد مجموعة بحارة) يُعلَّق تحتها في الهيكلية. */}
      {formGroups.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="a_group">{t('leader.linkedGroup')}</Label>
          <Select
            id="a_group"
            value={form.group_id ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, group_id: e.target.value }))}
          >
            <option value="">{t('leader.wholeBranch')}</option>
            {formGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">{t('leader.groupFunctionHint')}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <FormActions onCancel={onCancel} saving={saving} />
    </form>
  );
}

function NewYearForm({ currentYear, onSaved, onCancel }) {
  const { t } = useTranslation();
  const y = new Date().getFullYear();
  const [year, setYear] = useState(`${y}-${y + 1}`);
  // template = the whole organigram as empty slots, copy = same slots AND same قادة, empty = blank
  const [mode, setMode] = useState('template');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const modes = [
    { value: 'template', label: t('leader.modeTemplate') },
    ...(currentYear ? [{ value: 'copy', label: t('leader.modeCopy') }] : []),
    { value: 'empty', label: t('leader.modeEmpty') },
  ];

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post('/tachkila/copy', { to_year: year, mode, from_year: currentYear });
      onSaved(year);
    } catch (err) {
      setError(err.message === 'year_exists' ? t('leader.yearExists') : err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="y_year">{t('leader.newYearLabel')}</Label>
        <Input id="y_year" required dir="ltr" value={year} onChange={(e) => setYear(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label className="block">{t('leader.newYearContent')}</Label>
        <SegmentedControl
          className="w-full"
          options={modes}
          value={mode}
          onChange={setMode}
          label={t('leader.newYearContent')}
        />
        <p className="text-xs text-muted-foreground">{t(`leader.modeHint.${mode}`)}</p>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <FormActions onCancel={onCancel} saving={saving} />
    </form>
  );
}

/** مفاتيح القوالب — تطابق ACCOUNT_PRESETS في الخادم، و الشرح في ملفات الترجمة. */
const ACCOUNT_PRESET_KEYS = ['branch', 'amana', 'readonly', 'full'];

/**
 * إنشاء حساب دخول لقائد. مرحلتان: استمارة (اسم دخول، قالب صلاحيات، فرق مرئية)،
 * ثم شاشة كلمة السرّ — تُعرض مرّة واحدة، فالإغلاق بعدها لا رجعة فيه.
 */
function AccountDialog({ leader, branches, onClose, onCreated }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // كلمة السرّ بعد الإنشاء — وجودها يقلب الحوار إلى شاشة العرض الوحيد
  const [result, setResult] = useState(null);
  const [form, setForm] = useState(() => ({
    username: [leader.first_name, leader.last_name].filter(Boolean).join('.').replace(/\s+/g, ''),
    preset: 'branch',
    // فرق توصيفاته الحالية مؤشَّرة سلفًا؛ لا تأشير = كل الفرق
    branch_ids: [...new Set((leader.roles || []).filter((r) => r.branch_id).map((r) => r.branch_id))],
  }));

  function toggleBranch(id) {
    setForm((f) => ({
      ...f,
      branch_ids: f.branch_ids.includes(id)
        ? f.branch_ids.filter((x) => x !== id)
        : [...f.branch_ids, id],
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const r = await api.post(`/leaders/${leader.id}/account`, {
        username: form.username,
        preset: form.preset,
        branches: form.branch_ids.length ? form.branch_ids.map(Number) : null,
      });
      setResult(r);
      onCreated();
    } catch (err) {
      setError(
        err.message === 'username_taken'
          ? t('leader.accountTaken')
          : err.message === 'account_exists'
            ? t('leader.accountExists')
            : err.message
      );
    } finally {
      setSaving(false);
    }
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(`${result.user.username}\n${result.password}`);
      toast.success(t('leader.accountCopied'));
    } catch {
      toast.error(t('error.loadFailed'));
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('leader.accountCreate')}
      description={memberName(leader)}
      size="sm"
    >
      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('leader.accountPasswordOnce')}</p>
          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-4" dir="ltr">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground">{t('leader.accountUsername')}</span>
              <span className="font-medium">{result.user.username}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground">{t('leader.accountPassword')}</span>
              <span className="select-all font-mono text-lg font-semibold tracking-wide">
                {result.password}
              </span>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={copyAll}>
              {t('leader.accountCopy')}
            </Button>
            <Button variant="brand" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="acc_username">{t('leader.accountUsername')}</Label>
            <Input
              id="acc_username"
              required
              autoComplete="off"
              dir="ltr"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc_preset">{t('leader.accountPreset')}</Label>
            <Select
              id="acc_preset"
              value={form.preset}
              onChange={(e) => setForm((f) => ({ ...f, preset: e.target.value }))}
            >
              {ACCOUNT_PRESET_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`leader.preset_${k}`)}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{t(`leader.presetHint_${form.preset}`)}</p>
          </div>
          <div className="space-y-1.5">
            <Label className="block">{t('leader.accountBranches')}</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('leader.accountBranches')}>
              {branches.map((b) => {
                const on = form.branch_ids.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleBranch(b.id)}
                    className={cn(
                      'focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors sm:min-h-9',
                      on
                        ? 'border-primary bg-primary/10 font-medium text-primary'
                        : 'border-input bg-card text-muted-foreground hover:bg-accent'
                    )}
                  >
                    {on && <IconCheck className="h-3.5 w-3.5" />}
                    {branchName(b, i18n.language)}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t('leader.accountBranchesHint')}</p>
          </div>
          <p className="text-xs text-muted-foreground">{t('leader.accountHint')}</p>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <FormActions onCancel={onClose} saving={saving} />
        </form>
      )}
    </Dialog>
  );
}

/** بطاقة توصيف في الهيكلية: القائد إن عُيّن، و إطار متقطّع إن كان المركز شاغرًا. */
function OrgCard({ a, className }) {
  const filled = !!a.leader_id;
  const inner = (
    <>
      {filled ? (
        <Avatar photo={a.photo} name={avatarName(a)} className="h-9 w-9" />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"
        >
          <IconShield className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0">
        <span
          className={cn('block truncate text-sm font-medium', !filled && 'text-muted-foreground')}
          title={filled ? memberName(a) : '—'}
        >
          {filled ? memberName(a) : '—'}
        </span>
        <span className="block truncate text-xs text-muted-foreground" title={a.title}>{a.title}</span>
      </span>
    </>
  );
  const base = cn(
    'flex w-36 items-center gap-2.5 rounded-xl border bg-card px-3 py-2 text-start shadow-xs sm:w-56',
    filled ? 'border-border' : 'border-dashed border-border',
    className
  );
  // البطاقة المعيَّنة تفتح ملفّ القائد؛ الشاغرة ليست رابطًا
  return filled ? (
    <Link to={`/leaders/${a.leader_id}`} className={cn(base, 'focus-ring transition-colors hover:border-primary/40 hover:bg-accent/40')}>
      {inner}
    </Link>
  ) : (
    <div className={base}>{inner}</div>
  );
}

/** بطاقة أمانة و تحتها تابعوها — الأمين و فريقه كتلة واحدة في الهيكلية. */
function OrgTeam({ a, helpers, className }) {
  return (
    <div>
      <OrgCard a={a} className={className} />
      {helpers.length > 0 && (
        <div className="ms-6 mt-2 space-y-2 border-s border-border ps-3">
          {helpers.map((h) => (
            <div key={h.id} className="flex items-center">
              <span aria-hidden="true" className="-ms-3 h-px w-3 shrink-0 bg-border" />
              <OrgCard a={h} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** خيط عمودي قصير بين طبقتين من الهيكلية. */
const OrgLine = () => <div aria-hidden="true" className="mx-auto h-4 w-px bg-border" />;

/**
 * التشكيلة شجرةً: عميد الفوج فنائبه فالأمانات، ثم عمود لكل فرقة يبدأ بقائدها و
 * تتدلّى تحته بقية توصيفاتها. الرتبة تُستنتج من ترتيب الصفوف (sort_order) لا من نص
 * التوصيف — النصوص قابلة للتعديل. عرضٌ للقراءة: التعيين يبقى في عرض اللائحة.
 */
function OrgChart({ assignments, branches, lang, t }) {
  const amanat = assignments.filter((a) => a.role_type === 'amana');
  // الجذور تصنع الطبقات؛ التابعون يتعلّقون تحت أمينهم أيًّا كانت طبقته
  const roots = amanat.filter((a) => !a.parent_id);
  const helpersOf = (id) => amanat.filter((a) => a.parent_id === id);
  const [head, deputy, ...secretariats] = roots;
  const columns = branches
    .map((b) => ({
      branch: b,
      list: assignments.filter((a) => a.role_type === 'branch' && a.branch_id === b.id),
    }))
    .filter((c) => c.list.length > 0);

  return (
    <div className="overflow-x-auto p-4 sm:p-5">
      <div className="w-max min-w-full">
        {/* رأس الفوج — في الوسط فوق الجميع */}
        {head && (
          <div className="flex flex-col items-center">
            <OrgTeam a={head} helpers={helpersOf(head.id)} className="border-primary/50" />
            {deputy && (
              <>
                <OrgLine />
                <OrgTeam a={deputy} helpers={helpersOf(deputy.id)} />
              </>
            )}
          </div>
        )}

        {/* الأمانات — صفّ ملتفّ في الوسط */}
        {secretariats.length > 0 && (
          <>
            <OrgLine />
            <div className="mx-auto flex max-w-3xl flex-wrap items-start justify-center gap-x-2 gap-y-3">
              {secretariats.map((a) => (
                <OrgTeam key={a.id} a={a} helpers={helpersOf(a.id)} />
              ))}
            </div>
          </>
        )}

        {/* الفرق — عمود لكل واحدة، يتفرّع من خط أفقي مشترك */}
        {columns.length > 0 && (
          <>
            <OrgLine />
            <div aria-hidden="true" className="mx-8 border-t border-border sm:mx-28" />
            <div className="flex items-start justify-center gap-4 sm:gap-6">
              {columns.map(({ branch, list }) => {
                // توصيفات الفرقة كلها أولًا، ثم توصيفات كل مجموعة عنقودًا باسمها
                const main = list.filter((a) => !a.group_id);
                const subs = [];
                for (const a of list.filter((x) => x.group_id)) {
                  let e = subs.find((x) => x.id === a.group_id);
                  if (!e) subs.push((e = { id: a.group_id, name: a.group_name, list: [] }));
                  e.list.push(a);
                }
                const [chief, ...assistants] = main;
                return (
                  <div key={branch.id} className="shrink-0">
                    <OrgLine />
                    <div className="mb-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {branchName(branch, lang)}
                    </div>
                    {chief && <OrgCard a={chief} />}
                    {(assistants.length > 0 || subs.length > 0) && (
                      <div className="ms-6 mt-2 space-y-2 border-s border-border ps-3">
                        {assistants.map((a) => (
                          <div key={a.id} className="flex items-center">
                            <span aria-hidden="true" className="-ms-3 h-px w-3 shrink-0 bg-border" />
                            <OrgCard a={a} />
                          </div>
                        ))}
                        {subs.map((g) => (
                          <div key={g.id} className="space-y-1.5 pt-1">
                            <div className="flex items-center">
                              <span aria-hidden="true" className="-ms-3 h-px w-3 shrink-0 bg-border" />
                              <span className="text-xs font-semibold text-muted-foreground">{g.name}</span>
                            </div>
                            {g.list.map((a) => (
                              <div key={a.id} className="ms-4 flex items-center">
                                <span aria-hidden="true" className="-ms-3 h-px w-3 shrink-0 bg-border" />
                                <OrgCard a={a} />
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">{t('leader.treeHint')}</p>
    </div>
  );
}

export default function Leaders() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [year, setYear] = useState(null);
  // '' = all, 'amana' = الأمانة only, otherwise a branch id (string)
  const [branchFilter, setBranchFilter] = useLocalStorage('leaders.branchFilter', '');
  // 'list' = الأسطر القابلة للتعيين، 'tree' = الهيكلية. تفضيل يبقى من زيارة لأخرى.
  const [view, setView] = useLocalStorage('leaders.tachkilaView', 'list');
  const [editingLeader, setEditingLeader] = useState(null);
  const [editingAssignment, setEditingAssignment] = useState(null);
  // القائد الذي يُنشأ له حساب دخول
  const [accountFor, setAccountFor] = useState(null);
  const [creatingYear, setCreatingYear] = useState(false);

  const leadersRes = useFetch('/leaders');
  const branchesRes = useFetch('/branches');
  // Les listes de quartiers / regions ne servent qu'au formulaire, reserve aux admins
  const lookupsRes = useFetch('/lookups', { skip: !isAdmin });
  const tachkilaRes = useFetch(year ? `/tachkila?year=${encodeURIComponent(year)}` : '/tachkila');

  const leaders = leadersRes.data || [];
  const branches = branchesRes.data || [];
  // SearchSelect prend des libelles nus ; une valeur retiree de la liste reste
  // affichee sur le chef qui la porte, elle n'est simplement plus proposable.
  const lookupLists = {
    residence_abidjan: (lookupsRes.data?.residence_abidjan || []).map((v) => v.label),
    residence_lebanon: (lookupsRes.data?.residence_lebanon || []).map((v) => v.label),
  };

  // Un quartier ajoute en pleine saisie rejoint la liste : le prochain formulaire
  // le trouve pret. Un doublon n'est pas un echec, l'entree existe deja.
  async function createLookup(kind, label) {
    const wanted = String(label).trim();
    try {
      const row = await api.post('/lookups', { kind, label: wanted });
      lookupsRes.reload({ quiet: true });
      return row.label;
    } catch (err) {
      if (err.message === 'duplicate label') {
        const existing = (lookupsRes.data?.[kind] || []).find(
          (v) => v.label.toLowerCase() === wanted.toLowerCase()
        );
        return existing?.label || wanted;
      }
      toast.error(err.message);
      return null;
    }
  }
  const tachkila = tachkilaRes.data || {
    years: [],
    year: null,
    assignments: [],
    template: [],
    missing_count: 0,
    locked: false,
  };
  // A سنة مقفلة is frozen: the server refuses every change, and only an admin can unlock it
  const locked = !!tachkila.locked;
  // With leaders.read a قائد opens this page read-only — changing the التشكيلة stays admin-only
  const canEdit = isAdmin && !locked;

  // The server answers 423 { error: 'year_locked' } if the freeze was set from another device
  const errMsg = (err) => (err.message === 'year_locked' ? t('leader.lockedError') : err.message);

  function reloadAll() {
    leadersRes.reload({ quiet: true });
    tachkilaRes.reload({ quiet: true });
  }

  // سحب الدخول: حذف الحساب المربوط. الجلسات المفتوحة تسقط مع الحساب.
  async function revokeAccount(l) {
    if (
      !(await confirm({
        title: t('leader.accountRevoke'),
        message: t('leader.accountRevokeConfirm', { username: l.account_username }),
      }))
    )
      return;
    try {
      await api.del(`/users/${l.account_user_id}`);
      leadersRes.reload({ quiet: true });
      toast.success(t('leader.accountRevoked'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeLeader(l) {
    if (!(await confirm({ title: t('common.delete'), message: t('leader.confirmDelete') }))) return;
    try {
      await api.del(`/leaders/${l.id}`);
      reloadAll();
      toast.success(t('leader.deleted'));
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  // Freeze / unfreeze the whole تشكيلة of the selected year. Admin only, server-enforced.
  async function toggleLock() {
    const next = !locked;
    const ok = await confirm({
      title: t(next ? 'leader.lock' : 'leader.unlock'),
      message: t(next ? 'leader.confirmLock' : 'leader.confirmUnlock', { year: tachkila.year }),
    });
    if (!ok) return;
    try {
      await api.post('/tachkila/lock', { year: tachkila.year, locked: next });
      reloadAll();
      toast.success(t(next ? 'leader.lockedToast' : 'leader.unlockedToast'));
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function removeAssignment(a) {
    if (!(await confirm({ title: t('common.delete'), message: t('leader.confirmDeleteAssignment') }))) return;
    try {
      await api.del(`/tachkila/${a.id}`);
      reloadAll();
      toast.success(t('leader.assignmentDeleted'));
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  // Assign / unassign a قائد straight from the row, so the تشكيلة can be adjusted any time of the year
  async function quickAssign(a, leaderId) {
    try {
      await api.put(`/tachkila/${a.id}`, { leader_id: leaderId === '' ? null : Number(leaderId) });
      reloadAll();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  // A مساعد sits right under its chef: same فرقة, same sort_order (the newer id breaks the tie)
  function addAssistant(a) {
    setEditingAssignment({
      leader_id: '',
      title: `${t('leader.assistantPrefix')} ${a.title}`,
      branch_id: a.branch_id ?? '',
      group_id: a.group_id ?? '',
      // مساعد أمانةٍ يتبعها؛ و إن كان التوصيف نفسه تابعًا فالمساعد الجديد يتبع أمينه هو
      parent_id: a.branch_id ? '' : (a.parent_id ?? a.id ?? ''),
      sort_order: a.sort_order ?? 0,
    });
  }

  async function fillTemplate() {
    try {
      const { added } = await api.post('/tachkila/fill', { year: tachkila.year });
      reloadAll();
      toast.success(added > 0 ? t('leader.templateFilled', { count: added }) : t('leader.templateComplete'));
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  const branchAssignments = tachkila.assignments.filter((a) => a.role_type === 'branch');
  const amanat = tachkila.assignments.filter((a) => a.role_type === 'amana');
  const showAmanat = branchFilter === '' || branchFilter === 'amana';

  // One group per فرقة so it is clear which chef belongs to which branch
  const branchGroups = branches
    .filter((b) => branchFilter === '' || branchFilter === String(b.id))
    .map((b) => ({ branch: b, list: branchAssignments.filter((a) => a.branch_id === b.id) }))
    .filter((g) => g.list.length > 0);

  const filteredLeaders = leaders.filter((l) => {
    if (branchFilter === '') return true;
    if (branchFilter === 'amana') return l.roles.some((r) => r.role_type === 'amana');
    return l.roles.some((r) => String(r.branch_id) === branchFilter);
  });

  function GroupHeading({ children, count }) {
    return (
      <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:border-t-0 sm:px-5">
        {children}
        <Badge variant="outline">{count}</Badge>
      </div>
    );
  }

  // One row = one توصيف. It exists even with no قائد yet; the inline select fills or frees it.
  function AssignmentRow({ a, child = false }) {
    return (
      <li
        className={cn(
          'flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5',
          child && 'border-s-2 border-border ms-6 sm:ms-8'
        )}
      >
        {a.leader_id ? (
          <Link to={`/leaders/${a.leader_id}`} className="focus-ring rounded-full">
            <Avatar photo={a.photo} name={avatarName(a)} />
          </Link>
        ) : (
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"
          >
            <IconShield className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-40 flex-1 space-y-1.5">
          <div className={cn('font-medium', !a.leader_id && 'text-muted-foreground')}>{a.title}</div>
          {canEdit ? (
            <Select
              value={a.leader_id || ''}
              onChange={(e) => quickAssign(a, e.target.value)}
              aria-label={`${a.title} — ${t('leader.selectLeader')}`}
              className="max-w-64"
            >
              <option value="">{t('leader.unassigned')}</option>
              {leaders.map((l) => (
                <option key={l.id} value={l.id}>
                  {memberName(l)}
                </option>
              ))}
            </Select>
          ) : a.leader_id ? (
            <Link
              to={`/leaders/${a.leader_id}`}
              className="focus-ring inline-block rounded text-sm hover:text-primary hover:underline"
            >
              {memberName(a)}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">{t('leader.unassigned')}</span>
          )}
        </div>
        {a.branch_id && <Badge>{branchName(a, i18n.language)}</Badge>}
        {a.group_name && <Badge variant="outline">{a.group_name}</Badge>}
        {/* Frozen year (or non-admin account): the row is read-only */}
        {locked && (
          <span className="text-muted-foreground" title={t('leader.lockedBadge')} aria-hidden="true">
            <IconLock className="h-4 w-4" />
          </span>
        )}
        {canEdit && (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => addAssistant(a)}
              aria-label={t('leader.addAssistant')}
              title={t('leader.addAssistant')}
            >
              <IconPlus />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEditingAssignment(a)}
              aria-label={t('common.edit')}
            >
              <IconPencil />
            </Button>
            <Button
              variant="destructive-ghost"
              size="icon"
              onClick={() => removeAssignment(a)}
              aria-label={t('common.delete')}
            >
              <IconTrash />
            </Button>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('leader.title')} description={t('leader.subtitle')}>
        {isAdmin && (
          <Button variant="brand" onClick={() => setEditingLeader(EMPTY_LEADER)}>
            <IconPlus />
            {t('leader.addLeader')}
          </Button>
        )}
      </PageHeader>

      {/* ---------- التشكيلة ---------- */}
      <Card>
        <CardHeader className="gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{t('leader.tachkila')}</CardTitle>
              {locked && (
                <Badge variant="warning">
                  <IconLock className="h-3.5 w-3.5" />
                  {t('leader.lockedBadge')}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {locked
                ? t('leader.lockedHint', {
                    by: tachkila.locked_by || '—',
                    admin: isAdmin ? t('leader.lockedHintAdmin') : t('leader.lockedHintUser'),
                  })
                : canEdit
                  ? t('leader.tachkilaHint')
                  : t('leader.readOnlyHint')}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <SegmentedControl
              label={t('leader.viewLabel')}
              value={view}
              onChange={setView}
              size="sm"
              className="col-span-2 sm:col-span-1"
              options={[
                { value: 'list', label: t('leader.viewList') },
                { value: 'tree', label: t('leader.viewTree') },
              ]}
            />
            <Select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label={t('member.branch')}
              className="min-w-36 flex-1 sm:w-auto sm:flex-initial"
            >
              <option value="">{t('member.allBranches')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {branchName(b, i18n.language)}
                </option>
              ))}
              <option value="amana">{t('leader.amanat')}</option>
            </Select>
            {tachkila.years.length > 0 && (
              <Select
                value={tachkila.year || ''}
                onChange={(e) => setYear(e.target.value)}
                aria-label={t('leader.year')}
                className="min-w-28 flex-1 sm:w-auto sm:flex-initial"
              >
                {tachkila.years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            )}
            {isAdmin && (
              <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setCreatingYear(true)}>
                <IconPlus />
                {t('leader.newYear')}
              </Button>
            )}
            {/* Only an admin may freeze a تشكيلة or lift the freeze */}
            {isAdmin && tachkila.year && (
              <Button variant={locked ? 'brand' : 'outline'} size="sm" className="w-full sm:w-auto" onClick={toggleLock}>
                <IconLock />
                {t(locked ? 'leader.unlock' : 'leader.lock')}
              </Button>
            )}
            {canEdit && tachkila.year && tachkila.missing_count > 0 && (
              <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={fillTemplate}>
                <IconShield />
                {t('leader.fillTemplate', { count: tachkila.missing_count })}
              </Button>
            )}
            {tachkila.year && canEdit && (
              <Button size="sm" className="w-full sm:w-auto" onClick={() => setEditingAssignment(EMPTY_ASSIGNMENT)}>
                <IconPlus />
                {t('leader.addAssignment')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {tachkilaRes.loading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : tachkilaRes.error ? (
            <div className="p-4">
              <ErrorState
                message={t('error.loadFailed')}
                onRetry={tachkilaRes.reload}
                retryLabel={t('error.retry')}
              />
            </div>
          ) : tachkila.assignments.length === 0 ? (
            <EmptyState icon={<IconShield className="h-6 w-6" />} title={t('leader.noAssignments')} />
          ) : view === 'tree' ? (
            /* الهيكلية تعرض الفوج كله: فلتر الفرقة يخصّ اللائحة وحدها */
            <OrgChart
              assignments={tachkila.assignments}
              branches={branches}
              lang={i18n.language}
              t={t}
            />
          ) : branchGroups.length === 0 && !(showAmanat && amanat.length > 0) ? (
            <EmptyState icon={<IconShield className="h-6 w-6" />} title={t('leader.noAssignments')} />
          ) : (
            <div>
              {/* الأمانات first — عميد الفوج heads the organigram — then فرقة by فرقة */}
              {showAmanat && amanat.length > 0 && (
                <div>
                  <GroupHeading count={amanat.length}>{t('leader.amanat')}</GroupHeading>
                  <ul className="divide-y divide-border">
                    {/* الأمين ثم تابعوه في إثره بإزاحة، فالفريق يُقرأ كتلةً واحدة */}
                    {amanat
                      .filter((a) => !a.parent_id)
                      .flatMap((root) => [
                        <AssignmentRow key={root.id} a={root} />,
                        ...amanat
                          .filter((c) => c.parent_id === root.id)
                          .map((c) => <AssignmentRow key={c.id} a={c} child />),
                      ])}
                    {/* تابعٌ فقد أمينه في عرضٍ قديم لا يختفي */}
                    {amanat
                      .filter((a) => a.parent_id && !amanat.some((r) => r.id === a.parent_id))
                      .map((a) => (
                        <AssignmentRow key={a.id} a={a} />
                      ))}
                  </ul>
                </div>
              )}
              {branchGroups.map((g) => (
                <div key={g.branch.id}>
                  <GroupHeading count={g.list.length}>{branchName(g.branch, i18n.language)}</GroupHeading>
                  <ul className="divide-y divide-border">
                    {g.list.map((a) => (
                      <AssignmentRow key={a.id} a={a} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- القادة ---------- */}
      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle>{t('leader.leadersList')}</CardTitle>
            {/* فرقة القادة: قادة الفوج تُتابع مطالبهم سنويًا مثل باقي الفرق */}
            <p className="mt-1 text-sm text-muted-foreground">{t('leader.cardHint')}</p>
          </div>
          <Badge variant="outline">{filteredLeaders.length}</Badge>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {leadersRes.loading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : filteredLeaders.length === 0 ? (
            <EmptyState
              icon={<IconUsers className="h-6 w-6" />}
              title={t('leader.noLeaders')}
              action={
                isAdmin ? (
                  <Button variant="brand" onClick={() => setEditingLeader(EMPTY_LEADER)}>
                    <IconPlus />
                    {t('leader.addLeader')}
                  </Button>
                ) : null
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {filteredLeaders.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <Link
                    to={`/leaders/${l.id}`}
                    className="focus-ring flex min-w-40 flex-1 items-center gap-3 rounded-md"
                  >
                    <Avatar photo={l.photo} name={avatarName(l)} />
                    <div className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'font-medium',
                          l.status === 'inactive' && 'text-muted-foreground line-through decoration-1'
                        )}
                      >
                        {memberName(l)}
                      </span>
                      <div className="mt-0.5 flex flex-wrap gap-1.5">
                        {l.roles.length === 0 ? (
                          <span className="text-xs text-muted-foreground">{t('leader.noRole')}</span>
                        ) : (
                          l.roles.map((r, i) => (
                            <Badge key={i} variant={r.role_type === 'branch' ? 'default' : 'warning'}>
                              {r.title}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {/* من له حساب يظهر اسمه هنا — جواب «من يدخل الموقع؟» من القائمة نفسها */}
                    {isAdmin && l.account_username && (
                      <Badge variant="outline" dir="ltr" className="max-w-40">
                        <IconKey className="h-3 w-3" />
                        <span className="truncate">{l.account_username}</span>
                      </Badge>
                    )}
                    <span className="tabular-nums">
                      {l.sessions_count} {t('leader.sessionsLed')}
                    </span>
                    <Badge variant="success">
                      <IconCheck className="h-3 w-3" />
                      {l.present_count}
                    </Badge>
                    <Badge variant="destructive">
                      <IconX className="h-3 w-3" />
                      {l.absent_count}
                    </Badge>
                    {/* بطاقة تقدم القائد لسنة التشكيلة الجارية */}
                    {l.card?.total > 0 && (
                      <Badge variant={l.card.done_count === l.card.total ? 'success' : 'outline'}>
                        {t('leader.cardProgress', { done: l.card.done_count, total: l.card.total })}
                      </Badge>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => (l.account_user_id ? revokeAccount(l) : setAccountFor(l))}
                        aria-label={t(l.account_user_id ? 'leader.accountRevoke' : 'leader.accountCreate')}
                        title={t(l.account_user_id ? 'leader.accountRevoke' : 'leader.accountCreate')}
                      >
                        <IconKey className={l.account_user_id ? 'text-primary' : undefined} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingLeader(l)}
                        aria-label={t('common.edit')}
                      >
                        <IconPencil />
                      </Button>
                      <Button
                        variant="destructive-ghost"
                        size="icon"
                        onClick={() => removeLeader(l)}
                        aria-label={t('common.delete')}
                      >
                        <IconTrash />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!editingLeader}
        onClose={() => setEditingLeader(null)}
        title={t(editingLeader?.id ? 'leader.editLeader' : 'leader.addLeader')}
      >
        {editingLeader && (
          <LeaderForm
            initial={editingLeader}
            lookups={lookupLists}
            onCreateLookup={createLookup}
            onSaved={() => {
              const wasNew = !editingLeader.id;
              setEditingLeader(null);
              reloadAll();
              toast.success(t(wasNew ? 'leader.created' : 'leader.updated'));
            }}
            onCancel={() => setEditingLeader(null)}
          />
        )}
      </Dialog>

      {accountFor && (
        <AccountDialog
          leader={accountFor}
          branches={branches}
          onClose={() => setAccountFor(null)}
          onCreated={() => leadersRes.reload({ quiet: true })}
        />
      )}

      <Dialog
        open={!!editingAssignment}
        onClose={() => setEditingAssignment(null)}
        title={t(editingAssignment?.id ? 'leader.editAssignment' : 'leader.addAssignment')}
      >
        {editingAssignment && (
          <AssignmentForm
            initial={editingAssignment}
            year={tachkila.year}
            leaders={leaders}
            branches={branches}
            template={tachkila.template}
            amanaRoots={amanat.filter((a) => !a.parent_id)}
            onSaved={() => {
              setEditingAssignment(null);
              reloadAll();
              toast.success(t('common.saved'));
            }}
            onCancel={() => setEditingAssignment(null)}
          />
        )}
      </Dialog>

      <Dialog open={creatingYear} onClose={() => setCreatingYear(false)} title={t('leader.newYear')}>
        {creatingYear && (
          <NewYearForm
            currentYear={tachkila.year}
            onSaved={(y) => {
              setCreatingYear(false);
              setYear(y);
              leadersRes.reload({ quiet: true });
              toast.success(t('common.saved'));
            }}
            onCancel={() => setCreatingYear(false)}
          />
        )}
      </Dialog>
    </div>
  );
}
