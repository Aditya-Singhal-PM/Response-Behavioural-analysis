import { callModel, extractJson, ModelError } from './providers';
import type { ProviderId } from './providers';
import { BUCKETS } from '../types';
import type {
  Bucket,
  Finding,
  JudgeMode,
  Remediation,
  RubricAssertion,
  Trace,
  Verdict,
} from '../types';

export interface JudgeConnection {
  providerId: ProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
}

const ASSERTION_SYSTEM = `You convert a description of an AI agent's intended behaviour into discrete, independently checkable assertions.

Rules:
- Each assertion must be checkable against a single request and its reply, with a yes or no answer.
- Split compound expectations into separate assertions.
- Cover correctness, grounding, scope and refusal, and output format, but only where the description implies them. Do not invent expectations the description does not support.
- Write each assertion as an imperative statement about the reply.
- Return between 4 and 12 assertions.

Return only JSON, no prose and no code fences:
{"assertions": ["...", "..."]}`;

export async function deriveAssertions(
  conn: JudgeConnection,
  intent: string
): Promise<string[]> {
  const raw = await callModel({
    ...conn,
    maxTokens: 1200,
    messages: [
      { role: 'system', content: ASSERTION_SYSTEM },
      { role: 'user', content: `Agent description:\n\n${intent}` },
    ],
  });
  const parsed = extractJson<{ assertions?: unknown }>(raw);
  const list = Array.isArray(parsed.assertions) ? parsed.assertions : [];
  return list.filter((a): a is string => typeof a === 'string' && a.trim().length > 0);
}

const MAPPING_SYSTEM = `You map spreadsheet columns onto a fixed schema for LLM trace analysis.

Schema fields:
- input: the full prompt sent to the agent
- output: the agent's reply
- reasoning: chain of thought, if stored separately
- groundTruth: the expected answer or required facts
- retrievedContext: retrieved documents, only if in their own column
- traceId: a unique row id
- model: the model name
- timestamp: when the trace was recorded

Return only JSON, no prose and no code fences. Use null when no column fits:
{"input":"col","output":"col","reasoning":null,"groundTruth":null,"retrievedContext":null,"traceId":null,"model":null,"timestamp":null}`;

export async function proposeMapping(
  conn: JudgeConnection,
  columns: string[],
  sampleRows: Record<string, string>[]
): Promise<Record<string, string | null>> {
  const preview = sampleRows.slice(0, 4).map((r) => {
    const out: Record<string, string> = {};
    for (const c of columns) out[c] = (r[c] ?? '').slice(0, 220);
    return out;
  });

  const raw = await callModel({
    ...conn,
    maxTokens: 700,
    messages: [
      { role: 'system', content: MAPPING_SYSTEM },
      {
        role: 'user',
        content: `Columns: ${JSON.stringify(columns)}\n\nSample rows:\n${JSON.stringify(
          preview,
          null,
          2
        )}`,
      },
    ],
  });
  return extractJson<Record<string, string | null>>(raw);
}

