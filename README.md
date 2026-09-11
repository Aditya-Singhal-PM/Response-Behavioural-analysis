# Response Behavioural Analysis

Judge LLM/agent traces against expected behaviour, entirely in the browser.

Upload a trace export (xlsx, csv, tsv or jsonl), map its columns, split the
prompt into instructions/context/request, describe what the agent should do,
and judge every row against the resulting checks. Failures are grouped into
patterns with a proposed change for each.

## Running it

No dependencies beyond the Vite React-TS scaffold. SheetJS is loaded at
runtime from a CDN, so no `npm install` is needed to add Excel support.

    npm install
    npm run dev

## What stays local

The API key lives in `sessionStorage` and is discarded when the tab closes.
The trace file is never uploaded — it is parsed in the browser. The only
outbound requests are the judge calls to the provider you configure.

A refresh clears the run. Save a snapshot from the results screen to keep it.

## Pipeline

1. **Provider** — connect a judge model and verify it responds
2. **Upload** — parse the export, detect Excel cell truncation
3. **Columns** — map columns onto the canonical schema
4. **Segment** — recover the invariant master prompt, split out retrieved context
5. **Rubric** — turn intent into discrete checkable assertions
6. **Run** — judge concurrently with adaptive rate limiting
7. **Results** — bucket distribution, patterns, row-level evidence, exports

## Design notes

- Every finding must quote verbatim supporting text. A failure with no quote
  is downgraded to an abstain rather than reported.
- Abstain is a first-class verdict. Pass rate is reported over rows that
  produced a usable verdict, not over rows in the file.
- Rows with ground truth are judged against it; rows without are judged
  against the rubric alone. The two are reported separately.
- Retrieval-miss versus context-ignored is decided by checking whether the
  quoted evidence appears in the retrieved context, not by asking the judge.
