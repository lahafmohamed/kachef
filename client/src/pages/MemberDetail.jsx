import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { fmtDate, branchName } from '../utils';
import {
  cn,
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
  IconBack,
  IconAlert,
} from '../components/ui';

const STATUS_BADGE = {
  present: ['success', 'session.present'],
  absent: ['destructive', 'session.absent'],
  excused: ['warning', 'session.excused'],
};

export default function MemberDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const [member, setMember] = useState(null);

  useEffect(() => {
    api.get(`/members/${id}`).then(setMember).catch(console.error);
  }, [id]);

  if (!member) return <p className="text-muted-foreground">{t('common.loading')}</p>;

  const { stats } = member;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => history.back()}>
        <IconBack className="rtl:rotate-180" />
        {t('common.back')}
      </Button>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <Avatar
            photo={member.photo}
            name={`${member.first_name} ${member.last_name}`}
            className="h-16 w-16 text-base"
          />
          <div className="flex-1">
            <h1 className="text-xl font-bold">
              {member.first_name} {member.last_name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge>{branchName(member, i18n.language)}</Badge>
              <span>
                {member.age} {t('common.years')}
              </span>
              <span>· {t(member.sex === 'M' ? 'member.male' : 'member.female')}</span>
              <Badge variant={member.status === 'active' ? 'success' : 'secondary'}>
                {t(member.status === 'active' ? 'member.active' : 'member.inactive')}
              </Badge>
            </div>
            <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
              <span>
                {t('member.birthDate')} : {fmtDate(member.birth_date)}
              </span>
              <span>
                {t('member.joinDate')} : {fmtDate(member.join_date)}
              </span>
              {member.parent_phone && (
                <span>
                  {t('member.parentPhone')} : <span dir="ltr">{member.parent_phone}</span>
                </span>
              )}
            </div>
          </div>
          <div className="text-center">
            <div className="bg-gradient-to-r from-emerald-700 to-teal-500 bg-clip-text text-3xl font-bold text-transparent">
              {stats.rate !== null ? `${stats.rate}%` : '—'}
            </div>
            <div className="text-xs text-muted-foreground">{t('member.attendanceRate')}</div>
          </div>
        </CardContent>
      </Card>

      {member.branch_total_requirements > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('member.requirementsProgress')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t('member.requirementsOf', {
                earned: Math.min(stats.requirements_earned, member.branch_total_requirements),
                total: member.branch_total_requirements,
              })}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-teal-400 transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round((stats.requirements_earned / member.branch_total_requirements) * 100)
                  )}%`,
                }}
              />
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1">
              {Array.from({ length: member.branch_total_requirements }, (_, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex h-8 items-center justify-center rounded border text-[0.65rem] font-medium',
                    stats.earned_numbers.includes(i + 1)
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-border bg-muted text-muted-foreground'
                  )}
                >
                  {i + 1}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {stats.consecutive_absences >= 3 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          <IconAlert />
          {t('member.consecutiveAbsences', { count: stats.consecutive_absences })}
        </div>
      )}

      {member.promotions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('promotion.history')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {member.promotions.map((p) => (
              <details key={p.id} className="rounded-lg border border-border">
                <summary className="flex cursor-pointer select-none list-none flex-wrap items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="text-muted-foreground">{fmtDate(p.promoted_at)}</span>
                  <Badge variant="secondary">
                    {i18n.language === 'ar' ? p.old_name_ar : p.old_name_fr}
                  </Badge>
                  <span className="text-muted-foreground rtl:inline-block rtl:rotate-180">→</span>
                  <Badge>{i18n.language === 'ar' ? p.new_name_ar : p.new_name_fr}</Badge>
                  <span className="ms-auto font-medium text-emerald-700">
                    {t('member.requirementsOf', {
                      earned: p.matalib.length,
                      total: p.old_total_requirements,
                    })}
                  </span>
                </summary>
                <div className="border-t border-border p-4">
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1">
                    {Array.from({ length: p.old_total_requirements }, (_, i) => (
                      <div
                        key={i}
                        className={cn(
                          'flex h-8 items-center justify-center rounded border text-[0.65rem] font-medium',
                          p.matalib.includes(i + 1)
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-border bg-muted text-muted-foreground'
                        )}
                      >
                        {i + 1}
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('member.attendanceHistory')}</CardTitle>
          {stats.total > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('member.sessionsAttended', { present: stats.present, total: stats.total })}
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {stats.history.length === 0 ? (
            <EmptyState>{t('member.noAttendance')}</EmptyState>
          ) : (
            <Table>
              <thead className="border-b border-border">
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('session.sessionTitle')}</Th>
                  <Th>{t('member.status')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stats.history.map((h) => {
                  const [variant, key] = STATUS_BADGE[h.status];
                  return (
                    <tr key={h.session_id}>
                      <Td>{fmtDate(h.date)}</Td>
                      <Td>
                        <Link to={`/sessions/${h.session_id}`} className="hover:underline">
                          {h.title}
                        </Link>
                      </Td>
                      <Td>
                        <Badge variant={variant}>{t(key)}</Badge>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
