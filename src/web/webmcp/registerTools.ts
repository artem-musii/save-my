import {
  entityTypes,
  relationshipTypes,
  trustStates,
  type Entity,
  type Proposal,
  type Scenario,
  type SimulationResult,
  type ValidationResult,
  type Workspace,
} from "../../domain/model";
import { requestJson } from "./requestJson";
import {
  assertWorkspaceVersion,
  objectSchema,
  registerInstrumentedTools,
  type WebMcpCallLog,
} from "./toolRegistry";

export type { WebMcpCallLog } from "./toolRegistry";

export type ProposalCreatedTarget = {
  proposalId?: string;
  scenarioId?: string;
};

type ToolContext = {
  getWorkspace: () => Workspace;
  onFocus: (entityIds: string[]) => void;
  onScenario: (
    scenario: Scenario,
    simulation: SimulationResult,
    persisted: boolean,
  ) => void;
  onProposalCreated: (target?: ProposalCreatedTarget) => void;
  onToolCall?: (entry: WebMcpCallLog) => void;
};

const stringId = { type: "string", minLength: 1, maxLength: 80 };
const version = { type: "integer", minimum: 1 };
const entityType = {
  type: "string",
  enum: [...entityTypes],
};
const relationshipType = {
  type: "string",
  enum: [...relationshipTypes],
};
const agentMetadataSchema = objectSchema({
  recoveryMethodExists: { type: "boolean" },
  secondaryOwner: { type: "string", maxLength: 120 },
  lastVerifiedAt: { type: "string", maxLength: 40 },
  verificationStatus: { type: "string", enum: [...trustStates] },
  storageLocationCategory: { type: "string", maxLength: 120 },
  requiresPersonalDevice: { type: "boolean" },
  requiresPersonalEmail: { type: "boolean" },
  documentationExists: { type: "boolean" },
  note: { type: "string", maxLength: 300 },
  dueAt: { type: "string", maxLength: 40 },
  rescheduleNote: { type: "string", maxLength: 300 },
  effortHours: { type: "number", minimum: 0, maximum: 1_000 },
  executionMode: { type: "string", enum: ["human", "agent", "shared"] },
});
const repairChangeSchema = {
  oneOf: [
    objectSchema(
      {
        op: { const: "add-entity" },
        entity: objectSchema(
          {
            id: stringId,
            name: { type: "string", minLength: 1, maxLength: 120 },
            type: entityType,
            critical: { type: "boolean" },
            description: { type: "string", maxLength: 600 },
            role: { type: "string", maxLength: 120 },
            team: { type: "string", maxLength: 120 },
            metadata: agentMetadataSchema,
          },
          ["id", "name", "type"],
        ),
      },
      ["op", "entity"],
    ),
    objectSchema(
      {
        op: { const: "add-relationship" },
        relationship: objectSchema(
          {
            id: stringId,
            from: stringId,
            to: stringId,
            type: relationshipType,
            group: { type: "string", maxLength: 80 },
            label: { type: "string", maxLength: 120 },
          },
          ["id", "from", "to", "type"],
        ),
      },
      ["op", "relationship"],
    ),
    objectSchema(
      {
        op: { const: "update-entity" },
        entityId: stringId,
        patch: {
          ...objectSchema({
            name: { type: "string", minLength: 1, maxLength: 120 },
            type: entityType,
            critical: { type: "boolean" },
            description: { type: "string", maxLength: 600 },
            role: { type: "string", maxLength: 120 },
            team: { type: "string", maxLength: 120 },
            metadata: agentMetadataSchema,
          }),
          minProperties: 1,
        },
      },
      ["op", "entityId", "patch"],
    ),
  ],
};

const nativeToolFallbackPolicy =
  "If a native Site Tool fails or is unavailable, stop and offer the visible manual path. Do not use browser or computer control as a fallback.";

