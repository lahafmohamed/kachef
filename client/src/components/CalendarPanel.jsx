import { ar, fr } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { Calendar } from './shadcn/calendar';

/**
 * Lazy chunk boundary. react-day-picker + the date-fns locales are ~90 kB of
 * the bundle and are only needed once someone actually opens the date filter,
 * so they load on demand instead of on first paint.
 */
export default function CalendarPanel({ isAr, ...props }) {
  const { t } = useTranslation();
  const formatDay = new Intl.DateTimeFormat(isAr ? 'ar' : 'fr', { dateStyle: 'full' });
  return (
    <Calendar
      dir={isAr ? 'rtl' : 'ltr'}
      locale={isAr ? ar : fr}
      numberOfMonths={1}
      labels={{
        labelNav: () => t('common.calendarNavigation'),
        labelPrevious: () => t('common.previousMonth'),
        labelNext: () => t('common.nextMonth'),
        labelDayButton: (date, modifiers) => [
          modifiers.today && t('common.today'),
          formatDay.format(date),
          modifiers.selected && t('common.selected'),
        ].filter(Boolean).join(', '),
      }}
      {...props}
    />
  );
}
