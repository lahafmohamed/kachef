import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFetch } from '../hooks';
import { avatarName, branchName, memberName } from '../utils';
import { Avatar, Badge, Button, Card } from './ui';

/** Bug 8: the عناصر the ترفيع list cannot see, for want of a birth date. */
export function MissingBirthDates({ branch }) {
  const { t, i18n } = useTranslation();
  const { data } = useFetch('/promotions/missing-birth-date');
  const [open, setOpen] = useState(false);
  const list = (data || []).filter((m) => !branch || String(m.branch_id) === String(branch));
  if (!list.length) return null;
  const shown = open ? list : list.slice(0, 5);
  return (
    <Card id="missing-birth-date">
      <div className="space-y-1 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">{t('admission.missingBirthTitle')}</h2>
          <Badge variant="warning">{list.length}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t('admission.missingBirthHint')}</p>
      </div>
      <ul className="divide-y divide-border">
        {shown.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            <Avatar photo={m.photo} name={avatarName(m)} className="h-8 w-8 bg-secondary text-secondary-foreground" />
            <Link
              to={`/members/${m.id}?tab=profile`}
              dir="auto"
              className="focus-ring min-w-0 flex-1 truncate rounded-sm text-sm font-medium hover:text-primary hover:underline"
            >
              {memberName(m)}
            </Link>
            <bdi className="shrink-0 text-xs text-muted-foreground">
              {branchName({ name_fr: m.branch_name_fr, name_ar: m.branch_name_ar }, i18n.language)}
            </bdi>
          </li>
        ))}
      </ul>
      {list.length > 5 && (
        <div className="border-t border-border px-4 py-2 sm:px-5">
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? t('admission.showLess') : t('admission.showAll', { count: list.length })}
          </Button>
        </div>
      )}
    </Card>
  );
}
