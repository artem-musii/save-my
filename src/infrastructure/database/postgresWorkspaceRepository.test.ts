import { describe, expect, test } from "bun:test";
import { PostgresWorkspaceRepository } from "./postgresWorkspaceRepository";
import { cloneDemo } from "../demoWorkspaces";
import {
  VersionConflictError,
  WorkspaceService,
} from "../../application/workspaceService";

const databaseUrl = process.env.DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

describe("PostgreSQL workspace repository", () => {
  integrationTest("persists and deletes opaque sessions", async () => {
    const repository = PostgresWorkspaceRepository.connect(databaseUrl!);
    const suffix = crypto.randomUUID();
    const userId = `integration-user-${suffix}`;
    const sessionId = `integration-session-${suffix}`;
    await repository.ensureUser(
      userId,
      `integration+${suffix}@example.com`,
      "not-a-production-password-hash",
      "Integration user",
    );
    await repository.createSession(sessionId);
    expect(await repository.getSession(sessionId)).toMatchObject({
      userId: undefined,
    });
    await repository.setSessionUser(sessionId, userId);
    expect(await repository.getSession(sessionId)).toMatchObject({ userId });
    await repository.deleteSession(sessionId);
    expect(await repository.getSession(sessionId)).toBeUndefined();
  });

  integrationTest(
    "persists workspaces and preserves tenant isolation",
    async () => {
      const repository = PostgresWorkspaceRepository.connect(databaseUrl!);
      const suffix = crypto.randomUUID();
      const firstScope = `integration-a:${suffix}`;
      const secondScope = `integration-b:${suffix}`;
      const first = (await repository.get(firstScope, "northstar-studio"))!;
      const expectedVersion = first.version;
      first.name = "Tenant A studio";
      first.version += 1;
      await repository.save(firstScope, first, expectedVersion);
      expect((await repository.get(firstScope, "northstar-studio"))!.name).toBe(
        "Tenant A studio",
      );
      expect(
        (await repository.get(secondScope, "northstar-studio"))!.name,
      ).toBe("Diamond Apps");
    },
  );

  integrationTest(
    "allows exactly one concurrent write for an expected workspace version",
    async () => {
      const repository = PostgresWorkspaceRepository.connect(databaseUrl!);
      const scope = `integration-cas:${crypto.randomUUID()}`;
      const original = (await repository.get(scope, "northstar-studio"))!;
      const first = structuredClone(original);
      const second = structuredClone(original);
      first.name = "First concurrent update";
      second.name = "Second concurrent update";
      first.version += 1;
      second.version += 1;

      const results = await Promise.allSettled([
        repository.save(scope, first, original.version),
        repository.save(scope, second, original.version),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(rejected?.reason).toBeInstanceOf(VersionConflictError);
      expect((await repository.get(scope, original.slug))!.version).toBe(
        original.version + 1,
      );
    },
  );

  integrationTest(
    "upgrades an older persisted demo seed without touching personal workspaces",
    async () => {
      const repository = PostgresWorkspaceRepository.connect(databaseUrl!);
      const scope = `integration-seed:${crypto.randomUUID()}`;
      const legacy = cloneDemo("northstar-studio")!;
      legacy.name = "Old persisted demo";
      legacy.entities = legacy.entities.slice(0, 3);
      delete legacy.seedRevision;
      await repository.save(scope, legacy);
      const upgraded = (await repository.get(scope, legacy.slug))!;
      expect(upgraded.name).toBe("Diamond Apps");
      expect(upgraded.entities).toHaveLength(40);
      expect(upgraded.seedRevision).toBe(2);
    },
  );

  integrationTest(
    "compare-and-swaps deletes so a stale request cannot erase a newer write",
    async () => {
      const repository = PostgresWorkspaceRepository.connect(databaseUrl!);
      const service = new WorkspaceService(repository);
      const scope = `integration-delete:${crypto.randomUUID()}`;
      const original = await service.create(scope, "Delete race company");
      const updated = structuredClone(original);
      updated.name = "Newer aggregate";
      updated.version += 1;
      await repository.save(scope, updated, original.version);

      await expect(
        repository.delete(scope, original.slug, original.version),
      ).rejects.toBeInstanceOf(VersionConflictError);
      expect(await repository.get(scope, original.slug)).toMatchObject({
        name: "Newer aggregate",
        version: updated.version,
      });
    },
  );

  integrationTest(
    "clears aggregate-backed proposal replay state when a demo is reset",
    async () => {
      const repository = PostgresWorkspaceRepository.connect(databaseUrl!);
      const scope = `integration-reset:${crypto.randomUUID()}`;
      const service = new WorkspaceService(repository);
      const baseline = (await repository.get(scope, "northstar-studio"))!;
      const first = await service.draft(
        scope,
        baseline.slug,
        baseline.version,
        "postgres-reset-draft",
        [
          {
            id: "before-reset",
            name: "Reset-sensitive item",
            type: "service",
            trust: "INFERRED",
          },
        ],
        [],
      );
      await service.resetDemo(scope, baseline.slug);

      const restartedService = new WorkspaceService(repository);
      const second = await restartedService.draft(
        scope,
        baseline.slug,
        baseline.version,
        "postgres-reset-draft",
        [
          {
            id: "after-reset",
            name: "Reset-sensitive item",
            type: "service",
            trust: "INFERRED",
          },
        ],
        [],
      );

      expect(second.id).not.toBe(first.id);
      expect(
        (await repository.get(scope, baseline.slug))!.proposals.map(
          (proposal) => proposal.id,
        ),
      ).toEqual([second.id]);
    },
  );
});
