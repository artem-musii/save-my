import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const sql = postgres(databaseUrl, { max: 1 });
const migration = await Bun.file(
  new URL("./migrations/0001_initial.sql", import.meta.url),
).text();
await sql.unsafe(migration);
await sql.end();
console.log("Applied 0001_initial.sql");
