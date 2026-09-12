import { callModel, ModelError } from './providers';
import type { ProviderId } from './providers';

export type TestResult =
  | { status: 'ok'; sample: string }
  | { status: 'empty'; message: string }
  | { status: 'auth'; message: string }
  | { status: 'not_found'; message: string }
  | { status: 'rate_limited'; message: string }
  | { status: 'cors_or_network'; message: string }
  | { status: 'unknown'; message: string };

export async function testConnection(
  providerId: ProviderId,
  baseUrl: string,
  apiKey: string,
  model: string,
  maxTokens = 2000
): Promise<TestResult> {
  try {
    const reply = await callModel({
      providerId,
      baseUrl,
      apiKey,
      model,
      maxTokens,
      messages: [{ role: 'user', content: 'Reply with just the word OK.' }],
    });

    if (!reply.trim()) {
      return {
        status: 'empty',
        message:
          'The request succeeded but no text came back. If this model reasons before answering, it may have used the whole token budget on that and left no room to reply — raise max tokens above and test again. Otherwise the response shape may differ from what this adapter reads; check the browser console for the raw body.',
      };
    }
    return { status: 'ok', sample: reply.trim() };
  } catch (err) {
    if (!(err instanceof ModelError)) {
      return { status: 'unknown', message: String(err) };
    }
    if (err.status === null) {
      return {
        status: 'cors_or_network',
        message:
          'No response arrived. The browser blocks a cross-origin call unless the provider allows it, so this is usually CORS — check the console for the exact rejection. For Azure, add this origin to the resource CORS list. For a self-hosted server, start it with permissive CORS.',
      };
    }
    if (err.status === 401 || err.status === 403) {
      return {
        status: 'auth',
        message: `Authentication rejected (${err.status}). Check the key, and that it is scoped to this model.`,
      };
    }
    if (err.status === 404) {
      return {
        status: 'not_found',
        message:
          'Endpoint not found (404). Either the base URL has the wrong path, or the model id does not exist on this provider.',
      };
    }
    if (err.status === 429) {
      return {
        status: 'rate_limited',
        message: 'Rate limited (429). The connection works — try again shortly.',
      };
    }
    return { status: 'unknown', message: err.message };
  }
}
