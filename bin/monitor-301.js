#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const {
  nowIso,
  sleep,
  parseDuration,
  runCheckAttempt,
  formatAttemptSummary,
  formatHopConsole,
} = require('../lib/redirect-monitor-core');

function printHelp() {
  console.log(`\nMonitor de redirecciones (301/302/...)\n
Uso:
  node monitor-301.js --url <URL> [opciones]

Opciones:
  -u, --url <URL>           URL inicial a comprobar (obligatorio)
  -e, --every <tiempo>      Intervalo entre comprobaciones. Ej: 10s, 2m, 1h (default: 60s)
  -t, --timeout <ms>        Timeout por petición en milisegundos (default: 15000)
  -m, --max-redirects <n>   Máximo de saltos por comprobación (default: 10)
  -o, --out <archivo>       Guarda logs en JSONL (una línea JSON por comprobación)
      --user-agent <UA>     User-Agent a usar en la petición
      --force-no-cache      Fuerza cabeceras de petición para bypass cache (cache-control/pragma)
      --stop-on-301         Finaliza el monitor al detectar al menos una 301
  -h, --help                Muestra esta ayuda
`);
}

function parseArgs(argv) {
  const args = {
    url: null,
    every: 60_000,
    timeout: 15_000,
    maxRedirects: 10,
    out: null,
    userAgent: null,
    forceNoCache: false,
    stopOn301: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '-h' || token === '--help') {
      args.help = true;
      continue;
    }
    if (token === '-u' || token === '--url') {
      args.url = argv[++i];
      continue;
    }
    if (token === '-e' || token === '--every') {
      args.every = parseDuration(argv[++i]);
      continue;
    }
    if (token === '-t' || token === '--timeout') {
      const timeout = Number(argv[++i]);
      if (!Number.isFinite(timeout) || timeout <= 0) {
        throw new Error('Timeout inválido. Debe ser > 0.');
      }
      args.timeout = timeout;
      continue;
    }
    if (token === '-m' || token === '--max-redirects') {
      const max = Number(argv[++i]);
      if (!Number.isInteger(max) || max < 0) {
        throw new Error('max-redirects inválido. Debe ser entero >= 0.');
      }
      args.maxRedirects = max;
      continue;
    }
    if (token === '-o' || token === '--out') {
      args.out = argv[++i];
      continue;
    }
    if (token === '--user-agent') {
      args.userAgent = argv[++i];
      continue;
    }
    if (token === '--force-no-cache') {
      args.forceNoCache = true;
      continue;
    }
    if (token === '--stop-on-301') {
      args.stopOn301 = true;
      continue;
    }

    throw new Error(`Argumento no reconocido: ${token}`);
  }

  if (!args.help && !args.url) {
    throw new Error('Falta --url <URL>.');
  }

  if (args.url) {
    // eslint-disable-next-line no-new
    new URL(args.url);
  }

  return args;
}

function appendJsonLine(filePath, obj) {
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, `${JSON.stringify(obj)}\n`, 'utf8');
}

async function run() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    printHelp();
    return;
  }

  console.log(`\n[${nowIso()}] Iniciando monitor...`);
  console.log(`URL: ${args.url}`);
  console.log(`Intervalo: ${args.every} ms`);
  console.log(`Timeout: ${args.timeout} ms`);
  console.log(`Max redirects por ciclo: ${args.maxRedirects}`);
  console.log(`Guardar log: ${args.out ? path.resolve(args.out) : 'no'}`);
  console.log(`User-Agent: ${args.userAgent || '(default)'}`);
  console.log(`Forzar no-cache: ${args.forceNoCache ? 'si' : 'no'}`);
  console.log(`Parar al detectar 301: ${args.stopOn301 ? 'si' : 'no'}\n`);

  let attempt = 0;
  let keepRunning = true;

  process.on('SIGINT', () => {
    keepRunning = false;
    console.log('\nSIGINT recibido. Terminando monitor...');
  });

  while (keepRunning) {
    attempt += 1;
    const event = await runCheckAttempt({
      url: args.url,
      timeoutMs: args.timeout,
      maxRedirects: args.maxRedirects,
      forceNoCache: args.forceNoCache,
      userAgent: args.userAgent,
      attempt,
    });

    if (event.ok) {
      console.log(formatAttemptSummary(event.timestamp, event.attempt, event));
      for (const hop of event.hops) {
        console.log(`  - ${formatHopConsole(hop)}`);
      }
      if (event.found301) {
        console.log('  >>> ALERTA: se detecto al menos una redireccion 301 en esta comprobacion.');
      }
      if (event.foundCacheHit) {
        console.log('  >>> INFO: se detecto respuesta servida desde cache (HIT) en esta comprobacion.');
      }
    } else {
      console.error(`[${event.timestamp}] #${event.attempt} ERROR: ${event.error}`);
    }

    if (args.out) {
      appendJsonLine(args.out, event);
    }

    if (args.stopOn301 && event.ok && event.found301) {
      console.log('\n--stop-on-301 activo: monitor finalizado.');
      break;
    }

    if (!keepRunning) break;
    await sleep(args.every);
  }
}

run();
