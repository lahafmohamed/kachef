import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePerms } from '../auth';
import { fmtAmount, todayISO } from '../utils';
import {
  KIND_BADGE,
  PAY_BADGE,
  chiefLabel,
  dayNumber,
  dueOf,
  eventPhase,
  fmtDateRange,
  fmtMonthShort,
  payState,
  staffRoleLabel,
} from '../lib/events';
import { Badge, Card, EmptyState, ErrorState, Skeleton, IconCoins, IconShield, IconTent } from './ui';

/**
 * المخيمات و الدورات في ملفّ عنصر أو قائد: كل مخيم شارك فيه — و للقائد ما كان قائده
 * المسؤول أو تولّى فيه مسؤولية (أمين السر، قائد التجمع…) — بأيامه، و حضوره في جلساته، و
 * دفعه لمن يرى المبالغ. `feminine` يؤنّث
 * الأفعال و الصفات (عنصر من الفتيات، قائدة).
 */
export default function EventParticipations({ state, feminine = false }) {
  const { t, i18n } = useTranslation();
  const { has } = usePerms();
  const canFees = has('sessions.read.fees');
  const lang = i18n.language;
  // The feminine Arabic wording when there is one; French and the rest fall back to the plain key
  const tg = (key, opts) => t(feminine ? [`${key}F`, key] : key, opts);
  const today = todayISO();

  if (state.loading)
    return (
      <Card className="space-y-4 p-4 sm:p-5">
        {[0, 1].map((i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-10 w-11" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </Card>
    );
  if (state.error)
    return <ErrorState message={t('error.loadFailed')} onRetry={state.reload} retryLabel={t('error.retry')} />;

  const rows = state.data || [];
  if (rows.length === 0)
    return (
      <Card>
        <EmptyState icon={<IconTent className="h-6 w-6" />} title={t('event.noParticipations')}>
          {t('event.noParticipationsHint')}
        </EmptyState>
      </Card>
    );

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {rows.map((e) => {
          const days = dayNumber(e, e.end_date);
          const phase = eventPhase(e, today);
          const meta = [
            `${fmtDateRange(e.start_date, e.end_date)}${days > 1 ? ` · ${t('event.dayCount', { count: days })}` : ''}`,
            e.place,
          ].filter(Boolean);
          const joined = e.participant_id !== null;
          // Paid or not only where an amount is asked, or money was recorded anyway
          const payKey =
            joined && canFees && (e.fee > 0 || e.paid !== null || e.amount_due !== null) ? payState(e, e) : null;
          const pay = payKey && {
            paid: fmtAmount(e.paid),
            partial: `${fmtAmount(e.paid)} / ${fmtAmount(dueOf(e, e))}`,
            unpaid: tg('event.notPaid'),
            exempt: tg('event.exempt'),
          }[payKey];
          return (
            <li key={e.id}>
              <Link
                to={`/events/${e.id}`}
                className="focus-ring group grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-accent/40 focus-visible:[outline-offset:-2px]! sm:grid-cols-[3.25rem_minmax(0,1fr)_auto] sm:items-center sm:px-5"
              >
                <div className="self-start text-center">
                  <span aria-hidden="true" className="block text-2xl font-semibold leading-none tabular-nums">
                    {Number(e.start_date.slice(8, 10))}
                  </span>
                  <span aria-hidden="true" className="mt-1 block text-xs text-muted-foreground">
                    {fmtMonthShort(e.start_date, lang)}
                  </span>
                </div>

                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold group-hover:text-primary">{e.title}</span>
                    <Badge variant={KIND_BADGE[e.kind]}>{t(`event.kind_${e.kind}`)}</Badge>
                    {phase === 'ongoing' && (
                      <Badge variant="success">{t('event.todayIsDay', { n: dayNumber(e, today), total: days })}</Badge>
                    )}
                    {phase === 'upcoming' && (
                      <Badge variant="outline">{t('event.startsIn', { count: 1 - dayNumber(e, today) })}</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{meta.join(' · ')}</p>
                </div>

                {/* His part in it: in charge, how many جلسات he attended, what he paid */}
                {(e.is_responsible || e.roles?.length > 0 || e.marked > 0 || pay) && (
                  <div className="col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-3 sm:justify-end">
                    {e.is_responsible && (
                      <Badge variant="info">
                        <IconShield className="h-3 w-3" />
                        {chiefLabel(t, e.kind, e.section)}
                      </Badge>
                    )}
                    {(e.roles || []).map((r, i) => (
                      <Badge key={`${r.role}-${i}`} variant="info">
                        {staffRoleLabel(t, r.role, r.title, e.section)}
                      </Badge>
                    ))}
                    {e.marked > 0 && (
                      <Badge variant="outline" className="tabular-nums">
                        {tg('event.attended', { present: e.present, total: e.marked })}
                      </Badge>
                    )}
                    {pay && (
                      <Badge variant={PAY_BADGE[payKey]}>
                        {(payKey === 'paid' || payKey === 'partial') && <IconCoins className="h-3 w-3" />}
                        <span className="tabular-nums">{pay}</span>
                      </Badge>
                    )}
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
