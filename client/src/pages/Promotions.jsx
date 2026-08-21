import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useFetch } from '../hooks';
import { avatarName, branchName, fmtDate, memberName } from '../utils';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  useConfirm,
  useToast,
  IconArrow,
  IconAward,
  IconSparkles,
  IconTrendingUp,
} from '../components/ui';

export default function Promotions() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  // View-only accounts see who is due for promotion but cannot apply it
  const { has } = usePerms();
  const editable = has('promotions.apply');
  const pending = useFetch('/promotions/pending');
  const history = useFetch('/promotions/history');
  const [busy, setBusy] = useState(null); // null | 'all' | member id

  const pendingList = pending.data || [];
  const historyList = history.data || [];

  async function promote(ids, key) {
    const many = ids.length > 1;
    if (
      !(await confirm({
        title: t('promotion.promote'),
        message: t(many ? 'promotion.confirmAll' : 'promotion.confirmOne', { count: ids.length }),
        destructive: false,
        confirmLabel: t('promotion.promote'),
      }))
    )
      return;

    setBusy(key);
    try {
      await api.post('/promotions/validate', { member_ids: ids });
      pending.reload({ quiet: true });
      history.reload({ quiet: true });
      toast.success(t('promotion.promoted', { count: ids.length }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('promotion.pending')} description={t('promotion.subtitle')}>
        {editable && pendingList.length > 0 && (
          <Button
            variant="brand"
            loading={busy === 'all'}
            disabled={!!busy}
            onClick={() => promote(pendingList.map((p) => p.id), 'all')}
          >
            <IconTrendingUp />
            {t('promotion.promoteAll', { count: pendingList.length })}
          </Button>
        )}
      </PageHeader>

      {pending.error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={pending.reload} retryLabel={t('error.retry')} />
      ) : pending.loading ? (
        <Card className="divide-y divide-border">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </Card>
      ) : (
        <Card>
          {pendingList.length === 0 ? (
            <EmptyState
              icon={<IconSparkles className="h-6 w-6 text-success" />}
              title={t('promotion.noPending')}
            >
              {t('promotion.noPendingHint')}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {pendingList.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <Avatar photo={p.photo} name={avatarName(p)} />
                  <div className="min-w-32 flex-1">
                    <Link
                      to={`/members/${p.id}`}
                      className="focus-ring rounded font-medium hover:text-primary hover:underline"
                    >
                      {memberName(p)}
                    </Link>
                    <div className="text-sm tabular-nums text-muted-foreground">
                      {p.age} {t('common.years')}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="secondary">{branchName(p.current_branch, i18n.language)}</Badge>
                    <IconArrow className="shrink-0 text-muted-foreground rtl:rotate-180" />
                    <Badge variant="solid">{branchName(p.target_branch, i18n.language)}</Badge>
                  </div>
                  {editable && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busy === p.id}
                      disabled={!!busy}
                      onClick={() => promote([p.id], p.id)}
                      className="w-full sm:w-auto"
                    >
                      {t('promotion.promote')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('promotion.history')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {history.error ? (
            <div className="px-4 py-2">
              <ErrorState message={t('error.loadFailed')} onRetry={history.reload} retryLabel={t('error.retry')} />
            </div>
          ) : history.loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 p-4">
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : historyList.length === 0 ? (
            <EmptyState icon={<IconAward className="h-6 w-6" />} title={t('promotion.noHistory')} />
          ) : (
            <>
              {/* Mobile: one row per promotion, stacked */}
              <ul className="divide-y divide-border md:hidden">
                {historyList.map((h) => (
                  <li key={h.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link
                        to={`/members/${h.member_id}`}
                        className="focus-ring rounded font-medium hover:text-primary hover:underline"
                      >
                        {memberName(h)}
                      </Link>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {fmtDate(h.promoted_at)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary">
                        {i18n.language === 'ar' ? h.old_name_ar : h.old_name_fr}
                      </Badge>
                      <IconArrow className="h-3.5 w-3.5 text-muted-foreground rtl:rotate-180" />
                      <Badge>{i18n.language === 'ar' ? h.new_name_ar : h.new_name_fr}</Badge>
                      <Badge variant="warning">
                        {h.matalib.length} {t('session.requirementsShort')}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>

              <Table className="hidden md:block">
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
                  {historyList.map((h) => (
                    <tr key={h.id} className="transition-colors hover:bg-accent/40">
                      <Td className="whitespace-nowrap tabular-nums">{fmtDate(h.promoted_at)}</Td>
                      <Td>
                        <Link
                          to={`/members/${h.member_id}`}
                          className="focus-ring rounded font-medium hover:text-primary hover:underline"
                        >
                          {memberName(h)}
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
