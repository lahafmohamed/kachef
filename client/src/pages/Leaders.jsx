import ExportPdfButton from '../components/ExportPdfButton';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth, usePerms } from '../auth';
import LeaderDues from '../components/LeaderDues';
import { useFetch, useLocalStorage, useUrlField, useUrlFilters } from '../hooks';
import { SECTIONS, useSection } from '../section';
import SectionField from '../components/SectionField';
import {
  LEADER_FILTER_KEYS,
  avatarName,
  branchName,
  fileToDataUrl,
  filterLeaders,
  fmtPhone,
  memberName,
} from '../utils';
import Combobox from '../components/Combobox';
import DatePicker from '../components/DatePicker';
import FilterSelect from '../components/FilterSelect';
import SearchInput from '../components/SearchInput';
import SearchSelect from '../components/SearchSelect';
import Credentials from '../components/Credentials';
import { RateValue, UnderlineTabs, phoneNumbers, telHref } from '../components/MemberParts';
import { Popover, PopoverContent, PopoverTrigger } from '../components/shadcn/popover';
import { USERNAME_PATTERN, USERNAME_RE } from './Admin';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  Th,
  cn,
  useConfirm,
  useToast,
  IconCheck,
  IconKey,
  IconLock,
  IconMore,
  IconPencil,
  IconPhone,
  IconPlus,
  IconShield,
  IconSwap,
  IconTrash,
  IconUsers,
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
  const { section: onScreen } = useSection();
  // A new قائد joins the قسم on screen; the admin can still place them in the other
  const [form, setForm] = useState(() => ({ ...initial, section: initial.section || onScreen || 'M' }));
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

      <SectionField
        value={form.section}
        onChange={(v) => setForm((f) => ({ ...f, section: v }))}
        hint={t(initial.id && initial.section !== form.section ? 'section.leaderMoveHint' : 'section.leaderHint')}
      />

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
        <Label>{t('leader.trainingLevel')}</Label>
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
  const { section: onScreen } = useSection();
  const [form, setForm] = useState(() => ({ ...initial, section: initial.section || onScreen || 'M' }));
  const formBranch = branches.find((b) => String(b.id) === String(form.branch_id));
  // قسم التوصيف: قسم فرقته، و إلا فقسم الأمانة. قادته و أمينه من هذا القسم وحده.
  const section = formBranch?.section || form.section;
  // مجموعات الفرقة المختارة — /branches يرسلها مع كل فرقة
  const formGroups = formBranch?.groups || [];
  // الأمانات الجذور التي يمكن أن يتبعها هذا التوصيف — لا نفسه، و لا تابعٌ لغيره
  const parentOptions = amanaRoots.filter((a) => a.id !== initial.id && a.section === section);
  const leaderOptions = leaders.filter(
    (l) => (l.status === 'active' && l.section === section) || String(l.id) === String(initial.leader_id)
  );
  // A new أمانة while both أقسام are on screen: say which one it belongs to (an
  // assistant added from a card already sits in its أمين's)
  const askSection = !initial.id && !initial.parent_id && !onScreen && form.branch_id === '';
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
      // A فرقة's توصيف follows the فرقة; a أمانة keeps the قسم it was made in
      ...(form.branch_id === '' ? { section } : {}),
    };
    try {
      if (initial.id) await api.put(`/tachkila/${initial.id}`, body);
      else await api.post('/tachkila', body);
      onSaved();
    } catch (err) {
      setError(err.message === 'leader_outside_section' ? t('section.leaderOutside') : err.message);
      setSaving(false);
    }
  }

  // Picking the other قسم (or a فرقة of it) lets go of a قائد and a أمين of this one
  function setSlotSection(next, patch = {}) {
    setForm((f) => {
      const keepLeader = leaders.find((l) => String(l.id) === String(f.leader_id))?.section === next;
      const parentId = 'parent_id' in patch ? patch.parent_id : next === section ? f.parent_id : '';
      return { ...f, ...patch, leader_id: keepLeader ? f.leader_id : '', parent_id: parentId };
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {askSection && (
        <SectionField value={form.section} onChange={(v) => setSlotSection(v, { section: v })} />
      )}
      <div className="space-y-1.5">
        <Label htmlFor="a_leader">{t('leader.selectLeader')}</Label>
        {/* 39 قائدًا: une liste déroulante simple ne se parcourt plus, il faut chercher */}
        <SearchSelect
          id="a_leader"
          value={form.leader_id ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, leader_id: e.target.value }))}
          options={leaderOptions.map((l) => ({ value: l.id, label: memberName(l) }))}
          clearLabel={t('leader.unassigned')}
          placeholder={t('leader.unassigned')}
          searchPlaceholder={t('common.search')}
          emptyLabel={t('common.noResults')}
        />
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
            // فرق الفتيات تقودها قائدات: «قائدة المرشدات»
            ...branches.map(
              (b) =>
                `${t(b.section === 'F' ? 'leader.branchLeaderF' : 'leader.branchLeader')} ${branchName(b, i18n.language)}`
            ),
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a_branch">{t('leader.linkedBranch')}</Label>
        <Select
          id="a_branch"
          value={form.branch_id ?? ''}
          onChange={(e) => {
            // المجموعة تخصّ فرقتها و التبعية تخصّ الأمانات: تغيير الفرقة يُسقط الاثنين
            const next = branches.find((b) => String(b.id) === e.target.value);
            setSlotSection(next?.section || form.section, {
              branch_id: e.target.value,
              group_id: '',
              ...(e.target.value ? { parent_id: '' } : {}),
            });
          }}
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
        <Label>{t('leader.newYearContent')}</Label>
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // كلمة السرّ بعد الإنشاء — وجودها يقلب الحوار إلى شاشة العرض الوحيد
  const [result, setResult] = useState(null);
  // The account lives in the قائد's own قسم: only its فرق can be granted
  const ownBranches = branches.filter((b) => b.section === leader.section);
  const [form, setForm] = useState(() => ({
    username: '',
    preset: 'branch',
    // فرق توصيفاته الحالية مؤشَّرة سلفًا؛ لا تأشير = كل الفرق
    branch_ids: [
      ...new Set(
        (leader.roles || [])
          .filter((r) => r.branch_id && ownBranches.some((b) => b.id === r.branch_id))
          .map((r) => r.branch_id)
      ),
    ],
  }));
  const usernameInvalid = form.username !== '' && !USERNAME_RE.test(form.username);

  // اسم الدخول يقترحه الخادم: حروف لاتينية، بلا فراغ، غير مأخوذ
  useEffect(() => {
    let alive = true;
    const name = [leader.first_name, leader.last_name].filter(Boolean).join(' ');
    api
      .get(`/users/username-suggestion?${new URLSearchParams({ name })}`)
      .then((r) => alive && setForm((f) => (f.username ? f : { ...f, username: r.username })))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [leader.first_name, leader.last_name]);

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
      const map = {
        username_taken: t('leader.accountTaken'),
        invalid_username: t('admin.usernameInvalid'),
        account_exists: t('leader.accountExists'),
        branch_outside_section: t('section.branchOutside'),
      };
      setError(map[err.message] || err.message);
    } finally {
      setSaving(false);
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
        <Credentials username={result.user.username} password={result.password} onClose={onClose} />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="acc_username">{t('leader.accountUsername')}</Label>
            <Input
              id="acc_username"
              required
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              dir="ltr"
              pattern={USERNAME_PATTERN}
              aria-invalid={usernameInvalid || undefined}
              className="font-mono"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase() }))}
            />
            <p className={`text-xs ${usernameInvalid ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
              {t(usernameInvalid ? 'admin.usernameInvalid' : 'admin.usernameHint')}
            </p>
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
            <Label>{t('leader.accountBranches')}</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('leader.accountBranches')}>
              {ownBranches.map((b) => {
                const on = form.branch_ids.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleBranch(b.id)}
                    className={cn(
                      'focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm sm:min-h-9',
                      'transition-[color,background-color,border-color,scale] active:scale-[0.96]',
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

/* ============================================================
   Shared pieces
   ============================================================ */

// Rank of each course on the training ladder: the highest one held is the قائد's level
const COURSE_RANK = Object.fromEntries(TRAINING_COURSES.map((c, i) => [c, i]));
const topCourse = (courses = []) =>
  courses.reduce((best, c) => (best == null || COURSE_RANK[c] > COURSE_RANK[best] ? c : best), null);

function ageOf(iso) {
  if (!iso) return null;
  const b = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
  return age;
}

/** Mixed scripts in one line («قائد الكشافة · Adjoint»): each part keeps its own direction. */
function Parts({ parts, sep = ' · ' }) {
  return parts.filter(Boolean).map((p, i) => (
    <span key={i}>
      {i > 0 && sep}
      <bdi>{p}</bdi>
    </span>
  ));
}

/** One cell of the figures strip — same shape as on the فرقة and عنصر pages. */
function Stat({ label, children, className }) {
  return (
    <div className={cn('min-w-0 space-y-2 bg-card p-4', className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Thin share bar — a part of a whole, drawn without the progressbar semantics. */
function ShareBar({ value, tone = 'primary', className }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <span aria-hidden="true" className={cn('block h-1.5 overflow-hidden rounded-full bg-muted', className)}>
      <span
        className={cn('block h-full rounded-full', tone === 'success' ? 'bg-success' : 'bg-primary')}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/**
 * A row's actions behind one button: forty-one rows each carrying three icons read
 * as a wall of buttons, and hid the names they act on.
 */
function RowMenu({ label, items, variant = 'ghost', size = 'icon-sm', children }) {
  const [open, setOpen] = useState(false);
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          size={size}
          aria-label={label}
          title={label}
          className={cn('shrink-0', variant === 'ghost' && 'text-muted-foreground')}
        >
          <IconMore />
          {children}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        <div className="flex flex-col">
          {shown.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={cn(
                'focus-ring flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-start text-sm transition-colors sm:min-h-9',
                it.danger ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <span aria-hidden="true" className="flex shrink-0 [&>svg]:h-4 [&>svg]:w-4">
                {it.icon}
              </span>
              {it.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ============================================================
   التشكيلة القيادية
   ============================================================ */

/** الأمانات: رأس الفوج و نائبه أولًا (بترتيب الصفوف)، ثم الأمانات، و لكل أمين فريقه. */
function amanaTeams(assignments) {
  const amanat = assignments.filter((a) => a.role_type === 'amana');
  const roots = amanat.filter((a) => !a.parent_id);
  const helpersOf = (id) => amanat.filter((a) => a.parent_id === id);
  // تابعٌ فقد أمينه في عرضٍ قديم لا يختفي: يصير فريقًا وحده
  const orphans = amanat.filter((a) => a.parent_id && !roots.some((r) => r.id === a.parent_id));
  const [head, deputy, ...secretariats] = roots;
  return { head, deputy, secretariats, orphans, helpersOf };
}

/** فرقة فرقة: قائدها، مساعدوه، ثم مسؤوليات كل طليعة عنقودًا باسمها. */
function branchUnits(assignments, branches) {
  return branches
    .map((b) => {
      const list = assignments.filter((a) => a.role_type === 'branch' && a.branch_id === b.id);
      const groups = [];
      for (const a of list.filter((x) => x.group_id)) {
        let g = groups.find((x) => x.id === a.group_id);
        if (!g) groups.push((g = { id: a.group_id, name: a.group_name, list: [] }));
        g.list.push(a);
      }
      const [chief, ...assistants] = list.filter((a) => !a.group_id);
      return { branch: b, list, chief, assistants, groups };
    })
    .filter((u) => u.list.length > 0);
}

/** The avatar of a slot: its قائد, or a dashed ring while it waits for one. */
function SlotAvatar({ a, className }) {
  return a.leader_id ? (
    <Avatar photo={a.photo} name={avatarName(a)} className={cn('bg-secondary text-secondary-foreground', className)} />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border border-dashed border-warning/60 bg-warning/5 text-warning',
        className
      )}
    >
      <IconShield className="h-4 w-4" />
    </span>
  );
}

/**
 * Who holds a slot. For an admin the name itself is the picker — the تشكيلة is
 * adjusted all year long, straight from the card; for everyone else it opens the
 * قائد's page.
 */
function Holder({ a, page, strong = false }) {
  const { t, canEdit, leaders, quickAssign } = page;
  const size = strong ? 'text-[0.9375rem] font-semibold' : 'text-sm font-medium';
  if (canEdit)
    return (
      <SearchSelect
        value={a.leader_id || ''}
        onChange={(e) => quickAssign(a, e.target.value)}
        ariaLabel={`${a.title} — ${t('leader.selectLeader')}`}
        className={cn(
          '-ms-2 inline-flex h-auto min-h-11 w-auto max-w-full gap-1.5 border-transparent bg-transparent px-2 py-1 shadow-none hover:border-border hover:bg-accent sm:h-auto sm:min-h-9',
          size
        )}
        // An archived قائد stays on the slot they hold, but is not offered anew; and a
        // slot of one قسم only ever takes a قائد of that قسم
        options={leaders
          .filter((l) => (l.status === 'active' && l.section === a.section) || l.id === a.leader_id)
          .map((l) => ({ value: l.id, label: memberName(l) }))}
        clearLabel={t('leader.unassigned')}
        placeholder={t('leader.vacant')}
        searchPlaceholder={t('common.search')}
        emptyLabel={t('common.noResults')}
      />
    );
  if (!a.leader_id) return <p className={cn(size, 'text-warning')}>{t('leader.vacant')}</p>;
  return (
    <Link
      to={`/leaders/${a.leader_id}`}
      dir="auto"
      className={cn('focus-ring block truncate rounded-sm hover:text-primary hover:underline', size)}
    >
      {memberName(a)}
    </Link>
  );
}

/** One slot: avatar, holder, المسؤولية, and its actions for an admin. */
function SlotLine({ a, page, lead = false, showTitle = true }) {
  const { t, canEdit, addAssistant, setEditingAssignment, removeAssignment } = page;
  return (
    <div className="flex items-center gap-3">
      <SlotAvatar a={a} className={lead ? 'h-11 w-11' : 'h-8 w-8 text-[0.6875rem]'} />
      <div className="min-w-0 flex-1">
        <Holder a={a} page={page} strong={lead} />
        {showTitle && <p className="truncate text-xs text-muted-foreground">{a.title}</p>}
      </div>
      {canEdit && (
        <RowMenu
          label={`${t('common.actions')} — ${a.title}`}
          items={[
            { label: t('leader.editAssignment'), icon: <IconPencil />, onSelect: () => setEditingAssignment(a) },
            { label: t('leader.addAssistant'), icon: <IconPlus />, onSelect: () => addAssistant(a) },
            { label: t('common.delete'), icon: <IconTrash />, danger: true, onSelect: () => removeAssignment(a) },
          ]}
        />
      )}
    </div>
  );
}

/** A unit of the تشكيلة as a card: its name, who leads it, then the team under them. */
function TeamCard({ title, lead, rest = [], groups = [], leadTitle = false, page }) {
  const all = [lead, ...rest, ...groups.flatMap((g) => g.list)].filter(Boolean);
  const filled = all.filter((a) => a.leader_id).length;
  return (
    <Card className="mb-4 break-inside-avoid">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <h4 className="min-w-0 truncate text-sm font-semibold">{title}</h4>
        {all.length > 1 && (
          <span
            title={page.t('leader.filledHint', { filled, total: all.length })}
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
              filled === all.length ? 'bg-success/12 text-success' : 'bg-secondary text-muted-foreground'
            )}
          >
            {filled}/{all.length}
          </span>
        )}
      </div>
      {lead && (
        <div className="px-4 pb-3.5 pt-2.5">
          <SlotLine a={lead} page={page} lead showTitle={leadTitle} />
        </div>
      )}
      {rest.length > 0 && (
        <ul className={cn('divide-y divide-border border-t border-border', !lead && 'mt-2.5')}>
          {rest.map((a) => (
            <li key={a.id} className="px-4 py-2.5">
              <SlotLine a={a} page={page} />
            </li>
          ))}
        </ul>
      )}
      {groups.map((g) => (
        <div key={g.id} className="border-t border-border">
          <p className="px-4 pt-2.5 text-xs font-semibold text-muted-foreground">{g.name}</p>
          <ul className="divide-y divide-border">
            {g.list.map((a) => (
              <li key={a.id} className="px-4 py-2.5">
                <SlotLine a={a} page={page} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

function Section({ title, count, children }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        {title}
        {count != null && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums">{count}</span>
        )}
      </h3>
      {children}
    </section>
  );
}

/**
 * التشكيلة وحدةً وحدة: قيادة الفوج، ثم الأمانات، ثم الفرق. كل وحدة بطاقة، و البطاقات
 * أعمدة تتراصّ — أمانة من ثمانية قادة بجانب أمانة من قائد واحد لا تترك فراغًا.
 */
function TachkilaCards({ assignments, branches, page, headLabel }) {
  const { t, lng } = page;
  const { head, deputy, secretariats, orphans, helpersOf } = amanaTeams(assignments);
  const units = branchUnits(assignments, branches);
  const top = [head, deputy].filter(Boolean);
  return (
    <div className="space-y-8">
      {top.length > 0 && (
        <Section title={headLabel || t('leader.sectionHead')}>
          <div className="grid gap-4 sm:grid-cols-2 [&>*]:mb-0">
            {top.map((a) => (
              <TeamCard key={a.id} title={a.title} lead={a} rest={helpersOf(a.id)} page={page} />
            ))}
          </div>
        </Section>
      )}
      {secretariats.length + orphans.length > 0 && (
        <Section title={t('leader.amanat')} count={secretariats.length}>
          <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
            {secretariats.map((a) => (
              <TeamCard key={a.id} title={a.title} lead={a} rest={helpersOf(a.id)} page={page} />
            ))}
            {orphans.map((a) => (
              <TeamCard key={a.id} title={a.title} lead={a} page={page} />
            ))}
          </div>
        </Section>
      )}
      {units.length > 0 && (
        <Section title={t('branch.pageTitle')} count={units.length}>
          <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
            {units.map((u) => (
              <TeamCard
                key={u.branch.id}
                title={branchName(u.branch, lng)}
                lead={u.chief}
                rest={u.assistants}
                groups={u.groups}
                leadTitle
                page={page}
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/** A node of the organigram: the holder, or «شاغرة», and how many more are in the team. */
function OrgNode({ a, label, extra = 0 }) {
  const { t } = useTranslation();
  const filled = !!a.leader_id;
  const body = (
    <>
      <SlotAvatar a={a} className="h-9 w-9 text-xs" />
      <span className="min-w-0 flex-1">
        <span dir="auto" className={cn('block truncate text-sm font-medium', !filled && 'text-warning')}>
          {filled ? memberName(a) : t('leader.vacant')}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{label || a.title}</span>
      </span>
      {extra > 0 && (
        <span
          dir="ltr"
          title={t('leader.teamMore', { count: extra })}
          className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[0.6875rem] font-medium tabular-nums text-muted-foreground"
        >
          +{extra}
          <span className="sr-only"> {t('leader.teamMore', { count: extra })}</span>
        </span>
      )}
    </>
  );
  const cls = cn(
    'relative flex w-full items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-start shadow-xs',
    filled ? 'border-border' : 'border-dashed border-warning/50'
  );
  return filled ? (
    <Link
      to={`/leaders/${a.leader_id}`}
      className={cn(cls, 'focus-ring transition-colors hover:border-primary/40 hover:bg-accent/40')}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const VLine = () => <div aria-hidden="true" className="h-5 w-px bg-border" />;

function OrgPanel({ title, children }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/30 p-3 sm:p-4">
      <p className="mb-3 text-center text-xs font-semibold text-muted-foreground">{title}</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">{children}</div>
    </div>
  );
}

/**
 * الهيكلية: عميد الفوج، فنائبه، ثم يتفرّع الخط إلى الأمانات و الفرق — رؤوسها وحدها،
 * و «+N» عدد من في فريق كل منها. تفاصيل الفرق في عرض البطاقات. الرتبة تُستنتج من
 * ترتيب الصفوف (sort_order) لا من نص المسؤولية — النصوص قابلة للتعديل.
 */
function OrgTree({ assignments, branches, page }) {
  const { t, lng } = page;
  const { head, deputy, secretariats, orphans, helpersOf } = amanaTeams(assignments);
  const units = branchUnits(assignments, branches);
  const amanaNodes = [...secretariats, ...orphans];
  const split = amanaNodes.length > 0 && units.length > 0;
  return (
    <div className="flex flex-col items-center">
      {head && (
        <div className="w-full max-w-64">
          <OrgNode a={head} extra={helpersOf(head.id).length} />
        </div>
      )}
      {head && deputy && <VLine />}
      {deputy && (
        <div className="w-full max-w-64">
          <OrgNode a={deputy} extra={helpersOf(deputy.id).length} />
        </div>
      )}
      {(head || deputy) && (amanaNodes.length > 0 || units.length > 0) && (
        <>
          <VLine />
          {/* The trunk forks to the two panels, whose centres sit half a gap apart */}
          {split && <div aria-hidden="true" className="hidden h-5 w-[calc(50%+0.5rem)] border-x border-t border-border md:block" />}
        </>
      )}
      <div className={cn('grid w-full gap-4', split && 'md:grid-cols-2')}>
        {amanaNodes.length > 0 && (
          <OrgPanel title={t('leader.amanat')}>
            {amanaNodes.map((a) => (
              <OrgNode key={a.id} a={a} extra={helpersOf(a.id).length} />
            ))}
          </OrgPanel>
        )}
        {units.length > 0 && (
          <OrgPanel title={t('branch.pageTitle')}>
            {units.map((u) => (
              <OrgNode
                key={u.branch.id}
                a={u.chief || u.list[0]}
                label={branchName(u.branch, lng)}
                extra={u.list.length - 1}
              />
            ))}
          </OrgPanel>
        )}
      </div>
    </div>
  );
}

function TachkilaSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   القادة
   ============================================================ */

/** The five courses as pips, in ladder order — the level reads as a filled run. */
function CoursePips({ courses = [] }) {
  const { t } = useTranslation();
  const have = new Set(courses);
  const label = courses.length
    ? TRAINING_COURSES.filter((c) => have.has(c))
        .map((c) => t(`leader.courseShort.${c}`))
        .join(t('member.listSep'))
    : t('leader.noCourse');
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex gap-1">
      {TRAINING_COURSES.map((c) => (
        <span
          key={c}
          className={cn('h-1.5 w-3.5 rounded-full', have.has(c) ? 'bg-primary' : 'bg-muted ring-1 ring-inset ring-border')}
        />
      ))}
    </span>
  );
}

const Dash = () => <span className="text-muted-foreground">—</span>;

/**
 * One قائد in the register. The whole row opens the profile; the name is the real
 * link, and the phone and the menu keep their own clicks. Columns appear with the
 * card's width, not the viewport's — the same register as the عناصر page.
 */
function LeaderRow({ l, page, onOpen }) {
  const { t, isAdmin, bothSections, revokeAccount, setAccountFor, setEditingLeader, removeLeader } = page;
  const name = memberName(l);
  const href = `/leaders/${l.id}`;
  const inactive = l.status !== 'active';
  const age = ageOf(l.birth_date);
  const top = topCourse(l.training_level);
  const phone = phoneNumbers(l.phone)[0];
  const marked = l.present_count + l.absent_count;
  const roles = l.roles.map((r) => r.title);
  const card = l.card?.total > 0 ? l.card : null;

  return (
    <tr
      onClick={(e) => {
        if (e.target.closest('a, button') || window.getSelection()?.toString()) return;
        onOpen(href);
      }}
      className="group cursor-pointer transition-colors hover:bg-accent/40"
    >
      {/* w-full + max-w-0: the name column takes what the others leave */}
      <td className="w-full max-w-0 py-3 ps-4 pe-2 @2xl:py-2.5">
        <div className="flex items-center gap-3">
          <Avatar
            photo={l.photo}
            name={avatarName(l)}
            className={cn(
              'h-10 w-10 bg-secondary text-secondary-foreground @2xl:h-9 @2xl:w-9 @2xl:text-[0.6875rem]',
              inactive && 'opacity-60 grayscale'
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                to={href}
                dir="auto"
                className={cn(
                  'focus-ring line-clamp-2 rounded-sm text-[0.9375rem] font-medium leading-5 group-hover:text-primary @2xl:text-sm',
                  inactive && 'text-muted-foreground'
                )}
              >
                {name}
              </Link>
              {/* من له حساب دخول — جواب «من يدخل الموقع؟» من القائمة نفسها */}
              {isAdmin && l.account_username && (
                <span title={`${t('leader.colAccount')}: ${l.account_username}`} className="text-primary">
                  <IconKey className="h-3.5 w-3.5" />
                  <span className="sr-only">
                    {t('leader.colAccount')}: {l.account_username}
                  </span>
                </span>
              )}
              {inactive && <Badge variant="secondary">{t('member.inactive')}</Badge>}
              {/* Both أقسام in one register: the قائدات say so */}
              {bothSections && l.section === 'F' && <Badge variant="info">{t('section.F')}</Badge>}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {roles.length ? <Parts parts={roles} sep={t('member.listSep')} /> : t('leader.noRole')}
            </div>
            {/* Phones: age and level fold in here; wider cards give them columns */}
            <div className="mt-0.5 truncate text-xs text-muted-foreground @2xl:hidden">
              <Parts parts={[age != null && `${age} ${t('common.years')}`, top && t(`leader.courseShort.${top}`)]} />
            </div>
          </div>
        </div>
      </td>

      <td className="hidden whitespace-nowrap px-3 text-sm tabular-nums @2xl:table-cell">{age ?? <Dash />}</td>

      <td className="hidden px-3 @2xl:table-cell">
        <div className="flex flex-col gap-1.5">
          <CoursePips courses={l.training_level} />
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {top ? t(`leader.courseShort.${top}`) : t('leader.noCourse')}
          </span>
        </div>
      </td>

      <td className="hidden whitespace-nowrap px-3 @3xl:table-cell">
        {l.years_ghadir != null ? (
          <div className="leading-tight">
            <span className="text-sm font-medium tabular-nums">{l.years_ghadir}</span>{' '}
            <span className="text-xs text-muted-foreground">{t('common.years')}</span>
            {l.years_total > l.years_ghadir && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t('leader.totalShort', { count: l.years_total })}
              </div>
            )}
          </div>
        ) : (
          <Dash />
        )}
      </td>

      {/* Présence as an animator; how many أنشطة they led as the main one under it */}
      <td className="hidden whitespace-nowrap px-3 @3xl:table-cell">
        {marked || l.sessions_count ? (
          <div className="leading-tight">
            {marked > 0 ? (
              <span className="flex items-baseline gap-1.5">
                <RateValue rate={Math.round((l.present_count / marked) * 100)} className="text-sm" />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {l.present_count}/{marked}
                </span>
              </span>
            ) : (
              <Dash />
            )}
            {l.sessions_count > 0 && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t('leader.ledShort', { count: l.sessions_count })}
              </div>
            )}
          </div>
        ) : (
          <Dash />
        )}
      </td>

      <td className="hidden px-3 @4xl:table-cell">
        {card ? (
          <div className="w-20 space-y-1.5">
            <span className="block text-xs tabular-nums text-muted-foreground">
              <span className="font-medium text-foreground">{card.done_count}</span>/{card.total}
            </span>
            <ShareBar value={(card.done_count / card.total) * 100} tone={card.done_count === card.total ? 'success' : 'primary'} />
          </div>
        ) : (
          <Dash />
        )}
      </td>

      <td className="hidden whitespace-nowrap px-3 @5xl:table-cell">
        {phone ? (
          <a
            href={telHref(phone)}
            dir="ltr"
            aria-label={`${t('member.call')} ${name}`}
            className="focus-ring rounded-sm text-sm tabular-nums hover:text-primary hover:underline"
          >
            {fmtPhone(phone)}
          </a>
        ) : (
          <Dash />
        )}
      </td>

      {/* Tap to call — gone once the card is wide enough to show the number itself */}
      <td className={cn('@5xl:hidden', isAdmin ? 'pe-0' : 'pe-2')}>
        {phone && (
          <a
            href={telHref(phone)}
            aria-label={`${t('member.call')} ${name}`}
            title={fmtPhone(phone)}
            className="focus-ring flex h-11 w-11 items-center justify-center rounded-lg text-primary transition-colors hover:bg-accent @2xl:h-9 @2xl:w-9"
          >
            <IconPhone />
          </a>
        )}
      </td>

      {isAdmin && (
        <td className="pe-2">
          <RowMenu
            label={`${t('common.actions')} — ${name}`}
            items={[
              { label: t('common.edit'), icon: <IconPencil />, onSelect: () => setEditingLeader(l) },
              l.account_user_id
                ? { label: t('leader.accountRevoke'), icon: <IconKey />, onSelect: () => revokeAccount(l) }
                : { label: t('leader.accountCreate'), icon: <IconKey />, onSelect: () => setAccountFor(l) },
              { label: t('common.delete'), icon: <IconTrash />, danger: true, onSelect: () => removeLeader(l) },
            ]}
          />
        </td>
      )}
    </tr>
  );
}

function RegisterSkeleton() {
  return (
    <div className="divide-y divide-border" aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   Page
   ============================================================ */

const TABS = ['tachkila', 'leaders', 'dues'];

/** The numbers of the الهيئة القيادية: who, how much of the تشكيلة is held, and the training ladder. */
function LeadersFigures({ leaders, tachkila, loading, isAdmin, onCourse }) {
  const { t } = useTranslation();
  if (loading) return <Skeleton className="h-[7.5rem] rounded-2xl" />;
  const active = leaders.filter((l) => l.status === 'active');
  const total = tachkila.assignments.length;
  const filled = tachkila.assignments.filter((a) => a.leader_id).length;
  const withAccount = leaders.filter((l) => l.account_user_id).length;
  const holding = active.filter((l) => l.roles.length > 0).length;
  return (
    <Card className="grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-4">
      <Stat label={t('leader.leadersList')}>
        <p className="text-2xl font-bold tabular-nums">{active.length}</p>
        <p className="text-xs text-muted-foreground">
          {isAdmin ? t('leader.withAccount', { count: withAccount }) : t('leader.holdingRole', { count: holding })}
        </p>
      </Stat>
      <Stat label={tachkila.year ? `${t('leader.colRoles')} · ${tachkila.year}` : t('leader.colRoles')}>
        <p className="text-2xl font-bold tabular-nums">
          {filled}
          <span className="text-base font-medium text-muted-foreground"> / {total}</span>
        </p>
        {total > 0 && <ShareBar value={(filled / total) * 100} tone={filled === total ? 'success' : 'primary'} />}
        <p className={cn('text-xs', total - filled > 0 ? 'font-medium text-warning' : 'text-muted-foreground')}>
          {total - filled > 0 ? t('leader.vacantCount', { count: total - filled }) : t('leader.allFilled')}
        </p>
      </Stat>
      {/* The ladder: how many قادة hold each course, lowest to highest. Each count
          is also the way to those قادة: it opens the list filtered on that course */}
      <Stat label={t('leader.figTraining')} className="col-span-2">
        {/* Three across under 400px: five columns there are 42px wide, and
            «Formateur» ran into its neighbour */}
        <ul className="grid grid-cols-3 gap-x-3 gap-y-4 min-[25rem]:grid-cols-5">
          {TRAINING_COURSES.map((c) => {
            const n = active.filter((l) => l.training_level.includes(c)).length;
            const course = t(`leader.courseShort.${c}`);
            return (
              <li key={c} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onCourse(c)}
                  aria-label={t('leader.showCourse', { course, count: n })}
                  className="focus-ring group -m-1.5 block w-[calc(100%+0.75rem)] space-y-1.5 rounded-lg p-1.5 text-start transition-colors hover:bg-accent/60"
                >
                  <span className="block text-xl font-bold leading-none tabular-nums group-hover:text-primary">{n}</span>
                  <ShareBar value={active.length ? (n / active.length) * 100 : 0} className="h-1" />
                  <span className="block text-xs leading-tight text-muted-foreground">{course}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Stat>
    </Card>
  );
}

export default function Leaders() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // اشتراك القادة: تبويب لمن يملك صلاحيته وحده
  const canDues = usePerms().has('leaders.dues');

  const [year, setYear] = useState(null);
  // The القادة list's filters live in the URL (LEADER_FILTER_KEYS): «back» from a
  // profile keeps them, and the PDF export receives the same query
  const [sp, patch] = useUrlFilters();
  const [query, setQuery] = useUrlField(sp, patch, 'q');
  const lf = Object.fromEntries(LEADER_FILTER_KEYS.map((k) => [k, sp.get(k) || '']));
  // A hand-edited or stale address falls back to the default rather than an empty list
  if (!['inactive', 'all'].includes(lf.status)) lf.status = '';
  if (lf.course && lf.course !== 'none' && !TRAINING_COURSES.includes(lf.course)) lf.course = '';
  if (!isAdmin || !['with', 'without'].includes(lf.account)) lf.account = '';
  // 'list' = بطاقات الوحدات، 'tree' = الهيكلية. تفضيل يبقى من زيارة لأخرى.
  const [view, setView] = useLocalStorage('leaders.tachkilaView', 'list');
  // Which section the page shows — kept from one visit to the next, like the view
  const [tab, setTab] = useLocalStorage('leaders.tab', 'tachkila');
  const [editingLeader, setEditingLeader] = useState(null);
  const [editingAssignment, setEditingAssignment] = useState(null);
  // القائد الذي يُنشأ له حساب دخول
  const [accountFor, setAccountFor] = useState(null);
  const [creatingYear, setCreatingYear] = useState(false);

  const leadersRes = useFetch('/leaders');
  const branchesRes = useFetch('/branches');
  // null = both أقسام on screen (an admin who has not narrowed the app to one)
  const { section: onScreen } = useSection();
  const bothSections = !onScreen;
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
  const errMsg = (err) =>
    err.message === 'year_locked'
      ? t('leader.lockedError')
      : err.message === 'leader_outside_section'
        ? t('section.leaderOutside')
        : err.message;

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

  // Assign / unassign a قائد straight from the card, so the تشكيلة can be adjusted any time of the year
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
      // في قسم من يساعده
      section: a.section,
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

  const amanat = tachkila.assignments.filter((a) => a.role_type === 'amana');

  // Search reaches what a قائد would type: a name, an مسؤولية, a phone number. The
  // typed text filters at once; the URL catches up a moment later.
  const filteredLeaders = filterLeaders(leaders, { ...lf, q: query });
  // The list's whole population under the current status — what «x of y» counts against
  const inStatus = filterLeaders(leaders, { status: lf.status });
  // قادة the default view leaves out (archived), among those the other filters keep
  const hiddenInactive = lf.status ? 0 : filterLeaders(leaders, { ...lf, q: query, status: 'inactive' }).length;
  const hasInactive = leaders.some((l) => l.status !== 'active');
  const filtering = !!(query.trim() || lf.role || lf.course || lf.account || lf.status);
  function clearLeaderFilters() {
    setQuery('');
    patch(Object.fromEntries(LEADER_FILTER_KEYS.map((k) => [k, ''])));
  }
  // From a figure of the training ladder: exactly the قادة that number counts
  function showCourse(course) {
    setQuery('');
    patch({ ...Object.fromEntries(LEADER_FILTER_KEYS.map((k) => [k, ''])), course });
    setTab('leaders');
  }
  // The export lists what the القادة tab shows; from the تشكيلة tab, every active قائد
  const exportQuery = new URLSearchParams(
    Object.entries({ ...lf, q: sp.get('q') || '' }).filter(([, v]) => v)
  ).toString();

  // What the rows and cards need from the page
  const page = {
    t,
    lng: i18n.language,
    locked,
    canEdit,
    isAdmin,
    bothSections,
    leaders,
    quickAssign,
    addAssistant,
    removeAssignment,
    setEditingAssignment,
    revokeAccount,
    setAccountFor,
    setEditingLeader,
    removeLeader,
  };
  const current = TABS.includes(tab) && (tab !== 'dues' || canDues) ? tab : 'tachkila';
  const filled = tachkila.assignments.filter((a) => a.leader_id).length;
  const total = tachkila.assignments.length;
  const tachkilaEmpty = tachkila.assignments.length === 0;
  // Each قسم has its own تشكيلة — its own head, أمانات and فرق. Shown together, they
  // stay two organigrams one under the other instead of one that mixes them.
  const tachkilaParts = bothSections
    ? SECTIONS.map((s) => ({ section: s, list: tachkila.assignments.filter((a) => a.section === s) })).filter(
        (p) => p.list.length > 0
      )
    : [{ section: null, list: tachkila.assignments }];
  // قسم الفتيات تقوده مسؤولته لا عميد الفوج: رأس تشكيلته «قيادة القسم»
  const renderTachkila = (list, section) =>
    view === 'tree' ? (
      <Card className="p-4 sm:p-6">
        <OrgTree assignments={list} branches={branches} page={page} />
      </Card>
    ) : (
      <TachkilaCards
        assignments={list}
        branches={branches}
        page={page}
        headLabel={(section || onScreen) === 'F' ? t('section.head') : null}
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader title={t('leader.title')} description={t('leader.subtitle')}>
        <ExportPdfButton kind="leaders-list" id={0} query={current === 'leaders' ? exportQuery : ''} compact />
        {isAdmin && (
          <Button variant="brand" onClick={() => setEditingLeader(EMPTY_LEADER)}>
            <IconPlus />
            {t('leader.addLeader')}
          </Button>
        )}
      </PageHeader>

      {leadersRes.error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={leadersRes.reload} retryLabel={t('error.retry')} />
      ) : (
        <LeadersFigures
          leaders={leaders}
          tachkila={tachkila}
          loading={leadersRes.loading || tachkilaRes.loading}
          isAdmin={isAdmin}
          onCourse={showCourse}
        />
      )}

      <div className="space-y-5">
        <UnderlineTabs
          items={[
            { id: 'tachkila', label: t('leader.tachkila'), count: total ? `${filled}/${total}` : null },
            { id: 'leaders', label: t('leader.leadersList'), count: leadersRes.data ? inStatus.length : null },
            ...(canDues ? [{ id: 'dues', label: t('dues.tab') }] : []),
          ]}
          value={current}
          onChange={setTab}
          label={t('leader.sections')}
          idPrefix="leaders-tab"
          panelId="leaders-tabpanel"
        />

        <div role="tabpanel" id="leaders-tabpanel" aria-labelledby={`leaders-tab-${current}`}>
          {current === 'dues' ? (
            <LeaderDues />
          ) : current === 'tachkila' ? (
            /* ---------- التشكيلة ---------- */
            <div className="space-y-5">
              {locked && (
                <div
                  role="status"
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/35 bg-warning/10 px-4 py-3"
                >
                  <IconLock className="h-5 w-5 shrink-0 text-warning" />
                  <p className="min-w-48 flex-1 text-sm font-medium">
                    {t('leader.lockedHint', {
                      by: tachkila.locked_by || '—',
                      admin: isAdmin ? t('leader.lockedHintAdmin') : t('leader.lockedHintUser'),
                    })}
                  </p>
                  {isAdmin && (
                    <Button size="sm" variant="outline" onClick={toggleLock}>
                      <IconLock />
                      {t('leader.unlock')}
                    </Button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {tachkila.years.length > 0 && (
                  <Select
                    value={tachkila.year || ''}
                    onChange={(e) => setYear(e.target.value)}
                    aria-label={t('leader.year')}
                    className="w-auto"
                  >
                    {tachkila.years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </Select>
                )}
                <SegmentedControl
                  label={t('leader.viewLabel')}
                  value={view}
                  onChange={setView}
                  size="sm"
                  options={[
                    { value: 'list', label: t('leader.viewList') },
                    { value: 'tree', label: t('leader.viewTree') },
                  ]}
                />
                <span className="grow" />
                {canEdit && tachkila.year && (
                  <Button size="sm" variant="brand" onClick={() => setEditingAssignment(EMPTY_ASSIGNMENT)}>
                    <IconPlus />
                    {t('leader.addAssignment')}
                  </Button>
                )}
                {/* The year's rarer actions, one menu away */}
                {isAdmin && (
                  <RowMenu
                    label={t('common.actions')}
                    variant="outline"
                    size="icon"
                    items={[
                      { label: t('leader.newYear'), icon: <IconPlus />, onSelect: () => setCreatingYear(true) },
                      canEdit &&
                        tachkila.year &&
                        tachkila.missing_count > 0 && {
                          label: t('leader.fillTemplate', { count: tachkila.missing_count }),
                          icon: <IconShield />,
                          onSelect: fillTemplate,
                        },
                      tachkila.year &&
                        !locked && { label: t('leader.lock'), icon: <IconLock />, onSelect: toggleLock },
                    ]}
                  />
                )}
              </div>
              {!locked && (
                <p className="-mt-2 text-sm text-muted-foreground">
                  {view === 'tree' ? t('leader.treeHint') : canEdit ? t('leader.tachkilaHint') : t('leader.readOnlyHint')}
                </p>
              )}

              {tachkilaRes.loading || branchesRes.loading ? (
                <TachkilaSkeleton />
              ) : tachkilaRes.error ? (
                <ErrorState message={t('error.loadFailed')} onRetry={tachkilaRes.reload} retryLabel={t('error.retry')} />
              ) : tachkilaEmpty ? (
                <Card>
                  <EmptyState
                    icon={<IconShield className="h-6 w-6" />}
                    title={t('leader.noAssignments')}
                    action={
                      canEdit && tachkila.year && tachkila.missing_count > 0 ? (
                        <Button variant="brand" onClick={fillTemplate}>
                          <IconShield />
                          {t('leader.fillTemplate', { count: tachkila.missing_count })}
                        </Button>
                      ) : null
                    }
                  />
                </Card>
              ) : tachkilaParts.length === 1 ? (
                renderTachkila(tachkilaParts[0].list, tachkilaParts[0].section)
              ) : (
                <div className="space-y-10">
                  {tachkilaParts.map((p) => (
                    <section key={p.section} className="space-y-4" aria-labelledby={`tachkila-${p.section}`}>
                      <h2 id={`tachkila-${p.section}`} className="text-base font-semibold">
                        {t(`section.name${p.section}`)}
                      </h2>
                      {renderTachkila(p.list, p.section)}
                    </section>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ---------- القادة ---------- */
            // relative: the sr-only labels inside are absolutely positioned, and must
            // be clipped here rather than stretch the page
            <Card className="@container relative overflow-hidden">
              {/* Search, then the questions the register gets asked: whose فرقة or
                  أمانة, which course (the training ladder: 7 قادة still have none),
                  and — for whoever hands out access — who has an account yet */}
              <div className="space-y-2 border-b border-border p-3 sm:px-4">
                {/* Search keeps a row of its own until the screen can hold it beside
                    the filters; on phones the filters pair up in a grid */}
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  <SearchInput
                    value={query}
                    onChange={setQuery}
                    placeholder={t('leader.searchPlaceholder')}
                    className="lg:min-w-64"
                  />
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center [&>*:last-child:nth-child(odd)]:col-span-2">
                    <FilterSelect
                      value={lf.role}
                      onChange={(v) => patch({ role: v })}
                      allLabel={t('leader.allLeaders')}
                      ariaLabel={t('leader.role')}
                      className="w-full sm:w-auto sm:min-w-40"
                      icon={<IconShield className="opacity-60" />}
                      options={[
                        ...branches.map((b) => ({ value: b.id, label: branchName(b, i18n.language) })),
                        { value: 'amana', label: t('leader.amanat') },
                        { value: 'none', label: t('leader.noRole') },
                      ]}
                    />
                    <FilterSelect
                      value={lf.course}
                      onChange={(v) => patch({ course: v })}
                      allLabel={t('leader.allCourses')}
                      ariaLabel={t('leader.colTraining')}
                      className="w-full sm:w-auto sm:min-w-40"
                      options={[
                        ...TRAINING_COURSES.map((c) => ({ value: c, label: t(`leader.courseShort.${c}`) })),
                        { value: 'none', label: t('leader.noCourse') },
                      ]}
                    />
                    {isAdmin && (
                      <FilterSelect
                        value={lf.account}
                        onChange={(v) => patch({ account: v })}
                        allLabel={t('leader.accountAll')}
                        ariaLabel={t('leader.colAccount')}
                        className="w-full sm:w-auto sm:min-w-40"
                        icon={<IconKey className="opacity-60" />}
                        options={[
                          { value: 'with', label: t('leader.accountWith') },
                          { value: 'without', label: t('leader.accountWithout') },
                        ]}
                      />
                    )}
                    {/* Archived قادة leave the default view, as عناصر do: the choice
                        appears once there is someone to bring back */}
                    {(hasInactive || lf.status) && (
                      <FilterSelect
                        value={lf.status}
                        onChange={(v) => patch({ status: v })}
                        allLabel={t('leader.statusActive')}
                        ariaLabel={t('member.status')}
                        className="w-full sm:w-auto sm:min-w-40"
                        options={[
                          { value: 'inactive', label: t('leader.statusInactive') },
                          { value: 'all', label: t('leader.statusBoth') },
                        ]}
                      />
                    )}
                  </div>
                </div>
                {filtering && leadersRes.data && (
                  <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span className="tabular-nums">
                      {t('leader.shownOf', { shown: filteredLeaders.length, total: inStatus.length })}
                    </span>
                    <Button variant="ghost" size="sm" onClick={clearLeaderFilters} className="-me-2">
                      {t('common.clearFilters')}
                    </Button>
                  </div>
                )}
              </div>

              {leadersRes.loading ? (
                <RegisterSkeleton />
              ) : filteredLeaders.length === 0 ? (
                filtering ? (
                  <EmptyState
                    icon={<IconUsers className="h-6 w-6" />}
                    title={t('common.noResults')}
                    action={
                      <Button variant="outline" onClick={clearLeaderFilters}>
                        {t('common.clearFilters')}
                      </Button>
                    }
                  />
                ) : (
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
                )
              ) : (
                <table className="w-full text-sm">
                  <thead className="hidden border-b border-border bg-muted/40 @2xl:table-header-group">
                    <tr>
                      <Th className="ps-4">{t('leader.colLeader')}</Th>
                      <Th>{t('member.age')}</Th>
                      <Th>{t('leader.colTraining')}</Th>
                      <Th className="hidden @3xl:table-cell">{t('leader.colService')}</Th>
                      <Th className="hidden @3xl:table-cell">{t('leader.colPresence')}</Th>
                      <Th className="hidden @4xl:table-cell" title={t('leader.cardHint')}>
                        {t('leader.colCard')}
                      </Th>
                      <Th className="hidden @5xl:table-cell">{t('leader.phone')}</Th>
                      <Th className="@5xl:hidden">
                        <span className="sr-only">{t('member.call')}</span>
                      </Th>
                      {isAdmin && (
                        <Th className="pe-3">
                          <span className="sr-only">{t('common.actions')}</span>
                        </Th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredLeaders.map((l) => (
                      <LeaderRow key={l.id} l={l} page={page} onOpen={navigate} />
                    ))}
                  </tbody>
                </table>
              )}

              {!leadersRes.loading && hiddenInactive > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-x-2 border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
                  {t('leader.inactiveHidden', { count: hiddenInactive })}
                  <button
                    type="button"
                    onClick={() => patch({ status: 'all' })}
                    className="focus-ring min-h-11 cursor-pointer rounded px-1 font-medium text-primary hover:underline sm:min-h-0"
                  >
                    {t('member.showInactive')}
                  </button>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

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
