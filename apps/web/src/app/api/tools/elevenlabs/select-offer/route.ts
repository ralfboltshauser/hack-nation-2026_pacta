import { createDatabase } from "@pacta/db";
import { ZodError } from "zod";

import { selectOffer } from "@/server/native-tools/decisions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { db, client } = createDatabase();
  try {
    return Response.json(
      await selectOffer(db, await request.json().catch(() => null)),
    );
  } catch (error) {
    return Response.json(
      {
        accepted: false,
        error: error instanceof Error ? error.message : "Selection failed.",
      },
      { status: error instanceof ZodError ? 422 : 400 },
    );
  } finally {
    await client.end();
  }
}
