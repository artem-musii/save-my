import type { Workspace } from "../../domain/model";
import type { Bootstrap } from "../lib/api";
import { requestJson } from "./requestJson";
import {
  assertWorkspaceVersion,
  objectSchema,
  registerInstrumentedTools,
  type WebMcpCallLog,
} from "./toolRegistry";

export type CompanySetupMode = "manual" | "agent-blueprint";

type AccountToolContext = {
  onCompanyCreated: (
    workspace: Workspace,
    setupMode: CompanySetupMode,
  ) =>
    | { workspaceToolsReady: boolean }
    | Promise<{ workspaceToolsReady: boolean }>;
  onToolCall?: (entry: WebMcpCallLog) => void;
};

function waitForResultOrAbort<T>(
  result: PromiseLike<T> | T,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(result).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (reason) => {
        signal.removeEventListener("abort", onAbort);
        reject(reason);
      },
    );
  });
}

export function registerSaveMyAccountTools(context: AccountToolContext) {
  const modelContext = document.modelContext;
  if (!modelContext)
    return {
      supported: false,
      cleanup: () => undefined,
      ready: Promise.resolve(),
    };

  const lifecycle = new AbortController();
  const tools: ModelContextTool[] = [
    {
      name: "get_account_companies",
      title: "Get SAVE MY… companies",
      description:
        "Read the signed-in account and its available companies before choosing or creating a workspace. Use this instead of inspecting the sidebar with browser or computer control.",
      inputSchema: objectSchema({}),
      annotations: { readOnlyHint: true },
      execute: async (_input, { signal }) => {
        const bootstrap = await requestJson<Bootstrap>("/api/bootstrap", {
          signal,
        });
        return {
          signedIn: Boolean(bootstrap.user),
          account: bootstrap.user,
          companyCount: bootstrap.workspaces.length,
          companies: bootstrap.workspaces.slice(0, 50).map((workspace) => ({
            slug: workspace.slug,
            name: workspace.name,
            fictional: workspace.fictional,
            archived: Boolean(workspace.archived),
            entityCount: workspace.entityCount,
            scenarioCount: workspace.scenarioCount,
          })),
          guidance: bootstrap.user
            ? "Call create_company only when the user wants a new company. Existing companies can be opened by the user; do not use browser or computer control to create one."
            : "Stop and ask the human to sign in before creating a persistent company. Never use browser or computer control to bypass sign-in or create the company through UI automation.",
        };
      },
    },
    {
      name: "create_company",
      title: "Create a SAVE MY… company",
      description:
        "Create one empty, user-owned company through the native Site Tool. Never use browser or computer control to click the company UI. Pass a stable idempotency key so exact retries return the same company; use a new key if the name or setup mode changes. For agent setup, choose agent-blueprint; the app navigates to the new company, then call get_workspace_summary and draft_company_blueprint to stage the full connected map for human review. This tool never invents or applies baseline items itself.",
      inputSchema: objectSchema(
        {
          name: { type: "string", minLength: 2, maxLength: 80 },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
          setupMode: {
            type: "string",
            enum: ["manual", "agent-blueprint"],
            default: "agent-blueprint",
          },
        },
        ["name", "idempotencyKey", "setupMode"],
      ),
      execute: async (input, { signal }) => {
        const result = await requestJson<{
          workspace: Workspace;
          setupMode: CompanySetupMode;
          baselineChanged: boolean;
          nextTool: "draft_company_blueprint" | null;
          guidance: string;
        }>("/api/account/companies", {
          method: "POST",
          signal,
          body: JSON.stringify(input),
        });
        signal.throwIfAborted();
        assertWorkspaceVersion(result.workspace.version, "Company creation");
        const handoff = await waitForResultOrAbort(
          context.onCompanyCreated(result.workspace, result.setupMode),
          signal,
        );
        signal.throwIfAborted();
        const workspaceToolsReady = handoff.workspaceToolsReady;
        return {
          companyId: result.workspace.id,
          companySlug: result.workspace.slug,
          companyName: result.workspace.name,
          workspaceVersion: result.workspace.version,
          setupMode: result.setupMode,
          baselineChanged: result.baselineChanged,
          humanReviewRequired: true,
          humanReviewBoundary:
            "The company now exists, but no company-map item has been applied. A person must review inferred baseline content in the visible UI.",
          workspaceToolsReady,
          nextTool: workspaceToolsReady ? result.nextTool : null,
          guidance: workspaceToolsReady
            ? result.guidance
            : "The company was created, but its native workspace tools did not finish registering. Do not use browser or computer control. Retry create_company with the same idempotency key to resume safely, or continue with the manual setup UI.",
          fallbackPolicy:
            "If a native Site Tool is unavailable, stop and offer the visible manual setup path. Do not use browser or computer control as a fallback.",
        };
      },
    },
  ];

  const ready = registerInstrumentedTools(
    modelContext,
    tools,
    lifecycle,
    context.onToolCall,
  );
  return { supported: true, cleanup: () => lifecycle.abort(), ready };
}
