import type {
  ContinuityIssue,
  ProposalChange,
  Relationship,
  Scenario,
  SimulationResult,
  ValidationResult,
  Workspace,
} from "./model";

const causalTypes = new Set<Relationship["type"]>([
  "depends-on",
  "owned-by",
  "administered-by",
  "accessible-by",
  "recovers-via",
  "communicates-through",
  "stored-in",
  "required-by",
]);

function causalRelationships(workspace: Workspace) {
  return workspace.relationships.filter((relationship) =>
    causalTypes.has(relationship.type),
  );
}

function groupRelationships(relationships: Relationship[]) {
  const groups = new Map<string, Relationship[]>();
  for (const relationship of relationships) {
    const key = relationship.group ?? relationship.id;
    groups.set(key, [...(groups.get(key) ?? []), relationship]);
  }
  return groups;
}

export function simulateDisruption(
  workspace: Workspace,
  scenario: Scenario,
): SimulationResult {
  const entityIds = new Set(workspace.entities.map((entity) => entity.id));
  const unavailable = scenario.unavailableEntityIds.filter((id) =>
    entityIds.has(id),
  );
  const blocked = new Set(unavailable);
  const depths: Record<string, number> = Object.fromEntries(
    unavailable.map((id) => [id, 0]),
  );
  const relationships = causalRelationships(workspace);
  let changed = true;

  while (changed) {
    changed = false;
    for (const entity of workspace.entities) {
      if (blocked.has(entity.id)) continue;
      const dependencies = relationships.filter(
        (relationship) => relationship.from === entity.id,
      );
      if (dependencies.length === 0) continue;
      const groups = groupRelationships(dependencies);
      const failedGroup = [...groups.values()].find((group) =>
        group.every((relationship) => blocked.has(relationship.to)),
      );
      if (!failedGroup) continue;
      blocked.add(entity.id);
      depths[entity.id] = Math.min(
        ...failedGroup.map(
          (relationship) => (depths[relationship.to] ?? 0) + 1,
        ),
      );
      changed = true;
    }
  }

  const blockedEntityIds = [...blocked];
  const affectedRelationshipIds = relationships
    .filter(
      (relationship) =>
        blocked.has(relationship.from) || blocked.has(relationship.to),
    )
    .map((relationship) => relationship.id);
  const orderedCascade = Object.entries(depths)
    .reduce<string[][]>((layers, [id, depth]) => {
      (layers[depth] ??= []).push(id);
      return layers;
    }, [])
    .map((layer) => layer.sort());
  const neighborIds = new Set<string>(blockedEntityIds);
  for (const relationship of relationships) {
    if (blocked.has(relationship.from) || blocked.has(relationship.to)) {
      neighborIds.add(relationship.from);
      neighborIds.add(relationship.to);
    }
  }

  return {
    scenarioId: scenario.id,
    workspaceVersion: workspace.version,
    unavailableEntityIds: unavailable,
    blockedEntityIds,
    affectedRelationshipIds,
    blockedWorkflowIds: workspace.entities
      .filter((entity) => entity.type === "workflow" && blocked.has(entity.id))
      .map((entity) => entity.id),
    depths,
    orderedCascade,
    smallestRelevantEntityIds: [...neighborIds],
    assumptions: [
      "A dependency group remains available when at least one verified or declared path in that group remains available.",
      "Unknown facts are reported by validation and are not silently treated as verified.",
      `Disruption lasts ${scenario.durationDays} day${scenario.durationDays === 1 ? "" : "s"}.`,
    ],
  };
}

function findCycles(workspace: Workspace): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const relationship of causalRelationships(workspace)) {
    adjacency.set(relationship.from, [
      ...(adjacency.get(relationship.from) ?? []),
      relationship.to,
    ]);
  }
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (id: string) => {
    if (visiting.has(id)) {
      const index = path.indexOf(id);
      cycles.push(path.slice(index).concat(id));
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    path.push(id);
    for (const next of adjacency.get(id) ?? []) visit(next);
    path.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const entity of workspace.entities) visit(entity.id);
  return cycles;
}

