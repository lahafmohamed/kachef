import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBack, useFetch } from '../hooks';
import { fmtDate, branchName, birthdayWhen } from '../utils';
import SearchInput from '../components/SearchInput';
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
  ProgressBar,
  RequirementGrid,
  SkeletonPage,
  Table,
  Td,
  Th,
  IconAlert,
  IconAward,
  IconBack,
  IconCake,
  IconCalendar,
  IconPhone,
  IconPin,
  IconUsers,
} from '../components/ui';

const STATUS_BADGE = {
  present: ['success', 'session.present'],
  absent: ['destructive', 'session.absent'],
  excused: ['warning', 'session.excused'],
};

export default function MemberDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const back = useBack('/members');
  const navigate = useNavigate();
  const [historyQuery, setHistoryQuery] = useState('');
  const { data: member, loading, error, reload } = useFetch(`/members/${id}`);

  if (loading) return <SkeletonPage rows={4} />;
  if (error)
    return <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />;

  const { stats } = member;
  const bday = birthdayWhen(member.birth_date);
  const reqPct = member.branch_total_requirements
    ? Math.min(100, Math.round((stats.requirements_earned / member.branch_total_requirements) * 100))
    : 0;
  // Search the présence log by نشاط title or date (typing "06/2026" narrows to a month)
  const hq = historyQuery.trim().toLowerCase();
  const history = hq
    ? stats.history.filter((h) =>
        [h.title, h.date, fmtDate(h.date)].some((v) => String(v || '').toLowerCase().includes(hq))
      )
    : stats.history;
  const rateTone =
    stats.rate === null ? 'text-foreground' : stats.rate >= 75 ? 'text-success' : stats.rate >= 50 ? 'text-warning' : 'text-destructive';

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={back} className="-ms-2">
        <IconBack className="rtl:rotate-180" />
        {t('common.back')}
      </Button>

      {/* ---------- Identity header ---------- */}
      <Card className="overflow-hidden">
        <div className="bg-brand-gradient h-1.5" />
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex items-center gap-4">
              <Avatar
                photo={member.photo}
                name={`${member.first_name} ${member.last_name}`}
                className="h-16 w-16 border-2 border-card text-xl shadow-md sm:h-20 sm:w-20 sm:text-2xl"
              />
              <div className="min-w-0 flex-1 sm:hidden">
                <h1 className="text-lg font-bold leading-tight">
                  {member.first_name} {member.last_name}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge>{branchName(member, i18n.language)}</Badge>
                  <Badge variant={member.status === 'active' ? 'success' : 'secondary'}>
                    {t(member.status === 'active' ? 'member.active' : 'member.inactive')}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="hidden sm:block">
                <h1 className="text-xl font-bold tracking-tight">
                  {member.first_name} {member.last_name}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge>{branchName(member, i18n.language)}</Badge>
                  <span className="tabular-nums">
                    {member.age} {t('common.years')}
                  </span>
                  <span>· {t(member.sex === 'M' ? 'member.male' : 'member.female')}</span>
                  <Badge variant={member.status === 'active' ? 'success' : 'secondary'}>
                    {t(member.status === 'active' ? 'member.active' : 'member.inactive')}
                  </Badge>
                </div>
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Row icon={<IconCalendar className="h-3.5 w-3.5" />} label={t('member.birthDate')}>
                  <span className="tabular-nums">
                    {fmtDate(member.birth_date)} · {member.age} {t('common.years')}
                  </span>
                </Row>
                <Row icon={<IconCalendar className="h-3.5 w-3.5" />} label={t('member.joinDate')}>
                  <span className="tabular-nums">{fmtDate(member.join_date)}</span>
                </Row>
                {member.birth_place && (
                  <Row icon={<IconPin className="h-3.5 w-3.5" />} label={t('member.birthPlace')}>
                    {member.birth_place}
                  </Row>
                )}
                {member.father_name && (
                  <Row icon={<IconUsers className="h-3.5 w-3.5" />} label={t('member.fatherName')}>
                    {member.father_name}
                  </Row>
                )}
                {member.mother_name && (
                  <Row icon={<IconUsers className="h-3.5 w-3.5" />} label={t('member.motherName')}>
                    {member.mother_name}
                  </Row>
                )}
                {member.address_abidjan && (
                  <Row icon={<IconPin className="h-3.5 w-3.5" />} label={t('member.addressAbidjan')}>
                    {member.address_abidjan}
                  </Row>
                )}
                {member.address_lebanon && (
                  <Row icon={<IconPin className="h-3.5 w-3.5" />} label={t('member.addressLebanon')}>
                    {member.address_lebanon}
                  </Row>
                )}
                {member.member_phone && (
                  <Row icon={<IconPhone className="h-3.5 w-3.5" />} label={t('member.memberPhone')}>
                    <a
                      href={`tel:${member.member_phone}`}
                      dir="ltr"
                      className="focus-ring rounded tabular-nums text-primary hover:underline"
                    >
                      {member.member_phone}
                    </a>
                  </Row>
                )}
                {member.parent_phone && (
                  <Row icon={<IconPhone className="h-3.5 w-3.5" />} label={t('member.parentPhone')}>
                    {/* Tapping a number should place the call on a phone */}
                    <a
                      href={`tel:${member.parent_phone}`}
                      dir="ltr"
                      className="focus-ring rounded tabular-nums text-primary hover:underline"
                    >
                      {member.parent_phone}
                    </a>
                  </Row>
                )}
              </dl>
            </div>

            <div className="flex shrink-0 items-center justify-around gap-6 rounded-lg bg-muted/50 px-4 py-3 sm:flex-col sm:gap-1 sm:bg-transparent sm:px-0 sm:py-0">
              <div className="text-center">
                <div className={`text-3xl font-bold leading-none tabular-nums ${rateTone}`}>
                  {stats.rate !== null ? `${stats.rate}%` : '—'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{t('member.attendanceRate')}</div>
              </div>
              <div className="text-center sm:hidden">
                <div className="text-3xl font-bold leading-none tabular-nums">{stats.present}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t('leader.timesPresent')}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {bday && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg border border-warning/35 bg-warning/10 px-4 py-3 text-sm font-medium text-warning"
        >
          <IconCake className="h-5 w-5 shrink-0" />
          {t(bday === 'today' ? 'birthday.isToday' : 'birthday.isTomorrow', {
            name: member.first_name,
            age: member.age + (bday === 'today' ? 0 : 1),
          })}
        </div>
      )}

      {stats.consecutive_absences >= 3 && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
        >
          <IconAlert className="h-5 w-5 shrink-0" />
          {t('member.consecutiveAbsences', { count: stats.consecutive_absences })}
        </div>
      )}

      {member.branch_total_requirements > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('member.requirementsProgress')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t('member.requirementsOf', {
                earned: Math.min(stats.requirements_earned, member.branch_total_requirements),
                total: member.branch_total_requirements,
              })}
              {' · '}
              <span className="font-medium text-foreground tabular-nums">{reqPct}%</span>
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProgressBar value={reqPct} label={t('member.requirementsProgress')} />
            <RequirementGrid
              total={member.branch_total_requirements}
              selected={stats.earned_numbers}
              label={t('member.requirementsProgress')}
            />
          </CardContent>
        </Card>
      )}

      {member.promotions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('promotion.history')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {member.promotions.map((p) => (
              <details key={p.id} className="group rounded-lg border border-border">
                <summary className="focus-ring flex cursor-pointer select-none list-none flex-wrap items-center gap-2 rounded-lg px-4 py-3 text-sm hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
                  <IconAward className="h-4 w-4 text-primary" />
                  <span className="tabular-nums text-muted-foreground">{fmtDate(p.promoted_at)}</span>
                  <Badge variant="secondary">{i18n.language === 'ar' ? p.old_name_ar : p.old_name_fr}</Badge>
                  <span className="text-muted-foreground rtl:inline-block rtl:rotate-180">→</span>
                  <Badge>{i18n.language === 'ar' ? p.new_name_ar : p.new_name_fr}</Badge>
                  <span className="ms-auto font-medium text-primary tabular-nums">
                    {t('member.requirementsOf', {
                      earned: p.matalib.length,
                      total: p.old_total_requirements,
                    })}
                  </span>
                </summary>
                <div className="border-t border-border p-4">
                  <RequirementGrid total={p.old_total_requirements} selected={p.matalib} />
                </div>
              </details>
            ))}
          </CardContent>
        </Card>
      )}

      {/* زيارات الأهل — kept out of the présence table on purpose: a visit is not an
          activity the عنصر attended, it is something the قادة did for their family. */}
      {member.visits?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('session.familyVisits')}</CardTitle>
            <Badge variant="outline">{member.visits.length}</Badge>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ul className="divide-y divide-border">
              {member.visits.map((v) => (
                <li key={v.session_id}>
                  <Link
                    to={`/sessions/${v.session_id}`}
                    className="focus-ring flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-accent/50 sm:px-5"
                  >
                    <span className="tabular-nums text-sm text-muted-foreground">{fmtDate(v.date)}</span>
                    <span className="flex-1 text-sm font-medium">{v.title}</span>
                    {v.leaders && <span className="text-xs text-muted-foreground">{v.leaders}</span>}
                  </Link>
                </li>
              ))}
            </ul>
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
            <EmptyState icon={<IconCalendar className="h-6 w-6" />} title={t('member.noAttendance')} />
          ) : (
            <>
              <div className="px-4 pb-3 sm:px-5">
                <SearchInput
                  value={historyQuery}
                  onChange={setHistoryQuery}
                  autoFocusHotkey={false}
                  placeholder={t('member.searchHistory')}
                />
              </div>
              {history.length === 0 ? (
                <EmptyState icon={<IconCalendar className="h-6 w-6" />} title={t('common.noResults')} />
              ) : (
                <Table>
                  <thead className="border-b border-border">
                    <tr>
                      <Th>{t('common.date')}</Th>
                      <Th>{t('session.sessionTitle')}</Th>
                      <Th className="text-end">{t('member.status')}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {history.map((h) => {
                      const [variant, key] = STATUS_BADGE[h.status];
                      return (
                        // The whole row opens the نشاط — the title alone is a small target on a phone
                        <tr
                          key={h.session_id}
                          onClick={() => navigate(`/sessions/${h.session_id}`)}
                          className="cursor-pointer transition-colors hover:bg-accent/40"
                        >
                          <Td className="whitespace-nowrap tabular-nums">{fmtDate(h.date)}</Td>
                          <Td>
                            <Link
                              to={`/sessions/${h.session_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="focus-ring rounded font-medium hover:text-primary hover:underline"
                            >
                              {h.title}
                            </Link>
                          </Td>
                          <Td className="text-end">
                            <Badge variant={variant}>{t(key)}</Badge>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ icon, label, children }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
