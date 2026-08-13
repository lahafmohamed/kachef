import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';
import { branchName } from '../utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  Select,
  SkeletonPage,
  useConfirm,
  useToast,
  IconPencil,
  IconPlus,
  IconShield,
  IconTrash,
  IconUsers,
} from '../components/ui';

const EMPTY_USER = { username: '', password: '', display_name: '', role: 'user', branches: [], perms: [] };

// Pages an account can be limited to; labels reuse the nav translations
const PERM_OPTIONS = [
  { key: 'members', label: 'nav.members' },
  { key: 'sessions', label: 'nav.sessions' },
  { key: 'branches', label: 'nav.branches' },
  { key: 'promotions', label: 'nav.promotions' },
];

function UserForm({ initial, branches, onSaved, onCancel }) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const isEdit = !!initial.id;

  function toggleBranch(id) {
    setForm((f) => ({
      ...f,
      branches: f.branches.includes(id) ? f.branches.filter((x) => x !== id) : [...f.branches, id],
    }));
  }

  function togglePerm(key) {
    setForm((f) => ({
      ...f,
      perms: f.perms.includes(key) ? f.perms.filter((x) => x !== key) : [...f.perms, key],
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const body = {
      display_name: form.display_name || null,
      role: form.role,
      // Empty selection = access to every فرقة / every page
      branches: form.branches.length ? form.branches : null,
      perms: form.perms.length ? form.perms : null,
    };
    if (form.password) body.password = form.password;
    try {
      if (isEdit) await api.put(`/users/${initial.id}`, body);
      else await api.post('/users', { ...body, username: form.username, password: form.password });
      onSaved();
    } catch (err) {
      const map = {
        username_taken: t('admin.usernameTaken'),
        last_admin: t('admin.lastAdmin'),
        'password too short': t('admin.passwordTooShort'),
      };
      setError(map[err.message] || err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="u_name">{t('auth.username')}</Label>
        <Input
          id="u_name"
          required
          disabled={isEdit}
          autoComplete="off"
          autoCapitalize="none"
          dir="ltr"
          value={form.username}
          onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="u_display">{t('admin.displayName')}</Label>
        <Input
          id="u_display"
          autoComplete="off"
          value={form.display_name || ''}
          onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="u_pass">{t(isEdit ? 'admin.newPassword' : 'auth.password')}</Label>
        <Input
          id="u_pass"
          type="password"
          required={!isEdit}
          autoComplete="new-password"
          dir="ltr"
          placeholder={isEdit ? t('admin.keepPassword') : undefined}
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="u_role">{t('admin.role')}</Label>
        <Select
          id="u_role"
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
        >
          <option value="user">{t('admin.roleUser')}</option>
          <option value="admin">{t('admin.roleAdmin')}</option>
        </Select>
        <p className="text-xs text-muted-foreground">{t('admin.roleHint')}</p>
      </div>
      {form.role === 'user' && (
        <div className="space-y-1.5">
          <Label className="block">{t('admin.allowedBranches')}</Label>
          <div className="rounded-md border border-border p-1.5">
            {branches.map((b) => (
              <label
                key={b.id}
                className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm hover:bg-accent/60 sm:min-h-9"
              >
                <input
                  type="checkbox"
                  checked={form.branches.includes(b.id)}
                  onChange={() => toggleBranch(b.id)}
                />
                {branchName(b, i18n.language)}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('admin.branchesHint')}</p>
        </div>
      )}
      {form.role === 'user' && (
        <div className="space-y-1.5">
          <Label className="block">{t('admin.allowedPages')}</Label>
          <div className="rounded-md border border-border p-1.5">
            {PERM_OPTIONS.map((p) => (
              <label
                key={p.key}
                className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm hover:bg-accent/60 sm:min-h-9"
              >
                <input
                  type="checkbox"
                  checked={form.perms.includes(p.key)}
                  onChange={() => togglePerm(p.key)}
                />
                {t(p.label)}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('admin.pagesHint')}</p>
        </div>
      )}
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

export default function Admin() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const users = useFetch('/users');
  const branches = useFetch('/branches');
  const [editing, setEditing] = useState(null);

  if (users.loading) return <SkeletonPage />;
  if (users.error)
    return <ErrorState message={t('error.loadFailed')} onRetry={users.reload} retryLabel={t('error.retry')} />;

  const list = users.data || [];
  const branchList = branches.data || [];
  const nameOf = (id) => {
    const b = branchList.find((x) => x.id === id);
    return b ? branchName(b, i18n.language) : id;
  };

  async function remove(u) {
    if (!(await confirm({ title: t('common.delete'), message: t('admin.confirmDelete') }))) return;
    try {
      await api.del(`/users/${u.id}`);
      users.reload({ quiet: true });
      toast.success(t('admin.deleted'));
    } catch (err) {
      toast.error(err.message === 'cannot_delete_self' ? t('admin.cannotDeleteSelf') : err.message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.title')} description={t('admin.subtitle')}>
        <Button variant="brand" onClick={() => setEditing(EMPTY_USER)}>
          <IconPlus />
          {t('admin.addUser')}
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="p-0 pb-2">
          {list.length === 0 ? (
            <EmptyState icon={<IconUsers className="h-6 w-6" />} title={t('admin.noUsers')} />
          ) : (
            <ul className="divide-y divide-border">
              {list.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
                  >
                    {(u.display_name || u.username).slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-40 flex-1">
                    <div className="font-medium">
                      {u.display_name || u.username}
                      {u.id === me.id && (
                        <span className="ms-2 text-xs text-muted-foreground">{t('admin.you')}</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground" dir="ltr">
                      {u.username}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {u.role === 'admin' ? (
                      <Badge variant="warning">
                        <IconShield className="h-3 w-3" />
                        {t('admin.roleAdmin')}
                      </Badge>
                    ) : (
                      <>
                        {u.branches === null ? (
                          <Badge variant="outline">{t('admin.allBranches')}</Badge>
                        ) : (
                          u.branches.map((id) => <Badge key={id}>{nameOf(id)}</Badge>)
                        )}
                        {u.perms !== null && (
                          <Badge variant="secondary">
                            {t('admin.pagesCount', { count: u.perms.length })}
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setEditing({ ...u, password: '', branches: u.branches || [], perms: u.perms || [] })
                      }
                      aria-label={t('common.edit')}
                    >
                      <IconPencil />
                    </Button>
                    <Button
                      variant="destructive-ghost"
                      size="icon"
                      disabled={u.id === me.id}
                      onClick={() => remove(u)}
                      aria-label={t('common.delete')}
                    >
                      <IconTrash />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={t(editing?.id ? 'admin.editUser' : 'admin.addUser')}
      >
        {editing && (
          <UserForm
            initial={editing}
            branches={branchList}
            onSaved={() => {
              setEditing(null);
              users.reload({ quiet: true });
              toast.success(t('common.saved'));
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>
    </div>
  );
}
