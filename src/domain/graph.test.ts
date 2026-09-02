import { describe, expect, test } from "bun:test";
import {
  applyProposalChanges,
  compareProposal,
  simulateDisruption,
  validateContinuityMap,
} from "./graph";
import type { Workspace } from "./model";

const workspace: Workspace = {
  id: "test",
  slug: "test",
  name: "Test",
  tagline: "",
  sector: "custom",
  fictional: true,
  version: 1,
  entities: [
    { id: "person", name: "Only owner", type: "person", trust: "VERIFIED" },
    { id: "alternate", name: "Alternate", type: "person", trust: "VERIFIED" },
    {
      id: "account",
      name: "Account",
      type: "account",
      trust: "DECLARED",
      critical: true,
    },
    {
      id: "workflow",
      name: "Release",
      type: "workflow",
      trust: "VERIFIED",
      critical: true,
    },
  ],
  relationships: [
    {
      id: "r1",
      from: "workflow",
      to: "account",
      type: "depends-on",
      group: "publish",
      trust: "VERIFIED",
    },
    {
      id: "r2",
      from: "account",
      to: "person",
      type: "accessible-by",
      group: "access",
      trust: "VERIFIED",
    },
  ],
  scenarios: [],
  proposals: [],
  activity: [],
};

describe("deterministic graph engine", () => {
  test("cascades failure hop by hop", () => {
    const result = simulateDisruption(workspace, {
      id: "s",
      name: "Owner away",
      unavailableEntityIds: ["person"],
      durationDays: 7,
      context: "",
      createdBy: "human",
    });
    expect(result.orderedCascade).toEqual([
      ["person"],
      ["account"],
      ["workflow"],
    ]);
    expect(result.blockedWorkflowIds).toEqual(["workflow"]);
  });

  test("keeps a dependency available through an alternate path", () => {
    const changed = applyProposalChanges(workspace, [
      {
        op: "add-relationship",
        relationship: {
          id: "r3",
          from: "account",
          to: "alternate",
          type: "accessible-by",
          group: "access",
          trust: "DECLARED",
        },
      },
    ]);
    const result = simulateDisruption(changed, {
      id: "s",
      name: "Owner away",
      unavailableEntityIds: ["person"],
      durationDays: 7,
      context: "",
      createdBy: "human",
    });
    expect(result.blockedEntityIds).toEqual(["person"]);
  });

  test("proposal comparison never mutates the baseline", () => {
    const original = structuredClone(workspace);
    const comparison = compareProposal(
      workspace,
      {
        id: "s",
        name: "Owner away",
        unavailableEntityIds: ["person"],
        durationDays: 7,
        context: "",
        createdBy: "human",
      },
      [
        {
          op: "add-relationship",
          relationship: {
            id: "r3",
            from: "account",
            to: "alternate",
            type: "accessible-by",
            group: "access",
            trust: "INFERRED",
          },
        },
      ],
    );
    expect(comparison.restoredWorkflowIds).toEqual(["workflow"]);
    expect(workspace).toEqual(original);
  });

  test("reports concrete single points instead of a score", () => {
    const result = validateContinuityMap(workspace);
    expect(result.counts.SINGLE_POINT).toBeGreaterThan(0);
    expect("score" in result).toBeFalse();
  });

  test("makes a human attestation stale after a material edit", () => {
    const changed = applyProposalChanges(workspace, [
      {
        op: "update-entity",
        entityId: "person",
        patch: { name: "Owner, updated" },
      },
    ]);
    expect(
      changed.entities.find((entity) => entity.id === "person")?.trust,
    ).toBe("STALE");
    expect(
      changed.entities.find((entity) => entity.id === "person")?.metadata
        ?.verificationStatus,
    ).toBe("STALE");
    expect(
      workspace.entities.find((entity) => entity.id === "person")?.trust,
    ).toBe("VERIFIED");
  });
});
