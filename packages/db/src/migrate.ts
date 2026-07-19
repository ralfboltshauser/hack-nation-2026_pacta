import "dotenv/config";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabase } from "./client";

const { db, client } = createDatabase(
  process.env.DIRECT_URL ?? process.env.DATABASE_URL,
);

try {
  await migrate(db, {
    migrationsFolder: new URL("../migrations", import.meta.url).pathname,
  });
} finally {
  await client.end();
}