const JUDGE_SYSTEM = `You evaluate one turn of an AI agent against stated expectations. You are strict, literal, and you never invent problems.

Hard rules:
- Every finding must quote a verbatim span from the reply or the retrieved context as evidence. If you cannot quote supporting text, you must not raise the finding.
- If the trace does not contain enough information to judge — the retrieved context is missing, the prompt is unreadable, or correctness depends on something not shown — return verdict "abstain" and say what is missing. Abstaining is correct and expected; do not guess.
- Judge only against the assertions given. Do not apply your own preferences about style or length.
- A reply saying it cannot find, does not have, or is not sure about the information is NOT by itself evidence of a retrieval failure. Refusing may be exactly correct for a request the corpus was never meant to cover. Only use retrieval-miss or knowledge-gap when an EXPECTED ANSWER is supplied and shows a real answer existed. With no expected answer, return "abstain" and say that you cannot confirm the information should have been available.

Bucket definitions:
- master-prompt-defect: the instructions themselves are missing or ambiguous about this case
- retrieval-miss: the needed fact is absent from the retrieved context but looks like something the corpus should hold
- knowledge-gap: the needed fact appears to exist nowhere in the corpus
- context-ignored: the needed fact IS in the retrieved context and the reply contradicts or omits it
- hallucination: the reply asserts something present in neither the context nor the expected answer
- reasoning-error: the facts are right but the inference from them is wrong
- output-format: content is right, structure or format is wrong
- over-refusal: refused something the assertions permit
- under-refusal: answered something the assertions say to refuse or escalate
- invalid-user-input: the request itself is malformed, empty, or unanswerable as written
- edge-case-input: the request is valid but outside what the instructions anticipate
- reference-may-be-stale: the reply looks correct and the expected answer looks outdated
- unclassified: none of the above fit

Return only JSON, no prose and no code fences:
{"verdict":"pass|fail|abstain","bucket":"one of the buckets","remediation":"prompt-patch|add-examples|retrieval-config|author-kb-content|guardrail|schema-enforcement|model-change|upstream-input-validation|no-action","confidence":0.0,"evidence":"verbatim quote or empty string","reason":"one or two sentences","failedAssertions":[]}`;

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]`;
}

function buildJudgeUser(
  trace: Trace,
  assertions: RubricAssertion[],
  mode: JudgeMode
): string {
  const seg = trace.segments;
  const parts: string[] = [];

  parts.push(
    `EXPECTATIONS\n${assertions
      .filter((a) => a.enabled)
      .map((a, i) => `${i + 1}. ${a.text}`)
      .join('\n')}`
  );

  if (seg?.masterPrompt) {
    parts.push(`AGENT INSTRUCTIONS\n${truncate(seg.masterPrompt, 4000)}`);
  }
  const context = trace.retrievedContext || seg?.retrievedContext || '';
  parts.push(
    context
      ? `RETRIEVED CONTEXT\n${truncate(context, 8000)}`
      : 'RETRIEVED CONTEXT\n[not available in this export — you cannot judge grounding, so abstain on any assertion that depends on it]'
  );
  parts.push(`USER REQUEST\n${truncate(seg?.userQuery || trace.input, 4000)}`);
  parts.push(`AGENT REPLY\n${truncate(trace.output, 6000)}`);

  if (trace.reasoning) {
    parts.push(`AGENT REASONING\n${truncate(trace.reasoning, 3000)}`);
  }
  if (mode === 'reference' && trace.groundTruth) {
    parts.push(
      `EXPECTED ANSWER\nThis is the reference. Compare the reply against it. It may itself be outdated — if the reply looks correct and the reference looks stale, use bucket reference-may-be-stale.\n${truncate(
        trace.groundTruth,
        4000
      )}`
    );
  }

  return parts.join('\n\n');
}

interface RawJudgement {
  verdict?: string;
  bucket?: string;
  remediation?: string;
  confidence?: number;
  evidence?: string;
  reason?: string;
}

const REMEDIATIONS: Remediation[] = [
  'prompt-patch',
  'add-examples',
  'retrieval-config',
  'author-kb-content',
  'guardrail',
  'schema-enforcement',
  'model-change',
  'upstream-input-validation',
  'no-action',
];

/**
 * Rule-based correction of the model's bucket choice. The distinction
 * between a retrieval failure and the model ignoring available context is
 * decidable from the trace, so it is not left to the judge's opinion.
 */
function reconcileBucket(
  claimed: Bucket,
  trace: Trace,
  evidence: string
): Bucket | null {
  const context = trace.retrievedContext || trace.segments?.retrievedContext || '';
  const hasReference = Boolean(trace.groundTruth?.trim());

  // Without a reference answer there is nothing in the trace that separates
  // a genuine retrieval failure from a correct refusal on an out-of-scope
  // request. Neither bucket is assignable, so the row abstains instead.
  if (!hasReference && (claimed === 'retrieval-miss' || claimed === 'knowledge-gap')) {
    return null;
  }

  if (!context) {
    // Nothing was retrieved, so the model cannot have ignored it.
    if (claimed === 'context-ignored') return hasReference ? 'retrieval-miss' : null;
    return claimed;
  }

  // The quoted span being present in the context settles this without
  // needing the judge's opinion: the fact was there and was not used.
  if (claimed === 'retrieval-miss' && evidence && context.includes(evidence.slice(0, 60))) {
    return 'context-ignored';
  }
  return claimed;
}

export async function judgeTrace(
  conn: JudgeConnection,
  trace: Trace,
  assertions: RubricAssertion[],
  signal?: AbortSignal
): Promise<Finding> {
  const mode: JudgeMode = trace.groundTruth?.trim() ? 'reference' : 'reference-free';

  const base = {
    rowIndex: trace.rowIndex,
    traceId: trace.traceId,
    mode,
    promptVersion: trace.promptVersion,
  };

  let raw: string;
  try {
    raw = await callModel({
      ...conn,
      maxTokens: 900,
      signal,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: buildJudgeUser(trace, assertions, mode) },
      ],
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return {
      ...base,
      verdict: 'error' as Verdict,
      bucket: 'unclassified',
      remediation: 'no-action',
      confidence: 0,
      evidence: '',
      reason: err instanceof ModelError ? err.message : String(err),
    };
  }

  let parsed: RawJudgement;
  try {
    parsed = extractJson<RawJudgement>(raw);
  } catch {
    return {
      ...base,
      verdict: 'error',
      bucket: 'unclassified',
      remediation: 'no-action',
      confidence: 0,
      evidence: '',
      reason: `Judge reply was not valid JSON: ${raw.slice(0, 160)}`,
    };
  }

  const verdict: Verdict =
    parsed.verdict === 'pass' || parsed.verdict === 'fail' || parsed.verdict === 'abstain'
      ? parsed.verdict
      : 'error';

  const claimedBucket = (BUCKETS as readonly string[]).includes(parsed.bucket ?? '')
    ? (parsed.bucket as Bucket)
    : 'unclassified';

  const evidence = typeof parsed.evidence === 'string' ? parsed.evidence : '';

  // A failure with no quoted evidence violates the contract, so it is
  // downgraded rather than reported as a finding.
  if (verdict === 'fail' && !evidence.trim()) {
    return {
      ...base,
      verdict: 'abstain',
      bucket: 'unclassified',
      remediation: 'no-action',
      confidence: 0,
      evidence: '',
      reason: parsed.reason ?? '',
      abstainReason: 'Judge raised a failure without quoting supporting text.',
    };
  }

  const reconciled =
    verdict === 'pass' ? 'unclassified' : reconcileBucket(claimedBucket, trace, evidence);

  if (reconciled === null) {
    return {
      ...base,
      verdict: 'abstain',
      bucket: 'unclassified',
      remediation: 'no-action',
      confidence: 0,
      evidence,
      reason: parsed.reason ?? '',
      abstainReason:
        'The reply reports missing information, but with no expected answer there is no way to tell a retrieval failure from a correct refusal.',
    };
  }

  return {
    ...base,
    verdict,
    bucket: reconciled,
    remediation: REMEDIATIONS.includes(parsed.remediation as Remediation)
      ? (parsed.remediation as Remediation)
      : 'no-action',
    confidence:
      typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
    evidence,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    abstainReason: verdict === 'abstain' ? parsed.reason : undefined,
  };
}

export interface SchedulerHandle {
  cancel: () => void;
}

export interface SchedulerOpts {
  conn: JudgeConnection;
  traces: Trace[];
  assertions: RubricAssertion[];
  startConcurrency?: number;
  onFinding: (f: Finding) => void;
  onConcurrencyChange?: (n: number) => void;
  onDone: () => void;
}

/**
 * Worker pool that backs off on 429s and steps concurrency back up after a
 * clean streak. Results are emitted as they arrive so the UI stays live and
 * a cancelled run keeps everything already judged.
 */
export function runJudgeQueue(opts: SchedulerOpts): SchedulerHandle {
  const controller = new AbortController();
  const queue = [...opts.traces];
  let concurrency = opts.startConcurrency ?? 5;
  let active = 0;
  let cleanStreak = 0;
  let stopped = false;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function attempt(trace: Trace): Promise<Finding> {
    let delay = 1000;
    for (let tries = 0; tries < 4; tries++) {
      const finding = await judgeTrace(opts.conn, trace, opts.assertions, controller.signal);
      const rateLimited =
        finding.verdict === 'error' && /\b429\b/.test(finding.reason);
      const serverError =
        finding.verdict === 'error' && /\b5\d\d\b/.test(finding.reason);

      if (!rateLimited && !serverError) {
        cleanStreak++;
        if (cleanStreak > 12 && concurrency < 8) {
          concurrency++;
          cleanStreak = 0;
          opts.onConcurrencyChange?.(concurrency);
        }
        return finding;
      }

      cleanStreak = 0;
      if (rateLimited && concurrency > 1) {
        concurrency = Math.max(1, Math.floor(concurrency / 2));
        opts.onConcurrencyChange?.(concurrency);
      }
      await sleep(delay + Math.random() * 400);
      delay *= 2;
      if (stopped) break;
    }
    return {
      rowIndex: trace.rowIndex,
      traceId: trace.traceId,
      mode: trace.groundTruth?.trim() ? 'reference' : 'reference-free',
      verdict: 'error',
      bucket: 'unclassified',
      remediation: 'no-action',
      confidence: 0,
      evidence: '',
      reason: 'Gave up after repeated rate limiting or server errors.',
      promptVersion: trace.promptVersion,
    };
  }

  async function worker() {
    while (!stopped) {
      const trace = queue.shift();
      if (!trace) break;
      active++;
      try {
        const finding = await attempt(trace);
        if (!stopped) opts.onFinding(finding);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          opts.onFinding({
            rowIndex: trace.rowIndex,
            traceId: trace.traceId,
            mode: 'reference-free',
            verdict: 'error',
            bucket: 'unclassified',
            remediation: 'no-action',
            confidence: 0,
            evidence: '',
            reason: String(err),
          });
        }
      } finally {
        active--;
      }
      while (active >= concurrency && !stopped) await sleep(120);
    }
    if (active === 0 && queue.length === 0) opts.onDone();
  }

  for (let i = 0; i < concurrency; i++) void worker();

  return {
    cancel: () => {
      stopped = true;
      controller.abort();
      opts.onDone();
    },
  };
}