export function validateContinuityMap(workspace: Workspace): ValidationResult {
  const issues: ContinuityIssue[] = [];
  const relationships = causalRelationships(workspace);
  for (const entity of workspace.entities) {
    const dependencies = relationships.filter(
      (relationship) => relationship.from === entity.id,
    );
    const groups = groupRelationships(dependencies);
    for (const [groupName, group] of groups) {
      if (group.length === 1 && entity.critical) {
        issues.push({
          code: "SINGLE_POINT",
          severity: "critical",
          entityIds: [entity.id, group[0]!.to],
          message: `${entity.name} has one path for ${groupName}.`,
        });
      }
    }
    const ownerPaths = workspace.relationships.filter(
      (relationship) =>
        relationship.from === entity.id &&
        ["owned-by", "administered-by", "accessible-by"].includes(
          relationship.type,
        ),
    );
    if (
      entity.critical &&
      !["person", "team", "workflow"].includes(entity.type) &&
      ownerPaths.length === 0
    ) {
      issues.push({
        code: "MISSING_OWNER",
        severity: "warning",
        entityIds: [entity.id],
        message: `${entity.name} has no declared owner.`,
      });
    }
    if (entity.trust === "UNKNOWN") {
      issues.push({
        code: "UNKNOWN_FACT",
        severity: "warning",
        entityIds: [entity.id],
        message: `${entity.name} contains unresolved facts.`,
      });
    }
    if (
      entity.trust === "STALE" ||
      entity.metadata?.verificationStatus === "STALE"
    ) {
      issues.push({
        code: "STALE_RECOVERY",
        severity: "warning",
        entityIds: [entity.id],
        message: `${entity.name} needs renewed verification.`,
      });
    }
    const connected = workspace.relationships.some(
      (relationship) =>
        relationship.from === entity.id || relationship.to === entity.id,
    );
    if (!connected)
      issues.push({
        code: "ORPHAN",
        severity: "info",
        entityIds: [entity.id],
        message: `${entity.name} is not connected.`,
      });
  }
  for (const cycle of findCycles(workspace)) {
    issues.push({
      code: "CYCLE",
      severity: "warning",
      entityIds: cycle,
      message: "A recovery path depends on itself.",
    });
  }
  const codes: ContinuityIssue["code"][] = [
    "SINGLE_POINT",
    "MISSING_OWNER",
    "STALE_RECOVERY",
    "UNKNOWN_FACT",
    "CYCLE",
    "ORPHAN",
  ];
  return {
    workspaceVersion: workspace.version,
    issues,
    counts: Object.fromEntries(
      codes.map((code) => [
        code,
        issues.filter((issue) => issue.code === code).length,
      ]),
    ) as ValidationResult["counts"],
  };
}

export function applyProposalChanges(
  workspace: Workspace,
  changes: ProposalChange[],
): Workspace {
  const next = structuredClone(workspace);
  for (const change of changes) {
    if (change.op === "add-entity") next.entities.push(change.entity);
    if (change.op === "add-relationship")
      next.relationships.push(change.relationship);
    if (change.op === "update-entity") {
      const entity = next.entities.find(
        (candidate) => candidate.id === change.entityId,
      );
      if (entity) {
        const materialEdit = Object.keys(change.patch).some(
          (key) => key !== "trust",
        );
        const wasVerified = entity.trust === "VERIFIED";
        const metadata = change.patch.metadata
          ? { ...entity.metadata, ...change.patch.metadata }
          : entity.metadata;
        Object.assign(entity, change.patch, { metadata });
        if (materialEdit && wasVerified && change.patch.trust === undefined) {
          entity.trust = "STALE";
          entity.metadata = { ...entity.metadata, verificationStatus: "STALE" };
        }
      }
    }
  }
  return next;
}

export function compareProposal(
  workspace: Workspace,
  scenario: Scenario,
  changes: ProposalChange[],
) {
  const before = simulateDisruption(workspace, scenario);
  const proposed = applyProposalChanges(workspace, changes);
  const after = simulateDisruption(proposed, scenario);
  return {
    before,
    after,
    restoredEntityIds: before.blockedEntityIds.filter(
      (id) => !after.blockedEntityIds.includes(id),
    ),
    restoredWorkflowIds: before.blockedWorkflowIds.filter(
      (id) => !after.blockedWorkflowIds.includes(id),
    ),
  };
}
