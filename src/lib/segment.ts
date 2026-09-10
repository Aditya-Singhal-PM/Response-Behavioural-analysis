import type { SegmentTemplate, Segments, Trace } from '../types';

/** Delimiters seen in real prompt assembly, tried in order of specificity. */
const CANDIDATE_DELIMITERS: [string, string][] = [
  ['<documents>', '</documents>'],
  ['<context>', '</context>'],
  ['<retrieved_context>', '</retrieved_context>'],
  ['### Context', '### Question'],
  ['### Context', '### Query'],
  ['### Retrieved', '### Question'],
  ['Context:', 'Question:'],
  ['Context:', 'Query:'],
  ['Retrieved passages:', 'User:'],
  ['Relevant documents:', 'User question:'],
  ['---CONTEXT---', '---QUESTION---'],
];

function commonPrefix(a: string, b: string): string {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return a.slice(0, i);
}

/**
 * The master prompt is whatever every sampled input starts with. Taking the
 * common prefix across a sample recovers it without an LLM call, and the
 * result doubles as the prompt-version key.
 */
export function deriveMasterPrompt(inputs: string[]): string {
  const sample = inputs.filter((s) => s && s.length > 40).slice(0, 40);
  if (sample.length < 2) return '';
  let prefix = sample[0];
  for (let i = 1; i < sample.length; i++) {
    prefix = commonPrefix(prefix, sample[i]);
    if (prefix.length < 30) break;
  }
  return prefix.length >= 30 ? prefix.trimEnd() : '';
}

function scoreDelimiters(inputs: string[], start: string, end: string): number {
  let hits = 0;
  for (const s of inputs) {
    const a = s.indexOf(start);
    if (a === -1) continue;
    const b = s.indexOf(end, a + start.length);
    if (b === -1) continue;
    hits++;
  }
  return inputs.length ? hits / inputs.length : 0;
}

export function deriveTemplate(inputs: string[]): SegmentTemplate {
  const sample = inputs.filter(Boolean).slice(0, 200);
  const masterPromptSample = deriveMasterPrompt(sample);

  let best: SegmentTemplate = {
    masterPromptSample,
    contextStart: '',
    contextEnd: '',
    matchRate: 0,
  };

  for (const [start, end] of CANDIDATE_DELIMITERS) {
    const rate = scoreDelimiters(sample, start, end);
    if (rate > best.matchRate) {
      best = { masterPromptSample, contextStart: start, contextEnd: end, matchRate: rate };
    }
  }
  return best;
}

export function applyTemplate(input: string, tpl: SegmentTemplate): Segments {
  const master = tpl.masterPromptSample && input.startsWith(tpl.masterPromptSample)
    ? tpl.masterPromptSample
    : '';
  const remainder = master ? input.slice(master.length) : input;

  if (!tpl.contextStart || !tpl.contextEnd) {
    return {
      masterPrompt: master,
      retrievedContext: '',
      userQuery: remainder.trim(),
      matched: false,
    };
  }

  const a = remainder.indexOf(tpl.contextStart);
  if (a === -1) {
    return {
      masterPrompt: master,
      retrievedContext: '',
      userQuery: remainder.trim(),
      matched: false,
    };
  }
  const contextFrom = a + tpl.contextStart.length;
  const b = remainder.indexOf(tpl.contextEnd, contextFrom);
  if (b === -1) {
    return {
      masterPrompt: master,
      retrievedContext: remainder.slice(contextFrom).trim(),
      userQuery: '',
      matched: false,
    };
  }

  return {
    masterPrompt: master,
    retrievedContext: remainder.slice(contextFrom, b).trim(),
    userQuery: remainder.slice(b + tpl.contextEnd.length).trim(),
    matched: true,
  };
}

/** Short stable hash, used as a human-readable prompt-version label. */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
}

export function segmentAll(traces: Trace[], tpl: SegmentTemplate): Trace[] {
  return traces.map((t) => {
    const segments = applyTemplate(t.input, tpl);
    const context = t.retrievedContext || segments.retrievedContext;
    return {
      ...t,
      retrievedContext: context,
      segments: { ...segments, retrievedContext: context },
      promptVersion: segments.masterPrompt ? `v-${hash(segments.masterPrompt)}` : 'v-none',
    };
  });
}

export function matchStats(traces: Trace[]): { matched: number; total: number } {
  return {
    matched: traces.filter((t) => t.segments?.matched).length,
    total: traces.length,
  };
}
