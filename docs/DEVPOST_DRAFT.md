# Devpost submission draft

## Title

SAVE MY…

## Tagline

Rehearse what breaks before one person, service, device, or recovery path disappears.

## Short description

SAVE MY… is a visual business-continuity workspace for small organizations. It maps operational dependencies, deterministically simulates absences and outages, lets a page-connected agent investigate and stage structural repairs through native WebMCP Site Tools, and reserves verification and acceptance for a human.

## Inspiration

Small teams run on undocumented chains: one founder owns a developer account, one phone receives every authentication prompt, one employee knows the offline procedure, or the recovery document lives inside the system it should recover. Traditional continuity plans are static checklists. SAVE MY… makes the counterfactual causal and visible.

## What it does

Users MAP people, services, assets, vendors, documents, workflows, access metadata, and recovery paths. BREAK runs a deterministic graph cascade. REPAIR uses narrow Site Tools to validate, focus, simulate, compare, and stage an inferred proposal. VERIFY is deliberately human-only.

Four fictional demos share the same model and engine: an app studio, edtech company, restaurant group, and commercial charter brokerage. Signed-in users can create personal workspaces manually or through Site Tools, declare and connect items, duplicate demos, rename/archive/restore private workspaces, permanently delete them through a separate confirmation, and review attributed activity.

## How WebMCP is used

The page registers 18 real tools through `document.modelContext.registerTool(...)`. Account tools list and create isolated user-owned companies without UI automation, then wait until the new company's workspace tool registration is ready before handing off. Workspace registrations use live active-company state and reject an old in-flight result after a company switch. Read tools expose bounded versioned structure and deterministic calculations. Focus tools visibly manipulate the live graph. Draft/proposal tools use optimistic concurrency and durable idempotency, including complete company blueprints and three-to-five-scenario design sets. Repair options are authored entirely by the agent, checked for connected multi-item graph integrity, deterministically required to reach zero blocked workflows, and stored by the backend. No tool can verify access, accept its own proposal, finalize a plan, or delete a workspace.

## How we built it

Bun, TypeScript, React/Vite, Hono, PostgreSQL, Zod, custom SVG graph rendering, native WebMCP, Docker, Playwright, and axe. The graph engine handles reachability, alternate paths, cascades, single points, missing owners, unknown/stale recovery, cycles, orphans, focused subgraphs, and before/after comparisons without an LLM.

## Challenges

The central design problem was trust: letting an agent materially help without letting inference silently become fact. The product solves this structurally with trust states, immutable baselines during comparison, visible ghost proposals, version attribution, and a hard human action boundary.

## Accomplishments

- Native Site Tools are useful rather than decorative.
- A production-shaped contract and hermetic tool-callback rehearsal build Wow Project as one connected 40-item, 78-path salon network with zero orphan nodes; this is not presented as a native-host model result.
- A causal graph motion system explains the exact deterministic result.
- Anonymous demos are isolated per session and resettable.
- The interface remains complete without WebMCP and usable from 320 to 1440 px.
- The local release candidate passes unit, database integration, Chrome E2E, responsive screenshot, accessibility, type, build, and audit gates recorded in the repository.

## Testing instructions

Choose **Explore the demo** to open Diamond Apps without an account. Wait for
**Site Tools · 18 ready**, then use the prompt in `docs/JUDGE_TESTING.md`. The
agent should read structured data, focus the graph, run a deterministic
scenario, and stage a reversible repair. Only the visible human action can
apply it.

For personal-company creation, use `judge@savemy.systems` and
`SaveMy-Judge-2026`. Each judge login receives an isolated tenant.

## Submission links

- Working URL: `[PENDING — not deployed]`
- Public source: `https://github.com/artem-musii/save-my`
- YouTube demo: `[PENDING — not recorded/published]`
