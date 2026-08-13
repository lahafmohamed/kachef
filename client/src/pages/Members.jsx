import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useDebounced, useFetch } from '../hooks';
import { fmtDate, todayISO, branchName, fileToDataUrl, birthdayWhen } from '../utils';
import FilterSelect from '../components/FilterSelect';
import SearchInput from '../components/SearchInput';
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
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  useConfirm,
  useToast,
  IconCake,
  IconPencil,
  IconPlus,
  IconShield,
  IconTrash,
  IconUsers,
} from '../components/ui';

const EMPTY_FORM = {
  first_name: '',
  last_name: '',
  father_name: '',
  mother_name: '',
  birth_date: '',
  birth_place: '',
  address_abidjan: '',
  address_lebanon: '',
  sex: 'M',
  branch_id: '',
  member_phone: '',
  parent_phone: '',
  join_date: todayISO(),
  photo: null,
  status: 'active',
};

function MemberForm({ initial, branches, onSave, onCancel }) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handlePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    const photo = await fileToDataUrl(file);
    setForm((f) => ({ ...f, photo }));
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...form, branch_id: Number(form.branch_id) });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="first_name">{t('member.firstName')}</Label>
          <Input id="first_name" required autoComplete="off" value={form.first_name} onChange={set('first_name')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="last_name">{t('member.lastName')}</Label>
          <Input id="last_name" required autoComplete="off" value={form.last_name} onChange={set('last_name')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="father_name">{t('member.fatherName')}</Label>
          <Input id="father_name" autoComplete="off" value={form.father_name || ''} onChange={set('father_name')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mother_name">{t('member.motherName')}</Label>
          <Input id="mother_name" autoComplete="off" value={form.mother_name || ''} onChange={set('mother_name')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="birth_date">{t('member.birthDate')}</Label>
          <Input id="birth_date" type="date" required value={form.birth_date} onChange={set('birth_date')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="birth_place">{t('member.birthPlace')}</Label>
          <Input id="birth_place" autoComplete="off" value={form.birth_place || ''} onChange={set('birth_place')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="address_abidjan">{t('member.addressAbidjan')}</Label>
          <Input
            id="address_abidjan"
            autoComplete="off"
            value={form.address_abidjan || ''}
            onChange={set('address_abidjan')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="address_lebanon">{t('member.addressLebanon')}</Label>
          <Input
            id="address_lebanon"
            autoComplete="off"
            value={form.address_lebanon || ''}
            onChange={set('address_lebanon')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sex">{t('member.sex')}</Label>
          <Select id="sex" value={form.sex} onChange={set('sex')}>
            <option value="M">{t('member.male')}</option>
            <option value="F">{t('member.female')}</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="branch_id">{t('member.branch')}</Label>
          <Select id="branch_id" required value={form.branch_id} onChange={set('branch_id')}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {branchName(b, i18n.language)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="member_phone">{t('member.memberPhone')}</Label>
          <Input
            id="member_phone"
            type="tel"
            inputMode="tel"
            dir="ltr"
            value={form.member_phone || ''}
            onChange={set('member_phone')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="parent_phone">{t('member.parentPhone')}</Label>
          <Input
            id="parent_phone"
            type="tel"
            inputMode="tel"
            dir="ltr"
            value={form.parent_phone || ''}
            onChange={set('parent_phone')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="join_date">{t('member.joinDate')}</Label>
          <Input id="join_date" type="date" required value={form.join_date} onChange={set('join_date')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">{t('member.status')}</Label>
          <Select id="status" value={form.status} onChange={set('status')}>
            <option value="active">{t('member.active')}</option>
            <option value="inactive">{t('member.inactive')}</option>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="photo">{t('member.photo')}</Label>
        <div className="flex flex-wrap items-center gap-3">
          {form.photo && (
            <Avatar photo={form.photo} name={form.first_name} className="h-14 w-14" />
          )}
          <Input
            id="photo"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhoto}
            className="flex-1 py-2 file:me-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-secondary-foreground"
          />
          {form.photo && (
            <Button variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, photo: null }))}>
              {t('member.removePhoto')}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      {/* Reversed on mobile so the primary action sits under the thumb */}
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

/** Cake marker for a birthday today or tomorrow — null the rest of the year. */
function BirthdayBadge({ birthDate, t }) {
  const when = birthdayWhen(birthDate);
  if (!when) return null;
  return (
    <Badge variant="warning" title={t(when === 'today' ? 'birthday.today' : 'birthday.tomorrow')}>
      <IconCake className="h-3 w-3" />
      {t(when === 'today' ? 'birthday.today' : 'birthday.tomorrow')}
    </Badge>
  );
}

/** One member as a tappable card — the mobile equivalent of a table row. */
function MemberCard({ m, lang, t, onEdit, onDelete }) {
  return (
    <li className="flex items-center gap-3 p-3">
      <Link to={`/members/${m.id}`} className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-md">
        <Avatar photo={m.photo} name={`${m.first_name} ${m.last_name}`} className="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {m.first_name} {m.last_name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge>{branchName(m, lang)}</Badge>
            <BirthdayBadge birthDate={m.birth_date} t={t} />
            <span className="text-xs text-muted-foreground">
              {m.age} {t('common.years')}
            </span>
            {m.status !== 'active' && <Badge variant="secondary">{t('member.inactive')}</Badge>}
          </div>
        </div>
      </Link>
      {(onEdit || onDelete) && (
        <div className="flex shrink-0 gap-0.5">
          {onEdit && (
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label={t('common.edit')}>
              <IconPencil />
            </Button>
          )}
          {onDelete && (
            <Button variant="destructive-ghost" size="icon" onClick={onDelete} aria-label={t('common.delete')}>
              <IconTrash />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export default function Members() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  // View-only accounts get the list without any add/edit/delete affordance
  const { has } = usePerms();
  const canCreate = has('members.create');
  const canModify = has('members.edit');
  const canDelete = has('members.delete');

  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | member object

  const dq = useDebounced(q, 250);
  const branches = useFetch('/branches');

  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (status) params.set('status', status);
  if (dq) params.set('q', dq);
  const members = useFetch(`/members?${params}`);

  const list = members.data || [];
  const branchList = branches.data || [];
  const filtering = !!(branch || status || q);

  async function save(form) {
    if (editing === 'new') await api.post('/members', form);
    else await api.put(`/members/${editing.id}`, form);
    setEditing(null);
    members.reload({ quiet: true });
    toast.success(t(editing === 'new' ? 'member.created' : 'member.updated'));
  }

  async function remove(m) {
    if (!(await confirm({ message: t('common.confirmDeleteMember'), title: t('common.delete') }))) return;
    try {
      await api.del(`/members/${m.id}`);
      members.reload({ quiet: true });
      toast.success(t('member.deleted'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('member.title')} description={t('member.subtitle', { count: list.length })}>
        {canCreate && (
          <Button variant="brand" onClick={() => setEditing('new')}>
            <IconPlus />
            {t('member.addMember')}
          </Button>
        )}
      </PageHeader>

      {/* Filters — search takes the full width on mobile, selects sit side by side */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder={t('common.search')}
          className="sm:min-w-56"
        />
        <div className="flex gap-2">
          <FilterSelect
            value={branch}
            onChange={setBranch}
            allLabel={t('member.allBranches')}
            ariaLabel={t('member.branch')}
            className="sm:w-auto sm:min-w-40"
            icon={<IconShield className="opacity-60" />}
            options={branchList.map((b) => ({ value: b.id, label: branchName(b, i18n.language) }))}
          />
          <FilterSelect
            value={status}
            onChange={setStatus}
            allLabel={t('member.allStatuses')}
            ariaLabel={t('member.status')}
            className="sm:w-auto sm:min-w-36"
            options={[
              { value: 'active', label: t('member.active') },
              { value: 'inactive', label: t('member.inactive') },
            ]}
          />
        </div>
      </div>

      {members.error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={members.reload} retryLabel={t('error.retry')} />
      ) : members.loading ? (
        <Card className="divide-y divide-border">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 p-3">
              <Skeleton className="h-11 w-11 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconUsers className="h-6 w-6" />}
            title={t(filtering ? 'common.noResults' : 'member.noMembers')}
            action={
              filtering ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQ('');
                    setBranch('');
                    setStatus('');
                  }}
                >
                  {t('common.clearFilters')}
                </Button>
              ) : canCreate ? (
                <Button variant="brand" onClick={() => setEditing('new')}>
                  <IconPlus />
                  {t('member.addMember')}
                </Button>
              ) : null
            }
          >
            {t(filtering ? 'common.noResultsHint' : 'member.noMembersHint')}
          </EmptyState>
        </Card>
      ) : (
        <>
          {/* Mobile: cards. A 7-column table cannot be read on a 375px screen. */}
          <Card className="md:hidden">
            <ul className="divide-y divide-border">
              {list.map((m) => (
                <MemberCard
                  key={m.id}
                  m={m}
                  lang={i18n.language}
                  t={t}
                  onEdit={canModify ? () => setEditing(m) : null}
                  onDelete={canDelete ? () => remove(m) : null}
                />
              ))}
            </ul>
          </Card>

          {/* Desktop: full table */}
          <Card className="hidden md:block">
            <Table>
              <thead className="border-b border-border">
                <tr>
                  <Th>{t('member.name')}</Th>
                  <Th>{t('member.age')}</Th>
                  <Th>{t('member.branch')}</Th>
                  <Th>{t('member.parentPhone')}</Th>
                  <Th>{t('member.joinDate')}</Th>
                  <Th>{t('member.status')}</Th>
                  {(canModify || canDelete) && <Th className="text-end">{t('common.actions')}</Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((m) => (
                  <tr key={m.id} className="group transition-colors hover:bg-accent/40">
                    <Td>
                      <Link
                        to={`/members/${m.id}`}
                        className="focus-ring flex items-center gap-3 rounded-md font-medium group-hover:text-primary"
                      >
                        <Avatar photo={m.photo} name={`${m.first_name} ${m.last_name}`} className="h-9 w-9" />
                        <span>
                          {m.first_name} {m.last_name}
                        </span>
                      </Link>
                    </Td>
                    <Td className="tabular-nums">
                      <div className="flex items-center gap-2">
                        {m.age} {t('common.years')}
                        <BirthdayBadge birthDate={m.birth_date} t={t} />
                      </div>
                    </Td>
                    <Td>
                      <Badge>{branchName(m, i18n.language)}</Badge>
                    </Td>
                    <Td dir="ltr" className="tabular-nums">
                      {m.parent_phone || '—'}
                    </Td>
                    <Td className="tabular-nums">{fmtDate(m.join_date)}</Td>
                    <Td>
                      <Badge variant={m.status === 'active' ? 'success' : 'secondary'}>
                        {t(m.status === 'active' ? 'member.active' : 'member.inactive')}
                      </Badge>
                    </Td>
                    {(canModify || canDelete) && (
                      <Td className="text-end">
                        <div className="flex justify-end gap-0.5">
                          {canModify && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setEditing(m)}
                              aria-label={t('common.edit')}
                            >
                              <IconPencil />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="destructive-ghost"
                              size="icon-sm"
                              onClick={() => remove(m)}
                              aria-label={t('common.delete')}
                            >
                              <IconTrash />
                            </Button>
                          )}
                        </div>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t(editing === 'new' ? 'member.addMember' : 'member.editMember')}
      >
        {editing !== null && (
          <MemberForm
            initial={
              editing === 'new'
                ? { ...EMPTY_FORM, branch_id: branchList[0]?.id || '' }
                : {
                    first_name: editing.first_name,
                    last_name: editing.last_name,
                    father_name: editing.father_name || '',
                    mother_name: editing.mother_name || '',
                    birth_date: editing.birth_date,
                    birth_place: editing.birth_place || '',
                    address_abidjan: editing.address_abidjan || '',
                    address_lebanon: editing.address_lebanon || '',
                    sex: editing.sex,
                    branch_id: editing.branch_id,
                    member_phone: editing.member_phone || '',
                    parent_phone: editing.parent_phone || '',
                    join_date: editing.join_date,
                    photo: editing.photo,
                    status: editing.status,
                  }
            }
            branches={branchList}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>
    </div>
  );
}
