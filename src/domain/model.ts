export const trustStates = [
  "DECLARED",
  "INFERRED",
  "VERIFIED",
  "UNKNOWN",
  "STALE",
  "DISPUTED",
] as const;
type TrustState = (typeof trustStates)[number];

export const entityTypes = [
  "person",
  "team",
  "service",
  "vendor",
  "device",
  "document",
  "account",
  "workflow",
  "location",
  "communication-channel",
  "recovery-mechanism",
] as const;
type EntityType = (typeof entityTypes)[number];

export const relationshipTypes = [
  "depends-on",
  "owned-by",
  "administered-by",
  "accessible-by",
  "recovers-via",
  "blocks",
  "substitutes-for",
  "communicates-through",
  "stored-in",
  "required-by",
] as const;
type RelationshipType = (typeof relationshipTypes)[number];

type AccessMetadata = {
  recoveryMethodExists?: boolean;
  secondaryOwner?: string;
  lastVerifiedAt?: string;
  verificationStatus?: TrustState;
  storageLocationCategory?: string;
  requiresPersonalDevice?: boolean;
  requiresPersonalEmail?: boolean;
  documentationExists?: boolean;
  note?: string;
  dueAt?: string;
  rescheduleNote?: string;
  effortHours?: number;
  executionMode?: "human" | "agent" | "shared";
};

export type Entity = {
  id: string;
  name: string;
  type: EntityType;
  trust: TrustState;
  critical?: boolean;
  description?: string;
  role?: string;
  team?: string;
  image?: string;
  metadata?: AccessMetadata;
};

export type Relationship = {
  id: string;
  from: string;
  to: string;
  type: RelationshipType;
  trust: TrustState;
  group?: string;
  label?: string;
};

export type Scenario = {
  id: string;
  name: string;
  unavailableEntityIds: string[];
  durationDays: number;
  context: string;
  createdBy: "system" | "human" | "agent";
  draft?: boolean;
  designGroupId?: string;
  idempotencyFingerprint?: string;
  createdAt?: string;
  resolution?: {
    status: "RESOLVED" | "PARTIAL";
    proposalId: string;
    resolvedAt: string;
    restoredWorkflowIds: string[];
    residualBlockedWorkflowIds: string[];
  };
};

export type ProposalChange =
  | { op: "add-relationship"; relationship: Relationship }
  | { op: "add-entity"; entity: Entity }
  | {
      op: "update-entity";
      entityId: string;
      patch: Partial<
        Pick<
          Entity,
          | "name"
          | "type"
          | "trust"
          | "critical"
          | "description"
          | "role"
          | "team"
          | "image"
          | "metadata"
        >
      >;
    };

type ProposalTradeoff = {
  effort: "LOW" | "MEDIUM" | "HIGH";
  timeToRestoreHours: number;
  residualRisk: "LOW" | "MEDIUM" | "HIGH";
  summary: string;
};

type AgentRepairChange =
  | { op: "add-relationship"; relationship: Omit<Relationship, "trust"> }
  | { op: "add-entity"; entity: Omit<Entity, "trust"> }
  | {
      op: "update-entity";
      entityId: string;
      patch: Partial<Omit<Entity, "id" | "trust">>;
    };

export type AgentRepairOption = {
  optionLabel: string;
  title: string;
  rationale: string;
  assumptions: string[];
  tradeoff: ProposalTradeoff;
  changes: AgentRepairChange[];
};

export type Proposal = {
  id: string;
  title: string;
  rationale: string;
  status: "PROPOSED" | "ACCEPTED" | "REJECTED";
  changes: ProposalChange[];
  createdBy: "system" | "agent" | "human";
  baseVersion: number;
  baselineFingerprint?: string;
  assumptions: string[];
  createdAt: string;
  kind?: "REPAIR" | "MAP_DRAFT" | "DELEGATION" | "SCHEDULE";
  scenarioId?: string;
  optionGroupId?: string;
  optionLabel?: string;
  strategy?: string;
  tradeoff?: ProposalTradeoff;
  idempotencyToken?: string;
  idempotencyFingerprint?: string;
};

export type ActivityEntry = {
  id: string;
  action: string;
  detail: string;
  actor: "system" | "human" | "agent";
  at: string;
  version: number;
};

export type Workspace = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  sector: "studio" | "education" | "hospitality" | "charter" | "custom";
  fictional: boolean;
  cover?: string;
  version: number;
  entities: Entity[];
  relationships: Relationship[];
  scenarios: Scenario[];
  proposals: Proposal[];
  activity: ActivityEntry[];
  archived?: boolean;
  seedRevision?: number;
  creationIdempotencyFingerprint?: string;
};

export type SimulationResult = {
  scenarioId: string;
  workspaceVersion: number;
  unavailableEntityIds: string[];
  blockedEntityIds: string[];
  affectedRelationshipIds: string[];
  blockedWorkflowIds: string[];
  depths: Record<string, number>;
  orderedCascade: string[][];
  smallestRelevantEntityIds: string[];
  assumptions: string[];
};

export type ContinuityIssue = {
  code:
    | "SINGLE_POINT"
    | "MISSING_OWNER"
    | "STALE_RECOVERY"
    | "UNKNOWN_FACT"
    | "CYCLE"
    | "ORPHAN";
  severity: "critical" | "warning" | "info";
  entityIds: string[];
  message: string;
};

export type ValidationResult = {
  workspaceVersion: number;
  issues: ContinuityIssue[];
  counts: Record<ContinuityIssue["code"], number>;
};
