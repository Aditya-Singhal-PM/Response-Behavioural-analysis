import { useState } from 'react';
import { proposeMapping } from '../lib/judge';
import { useApp } from '../state/AppContext';
import { CANONICAL_FIELDS } from '../types';
import type { CanonicalField, ColumnMapping, Trace } from '../types';
import { Button, Callout, Card, Empty, Spinner } from '../components/ui';

function buildTraces(
  rows: Record<string, string>[],
  mapping: ColumnMapping
): Trace[] {
  const get = (row: Record<string, string>, field: CanonicalField) => {
    const col = mapping[field];
    return col ? (row[col] ?? '').trim() : '';
  };
  return rows.map((row, i) => ({
    rowIndex: i,
    traceId: get(row, 'traceId') || `row-${i + 2}`,
    feature: get(row, 'feature'),
    input: get(row, 'input'),
    output: get(row, 'output'),
    reasoning: get(row, 'reasoning'),
    groundTruth: get(row, 'groundTruth'),
    retrievedContext: get(row, 'retrievedContext'),
    model: get(row, 'model'),
    timestamp: get(row, 'timestamp'),
  }));
}

export function MappingScreen() {
  const {
    rawColumns,
    rawRows,
    mapping,
    setMapping,
    setTraces,
    provider,
    goTo,
  } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState(false);

  if (rawRows.length === 0) {
    return (
      <Card title="Column mapping">
        <Empty title="No file loaded">
          Load a trace export first and its columns will show up here.
        </Empty>
      </Card>
    );
  }

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      const result = await proposeMapping(
        {
          providerId: provider.providerId,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          maxTokens: provider.maxTokens,
        },
        rawColumns,
        rawRows
      );
      const next: ColumnMapping = {};
      for (const f of CANONICAL_FIELDS) {
        const val = result[f.key];
        if (typeof val === 'string' && rawColumns.includes(val)) next[f.key] = val;
      }
      // An exactly named ground-truth column is more reliable than a guess.
      const exact = rawColumns.find((c) => c.trim().toLowerCase() === 'ground truth');
      if (exact) next.groundTruth = exact;
      setMapping(next);
      setProposed(true);
    } catch (err) {
      setError(
        `Could not propose a mapping: ${
          err instanceof Error ? err.message : String(err)
        }. Set the columns by hand instead.`
      );
    } finally {
      setBusy(false);
    }
  }

  const requiredMet = CANONICAL_FIELDS.filter((f) => f.required).every(
    (f) => !!mapping[f.key]
  );

  const sample = rawRows[0] ?? {};

  return (
    <Card
      title="Column mapping"
      subtitle="Point each schema field at a column in your file. Input and output are required; the optional ones each unlock a diagnostic that is otherwise unreachable."
      actions={
        <Button
          variant="go"
          disabled={!requiredMet}
          onClick={() => {
            setTraces(buildTraces(rawRows, mapping));
            goTo('segment');
          }}
        >
          Continue
        </Button>
      }
    >
      <div className="toolbar">
        <Button onClick={propose} disabled={busy}>
          {busy ? 'Reading a sample' : proposed ? 'Propose again' : 'Propose mapping'}
        </Button>
        <span className="toolbar-hint">
          {busy
            ? 'Asking the model to match your columns'
            : 'Reads four sample rows, then you check each one. Re-proposing replaces manual edits.'}
        </span>
      </div>

      {busy && <Spinner label="Asking the model to match your columns" />}

      {error && (
        <div style={{ marginBottom: 16 }}>
          <Callout tone="bad">{error}</Callout>
        </div>
      )}

      {proposed && !busy && !error && (
        <div style={{ marginBottom: 16 }}>
          <Callout tone="info">
            Proposed from the first few rows. Check each one — a wrong mapping here
            produces confident nonsense later.
          </Callout>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Column</th>
            <th>First row</th>
          </tr>
        </thead>
        <tbody>
          {CANONICAL_FIELDS.map((f) => {
            const col = mapping[f.key];
            const preview = col ? (sample[col] ?? '') : '';
            return (
              <tr key={f.key}>
                <td>
                  <span className="cell-name">{f.label}</span>
                  {f.required && <span className="req">required</span>}
                  <span className="cell-hint">{f.hint}</span>
                </td>
                <td>
                  <select
                    value={col ?? ''}
                    onChange={(e) =>
                      setMapping({ ...mapping, [f.key]: e.target.value || undefined })
                    }
                  >
                    <option value="">not mapped</option>
                    {rawColumns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="cell-preview">
                  {preview ? `${preview.slice(0, 90)}${preview.length > 90 ? '…' : ''}` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!mapping.groundTruth && (
        <div style={{ marginTop: 16 }}>
          <Callout tone="warn">
            No ground truth mapped. Every row will be judged against the rubric alone,
            which is the weaker of the two modes. Without any reference rows there is
            also no way to measure whether the judge is right.
          </Callout>
        </div>
      )}
    </Card>
  );
}
