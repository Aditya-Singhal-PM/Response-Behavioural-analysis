// src/lib/providers.ts

export type ProviderId = 'anthropic' | 'openai' | 'openai-compatible';

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  buildRequest: (opts: {
    baseUrl: string;
    apiKey: string;
    model: string;
    prompt: string;
  }) => { url: string; headers: Record<string, string>; body: unknown };
  parseResponse: (data: any) => string; // extracts text from a successful response
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    buildRequest: ({ baseUrl, apiKey, model, prompt }) => ({
      url: `${baseUrl.replace(/\/$/, '')}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: {
        model,
        max_tokens: 20,
        messages: [{ role: 'user', content: prompt }],
      },
    }),
    parseResponse: (data) => data?.content?.[0]?.text ?? '',
  },

  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-4o-mini',
    buildRequest: ({ baseUrl, apiKey, model, prompt }) => ({
      url: `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: {
        model,
        max_tokens: 20,
        messages: [{ role: 'user', content: prompt }],
      },
    }),
    parseResponse: (data) => data?.choices?.[0]?.message?.content ?? '',
  },

  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI-compatible (self-hosted / other)',
    defaultBaseUrl: '',
    defaultModel: '',
    buildRequest: ({ baseUrl, apiKey, model, prompt }) => ({
      url: `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: {
        model,
        max_tokens: 20,
        messages: [{ role: 'user', content: prompt }],
      },
    }),
    parseResponse: (data) => data?.choices?.[0]?.message?.content ?? '',
  },
};