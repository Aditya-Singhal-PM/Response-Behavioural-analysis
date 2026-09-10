import { useRef, useState } from 'react';
import { parseFile } from '../lib/parseFile';
import { useApp } from '../state/AppContext';
import { Button, Callout, Card, Spinner } from '../components/ui';

export function UploadScreen() {
  const { fileName, rawRows, rawColumns, truncatedCells, setFile, goTo } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = await parseFile(file);
      if (parsed.rows.length === 0) {
        setError('No data rows found. Check the first row holds column headers.');
      } else {
        setFile(file.name, parsed.columns, parsed.rows, parsed.truncatedCells);
      }
    } catch (err) {
      setError(
        `Could not read the file: ${
          err instanceof Error ? err.message : String(err)
        }. Excel parsing loads a library from a CDN, so check your connection is not blocking it.`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Trace export"
      subtitle="An export from Langfuse, Bifrost or anywhere else. Column names can be anything — you map them on the next step."
      actions={
        <>
          <Button onClick={() => inputRef.current?.click()} disabled={busy}>
            {fileName ? 'Choose another file' : 'Choose file'}
          </Button>
          <Button
            variant="go"
            disabled={rawRows.length === 0}
            onClick={() => goTo('mapping')}
          >
            Continue
          </Button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.tsv,.jsonl,.ndjson"
        style={{ display: 'none' }}
        onChange={(e) => void handle(e.target.files?.[0])}
      />

      <div
        className="dropzone"
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handle(e.dataTransfer.files?.[0]);
        }}
      >
        {busy ? (
          <Spinner label="Reading the file" />
        ) : fileName ? (
          <>
            <p className="drop-name">{fileName}</p>
            <p className="sub">
              {rawRows.length.toLocaleString()} rows · {rawColumns.length} columns
            </p>
          </>
        ) : (
          <>
            <p className="drop-name">Drop a file here</p>
            <p className="sub">xlsx · csv · tsv · jsonl</p>
          </>
        )}
      </div>

      {error && (
        <div style={{ marginTop: 16 }}>
          <Callout tone="bad">{error}</Callout>
        </div>
      )}

      {truncatedCells > 0 && (
        <div style={{ marginTop: 16 }}>
          <Callout tone="warn">
            {truncatedCells} cells sit exactly at Excel's 32,767-character limit, which
            means the export cut them off before you got here. Those traces are already
            incomplete. Re-export as CSV or JSONL if you can.
          </Callout>
        </div>
      )}

      {rawColumns.length > 0 && (
        <div className="chips">
          {rawColumns.map((c) => (
            <span key={c} className="chip">
              {c}
            </span>
          ))}
        </div>
      )}

      <ul className="notes">
        <li>
          Ground truth is optional. Where you have it, put it in a column named{' '}
          <code>Ground Truth</code> on the same row as the trace it describes.
        </li>
        <li>
          Retrieved context can either sit in its own column or stay inside the prompt.
          Either way it gets pulled out at the segmentation step.
        </li>
        <li>
          Nothing leaves this browser except the judge calls themselves. The file is
          never uploaded anywhere.
        </li>
      </ul>
    </Card>
  );
}
