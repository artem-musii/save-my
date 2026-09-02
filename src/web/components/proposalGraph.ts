import type { Proposal } from "../../domain/model";

export function proposalGraphEntityIds(proposal?: Proposal | null) {
  const ids = new Set<string>();
  for (const change of proposal?.changes ?? []) {
    if (change.op === "add-entity") ids.add(change.entity.id);
    if (change.op === "update-entity") ids.add(change.entityId);
    if (change.op === "add-relationship") {
      ids.add(change.relationship.from);
      ids.add(change.relationship.to);
    }
  }
  return ids;
}
