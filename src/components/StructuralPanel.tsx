import { STRUCTURAL_LABELS, STRUCTURAL_SEVERITY } from '../lib/structural';
import type { StructuralIssue } from '../types';
import { Badge } from './ui';

const ORDER = { high: 0, medium: 1, low: 2 } as const;

export function StructuralPanel({
  issues,
  compact,
}: {
  issues: StructuralIssue[];
  compact?: boolean;
}) {
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

  const shown = compact ? sorted.slice(0, 6) : sorted;
  const affected = new Set(issues.flatMap((i) => i.rowIndexes)).size;

  return (
    <div className="structural">
      <p className="structural-head">
        {issues.length} issue{issues.length === 1 ? '' : 's'} across {affected} rows.
        These are defects in how traces were produced or exported, not in what the
        agent said, so they are counted separately from behavioural findings.
      </p>

      {shown.map((issue, i) => {
        const severity = STRUCTURAL_SEVERITY[issue.kind];
        return (
          <div key={`${issue.kind}-${i}`} className="struct-row">
            <div className="struct-top">
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
            </div>
            <p className="struct-detail">{issue.detail}</p>
            {issue.evidence && (
              <pre className="struct-evidence">{issue.evidence}</pre>
            )}
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
