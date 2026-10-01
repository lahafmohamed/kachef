import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth';
import AuthLayout, { AuthHeader } from '../components/AuthLayout';
import {
  Button,
  IconAlert,
  IconClock,
  IconEye,
  IconEyeOff,
  IconSwap,
  Input,
  Label,
  cn,
} from '../components/ui';

/** A failed sign-in, as the message key that tells the leader what to do next. */
function errorKey(err) {
  if (err.message === 'invalid_credentials') return 'auth.badCredentials';
  if (err.status === 429) return 'auth.tooManyAttempts';
  // fetch() rejects with no status when the network is down; 502–504 mean the
  // proxy answered but the app behind it did not
  if (!err.status || [502, 503, 504].includes(err.status)) return 'auth.unreachable';
  return 'auth.loginFailed';
}

export default function Login() {
  const { t, i18n } = useTranslation();
  const { login, endedReason, lastUsername } = useAuth();
  // After an idle sign-out the same leader is usually back: keep the name
  const [username, setUsername] = useState(lastUsername || '');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  // { key, n } — a key so a language switch re-translates it, n so a repeat
  // of the same failure remounts the alert and is announced again
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const passRef = useRef(null);
  const caretRef = useRef(null);
  const rtl = i18n.dir() === 'rtl';

  // Switching the field's type resets its caret to the start, so typing on
  // after a peek would land in front of what is already there. Put it back.
  function toggleReveal() {
    const el = passRef.current;
    if (el && document.activeElement === el) caretRef.current = [el.selectionStart, el.selectionEnd];
    setReveal((v) => !v);
  }
  useLayoutEffect(() => {
    const el = passRef.current;
    const range = caretRef.current;
    if (!el || !range) return;
    caretRef.current = null;
    // Chrome rebuilds the field for its new type at the next layout and drops
    // the caret then; run that layout now so the restore isn't undone
    void el.offsetHeight;
    el.setSelectionRange(...range);
  }, [reveal]);

  // Tells this tab apart from a signed-in one in the tab strip and history
  useEffect(() => {
    const prev = document.title;
    document.title = `${t('auth.title')} · ${t('app.name')}`;
    return () => {
      document.title = prev;
    };
  }, [t]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      const key = errorKey(err);
      setError((prev) => ({ key, n: (prev?.n || 0) + 1 }));
      setBusy(false);
      // A typo in the password is the usual cause: select it for a clean retype
      if (key === 'auth.badCredentials') {
        passRef.current?.focus();
        passRef.current?.select();
      }
    }
  }

  const syncCapsLock = (e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);
  const invalid = error?.key === 'auth.badCredentials' || undefined;
  const describedBy = (...ids) => ids.filter(Boolean).join(' ') || undefined;

  return (
    <AuthLayout>
      <div className="space-y-8">
        <AuthHeader title={t('auth.title')}>{t('auth.subtitle')}</AuthHeader>

        {/* Says why the login screen came back — an idle timeout is not a bug */}
        {endedReason && !error && (
          <div
            role="status"
            className="flex gap-2.5 rounded-lg border border-border bg-card px-3.5 py-3 text-sm text-muted-foreground shadow-xs"
          >
            <IconClock className="mt-0.5 text-primary" />
            <p>{t(endedReason === 'idle' ? 'auth.endedIdle' : 'auth.endedExpired')}</p>
          </div>
        )}

        <form onSubmit={submit} data-auth-form className="space-y-5">
          <div>
            <Label htmlFor="login_user" className="mb-1.5">{t('auth.username')}</Label>
            <Input
              id="login_user"
              name="username"
              required
              autoFocus={!lastUsername}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              enterKeyHint="next"
              dir="ltr"
              aria-invalid={invalid}
              aria-describedby={describedBy(invalid && 'login_error')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                // Return on the first field moves on instead of failing validation
                if (e.key === 'Enter' && !password) {
                  e.preventDefault();
                  passRef.current?.focus();
                }
              }}
              className="sm:h-11"
            />
          </div>

          <div>
            <Label htmlFor="login_pass" className="mb-1.5">{t('auth.password')}</Label>
            <div className="relative">
              <Input
                id="login_pass"
                ref={passRef}
                name="password"
                type={reveal ? 'text' : 'password'}
                required
                autoFocus={!!lastUsername}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                enterKeyHint="go"
                dir="ltr"
                aria-invalid={invalid}
                aria-describedby={describedBy(capsLock && 'login_caps', invalid && 'login_error')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={syncCapsLock}
                onKeyUp={syncCapsLock}
                onBlur={() => setCapsLock(false)}
                // The field is always LTR but the toggle follows the page, so
                // its clearance goes on whichever physical side the toggle is
                className={cn('sm:h-11', rtl ? 'pl-12' : 'pr-12')}
              />
              <button
                type="button"
                aria-label={t('auth.showPassword')}
                aria-pressed={reveal}
                aria-controls="login_pass"
                // Keep focus (and the phone keyboard) in the field while peeking;
                // Tab still reaches the button for keyboard users
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggleReveal}
                className="focus-ring absolute inset-y-0 end-0 flex w-11 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
              >
                <IconSwap on={reveal} onIcon={<IconEyeOff />} offIcon={<IconEye />} />
              </button>
            </div>
            {/* Live, not just described-by: Caps Lock usually goes on mid-word,
                long after the field announced its description */}
            <div aria-live="polite">
              {capsLock && (
                <p id="login_caps" className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warning">
                  <IconAlert className="h-3.5 w-3.5" />
                  {t('auth.capsLock')}
                </p>
              )}
            </div>
          </div>

          {error && (
            <div
              key={error.n}
              id="login_error"
              role="alert"
              className="animate-fade-up flex gap-2.5 rounded-lg bg-destructive/10 px-3.5 py-3 text-sm font-medium text-destructive"
            >
              <IconAlert className="mt-0.5" />
              <p>{t(error.key)}</p>
            </div>
          )}

          <Button type="submit" variant="brand" className="w-full sm:h-11" loading={busy}>
            {t(busy ? 'auth.signingIn' : 'auth.signIn')}
          </Button>
        </form>

        {/* There is no self-service reset: say who can do it, below a rule so
            it reads as help for the form rather than part of it */}
        <div className="border-t border-border pt-6 text-sm">
          <p className="font-medium text-foreground">{t('auth.forgotTitle')}</p>
          <p className="mt-1 text-muted-foreground">{t('auth.forgotBody')}</p>
        </div>
      </div>
    </AuthLayout>
  );
}
