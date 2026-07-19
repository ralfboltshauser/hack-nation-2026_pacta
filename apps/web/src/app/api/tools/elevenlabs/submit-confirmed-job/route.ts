import { createDatabase } from "@pacta/db";
import { ZodError } from "zod";

import { runSessionAction } from "@/server/orchestration/calls";
import { submitConfirmedJob } from "@/server/native-tools/submit-confirmed-job";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const { db, client } = createDatabase();
  try {
    const body = await request.json().catch(() => null);
    const result = await submitConfirmedJob(db, body);
    if (result.accepted && result.created) {
      await runSessionAction(result.sessionId, "call_suppliers");
    }
    if (result.accepted) {
      return Response.json({
        accepted: result.accepted,
        created: result.created,
        jobRevisionId: result.jobRevisionId,
        jobRevisionNumber: result.jobRevisionNumber,
        nextAction: result.nextAction,
      });
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json(
        { accepted: false, reason: "invalid_request", issues: error.issues },
        { status: 422 },
      );
    return Response.json(
      {
        accepted: false,
        reason: "tool_failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 },
    );
  } finally {
    await client.end();
  }
}
