'use strict';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_USER_AGENT = 'redirect-monitor/1.0 (+local-tool)';
const COMMON_USER_AGENTS = [
  {
    id: 'chrome-windows',
    label: 'Chrome Windows',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  },
  {
    id: 'chrome-mac',
    label: 'Chrome macOS',
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  },
  {
    id: 'edge-windows',
    label: 'Edge Windows',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0',
  },
  {
    id: 'firefox-windows',
    label: 'Firefox Windows',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0',
  },
  {
    id: 'safari-mac',
    label: 'Safari macOS',
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  },
  {
    id: 'chrome-android',
    label: 'Chrome Android',
    value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  },
  {
    id: 'safari-ios',
    label: 'Safari iPhone',
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'googlebot-mobile',
    label: 'Googlebot Smartphone',
    value: 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  },
];
const CACHE_HEADER_KEYS = [
  'x-cache',
  'x-cache-hits',
  'cf-cache-status',
  'age',
  'via',
  'server',
  'x-amz-cf-pop',
  'x-amz-cf-id',
  'cache-control',
  'expires',
  'date',
  'etag',
  'last-modified',
  'vary',
];

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDuration(input) {
  if (!input && input !== 0) return 60_000;
  const str = String(input).trim().toLowerCase();
  const match = str.match(/^(\d+)(ms|s|m|h)?$/);
  if (!match) {
    throw new Error(`Intervalo invalido: "${input}". Usa 10s, 2m, 1h o ms.`);
  }
  const value = Number(match[1]);
  const unit = match[2] || 'ms';

  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 3_600_000;
    default:
      throw new Error(`Unidad no soportada: ${unit}`);
  }
}

function normalizeUserAgent(userAgent) {
  if (userAgent === null || userAgent === undefined) return DEFAULT_USER_AGENT;
  const ua = String(userAgent).trim();
  if (!ua) return DEFAULT_USER_AGENT;
  if (ua.length > 1024) {
    throw new Error('User-Agent demasiado largo (max 1024).');
  }
  return ua;
}

function buildRequestHeaders(forceNoCache, userAgent) {
  const headers = {
    'user-agent': normalizeUserAgent(userAgent),
  };
  if (forceNoCache) {
    headers['cache-control'] = 'no-cache';
    headers.pragma = 'no-cache';
  }
  return headers;
}

function headersToObject(headers) {
  const out = {};
  for (const [key, value] of headers.entries()) {
    out[key] = value;
  }
  return out;
}

function filterHeaders(headers, keys) {
  const out = {};
  for (const key of keys) {
    if (headers[key]) out[key] = headers[key];
  }
  return out;
}

function buildCacheInfo(headers) {
  const info = {
    xCache: headers['x-cache'] || null,
    xCacheHits: headers['x-cache-hits'] || null,
    cfCacheStatus: headers['cf-cache-status'] || null,
    age: headers.age || null,
    via: headers.via || null,
    server: headers.server || null,
    xAmzCfPop: headers['x-amz-cf-pop'] || null,
    xAmzCfId: headers['x-amz-cf-id'] || null,
    cacheControl: headers['cache-control'] || null,
    expires: headers.expires || null,
    date: headers.date || null,
    etag: headers.etag || null,
    lastModified: headers['last-modified'] || null,
    vary: headers.vary || null,
  };

  const hitSignals = [info.xCache, info.cfCacheStatus].filter(Boolean).join(' ');
  info.cacheHit = /\bhit\b/i.test(hitSignals);
  return info;
}

function formatCacheSummary(cacheInfo) {
  const parts = [];
  if (cacheInfo.xCache) parts.push(`x-cache="${cacheInfo.xCache}"`);
  if (cacheInfo.cfCacheStatus) parts.push(`cf-cache-status="${cacheInfo.cfCacheStatus}"`);
  if (cacheInfo.age) parts.push(`age=${cacheInfo.age}`);
  if (cacheInfo.xAmzCfPop) parts.push(`pop=${cacheInfo.xAmzCfPop}`);
  if (cacheInfo.xAmzCfId) parts.push(`cf-id=${cacheInfo.xAmzCfId}`);
  if (parts.length === 0) return 'sin cabeceras cache/cdn';
  return parts.join(', ');
}

