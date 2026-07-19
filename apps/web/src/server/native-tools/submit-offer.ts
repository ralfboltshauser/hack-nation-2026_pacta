import "server-only";

import { createHash } from "node:crypto";

import { reduceOfferDocument } from "@pacta/core";
import {
  appendSessionEventInTransaction,
  conversationTurns,
  conversations,
  jobRevisions,
  jobs,
  leverageFacts,
  negotiations,
  offerRevisions,
  offers,
  sessions,
  sessionEvents,
  toolInvocations,
  useCaseConfigVersions,
  type PactaDatabase,
} from "@pacta/db";
import {
  hasPointer,
  useCaseConfigSchema,
  type UseCaseConfig,
} from "@pacta/use-case-config";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

const TOOL_NAME = "submit_offer";
const PROVIDER = "elevenlabs";

const recordSchema = z.record(z.string(), z.unknown());
const parametersSchema = z
  .object({
    conversation_id: z.string().min(1),
    conversation_history: z.union([
      z.string().min(1),
      z.array(z.unknown()),
      recordSchema,
    ]),
    offer: recordSchema,
  })
  .passthrough();
const envelopeSchema = z
  .object({
    tool_call_id: z.string().min(1).optional(),
    tool_name: z.string().min(1).optional(),
    conversation_id: z.string().min(1).optional(),
    parameters: parametersSchema.optional(),
    conversation_history:
      parametersSchema.shape.conversation_history.optional(),
    offer: recordSchema.optional(),
  })
  .passthrough();

type NormalizedRequest = {
  providerConversationId: string;
  providerToolCallId: string;
  conversationHistory: z.infer<
    typeof parametersSchema.shape.conversation_history
  >;
  offer: Record<string, unknown>;
  rawRequest: Record<string, unknown>;
};

export class NativeSubmitOfferError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function pointerPart(value: string) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeRequest(input: unknown): NormalizedRequest {
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new NativeSubmitOfferError("Invalid submit_offer request.", 422);
  if (parsed.data.tool_name && parsed.data.tool_name !== TOOL_NAME)
    throw new NativeSubmitOfferError(
      `Expected ${TOOL_NAME}, received ${parsed.data.tool_name}.`,
      422,
    );

  const directParameters = {
    conversation_id: parsed.data.conversation_id,
    conversation_history: parsed.data.conversation_history,
    offer: parsed.data.offer,
  };
  const parameters = parametersSchema.safeParse(
    parsed.data.parameters ?? directParameters,
  );
  if (!parameters.success)
    throw new NativeSubmitOfferError(
      "submit_offer requires system conversation_id, conversation_history, and a complete offer.",
      422,
    );
  if (
    parsed.data.conversation_id &&
    parsed.data.conversation_id !== parameters.data.conversation_id
  )
    throw new NativeSubmitOfferError(
      "Envelope and system conversation IDs do not match.",
      409,
    );

  const identity = {
    toolName: TOOL_NAME,
    conversationId: parameters.data.conversation_id,
    conversationHistory: parameters.data.conversation_history,
    offer: parameters.data.offer,
  };
  return {
    providerConversationId: parameters.data.conversation_id,
    providerToolCallId:
      parsed.data.tool_call_id ?? `derived_${fingerprint(identity)}`,
    conversationHistory: parameters.data.conversation_history,
    offer: parameters.data.offer,
    rawRequest: parsed.data,
  };
}

function historyEntries(value: NormalizedRequest["conversationHistory"]) {
  let history: unknown = value;
  if (typeof history === "string") {
    try {
      history = JSON.parse(history) as unknown;
    } catch {
      throw new NativeSubmitOfferError(
        "system conversation_history is not valid JSON.",
        422,
      );
    }
  }
  if (Array.isArray(history)) return history;
  const document = jsonRecord(history);
  return Array.isArray(document.entries) ? document.entries : [];
}

