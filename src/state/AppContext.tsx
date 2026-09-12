import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ProviderId } from '../lib/providers';
import { PROVIDERS } from '../lib/providers';
import { analyseStructure, redundantRows } from '../lib/structural';
import type {
  Cluster,
  ColumnMapping,
  Finding,
  RubricAssertion,
  RunStats,
  SegmentTemplate,
  StepId,
  StructuralIssue,
  Trace,
} from '../types';

export interface ProviderState {
  providerId: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  maxTokens: number;
  verified: boolean;
}

interface AppState {
  step: StepId;
  goTo: (s: StepId) => void;

  provider: ProviderState;
  patchProvider: (p: Partial<ProviderState>) => void;

  fileName: string | null;
  rawColumns: string[];
  rawRows: Record<string, string>[];
  truncatedCells: number;
  setFile: (
    name: string,
    columns: string[],
    rows: Record<string, string>[],
    truncatedCells: number
  ) => void;

  mapping: ColumnMapping;
  setMapping: (m: ColumnMapping) => void;

  traces: Trace[];
  setTraces: (t: Trace[]) => void;

  template: SegmentTemplate | null;
  setTemplate: (t: SegmentTemplate | null) => void;

  intent: string;
  setIntent: (s: string) => void;
  assertions: RubricAssertion[];
  setAssertions: (a: RubricAssertion[]) => void;
  background: string[];
  setBackground: (b: string[]) => void;

  findings: Finding[];
  addFinding: (f: Finding) => void;
  setFindings: (f: Finding[]) => void;
  setFeedback: (rowIndex: number, value: Finding['feedback']) => void;

  clusters: Cluster[];
  addCluster: (c: Cluster) => void;
  setClusters: (c: Cluster[]) => void;

  stats: RunStats;
  reachable: (step: StepId) => boolean;

  /** Deterministic pipeline defects, derived from the traces with no model call. */
  structural: StructuralIssue[];
  redundant: Set<number>;
  excludeRedundant: boolean;
  setExcludeRedundant: (v: boolean) => void;
}

const AppContext = createContext<AppState | null>(null);
const KEY_STORAGE = 'rba.apiKey';

export function AppProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<StepId>('setup');
  const [provider, setProviderState] = useState<ProviderState>(() => ({
    providerId: 'openai-compatible',
    baseUrl: PROVIDERS['openai-compatible'].defaultBaseUrl,
    model: PROVIDERS['openai-compatible'].defaultModel,
    apiKey: sessionStorage.getItem(KEY_STORAGE) ?? '',
    maxTokens: 2000,
    verified: false,
  }));
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawColumns, setRawColumns] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [truncatedCells, setTruncatedCells] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [traces, setTraces] = useState<Trace[]>([]);
  const [template, setTemplate] = useState<SegmentTemplate | null>(null);
  const [intent, setIntent] = useState('');
  const [assertions, setAssertions] = useState<RubricAssertion[]>([]);
  const [background, setBackground] = useState<string[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [excludeRedundant, setExcludeRedundant] = useState(true);

  // Runs on every trace change. Deterministic and cheap, so there is no
  // reason to make it a separate step the user has to trigger.
  const structural = useMemo(() => analyseStructure(traces), [traces]);
  const redundant = useMemo(() => redundantRows(structural), [structural]);

  const patchProvider = useCallback((patch: Partial<ProviderState>) => {
    setProviderState((prev) => {
      if (patch.apiKey !== undefined) {
        // The key lives for this tab only, never in durable storage.
        sessionStorage.setItem(KEY_STORAGE, patch.apiKey);
      }
      return { ...prev, ...patch };
    });
  }, []);

  const setFile = useCallback(
    (
      name: string,
      columns: string[],
      rows: Record<string, string>[],
      truncated: number
    ) => {
      setFileName(name);
      setRawColumns(columns);
      setRawRows(rows);
      setTruncatedCells(truncated);
      setMapping({});
      setTraces([]);
      setTemplate(null);
      setFindings([]);
      setClusters([]);
    },
    []
  );

  const addFinding = useCallback((f: Finding) => {
    setFindings((prev) =>
      prev.some((p) => p.rowIndex === f.rowIndex) ? prev : [...prev, f]
    );
  }, []);

  const addCluster = useCallback((c: Cluster) => {
    setClusters((prev) => [...prev, c]);
  }, []);

  const setFeedback = useCallback(
    (rowIndex: number, value: Finding['feedback']) => {
      setFindings((prev) =>
        prev.map((f) =>
          f.rowIndex === rowIndex
            ? { ...f, feedback: f.feedback === value ? undefined : value }
            : f
        )
      );
    },
    []
  );

  const stats = useMemo<RunStats>(() => {
    const passed = findings.filter((f) => f.verdict === 'pass').length;
    const failed = findings.filter((f) => f.verdict === 'fail').length;
    return {
      total: traces.length,
      judged: passed + failed,
      passed,
      failed,
      abstained: findings.filter((f) => f.verdict === 'abstain').length,
      errored: findings.filter((f) => f.verdict === 'error').length,
    };
  }, [findings, traces.length]);

  const reachable = useCallback(
    (target: StepId) => {
      switch (target) {
        case 'setup':
          return true;
        case 'upload':
          return provider.verified;
        case 'mapping':
          return provider.verified && rawRows.length > 0;
        case 'segment':
          return traces.length > 0;
        case 'rubric':
          return traces.length > 0;
        case 'run':
          return traces.length > 0 && assertions.some((a) => a.enabled);
        case 'results':
          return findings.length > 0;
      }
    },
    [provider.verified, rawRows.length, traces.length, assertions, findings.length]
  );

  const goTo = useCallback(
    (s: StepId) => {
      setStep(s);
      window.scrollTo({ top: 0 });
    },
    []
  );

  const value = useMemo<AppState>(
    () => ({
      step,
      goTo,
      provider,
      patchProvider,
      fileName,
      rawColumns,
      rawRows,
      truncatedCells,
      setFile,
      mapping,
      setMapping,
      traces,
      setTraces,
      template,
      setTemplate,
      intent,
      setIntent,
      assertions,
      setAssertions,
      background,
      setBackground,
      findings,
      addFinding,
      setFindings,
      setFeedback,
      clusters,
      addCluster,
      setClusters,
      stats,
      reachable,
      structural,
      redundant,
      excludeRedundant,
      setExcludeRedundant,
    }),
    [
      step,
      goTo,
      provider,
      patchProvider,
      fileName,
      rawColumns,
      rawRows,
      truncatedCells,
      setFile,
      mapping,
      traces,
      template,
      intent,
      assertions,
      background,
      findings,
      addFinding,
      setFeedback,
      clusters,
      addCluster,
      stats,
      reachable,
      structural,
      redundant,
      excludeRedundant,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be called inside AppProvider.');
  return ctx;
}
