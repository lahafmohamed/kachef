import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useBack, useFetch } from '../hooks';
import { fmtDate, branchName } from '../utils';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  ErrorState,
  ProgressBar,
  Select,
  SkeletonPage,
  Table,
  Td,
  Th,
  useToast,
  IconAward,
  IconBack,
  IconCheck,
  IconPhone,
  IconShield,
} from '../components/ui';

export default function LeaderDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const back = useBack('/leaders');
  const toast = useToast();
  const { has } = usePerms();
  // Filling in بطاقة تقدم القائد is its own permission; everyone else reads it
  const canEditCard = has('leaders.progress');
  // '' = the year the server picks (the latest تشكيلة year)
  const [cardYear, setCardYear] = useState('');
  const {
    data: leader,
    setData: setLeader,
    loading,
    error,
    reload,
  } = useFetch(`/leaders/${id}${cardYear ? `?year=${encodeURIComponent(cardYear)}` : ''}`);

  async function toggleMatlab(item) {
    try {
      const card = await api.post(`/leaders/${id}/progress`, {
        year: leader.card.year,
        matlab_id: item.id,
        done: !item.done,
      });
      setLeader((l) => ({ ...l, card }));
      toast.success(t('leader.cardUpdated'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading) return <SkeletonPage rows={4} />;
  if (error)
    return <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />;

  // Group role history by year, newest first
  const byYear = [];
  for (const a of leader.assignments) {
    const g = byYear.find((x) => x.year === a.year);
    if (g) g.roles.push(a);
    else byYear.push({ year: a.year, roles: [a] });
  }

  // بطاقة تقدم القائد for the selected سنة — empty until the مطالب list is filled in
  const card = leader.card || { year: '', total: 0, done_count: 0, items: [] };

  const stats = [
    { value: leader.sessions.length, label: t('leader.sessionsLed'), cls: 'text-primary' },
    { value: leader.attendance?.present ?? 0, label: t('leader.timesPresent'), cls: 'text-success' },
    { value: leader.attendance?.absent ?? 0, label: t('leader.timesAbsent'), cls: 'text-destructive' },
  ];

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={back} className="-ms-2">
        <IconBack className="rtl:rotate-180" />
        {t('common.back')}
      </Button>

      <Card className="overflow-hidden">
        <div className="bg-primary h-1.5" />
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <Avatar
              photo={leader.photo}
              name={`${leader.first_name} ${leader.last_name}`}
              className="h-16 w-16 border-2 border-card text-xl shadow-md sm:h-20 sm:w-20 sm:text-2xl"
            />
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold tracking-tight sm:text-xl">
                {leader.first_name} {leader.last_name}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={leader.status === 'active' ? 'success' : 'secondary'}>
                  {t(leader.status === 'active' ? 'member.active' : 'member.inactive')}
                </Badge>
                {leader.phone && (
                  <a
                    href={`tel:${leader.phone}`}
                    dir="ltr"
                    className="focus-ring flex items-center gap-1.5 rounded tabular-nums text-primary hover:underline"
                  >
                    <IconPhone className="h-3.5 w-3.5" />
                    {leader.phone}
                  </a>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {leader.current_roles.length === 0 ? (
                  <span className="text-sm text-muted-foreground">{t('leader.noRole')}</span>
                ) : (
                  leader.current_roles.map((r) => (
                    <Badge key={r.id} variant={r.role_type === 'branch' ? 'default' : 'warning'}>
                      {r.title}
                    </Badge>
                  ))
                )}
                {leader.year && (
                  <span className="text-xs tabular-nums text-muted-foreground">({leader.year})</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-center sm:bg-transparent sm:p-0">
              {stats.map((s) => (
                <div key={s.label}>
                  <div className={`text-2xl font-bold leading-none tabular-nums sm:text-3xl ${s.cls}`}>
                    {s.value}
                  </div>
                  <div className="mt-1 text-xs leading-tight text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------- فرقة القادة: بطاقة تقدم القائد ---------- */}
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{t('leader.card')}</CardTitle>
              {card.total > 0 && (
                <Badge variant={card.done_count === card.total ? 'success' : 'outline'}>
                  {t('leader.cardProgress', { done: card.done_count, total: card.total })}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(canEditCard ? 'leader.cardHint' : 'leader.cardReadOnly')}
            </p>
          </div>
          {(leader.card_years || []).length > 0 && (
            <Select
              value={card.year}
              onChange={(e) => setCardYear(e.target.value)}
              aria-label={t('leader.cardYear')}
              className="sm:w-auto"
            >
              {leader.card_years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          )}
        </CardHeader>
        <CardContent className="space-y-3 p-0 pb-2">
          {card.total === 0 ? (
            <EmptyState icon={<IconAward className="h-6 w-6" />} title={t('leader.cardEmpty')}>
              {t('leader.cardEmptyHint')}
            </EmptyState>
          ) : (
            <>
              <div className="px-4 sm:px-5">
                <ProgressBar
                  value={Math.round((card.done_count / card.total) * 100)}
                  label={t('leader.card')}
                />
              </div>
              <ul className="divide-y divide-border">
                {card.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                    <button
                      type="button"
                      aria-pressed={item.done}
                      disabled={!canEditCard}
                      onClick={() => toggleMatlab(item)}
                      aria-label={item.label}
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors',
                        item.done
                          ? 'border-success bg-success text-success-foreground'
                          : 'border-border bg-muted text-muted-foreground',
                        canEditCard ? 'focus-ring cursor-pointer' : 'cursor-default'
                      )}
                    >
                      {item.done ? <IconCheck className="h-4 w-4" /> : null}
                    </button>
                    <span className="w-8 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                      {item.number}
                    </span>
                    <span className={cn('flex-1 text-sm', item.done && 'font-medium')}>{item.label}</span>
                    {item.achieved_at && (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {fmtDate(item.achieved_at)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {byYear.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('leader.rolesHistory')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {byYear.map((g) => (
              <div
                key={g.year}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border px-4 py-3"
              >
                <span className="font-semibold tabular-nums" dir="ltr">
                  {g.year}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {g.roles.map((r) => (
                    <Badge key={r.id} variant={r.role_type === 'branch' ? 'default' : 'warning'}>
                      {r.title}
                      {r.branch_id ? ` · ${branchName(r, i18n.language)}` : ''}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* زيارات الأهل this قائد took part in — listed apart from the أنشطة he animated */}
      {leader.visits?.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t('session.familyVisits')}</CardTitle>
            <Badge variant="outline">{leader.visits.length}</Badge>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ul className="divide-y divide-border">
              {leader.visits.map((v) => (
                <li key={v.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link
                      to={`/sessions/${v.id}`}
                      className="focus-ring rounded font-medium hover:text-primary hover:underline"
                    >
                      {v.title}
                    </Link>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {fmtDate(v.date)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge>{branchName(v, i18n.language)}</Badge>
                    <Badge variant={v.role === 'main' ? 'default' : 'secondary'}>
                      {t(v.role === 'main' ? 'session.mainAnimator' : 'session.helper')}
                    </Badge>
                    {v.members?.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {v.members.map((m) => `${m.first_name} ${m.last_name}`).join(' · ')}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('leader.activitiesLed')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {leader.sessions.length === 0 ? (
            <EmptyState icon={<IconShield className="h-6 w-6" />} title={t('leader.noActivities')} />
          ) : (
            <>
              {/* Mobile: stacked rows — the 6-column table is unreadable at 375px */}
              <ul className="divide-y divide-border md:hidden">
                {leader.sessions.map((s) => (
                  <li key={s.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link
                        to={`/sessions/${s.id}`}
                        className="focus-ring rounded font-medium hover:text-primary hover:underline"
                      >
                        {s.title}
                      </Link>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {fmtDate(s.date)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {s.branch_id ? (
                        <Badge>{branchName(s, i18n.language)}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('session.kindLeaders')}</Badge>
                      )}
                      <Badge variant={s.role === 'main' ? 'default' : 'secondary'}>
                        {t(s.role === 'main' ? 'session.mainAnimator' : 'session.helper')}
                      </Badge>
                      {s.my_status && (
                        <Badge variant={s.my_status === 'present' ? 'success' : 'destructive'}>
                          {t(s.my_status === 'present' ? 'session.present' : 'session.absent')}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {s.present_count} {t('session.present')}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              <Table className="hidden md:block">
                <thead className="border-b border-border">
                  <tr>
                    <Th>{t('common.date')}</Th>
                    <Th>{t('session.sessionTitle')}</Th>
                    <Th>{t('member.branch')}</Th>
                    <Th>{t('session.role')}</Th>
                    <Th>{t('session.myPresence')}</Th>
                    <Th>{t('session.present')}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leader.sessions.map((s) => (
                    <tr key={s.id} className="transition-colors hover:bg-accent/40">
                      <Td className="whitespace-nowrap tabular-nums">{fmtDate(s.date)}</Td>
                      <Td>
                        <Link
                          to={`/sessions/${s.id}`}
                          className="focus-ring rounded font-medium hover:text-primary hover:underline"
                        >
                          {s.title}
                        </Link>
                      </Td>
                      <Td>
                        {s.branch_id ? (
                        <Badge>{branchName(s, i18n.language)}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('session.kindLeaders')}</Badge>
                      )}
                      </Td>
                      <Td>
                        <Badge variant={s.role === 'main' ? 'default' : 'secondary'}>
                          {t(s.role === 'main' ? 'session.mainAnimator' : 'session.helper')}
                        </Badge>
                      </Td>
                      <Td>
                        {s.my_status ? (
                          <Badge variant={s.my_status === 'present' ? 'success' : 'destructive'}>
                            {t(s.my_status === 'present' ? 'session.present' : 'session.absent')}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </Td>
                      <Td>
                        <Badge variant="success">{s.present_count}</Badge>
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