function latestUserMessage(value: NormalizedRequest["conversationHistory"]) {
  const latest = historyEntries(value)
    .toReversed()
    .find((entry) => {
      const row = jsonRecord(entry);
      return row.role === "user" && typeof row.message === "string";
    });
  const message = jsonRecord(latest).message;
  if (typeof message !== "string" || !message.trim())
    throw new NativeSubmitOfferError(
      "system conversation_history has no finalized user message.",
      422,
    );
  return message.trim();
}

function rejectDerivedOutputs(
  config: UseCaseConfig,
  offer: Record<string, unknown>,
) {
  const supplied = config.offer.normalizers
    .map((normalizer) => normalizer.output)
    .filter((path) => hasPointer(offer, path));
  if (supplied.length)
    throw new NativeSubmitOfferError(
      `Derived offer fields must not be supplied: ${supplied.join(", ")}.`,
      422,
    );
}

function numberAt(document: Record<string, unknown>, path: string[]) {
  let current: unknown = document;
  for (const key of path) current = jsonRecord(current)[key];
  return typeof current === "number" ? current : null;
}

function rejectionResult(
  reduced: ReturnType<typeof reduceOfferDocument>,
  validationMessage?: string,
) {
  return {
    accepted: false,
    comparabilityStatus: reduced.comparabilityStatus,
    missingRequiredPaths: reduced.missingRequiredPaths,
    clarificationNeeds: reduced.clarificationNeeds,
    validationErrors: validationMessage
      ? [{ message: validationMessage }]
      : reduced.validationErrors,
    instruction:
      "The offer was not recorded. Clarify every reported missing or invalid field, then submit the complete offer again.",
  };
}

