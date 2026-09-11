export type StepId =
  | 'setup'
  | 'upload'
  | 'mapping'
  | 'segment'
  | 'rubric'
  | 'run'
  | 'results';

export interface Step {
  id: StepId;
  label: string;
  blurb: string;
}

export const STEPS: Step[] = [
  { id: 'setup', label: 'Provider', blurb: 'Connect a judge model' },
  { id: 'upload', label: 'Upload', blurb: 'Load a trace export' },
  { id: 'mapping', label: 'Columns', blurb: 'Map columns to the schema' },
  { id: 'segment', label: 'Segment', blurb: 'Split the prompt blob' },
  { id: 'rubric', label: 'Rubric', blurb: 'Define expected behaviour' },
  { id: 'run', label: 'Run', blurb: 'Judge the traces' },
  { id: 'results', label: 'Results', blurb: 'Findings and clusters' },
];

export type CanonicalField =
  | 'traceId'
  | 'input'
  | 'output'
  | 'reasoning'
  | 'groundTruth'
  | 'retrievedContext'
  | 'model'
  | 'timestamp';

export interface FieldSpec {
  key: CanonicalField;
  label: string;
  required: boolean;
  hint: string;
}

export const CANONICAL_FIELDS: FieldSpec[] = [
  {
    key: 'input',
    label: 'Input',
    required: true,
    hint: 'The full prompt sent to the agent, including any context',
  },
  {
    key: 'output',
    label: 'Output',
    required: true,
    hint: 'What the agent replied',
  },
  {
    key: 'reasoning',
    label: 'Reasoning',
    required: false,
    hint: 'Chain of thought, if captured separately',
  },
  {
    key: 'groundTruth',
    label: 'Ground truth',
    required: false,
    hint: 'Expected answer, required facts, or expected refusal',
  },
  {
    key: 'retrievedContext',
    label: 'Retrieved context',
    required: false,
    hint: 'Only if stored in its own column rather than inside the input',
  },
  {
    key: 'traceId',
    label: 'Trace id',
    required: false,
    hint: 'Unique id per row, used for cross-referencing',
  },
  {
    key: 'model',
    label: 'Model',
    required: false,
    hint: 'Which model produced the output',
  },
  {
    key: 'timestamp',
    label: 'Timestamp',
    required: false,
    hint: 'When the trace was recorded',
  },
];

export type ColumnMapping = Partial<Record<CanonicalField, string>>;

export interface Segments {
  masterPrompt: string;
  retrievedContext: string;
  userQuery: string;
  matched: boolean;
}

export interface Trace {
  rowIndex: number;
  traceId: string;
  input: string;
  output: string;
  reasoning: string;
  groundTruth: string;
  retrievedContext: string;
  model: string;
  timestamp: string;
  segments?: Segments;
  promptVersion?: string;
}

export interface SegmentTemplate {
  /** Recovered invariant prefix, used to group prompt versions. */
  masterPromptSample: string;
  /** Literal delimiter that starts the retrieved-context block. */
  contextStart: string;
  /** Literal delimiter that ends it and starts the user turn. */
  contextEnd: string;
  matchRate: number;
}

export type Verdict = 'pass' | 'fail' | 'abstain' | 'error';

export const BUCKETS = [
  'master-prompt-defect',
  'retrieval-miss',
  'knowledge-gap',
  'context-ignored',
  'hallucination',
  'reasoning-error',
  'output-format',
  'over-refusal',
  'under-refusal',
  'invalid-user-input',
  'edge-case-input',
  'reference-may-be-stale',
  'unclassified',
] as const;

export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_LABELS: Record<Bucket, string> = {
  'master-prompt-defect': 'Master prompt defect',
  'retrieval-miss': 'Retrieval miss',
  'knowledge-gap': 'Knowledge base gap',
  'context-ignored': 'Context present but ignored',
  hallucination: 'Hallucination',
  'reasoning-error': 'Reasoning error',
  'output-format': 'Output format',
  'over-refusal': 'Over-refusal',
  'under-refusal': 'Under-refusal',
  'invalid-user-input': 'Invalid user input',
  'edge-case-input': 'Edge-case input',
  'reference-may-be-stale': 'Reference may be stale',
  unclassified: 'Unclassified',
};

export type Remediation =
  | 'prompt-patch'
  | 'add-examples'
  | 'retrieval-config'
  | 'author-kb-content'
  | 'guardrail'
  | 'schema-enforcement'
  | 'model-change'
  | 'upstream-input-validation'
  | 'no-action';

export type JudgeMode = 'reference' | 'reference-free';

export interface Finding {
  rowIndex: number;
  traceId: string;
  mode: JudgeMode;
  verdict: Verdict;
  bucket: Bucket;
  remediation: Remediation;
  confidence: number;
  /** Verbatim span from the output or context that supports the finding. */
  evidence: string;
  reason: string;
  abstainReason?: string;
  promptVersion?: string;
  clusterId?: number;
  feedback?: 'agree' | 'disagree' | 'not-an-issue';
}

export interface Cluster {
  id: number;
  bucket: Bucket;
  pattern: string;
  rowIndexes: number[];
  proposedPatch: string;
}

export interface RubricAssertion {
  id: string;
  text: string;
  enabled: boolean;
}

export type StructuralKind =
  | 'duplicate-context-block'
  | 'context-fully-duplicated'
  | 'duplicate-trace-id'
  | 'duplicate-fire'
  | 'repeated-request'
  | 'query-insensitive-retrieval'
  | 'empty-context'
  | 'empty-output';

/**
 * A defect in the trace pipeline rather than in the agent's behaviour.
 * Found deterministically, with no model call, before judging starts.
 */
export interface StructuralIssue {
  kind: StructuralKind;
  rowIndexes: number[];
  count: number;
  detail: string;
  evidence: string;
}

export interface RunStats {
  total: number;
  judged: number;
  passed: number;
  failed: number;
  abstained: number;
  errored: number;
}
