export type ProviderId = 'anthropic' | 'openai' | 'openai-compatible';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  hint: string;
  buildRequest: (opts: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: ChatMessage[];
    maxTokens: number;
    disableReasoning?: boolean;
  }) => BuiltRequest;
  parseResponse: (data: unknown) => string;
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function readPath(obj: unknown, path: (string | number)[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

/**
 * Anthropic keeps the system prompt out of the messages array, so it is
 * lifted into its own top-level field here.
 */
function anthropicBody(model: string, messages: ChatMessage[], maxTokens: number) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: 'user' as const, content: m.content }));
  return {
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: rest.length ? rest : [{ role: 'user' as const, content: '' }],
  };
}

// Models on OpenRouter that spend their whole token budget reasoning and
// return an empty answer unless reasoning is explicitly turned off. This is
// the exception, not the default: most models either have no reasoning
// mode, or reasoning is optional and off by default. A few models — seen
// so far on certain auto-routed free-tier backends — go the other way and
// reject the request if reasoning is disabled, so the flag is only sent
// for models known to need it, never sent otherwise, and dropped
// automatically if the provider still rejects it.
const FORCE_REASONING_OFF = [/nemotron/i, /nvidia\//i];

function openAiBody(
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  baseUrl = '',
  disableReasoning = false
) {
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
  const isOpenRouter = /openrouter\.ai/i.test(baseUrl);
  const shouldDisable =
    isOpenRouter && (disableReasoning || FORCE_REASONING_OFF.some((re) => re.test(model)));
  if (shouldDisable) {
    body.reasoning = { enabled: false };
  }
  return body;
}

/**
 * Some OpenAI-compatible gateways put the assistant text in `content`,
 * others leave `content` empty and return reasoning separately. Both are
 * checked so a reasoning model does not read as an empty reply.
 */
function openAiParse(data: unknown): string {
  const content = readPath(data, ['choices', 0, 'message', 'content']);
  if (typeof content === 'string' && content.trim()) return content;
  const reasoning = readPath(data, ['choices', 0, 'message', 'reasoning']);
  if (typeof reasoning === 'string' && reasoning.trim()) return reasoning;
  const text = readPath(data, ['choices', 0, 'text']);
  if (typeof text === 'string' && text.trim()) return text;
  return '';
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    hint: 'Host only. The /v1/messages path is added for you.',
    buildRequest: ({ baseUrl, apiKey, model, messages, maxTokens }) => ({
      url: `${trimSlash(baseUrl)}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: anthropicBody(model, messages, maxTokens),
    }),
    parseResponse: (data) => {
      const text = readPath(data, ['content', 0, 'text']);
      return typeof text === 'string' ? text : '';
    },
  },

  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-4o-mini',
    hint: 'Host only. The /v1/chat/completions path is added for you.',
    buildRequest: ({ baseUrl, apiKey, model, messages, maxTokens }) => ({
      url: `${trimSlash(baseUrl)}/v1/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: openAiBody(model, messages, maxTokens),
    }),
    parseResponse: openAiParse,
  },

  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI-compatible (OpenRouter, Hugging Face, self-hosted)',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    hint: 'Include the version path. Only /chat/completions is added.',
    buildRequest: ({ baseUrl, apiKey, model, messages, maxTokens, disableReasoning }) => {
      const isOpenRouter = /openrouter\.ai/i.test(baseUrl);
      return {
        url: `${trimSlash(baseUrl)}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          // Attribution headers OpenRouter asks for. Sent only to OpenRouter,
          // because extra headers widen the CORS preflight and other hosts
          // may not allow them.
          ...(isOpenRouter
            ? {
                'HTTP-Referer': window.location.origin,
                'X-Title': 'Response Behavioural Analysis',
              }
            : {}),
        },
        body: openAiBody(model, messages, maxTokens, baseUrl, disableReasoning),
      };
    },
    parseResponse: openAiParse,
  },
};

export interface ModelCallOpts {
  providerId: ProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
  /** Set true only after the provider has rejected a request for requiring reasoning to stay on. */
  disableReasoning?: boolean;
}

export class ModelError extends Error {
  status: number | null;
  retryAfterMs: number | null;
  constructor(message: string, status: number | null, retryAfterMs: number | null = null) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Single non-streaming completion. Throws ModelError on any failure. */
export async function callModel(opts: ModelCallOpts): Promise<string> {
  const provider = PROVIDERS[opts.providerId];
  const { url, headers, body } = provider.buildRequest({
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    model: opts.model,
    messages: opts.messages,
    maxTokens: opts.maxTokens ?? 1600,
    disableReasoning: opts.disableReasoning,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ModelError(
      'Request failed before a response arrived. Usually CORS or an unreachable host.',
      null
    );
  }

  if (!res.ok) {
    const retryAfter = res.headers.get('retry-after');
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : null;
    const text = await res.text().catch(() => '');

    // A model that mandates reasoning and rejects the disable flag gets a
    // clear, specific message rather than a raw 400 dump, since this is a
    // fixable request shape rather than an auth or path problem.
    if (
      body &&
      typeof body === 'object' &&
      (body as Record<string, unknown>).reasoning &&
      /reasoning/i.test(text) &&
      /(mandatory|required|cannot be disabled)/i.test(text)
    ) {
      throw new ModelError(
        `This model requires reasoning to stay enabled, but it was sent disabled. ${text.slice(0, 200)}`,
        res.status
      );
    }

    throw new ModelError(
      `Provider returned ${res.status}. ${text.slice(0, 300)}`,
      res.status,
      Number.isFinite(retryAfterMs) ? retryAfterMs : null
    );
  }

  const data = await res.json();
  const text = provider.parseResponse(data);
  if (text.trim()) return text;

  // Empty answer. Distinguish the causes, because they need different fixes.
  const finish = readPath(data, ['choices', 0, 'finish_reason']);
  const stop = readPath(data, ['stop_reason']);
  const hadReasoning =
    Boolean(readPath(data, ['choices', 0, 'message', 'reasoning'])) ||
    Boolean(readPath(data, ['choices', 0, 'message', 'reasoning_details']));

  if (finish === 'length' || stop === 'max_tokens') {
    throw new ModelError(
      hadReasoning
        ? 'The model used its whole token budget on reasoning and returned no answer. Reasoning has been disabled for OpenRouter; if this persists, pick a non-reasoning model.'
        : 'The model hit the token limit before producing any answer text.',
      res.status
    );
  }
  if (hadReasoning) {
    throw new ModelError(
      'The model returned reasoning but no answer text. Pick a model that does not reason before replying, or one that puts its answer in the content field.',
      res.status
    );
  }
  throw new ModelError(
    `The model returned an empty reply (finish_reason: ${String(finish ?? stop ?? 'unknown')}).`,
    res.status
  );
}

/**
 * Pulls the first JSON object or array out of a model reply, tolerating
 * fenced code blocks and surrounding prose.
 */
export function extractJson<T>(raw: string): T {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const firstBrace = text.search(/[[{]/);
  if (firstBrace === -1) throw new Error('No JSON found in model reply.');
  const opener = text[firstBrace];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === opener) depth++;
    if (ch === closer) {
      depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(firstBrace, i + 1)) as T;
      }
    }
  }
  throw new Error('Unbalanced JSON in model reply.');
}
