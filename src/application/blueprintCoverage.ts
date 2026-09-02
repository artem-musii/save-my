import { entityTypes, relationshipTypes } from "../domain/model";
import type { CompanyBlueprintFixture } from "../fixtures/wowProjectBlueprint";

type BlueprintEntities = CompanyBlueprintFixture["entities"];
type BlueprintRelationships = CompanyBlueprintFixture["relationships"];

export function inspectBlueprintCoverage(
  entities: BlueprintEntities,
  relationships: BlueprintRelationships,
) {
  const refs = new Set(entities.map((entity) => entity.ref));
  const adjacency = new Map<string, Set<string>>(
    entities.map((entity) => [entity.ref, new Set<string>()]),
  );
  for (const relationship of relationships) {
    if (!refs.has(relationship.fromRef) || !refs.has(relationship.toRef))
      continue;
    adjacency.get(relationship.fromRef)!.add(relationship.toRef);
    adjacency.get(relationship.toRef)!.add(relationship.fromRef);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const ref of refs) {
    if (visited.has(ref)) continue;
    const component: string[] = [];
    const queue = [ref];
    visited.add(ref);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }

  const entityTypeCounts = Object.fromEntries(
    entityTypes.map((type) => [
      type,
      entities.filter((entity) => entity.type === type).length,
    ]),
  ) as Record<(typeof entityTypes)[number], number>;
  const relationshipTypeCounts = Object.fromEntries(
    relationshipTypes.map((type) => [
      type,
      relationships.filter((relationship) => relationship.type === type).length,
    ]),
  ) as Record<(typeof relationshipTypes)[number], number>;
  const isolatedRefs = entities
    .filter((entity) => adjacency.get(entity.ref)?.size === 0)
    .map((entity) => entity.ref);
  const criticalWorkflowRefs = new Set(
    entities
      .filter((entity) => entity.type === "workflow" && entity.critical)
      .map((entity) => entity.ref),
  );
  const responsibleRefs = new Set(
    entities
      .filter((entity) => entity.type === "person" || entity.type === "team")
      .map((entity) => entity.ref),
  );
  const operationalDependencyRefs = new Set(
    entities
      .filter((entity) =>
        [
          "service",
          "vendor",
          "account",
          "device",
          "document",
          "location",
          "communication-channel",
        ].includes(entity.type),
      )
      .map((entity) => entity.ref),
  );
  const criticalOrOperationalRefs = new Set([
    ...criticalWorkflowRefs,
    ...operationalDependencyRefs,
  ]);
  const connects = (
    relationship: BlueprintRelationships[number],
    left: Set<string>,
    right: Set<string>,
  ) =>
    (left.has(relationship.fromRef) && right.has(relationship.toRef)) ||
    (left.has(relationship.toRef) && right.has(relationship.fromRef));
  const criticalDependencyPathCount = relationships.filter(
    (relationship) =>
      ["depends-on", "required-by"].includes(relationship.type) &&
      connects(relationship, criticalWorkflowRefs, operationalDependencyRefs),
  ).length;
  const accountablePathCount = relationships.filter(
    (relationship) =>
      ["owned-by", "administered-by", "accessible-by"].includes(
        relationship.type,
      ) && connects(relationship, responsibleRefs, criticalOrOperationalRefs),
  ).length;
  const continuityPathCount = relationships.filter(
    (relationship) =>
      ["recovers-via", "substitutes-for"].includes(relationship.type) &&
      (criticalOrOperationalRefs.has(relationship.fromRef) ||
        criticalOrOperationalRefs.has(relationship.toRef)),
  ).length;
  const reviewPrompts = [
    entityTypeCounts.person + entityTypeCounts.team === 0
      ? "Add the people or teams responsible for critical work."
      : undefined,
    entityTypeCounts.workflow === 0
      ? "Add the operational workflows the company must continue."
      : undefined,
    entities.every((entity) => entity.type !== "workflow" || !entity.critical)
      ? "Mark at least one must-continue workflow as critical."
      : undefined,
    entityTypeCounts["recovery-mechanism"] === 0
      ? "Add at least one concrete recovery mechanism."
      : undefined,
    entityTypeCounts.service +
      entityTypeCounts.vendor +
      entityTypeCounts.account +
      entityTypeCounts.device +
      entityTypeCounts.document +
      entityTypeCounts.location +
      entityTypeCounts["communication-channel"] ===
    0
      ? "Add at least one operational system, vendor, account, device, document, location, or channel."
      : undefined,
    criticalDependencyPathCount === 0
      ? "Connect a critical workflow to the operational dependency it requires."
      : undefined,
    accountablePathCount === 0
      ? "Connect a responsible person or team to a critical workflow or operational dependency through ownership, administration, or access."
      : undefined,
    continuityPathCount === 0
      ? "Connect a critical workflow or operational dependency to an explicit recovery or substitute path."
      : undefined,
  ].filter((message): message is string => Boolean(message));

  return {
    entityCount: entities.length,
    connectionCount: relationships.length,
    entityTypeCounts,
    relationshipTypeCounts,
    criticalWorkflowCount: entities.filter(
      (entity) => entity.type === "workflow" && entity.critical,
    ).length,
    criticalDependencyPathCount,
    accountablePathCount,
    continuityPathCount,
    relationshipGroupCount: new Set(
      relationships.map(
        (relationship) =>
          relationship.group ??
          `${relationship.fromRef}:${relationship.toRef}:${relationship.type}`,
      ),
    ).size,
    connectedItemCount: entities.length - isolatedRefs.length,
    isolatedRefs,
    componentCount: components.length,
    disconnectedComponents: components.length > 1 ? components : [],
    reviewPrompts,
  };
}
