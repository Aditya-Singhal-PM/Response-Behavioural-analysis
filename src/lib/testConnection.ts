// src/lib/testConnection.ts
import { PROVIDERS } from './providers';
import type { ProviderId } from './providers';

export type TestResult =
  | { status: 'ok'; sample: string }
  | { status: 'auth'; message: string }
  | { status: 'not_found'; message: string }
  | { status: 'cors_or_network'; message: string }
  | { status: 'unknown'; message: string };

export async function testConnection(
  providerId: ProviderId,
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<TestResult> {
  const provider = PROVIDERS[providerId];
  const { url, headers, body } = provider.buildRequest({
    baseUrl,
    apiKey,
    model,
    prompt: 'Reply with just the word OK.',
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      return { status: 'auth', message: `Authentication failed (${res.status}). Check your API key.` };
    }
    if (res.status === 404) {
      return { status: 'not_found', message: 'Endpoint not found (404). Check base URL and model name.' };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { status: 'unknown', message: `Request failed (${res.status}): ${text.slice(0, 200)}` };
    }

    const data = await res.json();
    return { status: 'ok', sample: provider.parseResponse(data) };
  } catch (err) {
    // fetch throws with no status on CORS failure or network error —
    // the browser deliberately hides the real reason
    return {
      status: 'cors_or_network',
      message:
        'Request failed before a response was received. This usually means CORS blocked the browser call, or the URL/network is unreachable. Check the browser console for the underlying error.',
    };
  }
}