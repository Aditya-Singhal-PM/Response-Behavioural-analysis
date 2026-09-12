export interface ParsedFile {
  columns: string[];
  rows: Record<string, string>[];
  /** Cells at Excel's hard cell limit, meaning the export is already truncated. */
  truncatedCells: number;
}

const EXCEL_CELL_LIMIT = 32767;

/**
 * RFC4180-ish CSV/TSV reader. Written by hand rather than pulled from a
 * package so CSV and JSONL work with no dependency and no network.
 */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Some exports serialise each cell as a JSON string literal: wrapped in
 * quotes, newlines as the two characters backslash-n, inner quotes as
 * backslash-quote. Others escape newlines without the quotes. Both are
 * undone here, otherwise delimiter matching in segmentation cannot work
 * and the panes show raw escape sequences.
 */
export function unescapeCell(value: string): string {
  const trimmed = value.trim();

  // Whole cell is a JSON string literal — the reliable case, parse it.
  if (
    trimmed.length >= 2 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"') &&
    trimmed.includes('\\')
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // Not valid JSON after all; fall through to the pattern replace.
    }
  }

  // Escaped newlines without the wrapping quotes. Only unescape when the
  // literal sequences clearly outnumber real newlines, so a cell that
  // legitimately mentions "\n" in prose is left alone.
  const literal = (value.match(/\\n/g) ?? []).length;
  const real = (value.match(/\n/g) ?? []).length;
  if (literal === 0 || literal <= real) return value;

  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"');
}

function toRecords(grid: string[][]): ParsedFile {
  if (grid.length === 0) return { columns: [], rows: [], truncatedCells: 0 };
  const header = grid[0].map((h, i) => (h.trim() ? h.trim() : `column_${i + 1}`));
  const rows: Record<string, string>[] = [];
  let truncatedCells = 0;

  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    if (line.every((c) => !c || !c.trim())) continue;
    const rec: Record<string, string> = {};
    header.forEach((col, c) => {
      const val = unescapeCell(line[c] ?? '');
      if (val.length >= EXCEL_CELL_LIMIT) truncatedCells++;
      rec[col] = val;
    });
    rows.push(rec);
  }
  return { columns: header, rows, truncatedCells };
}

function parseJsonl(text: string): ParsedFile {
  const rows: Record<string, string>[] = [];
  const columnSet = new Set<string>();
  let truncatedCells = 0;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const rec: Record<string, string> = {};
    for (const [k, v] of Object.entries(flatten(obj as Record<string, unknown>))) {
      columnSet.add(k);
      const s = unescapeCell(v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
      if (s.length >= EXCEL_CELL_LIMIT) truncatedCells++;
      rec[k] = s;
    }
    rows.push(rec);
  }

  const columns = [...columnSet];
  for (const r of rows) for (const c of columns) if (!(c in r)) r[c] = '';
  return { columns, rows, truncatedCells };
}

/** Langfuse-style exports nest fields, so one level of dotted flattening helps. */
function flatten(
  obj: Record<string, unknown>,
  prefix = '',
  depth = 0
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) {
      Object.assign(out, flatten(v as Record<string, unknown>, key, depth + 1));
    } else {
      out[key] = v;
    }
  }
  return out;
}

interface SheetJsModule {
  read: (data: ArrayBuffer, opts: { type: string }) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json: (
      sheet: unknown,
      opts: { header: number; raw: boolean; defval: string }
    ) => unknown[][];
  };
}

let sheetJs: SheetJsModule | null = null;

/**
 * SheetJS is fetched at runtime from a CDN rather than installed, so this
 * whole app stays editable from the GitHub web UI with no lockfile changes.
 */
async function loadSheetJs(): Promise<SheetJsModule> {
  if (sheetJs) return sheetJs;
  const url = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
  const mod = (await import(/* @vite-ignore */ url)) as unknown as SheetJsModule;
  sheetJs = mod;
  return mod;
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.jsonl') || name.endsWith('.ndjson')) {
    return parseJsonl(await file.text());
  }
  if (name.endsWith('.csv')) {
    return toRecords(parseDelimited(await file.text(), ','));
  }
  if (name.endsWith('.tsv')) {
    return toRecords(parseDelimited(await file.text(), '\t'));
  }

  const xlsx = await loadSheetJs();
  const buf = await file.arrayBuffer();
  const wb = xlsx.read(buf, { type: 'array' });
  const first = wb.Sheets[wb.SheetNames[0]];
  const grid = xlsx.utils.sheet_to_json(first, {
    header: 1,
    raw: false,
    defval: '',
  }) as unknown[][];
  const asStrings = grid.map((r) => r.map((c) => (c == null ? '' : String(c))));
  return toRecords(asStrings);
}
