import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth, usePerms } from '../auth';
import { useBack, useFetch } from '../hooks';
import ExportPdfButton from '../components/ExportPdfButton';
import { branchName, fmtDate, fmtTime } from '../utils';
import PrepCardForm from '../components/PrepCardForm';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  ErrorState,
  SkeletonPage,
  useConfirm,
  useToast,
  IconBack,
  IconCalendar,
  IconClock,
  IconPencil,
  IconPin,
  IconShield,
  IconTrash,
} from '../components/ui';

// created_at / updated_at are UTC "YYYY-MM-DD HH:MM:SS" — show the local date
const stampDate = (v) => (v ? fmtDate(v.slice(0, 10)) : '');

/**
 * بطاقة تحضير واحدة كما كتبها القائد: الترويسة (العنوان، الزمان، المكان، الفرقة،
 * المُعدّ، المطالب) ثم الأقسام النصية — قسمٌ فارغ لا يُعرض. التعديل مفتوح في أي
 * وقت لمن يملك صلاحية إنشاء الأنشطة، و الحذف للأدمن وحده.
 */
export default function PrepCardDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const back = useBack('/prep-cards');
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const { has } = usePerms();
  const editable = has('sessions.create');
  const isAdmin = user?.role === 'admin';

  const { data: card, setData: setCard, loading, error, reload } = useFetch(`/prep-cards/${id}`);
  const [editing, setEditing] = useState(false);
  const branches = useFetch('/branches', { skip: !editable });
  const leaders = useFetch('/leaders', { skip: !editable });

  async function remove() {
    if (!(await confirm({ title: t('prep.delete'), message: t('prep.deleteConfirm') }))) return;
    try {
      await api.del(`/prep-cards/${id}`);
      toast.success(t('prep.deleted'));
      navigate('/prep-cards', { replace: true });
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading) return <SkeletonPage rows={4} />;
  if (error)
    return <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />;

  const sections = [
    ['goals', 'prep.goals'],
    ['segments', 'prep.segments'],
    ['tools', 'prep.tools'],
    ['notes', 'prep.notes'],
  ].filter(([key]) => card[key]);

  return (
    <div className="space-y-4">
      {/* Phones: back and the icon-only actions share one line, and «create the
          activity» — the card's next step — gets a full-width line of its own under
          them instead of wrapping the header into three ragged rows */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={back} className="-ms-2 me-auto">
          <IconBack className="rtl:rotate-180" />
          {t('common.back')}
        </Button>
        {/* البطاقة كُتبت قبل النشاط: من هنا يُنشأ النشاط مملوءًا منها و مربوطًا بها */}
        {editable && !card.session_id && (
          <Button
            variant="brand"
            size="sm"
            onClick={() => navigate('/sessions', { state: { prepCard: card } })}
            className="order-last w-full sm:order-none sm:w-auto"
          >
            <IconCalendar />
            {t('prep.createSession')}
          </Button>
        )}
        <ExportPdfButton kind="prep" id={card.id} compact />
        {editable && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            aria-label={t('common.edit')}
            className="w-11 px-0 sm:w-auto sm:px-3"
          >
            <IconPencil />
            <span className="sr-only sm:not-sr-only">{t('common.edit')}</span>
          </Button>
        )}
        {isAdmin && (
          <Button
            variant="destructive-ghost"
            size="sm"
            onClick={remove}
            aria-label={t('common.delete')}
            className="w-11 px-0 sm:w-auto sm:px-3"
          >
            <IconTrash />
            <span className="sr-only sm:not-sr-only">{t('common.delete')}</span>
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="bg-primary h-1.5" />
        <CardContent className="p-4 sm:p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('prep.cardLabel')}
          </p>
          <h1 className="mt-1 text-lg font-bold tracking-tight sm:text-xl">{card.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="flex items-center gap-1.5 tabular-nums">
              <IconCalendar className="h-4 w-4 text-muted-foreground" />
              {fmtDate(card.date)}
            </span>
            {card.start_time && (
              <span className="flex items-center gap-1.5 tabular-nums">
                <IconClock className="h-4 w-4 text-muted-foreground" />
                {fmtTime(card.start_time)}
              </span>
            )}
            {card.place && (
              <span className="flex items-center gap-1.5">
                <IconPin className="h-4 w-4 text-muted-foreground" />
                {card.place}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <IconShield className="h-4 w-4 text-muted-foreground" />
              <Badge>{branchName(card, i18n.language)}</Badge>
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {card.leader && (
              <span className="text-sm text-muted-foreground">
                {t('prep.author')}:{' '}
                {card.leader_id ? (
                  <Link
                    to={`/leaders/${card.leader_id}`}
                    className="focus-ring rounded font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {card.leader}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{card.leader}</span>
                )}
              </span>
            )}
            {/* النشاط الذي حُضِّرت له — يفتح صفحته مباشرة */}
            {card.session_id && (
              <span className="text-sm text-muted-foreground">
                {t('prep.session')}:{' '}
                <Link
                  to={`/sessions/${card.session_id}`}
                  className="focus-ring rounded font-medium text-foreground hover:text-primary hover:underline"
                >
                  {card.session_title}
                </Link>
              </span>
            )}
          </div>
          {card.matalib.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-sm text-muted-foreground">{t('prep.matalib')}:</span>
              {card.matalib.map((n) => (
                <Badge key={n} variant="warning">
                  {n}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {sections.map(([key, labelKey]) => (
        <Card key={key}>
          <CardHeader>
            <CardTitle>{t(labelKey)}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* anywhere: one pasted link must not push the page past a phone's edge */}
            <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{card[key]}</p>
          </CardContent>
        </Card>
      ))}

      {/* سطر الأرشيف: من أنشأها و متى، و آخر تعديل إن اختلف */}
      <p className="text-xs text-muted-foreground">
        {[
          card.created_by && t('prep.createdBy', { name: card.created_by, date: stampDate(card.created_at) }),
          card.updated_at !== card.created_at && t('prep.updatedAt', { date: stampDate(card.updated_at) }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <Dialog open={editing} onClose={() => setEditing(false)} title={t('prep.editCard')}>
        {branches.error || leaders.error ? (
          <ErrorState
            message={t('error.loadFailed')}
            onRetry={() => {
              if (branches.error) branches.reload();
              if (leaders.error) leaders.reload();
            }}
            retryLabel={t('error.retry')}
          />
        ) : (
          <PrepCardForm
            initial={card}
            branches={branches.data || []}
            leaders={leaders.data || []}
            onCancel={() => setEditing(false)}
            onSaved={(updated) => {
              setEditing(false);
              setCard(updated);
              toast.success(t('prep.updated'));
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
