'use strict';

const fs = require('fs');
const path = require('path');
const {
  nowIso,
  runCheckAttempt,
  normalizeUserAgent,
} = require('./redirect-monitor-core');

const DEFAULTS = {
  everyMs: 60_000,
  timeoutMs: 15_000,
  maxRedirects: 10,
  forceNoCache: false,
  stopOn301: false,
  userAgent: null,
};

function ensureAbsoluteUrl(url) {
  // eslint-disable-next-line no-new
  new URL(url);
}

function ensureNumber(value, { min = null, integer = false, fallback = null } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    if (fallback !== null) return fallback;
    throw new Error('Valor numerico invalido');
  }
  if (integer && !Number.isInteger(num)) {
    throw new Error('Se esperaba numero entero');
  }
  if (min !== null && num < min) {
    throw new Error(`El valor debe ser >= ${min}`);
  }
  return num;
}

function toPublicConfig(config) {
  return {
    url: config.url,
    everyMs: config.everyMs,
    timeoutMs: config.timeoutMs,
    maxRedirects: config.maxRedirects,
    forceNoCache: config.forceNoCache,
    stopOn301: config.stopOn301,
    userAgent: config.userAgent,
  };
}

class RedirectMonitorManager {
  constructor({ logsDir }) {
    this.logsDir = logsDir;
    this.jobs = new Map();
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  validateConfig(input) {
    if (!input || typeof input !== 'object') {
      throw new Error('Body JSON invalido');
    }
    if (!input.url) {
      throw new Error('Falta url');
    }

    ensureAbsoluteUrl(input.url);

    return {
      url: String(input.url),
      everyMs: ensureNumber(input.everyMs ?? DEFAULTS.everyMs, { min: 1000, integer: true }),
      timeoutMs: ensureNumber(input.timeoutMs ?? DEFAULTS.timeoutMs, { min: 1000, integer: true }),
      maxRedirects: ensureNumber(input.maxRedirects ?? DEFAULTS.maxRedirects, { min: 0, integer: true }),
      forceNoCache: Boolean(input.forceNoCache ?? DEFAULTS.forceNoCache),
      stopOn301: Boolean(input.stopOn301 ?? DEFAULTS.stopOn301),
      userAgent: normalizeUserAgent(input.userAgent ?? DEFAULTS.userAgent),
    };
  }

  createJob(inputConfig) {
    const config = this.validateConfig(inputConfig);
    const createdAt = nowIso();
    const id = `rm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const logFileName = `${id}.jsonl`;
    const logFilePath = path.join(this.logsDir, logFileName);

    const job = {
      id,
      type: 'redirect-monitor',
      status: 'running',
      createdAt,
      startedAt: createdAt,
      stoppedAt: null,
      lastRunAt: null,
      attempts: 0,
      config,
      lastEvent: null,
      logFilePath,
      logFileName,
      logUrl: `/logs/redirect-monitor/${encodeURIComponent(logFileName)}`,
      timer: null,
      busy: false,
      stopReason: null,
    };

    this.jobs.set(id, job);
    this.runLoop(job);
    return this.toPublicJob(job);
  }

  toPublicJob(job) {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      stoppedAt: job.stoppedAt,
      lastRunAt: job.lastRunAt,
      attempts: job.attempts,
      stopReason: job.stopReason,
      config: toPublicConfig(job.config),
      lastEvent: job.lastEvent,
      logUrl: job.logUrl,
      logFileName: job.logFileName,
    };
  }

  appendLog(job, event) {
    fs.mkdirSync(path.dirname(job.logFilePath), { recursive: true });
    fs.appendFileSync(job.logFilePath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  async runOnce(job) {
    if (job.status !== 'running' || job.busy) return;
    job.busy = true;
    job.attempts += 1;

    const event = await runCheckAttempt({
      url: job.config.url,
      timeoutMs: job.config.timeoutMs,
      maxRedirects: job.config.maxRedirects,
      forceNoCache: job.config.forceNoCache,
      userAgent: job.config.userAgent,
      attempt: job.attempts,
    });

    job.lastRunAt = event.timestamp;
    job.lastEvent = event;
    this.appendLog(job, event);

    if (job.config.stopOn301 && event.ok && event.found301) {
      this.stopJob(job.id, 'stop-on-301');
    }

    job.busy = false;
  }

  runLoop(job) {
    const scheduleNext = () => {
      if (job.status !== 'running') return;
      job.timer = setTimeout(async () => {
        await this.runOnce(job);
        scheduleNext();
      }, job.config.everyMs);
    };

    // Primera comprobacion inmediata.
    this.runOnce(job)
      .then(() => scheduleNext())
      .catch((error) => {
        job.lastEvent = {
          ok: false,
          timestamp: nowIso(),
          attempt: job.attempts,
          error: `Error interno: ${error.message || String(error)}`,
        };
        this.stopJob(job.id, 'internal-error');
      });
  }

  stopJob(id, reason = 'manual') {
    const job = this.jobs.get(id);
    if (!job) {
      return null;
    }

    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }

    if (job.status === 'running') {
      job.status = 'stopped';
      job.stoppedAt = nowIso();
      job.stopReason = reason;
    }

    return this.toPublicJob(job);
  }

  getJob(id) {
    const job = this.jobs.get(id);
    return job ? this.toPublicJob(job) : null;
  }

  getJobLogFilePath(id) {
    const job = this.jobs.get(id);
    return job ? job.logFilePath : null;
  }

  listJobs() {
    return [...this.jobs.values()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((job) => this.toPublicJob(job));
  }
}

module.exports = {
  RedirectMonitorManager,
};
