import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  InMemoryWorkspaceRepository,
  WorkspaceService,
  AuthorizationError,
  IdempotencyConflictError,
  InputValidationError,
  NotFoundError,
  VersionConflictError,
} from "../application/workspaceService";
import { PostgresWorkspaceRepository } from "../infrastructure/database/postgresWorkspaceRepository";
import type { Entity, Relationship, Scenario } from "../domain/model";
import {
  acceptProposalSchema,
  agentCreateWorkspaceSchema,
  agentScenarioDesignSchema,
  agentSingleScenarioSchema,
  createWorkspaceSchema,
  createScenarioSchema,
  companyBlueprintSchema,
  customizeProposalSchema,
  delegationDraftSchema,
  draftEntitiesSchema,
  draftRelationshipsSchema,
  deleteWorkspaceSchema,
  loginSchema,
  manualEntitySchema,
  manualRelationshipSchema,
  repairOptionsDraftSchema,
  scenarioInputSchema,
  scheduleDraftSchema,
  updateEntitySchema,
  updateWorkspaceSchema,
} from "../shared/schemas";

const app = new Hono();
export function assertProductionDatabaseConfigured(
  nodeEnvironment: string | undefined,
  databaseUrl: string | undefined,
) {
  if (nodeEnvironment === "production" && !databaseUrl)
    throw new Error(
      "DATABASE_URL is required in production; refusing volatile in-memory storage.",
    );
}

assertProductionDatabaseConfigured(
  process.env.NODE_ENV,
  process.env.DATABASE_URL,
);
const repository = process.env.DATABASE_URL
  ? PostgresWorkspaceRepository.connect(process.env.DATABASE_URL)
  : new InMemoryWorkspaceRepository();
const service = new WorkspaceService(repository);
type SessionRecord = { userId?: string; createdAt: number };
const sessions = new Map<string, SessionRecord>();
const testEmail = process.env.TEST_USER_EMAIL ?? "judge@savemy.systems";
const testPassword = process.env.TEST_USER_PASSWORD ?? "SaveMy-Judge-2026";
const testPasswordHash = await Bun.password.hash(testPassword, {
  algorithm: "argon2id",
  memoryCost: 4096,
  timeCost: 2,
});
const requestBodyLimit = 160 * 1024;
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1_000;

