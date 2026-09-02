import { describe, expect, test } from "bun:test";
import {
  AuthorizationError,
  IdempotencyConflictError,
  InputValidationError,
  InMemoryWorkspaceRepository,
  VersionConflictError,
  WorkspaceService,
} from "./workspaceService";
import { wowProjectBlueprint } from "../fixtures/wowProjectBlueprint";
import type { AgentRepairOption } from "../domain/model";

const agentRepairOptions = (count = 1): AgentRepairOption[] =>
  Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1);
    const fallbackOwners = [
      "studio-ops",
      "studio-engineering",
      "studio-finance",
    ];
    const recoveryPaths = [
      "studio-qa-devices",
      "studio-recovery-doc",
      "studio-finance-channel",
    ];
    const fallbackOwner = fallbackOwners[index] ?? "studio-ops";
    const recoveryPath = recoveryPaths[index] ?? "studio-qa-devices";
    return {
      optionLabel: String.fromCharCode(65 + index),
      title: `Agent-authored recovery ${suffix}`,
      rationale: "The agent selected explicit healthy fallback paths.",
      assumptions: ["Human review is required before application."],
      tradeoff: {
        effort: index === 0 ? "LOW" : index === 1 ? "MEDIUM" : "HIGH",
        timeToRestoreHours: 2 + index * 2,
        residualRisk: index === 0 ? "MEDIUM" : "LOW",
        summary: "Tradeoff supplied by the agent.",
      },
      changes: [
        {
          op: "add-relationship",
          relationship: {
            id: `agent-access-${suffix}`,
            from: "studio-apple-account",
            to: fallbackOwner,
            type: "owned-by",
            group: "access",
            label: "agent-selected access fallback",
          },
        },
        {
          op: "add-relationship",
          relationship: {
            id: `agent-auth-${suffix}`,
            from: "studio-apple-account",
            to: recoveryPath,
            type: "recovers-via",
            group: "authentication",
            label: "agent-selected recovery device",
          },
        },
        {
          op: "add-relationship",
          relationship: {
            id: `agent-delegation-${suffix}`,
            from: "studio-engineering",
            to:
              fallbackOwner === "studio-engineering"
                ? "studio-ops"
                : fallbackOwner,
            type: "substitutes-for",
            group: "delegation",
            label: "agent-selected delegate",
          },
        },
      ],
    };
  });

const structuralRepairOption = (): AgentRepairOption => ({
  optionLabel: "S",
  title: "Add a shared release custodian",
  rationale:
    "Create a named shared custodian and connect both account access and certificate administration.",
  assumptions: ["The proposed custodian requires human verification."],
  tradeoff: {
    effort: "MEDIUM",
    timeToRestoreHours: 12,
    residualRisk: "LOW",
    summary: "Adds durable custody instead of relying on one personal device.",
  },
  changes: [
    {
      op: "add-entity",
      entity: {
        id: "agent-shared-custodian",
        name: "Shared release custodian",
        type: "team",
        critical: true,
        description: "Two-person custody for release access and signing.",
      },
    },
    {
      op: "add-relationship",
      relationship: {
        id: "agent-shared-account-path",
        from: "studio-apple-account",
        to: "agent-shared-custodian",
        type: "owned-by",
        group: "access",
        label: "shared custody",
      },
    },
    {
      op: "add-relationship",
      relationship: {
        id: "agent-shared-signing-path",
        from: "studio-cert",
        to: "agent-shared-custodian",
        type: "administered-by",
        group: "custody",
        label: "maintained by",
      },
    },
    {
      op: "add-relationship",
      relationship: {
        id: "agent-shared-operations-path",
        from: "studio-apple-account",
        to: "studio-ops",
        type: "owned-by",
        group: "access",
        label: "operations fallback",
      },
    },
    {
      op: "add-relationship",
      relationship: {
        id: "agent-shared-device-path",
        from: "studio-apple-account",
        to: "studio-qa-devices",
        type: "recovers-via",
        group: "authentication",
        label: "shared recovery device",
      },
    },
    {
      op: "add-relationship",
      relationship: {
        id: "agent-shared-delegation-path",
        from: "studio-engineering",
        to: "studio-ops",
        type: "substitutes-for",
        group: "delegation",
        label: "operations delegate",
      },
    },
  ],
});

