import { z } from "zod";
import { entityTypes, relationshipTypes, trustStates } from "../domain/model";

const trustStateSchema = z.enum(trustStates);
const entityTypeSchema = z.enum(entityTypes);
const relationshipTypeSchema = z.enum(relationshipTypes);

export const scenarioInputSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(120),
  unavailableEntityIds: z.array(z.string().min(1).max(80)).min(1).max(8),
  durationDays: z.number().int().min(1).max(30),
  context: z.string().max(500).default(""),
  workspaceVersion: z.number().int().positive(),
});

const agentMetadataSchema = z.object({
  recoveryMethodExists: z.boolean().optional(),
  secondaryOwner: z.string().max(120).optional(),
  lastVerifiedAt: z.string().max(40).optional(),
  verificationStatus: trustStateSchema.optional(),
  storageLocationCategory: z.string().max(120).optional(),
  requiresPersonalDevice: z.boolean().optional(),
  requiresPersonalEmail: z.boolean().optional(),
  documentationExists: z.boolean().optional(),
  note: z.string().max(300).optional(),
  dueAt: z.string().max(40).optional(),
  rescheduleNote: z.string().max(300).optional(),
  effortHours: z.number().min(0).max(1_000).optional(),
  executionMode: z.enum(["human", "agent", "shared"]).optional(),
});

const agentEntitySchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  type: entityTypeSchema,
  critical: z.boolean().optional(),
  description: z.string().max(600).optional(),
  role: z.string().max(120).optional(),
  team: z.string().max(120).optional(),
  metadata: agentMetadataSchema.optional(),
});

const agentEntityPatchSchema = agentEntitySchema
  .omit({ id: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "An item update must contain at least one material field.",
  });

const agentRelationshipSchema = z.object({
  id: z.string().min(1).max(80),
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  type: relationshipTypeSchema,
  group: z.string().max(80).optional(),
  label: z.string().max(120).optional(),
});

const agentRepairChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add-entity"), entity: agentEntitySchema }),
  z.object({
    op: z.literal("add-relationship"),
    relationship: agentRelationshipSchema,
  }),
  z.object({
    op: z.literal("update-entity"),
    entityId: z.string().min(1).max(80),
    patch: agentEntityPatchSchema,
  }),
]);

export const repairOptionsDraftSchema = z.object({
  scenarioId: z.string().min(1).max(80),
  workspaceVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(120),
  options: z
    .array(
      z.object({
        optionLabel: z.string().min(1).max(8),
        title: z.string().min(1).max(120),
        rationale: z.string().min(1).max(600),
        assumptions: z.array(z.string().min(1).max(300)).max(12),
        tradeoff: z.object({
          effort: z.enum(["LOW", "MEDIUM", "HIGH"]),
          timeToRestoreHours: z.number().min(0).max(10_000),
          residualRisk: z.enum(["LOW", "MEDIUM", "HIGH"]),
          summary: z.string().min(1).max(300),
        }),
        changes: z.array(agentRepairChangeSchema).min(2).max(100),
      }),
    )
    .min(1)
    .max(3),
});

export const acceptProposalSchema = z.object({
  workspaceVersion: z.number().int().positive(),
});

export const customizeProposalSchema = z.object({
  workspaceVersion: z.number().int().positive(),
  title: z.string().min(1).max(120),
  relationshipTargets: z
    .array(
      z.object({
        changeIndex: z.number().int().min(0).max(199),
        to: z.string().min(1).max(80),
      }),
    )
    .max(100),
  entityNames: z
    .array(
      z.object({
        changeIndex: z.number().int().min(0).max(199),
        name: z.string().min(1).max(120),
      }),
    )
    .max(50),
});

const entityDraftSchema = z.object({
  name: z.string().min(1).max(120),
  type: entityTypeSchema,
  description: z.string().max(300).optional(),
});

const relationshipDraftSchema = z.object({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  type: relationshipTypeSchema,
  group: z.string().max(80).optional(),
  label: z.string().max(120).optional(),
});

export const draftEntitiesSchema = z.object({
  workspaceVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(120),
  entities: z.array(entityDraftSchema).min(1).max(20),
});

