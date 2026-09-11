import type { StructuralIssue, StructuralKind, Trace } from '../types';

// None of these checks call a model. They are deterministic properties of
// the export, they cost nothing, and they catch pipeline defects that a
// behavioural judge cannot see from a single row.

const MIN_BLOCK_CHARS = 40;
const DEFAULT_REFIRE_WINDOW_MS = 5000;

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** FNV-1a. Short, stable, and fast enough for a few hundred thousand blocks. */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Retrieved context is usually assembled by concatenating chunks, so blank
 * lines and common document delimiters are where the seams are.
 */
function splitBlocks(context: string): string[] {
  const byDelimiter = context.split(
    /\n\s*\n|\n(?=(?:Document|Chunk|Passage|Source|Clause)\s*[:#\d])|<\/?document[^>]*>/gi
  );
  return byDelimiter
    .map((b) => b.trim())
    .filter((b) => b.length >= MIN_BLOCK_CHARS);
}

/**
 * Detects a context that is one block repeated end to end. Uses a probe
 * from the start of the string rather than exact division, so a separator
 * between the copies does not defeat the check.
 */
function wholeContextRepeats(context: string): number {
  const n = norm(context);
  if (n.length < MIN_BLOCK_CHARS * 2) return 1;

  const probe = n.slice(0, Math.min(60, Math.floor(n.length / 2)));
  if (probe.length < 20) return 1;

  const positions: number[] = [];
  let at = n.indexOf(probe);
  while (at !== -1) {
    positions.push(at);
    at = n.indexOf(probe, at + probe.length);
  }
  if (positions.length < 2) return 1;

  // Evenly spaced occurrences covering the whole string means the content
  // is a repeat rather than a phrase that happens to recur.
  const gaps = positions.slice(1).map((p, i) => p - positions[i]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const even = gaps.every((g) => Math.abs(g - mean) <= Math.max(4, mean * 0.05));
  const covers = positions[positions.length - 1] + mean >= n.length * 0.9;

  return even && covers ? positions.length : 1;
}

function checkDuplicateContextBlocks(trace: Trace): StructuralIssue[] {
  const context = trace.retrievedContext || trace.segments?.retrievedContext || '';
  if (!context) return [];

  const issues: StructuralIssue[] = [];

  const wholeRepeat = wholeContextRepeats(context);
  if (wholeRepeat > 1) {
    issues.push({
      kind: 'context-fully-duplicated',
      rowIndexes: [trace.rowIndex],
      count: wholeRepeat,
      detail: `The entire retrieved context is the same content repeated ${wholeRepeat} times.`,
      evidence: context.slice(0, 240),
    });
    return issues;
  }

  const blocks = splitBlocks(context);
  if (blocks.length < 2) return issues;

  const seen = new Map<string, { text: string; times: number }>();
  for (const block of blocks) {
    const key = hash(norm(block));
    const entry = seen.get(key);
    if (entry) entry.times++;
    else seen.set(key, { text: block, times: 1 });
  }

  const repeated = [...seen.values()].filter((e) => e.times > 1);
  if (repeated.length > 0) {
    const worst = repeated.reduce((a, b) => (b.times > a.times ? b : a));
    const wasted = repeated.reduce((n, e) => n + e.text.length * (e.times - 1), 0);
    const copies = repeated.reduce((n, e) => n + (e.times - 1), 0);
    issues.push({
      kind: 'duplicate-context-block',
      rowIndexes: [trace.rowIndex],
      count: copies,
      detail: `${repeated.length} passage${
        repeated.length === 1 ? ' is' : 's are'
      } repeated inside one context, the worst ${worst.times} times. About ${wasted.toLocaleString()} characters of the window are spent on copies.`,
      evidence: worst.text.slice(0, 240),
    });
  }

  return issues;
}

function checkDuplicateTraceIds(traces: Trace[]): StructuralIssue[] {
  const byId = new Map<string, number[]>();
  for (const t of traces) {
    if (!t.traceId || /^row-\d+$/.test(t.traceId)) continue;
    const list = byId.get(t.traceId) ?? [];
    list.push(t.rowIndex);
    byId.set(t.traceId, list);
  }

  return [...byId.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([id, rows]) => ({
      kind: 'duplicate-trace-id' as StructuralKind,
      rowIndexes: rows,
      count: rows.length,
      detail: `Trace id ${id} appears on ${rows.length} rows. Either the export duplicated it or the same trace was written more than once.`,
      evidence: id,
    }));
}

function parseTime(value: string): number | null {
  if (!value) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 1e9) {
    // Accept epoch seconds as well as milliseconds.
    return asNumber < 1e12 ? asNumber * 1000 : asNumber;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The same request and the same context landing twice within a few seconds
 * is a re-fire: a client retry, a double-submit, or a queue redelivery.
 * Left in place it inflates the denominator and double-counts failures.
 */
function checkRefires(traces: Trace[], windowMs: number): StructuralIssue[] {
  const groups = new Map<string, Trace[]>();
  for (const t of traces) {
    const context = t.retrievedContext || t.segments?.retrievedContext || '';
    const query = t.segments?.userQuery || t.input;
    if (!query.trim()) continue;
    const key = `${hash(norm(query))}:${hash(norm(context))}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const issues: StructuralIssue[] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const timed = group
      .map((t) => ({ trace: t, at: parseTime(t.timestamp) }))
      .filter((x): x is { trace: Trace; at: number } => x.at !== null)
      .sort((a, b) => a.at - b.at);

    if (timed.length < 2) {
      // With no usable timestamps this is still a duplicate request, just
      // not provably a re-fire, so it is reported as the weaker finding.
      issues.push({
        kind: 'repeated-request',
        rowIndexes: group.map((t) => t.rowIndex),
        count: group.length,
        detail: `The same request and context appear on ${group.length} rows. Without timestamps this cannot be confirmed as a re-fire rather than a genuine repeat.`,
        evidence: (group[0].segments?.userQuery || group[0].input).slice(0, 200),
      });
      continue;
    }

    let burst: { trace: Trace; at: number }[] = [timed[0]];
    const flush = () => {
      if (burst.length < 2) return;
      const spanMs = burst[burst.length - 1].at - burst[0].at;
      issues.push({
        kind: 'duplicate-fire',
        rowIndexes: burst.map((b) => b.trace.rowIndex),
        count: burst.length,
        detail: `${burst.length} identical calls — same request, same context — within ${(
          spanMs / 1000
        ).toFixed(1)}s. These are almost certainly one event, so judging them separately counts the same behaviour ${burst.length} times.`,
        evidence: (burst[0].trace.segments?.userQuery || burst[0].trace.input).slice(0, 200),
      });
    };

    for (let i = 1; i < timed.length; i++) {
      if (timed[i].at - timed[i - 1].at <= windowMs) {
        burst.push(timed[i]);
      } else {
        flush();
        burst = [timed[i]];
      }
    }
    flush();
  }

  return issues;
}

/**
 * If retrieval returns the same context for materially different questions,
 * it is not responding to the query at all. This is invisible per row and
 * obvious across the corpus.
 */
function checkStaticContext(traces: Trace[]): StructuralIssue[] {
  const byContext = new Map<string, { rows: number[]; queries: Set<string> }>();

  for (const t of traces) {
    const context = t.retrievedContext || t.segments?.retrievedContext || '';
    if (context.length < MIN_BLOCK_CHARS) continue;
    const query = norm(t.segments?.userQuery || t.input);
    if (!query) continue;
    const key = hash(norm(context));
    const entry = byContext.get(key) ?? { rows: [], queries: new Set<string>() };
    entry.rows.push(t.rowIndex);
    entry.queries.add(hash(query));
    byContext.set(key, entry);
  }

  return [...byContext.values()]
    .filter((e) => e.rows.length >= 3 && e.queries.size >= 3)
    .map((e) => ({
      kind: 'query-insensitive-retrieval' as StructuralKind,
      rowIndexes: e.rows,
      count: e.rows.length,
      detail: `Identical retrieved context served to ${e.queries.size} different questions across ${e.rows.length} rows. Retrieval is not varying with the query.`,
      evidence: '',
    }));
}

function checkEmptyFields(traces: Trace[]): StructuralIssue[] {
  const noContext = traces.filter(
    (t) => !(t.retrievedContext || t.segments?.retrievedContext || '').trim()
  );
  const noOutput = traces.filter((t) => !t.output.trim());
  const issues: StructuralIssue[] = [];

  if (noContext.length > 0) {
    issues.push({
      kind: 'empty-context',
      rowIndexes: noContext.map((t) => t.rowIndex),
      count: noContext.length,
      detail: `${noContext.length} rows carry no retrieved context. Grounding cannot be judged on these, so they will abstain rather than fail.`,
      evidence: '',
    });
  }
  if (noOutput.length > 0) {
    issues.push({
      kind: 'empty-output',
      rowIndexes: noOutput.map((t) => t.rowIndex),
      count: noOutput.length,
      detail: `${noOutput.length} rows have an empty reply. Check whether the agent returned nothing or the export dropped the column.`,
      evidence: '',
    });
  }
  return issues;
}

export interface StructuralOptions {
  refireWindowMs?: number;
}

export function analyseStructure(
  traces: Trace[],
  options: StructuralOptions = {}
): StructuralIssue[] {
  const windowMs = options.refireWindowMs ?? DEFAULT_REFIRE_WINDOW_MS;
  const issues: StructuralIssue[] = [];

  for (const t of traces) issues.push(...checkDuplicateContextBlocks(t));
  issues.push(...checkDuplicateTraceIds(traces));
  issues.push(...checkRefires(traces, windowMs));
  issues.push(...checkStaticContext(traces));
  issues.push(...checkEmptyFields(traces));

  return issues;
}

/**
 * Rows to drop from the judge run. Only the first of each duplicate burst is
 * kept, so the behavioural numbers describe distinct events rather than
 * counting one event several times.
 */
export function redundantRows(issues: StructuralIssue[]): Set<number> {
  const drop = new Set<number>();
  for (const issue of issues) {
    if (issue.kind !== 'duplicate-fire' && issue.kind !== 'duplicate-trace-id') continue;
    const [, ...rest] = [...issue.rowIndexes].sort((a, b) => a - b);
    for (const row of rest) drop.add(row);
  }
  return drop;
}

export const STRUCTURAL_LABELS: Record<StructuralKind, string> = {
  'duplicate-context-block': 'Duplicate passages in context',
  'context-fully-duplicated': 'Context repeated end to end',
  'duplicate-trace-id': 'Duplicate trace id',
  'duplicate-fire': 'Same call fired repeatedly',
  'repeated-request': 'Repeated request',
  'query-insensitive-retrieval': 'Retrieval ignores the query',
  'empty-context': 'No retrieved context',
  'empty-output': 'Empty reply',
};

export const STRUCTURAL_SEVERITY: Record<StructuralKind, 'high' | 'medium' | 'low'> = {
  'duplicate-fire': 'high',
  'duplicate-trace-id': 'high',
  'query-insensitive-retrieval': 'high',
  'context-fully-duplicated': 'high',
  'duplicate-context-block': 'medium',
  'empty-output': 'medium',
  'repeated-request': 'low',
  'empty-context': 'low',
};
