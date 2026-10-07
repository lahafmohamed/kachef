import writeXlsxFile from 'write-excel-file/universal';
import {
  getCellAddress,
  getOrderOfSiblings,
  insertElementMarkupAccordingToOrderOfSiblings,
} from 'write-excel-file/utility';

/**
 * تصدير Excel: the report as a workbook to sort, filter and fill in, written in the
 * browser — a date is a date, an amount a number shown «20 700 F», a rate a percent.
 * Each sheet opens on its title and what it is about, then its facts or its table: a
 * table alone on its sheet keeps its header on screen and carries Excel's filters.
 * Arabic sheets read right to left, as the app does.
 *
 * A sheet is described, not drawn:
 *   { name, title, lines: [string], blocks: [
 *       { heading?, facts: [[label, value, type?], …] },
 *       { heading?, columns: [{ label, type? }], rows: [[value, …]], total?: [value, …], empty? },
 *   ] }
 * Types: 'text' (the default), 'int', 'amount', 'signed' (an amount with its sign),
 * 'percent' (0–100, as the app reckons rates), 'date' ('YYYY-MM-DD…'). An empty value
 * stays an empty cell: no «—» to filter out. `empty`: what a table with no rows says.
 */

const INK = '#1E2229';
const MUTED = '#676D79';
const BRAND = '#0E7490';
const HEAD_FILL = '#E7F1F4';
const RULE = '#B8C2CC';

// The thousands follow the reader's own Excel; the day order and its «/» are the app's
const FORMATS = {
  amount: '#,##0 "F";[Red]-#,##0 "F"',
  signed: '+#,##0 "F";[Red]-#,##0 "F";0 "F"',
  percent: '0%',
  date: 'dd\\/mm\\/yyyy',
};
const NUMERIC = new Set(['int', 'amount', 'signed', 'percent']);
// Figures read against each other at the end of their column
const ENDS = new Set(['amount', 'signed', 'percent']);

// Widths in Excel's «characters»; past the widest a text wraps instead. A summary's
// label and value stay within a portrait page.
const MAX_TABLE_WIDTH = 46;
const MAX_LABEL_WIDTH = 32;
const MAX_FACT_WIDTH = 54;
// Arial 10: a line is ~12.75pt high
const LINE_HEIGHT = 13;

/**
 * The app's words for a cell. Excel draws the bidi isolates the app wraps a figure in
 * («⁦50 000 F⁩» in an Arabic sentence) as visible boxes, and without them the unit
 * jumps to the other side of the number: a pair of marks of the same direction keeps
 * the figure whole and draws nothing.
 */
const text = (s) =>
  String(s)
    .replace(/⁦([^⁦-⁩]*)⁩/g, '‎$1‎')
    .replace(/⁧([^⁦-⁩]*)⁩/g, '‏$1‏')
    .replace(/[⁦-⁩]/g, '');

/** The cell for a value of a type, or null for nothing to show */
function cellOf(value, type) {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    // UTC midnight: the file holds the day itself, whatever the phone's time zone
    if (m) return { value: new Date(Date.UTC(+m[1], m[2] - 1, +m[3])), type: Date, format: FORMATS.date };
    return { value: text(value), type: String };
  }
  if (NUMERIC.has(type)) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (type === 'percent') return { value: n / 100, type: Number, format: FORMATS.percent };
    return { value: n, type: Number, ...(FORMATS[type] && { format: FORMATS[type] }) };
  }
  return { value: text(Array.isArray(value) ? value.join(', ') : value), type: String };
}

/** About how many characters a value takes once Excel shows it */
function shownLength(cell, type) {
  if (!cell) return 0;
  if (type === 'date' && cell.type === Date) return 10;
  if (type === 'percent') return 4;
  if (type === 'amount' || type === 'signed') {
    const digits = String(Math.round(Math.abs(cell.value))).length;
    return digits + Math.floor((digits - 1) / 3) + 2 + (type === 'signed' || cell.value < 0 ? 1 : 0);
  }
  return Math.max(
    ...String(cell.value)
      .split('\n')
      .map((l) => l.length)
  );
}

