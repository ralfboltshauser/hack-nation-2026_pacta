import { createDatabase } from "@pacta/db";
import { ZodError } from "zod";

import { storePartyMemory } from "@/server/crm/party-memory";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { db, client } = createDatabase();
  try {
    return Response.json(
      await storePartyMemory(db, await request.json().catch(() => null)),
    );
  } catch (error) {
    return Response.json(
      {
        accepted: false,
        error:
          error instanceof Error ? error.message : "Memory storage failed.",
      },
      { status: error instanceof ZodError ? 422 : 400 },
    );
  } finally {
    await client.end();
  }
}
