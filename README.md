# SAVE MY…

[![CI](https://github.com/artem-musii/save-my/actions/workflows/ci.yml/badge.svg)](https://github.com/artem-musii/save-my/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)
[![WebMCP](https://img.shields.io/badge/WebMCP-18%20Site%20Tools-9ee7cf.svg)](docs/WEBMCP.md)

> Rehearse what breaks before one person, service, device, or recovery path
> disappears.

![SAVE MY… product artwork](public/assets/submission-thumbnail.webp)

Small teams are held together by invisible dependencies: the founder’s phone
receives every login code, one person owns the billing account, or the recovery
document lives inside the system it is meant to recover. Those details usually
surface at the worst possible moment.

I built SAVE MY… to make that fragility visible while there is still time to
fix it. The app maps a company as a dependency graph, temporarily removes a
person or system, and shows the exact work that stops. An agent can investigate
the map and stage repairs through native WebMCP Site Tools, but it cannot accept
its own proposal or declare anything verified. That last step stays human.

The loop is deliberately simple: **MAP → BREAK → REPAIR → VERIFY**.

## Try it

Choose **Explore the demo** for four fictional companies with realistic
continuity problems. No account is required. For personal workspaces, the judge
account is:

- Email: `judge@savemy.systems`
- Password: `SaveMy-Judge-2026`

Anonymous demo state is isolated per session. Judge logins are also placed in
separate tenants, so two reviewers cannot edit each other’s work. **Reset demo**
restores the original fictional company.

## What the agent can—and cannot—do

The page registers 18 real tools through
`document.modelContext.registerTool(...)`:

- read a bounded, versioned company map;
- search and visibly focus the live graph;
- validate continuity paths and run deterministic disruption scenarios;
- create an empty company and stage a complete connected blueprint;
- design several materially different failure scenarios;
- stage delegation, scheduling, and full repair options for review; and
- compare the current graph with a proposed repair without mutating the
  baseline.

There is intentionally no tool for verifying access, accepting or rejecting a
proposal, assigning final responsibility, closing a rehearsal, or deleting a
workspace. Agent output is marked **INFERRED** and remains reversible until a
person acts in the visible interface.

The common registration boundary is in
[`src/web/webmcp/toolRegistry.ts`](src/web/webmcp/toolRegistry.ts); the account
and workspace definitions live beside it. See
[`docs/WEBMCP.md`](docs/WEBMCP.md) for the contracts and trust model.

## Run it locally

You need Bun 1.3+ and PostgreSQL 17+. Node.js is not required.

```bash
cp .env.example .env
bun install
bun run db:migrate
bun run dev
```

Open `http://localhost:5173`. Native Site Tools require a supported client: use
the ChatGPT in-app browser or Chrome 149+ with WebMCP testing enabled.

For the production-shaped Docker stack:

```bash
docker compose up --build
```

The app will be available at `http://localhost:3000`.

## Test it

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run test:e2e
bun run build
bun run audit
```

`bun run test` skips the live PostgreSQL repository suite when `DATABASE_URL`
is absent. [`docs/TESTING.md`](docs/TESTING.md) includes the database and Docker
commands. The full suite covers the graph engine, tenant isolation, optimistic
concurrency, durable idempotency, HTTP contracts, all 18 tool registrations,
real tool callbacks, responsive layouts, keyboard behavior, and automated
accessibility checks.

## Deploy it

The fastest hackathon path is the included Render Blueprint. It creates a
single Docker web service and PostgreSQL 17 database. The app image applies its
idempotent migration at startup and Render checks `/api/health`.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/artem-musii/save-my)

Render’s free services are suitable for judging but have cold starts and the
free database expires after 30 days. For a durable installation, use the same
Docker image with a paid managed Postgres database, or deploy the included
Compose stack on a small VPS through Coolify. Details and the public-release
checklist are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## How it is put together

- **Domain:** graph invariants, alternate paths, reachability, cascades,
  validation, staleness, and before/after comparisons.
- **Application:** tenant-scoped commands and queries, authorization,
  provenance, optimistic concurrency, and idempotency.
- **Infrastructure:** PostgreSQL aggregate persistence, durable sessions, and
  immutable code-owned demo templates.
- **Presentation:** React/Vite, a custom accessible SVG graph, and a Hono JSON
  API running on Bun.
- **WebMCP:** two app-lifetime account tools and sixteen live workspace tools
  with cancellation, bounded schemas, visible effects, and a hard human
  decision boundary.

Useful reading: [architecture](docs/ARCHITECTURE.md),
[security](docs/SECURITY.md), [accessibility](docs/ACCESSIBILITY.md),
[judge path](docs/JUDGE_TESTING.md), and
[hackathon requirements](docs/HACKATHON_REQUIREMENTS.md).

## License and data

SAVE MY… is available under the [MIT License](LICENSE). The bundled Inter and
Martian Mono fonts remain under the SIL Open Font License 1.1; see
[third-party notices](THIRD_PARTY_NOTICES.md).

All demo organizations, people, incidents, and generated images are fictional
or synthetic. Their generation notes and checksums are recorded in
[`docs/ASSET_PROVENANCE.md`](docs/ASSET_PROVENANCE.md). Do not put passwords,
recovery codes, tokens, or other secret values into a continuity map.
