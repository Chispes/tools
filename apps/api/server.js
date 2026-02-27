#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const { RedirectMonitorManager } = require('../../lib/redirect-monitor-manager');
const { DEFAULT_USER_AGENT, COMMON_USER_AGENTS } = require('../../lib/redirect-monitor-core');

const ROOT = path.resolve(__dirname, '../..');
const WEB_ROOT = path.join(ROOT, 'apps', 'web');
const LOGS_ROOT = path.join(ROOT, 'runtime', 'logs');
const REDIRECT_LOGS_ROOT = path.join(LOGS_ROOT, 'redirect-monitor');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

const monitorManager = new RedirectMonitorManager({ logsDir: REDIRECT_LOGS_ROOT });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendText(res, code, text) {
  res.writeHead(code, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function safeJoin(baseDir, requestPath) {
  const full = path.normalize(path.join(baseDir, requestPath));
  if (!full.startsWith(baseDir)) {
    return null;
  }
  return full;
}

function sendFile(res, absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
      sendText(res, 404, 'Not found');
      return;
    }

    const ext = path.extname(absPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': stat.size,
      'cache-control': 'no-store',
    });

    const stream = fs.createReadStream(absPath);
    stream.on('error', () => {
      if (!res.headersSent) sendText(res, 500, 'Error reading file');
      else res.destroy();
    });
    stream.pipe(res);
  } catch (_) {
    sendText(res, 404, 'Not found');
  }
}

function parseBodyJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Body demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (_) {
        reject(new Error('JSON invalido'));
      }
    });
    req.on('error', reject);
  });
}

function readTailLines(filePath, maxLines) {
  const text = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const recent = lines.slice(-maxLines);
  const parsed = [];
  for (const line of recent) {
    try {
      parsed.push(JSON.parse(line));
    } catch (_) {
      // Skip invalid line.
    }
  }
  return parsed;
}

function listTools() {
  return [
    {
      id: 'redirect-monitor',
      name: 'Monitor redirecciones 301',
      description: 'Comprueba periodicamente una URL y registra redirecciones/caches/errores.',
      createJobEndpoint: '/api/redirect-monitor/jobs',
      webViewerPath: '/log-viewer.html',
    },
  ];
}

async function handleApi(req, res, pathname, query) {
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      time: new Date().toISOString(),
      jobsRunning: monitorManager.listJobs().filter((j) => j.status === 'running').length,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/tools') {
    sendJson(res, 200, { tools: listTools() });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/redirect-monitor/jobs') {
    sendJson(res, 200, { jobs: monitorManager.listJobs() });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/redirect-monitor/user-agents') {
    sendJson(res, 200, {
      defaultUserAgent: DEFAULT_USER_AGENT,
      presets: COMMON_USER_AGENTS,
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/redirect-monitor/jobs') {
    try {
      const body = await parseBodyJson(req);
      const job = monitorManager.createJob(body);
      sendJson(res, 201, { job });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/redirect-monitor\/jobs\/([^/]+)$/);
  if (req.method === 'GET' && detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    const job = monitorManager.getJob(id);
    if (!job) {
      sendJson(res, 404, { error: 'Job no encontrado' });
      return true;
    }
    sendJson(res, 200, { job });
    return true;
  }

  const stopMatch = pathname.match(/^\/api\/redirect-monitor\/jobs\/([^/]+)\/stop$/);
  if (req.method === 'POST' && stopMatch) {
    const id = decodeURIComponent(stopMatch[1]);
    const job = monitorManager.stopJob(id, 'manual');
    if (!job) {
      sendJson(res, 404, { error: 'Job no encontrado' });
      return true;
    }
    sendJson(res, 200, { job });
    return true;
  }

  const tailMatch = pathname.match(/^\/api\/redirect-monitor\/jobs\/([^/]+)\/tail$/);
  if (req.method === 'GET' && tailMatch) {
    const id = decodeURIComponent(tailMatch[1]);
    const job = monitorManager.getJob(id);
    if (!job) {
      sendJson(res, 404, { error: 'Job no encontrado' });
      return true;
    }

    const maxLines = Math.max(1, Math.min(1000, Number(query.get('lines') || 100)));
    const logFilePath = monitorManager.getJobLogFilePath(id);
    const events = readTailLines(logFilePath, maxLines);
    sendJson(res, 200, { id, events });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, pathname, url.searchParams);
      if (!handled) sendJson(res, 404, { error: 'API route not found' });
      return;
    }

    if (pathname.startsWith('/logs/')) {
      const relativePath = pathname.replace(/^\/logs\//, '');
      const abs = safeJoin(LOGS_ROOT, relativePath);
      if (!abs) {
        sendText(res, 400, 'Ruta no valida');
        return;
      }
      sendFile(res, abs);
      return;
    }

    let relativeWebPath = pathname;
    if (relativeWebPath === '/') {
      relativeWebPath = '/index.html';
    }

    const absWebFile = safeJoin(WEB_ROOT, relativeWebPath);
    if (!absWebFile) {
      sendText(res, 400, 'Ruta no valida');
      return;
    }

    sendFile(res, absWebFile);
  } catch (error) {
    sendJson(res, 500, {
      error: 'Internal server error',
      detail: error.message || String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] API+Web listening on http://${HOST}:${PORT}`);
});
