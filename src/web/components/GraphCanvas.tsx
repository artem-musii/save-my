import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import type {
  Entity,
  Proposal,
  Relationship,
  SimulationResult,
  Workspace,
} from "../../domain/model";
import { applyProposalChanges } from "../../domain/graph";
import { trustDescription, trustLabel, trustOrder } from "../lib/trust";
import { OptionalImage } from "./OptionalImage";
import { ZoomInIcon, ZoomOutIcon } from "./icons";
import { proposalGraphEntityIds } from "./proposalGraph";
import {
  GRAPH_NODE,
  GRAPH_VIEWPORT,
  clampGraphView,
  fitGraphView,
  focusGraphView,
  graphBounds,
  layoutGraph,
  layoutScenarioGraph,
  type GraphPosition,
  type GraphView,
} from "./graphCamera";

function edgePath(from: GraphPosition, to: GraphPosition) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const direction = dx >= 0 ? 1 : -1;
    const startX = from.x + direction * (GRAPH_NODE.width / 2 - 4);
    const endX = to.x - direction * (GRAPH_NODE.width / 2 - 4);
    const bend = startX + (endX - startX) * 0.5;
    return `M ${startX} ${from.y} C ${bend} ${from.y}, ${bend} ${to.y}, ${endX} ${to.y}`;
  }
  const direction = dy >= 0 ? 1 : -1;
  const startY = from.y + direction * (GRAPH_NODE.height / 2 - 4);
  const endY = to.y - direction * (GRAPH_NODE.height / 2 - 4);
  const bend = startY + (endY - startY) * 0.5;
  return `M ${from.x} ${startY} C ${from.x} ${bend}, ${to.x} ${bend}, ${to.x} ${endY}`;
}

type NodeShape = "operator" | "route" | "system" | "artifact";

function nodeShapeFor(entity: Entity): NodeShape {
  if (entity.type === "person" || entity.type === "team") return "operator";
  if (entity.type === "workflow") return "route";
  if (["document", "device", "location"].includes(entity.type))
    return "artifact";
  return "system";
}

function nodeFacePath(shape: NodeShape) {
  const width = GRAPH_NODE.width;
  const height = GRAPH_NODE.height;
  if (shape === "operator")
    return `M 24 0 H ${width - 24} L ${width} 24 V ${height - 24} L ${width - 24} ${height} H 24 L 0 ${height - 24} V 24 Z`;
  if (shape === "route")
    return `M 0 18 L 18 0 H ${width - 36} L ${width} 30 V ${height - 18} L ${width - 18} ${height} H 18 L 0 ${height - 18} Z`;
  if (shape === "artifact")
    return `M 0 0 H ${width - 34} L ${width} 34 V ${height} H 22 L 0 ${height - 22} Z`;
  return `M 18 0 H ${width} V ${height - 22} L ${width - 22} ${height} H 0 V 18 Z`;
}

function nodeFacetPath(shape: NodeShape) {
  const width = GRAPH_NODE.width;
  if (shape === "operator")
    return `M 24 0 H ${width - 24} L ${width - 14} 10 H 34 Z`;
  if (shape === "route")
    return `M 18 0 H ${width - 36} L ${width - 24} 10 H 28 Z`;
  if (shape === "artifact")
    return `M 0 0 H ${width - 34} L ${width - 24} 10 H 10 Z`;
  return `M 18 0 H ${width} V 10 H 28 Z`;
}

const proposalRelationships = (proposal?: Proposal | null) =>
  proposal?.changes.flatMap((change) =>
    change.op === "add-relationship" ? [change.relationship] : [],
  ) ?? [];

const proposalEntities = (proposal?: Proposal | null) =>
  proposal?.changes.flatMap((change) =>
    change.op === "add-entity" ? [change.entity] : [],
  ) ?? [];

