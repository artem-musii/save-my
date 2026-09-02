import { describe, expect, setSystemTime, test } from "bun:test";
import { app, assertProductionDatabaseConfigured, isPathInside } from "./index";
import { wowProjectBlueprint } from "../fixtures/wowProjectBlueprint";

const credentials = {
  email: "judge@savemy.systems",
  password: "SaveMy-Judge-2026",
};
const inMemoryServerTest = process.env.DATABASE_URL ? test.skip : test;

async function loginCookie() {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  return cookie!;
}

async function anonymousWorkspace(slug = "northstar-studio") {
  const response = await app.request(`/api/workspaces/${slug}`);
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  const body = (await response.json()) as {
    workspace: { slug: string; version: number };
  };
  return { cookie: cookie!, workspace: body.workspace };
}

async function jsonRequest(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  cookie?: string,
) {
  return app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("HTTP contracts", () => {
  test("health endpoint is available", async () => {
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe("ok");
  });

  test("refuses volatile storage in production", () => {
    expect(() =>
      assertProductionDatabaseConfigured("production", undefined),
    ).toThrow("DATABASE_URL is required in production");
    expect(() =>
      assertProductionDatabaseConfigured(
        "production",
        "postgres://database/save-my",
      ),
    ).not.toThrow();
    expect(() =>
      assertProductionDatabaseConfigured("test", undefined),
    ).not.toThrow();
  });

  test("serves the WebMCP permission and safe cache policy on the SPA", async () => {
    const response = await app.request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("permissions-policy")).toBe("tools=(self)");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const stableAsset = await app.request("/assets/demo-studio.webp");
    expect(stableAsset.status).toBe(200);
    expect(stableAsset.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });

  test("keeps API 404s in JSON and rejects static prefix/traversal escapes", async () => {
    const missing = await app.request("/api/not-a-real-route");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");
    expect(await missing.json()).toEqual({ error: "API route not found." });

    expect(
      isPathInside("/srv/save-my/dist/web", "/srv/save-my/dist/web/index.html"),
    ).toBeTrue();
    expect(
      isPathInside("/srv/save-my/dist/web", "/srv/save-my/dist/web-evil/leak"),
    ).toBeFalse();
    expect(
      isPathInside("/srv/save-my/dist/web", "/srv/save-my/package.json"),
    ).toBeFalse();
  });

  test("demo access does not require authentication", async () => {
    const response = await app.request("/api/workspaces/northstar-studio");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workspace: { name: string };
      simulation: { blockedWorkflowIds: string[] };
    };
    expect(body.workspace.name).toBe("Diamond Apps");
    expect(body.simulation.blockedWorkflowIds).toContain("studio-release");
  });

  test("rejects an incorrect login", async () => {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "wrong@example.com",
        password: "incorrect-password",
      }),
    });
    expect(response.status).toBe(401);
  });

  test("returns bounded JSON errors for malformed and invalid request bodies", async () => {
    const malformed = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
      error: "Malformed JSON in request body",
    });

    const invalid = await jsonRequest("/api/workspaces", "POST", {
      name: "x",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: "Request validation failed.",
      issues: [{ path: "name" }],
    });
  });

  inMemoryServerTest(
    "expires an in-memory session after the documented seven days",
    async () => {
      const startedAt = Date.now();
      const cookie = await loginCookie();
      try {
        setSystemTime(startedAt + 8 * 24 * 60 * 60 * 1_000);
        const expired = await app.request("/api/bootstrap", {
          headers: { cookie },
        });
        expect(expired.status).toBe(200);
        expect((await expired.json()) as { user: unknown }).toMatchObject({
          user: null,
        });
        expect(expired.headers.get("set-cookie")?.split(";")[0]).not.toBe(
          cookie,
        );
      } finally {
        setSystemTime();
      }
    },
  );

  test("requires authentication for persistent workspace writes", async () => {
    const response = await app.request("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Unauthorized workspace" }),
    });
    expect(response.status).toBe(401);
  });

  test("creates an empty company idempotently through the native account route", async () => {
    const unauthorized = await app.request("/api/account/companies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Native company",
        idempotencyKey: "native-company-server-v1",
        setupMode: "agent-blueprint",
      }),
    });
    expect(unauthorized.status).toBe(401);

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "judge@savemy.systems",
        password: "SaveMy-Judge-2026",
      }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const input = {
      name: "Native company",
      idempotencyKey: "native-company-server-v1",
      setupMode: "agent-blueprint",
    };
    const created = await app.request("/api/account/companies", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie! },
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(201);
    const first = (await created.json()) as {
      workspace: {
        id: string;
        slug: string;
        version: number;
        entities: unknown[];
        relationships: unknown[];
      };
      baselineChanged: boolean;
      nextTool: string;
    };
    expect(first.workspace.entities).toHaveLength(0);
    expect(first.workspace.relationships).toHaveLength(0);
    expect(first.workspace.version).toBe(1);
    expect(first.baselineChanged).toBeFalse();
    expect(first.nextTool).toBe("draft_company_blueprint");

    const retry = await app.request("/api/account/companies", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie! },
      body: JSON.stringify(input),
    });
    const second = (await retry.json()) as typeof first;
    expect(second.workspace.id).toBe(first.workspace.id);
    expect(second.workspace.slug).toBe(first.workspace.slug);
    const mismatch = await app.request("/api/account/companies", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie! },
      body: JSON.stringify({ ...input, name: "Different retry name" }),
    });
    expect(mismatch.status).toBe(409);
    const setupModeMismatch = await app.request("/api/account/companies", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie! },
      body: JSON.stringify({ ...input, setupMode: "manual" }),
    });
    expect(setupModeMismatch.status).toBe(409);
  });

  test("stages focused map drafts and a complete blueprint through HTTP", async () => {
    const cookie = await loginCookie();
    const focusedCreated = await jsonRequest(
      "/api/workspaces",
      "POST",
      { name: "Focused draft company" },
      cookie,
    );
    const focused = (await focusedCreated.json()) as {
      workspace: { slug: string; version: number };
    };
    const entityDraftResponse = await jsonRequest(
      `/api/workspaces/${focused.workspace.slug}/draft/entities`,
      "POST",
      {
        workspaceVersion: focused.workspace.version,
        idempotencyKey: "focused-entities-server",
        entities: [
          { name: "Primary owner", type: "person" },
          { name: "Fallback owner", type: "person" },
          { name: "Critical workflow", type: "workflow" },
        ],
      },
      cookie,
    );
    expect(entityDraftResponse.status).toBe(201);
    const entityDraft = (await entityDraftResponse.json()) as {
      proposal: { id: string };
      workspaceVersion: number;
    };
    const acceptedEntitiesResponse = await jsonRequest(
      `/api/workspaces/${focused.workspace.slug}/proposals/${entityDraft.proposal.id}/accept`,
      "POST",
      { workspaceVersion: entityDraft.workspaceVersion },
      cookie,
    );
    expect(acceptedEntitiesResponse.status).toBe(200);
    const acceptedEntities = (await acceptedEntitiesResponse.json()) as {
      workspace: {
        version: number;
        entities: Array<{ id: string; name: string; trust: string }>;
      };
    };
    expect(acceptedEntities.workspace.entities).toHaveLength(3);
    expect(
      acceptedEntities.workspace.entities.every(
        (entity) => entity.trust === "INFERRED",
      ),
    ).toBeTrue();
    const workflowId = acceptedEntities.workspace.entities.find(
      (entity) => entity.name === "Critical workflow",
    )!.id;
    const ownerId = acceptedEntities.workspace.entities.find(
      (entity) => entity.name === "Primary owner",
    )!.id;

    const relationshipDraftResponse = await jsonRequest(
      `/api/workspaces/${focused.workspace.slug}/draft/relationships`,
      "POST",
      {
        workspaceVersion: acceptedEntities.workspace.version,
        idempotencyKey: "focused-paths-server",
        relationships: [
          {
            from: workflowId,
            to: ownerId,
            type: "owned-by",
            group: "ownership",
          },
        ],
      },
      cookie,
    );
    expect(relationshipDraftResponse.status).toBe(201);
    const relationshipDraft = (await relationshipDraftResponse.json()) as {
      proposal: { id: string };
      workspaceVersion: number;
    };
    const acceptedPath = await jsonRequest(
      `/api/workspaces/${focused.workspace.slug}/proposals/${relationshipDraft.proposal.id}/accept`,
      "POST",
      { workspaceVersion: relationshipDraft.workspaceVersion },
      cookie,
    );
    expect(await acceptedPath.json()).toMatchObject({
      workspace: {
        relationships: [{ from: workflowId, to: ownerId, trust: "INFERRED" }],
      },
    });

    const companyName = `Blueprint ${crypto.randomUUID().slice(0, 8)}`;
    const blueprintCreatedResponse = await jsonRequest(
      "/api/account/companies",
      "POST",
      {
        name: companyName,
        idempotencyKey: `blueprint-company-${crypto.randomUUID()}`,
        setupMode: "agent-blueprint",
      },
      cookie,
    );
    const blueprintCreated = (await blueprintCreatedResponse.json()) as {
      workspace: { slug: string; version: number };
    };
    const blueprintResponse = await jsonRequest(
      `/api/workspaces/${blueprintCreated.workspace.slug}/draft/company-blueprint`,
      "POST",
      {
        workspaceVersion: blueprintCreated.workspace.version,
        idempotencyKey: "complete-blueprint-server",
        ...wowProjectBlueprint,
        companyName,
      },
      cookie,
    );
    expect(blueprintResponse.status).toBe(201);
    const blueprint = (await blueprintResponse.json()) as {
      proposal: { id: string; changes: unknown[] };
      workspaceVersion: number;
      blueprintReview: {
        baselineChanged: boolean;
        humanReviewRequired: boolean;
      };
    };
    expect(blueprint.proposal.changes).toHaveLength(118);
    expect(blueprint.blueprintReview).toMatchObject({
      baselineChanged: false,
      humanReviewRequired: true,
    });
    const blueprintRetry = await jsonRequest(
      `/api/workspaces/${blueprintCreated.workspace.slug}/draft/company-blueprint`,
      "POST",
      {
        workspaceVersion: blueprintCreated.workspace.version,
        idempotencyKey: "complete-blueprint-server",
        ...wowProjectBlueprint,
        companyName,
      },
      cookie,
    );
    expect(
      ((await blueprintRetry.json()) as { proposal: { id: string } }).proposal
        .id,
    ).toBe(blueprint.proposal.id);
  });

  test("isolates the public judge account by rotated browser session", async () => {
    const credentials = JSON.stringify({
      email: "judge@savemy.systems",
      password: "SaveMy-Judge-2026",
    });
    const [loginA, loginB] = await Promise.all([
      app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: credentials,
      }),
      app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: credentials,
      }),
    ]);
    const accountA = (await loginA.json()) as { user: { id: string } };
    const accountB = (await loginB.json()) as { user: { id: string } };
    const cookieA = loginA.headers.get("set-cookie")?.split(";")[0];
    const cookieB = loginB.headers.get("set-cookie")?.split(";")[0];
    expect(accountA.user.id).not.toBe(accountB.user.id);
    expect(cookieA).not.toBe(cookieB);

    const companyName = `Isolated ${crypto.randomUUID().slice(0, 8)}`;
    await app.request("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieA! },
      body: JSON.stringify({ name: companyName }),
    });
    const bootstrapB = (await (
      await app.request("/api/bootstrap", {
        headers: { cookie: cookieB! },
      })
    ).json()) as { workspaces: Array<{ name: string }> };
    expect(
      bootstrapB.workspaces.some((workspace) => workspace.name === companyName),
    ).toBeFalse();
  });

  test("rejects an oversized streamed body without a Content-Length header", async () => {
    const payload = new TextEncoder().encode("x".repeat(160 * 1024 + 1));
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(payload);
          controller.close();
        },
      }),
    });
    expect(request.headers.get("content-length")).toBeNull();

    const response = await app.request(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request exceeds 160KB." });
  });

  test("measures the stream instead of trusting a smaller Content-Length", async () => {
    const payload = new TextEncoder().encode("x".repeat(160 * 1024 + 1));
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "1",
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(payload);
          controller.close();
        },
      }),
    });

    expect((await app.request(request)).status).toBe(413);
  });

  test("requires authentication for company deletion", async () => {
    const response = await app.request("/api/workspaces/personal-company", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceVersion: 1 }),
    });
    expect(response.status).toBe(401);
  });

  test("deletes an authenticated personal company end to end", async () => {
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "judge@savemy.systems",
        password: "SaveMy-Judge-2026",
      }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();

    const created = await app.request("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie! },
      body: JSON.stringify({ name: "Disposable company" }),
    });
    const { workspace } = (await created.json()) as {
      workspace: { slug: string; version: number };
    };

    const deleted = await app.request(`/api/workspaces/${workspace.slug}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: cookie! },
      body: JSON.stringify({ workspaceVersion: workspace.version }),
    });

    expect(deleted.status).toBe(200);
    expect(
      (
        await app.request(`/api/workspaces/${workspace.slug}`, {
          headers: { cookie: cookie! },
        })
      ).status,
    ).toBe(404);
    const logout = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: cookie! },
    });
    expect(logout.status).toBe(200);
    expect(await logout.json()).toEqual({ ok: true });
    const loggedOutBootstrap = (await (
      await app.request("/api/bootstrap", { headers: { cookie: cookie! } })
    ).json()) as { user: unknown };
    expect(loggedOutBootstrap.user).toBeNull();
  });

  test("covers the authenticated manual mutation lifecycle and tenant boundary", async () => {
    const cookie = await loginCookie();
    const createdResponse = await jsonRequest(
      "/api/workspaces",
      "POST",
      { name: "Manual lifecycle" },
      cookie,
    );
    expect(createdResponse.status).toBe(201);
    let { workspace } = (await createdResponse.json()) as {
      workspace: {
        slug: string;
        name: string;
        archived?: boolean;
        version: number;
      };
    };

    const renamed = await jsonRequest(
      `/api/workspaces/${workspace.slug}`,
      "PATCH",
      { workspaceVersion: workspace.version, name: "Renamed lifecycle" },
      cookie,
    );
    expect(renamed.status).toBe(200);
    workspace = ((await renamed.json()) as { workspace: typeof workspace })
      .workspace;
    expect(workspace).toMatchObject({ name: "Renamed lifecycle", version: 2 });

    const archived = await jsonRequest(
      `/api/workspaces/${workspace.slug}`,
      "PATCH",
      { workspaceVersion: workspace.version, archived: true },
      cookie,
    );
    workspace = ((await archived.json()) as { workspace: typeof workspace })
      .workspace;
    expect(workspace).toMatchObject({ archived: true, version: 3 });
    const restored = await jsonRequest(
      `/api/workspaces/${workspace.slug}`,
      "PATCH",
      { workspaceVersion: workspace.version, archived: false },
      cookie,
    );
    workspace = ((await restored.json()) as { workspace: typeof workspace })
      .workspace;

    const firstResponse = await jsonRequest(
      `/api/workspaces/${workspace.slug}/entities`,
      "POST",
      {
        workspaceVersion: workspace.version,
        name: "Payroll run",
        type: "workflow",
        critical: true,
      },
      cookie,
    );
    expect(firstResponse.status).toBe(201);
    const first = (await firstResponse.json()) as {
      workspace: typeof workspace;
      entity: { id: string; name: string; trust: string };
    };
    workspace = first.workspace;
    const secondResponse = await jsonRequest(
      `/api/workspaces/${workspace.slug}/entities`,
      "POST",
      {
        workspaceVersion: workspace.version,
        name: "Payroll provider",
        type: "service",
      },
      cookie,
    );
    const second = (await secondResponse.json()) as typeof first;
    workspace = second.workspace;

    const updated = await jsonRequest(
      `/api/workspaces/${workspace.slug}/entities/${second.entity.id}`,
      "PATCH",
      {
        workspaceVersion: workspace.version,
        description: "Processes employee payroll.",
      },
      cookie,
    );
    const updatedBody = (await updated.json()) as typeof first;
    workspace = updatedBody.workspace;
    expect(updatedBody.entity).toMatchObject({
      description: "Processes employee payroll.",
      trust: "DECLARED",
    });

    const connected = await jsonRequest(
      `/api/workspaces/${workspace.slug}/relationships`,
      "POST",
      {
        workspaceVersion: workspace.version,
        from: first.entity.id,
        to: second.entity.id,
        type: "depends-on",
        group: "payroll-provider",
        label: "runs through",
      },
      cookie,
    );
    const connectedBody = (await connected.json()) as {
      workspace: typeof workspace;
      relationship: { trust: string };
    };
    workspace = connectedBody.workspace;
    expect(connectedBody.relationship.trust).toBe("DECLARED");

    const simulated = await jsonRequest(
      `/api/workspaces/${workspace.slug}/simulate`,
      "POST",
      {
        workspaceVersion: workspace.version,
        name: "Provider outage",
        unavailableEntityIds: [second.entity.id],
        durationDays: 1,
        context: "Payroll must continue.",
      },
      cookie,
    );
    expect(simulated.status).toBe(200);
    expect(
      (await simulated.json()) as {
        simulation: { blockedWorkflowIds: string[] };
      },
    ).toMatchObject({ simulation: { blockedWorkflowIds: [first.entity.id] } });

    const scenarioResponse = await jsonRequest(
      `/api/workspaces/${workspace.slug}/scenarios`,
      "POST",
      {
        id: "caller-controlled-scenario",
        workspaceVersion: workspace.version,
        name: "Provider unavailable",
        unavailableEntityIds: [second.entity.id],
        durationDays: 2,
        context: "Payroll must continue.",
        createdBy: "agent",
      },
      cookie,
    );
    expect(scenarioResponse.status).toBe(201);
    const scenarioBody = (await scenarioResponse.json()) as {
      workspace: typeof workspace;
      scenario: {
        id: string;
        createdBy: string;
        draft: boolean;
      };
    };
    workspace = scenarioBody.workspace;
    expect(scenarioBody.scenario).toMatchObject({
      createdBy: "human",
      draft: false,
    });
    expect(scenarioBody.scenario.id).not.toBe("caller-controlled-scenario");

    const validation = await app.request(
      `/api/workspaces/${workspace.slug}/validate`,
      { headers: { cookie } },
    );
    expect(validation.status).toBe(200);
    expect(await validation.json()).toMatchObject({
      workspaceVersion: workspace.version,
    });
    const search = await app.request(
      `/api/workspaces/${workspace.slug}/search?q=payroll%20provider`,
      { headers: { cookie } },
    );
    expect(await search.json()).toMatchObject({
      workspaceVersion: workspace.version,
      entities: [{ id: second.entity.id }],
    });
    const activity = await app.request(
      `/api/workspaces/${workspace.slug}/activity?limit=1`,
      { headers: { cookie } },
    );
    expect(
      ((await activity.json()) as { activity: unknown[] }).activity,
    ).toHaveLength(1);

    const otherCookie = await loginCookie();
    expect(
      (
        await app.request(`/api/workspaces/${workspace.slug}`, {
          headers: { cookie: otherCookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await jsonRequest(
          `/api/workspaces/${workspace.slug}`,
          "PATCH",
          { workspaceVersion: workspace.version, name: "Cross tenant" },
          otherCookie,
        )
      ).status,
    ).toBe(404);

    const duplicate = await app.request(
      "/api/workspaces/northstar-studio/duplicate",
      { method: "POST", headers: { cookie } },
    );
    expect(duplicate.status).toBe(201);
    const reset = await app.request("/api/workspaces/northstar-studio/reset", {
      method: "POST",
      headers: { cookie },
    });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toMatchObject({
      workspace: { slug: "northstar-studio", version: 1, proposals: [] },
    });

    const deleted = await jsonRequest(
      `/api/workspaces/${workspace.slug}`,
      "DELETE",
      { workspaceVersion: workspace.version },
      cookie,
    );
    expect(deleted.status).toBe(200);
    expect(
      (
        await app.request(`/api/workspaces/${workspace.slug}`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(404);
  });

  test("returns resource 404s without exposing another tenant or the SPA", async () => {
    const { cookie } = await anonymousWorkspace();
    for (const path of [
      "/api/workspaces/missing-workspace",
      "/api/workspaces/missing-workspace/validate",
      "/api/workspaces/missing-workspace/search?q=item",
      "/api/workspaces/missing-workspace/activity",
    ]) {
      const response = await app.request(path, { headers: { cookie } });
      expect(response.status, path).toBe(404);
      expect(response.headers.get("content-type"), path).toContain(
        "application/json",
      );
    }
    expect(
      (
        await app.request("/api/workspaces/missing-workspace/reset", {
          method: "POST",
          headers: { cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await jsonRequest(
          "/api/workspaces/northstar-studio/simulate",
          "POST",
          {
            workspaceVersion: 1,
            name: "Unknown item",
            unavailableEntityIds: ["missing-entity"],
            durationDays: 1,
            context: "Must reject invented graph IDs.",
          },
          cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          "/api/workspaces/northstar-studio/proposals/missing/compare?scenarioId=studio-founder-away",
          { headers: { cookie } },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await jsonRequest(
          "/api/workspaces/northstar-studio/proposals/missing/accept",
          "POST",
          { workspaceVersion: 1 },
          cookie,
        )
      ).status,
    ).toBe(404);

    const authenticated = await loginCookie();
    expect(
      (
        await app.request("/api/workspaces/missing-workspace/duplicate", {
          method: "POST",
          headers: { cookie: authenticated },
        })
      ).status,
    ).toBe(404);
    const created = await jsonRequest(
      "/api/workspaces",
      "POST",
      { name: "Unknown resource checks" },
      authenticated,
    );
    const personal = (await created.json()) as {
      workspace: { slug: string; version: number };
    };
    expect(
      (
        await jsonRequest(
          `/api/workspaces/${personal.workspace.slug}/entities/missing`,
          "PATCH",
          {
            workspaceVersion: personal.workspace.version,
            name: "Still missing",
          },
          authenticated,
        )
      ).status,
    ).toBe(404);
  });

  test("mutation responses return the next authoritative workspace version", async () => {
    const initial = await app.request("/api/workspaces/northstar-studio");
    const cookie = initial.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const response = await app.request(
      "/api/workspaces/northstar-studio/draft/repair-options",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookie!,
        },
        body: JSON.stringify({
          scenarioId: "studio-founder-away",
          workspaceVersion: 1,
          idempotencyKey: "server-version-contract",
          options: [
            {
              optionLabel: "A",
              title: "Agent-selected fallback paths",
              rationale: "Use explicit healthy paths selected by the agent.",
              assumptions: ["Human review is required."],
              tradeoff: {
                effort: "LOW",
                timeToRestoreHours: 2,
                residualRisk: "MEDIUM",
                summary: "Fast, with human verification still required.",
              },
              changes: [
                {
                  op: "add-relationship",
                  relationship: {
                    id: "agent-access",
                    from: "studio-apple-account",
                    to: "studio-ops",
                    type: "owned-by",
                    group: "access",
                  },
                },
                {
                  op: "add-relationship",
                  relationship: {
                    id: "agent-auth",
                    from: "studio-apple-account",
                    to: "studio-qa-devices",
                    type: "recovers-via",
                    group: "authentication",
                  },
                },
                {
                  op: "add-relationship",
                  relationship: {
                    id: "agent-delegation",
                    from: "studio-engineering",
                    to: "studio-ops",
                    type: "substitutes-for",
                    group: "delegation",
                  },
                },
              ],
            },
          ],
        }),
      },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      workspaceVersion: number;
      proposals: Array<{ id: string; baseVersion: number }>;
    };
    expect(body.workspaceVersion).toBe(2);
    expect(body.proposals).toHaveLength(1);
    expect(
      body.proposals.every((proposal) => proposal.baseVersion === 1),
    ).toBeTrue();
    const comparison = await app.request(
      `/api/workspaces/northstar-studio/proposals/${body.proposals[0]!.id}/compare?scenarioId=studio-founder-away&expectedWorkspaceVersion=2`,
      { headers: { cookie: cookie! } },
    );
    expect(comparison.status).toBe(200);
    expect(await comparison.json()).toMatchObject({
      workspaceVersion: 2,
      before: { blockedWorkflowIds: ["studio-release"] },
      after: { blockedWorkflowIds: [] },
    });
    const staleComparison = await app.request(
      `/api/workspaces/northstar-studio/proposals/${body.proposals[0]!.id}/compare?scenarioId=studio-founder-away&expectedWorkspaceVersion=1`,
      { headers: { cookie: cookie! } },
    );
    expect(staleComparison.status).toBe(409);
    expect(await staleComparison.json()).toMatchObject({ currentVersion: 2 });
    const validation = await app.request(
      "/api/workspaces/northstar-studio/validate?expectedWorkspaceVersion=2",
      { headers: { cookie: cookie! } },
    );
    expect(validation.status).toBe(200);
    expect(await validation.json()).toMatchObject({ workspaceVersion: 2 });
    const staleValidation = await app.request(
      "/api/workspaces/northstar-studio/validate?expectedWorkspaceVersion=1",
      { headers: { cookie: cookie! } },
    );
    expect(staleValidation.status).toBe(409);
    expect(await staleValidation.json()).toMatchObject({ currentVersion: 2 });
  });

  test("covers delegation, schedule, compare, customization, and both proposal decisions", async () => {
    const { cookie, workspace: initial } = await anonymousWorkspace();
    const delegationResponse = await jsonRequest(
      `/api/workspaces/${initial.slug}/draft/delegation`,
      "POST",
      {
        workspaceVersion: initial.version,
        idempotencyKey: "server-delegation-workflow",
        primaryPersonId: "studio-founder",
        fallbackPersonId: "studio-support-owner",
        responsibilityId: "studio-release",
        note: "Release fallback",
      },
      cookie,
    );
    expect(delegationResponse.status).toBe(201);
    const delegation = (await delegationResponse.json()) as {
      proposal: { id: string };
      workspaceVersion: number;
    };
    expect(delegation.workspaceVersion).toBe(initial.version + 1);

    const customized = await jsonRequest(
      `/api/workspaces/${initial.slug}/proposals/${delegation.proposal.id}`,
      "PATCH",
      {
        workspaceVersion: delegation.workspaceVersion,
        title: "Human-reviewed release fallback",
        relationshipTargets: [],
        entityNames: [],
      },
      cookie,
    );
    expect(customized.status).toBe(200);
    const customizedBody = (await customized.json()) as {
      workspace: { version: number };
      proposal: { title: string };
    };
    expect(customizedBody).toMatchObject({
      workspace: { version: initial.version + 2 },
      proposal: { title: "Human-reviewed release fallback" },
    });

    const comparison = await app.request(
      `/api/workspaces/${initial.slug}/proposals/${delegation.proposal.id}/compare?scenarioId=studio-founder-away`,
      { headers: { cookie } },
    );
    expect(comparison.status).toBe(200);
    expect(await comparison.json()).toMatchObject({
      before: { scenarioId: "studio-founder-away" },
      after: { scenarioId: "studio-founder-away" },
    });

    const rejected = await jsonRequest(
      `/api/workspaces/${initial.slug}/proposals/${delegation.proposal.id}/reject`,
      "POST",
      { workspaceVersion: customizedBody.workspace.version },
      cookie,
    );
    const rejectedWorkspace = (await rejected.json()) as {
      workspace: {
        version: number;
        proposals: Array<{ id: string; status: string }>;
      };
    };
    expect(
      rejectedWorkspace.workspace.proposals.find(
        (proposal) => proposal.id === delegation.proposal.id,
      )?.status,
    ).toBe("REJECTED");

    const scheduleResponse = await jsonRequest(
      `/api/workspaces/${initial.slug}/draft/schedule`,
      "POST",
      {
        workspaceVersion: rejectedWorkspace.workspace.version,
        idempotencyKey: "server-schedule-workflow",
        entityId: "studio-release",
        dueAt: "2026-09-08",
        note: "Move after recovery review",
        executionMode: "shared",
      },
      cookie,
    );
    expect(scheduleResponse.status).toBe(201);
    const schedule = (await scheduleResponse.json()) as {
      proposal: { id: string };
      workspaceVersion: number;
    };
    const accepted = await jsonRequest(
      `/api/workspaces/${initial.slug}/proposals/${schedule.proposal.id}/accept`,
      "POST",
      { workspaceVersion: schedule.workspaceVersion },
      cookie,
    );
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as {
      workspace: { version: number };
    };
    expect(acceptedBody.workspace.version).toBe(schedule.workspaceVersion + 1);
    const acceptedWorkspace = (await (
      await app.request(`/api/workspaces/${initial.slug}`, {
        headers: { cookie },
      })
    ).json()) as {
      workspace: {
        entities: Array<{ id: string; metadata?: { dueAt?: string } }>;
      };
    };
    expect(
      acceptedWorkspace.workspace.entities.find(
        (entity) => entity.id === "studio-release",
      )?.metadata?.dueAt,
    ).toBe("2026-09-08");
  });

  test("keeps the dedicated single-scenario tool contract available", async () => {
    const initial = await app.request("/api/workspaces/northstar-studio");
    const cookie = initial.headers.get("set-cookie")?.split(";")[0];
    const response = await app.request(
      "/api/workspaces/northstar-studio/draft/scenario",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookie!,
        },
        body: JSON.stringify({
          workspaceVersion: 1,
          idempotencyKey: "single-scenario-contract",
          scenario: {
            name: "Founder unavailable",
            unavailableEntityIds: ["studio-founder"],
            durationDays: 2,
            context: "Release and support must continue.",
          },
        }),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      scenarios: Array<{ draft: boolean; createdBy: string }>;
      baselineChanged: boolean;
    };
    expect(body.scenarios).toHaveLength(1);
    expect(body.scenarios[0]).toMatchObject({
      draft: true,
      createdBy: "agent",
    });
    expect(body.baselineChanged).toBeFalse();

    const undersizedLibrary = await app.request(
      "/api/workspaces/northstar-studio/draft/scenarios",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookie!,
        },
        body: JSON.stringify({
          workspaceVersion: 2,
          idempotencyKey: "undersized-scenario-library",
          scenarios: [
            {
              name: "Only one scenario",
              unavailableEntityIds: ["studio-founder"],
              durationDays: 1,
              context: "A library needs materially different rehearsals.",
            },
          ],
        }),
      },
    );
    expect(undersizedLibrary.status).toBe(400);
  });
});
