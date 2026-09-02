# Testing

## Layers

- Bun unit tests cover graph reachability, alternate paths, cascade depth, validation, proposal isolation, verification staleness, tenant isolation, versions, idempotency, and human-only decisions.
- HTTP contract tests cover health, streamed-body limits, anonymous demo access, authentication failure, rotated judge-account isolation, account company creation, idempotency, authorization, version conflicts, archive/restore, and permanent deletion.
- PostgreSQL integration tests exercise persistence and tenant separation against a real database.
- WebMCP registry tests inspect all 18 registered tools, account-to-workspace handoff, stable live context across company switches, cross-realm aborts, partial-registration cleanup, structured bounds, and the absence of human-only capabilities.
- Playwright runs hermetic Chrome journeys on a freshly built isolated server: all four demos; a real structural repair node and changed paths in Before/After/apply; all 18 registrations and their visible log; create-company → 40-item blueprint → multi-scenario design through the real tool callbacks under a deterministic model-context bridge; failed-registry same-key recovery without UI automation; manual company creation, editing, and connection; rename/archive/restore/delete; keyboard account actions; bootstrap/action failure recovery; mobile and tablet graph/account access; scenario isolation; axe; dialog focus; 200% text sizing; and responsive screenshots across the target breakpoints.
- Manual browser QA covers native WebMCP discovery/calls, graph motion, proposal acceptance, activity attribution, personal editing, duplication, and responsive composition.

## Run

```bash
bun run test
bun run test:e2e
```

`bun run test` skips the live PostgreSQL repository suite when `DATABASE_URL`
is absent. To run it against a local PostgreSQL 17 database:

```bash
DATABASE_URL=postgres://save_my:save_my@localhost:5432/save_my bun run db:migrate
DATABASE_URL=postgres://save_my:save_my@localhost:5432/save_my bun test src/infrastructure/database/postgresWorkspaceRepository.test.ts
```

Or run the same migration and suite inside the Compose network, which uses the
credentials already defined in `docker-compose.yml` and does not require a
host database port:

```bash
docker compose up -d postgres
docker compose run --rm --build app sh -c 'bun src/infrastructure/database/migrate.ts && bun test src/infrastructure/database/postgresWorkspaceRepository.test.ts'
```

Playwright uses local Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Change `launchOptions.executablePath` on another platform.

## Manual release pass

1. Open all four demos anonymously in separate fresh contexts.
2. In Diamond Apps, open a scenario and confirm a hop-by-hop cascade and focused subgraph.
3. Stage a structural REPAIR with a new connected node; confirm it is absent in Before, visible and inspectable in After, and absent from the baseline API before acceptance.
4. Accept/reject only through the visible UI and inspect HUMAN activity.
5. Sign in; use **Add company** → **Build manually**; add two items, connect them, and create a scenario. Open the bottom-left account menu, rename and archive the company in **Company settings**, restore it from the landing page, and exercise the separately confirmed delete action on disposable data. Duplicate a demo and edit the copy.
6. Reload the server and confirm the PostgreSQL session remains signed in.
7. In a supported client/model, call native Site Tools and verify `create_company` waits for the new registry before returning `draft_company_blueprint` as ready. Re-discover the active page tools, call `get_workspace_summary`, stage a connected blueprint, then design three to five scenarios. Confirm authoritative next versions, bounded responses, call-log entries, and same-key retries. Do not use browser/computer control as a fallback.
8. Repeat with reduced motion, keyboard only, and 320 px.

Do not describe a polyfill/test bridge as native WebMCP execution.
