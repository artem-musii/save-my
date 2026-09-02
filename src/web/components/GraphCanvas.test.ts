import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Proposal, Workspace } from "../../domain/model";
import { GraphCanvas } from "./GraphCanvas";
import { proposalGraphEntityIds } from "./proposalGraph";

const accessibilityWorkspace: Workspace = {
  id: "workspace-accessibility",
  slug: "workspace-accessibility",
  name: "Accessible graph",
  tagline: "A focused accessibility fixture.",
  sector: "custom",
  fictional: false,
  version: 1,
  entities: [
    {
      id: "release-workflow",
      name: "Release workflow",
      type: "workflow",
      trust: "VERIFIED",
      critical: true,
    },
    {
      id: "source-repository",
      name: "Source repository",
      type: "service",
      trust: "DECLARED",
    },
  ],
  relationships: [
    {
      id: "release-source-path",
      from: "release-workflow",
      to: "source-repository",
      type: "depends-on",
      trust: "VERIFIED",
      group: "source",
      label: "Release source",
    },
  ],
  scenarios: [],
  proposals: [],
  activity: [],
};

const renderAccessibleGraph = () =>
  renderToStaticMarkup(
    createElement(GraphCanvas, {
      workspace: accessibilityWorkspace,
      simulation: null,
      focusedIds: [],
      selectedId: undefined,
      onSelect: () => undefined,
    }),
  );

describe("proposal graph scope", () => {
  test("includes new items, relationship endpoints, and standalone item updates", () => {
    const proposal: Proposal = {
      id: "proposal-1",
      title: "Connected repair",
      rationale: "Exercise every proposal change shape.",
      status: "PROPOSED",
      changes: [
        {
          op: "add-entity",
          entity: {
            id: "new-custodian",
            name: "Shared custodian",
            type: "team",
            trust: "INFERRED",
          },
        },
        {
          op: "add-relationship",
          relationship: {
            id: "new-path",
            from: "existing-account",
            to: "new-custodian",
            type: "owned-by",
            trust: "INFERRED",
          },
        },
        {
          op: "update-entity",
          entityId: "standalone-document",
          patch: { description: "Updated recovery instructions." },
        },
      ],
      createdBy: "agent",
      baseVersion: 1,
      assumptions: [],
      createdAt: "2026-09-01T00:00:00.000Z",
    };

    expect([...proposalGraphEntityIds(proposal)].sort()).toEqual([
      "existing-account",
      "new-custodian",
      "standalone-document",
    ]);
  });

  test("returns an empty scope when there is no active proposal", () => {
    expect([...proposalGraphEntityIds(null)]).toEqual([]);
  });
});

describe("graph accessibility", () => {
  test("names the graph and describes its keyboard controls", () => {
    const markup = renderAccessibleGraph();

    expect(markup).toContain('class="graph-stage" role="region"');
    expect(markup).toContain("Continuity dependency graph");
    expect(markup).toContain("Use the arrow keys to pan the graph.");
    expect(markup).toContain("press Enter or Space");
    expect(markup).toContain(
      'role="group" aria-label="Interactive continuity graph canvas"',
    );
  });

  test("includes criticality in every interactive item name", () => {
    const markup = renderAccessibleGraph();

    expect(
      markup.match(
        /aria-label="Release workflow, workflow, critical item, Verified"/g,
      ),
    ).toHaveLength(2);
    expect(
      markup.match(
        /aria-label="Source repository, service, not marked critical, Declared"/g,
      ),
    ).toHaveLength(2);
  });

  test("exposes relationship direction, type, group, and path label", () => {
    const markup = renderAccessibleGraph().replaceAll("<!-- -->", "");

    expect(markup).toContain("Graph relationships and paths");
    expect(markup).toContain(
      "Direction: Release workflow to Source repository.",
    );
    expect(markup).toContain("Type: depends on.");
    expect(markup).toContain("Path group: source.");
    expect(markup).toContain("Path label: Release source.");
  });
});
