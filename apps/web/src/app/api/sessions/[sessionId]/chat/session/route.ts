import { createHash } from "node:crypto";

import { conversations, createDatabase, sessions } from "@pacta/db";
import {
  buildSignedTextSessionPayload,
  createBrainToken,
  getSignedConversationUrl,
  selectPactaAgent,
} from "@pacta/elevenlabs";
import { and, eq } from "drizzle-orm";

import { hasSessionMembership } from "@/server/sessions/authorization";

export const runtime = "nodejs";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
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
      role: "customer",
      customLlmAgentId: process.env.ELEVENLABS_CUSTOMER_AGENT_ID,
      nativeToolsAgentId: process.env.ELEVENLABS_NATIVE_CUSTOMER_AGENT_ID,
    });
    if (!apiKey || !agent.agentId)
      return Response.json(
        {
          error: "Customer chat agent is not configured",
          missing: !agent.agentId ? agent.environmentVariable : undefined,
        },
        { status: 503 },
      );
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
    if (["completed", "failed"].includes(row.session.status))
      return Response.json(
        { error: "Session is already closed" },
        { status: 409 },
      );

    const signedUrl = await getSignedConversationUrl({
      apiKey,
      agentId: agent.agentId,
    });
    const brainToken =
      agent.runtime === "custom_llm" ? createBrainToken() : null;
    // The DB hash is non-null for legacy rollback; epoch expiry revokes it in native mode.
    await db
      .update(conversations)
      .set({
        agentId: agent.agentId,
        channel: "text_chat",
        provider: "elevenlabs",
        status: "initiating",
        ...(brainToken
          ? {
              brainTokenHash: hash(brainToken),
              brainTokenExpiresAt: new Date(Date.now() + 3 * 60 * 60_000),
            }
          : { brainTokenExpiresAt: new Date(0) }),
      })
      .where(eq(conversations.id, row.conversation.id));
    return Response.json(
      buildSignedTextSessionPayload({
        signedUrl,
        runtime: agent.runtime,
        customLlmExtraBody: {
          contract_version: "1",
          brain_token: brainToken,
          workspace_id: row.session.workspaceId,
          session_id: row.session.id,
          conversation_id: row.conversation.id,
          purpose: "customer_intake",
        },
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Customer chat session creation failed", error);
    return Response.json(
      { error: "Customer chat session creation failed" },
      { status: 502 },
    );
  } finally {
    await client.end();
  }
}
