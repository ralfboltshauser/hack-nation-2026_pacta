import { createHash } from "node:crypto";

import {
  appendSessionEvent,
  conversations,
  createDatabase,
  jobs,
  parties,
  sessionActions,
  sessions,
} from "@pacta/db";
import { createBrainToken, startOutboundCall } from "@pacta/elevenlabs";
import { and, eq, inArray } from "drizzle-orm";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function outboundCallsEnabled() {
  return process.env.PACTA_OUTBOUND_CALLS_ENABLED === "true";
}

function agentId(purpose: string) {
  const nativeRuntime = process.env.PACTA_ELEVENLABS_RUNTIME === "native_tools";
  const value =
    purpose === "customer_intake"
      ? nativeRuntime
        ? process.env.ELEVENLABS_NATIVE_CUSTOMER_AGENT_ID
        : process.env.ELEVENLABS_CUSTOMER_AGENT_ID
      : nativeRuntime
        ? process.env.ELEVENLABS_NATIVE_SUPPLIER_AGENT_ID
        : process.env.ELEVENLABS_SUPPLIER_AGENT_ID;
  if (!value)
    throw new Error(`No ElevenLabs agent is configured for ${purpose}.`);
  return value;
}

export async function executeOutboundCall(conversationId: string) {
  if (!outboundCallsEnabled())
    throw new Error(
      "Outbound phone calls are disarmed by PACTA_OUTBOUND_CALLS_ENABLED.",
    );
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  if (!apiKey || !phoneNumberId)
    throw new Error("ElevenLabs outbound-call credentials are incomplete.");
  const { db, client } = createDatabase();
  try {
    const [row] = await db
      .select({ conversation: conversations, party: parties })
      .from(conversations)
      .innerJoin(parties, eq(parties.id, conversations.partyId))
      .where(eq(conversations.id, conversationId));
    if (!row?.party.phoneE164)
      throw new Error("Conversation party has no phone number.");
    if (
      ["initiated", "connected", "in_progress"].includes(
        row.conversation.status,
      )
    ) {
      return {
        skipped: true,
        providerConversationId: row.conversation.providerConversationId,
      };
    }
    const nativeRuntime =
      process.env.PACTA_ELEVENLABS_RUNTIME === "native_tools";
    const brainToken = nativeRuntime ? null : createBrainToken();
    await db
      .update(conversations)
      .set({
        ...(brainToken
          ? {
              brainTokenHash: hash(brainToken),
              brainTokenExpiresAt: new Date(Date.now() + 3 * 60 * 60_000),
            }
          : { brainTokenExpiresAt: new Date(0) }),
        status: "initiating",
      })
      .where(eq(conversations.id, conversationId));
    try {
      const result = await startOutboundCall({
        apiKey,
        agentId: agentId(row.conversation.purposeKey),
        agentPhoneNumberId: phoneNumberId,
        toNumber: row.party.phoneE164,
        runtime: nativeRuntime ? "native_tools" : "custom_llm",
        ...(brainToken
          ? {
              brainToken,
              context: {
                workspace_id: row.conversation.workspaceId,
                session_id: row.conversation.sessionId,
                conversation_id: row.conversation.id,
                purpose: row.conversation.purposeKey as
                  | "customer_intake"
                  | "supplier_negotiation"
                  | "supplier_commitment"
                  | "supplier_closeout",
                ...(row.conversation.negotiationId
                  ? { negotiation_id: row.conversation.negotiationId }
                  : {}),
              },
            }
          : {}),
        dynamicVariables: { party_name: row.party.displayName },
        callRecordingEnabled: false,
      });
      await db
        .update(conversations)
        .set({
          status: "initiated",
          agentId: agentId(row.conversation.purposeKey),
          providerConversationId: result.conversationId,
          providerCallId: result.callSid,
          initiatedAt: new Date(),
          rawMetadata: { initiationMessage: result.message },
        })
        .where(eq(conversations.id, conversationId));
      await appendSessionEvent(db, {
        workspaceId: row.conversation.workspaceId,
        sessionId: row.conversation.sessionId,
        aggregateType: "conversation",
        aggregateId: row.conversation.id,
        eventType: "conversation.initiated",
        source: "orchestrator",
        idempotencyKey: `conversation:${conversationId}:initiated`,
        payload: {
          purpose: row.conversation.purposeKey,
          partyId: row.party.id,
        },
      });
      return { skipped: false, providerConversationId: result.conversationId };
    } catch (error) {
      await db
        .update(conversations)
        .set({
          status: "failed",
          endReason: "initiation_failed",
          endedAt: new Date(),
          rawMetadata: {
            message: error instanceof Error ? error.message : "Unknown error",
          },
        })
        .where(eq(conversations.id, conversationId));
      await appendSessionEvent(db, {
        workspaceId: row.conversation.workspaceId,
        sessionId: row.conversation.sessionId,
        aggregateType: "conversation",
        aggregateId: row.conversation.id,
        eventType: "conversation.initiation_failed",
        source: "orchestrator",
        idempotencyKey: `conversation:${conversationId}:initiation_failed`,
        payload: { purpose: row.conversation.purposeKey },
      });
      throw error;
    }
  } finally {
    await client.end();
  }
}

export async function executeSessionCalls(
  sessionId: string,
  purposeKey: "customer_intake" | "supplier_negotiation",
) {
  const { db, client } = createDatabase();
  try {
    const rows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.sessionId, sessionId),
          eq(conversations.purposeKey, purposeKey),
        ),
      );
    return Promise.allSettled(rows.map((row) => executeOutboundCall(row.id)));
  } finally {
    await client.end();
  }
}

export async function runSessionAction(
  sessionId: string,
  actionType: "call_customer" | "call_suppliers",
) {
  if (!outboundCallsEnabled())
    return { skipped: true, reason: "outbound_calls_disabled" } as const;
  const actionKey = `${actionType}:v1`;
  const { db, client } = createDatabase();
  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    if (!session) throw new Error("Session not found.");
    if (actionType === "call_suppliers") {
      const [job] = await db
        .select({ status: jobs.status })
        .from(jobs)
        .where(eq(jobs.sessionId, sessionId));
      if (job?.status !== "confirmed")
        throw new Error("Supplier calls require an explicitly confirmed job.");
    }
    const [action] = await db
      .insert(sessionActions)
      .values({
        workspaceId: session.workspaceId,
        sessionId,
        actionType,
        actionKey,
        status: "running",
        requestedBy: "orchestrator",
        attemptCount: 1,
        claimedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();
    if (!action) return { skipped: true };
    try {
      const results = await executeSessionCalls(
        sessionId,
        actionType === "call_customer"
          ? "customer_intake"
          : "supplier_negotiation",
      );
      await db
        .update(sessionActions)
        .set({ status: "completed", result: results, completedAt: new Date() })
        .where(eq(sessionActions.id, action.id));
      return { skipped: false, results };
    } catch (error) {
      await db
        .update(sessionActions)
        .set({
          status: "failed",
          lastError: {
            message: error instanceof Error ? error.message : "Unknown error",
          },
          completedAt: new Date(),
        })
        .where(eq(sessionActions.id, action.id));
      throw error;
    }
  } finally {
    await client.end();
  }
}

export async function markProviderConversationEnded(
  providerConversationIds: string[],
) {
  if (!providerConversationIds.length) return;
  const { db, client } = createDatabase();
  try {
    await db
      .update(conversations)
      .set({ status: "ended", endedAt: new Date() })
      .where(
        inArray(conversations.providerConversationId, providerConversationIds),
      );
  } finally {
    await client.end();
  }
}