const jsonValidator = <T extends ZodType>(schema: T) =>
  zValidator("json", schema, (result, c) => {
    if (!result.success)
      return c.json(
        {
          error: "Request validation failed.",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
  });

function writeSessionCookie(c: Parameters<typeof setCookie>[0], id: string) {
  setCookie(c, "save_my_session", id, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

async function requestBodyExceedsLimit(request: Request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > requestBodyLimit)
    return true;
  if (!request.body || request.method === "GET" || request.method === "HEAD")
    return false;

  const reader = request.clone().body!.getReader();
  let received = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return false;
      received += chunk.value.byteLength;
      if (received > requestBodyLimit) {
        void reader.cancel("Request body exceeds the application limit.");
        return true;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

app.use(
  "*",
  secureHeaders({
    crossOriginOpenerPolicy: "same-origin",
    originAgentCluster: "?1",
    referrerPolicy: "no-referrer",
    xFrameOptions: "DENY",
  }),
);
app.use("*", async (c, next) => {
  if (await requestBodyExceedsLimit(c.req.raw))
    return c.json({ error: "Request exceeds 160KB." }, 413);
  await next();
  c.header("Permissions-Policy", "tools=(self)");
  c.header(
    "Cache-Control",
    c.req.path.startsWith("/assets/")
      ? "public, max-age=0, must-revalidate"
      : "no-store",
  );
});

async function sessionFor(
  c: Parameters<typeof getCookie>[0],
): Promise<{ id: string; session: SessionRecord }> {
  let id = getCookie(c, "save_my_session");
  if (repository instanceof PostgresWorkspaceRepository) {
    let session = id ? await repository.getSession(id) : undefined;
    if (!id || !session) {
      id = crypto.randomUUID();
      await repository.createSession(id);
      session = { userId: undefined, createdAt: Date.now() };
      writeSessionCookie(c, id);
    }
    return { id, session };
  }
  const existing = id ? sessions.get(id) : undefined;
  if (
    !id ||
    !existing ||
    Date.now() - existing.createdAt >= sessionLifetimeMs
  ) {
    if (id) sessions.delete(id);
    id = crypto.randomUUID();
    sessions.set(id, { createdAt: Date.now() });
    writeSessionCookie(c, id);
  }
  return { id, session: sessions.get(id)! };
}

function scopeForSession(id: string, session: SessionRecord) {
  return session.userId ? `user:${session.userId}` : `demo:${id}`;
}

async function scopeFor(c: Parameters<typeof getCookie>[0]) {
  return (await sessionContextFor(c)).scope;
}

async function sessionContextFor(c: Parameters<typeof getCookie>[0]) {
  const { id, session } = await sessionFor(c);
  return { session, scope: scopeForSession(id, session) };
}

function expectedWorkspaceVersion(c: Context) {
  const value = c.req.query("expectedWorkspaceVersion");
  if (value === undefined) return undefined;
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1)
    throw new InputValidationError(
      "expectedWorkspaceVersion must be a positive integer.",
    );
  return version;
}

app.get("/api/health", (c) =>
  c.json({ status: "ok", runtime: "bun", time: new Date().toISOString() }),
);

app.get("/api/bootstrap", async (c) => {
  const { id, session } = await sessionFor(c);
  const scope = scopeForSession(id, session);
  return c.json({
    user: session.userId
      ? { id: session.userId, email: testEmail, name: "Judge account" }
      : null,
    workspaces: (await service.list(scope)).map(
      ({
        slug,
        name,
        tagline,
        sector,
        cover,
        entities,
        scenarios,
        fictional,
        archived,
      }) => ({
        slug,
        name,
        tagline,
        sector,
        cover,
        entityCount: entities.length,
        scenarioCount: scenarios.length,
        fictional,
        archived: Boolean(archived),
      }),
    ),
    webmcp: { nativeExpected: true, tools: 18 },
  });
});

app.post("/api/auth/login", jsonValidator(loginSchema), async (c) => {
  const input = c.req.valid("json");
  const passwordValid = await Bun.password.verify(
    input.password,
    testPasswordHash,
  );
  const valid =
    input.email.toLowerCase() === testEmail.toLowerCase() && passwordValid;
  if (!valid) return c.json({ error: "Email or password is incorrect." }, 401);
  const previousSessionId = getCookie(c, "save_my_session");
  if (previousSessionId && repository instanceof PostgresWorkspaceRepository)
    await repository.deleteSession(previousSessionId);
  else if (previousSessionId) sessions.delete(previousSessionId);

  const id = crypto.randomUUID();
  const userId = `judge-${id}`;
  if (repository instanceof PostgresWorkspaceRepository) {
    const [localPart = "judge", domain = "savemy.systems"] =
      testEmail.split("@");
    await repository.ensureUser(
      userId,
      `${localPart}+${id}@${domain}`,
      testPasswordHash,
      "Judge account",
    );
    await repository.createSession(id);
    await repository.setSessionUser(id, userId);
  } else sessions.set(id, { userId, createdAt: Date.now() });
  writeSessionCookie(c, id);
  return c.json({
    user: { id: userId, email: testEmail, name: "Judge account" },
  });
});

app.post("/api/auth/logout", async (c) => {
  const id = getCookie(c, "save_my_session");
  if (id && repository instanceof PostgresWorkspaceRepository)
    await repository.deleteSession(id);
  else if (id) sessions.delete(id);
  deleteCookie(c, "save_my_session", { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/workspaces/:slug", async (c) => {
  const scope = await scopeFor(c);
  return c.json(await service.getWorkspaceOverview(scope, c.req.param("slug")));
});

app.post("/api/workspaces", jsonValidator(createWorkspaceSchema), async (c) => {
  const { session, scope } = await sessionContextFor(c);
  if (!session.userId)
    return c.json({ error: "Sign in to create a persistent workspace." }, 401);
  return c.json(
    {
      workspace: await service.create(scope, c.req.valid("json").name),
    },
    201,
  );
});

app.post(
  "/api/account/companies",
  jsonValidator(agentCreateWorkspaceSchema),
  async (c) => {
    const { session, scope } = await sessionContextFor(c);
    if (!session.userId)
      return c.json(
        { error: "Sign in before creating a company through Site Tools." },
        401,
      );
    const input = c.req.valid("json");
    const workspace = await service.create(scope, input.name, {
      idempotencyKey: input.idempotencyKey,
      actor: "agent",
      setupMode: input.setupMode,
    });
    return c.json(
      {
        workspace,
        setupMode: input.setupMode,
        baselineChanged: false,
        nextTool:
          input.setupMode === "agent-blueprint"
            ? "draft_company_blueprint"
            : null,
        guidance:
          input.setupMode === "agent-blueprint"
            ? "The empty company is now active. Read get_workspace_summary, then stage one connected map with draft_company_blueprint. Do not use browser or computer control."
            : "The empty company is now active for manual setup.",
      },
      201,
    );
  },
);

app.post("/api/workspaces/:slug/duplicate", async (c) => {
  const { session, scope } = await sessionContextFor(c);
  if (!session.userId)
    return c.json({ error: "Sign in to create an editable demo copy." }, 401);
  return c.json(
    {
      workspace: await service.duplicate(scope, c.req.param("slug")),
    },
    201,
  );
});

app.patch(
  "/api/workspaces/:slug",
  jsonValidator(updateWorkspaceSchema),
  async (c) => {
    const { session, scope } = await sessionContextFor(c);
    if (!session.userId)
      return c.json({ error: "Sign in to manage a workspace." }, 401);
    const { workspaceVersion, ...changes } = c.req.valid("json");
    return c.json({
      workspace: await service.updateWorkspace(
        scope,
        c.req.param("slug"),
        workspaceVersion,
        changes,
      ),
    });
  },
);

app.delete(
  "/api/workspaces/:slug",
  jsonValidator(deleteWorkspaceSchema),
  async (c) => {
    const { session, scope } = await sessionContextFor(c);
    if (!session.userId)
      return c.json({ error: "Sign in to delete a workspace." }, 401);
    await service.deleteWorkspace(
      scope,
      c.req.param("slug"),
      c.req.valid("json").workspaceVersion,
    );
    return c.json({ ok: true });
  },
);

app.post(
  "/api/workspaces/:slug/entities",
  jsonValidator(manualEntitySchema),
  async (c) => {
    const { session, scope } = await sessionContextFor(c);
    if (!session.userId)
      return c.json({ error: "Sign in to edit a workspace." }, 401);
    const { workspaceVersion, ...entity } = c.req.valid("json");
    return c.json(
      await service.addEntity(
        scope,
        c.req.param("slug"),
        workspaceVersion,
        entity,
      ),
      201,
    );
  },
);

app.patch(
  "/api/workspaces/:slug/entities/:entityId",
  jsonValidator(updateEntitySchema),
  async (c) => {
    const { session, scope } = await sessionContextFor(c);
    if (!session.userId)
      return c.json({ error: "Sign in to edit a workspace." }, 401);
    const { workspaceVersion, ...patch } = c.req.valid("json");
    return c.json(
      await service.updateEntity(
        scope,
        c.req.param("slug"),
        c.req.param("entityId"),
        workspaceVersion,
        patch,
      ),
    );
  },
);

app.post(
  "/api/workspaces/:slug/relationships",
  jsonValidator(manualRelationshipSchema),
  async (c) => {
    const { session, scope } = await sessionContextFor(c);
    if (!session.userId)
      return c.json({ error: "Sign in to edit a workspace." }, 401);
    const { workspaceVersion, ...relationship } = c.req.valid("json");
    return c.json(
      await service.addRelationship(
        scope,
        c.req.param("slug"),
        workspaceVersion,
        relationship,
      ),
      201,
    );
  },
);

app.post("/api/workspaces/:slug/reset", async (c) =>
  c.json({
    workspace: await service.resetDemo(await scopeFor(c), c.req.param("slug")),
  }),
);

app.post(
  "/api/workspaces/:slug/simulate",
  jsonValidator(scenarioInputSchema),
  async (c) => {
    const input = c.req.valid("json");
    const scope = await scopeFor(c);
    const scenario: Scenario = {
      id: input.id ?? `scenario-${crypto.randomUUID().slice(0, 8)}`,
      name: input.name,
      unavailableEntityIds: input.unavailableEntityIds,
      durationDays: input.durationDays,
      context: input.context,
      createdBy: "agent",
      draft: true,
    };
    return c.json({
      scenario,
      simulation: await service.simulate(
        scope,
        c.req.param("slug"),
        scenario,
        input.workspaceVersion,
      ),
    });
  },
);

app.post(
  "/api/workspaces/:slug/scenarios",
  jsonValidator(createScenarioSchema),
  async (c) => {
    const input = c.req.valid("json");
    return c.json(
      await service.createScenario(
        await scopeFor(c),
        c.req.param("slug"),
        input.workspaceVersion,
        {
          name: input.name,
          unavailableEntityIds: input.unavailableEntityIds,
          durationDays: input.durationDays,
          context: input.context,
          createdBy: "human",
          draft: false,
        },
      ),
      201,
    );
  },
);

app.post(
  "/api/workspaces/:slug/draft/scenario",
  jsonValidator(agentSingleScenarioSchema),
  async (c) => {
    const input = c.req.valid("json");
    const result = await service.createAgentScenarioDraft(
      await scopeFor(c),
      c.req.param("slug"),
      input.workspaceVersion,
      input.idempotencyKey,
      input.scenario,
    );
    return c.json({
      scenarios: result.scenarios,
      simulations: result.simulations,
      workspaceVersion: result.workspace.version,
      baselineChanged: false,
      humanReviewRequired: true,
    });
  },
);

app.post(
  "/api/workspaces/:slug/draft/scenarios",
  jsonValidator(agentScenarioDesignSchema),
  async (c) => {
    const input = c.req.valid("json");
    const result = await service.designAgentScenarios(
      await scopeFor(c),
      c.req.param("slug"),
      input.workspaceVersion,
      input.idempotencyKey,
      input.scenarios,
    );
    return c.json({
      scenarios: result.scenarios,
      simulations: result.simulations,
      workspaceVersion: result.workspace.version,
      baselineChanged: false,
      humanReviewRequired: true,
    });
  },
);

app.get("/api/workspaces/:slug/validate", async (c) =>
  c.json(
    await service.validate(
      await scopeFor(c),
      c.req.param("slug"),
      expectedWorkspaceVersion(c),
    ),
  ),
);

app.get("/api/workspaces/:slug/search", async (c) => {
  const workspace = await service.get(await scopeFor(c), c.req.param("slug"));
  const query = (c.req.query("q") ?? "").toLowerCase().slice(0, 120);
  const entities = workspace.entities
    .filter((entity) =>
      `${entity.name} ${entity.type} ${entity.description ?? ""}`
        .toLowerCase()
        .includes(query),
    )
    .slice(0, 20);
  return c.json({ workspaceVersion: workspace.version, entities });
});

app.post(
  "/api/workspaces/:slug/draft/repair-options",
  jsonValidator(repairOptionsDraftSchema),
  async (c) => {
    const input = c.req.valid("json");
    const scope = await scopeFor(c);
    const slug = c.req.param("slug");
    const proposals = await service.stageAgentRepairOptions(
      scope,
      slug,
      input.scenarioId,
      input.workspaceVersion,
      input.idempotencyKey,
      input.options,
    );
    return c.json(
      {
        proposals,
        workspaceVersion: proposals.workspaceVersion,
      },
      201,
    );
  },
);

app.get("/api/workspaces/:slug/proposals/:proposalId/compare", async (c) => {
  const scenarioId = c.req.query("scenarioId") ?? "";
  return c.json(
    await service.compare(
      await scopeFor(c),
      c.req.param("slug"),
      scenarioId,
      c.req.param("proposalId"),
      expectedWorkspaceVersion(c),
    ),
  );
});

app.patch(
  "/api/workspaces/:slug/proposals/:proposalId",
  jsonValidator(customizeProposalSchema),
  async (c) => {
    const input = c.req.valid("json");
    return c.json(
      await service.customizeProposal(
        await scopeFor(c),
        c.req.param("slug"),
        c.req.param("proposalId"),
        input.workspaceVersion,
        input.title,
        input.relationshipTargets,
        input.entityNames,
      ),
    );
  },
);

app.post(
  "/api/workspaces/:slug/proposals/:proposalId/:decision",
  jsonValidator(acceptProposalSchema),
  async (c) => {
    const decision = c.req.param("decision");
    if (!["accept", "reject"].includes(decision))
      return c.json({ error: "Unknown decision." }, 400);
    const workspace = await service.decideProposal(
      await scopeFor(c),
      c.req.param("slug"),
      c.req.param("proposalId"),
      c.req.valid("json").workspaceVersion,
      decision === "accept" ? "ACCEPTED" : "REJECTED",
      "human",
    );
    return c.json({ workspace });
  },
);

app.post(
  "/api/workspaces/:slug/draft/company-blueprint",
  jsonValidator(companyBlueprintSchema),
  async (c) => {
    const input = c.req.valid("json");
    const scope = await scopeFor(c);
    const slug = c.req.param("slug");
    const { coverage, workspaceVersion, ...proposal } =
      await service.draftCompanyBlueprint(
        scope,
        slug,
        input.workspaceVersion,
        input.idempotencyKey,
        input.companyName,
        input.companySummary,
        input.entities,
        input.relationships,
      );
    return c.json(
      {
        proposal,
        workspaceVersion,
        blueprintReview: {
          ...coverage,
          baselineChanged: false,
          humanReviewRequired: true,
          imagePolicy:
            "Type-matched reviewed placeholders are proposed for context; they are not evidence.",
        },
      },
      201,
    );
  },
);

app.post(
  "/api/workspaces/:slug/draft/entities",
  jsonValidator(draftEntitiesSchema),
  async (c) => {
    const input = c.req.valid("json");
    const scope = await scopeFor(c);
    const slug = c.req.param("slug");
    const entities: Entity[] = input.entities.map((entity) => ({
      id: `draft-${crypto.randomUUID().slice(0, 8)}`,
      ...entity,
      trust: "INFERRED",
    }));
    const { workspaceVersion, ...proposal } = await service.draft(
      scope,
      slug,
      input.workspaceVersion,
      input.idempotencyKey,
      entities,
      [],
    );
    return c.json({ proposal, workspaceVersion }, 201);
  },
);

app.post(
  "/api/workspaces/:slug/draft/relationships",
  jsonValidator(draftRelationshipsSchema),
  async (c) => {
    const input = c.req.valid("json");
    const scope = await scopeFor(c);
    const slug = c.req.param("slug");
    const relationships: Relationship[] = input.relationships.map(
      (relationship) => ({
        id: `draft-${crypto.randomUUID().slice(0, 8)}`,
        ...relationship,
        trust: "INFERRED",
      }),
    );
    const { workspaceVersion, ...proposal } = await service.draft(
      scope,
      slug,
      input.workspaceVersion,
      input.idempotencyKey,
      [],
      relationships,
    );
    return c.json({ proposal, workspaceVersion }, 201);
  },
);

app.post(
  "/api/workspaces/:slug/draft/delegation",
  jsonValidator(delegationDraftSchema),
  async (c) => {
    const input = c.req.valid("json");
    const scope = await scopeFor(c);
    const slug = c.req.param("slug");
    const { workspaceVersion, ...proposal } = await service.draftDelegation(
      scope,
      slug,
      input.workspaceVersion,
      input.idempotencyKey,
      input.primaryPersonId,
      input.fallbackPersonId,
      input.responsibilityId,
      input.note,
    );
    return c.json({ proposal, workspaceVersion }, 201);
  },
);

app.post(
  "/api/workspaces/:slug/draft/schedule",
  jsonValidator(scheduleDraftSchema),
  async (c) => {
    const input = c.req.valid("json");
    const scope = await scopeFor(c);
    const slug = c.req.param("slug");
    const { workspaceVersion, ...proposal } = await service.draftSchedule(
      scope,
      slug,
      input.workspaceVersion,
      input.idempotencyKey,
      input.entityId,
      input.dueAt,
      input.note,
      input.executionMode,
    );
    return c.json({ proposal, workspaceVersion }, 201);
  },
);

app.get("/api/workspaces/:slug/activity", async (c) => {
  const requestedLimit = Number(c.req.query("limit") ?? 20);
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit >= 1
      ? Math.min(requestedLimit, 50)
      : 20;
  const workspace = await service.get(await scopeFor(c), c.req.param("slug"));
  return c.json({
    workspaceVersion: workspace.version,
    activity: workspace.activity.slice(0, limit),
  });
});

app.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  if (error instanceof InputValidationError)
    return c.json({ error: error.message }, 400);
  if (error instanceof IdempotencyConflictError)
    return c.json({ error: error.message }, 409);
  if (error instanceof VersionConflictError)
    return c.json(
      { error: error.message, currentVersion: error.currentVersion },
      409,
    );
  if (error instanceof AuthorizationError)
    return c.json({ error: error.message }, 403);
  if (error instanceof NotFoundError)
    return c.json({ error: error.message }, 404);
  console.error(error);
  return c.json({ error: "The request could not be completed." }, 500);
});

const apiNotFound = (c: Context) =>
  c.json({ error: "API route not found." }, 404);
app.all("/api", apiNotFound);
app.all("/api/*", apiNotFound);

const webRoot = resolve(import.meta.dir, "../../dist/web");
export function isPathInside(root: string, candidate: string) {
  const relativePath = relative(root, candidate);
  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

app.get("*", async (c) => {
  if (!existsSync(webRoot))
    return c.text(
      "SAVE MY… API is running. Start Vite for the interface.",
      200,
    );
  const requested = c.req.path === "/" ? "index.html" : c.req.path.slice(1);
  const filePath = resolve(webRoot, requested);
  const safePath =
    isPathInside(webRoot, filePath) && existsSync(filePath)
      ? filePath
      : resolve(webRoot, "index.html");
  const file = Bun.file(safePath);
  return new Response(file, {
    headers: { "Content-Type": file.type || "text/html; charset=utf-8" },
  });
});

const port = Number(process.env.PORT ?? 3000);
if (import.meta.main) {
  console.log(`SAVE MY… listening on http://localhost:${port}`);
  Bun.serve({ port, fetch: app.fetch });
}

export { app };
