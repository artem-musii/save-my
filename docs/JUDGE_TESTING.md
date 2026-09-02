# Judge testing

Open the working URL, choose **EXPLORE DEMO**, and wait for **SITE TOOLS · 18 READY**.

If the status does not become ready, open the Site Tool call log and confirm the
client/account/model supports page-defined Site Tools before continuing. Do
not let the agent substitute browser clicking, typing, screenshots, page
scraping, or computer control. The full manual workspace remains testable, but
that is not evidence of a native WebMCP run.

Use this exact prompt:

> Use this page’s Site Tools to review the app studio’s continuity map. Determine what becomes blocked if the founder is unavailable for seven days and their personal phone cannot receive authentication codes. Validate the current map, focus the smallest critical subgraph, and propose the minimum changes needed to preserve product releases and customer support. Do not confirm access, assign responsibility, accept changes, or finalize the continuity plan.

Expected behavior:

- The agent reads versioned structured data.
- The backend returns deterministic validation and simulation results.
- The page visibly focuses the smallest relevant subgraph.
- The repair appears as an INFERRED, reversible proposal.
- Assumptions and unknowns remain explicit.
- The live entity/relationship baseline remains unchanged.
- Acceptance remains available only as a visible human action.

Test account, if desired: `judge@savemy.systems` / `SaveMy-Judge-2026`. Anonymous exploration should be the first impression.

## Complete-company proof

Sign in, create an empty company named **Wow Project**, and ask:

> Use this page's Site Tools to build one connected continuity map for a three-location beauty-salon network. Include accountable people and teams, three salon locations, booking and checkout, opening and closing, same-day staff cover, stock restocking, incident response, payouts, data recovery, the systems and vendors those workflows require, accounts, documents, communication channels, and alternate recovery paths. Stage the complete company blueprint for review. Do not apply or verify it.

Expected behavior:

- `get_workspace_summary` identifies `draft_company_blueprint` as the next action for an empty baseline.
- The tool rejects duplicate refs, dangling endpoints, self-links, duplicate paths, and disconnected components.
- The reviewed Wow Project fixture produces 40 illustrated items, 78 labeled connections, eight critical workflows, 47 path groups, one component, and no isolated refs.
- On a successful native call, the returned result must say the baseline is unchanged and human review is required.
- Repeating the request with the same idempotency key returns the same proposal ID.
- Only **Apply company map** in the visible interface can promote the draft to the baseline.

The same company can also be created directly by the agent with `create_company`; the tool waits for the new workspace registry before returning `draft_company_blueprint` as ready. Re-discover the active page tools after the company opens, then call `get_workspace_summary` before staging the blueprint. A registration timeout returns same-key retry guidance rather than claiming that the blueprint tool is ready. No browser or computer-control fallback is part of this path. After applying the map, `design_failure_scenarios` stages three to five distinct, attributed scenario drafts in one idempotent call.
