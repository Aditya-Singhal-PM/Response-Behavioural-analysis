import { useMemo, useRef, useState } from 'react';
import { runJudgeQueue } from '../lib/judge';
import type { SchedulerHandle } from '../lib/judge';
import { synthesiseClusters } from '../lib/cluster';
import { useApp } from '../state/AppContext';
import { Button, Callout, Card, Empty, Field, Stat } from '../components/ui';

export function RunScreen() {
  const {
    traces,
    assertions,
    provider,
    findings,
    addFinding,
    setClusters,
    addCluster,
    stats,
    goTo,
  } = useApp();

  const [running, setRunning] = useState(false);
  const [synthesising, setSynthesising] = useState(false);
  const [concurrency, setConcurrency] = useState(5);
  const [limit, setLimit] = useState(String(Math.min(traces.length, 50)));
  const handleRef = useRef<SchedulerHandle | null>(null);

  const judgedRows = useMemo(
    () => new Set(findings.map((f) => f.rowIndex)),
    [findings]
  );

  if (traces.length === 0) {
    return (
      <Card title="Run">
        <Empty title="Nothing loaded">Load and map a file first.</Empty>
      </Card>
    );
  }

  const cap = Math.max(1, Math.min(Number(limit) || 1, traces.length));
  const pending = traces.slice(0, cap).filter((t) => !judgedRows.has(t.rowIndex));

  // Rough estimate from the actual segmented text, so it moves with the data.
  const estTokens = useMemo(() => {
    const sample = traces.slice(0, 20);
    const avgChars =
      sample.reduce(
        (n, t) =>
          n +
          (t.segments?.masterPrompt.length ?? 0) +
          t.retrievedContext.length +
          t.input.length +
          t.output.length +
          t.groundTruth.length,
        0
      ) / Math.max(sample.length, 1);
    return Math.round((avgChars / 4) * pending.length);
  }, [traces, pending.length]);

  function start() {
    setRunning(true);
    handleRef.current = runJudgeQueue({
      conn: {
        providerId: provider.providerId,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
      },
      traces: pending,
      assertions,
      startConcurrency: concurrency,
      onFinding: addFinding,
      onConcurrencyChange: setConcurrency,
      onDone: () => {
        setRunning(false);
        handleRef.current = null;
      },
    });
  }

  function stop() {
    handleRef.current?.cancel();
    setRunning(false);
  }

  async function synthesise() {
    setSynthesising(true);
    setClusters([]);
    try {
      await synthesiseClusters(
        {
          providerId: provider.providerId,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
        },
        findings,
        traces,
        addCluster
      );
    } finally {
      setSynthesising(false);
      goTo('results');
    }
  }

  const done = findings.length;
  const progress = cap ? Math.min(100, Math.round((done / cap) * 100)) : 0;
  const abstainRate = stats.judged + stats.abstained
    ? stats.abstained / (stats.judged + stats.abstained)
    : 0;

  return (
    <Card
      title="Run"
      subtitle="One call per row, judged concurrently. Concurrency drops automatically when the provider rate-limits and climbs back after a clean streak."
      actions={
        <>
          {running ? (
            <Button variant="danger" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button variant="go" onClick={start} disabled={pending.length === 0}>
              {done > 0 ? `Judge ${pending.length} remaining` : `Judge ${pending.length} rows`}
            </Button>
          )}
          <Button
            onClick={() => void synthesise()}
            disabled={running || synthesising || stats.failed === 0}
          >
            {synthesising ? 'Finding patterns' : 'Find patterns and continue'}
          </Button>
        </>
      }
    >
      {!running && done === 0 && (
        <div className="grid-2" style={{ marginBottom: 18 }}>
          <Field
            label="Rows to judge"
            hint={`Of ${traces.length.toLocaleString()} loaded. Start small.`}
          >
            <input
              type="number"
              min={1}
              max={traces.length}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </Field>
          <Field label="Starting concurrency" hint="Adjusts itself during the run">
            <input
              type="number"
              min={1}
              max={10}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value) || 1)}
            />
          </Field>
        </div>
      )}

      <div className="progress">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="stats">
        <Stat label="Passed" value={stats.passed} tone="ok" />
        <Stat label="Failed" value={stats.failed} tone="bad" />
        <Stat label="Abstained" value={stats.abstained} tone="warn" />
        <Stat label="Errored" value={stats.errored} tone="bad" />
        <Stat label="Remaining" value={pending.length} />
      </div>

      <div className="run-meta">
        <span>
          pass rate{' '}
          {stats.judged ? `${Math.round((stats.passed / stats.judged) * 100)}%` : '—'} of{' '}
          {stats.judged} judged
        </span>
        <span>concurrency {concurrency}</span>
        <span>{provider.model}</span>
      </div>

      {!running && done === 0 && (
        <div style={{ marginTop: 16 }}>
          <Callout tone="info">
            Roughly {estTokens.toLocaleString()} input tokens for {pending.length} rows,
            before the reply. Check that against your provider's pricing before running
            the whole file.
          </Callout>
        </div>
      )}

      {abstainRate > 0.2 && (
        <div style={{ marginTop: 16 }}>
          <Callout tone="warn">
            {Math.round(abstainRate * 100)}% of rows are coming back as abstain. That is
            a signal about the export rather than the agent — usually a missing
            retrieved context. Worth stopping and revisiting the segmentation before
            spending more calls.
          </Callout>
        </div>
      )}

      {stats.errored > 0 && stats.errored === done && (
        <div style={{ marginTop: 16 }}>
          <Callout tone="bad">
            Every row errored. The connection worked on the setup step, so this is most
            likely the model refusing the output format or hitting a context limit.
            Check the reason on the results screen.
          </Callout>
        </div>
      )}
    </Card>
  );
}
