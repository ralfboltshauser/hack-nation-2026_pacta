import { createDatabase, sessionEvents } from "@pacta/db";
import { and, asc, eq, gt } from "drizzle-orm";

import { hasSessionMembership } from "@/server/sessions/authorization";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const afterValue = Number(
    new URL(request.url).searchParams.get("after") ?? 0,
  );
  const after =
    Number.isSafeInteger(afterValue) && afterValue >= 0 ? afterValue : 0;
  const { db, client } = createDatabase();
  try {
    const access = await hasSessionMembership(request, db, sessionId);
    if (!access.authenticated)
      return Response.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    if (!access.authorized)
      return Response.json({ error: "Session access denied" }, { status: 403 });
    const events = await db
      .select()
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.sessionId, sessionId),
          gt(sessionEvents.eventSeq, after),
        ),
      )
      .orderBy(asc(sessionEvents.eventSeq))
      .limit(500);
    return Response.json({
      events,
      nextAfter: events.at(-1)?.eventSeq ?? after,
    });
  } finally {
    await client.end();
  }
}