export const draftRelationshipsSchema = z.object({
  workspaceVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(120),
  relationships: z.array(relationshipDraftSchema).min(1).max(30),
});

export const companyBlueprintSchema = z.object({
  workspaceVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(120),
  companyName: z.string().min(2).max(120),
  companySummary: z.string().min(20).max(1_200),
  entities: z
    .array(
      z.object({
        ref: z.string().min(1).max(60),
        name: z.string().min(1).max(120),
        type: entityTypeSchema,
        description: z.string().min(1).max(500),
        role: z.string().max(120).optional(),
        team: z.string().max(120).optional(),
        critical: z.boolean().default(false),
      }),
    )
    .min(4)
    .max(50),
  relationships: z
    .array(
      z.object({
        fromRef: z.string().min(1).max(60),
        toRef: z.string().min(1).max(60),
        type: relationshipTypeSchema,
        group: z.string().max(80).optional(),
        label: z.string().max(120).optional(),
      }),
    )
    .min(3)
    .max(100),
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(80),
});
export const agentCreateWorkspaceSchema = createWorkspaceSchema.extend({
  idempotencyKey: z.string().min(8).max(120),
  setupMode: z.enum(["manual", "agent-blueprint"]).default("agent-blueprint"),
});
export const updateWorkspaceSchema = z
  .object({
    name: z.string().min(2).max(80).optional(),
    archived: z.boolean().optional(),
    workspaceVersion: z.number().int().positive(),
  })
  .refine(
    (value) => value.name !== undefined || value.archived !== undefined,
    "At least one change is required.",
  );

export const deleteWorkspaceSchema = z.object({
  workspaceVersion: z.number().int().positive(),
});

export const manualEntitySchema = z.object({
  workspaceVersion: z.number().int().positive(),
  name: z.string().min(1).max(120),
  type: entityTypeSchema,
  description: z.string().max(600).optional(),
  role: z.string().max(120).optional(),
  team: z.string().max(120).optional(),
  image: z.string().max(60_000).optional(),
  critical: z.boolean().default(false),
  metadata: z
    .object({
      dueAt: z.string().max(40).optional(),
      rescheduleNote: z.string().max(300).optional(),
      effortHours: z.number().min(0).max(1_000).optional(),
      executionMode: z.enum(["human", "agent", "shared"]).optional(),
      note: z.string().max(300).optional(),
    })
    .optional(),
});

export const updateEntitySchema = manualEntitySchema.partial().extend({
  workspaceVersion: z.number().int().positive(),
});

export const createScenarioSchema = scenarioInputSchema.extend({
  createdBy: z.enum(["human", "agent"]).default("human"),
});

const agentScenarioDraftSchema = z.object({
  name: z.string().min(1).max(120),
  unavailableEntityIds: z.array(z.string().min(1).max(80)).min(1).max(8),
  durationDays: z.number().int().min(1).max(30),
  context: z.string().min(1).max(500),
});

export const agentSingleScenarioSchema = z.object({
  workspaceVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(120),
  scenario: agentScenarioDraftSchema,
});

export const agentScenarioDesignSchema = z.object({
  workspaceVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(120),
  scenarios: z.array(agentScenarioDraftSchema).min(3).max(5),
});

export const delegationDraftSchema = z.object({
  workspaceVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(120),
  primaryPersonId: z.string().min(1).max(80),
  fallbackPersonId: z.string().min(1).max(80),
  responsibilityId: z.string().min(1).max(80).optional(),
  note: z.string().max(300).default(""),
});

export const scheduleDraftSchema = z.object({
  workspaceVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(120),
  entityId: z.string().min(1).max(80),
  dueAt: z.string().min(1).max(40),
  note: z.string().max(300).default(""),
  executionMode: z.enum(["human", "agent", "shared"]).default("shared"),
});

export const manualRelationshipSchema = z.object({
  workspaceVersion: z.number().int().positive(),
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  type: relationshipTypeSchema,
  group: z.string().max(80).optional(),
  label: z.string().max(120).optional(),
});
export const loginSchema = z.object({
  email: z.string().email().max(180),
  password: z.string().min(8).max(200),
});
