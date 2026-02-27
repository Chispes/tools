# AGENTS Rules

## Changelog Discipline
- Every functional or user-visible change must update `CHANGELOG.md` in the same commit.
- New work goes under `## [Unreleased]`.
- When cutting a version, move unreleased items into a dated version section.

## Structure Discipline
- Keep runtime outputs in `runtime/` and never commit generated logs.
- Put reusable logic in `lib/`, web UIs in `apps/web/`, APIs in `apps/api/`, CLIs in `bin/`.

## Release Hygiene
- Validate syntax/checks before commit.
- Keep README examples aligned with current API/CLI options.
