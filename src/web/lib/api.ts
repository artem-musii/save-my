import type {
  Proposal,
  Scenario,
  SimulationResult,
  ValidationResult,
  Workspace,
} from "../../domain/model";

export type Bootstrap = {
  user: { id: string; email: string; name: string } | null;
  workspaces: Array<
    Pick<
      Workspace,
      | "slug"
      | "name"
      | "tagline"
      | "sector"
      | "cover"
      | "fictional"
      | "archived"
    > & { entityCount: number; scenarioCount: number }
  >;
  webmcp: { nativeExpected: boolean; tools: number };
};

export type WorkspacePayload = {
  workspace: Workspace;
  validation: ValidationResult;
  simulation: SimulationResult | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body as T;
}

export const api = {
  bootstrap: () => request<Bootstrap>("/api/bootstrap"),
  workspace: (slug: string) =>
    request<WorkspacePayload>(`/api/workspaces/${slug}`),
  login: (email: string, password: string) =>
    request<{ user: Bootstrap["user"] }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  createWorkspace: (name: string) =>
    request<{ workspace: Workspace }>("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  duplicateWorkspace: (slug: string) =>
    request<{ workspace: Workspace }>(`/api/workspaces/${slug}/duplicate`, {
      method: "POST",
    }),
  updateWorkspace: (
    slug: string,
    workspaceVersion: number,
    changes: { name?: string; archived?: boolean },
  ) =>
    request<{ workspace: Workspace }>(`/api/workspaces/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ workspaceVersion, ...changes }),
    }),
  deleteWorkspace: (slug: string, workspaceVersion: number) =>
    request<{ ok: true }>(`/api/workspaces/${slug}`, {
      method: "DELETE",
      body: JSON.stringify({ workspaceVersion }),
    }),
  addEntity: (
    slug: string,
    workspaceVersion: number,
    entity: {
      name: string;
      type: Workspace["entities"][number]["type"];
      description?: string;
      role?: string;
      team?: string;
      image?: string;
      critical?: boolean;
      metadata?: Workspace["entities"][number]["metadata"];
    },
  ) =>
    request<{ workspace: Workspace; entity: Workspace["entities"][number] }>(
      `/api/workspaces/${slug}/entities`,
      { method: "POST", body: JSON.stringify({ workspaceVersion, ...entity }) },
    ),
  updateEntity: (
    slug: string,
    entityId: string,
    workspaceVersion: number,
    patch: Partial<Omit<Workspace["entities"][number], "id" | "trust">>,
  ) =>
    request<{ workspace: Workspace; entity: Workspace["entities"][number] }>(
      `/api/workspaces/${slug}/entities/${entityId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ workspaceVersion, ...patch }),
      },
    ),
  addRelationship: (
    slug: string,
    workspaceVersion: number,
    relationship: {
      from: string;
      to: string;
      type: Workspace["relationships"][number]["type"];
      group?: string;
      label?: string;
    },
  ) =>
    request<{
      workspace: Workspace;
      relationship: Workspace["relationships"][number];
    }>(`/api/workspaces/${slug}/relationships`, {
      method: "POST",
      body: JSON.stringify({ workspaceVersion, ...relationship }),
    }),
  reset: (slug: string) =>
    request<{ workspace: Workspace }>(`/api/workspaces/${slug}/reset`, {
      method: "POST",
    }),
  simulate: (
    slug: string,
    scenario: Scenario,
    workspaceVersion: number,
    signal?: AbortSignal,
  ) =>
    request<{ scenario: Scenario; simulation: SimulationResult }>(
      `/api/workspaces/${slug}/simulate`,
      {
        method: "POST",
        ...(signal ? { signal } : {}),
        body: JSON.stringify({ ...scenario, workspaceVersion }),
      },
    ),
  createScenario: (
    slug: string,
    workspaceVersion: number,
    scenario: Omit<Scenario, "id" | "createdAt"> & { id?: string },
  ) =>
    request<{ workspace: Workspace; scenario: Scenario }>(
      `/api/workspaces/${slug}/scenarios`,
      {
        method: "POST",
        body: JSON.stringify({ workspaceVersion, ...scenario }),
      },
    ),
  search: (slug: string, query: string, signal?: AbortSignal) =>
    request<{
      workspaceVersion: number;
      entities: Workspace["entities"];
    }>(`/api/workspaces/${slug}/search?q=${encodeURIComponent(query)}`, {
      ...(signal ? { signal } : {}),
    }),
  draftDelegation: (
    slug: string,
    input: {
      workspaceVersion: number;
      idempotencyKey: string;
      primaryPersonId: string;
      fallbackPersonId: string;
      responsibilityId?: string;
      note?: string;
    },
  ) =>
    request<{ proposal: Proposal; workspaceVersion: number }>(
      `/api/workspaces/${slug}/draft/delegation`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  draftSchedule: (
    slug: string,
    input: {
      workspaceVersion: number;
      idempotencyKey: string;
      entityId: string;
      dueAt: string;
      note?: string;
      executionMode?: "human" | "agent" | "shared";
    },
  ) =>
    request<{ proposal: Proposal; workspaceVersion: number }>(
      `/api/workspaces/${slug}/draft/schedule`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  compare: (slug: string, proposalId: string, scenarioId: string) =>
    request<{
      before: SimulationResult;
      after: SimulationResult;
      restoredEntityIds: string[];
      restoredWorkflowIds: string[];
    }>(
      `/api/workspaces/${slug}/proposals/${proposalId}/compare?scenarioId=${encodeURIComponent(scenarioId)}`,
    ),
  customizeProposal: (
    slug: string,
    proposalId: string,
    input: {
      workspaceVersion: number;
      title: string;
      relationshipTargets: Array<{ changeIndex: number; to: string }>;
      entityNames: Array<{ changeIndex: number; name: string }>;
    },
  ) =>
    request<{ workspace: Workspace; proposal: Proposal }>(
      `/api/workspaces/${slug}/proposals/${proposalId}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  decide: (
    slug: string,
    proposalId: string,
    decision: "accept" | "reject",
    workspaceVersion: number,
  ) =>
    request<{ workspace: Workspace }>(
      `/api/workspaces/${slug}/proposals/${proposalId}/${decision}`,
      { method: "POST", body: JSON.stringify({ workspaceVersion }) },
    ),
};
