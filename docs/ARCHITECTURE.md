# Architecture

SAVE MY… uses Bun + TypeScript + React/Vite + Hono + PostgreSQL. This is smaller than a framework-heavy server-rendered stack, keeps the graph workspace client-side, and lets the HTTP UI and WebMCP adapters share one application boundary.

```text
React UI ─────┐
              ├─ Hono HTTP adapters ─ application service ─ domain graph engine
WebMCP tools ─┘                                  │
                                          workspace repository
                                          PostgreSQL / memory tests
```

## Boundaries

- `src/domain`: entities, relationships, scenarios, trust states, deterministic simulation, validation, proposal application, staleness.
- `src/application`: tenant-scoped workspace aggregate commands and queries, version checks, idempotency, human-only proposal decisions, activity attribution.
- `src/infrastructure`: four code-owned demo aggregates, the PostgreSQL repository, and its migration.
- `src/server`: validation, cookies, request limits, error mapping, static delivery.
- `src/web`: graph, responsive list, inspectors, complete manual company setup, account/company management, proposals, and human decision UI.
- `src/web/webmcp`: native capability detection, schemas, app-lifetime account registration, live active-company workspace context, cross-realm abort signals, and UI-visible tool effects.

## Decisions

- The workspace is persisted as a versioned JSONB aggregate. This keeps invariants and mutations atomic at the application boundary while the prototype domain evolves. Indexed relational projections can be added later without changing the domain contracts.
- Calculations are deterministic. No model decides graph reachability, blocked workflows, cycles, alternates, or before/after effects.
- Demo templates are code-owned and immutable. A tenant/session-specific clone is created on first access; reset replaces only that clone.
- Persistent writes use atomic expected-version compare-and-swap. Durable agent mutations embed their operation-scoped idempotency token and payload fingerprint in the same atomically saved workspace aggregate, which is the single replay source of truth.
- Workspace Site Tools stay registered across an ordinary in-app company switch and resolve a live workspace reference. An HTTP result is rejected if its starting company is no longer active; leaving the workspace view or retrying a failed handoff aborts and rebuilds the workspace registration lifecycle.
- Sessions are opaque random IDs in HttpOnly, SameSite cookies and persist in PostgreSQL when a database is configured. Login rotates the session, and the public judge credential creates an isolated tenant per browser session.

## Known release boundary

The product is prepared for a single-instance Coolify deployment. Workspace writes and their replay identity are protected by database compare-and-swap; horizontal scaling would still require centralized rate limiting.
