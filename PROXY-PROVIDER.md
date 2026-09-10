# providers.ts changes for the proxy

Three edits to `src/lib/providers.ts`. Everything else in the app is
unchanged, because `callModel` already routes through the adapter.

## 1. Extend the id union

```ts
export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'openai-compatible'
  | 'server-proxy';
```

## 2. Add the adapter to PROVIDERS

The proxy takes the same request the client would have built and nests it,
so the server only has to swap the credential.

```ts
  'server-proxy': {
    id: 'server-proxy',
    label: 'This server (key held server-side)',
    defaultBaseUrl: '',
    defaultModel: '',
    hint: 'The key is configured on the Cloud Run service, not here.',
    buildRequest: ({ apiKey, model, messages, maxTokens }) => ({
      url: '/api/judge',
      headers: {
        'Content-Type': 'application/json',
        // Only the shared proxy secret goes in the API key field here.
        ...(apiKey ? { 'x-proxy-secret': apiKey } : {}),
      },
      body: {
        path: '/chat/completions',
        headers: {},
        body: openAiBody(model, messages, maxTokens),
      },
    }),
    parseResponse: openAiParse,
  },
```

If the upstream is Anthropic rather than an OpenAI-compatible endpoint, set
`path` to `/v1/messages`, swap `openAiBody` for `anthropicBody`, and read the
reply with `readPath(data, ['content', 0, 'text'])`. Set
`UPSTREAM_AUTH_STYLE=x-api-key` on the service so the server sends the right
header.

## 3. Optionally default to the proxy when it is configured

`AppContext` currently starts on `openai-compatible`. To prefer the proxy
when the server has a key, call `/api/config` on mount:

```ts
useEffect(() => {
  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      if (cfg.proxyConfigured) {
        patchProvider({
          providerId: 'server-proxy',
          baseUrl: '',
          model: 'openrouter/free',
        });
      }
    })
    .catch(() => {
      // Running on Pages, where there is no proxy. Keep the direct adapter.
    });
}, [patchProvider]);
```

The catch matters: the same build is deployed to both GitHub Pages and Cloud
Run, and on Pages that fetch returns the SPA's index.html rather than JSON.

## What does not change

`testConnection.ts` works as-is — a proxy failure surfaces as a real status
code rather than the opaque CORS case, which is the point. `judge.ts`,
`cluster.ts` and every screen are untouched.

## Model id still comes from the client

The server does not pin a model, so the Model field on the setup screen
still drives which model is used. If you want to lock that down, read it
from an env var in `handleJudge` and overwrite `body.model` there.
