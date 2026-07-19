import {
  appendSessionEvent,
  conversations,
  createDatabase,
  sessions,
} from "@pacta/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { hasSessionMembership } from "@/server/sessions/authorization";

const requestSchema = z
  .object({ providerConversationId: z.string().min(8).max(200) })
  .strict();

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Invalid provider conversation ID" },
      { status: 422 },
    );
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
    const [row] = await db
      .select({ session: sessions, conversation: conversations })
      .from(sessions)
      .innerJoin(
        conversations,
        and(
          eq(conversations.sessionId, sessions.id),
          eq(conversations.partyId, sessions.customerPartyId),
          eq(conversations.purposeKey, "customer_intake"),
        ),
      )
      .where(eq(sessions.id, sessionId));
    if (!row)
      return Response.json(
        { error: "Session customer conversation was not found" },
        { status: 404 },
      );
    const now = new Date();
    await db
      .update(conversations)
      .set({
        providerConversationId: parsed.data.providerConversationId,
        status:
          row.conversation.status === "in_progress"
            ? "in_progress"
            : "connected",
        initiatedAt: row.conversation.initiatedAt ?? now,
        connectedAt: row.conversation.connectedAt ?? now,
      })
      .where(eq(conversations.id, row.conversation.id));
    await appendSessionEvent(db, {
      workspaceId: row.session.workspaceId,
      sessionId,
      aggregateType: "conversation",
      aggregateId: row.conversation.id,
      eventType: "conversation.connected",
      source: "elevenlabs_chat",
      idempotencyKey: `conversation:${row.conversation.id}:connected`,
      payload: {
        purpose: row.conversation.purposeKey,
        partyId: row.conversation.partyId,
        channel: "text_chat",
      },
    });
    return Response.json({ bound: true });
  } finally {
    await client.end();
  }
}
