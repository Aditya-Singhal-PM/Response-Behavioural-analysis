// src/components/ProviderSetup.tsx
import { useState } from 'react';
import { PROVIDERS } from '../lib/providers';
import type { ProviderId } from '../lib/providers';
import { testConnection } from '../lib/testConnection';
import type { TestResult } from '../lib/testConnection';

export function ProviderSetup() {
  const [providerId, setProviderId] = useState<ProviderId>('anthropic');
  const [baseUrl, setBaseUrl] = useState(PROVIDERS.anthropic.defaultBaseUrl);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(PROVIDERS.anthropic.defaultModel);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  function handleProviderChange(id: ProviderId) {
    setProviderId(id);
    setBaseUrl(PROVIDERS[id].defaultBaseUrl);
    setModel(PROVIDERS[id].defaultModel);
    setResult(null);
  }

  async function handleTest() {
    setTesting(true);
    setResult(null);
    const r = await testConnection(providerId, baseUrl, apiKey, model);
    setResult(r);
    setTesting(false);
  }

  return (
    <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label>
        Provider
        <select
          value={providerId}
          onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
        >
          {Object.values(PROVIDERS).map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>

      <label>
        Base URL
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>

      <label>
        Model
        <input value={model} onChange={(e) => setModel(e.target.value)} />
      </label>

      <label>
        API Key
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </label>

      <button onClick={handleTest} disabled={testing || !apiKey || !baseUrl}>
        {testing ? 'Testing…' : 'Test connection'}
      </button>

      {result && (
        <div style={{ padding: 8, border: '1px solid #ccc' }}>
          {result.status === 'ok' && <p>✅ Success. Sample reply: {result.sample}</p>}
          {result.status !== 'ok' && <p>❌ {result.message}</p>}
        </div>
      )}
    </div>
  );
}