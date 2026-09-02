import { describe, expect, test } from "bun:test";
import { demoWorkspaces } from "../../infrastructure/demoWorkspaces";
import {
  registerSaveMyTools,
  type ProposalCreatedTarget,
  type WebMcpCallLog,
} from "./registerTools";

type RegisteredToolDefinition = ModelContextTool;

describe("WebMCP registry", () => {
  test("reports unsupported without running any workspace handler", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {},
    });
    let focusCount = 0;
    const registry = registerSaveMyTools({
      getWorkspace: () => structuredClone(demoWorkspaces[0]),
      onFocus: () => {
        focusCount += 1;
      },
      onScenario: () => {},
      onProposalCreated: () => {},
    });
    expect(registry.supported).toBeFalse();
    await registry.ready;
    registry.cleanup();
    expect(focusCount).toBe(0);
  });

  test("registers narrow tools and excludes human-only actions", async () => {
    const tools: RegisteredToolDefinition[] = [];
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        modelContext: {
          registerTool: async (tool: RegisteredToolDefinition) => {
            tools.push(tool);
          },
        },
      },
    });
    const workspace = structuredClone(demoWorkspaces[0]);
    const callLog: WebMcpCallLog[] = [];
    const registry = registerSaveMyTools({
      getWorkspace: () => workspace,
      onFocus: () => {},
      onScenario: () => {},
      onProposalCreated: () => {},
      onToolCall: (entry) => callLog.push(entry),
    });
    await registry.ready;
    expect(tools).toHaveLength(16);
    expect(tools.map((tool) => tool.name)).toContain("simulate_disruption");
    expect(tools.map((tool) => tool.name)).toContain("draft_repair_options");
    expect(tools.map((tool) => tool.name)).toContain(
      "design_failure_scenarios",
    );
    expect(tools.map((tool) => tool.name)).not.toContain(
      "propose_complete_repair_options",
    );
    expect(tools.map((tool) => tool.name)).not.toContain(
      "propose_continuity_changes",
    );
    expect(tools.map((tool) => tool.name)).toContain("draft_company_blueprint");
    expect(
      tools.some((tool) => /accept|verify|delete|finalize/.test(tool.name)),
    ).toBeFalse();
    expect(
      tools.every((tool) => tool.inputSchema?.additionalProperties === false),
    ).toBeTrue();
    expect(
      tools.every((tool) => tool.annotations?.untrustedContentHint === true),
    ).toBeTrue();
    expect(
      tools
        .filter((tool) => tool.annotations?.readOnlyHint)
        .map((tool) => tool.name),
    ).toEqual([
      "get_workspace_summary",
      "search_entities",
      "validate_continuity_map",
      "compare_scenarios",
      "get_recent_activity",
    ]);
    const scenarioDesigner = tools.find(
      (tool) => tool.name === "design_failure_scenarios",
    )!;
    expect(
      (
        scenarioDesigner.inputSchema?.properties as Record<
          string,
          Record<string, unknown>
        >
      ).scenarios?.minItems,
    ).toBe(3);
    const singleScenario = tools.find(
      (tool) => tool.name === "create_failure_scenario",
    )!;
    expect(singleScenario.inputSchema?.required).toContain("context");
    expect(
      (
        singleScenario.inputSchema?.properties as Record<
          string,
          Record<string, unknown>
        >
      ).context?.minLength,
    ).toBe(1);
    const blueprint = tools.find(
      (tool) => tool.name === "draft_company_blueprint",
    )!;
    const blueprintProperties = blueprint.inputSchema?.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(blueprintProperties.entities?.minItems).toBe(4);
    expect(blueprintProperties.relationships?.minItems).toBe(3);
    const repair = tools.find((tool) => tool.name === "draft_repair_options")!;
    const repairProperties = repair.inputSchema?.properties as Record<
      string,
      Record<string, unknown>
    >;
    const repairOption = repairProperties.options!.items as Record<
      string,
      unknown
    >;
    const repairOptionProperties = repairOption.properties as Record<
      string,
      Record<string, unknown>
    >;
    const repairChanges = repairOptionProperties.changes!.items as Record<
      string,
      unknown
    >;
    const updateChange = (
      repairChanges.oneOf as Array<Record<string, unknown>>
    ).at(2)!;
    const updateProperties = updateChange.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(updateProperties.patch!.minProperties).toBe(1);
    const addEntity = (
      repairChanges.oneOf as Array<Record<string, unknown>>
    ).at(0)!;
    const addEntityProperties = addEntity.properties as Record<
      string,
      Record<string, unknown>
    >;
    const entityProperties = addEntityProperties.entity!.properties as Record<
      string,
      Record<string, unknown>
    >;
    const metadataProperties = entityProperties.metadata!.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(metadataProperties)).toEqual([
      "recoveryMethodExists",
      "secondaryOwner",
      "lastVerifiedAt",
      "verificationStatus",
      "storageLocationCategory",
      "requiresPersonalDevice",
      "requiresPersonalEmail",
      "documentationExists",
      "note",
      "dueAt",
      "rescheduleNote",
      "effortHours",
      "executionMode",
    ]);
    expect(metadataProperties.verificationStatus!.enum).toContain("STALE");
    const patchProperties = updateProperties.patch!.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(patchProperties.metadata!.additionalProperties).toBeFalse();
    for (const name of ["get_dependency_subgraph", "focus_workspace_item"])
      expect(tools.find((tool) => tool.name === name)?.description).toContain(
        "currently rendered workspace snapshot",
      );
    for (const name of [
      "propose_delegation",
      "propose_schedule_change",
      "create_failure_scenario",
      "design_failure_scenarios",
      "draft_company_blueprint",
      "draft_entities",
      "draft_relationships",
      "draft_repair_options",
    ])
      expect(tools.find((tool) => tool.name === name)?.description).toContain(
        "idempotency key",
      );
    const summary = tools.find(
      (tool) => tool.name === "get_workspace_summary",
    )!;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ workspace }), {
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    let summaryResult!: {
      suggestedToolSequence: string[];
      humanOnlyActions: string[];
      stateModel: Record<string, string>;
    };
    try {
      summaryResult = (await summary.execute!({}, {
        signal: new AbortController().signal,
      } as never)) as typeof summaryResult;
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(summaryResult.suggestedToolSequence[0]).toBe(
      "get_workspace_summary",
    );
    expect(summaryResult.humanOnlyActions).toContain(
      "Apply or reject a proposal",
    );
    expect(summaryResult.stateModel.scenario).toContain("deterministic");
    expect(callLog.map((entry) => entry.status)).toEqual([
      "running",
      "succeeded",
    ]);
    expect(callLog[1]?.name).toBe("get_workspace_summary");
    expect(callLog[1]?.output).toContain('"workspaceVersion"');
    registry.cleanup();
  });

  test("directs an agent to one complete blueprint when the baseline is empty", async () => {
    const tools: RegisteredToolDefinition[] = [];
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        modelContext: {
          registerTool: async (tool: RegisteredToolDefinition) => {
            tools.push(tool);
          },
        },
      },
    });
    const workspace = {
      ...structuredClone(demoWorkspaces[0]),
      id: "empty-company",
      slug: "empty-company",
      name: "Empty company",
      fictional: false,
      sector: "custom" as const,
      entities: [],
      relationships: [],
      scenarios: [],
      proposals: [],
    };
    const registry = registerSaveMyTools({
      getWorkspace: () => workspace,
      onFocus: () => {},
      onScenario: () => {},
      onProposalCreated: () => {},
    });
    await registry.ready;
    const summary = tools.find(
      (tool) => tool.name === "get_workspace_summary",
    )!;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ workspace }), {
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    let result!: {
      recommendedNextAction: { tool: string; reason: string };
      suggestedToolSequence: string[];
    };
    try {
      result = (await summary.execute!({}, {
        signal: new AbortController().signal,
      } as never)) as typeof result;
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(result.recommendedNextAction.tool).toBe("draft_company_blueprint");
    expect(result.recommendedNextAction.reason).toContain("baseline is empty");
    expect(result.suggestedToolSequence[1]).toBe("draft_company_blueprint");
    registry.cleanup();
  });

  test("executes every workspace handler and returns review-safe write results", async () => {
    const tools: RegisteredToolDefinition[] = [];
    const callLog: WebMcpCallLog[] = [];
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        modelContext: {
          registerTool: async (tool: RegisteredToolDefinition) => {
            tools.push(tool);
          },
        },
      },
    });
    const workspace = structuredClone(demoWorkspaces[0]);
    const entityIds = workspace.entities.slice(0, 3).map(({ id }) => id);
    const scenario = {
      id: "scenario-runtime",
      name: "Runtime outage",
      unavailableEntityIds: [entityIds[0]!],
      durationDays: 1,
      context: "Keep critical work operating.",
      createdBy: "agent",
      draft: true,
    };
    const simulation = {
      workspaceVersion: workspace.version,
      smallestRelevantEntityIds: entityIds,
      impactedEntityIds: entityIds,
      blockedWorkflowIds: [entityIds[1]!],
    };
    const proposal = {
      id: "proposal-runtime",
      title: "Runtime proposal",
      status: "PROPOSED",
      changes: [],
      scenarioId: scenario.id,
    };
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith(`/api/workspaces/${workspace.slug}`))
        return json({ workspace });
      if (url.includes("/search?"))
        return json({ workspaceVersion: workspace.version, entities: [] });
      if (url.includes("/validate?"))
        return json({
          workspaceVersion: workspace.version,
          issues: [],
          counts: {},
        });
      if (url.endsWith("/simulate")) return json({ scenario, simulation });
      if (url.endsWith("/draft/delegation"))
        return json({ proposal, workspaceVersion: workspace.version + 1 }, 201);
      if (url.endsWith("/draft/schedule"))
        return json({ proposal, workspaceVersion: workspace.version + 1 }, 201);
      if (url.includes("/proposals/") && url.includes("/compare?"))
        return json({
          workspaceVersion: workspace.version,
          before: simulation,
          after: simulation,
          restoredEntityIds: [],
          restoredWorkflowIds: [],
        });
      if (url.includes("/activity?"))
        return json({ workspaceVersion: workspace.version, activity: [] });
      if (url.endsWith("/draft/scenarios"))
        return json({
          scenarios: [scenario, scenario, scenario],
          simulations: [simulation, simulation, simulation],
          workspaceVersion: workspace.version + 1,
          baselineChanged: false,
          humanReviewRequired: true,
        });
      if (url.endsWith("/draft/scenario"))
        return json({
          scenarios: [scenario],
          simulations: [simulation],
          workspaceVersion: workspace.version + 1,
        });
      if (url.endsWith("/draft/company-blueprint"))
        return json(
          {
            proposal,
            workspaceVersion: workspace.version + 1,
            blueprintReview: {
              baselineChanged: false,
              humanReviewRequired: true,
            },
          },
          201,
        );
      if (url.endsWith("/draft/entities"))
        return json({ proposal, workspaceVersion: workspace.version + 1 }, 201);
      if (url.endsWith("/draft/relationships"))
        return json({ proposal, workspaceVersion: workspace.version + 1 }, 201);
      if (url.endsWith("/draft/repair-options"))
        return json(
          { proposals: [proposal], workspaceVersion: workspace.version + 1 },
          201,
        );
      throw new Error(`Unhandled runtime tool URL: ${url}`);
    }) as unknown as typeof fetch;

    try {
      const registry = registerSaveMyTools({
        getWorkspace: () => workspace,
        onFocus: () => {},
        onScenario: () => {},
        onProposalCreated: () => {},
        onToolCall: (entry) => callLog.push(entry),
      });
      await registry.ready;
      const run = (name: string, input: Record<string, unknown>) =>
        tools
          .find((tool) => tool.name === name)!
          .execute(input, { signal: new AbortController().signal });
      const version = workspace.version;
      await run("get_workspace_summary", {});
      await run("search_entities", { query: "finance" });
      await run("get_dependency_subgraph", {
        entityIds: [entityIds[0]],
        maxDepth: 1,
      });
      await run("validate_continuity_map", {
        expectedWorkspaceVersion: version,
      });
      await run("simulate_disruption", {
        name: scenario.name,
        unavailableEntityIds: scenario.unavailableEntityIds,
        durationDays: scenario.durationDays,
        context: scenario.context,
        workspaceVersion: version,
      });
      const writeResults = new Map<string, Record<string, unknown>>();
      writeResults.set(
        "propose_delegation",
        (await run("propose_delegation", {
          workspaceVersion: version,
          idempotencyKey: "runtime-delegation-v1",
          primaryPersonId: entityIds[0],
          fallbackPersonId: entityIds[1],
          responsibilityId: entityIds[2],
        })) as Record<string, unknown>,
      );
      writeResults.set(
        "propose_schedule_change",
        (await run("propose_schedule_change", {
          workspaceVersion: version,
          idempotencyKey: "runtime-schedule-v1",
          entityId: entityIds[0],
          dueAt: "2026-09-03T10:00:00Z",
          executionMode: "shared",
        })) as Record<string, unknown>,
      );
      await run("compare_scenarios", {
        scenarioId: scenario.id,
        proposalId: proposal.id,
        workspaceVersion: version,
      });
      await run("get_recent_activity", { limit: 10 });
      await run("focus_workspace_item", { entityIds: [entityIds[0]] });
      writeResults.set(
        "create_failure_scenario",
        (await run("create_failure_scenario", {
          name: scenario.name,
          unavailableEntityIds: scenario.unavailableEntityIds,
          durationDays: scenario.durationDays,
          context: scenario.context,
          workspaceVersion: version,
          idempotencyKey: "runtime-scenario-v1",
        })) as Record<string, unknown>,
      );
      writeResults.set(
        "design_failure_scenarios",
        (await run("design_failure_scenarios", {
          workspaceVersion: version,
          idempotencyKey: "runtime-scenario-set-v1",
          scenarios: [
            scenario,
            {
              ...scenario,
              name: "Runtime outage 2",
              unavailableEntityIds: [entityIds[1]],
            },
            {
              ...scenario,
              name: "Runtime outage 3",
              unavailableEntityIds: [entityIds[2]],
            },
          ],
        })) as Record<string, unknown>,
      );
      writeResults.set(
        "draft_company_blueprint",
        (await run("draft_company_blueprint", {
          workspaceVersion: version,
          idempotencyKey: "runtime-blueprint-v1",
          companyName: "Runtime Company",
          companySummary: "A complete runtime company description.",
          entities: [
            {
              ref: "workflow",
              name: "Critical fulfillment",
              type: "workflow",
              description: "Deliver the company service to customers.",
              critical: true,
            },
            {
              ref: "service",
              name: "Fulfillment platform",
              type: "service",
              description: "Runs the critical fulfillment workflow.",
              critical: true,
            },
            {
              ref: "owner",
              name: "Operations owner",
              type: "person",
              description: "Owns continuity for fulfillment.",
              critical: true,
            },
            {
              ref: "recovery",
              name: "Recovery runbook",
              type: "recovery-mechanism",
              description: "Restores fulfillment through an alternate path.",
              critical: true,
            },
          ],
          relationships: [
            {
              fromRef: "workflow",
              toRef: "service",
              type: "depends-on",
            },
            {
              fromRef: "workflow",
              toRef: "owner",
              type: "owned-by",
            },
            {
              fromRef: "workflow",
              toRef: "recovery",
              type: "recovers-via",
            },
          ],
        })) as Record<string, unknown>,
      );
      writeResults.set(
        "draft_entities",
        (await run("draft_entities", {
          workspaceVersion: version,
          idempotencyKey: "runtime-entities-v1",
          entities: [{ name: "Recovery role", type: "person" }],
        })) as Record<string, unknown>,
      );
      writeResults.set(
        "draft_relationships",
        (await run("draft_relationships", {
          workspaceVersion: version,
          idempotencyKey: "runtime-relationships-v1",
          relationships: [
            { from: entityIds[0], to: entityIds[1], type: "depends-on" },
          ],
        })) as Record<string, unknown>,
      );
      writeResults.set(
        "draft_repair_options",
        (await run("draft_repair_options", {
          scenarioId: scenario.id,
          workspaceVersion: version,
          idempotencyKey: "runtime-repairs-v1",
          options: [
            {
              optionLabel: "A",
              title: "Connected recovery",
              rationale: "Restore every critical path.",
              assumptions: [],
              tradeoff: {
                effort: "MEDIUM",
                timeToRestoreHours: 8,
                residualRisk: "LOW",
                summary: "Adds a reviewed alternate path.",
              },
              changes: [
                {
                  op: "add-entity",
                  entity: {
                    id: "runtime-recovery",
                    name: "Runtime recovery",
                    type: "recovery-mechanism",
                  },
                },
                {
                  op: "add-relationship",
                  relationship: {
                    id: "runtime-path-1",
                    from: entityIds[0],
                    to: "runtime-recovery",
                    type: "recovers-via",
                  },
                },
                {
                  op: "add-relationship",
                  relationship: {
                    id: "runtime-path-2",
                    from: entityIds[1],
                    to: "runtime-recovery",
                    type: "recovers-via",
                  },
                },
              ],
            },
          ],
        })) as Record<string, unknown>,
      );

      expect(
        callLog
          .filter(({ status }) => status === "succeeded")
          .map(({ name }) => name),
      ).toEqual(tools.map(({ name }) => name));
      expect(writeResults.size).toBe(8);
      for (const [name, result] of writeResults) {
        expect(result.workspaceVersion, name).toBeNumber();
        expect(result.baselineChanged, name).toBeFalse();
        expect(result.humanReviewRequired, name).toBeTrue();
        expect(result.nextHumanAction, name).toBeString();
        expect(result.fallbackPolicy, name).toContain(
          "Do not use browser or computer control",
        );
      }
      registry.cleanup();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("hands the created repair and its scenario back to the visible UI", async () => {
    const tools: RegisteredToolDefinition[] = [];
    const targets: (ProposalCreatedTarget | undefined)[] = [];
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        modelContext: {
          registerTool: async (tool: RegisteredToolDefinition) => {
            tools.push(tool);
          },
        },
      },
    });
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          proposals: [
            {
              id: "proposal-visible",
              scenarioId: "scenario-payments",
            },
          ],
          workspaceVersion: 3,
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;
    try {
      const registry = registerSaveMyTools({
        getWorkspace: () => structuredClone(demoWorkspaces[0]),
        onFocus: () => {},
        onScenario: () => {},
        onProposalCreated: (target) => targets.push(target),
      });
      await registry.ready;
      const draft = tools.find((tool) => tool.name === "draft_repair_options")!;
      await draft.execute!(
        {
          scenarioId: "scenario-payments",
          workspaceVersion: 2,
          idempotencyKey: "repair-visible",
          options: [],
        },
        { signal: new AbortController().signal } as never,
      );
      expect(targets).toEqual([
        {
          proposalId: "proposal-visible",
          scenarioId: "scenario-payments",
        },
      ]);
      registry.cleanup();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("aborts every partially registered workspace tool when registration fails", async () => {
    const signals: AbortSignal[] = [];
    let count = 0;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        modelContext: {
          registerTool: async (
            _tool: RegisteredToolDefinition,
            options?: { signal?: AbortSignal },
          ) => {
            if (options?.signal) signals.push(options.signal);
            count += 1;
            if (count === 4) throw new Error("workspace registration failed");
          },
        },
      },
    });
    const registry = registerSaveMyTools({
      getWorkspace: () => structuredClone(demoWorkspaces[0]),
      onFocus: () => {},
      onScenario: () => {},
      onProposalCreated: () => {},
    });
    await expect(registry.ready).rejects.toThrow(
      "workspace registration failed",
    );
    expect(signals).toHaveLength(16);
    expect(signals.every((signal) => signal.aborted)).toBeTrue();
  });

  test("refuses to execute a synchronous workspace tool after cleanup", async () => {
    const tools: RegisteredToolDefinition[] = [];
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        modelContext: {
          registerTool: async (tool: RegisteredToolDefinition) => {
            tools.push(tool);
          },
        },
      },
    });
    const workspace = structuredClone(demoWorkspaces[0]);
    let focused = false;
    const registry = registerSaveMyTools({
      getWorkspace: () => workspace,
      onFocus: () => {
        focused = true;
      },
      onScenario: () => {},
      onProposalCreated: () => {},
    });
    await registry.ready;
    const focus = tools.find((tool) => tool.name === "focus_workspace_item")!;
    registry.cleanup();

    try {
      await focus.execute!({ entityIds: [workspace.entities[0]!.id] }, {
        signal: new AbortController().signal,
      } as never);
      throw new Error("Cleaned-up tool execution unexpectedly succeeded.");
    } catch (reason) {
      expect(reason).toBeInstanceOf(DOMException);
      expect((reason as DOMException).name).toBe("AbortError");
    }
    expect(focused).toBeFalse();
  });

  test("rejects an old in-flight response instead of updating a newly active company", async () => {
    const tools: RegisteredToolDefinition[] = [];
    const originalFetch = globalThis.fetch;
    let resolveFetch!: (response: Response) => void;
    let requestedPath = "";
    globalThis.fetch = ((input) => {
      requestedPath = String(input);
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    }) as typeof fetch;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        modelContext: {
          registerTool: async (tool: RegisteredToolDefinition) => {
            tools.push(tool);
          },
        },
      },
    });
    const first = structuredClone(demoWorkspaces[0]);
    const second = {
      ...structuredClone(demoWorkspaces[1]),
      id: "second-company-id",
      slug: "second-company",
    };
    let active = first;
    let scenarioUpdates = 0;
    let focusUpdates = 0;
    try {
      const registry = registerSaveMyTools({
        getWorkspace: () => active,
        onFocus: () => {
          focusUpdates += 1;
        },
        onScenario: () => {
          scenarioUpdates += 1;
        },
        onProposalCreated: () => {},
      });
      await registry.ready;
      const simulate = tools.find(
        (tool) => tool.name === "simulate_disruption",
      )!;
      const execution = simulate.execute(
        {
          name: "Old company outage",
          unavailableEntityIds: [first.entities[0]!.id],
          durationDays: 1,
          workspaceVersion: first.version,
        },
        { signal: new AbortController().signal },
      );
      active = second;
      resolveFetch(
        new Response(
          JSON.stringify({
            scenario: {
              id: "old-scenario",
              name: "Old company outage",
              unavailableEntityIds: [first.entities[0]!.id],
              durationDays: 1,
              createdBy: "agent",
              draft: true,
            },
            simulation: { smallestRelevantEntityIds: [first.entities[0]!.id] },
          }),
          {
            headers: { "content-type": "application/json" },
          },
        ),
      );

      try {
        await execution;
        throw new Error("Old company response unexpectedly succeeded.");
      } catch (reason) {
        expect(reason).toBeInstanceOf(DOMException);
        expect((reason as DOMException).name).toBe("AbortError");
        expect((reason as Error).message).toContain("active company changed");
      }
      expect(requestedPath).toContain(encodeURIComponent(first.slug));
      expect(scenarioUpdates).toBe(0);
      expect(focusUpdates).toBe(0);

      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ workspace: second }), {
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch;
      const summary = tools.find(
        (tool) => tool.name === "get_workspace_summary",
      )!;
      const summaryResult = (await summary.execute(
        {},
        { signal: new AbortController().signal },
      )) as { workspaceId: string };
      expect(summaryResult.workspaceId).toBe(second.id);
      registry.cleanup();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
