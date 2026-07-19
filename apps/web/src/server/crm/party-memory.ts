import "server-only";

import { createHash } from "node:crypto";

import {
  conversations,
  partyMemoryObservations,
  parties,
  sessions,
  useCaseConfigVersions,
  type PactaDatabase,
} from "@pacta/db";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";

const memoryCategorySchema = z.enum([
  "communication_preference",
  "commercial_preference",
  "operating_capability",
  "relationship_fact",
]);

export const storePartyMemoryBodySchema = z
  .object({
    conversation_id: z.string().min(1),
    conversation_history: z.string().min(1),
    memory_token: z.string().min(32).max(256),
    category: memoryCategorySchema,
    memory_key: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    content: z.string().trim().min(1).max(500),
    evidence_quote: z.string().trim().min(1).max(1000),
  })
  .strict();

const historySchema = z.object({ entries: z.array(z.unknown()) }).passthrough();

function latestUserStatement(serializedHistory: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedHistory);
  } catch {
    return null;
  }
  const history = historySchema.safeParse(parsed);
  if (!history.success) return null;
  for (const entry of [...history.data.entries].reverse()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (
      record.role === "user" &&
      typeof record.message === "string" &&
      record.message.trim()
    )
      return record.message.trim();
  }
  return null;
}

function fingerprint(parts: string[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function conversationMemoryContext(
  db: PactaDatabase,
  providerConversationId: string,
  memoryToken: string,
) {
  const [context] = await db
    .select({
      conversation: conversations,
      useCaseId: useCaseConfigVersions.useCaseId,
    })
    .from(conversations)
    .innerJoin(sessions, eq(sessions.id, conversations.sessionId))
    .innerJoin(
      useCaseConfigVersions,
      eq(useCaseConfigVersions.id, sessions.useCaseConfigVersionId),
    )
    .where(
      and(
        eq(conversations.provider, "elevenlabs"),
        eq(conversations.providerConversationId, providerConversationId),
        eq(conversations.brainTokenHash, tokenHash(memoryToken)),
        gt(conversations.brainTokenExpiresAt, new Date()),
      ),
    );
  if (!context) throw new Error("Unknown ElevenLabs conversation.");
  return context;
}

export async function storePartyMemory(db: PactaDatabase, rawBody: unknown) {
  const body = storePartyMemoryBodySchema.parse(rawBody);
  const sourceStatement = latestUserStatement(body.conversation_history);
  if (!sourceStatement)
    return {
      accepted: false as const,
      reason: "explicit_supplier_statement_required",
      nextAction:
        "Do not store a memory. Continue only after the supplier explicitly states the fact.",
    };
  if (!sourceStatement.includes(body.evidence_quote))
    return {
      accepted: false as const,
      reason: "evidence_quote_not_in_latest_supplier_turn",
      nextAction:
        "Use an exact quote from the latest supplier turn or do not store the memory.",
    };

  const context = await conversationMemoryContext(
    db,
    body.conversation_id,
    body.memory_token,
  );
  if (!context.conversation.purposeKey.startsWith("supplier_"))
    throw new Error("Only a supplier conversation can store supplier memory.");
  const observationFingerprint = fingerprint([
    context.conversation.workspaceId,
    context.conversation.partyId,
    context.useCaseId,
    context.conversation.id,
    body.category,
    body.memory_key,
    body.content,
    body.evidence_quote,
  ]);

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as PactaDatabase;
    await tx
      .select({ id: parties.id })
      .from(parties)
      .where(eq(parties.id, context.conversation.partyId))
      .for("update");
    const [existing] = await tx
      .select()
      .from(partyMemoryObservations)
      .where(
        eq(
          partyMemoryObservations.observationFingerprint,
          observationFingerprint,
        ),
      );
    if (existing)
      return {
        accepted: true as const,
        created: false,
        memoryId: existing.id,
        memoryKey: existing.memoryKey,
        nextAction:
          "The same CRM memory is already stored. Continue the conversation.",
      };

    const [previous] = await tx
      .select({ id: partyMemoryObservations.id })
      .from(partyMemoryObservations)
      .where(
        and(
          eq(
            partyMemoryObservations.workspaceId,
            context.conversation.workspaceId,
          ),
          eq(partyMemoryObservations.partyId, context.conversation.partyId),
          eq(partyMemoryObservations.useCaseId, context.useCaseId),
          eq(partyMemoryObservations.memoryKey, body.memory_key),
        ),
      )
      .orderBy(
        desc(partyMemoryObservations.observedAt),
        desc(partyMemoryObservations.createdAt),
        desc(partyMemoryObservations.id),
      )
      .limit(1);
    const [created] = await tx
      .insert(partyMemoryObservations)
      .values({
        workspaceId: context.conversation.workspaceId,
        partyId: context.conversation.partyId,
        useCaseId: context.useCaseId,
        sourceConversationId: context.conversation.id,
        categoryKey: body.category,
        memoryKey: body.memory_key,
        content: body.content,
        evidenceStatement: body.evidence_quote,
        observationFingerprint,
        supersedesObservationId: previous?.id,
      })
      .returning();
    if (!created) throw new Error("Could not store party memory.");
    return {
      accepted: true as const,
      created: true,
      memoryId: created.id,
      memoryKey: created.memoryKey,
      supersedesMemoryId: previous?.id ?? null,
      nextAction:
        "The evidence-backed CRM memory is stored. Continue without exposing internal memory IDs or tool details.",
    };
  });
}

