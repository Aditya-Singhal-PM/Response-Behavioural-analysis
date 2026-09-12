import { useMemo, useState } from 'react';
import { severityRank } from '../lib/cluster';
import { exportSnapshot, exportWorkbook } from '../lib/exportRun';
import { useApp } from '../state/AppContext';
import { BUCKET_LABELS } from '../types';
import type { Bucket, Finding, Verdict } from '../types';
import { Badge, Button, Callout, Card, Empty, Stat } from '../components/ui';
import { StructuralPanel } from '../components/StructuralPanel';

type Filter = 'all' | Verdict;

export function ResultsScreen() {
  const {
    findings,
    clusters,
    traces,
    stats,
    rawRows,
    rawColumns,
    assertions,
    intent,
    provider,
    fileName,
    setFeedback,
    structural,
  } = useApp();

  const [filter, setFilter] = useState<Filter>('fail');
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [clusterFilter, setClusterFilter] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const byRow = useMemo(() => new Map(traces.map((t) => [t.rowIndex, t])), [traces]);

  const buckets = useMemo(() => {
    const counts = new Map<Bucket, number>();
    for (const f of findings) {
      if (f.verdict !== 'fail') continue;
      counts.set(f.bucket, (counts.get(f.bucket) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || severityRank(a[0]) - severityRank(b[0])
    );
  }, [findings]);

  const agreement = useMemo(() => {
    const rated = findings.filter((f) => f.feedback);
    if (rated.length === 0) return null;
    const agreed = rated.filter((f) => f.feedback === 'agree').length;
    return { rated: rated.length, pct: Math.round((agreed / rated.length) * 100) };
  }, [findings]);

  const byFeature = useMemo(() => {
    const map = new Map<string, { judged: number; passed: number; abstained: number; errored: number }>();
    for (const f of findings) {
      const key = f.feature || '(no feature)';
      const e = map.get(key) ?? { judged: 0, passed: 0, abstained: 0, errored: 0 };
      if (f.verdict === 'pass') { e.judged++; e.passed++; }
      else if (f.verdict === 'fail') e.judged++;
      else if (f.verdict === 'abstain') e.abstained++;
      else e.errored++;
      map.set(key, e);
    }
    return [...map.entries()].sort((a, b) => b[1].judged - a[1].judged);
  }, [findings]);
  const hasFeatures = byFeature.some(([k]) => k !== '(no feature)');

  const modeSplit = useMemo(() => {
    const ref = findings.filter((f) => f.mode === 'reference');
    const free = findings.filter((f) => f.mode === 'reference-free');
    const rate = (list: Finding[]) => {
      const judged = list.filter((f) => f.verdict === 'pass' || f.verdict === 'fail');
      return judged.length
        ? Math.round(
            (judged.filter((f) => f.verdict === 'pass').length / judged.length) * 100
          )
        : null;
    };
    return { refCount: ref.length, freeCount: free.length, refRate: rate(ref), freeRate: rate(free) };
  }, [findings]);

  if (findings.length === 0) {
    return (
      <Card title="Findings">
        <Empty title="No run has finished">
          Judge some rows and the findings will collect here.
        </Empty>
      </Card>
    );
  }

  const visible = findings
    .filter((f) => (filter === 'all' ? true : f.verdict === filter))
    .filter((f) =>
      clusterFilter === null
        ? true
        : (clusters.find((c) => c.id === clusterFilter)?.rowIndexes ?? []).includes(
            f.rowIndex
          )
    )
    .sort((a, b) => severityRank(a.bucket) - severityRank(b.bucket));

  async function download() {
    setExporting(true);
    try {
      await exportWorkbook({
        rawRows,
        rawColumns,
        traces,
        findings,
        clusters,
        assertions,
        intent,
        model: provider.model,
        baseUrl: provider.baseUrl,
        fileName: fileName ?? 'unknown',
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="results">
      <Card
        title="Run summary"
        subtitle="The denominator is rows that produced a usable verdict, not rows in the file. Abstains are neither passes nor failures."
        actions={
          <>
            <Button onClick={() => void download()} disabled={exporting}>
              {exporting ? 'Building workbook' : 'Download xlsx'}
            </Button>
            <Button
              onClick={() =>
                exportSnapshot({
                  intent,
                  assertions,
                  findings,
                  clusters,
                  model: provider.model,
                  fileName: fileName ?? 'unknown',
                })
              }
            >
              Save snapshot
            </Button>
          </>
        }
      >
        <div className="stats">
          <Stat label="Judged" value={stats.judged} />
          <Stat
            label="Pass rate"
            value={stats.judged ? `${Math.round((stats.passed / stats.judged) * 100)}%` : '—'}
            tone="ok"
          />
          <Stat label="Failed" value={stats.failed} tone="bad" />
          <Stat label="Abstained" value={stats.abstained} tone="warn" />
          <Stat label="Errored" value={stats.errored} tone="bad" />
        </div>

        {modeSplit.refCount > 0 && modeSplit.freeCount > 0 && (
          <div style={{ marginTop: 16 }}>
            <Callout tone="info">
              {modeSplit.refCount} rows judged against ground truth at{' '}
              {modeSplit.refRate}% pass; {modeSplit.freeCount} judged against the rubric
              alone at {modeSplit.freeRate}%. A wide gap between those two usually means
              the rubric is stricter or vaguer than the references, not that the agent
              behaves differently on those rows.
            </Callout>
          </div>
        )}

        {agreement && (
          <div style={{ marginTop: 12 }}>
            <Callout tone={agreement.pct >= 75 ? 'ok' : 'warn'}>
              You agreed with {agreement.pct}% of the {agreement.rated} findings you
              reviewed. That number, not the pass rate, is what tells you whether to
              trust this run.
            </Callout>
          </div>
        )}

        {hasFeatures && byFeature.length > 1 && (
          <div className="feature-table">
            <p className="pane-label">By feature</p>
            <table className="table table-tight">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Judged</th>
                  <th>Pass rate</th>
                  <th>Abstained</th>
                  <th>Errored</th>
                </tr>
              </thead>
              <tbody>
                {byFeature.map(([name, e]) => (
                  <tr key={name}>
                    <td className="mono">{name}</td>
                    <td className="mono">{e.judged}</td>
                    <td className="mono">
                      {e.judged ? `${Math.round((e.passed / e.judged) * 100)}%` : '—'}
                    </td>
                    <td className="mono">{e.abstained}</td>
                    <td className="mono">{e.errored}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {buckets.length > 0 && (
          <div className="bucket-bars">
            {buckets.map(([bucket, count]) => (
              <div key={bucket} className="bucket-row">
                <span className="bucket-name">{BUCKET_LABELS[bucket]}</span>
                <div className="bucket-track">
                  <div
                    className="bucket-fill"
                    style={{ width: `${(count / buckets[0][1]) * 100}%` }}
                  />
                </div>
                <span className="bucket-count">{count}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {structural.length > 0 && (
        <Card
          title="Pipeline issues"
          subtitle="Found without a model call, from the structure of the export alone. Worth clearing first — duplicates in particular distort every number above."
        >
          <StructuralPanel issues={structural} traces={traces} />
        </Card>
      )}

      {clusters.length > 0 && (
        <Card
          title="Patterns"
          subtitle="Each of these explains several failures at once. Fixing the pattern is what moves the numbers; fixing individual rows does not."
        >
          {clusters
            .slice()
            .sort(
              (a, b) =>
                b.rowIndexes.length - a.rowIndexes.length ||
                severityRank(a.bucket) - severityRank(b.bucket)
            )
            .map((c) => (
              <div key={c.id} className="cluster">
                <div className="cluster-head">
                  <Badge tone="bad">{BUCKET_LABELS[c.bucket]}</Badge>
                  <Badge tone="accent">{c.scope}</Badge>
                  <span className="cluster-count">
                    {c.rowIndexes.length} failures
                  </span>
                  <Button
                    size="sm"
                    onClick={() => {
                      setClusterFilter(clusterFilter === c.id ? null : c.id);
                      setFilter('fail');
                    }}
                  >
                    {clusterFilter === c.id ? 'Clear filter' : 'Show rows'}
                  </Button>
                </div>
                <p className="cluster-pattern">{c.pattern}</p>
                {c.proposedPatch && (
                  <div className="patch">
                    <p className="patch-label">Proposed change</p>
                    <p className="patch-text">{c.proposedPatch}</p>
                  </div>
                )}
              </div>
            ))}
        </Card>
      )}

      <Card
        title="Rows"
        subtitle="Every finding quotes the text it is based on. If a quote does not support the claim, mark it and the disagreement counts toward the agreement rate above."
      >
        <div className="filters">
          {(['fail', 'abstain', 'error', 'pass', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`filter${filter === f ? ' filter-on' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
          {clusterFilter !== null && (
            <span className="filter-note">
              filtered to pattern {clusterFilter}
            </span>
          )}
        </div>

        {visible.length === 0 ? (
          <Empty title="Nothing matches that filter" />
        ) : (
          visible.map((f) => {
            const trace = byRow.get(f.rowIndex);
            const open = openRow === f.rowIndex;
            return (
              <div key={f.rowIndex} className="finding">
                <div
                  className="finding-head"
                  onClick={() => setOpenRow(open ? null : f.rowIndex)}
                  role="button"
                >
                  <Badge
                    tone={
                      f.verdict === 'pass'
                        ? 'ok'
                        : f.verdict === 'fail'
                          ? 'bad'
                          : f.verdict === 'abstain'
                            ? 'warn'
                            : 'neutral'
                    }
                  >
                    {f.verdict}
                  </Badge>
                  <span className="finding-id">
                    {f.feature ? `${f.feature} · ` : ''}{f.traceId}
                  </span>
                  {f.verdict === 'fail' && (
                    <span className="finding-bucket">{BUCKET_LABELS[f.bucket]}</span>
                  )}
                  <span className="finding-reason">
                    {f.abstainReason ?? f.reason}
                  </span>
                  <span className="finding-caret">{open ? '−' : '+'}</span>
                </div>

                {open && trace && (
                  <div className="finding-body">
                    {f.evidence && (
                      <div className="evidence">
                        <p className="pane-label">Quoted evidence</p>
                        <p className="evidence-text">{f.evidence}</p>
                      </div>
                    )}

                    <div className="panes">
                      <div className="pane">
                        <p className="pane-label">Retrieved context</p>
                        <pre className="pane-text">
                          {trace.retrievedContext || 'Not available'}
                        </pre>
                      </div>
                      <div className="pane">
                        <p className="pane-label">Request</p>
                        <pre className="pane-text">
                          {trace.segments?.userQuery || trace.input}
                        </pre>
                      </div>
                      <div className="pane">
                        <p className="pane-label">Reply</p>
                        <pre className="pane-text">{trace.output}</pre>
                      </div>
                      {trace.groundTruth && (
                        <div className="pane">
                          <p className="pane-label">Ground truth</p>
                          <pre className="pane-text">{trace.groundTruth}</pre>
                        </div>
                      )}
                    </div>

                    <div className="finding-foot">
                      <span className="finding-meta">
                        {f.mode} · confidence {f.confidence.toFixed(2)} ·{' '}
                        {f.remediation} · {f.promptVersion}
                      </span>
                      <div className="feedback">
                        {(['agree', 'disagree', 'not-an-issue'] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            className={`fb${f.feedback === v ? ' fb-on' : ''}`}
                            onClick={() => setFeedback(f.rowIndex, v)}
                          >
                            {v.replace(/-/g, ' ')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
