import { describe, expect, test } from "bun:test";
import type { Entity } from "../../domain/model";
import {
  clampGraphView,
  fitGraphView,
  graphBounds,
  layoutGraph,
} from "./graphCamera";

const entities: Entity[] = Array.from({ length: 30 }, (_, index) => ({
  id: `entity-${index}`,
  name: `Entity ${index}`,
  type: index % 5 === 0 ? "workflow" : index % 3 === 0 ? "person" : "service",
  trust: "VERIFIED",
}));

describe("graph camera", () => {
  test("fits a rich graph inside the visible viewport", () => {
    const bounds = graphBounds(layoutGraph(entities));
    const view = fitGraphView(bounds);
    expect(view.scale).toBeGreaterThanOrEqual(0.38);
    expect(bounds.maxX * view.scale + view.x).toBeGreaterThan(110);
    expect(bounds.minX * view.scale + view.x).toBeLessThan(1090);
  });

  test("clamps extreme drags so the graph cannot become a black screen", () => {
    const bounds = graphBounds(layoutGraph(entities));
    const left = clampGraphView({ x: -100_000, y: -100_000, scale: 1 }, bounds);
    const right = clampGraphView({ x: 100_000, y: 100_000, scale: 1 }, bounds);
    expect(bounds.maxX + left.x).toBeGreaterThanOrEqual(110);
    expect(bounds.minX + right.x).toBeLessThanOrEqual(1090);
    expect(bounds.maxY + left.y).toBeGreaterThanOrEqual(110);
    expect(bounds.minY + right.y).toBeLessThanOrEqual(650);
  });
});
