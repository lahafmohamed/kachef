import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { fmtDate, todayISO, branchName, fileToDataUrl } from '../utils';
import {
  Button,
  Card,
  Input,
  Select,
  Label,
  Badge,
  Avatar,
  Dialog,
  Table,
  Th,
  Td,
  EmptyState,
  IconPlus,
  IconSearch,
  IconPencil,
  IconTrash,
} from '../components/ui';

const EMPTY_FORM = {
  first_name: '',
  last_name: '',
  birth_date: '',
  sex: 'M',
  branch_id: '',
  parent_phone: '',
  join_date: todayISO(),
  photo: null,
  status: 'active',
};

function MemberForm({ initial, branches, onSave, onCancel }) {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handlePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setForm((f) => ({ ...f, photo: dataUrl }));
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
          <Input id="first_name" required value={form.first_name} onChange={set('first_name')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="last_name">{t('member.lastName')}</Label>
          <Input id="last_name" required value={form.last_name} onChange={set('last_name')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="birth_date">{t('member.birthDate')}</Label>
          <Input id="birth_date" type="date" required value={form.birth_date} onChange={set('birth_date')} />
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
          <Label htmlFor="parent_phone">{t('member.parentPhone')}</Label>
          <Input id="parent_phone" type="tel" value={form.parent_phone || ''} onChange={set('parent_phone')} />
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
        <div className="flex items-center gap-3">
          {form.photo && <Avatar photo={form.photo} name="" className="h-12 w-12" />}
          <Input id="photo" type="file" accept="image/*" onChange={handlePhoto} className="h-auto py-1.5" />
          {form.photo && (
            <Button variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, photo: null }))}>
              {t('member.removePhoto')}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={saving}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

export default function Members() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [members, setMembers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | member object

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (branch) params.set('branch', branch);
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    api.get(`/members?${params}`).then(setMembers).catch(console.error);
  }, [branch, status, q]);

  useEffect(() => {
    api.get('/branches').then(setBranches).catch(console.error);
  }, []);

  useEffect(() => {
    const id = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  async function save(form) {
    if (editing === 'new') await api.post('/members', form);
    else await api.put(`/members/${editing.id}`, form);
    setEditing(null);
    load();
  }

  async function remove(m) {
    if (!confirm(t('common.confirmDeleteMember'))) return;
    await api.del(`/members/${m.id}`);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('member.title')}</h1>
        <Button onClick={() => setEditing('new')}>
          <IconPlus />
          {t('member.addMember')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <IconSearch className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('common.search')}
            className="ps-9"
          />
        </div>
        <Select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-auto">
          <option value="">{t('member.allBranches')}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {branchName(b, i18n.language)}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">{t('member.allStatuses')}</option>
          <option value="active">{t('member.active')}</option>
          <option value="inactive">{t('member.inactive')}</option>
        </Select>
      </div>

      <Card>
        {members.length === 0 ? (
          <EmptyState>{t('common.none')}</EmptyState>
        ) : (
          <Table>
            <thead className="border-b border-border">
              <tr>
                <Th>{t('member.name')}</Th>
                <Th>{t('member.age')}</Th>
                <Th>{t('member.branch')}</Th>
                <Th className="hidden md:table-cell">{t('member.parentPhone')}</Th>
                <Th className="hidden md:table-cell">{t('member.joinDate')}</Th>
                <Th>{t('member.status')}</Th>
                <Th className="text-end">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m) => (
                <tr
                  key={m.id}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                  onClick={() => navigate(`/members/${m.id}`)}
                >
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar photo={m.photo} name={`${m.first_name} ${m.last_name}`} />
                      <span className="font-medium">
                        {m.first_name} {m.last_name}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    {m.age} {t('common.years')}
                  </Td>
                  <Td>
                    <Badge>{branchName(m, i18n.language)}</Badge>
                  </Td>
                  <Td className="hidden md:table-cell" dir="ltr">
                    {m.parent_phone}
                  </Td>
                  <Td className="hidden md:table-cell">{fmtDate(m.join_date)}</Td>
                  <Td>
                    <Badge variant={m.status === 'active' ? 'success' : 'secondary'}>
                      {t(m.status === 'active' ? 'member.active' : 'member.inactive')}
                    </Badge>
                  </Td>
                  <Td className="text-end" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setEditing(m)} aria-label={t('common.edit')}>
                        <IconPencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => remove(m)}
                        aria-label={t('common.delete')}
                      >
                        <IconTrash />
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t(editing === 'new' ? 'member.addMember' : 'member.editMember')}
      >
        {editing !== null && (
          <MemberForm
            initial={
              editing === 'new'
                ? { ...EMPTY_FORM, branch_id: branches[0]?.id || '' }
                : {
                    first_name: editing.first_name,
                    last_name: editing.last_name,
                    birth_date: editing.birth_date,
                    sex: editing.sex,
                    branch_id: editing.branch_id,
                    parent_phone: editing.parent_phone || '',
                    join_date: editing.join_date,
                    photo: editing.photo,
                    status: editing.status,
                  }
            }
            branches={branches}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>
    </div>
  );
}
