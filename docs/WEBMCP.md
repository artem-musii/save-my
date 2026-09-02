# WebMCP Site Tools

The app feature-detects `document.modelContext` and registers 18 real tools with `document.modelContext.registerTool(tool, { signal })`. Two account tools remain registered for the lifetime of the single-page app. Sixteen workspace tools mount while a company workspace is open and use a live workspace reference, so the same registrations follow an ordinary in-app company switch without serving the previous company's state. Each HTTP call captures its starting company and refuses its result if the active company changed while the call was running.

Leaving the workspace view or unmounting the app aborts the workspace registration lifecycle and in-flight executions. A partial registration failure aborts the whole workspace batch. Company creation intentionally starts a fresh workspace registration attempt; an exact same-key retry can safely resume a handoff that did not become ready. This keeps registration stable during normal work while still giving failed setup a clean retry path.

Without native WebMCP, the complete manual UI remains available.

## Account and company

| Tool                    | Effect                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| `get_account_companies` | Reads a bounded list of signed-in companies                            |
| `create_company`        | Idempotently creates an empty company and waits for its tools to mount |

The create-company handoff does not return `draft_company_blueprint` as the next tool until the new company’s workspace registry is live. It waits up to ten seconds. A failed or timed-out registration returns a safe same-key retry path and explicitly forbids substituting UI automation; it does not report the blueprint tool as ready.

## Read and focus

| Tool                      | Effect                                           |
| ------------------------- | ------------------------------------------------ |
| `get_workspace_summary`   | Bounded counts, scenarios, proposals, version    |
| `search_entities`         | Up to 20 metadata-only search results            |
| `get_dependency_subgraph` | Bounded depth/size read plus visible graph focus |
| `validate_continuity_map` | Deterministic concrete issues                    |
| `simulate_disruption`     | Deterministic cascade, no baseline mutation      |
| `compare_scenarios`       | Before/proposed-after comparison                 |
| `get_recent_activity`     | Up to 50 provenance rows                         |
| `focus_workspace_item`    | Visible focus only                               |

## Draft and proposal

| Tool                       | Effect                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| `create_failure_scenario`  | Saves and runs a structured scenario without changing the baseline |
| `design_failure_scenarios` | Stages 3–5 materially different, idempotent scenario drafts        |
| `propose_delegation`       | Stages fallback coverage for human review                          |
| `propose_schedule_change`  | Stages a date and execution-mode change for human review           |
| `draft_entities`           | Stages 1–20 inferred entities                                      |
| `draft_relationships`      | Stages 1–30 inferred relationships                                 |
| `draft_company_blueprint`  | Stages one contract-checked connected 4–50 item company map        |
| `draft_repair_options`     | Stores 1–3 fully agent-authored, engine-checked repair options     |

Writes require a workspace version; durable writes require an operation-scoped, payload-bound idempotency key. The payload fingerprint is committed inside the same workspace aggregate as the proposal or scenario, so concurrent or later retries return the original result while a same-key/different-payload request returns `409`. Every mutation response returns the authoritative next `workspaceVersion`, including idempotent retries, so the following call does not need to guess whether staging advanced state.

The repair tool requires the agent to supply every option title, rationale, tradeoff, assumption, entity, relationship, and non-empty material update. Each repair needs multiple connected changes spanning at least three graph items; dangling, orphaned, unanchored, duplicated, no-op-update, or still-blocked strategies are rejected. The backend adds no repair content; it only enforces inferred provenance, proves a zero-blocked outcome with the deterministic engine, and stores the reversible draft.

Complete company blueprints only establish an empty baseline. A critical workflow must have a concrete operational dependency, accountable person or team, and recovery/substitute path; the map must also include a recovery mechanism. Duplicate refs or paths, dangling endpoints, self-links, and disconnected components are rejected. `design_failure_scenarios` separately enforces a 3–5 item library with distinct unavailable-item sets, so cosmetic duration or wording changes cannot masquerade as different rehearsals; `create_failure_scenario` remains the explicit single-scenario tool.

`get_workspace_summary` identifies the recommended call sequence, explains baseline/scenario/proposal provenance, and lists the human-only boundaries. Inputs are fixed, bounded JSON schemas. HTTP abort signals propagate from the tool call, and cleanup aborts stale synchronous and asynchronous executions. Responses contain no secrets, image bytes, hidden agent state, or model-derived calculations.

There are deliberately no tools for confirming facts, verifying access, accepting/rejecting changes, assigning final responsibility, closing a rehearsal, finalizing a plan, or deleting a workspace. Those actions remain visible human UI boundaries. A person can adjust staged item names and fallback targets before acceptance; a deterministic recheck refuses repair edits that reopen a blocked workflow.

## Manual path and account controls

Company creation does not depend on an agent. A signed-in user can choose **Add company** → **Build manually**, then use the workspace controls to add/edit items, connect paths, create scenarios, assign fallback coverage, and schedule work. **Add company** → **Create with Site Tools** instead produces an exact prompt for the page-connected agent; copying a prompt does not create anything until the call log shows the native tool executions.

The bottom-left account button opens the account/company menu. A private company can be renamed or archived in **Company settings**, restored from **Archived companies** on the landing page, or permanently deleted through the separately confirmed trash action in the company switcher. None of those human account-management actions are exposed as WebMCP tools.

## Native verification

Use Chrome 149+ or the ChatGPT in-app browser with Site Tools enabled, open Diamond Apps, and inspect the page's Site Tools. Availability depends on the client, account rollout, and selected model; consult the current [official Site Tools documentation](https://learn.chatgpt.com/docs/webmcp) before a judge run. The tools belong to the open top-level page, so closing it or navigating away from the app makes them unavailable.

The product status button reports whether account/workspace registration completed, and its call log records inputs, success/failure, and bounded outputs. An agent message without a corresponding successful call-log entry is not evidence that the app changed. If discovery or execution is unavailable, stop and use the manual path or a supported Site Tools client/model. Do not substitute browser clicking, typing, screenshots, DOM scraping, or computer control.

Automated registry tests use a deterministic model-context test bridge only; they are not described as native execution or model-behavior results. Repair strategies shown in the workspace must originate in the agent's `draft_repair_options` payload; the backend never authors fallback choices.

The recorded local native-host proof is intentionally narrower: the in-app browser discovered all 18 tools and completed the read-only summary, search, subgraph, validation, simulation, activity, and focus sequence without changing the workspace version. Company-blueprint, multi-scenario, and repair writes are covered by real registration callbacks under the deterministic browser bridge plus domain/API tests; they are not claimed as native-host model executions yet.
