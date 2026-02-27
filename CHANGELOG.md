# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
### Added
- User-Agent support end-to-end (CLI, API, core, web form).
- API endpoint `GET /api/redirect-monitor/user-agents` with common presets.
- Web selector for User-Agent presets and custom User-Agent input.
- Project operating rule in `AGENTS.md` to keep changelog updated.

### Changed
- Job configuration now stores `userAgent` and shows it in the jobs table.
- Redirect monitor request headers now build from configurable User-Agent.

## [0.1.0] - 2026-02-27
### Added
- Initial toolbox architecture (`apps/api`, `apps/web`, `lib`, `bin`, `runtime/logs`).
- Redirect monitor core with redirect chain tracing and cache/CDN diagnostics.
- Local API and web dashboard to create/stop monitor jobs.
- JSONL log viewer with timeline, latency chart, and event details.
- CLI monitor command for terminal use.
