import { createDatabase } from "@pacta/db";
import { ZodError } from "zod";

import { getNegotiationState } from "@/server/native-tools/state";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { db, client } = createDatabase();
  try {
    return Response.json(
      await getNegotiationState(db, await request.json().catch(() => null)),
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "State lookup failed.",
      },
      { status: error instanceof ZodError ? 422 : 400 },
    );
  } finally {
    await client.end();
  }
}
