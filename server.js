import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

// No npm dependencies on purpose: package.json and the lockfile stay
// untouched, so the repo remains editable from the GitHub web UI.

const PORT = Number(process.env.PORT) || 8080;
const DIST = join(process.cwd(), 'dist');

// Set these as Cloud Run environment variables or secrets. When present the
// browser never sees the key; when absent the client falls back to sending
// its own, so local development still works unchanged.
const UPSTREAM_BASE_URL = process.env.UPSTREAM_BASE_URL || '';
const UPSTREAM_API_KEY = process.env.UPSTREAM_API_KEY || '';
const UPSTREAM_AUTH_STYLE = process.env.UPSTREAM_AUTH_STYLE || 'bearer';
// A shared secret stops an open proxy burning your key if the URL leaks.
const PROXY_SECRET = process.env.PROXY_SECRET || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' });
}

async function readBody(req, limitBytes = 4 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Forwards one completion request upstream. The client sends the provider
 * path and body it already builds; only the credential is swapped in here.
 */
async function handleJudge(req, res) {
  if (PROXY_SECRET && req.headers['x-proxy-secret'] !== PROXY_SECRET) {
    return sendJson(res, 401, { error: 'Bad or missing proxy secret.' });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, 400, { error: `Invalid request body: ${err.message}` });
  }

  const { path, body, headers: clientHeaders } = payload;
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return sendJson(res, 400, { error: 'path must be an absolute API path.' });
  }
  if (!UPSTREAM_BASE_URL) {
    return sendJson(res, 500, {
      error: 'UPSTREAM_BASE_URL is not configured on this service.',
    });
  }

  const target = `${UPSTREAM_BASE_URL.replace(/\/+$/, '')}${path}`;
  const headers = { 'Content-Type': 'application/json' };

  // Pass through non-credential headers the provider needs, never the
  // client's own authorization.
  for (const [k, v] of Object.entries(clientHeaders || {})) {
    const key = k.toLowerCase();
    if (['authorization', 'x-api-key', 'x-proxy-secret', 'host'].includes(key)) continue;
    if (typeof v === 'string') headers[k] = v;
  }

  if (UPSTREAM_API_KEY) {
    if (UPSTREAM_AUTH_STYLE === 'x-api-key') {
      headers['x-api-key'] = UPSTREAM_API_KEY;
      headers['anthropic-version'] = headers['anthropic-version'] || '2023-06-01';
    } else {
      headers.Authorization = `Bearer ${UPSTREAM_API_KEY}`;
    }
  }

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
    });
    const text = await upstream.text();
    const retryAfter = upstream.headers.get('retry-after');
    send(res, upstream.status, text, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      ...(retryAfter ? { 'Retry-After': retryAfter } : {}),
    });
  } catch (err) {
    sendJson(res, 502, { error: `Upstream request failed: ${err.message}` });
  }
}

async function serveStatic(req, res, urlPath) {
  const clean = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(DIST, clean === '/' ? 'index.html' : clean);

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // Unknown paths fall back to the SPA entry point.
    filePath = join(DIST, 'index.html');
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    const immutable = filePath.includes(`${join('dist', 'assets')}`);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': immutable
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    res.end(data);
  } catch {
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/healthz') {
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/config') {
    // Lets the client know whether it needs to ask the user for a key.
    return sendJson(res, 200, {
      proxyConfigured: Boolean(UPSTREAM_BASE_URL && UPSTREAM_API_KEY),
      requiresSecret: Boolean(PROXY_SECRET),
    });
  }

  if (url.pathname === '/api/judge') {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'POST only.' });
    }
    return void handleJudge(req, res);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  void serveStatic(req, res, url.pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`listening on ${PORT}`);
  console.log(`proxy ${UPSTREAM_BASE_URL ? 'configured' : 'not configured'}`);
});
