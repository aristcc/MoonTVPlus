#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const assetsDir = path.join(root, '.edgeone', 'assets');
const handlerPath = path.join(root, '.edgeone', 'cloud-functions', 'ssr-node', 'handler.js');
const defaultPort = Number(process.env.PORT || process.env.EDGEONE_LOCAL_PORT || 8088);

function loadDotenv(file) {
  if (!existsSync(file)) return;
  const content = readFileSync(file, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const idx = normalized.indexOf('=');
    if (idx <= 0) continue;
    const key = normalized.slice(0, idx).trim();
    let value = normalized.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotenv(path.join(root, '.env'));
loadDotenv(path.join(root, '.env.local'));

process.env.NODE_ENV ||= 'production';
process.env.BUILD_TARGET = 'edgeone';
process.env.EDGEONE_PAGES = '1';

if (!existsSync(handlerPath)) {
  console.error('未找到 EdgeOne SSR handler：', handlerPath);
  console.error('请先运行：pnpm build:edgeone');
  process.exit(1);
}

const { default: edgeoneHandler } = await import(pathToFileURL(handlerPath).href);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.jar': 'application/java-archive',
};

function safeAssetPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '') || 'index.html';
  const full = path.normalize(path.join(assetsDir, relative));
  if (!full.startsWith(assetsDir)) return null;
  if (existsSync(full) && statSync(full).isFile()) return full;
  if (existsSync(full + '.html') && statSync(full + '.html').isFile()) return full + '.html';
  const indexFile = path.join(full, 'index.html');
  if (existsSync(indexFile) && statSync(indexFile).isFile()) return indexFile;
  return null;
}

function sendStatic(req, res, file) {
  const ext = path.extname(file).toLowerCase();
  res.statusCode = 200;
  res.setHeader('content-type', mime[ext] || 'application/octet-stream');
  if (req.url?.startsWith('/_next/static/')) {
    res.setHeader('cache-control', 'public,max-age=31536000,immutable');
  }
  createReadStream(file).pipe(res);
}

function toEdgeOneRequest(req) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  }
  headers['x-forwarded-proto'] ||= 'http';
  headers.host ||= `localhost:${defaultPort}`;

  return {
    method: req.method || 'GET',
    url: req.url || '/',
    headers,
    body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : req,
    on: req.on.bind(req),
    read: req.read.bind(req),
  };
}

async function sendFetchResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  } catch (error) {
    res.destroy(error);
  }
}

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    const asset = safeAssetPath(pathname);
    if (asset) return sendStatic(req, res, asset);

    const request = toEdgeOneRequest(req);
    const response = await edgeoneHandler(request, {
      env: process.env,
      waitUntil: (promise) => Promise.resolve(promise).catch((err) => console.error('[waitUntil]', err)),
    });
    await sendFetchResponse(res, response);
  } catch (error) {
    console.error('[edgeone-local-preview]', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(error instanceof Error ? error.stack || error.message : String(error));
  }
});

server.listen(defaultPort, () => {
  console.log(`EdgeOne local preview (no login) running at http://localhost:${defaultPort}`);
});
