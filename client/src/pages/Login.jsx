import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth';
import { Button, Card, CardContent, Input, Label } from '../components/ui';

export default function Login() {
  const { t, i18n } = useTranslation();
  const { login, endedReason } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const userRef = useRef(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message === 'invalid_credentials' ? t('auth.badCredentials') : err.message);
      setBusy(false);
      // Land the caret back where the correction starts instead of on a dead submit
      userRef.current?.focus();
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-5 p-6 sm:p-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <img
              src="/logo.png"
              alt={t('app.name')}
              width={96}
              height={96}
              className="h-24 w-24 object-cover object-[50%_18%]"
            />
            <h1 className="text-xl font-bold tracking-tight text-primary">{t('app.name')}</h1>
            <p className="text-sm text-muted-foreground">{t('auth.subtitle')}</p>
          </div>

          {/* Says why the login screen came back — an idle timeout is not a bug */}
          {endedReason && !error && (
            <p
              role="status"
              className="rounded-lg bg-muted px-3 py-2 text-center text-sm text-muted-foreground"
            >
              {t(endedReason === 'idle' ? 'auth.endedIdle' : 'auth.endedExpired')}
            </p>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login_user">{t('auth.username')}</Label>
              <Input
                id="login_user"
                ref={userRef}
                required
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                dir="ltr"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'login_error' : undefined}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login_pass">{t('auth.password')}</Label>
              <Input
                id="login_pass"
                type="password"
                required
                autoComplete="current-password"
                dir="ltr"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'login_error' : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p id="login_error" role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" variant="brand" className="w-full" loading={busy}>
              {t('auth.signIn')}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => i18n.changeLanguage(i18n.language === 'ar' ? 'fr' : 'ar')}
            className="focus-ring mx-auto flex min-h-11 items-center rounded px-4 text-sm text-muted-foreground hover:text-foreground sm:min-h-9 sm:text-xs"
          >
            {i18n.language === 'ar' ? 'Français' : 'العربية'}
          </button>
        </CardContent>
      </Card>
    </main>
  );
}
