import { describe, expect, test } from "bun:test";
import type { Workspace } from "../../domain/model";
import {
  registerSaveMyAccountTools,
  type CompanySetupMode,
} from "./registerAccountTools";
import { SiteToolRequestError } from "./requestJson";
import type { WebMcpCallLog } from "./registerTools";

type RegisteredToolDefinition = ModelContextTool;

const company = {
  id: "workspace-native",
  slug: "valencia-ridge-native",
  name: "Valencia Ridge",
  tagline: "Map the dependency. Rehearse the absence.",
  sector: "custom",
  fictional: false,
  version: 1,
  entities: [],
  relationships: [],
  scenarios: [],
  proposals: [],
  activity: [],
} satisfies Workspace;

const installModelContext = (
  registerTool: (
    tool: RegisteredToolDefinition,
    options?: { signal?: AbortSignal },
  ) => Promise<void>,
) => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: { registerTool } },
  });
};

describe("account WebMCP registry", () => {
  test("reports unsupported without attempting a UI-automation fallback", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {},
    });
    let handoffCount = 0;
    const registry = registerSaveMyAccountTools({
      onCompanyCreated: () => {
        handoffCount += 1;
        return { workspaceToolsReady: true };
      },
    });
    expect(registry.supported).toBeFalse();
    await registry.ready;
    registry.cleanup();
    expect(handoffCount).toBe(0);
  });

  test("tells a signed-out agent to stop without UI automation", async () => {
    const tools: RegisteredToolDefinition[] = [];
    installModelContext(async (tool) => {
      tools.push(tool);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          user: null,
          workspaces: [],
          webmcp: { nativeExpected: true, tools: 18 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;
    try {
      const registry = registerSaveMyAccountTools({
        onCompanyCreated: () => ({ workspaceToolsReady: true }),
      });
      await registry.ready;
      const result = (await tools
        .find((tool) => tool.name === "get_account_companies")!
        .execute({}, { signal: new AbortController().signal })) as {
        signedIn: boolean;
        guidance: string;
      };
      expect(result.signedIn).toBeFalse();
      expect(result.guidance).toContain("ask the human to sign in");
      expect(result.guidance).toContain("Never use browser or computer");
      registry.cleanup();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("creates a company and waits for the new workspace tools before handing off", async () => {
    const tools: RegisteredToolDefinition[] = [];
    const calls: WebMcpCallLog[] = [];
    const handoffs: Array<{
      workspace: Workspace;
      setupMode: CompanySetupMode;
    }> = [];
    installModelContext(async (tool) => {
      tools.push(tool);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      expect(input).toBe("/api/account/companies");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        name: "Valencia Ridge",
        idempotencyKey: "valencia-ridge-native-v1",
        setupMode: "agent-blueprint",
      });
      return new Response(
        JSON.stringify({
          workspace: company,
          setupMode: "agent-blueprint",
          baselineChanged: false,
          nextTool: "draft_company_blueprint",
          guidance: "Workspace tools are ready.",
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;
    try {
      const registry = registerSaveMyAccountTools({
        onCompanyCreated: async (workspace, setupMode) => {
          handoffs.push({ workspace, setupMode });
          await Promise.resolve();
          return { workspaceToolsReady: true };
        },
        onToolCall: (entry) => calls.push(entry),
      });
      await registry.ready;
      expect(tools.map((tool) => tool.name)).toEqual([
        "get_account_companies",
        "create_company",
      ]);
      expect(
        tools.every((tool) => tool.annotations?.untrustedContentHint === true),
      ).toBeTrue();
      const create = tools.find((tool) => tool.name === "create_company")!;
      const result = (await create.execute(
        {
          name: "Valencia Ridge",
          idempotencyKey: "valencia-ridge-native-v1",
          setupMode: "agent-blueprint",
        },
        { signal: new AbortController().signal },
      )) as Record<string, unknown>;
      expect(handoffs).toEqual([
        { workspace: company, setupMode: "agent-blueprint" },
      ]);
      expect(result.workspaceToolsReady).toBeTrue();
      expect(result.nextTool).toBe("draft_company_blueprint");
      expect(result.workspaceVersion).toBe(1);
      expect(result.baselineChanged).toBeFalse();
      expect(result.humanReviewRequired).toBeTrue();
      expect(result.humanReviewBoundary).toContain("no company-map item");
      expect(result.fallbackPolicy).toContain(
        "Do not use browser or computer control",
      );
      expect(create.description).toContain("exact retries");
      expect(create.description).toContain("use a new key");
      expect(calls.map((entry) => entry.status)).toEqual([
        "running",
        "succeeded",
      ]);
      registry.cleanup();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns a safe retry path when workspace tools do not register", async () => {
    const tools: RegisteredToolDefinition[] = [];
    installModelContext(async (tool) => {
      tools.push(tool);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          workspace: company,
          setupMode: "agent-blueprint",
          baselineChanged: false,
          nextTool: "draft_company_blueprint",
          guidance: "Continue.",
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;
    try {
      const registry = registerSaveMyAccountTools({
        onCompanyCreated: () => ({ workspaceToolsReady: false }),
      });
      await registry.ready;
      const result = (await tools
        .find((tool) => tool.name === "create_company")!
        .execute(
          {
            name: "Valencia Ridge",
            idempotencyKey: "valencia-ridge-native-v1",
            setupMode: "agent-blueprint",
          },
          { signal: new AbortController().signal },
        )) as Record<string, unknown>;
      expect(result.nextTool).toBeNull();
      expect(result.guidance).toContain("same idempotency key");
      expect(result.guidance).toContain("Do not use browser or computer");
      registry.cleanup();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("preserves the exact company payload across a same-key retry", async () => {
    const tools: RegisteredToolDefinition[] = [];
    const requestBodies: string[] = [];
    installModelContext(async (tool) => {
      tools.push(tool);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(String(init?.body));
      return new Response(
        JSON.stringify({
          workspace: company,
          setupMode: "agent-blueprint",
          baselineChanged: false,
          nextTool: "draft_company_blueprint",
          guidance: "Continue.",
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;
    try {
      const registry = registerSaveMyAccountTools({
        onCompanyCreated: () => ({ workspaceToolsReady: true }),
      });
      await registry.ready;
      const create = tools.find((tool) => tool.name === "create_company")!;
      const input = {
        name: "Valencia Ridge",
        idempotencyKey: "valencia-ridge-native-v1",
        setupMode: "agent-blueprint",
      };
      const first = (await create.execute(input, {
        signal: new AbortController().signal,
      })) as Record<string, unknown>;
      const retry = (await create.execute(input, {
        signal: new AbortController().signal,
      })) as Record<string, unknown>;
      expect(requestBodies).toHaveLength(2);
      expect(requestBodies[1]).toBe(requestBodies[0]);
      expect(retry.companyId).toBe(first.companyId);
      expect(retry.workspaceVersion).toBe(first.workspaceVersion);
      registry.cleanup();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps the authentication boundary and never begins a company handoff on 401", async () => {
    const tools: RegisteredToolDefinition[] = [];
    installModelContext(async (tool) => {
      tools.push(tool);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: "Sign in before creating a company through Site Tools.",
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;
    let handoffCount = 0;
    try {
      const registry = registerSaveMyAccountTools({
        onCompanyCreated: () => {
          handoffCount += 1;
          return { workspaceToolsReady: true };
        },
      });
      await registry.ready;
      const create = tools.find((tool) => tool.name === "create_company")!;
      try {
        await create.execute(
          {
            name: "Valencia Ridge",
            idempotencyKey: "valencia-ridge-native-v1",
            setupMode: "agent-blueprint",
          },
          { signal: new AbortController().signal },
        );
        throw new Error("Signed-out company creation unexpectedly succeeded.");
      } catch (reason) {
        expect(reason).toBeInstanceOf(SiteToolRequestError);
        expect((reason as SiteToolRequestError).status).toBe(401);
        expect((reason as Error).message).toContain("Sign in before creating");
      }
      expect(handoffCount).toBe(0);
      registry.cleanup();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("aborts every partially registered account tool when registration fails", async () => {
    const registrationSignals: AbortSignal[] = [];
    let count = 0;
    installModelContext(async (_tool, options) => {
      if (options?.signal) registrationSignals.push(options.signal);
      count += 1;
      if (count === 2) throw new Error("registration failed");
    });
    const registry = registerSaveMyAccountTools({
      onCompanyCreated: () => ({ workspaceToolsReady: true }),
    });
    await expect(registry.ready).rejects.toThrow("registration failed");
    expect(registrationSignals).toHaveLength(2);
    expect(registrationSignals.every((signal) => signal.aborted)).toBeTrue();
  });

  test("aborts create-company while it is waiting for workspace tools", async () => {
    const tools: RegisteredToolDefinition[] = [];
    installModelContext(async (tool) => {
      tools.push(tool);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          workspace: company,
          setupMode: "agent-blueprint",
          baselineChanged: false,
          nextTool: "draft_company_blueprint",
          guidance: "Continue.",
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;
    let markHandoffStarted!: () => void;
    const handoffStarted = new Promise<void>((resolve) => {
      markHandoffStarted = resolve;
    });
    let finishHandoff!: (value: { workspaceToolsReady: boolean }) => void;
    const handoff = new Promise<{ workspaceToolsReady: boolean }>((resolve) => {
      finishHandoff = resolve;
    });
    try {
      const registry = registerSaveMyAccountTools({
        onCompanyCreated: () => {
          markHandoffStarted();
          return handoff;
        },
      });
      await registry.ready;
      const create = tools.find((tool) => tool.name === "create_company")!;
      const controller = new AbortController();
      const execution = create.execute!(
        {
          name: "Valencia Ridge",
          idempotencyKey: "valencia-ridge-native-v1",
          setupMode: "agent-blueprint",
        },
        { signal: controller.signal } as never,
      );
      await handoffStarted;
      controller.abort();
      await Promise.resolve();
      finishHandoff({ workspaceToolsReady: true });

      try {
        await execution;
        throw new Error("Aborted company handoff unexpectedly succeeded.");
      } catch (reason) {
        expect(reason).toBeInstanceOf(DOMException);
        expect((reason as DOMException).name).toBe("AbortError");
      }
      registry.cleanup();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not navigate after cancellation wins the create response race", async () => {
    const tools: RegisteredToolDefinition[] = [];
    installModelContext(async (tool) => {
      tools.push(tool);
    });
    const originalFetch = globalThis.fetch;
    let resolveFetch!: (response: Response) => void;
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })) as unknown as typeof fetch;
    let handoffCount = 0;
    try {
      const registry = registerSaveMyAccountTools({
        onCompanyCreated: () => {
          handoffCount += 1;
          return { workspaceToolsReady: true };
        },
      });
      await registry.ready;
      const create = tools.find((tool) => tool.name === "create_company")!;
      const controller = new AbortController();
      const execution = create.execute(
        {
          name: "Valencia Ridge",
          idempotencyKey: "valencia-ridge-native-v1",
          setupMode: "agent-blueprint",
        },
        { signal: controller.signal },
      );
      resolveFetch(
        new Response(
          JSON.stringify({
            workspace: company,
            setupMode: "agent-blueprint",
            baselineChanged: false,
            nextTool: "draft_company_blueprint",
            guidance: "Continue.",
          }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        ),
      );
      controller.abort();

      try {
        await execution;
        throw new Error("Cancelled company creation unexpectedly navigated.");
      } catch (reason) {
        expect(reason).toBeInstanceOf(DOMException);
        expect((reason as DOMException).name).toBe("AbortError");
      }
      expect(handoffCount).toBe(0);
      registry.cleanup();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
