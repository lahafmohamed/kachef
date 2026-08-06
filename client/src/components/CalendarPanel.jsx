import { ar, fr } from 'date-fns/locale';
import { Calendar } from './shadcn/calendar';

/**
 * Lazy chunk boundary. react-day-picker + the date-fns locales are ~90 kB of
 * the bundle and are only needed once someone actually opens the date filter,
 * so they load on demand instead of on first paint.
 */
export default function CalendarPanel({ isAr, ...props }) {
  return <Calendar dir={isAr ? 'rtl' : 'ltr'} locale={isAr ? ar : fr} numberOfMonths={1} {...props} />;
}
