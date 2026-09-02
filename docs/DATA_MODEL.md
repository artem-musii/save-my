# Data model

The `Workspace` aggregate owns entities, typed relationships, scenarios, proposals, and activity. Every response includes a workspace version.

## Core types

- **Entity:** person, team, service, vendor, device, document, account, workflow, location, communication channel, or recovery mechanism.
- **Relationship:** depends-on, owned-by, administered-by, accessible-by, recovers-via, blocks, substitutes-for, communicates-through, stored-in, or required-by.
- **Scenario:** bounded unavailable entity IDs, duration, context, creator, and draft state.
- **SimulationResult:** unavailable and blocked IDs, affected edges, ordered depth layers, blocked workflows, the smallest relevant subgraph, and explicit assumptions.
- **Proposal:** base version, rationale, assumptions, reversible changes, creator, and status.
- **ActivityEntry:** actor, action, detail, time, and workspace version.

## Trust states

- `DECLARED`: entered by a human.
- `INFERRED`: staged by an agent.
- `VERIFIED`: explicitly attested by a human.
- `UNKNOWN`: missing information.
- `STALE`: prior attestation invalidated by time or a material edit.
- `DISPUTED`: declarations conflict.

Actual credentials, tokens, keys, recovery codes, card data, and secret values are outside the model. Only continuity metadata such as recovery existence, ownership, verification time, location category, and device/email dependence is allowed.

## Deterministic semantics

Outgoing causal relationships are dependencies of the source entity. Relationships sharing a `group` are alternate paths: the entity is blocked only when every path in a required group is blocked. The engine repeats this rule to a fixed point, records each minimum cascade depth, and then derives blocked workflows and the focused subgraph.

Validation emits concrete issues: single points, missing owners, stale recovery, unknown facts, cycles, and orphans. It intentionally emits no opaque resilience score.
