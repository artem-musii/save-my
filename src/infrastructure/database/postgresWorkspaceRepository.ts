import postgres, { type Sql } from "postgres";
import type { Workspace } from "../../domain/model";
import type { WorkspaceRepository } from "../../application/workspaceService";
import { cloneDemo, demoWorkspaces } from "../demoWorkspaces";
import {
  NotFoundError,
  VersionConflictError,
} from "../../application/workspaceService";

export class PostgresWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly sql: Sql) {}

  static connect(databaseUrl: string) {
    return new PostgresWorkspaceRepository(
      postgres(databaseUrl, { max: 10, idle_timeout: 20 }),
    );
  }

  async ensureUser(
    id: string,
    email: string,
    passwordHash: string,
    displayName: string,
  ) {
    await this.sql`INSERT INTO users (id, email, password_hash, display_name)
      VALUES (${id}, ${email}, ${passwordHash}, ${displayName})
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name`;
  }

  async getSession(id: string) {
    const rows = await this.sql<
      { user_id: string | null; created_at: Date }[]
    >`SELECT user_id, created_at FROM sessions WHERE id = ${id} AND expires_at > now() LIMIT 1`;
    return rows[0]
      ? {
          userId: rows[0].user_id ?? undefined,
          createdAt: rows[0].created_at.getTime(),
        }
      : undefined;
  }

  async createSession(id: string) {
    await this
      .sql`INSERT INTO sessions (id, user_id, expires_at) VALUES (${id}, NULL, now() + interval '7 days') ON CONFLICT (id) DO NOTHING`;
  }

  async setSessionUser(id: string, userId: string) {
    await this
      .sql`UPDATE sessions SET user_id = ${userId}, expires_at = now() + interval '7 days' WHERE id = ${id}`;
  }

  async deleteSession(id: string) {
    await this.sql`DELETE FROM sessions WHERE id = ${id}`;
  }

  async get(scope: string, slug: string) {
    const rows = await this.sql<
      { data: Workspace }[]
    >`SELECT data FROM workspaces WHERE scope = ${scope} AND slug = ${slug} LIMIT 1`;
    const demo = cloneDemo(slug);
    if (rows[0]) {
      const stored = structuredClone(rows[0].data);
      if (
        stored.fictional &&
        demo &&
        stored.seedRevision !== demo.seedRevision
      ) {
        await this.save(scope, demo);
        return demo;
      }
      return stored;
    }
    if (!demo) return undefined;
    await this.save(scope, demo);
    return demo;
  }

  async save(scope: string, workspace: Workspace, expectedVersion?: number) {
    const ownerId = scope.startsWith("user:") ? scope.slice(5) : null;
    if (expectedVersion === 0) {
      const inserted = await this.sql<
        { version: number }[]
      >`INSERT INTO workspaces (scope, slug, owner_id, version, fictional, data)
        VALUES (${scope}, ${workspace.slug}, ${ownerId}, ${workspace.version}, ${workspace.fictional}, ${this.sql.json(workspace)})
        ON CONFLICT (scope, slug) DO NOTHING
        RETURNING version`;
      if (inserted.length) return;
      const current = await this.sql<
        { version: number }[]
      >`SELECT version FROM workspaces WHERE scope = ${scope} AND slug = ${workspace.slug} LIMIT 1`;
      throw new VersionConflictError(current[0]?.version ?? 0);
    }
    if (expectedVersion !== undefined) {
      const updated = await this.sql<{ version: number }[]>`UPDATE workspaces
        SET owner_id = ${ownerId}, version = ${workspace.version}, fictional = ${workspace.fictional}, data = ${this.sql.json(workspace)}, updated_at = now()
        WHERE scope = ${scope} AND slug = ${workspace.slug} AND version = ${expectedVersion}
        RETURNING version`;
      if (updated.length) return;
      const current = await this.sql<
        { version: number }[]
      >`SELECT version FROM workspaces WHERE scope = ${scope} AND slug = ${workspace.slug} LIMIT 1`;
      if (!current[0]) throw new NotFoundError("Workspace not found.");
      throw new VersionConflictError(current[0].version);
    }
    await this
      .sql`INSERT INTO workspaces (scope, slug, owner_id, version, fictional, data)
      VALUES (${scope}, ${workspace.slug}, ${ownerId}, ${workspace.version}, ${workspace.fictional}, ${this.sql.json(workspace)})
      ON CONFLICT (scope, slug) DO UPDATE SET version = EXCLUDED.version, fictional = EXCLUDED.fictional, data = EXCLUDED.data, updated_at = now()`;
  }

  async delete(scope: string, slug: string, expectedVersion?: number) {
    await this.sql.begin(async (transaction) => {
      if (expectedVersion !== undefined) {
        const deleted = await transaction<
          { version: number }[]
        >`DELETE FROM workspaces WHERE scope = ${scope} AND slug = ${slug} AND version = ${expectedVersion} RETURNING version`;
        if (!deleted.length) {
          const current = await transaction<
            { version: number }[]
          >`SELECT version FROM workspaces WHERE scope = ${scope} AND slug = ${slug} LIMIT 1`;
          if (!current[0]) throw new NotFoundError("Workspace not found.");
          throw new VersionConflictError(current[0].version);
        }
      } else {
        await transaction`DELETE FROM workspaces WHERE scope = ${scope} AND slug = ${slug}`;
      }
    });
  }

  async resetDemo(scope: string, slug: string) {
    const demo = cloneDemo(slug);
    if (!demo) throw new NotFoundError("Demo workspace not found.");
    const ownerId = scope.startsWith("user:") ? scope.slice(5) : null;
    await this.sql.begin(async (transaction) => {
      await transaction`INSERT INTO workspaces (scope, slug, owner_id, version, fictional, data)
        VALUES (${scope}, ${demo.slug}, ${ownerId}, ${demo.version}, ${demo.fictional}, ${transaction.json(demo)})
        ON CONFLICT (scope, slug) DO UPDATE SET owner_id = EXCLUDED.owner_id, version = EXCLUDED.version, fictional = EXCLUDED.fictional, data = EXCLUDED.data, updated_at = now()`;
    });
    return demo;
  }

  async list(scope: string) {
    for (const demo of demoWorkspaces) await this.get(scope, demo.slug);
    const rows = await this.sql<
      { data: Workspace }[]
    >`SELECT data FROM workspaces WHERE scope = ${scope} ORDER BY fictional DESC, updated_at DESC`;
    const workspaces = rows.map((row) => structuredClone(row.data));
    const bySlug = new Map(
      workspaces.map((workspace) => [workspace.slug, workspace]),
    );
    return [
      ...demoWorkspaces
        .map((demo) => bySlug.get(demo.slug))
        .filter((workspace): workspace is Workspace => Boolean(workspace)),
      ...workspaces.filter((workspace) => workspace.sector === "custom"),
    ];
  }
}
