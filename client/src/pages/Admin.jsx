import { displayError } from '../lib/errors';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useDebounced, useFetch } from '../hooks';
import { isFeminine, useSection } from '../section';
import { branchName } from '../utils';
import { USERNAME_PATTERN, USERNAME_RE } from '../lib/username';
import { ALL_PERM_KEYS, DEFAULT_PERMS } from '../lib/perms';
import Credentials from '../components/Credentials';
import PermsEditor from '../components/PermsEditor';
import SectionField from '../components/SectionField';
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
  SegmentedControl,
  Skeleton,
  cn,
  useConfirm,
  useToast,
  IconAlert,
  IconCheck,
  IconKey,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconShield,
  IconSwap,
  IconTrash,
  IconTrendingUp,
  IconUserCheck,
  IconUsers,
} from '../components/ui';

const EMPTY_USER = {
  username: '',
  display_name: '',
  role: 'user',
  branches: [],
  // Everything but the caisses and the dues, which are handed to the أمين المال by hand,
  // and what deletes or names who rated what — ticked one by one
  perms: DEFAULT_PERMS,
  // 'M' | 'F' | '' (both أقسام) — the form opens on the قسم being looked at
  section: 'M',
};

// The server sends perms normalized to the granular array; null = full access
const normalizePerms = (p) => (p ? p.filter((k) => ALL_PERM_KEYS.includes(k)) : [...ALL_PERM_KEYS]);

const initials = (u) => (u.display_name || u.username || '').trim().slice(0, 2).toUpperCase();

/**
 * Login-name field: proposed by the server from the display name (transliterated,
 * deduplicated), editable, with a button to propose again. Once the admin has
 * typed in it, the display name stops overwriting it.
 */
function UsernameField({ form, setForm, isEdit, exceptId, original }) {
  const { t } = useTranslation();
  const [touched, setTouched] = useState(isEdit);
  const [busy, setBusy] = useState(false);
  const debouncedName = useDebounced(form.display_name, 350);
  const requestId = useRef(0);

  async function propose(name) {
    const id = ++requestId.current;
    setBusy(true);
    try {
      const params = new URLSearchParams({ name: name || '' });
      if (exceptId) params.set('except', String(exceptId));
      const r = await api.get(`/users/username-suggestion?${params}`);
      if (id === requestId.current) setForm((f) => ({ ...f, username: r.username }));
    } catch {
      /* the field stays editable by hand */
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (touched || !debouncedName.trim()) return;
    propose(debouncedName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedName, touched]);

  const value = form.username;
  // An untouched legacy name (spaces, Arabic) may stay: only a new value is checked
  const unchanged = isEdit && value === original;
  const invalid = value !== '' && !unchanged && !USERNAME_RE.test(value);
  const legacy = unchanged && !USERNAME_RE.test(value);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="u_name">{t('auth.username')}</Label>
      <div className="flex gap-2">
        <Input
          id="u_name"
          required
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          pattern={unchanged ? undefined : USERNAME_PATTERN}
          aria-invalid={invalid || undefined}
          aria-describedby="u_name_hint"
          className="font-mono"
          value={value}
          onChange={(e) => {
            setTouched(true);
            setForm((f) => ({ ...f, username: e.target.value.toLowerCase() }));
          }}
        />
        <Button
          variant="outline"
          size="icon"
          loading={busy}
          disabled={!form.display_name.trim()}
          onClick={() => {
            setTouched(false);
            propose(form.display_name);
          }}
          aria-label={t('admin.usernameRegenerate')}
          title={t('admin.usernameRegenerate')}
          // The full-width field beside it squeezed it to 38px on a phone
          className="shrink-0"
        >
          {!busy && <IconRefresh />}
        </Button>
      </div>
      <p
        id="u_name_hint"
        className={`text-xs ${invalid ? 'font-medium text-destructive' : legacy ? 'font-medium text-warning' : 'text-muted-foreground'}`}
      >
        {invalid
          ? t('admin.usernameInvalid')
          : legacy
            ? t('admin.usernameLegacyHint')
            : t(isEdit ? 'admin.usernameChangedHint' : 'admin.usernameHint')}
      </p>
    </div>
  );
}