const accessibleEntityName = (entity: Entity, state: string) =>
  `${entity.name}, ${entity.type.replaceAll("-", " ")}, ${entity.critical ? "critical item" : "not marked critical"}, ${state}`;

const accessibleRelationshipType = (relationship: Relationship) =>
  relationship.type.replaceAll("-", " ");

type Props = {
  workspace: Workspace;
  simulation: SimulationResult | null;
  layoutSimulation?: SimulationResult | null;
  proposal?: Proposal | null;
  proposalPhase?: "before" | "after";
  comparisonPending?: boolean;
  scenarioResolved?: boolean;
  restoredIds?: string[];
  focusedIds: string[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
};

export function GraphCanvas({
  workspace,
  simulation,
  layoutSimulation,
  proposal,
  proposalPhase,
  comparisonPending = false,
  scenarioResolved = false,
  restoredIds = [],
  focusedIds,
  selectedId,
  onSelect,
}: Props) {
  const graphTitleId = useId();
  const graphInstructionsId = useId();
  const relationshipListTitleId = useId();
  const showProposalChanges = proposalPhase === "after" && Boolean(proposal);
  const extras = useMemo(
    () => (showProposalChanges ? proposalEntities(proposal) : []),
    [proposal, showProposalChanges],
  );
  const extraRelationships = useMemo(
    () => (showProposalChanges ? proposalRelationships(proposal) : []),
    [proposal, showProposalChanges],
  );
  const previewWorkspace = useMemo(
    () =>
      showProposalChanges && proposal
        ? applyProposalChanges(workspace, proposal.changes)
        : workspace,
    [proposal, showProposalChanges, workspace],
  );
  const allEntities = previewWorkspace.entities;
  const allRelationships = previewWorkspace.relationships;
  const scenarioEntityIds = useMemo(() => {
    const scope = layoutSimulation ?? simulation;
    if (!scope) return null;
    const ids = new Set(scope.smallestRelevantEntityIds);
    if (showProposalChanges)
      for (const id of proposalGraphEntityIds(proposal)) ids.add(id);
    return ids;
  }, [layoutSimulation, proposal, showProposalChanges, simulation]);
  const entities = useMemo(
    () =>
      scenarioEntityIds
        ? allEntities.filter((entity) => scenarioEntityIds.has(entity.id))
        : allEntities,
    [allEntities, scenarioEntityIds],
  );
  const entityIds = useMemo(
    () => new Set(entities.map((entity) => entity.id)),
    [entities],
  );
  const relationships = useMemo(
    () =>
      allRelationships.filter(
        (relationship) =>
          entityIds.has(relationship.from) && entityIds.has(relationship.to),
      ),
    [allRelationships, entityIds],
  );
  const entityNames = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity.name])),
    [entities],
  );
  const positions = useMemo(
    () =>
      (layoutSimulation ?? simulation)
        ? layoutScenarioGraph(
            entities,
            relationships,
            (layoutSimulation ?? simulation)!,
          )
        : layoutGraph(entities),
    [entities, layoutSimulation, relationships, simulation],
  );
  const bounds = useMemo(() => graphBounds(positions), [positions]);
  const [view, setView] = useState<GraphView>(() => fitGraphView(bounds));
  const [hoveredId, setHoveredId] = useState<string>();
  const [unavailableImages, setUnavailableImages] = useState<Set<string>>(
    () => new Set(),
  );
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    originX: number;
    originY: number;
    scale: number;
  } | null>(null);

  useEffect(() => setView(fitGraphView(bounds)), [bounds]);
  useEffect(() => setUnavailableImages(new Set()), [workspace.id]);
  useEffect(() => {
    if (!selectedId) return;
    const position = positions.get(selectedId);
    if (position)
      setView((current) => focusGraphView(position, current, bounds));
  }, [bounds, positions, selectedId]);

  const blocked = useMemo(
    () => new Set(scenarioResolved ? [] : (simulation?.blockedEntityIds ?? [])),
    [scenarioResolved, simulation],
  );
  const unavailable = useMemo(
    () => new Set(simulation?.unavailableEntityIds ?? []),
    [simulation],
  );
  const affected = useMemo(
    () =>
      new Set(
        scenarioResolved ? [] : (simulation?.affectedRelationshipIds ?? []),
      ),
    [scenarioResolved, simulation],
  );
  const proposedEntityIds = useMemo(() => {
    const ids = new Set(extras.map((entity) => entity.id));
    if (!showProposalChanges) return ids;
    for (const change of proposal?.changes ?? []) {
      if (change.op === "update-entity") ids.add(change.entityId);
      if (change.op === "add-relationship") {
        ids.add(change.relationship.from);
        ids.add(change.relationship.to);
      }
    }
    return ids;
  }, [extras, proposal, showProposalChanges]);
  const addedEntityIds = useMemo(
    () => new Set(extras.map((entity) => entity.id)),
    [extras],
  );
  const proposedRelationshipIds = useMemo(
    () => new Set(extraRelationships.map((relationship) => relationship.id)),
    [extraRelationships],
  );
  const restoredEntityIds = useMemo(
    () =>
      proposalPhase === "after" ? new Set(restoredIds) : new Set<string>(),
    [proposalPhase, restoredIds],
  );
  const stateForEntity = (entity: Entity) => {
    const isBlocked = blocked.has(entity.id);
    const isUnavailable = unavailable.has(entity.id);
    const isContained = scenarioResolved && isUnavailable;
    const isRestored = restoredEntityIds.has(entity.id);
    const isProposed = proposedEntityIds.has(entity.id);
    const depth = simulation?.depths[entity.id] ?? 0;
    return isUnavailable
      ? isContained
        ? "Unavailable · contained"
        : "Failure origin"
      : isRestored && proposalPhase === "after"
        ? "Restored by repair"
        : isProposed && proposalPhase === "after"
          ? addedEntityIds.has(entity.id)
            ? "New proposed item"
            : isBlocked
              ? "Still blocked"
              : "Proposed graph change"
          : isBlocked
            ? `Blocked · hop ${depth}`
            : trustLabel[entity.trust];
  };
  const exploreIds = useMemo(() => {
    const ids = new Set(focusedIds);
    for (const id of proposedEntityIds) ids.add(id);
    const pivot = hoveredId ?? selectedId;
    if (pivot) {
      ids.add(pivot);
      for (const relationship of relationships) {
        if (relationship.from === pivot) ids.add(relationship.to);
        if (relationship.to === pivot) ids.add(relationship.from);
      }
    }
    return ids;
  }, [focusedIds, hoveredId, proposedEntityIds, relationships, selectedId]);
  const hasFocus = exploreIds.size > 0;

  const pan = (x: number, y: number) => {
    setView((current) =>
      clampGraphView(
        { ...current, x: current.x + x, y: current.y + y },
        bounds,
      ),
    );
  };
  const zoom = (
    delta: number,
    anchor = { x: GRAPH_VIEWPORT.width / 2, y: GRAPH_VIEWPORT.height / 2 },
  ) => {
    setView((current) => {
      const scale = Math.min(1.65, Math.max(0.38, current.scale + delta));
      const worldX = (anchor.x - current.x) / current.scale;
      const worldY = (anchor.y - current.y) / current.scale;
      return clampGraphView(
        {
          scale,
          x: anchor.x - worldX * scale,
          y: anchor.y - worldY * scale,
        },
        bounds,
      );
    });
  };
  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const unitX = GRAPH_VIEWPORT.width / rect.width;
    const unitY = GRAPH_VIEWPORT.height / rect.height;
    const horizontalGesture =
      event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.35;
    if (horizontalGesture && !event.ctrlKey && !event.metaKey) {
      pan(
        -(event.shiftKey ? event.deltaY : event.deltaX) * unitX,
        -event.deltaY * unitY * (event.shiftKey ? 0 : 1),
      );
      return;
    }
    const anchor = {
      x: (event.clientX - rect.left) * unitX,
      y: (event.clientY - rect.top) * unitY,
    };
    zoom(event.deltaY > 0 ? -0.08 : 0.08, anchor);
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest("[data-node]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: view.x,
      originY: view.y,
      scale: view.scale,
    };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setView(
      clampGraphView(
        {
          scale: drag.current.scale,
          x:
            drag.current.originX +
            (event.clientX - drag.current.x) *
              (GRAPH_VIEWPORT.width / rect.width),
          y:
            drag.current.originY +
            (event.clientY - drag.current.y) *
              (GRAPH_VIEWPORT.height / rect.height),
        },
        bounds,
      ),
    );
  };
  const releasePointer = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const amount = event.shiftKey ? 140 : 70;
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    if (event.key === "ArrowLeft") pan(amount, 0);
    if (event.key === "ArrowRight") pan(-amount, 0);
    if (event.key === "ArrowUp") pan(0, amount);
    if (event.key === "ArrowDown") pan(0, -amount);
  };

  return (
    <section
      className="graph-stage"
      role="region"
      aria-labelledby={graphTitleId}
      aria-describedby={graphInstructionsId}
    >
      <h2 className="sr-only" id={graphTitleId}>
        Continuity dependency graph
      </h2>
      <p className="sr-only" id={graphInstructionsId}>
        Use the arrow keys to pan the graph. Hold Shift to pan farther. Use Tab
        to move between graph items, then press Enter or Space to open an
        item&apos;s details. Use the zoom and Fit all controls to change the
        view.
      </p>
      <div
        className="graph-tools"
        role="group"
        aria-label="Graph view controls"
      >
        <button
          className="icon-button"
          onClick={() => zoom(0.14)}
          aria-label="Zoom in"
        >
          <ZoomInIcon />
        </button>
        <button
          className="icon-button"
          onClick={() => zoom(-0.14)}
          aria-label="Zoom out"
        >
          <ZoomOutIcon />
        </button>
        <button
          className="fit-button"
          onClick={() => setView(fitGraphView(bounds))}
        >
          FIT ALL
        </button>
        <button
          className="icon-button graph-pan-button"
          onClick={() => pan(120, 0)}
          aria-label="Move map left"
          title="Move map left"
        >
          ←
        </button>
        <button
          className="icon-button graph-pan-button"
          onClick={() => pan(-120, 0)}
          aria-label="Move map right"
          title="Move map right"
        >
          →
        </button>
      </div>
      <div className="graph-hint">
        <strong>
          {entities.length} {simulation ? "relevant" : "items"}
        </strong>
        <span>Drag to move · scroll to zoom · select to focus</span>
      </div>
      {proposalPhase && (
        <div
          className={`graph-phase-label ${proposalPhase} ${comparisonPending ? "pending" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span>
            {proposal?.kind === "MAP_DRAFT"
              ? proposalPhase === "before"
                ? "Baseline"
                : "Draft preview"
              : proposalPhase === "before"
                ? "Current failure"
                : "Proposed outcome"}
          </span>
          <strong>
            {comparisonPending
              ? "Calculating this option’s impact"
              : proposal?.kind === "MAP_DRAFT"
                ? proposalPhase === "before"
                  ? "Current company map"
                  : `${proposal?.changes.length ?? 0} staged changes · baseline unchanged`
                : proposalPhase === "before"
                  ? "Baseline graph only · proposal hidden"
                  : `${proposal?.changes.length ?? 0} proposed changes · baseline unchanged`}
          </strong>
        </div>
      )}
      <svg
        id="graph-main"
        className="graph-canvas"
        tabIndex={0}
        role="group"
        aria-label="Interactive continuity graph canvas"
        aria-describedby={graphInstructionsId}
        viewBox={`0 0 ${GRAPH_VIEWPORT.width} ${GRAPH_VIEWPORT.height}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onLostPointerCapture={releasePointer}
        onKeyDown={onKeyDown}
        onDoubleClick={() => setView(fitGraphView(bounds))}
      >
        <defs>
          <pattern
            id="dot-grid"
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="0.8" className="grid-dot" />
          </pattern>
          {(["normal", "blocked", "proposed"] as const).map((state) => (
            <marker
              key={state}
              id={`arrow-${state}`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" className={`edge-arrow ${state}`} />
            </marker>
          ))}
        </defs>
        <rect
          width={GRAPH_VIEWPORT.width}
          height={GRAPH_VIEWPORT.height}
          fill="url(#dot-grid)"
        />
        <g
          className="graph-world"
          transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}
        >
          <g className="edges">
            {relationships.map((relationship: Relationship) => {
              const from = positions.get(relationship.from);
              const to = positions.get(relationship.to);
              if (!from || !to) return null;
              const isAffected = affected.has(relationship.id);
              const isProposed = proposedRelationshipIds.has(relationship.id);
              const isFocused =
                exploreIds.has(relationship.from) &&
                exploreIds.has(relationship.to);
              const active =
                relationship.from === (hoveredId ?? selectedId) ||
                relationship.to === (hoveredId ?? selectedId);
              return (
                <g
                  key={relationship.id}
                  className={`graph-edge ${isAffected ? "is-blocked" : ""} ${isProposed ? "is-proposed" : ""} ${active ? "is-active" : ""} ${hasFocus && !isFocused ? "is-receded" : ""}`}
                >
                  <path
                    d={edgePath(from, to)}
                    markerEnd={`url(#arrow-${isAffected ? "blocked" : isProposed ? "proposed" : "normal"})`}
                  />
                </g>
              );
            })}
          </g>
          <g className="nodes">
            {entities.map((entity) => {
              const position = positions.get(entity.id)!;
              const nodeShape = nodeShapeFor(entity);
              const isBlocked = blocked.has(entity.id);
              const isUnavailable = unavailable.has(entity.id);
              const isContained = scenarioResolved && isUnavailable;
              const isFocused = exploreIds.has(entity.id);
              const isProposed = proposedEntityIds.has(entity.id);
              const isSelected = selectedId === entity.id;
              const isRestored = restoredEntityIds.has(entity.id);
              const hasImage =
                Boolean(entity.image) && !unavailableImages.has(entity.id);
              const depth = simulation?.depths[entity.id] ?? 0;
              const state = stateForEntity(entity);
              return (
                <g
                  data-node="true"
                  key={entity.id}
                  transform={`translate(${position.x - GRAPH_NODE.width / 2} ${position.y - GRAPH_NODE.height / 2})`}
                  tabIndex={0}
                  role="button"
                  aria-label={accessibleEntityName(entity, state)}
                  aria-pressed={isSelected}
                  className={`graph-node ${entity.type} trust-${entity.trust.toLowerCase()} ${isBlocked ? "is-blocked" : ""} ${isUnavailable ? "is-unavailable" : ""} ${isContained ? "is-contained" : ""} ${isFocused ? "is-focused" : ""} ${isSelected ? "is-selected" : ""} ${isProposed ? `is-proposed is-proposal-${proposalPhase}` : ""} ${isRestored ? `is-restored is-restored-${proposalPhase}` : ""} ${hasFocus && !isFocused ? "is-receded" : ""}`}
                  style={{ "--cascade-depth": depth } as React.CSSProperties}
                  onPointerEnter={() => setHoveredId(entity.id)}
                  onPointerLeave={() => setHoveredId(undefined)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(entity.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(entity.id);
                    }
                  }}
                >
                  <title>{`${entity.name}. Evidence: ${trustLabel[entity.trust]}. ${trustDescription[entity.trust]} Current impact: ${state}.`}</title>
                  {isUnavailable && !isContained && (
                    <path
                      className="failure-origin-beacon"
                      d={nodeFacePath(nodeShape)}
                    />
                  )}
                  {isProposed && (
                    <path
                      className="repair-target-beacon"
                      d={nodeFacePath(nodeShape)}
                    />
                  )}
                  {isRestored && (
                    <path
                      className="repair-outcome-beacon"
                      d={nodeFacePath(nodeShape)}
                    />
                  )}
                  <g className="node-motion">
                    <path
                      className="node-depth"
                      transform="translate(10 10)"
                      d={nodeFacePath(nodeShape)}
                    />
                    <path className="node-face" d={nodeFacePath(nodeShape)} />
                    <path className="node-facet" d={nodeFacetPath(nodeShape)} />
                    <foreignObject
                      width={GRAPH_NODE.width}
                      height={GRAPH_NODE.height}
                    >
                      <div
                        className={`node-surface shape-${nodeShape} ${hasImage ? "has-image" : "no-image"}`}
                      >
                        {hasImage && (
                          <div className="node-image-wrap">
                            <OptionalImage
                              src={entity.image}
                              draggable={false}
                              onUnavailable={() =>
                                setUnavailableImages((current) => {
                                  const next = new Set(current);
                                  next.add(entity.id);
                                  return next;
                                })
                              }
                            />
                          </div>
                        )}
                        <div className="node-copy">
                          <span className="node-kicker">
                            {entity.role ?? entity.type.replaceAll("-", " ")}
                          </span>
                          <strong>{entity.name}</strong>
                          <span className="node-state">{state}</span>
                        </div>
                        {entity.critical && (
                          <i className="critical-mark" title="Critical" />
                        )}
                      </div>
                    </foreignObject>
                  </g>
                </g>
              );
            })}
          </g>
          <g className="edge-labels" aria-hidden="true">
            {relationships.map((relationship: Relationship) => {
              const from = positions.get(relationship.from);
              const to = positions.get(relationship.to);
              if (!from || !to) return null;
              const isProposed = proposedRelationshipIds.has(relationship.id);
              const active =
                relationship.from === (hoveredId ?? selectedId) ||
                relationship.to === (hoveredId ?? selectedId);
              if (!active && !isProposed) return null;
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const length = Math.max(Math.hypot(dx, dy), 1);
              const side = relationship.id.length % 2 === 0 ? 1 : -1;
              const offset = 18 * side;
              const x = (from.x + to.x) / 2 + (-dy / length) * offset;
              const y = (from.y + to.y) / 2 + (dx / length) * offset;
              const label = relationship.label ?? relationship.type;
              const width = Math.min(196, Math.max(104, label.length * 7 + 28));
              return (
                <g
                  key={`label-${relationship.id}`}
                  className={`edge-label ${isProposed ? "is-proposed" : ""}`}
                  transform={`translate(${x} ${y})`}
                >
                  <rect
                    x={-width / 2}
                    y="-13"
                    width={width}
                    height="26"
                    rx="13"
                  />
                  <text textAnchor="middle" y="4">
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <details className="graph-legend">
        <summary aria-label="Explain graph states">
          <span className="legend-source">
            <strong>State source</strong>
            <small>
              Baseline v{workspace.version}
              {simulation ? " + deterministic scenario" : " evidence"}
            </small>
          </span>
          <span className="legend-item">
            <i className="legend-dot verified" />
            <span>
              <strong>Healthy</strong>
              <small>No computed block</small>
            </span>
          </span>
          <span className="legend-item">
            <i className="legend-dot stale" />
            <span>
              <strong>Needs review</strong>
              <small>Unknown or stale</small>
            </span>
          </span>
          <span className="legend-item">
            <i className="legend-dot blocked" />
            <span>
              <strong>Blocked</strong>
              <small>No active path</small>
            </span>
          </span>
          <span className="legend-item">
            <i className="legend-dot proposed" />
            <span>
              <strong>Proposed</strong>
              <small>Not applied</small>
            </span>
          </span>
          <span className="legend-explain">What these mean</span>
        </summary>
        <div className="legend-explanation">
          <section>
            <strong>Scenario state</strong>
            <div className="scenario-state-grid">
              <div>
                <span>Healthy</span>
                <p>The selected scenario does not block this item.</p>
              </div>
              <div>
                <span>Needs review</span>
                <p>Evidence is unknown or stale. Availability is not proven.</p>
              </div>
              <div>
                <span>Blocked</span>
                <p>The item is unavailable or has no active dependency path.</p>
              </div>
              <div>
                <span>Proposed</span>
                <p>An agent-authored draft, excluded from the baseline.</p>
              </div>
            </div>
            <p>
              Scenario impact is recalculated deterministically from the
              selected failure, relationship groups, and workspace version.
            </p>
          </section>
          <section className="evidence-key">
            <strong>Evidence status</strong>
            <div className="evidence-status-grid">
              {trustOrder.map((trust) => (
                <div key={trust}>
                  <span>{trustLabel[trust]}</span>
                  <p>{trustDescription[trust]}</p>
                </div>
              ))}
            </div>
            <p>Images add context only. They never count as evidence.</p>
          </section>
        </div>
      </details>
      <div
        className="accessible-graph-summary"
        role="list"
        aria-label="Graph items and states"
      >
        {entities.map((entity) => (
          <div role="listitem" key={entity.id}>
            <strong>{entity.name}</strong>
            <span>
              {entity.role ?? entity.type.replaceAll("-", " ")} ·{" "}
              {entity.critical ? "Critical item" : "Not marked critical"} ·{" "}
              {stateForEntity(entity)}
            </span>
          </div>
        ))}
      </div>
      <section className="sr-only" aria-labelledby={relationshipListTitleId}>
        <h3 id={relationshipListTitleId}>Graph relationships and paths</h3>
        {relationships.length === 0 ? (
          <p>No relationships are shown in the current graph view.</p>
        ) : (
          <div role="list">
            {relationships.map((relationship) => {
              const fromName =
                entityNames.get(relationship.from) ?? relationship.from;
              const toName =
                entityNames.get(relationship.to) ?? relationship.to;
              const relationshipState = proposedRelationshipIds.has(
                relationship.id,
              )
                ? "Proposed path, not applied"
                : affected.has(relationship.id)
                  ? "Affected by the current scenario"
                  : "Shown in the current graph view";
              return (
                <div role="listitem" key={relationship.id}>
                  <strong>
                    {fromName} to {toName}
                  </strong>
                  <span>
                    Direction: {fromName} to {toName}. Type:{" "}
                    {accessibleRelationshipType(relationship)}. Path group:{" "}
                    {relationship.group ?? "not provided"}. Path label:{" "}
                    {relationship.label ?? "not provided"}. State:{" "}
                    {relationshipState}.
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <div
        className="accessible-graph-list"
        role="group"
        aria-label="Interactive graph list"
      >
        {entities.map((entity) => {
          const hasImage =
            Boolean(entity.image) && !unavailableImages.has(entity.id);
          return (
            <button
              className={hasImage ? "has-image" : "no-image"}
              key={entity.id}
              aria-label={accessibleEntityName(entity, stateForEntity(entity))}
              onClick={() => onSelect(entity.id)}
            >
              {hasImage && (
                <OptionalImage
                  src={entity.image}
                  onUnavailable={() =>
                    setUnavailableImages((current) => {
                      const next = new Set(current);
                      next.add(entity.id);
                      return next;
                    })
                  }
                />
              )}
              <span>
                <strong>{entity.name}</strong>
                <small>
                  {entity.role ?? entity.type.replaceAll("-", " ")} ·{" "}
                  {stateForEntity(entity)}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