export async function submitNativeOffer(db: PactaDatabase, input: unknown) {
  const request = normalizeRequest(input);
  const userMessage = latestUserMessage(request.conversationHistory);

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as PactaDatabase;
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.provider, PROVIDER),
          eq(
            conversations.providerConversationId,
            request.providerConversationId,
          ),
          eq(conversations.purposeKey, "supplier_negotiation"),
        ),
      )
      .for("update");
    if (!conversation?.negotiationId)
      throw new NativeSubmitOfferError(
        "No supplier negotiation matches this ElevenLabs conversation.",
        404,
      );
    if (["ended", "failed"].includes(conversation.status))
      throw new NativeSubmitOfferError(
        "The supplier conversation is already terminal.",
        409,
      );

    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, conversation.sessionId))
      .for("update");
    if (!session)
      throw new NativeSubmitOfferError(
        "The sourcing session was not found.",
        404,
      );
    const [configRow] = await tx
      .select({ document: useCaseConfigVersions.document })
      .from(useCaseConfigVersions)
      .where(eq(useCaseConfigVersions.id, session.useCaseConfigVersionId));
    const config = useCaseConfigSchema.parse(configRow?.document);
    rejectDerivedOutputs(config, request.offer);

    const [job] = await tx
      .select({ status: jobs.status, revision: jobRevisions.data })
      .from(jobs)
      .innerJoin(jobRevisions, eq(jobRevisions.id, jobs.confirmedRevisionId))
      .where(eq(jobs.sessionId, session.id));
    if (!job || job.status !== "confirmed")
      throw new NativeSubmitOfferError(
        "Supplier offers require a confirmed job.",
        409,
      );

    const [negotiation] = await tx
      .select()
      .from(negotiations)
      .where(eq(negotiations.id, conversation.negotiationId))
      .for("update");
    if (!negotiation)
      throw new NativeSubmitOfferError("The negotiation was not found.", 404);
    const [offer] = await tx
      .select()
      .from(offers)
      .where(eq(offers.negotiationId, negotiation.id))
      .for("update");
    if (!offer)
      throw new NativeSubmitOfferError(
        "The offer aggregate was not found.",
        404,
      );

    // Claim child records only after locking their aggregate parents. PostgreSQL
    // foreign-key checks take key-share locks; inserting first lets concurrent
    // requests each hold a child FK lock while waiting to update the same parent.
    const [claimed] = await tx
      .insert(toolInvocations)
      .values({
        workspaceId: conversation.workspaceId,
        sessionId: conversation.sessionId,
        conversationId: conversation.id,
        negotiationId: conversation.negotiationId,
        provider: PROVIDER,
        providerToolCallId: request.providerToolCallId,
        toolName: TOOL_NAME,
        status: "running",
        request: request.rawRequest,
      })
      .onConflictDoNothing()
      .returning({ id: toolInvocations.id });

    if (!claimed) {
      const [existing] = await tx
        .select()
        .from(toolInvocations)
        .where(
          and(
            eq(toolInvocations.provider, PROVIDER),
            eq(toolInvocations.providerToolCallId, request.providerToolCallId),
          ),
        )
        .for("update");
      if (!existing)
        throw new Error("Conflicting tool invocation disappeared.");
      if (stable(existing.request) !== stable(request.rawRequest))
        throw new NativeSubmitOfferError(
          "This provider tool-call ID was reused with a different request.",
          409,
        );
      if (existing.status === "succeeded" && existing.response)
        return existing.response;
      throw new NativeSubmitOfferError(
        "This provider tool call is already being processed.",
        409,
      );
    }

    const observations = Object.entries(request.offer).map(([key, value]) => ({
      path: `/${pointerPart(key)}`,
      value,
      evidenceQuote: userMessage,
    }));
    let reduced: ReturnType<typeof reduceOfferDocument>;
    try {
      reduced = reduceOfferDocument(
        config,
        jsonRecord(job.revision),
        {},
        {
          jobObservations: [],
          offerObservations: observations,
          signals: { offerIsFinal: true },
        },
      );
    } catch (error) {
      const empty = reduceOfferDocument(
        config,
        jsonRecord(job.revision),
        {},
        {
          jobObservations: [],
          offerObservations: [],
          signals: {},
        },
      );
      const result = rejectionResult(
        empty,
        error instanceof Error ? error.message : "Offer validation failed.",
      );
      await tx
        .update(toolInvocations)
        .set({
          status: "succeeded",
          response: result,
          completedAt: new Date(),
        })
        .where(eq(toolInvocations.id, claimed.id));
      return result;
    }

    if (
      !reduced.valid ||
      reduced.missingRequiredPaths.length > 0 ||
      reduced.comparabilityStatus !== "comparable"
    ) {
      const result = rejectionResult(reduced);
      await tx
        .update(toolInvocations)
        .set({
          status: "succeeded",
          response: result,
          completedAt: new Date(),
        })
        .where(eq(toolInvocations.id, claimed.id));
      return result;
    }

    const naturalIdempotencyKey = `native:submit-offer:${conversation.id}:${fingerprint(
      {
        offer: request.offer,
        evidence: userMessage,
      },
    )}`;
    const [existingEvent] = await tx
      .select()
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.workspaceId, conversation.workspaceId),
          eq(sessionEvents.idempotencyKey, naturalIdempotencyKey),
        ),
      );
    if (existingEvent) {
      const revisionId = jsonRecord(existingEvent.payload).revisionId;
      if (typeof revisionId !== "string")
        throw new Error("The replayed offer event has no revision ID.");
      const [existingRevision] = await tx
        .select()
        .from(offerRevisions)
        .where(eq(offerRevisions.id, revisionId));
      if (!existingRevision)
        throw new Error("The replayed offer revision disappeared.");
      const result = {
        accepted: true,
        created: false,
        offerRevisionId: existingRevision.id,
        revisionNumber: existingRevision.revisionNumber,
        comparabilityStatus: existingRevision.comparabilityStatus,
        normalizedOffer: existingRevision.data,
        eventSeq: existingEvent.eventSeq,
        instruction:
          "This exact offer and evidence were already recorded. Continue from the current verified negotiation state.",
      };
      await tx
        .update(toolInvocations)
        .set({ status: "succeeded", response: result, completedAt: new Date() })
        .where(eq(toolInvocations.id, claimed.id));
      return result;
    }

    const providerTurnId = `native-tool:${fingerprint({
      conversationId: conversation.id,
      offer: request.offer,
      evidence: userMessage,
    })}:user`;
    await tx
      .insert(conversationTurns)
      .values({
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        providerTurnId,
        role: "user",
        content: userMessage,
        isFinal: true,
        rawEvent: { conversationHistory: request.conversationHistory },
      })
      .onConflictDoNothing();
    const [last] = await tx
      .select({ number: offerRevisions.revisionNumber })
      .from(offerRevisions)
      .where(eq(offerRevisions.offerId, offer.id))
      .orderBy(desc(offerRevisions.revisionNumber))
      .limit(1);
    const [revision] = await tx
      .insert(offerRevisions)
      .values({
        workspaceId: conversation.workspaceId,
        offerId: offer.id,
        revisionNumber: (last?.number ?? 0) + 1,
        data: reduced.data,
        validationStatus: "valid",
        comparabilityStatus: reduced.comparabilityStatus,
        missingRequiredPaths: reduced.missingRequiredPaths,
        clarificationNeeds: reduced.clarificationNeeds,
        validationErrors: reduced.validationErrors,
        sourceConversationId: conversation.id,
        createdByToolInvocationId: claimed.id,
        capturedAt: new Date(),
      })
      .returning({
        id: offerRevisions.id,
        revisionNumber: offerRevisions.revisionNumber,
      });
    if (!revision) throw new Error("Failed to create an offer revision.");
    await tx
      .update(offers)
      .set({ currentRevisionId: revision.id, status: "comparable" })
      .where(eq(offers.id, offer.id));
    const totalMinor = numberAt(reduced.data, ["normalized", "totalMinor"]);
    if (totalMinor !== null)
      await tx.insert(leverageFacts).values({
        workspaceId: conversation.workspaceId,
        sessionId: conversation.sessionId,
        sourceNegotiationId: negotiation.id,
        sourceOfferRevisionId: revision.id,
        factKey: "verified_all_in_price",
        payload: { amountMinor: totalMinor },
        verificationStatus: "verified",
        shareability: "anonymous",
      });
    await tx
      .update(sessions)
      .set({ status: "negotiating" })
      .where(eq(sessions.id, session.id));
    await tx
      .update(conversations)
      .set({
        status: "in_progress",
        connectedAt: conversation.connectedAt ?? new Date(),
      })
      .where(eq(conversations.id, conversation.id));

    const eventPayload = {
      negotiationId: negotiation.id,
      offerId: offer.id,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      comparabilityStatus: reduced.comparabilityStatus,
      totalMinor,
      missingRequiredPaths: reduced.missingRequiredPaths,
    };
    const event = await appendSessionEventInTransaction(tx, {
      workspaceId: conversation.workspaceId,
      sessionId: conversation.sessionId,
      aggregateType: "negotiation",
      aggregateId: negotiation.id,
      eventType: "offer.revision_created",
      source: "elevenlabs_native_tool",
      idempotencyKey: naturalIdempotencyKey,
      payload: eventPayload,
    });
    const result = {
      accepted: true,
      created: true,
      offerRevisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      comparabilityStatus: reduced.comparabilityStatus,
      normalizedOffer: reduced.data,
      eventSeq: event.eventSeq,
      instruction:
        "The complete comparable offer is recorded. Use only verified state returned by Pacta for any competing-offer claim.",
    };
    await tx
      .update(toolInvocations)
      .set({ status: "succeeded", response: result, completedAt: new Date() })
      .where(eq(toolInvocations.id, claimed.id));
    return result;
  });
}
