'use strict';

const DEFAULT_SITEMAP_FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_URLS = 10_000;
const DEFAULT_MAX_SITEMAPS = 40;

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractLocValues(xmlText) {
  const locs = [];
  const re = /<(?:[a-z0-9_-]+:)?loc\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?loc>/gi;
  let match = re.exec(xmlText);
  while (match) {
    const raw = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    if (raw) {
      locs.push(decodeXmlEntities(raw));
    }
    match = re.exec(xmlText);
  }
  return locs;
}

function normalizeHttpUrl(raw, baseUrl = null) {
  try {
    const u = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return null;
    }
    return u.toString();
  } catch (_) {
    return null;
  }
}

function parseSitemapDocument(text, baseUrl = null) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return { kind: 'empty', urls: [], nestedSitemaps: [] };
  }

  const looksLikeXml = trimmed.startsWith('<') || trimmed.includes('<urlset') || trimmed.includes('<sitemapindex');
  if (!looksLikeXml) {
    const urls = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => normalizeHttpUrl(line, baseUrl))
      .filter(Boolean);

    return {
      kind: 'text-url-list',
      urls,
      nestedSitemaps: [],
    };
  }

  const isSitemapIndex = /<(?:[a-z0-9_-]+:)?sitemapindex\b/i.test(trimmed);
  const locs = extractLocValues(trimmed);
  const normalized = locs
    .map((loc) => normalizeHttpUrl(loc, baseUrl))
    .filter(Boolean);

  if (isSitemapIndex) {
    return {
      kind: 'sitemapindex',
      urls: [],
      nestedSitemaps: normalized,
    };
  }

  return {
    kind: 'urlset',
    urls: normalized,
    nestedSitemaps: [],
  };
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'redirect-monitor-sitemap-loader/1.0 (+local-tool)',
        accept: 'application/xml,text/xml,text/plain,*/*',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} al leer sitemap`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function randomItem(array) {
  const index = Math.floor(Math.random() * array.length);
  return {
    index,
    value: array[index],
  };
}

async function loadSitemapUrls(options) {
  const sitemapUrl = options && options.sitemapUrl ? String(options.sitemapUrl).trim() : '';
  const sitemapContent = options && options.sitemapContent ? String(options.sitemapContent) : '';
  const timeoutMs = options && Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : DEFAULT_SITEMAP_FETCH_TIMEOUT_MS;
  const maxUrls = options && Number.isFinite(Number(options.maxUrls)) ? Number(options.maxUrls) : DEFAULT_MAX_URLS;
  const maxSitemaps = options && Number.isFinite(Number(options.maxSitemaps)) ? Number(options.maxSitemaps) : DEFAULT_MAX_SITEMAPS;

  if (!sitemapUrl && !sitemapContent) {
    throw new Error('Falta sitemap (url o contenido).');
  }
  if (sitemapUrl && sitemapContent) {
    throw new Error('Usa solo sitemapUrl o sitemapContent, no ambos.');
  }
  if (maxUrls < 1 || maxSitemaps < 1) {
    throw new Error('Limites de sitemap invalidos.');
  }

  const queue = [];
  if (sitemapUrl) {
    const normalizedSitemapUrl = normalizeHttpUrl(sitemapUrl);
    if (!normalizedSitemapUrl) {
      throw new Error('sitemapUrl no es una URL http/https valida.');
    }
    queue.push({ type: 'url', url: normalizedSitemapUrl });
  } else {
    queue.push({ type: 'content', content: sitemapContent, sourceLabel: options && options.sourceLabel ? String(options.sourceLabel) : 'inline' });
  }

  const visitedSitemaps = new Set();
  const urls = [];
  const uniqueUrls = new Set();
  let processedSitemaps = 0;

  while (queue.length > 0) {
    if (urls.length >= maxUrls) break;
    if (processedSitemaps >= maxSitemaps) break;

    const item = queue.shift();
    processedSitemaps += 1;

    let text;
    let baseUrl = null;

    if (item.type === 'url') {
      if (visitedSitemaps.has(item.url)) {
        continue;
      }
      visitedSitemaps.add(item.url);
      baseUrl = item.url;
      text = await fetchTextWithTimeout(item.url, timeoutMs);
    } else {
      text = item.content;
    }

    const parsed = parseSitemapDocument(text, baseUrl);

    for (const pageUrl of parsed.urls) {
      if (!uniqueUrls.has(pageUrl)) {
        uniqueUrls.add(pageUrl);
        urls.push(pageUrl);
        if (urls.length >= maxUrls) break;
      }
    }

    if (urls.length >= maxUrls) break;

    for (const nested of parsed.nestedSitemaps) {
      if (queue.length + visitedSitemaps.size >= maxSitemaps) break;
      if (!visitedSitemaps.has(nested)) {
        queue.push({ type: 'url', url: nested });
      }
    }
  }

  return {
    urls,
    count: urls.length,
    processedSitemaps,
    sourceType: sitemapUrl ? 'url' : 'content',
    source: sitemapUrl || (options && options.sourceLabel ? String(options.sourceLabel) : 'inline'),
    truncated: urls.length >= maxUrls,
  };
}

module.exports = {
  DEFAULT_SITEMAP_FETCH_TIMEOUT_MS,
  DEFAULT_MAX_URLS,
  DEFAULT_MAX_SITEMAPS,
  parseSitemapDocument,
  loadSitemapUrls,
  randomItem,
};