const withHumanReviewBoundary = <T extends Record<string, unknown>>(
  result: T,
  nextHumanAction: string,
) => {
  assertWorkspaceVersion(result.workspaceVersion, "The Site Tool write");
  return {
    ...result,
    baselineChanged: false,
    humanReviewRequired: true,
    nextHumanAction,
    fallbackPolicy: nativeToolFallbackPolicy,
  };
};

const assertExpectedWorkspaceVersion = (
  actual: unknown,
  expected: unknown,
  source: string,
) => {
  const authoritative = assertWorkspaceVersion(actual, source);
  if (authoritative !== expected)
    throw new Error(
      `Version conflict. Current authoritative workspace version is ${authoritative}. Call get_workspace_summary and retry.`,
    );
  return authoritative;
};

export function registerSaveMyTools(context: ToolContext) {
  const modelContext = document.modelContext;
  if (!modelContext)
    return {
      supported: false,
      cleanup: () => undefined,
      ready: Promise.resolve(),
    };
  const lifecycle = new AbortController();
  const workspaceChanged = () =>
    new DOMException(
      "The active company changed while this Site Tool was running. Call get_workspace_summary and retry against the active company.",
      "AbortError",
    );
  const workspaceApi = async <T>(suffix: string, init: RequestInit = {}) => {
    const startedIn = context.getWorkspace();
    const result = await requestJson<T>(
      `/api/workspaces/${encodeURIComponent(startedIn.slug)}${suffix}`,
      init,
    );
    let active: Workspace;
    try {
      active = context.getWorkspace();
    } catch {
      throw workspaceChanged();
    }
    if (active.id !== startedIn.id || active.slug !== startedIn.slug)
      throw workspaceChanged();
    return result;
  };
  const tools: ModelContextTool[] = [
    {
      name: "get_workspace_summary",
      title: "Get workspace summary",
      description:
        "Call this first. Read the active continuity workspace, authoritative version, concrete counts, scenarios, proposal status, guardrails, and the recommended tool sequence. Does not modify state.",
      inputSchema: objectSchema({}),
      annotations: { readOnlyHint: true },
      execute: async (_input, { signal }) => {
        const { workspace: authoritative } = await workspaceApi<{
          workspace: Workspace;
        }>("", { signal });
        const workspaceVersion = assertWorkspaceVersion(
          authoritative.version,
          "Workspace summary",
        );
        return {
          workspaceId: authoritative.id,
          workspaceVersion,
          name: authoritative.name,
          fictional: authoritative.fictional,
          entityCount: authoritative.entities.length,
          relationshipCount: authoritative.relationships.length,
          criticalWorkflowCount: authoritative.entities.filter(
            (e) => e.type === "workflow" && e.critical,
          ).length,
          scenarioCount: authoritative.scenarios.length,
          scenarios: authoritative.scenarios
            .slice(0, 20)
            .map(
              ({
                id,
                name,
                unavailableEntityIds,
                durationDays,
                resolution,
              }) => ({
                id,
                name,
                unavailableEntityIds,
                durationDays,
                resolution,
              }),
            ),
          proposalCount: authoritative.proposals.length,
          proposals: authoritative.proposals
            .slice(0, 20)
            .map(
              ({
                id,
                title,
                status,
                baseVersion,
                kind,
                scenarioId,
                optionLabel,
                strategy,
                tradeoff,
              }) => ({
                id,
                title,
                status,
                baseVersion,
                kind,
                scenarioId,
                optionLabel,
                strategy,
                tradeoff,
              }),
            ),
          stateModel: {
            baseline:
              "Human-entered company facts. VERIFIED is attested; DECLARED is entered but unverified; UNKNOWN and STALE need review.",
            scenario:
              "A deterministic temporary disruption calculated from unavailable entity IDs and relationship path groups. It never edits the baseline.",
            proposal:
              "An agent-staged reversible draft. INFERRED changes remain separate until a human applies or rejects them in the UI.",
          },
          recommendedNextAction:
            authoritative.entities.length === 0
              ? {
                  tool: "draft_company_blueprint",
                  reason:
                    "The baseline is empty. Stage one connected company map for human review before simulating disruption.",
                }
              : {
                  tool: "search_entities",
                  reason:
                    "Resolve exact IDs before focusing, simulating, delegating, or scheduling.",
                },
          suggestedToolSequence:
            authoritative.entities.length === 0
              ? [
                  "get_workspace_summary",
                  "draft_company_blueprint",
                  "wait for visible human review and application",
                  "get_workspace_summary after the baseline changes",
                ]
              : [
                  "get_workspace_summary",
                  "search_entities",
                  "simulate_disruption",
                  "design_failure_scenarios to stage three to five evidence-based rehearsals",
                  "draft_repair_options with agent-authored strategies and changes",
                  "compare_scenarios using the workspaceVersion returned by the proposal call",
                ],
          humanOnlyActions: [
            "Apply or reject a proposal",
            "Verify access or evidence",
            "Confirm final responsibility",
            "Archive a company",
          ],
        };
      },
    },
    {
      name: "search_entities",
      title: "Search map entities",
      description:
        "Search active workspace entities by name, type, or description. Returns at most 20 metadata-only results.",
      inputSchema: objectSchema(
        { query: { type: "string", minLength: 1, maxLength: 120 } },
        ["query"],
      ),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async ({ query }, { signal }) => {
        const result = await workspaceApi<{
          workspaceVersion: number;
          entities: Entity[];
        }>(`/search?q=${encodeURIComponent(String(query))}`, {
          signal,
        });
        assertWorkspaceVersion(result.workspaceVersion, "Entity search");
        return result;
      },
    },
    {
      name: "get_dependency_subgraph",
      title: "Get dependency subgraph",
      description:
        "Read a bounded subgraph from the currently rendered workspace snapshot around up to eight entity IDs, then visibly focus those items. Use get_workspace_summary first when authoritative freshness matters.",
      inputSchema: objectSchema(
        {
          entityIds: {
            type: "array",
            items: stringId,
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
          },
          maxDepth: { type: "integer", minimum: 1, maximum: 3, default: 2 },
        },
        ["entityIds"],
      ),
      execute: async ({ entityIds, maxDepth = 2 }) => {
        const workspace = context.getWorkspace();
        assertWorkspaceVersion(workspace.version, "Dependency subgraph");
        const ids = new Set((entityIds as string[]).slice(0, 8));
        for (let depth = 0; depth < Number(maxDepth); depth += 1) {
          for (const relationship of workspace.relationships)
            if (ids.has(relationship.from) || ids.has(relationship.to)) {
              ids.add(relationship.from);
              ids.add(relationship.to);
            }
        }
        const selected = [...ids].slice(0, 40);
        const selectedIds = new Set(selected);
        context.onFocus(selected);
        return {
          workspaceVersion: workspace.version,
          entities: workspace.entities.filter((entity) =>
            selectedIds.has(entity.id),
          ),
          relationships: workspace.relationships.filter(
            (relationship) =>
              selectedIds.has(relationship.from) &&
              selectedIds.has(relationship.to),
          ),
          visibleFocusApplied: true,
          stateSource: "current-rendered-workspace",
        };
      },
    },
    {
      name: "validate_continuity_map",
      title: "Validate continuity map",
      description:
        "Run deterministic continuity validation. Reports single points, missing owners, stale paths, unknowns, cycles, and orphan nodes. Does not calculate an opaque score.",
      inputSchema: objectSchema({ expectedWorkspaceVersion: version }, [
        "expectedWorkspaceVersion",
      ]),
      annotations: { readOnlyHint: true },
      execute: async ({ expectedWorkspaceVersion }, { signal }) => {
        const result = await workspaceApi<ValidationResult>(
          `/validate?expectedWorkspaceVersion=${encodeURIComponent(String(expectedWorkspaceVersion))}`,
          { signal },
        );
        assertExpectedWorkspaceVersion(
          result.workspaceVersion,
          expectedWorkspaceVersion,
          "Continuity validation",
        );
        return result;
      },
    },
    {
      name: "simulate_disruption",
      title: "Simulate disruption",
      description:
        "After resolving exact IDs with search_entities, run a deterministic failure cascade against the current baseline. Returns impacted and blocked IDs, updates the visible graph, does not use an LLM, and does not mutate the workspace.",
      inputSchema: objectSchema(
        {
          name: { type: "string", minLength: 1, maxLength: 120 },
          unavailableEntityIds: {
            type: "array",
            items: stringId,
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
          },
          durationDays: { type: "integer", minimum: 1, maximum: 30 },
          context: { type: "string", maxLength: 500 },
          workspaceVersion: version,
        },
        ["name", "unavailableEntityIds", "durationDays", "workspaceVersion"],
      ),
      execute: async (input, { signal }) => {
        const result = await workspaceApi<{
          scenario: Scenario;
          simulation: SimulationResult;
        }>("/simulate", {
          method: "POST",
          signal,
          body: JSON.stringify(input),
        });
        context.onScenario(result.scenario, result.simulation, false);
        context.onFocus(result.simulation.smallestRelevantEntityIds);
        const workspaceVersion = assertExpectedWorkspaceVersion(
          result.simulation.workspaceVersion,
          input.workspaceVersion,
          "Disruption simulation",
        );
        return {
          ...result,
          workspaceVersion,
          baselineChanged: false,
        };
      },
    },
    {
      name: "propose_delegation",
      title: "Propose fallback delegation",
      description:
        "Stage a fallback person and optional responsibility assignment for human review. Never changes ownership directly. Reuse one idempotency key only for an exact retry; use a new key when the payload changes.",
      inputSchema: objectSchema(
        {
          workspaceVersion: version,
          idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
          primaryPersonId: stringId,
          fallbackPersonId: stringId,
          responsibilityId: stringId,
          note: { type: "string", maxLength: 300 },
        },
        [
          "workspaceVersion",
          "idempotencyKey",
          "primaryPersonId",
          "fallbackPersonId",
        ],
      ),
      execute: async (input, { signal }) => {
        const result = await workspaceApi<Record<string, unknown>>(
          "/draft/delegation",
          {
            method: "POST",
            signal,
            body: JSON.stringify(input),
          },
        );
        context.onProposalCreated();
        return withHumanReviewBoundary(
          result,
          "Review the staged fallback delegation in the visible proposal UI, then apply or discard it manually.",
        );
      },
    },
    {
      name: "propose_schedule_change",
      title: "Propose schedule change",
      description:
        "Stage a reviewable due-date and execution-mode change for one item. Never reschedules the baseline directly. Reuse one idempotency key only for an exact retry; use a new key when the payload changes.",
      inputSchema: objectSchema(
        {
          workspaceVersion: version,
          idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
          entityId: stringId,
          dueAt: { type: "string", minLength: 1, maxLength: 40 },
          note: { type: "string", maxLength: 300 },
          executionMode: {
            type: "string",
            enum: ["human", "agent", "shared"],
          },
        },
        ["workspaceVersion", "idempotencyKey", "entityId", "dueAt"],
      ),
      execute: async (input, { signal }) => {
        const result = await workspaceApi<Record<string, unknown>>(
          "/draft/schedule",
          {
            method: "POST",
            signal,
            body: JSON.stringify(input),
          },
        );
        context.onProposalCreated();
        return withHumanReviewBoundary(
          result,
          "Review the staged schedule change in the visible proposal UI, then apply or discard it manually.",
        );
      },
    },
    {
      name: "compare_scenarios",
      title: "Compare scenario and repair",
      description:
        "Compare deterministic before and proposed-after results for one scenario and one reversible proposal. Baseline remains unchanged.",
      inputSchema: objectSchema(
        {
          scenarioId: stringId,
          proposalId: stringId,
          workspaceVersion: version,
        },
        ["scenarioId", "proposalId", "workspaceVersion"],
      ),
      annotations: { readOnlyHint: true },
      execute: async (
        { scenarioId, proposalId, workspaceVersion },
        { signal },
      ) => {
        const result = await workspaceApi<{
          workspaceVersion: number;
          before: SimulationResult;
          after: SimulationResult;
          restoredEntityIds: string[];
          restoredWorkflowIds: string[];
        }>(
          `/proposals/${proposalId}/compare?scenarioId=${encodeURIComponent(String(scenarioId))}&expectedWorkspaceVersion=${encodeURIComponent(String(workspaceVersion))}`,
          { signal },
        );
        assertExpectedWorkspaceVersion(
          result.workspaceVersion,
          workspaceVersion,
          "Scenario comparison",
        );
        assertExpectedWorkspaceVersion(
          result.after.workspaceVersion,
          workspaceVersion,
          "Scenario comparison",
        );
        return result;
      },
    },
    {
      name: "get_recent_activity",
      title: "Get recent activity",
      description:
        "Read up to 50 recent provenance entries with actor, time, action, and workspace version.",
      inputSchema: objectSchema({
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      }),
      annotations: { readOnlyHint: true },
      execute: async ({ limit = 20 }, { signal }) => {
        const result = await workspaceApi<{
          workspaceVersion: number;
          activity: unknown[];
        }>(`/activity?limit=${Number(limit)}`, { signal });
        assertWorkspaceVersion(result.workspaceVersion, "Recent activity");
        return result;
      },
    },
    {
      name: "focus_workspace_item",
      title: "Focus workspace item",
      description:
        "Visibly focus up to eight existing entities from the currently rendered workspace snapshot. This changes only the current view, not organization data.",
      inputSchema: objectSchema(
        {
          entityIds: {
            type: "array",
            items: stringId,
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
          },
        },
        ["entityIds"],
      ),
      execute: async ({ entityIds }) => {
        const workspace = context.getWorkspace();
        assertWorkspaceVersion(workspace.version, "Workspace focus");
        const ids = (entityIds as string[]).filter((id) =>
          workspace.entities.some((entity) => entity.id === id),
        );
        context.onFocus(ids);
        return {
          focusedEntityIds: ids,
          workspaceVersion: workspace.version,
          stateSource: "current-rendered-workspace",
        };
      },
    },
    {
      name: "create_failure_scenario",
      title: "Create failure scenario draft",
      description:
        "After a useful simulation, idempotently stage and visibly run one agent-authored scenario draft. Prefer design_failure_scenarios when the user asks for a scenario library. The deterministic result never changes baseline entities or marks a rehearsal successful. Reuse one idempotency key only for an exact retry; use a new key when the scenario changes.",
      inputSchema: objectSchema(
        {
          name: { type: "string", minLength: 1, maxLength: 120 },
          unavailableEntityIds: {
            type: "array",
            items: stringId,
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
          },
          durationDays: { type: "integer", minimum: 1, maximum: 30 },
          context: { type: "string", minLength: 1, maxLength: 500 },
          workspaceVersion: version,
          idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
        },
        [
          "name",
          "unavailableEntityIds",
          "durationDays",
          "context",
          "workspaceVersion",
          "idempotencyKey",
        ],
      ),
      execute: async (input, { signal }) => {
        const {
          workspaceVersion,
          idempotencyKey,
          name,
          unavailableEntityIds,
          durationDays,
          context: scenarioContext = "",
        } = input;
        const staged = await workspaceApi<{
          scenarios: Scenario[];
          simulations: SimulationResult[];
          workspaceVersion: number;
        }>("/draft/scenario", {
          method: "POST",
          signal,
          body: JSON.stringify({
            workspaceVersion,
            idempotencyKey,
            scenario: {
              name,
              unavailableEntityIds,
              durationDays,
              context: scenarioContext,
            },
          }),
        });
        const scenario = staged.scenarios[0];
        const simulation = staged.simulations[0];
        if (!scenario || !simulation)
          throw new Error("Scenario draft was not returned.");
        context.onScenario(scenario, simulation, true);
        context.onFocus(simulation.smallestRelevantEntityIds);
        return withHumanReviewBoundary(
          {
            scenario,
            simulation,
            workspaceVersion: staged.workspaceVersion,
          },
          "Review the saved scenario draft and its deterministic impact in the visible UI.",
        );
      },
    },
    {
      name: "design_failure_scenarios",
      title: "Design disruption scenario drafts",
      description:
        "Design and store three to five materially different disruption scenarios from exact IDs in the active company graph. Every scenario must use a distinct unavailable-item set; changing only duration, name, or wording is not a different rehearsal. Use search_entities and simulate_disruption first. Cover distinct operational risks, combine multiple unavailable items when evidence supports a compound failure, and state what must continue in each context. The scenarios are agent-authored drafts, remain separate from the baseline, and are idempotent as one set. Reuse one idempotency key only for an exact retry of that set; use a new key when any scenario changes. Use create_failure_scenario only when the user explicitly wants a single scenario. Do not use browser or computer control to create scenario cards.",
      inputSchema: objectSchema(
        {
          workspaceVersion: version,
          idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
          scenarios: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            items: objectSchema(
              {
                name: { type: "string", minLength: 1, maxLength: 120 },
                unavailableEntityIds: {
                  type: "array",
                  items: stringId,
                  minItems: 1,
                  maxItems: 8,
                  uniqueItems: true,
                },
                durationDays: {
                  type: "integer",
                  minimum: 1,
                  maximum: 30,
                },
                context: { type: "string", minLength: 1, maxLength: 500 },
              },
              ["name", "unavailableEntityIds", "durationDays", "context"],
            ),
          },
        },
        ["workspaceVersion", "idempotencyKey", "scenarios"],
      ),
      execute: async (input, { signal }) => {
        const result = await workspaceApi<{
          scenarios: Scenario[];
          simulations: SimulationResult[];
          workspaceVersion: number;
          baselineChanged: boolean;
          humanReviewRequired: boolean;
        }>("/draft/scenarios", {
          method: "POST",
          signal,
          body: JSON.stringify(input),
        });
        const firstScenario = result.scenarios[0];
        const firstSimulation = result.simulations[0];
        if (firstScenario && firstSimulation) {
          context.onScenario(firstScenario, firstSimulation, true);
          context.onFocus(firstSimulation.smallestRelevantEntityIds);
        }
        return withHumanReviewBoundary(
          result,
          "Review the three to five saved scenario drafts and their deterministic impacts in the visible UI.",
        );
      },
    },
    {
      name: "draft_company_blueprint",
      title: "Draft a complete company map",
      description:
        "Turn a detailed company description into one coherent, reversible continuity-map proposal for an empty company, with 4 to 50 richly described items and 3 to 100 connections. Use unique stable short refs inside this call and connect every item into one map; duplicate, dangling, self, disconnected, and semantically incomplete drafts are rejected. Include at least one critical workflow, responsible person or team, operational dependency, recovery mechanism, ownership or access path, and recovery or substitute path. Expand with locations, vendors, documents, accounts, and channels as relevant. The human reviews the complete graph before anything enters the baseline. Reuse one idempotency key only for an exact retry; use a new key when the payload changes.",
      inputSchema: objectSchema(
        {
          workspaceVersion: version,
          idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
          companyName: { type: "string", minLength: 2, maxLength: 120 },
          companySummary: { type: "string", minLength: 20, maxLength: 1200 },
          entities: {
            type: "array",
            minItems: 4,
            maxItems: 50,
            items: objectSchema(
              {
                ref: { type: "string", minLength: 1, maxLength: 60 },
                name: { type: "string", minLength: 1, maxLength: 120 },
                type: {
                  type: "string",
                  enum: [
                    "person",
                    "team",
                    "service",
                    "vendor",
                    "device",
                    "document",
                    "account",
                    "workflow",
                    "location",
                    "communication-channel",
                    "recovery-mechanism",
                  ],
                },
                description: { type: "string", minLength: 1, maxLength: 500 },
                role: { type: "string", maxLength: 120 },
                team: { type: "string", maxLength: 120 },
                critical: { type: "boolean" },
              },
              ["ref", "name", "type", "description", "critical"],
            ),
          },
          relationships: {
            type: "array",
            minItems: 3,
            maxItems: 100,
            items: objectSchema(
              {
                fromRef: { type: "string", minLength: 1, maxLength: 60 },
                toRef: { type: "string", minLength: 1, maxLength: 60 },
                type: {
                  type: "string",
                  enum: [
                    "depends-on",
                    "owned-by",
                    "administered-by",
                    "accessible-by",
                    "recovers-via",
                    "blocks",
                    "substitutes-for",
                    "communicates-through",
                    "stored-in",
                    "required-by",
                  ],
                },
                group: { type: "string", maxLength: 80 },
                label: { type: "string", maxLength: 120 },
              },
              ["fromRef", "toRef", "type"],
            ),
          },
        },
        [
          "workspaceVersion",
          "idempotencyKey",
          "companyName",
          "companySummary",
          "entities",
          "relationships",
        ],
      ),
      execute: async (input, { signal }) => {
        const result = await workspaceApi<{
          proposal: Proposal;
          workspaceVersion: number;
          blueprintReview: Record<string, unknown> & {
            baselineChanged: boolean;
            humanReviewRequired: boolean;
          };
        }>("/draft/company-blueprint", {
          method: "POST",
          signal,
          body: JSON.stringify(input),
        });
        context.onProposalCreated({ proposalId: result.proposal.id });
        return withHumanReviewBoundary(
          {
            proposalId: result.proposal.id,
            proposalTitle: result.proposal.title,
            proposedChangeCount: result.proposal.changes.length,
            workspaceVersion: result.workspaceVersion,
            blueprintReview: result.blueprintReview,
          },
          "Review the complete proposed graph in Before/After, then apply or discard it in the visible UI.",
        );
      },
    },
    {
      name: "draft_entities",
      title: "Draft map entities",
      description:
        "Stage 1 to 20 inferred entities as a reversible proposal. Never confirms, verifies, or directly changes the live graph. Reuse one idempotency key only for an exact retry; use a new key when the payload changes.",
      inputSchema: objectSchema(
        {
          workspaceVersion: version,
          idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
          entities: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: objectSchema(
              {
                name: { type: "string", minLength: 1, maxLength: 120 },
                type: {
                  type: "string",
                  enum: [
                    "person",
                    "team",
                    "service",
                    "vendor",
                    "device",
                    "document",
                    "account",
                    "workflow",
                    "location",
                    "communication-channel",
                    "recovery-mechanism",
                  ],
                },
                description: { type: "string", maxLength: 300 },
              },
              ["name", "type"],
            ),
          },
        },
        ["workspaceVersion", "idempotencyKey", "entities"],
      ),
      execute: async (input, { signal }) => {
        const result = await workspaceApi<Record<string, unknown>>(
          "/draft/entities",
          {
            method: "POST",
            signal,
            body: JSON.stringify(input),
          },
        );
        context.onProposalCreated();
        return withHumanReviewBoundary(
          result,
          "Review every inferred item in the visible proposal UI, then apply or discard the proposal manually.",
        );
      },
    },
    {
      name: "draft_relationships",
      title: "Draft map relationships",
      description:
        "Stage 1 to 30 inferred relationships as a reversible proposal. Never confirms or changes the live graph. Reuse one idempotency key only for an exact retry; use a new key when the payload changes.",
      inputSchema: objectSchema(
        {
          workspaceVersion: version,
          idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
          relationships: {
            type: "array",
            minItems: 1,
            maxItems: 30,
            items: objectSchema(
              {
                from: stringId,
                to: stringId,
                type: {
                  type: "string",
                  enum: [
                    "depends-on",
                    "owned-by",
                    "administered-by",
                    "accessible-by",
                    "recovers-via",
                    "blocks",
                    "substitutes-for",
                    "communicates-through",
                    "stored-in",
                    "required-by",
                  ],
                },
                group: { type: "string", maxLength: 80 },
                label: { type: "string", maxLength: 120 },
              },
              ["from", "to", "type"],
            ),
          },
        },
        ["workspaceVersion", "idempotencyKey", "relationships"],
      ),
      execute: async (input, { signal }) => {
        const result = await workspaceApi<Record<string, unknown>>(
          "/draft/relationships",
          {
            method: "POST",
            signal,
            body: JSON.stringify(input),
          },
        );
        context.onProposalCreated();
        return withHumanReviewBoundary(
          result,
          "Review every inferred connection in the visible proposal UI, then apply or discard the proposal manually.",
        );
      },
    },
    {
      name: "draft_repair_options",
      title: "Draft agent-authored repair options",
      description:
        "Stage one to three materially different, complete repair options authored entirely by the agent. Each option must contain at least two coherent graph changes spanning at least three items and must restore every blocked critical workflow. When a strategy introduces a new owner, custodian, account, document, device, or recovery mechanism, add that entity and explicitly connect it to the existing graph with one or more relationships; never reference an invented endpoint only from a relationship. Supply every title, rationale, tradeoff, assumption, entity, relationship, and update explicitly. The backend rejects dangling, duplicate, self, orphaned, unanchored, repeated-strategy, or incomplete change sets, enforces INFERRED provenance, and stores reversible drafts for visible human review. Reuse one idempotency key only for an exact retry of the entire option set; use a new key when any option changes.",
      inputSchema: objectSchema(
        {
          scenarioId: stringId,
          workspaceVersion: version,
          idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
          options: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: objectSchema(
              {
                optionLabel: { type: "string", minLength: 1, maxLength: 8 },
                title: { type: "string", minLength: 1, maxLength: 120 },
                rationale: { type: "string", minLength: 1, maxLength: 600 },
                assumptions: {
                  type: "array",
                  maxItems: 12,
                  items: { type: "string", minLength: 1, maxLength: 300 },
                },
                tradeoff: objectSchema(
                  {
                    effort: {
                      type: "string",
                      enum: ["LOW", "MEDIUM", "HIGH"],
                    },
                    timeToRestoreHours: {
                      type: "number",
                      minimum: 0,
                      maximum: 10_000,
                    },
                    residualRisk: {
                      type: "string",
                      enum: ["LOW", "MEDIUM", "HIGH"],
                    },
                    summary: {
                      type: "string",
                      minLength: 1,
                      maxLength: 300,
                    },
                  },
                  ["effort", "timeToRestoreHours", "residualRisk", "summary"],
                ),
                changes: {
                  type: "array",
                  minItems: 2,
                  maxItems: 100,
                  items: repairChangeSchema,
                },
              },
              [
                "optionLabel",
                "title",
                "rationale",
                "assumptions",
                "tradeoff",
                "changes",
              ],
            ),
          },
        },
        ["scenarioId", "workspaceVersion", "idempotencyKey", "options"],
      ),
      execute: async (input, { signal }) => {
        const result = await workspaceApi<{
          proposals: Proposal[];
          workspaceVersion: number;
        }>("/draft/repair-options", {
          method: "POST",
          signal,
          body: JSON.stringify(input),
        });
        const firstProposal = result.proposals[0];
        context.onProposalCreated(
          firstProposal
            ? {
                proposalId: firstProposal.id,
                ...(firstProposal.scenarioId
                  ? { scenarioId: firstProposal.scenarioId }
                  : {}),
              }
            : undefined,
        );
        return withHumanReviewBoundary(
          result,
          "Compare and review every repair option in Before/After, then manually apply one option or discard the drafts.",
        );
      },
    },
  ];
  const ready = registerInstrumentedTools(
    modelContext,
    tools,
    lifecycle,
    context.onToolCall,
  );
  return { supported: true, cleanup: () => lifecycle.abort(), ready };
}
