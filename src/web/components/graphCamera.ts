import type {
  Entity,
  Relationship,
  SimulationResult,
} from "../../domain/model";

export const GRAPH_VIEWPORT = { width: 1200, height: 760 } as const;
export const GRAPH_NODE = { width: 264, height: 116 } as const;

export type GraphPosition = { x: number; y: number };
export type GraphView = { x: number; y: number; scale: number };
export type GraphBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const laneFor = (entity: Entity, index: number) => {
  if (entity.type === "workflow") return 0;
  if (["service", "vendor"].includes(entity.type)) return 1 + (index % 3);
  if (["account", "communication-channel"].includes(entity.type)) return 4;
  if (
    ["document", "location", "device", "recovery-mechanism"].includes(
      entity.type,
    )
  )
    return 5;
  return 6;
};

export function layoutGraph(entities: Entity[]) {
  const lanes = Array.from({ length: 7 }, () => [] as Entity[]);
  entities
    .slice()
    .sort(
      (a, b) =>
        Number(Boolean(b.critical)) - Number(Boolean(a.critical)) ||
        a.name.localeCompare(b.name),
    )
    .forEach((entity, index) => lanes[laneFor(entity, index)]!.push(entity));

  const positions = new Map<string, GraphPosition>();
  const xs = [170, 470, 770, 1070, 1370, 1670, 1970];
  const gap = 132;
  const maxItems = Math.max(1, ...lanes.map((lane) => lane.length));
  const canvasHeight = Math.max(760, maxItems * gap + 160);
  for (const [laneIndex, lane] of lanes.entries()) {
    const start = (canvasHeight - (lane.length - 1) * gap) / 2;
    lane.forEach((entity, index) => {
      positions.set(entity.id, { x: xs[laneIndex]!, y: start + index * gap });
    });
  }
  return positions;
}

export function layoutScenarioGraph(
  entities: Entity[],
  relationships: Relationship[],
  simulation: SimulationResult,
) {
  const maxDepth = Math.max(1, ...Object.values(simulation.depths));
  const columnById = new Map<string, number>();
  for (const entity of entities) {
    const depth = simulation.depths[entity.id];
    if (depth !== undefined) columnById.set(entity.id, maxDepth - depth);
  }

  const columns = Array.from({ length: maxDepth + 1 }, () => [] as Entity[]);
  for (const entity of entities) {
    const column = columnById.get(entity.id);
    if (column !== undefined) columns[column]!.push(entity);
  }
  for (const entity of entities) {
    if (columnById.has(entity.id)) continue;
    const connectedColumns = relationships.flatMap((relationship) => {
      const otherId =
        relationship.from === entity.id
          ? relationship.to
          : relationship.to === entity.id
            ? relationship.from
            : undefined;
      const column = otherId ? columnById.get(otherId) : undefined;
      return column === undefined ? [] : [column];
    });
    const preferred =
      connectedColumns.length > 0
        ? Math.round(
            connectedColumns.reduce((sum, column) => sum + column, 0) /
              connectedColumns.length,
          )
        : Math.min(1, maxDepth);
    const column = columns
      .map((items, index) => ({
        index,
        score: Math.abs(index - preferred) * 2 + items.length,
      }))
      .sort((a, b) => a.score - b.score || a.index - b.index)[0]!.index;
    columnById.set(entity.id, column);
    columns[column]!.push(entity);
  }
  for (const column of columns)
    column.sort(
      (a, b) =>
        Number(simulation.unavailableEntityIds.includes(a.id)) -
          Number(simulation.unavailableEntityIds.includes(b.id)) ||
        a.name.localeCompare(b.name),
    );

  const positions = new Map<string, GraphPosition>();
  const horizontalGap = 310;
  const verticalGap = 142;
  const canvasHeight = Math.max(
    GRAPH_VIEWPORT.height,
    Math.max(1, ...columns.map((column) => column.length)) * verticalGap + 170,
  );
  columns.forEach((column, columnIndex) => {
    const startY = (canvasHeight - (column.length - 1) * verticalGap) / 2;
    column.forEach((entity, index) =>
      positions.set(entity.id, {
        x: 170 + columnIndex * horizontalGap,
        y: startY + index * verticalGap,
      }),
    );
  });
  return positions;
}

export function graphBounds(
  positions: Map<string, GraphPosition>,
): GraphBounds {
  const values = [...positions.values()];
  if (!values.length) return { minX: 0, minY: 0, maxX: 1200, maxY: 760 };
  const pad = 110;
  return {
    minX:
      Math.min(...values.map((item) => item.x)) - GRAPH_NODE.width / 2 - pad,
    minY:
      Math.min(...values.map((item) => item.y)) - GRAPH_NODE.height / 2 - pad,
    maxX:
      Math.max(...values.map((item) => item.x)) + GRAPH_NODE.width / 2 + pad,
    maxY:
      Math.max(...values.map((item) => item.y)) + GRAPH_NODE.height / 2 + pad,
  };
}

export function clampGraphView(
  view: GraphView,
  bounds: GraphBounds,
): GraphView {
  const scale = Math.min(1.65, Math.max(0.38, view.scale));
  const visible = 110;
  const scaledWidth = (bounds.maxX - bounds.minX) * scale;
  const scaledHeight = (bounds.maxY - bounds.minY) * scale;
  const centerX =
    GRAPH_VIEWPORT.width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
  const centerY =
    GRAPH_VIEWPORT.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale;
  const x =
    scaledWidth <= GRAPH_VIEWPORT.width - visible * 2
      ? centerX
      : Math.min(
          GRAPH_VIEWPORT.width - visible - bounds.minX * scale,
          Math.max(visible - bounds.maxX * scale, view.x),
        );
  const y =
    scaledHeight <= GRAPH_VIEWPORT.height - visible * 2
      ? centerY
      : Math.min(
          GRAPH_VIEWPORT.height - visible - bounds.minY * scale,
          Math.max(visible - bounds.maxY * scale, view.y),
        );
  return { x, y, scale };
}

export function fitGraphView(bounds: GraphBounds): GraphView {
  const padding = 72;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(
    1,
    (GRAPH_VIEWPORT.width - padding * 2) / width,
    (GRAPH_VIEWPORT.height - padding * 2) / height,
  );
  return clampGraphView(
    {
      scale,
      x: GRAPH_VIEWPORT.width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
      y: GRAPH_VIEWPORT.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
    },
    bounds,
  );
}

export function focusGraphView(
  position: GraphPosition,
  current: GraphView,
  bounds: GraphBounds,
): GraphView {
  const scale = Math.max(0.86, current.scale);
  return clampGraphView(
    {
      scale,
      x: GRAPH_VIEWPORT.width / 2 - position.x * scale,
      y: GRAPH_VIEWPORT.height / 2 - position.y * scale,
    },
    bounds,
  );
}
