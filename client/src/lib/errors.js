import i18n from '../i18n';

const RECOVERY_KEYS = {
  'invalid phone': 'member.errPhone',
  'invalid birth_date': 'member.errBirthDate',
  'password too short': 'admin.passwordTooShort',
  invalid_credentials: 'auth.badCredentials',
  invalid_current_password: 'auth.badCurrentPassword',
  forbidden: 'error.forbidden',
  unauthorized: 'error.forbidden',
  admin_only: 'error.forbidden',
  insufficient_permissions: 'error.forbidden',
  not_found: 'error.missing',
  'not found': 'error.missing',
  network: 'error.network',
};

// Domain handlers keep the original Error and its code. Only the final displayed
// copy is translated, so detailed field-specific recovery still wins.
export function displayError(errorOrMessage) {
  const error = typeof errorOrMessage === 'object' && errorOrMessage ? errorOrMessage : null;
  const message = typeof errorOrMessage === 'string' ? errorOrMessage : error?.message;
  const code = error?.code || message;
  const known = Object.hasOwn(RECOVERY_KEYS, code)
    ? RECOVERY_KEYS[code]
    : Object.hasOwn(RECOVERY_KEYS, message) ? RECOVERY_KEYS[message] : null;
  if (known) return i18n.t(known);
  if (error?.network) return i18n.t('error.network');
  if (error?.status === 403 || error?.status === 401) return i18n.t('error.forbidden');
  if (error?.status === 404) return i18n.t('error.missing');
  if (error?.status >= 400) return i18n.t('error.requestFailed');
  if (typeof message !== 'string' || !message.trim()) return i18n.t('error.requestFailed');

  const text = message.trim();
  if (/\bnot found$/i.test(text)) return i18n.t('error.missing');
  // API validation codes use snake_case or short English phrases. Browser
  // exceptions are technical too; neither tells a French/Arabic reader a fix.
  const technical = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/i.test(text)
    || /^(?:invalid|unknown|unsupported|missing|already|cannot|no|too many|more than|nothing to)\b.*$/i.test(text)
    || /\brequired(?: for .*)?$/i.test(text)
    || /^(?:before opening|not owed|not paid|text too long|duplicate .+|write failed|network error|failed to fetch|failed to .+|load failed|typeerror\b.*|syntaxerror\b.*|internal server error|bad request|bad gateway|service unavailable|gateway timeout|unprocessable entity|too many requests|not acceptable|payload too large|request timeout|not implemented)$/i.test(text);
  return technical ? i18n.t('error.requestFailed') : message;
}
