import { useTranslation } from 'react-i18next';
import { Button, useToast } from './ui';

/**
 * The one-time reveal of a generated password. The clear text never comes back
 * from the server again, so this card is the only chance to copy or dictate it.
 */
export default function Credentials({ username, password, onClose, notice }) {
  const { t } = useTranslation();
  const toast = useToast();

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(`${username}\n${password}`);
      toast.success(t('leader.accountCopied'));
    } catch {
      toast.error(t('error.loadFailed'));
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{notice || t('leader.accountPasswordOnce')}</p>
      <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-4" dir="ltr">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-muted-foreground">{t('auth.username')}</span>
          <span className="select-all font-medium">{username}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-muted-foreground">{t('auth.password')}</span>
          <span className="select-all font-mono text-lg font-semibold tracking-wide">{password}</span>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={copyAll}>
          {t('leader.accountCopy')}
        </Button>
        <Button variant="brand" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </div>
  );
}
