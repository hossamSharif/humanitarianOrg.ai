# Implement-time Gates: 002-procurement-to-payment

**Checked**: 2026-11-16 (T001), at the start of `/speckit-implement` Phase 1
**Sources**: quickstart.md "Prerequisites", research.md R36 and R29

| # | Gate | Result | Evidence |
|---|---|---|---|
| 1 | Constitution v1.2.0 (Principle XI, regression-gate rule) present and committed | ✅ PASS | `.specify/memory/constitution.md` is v1.2.0 with `### XI. Accounting Integrity` and the "regression gate" workflow rule; committed in `8fca543` |
| 2 | 001 tasks T142 and T159–T166 checked in `specs/001-grants-pr-foundation/tasks.md` | ❌ OPEN | All nine are still `- [ ]`. Missing artifacts: `packages/database/scripts/seed-demo.ts` (T159; `seed:demo` script points to it), `apps/web/e2e/fixtures/rtha-pr-0010.json` (T160), `apps/web/e2e/rtha-pr-0010.spec.ts` (T161), root `README.md` (T166), `specs/001-grants-pr-foundation/checklists/security.md` (T165). `pr-list.int.test.ts` exists but T142 is unchecked |
| 3 | `pg_cron` enabled on the dev project, or the R29 fallback chosen | ✅ PASS (fallback) | `pg_available_extensions` on `humanitairianOrg`: `pg_cron` 1.6.4 available, **not installed**. The R29 API interval sweeper (`NOTIFICATION_SWEEP_INTERVAL_MS`, default 900000, advisory lock + lazy sweep on task load) is the chosen path until someone enables the extension. Migration `0022_scheduled_notifications` must schedule the job only when the extension exists |
| — | Supabase MCP connects (quickstart gate 3, informational) | ⚠️ DOWN | MCP timed out again this session; use the 001 R20 fallback (`pnpm --filter @ngo/database migrate`, `gen:types`) |

## Impact

- Phase 1 (setup: folders, barrels, empty i18n namespaces, gated navigation) does not depend
  on gate 2 and was completed.
- **Gate 2 blocks the phases that extend the 001 seed and fixture**: the 002 additions to
  `seed-demo.ts` (data-model §11) and the RTHA chain E2E (Phase 15, which extends
  `rtha-pr-0010.json`). Finish 001 T142 and T159–T166 before those phases. It also blocks the
  Phase 2 regression gate if it should cover the 001 E2E suite.