/**
 * The account form. Its save and cancel live in the dialog's pinned footer (the form
 * is long), so `saving` and the error are the page's: this form only sets them.
 */
function UserForm({ initial, branches, isSelf, setSaving, setError, onSaved, onCredentials }) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const [form, setForm] = useState(initial);
  const [resetting, setResetting] = useState(false);
  const isEdit = !!initial.id;

  function toggleBranch(id) {
    setForm((f) => ({
      ...f,
      branches: f.branches.includes(id) ? f.branches.filter((x) => x !== id) : [...f.branches, id],
    }));
  }

  // فرق an account may be limited to: those of its قسم. Changing the قسم drops the
  // ticks of the other one — the server would refuse them anyway.
  const branchesOfSection = (s) => (s ? branches.filter((b) => b.section === s) : branches);
  const visibleBranches = branchesOfSection(form.section);
  function setSection(s) {
    const keep = new Set(branchesOfSection(s).map((b) => b.id));
    setForm((f) => ({ ...f, section: s, branches: f.branches.filter((id) => keep.has(id)) }));
  }

  function describe(err) {
    const map = {
      username_taken: t('admin.usernameTaken'),
      invalid_username: t('admin.usernameInvalid'),
      last_admin: t('admin.lastAdmin'),
      cannot_edit_self: t('admin.cannotEditSelf'),
      'password too short': t('admin.passwordTooShort'),
      branch_outside_section: t('section.branchOutside'),
    };
    return map[err.message] || displayError(err);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (form.username !== initial.username && !USERNAME_RE.test(form.username))
      return setError(t('admin.usernameInvalid'));
    setSaving(true);
    const body = {
      username: form.username,
      display_name: form.display_name.trim(),
      role: form.role,
      // Empty branch selection = every فرقة (of its قسم); the server stores the complete set as null
      branches: form.branches.length ? form.branches : null,
      perms: form.perms,
      // '' = both أقسام; an admin always sees both, the server ignores it there
      section: form.role === 'admin' ? null : form.section || null,
    };
    try {
      if (isEdit) {
        await api.put(`/users/${initial.id}`, body);
        onSaved();
      } else {
        const created = await api.post('/users', body);
        onSaved({ quietToast: true });
        onCredentials({ username: created.username, password: created.password });
      }
    } catch (err) {
      setError(describe(err));
      setSaving(false);
    }
  }

  async function resetPassword() {
    const ok = await confirm({
      title: t('admin.resetPassword'),
      message: t('admin.resetPasswordConfirm', { name: form.display_name || form.username }),
      confirmLabel: t('admin.resetPassword'),
    });
    if (!ok) return;
    setError(null);
    setResetting(true);
    try {
      const updated = await api.put(`/users/${initial.id}`, { reset_password: true });
      onSaved({ quietToast: true });
      onCredentials({ username: updated.username, password: updated.password });
    } catch (err) {
      setError(describe(err));
      setResetting(false);
    }
  }

  return (
    <form id="user-form" onSubmit={submit} className="space-y-5">
      {/* ---------- Who: the name, the login, the password ---------- */}
      <div className="space-y-1.5">
        <Label htmlFor="u_display">{t('admin.displayName')}</Label>
        <Input
          id="u_display"
          required
          autoComplete="off"
          value={form.display_name || ''}
          onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
        />
        <p className="text-xs text-muted-foreground">{t('admin.displayNameHint')}</p>
      </div>

      <UsernameField form={form} setForm={setForm} isEdit={isEdit} exceptId={initial.id} original={initial.username} />

      {isEdit ? (
        !isSelf && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <span className="text-sm">{t('auth.password')}</span>
            <Button variant="outline" size="sm" loading={resetting} onClick={resetPassword}>
              <IconKey />
              {t('admin.resetPassword')}
            </Button>
          </div>
        )
      ) : (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <IconKey className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t('admin.passwordGenerated')}
        </p>
      )}

      {/* ---------- What the account reaches: its role, قسم and فرق ---------- */}
      <div className="space-y-5 border-t border-border pt-5">
        <div className="space-y-1.5">
          <Label>{t('admin.role')}</Label>
          {/* Two choices, side by side like the قسم under it. An admin cannot demote
              himself: the server refuses it, so the control is not offered */}
          <fieldset disabled={isSelf} className="min-w-0 disabled:pointer-events-none disabled:opacity-60">
            <SegmentedControl
              label={t('admin.role')}
              value={form.role}
              onChange={(v) => setForm((f) => ({ ...f, role: v }))}
              className="flex w-full"
              options={[
                // حساب في قسم الفتيات حسابُ قائدة
                { value: 'user', label: t(isFeminine(form.section) ? 'section.roleUserF' : 'admin.roleUser') },
                { value: 'admin', label: t('admin.roleAdmin') },
              ]}
            />
          </fieldset>
          <p className="text-xs text-muted-foreground">{t(isSelf ? 'admin.cannotEditSelf' : 'admin.roleHint')}</p>
        </div>

        {form.role === 'user' && (
          <SectionField
            allowBoth
            value={form.section}
            onChange={setSection}
            hint={t(form.section ? 'section.accountHint' : 'section.accountBothHint')}
          />
        )}

        {form.role === 'user' && (
          <div className="space-y-1.5">
            <Label>{t('admin.allowedBranches')}</Label>
            {/* A قسم without فرق yet (the girls' one, at first): say so, instead of a
                label over nothing and a hint about ticks there are none of */}
            {visibleBranches.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                {t('admin.noBranchesInSection')}
              </p>
            ) : (
              <>
                {/* The same toggle chips as the فرق of a نشاط */}
                <div className="flex flex-wrap gap-2" role="group" aria-label={t('admin.allowedBranches')}>
                  {visibleBranches.map((b) => {
                    const on = form.branches.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleBranch(b.id)}
                        className={cn(
                          'focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-[color,background-color,border-color,scale] active:scale-[0.97] sm:min-h-9',
                          on
                            ? 'border-primary bg-primary/10 font-medium text-primary'
                            : 'border-input bg-card text-muted-foreground hover:bg-accent'
                        )}
                      >
                        <IconSwap on={on} onIcon={<IconCheck className="h-3.5 w-3.5" />} className="h-3.5 w-3.5" collapse />
                        {branchName(b, i18n.language)}
                        {/* Both أقسام listed together: say which one each فرقة belongs to */}
                        {!form.section && (
                          <span className="text-xs text-muted-foreground">· {t(`section.${b.section}`)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">{t('admin.branchesHint')}</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* ---------- What the account may do, page by page ---------- */}
      {form.role === 'user' && <PermsEditor perms={form.perms} onChange={(perms) => setForm((f) => ({ ...f, perms }))} />}
    </form>
  );
}

/**
 * One account. Phones: name and actions on the first line, the badges under the name.
 * From sm up: the badges move inline, between the name and the actions.
 */
// I4: what the account's فرق are against the قائد's تشكيلة. 'ok' / 'all' / 'amana' say nothing.
const TACHKILA_ALERTS = ['drift', 'absent', 'archived'];

function UserRow({ u, me, nameOf, onEdit, onDeactivate, onReactivate, onDelete, onAlign, aligning }) {
  const { t } = useTranslation();
  const isSelf = u.id === me.id;
  // The icon buttons say what they do; this tells a screen reader whose account it is
  const nameId = `user-${u.id}-name`;
  return (
    <li
      className={cn(
        'grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto_auto] sm:px-5',
        !u.active && 'opacity-70'
      )}
    >
      <span
        aria-hidden="true"
        className="row-span-2 flex h-10 w-10 shrink-0 items-center justify-center self-start rounded-full bg-secondary text-sm font-semibold text-secondary-foreground sm:row-span-1 sm:self-center"
      >
        {initials(u)}
      </span>
      <div className="min-w-0">
        {/* A long name truncates; «(vous)» stays whole beside it. dir=auto: a Latin
            name in Arabic keeps its start and loses its end, not the other way round */}
        <div className="flex min-w-0 items-baseline gap-2">
          <span id={nameId} dir="auto" className="min-w-0 truncate font-medium">
            {u.display_name || u.username}
          </span>
          {isSelf && <span className="shrink-0 text-xs text-muted-foreground">{t('admin.you')}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-mono" dir="ltr">
            {u.username}
          </span>
          {u.username_legacy && (
            <span className="inline-flex items-center gap-1 text-warning" title={t('admin.usernameLegacyHint')}>
              <IconAlert className="h-3 w-3" />
              {t('admin.usernameLegacy')}
            </span>
          )}
          {u.leader_name && (
            <span className="inline-flex items-center gap-1" title={t('admin.linkedLeader')}>
              <IconKey className="h-3 w-3" />
              {u.leader_name}
            </span>
          )}
        </div>
        {/* The فرق his تشكيلة gives him, next to the button that copies them over */}
        {u.active && u.tachkila_status === 'drift' && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>
              {t('admin.tachkila.inTachkila', { year: u.tachkila_year })}:{' '}
              <span className="font-medium text-foreground">{u.assignment_branch_ids.map(nameOf).join('، ')}</span>
            </span>
            <Button size="sm" variant="outline" loading={aligning} onClick={() => onAlign(u)}>
              <IconRefresh />
              {t('admin.tachkila.align')}
            </Button>
          </div>
        )}
      </div>
      {/* Phones: under the name and the actions both — the badges get the full width */}
      <div className="col-span-2 col-start-2 row-start-2 flex flex-wrap items-center gap-1.5 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:justify-end">
        {!u.active && <Badge variant="destructive">{t('admin.inactive')}</Badge>}
        {u.active && TACHKILA_ALERTS.includes(u.tachkila_status) && (
          <Badge
            variant="warning"
            title={t(`admin.tachkila.${u.tachkila_status}Hint`, { year: u.tachkila_year })}
          >
            <IconAlert className="h-3 w-3" />
            {t(`admin.tachkila.${u.tachkila_status}`)}
          </Badge>
        )}
        {u.role === 'admin' ? (
          <Badge variant="warning">
            <IconShield className="h-3 w-3" />
            {t('admin.roleAdmin')}
          </Badge>
        ) : (
          <>
            <Badge variant={isFeminine(u.section) ? 'info' : 'outline'}>
              {t(u.section ? `section.name${u.section}` : 'section.both')}
            </Badge>
            {u.branches === null ? (
              <Badge variant="outline">{t('admin.allBranches')}</Badge>
            ) : (
              u.branches.map((id) => <Badge key={id}>{nameOf(id)}</Badge>)
            )}
            {u.perms !== null && <Badge variant="secondary">{t('admin.customPerms')}</Badge>}
          </>
        )}
        {u.active && u.must_change_password && (
          <Badge variant="info" title={t('admin.tempPasswordHint')}>
            {t('admin.tempPassword')}
          </Badge>
        )}
      </div>
      <div className="col-start-3 row-start-1 flex gap-0.5 sm:col-start-4">
        {!u.active && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onReactivate(u)}
            aria-label={t('admin.reactivate')}
            aria-describedby={nameId}
            title={t('admin.reactivate')}
          >
            <IconUserCheck className="text-success" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(u)}
          aria-label={t('common.edit')}
          aria-describedby={nameId}
          title={t('common.edit')}
        >
          <IconPencil />
        </Button>
        <Button
          variant="destructive-ghost"
          size="icon"
          disabled={isSelf}
          onClick={() => (u.active ? onDeactivate(u) : onDelete(u))}
          aria-label={t(u.active ? 'admin.deactivate' : 'admin.deletePermanently')}
          aria-describedby={nameId}
          title={t(u.active ? 'admin.deactivate' : 'admin.deletePermanently')}
        >
          <IconTrash />
        </Button>
      </div>
    </li>
  );
}

/** The accounts card while it loads: same rows, so nothing jumps when they arrive. */
function UsersSkeleton() {
  return (
    <Card aria-busy="true" aria-live="polite">
      <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
        <div className="divide-y divide-border">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3 sm:items-center sm:px-5">
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
                {/* Phones: the badges sit under the name */}
                <Skeleton className="h-5 w-24 rounded-full sm:hidden" />
              </div>
              <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
              <Skeleton className="h-10 w-24 shrink-0 sm:h-8 sm:w-20" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Admin() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const { view } = useSection();
  const navigate = useNavigate();
  const users = useFetch('/users');
  // Every فرقة of both أقسام, whatever the switcher says: an account of the other قسم
  // must still be editable from here
  const branches = useFetch('/branches', { section: '' });
  const [editing, setEditing] = useState(null);
  // The account form's save state, here because its buttons sit in the dialog footer
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  // { username, password } right after a creation or a reset — shown exactly once
  const [credentials, setCredentials] = useState(null);
  // 'all' or a user id while «aligner» runs
  const [aligning, setAligning] = useState(null);

  // The badges name the فرق and the form lists them: the page waits for both lists
  const loading = users.loading || branches.loading;
  const failed = !loading && (users.error || branches.error);
  const retry = () => {
    if (users.error) users.reload();
    if (branches.error) branches.reload();
  };

  // The switcher narrows the list too: the accounts of that قسم, plus the admins and
  // the accounts open on both, which belong to either
  const list = (users.data || []).filter(
    (u) => !view || u.role === 'admin' || !u.section || u.section === view
  );
  const activeUsers = list.filter((u) => u.active);
  const inactiveUsers = list.filter((u) => !u.active);
  const branchList = branches.data || [];
  const nameOf = (id) => {
    const b = branchList.find((x) => x.id === id);
    return b ? branchName(b, i18n.language) : id;
  };
  const label = (u) => u.display_name || u.username;
  const drifted = activeUsers.filter((u) => u.tachkila_status === 'drift');
  const outOfTachkila = activeUsers.filter((u) => ['absent', 'archived'].includes(u.tachkila_status));
  const tachkilaYear = activeUsers.find((u) => u.tachkila_year)?.tachkila_year;

  function describe(err) {
    const map = {
      cannot_delete_self: t('admin.cannotDeleteSelf'),
      cannot_edit_self: t('admin.cannotEditSelf'),
      last_admin: t('admin.lastAdmin'),
    };
    return map[err.message] || displayError(err);
  }

  async function deactivate(u) {
    const ok = await confirm({
      title: t('admin.deactivate'),
      message: t('admin.confirmDeactivate', { name: label(u) }),
      confirmLabel: t('admin.deactivate'),
    });
    if (!ok) return;
    try {
      await api.del(`/users/${u.id}`);
      users.reload({ quiet: true });
      toast.success(t('admin.deactivated'));
    } catch (err) {
      toast.error(describe(err));
    }
  }

  async function reactivate(u) {
    try {
      await api.put(`/users/${u.id}`, { active: true });
      users.reload({ quiet: true });
      toast.success(t('admin.reactivated'));
    } catch (err) {
      toast.error(describe(err));
    }
  }

  async function remove(u) {
    const ok = await confirm({
      title: t('admin.deletePermanently'),
      message: t('admin.confirmDeletePermanent', { name: label(u) }),
      confirmLabel: t('admin.deletePermanently'),
    });
    if (!ok) return;
    try {
      await api.del(`/users/${u.id}?permanent=1`);
      users.reload({ quiet: true });
      toast.success(t('admin.deleted'));
    } catch (err) {
      toast.error(describe(err));
    }
  }

  // «Aligner» one account, or every drifted one after a confirmation
  async function align(u) {
    if (!u) {
      const ok = await confirm({
        title: t('admin.tachkila.alertTitle'),
        message: t('admin.tachkila.confirmAlignAll', { count: drifted.length, year: tachkilaYear }),
        confirmLabel: t('admin.tachkila.align'),
      });
      if (!ok) return;
    }
    setAligning(u ? u.id : 'all');
    try {
      const r = await api.post('/users/sync-branches', u ? { ids: [u.id] } : {});
      users.reload({ quiet: true });
      toast.success(
        r.updated ? t('admin.tachkila.aligned', { count: r.updated }) : t('admin.tachkila.alignedNone')
      );
    } catch (err) {
      toast.error(describe(err));
    } finally {
      setAligning(null);
    }
  }

  // Every opening starts clean: no error or spinner left over from the last account
  function openForm(u) {
    setFormError(null);
    setSaving(false);
    setEditing(u);
  }

  const edit = (u) =>
    openForm({
      ...u,
      display_name: u.display_name || '',
      branches: u.branches || [],
      perms: normalizePerms(u.perms),
      section: u.section || '',
    });

  const rowProps = {
    me,
    nameOf,
    onEdit: edit,
    onDeactivate: deactivate,
    onReactivate: reactivate,
    onDelete: remove,
    onAlign: align,
  };

  return (
    <div className="space-y-6">
      {/* The header stays while the list loads or fails; a form opened before the
          فرق arrive would offer none, so the button waits for them */}
      <PageHeader title={t('admin.title')} description={t('admin.subtitle')}>
        <Button variant="outline" onClick={() => navigate('/admin/activity')}>
          <IconTrendingUp />
          {t('activity.title')}
        </Button>
        <Button
          variant="brand"
          disabled={loading || !!failed}
          onClick={() => openForm({ ...EMPTY_USER, section: view || 'M' })}
        >
          <IconPlus />
          {t('admin.addUser')}
        </Button>
      </PageHeader>

      {/* I4: accounts whose فرق no longer match the التشكيلة — wrong access, wrong notifications */}
      {!loading && !failed && (drifted.length > 0 || outOfTachkila.length > 0) && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/35 bg-warning/10 px-4 py-3"
        >
          <IconAlert className="h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-48 flex-1">
            <p className="text-sm font-medium">{t('admin.tachkila.alertTitle')}</p>
            <p className="text-xs text-muted-foreground">
              {t('admin.tachkila.alertBody', { drift: drifted.length, other: outOfTachkila.length })}
            </p>
          </div>
          {drifted.length > 0 && (
            <Button size="sm" variant="outline" loading={aligning === 'all'} onClick={() => align(null)}>
              <IconRefresh />
              {t('admin.tachkila.alignAll', { count: drifted.length })}
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <UsersSkeleton />
      ) : failed ? (
        <ErrorState message={t('error.loadFailed')} onRetry={retry} retryLabel={t('error.retry')} />
      ) : (
        <Card>
          <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
            {activeUsers.length === 0 ? (
              <EmptyState icon={<IconUsers className="h-6 w-6" />} title={t('admin.noUsers')} />
            ) : (
              <ul className="divide-y divide-border">
                {activeUsers.map((u) => (
                  <UserRow key={u.id} u={u} {...rowProps} aligning={aligning === u.id} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && !failed && inactiveUsers.length > 0 && (
        <section className="space-y-2">
          <div className="px-1">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t('admin.inactiveSection')} ({inactiveUsers.length})
            </h2>
            <p className="text-xs text-muted-foreground">{t('admin.inactiveHint')}</p>
          </div>
          <Card>
            <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
              <ul className="divide-y divide-border">
                {inactiveUsers.map((u) => (
                  <UserRow key={u.id} u={u} {...rowProps} />
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Wide enough for the rights in two columns; save stays pinned under the
          scrolling form. An edit opens on the panel, not in the name field: on a phone
          the keyboard would otherwise cover the account being looked at. */}
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `${t('admin.editUser')} — ${label(editing)}` : t('admin.addUser')}
        size="lg"
        autoFocus={!editing?.id}
        footer={
          <div className="space-y-2">
            {formError && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {formError}
              </p>
            )}
            {/* Side by side even on a phone: a pinned footer twice as tall steals the form */}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <Button variant="outline" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" form="user-form" loading={saving}>
                {t(editing?.id ? 'common.save' : 'admin.createUser')}
              </Button>
            </div>
          </div>
        }
      >
        {editing && (
          <UserForm
            key={editing.id ?? 'new'}
            initial={editing}
            branches={branchList}
            isSelf={editing.id === me.id}
            setSaving={setSaving}
            setError={setFormError}
            onSaved={({ quietToast } = {}) => {
              setEditing(null);
              users.reload({ quiet: true });
              if (!quietToast) toast.success(t('common.saved'));
            }}
            onCredentials={setCredentials}
          />
        )}
      </Dialog>

      {/* Closing is the only way to lose the clear-text password: the card says so */}
      <Dialog open={!!credentials} onClose={() => setCredentials(null)} title={t('admin.credentialsTitle')} size="sm">
        {credentials && (
          <Credentials
            username={credentials.username}
            password={credentials.password}
            onClose={() => setCredentials(null)}
          />
        )}
      </Dialog>
    </div>
  );
}
