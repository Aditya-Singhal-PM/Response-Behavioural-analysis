# Deploying to Cloud Run

## What is in this bundle

| File | Purpose |
| --- | --- |
| `Dockerfile` | Two-stage build: compiles the Vite app, then runs the server |
| `server.js` | Serves `dist/` and proxies `/api/judge`. No npm dependencies |
| `.dockerignore` | Keeps `node_modules`, `.env` and `.git` out of the image |
| `vite.config.ts` | Base path driven by `VITE_BASE` so Pages and Cloud Run both work |
| `PROXY-PROVIDER.md` | The `providers.ts` edits that route calls through the proxy |

Add all of these at the repo root, alongside `package.json`.

## Why no dependencies

`server.js` uses only `node:http`, `node:fs` and the global `fetch` that
Node 18+ ships. That means `package.json` and `package-lock.json` stay
untouched, so `npm ci` in your existing Pages workflow keeps working and the
repo stays editable from the GitHub web UI.

## Keep the Pages workflow working

Adding `VITE_BASE` to `vite.config.ts` changes nothing for Pages, because the
fallback is still the repo subpath. If you would rather be explicit, add this
to the build step in `.github/workflows/deploy.yml`:

```yaml
      - name: Build
        run: npm run build
        env:
          VITE_BASE: /Response-Behavioural-analysis/
```

## Create the service

In the Cloud Console, Cloud Run then **Deploy container** then
**Continuously deploy from a repository**. Connect the GitHub repo, pick the
`main` branch, and choose **Dockerfile** as the build type. Cloud Build then
rebuilds and redeploys on every push, the same trigger model as Actions.

Settings worth changing from the defaults:

- **Authentication**: allow unauthenticated invocations, otherwise the browser
  cannot load the page
- **Minimum instances**: 0. This is the single most important cost setting —
  with 0 you pay nothing while idle and accept a few seconds of cold start
- **Maximum instances**: 2 or 3. A cap is what stops a runaway loop turning
  into a bill
- **Memory**: 512 MiB is plenty; the server holds no state
- **Request timeout**: 300s. Judge calls to a slow model can take a while

## Environment variables

Set these under **Variables and secrets**.

| Name | Example | Notes |
| --- | --- | --- |
| `UPSTREAM_BASE_URL` | `https://openrouter.ai/api/v1` | Include the version path |
| `UPSTREAM_API_KEY` | your key | Use Secret Manager, not a plain variable |
| `UPSTREAM_AUTH_STYLE` | `bearer` | Use `x-api-key` for Anthropic |
| `PROXY_SECRET` | a long random string | Optional but strongly advised |

`PORT` is injected by Cloud Run. Do not set it yourself.

For `UPSTREAM_API_KEY`, create a secret in Secret Manager and reference it
rather than pasting the value into an env var — env vars are visible to
anyone with console read access on the project.

## Why PROXY_SECRET matters

Without it, anyone who finds the service URL can spend your key. With it,
`/api/judge` returns 401 unless the request carries the matching
`x-proxy-secret` header. In the app, that secret goes in the API key field on
the setup screen when the provider is set to `server-proxy` — so it is
something you type once per session rather than something baked into the
build. Never put it in a `VITE_` variable; those are embedded in the bundle
and readable by anyone.

## Verifying the deploy

```
curl https://YOUR-SERVICE-URL/healthz
curl https://YOUR-SERVICE-URL/api/config
```

`/healthz` should return `{"ok":true}`. `/api/config` reports whether the
proxy has a key and whether a secret is required, which is a quick way to
confirm the env vars actually landed.

## Cost

Cloud Run's free tier covers a large number of requests, CPU-seconds and
memory-seconds per month, and a personal POC will not come close. The real
risks are not traffic:

- **Minimum instances above 0** bills continuously whether or not anyone is
  using it. Leave it at 0.
- **Artifact Registry storage** for old images accrues. Set a cleanup policy
  to keep the last few and delete the rest.
- **The LLM tokens** remain the actual cost, and they are unchanged by
  hosting.

Set a budget alert on the project regardless. It costs nothing and it is the
only thing that tells you if an assumption here was wrong.

## About Firestore

Firebase Hosting is redundant here — Cloud Run already serves the static
files, and running both means two places to deploy and one of them serving
stale assets.

Firestore is a different matter and is the natural next step for the
persistence gap. Findings currently live in React state, so a refresh loses a
run and the JSON snapshot export is the only backup. Firestore would give you
durable runs, real rubric version history, and calibration labels that
survive a browser change — the things a POC about judge quality actually
needs to keep.

That does require a dependency (`@google-cloud/firestore` on the server), so
it needs a Codespace session to update the lockfile. Worth doing once the
judging itself is proven, not before.

## What to test first

The proxy removes CORS as a variable, which means the first real question
becomes whether your chosen model reliably returns parseable JSON for the
judge prompt. Run 20 rows, check the error count on the results screen, and
read the reason on any row that failed to parse. That, not the deploy, is
what decides whether this pipeline works.
