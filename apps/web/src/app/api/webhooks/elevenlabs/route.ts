import {
  appendSessionEvent,
  awards,
  contextInjections,
  conversations,
  conversationTurns,
  createDatabase,
  customerDecisions,
  sessions,
  type PactaDatabase,
} from "@pacta/db";
import { verifyPostCallWebhook } from "@pacta/elevenlabs";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret)
    return Response.json(
      { error: "Webhook is not configured" },
      { status: 503 },
    );
  const rawBody = await request.text();
  let event;
  try {
    event = await verifyPostCallWebhook(
      rawBody,
      request.headers.get("elevenlabs-signature"),
      secret,
    );
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  const { db, client } = createDatabase();
  try {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(
        eq(conversations.providerConversationId, event.data.conversation_id),
      );
    if (!conversation) return Response.json({ received: true, matched: false });
    if (event.type === "post_call_transcription") {
      const transcript = Array.isArray(event.data.transcript)
        ? event.data.transcript
        : [];
      for (const [ordinal, rawTurn] of transcript.entries()) {
        if (!rawTurn || typeof rawTurn !== "object") continue;
        const turn = rawTurn as Record<string, unknown>;
        await db
          .insert(conversationTurns)
          .values({
            workspaceId: conversation.workspaceId,
            conversationId: conversation.id,
            providerTurnId: `post-call:${ordinal}`,
            ordinal,
            role: typeof turn.role === "string" ? turn.role : "unknown",
            content: typeof turn.message === "string" ? turn.message : turn,
            isFinal: true,
            rawEvent: turn,
          })
          .onConflictDoNothing();
      }
      await db
        .update(conversations)
        .set({
          status: "ended",
          endedAt: new Date(),
          rawMetadata: { webhook: event.data },
        })
        .where(eq(conversations.id, conversation.id));
    } else if (event.type === "call_initiation_failure") {
      await db
        .update(conversations)
        .set({
          status: "failed",
          endedAt: new Date(),
          endReason: String(event.data.failure_reason ?? "unknown"),
          rawMetadata: { webhook: event.data },
        })
        .where(eq(conversations.id, conversation.id));
    }
    await appendSessionEvent(db, {
      workspaceId: conversation.workspaceId,
      sessionId: conversation.sessionId,
      aggregateType: "conversation",
      aggregateId: conversation.id,
      eventType:
        event.type === "call_initiation_failure"
          ? "conversation.initiation_failed"
          : "conversation.ended",
      source: "elevenlabs_webhook",
      idempotencyKey: `elevenlabs:${event.type}:${event.data.conversation_id}:${event.event_timestamp}`,
      payload: { providerConversationId: event.data.conversation_id },
    });
    await maybeCompleteSession(
      db,
      conversation.workspaceId,
      conversation.sessionId,
    );
    return Response.json({ received: true, matched: true });
  } finally {
    await client.end();
  }
}

async function maybeCompleteSession(
  db: PactaDatabase,
  workspaceId: string,
  sessionId: string,
) {
  const calls = await db
    .select({ status: conversations.status })
    .from(conversations)
    .where(eq(conversations.sessionId, sessionId));
  const [pendingInjection] = await db
    .select({ id: contextInjections.id })
    .from(contextInjections)
    .where(
      and(
        eq(contextInjections.sessionId, sessionId),
        eq(contextInjections.status, "pending"),
      ),
    )
    .limit(1);
  const [confirmedAward] = await db
    .select({ id: awards.id })
    .from(awards)
    .where(and(eq(awards.sessionId, sessionId), eq(awards.status, "confirmed")))
    .limit(1);
  const [declinedAll] = await db
    .select({ id: customerDecisions.id })
    .from(customerDecisions)
    .where(
      and(
        eq(customerDecisions.sessionId, sessionId),
        eq(customerDecisions.action, "declined_all"),
      ),
    )
    .limit(1);
  const callsTerminal =
    calls.length > 0 &&
    calls.every((call) => ["ended", "failed"].includes(call.status));
  if (!callsTerminal || pendingInjection || (!confirmedAward && !declinedAll))
    return false;
  await db
    .update(sessions)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(sessions.id, sessionId));
  await appendSessionEvent(db, {
    workspaceId,
    sessionId,
    aggregateType: "session",
    aggregateId: sessionId,
    eventType: "session.completed",
    source: "orchestrator",
    idempotencyKey: `session:${sessionId}:completed`,
    payload: {
      outcome: confirmedAward ? "award_confirmed" : "customer_declined_all",
    },
  });
  return true;
}
