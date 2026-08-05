import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { fmtDate, branchName } from '../utils';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Avatar,
  Table,
  Th,
  Td,
  EmptyState,
  IconArrow,
  IconTrendingUp,
} from '../components/ui';

export default function Promotions() {
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get('/promotions/pending').then(setPending).catch(console.error);
    api.get('/promotions/history').then(setHistory).catch(console.error);
  }

  useEffect(load, []);

  async function promote(ids) {
    setBusy(true);
    try {
      await api.post('/promotions/validate', { member_ids: ids });
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('promotion.pending')}</h1>
        {pending.length > 0 && (
          <Button disabled={busy} onClick={() => promote(pending.map((p) => p.id))}>
            <IconTrendingUp />
            {t('promotion.promoteAll', { count: pending.length })}
          </Button>
        )}
      </div>

      <Card>
        {pending.length === 0 ? (
          <EmptyState>{t('promotion.noPending')}</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Avatar photo={p.photo} name={`${p.first_name} ${p.last_name}`} />
                <div className="min-w-32 flex-1">
                  <Link to={`/members/${p.id}`} className="font-medium hover:underline">
                    {p.first_name} {p.last_name}
                  </Link>
                  <div className="text-sm text-muted-foreground">
                    {p.age} {t('common.years')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{branchName(p.current_branch, i18n.language)}</Badge>
                  <IconArrow className="text-muted-foreground rtl:rotate-180" />
                  <Badge>{branchName(p.target_branch, i18n.language)}</Badge>
                </div>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => promote([p.id])}>
                  {t('promotion.promote')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('promotion.history')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {history.length === 0 ? (
            <EmptyState>{t('promotion.noHistory')}</EmptyState>
          ) : (
            <Table>
              <thead className="border-b border-border">
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('promotion.member')}</Th>
                  <Th>{t('promotion.oldBranch')}</Th>
                  <Th>{t('promotion.newBranch')}</Th>
                  <Th>{t('session.requirementsShort')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((h) => (
                  <tr key={h.id}>
                    <Td>{fmtDate(h.promoted_at)}</Td>
                    <Td>
                      <Link to={`/members/${h.member_id}`} className="font-medium hover:underline">
                        {h.first_name} {h.last_name}
                      </Link>
                    </Td>
                    <Td>
                      <Badge variant="secondary">
                        {i18n.language === 'ar' ? h.old_name_ar : h.old_name_fr}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge>{i18n.language === 'ar' ? h.new_name_ar : h.new_name_fr}</Badge>
                    </Td>
                    <Td>
                      <Badge variant="warning" title={h.matalib.join(', ')}>
                        {h.matalib.length}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
