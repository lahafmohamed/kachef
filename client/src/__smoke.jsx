/* Temporary render smoke test for the shadcn filter components (no browser). */
import { renderToStaticMarkup } from 'react-dom/server';
import { DirectionProvider } from '@radix-ui/react-direction';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ar, fr } from 'date-fns/locale';
import frJson from './locales/fr.json';
import DateRangePicker from './components/DateRangePicker';
import FilterSelect from './components/FilterSelect';
import SearchInput from './components/SearchInput';
import { Calendar } from './components/shadcn/calendar';

i18next.use(initReactI18next).init({
  resources: { fr: { translation: frJson } },
  lng: 'fr',
  interpolation: { escapeValue: false },
});

let failed = 0;
function check(name, fn) {
  try {
    const html = fn();
    console.log(`PASS  ${name}  (${html.length} bytes)`);
    return html;
  } catch (e) {
    console.log(`FAIL  ${name}: ${e.message}`);
    failed++;
    return '';
  }
}
function expect(label, cond) {
  console.log(`  ${cond ? 'ok  ' : 'BAD '} ${label}`);
  if (!cond) failed++;
}

const branches = [
  { value: 1, label: 'Baraem' },
  { value: 2, label: 'Louveteaux' },
];

check('SearchInput empty', () =>
  renderToStaticMarkup(<SearchInput value="" onChange={() => {}} placeholder="chercher" />)
);

const withValue = check('SearchInput with value', () =>
  renderToStaticMarkup(<SearchInput value="juju" onChange={() => {}} placeholder="chercher" />)
);
expect('clear button rendered instead of kbd hint', withValue.includes('<button') && !withValue.includes('<kbd'));

const fs1 = check('FilterSelect all/ltr', () =>
  renderToStaticMarkup(
    <DirectionProvider dir="ltr">
      <FilterSelect value="" onChange={() => {}} options={branches} allLabel="Toutes" ariaLabel="Branche" />
    </DirectionProvider>
  )
);
expect('renders allLabel', fs1.includes('Toutes'));

const fs2 = check('FilterSelect selected/rtl', () =>
  renderToStaticMarkup(
    <DirectionProvider dir="rtl">
      <FilterSelect value={2} onChange={() => {}} options={branches} allLabel="الكل" ariaLabel="الفرقة" />
    </DirectionProvider>
  )
);
expect('renders selected option label', fs2.includes('Louveteaux'));

const calFr = check('Calendar range fr/ltr', () =>
  renderToStaticMarkup(
    <Calendar
      mode="range"
      locale={fr}
      dir="ltr"
      defaultMonth={new Date('2026-08-01T12:00:00')}
      selected={{ from: new Date('2026-08-03T12:00:00'), to: new Date('2026-08-06T12:00:00') }}
      onSelect={() => {}}
    />
  )
);
expect('has range_middle styling applied', calFr.includes('range_middle') || calFr.includes('bg-accent'));
expect('french caption', /ao[uû]t/i.test(calFr));

const calAr = check('Calendar range ar/rtl', () =>
  renderToStaticMarkup(
    <Calendar mode="range" locale={ar} dir="rtl" defaultMonth={new Date('2026-08-01T12:00:00')} onSelect={() => {}} />
  )
);
expect('arabic text rendered', /[؀-ۿ]/.test(calAr));

const dr = check('DateRangePicker with range', () =>
  renderToStaticMarkup(
    <DirectionProvider dir="ltr">
      <DateRangePicker value={{ from: '2026-08-03', to: '2026-08-06' }} onChange={() => {}} />
    </DirectionProvider>
  )
);
expect('trigger shows dd/mm/yyyy range', dr.includes('03/08/2026') && dr.includes('06/08/2026'));

const drEmpty = check('DateRangePicker empty', () =>
  renderToStaticMarkup(
    <DirectionProvider dir="ltr">
      <DateRangePicker value={{ from: '', to: '' }} onChange={() => {}} />
    </DirectionProvider>
  )
);
expect('trigger shows "any date"', drEmpty.includes('Toutes les dates'));

const drOneSided = check('DateRangePicker open-ended (from only)', () =>
  renderToStaticMarkup(
    <DirectionProvider dir="ltr">
      <DateRangePicker value={{ from: '2026-08-03', to: '' }} onChange={() => {}} />
    </DirectionProvider>
  )
);
expect('shows "Du 03/08/2026"', drOneSided.includes('03/08/2026') && drOneSided.includes('Du'));

console.log(failed === 0 ? '\nALL GREEN' : `\n${failed} FAILURE(S)`);
process.exitCode = failed === 0 ? 0 : 1;
