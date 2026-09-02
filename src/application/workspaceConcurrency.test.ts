import { describe, expect, test } from "bun:test";
import {
  InMemoryWorkspaceRepository,
  VersionConflictError,
  WorkspaceService,
} from "./workspaceService";
import { wowProjectBlueprint } from "../fixtures/wowProjectBlueprint";

describe("workspace compare-and-swap persistence", () => {
  test("allows only one mutation to commit from the same version", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const scope = `concurrency:${crypto.randomUUID()}`;
    const workspace = await service.create(scope, "Concurrent company");

    const results = await Promise.allSettled([
      service.updateWorkspace(scope, workspace.slug, workspace.version, {
        name: "First update",
      }),
      service.updateWorkspace(scope, workspace.slug, workspace.version, {
        name: "Second update",
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(VersionConflictError);
    expect((await service.get(scope, workspace.slug)).version).toBe(
      workspace.version + 1,
    );
  });

  test("replays the winner for concurrent identical idempotent blueprints", async () => {
    const service = new WorkspaceService(new InMemoryWorkspaceRepository());
    const scope = `concurrent-blueprint:${crypto.randomUUID()}`;
    const workspace = await service.create(scope, "Concurrent blueprint");
    const draft = () =>
      service.draftCompanyBlueprint(
        scope,
        workspace.slug,
        workspace.version,
        "concurrent-blueprint-key",
        wowProjectBlueprint.companyName,
        wowProjectBlueprint.companySummary,
        wowProjectBlueprint.entities,
        wowProjectBlueprint.relationships,
      );

    const [first, second] = await Promise.all([draft(), draft()]);
    expect(second.id).toBe(first.id);
    const saved = await service.get(scope, workspace.slug);
    expect(saved.version).toBe(workspace.version + 1);
    expect(
      saved.proposals.filter(
        (proposal) =>
          proposal.idempotencyToken ===
          "company-blueprint:concurrent-blueprint-key",
      ),
    ).toHaveLength(1);
  });

  test("keeps a newer workspace when a stale delete reaches persistence", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = new WorkspaceService(repository);
    const scope = `concurrent-delete:${crypto.randomUUID()}`;
    const workspace = await service.create(scope, "Delete race company");
    const updated = structuredClone(workspace);
    updated.name = "Newer aggregate";
    updated.version += 1;
    await repository.save(scope, updated, workspace.version);

    await expect(
      repository.delete(scope, workspace.slug, workspace.version),
    ).rejects.toBeInstanceOf(VersionConflictError);
    expect(await repository.get(scope, workspace.slug)).toMatchObject({
      name: "Newer aggregate",
      version: updated.version,
    });
  });
});
