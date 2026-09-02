import {
  applyProposalChanges,
  compareProposal,
  simulateDisruption,
  validateContinuityMap,
} from "../domain/graph";
import type {
  ActivityEntry,
  AgentRepairOption,
  Entity,
  Proposal,
  ProposalChange,
  Relationship,
  Scenario,
  Workspace,
} from "../domain/model";
import {
  cloneDemo,
  demoWorkspaces,
  reviewedAssetForType,
} from "../infrastructure/demoWorkspaces";
import { inspectBlueprintCoverage } from "./blueprintCoverage";

export class VersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super(`Workspace changed. Current version is ${currentVersion}.`);
  }
}

export class AuthorizationError extends Error {}
export class NotFoundError extends Error {}
export class IdempotencyConflictError extends Error {}
export class InputValidationError extends Error {}

export interface WorkspaceRepository {
  get(scope: string, slug: string): Promise<Workspace | undefined>;
  save(
    scope: string,
    workspace: Workspace,
    expectedVersion?: number,
  ): Promise<void>;
  delete(scope: string, slug: string, expectedVersion?: number): Promise<void>;
  resetDemo(scope: string, slug: string): Promise<Workspace>;
  list(scope: string): Promise<Workspace[]>;
}

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private records = new Map<string, Workspace>();
  private key(scope: string, slug: string) {
    return `${scope}:${slug}`;
  }

  async get(scope: string, slug: string) {
    const key = this.key(scope, slug);
    let workspace = this.records.get(key);
    if (!workspace) {
      const demo = cloneDemo(slug);
      if (demo) {
        workspace = demo;
        this.records.set(key, workspace);
      }
    }
    return workspace ? structuredClone(workspace) : undefined;
  }

  async save(scope: string, workspace: Workspace, expectedVersion?: number) {
    const key = this.key(scope, workspace.slug);
    const current = this.records.get(key);
    if (expectedVersion !== undefined && expectedVersion !== 0 && !current)
      throw new NotFoundError("Workspace not found.");
    if (
      expectedVersion !== undefined &&
      (expectedVersion === 0
        ? Boolean(current)
        : current?.version !== expectedVersion)
    )
      throw new VersionConflictError(current?.version ?? 0);
    this.records.set(key, structuredClone(workspace));
  }

  async delete(scope: string, slug: string, expectedVersion?: number) {
    const key = this.key(scope, slug);
    const current = this.records.get(key);
    if (!current) throw new NotFoundError("Workspace not found.");
    if (expectedVersion !== undefined && current.version !== expectedVersion)
      throw new VersionConflictError(current.version);
    this.records.delete(key);
  }

  async resetDemo(scope: string, slug: string) {
    const demo = cloneDemo(slug);
    if (!demo) throw new NotFoundError("Demo workspace not found.");
    this.records.set(this.key(scope, slug), demo);
    return structuredClone(demo);
  }

  async list(scope: string) {
    const demos = (await Promise.all(
      demoWorkspaces.map((workspace) => this.get(scope, workspace.slug)),
    )) as Workspace[];
    const personal = [...this.records.entries()]
      .filter(
        ([key, workspace]) =>
          key.startsWith(`${scope}:`) && workspace.sector === "custom",
      )
      .map(([, workspace]) => structuredClone(workspace));
    return [...demos, ...personal];
  }
}

const now = () => new Date().toISOString();
const unique = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  return value;
}

const stableJson = (value: unknown) => JSON.stringify(stableValue(value));

function normalizedText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function requireMeaningfulText(value: string, label: string) {
  const normalized = normalizedText(value);
  if (!normalized) throw new InputValidationError(`${label} cannot be blank.`);
  return normalized;
}

function validateScenarioEntityIds(
  workspace: Workspace,
  unavailableEntityIds: string[],
) {
  if (unavailableEntityIds.length === 0)
    throw new InputValidationError(
      "A scenario must make at least one item unavailable.",
    );
  if (new Set(unavailableEntityIds).size !== unavailableEntityIds.length)
    throw new InputValidationError(
      "A scenario cannot repeat an unavailable item ID.",
    );
  const entityIds = new Set(workspace.entities.map(({ id }) => id));
  for (const entityId of unavailableEntityIds) {
    if (!entityIds.has(entityId))
      throw new NotFoundError(`Unavailable entity ${entityId} was not found.`);
  }
}

