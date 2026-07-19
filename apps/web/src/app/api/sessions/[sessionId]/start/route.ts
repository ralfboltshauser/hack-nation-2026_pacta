import { z } from "zod";

import { hasDemoAccess } from "@/server/access";
import { runSessionAction } from "@/server/orchestration/calls";

const requestSchema = z.object({ target: z.literal("suppliers") }).strict();

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  if (!hasDemoAccess(request))
    return Response.json(
      { error: "Demo access key required" },
      { status: 401 },
    );
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json({ error: "Invalid start request" }, { status: 422 });
  const { sessionId } = await context.params;
  const result = await runSessionAction(sessionId, "call_suppliers");
  return Response.json(result);
}
