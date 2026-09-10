import { useEffect, useMemo, useState } from 'react';
import { applyTemplate, deriveTemplate, matchStats, segmentAll } from '../lib/segment';
import { useApp } from '../state/AppContext';
import { Badge, Button, Callout, Card, Empty, Field } from '../components/ui';

export function SegmentScreen() {
  const { traces, setTraces, template, setTemplate, goTo } = useApp();
  const [row, setRow] = useState(0);
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  useEffect(() => {
    if (!template && traces.length > 0) {
      const derived = deriveTemplate(traces.map((t) => t.input));
      setTemplate(derived);
      setStart(derived.contextStart);
      setEnd(derived.contextEnd);
      setTraces(segmentAll(traces, derived));
    }
  }, [traces, template, setTemplate, setTraces]);

  const stats = useMemo(() => matchStats(traces), [traces]);
  const versions = useMemo(
    () => [...new Set(traces.map((t) => t.promptVersion).filter(Boolean))],
    [traces]
  );

  if (traces.length === 0) {
    return (
      <Card title="Prompt segmentation">
        <Empty title="Nothing to segment">Map your columns first.</Empty>
      </Card>
    );
  }

  const current = traces[Math.min(row, traces.length - 1)];
  const seg = current?.segments ?? applyTemplate(current?.input ?? '', {
    masterPromptSample: '',
    contextStart: '',
    contextEnd: '',
    matchRate: 0,
  });

  function reapply() {
    const next = {
      masterPromptSample: template?.masterPromptSample ?? '',
      contextStart: start,
      contextEnd: end,
      matchRate: 0,
    };
    const applied = segmentAll(traces, next);
    const rate = applied.filter((t) => t.segments?.matched).length / applied.length;
    setTemplate({ ...next, matchRate: rate });
    setTraces(applied);
    setEditing(false);
  }

  const rate = stats.total ? stats.matched / stats.total : 0;

  return (
    <Card
      title="Prompt segmentation"
      subtitle="Every input is split into the invariant instructions, the retrieved context, and the actual request. This split is what lets a failure be blamed on retrieval rather than on the prompt."
      actions={
        <>
          <Button onClick={() => setEditing((v) => !v)}>
            {editing ? 'Cancel' : 'Edit delimiters'}
          </Button>
          <Button variant="go" onClick={() => goTo('rubric')}>
            Continue
          </Button>
        </>
      }
    >
      <div className="row-nav">
        <Field label="Preview row">
          <select value={row} onChange={(e) => setRow(Number(e.target.value))}>
            {traces.slice(0, 200).map((t, i) => (
              <option key={t.rowIndex} value={i}>
                {i + 1} — {t.traceId}
              </option>
            ))}
          </select>
        </Field>
        <div className="row-meta">
          <Badge tone={seg.matched ? 'ok' : 'warn'}>
            {seg.matched ? 'segmented' : 'not segmented'}
          </Badge>
          <Badge tone="accent">{current?.promptVersion}</Badge>
          {current?.groundTruth ? (
            <Badge tone="ok">has ground truth</Badge>
          ) : (
            <Badge>no reference</Badge>
          )}
        </div>
      </div>

      {editing && (
        <div className="edit-box">
          <div className="grid-2">
            <Field label="Context starts after" hint="Literal text, matched exactly">
              <input value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Context ends before" hint="The request follows this">
              <input value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <Button variant="go" size="sm" onClick={reapply} style={{ marginTop: 12 }}>
            Apply to all rows
          </Button>
        </div>
      )}

      <div className="panes">
        <div className="pane">
          <p className="pane-label">Agent instructions</p>
          <pre className="pane-text">
            {seg.masterPrompt || 'No invariant prefix found across rows'}
          </pre>
        </div>
        <div className="pane">
          <p className="pane-label">Retrieved context</p>
          <pre className="pane-text">
            {current?.retrievedContext || seg.retrievedContext || 'Not found in this row'}
          </pre>
        </div>
        <div className="pane">
          <p className="pane-label">Request</p>
          <pre className="pane-text">{seg.userQuery || 'Not isolated'}</pre>
        </div>
        <div className="pane">
          <p className="pane-label">Reply</p>
          <pre className="pane-text">{current?.output || '—'}</pre>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {rate >= 0.9 ? (
          <Callout tone="ok">
            The template fits {stats.matched} of {stats.total} rows. The{' '}
            {stats.total - stats.matched} that do not match will be judged without a
            separated context, so the judge will abstain on grounding for those.
          </Callout>
        ) : rate >= 0.4 ? (
          <Callout tone="warn">
            Only {stats.matched} of {stats.total} rows match. Open a few rows above,
            find the text that actually brackets the retrieved context, and set the
            delimiters by hand.
          </Callout>
        ) : (
          <Callout tone="bad">
            The template matched almost nothing ({stats.matched} of {stats.total}). If
            your prompt is assembled dynamically with no stable delimiters, retrieval
            attribution is not available on this export — you can still continue, but
            findings will be limited to the prompt and the reasoning.
          </Callout>
        )}
      </div>

      {versions.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <Callout tone="info">
            {versions.length} distinct prompt versions found. Findings are reported per
            version, because a rule missing from one revision may be present in another.
          </Callout>
        </div>
      )}
    </Card>
  );
}
