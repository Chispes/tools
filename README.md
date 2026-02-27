# Local Toolbox

Proyecto pensado para crecer con varias herramientas de trabajo (local o en Plesk).

Primera herramienta implementada:

- Monitor de redirecciones 301 (con trazado de hops, cache/CDN y errores de red)

## Estructura recomendada

- `apps/api/`: servidor HTTP + API
- `apps/web/`: interfaz web (panel y visor de logs)
- `lib/`: logica reutilizable de herramientas
- `bin/`: CLIs
- `runtime/logs/`: logs generados en ejecucion

## Requisitos

- Node.js 18+

## Arrancar la web (formulario + monitor en vivo)

```bash
cd /Users/chispes/Workspace/tools
npm start
```

Abre:

- `http://localhost:8787/`

Desde esa web puedes:

- crear jobs del monitor 301 con formulario
- elegir User-Agent (presets conocidos o personalizado)
- parar jobs en ejecucion
- abrir el log JSONL y el visor visual por cada job

## Visor de logs

Ruta:

- `http://localhost:8787/log-viewer.html`

Funciones:

- banda temporal de estados (clicable)
- grafica de latencia (media/p95/max)
- detalle por evento (hops + cache + error + JSON)
- auto-recarga cada X segundos para modo monitor en tiempo real

Tambien puedes abrir un log concreto por query string:

```txt
http://localhost:8787/log-viewer.html?file=/logs/redirect-monitor/<job-id>.jsonl
```

## API principal

- `GET /api/health`
- `GET /api/tools`
- `GET /api/redirect-monitor/jobs`
- `GET /api/redirect-monitor/user-agents`
- `POST /api/redirect-monitor/jobs`
- `GET /api/redirect-monitor/jobs/:id`
- `POST /api/redirect-monitor/jobs/:id/stop`
- `GET /api/redirect-monitor/jobs/:id/tail?lines=100`

Ejemplo body para crear job:

```json
{
  "url": "https://techy44.okdiario.com/",
  "everyMs": 30000,
  "timeoutMs": 15000,
  "maxRedirects": 10,
  "userAgent": "Mozilla/5.0 (...)",
  "forceNoCache": false,
  "stopOn301": false
}
```

## Despliegue en Plesk (Node.js)

Configura la app Node con:

- Document root: `/Users/chispes/Workspace/tools`
- Application startup file: `apps/api/server.js`
- Variables recomendadas:
  - `PORT` (el que te asigne Plesk)
  - `HOST=0.0.0.0`

Despues abre:

- `/` para el panel de control
- `/log-viewer.html` para el visor de logs

## CLI (se mantiene)

Puedes seguir usando terminal:

```bash
node /Users/chispes/Workspace/tools/monitor-301.js -u "https://techy44.okdiario.com/" -e 30s --user-agent "Mozilla/5.0 (...)" -o runtime/logs/manual.jsonl
```

O directamente:

```bash
npm run monitor -- -u "https://techy44.okdiario.com/" -e 30s
```

## Changelog

- El historial de cambios se mantiene en `CHANGELOG.md`.
