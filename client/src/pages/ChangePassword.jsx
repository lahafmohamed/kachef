import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../auth';
import AuthLayout, { AuthHeader } from '../components/AuthLayout';
import { Button, Dialog, Input, Label, IconLogout, useToast } from '../components/ui';

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Current password + new password twice. Used full-screen after a first login
 * with a generated password (the server refuses every data request until it is
 * replaced), and inside a dialog from the user menu the rest of the time.
 */
export function ChangePasswordForm({ onDone, submitLabel }) {
  const { t } = useTranslation();
  const { updateUser } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (next.length < MIN_PASSWORD_LENGTH) return setError(t('auth.passwordTooShort', { n: MIN_PASSWORD_LENGTH }));
    if (next !== again) return setError(t('auth.passwordMismatch'));
    if (next === current) return setError(t('auth.passwordSame'));
    setBusy(true);
    try {
      const u = await api.post('/auth/change-password', { current_password: current, new_password: next });
      updateUser(u);
      onDone?.();
    } catch (err) {
      const map = {
        invalid_current_password: t('auth.badCurrentPassword'),
        'password too short': t('auth.passwordTooShort', { n: MIN_PASSWORD_LENGTH }),
      };
      setError(map[err.message] || err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pw_current">{t('auth.currentPassword')}</Label>
        <Input
          id="pw_current"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          dir="ltr"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw_new">{t('auth.newPassword')}</Label>
        <Input
          id="pw_new"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          dir="ltr"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('auth.passwordRule', { n: MIN_PASSWORD_LENGTH })}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw_again">{t('auth.newPasswordAgain')}</Label>
        <Input
          id="pw_again"
          type="password"
          required
          autoComplete="new-password"
          dir="ltr"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="brand" loading={busy} className="w-full">
        {submitLabel || t('common.save')}
      </Button>
    </form>
  );
}

/** Full-screen gate shown instead of the app while must_change_password is set.
 *  It follows the sign-in screen directly, so it keeps the same frame. */
export default function ChangePasswordGate() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const toast = useToast();
  return (
    <AuthLayout>
      <div className="space-y-8">
        <AuthHeader title={t('auth.firstLoginTitle')}>
          {t('auth.firstLoginBody', { name: user.display_name || user.username })}
        </AuthHeader>
        <ChangePasswordForm
          submitLabel={t('auth.setPassword')}
          onDone={() => toast.success(t('auth.passwordChanged'))}
        />
        <Button variant="ghost" size="sm" onClick={() => logout(null)} className="w-full gap-2">
          <IconLogout />
          {t('auth.signOut')}
        </Button>
      </div>
    </AuthLayout>
  );
}

/** The same form in a dialog, for a voluntary change from the user menu. */
export function ChangePasswordDialog({ open, onClose }) {
  const { t } = useTranslation();
  const toast = useToast();
  return (
    <Dialog open={open} onClose={onClose} title={t('auth.changePassword')} size="sm">
      {open && (
        <ChangePasswordForm
          onDone={() => {
            toast.success(t('auth.passwordChanged'));
            onClose();
          }}
        />
      )}
    </Dialog>
  );
}
