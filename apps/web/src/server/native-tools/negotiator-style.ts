import "server-only";

import {
  negotiatorStylePlaybooks,
  negotiatorStyleSchema,
  negotiatorStyles,
} from "@pacta/core";
import {
  appendSessionEventInTransaction,
  negotiations,
  sessions,
  type PactaDatabase,
} from "@pacta/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { jsonRecord, loadNativeConversationContext } from "./state";

export const classifyNegotiatorStyleBodySchema = z
  .object({
    conversation_id: z.string().min(1),
    conversation_history: z.string().min(1),
    negotiator_style: z.enum(negotiatorStyles),
    evidence_quote: z.string().trim().min(4).max(280),
  })
  .strict();

export const storedCounterpartyStyleSchema = z
  .object({
    type: negotiatorStyleSchema,
    evidenceQuote: z.string().min(1),
    source: z.literal("elevenlabs_conversation_history"),
    revision: z.number().int().positive(),
    classifiedAt: z.string().datetime(),
  })
  .strict();

export type StoredCounterpartyStyle = z.infer<
  typeof storedCounterpartyStyleSchema
>;

function historyUserMessages(serializedHistory: string) {
  let history: unknown;
  try {
    history = JSON.parse(serializedHistory) as unknown;
  } catch {
    return [];
  }
  const document = jsonRecord(history);
  const entries = Array.isArray(history)
    ? history
    : Array.isArray(document.entries)
      ? document.entries
      : [];
  return entries.flatMap((entry) => {
    const row = jsonRecord(entry);
    return row.role === "user" && typeof row.message === "string"
      ? [row.message]
      : [];
  });
}

function normalizeEvidence(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}%$€£¥₣']+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function evidenceQuoteAppearsInSupplierTurns(
  serializedHistory: string,
  evidenceQuote: string,
) {
  const evidence = normalizeEvidence(evidenceQuote);
  if (evidence.split(" ").filter(Boolean).length < 2) return false;
  return historyUserMessages(serializedHistory).some((message) =>
    normalizeEvidence(message).includes(evidence),
  );
}

export function storedCounterpartyStyle(value: unknown) {
  const result = storedCounterpartyStyleSchema.safeParse(
    jsonRecord(value).counterpartyStyle,
  );
  return result.success ? result.data : null;
}

export async function classifyNegotiatorStyle(
  db: PactaDatabase,
  rawBody: unknown,
) {
  const body = classifyNegotiatorStyleBodySchema.parse(rawBody);
  const context = await loadNativeConversationContext(db, body.conversation_id);
  const negotiationId = context.conversation.negotiationId;
  if (
    context.conversation.purposeKey !== "supplier_negotiation" ||
    !negotiationId
  )
    throw new Error(
      "Only a supplier negotiation can classify counterparty behavior.",
    );

  if (
    !evidenceQuoteAppearsInSupplierTurns(
      body.conversation_history,
      body.evidence_quote,
    )
  )
    return {
      accepted: false as const,
      reason: "evidence_not_in_supplier_transcript",
      nextAction:
        "Continue with the neutral strategy. Classify only after a direct supplier quote supports one covered style.",
    };

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as PactaDatabase;
    const [lockedSession] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, context.session.id))
      .for("update");
    if (!lockedSession) throw new Error("Session disappeared.");
    const [negotiation] = await tx
      .select()
      .from(negotiations)
      .where(eq(negotiations.id, negotiationId))
      .for("update");
    if (!negotiation) throw new Error("Negotiation disappeared.");
    if (negotiation.closedAt)
      throw new Error("A terminal negotiation cannot be reclassified.");

    const current = storedCounterpartyStyle(negotiation.data);
    const strategy = negotiatorStylePlaybooks[body.negotiator_style];
    if (
      current?.type === body.negotiator_style &&
      normalizeEvidence(current.evidenceQuote) ===
        normalizeEvidence(body.evidence_quote)
    )
      return {
        accepted: true as const,
        created: false,
        classification: current,
        strategy,
        nextAction:
          "The same evidence-backed style is already active. Continue its strategy.",
      };

    const now = new Date();
    const classification: StoredCounterpartyStyle = {
      type: body.negotiator_style,
      evidenceQuote: body.evidence_quote,
      source: "elevenlabs_conversation_history",
      revision: (current?.revision ?? 0) + 1,
      classifiedAt: now.toISOString(),
    };
    await tx
      .update(negotiations)
      .set({
        stateVersion: negotiation.stateVersion + 1,
        data: {
          ...jsonRecord(negotiation.data),
          counterpartyStyle: classification,
        },
        updatedAt: now,
      })
      .where(eq(negotiations.id, negotiation.id));
    await appendSessionEventInTransaction(tx, {
      workspaceId: lockedSession.workspaceId,
      sessionId: lockedSession.id,
      aggregateType: "negotiation",
      aggregateId: negotiation.id,
      eventType: "negotiation.counterparty_style_classified",
      source: "elevenlabs_native_tool",
      idempotencyKey: `negotiation:${negotiation.id}:counterparty-style:${classification.revision}`,
      payload: {
        previousType: current?.type ?? null,
        type: classification.type,
        evidenceQuote: classification.evidenceQuote,
        revision: classification.revision,
      },
    });
    return {
      accepted: true as const,
      created: true,
      classification,
      strategy,
      nextAction:
        "Apply the returned strategy on the next response without saying the internal style label aloud.",
    };
  });
}
