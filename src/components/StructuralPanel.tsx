import { useState } from 'react';
import { STRUCTURAL_LABELS, STRUCTURAL_SEVERITY } from '../lib/structural';
import type { StructuralIssue, Trace } from '../types';
import { Badge } from './ui';

const ORDER = { high: 0, medium: 1, low: 2 } as const;

function IssueRows({ issue, traces }: { issue: StructuralIssue; traces: Map<number, Trace> }) {
  const [selected, setSelected] = useState(issue.rowIndexes[0]);
  const trace = traces.get(selected);

  return (
    <div className="issue-detail">
      <div className="row-tabs">
        {issue.rowIndexes.slice(0, 24).map((r) => {
          const t = traces.get(r);
          return (
            <button
              key={r}
              type="button"
              className={`row-tab${r === selected ? ' row-tab-on' : ''}`}
              onClick={() => setSelected(r)}
              title={t?.traceId}
            >
              {r + 2}
            </button>
          );
        })}
        {issue.rowIndexes.length > 24 && (
          <span className="row-tab-more">+{issue.rowIndexes.length - 24} more</span>
        )}
      </div>

      {trace ? (
        <>
          <p className="issue-meta">
            {trace.feature && <span>{trace.feature} · </span>}
            {trace.traceId}
            {trace.timestamp && <span> · {trace.timestamp}</span>}
          </p>
          <div className="panes">
            <div className="pane">
              <p className="pane-label">Retrieved context</p>
              <pre className="pane-text">
                {trace.retrievedContext || trace.segments?.retrievedContext || 'Not available'}
              </pre>
            </div>
            <div className="pane">
              <p className="pane-label">Request</p>
              <pre className="pane-text">{trace.segments?.userQuery || trace.input}</pre>
            </div>
            <div className="pane">
              <p className="pane-label">Reply</p>
              <pre className="pane-text">{trace.output || '—'}</pre>
            </div>
          </div>
        </>
      ) : (
        <p className="note">Row not found in the loaded traces.</p>
      )}
    </div>
  );
}

export function StructuralPanel({
  issues,
  traces,
  compact,
  collapsible,
}: {
  issues: StructuralIssue[];
  traces: Trace[];
  compact?: boolean;
  /** Starts collapsed behind a summary line, for a long list on the results screen. */
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(!collapsible);
  const byRow = new Map(traces.map((t) => [t.rowIndex, t]));

  if (issues.length === 0) {
    return (
      <p className="note">
        No duplicate calls, repeated passages or empty fields found. The export
        looks structurally clean.
      </p>
    );
  }

  const sorted = [...issues].sort(
    (a, b) =>
      ORDER[STRUCTURAL_SEVERITY[a.kind]] - ORDER[STRUCTURAL_SEVERITY[b.kind]] ||
      b.rowIndexes.length - a.rowIndexes.length
  );

  const affected = new Set(issues.flatMap((i) => i.rowIndexes)).size;

  const summary = (
    <p className="structural-head">
      {issues.length} issue{issues.length === 1 ? '' : 's'} across {affected} rows.
      These are defects in how traces were produced or exported, not in what the
      agent said, so they are counted separately from behavioural findings.
    </p>
  );

  if (collapsible && !expanded) {
    return (
      <div className="structural">
        {summary}
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setExpanded(true)}>
          Show {issues.length} issue{issues.length === 1 ? '' : 's'}
        </button>
      </div>
    );
  }

  const shown = compact ? sorted.slice(0, 6) : sorted;

  return (
    <div className="structural">
      <div className="structural-top">
        {summary}
        {collapsible && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setExpanded(false)}>
            Collapse
          </button>
        )}
      </div>

      {shown.map((issue, i) => {
        const severity = STRUCTURAL_SEVERITY[issue.kind];
        const isOpen = open === i;
        return (
          <div key={`${issue.kind}-${i}`} className="struct-row">
            <div className="struct-top" onClick={() => setOpen(isOpen ? null : i)} role="button">
              <Badge tone={severity === 'high' ? 'bad' : severity === 'medium' ? 'warn' : 'neutral'}>
                {STRUCTURAL_LABELS[issue.kind]}
              </Badge>
              <span className="struct-rows">
                {issue.rowIndexes.length === 1
                  ? `row ${issue.rowIndexes[0] + 2}`
                  : `rows ${issue.rowIndexes
                      .slice(0, 4)
                      .map((r) => r + 2)
                      .join(', ')}${issue.rowIndexes.length > 4 ? ` +${issue.rowIndexes.length - 4}` : ''}`}
              </span>
              <span className="struct-caret">{isOpen ? 'hide rows' : 'view rows'}</span>
            </div>
            <p className="struct-detail">{issue.detail}</p>
            {issue.evidence && !isOpen && (
              <pre className="struct-evidence">{issue.evidence}</pre>
            )}
            {isOpen && <IssueRows issue={issue} traces={byRow} />}
          </div>
        );
      })}

      {compact && sorted.length > shown.length && (
        <p className="note">
          {sorted.length - shown.length} more shown on the results screen.
        </p>
      )}
    </div>
  );
}