async function requestFingerprint(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableJson(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function patchMateriallyChangesEntity(
  entity: Entity,
  patch: Record<string, unknown>,
) {
  if (Object.keys(patch).length === 0) return false;
  const patchMetadata = patch.metadata;
  const mergedMetadata =
    patchMetadata && typeof patchMetadata === "object"
      ? { ...entity.metadata, ...patchMetadata }
      : entity.metadata;
  const normalizedMetadata =
    mergedMetadata && Object.keys(mergedMetadata).length > 0
      ? mergedMetadata
      : undefined;
  const effective = {
    ...entity,
    ...patch,
    metadata: normalizedMetadata,
  };
  return stableJson(effective) !== stableJson(entity);
}

type AgentScenarioInput = Pick<
  Scenario,
  "name" | "unavailableEntityIds" | "durationDays" | "context"
>;

function normalizeScenarioInput(input: AgentScenarioInput): AgentScenarioInput {
  return {
    name: input.name.trim().replace(/\s+/g, " "),
    unavailableEntityIds: [...input.unavailableEntityIds].sort(),
    durationDays: input.durationDays,
    context: input.context.trim().replace(/\s+/g, " "),
  };
}

function scenarioMaterialSignature(input: AgentScenarioInput) {
  return stableJson({
    unavailableEntityIds: [...input.unavailableEntityIds].sort(),
  });
}

function activity(
  workspace: Workspace,
  action: string,
  detail: string,
  actor: ActivityEntry["actor"],
) {
  workspace.activity.unshift({
    id: unique("activity"),
    action,
    detail,
    actor,
    at: now(),
    version: workspace.version,
  });
}

function baselineFingerprint(workspace: Workspace) {
  return JSON.stringify({
    entities: [...workspace.entities].sort((a, b) => a.id.localeCompare(b.id)),
    relationships: [...workspace.relationships].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  });
}

function validateProposalGraphChanges(
  workspace: Workspace,
  changes: ProposalChange[],
) {
  if (changes.length === 0)
    throw new AuthorizationError(
      "A proposal must contain at least one change.",
    );
  const baselineEntityIds = new Set(workspace.entities.map(({ id }) => id));
  const newEntityIds = new Set<string>();
  for (const change of changes) {
    if (change.op !== "add-entity") continue;
    requireMeaningfulText(change.entity.id, "Proposed item ID");
    requireMeaningfulText(change.entity.name, "Proposed item name");
    if (
      baselineEntityIds.has(change.entity.id) ||
      newEntityIds.has(change.entity.id)
    )
      throw new AuthorizationError(
        `Proposal reuses entity ID ${change.entity.id}.`,
      );
    newEntityIds.add(change.entity.id);
  }
  const availableEntityIds = new Set([...baselineEntityIds, ...newEntityIds]);
  const relationshipIds = new Set(workspace.relationships.map(({ id }) => id));
  const relationshipKeys = new Set(
    workspace.relationships.map((relationship) =>
      [
        relationship.from,
        relationship.to,
        relationship.type,
        relationship.group ?? "",
      ].join("|"),
    ),
  );
  for (const change of changes) {
    if (change.op === "update-entity") {
      const entity = workspace.entities.find(
        (candidate) => candidate.id === change.entityId,
      );
      if (!entity)
        throw new AuthorizationError(
          `Proposal updates unknown entity ${change.entityId}.`,
        );
      if (!patchMateriallyChangesEntity(entity, change.patch))
        throw new AuthorizationError(
          `Proposal update for ${change.entityId} must change at least one material field.`,
        );
      if (change.patch.name !== undefined)
        requireMeaningfulText(change.patch.name, "Proposed item name");
      continue;
    }
    if (change.op !== "add-relationship") continue;
    const { relationship } = change;
    requireMeaningfulText(relationship.id, "Proposed path ID");
    if (
      !availableEntityIds.has(relationship.from) ||
      !availableEntityIds.has(relationship.to)
    )
      throw new AuthorizationError(
        `Proposal path ${relationship.id} has an unknown endpoint.`,
      );
    if (relationship.from === relationship.to)
      throw new AuthorizationError("Proposal paths cannot be self-links.");
    if (relationshipIds.has(relationship.id))
      throw new AuthorizationError(
        `Proposal reuses relationship ID ${relationship.id}.`,
      );
    relationshipIds.add(relationship.id);
    const key = [
      relationship.from,
      relationship.to,
      relationship.type,
      relationship.group ?? "",
    ].join("|");
    if (relationshipKeys.has(key))
      throw new AuthorizationError(
        `Proposal duplicates the path ${relationship.from} → ${relationship.to}.`,
      );
    relationshipKeys.add(key);
  }
}

function validateRepairOptionGraph(
  workspace: Workspace,
  option: AgentRepairOption,
) {
  if (option.changes.length < 2)
    throw new AuthorizationError(
      `Repair option ${option.optionLabel} must contain at least two connected graph changes.`,
    );

  const baselineEntityIds = new Set(workspace.entities.map(({ id }) => id));
  const proposedEntityIds = new Set<string>();
  const relationshipIds = new Set(workspace.relationships.map(({ id }) => id));
  const affectedEntityIds = new Set<string>();

  for (const change of option.changes) {
    if (change.op === "add-entity") {
      if (
        baselineEntityIds.has(change.entity.id) ||
        proposedEntityIds.has(change.entity.id)
      )
        throw new AuthorizationError(
          `Repair option ${option.optionLabel} reuses entity ID ${change.entity.id}.`,
        );
      proposedEntityIds.add(change.entity.id);
      affectedEntityIds.add(change.entity.id);
    }
  }

  const availableEntityIds = new Set([
    ...baselineEntityIds,
    ...proposedEntityIds,
  ]);
  const connectedProposedEntityIds = new Set<string>();
  const proposedAdjacency = new Map<string, Set<string>>();
  const baselineAnchoredProposedIds = new Set<string>();
  const relationshipKeys = new Set(
    workspace.relationships.map((relationship) =>
      [
        relationship.from,
        relationship.to,
        relationship.type,
        relationship.group ?? "",
      ].join("|"),
    ),
  );

  for (const change of option.changes) {
    if (change.op === "update-entity") {
      const entity = workspace.entities.find(
        (candidate) => candidate.id === change.entityId,
      );
      if (!entity)
        throw new AuthorizationError(
          `Repair option ${option.optionLabel} updates unknown entity ${change.entityId}.`,
        );
      if (!patchMateriallyChangesEntity(entity, change.patch))
        throw new AuthorizationError(
          `Repair option ${option.optionLabel} must materially change ${change.entityId}; empty or unchanged updates do not count.`,
        );
      affectedEntityIds.add(change.entityId);
      continue;
    }
    if (change.op !== "add-relationship") continue;

    const { relationship } = change;
    if (!availableEntityIds.has(relationship.from))
      throw new AuthorizationError(
        `Repair option ${option.optionLabel} has an unknown relationship source ${relationship.from}. Add the item first or use an existing ID.`,
      );
    if (!availableEntityIds.has(relationship.to))
      throw new AuthorizationError(
        `Repair option ${option.optionLabel} has an unknown relationship target ${relationship.to}. Add the item first or use an existing ID.`,
      );
    if (relationship.from === relationship.to)
      throw new AuthorizationError(
        `Repair option ${option.optionLabel} cannot connect an item to itself.`,
      );
    if (relationshipIds.has(relationship.id))
      throw new AuthorizationError(
        `Repair option ${option.optionLabel} reuses relationship ID ${relationship.id}.`,
      );
    relationshipIds.add(relationship.id);
    const relationshipKey = [
      relationship.from,
      relationship.to,
      relationship.type,
      relationship.group ?? "",
    ].join("|");
    if (relationshipKeys.has(relationshipKey))
      throw new AuthorizationError(
        `Repair option ${option.optionLabel} duplicates an existing or proposed path.`,
      );
    relationshipKeys.add(relationshipKey);
    affectedEntityIds.add(relationship.from);
    affectedEntityIds.add(relationship.to);
    if (proposedEntityIds.has(relationship.from))
      connectedProposedEntityIds.add(relationship.from);
    if (proposedEntityIds.has(relationship.to))
      connectedProposedEntityIds.add(relationship.to);
    if (proposedEntityIds.has(relationship.from)) {
      if (baselineEntityIds.has(relationship.to))
        baselineAnchoredProposedIds.add(relationship.from);
      if (proposedEntityIds.has(relationship.to)) {
        const fromNeighbors =
          proposedAdjacency.get(relationship.from) ?? new Set<string>();
        fromNeighbors.add(relationship.to);
        proposedAdjacency.set(relationship.from, fromNeighbors);
        const toNeighbors =
          proposedAdjacency.get(relationship.to) ?? new Set<string>();
        toNeighbors.add(relationship.from);
        proposedAdjacency.set(relationship.to, toNeighbors);
      }
    }
    if (
      proposedEntityIds.has(relationship.to) &&
      baselineEntityIds.has(relationship.from)
    )
      baselineAnchoredProposedIds.add(relationship.to);
  }

  const orphanedProposedIds = [...proposedEntityIds].filter(
    (id) => !connectedProposedEntityIds.has(id),
  );
  if (orphanedProposedIds.length)
    throw new AuthorizationError(
      `Repair option ${option.optionLabel} must connect every new item. Missing paths for: ${orphanedProposedIds.join(", ")}.`,
    );
  const reachableProposedIds = new Set(baselineAnchoredProposedIds);
  const queue = [...baselineAnchoredProposedIds];
  while (queue.length) {
    const current = queue.shift()!;
    for (const neighbor of proposedAdjacency.get(current) ?? []) {
      if (reachableProposedIds.has(neighbor)) continue;
      reachableProposedIds.add(neighbor);
      queue.push(neighbor);
    }
  }
  const unanchoredProposedIds = [...proposedEntityIds].filter(
    (id) => !reachableProposedIds.has(id),
  );
  if (unanchoredProposedIds.length)
    throw new AuthorizationError(
      `Repair option ${option.optionLabel} must connect every new item to the existing company graph. Unanchored: ${unanchoredProposedIds.join(", ")}.`,
    );
  if (affectedEntityIds.size < 3)
    throw new AuthorizationError(
      `Repair option ${option.optionLabel} must change at least three graph items.`,
    );
}

function repairOptionSignature(option: AgentRepairOption) {
  return option.changes
    .map((change) => {
      if (change.op === "add-entity")
        return `entity:${change.entity.type}:${change.entity.name.trim().toLowerCase()}`;
      if (change.op === "add-relationship")
        return [
          "path",
          change.relationship.from,
          change.relationship.to,
          change.relationship.type,
          change.relationship.group ?? "",
        ].join(":");
      return `update:${change.entityId}:${JSON.stringify(change.patch)}`;
    })
    .sort()
    .join("|");
}

export class WorkspaceService {
  constructor(private readonly repository: WorkspaceRepository) {}

  private priorProposal(
    workspace: Workspace,
    token: string,
    fingerprint: string,
  ) {
    const prior = workspace.proposals.find(
      (proposal) => proposal.idempotencyToken === token,
    );
    if (!prior) return undefined;
    if (prior.idempotencyFingerprint !== fingerprint)
      throw new IdempotencyConflictError(
        "This idempotency key was already used with a different request payload.",
      );
    return prior;
  }

  private proposalDraftResult(proposal: Proposal, workspace: Workspace) {
    return { ...proposal, workspaceVersion: workspace.version };
  }

  private repairDraftResult(proposals: Proposal[], workspace: Workspace) {
    return Object.assign(proposals, { workspaceVersion: workspace.version });
  }

  private async saveProposalWithReplay(
    scope: string,
    slug: string,
    workspace: Workspace,
    expectedVersion: number,
    token: string,
    fingerprint: string,
    proposal: Proposal,
  ) {
    try {
      await this.repository.save(scope, workspace, expectedVersion);
    } catch (error) {
      if (error instanceof VersionConflictError) {
        const current = await this.get(scope, slug);
        const replay = this.priorProposal(current, token, fingerprint);
        if (replay) return this.proposalDraftResult(replay, current);
      }
      throw error;
    }
    return this.proposalDraftResult(proposal, workspace);
  }

  async get(scope: string, slug: string) {
    const workspace = await this.repository.get(scope, slug);
    if (!workspace) throw new NotFoundError("Workspace not found.");
    return workspace;
  }

  async list(scope: string) {
    return this.repository.list(scope);
  }

  async validate(scope: string, slug: string, expectedVersion?: number) {
    const workspace = await this.get(scope, slug);
    if (expectedVersion !== undefined && workspace.version !== expectedVersion)
      throw new VersionConflictError(workspace.version);
    return validateContinuityMap(workspace);
  }

  async getWorkspaceOverview(scope: string, slug: string) {
    const workspace = await this.get(scope, slug);
    const scenario = workspace.scenarios[0];
    return {
      workspace,
      validation: validateContinuityMap(workspace),
      simulation: scenario ? simulateDisruption(workspace, scenario) : null,
    };
  }

  async simulate(
    scope: string,
    slug: string,
    scenario: Scenario,
    expectedVersion?: number,
  ) {
    const workspace = await this.get(scope, slug);
    if (expectedVersion !== undefined && workspace.version !== expectedVersion)
      throw new VersionConflictError(workspace.version);
    requireMeaningfulText(scenario.name, "Scenario name");
    validateScenarioEntityIds(workspace, scenario.unavailableEntityIds);
    return simulateDisruption(workspace, scenario);
  }

  async compare(
    scope: string,
    slug: string,
    scenarioId: string,
    proposalId: string,
    expectedVersion?: number,
  ) {
    const workspace = await this.get(scope, slug);
    if (expectedVersion !== undefined && workspace.version !== expectedVersion)
      throw new VersionConflictError(workspace.version);
    const scenario = workspace.scenarios.find(
      (candidate) => candidate.id === scenarioId,
    );
    const proposal = workspace.proposals.find(
      (candidate) => candidate.id === proposalId,
    );
    if (!scenario || !proposal)
      throw new NotFoundError("Scenario or proposal not found.");
    return {
      workspaceVersion: workspace.version,
      ...compareProposal(workspace, scenario, proposal.changes),
    };
  }

  async stageAgentRepairOptions(
    scope: string,
    slug: string,
    scenarioId: string,
    version: number,
    idempotencyKey: string,
    options: AgentRepairOption[],
  ) {
    const workspace = await this.get(scope, slug);
    const optionGroupId = `repair:${idempotencyKey}`;
    const idempotencyFingerprint = await requestFingerprint({
      scenarioId,
      options,
    });
    const prior = workspace.proposals.filter(
      (proposal) => proposal.optionGroupId === optionGroupId,
    );
    if (prior.length) {
      if (
        prior.some(
          (proposal) =>
            proposal.idempotencyFingerprint !== idempotencyFingerprint,
        )
      )
        throw new IdempotencyConflictError(
          "This repair idempotency key was already used with a different option set.",
        );
      return this.repairDraftResult(prior, workspace);
    }
    if (workspace.version !== version)
      throw new VersionConflictError(workspace.version);
    const scenario = workspace.scenarios.find(
      (candidate) => candidate.id === scenarioId,
    );
    if (!scenario) throw new NotFoundError("Scenario not found.");
    const before = simulateDisruption(workspace, scenario);
    if (before.blockedWorkflowIds.length === 0)
      throw new AuthorizationError("This scenario is already contained.");

    const labels = new Set<string>();
    const optionSignatures = new Set<string>();
    const proposals = options.map((option) => {
      const normalizedLabel = requireMeaningfulText(
        option.optionLabel,
        "Repair option label",
      );
      requireMeaningfulText(
        option.title,
        `Repair option ${normalizedLabel} title`,
      );
      requireMeaningfulText(
        option.rationale,
        `Repair option ${normalizedLabel} rationale`,
      );
      requireMeaningfulText(
        option.tradeoff.summary,
        `Repair option ${normalizedLabel} tradeoff summary`,
      );
      option.assumptions.forEach((assumption) =>
        requireMeaningfulText(
          assumption,
          `Repair option ${normalizedLabel} assumption`,
        ),
      );
      const labelKey = normalizedLabel.toLowerCase();
      if (labels.has(labelKey))
        throw new AuthorizationError("Repair option labels must be unique.");
      labels.add(labelKey);
      validateRepairOptionGraph(workspace, option);
      const signature = repairOptionSignature(option);
      if (optionSignatures.has(signature))
        throw new AuthorizationError(
          `Repair option ${option.optionLabel} duplicates another strategy.`,
        );
      optionSignatures.add(signature);
      const changes: ProposalChange[] = option.changes.map((change, index) => {
        if (change.op === "add-entity")
          return {
            op: change.op,
            entity: {
              ...change.entity,
              trust: "INFERRED",
              image:
                change.entity.image ??
                reviewedAssetForType(change.entity.type, index),
            },
          };
        if (change.op === "add-relationship")
          return {
            op: change.op,
            relationship: { ...change.relationship, trust: "INFERRED" },
          };
        return {
          op: change.op,
          entityId: change.entityId,
          patch: { ...change.patch, trust: "INFERRED" },
        };
      });
      validateProposalGraphChanges(workspace, changes);
      const comparison = compareProposal(workspace, scenario, changes);
      if (comparison.after.blockedWorkflowIds.length > 0)
        throw new AuthorizationError(
          `Repair option ${option.optionLabel} is incomplete: ${comparison.after.blockedWorkflowIds.length} critical workflow${comparison.after.blockedWorkflowIds.length === 1 ? " remains" : "s remain"} blocked.`,
        );
      return {
        id: unique("proposal"),
        title: option.title,
        rationale: option.rationale,
        status: "PROPOSED" as const,
        changes,
        createdBy: "agent" as const,
        baseVersion: workspace.version,
        baselineFingerprint: baselineFingerprint(workspace),
        assumptions: option.assumptions,
        createdAt: now(),
        kind: "REPAIR" as const,
        scenarioId,
        optionGroupId,
        optionLabel: option.optionLabel,
        strategy: option.title,
        tradeoff: option.tradeoff,
        idempotencyFingerprint,
      } satisfies Proposal;
    });
    workspace.proposals.unshift(...proposals);
    workspace.version += 1;
    activity(
      workspace,
      "REPAIR_OPTIONS_CREATED",
      `${proposals.length} agent-authored repair options staged for ${scenario.name}. Baseline unchanged.`,
      "agent",
    );
    try {
      await this.repository.save(scope, workspace, version);
    } catch (error) {
      if (error instanceof VersionConflictError) {
        const current = await this.get(scope, slug);
        const replay = current.proposals.filter(
          (proposal) => proposal.optionGroupId === optionGroupId,
        );
        if (
          replay.length > 0 &&
          replay.every(
            (proposal) =>
              proposal.idempotencyFingerprint === idempotencyFingerprint,
          )
        )
          return this.repairDraftResult(replay, current);
      }
      throw error;
    }
    return this.repairDraftResult(proposals, workspace);
  }

  async draft(
    scope: string,
    slug: string,
    version: number,
    idempotencyKey: string,
    entities: Entity[],
    relationships: Relationship[],
  ) {
    const workspace = await this.get(scope, slug);
    const token = `map-draft:${idempotencyKey}`;
    const idempotencyFingerprint = await requestFingerprint({
      entities: entities.map((entity) =>
        Object.fromEntries(
          Object.entries(entity).filter(
            ([key]) => key !== "id" && key !== "trust",
          ),
        ),
      ),
      relationships: relationships.map((relationship) =>
        Object.fromEntries(
          Object.entries(relationship).filter(
            ([key]) => key !== "id" && key !== "trust",
          ),
        ),
      ),
    });
    const prior = this.priorProposal(workspace, token, idempotencyFingerprint);
    if (prior) return this.proposalDraftResult(prior, workspace);
    if (workspace.version !== version)
      throw new VersionConflictError(workspace.version);
    const changes: ProposalChange[] = [
      ...entities.map((entity) => ({
        op: "add-entity" as const,
        entity: { ...entity, trust: "INFERRED" as const },
      })),
      ...relationships.map((relationship) => ({
        op: "add-relationship" as const,
        relationship: { ...relationship, trust: "INFERRED" as const },
      })),
    ];
    validateProposalGraphChanges(workspace, changes);
    const proposal: Proposal = {
      id: unique("draft"),
      title: "Agent map draft",
      rationale:
        "Structured from the user’s description. Review every inferred fact.",
      status: "PROPOSED",
      changes,
      createdBy: "agent",
      baseVersion: workspace.version,
      baselineFingerprint: baselineFingerprint(workspace),
      assumptions: ["Names and relationships are inferred, not verified."],
      createdAt: now(),
      kind: "MAP_DRAFT",
      idempotencyToken: token,
      idempotencyFingerprint,
    };
    workspace.proposals.unshift(proposal);
    workspace.version += 1;
    activity(
      workspace,
      "DRAFT_CREATED",
      `${proposal.changes.length} inferred map changes staged.`,
      "agent",
    );
    return this.saveProposalWithReplay(
      scope,
      slug,
      workspace,
      version,
      token,
      idempotencyFingerprint,
      proposal,
    );
  }

  async draftCompanyBlueprint(
    scope: string,
    slug: string,
    version: number,
    idempotencyKey: string,
    companyName: string,
    companySummary: string,
    entities: Array<{
      ref: string;
      name: string;
      type: Entity["type"];
      description: string;
      role?: string;
      team?: string;
      critical: boolean;
    }>,
    relationships: Array<{
      fromRef: string;
      toRef: string;
      type: Relationship["type"];
      group?: string;
      label?: string;
    }>,
  ) {
    const workspace = await this.get(scope, slug);
    const token = `company-blueprint:${idempotencyKey}`;
    const idempotencyFingerprint = await requestFingerprint({
      companyName,
      companySummary,
      entities,
      relationships,
    });
    const coverage = inspectBlueprintCoverage(entities, relationships);
    const prior = this.priorProposal(workspace, token, idempotencyFingerprint);
    if (prior)
      return {
        ...this.proposalDraftResult(prior, workspace),
        coverage,
      };
    if (workspace.version !== version)
      throw new VersionConflictError(workspace.version);
    requireMeaningfulText(companyName, "Blueprint company name");
    requireMeaningfulText(companySummary, "Blueprint company summary");
    if (workspace.entities.length > 0 || workspace.relationships.length > 0)
      throw new AuthorizationError(
        "A complete company blueprint can only establish an empty baseline. Use focused draft tools to extend an existing map.",
      );
    if (
      workspace.proposals.some(
        (proposal) =>
          proposal.status === "PROPOSED" && proposal.kind === "MAP_DRAFT",
      )
    )
      throw new AuthorizationError(
        "Review or discard the existing map draft before staging another complete blueprint.",
      );
    const refs = new Set<string>();
    for (const entity of entities) {
      const ref = requireMeaningfulText(entity.ref, "Blueprint item reference");
      if (!/[a-z0-9]/i.test(ref))
        throw new InputValidationError(
          `Blueprint reference ${entity.ref} must contain a letter or number.`,
        );
      requireMeaningfulText(entity.name, `Blueprint item ${ref} name`);
      requireMeaningfulText(
        entity.description,
        `Blueprint item ${ref} description`,
      );
      if (refs.has(entity.ref))
        throw new AuthorizationError(
          `Blueprint reference ${entity.ref} is duplicated.`,
        );
      refs.add(entity.ref);
    }
    const relationshipKeys = new Set<string>();
    for (const relationship of relationships) {
      if (!refs.has(relationship.fromRef) || !refs.has(relationship.toRef))
        throw new NotFoundError(
          `Blueprint relationship ${relationship.fromRef} → ${relationship.toRef} has an unknown endpoint.`,
        );
      if (relationship.fromRef === relationship.toRef)
        throw new AuthorizationError(
          "Blueprint relationships must connect two different items.",
        );
      const relationshipKey = [
        relationship.fromRef,
        relationship.toRef,
        relationship.type,
        relationship.group ?? "",
      ].join("|");
      if (relationshipKeys.has(relationshipKey))
        throw new AuthorizationError(
          `Blueprint connection ${relationship.fromRef} → ${relationship.toRef} is duplicated.`,
        );
      relationshipKeys.add(relationshipKey);
    }
    if (coverage.componentCount > 1) {
      const disconnected = coverage.disconnectedComponents
        .slice(1)
        .flat()
        .slice(0, 8)
        .join(", ");
      throw new AuthorizationError(
        `Blueprint must be one connected map. Connect the disconnected item refs: ${disconnected}.`,
      );
    }
    if (coverage.reviewPrompts.length > 0)
      throw new AuthorizationError(
        `Blueprint is incomplete. ${coverage.reviewPrompts.join(" ")}`,
      );
    const idByRef = new Map(
      entities.map((entity) => [
        entity.ref,
        `blueprint-${entity.ref
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "")
          .slice(0, 36)}-${crypto.randomUUID().slice(0, 5)}`,
      ]),
    );
    const proposedEntities: Entity[] = entities.map((entity, index) => ({
      id: idByRef.get(entity.ref)!,
      name: entity.name,
      type: entity.type,
      description: entity.description,
      ...(entity.role ? { role: entity.role } : {}),
      ...(entity.team ? { team: entity.team } : {}),
      critical: entity.critical,
      trust: "INFERRED",
      image: reviewedAssetForType(entity.type, index),
    }));
    const proposedRelationships: Relationship[] = relationships.map(
      (relationship) => ({
        id: unique("blueprint-path"),
        from: idByRef.get(relationship.fromRef)!,
        to: idByRef.get(relationship.toRef)!,
        type: relationship.type,
        trust: "INFERRED",
        ...(relationship.group ? { group: relationship.group } : {}),
        ...(relationship.label ? { label: relationship.label } : {}),
      }),
    );
    const proposal: Proposal = {
      id: unique("blueprint"),
      title: `Build ${companyName} continuity map`,
      rationale: companySummary,
      status: "PROPOSED",
      changes: [
        ...proposedEntities.map((entity) => ({
          op: "add-entity" as const,
          entity,
        })),
        ...proposedRelationships.map((relationship) => ({
          op: "add-relationship" as const,
          relationship,
        })),
      ],
      createdBy: "agent",
      baseVersion: workspace.version,
      baselineFingerprint: baselineFingerprint(workspace),
      assumptions: [
        "The blueprint is inferred from the company description and requires human review.",
        "Images are contextual placeholders, not evidence.",
        "Access, ownership, and recovery paths remain unverified until attested.",
      ],
      createdAt: now(),
      kind: "MAP_DRAFT",
      idempotencyToken: token,
      idempotencyFingerprint,
    };
    validateProposalGraphChanges(workspace, proposal.changes);
    workspace.proposals.unshift(proposal);
    workspace.version += 1;
    activity(
      workspace,
      "COMPANY_BLUEPRINT_STAGED",
      `${proposedEntities.length} items and ${proposedRelationships.length} connections staged for review.`,
      "agent",
    );
    const result = await this.saveProposalWithReplay(
      scope,
      slug,
      workspace,
      version,
      token,
      idempotencyFingerprint,
      proposal,
    );
    return { ...result, coverage };
  }

  async customizeProposal(
    scope: string,
    slug: string,
    proposalId: string,
    version: number,
    title: string,
    relationshipTargets: Array<{ changeIndex: number; to: string }>,
    entityNames: Array<{ changeIndex: number; name: string }>,
  ) {
    const workspace = await this.get(scope, slug);
    if (workspace.version !== version)
      throw new VersionConflictError(workspace.version);
    const proposal = workspace.proposals.find(
      (candidate) => candidate.id === proposalId,
    );
    if (!proposal) throw new NotFoundError("Proposal not found.");
    if (proposal.status !== "PROPOSED")
      throw new AuthorizationError("Only a proposed draft can be edited.");
    if (
      proposal.baselineFingerprint &&
      proposal.baselineFingerprint !== baselineFingerprint(workspace)
    )
      throw new AuthorizationError(
        "The baseline changed after this proposal was staged. Create a fresh proposal before editing it.",
      );
    const originalProposal = stableJson(proposal);
    const normalizedTitle = requireMeaningfulText(title, "Proposal title");
    const proposedEntityIds = new Set(
      proposal.changes.flatMap((change) =>
        change.op === "add-entity" ? [change.entity.id] : [],
      ),
    );
    const validTargets = new Set([
      ...workspace.entities.map((entity) => entity.id),
      ...proposedEntityIds,
    ]);
    for (const edit of relationshipTargets) {
      const change = proposal.changes[edit.changeIndex];
      if (!change || change.op !== "add-relationship")
        throw new NotFoundError("The proposed relationship was not found.");
      if (!validTargets.has(edit.to))
        throw new NotFoundError("The selected fallback was not found.");
      if (change.relationship.from === edit.to)
        throw new AuthorizationError(
          "A fallback cannot point back to the same item.",
        );
      change.relationship.to = edit.to;
    }
    for (const edit of entityNames) {
      const change = proposal.changes[edit.changeIndex];
      if (!change || change.op !== "add-entity")
        throw new NotFoundError("The proposed item was not found.");
      change.entity.name = requireMeaningfulText(
        edit.name,
        "Proposed item name",
      );
    }
    proposal.title = normalizedTitle;
    if (stableJson(proposal) === originalProposal)
      throw new InputValidationError(
        "The proposal edit must change at least one field.",
      );
    validateProposalGraphChanges(workspace, proposal.changes);
    if (proposal.scenarioId) {
      const scenario = workspace.scenarios.find(
        (candidate) => candidate.id === proposal.scenarioId,
      );
      if (!scenario) throw new NotFoundError("Scenario not found.");
      const result = compareProposal(workspace, scenario, proposal.changes);
      if (result.after.blockedWorkflowIds.length > 0)
        throw new AuthorizationError(
          "This edit reopens a blocked workflow. Choose another fallback before saving.",
        );
      if (proposal.tradeoff)
        proposal.tradeoff.summary =
          "Human-adjusted option. The deterministic recheck still restores every blocked workflow.";
    }
    workspace.version += 1;
    activity(
      workspace,
      "PROPOSAL_CUSTOMIZED",
      `${proposal.title} edited by a human. Baseline unchanged.`,
      "human",
    );
    await this.repository.save(scope, workspace, version);
    return { workspace, proposal };
  }

  async decideProposal(
    scope: string,
    slug: string,
    proposalId: string,
    version: number,
    decision: "ACCEPTED" | "REJECTED",
    actor: "human" | "agent",
  ) {
    if (actor !== "human")
      throw new AuthorizationError(
        "Only a visible human action can decide a proposal.",
      );
    const workspace = await this.get(scope, slug);
    if (workspace.version !== version)
      throw new VersionConflictError(workspace.version);
    const proposal = workspace.proposals.find(
      (candidate) => candidate.id === proposalId,
    );
    if (!proposal) throw new NotFoundError("Proposal not found.");
    if (proposal.status !== "PROPOSED") return workspace;
    if (
      decision === "ACCEPTED" &&
      proposal.baselineFingerprint &&
      proposal.baselineFingerprint !== baselineFingerprint(workspace)
    )
      throw new AuthorizationError(
        "The baseline changed after this proposal was staged. Review a fresh proposal before applying changes.",
      );
    const repairComparison = proposal.scenarioId
      ? (() => {
          const scenario = workspace.scenarios.find(
            (candidate) => candidate.id === proposal.scenarioId,
          );
          return scenario
            ? {
                scenario,
                result: compareProposal(workspace, scenario, proposal.changes),
              }
            : undefined;
        })()
      : undefined;
    proposal.status = decision;
    if (decision === "ACCEPTED") {
      validateProposalGraphChanges(workspace, proposal.changes);
      if (
        repairComparison &&
        repairComparison.result.after.blockedWorkflowIds.length > 0
      )
        throw new AuthorizationError(
          "This repair no longer restores every blocked workflow. Draft a fresh option.",
        );
      const applied = applyProposalChanges(workspace, proposal.changes);
      workspace.entities = applied.entities;
      workspace.relationships = applied.relationships;
      if (proposal.optionGroupId) {
        for (const sibling of workspace.proposals) {
          if (
            sibling.id !== proposal.id &&
            sibling.optionGroupId === proposal.optionGroupId &&
            sibling.status === "PROPOSED"
          )
            sibling.status = "REJECTED";
        }
      }
      if (repairComparison) {
        const residualBlockedWorkflowIds =
          repairComparison.result.after.blockedWorkflowIds;
        repairComparison.scenario.resolution = {
          status:
            residualBlockedWorkflowIds.length === 0 ? "RESOLVED" : "PARTIAL",
          proposalId: proposal.id,
          resolvedAt: now(),
          restoredWorkflowIds: repairComparison.result.restoredWorkflowIds,
          residualBlockedWorkflowIds,
        };
      }
    }
    workspace.version += 1;
    activity(workspace, `PROPOSAL_${decision}`, `${proposal.title}.`, "human");
    await this.repository.save(scope, workspace, version);
    return workspace;
  }

  async resetDemo(scope: string, slug: string) {
    return this.repository.resetDemo(scope, slug);
  }

  async create(
    scope: string,
    name: string,
    options: {
      idempotencyKey?: string;
      actor?: ActivityEntry["actor"];
      setupMode?: "manual" | "agent-blueprint";
    } = {},
  ) {
    const normalizedName = requireMeaningfulText(name, "Company name");
    const creationIdempotencyFingerprint = options.idempotencyKey
      ? await requestFingerprint({
          name: normalizedName,
          setupMode: options.setupMode ?? "manual",
        })
      : undefined;
    const baseSlug =
      normalizedName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "company";
    const slug = options.idempotencyKey
      ? `company-${(
          await requestFingerprint({
            operation: "create-company",
            key: options.idempotencyKey,
          })
        ).slice(0, 20)}`
      : `${baseSlug}-${crypto.randomUUID().slice(0, 4)}`;
    if (options.idempotencyKey) {
      const existing = await this.repository.get(scope, slug);
      if (existing && !existing.fictional) {
        if (
          existing.creationIdempotencyFingerprint
            ? existing.creationIdempotencyFingerprint !==
              creationIdempotencyFingerprint
            : existing.name.trim().replace(/\s+/g, " ") !== normalizedName
        )
          throw new IdempotencyConflictError(
            "This company idempotency key was already used with a different request payload.",
          );
        return existing;
      }
    }
    const workspace: Workspace = {
      id: unique("workspace"),
      slug,
      name: normalizedName,
      tagline: "Map the dependency. Rehearse the absence.",
      sector: "custom",
      fictional: false,
      version: 1,
      entities: [],
      relationships: [],
      scenarios: [],
      proposals: [],
      archived: false,
      ...(creationIdempotencyFingerprint
        ? { creationIdempotencyFingerprint }
        : {}),
      activity: [
        {
          id: unique("activity"),
          action: "WORKSPACE_CREATED",
          detail:
            options.actor === "agent"
              ? "Empty personal workspace created through a Site Tool. Baseline setup still requires human review."
              : "Empty personal workspace created.",
          actor: options.actor ?? "human",
          at: now(),
          version: 1,
        },
      ],
    };
    try {
      await this.repository.save(scope, workspace, 0);
    } catch (error) {
      if (options.idempotencyKey && error instanceof VersionConflictError) {
        const existing = await this.repository.get(scope, slug);
        if (existing && !existing.fictional) {
          if (
            existing.creationIdempotencyFingerprint
              ? existing.creationIdempotencyFingerprint !==
                creationIdempotencyFingerprint
              : existing.name.trim().replace(/\s+/g, " ") !== normalizedName
          )
            throw new IdempotencyConflictError(
              "This company idempotency key was already used with a different request payload.",
            );
          return existing;
        }
      }
      throw error;
    }
    return workspace;
  }

  async duplicate(scope: string, sourceSlug: string) {
    const source = cloneDemo(sourceSlug);
    if (!source) throw new NotFoundError("Demo workspace not found.");
    const suffix = crypto.randomUUID().slice(0, 4);
    const workspace: Workspace = {
      ...structuredClone(source),
      id: unique("workspace"),
      slug: `${source.slug}-copy-${suffix}`,
      name: `${source.name} copy`,
      fictional: false,
      sector: "custom",
      version: 1,
      proposals: [],
      archived: false,
      activity: [
        {
          id: unique("activity"),
          action: "WORKSPACE_DUPLICATED",
          detail: `Editable copy created from the fictional ${source.name} demo.`,
          actor: "human",
          at: now(),
          version: 1,
        },
      ],
    };
    await this.repository.save(scope, workspace, 0);
    return workspace;
  }

  async updateWorkspace(
    scope: string,
    slug: string,
    version: number,
    input: { name?: string; archived?: boolean },
  ) {
    const workspace = await this.get(scope, slug);
    if (workspace.fictional)
      throw new AuthorizationError(
        "Demo workspaces cannot be renamed or archived. Duplicate the demo first.",
      );
    if (workspace.version !== version)
      throw new VersionConflictError(workspace.version);
    const nextName =
      input.name !== undefined
        ? requireMeaningfulText(input.name, "Company name")
        : workspace.name;
    const nextArchived = input.archived ?? Boolean(workspace.archived);
    if (
      nextName === workspace.name &&
      nextArchived === Boolean(workspace.archived)
    )
      throw new InputValidationError(
        "The workspace update must change at least one field.",
      );
    if (input.name !== undefined) workspace.name = nextName;
    if (input.archived !== undefined) workspace.archived = input.archived;
    workspace.version += 1;
    activity(
      workspace,
      "WORKSPACE_UPDATED",
      input.archived
        ? "Workspace archived."
        : input.name
          ? `Workspace renamed to ${workspace.name}.`
          : "Workspace restored.",
      "human",
    );
    await this.repository.save(scope, workspace, version);
    return workspace;
  }

  async deleteWorkspace(scope: string, slug: string, version: number) {
    const workspace = await this.get(scope, slug);
    if (workspace.fictional)
      throw new AuthorizationError(
        "Demo workspaces cannot be deleted. Duplicate the demo first.",
      );
    if (workspace.version !== version)
      throw new VersionConflictError(workspace.version);
    await this.repository.delete(scope, slug, version);
  }

  async addEntity(
    scope: string,
    slug: string,
    version: number,
    input: Omit<Entity, "id" | "trust">,
  ) {
    const workspace = await this.get(scope, slug);
    if (workspace.fictional)
      throw new AuthorizationError("Duplicate the demo before editing it.");
    if (workspace.version !== version)
      throw new VersionConflictError(workspace.version);
    const entity: Entity = {
      ...input,
      name: requireMeaningfulText(input.name, "Item name"),
      id: unique("entity"),
      trust: "DECLARED",
    };
    workspace.entities.push(entity);
    workspace.version += 1;
    activity(
      workspace,
      "ENTITY_CREATED",
      `${entity.name} declared as ${entity.type}.`,
      "human",
    );
    await this.repository.save(scope, workspace, version);
    return { workspace, entity };
  }

  async updateEntity(
    scope: string,
    slug: string,
    entityId: string,
    version: number,
    patch: Partial<Omit<Entity, "id" | "trust">>,
  ) {
    const workspace = await this.get(scope, slug);
    if (workspace.fictional)
      throw new AuthorizationError("Duplicate the demo before editing it.");
    if (workspace.version !== version)
      throw new VersionConflictError(workspace.version);
    const entity = workspace.entities.find((item) => item.id === entityId);
    if (!entity) throw new NotFoundError("Entity not found.");
    if (patch.name !== undefined)
      patch = {
        ...patch,
        name: requireMeaningfulText(patch.name, "Item name"),
      };
    if (!patchMateriallyChangesEntity(entity, patch))
      throw new InputValidationError(
        "The item update must change at least one material field.",
      );
    const metadata = patch.metadata
      ? { ...entity.metadata, ...patch.metadata }
      : entity.metadata;
    Object.assign(entity, patch, { metadata });
    if (entity.trust === "VERIFIED") {
      entity.trust = "STALE";
      entity.metadata = { ...entity.metadata, verificationStatus: "STALE" };
    }
    workspace.version += 1;
    activity(
      workspace,
      "ENTITY_UPDATED",
      `${entity.name} was edited and queued for reverification.`,
      "human",
    );
    await this.repository.save(scope, workspace, version);
    return { workspace, entity };
  }

  async createScenario(
    scope: string,
    slug: string,
    version: number,
    input: Omit<Scenario, "id" | "createdAt"> & { id?: string },
  ) {
    const workspace = await this.get(scope, slug);
    if (workspace.version !== version)
      throw new VersionConflictError(workspace.version);
    validateScenarioEntityIds(workspace, input.unavailableEntityIds);
    const scenarioId = input.id ?? unique("scenario");
    if (workspace.scenarios.some((candidate) => candidate.id === scenarioId))
      throw new InputValidationError("A scenario with this ID already exists.");
    const scenario: Scenario = {
      ...input,
      id: scenarioId,
      name: requireMeaningfulText(input.name, "Scenario name"),
      context: input.context.trim(),
      draft: input.createdBy === "agent" ? true : Boolean(input.draft),
      createdAt: now(),
    };
    workspace.scenarios.unshift(scenario);
    workspace.version += 1;
    activity(
      workspace,
      "SCENARIO_SAVED",
      `${scenario.name} saved with ${scenario.unavailableEntityIds.length} unavailable item${scenario.unavailableEntityIds.length === 1 ? "" : "s"}.`,
      input.createdBy,
    );
    await this.repository.save(scope, workspace, version);
    return { workspace, scenario };
  }

  async createAgentScenarioDraft(
    scope: string,
    slug: string,
    version: number,
    idempotencyKey: string,
    input: AgentScenarioInput,
  ) {
    return this.stageAgentScenarioSet(
      scope,
      slug,
      version,
      idempotencyKey,
      [input],
      "single",
    );
  }

  async designAgentScenarios(
    scope: string,
    slug: string,
    version: number,
    idempotencyKey: string,
    inputs: AgentScenarioInput[],
  ) {
    return this.stageAgentScenarioSet(
      scope,
      slug,
      version,
      idempotencyKey,
      inputs,
      "library",
    );
  }

  private async stageAgentScenarioSet(
    scope: string,
    slug: string,
    version: number,
    idempotencyKey: string,
    inputs: AgentScenarioInput[],
    mode: "single" | "library",
  ) {
    const workspace = await this.get(scope, slug);
    const minimum = mode === "single" ? 1 : 3;
    const maximum = mode === "single" ? 1 : 5;
    if (inputs.length < minimum || inputs.length > maximum)
      throw new AuthorizationError(
        mode === "single"
          ? "A single scenario request must contain exactly one draft."
          : "A scenario library must contain three to five materially different drafts.",
      );
    for (const input of inputs) {
      requireMeaningfulText(input.name, "Scenario name");
      requireMeaningfulText(input.context, `Scenario ${input.name} context`);
      validateScenarioEntityIds(workspace, input.unavailableEntityIds);
    }
    const normalizedInputs = inputs.map(normalizeScenarioInput);
    const idempotencyFingerprint = await requestFingerprint(
      [...normalizedInputs].sort((left, right) =>
        stableJson(left).localeCompare(stableJson(right)),
      ),
    );
    const designGroupId = `${
      mode === "single" ? "scenario-single" : "scenario-design"
    }:${idempotencyKey}`;
    const prior = workspace.scenarios.filter(
      (scenario) => scenario.designGroupId === designGroupId,
    );
    if (prior.length) {
      if (
        prior.some(
          (scenario) =>
            scenario.idempotencyFingerprint !== idempotencyFingerprint,
        )
      )
        throw new IdempotencyConflictError(
          "This scenario idempotency key was already used with a different request payload.",
        );
      return {
        workspace,
        scenarios: prior,
        simulations: prior.map((scenario) =>
          simulateDisruption(workspace, scenario),
        ),
      };
    }
    if (workspace.version !== version)
      throw new VersionConflictError(workspace.version);
    if (workspace.entities.length === 0)
      throw new AuthorizationError(
        "Stage and apply a company map before designing scenarios.",
      );

    const names = new Set<string>();
    const materialSignatures = new Set<string>();
    const scenarios = normalizedInputs.map((input) => {
      const normalizedName = input.name.trim().toLowerCase();
      if (names.has(normalizedName))
        throw new AuthorizationError(
          `Scenario name ${input.name} is duplicated in this design set.`,
        );
      names.add(normalizedName);
      const materialSignature = scenarioMaterialSignature(input);
      if (materialSignatures.has(materialSignature))
        throw new AuthorizationError(
          `Scenario ${input.name} duplicates another scenario's unavailable item set. A scenario library must cover distinct disruptions.`,
        );
      materialSignatures.add(materialSignature);
      return {
        ...input,
        id: unique("scenario"),
        createdBy: "agent" as const,
        draft: true,
        designGroupId,
        idempotencyFingerprint,
        createdAt: now(),
      } satisfies Scenario;
    });
    workspace.scenarios.unshift(...scenarios);
    workspace.version += 1;
    activity(
      workspace,
      "SCENARIO_SET_DESIGNED",
      `${scenarios.length} agent-authored scenario draft${scenarios.length === 1 ? "" : "s"} staged for review. Baseline unchanged.`,
      "agent",
    );
    try {
      await this.repository.save(scope, workspace, version);
    } catch (error) {
      if (error instanceof VersionConflictError) {
        const current = await this.get(scope, slug);
        const replay = current.scenarios.filter(
          (scenario) => scenario.designGroupId === designGroupId,
        );
        if (
          replay.length > 0 &&
          replay.every(
            (scenario) =>
              scenario.idempotencyFingerprint === idempotencyFingerprint,
          )
        )
          return {
            workspace: current,
            scenarios: replay,
            simulations: replay.map((scenario) =>
              simulateDisruption(current, scenario),
            ),
          };
      }
      throw error;
    }
    return {
      workspace,
      scenarios,
      simulations: scenarios.map((scenario) =>
        simulateDisruption(workspace, scenario),
      ),
    };
  }

  private async stageRulesProposal(
    scope: string,
    workspace: Workspace,
    version: number,
    idempotencyKey: string,
    operation: "delegation" | "schedule",
    title: string,
    rationale: string,
    changes: ProposalChange[],
    assumptions: string[],
  ) {
    const token = `${operation}:${idempotencyKey}`;
    const idempotencyFingerprint = await requestFingerprint({
      title,
      rationale,
      changes: changes.map((change) =>
        change.op === "add-relationship"
          ? {
              ...change,
              relationship: {
                ...change.relationship,
                id: "request-generated",
              },
            }
          : change,
      ),
      assumptions,
    });
    const prior = this.priorProposal(workspace, token, idempotencyFingerprint);
    if (prior) return this.proposalDraftResult(prior, workspace);
    if (workspace.version !== version)
      throw new VersionConflictError(workspace.version);
    validateProposalGraphChanges(workspace, changes);
    const proposal: Proposal = {
      id: unique("proposal"),
      title,
      rationale,
      status: "PROPOSED",
      changes,
      createdBy: "system",
      baseVersion: workspace.version,
      baselineFingerprint: baselineFingerprint(workspace),
      assumptions,
      createdAt: now(),
      kind: operation === "delegation" ? "DELEGATION" : "SCHEDULE",
      idempotencyToken: token,
      idempotencyFingerprint,
    };
    workspace.proposals.unshift(proposal);
    workspace.version += 1;
    activity(
      workspace,
      "PROPOSAL_CREATED",
      `${title}. Baseline unchanged.`,
      "system",
    );
    return this.saveProposalWithReplay(
      scope,
      workspace.slug,
      workspace,
      version,
      token,
      idempotencyFingerprint,
      proposal,
    );
  }

  async draftDelegation(
    scope: string,
    slug: string,
    version: number,
    idempotencyKey: string,
    primaryPersonId: string,
    fallbackPersonId: string,
    responsibilityId?: string,
    note = "",
  ) {
    const workspace = await this.get(scope, slug);
    const primary = workspace.entities.find(
      (entity) => entity.id === primaryPersonId && entity.type === "person",
    );
    const fallback = workspace.entities.find(
      (entity) => entity.id === fallbackPersonId && entity.type === "person",
    );
    if (!primary || !fallback)
      throw new NotFoundError("Both primary and fallback people must exist.");
    if (primary.id === fallback.id)
      throw new AuthorizationError("Fallback must be a different person.");
    const changes: ProposalChange[] = [
      {
        op: "add-relationship",
        relationship: {
          id: unique("proposed"),
          from: fallback.id,
          to: primary.id,
          type: "substitutes-for",
          trust: "INFERRED",
          group: "delegation",
          label: note || "fallback coverage",
        },
      },
    ];
    if (responsibilityId) {
      const responsibility = workspace.entities.find(
        (entity) => entity.id === responsibilityId,
      );
      if (!responsibility)
        throw new NotFoundError("Responsibility was not found.");
      changes.push({
        op: "add-relationship",
        relationship: {
          id: unique("proposed"),
          from: responsibility.id,
          to: fallback.id,
          type: "owned-by",
          trust: "INFERRED",
          group: "delegation",
          label: "proposed fallback owner",
        },
      });
    }
    return this.stageRulesProposal(
      scope,
      workspace,
      version,
      idempotencyKey,
      "delegation",
      `Add ${fallback.name} as fallback for ${primary.name}`,
      "Add a reviewable alternate owner without changing the verified baseline.",
      changes,
      [note || "Coverage scope needs human confirmation."],
    );
  }

  async draftSchedule(
    scope: string,
    slug: string,
    version: number,
    idempotencyKey: string,
    entityId: string,
    dueAt: string,
    note: string,
    executionMode: "human" | "agent" | "shared",
  ) {
    const workspace = await this.get(scope, slug);
    const entity = workspace.entities.find((item) => item.id === entityId);
    if (!entity) throw new NotFoundError("Scheduled item was not found.");
    const normalizedDueAt = dueAt.trim();
    if (
      !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(
        normalizedDueAt,
      ) ||
      !Number.isFinite(Date.parse(normalizedDueAt))
    )
      throw new InputValidationError(
        "The proposed due date must be a valid ISO date or timestamp.",
      );
    return this.stageRulesProposal(
      scope,
      workspace,
      version,
      idempotencyKey,
      "schedule",
      `Reschedule ${entity.name}`,
      "Move the work while preserving a visible audit trail and human approval.",
      [
        {
          op: "update-entity",
          entityId,
          patch: {
            metadata: {
              dueAt: normalizedDueAt,
              rescheduleNote: note,
              executionMode,
            },
          },
        },
      ],
      [note || "The new due date needs owner confirmation."],
    );
  }

  async addRelationship(
    scope: string,
    slug: string,
    version: number,
    input: Omit<Relationship, "id" | "trust">,
  ) {
    const workspace = await this.get(scope, slug);
    if (workspace.fictional)
      throw new AuthorizationError("Duplicate the demo before editing it.");
    if (workspace.version !== version)
      throw new VersionConflictError(workspace.version);
    if (input.from === input.to)
      throw new AuthorizationError(
        "A relationship must connect two different entities.",
      );
    if (
      !workspace.entities.some((entity) => entity.id === input.from) ||
      !workspace.entities.some((entity) => entity.id === input.to)
    )
      throw new NotFoundError(
        "Both relationship endpoints must exist in this workspace.",
      );
    const duplicate = workspace.relationships.some(
      (relationship) =>
        relationship.from === input.from &&
        relationship.to === input.to &&
        relationship.type === input.type,
    );
    if (duplicate)
      throw new AuthorizationError("That relationship already exists.");
    const relationship: Relationship = {
      ...input,
      id: unique("relationship"),
      trust: "DECLARED",
    };
    workspace.relationships.push(relationship);
    workspace.version += 1;
    activity(
      workspace,
      "RELATIONSHIP_CREATED",
      `${workspace.entities.find((entity) => entity.id === input.from)?.name} ${input.type} ${workspace.entities.find((entity) => entity.id === input.to)?.name}.`,
      "human",
    );
    await this.repository.save(scope, workspace, version);
    return { workspace, relationship };
  }
}