/** Lines a text takes in a column `width` characters wide, wrapped at its spaces */
function lineCount(text, width) {
  let lines = 0;
  for (const para of String(text).split('\n')) {
    let used = 0;
    lines++;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const w = word.length;
      if (used === 0) used = w;
      else if (used + 1 + w <= width) used += 1 + w;
      else {
        lines++;
        used = w;
      }
      // A word wider than the column breaks across lines
      while (used > width) {
        lines++;
        used -= width;
      }
    }
  }
  return lines;
}

/** The narrowest width a header holds in, on two lines at most and no word cut */
const headerWidth = (label) =>
  Math.max(
    ...String(label)
      .split(/\s+/)
      .map((w) => w.length),
    Math.ceil(String(label).length / 2) + 1
  );

/**
 * Column widths for a sheet's blocks: each table column fits its values and its
 * header; a fact's label and value fit theirs. Past the maximum, a text wraps.
 */
function columnWidths(blocks) {
  const widths = [];
  const fit = (i, n, max) => {
    widths[i] = Math.min(max, Math.max(widths[i] || 0, n));
  };
  for (const b of blocks) {
    if (b.facts) {
      for (const [label, value, type] of b.facts) {
        // A fact with nothing to say is left out of the sheet, and of its widths
        if (!cellOf(value, type)) continue;
        fit(0, String(label).length, MAX_LABEL_WIDTH);
        fit(1, shownLength(cellOf(value, type), type), MAX_FACT_WIDTH);
      }
    } else if (b.rows.length) {
      b.columns.forEach((c, i) => {
        fit(i, headerWidth(c.label), MAX_TABLE_WIDTH);
        for (const r of [...b.rows, ...(b.total ? [b.total] : [])])
          fit(i, shownLength(cellOf(r[i], c.type), c.type) + (ENDS.has(c.type) ? 1 : 0), MAX_TABLE_WIDTH);
      });
    }
  }
  // A little air, and room for the filter button on a header
  return Array.from(widths, (w) => Math.max(5, (w || 0) + 2));
}

/** Row height for cells that wrap — null when one line will do */
function wrappedHeight(texts) {
  const lines = Math.max(1, ...texts.map(([text, width]) => lineCount(text, Math.max(1, width - 1))));
  return lines > 1 ? lines * LINE_HEIGHT + 4 : null;
}

/**
 * Cells for one sheet. `start`/`end` are the sides of a cell the reading direction
 * puts text and figures on — set on every cell, since Excel's «General» alignment
 * follows each text's own script: an Arabic name in a French sheet would sit on the
 * right, and a French one in an Arabic sheet on the left.
 */
function sheetCells(blocks, widths, rtl) {
  const start = rtl ? 'right' : 'left';
  const end = rtl ? 'left' : 'right';
  // A count or a rank sits in the middle of its column; an amount at its end, one step
  // in, so it never touches the text that starts the next column
  const side = (type) =>
    type === 'int' ? { align: 'center' } : ENDS.has(type) ? { align: end, indent: 1 } : { align: start };
  const rows = [];
  let header = null;
  let filtered = null;

  for (const b of blocks) {
    rows.push([]);
    if (b.heading)
      rows.push([
        { value: text(b.heading), fontWeight: 'bold', fontSize: 11, textColor: BRAND, align: start, height: 18 },
      ]);

    if (b.facts) {
      for (const [label, value, type] of b.facts) {
        const cell = cellOf(value, type);
        if (!cell) continue;
        const long = cell.type === String && shownLength(cell, type) > widths[1] - 2;
        const height = long ? wrappedHeight([[cell.value, widths[1]]]) : null;
        rows.push([
          { value: text(label), textColor: MUTED, align: start, alignVertical: 'top', ...(height && { height }) },
          // A summary reads like a form: every value against its label
          { ...cell, align: start, alignVertical: 'top', ...(long && { wrap: true }) },
        ]);
      }
      continue;
    }

    if (!b.rows.length) {
      if (b.empty) rows.push([{ value: text(b.empty), textColor: MUTED, align: start }]);
      continue;
    }
    const headerHeight = wrappedHeight(b.columns.map((c, i) => [c.label, widths[i]]));
    header = rows.length;
    rows.push(
      b.columns.map((c) => ({
        value: text(c.label),
        fontWeight: 'bold',
        backgroundColor: HEAD_FILL,
        bottomBorderStyle: 'thin',
        bottomBorderColor: RULE,
        wrap: true,
        ...side(c.type),
        alignVertical: 'center',
        ...(headerHeight && { height: headerHeight }),
      }))
    );
    for (const r of b.rows) {
      const cells = b.columns.map((c, i) => cellOf(r[i], c.type));
      const wraps = cells.map((cell, i) => cell?.type === String && shownLength(cell, 'text') > widths[i] - 2);
      const height = wrappedHeight(cells.flatMap((cell, i) => (wraps[i] ? [[cell.value, widths[i]]] : [])));
      rows.push(
        cells.map((cell, i) => ({
          ...(cell || { value: null }),
          ...side(b.columns[i].type),
          alignVertical: 'top',
          ...(wraps[i] && { wrap: true }),
          ...(i === 0 && height && { height }),
        }))
      );
    }
    filtered = { from: header, to: rows.length - 1, columns: b.columns.length };
    if (b.total) {
      // A blank row first: Excel takes rows touching a table for part of it, and a
      // sort would carry the total in among the names
      rows.push([]);
      rows.push(
        b.columns.map((c, i) => ({
          ...(cellOf(b.total[i], c.type) || { value: null }),
          fontWeight: 'bold',
          topBorderStyle: 'thin',
          topBorderColor: RULE,
          ...side(c.type),
        }))
      );
    }
  }
  return { rows, filtered };
}