async function fetchWithTimeout(url, timeoutMs, requestHeaders) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = nowIso();
  const startedMs = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: requestHeaders,
    });

    return {
      response,
      startedAt,
      endedAt: nowIso(),
      durationMs: Date.now() - startedMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function traceRedirects(startUrl, timeoutMs, maxRedirects, requestHeaders) {
  const hops = [];
  let currentUrl = startUrl;
  let found301 = false;
  let foundCacheHit = false;

  for (let i = 0; i <= maxRedirects; i += 1) {
    const requestMeta = await fetchWithTimeout(currentUrl, timeoutMs, requestHeaders);
    const response = requestMeta.response;
    const status = response.status;
    const location = response.headers.get('location');
    const responseHeaders = headersToObject(response.headers);
    const cacheInfo = buildCacheInfo(responseHeaders);

    const hop = {
      hop: i + 1,
      url: currentUrl,
      status,
      statusText: response.statusText || null,
      location: location || null,
      nextUrl: location ? new URL(location, currentUrl).toString() : null,
      requestStartedAt: requestMeta.startedAt,
      requestEndedAt: requestMeta.endedAt,
      durationMs: requestMeta.durationMs,
      requestHeaders,
      cache: cacheInfo,
      cacheHeaders: filterHeaders(responseHeaders, CACHE_HEADER_KEYS),
      responseHeaders,
    };
    hops.push(hop);

    if (status === 301) found301 = true;
    if (cacheInfo.cacheHit) foundCacheHit = true;

    if (REDIRECT_STATUSES.has(status) && location) {
      currentUrl = hop.nextUrl;
      continue;
    }

    break;
  }

  const lastHop = hops[hops.length - 1];
  return {
    found301,
    foundCacheHit,
    hops,
    finalUrl: lastHop ? lastHop.url : startUrl,
    finalStatus: lastHop ? lastHop.status : null,
  };
}

function serializeError(error) {
  const cause = error && error.cause ? error.cause : null;
  return {
    name: error && error.name ? error.name : null,
    message: error && error.message ? error.message : String(error),
    code: (error && error.code) || (cause && cause.code) || null,
    errno: (error && error.errno) || (cause && cause.errno) || null,
    type: (error && error.type) || (cause && cause.type) || null,
    stack: error && error.stack ? error.stack : null,
    cause: cause
      ? {
          name: cause.name || null,
          message: cause.message || null,
          code: cause.code || null,
          errno: cause.errno || null,
          type: cause.type || null,
          stack: cause.stack || null,
        }
      : null,
  };
}

function formatErrorSummary(errorDetails, timeoutMs) {
  if (errorDetails.name === 'AbortError') {
    return `Timeout de ${timeoutMs} ms`;
  }
  const code = errorDetails.code ? ` code=${errorDetails.code}` : '';
  const errno = errorDetails.errno ? ` errno=${errorDetails.errno}` : '';
  const cause = errorDetails.cause && errorDetails.cause.message ? ` cause="${errorDetails.cause.message}"` : '';
  return `${errorDetails.message}${code}${errno}${cause}`;
}

function formatRunId(timestamp, attempt) {
  return `${timestamp.replace(/[:.]/g, '-')}-${attempt}`;
}

function formatHopForLog(hop) {
  return {
    ...hop,
    cacheSummary: formatCacheSummary(hop.cache),
  };
}

function formatHopConsole(hop) {
  const base = hop.location
    ? `${hop.status} ${hop.url} -> ${hop.location}`
    : `${hop.status} ${hop.url}`;
  return `${base} (${hop.durationMs} ms) | cache: ${formatCacheSummary(hop.cache)}`;
}

function formatAttemptSummary(timestamp, attempt, result) {
  return `[${timestamp}] #${attempt} final=${result.finalStatus} url=${result.finalUrl} 301=${
    result.found301 ? 'SI' : 'no'
  } cacheHit=${result.foundCacheHit ? 'SI' : 'no'}`;
}

async function runCheckAttempt({ url, timeoutMs, maxRedirects, forceNoCache, userAgent, attempt }) {
  const timestamp = nowIso();
  let requestHeaders = null;

  try {
    requestHeaders = buildRequestHeaders(forceNoCache, userAgent);
    const result = await traceRedirects(url, timeoutMs, maxRedirects, requestHeaders);
    const runId = formatRunId(timestamp, attempt);

    return {
      ok: true,
      runId,
      timestamp,
      attempt,
      startUrl: url,
      requestHeaders,
      found301: result.found301,
      foundCacheHit: result.foundCacheHit,
      finalUrl: result.finalUrl,
      finalStatus: result.finalStatus,
      hops: result.hops.map(formatHopForLog),
    };
  } catch (error) {
    const runId = formatRunId(timestamp, attempt);
    const errorDetails = serializeError(error);
    return {
      ok: false,
      runId,
      timestamp,
      attempt,
      startUrl: url,
      requestHeaders: requestHeaders || {},
      timeoutMs,
      error: formatErrorSummary(errorDetails, timeoutMs),
      errorDetails,
    };
  }
}

module.exports = {
  REDIRECT_STATUSES,
  CACHE_HEADER_KEYS,
  DEFAULT_USER_AGENT,
  COMMON_USER_AGENTS,
  nowIso,
  sleep,
  parseDuration,
  normalizeUserAgent,
  buildRequestHeaders,
  traceRedirects,
  serializeError,
  formatErrorSummary,
  formatHopForLog,
  formatHopConsole,
  formatAttemptSummary,
  formatRunId,
  runCheckAttempt,
};
