import { createHash } from "node:crypto";

import { conversations, createDatabase, parties, sessions } from "@pacta/db";
import {
  buildSignedTextSessionPayload,
  createBrainToken,
  getSignedConversationUrl,
  selectPactaAgent,
} from "@pacta/elevenlabs";
import { and, eq } from "drizzle-orm";

import { outboundCallsEnabled } from "@/server/orchestration/calls";
import { loadConversationPartyMemoryPromptContext } from "@/server/crm/party-memory";
import { hasSessionMembership } from "@/server/sessions/authorization";

export const runtime = "nodejs";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ sessionId: string; conversationId: string }>;
  },
) {
  if (outboundCallsEnabled())
    return Response.json(
      {
        error: "Supplier text testing is disabled while phone calls are armed",
      },
      { status: 409 },
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

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agent = selectPactaAgent({
      runtime: process.env.PACTA_ELEVENLABS_RUNTIME,
      role: "supplier",
      customLlmAgentId: process.env.ELEVENLABS_SUPPLIER_AGENT_ID,
      nativeToolsAgentId: process.env.ELEVENLABS_NATIVE_SUPPLIER_AGENT_ID,
    });
    if (!apiKey || !agent.agentId)
      return Response.json(
        {
          error: "Supplier agent is not configured",
          missing: !agent.agentId ? agent.environmentVariable : undefined,
        },
        { status: 503 },
      );
    const [row] = await db
      .select({
        session: sessions,
        conversation: conversations,
        party: parties,
      })
      .from(conversations)
      .innerJoin(sessions, eq(sessions.id, conversations.sessionId))
      .innerJoin(parties, eq(parties.id, conversations.partyId))
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
    if (["completed", "failed"].includes(row.session.status))
      return Response.json(
        { error: "Session is already closed" },
        { status: 409 },
      );

    const signedUrl = await getSignedConversationUrl({
      apiKey,
      agentId: agent.agentId,
    });
    const conversationToken = createBrainToken();
    const partyMemory = await loadConversationPartyMemoryPromptContext(
      db,
      row.conversation.id,
    );
    await db
      .update(conversations)
      .set({
        agentId: agent.agentId,
        channel: "text_chat",
        provider: "elevenlabs",
        status: "initiating",
        brainTokenHash: hash(conversationToken),
        brainTokenExpiresAt: new Date(Date.now() + 3 * 60 * 60_000),
      })
      .where(eq(conversations.id, conversationId));
    return Response.json(
      buildSignedTextSessionPayload({
        signedUrl,
        runtime: agent.runtime,
        dynamicVariables: {
          party_name: row.party.displayName,
          party_memory: partyMemory,
          party_memory_token: conversationToken,
        },
        customLlmExtraBody: {
          contract_version: "1",
          brain_token: conversationToken,
          workspace_id: row.session.workspaceId,
          session_id: row.session.id,
          conversation_id: row.conversation.id,
          purpose: "supplier_negotiation",
          negotiation_id: row.conversation.negotiationId,
        },
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Supplier text session creation failed", error);
    return Response.json(
      { error: "Supplier text session creation failed" },
      { status: 502 },
    );
  } finally {
    await client.end();
  }
}