// Sheet names: 31 characters at most, none of []:*?/\ , each one different
function sheetNames(names) {
  const used = new Set();
  return names.map((raw) => {
    const base =
      String(raw || 'Feuille')
        .replace(/[[\]:*?/\\]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 31) || 'Feuille';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 3)} (${n})`;
    used.add(name.toLowerCase());
    return name;
  });
}

// Excel's own filter buttons on a table's header — write-excel-file leaves them to a feature
const autoFilter = {
  files: {
    transform: {
      'xl/worksheets/sheet{id}.xml': {
        transform: (xml, sheet) =>
          sheet.autoFilter
            ? insertElementMarkupAccordingToOrderOfSiblings(
                xml,
                `<autoFilter ref="${sheet.autoFilter}"/>`,
                getOrderOfSiblings('xl/worksheets/sheet{id}.xml', 'worksheet'),
                'worksheet'
              )
            : xml,
      },
    },
  },
};

function buildSheet(spec, name, rtl) {
  const start = rtl ? 'right' : 'left';
  const blocks = spec.blocks.filter(Boolean).filter((b) => (b.facts ? b.facts.length : b.columns.length));
  const widths = columnWidths(blocks);
  if (widths.length && blocks.every((b) => b.facts)) {
    const need = Math.max(
      text(spec.title).length * 1.5,
      ...(spec.lines || []).filter(Boolean).map((l) => text(l).length)
    );
    const room = widths.reduce((n, w) => n + w, 0);
    if (need > room)
      widths[widths.length - 1] += Math.ceil(Math.min(need, MAX_LABEL_WIDTH + MAX_FACT_WIDTH + 4) - room);
  }
  const head = [
    [{ value: text(spec.title), fontWeight: 'bold', fontSize: 14, textColor: INK, align: start, height: 22 }],
    ...(spec.lines || []).filter(Boolean).map((l) => [{ value: text(l), textColor: MUTED, align: start }]),
  ];
  const { rows, filtered } = sheetCells(blocks, widths, rtl);
  // One table and nothing else: its header stays on screen and filters it
  const lone = blocks.length === 1 && !blocks[0].facts && filtered;
  const top = head.length + (lone ? filtered.from : 0);
  return {
    data: [...head, ...rows],
    sheet: name,
    columns: widths.map((width) => ({ width })),
    rightToLeft: rtl,
    // A wide table prints across the page
    orientation: Math.max(0, ...blocks.map((b) => b.columns?.length || 0)) > 6 ? 'landscape' : 'portrait',
    ...(lone && {
      stickyRowsCount: top + 1,
      autoFilter: `${getCellAddress(top, 0)}:${getCellAddress(head.length + filtered.to, filtered.columns - 1)}`,
    }),
  };
}

/** The workbook of a report: a Blob ready to save */
export function workbookBlob({ sheets, rtl = false }) {
  const names = sheetNames(sheets.map((s) => s.name));
  return writeXlsxFile(
    sheets.map((s, i) => buildSheet(s, names[i], rtl)),
    { fontFamily: 'Arial', fontSize: 10, features: [autoFilter] }
  ).toBlob();
}
