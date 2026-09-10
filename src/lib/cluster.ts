import { callModel, extractJson } from './providers';
import type { JudgeConnection } from './judge';
import { BUCKET_LABELS } from '../types';
import type { Bucket, Cluster, Finding, Trace } from '../types';

const SYNTHESIS_SYSTEM = `You summarise a group of related failures from an AI agent's traces into one actionable finding for a product manager.

Given several failures that share a diagnostic bucket, identify the single underlying pattern and propose one concrete change.

Rules:
- The pattern must be specific enough to be falsifiable. "Handles some queries poorly" is useless; "Does not state a clause number when the answer spans two clauses" is useful.
- The patch must be text the reader could act on directly. For a prompt change, write the actual sentence to add. For a retrieval change, name the setting. For a content gap, name the missing document.
- If the failures do not actually share a cause, say so in the pattern and propose no patch.

Return only JSON, no prose and no code fences:
{"pattern":"one or two sentences","patch":"the concrete change, or empty string"}`;

/**
 * Findings are grouped by bucket and prompt version rather than by embedding
 * similarity — a shared diagnostic cause matters more here than surface
 * similarity, and it needs no embedding call.
 */
export function groupFindings(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    if (f.verdict !== 'fail') continue;
    const key = `${f.bucket}::${f.promptVersion ?? 'v-none'}`;
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  return groups;
}

export async function synthesiseClusters(
  conn: JudgeConnection,
  findings: Finding[],
  traces: Trace[],
  onCluster: (c: Cluster) => void
): Promise<void> {
  const groups = [...groupFindings(findings).entries()].sort(
    (a, b) => b[1].length - a[1].length
  );
  const byRow = new Map(traces.map((t) => [t.rowIndex, t]));
  let id = 0;

  for (const [key, group] of groups.slice(0, 12)) {
    const bucket = key.split('::')[0] as Bucket;
    const examples = group.slice(0, 6).map((f) => {
      const t = byRow.get(f.rowIndex);
      return {
        request: (t?.segments?.userQuery || t?.input || '').slice(0, 400),
        reply: (t?.output || '').slice(0, 400),
        evidence: f.evidence.slice(0, 300),
        why: f.reason.slice(0, 300),
      };
    });

    let pattern = `${group.length} failures share the ${BUCKET_LABELS[bucket]} bucket.`;
    let patch = '';

    try {
      const raw = await callModel({
        ...conn,
        maxTokens: 700,
        messages: [
          { role: 'system', content: SYNTHESIS_SYSTEM },
          {
            role: 'user',
            content: `Bucket: ${BUCKET_LABELS[bucket]}\nFailure count: ${
              group.length
            }\n\nExamples:\n${JSON.stringify(examples, null, 2)}`,
          },
        ],
      });
      const parsed = extractJson<{ pattern?: string; patch?: string }>(raw);
      if (typeof parsed.pattern === 'string' && parsed.pattern.trim()) {
        pattern = parsed.pattern;
      }
      if (typeof parsed.patch === 'string') patch = parsed.patch;
    } catch {
      // The group is still worth showing with its count even if synthesis fails.
    }

    const cluster: Cluster = {
      id: id++,
      bucket,
      pattern,
      rowIndexes: group.map((f) => f.rowIndex),
      proposedPatch: patch,
    };
    onCluster(cluster);
  }
}

export function severityRank(bucket: Bucket): number {
  const order: Bucket[] = [
    'hallucination',
    'context-ignored',
    'under-refusal',
    'retrieval-miss',
    'knowledge-gap',
    'master-prompt-defect',
    'reasoning-error',
    'output-format',
    'over-refusal',
    'edge-case-input',
    'invalid-user-input',
    'reference-may-be-stale',
    'unclassified',
  ];
  const i = order.indexOf(bucket);
  return i === -1 ? order.length : i;
}
