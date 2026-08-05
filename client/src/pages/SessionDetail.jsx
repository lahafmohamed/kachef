import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
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
  EmptyState,
  IconBack,
  IconAlert,
} from '../components/ui';

const STATUSES = [
  { value: 'present', key: 'session.present', active: 'bg-emerald-600 text-white border-emerald-600' },
  { value: 'absent', key: 'session.absent', active: 'bg-red-600 text-white border-red-600' },
  { value: 'excused', key: 'session.excused', active: 'bg-amber-500 text-white border-amber-500' },
];

export default function SessionDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState(null);

  function load() {
    api.get(`/sessions/${id}`).then(setSession).catch(console.error);
  }

  useEffect(load, [id]);

  async function mark(memberId, status) {
    await api.post(`/sessions/${id}/attendance`, { member_id: memberId, status });
    load();
  }

  if (!session) return <p className="text-muted-foreground">{t('common.loading')}</p>;

  const marked = session.roster.filter((m) => m.status).length;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => history.back()}>
        <IconBack className="rtl:rotate-180" />
        {t('common.back')}
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{session.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{fmtDate(session.date)}</span>
            <Badge>{branchName(session, i18n.language)}</Badge>
            {session.leader && (
              <span>
                {t('session.leader')} : {session.leader}
              </span>
            )}
            {session.fee !== null && (
              <span>
                {t('session.fee')} : {session.fee}
              </span>
            )}
            {session.matalib.length > 0 && (
              <Badge variant="warning">
                {t('session.requirementsShort')} : {session.matalib.join('، ')}
              </Badge>
            )}
          </div>
        </div>
        <Badge variant="outline">
          {t('session.marked', { marked, total: session.roster.length })}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('session.roster')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {session.roster.length === 0 ? (
            <EmptyState>{t('session.emptyRoster')}</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {session.roster.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Avatar photo={m.photo} name={`${m.first_name} ${m.last_name}`} />
                  <div className="min-w-32 flex-1">
                    <span className="font-medium">
                      {m.first_name} {m.last_name}
                    </span>
                    {m.consecutive_absences >= 3 && (
                      <Badge variant="destructive" className="ms-2">
                        <IconAlert className="h-3 w-3" />
                        {t('member.consecutiveAbsences', { count: m.consecutive_absences })}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    {STATUSES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => mark(m.id, s.value)}
                        className={cn(
                          'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                          m.status === s.value
                            ? s.active
                            : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        )}
                      >
                        {t(s.key)}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
