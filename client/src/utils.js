import i18n from './i18n';
import { toDate } from './lib/date';

// Latin digits in both locales: dates sit in tabular-nums columns and dir="ltr"
// islands next to Latin numbers, so Arabic-Indic digits would mix scripts.
const dateFormats = {};
function dateFormat(lng) {
  const locale = lng === 'ar' ? 'ar-u-nu-latn' : 'fr-FR';
  return (dateFormats[locale] ??= new Intl.DateTimeFormat(locale, { dateStyle: 'short' }));
}

export function fmtDate(iso) {
  if (!iso) return '';
  // Strip bidi control marks (RLM/ALM) the ar formatter inserts: inside the
  // dir="ltr" islands the UI uses for dates they reverse the segment order.
  // A bare digits/slashes run already renders d/m/y correctly in RTL text.
  return dateFormat(i18n.language).format(toDate(iso)).replace(/[‎‏؜]/g, '');
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 'today' | 'tomorrow' | null for a YYYY-MM-DD birth date.
 * Month-day only, so it matches every year; the window stops at one day ahead.
 */
export function birthdayWhen(birthDate) {
  if (!birthDate) return null;
  const md = (d) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = birthDate.slice(5);
  if (target === md(now)) return 'today';
  if (target === md(tomorrow)) return 'tomorrow';
  return null;
}

// طبيعة النشاط — the slugs the server accepts, with their translation key
export const ACTIVITY_TYPES = [
  { value: 'weekly', key: 'session.natureWeekly' },
  { value: 'cultural', key: 'session.natureCultural' },
  { value: 'ashura', key: 'session.natureAshura' },
  { value: 'ramadan', key: 'session.natureRamadan' },
  { value: 'summer_clubs', key: 'session.natureSummerClubs' },
];

export const activityTypeKey = (value) =>
  ACTIVITY_TYPES.find((a) => a.value === value)?.key || null;

// HH:MM — stored as typed, only trimmed of a stray seconds part
export const fmtTime = (v) => (v ? String(v).slice(0, 5) : '');

/**
 * الاسم الثلاثي: الاسم، ثم اسم الأب، ثم اسم العائلة.
 *
 * في الفوج أكثر من «علي أحمد» واحد، و اسم الأب هو ما يفرّق بينهم — فبدونه يضع
 * القائد حضور غير صاحبه. اسم الأب اختياري في التسجيل، و العناصر المسجَّلون قبل أن
 * يوجد الحقل بلا اسم أب، فيُتخطّى حين يغيب و يعود الاسم ثنائيًا كما كان.
 * يصلح للقادة أيضًا: لا اسم أب لهم، فيُعرضون ثنائيين.
 */
export const memberName = (m) =>
  m ? [m.first_name, m.father_name, m.last_name].filter(Boolean).join(' ') : '';

// الصورة الرمزية تأخذ حرفين: الاسم و العائلة. اسم الأب يُترك خارجها، و إلا صار
// «ع م» بدل «ع أ» و ضاع الحرف الذي يدلّ على العائلة.
export const avatarName = (m) => (m ? `${m.first_name || ''} ${m.last_name || ''}`.trim() : '');

// Works for objects carrying either name_fr/name_ar or branch_name_fr/branch_name_ar
export function branchName(obj, lng) {
  if (!obj) return '';
  return lng === 'ar'
    ? obj.name_ar ?? obj.branch_name_ar ?? ''
    : obj.name_fr ?? obj.branch_name_fr ?? '';
}

// Downscale an image file to a small JPEG data URL (avatar-sized)
export function fileToDataUrl(file, maxSize = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
