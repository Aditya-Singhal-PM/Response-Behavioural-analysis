import { useState } from 'react';
import { PROVIDERS } from '../lib/providers';
import type { ProviderId } from '../lib/providers';
import { testConnection } from '../lib/testConnection';
import type { TestResult } from '../lib/testConnection';
import { useApp } from '../state/AppContext';
import { Button, Callout, Card, Field, Spinner } from '../components/ui';

export function SetupScreen() {
  const { provider, patchProvider, goTo } = useApp();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  function switchProvider(id: ProviderId) {
    patchProvider({
      providerId: id,
      baseUrl: PROVIDERS[id].defaultBaseUrl,
      model: PROVIDERS[id].defaultModel,
      verified: false,
    });
    setResult(null);
  }

  async function test() {
    setTesting(true);
    setResult(null);
    const r = await testConnection(
      provider.providerId,
      provider.baseUrl.trim(),
      provider.apiKey.trim(),
      provider.model.trim()
    );
    setResult(r);
    patchProvider({ verified: r.status === 'ok' });
    setTesting(false);
  }

  const ready =
    provider.apiKey.trim() && provider.baseUrl.trim() && provider.model.trim();

  return (
    <Card
      title="Judge model"
      subtitle="The model that reads your traces and applies the rubric. Your key stays in this browser tab and goes nowhere except the provider you name below."
      actions={
        <>
          <Button onClick={test} disabled={testing || !ready} variant="quiet">
            {testing ? 'Testing' : 'Test connection'}
          </Button>
          <Button
            variant="go"
            disabled={!provider.verified}
            onClick={() => goTo('upload')}
          >
            Continue
          </Button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="Provider">
          <select
            value={provider.providerId}
            onChange={(e) => switchProvider(e.target.value as ProviderId)}
          >
            {Object.values(PROVIDERS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Base URL" hint={PROVIDERS[provider.providerId].hint}>
          <input
            value={provider.baseUrl}
            spellCheck={false}
            onChange={(e) =>
              patchProvider({ baseUrl: e.target.value, verified: false })
            }
          />
        </Field>

        <Field label="Model" hint="The provider's exact model id">
          <input
            value={provider.model}
            spellCheck={false}
            onChange={(e) => patchProvider({ model: e.target.value, verified: false })}
          />
        </Field>

        <Field label="API key" hint="Discarded when you close this tab">
          <input
            type="password"
            value={provider.apiKey}
            autoComplete="off"
            onChange={(e) => patchProvider({ apiKey: e.target.value, verified: false })}
          />
        </Field>
      </div>

      {testing && (
        <div style={{ marginTop: 16 }}>
          <Spinner label="Sending one short completion" />
        </div>
      )}

      {result && !testing && (
        <div style={{ marginTop: 16 }}>
          {result.status === 'ok' && (
            <Callout tone="ok">
              Connected. The model replied <code>{result.sample}</code>.
            </Callout>
          )}
          {result.status === 'empty' && <Callout tone="warn">{result.message}</Callout>}
          {result.status === 'rate_limited' && (
            <Callout tone="warn">{result.message}</Callout>
          )}
          {(result.status === 'auth' ||
            result.status === 'not_found' ||
            result.status === 'cors_or_network' ||
            result.status === 'unknown') && (
            <Callout tone="bad">{result.message}</Callout>
          )}
        </div>
      )}

      <p className="note">
        A judge run costs one call per row, plus a few for setup and synthesis. Start
        with a cheap model to check the pipeline before spending on a capable one.
      </p>
    </Card>
  );
}
