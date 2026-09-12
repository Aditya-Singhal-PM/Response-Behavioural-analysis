import { useState } from 'react';
import { deriveAssertions } from '../lib/judge';
import { useApp } from '../state/AppContext';
import { Button, Callout, Card, Spinner } from '../components/ui';

const PLACEHOLDER = `Describe what this agent is meant to do, and what counts as getting it wrong.

For example: this assistant answers questions about our commercial contracts. It must answer only from the clauses provided in the context and cite the clause number it used. If the clauses do not cover the question it must say so rather than reason from general contract knowledge. Anything touching indemnity caps or termination rights must be escalated to a human reviewer instead of answered. Replies should be under 150 words and must not restate the question.`;

export function RubricScreen() {
  const { intent, setIntent, assertions, setAssertions, background, setBackground, provider, goTo } =
    useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function derive() {
    setBusy(true);
    setError(null);
    try {
      const derived = await deriveAssertions(
        {
          providerId: provider.providerId,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          maxTokens: provider.maxTokens,
        },
        intent
      );
      setAssertions(
        derived.assertions.map((text, i) => ({ id: `a${i}`, text, enabled: true }))
      );
      setBackground(derived.background);
    } catch (err) {
      setError(
        `Could not derive assertions: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  function update(id: string, text: string) {
    setAssertions(assertions.map((a) => (a.id === id ? { ...a, text } : a)));
  }

  function toggle(id: string) {
    setAssertions(
      assertions.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a))
    );
  }

  function remove(id: string) {
    setAssertions(assertions.filter((a) => a.id !== id));
  }

  function add() {
    setAssertions([
      ...assertions,
      { id: `a${Date.now()}`, text: '', enabled: true },
    ]);
  }

  const enabledCount = assertions.filter((a) => a.enabled && a.text.trim()).length;

  function updateBackground(i: number, text: string) {
    setBackground(background.map((b, j) => (j === i ? text : b)));
  }
  function removeBackground(i: number) {
    setBackground(background.filter((_, j) => j !== i));
  }

  return (
    <Card
      title="Expected behaviour"
      subtitle="Describe the agent in your own words, then turn that into a list of separate checks. The judge only ever tests against this list, so anything not on it will not be flagged."
      actions={
        <>
          <Button onClick={derive} disabled={busy || intent.trim().length < 40}>
            {busy ? 'Working' : assertions.length ? 'Derive again' : 'Derive checks'}
          </Button>
          <Button variant="go" disabled={enabledCount === 0} onClick={() => goTo('run')}>
            Continue
          </Button>
        </>
      }
    >
      <textarea
        rows={9}
        value={intent}
        placeholder={PLACEHOLDER}
        spellCheck
        onChange={(e) => setIntent(e.target.value)}
      />

      {busy && (
        <div style={{ marginTop: 16 }}>
          <Spinner label="Splitting that into separate checks" />
        </div>
      )}

      {error && (
        <div style={{ marginTop: 16 }}>
          <Callout tone="bad">{error}</Callout>
        </div>
      )}

      {assertions.length > 0 && !busy && (
        <div className="assertions">
          <p className="assert-head">
            {enabledCount} of {assertions.length} checks active
          </p>
          {assertions.map((a, i) => (
            <div key={a.id} className={`assert${a.enabled ? '' : ' assert-off'}`}>
              <input
                type="checkbox"
                checked={a.enabled}
                onChange={() => toggle(a.id)}
                aria-label={`Check ${i + 1} active`}
              />
              <textarea
                rows={2}
                value={a.text}
                placeholder="A single checkable statement about the reply"
                onChange={(e) => update(a.id, e.target.value)}
              />
              <Button size="sm" variant="danger" onClick={() => remove(a.id)}>
                Remove
              </Button>
            </div>
          ))}
          <Button size="sm" onClick={add} style={{ marginTop: 10 }}>
            Add a check
          </Button>

          <div className="background">
            <p className="assert-head">
              Background for the judge — {background.length} note{background.length === 1 ? '' : 's'}
            </p>
            <p className="note" style={{ marginTop: 0, marginBottom: 12 }}>
              Things the judge needs to know to read the traces correctly, but that cannot
              be checked on one row: how inputs are produced, what a score means, what a
              field is for. These are shown to the judge on every row but never counted as
              pass or fail.
            </p>
            {background.map((b, i) => (
              <div key={i} className="assert">
                <span className="bg-mark">i</span>
                <textarea
                  rows={2}
                  value={b}
                  placeholder="A factual note about how this agent or its inputs work"
                  onChange={(e) => updateBackground(i, e.target.value)}
                />
                <Button size="sm" variant="danger" onClick={() => removeBackground(i)}>
                  Remove
                </Button>
              </div>
            ))}
            <Button size="sm" onClick={() => setBackground([...background, ''])} style={{ marginTop: 10 }}>
              Add a note
            </Button>
          </div>
        </div>
      )}

      {assertions.length === 0 && !busy && (
        <p className="note">
          Vague intent gives vague findings. Be concrete about what a correct reply
          contains, what should be refused, and what format is expected — those three
          are where most real failures live.
        </p>
      )}
    </Card>
  );
}