export type PartyMemoryPromptObservation = Pick<
  typeof partyMemoryObservations.$inferSelect,
  "categoryKey" | "memoryKey" | "content" | "observedAt"
>;

export function buildPartyMemoryPromptContext(
  observations: PartyMemoryPromptObservation[],
) {
  const latestByKey = new Map<string, PartyMemoryPromptObservation>();
  for (const observation of observations) {
    if (!latestByKey.has(observation.memoryKey))
      latestByKey.set(observation.memoryKey, observation);
  }
  return JSON.stringify(
    [...latestByKey.values()].slice(0, 8).map((observation) => ({
      category: observation.categoryKey,
      key: observation.memoryKey,
      fact: observation.content,
      observed_at: observation.observedAt.toISOString(),
    })),
  );
}

export async function loadPartyMemoryPromptContext(
  db: PactaDatabase,
  input: { partyId: string; useCaseId: string },
) {
  const observations = await db
    .select({
      categoryKey: partyMemoryObservations.categoryKey,
      memoryKey: partyMemoryObservations.memoryKey,
      content: partyMemoryObservations.content,
      observedAt: partyMemoryObservations.observedAt,
    })
    .from(partyMemoryObservations)
    .where(
      and(
        eq(partyMemoryObservations.partyId, input.partyId),
        eq(partyMemoryObservations.useCaseId, input.useCaseId),
      ),
    )
    .orderBy(
      desc(partyMemoryObservations.observedAt),
      desc(partyMemoryObservations.createdAt),
      desc(partyMemoryObservations.id),
    )
    .limit(64);
  return buildPartyMemoryPromptContext(observations);
}

export async function loadConversationPartyMemoryPromptContext(
  db: PactaDatabase,
  conversationId: string,
) {
  const [context] = await db
    .select({
      partyId: conversations.partyId,
      useCaseId: useCaseConfigVersions.useCaseId,
    })
    .from(conversations)
    .innerJoin(sessions, eq(sessions.id, conversations.sessionId))
    .innerJoin(
      useCaseConfigVersions,
      eq(useCaseConfigVersions.id, sessions.useCaseConfigVersionId),
    )
    .where(eq(conversations.id, conversationId));
  if (!context) throw new Error("Conversation memory context was not found.");
  return loadPartyMemoryPromptContext(db, context);
}
