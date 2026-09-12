import { BUCKET_LABELS } from '../types';
import type { Cluster, Finding, RubricAssertion, Trace } from '../types';

const EXCEL_CELL_LIMIT = 32000;

interface SheetJsWrite {
  utils: {
    book_new: () => unknown;
    aoa_to_sheet: (data: unknown[][]) => unknown;
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
  };
  write: (wb: unknown, opts: { bookType: string; type: string }) => ArrayBuffer;
}

let sheetJs: SheetJsWrite | null = null;

async function loadSheetJs(): Promise<SheetJsWrite> {
  if (sheetJs) return sheetJs;
  const url = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
  sheetJs = (await import(/* @vite-ignore */ url)) as unknown as SheetJsWrite;
  return sheetJs;
}

function cap(v: unknown): string {
  const s = v == null ? '' : String(v);
  return s.length > EXCEL_CELL_LIMIT
    ? `${s.slice(0, EXCEL_CELL_LIMIT)}…[truncated]`
    : s;
}

export interface ExportInput {
  rawRows: Record<string, string>[];
  rawColumns: string[];
  traces: Trace[];
  findings: Finding[];
  clusters: Cluster[];
  assertions: RubricAssertion[];
  background: string[];
  intent: string;
  model: string;
  baseUrl: string;
  fileName: string;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportWorkbook(input: ExportInput): Promise<void> {
  const xlsx = await loadSheetJs();
  const byRow = new Map(input.findings.map((f) => [f.rowIndex, f]));
  const clusterOfRow = new Map<number, number>();
  for (const c of input.clusters) {
    for (const r of c.rowIndexes) clusterOfRow.set(r, c.id);
  }

  // Sheet 1 keeps every original column in its original order so the result
  // can be pivoted next to whatever the user already has.
  const judgementCols = [
    'rba_feature',
    'rba_verdict',
    'rba_bucket',
    'rba_remediation',
    'rba_confidence',
    'rba_evidence',
    'rba_reason',
    'rba_mode',
    'rba_prompt_version',
    'rba_cluster',
    'rba_feedback',
  ];
  const traceRows: unknown[][] = [[...input.rawColumns, ...judgementCols]];
  input.rawRows.forEach((row, i) => {
    const f = byRow.get(i);
    traceRows.push([
      ...input.rawColumns.map((c) => cap(row[c])),
      f?.feature ?? '',
      f?.verdict ?? '',
      f ? BUCKET_LABELS[f.bucket] : '',
      f?.remediation ?? '',
      f ? f.confidence.toFixed(2) : '',
      cap(f?.evidence),
      cap(f?.reason),
      f?.mode ?? '',
      f?.promptVersion ?? '',
      clusterOfRow.has(i) ? String(clusterOfRow.get(i)) : '',
      f?.feedback ?? '',
    ]);
  });

  const clusterRows: unknown[][] = [
    ['cluster', 'feature', 'bucket', 'failures', 'pattern', 'proposed change'],
    ...input.clusters.map((c) => [
      c.id,
      c.scope,
      BUCKET_LABELS[c.bucket],
      c.rowIndexes.length,
      cap(c.pattern),
      cap(c.proposedPatch),
    ]),
  ];

  const judged = input.findings.filter(
    (f) => f.verdict === 'pass' || f.verdict === 'fail'
  );
  const configRows: unknown[][] = [
    ['key', 'value'],
    ['source file', input.fileName],
    ['rows in file', input.rawRows.length],
    ['rows judged', judged.length],
    ['abstained', input.findings.filter((f) => f.verdict === 'abstain').length],
    ['errored', input.findings.filter((f) => f.verdict === 'error').length],
    ['judge model', input.model],
    ['base url', input.baseUrl],
    ['exported at', new Date().toISOString()],
    ['intent', cap(input.intent)],
    ...input.assertions.map((a, i) => [
      `assertion ${i + 1}${a.enabled ? '' : ' (disabled)'}`,
      cap(a.text),
    ]),
    ...input.background.map((b, i) => [`background ${i + 1}`, cap(b)]),
  ];

  const problemRows: unknown[][] = [
    ['row', 'trace id', 'verdict', 'reason'],
    ...input.findings
      .filter((f) => f.verdict === 'abstain' || f.verdict === 'error')
      .map((f) => [
        f.rowIndex + 2,
        f.traceId,
        f.verdict,
        cap(f.abstainReason ?? f.reason),
      ]),
  ];

  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(traceRows), 'Traces');
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(clusterRows), 'Clusters');
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(configRows), 'Run config');
  xlsx.utils.book_append_sheet(
    wb,
    xlsx.utils.aoa_to_sheet(problemRows),
    'Abstains and errors'
  );

  const out = xlsx.write(wb, { bookType: 'xlsx', type: 'array' });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  download(
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `rba-findings-${stamp}.xlsx`
  );
}

export interface Snapshot {
  version: 1;
  intent: string;
  assertions: RubricAssertion[];
  findings: Finding[];
  clusters: Cluster[];
  model: string;
  fileName: string;
  savedAt: string;
}

export function exportSnapshot(s: Omit<Snapshot, 'version' | 'savedAt'>): void {
  const snap: Snapshot = { version: 1, savedAt: new Date().toISOString(), ...s };
  download(
    new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' }),
    `rba-run-${snap.savedAt.slice(0, 16).replace(/[:T]/g, '-')}.json`
  );
}

export async function importSnapshot(file: File): Promise<Snapshot> {
  const parsed = JSON.parse(await file.text()) as Snapshot;
  if (parsed.version !== 1) throw new Error('Unrecognised snapshot version.');
  return parsed;
}
