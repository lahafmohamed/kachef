import { displayError } from '../lib/errors';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../auth';
import AuthLayout, { AuthHeader } from '../components/AuthLayout';
import { Button, Dialog, Input, Label, IconAlert, IconLogout, useToast } from '../components/ui';

export const MIN_PASSWORD_LENGTH = 10;

/** A refused change, as the message key and the field the leader has to fix. */
function serverProblem(err) {
  if (err.message === 'invalid_current_password') return { key: 'auth.badCurrentPassword', field: 'current' };
  if (err.message === 'password too short') return { key: 'auth.passwordTooShort', field: 'next' };
  // fetch() rejects with no status when the network is down; 502–504 mean the
  // proxy answered but the app behind it did not
  if (!err.status || [502, 503, 504].includes(err.status)) return { key: 'auth.unreachable' };
  return { text: displayError(err) };
}

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
  // { key | text, field, n }: a key so a language switch re-translates it, the
  // field it is about, n so a repeat remounts the alert and is announced again
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fieldRefs = { current: useRef(null), next: useRef(null), again: useRef(null) };

  // Says what is wrong and puts the caret in the field to fix, its text
  // selected so the retype replaces it
  function fail(problem) {
    setError((prev) => ({ ...problem, n: (prev?.n || 0) + 1 }));
    const el = fieldRefs[problem.field]?.current;
    el?.focus();
    el?.select();
  }

  async function submit(e) {
    e.preventDefault();
    if (next.length < MIN_PASSWORD_LENGTH) return fail({ key: 'auth.passwordTooShort', field: 'next' });
    if (next !== again) return fail({ key: 'auth.passwordMismatch', field: 'again' });
    if (next === current) return fail({ key: 'auth.passwordSame', field: 'next' });
    setError(null);
    setBusy(true);
    try {
      const u = await api.post('/auth/change-password', { current_password: current, new_password: next });
      updateUser(u);
      onDone?.();
    } catch (err) {
      setBusy(false);
      fail(serverProblem(err));
    }
  }

  const invalid = (field) => error?.field === field || undefined;
  const describedBy = (...ids) => ids.filter(Boolean).join(' ') || undefined;

  return (
    // data-auth-form: the current password is where a saved one gets autofilled
    <form onSubmit={submit} data-auth-form className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pw_current">{t('auth.currentPassword')}</Label>
        <Input
          id="pw_current"
          ref={fieldRefs.current}
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          dir="ltr"
          aria-invalid={invalid('current')}
          aria-describedby={describedBy(invalid('current') && 'pw_error')}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw_new">{t('auth.newPassword')}</Label>
        <Input
          id="pw_new"
          ref={fieldRefs.next}
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          dir="ltr"
          aria-invalid={invalid('next')}
          aria-describedby={describedBy('pw_rule', invalid('next') && 'pw_error')}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <p id="pw_rule" className="text-xs text-muted-foreground">
          {t('auth.passwordRule', { n: MIN_PASSWORD_LENGTH })}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw_again">{t('auth.newPasswordAgain')}</Label>
        <Input
          id="pw_again"
          ref={fieldRefs.again}
          type="password"
          required
          autoComplete="new-password"
          dir="ltr"
          aria-invalid={invalid('again')}
          aria-describedby={describedBy(invalid('again') && 'pw_error')}
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </div>
      {/* Same alert as the sign-in screen this one follows */}
      {error && (
        <div
          key={error.n}
          id="pw_error"
          role="alert"
          className="animate-fade-up flex gap-2.5 rounded-lg bg-destructive/10 px-3.5 py-3 text-sm font-medium text-destructive"
        >
          <IconAlert className="mt-0.5" />
          <p>{error.key ? t(error.key, { n: MIN_PASSWORD_LENGTH }) : error.text}</p>
        </div>
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
