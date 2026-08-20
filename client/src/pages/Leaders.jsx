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
const EMPTY_ASSIGNMENT = { leader_id: '', title: '', branch_id: '', sort_order: 0 };

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

function AssignmentForm({ initial, year, leaders, branches, template, onSaved, onCancel }) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState(initial);
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
          onChange={(e) => setForm((f) => ({ ...f, branch_id: e.target.value }))}
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

export default function Leaders() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [year, setYear] = useState(null);
  // '' = all, 'amana' = الأمانة only, otherwise a branch id (string)
  const [branchFilter, setBranchFilter] = useLocalStorage('leaders.branchFilter', '');
  const [editingLeader, setEditingLeader] = useState(null);
  const [editingAssignment, setEditingAssignment] = useState(null);
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
  function AssignmentRow({ a }) {
    return (
      <li className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
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
          <Select
            value={a.leader_id || ''}
            onChange={(e) => quickAssign(a, e.target.value)}
            aria-label={`${a.title} — ${t('leader.selectLeader')}`}
            className="max-w-64"
            disabled={!canEdit}
          >
            <option value="">{t('leader.unassigned')}</option>
            {leaders.map((l) => (
              <option key={l.id} value={l.id}>
                {memberName(l)}
              </option>
            ))}
          </Select>
        </div>
        {a.branch_id && <Badge>{branchName(a, i18n.language)}</Badge>}
        {/* Frozen year (or non-admin account): the row is read-only */}
        {locked && (
          <span className="text-muted-foreground" title={t('leader.lockedBadge')} aria-hidden="true">
            <IconLock className="h-4 w-4" />
          </span>
        )}
        {canEdit && (
          <div className="flex gap-0.5">
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
            <Select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label={t('member.branch')}
              className="sm:w-auto"
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
                className="sm:w-auto"
              >
                {tachkila.years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            )}
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setCreatingYear(true)}>
                <IconPlus />
                {t('leader.newYear')}
              </Button>
            )}
            {/* Only an admin may freeze a تشكيلة or lift the freeze */}
            {isAdmin && tachkila.year && (
              <Button variant={locked ? 'brand' : 'outline'} size="sm" onClick={toggleLock}>
                <IconLock />
                {t(locked ? 'leader.unlock' : 'leader.lock')}
              </Button>
            )}
            {canEdit && tachkila.year && tachkila.missing_count > 0 && (
              <Button variant="outline" size="sm" onClick={fillTemplate}>
                <IconShield />
                {t('leader.fillTemplate', { count: tachkila.missing_count })}
              </Button>
            )}
            {tachkila.year && canEdit && (
              <Button size="sm" onClick={() => setEditingAssignment(EMPTY_ASSIGNMENT)}>
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
          ) : branchGroups.length === 0 && !(showAmanat && amanat.length > 0) ? (
            <EmptyState icon={<IconShield className="h-6 w-6" />} title={t('leader.noAssignments')} />
          ) : (
            <div>
              {/* الأمانات first — عميد الفوج heads the organigram — then فرقة by فرقة */}
              {showAmanat && amanat.length > 0 && (
                <div>
                  <GroupHeading count={amanat.length}>{t('leader.amanat')}</GroupHeading>
                  <ul className="divide-y divide-border">
                    {amanat.map((a) => (
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
                    <div className="flex gap-0.5">
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
