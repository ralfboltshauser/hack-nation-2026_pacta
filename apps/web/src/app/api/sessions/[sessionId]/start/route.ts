import { z } from "zod";

import { runSessionAction } from "@/server/orchestration/calls";

const requestSchema = z
  .object({ target: z.enum(["customer", "suppliers"]) })
  .strict();

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json({ error: "Invalid start request" }, { status: 422 });
  const { sessionId } = await context.params;
  const result = await runSessionAction(
    sessionId,
    parsed.data.target === "customer" ? "call_customer" : "call_suppliers",
  );
  return Response.json(result);
}
