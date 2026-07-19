import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export function createDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is required");
  const client = postgres(url, {
    max: process.env.VERCEL ? 1 : 10,
    prepare: false,
  });
  return { db: drizzle(client, { schema }), client };
}

export type PactaDatabase = ReturnType<typeof createDatabase>["db"];
