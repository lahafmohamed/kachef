import { useLayoutEffect, useRef } from 'react';
import { Input, cn } from './ui';

const NBSP = ' ';

// '20700' → '20 700': the grouping fmtAmount shows, while the amount is typed
function group(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const [int, dec] = String(raw).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return dec === undefined ? grouped : `${grouped},${dec}`;
}

/**
 * An amount typed as it reads: «20 700», then «F» at the end of the field — the same
 * look as every amount on the site. The francs have no cents, so only digits are
 * kept: «20.000», as many write it, is twenty thousand, never twenty.
 *
 * A drop-in for <Input type="number">: `value` is the raw string the form keeps ('' or
 * '20700'), and `onChange` receives `{ target: { value } }` with that raw string, so a
 * form's `set('amount')` and its Number(form.amount) stay as they are.
 */
export default function AmountInput({ value, onChange, onKeyDown, unit = true, className, ...props }) {
  const ref = useRef(null);
  // Digits before the caret at the last keystroke: where to put it back once regrouped
  const caret = useRef(null);
  const shown = group(value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (caret.current === null || !el || document.activeElement !== el) return;
    let digits = caret.current;
    let pos = 0;
    while (pos < shown.length && digits > 0) {
      if (/\d/.test(shown[pos])) digits -= 1;
      pos += 1;
    }
    el.setSelectionRange(pos, pos);
    caret.current = null;
  });

  function change(e) {
    const text = e.target.value;
    const at = e.target.selectionStart ?? text.length;
    caret.current = text.slice(0, at).replace(/\D/g, '').length;
    onChange?.({ target: { value: text.replace(/\D/g, '').replace(/^0+(?=\d)/, '') } });
  }

  // Backspace right after a group's space deletes the digit before it, not a space the
  // field would only put back
  function keyDown(e) {
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: end } = el;
    if (s === end && s !== null) {
      if (e.key === 'Backspace' && el.value[s - 1] === NBSP) el.setSelectionRange(s - 1, s - 1);
      else if (e.key === 'Delete' && el.value[s] === NBSP) el.setSelectionRange(s + 1, s + 1);
    }
    onKeyDown?.(e);
  }

  return (
    <div className="relative">
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        // Digits and the unit read left to right in Arabic too, like every amount shown;
        // there the number sits at the end, next to its «F»
        dir="ltr"
        value={shown}
        onChange={change}
        onKeyDown={keyDown}
        className={cn('tabular-nums rtl:text-right', unit && 'pe-8', className)}
      />
      {unit && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
        >
          F
        </span>
      )}
    </div>
  );
}
