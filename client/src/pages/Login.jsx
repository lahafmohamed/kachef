import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth';
import { Button, Card, CardContent, Input, Label } from '../components/ui';

export default function Login() {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message === 'invalid_credentials' ? t('auth.badCredentials') : err.message);
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center p-4">
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

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login_user">{t('auth.username')}</Label>
              <Input
                id="login_user"
                required
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                dir="ltr"
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
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
            className="focus-ring mx-auto block rounded text-xs text-muted-foreground hover:text-foreground"
          >
            {i18n.language === 'ar' ? 'Français' : 'العربية'}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
