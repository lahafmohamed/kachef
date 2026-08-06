/* Temporary DOM smoke test: mounts the shadcn filter components in jsdom and
   drives them the way a user would (open the dropdown, pick a date). */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DirectionProvider } from '@radix-ui/react-direction';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import frJson from './locales/fr.json';
import DateRangePicker from './components/DateRangePicker';
import FilterSelect from './components/FilterSelect';
import SearchInput from './components/SearchInput';

i18next.use(initReactI18next).init({
  resources: { fr: { translation: frJson } },
  lng: 'fr',
  interpolation: { escapeValue: false },
});

let failed = 0;
function expect(label, cond, extra) {
  console.log(`  ${cond ? 'ok  ' : 'BAD '} ${label}${cond || !extra ? '' : `  -> ${extra}`}`);
  if (!cond) failed++;
}

function mount(el) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  return host;
}

const branches = [
  { value: 1, label: 'Baraem' },
  { value: 2, label: 'Louveteaux' },
];

console.log('FilterSelect');
{
  let picked = null;
  const host = mount(
    <DirectionProvider dir="ltr">
      <FilterSelect
        value={2}
        onChange={(v) => (picked = v)}
        options={branches}
        allLabel="Toutes les branches"
        ariaLabel="Branche"
      />
    </DirectionProvider>
  );
  const trigger = host.querySelector('[role="combobox"]');
  expect('trigger exists', !!trigger);
  expect('trigger shows selected label while closed', trigger?.textContent.includes('Louveteaux'), trigger?.textContent);
  expect('trigger has aria-label', trigger?.getAttribute('aria-label') === 'Branche');
  expect('trigger reports collapsed', trigger?.getAttribute('aria-expanded') === 'false');

  // Radix opens on keydown (jsdom lacks real pointer events)
  act(() => {
    trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  const listbox = document.querySelector('[role="listbox"]');
  expect('opens a listbox', !!listbox);
  const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim());
  expect('lists "all" + every branch', options.length === 3, options.join(' | '));
  expect('option order keeps "all" first', options[0].includes('Toutes'), options[0]);

  const target = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes('Baraem'));
  act(() => {
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect('selecting an option reports its id as a string', picked === '1', JSON.stringify(picked));

  // "all" must map back to '' so the query param is omitted. Start from a real
  // branch, otherwise re-picking the current value is a no-op for Radix.
  picked = 'untouched';
  const host2 = mount(
    <DirectionProvider dir="ltr">
      <FilterSelect value={2} onChange={(v) => (picked = v)} options={branches} allLabel="Toutes les branches" />
    </DirectionProvider>
  );
  const t2 = host2.querySelector('[role="combobox"]');
  act(() => t2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  const allOpt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes('Toutes'));
  act(() => allOpt.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect('picking "all" reports empty string', picked === '', JSON.stringify(picked));

  const host3 = mount(
    <DirectionProvider dir="ltr">
      <FilterSelect value="" onChange={() => {}} options={branches} allLabel="Toutes les branches" />
    </DirectionProvider>
  );
  expect(
    'empty value shows the "all" label',
    host3.querySelector('[role="combobox"]').textContent.includes('Toutes')
  );
}

console.log('SearchInput');
{
  let val = 'juju';
  const host = mount(<SearchInput value={val} onChange={(v) => (val = v)} placeholder="chercher" />);
  const input = host.querySelector('input');
  expect('input is type=search', input.type === 'search');
  expect('shows current value', input.value === 'juju');

  const clear = host.querySelector('button');
  act(() => clear.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  expect('clear button empties the value', val === '', JSON.stringify(val));

  val = 'abc';
  act(() => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect('Escape empties the value', val === '', JSON.stringify(val));

  // Ctrl+K focuses from anywhere on the page
  const other = document.createElement('button');
  document.body.appendChild(other);
  other.focus();
  act(() => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  });
  expect('Ctrl+K focuses the search field', document.activeElement === input, document.activeElement?.tagName);
}

console.log('DateRangePicker');
{
  let range = { from: '', to: '' };
  const host = mount(
    <DirectionProvider dir="ltr">
      <DateRangePicker value={range} onChange={(v) => (range = v)} />
    </DirectionProvider>
  );
  const trigger = host.querySelector('button');
  expect('closed trigger shows "any date"', trigger.textContent.includes('Toutes les dates'), trigger.textContent);

  act(() => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  const dialog = document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]');
  expect('popover opens', !!dialog);

  const grid = document.querySelector('table');
  expect('calendar grid rendered', !!grid);
  const dayButtons = [...document.querySelectorAll('table button')];
  expect('calendar has day buttons', dayButtons.length > 27, String(dayButtons.length));

  const presetBtns = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
  expect('presets present', presetBtns.some((x) => x.includes('7 derniers jours')), presetBtns.slice(0, 6).join(' | '));

  const p7 = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('7 derniers jours'));
  act(() => p7.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  expect('preset emits ISO from/to', iso.test(range.from) && iso.test(range.to), JSON.stringify(range));
  const spanDays = (new Date(range.to) - new Date(range.from)) / 86400000;
  expect('"7 derniers jours" spans 6 days inclusive', spanDays === 6, String(spanDays));
}

console.log(failed === 0 ? '\nALL GREEN' : `\n${failed} FAILURE(S)`);
process.exitCode = failed === 0 ? 0 : 1;
