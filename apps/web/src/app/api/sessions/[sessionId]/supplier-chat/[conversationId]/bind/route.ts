import {
  appendSessionEvent,
  conversations,
  createDatabase,
  sessions,
} from "@pacta/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { hasDemoAccess } from "@/server/access";
import { outboundCallsEnabled } from "@/server/orchestration/calls";
import { hasSessionMembership } from "@/server/sessions/authorization";

const requestSchema = z
  .object({ providerConversationId: z.string().min(8).max(200) })
  .strict();

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ sessionId: string; conversationId: string }>;
  },
) {
  if (!hasDemoAccess(request))
    return Response.json(
      { error: "Demo access key required" },
      { status: 401 },
    );
  if (outboundCallsEnabled())
    return Response.json(
      {
        error: "Supplier text testing is disabled while phone calls are armed",
      },
      { status: 409 },
    );
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Invalid provider conversation ID" },
      { status: 422 },
    );
  const { sessionId, conversationId } = await context.params;
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
      .from(conversations)
      .innerJoin(sessions, eq(sessions.id, conversations.sessionId))
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.sessionId, sessionId),
          eq(conversations.purposeKey, "supplier_negotiation"),
        ),
      );
    if (!row)
      return Response.json(
        { error: "Supplier conversation was not found" },
        { status: 404 },
      );

    const now = new Date();
    await db
      .update(conversations)
      .set({
        providerConversationId: parsed.data.providerConversationId,
        status: "connected",
        initiatedAt: row.conversation.initiatedAt ?? now,
        connectedAt: row.conversation.connectedAt ?? now,
      })
      .where(eq(conversations.id, conversationId));
    await appendSessionEvent(db, {
      workspaceId: row.session.workspaceId,
      sessionId,
      aggregateType: "conversation",
      aggregateId: conversationId,
      eventType: "conversation.connected",
      source: "elevenlabs_chat",
      idempotencyKey: `conversation:${conversationId}:connected`,
      payload: {
        purpose: row.conversation.purposeKey,
        partyId: row.conversation.partyId,
        channel: "text_chat",
        safetyHarness: true,
      },
    });
    return Response.json({ bound: true });
  } finally {
    await client.end();
  }
}