describe("workspace application boundary", () => {
  test("isolates mutable demo state by scope", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const one = (await repository.get("session-one", "northstar-studio"))!;
    one.name = "Changed";
    await repository.save("session-one", one);
    expect(
      (await repository.get("session-two", "northstar-studio"))!.name,
    ).toBe("Diamond Apps");
  });

  test("enforces optimistic concurrency", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    await expect(
      service.stageAgentRepairOptions(
        "scope",
        "northstar-studio",
        "studio-founder-away",
        99,
        "idempotency-123",
        agentRepairOptions(),
      ),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  test("returns the same durable mutation for the same idempotency key", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const first = await service.stageAgentRepairOptions(
      "scope",
      "northstar-studio",
      "studio-founder-away",
      1,
      "idempotency-123",
      agentRepairOptions(),
    );
    const second = await service.stageAgentRepairOptions(
      "scope",
      "northstar-studio",
      "studio-founder-away",
      1,
      "idempotency-123",
      agentRepairOptions(),
    );
    expect(second[0]?.id).toBe(first[0]?.id);
  });

  test("creates one company for repeated native-tool retries", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const first = await service.create("user:native", "Valencia Ridge", {
      idempotencyKey: "valencia-ridge-company-v1",
      actor: "agent",
      setupMode: "manual",
    });
    const retry = await service.create("user:native", "Valencia Ridge", {
      idempotencyKey: "valencia-ridge-company-v1",
      actor: "agent",
      setupMode: "manual",
    });
    expect(retry.id).toBe(first.id);
    expect(retry.slug).toBe(first.slug);
    expect(
      (await service.list("user:native")).filter(
        (workspace) => workspace.slug === first.slug,
      ),
    ).toHaveLength(1);
    expect(first.activity[0]?.actor).toBe("agent");
    await expect(
      service.create("user:native", "Renamed retry payload", {
        idempotencyKey: "valencia-ridge-company-v1",
        actor: "agent",
        setupMode: "manual",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(
      service.create("user:native", "Valencia Ridge", {
        idempotencyKey: "valencia-ridge-company-v1",
        actor: "agent",
        setupMode: "agent-blueprint",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  test("prevents an agent from accepting a proposal", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const [proposal] = await service.stageAgentRepairOptions(
      "scope",
      "northstar-studio",
      "studio-founder-away",
      1,
      "idempotency-123",
      agentRepairOptions(),
    );
    await expect(
      service.decideProposal(
        "scope",
        "northstar-studio",
        proposal!.id,
        2,
        "ACCEPTED",
        "agent",
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  test("keeps seeded demos immutable while allowing editable copies", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const baselineCount = (await service.get("user:one", "northstar-studio"))
      .entities.length;
    await expect(
      service.addEntity("user:one", "northstar-studio", 1, {
        name: "Hidden edit",
        type: "service",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const copy = await service.duplicate("user:one", "northstar-studio");
    const result = await service.addEntity("user:one", copy.slug, 1, {
      name: "Release mirror",
      type: "service",
      critical: true,
    });
    expect(result.entity.trust).toBe("DECLARED");
    expect(result.workspace.entities.at(-1)?.name).toBe("Release mirror");
    expect(
      (await service.get("user:one", "northstar-studio")).entities,
    ).toHaveLength(baselineCount);
  });

  test("permanently deletes personal companies but never seeded demos", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = new WorkspaceService(repository);
    const workspace = await service.create("user:one", "Temporary company");

    await service.deleteWorkspace(
      "user:one",
      workspace.slug,
      workspace.version,
    );

    expect(await repository.get("user:one", workspace.slug)).toBeUndefined();
    await expect(
      service.deleteWorkspace("user:one", "northstar-studio", 1),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  test("does not replay a proposal that an explicit demo reset erased", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const scope = "scope:reset-idempotency";
    const baseline = await service.get(scope, "northstar-studio");
    const first = await service.draft(
      scope,
      baseline.slug,
      baseline.version,
      "reset-draft-key",
      [
        {
          id: "first-reset-item",
          name: "Reset-sensitive item",
          type: "service",
          trust: "INFERRED",
        },
      ],
      [],
    );

    await service.resetDemo(scope, baseline.slug);
    const second = await service.draft(
      scope,
      baseline.slug,
      baseline.version,
      "reset-draft-key",
      [
        {
          id: "second-reset-item",
          name: "Reset-sensitive item",
          type: "service",
          trust: "INFERRED",
        },
      ],
      [],
    );
    const saved = await service.get(scope, baseline.slug);

    expect(second.id).not.toBe(first.id);
    expect(saved.proposals.map((proposal) => proposal.id)).toEqual([second.id]);
    expect(saved.version).toBe(baseline.version + 1);
  });

  test("rejects blank and no-op manual mutations at the application boundary", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    await expect(service.create("user:blank", "   ")).rejects.toBeInstanceOf(
      InputValidationError,
    );
    const workspace = await service.create("user:manual-validation", "Valid");
    await expect(
      service.updateWorkspace(
        "user:manual-validation",
        workspace.slug,
        workspace.version,
        { name: " Valid " },
      ),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      service.addEntity(
        "user:manual-validation",
        workspace.slug,
        workspace.version,
        { name: "  ", type: "service" },
      ),
    ).rejects.toBeInstanceOf(InputValidationError);
    const added = await service.addEntity(
      "user:manual-validation",
      workspace.slug,
      workspace.version,
      { name: "Billing", type: "service" },
    );
    await expect(
      service.updateEntity(
        "user:manual-validation",
        workspace.slug,
        added.entity.id,
        added.workspace.version,
        { name: "Billing" },
      ),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  test("validates scenario IDs and schedule dates before persisting them", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const workspace = await service.get(
      "scope:scenario-validation",
      "northstar-studio",
    );
    await expect(
      service.createScenario(
        "scope:scenario-validation",
        workspace.slug,
        workspace.version,
        {
          id: workspace.scenarios[0]!.id,
          name: "Overwrite seeded scenario",
          unavailableEntityIds: ["studio-founder"],
          durationDays: 1,
          context: "Must not overwrite a stored rehearsal.",
          createdBy: "human",
        },
      ),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      service.simulate("scope:scenario-validation", workspace.slug, {
        id: "duplicate-input",
        name: "Duplicate input",
        unavailableEntityIds: ["studio-founder", "studio-founder"],
        durationDays: 1,
        context: "Duplicate unavailable IDs are ambiguous.",
        createdBy: "agent",
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      service.draftSchedule(
        "scope:scenario-validation",
        workspace.slug,
        workspace.version,
        "invalid-schedule-date",
        "studio-release",
        "not-a-date",
        "Invalid date must not be stored.",
        "shared",
      ),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  test("validates manual relationship endpoints inside the aggregate", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const workspace = await service.create("user:one", "Manual map");
    const first = await service.addEntity("user:one", workspace.slug, 1, {
      name: "Release workflow",
      type: "workflow",
    });
    await expect(
      service.addRelationship("user:one", workspace.slug, 2, {
        from: first.entity.id,
        to: "outside-tenant",
        type: "depends-on",
      }),
    ).rejects.toThrow("Both relationship endpoints must exist");
  });

  test("stores a manual connection with its alternate-path group and provenance", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const workspace = await service.create("user:one", "Manual connection");
    const workflow = await service.addEntity("user:one", workspace.slug, 1, {
      name: "Release workflow",
      type: "workflow",
    });
    const repository = await service.addEntity("user:one", workspace.slug, 2, {
      name: "Source repository",
      type: "service",
    });
    const result = await service.addRelationship(
      "user:one",
      workspace.slug,
      3,
      {
        from: workflow.entity.id,
        to: repository.entity.id,
        type: "depends-on",
        group: "source",
        label: "builds from",
      },
    );
    expect(result.relationship).toMatchObject({
      from: workflow.entity.id,
      to: repository.entity.id,
      type: "depends-on",
      group: "source",
      label: "builds from",
      trust: "DECLARED",
    });
    expect(result.workspace.activity[0]).toMatchObject({
      action: "RELATIONSHIP_CREATED",
      actor: "human",
      version: 4,
    });
  });

  test("stores a scenario without changing baseline entities", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const before = await service.get("scope", "northstar-studio");
    const result = await service.createScenario(
      "scope",
      "northstar-studio",
      before.version,
      {
        name: "Support leads unavailable",
        unavailableEntityIds: ["studio-support-owner"],
        durationDays: 2,
        context: "Customer support must continue.",
        createdBy: "human",
      },
    );
    expect(result.workspace.scenarios[0]?.name).toBe(
      "Support leads unavailable",
    );
    expect(result.workspace.entities).toHaveLength(before.entities.length);
  });

  test("stages delegation and schedule changes as proposals", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const delegation = await service.draftDelegation(
      "scope",
      "northstar-studio",
      1,
      "delegation-key",
      "studio-founder",
      "studio-support-owner",
      "studio-release",
      "Release coverage",
    );
    expect(delegation.kind).toBe("DELEGATION");
    expect(delegation.status).toBe("PROPOSED");
    expect(
      delegation.changes.some((change) => change.op === "add-relationship"),
    ).toBeTrue();
    const schedule = await service.draftSchedule(
      "scope",
      "northstar-studio",
      2,
      "schedule-key",
      "studio-release",
      "2026-09-04",
      "Move after verification",
      "shared",
    );
    expect(schedule.kind).toBe("SCHEDULE");
    expect(schedule.changes[0]?.op).toBe("update-entity");
    expect(
      (await service.get("scope", "northstar-studio")).entities.find(
        (entity) => entity.id === "studio-release",
      )?.metadata?.dueAt,
    ).toBeUndefined();
  });

  test("stages agent-authored repairs and records the chosen resolution", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const options = await service.stageAgentRepairOptions(
      "scope",
      "northstar-studio",
      "studio-founder-away",
      1,
      "repair-options-key",
      agentRepairOptions(3),
    );
    expect(options).toHaveLength(3);
    for (const option of options) {
      const comparison = await service.compare(
        "scope",
        "northstar-studio",
        "studio-founder-away",
        option.id,
      );
      expect(comparison.before.blockedWorkflowIds.length).toBeGreaterThan(0);
      expect(comparison.after.blockedWorkflowIds).toHaveLength(0);
    }
    const selected = options[1]!;
    const customized = await service.customizeProposal(
      "scope",
      "northstar-studio",
      selected.id,
      2,
      "Cross-team recovery with named owners",
      selected.changes.flatMap((change, changeIndex) =>
        change.op === "add-relationship"
          ? [{ changeIndex, to: change.relationship.to }]
          : [],
      ),
      [],
    );
    expect(customized.proposal.title).toBe(
      "Cross-team recovery with named owners",
    );
    const resolved = await service.decideProposal(
      "scope",
      "northstar-studio",
      selected.id,
      3,
      "ACCEPTED",
      "human",
    );
    const scenario = resolved.scenarios.find(
      (item) => item.id === "studio-founder-away",
    );
    expect(scenario?.resolution?.status).toBe("RESOLVED");
    expect(scenario?.resolution?.residualBlockedWorkflowIds).toHaveLength(0);
    expect(
      resolved.proposals.filter(
        (item) =>
          item.optionGroupId === options[0]!.optionGroupId &&
          item.status === "REJECTED",
      ),
    ).toHaveLength(2);
  });

  test("keeps a connected agent-suggested node visible in a structural repair", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const before = await service.get("scope:structural", "northstar-studio");
    expect(
      before.entities.some((entity) => entity.id === "agent-shared-custodian"),
    ).toBeFalse();
    const [proposal] = await service.stageAgentRepairOptions(
      "scope:structural",
      "northstar-studio",
      "studio-founder-away",
      before.version,
      "structural-repair-key",
      [structuralRepairOption()],
    );
    expect(
      proposal?.changes.some(
        (change) =>
          change.op === "add-entity" &&
          change.entity.id === "agent-shared-custodian" &&
          Boolean(change.entity.image),
      ),
    ).toBeTrue();
    expect(
      (await service.get("scope:structural", "northstar-studio")).entities.some(
        (entity) => entity.id === "agent-shared-custodian",
      ),
    ).toBeFalse();
    const comparison = await service.compare(
      "scope:structural",
      "northstar-studio",
      "studio-founder-away",
      proposal!.id,
    );
    expect(comparison.before.blockedWorkflowIds.length).toBeGreaterThan(0);
    expect(comparison.after.blockedWorkflowIds).toHaveLength(0);
  });

  test("rejects dangling, orphaned, and duplicated repair strategies", async () => {
    const dangling = agentRepairOptions()[0]!;
    dangling.changes.push({
      op: "add-relationship",
      relationship: {
        id: "agent-dangling-path",
        from: "missing-agent-item",
        to: "studio-ops",
        type: "owned-by",
      },
    });
    await expect(
      new WorkspaceService(
        new InMemoryWorkspaceRepository(),
      ).stageAgentRepairOptions(
        "scope:dangling",
        "northstar-studio",
        "studio-founder-away",
        1,
        "dangling-repair-key",
        [dangling],
      ),
    ).rejects.toThrow("unknown relationship source");

    const orphaned = agentRepairOptions()[0]!;
    orphaned.changes.push({
      op: "add-entity",
      entity: {
        id: "agent-orphan",
        name: "Unconnected recovery owner",
        type: "person",
      },
    });
    await expect(
      new WorkspaceService(
        new InMemoryWorkspaceRepository(),
      ).stageAgentRepairOptions(
        "scope:orphaned",
        "northstar-studio",
        "studio-founder-away",
        1,
        "orphaned-repair-key",
        [orphaned],
      ),
    ).rejects.toThrow("connect every new item");

    const first = agentRepairOptions()[0]!;
    const duplicate = structuredClone(first);
    duplicate.optionLabel = "B";
    duplicate.title = "Same graph under another label";
    duplicate.changes.forEach((change, index) => {
      if (change.op === "add-relationship")
        change.relationship.id = `duplicate-strategy-${index}`;
    });
    await expect(
      new WorkspaceService(
        new InMemoryWorkspaceRepository(),
      ).stageAgentRepairOptions(
        "scope:duplicates",
        "northstar-studio",
        "studio-founder-away",
        1,
        "duplicate-repair-key",
        [first, duplicate],
      ),
    ).rejects.toThrow("duplicates another strategy");

    const emptyUpdate = agentRepairOptions()[0]!;
    emptyUpdate.changes.push({
      op: "update-entity",
      entityId: "studio-ci",
      patch: {},
    });
    await expect(
      new WorkspaceService(
        new InMemoryWorkspaceRepository(),
      ).stageAgentRepairOptions(
        "scope:empty-update",
        "northstar-studio",
        "studio-founder-away",
        1,
        "empty-update-repair-key",
        [emptyUpdate],
      ),
    ).rejects.toThrow("materially change");

    const emptyMetadataUpdate = agentRepairOptions()[0]!;
    emptyMetadataUpdate.changes.push({
      op: "update-entity",
      entityId: "studio-ci",
      patch: { metadata: {} },
    });
    await expect(
      new WorkspaceService(
        new InMemoryWorkspaceRepository(),
      ).stageAgentRepairOptions(
        "scope:empty-metadata-update",
        "northstar-studio",
        "studio-founder-away",
        1,
        "empty-metadata-update-key",
        [emptyMetadataUpdate],
      ),
    ).rejects.toThrow("materially change");
  });

  test("designs several idempotent agent scenario drafts without changing the graph", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const before = await service.get("scope:scenarios", "northstar-studio");
    const ids = before.entities.slice(0, 3).map((entity) => entity.id);
    const inputs = ids.map((entityId, index) => ({
      name: `Agent rehearsal ${index + 1}`,
      unavailableEntityIds: [entityId],
      durationDays: index + 1,
      context: `Keep critical work moving during rehearsal ${index + 1}.`,
    }));
    const first = await service.designAgentScenarios(
      "scope:scenarios",
      "northstar-studio",
      before.version,
      "scenario-library-key",
      inputs,
    );
    expect(first.scenarios).toHaveLength(3);
    expect(first.simulations).toHaveLength(3);
    expect(
      first.scenarios.every(
        (scenario) =>
          scenario.createdBy === "agent" &&
          scenario.draft === true &&
          scenario.designGroupId === "scenario-design:scenario-library-key",
      ),
    ).toBeTrue();
    expect(first.workspace.entities).toHaveLength(before.entities.length);
    expect(first.workspace.relationships).toHaveLength(
      before.relationships.length,
    );
    const retry = await service.designAgentScenarios(
      "scope:scenarios",
      "northstar-studio",
      before.version,
      "scenario-library-key",
      inputs,
    );
    expect(retry.scenarios.map((scenario) => scenario.id)).toEqual(
      first.scenarios.map((scenario) => scenario.id),
    );
    expect(retry.workspace.version).toBe(before.version + 1);
    await expect(
      service.designAgentScenarios(
        "scope:scenarios",
        "northstar-studio",
        before.version,
        "scenario-library-key",
        inputs.map((input, index) =>
          index === 0
            ? { ...input, context: "A different retry payload." }
            : input,
        ),
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    await expect(
      new WorkspaceService(
        new InMemoryWorkspaceRepository(),
      ).designAgentScenarios(
        "scope:too-few-scenarios",
        "northstar-studio",
        before.version,
        "too-few-scenario-key",
        inputs.slice(0, 1),
      ),
    ).rejects.toThrow("three to five");

    const duplicateMaterialScenario = {
      ...inputs[0]!,
      name: "Same disruption under another name",
    };
    await expect(
      new WorkspaceService(
        new InMemoryWorkspaceRepository(),
      ).designAgentScenarios(
        "scope:duplicate-scenarios",
        "northstar-studio",
        before.version,
        "duplicate-scenario-key",
        [inputs[0]!, duplicateMaterialScenario, inputs[2]!],
      ),
    ).rejects.toThrow("duplicates another scenario");
  });

  test("refuses to apply a proposal after the baseline changes", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = new WorkspaceService(repository);
    const workspace = await service.create("user:stale", "Stale proposal co");
    const proposal = await service.draft(
      "user:stale",
      workspace.slug,
      workspace.version,
      "stale-proposal-key",
      [
        {
          id: "agent-proposed-service",
          name: "Proposed service",
          type: "service",
          trust: "INFERRED",
        },
      ],
      [],
    );
    const changed = (await repository.get("user:stale", workspace.slug))!;
    changed.entities.push({
      id: "manual-baseline-person",
      name: "Manual baseline owner",
      type: "person",
      trust: "DECLARED",
    });
    const expectedVersion = changed.version;
    changed.version += 1;
    await repository.save("user:stale", changed, expectedVersion);
    await expect(
      service.decideProposal(
        "user:stale",
        workspace.slug,
        proposal.id,
        changed.version,
        "ACCEPTED",
        "human",
      ),
    ).rejects.toThrow("baseline changed");
  });

  test("keeps agent-authored repair options idempotent", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const options = await service.stageAgentRepairOptions(
      "scope:agent-case",
      "northstar-studio",
      "studio-founder-away",
      1,
      "prepared-three-person-case",
      agentRepairOptions(3),
    );
    expect(options).toHaveLength(3);
    for (const option of options) {
      const comparison = await service.compare(
        "scope:agent-case",
        "northstar-studio",
        "studio-founder-away",
        option.id,
      );
      expect(comparison.before.blockedWorkflowIds).toHaveLength(1);
      expect(comparison.after.blockedWorkflowIds).toHaveLength(0);
      expect(comparison.restoredWorkflowIds).toHaveLength(1);
    }
    const retry = await service.stageAgentRepairOptions(
      "scope:agent-case",
      "northstar-studio",
      "studio-founder-away",
      1,
      "prepared-three-person-case",
      agentRepairOptions(3),
    );
    expect(retry.map((proposal) => proposal.id)).toEqual(
      options.map((proposal) => proposal.id),
    );
    const changedRetry = agentRepairOptions(3);
    changedRetry[0]!.tradeoff.summary = "Changed retry payload.";
    await expect(
      service.stageAgentRepairOptions(
        "scope:agent-case",
        "northstar-studio",
        "studio-founder-away",
        1,
        "prepared-three-person-case",
        changedRetry,
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(
      (await service.get("scope:agent-case", "northstar-studio")).version,
    ).toBe(2);
  });

  test("stages a connected new recovery item without changing the baseline", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const baseline = await service.get("scope:structural", "northstar-studio");
    const [proposal] = await service.stageAgentRepairOptions(
      "scope:structural",
      "northstar-studio",
      "studio-founder-away",
      baseline.version,
      "structural-repair-item",
      [structuralRepairOption()],
    );

    expect(
      proposal?.changes.some(
        (change) =>
          change.op === "add-entity" &&
          change.entity.id === "agent-shared-custodian",
      ),
    ).toBeTrue();
    expect(
      (await service.get("scope:structural", "northstar-studio")).entities,
    ).toHaveLength(baseline.entities.length);
    expect(
      (
        await service.compare(
          "scope:structural",
          "northstar-studio",
          "studio-founder-away",
          proposal!.id,
        )
      ).after.blockedWorkflowIds,
    ).toHaveLength(0);
  });

  test("stages a connected company blueprint in one agent proposal", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const workspace = await service.create("user:salon", "Luma Salon Network");
    const proposal = await service.draftCompanyBlueprint(
      "user:salon",
      workspace.slug,
      1,
      "salon-blueprint-key",
      "Luma Salon Network",
      "Three beauty salons share booking, inventory, staff scheduling, and emergency access.",
      [
        {
          ref: "booking",
          name: "Booking and checkout",
          type: "workflow",
          description:
            "Books appointments, charges deposits, and closes visits.",
          critical: true,
        },
        {
          ref: "platform",
          name: "Salon booking platform",
          type: "service",
          description: "Shared cloud booking and point-of-sale system.",
          critical: true,
        },
        {
          ref: "ops",
          name: "Regional operations lead",
          type: "person",
          role: "Operations lead",
          description: "Owns continuity across all three salon locations.",
          critical: true,
        },
        {
          ref: "break-glass",
          name: "Booking recovery runbook",
          type: "recovery-mechanism",
          description:
            "Documents offline booking, payment capture, and restore steps.",
          critical: true,
        },
      ],
      [
        {
          fromRef: "booking",
          toRef: "platform",
          type: "depends-on",
          group: "booking",
        },
        {
          fromRef: "platform",
          toRef: "ops",
          type: "administered-by",
          group: "access",
        },
        {
          fromRef: "platform",
          toRef: "break-glass",
          type: "recovers-via",
          group: "recovery",
        },
      ],
    );
    expect(proposal.kind).toBe("MAP_DRAFT");
    expect(
      proposal.changes.filter((change) => change.op === "add-entity"),
    ).toHaveLength(4);
    expect(
      proposal.changes.filter((change) => change.op === "add-relationship"),
    ).toHaveLength(3);
    const proposedEntities = proposal.changes.flatMap((change) =>
      change.op === "add-entity" ? [change.entity] : [],
    );
    expect(
      proposedEntities.find((entity) => entity.type === "person")?.image,
    ).toMatch(
      /\/(studio|education|hospitality|charter)\/(01|02|03|04|05|08|21|23|24)\.webp$/,
    );
    expect(
      proposedEntities.find((entity) => entity.type === "workflow")?.image,
    ).not.toBe(
      proposedEntities.find((entity) => entity.type === "person")?.image,
    );
    const accepted = await service.decideProposal(
      "user:salon",
      workspace.slug,
      proposal.id,
      2,
      "ACCEPTED",
      "human",
    );
    expect(accepted.entities).toHaveLength(4);
    expect(accepted.relationships).toHaveLength(3);
    expect(
      accepted.entities.every((entity) => Boolean(entity.image)),
    ).toBeTrue();
  });

  test("requires a semantically complete blueprint on an empty baseline", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const incomplete = await service.create(
      "user:incomplete-blueprint",
      "Incomplete blueprint",
    );
    await expect(
      service.draftCompanyBlueprint(
        "user:incomplete-blueprint",
        incomplete.slug,
        incomplete.version,
        "incomplete-blueprint-key",
        "Incomplete blueprint",
        "A connected but operationally incomplete company map for validation.",
        [
          {
            ref: "workflow",
            name: "Serve customers",
            type: "workflow",
            description: "The work that must continue.",
            critical: true,
          },
          {
            ref: "service",
            name: "Primary service",
            type: "service",
            description: "The system used to serve customers.",
            critical: true,
          },
          {
            ref: "owner",
            name: "Operations owner",
            type: "person",
            description: "Owns daily operations.",
            critical: true,
          },
          {
            ref: "document",
            name: "Operating guide",
            type: "document",
            description: "Describes normal operations only.",
            critical: false,
          },
        ],
        [
          {
            fromRef: "workflow",
            toRef: "service",
            type: "depends-on",
          },
          {
            fromRef: "service",
            toRef: "owner",
            type: "administered-by",
          },
          {
            fromRef: "workflow",
            toRef: "document",
            type: "depends-on",
          },
        ],
      ),
    ).rejects.toThrow("Blueprint is incomplete");

    const nonempty = await service.create(
      "user:nonempty-blueprint",
      "Nonempty blueprint",
    );
    const withItem = await service.addEntity(
      "user:nonempty-blueprint",
      nonempty.slug,
      nonempty.version,
      {
        name: "Manually declared owner",
        type: "person",
        description: "Already part of the authoritative baseline.",
      },
    );
    await expect(
      service.draftCompanyBlueprint(
        "user:nonempty-blueprint",
        nonempty.slug,
        withItem.workspace.version,
        "nonempty-blueprint-key",
        wowProjectBlueprint.companyName,
        wowProjectBlueprint.companySummary,
        wowProjectBlueprint.entities,
        wowProjectBlueprint.relationships,
      ),
    ).rejects.toThrow("only establish an empty baseline");
  });

  test("stages the production-shaped Wow Project salon network atomically and idempotently", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const workspace = await service.create("user:wow", "Wow Project");
    const input = wowProjectBlueprint;
    const proposal = await service.draftCompanyBlueprint(
      "user:wow",
      workspace.slug,
      workspace.version,
      "wow-project-native-blueprint-v1",
      input.companyName,
      input.companySummary,
      input.entities,
      input.relationships,
    );
    const proposedEntities = proposal.changes.flatMap((change) =>
      change.op === "add-entity" ? [change.entity] : [],
    );
    const proposedRelationships = proposal.changes.flatMap((change) =>
      change.op === "add-relationship" ? [change.relationship] : [],
    );
    expect(proposal.kind).toBe("MAP_DRAFT");
    expect(proposedEntities).toHaveLength(40);
    expect(proposedRelationships).toHaveLength(78);
    expect(
      proposedEntities.filter((entity) => entity.type === "workflow"),
    ).toHaveLength(8);
    expect(
      proposedEntities.filter((entity) => entity.type === "person"),
    ).toHaveLength(8);
    expect(
      proposedEntities.every((entity) => Boolean(entity.image)),
    ).toBeTrue();
    const proposedIds = new Set(proposedEntities.map((entity) => entity.id));
    expect(
      proposedRelationships.every(
        (relationship) =>
          proposedIds.has(relationship.from) &&
          proposedIds.has(relationship.to) &&
          relationship.from !== relationship.to,
      ),
    ).toBeTrue();

    const retry = await service.draftCompanyBlueprint(
      "user:wow",
      workspace.slug,
      workspace.version,
      "wow-project-native-blueprint-v1",
      input.companyName,
      input.companySummary,
      input.entities,
      input.relationships,
    );
    expect(retry.id).toBe(proposal.id);
    expect((await service.get("user:wow", workspace.slug)).version).toBe(2);

    const accepted = await service.decideProposal(
      "user:wow",
      workspace.slug,
      proposal.id,
      2,
      "ACCEPTED",
      "human",
    );
    expect(accepted.entities).toHaveLength(40);
    expect(accepted.relationships).toHaveLength(78);
    expect(
      accepted.relationships.every(
        (relationship) =>
          accepted.entities.some((entity) => entity.id === relationship.from) &&
          accepted.entities.some((entity) => entity.id === relationship.to),
      ),
    ).toBeTrue();
  });

  test("rejects a blueprint that is split into disconnected graph components", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const workspace = await service.create("user:split", "Split company");
    await expect(
      service.draftCompanyBlueprint(
        "user:split",
        workspace.slug,
        workspace.version,
        "split-blueprint-key",
        "Split company",
        "A deliberately disconnected company description for contract testing.",
        [
          {
            ref: "workflow",
            name: "Serve customers",
            type: "workflow",
            description: "Primary service workflow.",
            critical: true,
          },
          {
            ref: "platform",
            name: "Booking platform",
            type: "service",
            description: "Supports service delivery.",
            critical: true,
          },
          {
            ref: "orphan",
            name: "Unconnected owner",
            type: "person",
            description: "Must not silently disappear into another component.",
            critical: false,
          },
        ],
        [
          {
            fromRef: "workflow",
            toRef: "platform",
            type: "depends-on",
          },
          {
            fromRef: "platform",
            toRef: "workflow",
            type: "required-by",
          },
        ],
      ),
    ).rejects.toThrow("one connected map");
  });
});
