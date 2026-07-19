import { createHash } from "node:crypto";

import {
  compareOffers,
  reduceJobDocument,
  reduceOfferDocument,
  type TurnReduction,
} from "@pacta/core";
import {
  appendSessionEventInTransaction,
  awards,
  comparisonRunOffers,
  comparisonRuns,
  conversationTurnExecutions,
  conversationTurns,
  conversations,
  contextInjections,
  customerDecisions,
  createDatabase,
  evidence,
  jobRevisionEvidence,
  jobs,
  jobConfirmations,
  jobRevisions,
  leverageFacts,
  negotiations,
  offerRevisions,
  offerRevisionEvidence,
  offers,
  parties,
  sessionSuppliers,
  sessionEvents,
  sessions,
  useCaseConfigVersions,
  type PactaDatabase,
} from "@pacta/db";
import type { ChatCompletionRequest, PactaExtraBody } from "@pacta/elevenlabs";
import {
  useCaseConfigSchema,
  type UseCaseConfig,
} from "@pacta/use-case-config";
import { and, desc, eq, gt } from "drizzle-orm";

import {
  brainOutputSchema,
  type BrainOutput,
  type BrainSnapshot,
} from "./model";

export class BrainAuthenticationError extends Error {}
export class BrainTurnInProgressError extends Error {}

export type BegunBrainTurn = {
  executionId: string;
  workspaceId: string;
  sessionId: string;
  conversationId: string;
  negotiationId: string | null;
  userTurnId: string | null;
  replayText: string | null;
  replayOutput: BrainOutput | null;
  snapshot: BrainSnapshot;
};

export type BrainTurnEvidenceSource = { artifactId: string; filename: string };

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(value: string) {
  const bytes = Buffer.from(hash(value).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function beginBrainTurn(
  db: PactaDatabase,
  request: ChatCompletionRequest,
  inputFingerprint: string,
): Promise<BegunBrainTurn> {
  const extra = request.elevenlabs_extra_body;
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as PactaDatabase;
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, extra.conversation_id),
          eq(conversations.workspaceId, extra.workspace_id),
          eq(conversations.sessionId, extra.session_id),
          eq(conversations.brainTokenHash, hash(extra.brain_token)),
          gt(conversations.brainTokenExpiresAt, new Date()),
        ),
      )
      .for("update");
    if (
      !conversation ||
      conversation.purposeKey !== extra.purpose ||
      conversation.negotiationId !== (extra.negotiation_id ?? null)
    ) {
      throw new BrainAuthenticationError(
        "Conversation context or brain token is invalid.",
      );
    }
    if (!["connected", "in_progress"].includes(conversation.status)) {
      await tx
        .update(conversations)
        .set({
          status: "in_progress",
          connectedAt: conversation.connectedAt ?? new Date(),
        })
        .where(eq(conversations.id, conversation.id));
      await appendSessionEventInTransaction(tx, {
        workspaceId: conversation.workspaceId,
        sessionId: conversation.sessionId,
        aggregateType: "conversation",
        aggregateId: conversation.id,
        eventType: "conversation.connected",
        source: "custom_llm",
        idempotencyKey: `conversation:${conversation.id}:connected`,
        payload: {
          purpose: conversation.purposeKey,
          partyId: conversation.partyId,
        },
      });
    }

    return claimBrainTurn(tx, {
      conversation,
      context: extra,
      messages: request.messages,
      inputFingerprint,
      provider: "elevenlabs",
      canonicalizationVersion: "elevenlabs-chat-completions.v1",
    });
  });
}

export async function beginAuthorizedBrainTurn(
  db: PactaDatabase,
  input: {
    context: Omit<PactaExtraBody, "brain_token">;
    messages: ChatCompletionRequest["messages"];
    inputFingerprint: string;
    provider: string;
    canonicalizationVersion: string;
    providerTurnKey?: string;
  },
): Promise<BegunBrainTurn> {
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as PactaDatabase;
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.context.conversation_id),
          eq(conversations.workspaceId, input.context.workspace_id),
          eq(conversations.sessionId, input.context.session_id),
        ),
      )
      .for("update");
    if (
      !conversation ||
      conversation.purposeKey !== input.context.purpose ||
      conversation.negotiationId !== (input.context.negotiation_id ?? null)
    ) {
      throw new BrainAuthenticationError(
        "Authorized conversation context is invalid.",
      );
    }
    return claimBrainTurn(tx, { conversation, ...input });
  });
}

async function claimBrainTurn(
  tx: PactaDatabase,
  input: {
    conversation: typeof conversations.$inferSelect;
    context: PactaExtraBody | Omit<PactaExtraBody, "brain_token">;
    messages: ChatCompletionRequest["messages"];
    inputFingerprint: string;
    provider: string;
    canonicalizationVersion: string;
    providerTurnKey?: string;
  },
): Promise<BegunBrainTurn> {
  const { conversation } = input;

  const [existing] = await tx
    .select()
    .from(conversationTurnExecutions)
    .where(
      and(
        eq(conversationTurnExecutions.conversationId, conversation.id),
        eq(conversationTurnExecutions.provider, input.provider),
        input.providerTurnKey
          ? eq(
              conversationTurnExecutions.providerTurnKey,
              input.providerTurnKey,
            )
          : eq(
              conversationTurnExecutions.inputFingerprint,
              input.inputFingerprint,
            ),
      ),
    );
  if (existing && existing.inputFingerprint !== input.inputFingerprint) {
    throw new BrainTurnInProgressError(
      "This turn ID was already used for different content.",
    );
  }
  if (existing?.status === "completed" && existing.responseText) {
    const replayOutput = brainOutputSchema.safeParse(existing.responseEnvelope);
    return loadSnapshot(
      tx,
      input.context,
      existing.id,
      existing.responseText,
      false,
      existing.newUserTurnId,
      replayOutput.success ? replayOutput.data : null,
    );
  }
  if (existing) {
    const reclaimable =
      existing.status === "failed" ||
      existing.status === "aborted" ||
      (existing.status === "running" &&
        existing.leaseExpiresAt &&
        existing.leaseExpiresAt <= new Date());
    if (!reclaimable)
      throw new BrainTurnInProgressError(
        "This provider turn is already being processed.",
      );
    await tx
      .update(conversationTurnExecutions)
      .set({
        status: "running",
        attemptCount: existing.attemptCount + 1,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        abortReason: null,
        completedAt: null,
      })
      .where(eq(conversationTurnExecutions.id, existing.id));
    return loadSnapshot(
      tx,
      input.context,
      existing.id,
      null,
      true,
      existing.newUserTurnId,
    );
  }

  const [execution] = await tx
    .insert(conversationTurnExecutions)
    .values({
      workspaceId: conversation.workspaceId,
      sessionId: conversation.sessionId,
      conversationId: conversation.id,
      provider: input.provider,
      providerTurnKey: input.providerTurnKey,
      inputFingerprint: input.inputFingerprint,
      canonicalizationVersion: input.canonicalizationVersion,
      logicalUserTurnKey: `${input.provider}:${input.providerTurnKey ?? input.inputFingerprint}`,
      reducesUserTurn: input.messages.at(-1)?.role === "user",
      status: "running",
      attemptCount: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      conversationSnapshot: { messages: input.messages },
      reducerVersion: "pacta.reducer.v1",
    })
    .returning({ id: conversationTurnExecutions.id });
  if (!execution) throw new Error("Failed to create a turn execution.");

  const last = input.messages.at(-1);
  let userTurnId: string | null = null;
  if (last?.role === "user") {
    const [turn] = await tx
      .insert(conversationTurns)
      .values({
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        providerTurnId: `input:${input.provider}:${input.inputFingerprint}`,
        ordinal: input.messages.length - 1,
        role: "user",
        content: last.content,
        isFinal: true,
      })
      .returning({ id: conversationTurns.id });
    await tx
      .update(conversationTurnExecutions)
      .set({ newUserTurnId: turn?.id })
      .where(eq(conversationTurnExecutions.id, execution.id));
    userTurnId = turn?.id ?? null;
  }
  return loadSnapshot(tx, input.context, execution.id, null, true, userTurnId);
}

async function loadSnapshot(
  db: PactaDatabase,
  extra: PactaExtraBody | Omit<PactaExtraBody, "brain_token">,
  executionId: string,
  replayText: string | null,
  consumeInjections = true,
  userTurnId: string | null = null,
  replayOutput: BrainOutput | null = null,
): Promise<BegunBrainTurn> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, extra.session_id));
  if (!session)
    throw new Error("Session disappeared while loading turn context.");
  const [configRow] = await db
    .select()
    .from(useCaseConfigVersions)
    .where(eq(useCaseConfigVersions.id, session.useCaseConfigVersionId));
  const config = useCaseConfigSchema.parse(
    configRow?.document,
  ) as UseCaseConfig;

  let job: Record<string, unknown> = {};
  const [jobRow] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.sessionId, session.id));
  if (jobRow?.currentRevisionId) {
    const [revision] = await db
      .select()
      .from(jobRevisions)
      .where(eq(jobRevisions.id, jobRow.currentRevisionId));
    job = jsonRecord(revision?.data);
  }

  let offer: Record<string, unknown> = {};
  let negotiation: Record<string, unknown> = {};
  if (extra.negotiation_id) {
    const [negotiationRow] = await db
      .select()
      .from(negotiations)
      .where(eq(negotiations.id, extra.negotiation_id));
    negotiation = negotiationRow
      ? {
          phaseKey: negotiationRow.phaseKey,
          outcomeKey: negotiationRow.outcomeKey,
          ...jsonRecord(negotiationRow.data),
        }
      : {};
    const [offerRow] = await db
      .select()
      .from(offers)
      .where(eq(offers.negotiationId, extra.negotiation_id));
    if (offerRow?.currentRevisionId) {
      const [revision] = await db
        .select()
        .from(offerRevisions)
        .where(eq(offerRevisions.id, offerRow.currentRevisionId));
      offer = jsonRecord(revision?.data);
    }
  }

  const events = await db
    .select({
      eventSeq: sessionEvents.eventSeq,
      eventType: sessionEvents.eventType,
      aggregateId: sessionEvents.aggregateId,
      payload: sessionEvents.payload,
    })
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, session.id))
    .orderBy(desc(sessionEvents.eventSeq))
    .limit(24);

  const visibleEvents =
    extra.purpose === "customer_intake"
      ? events
      : events.filter(
          (event) =>
            event.aggregateId === extra.negotiation_id ||
            event.aggregateId === extra.conversation_id,
        );
  const pendingInjections = consumeInjections
    ? await db
        .select({
          injection: contextInjections,
          eventSeq: sessionEvents.eventSeq,
          eventType: sessionEvents.eventType,
        })
        .from(contextInjections)
        .innerJoin(
          sessionEvents,
          eq(sessionEvents.id, contextInjections.sourceEventId),
        )
        .where(
          and(
            eq(contextInjections.targetConversationId, extra.conversation_id),
            eq(contextInjections.status, "pending"),
          ),
        )
    : [];
  if (consumeInjections && pendingInjections.length) {
    await db
      .update(contextInjections)
      .set({
        status: "delivered",
        includedInExecutionId: executionId,
        deliveredAt: new Date(),
      })
      .where(
        and(
          eq(contextInjections.targetConversationId, extra.conversation_id),
          eq(contextInjections.status, "pending"),
        ),
      );
  }

  return {
    executionId,
    workspaceId: session.workspaceId,
    sessionId: session.id,
    conversationId: extra.conversation_id,
    negotiationId: extra.negotiation_id ?? null,
    userTurnId,
    replayText,
    replayOutput,
    snapshot: {
      purpose: extra.purpose,
      config,
      job,
      offer,
      negotiation,
      materialContext: [
        ...visibleEvents.reverse().map((event) => ({
          eventSeq: event.eventSeq,
          eventType: event.eventType,
          payload: jsonRecord(event.payload),
        })),
        ...pendingInjections.map((row) => ({
          eventSeq: row.eventSeq,
          eventType: `injected.${row.eventType}`,
          payload: jsonRecord(row.injection.payload),
        })),
      ].sort((left, right) => left.eventSeq - right.eventSeq),
    },
  };
}

function numberAt(document: Record<string, unknown>, path: string[]) {
  let current: unknown = document;
  for (const key of path) current = jsonRecord(current)[key];
  return typeof current === "number" ? current : null;
}

export async function completeBrainTurn(
  db: PactaDatabase,
  begun: BegunBrainTurn,
  output: BrainOutput,
  options: { sourceArtifact?: BrainTurnEvidenceSource } = {},
) {
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as PactaDatabase;
    const [execution] = await tx
      .select()
      .from(conversationTurnExecutions)
      .where(eq(conversationTurnExecutions.id, begun.executionId))
      .for("update");
    if (execution?.status === "completed" && execution.responseText)
      return execution.responseText;
    if (!execution || execution.status !== "running")
      throw new Error("Turn execution is not completable.");

    let eventType = "conversation.turn_reduced";
    let eventPayload: Record<string, unknown> = {
      purpose: begun.snapshot.purpose,
    };
    const signals = output.reduction.signals;
    const isCustomerDecision = Boolean(
      signals.selectedOfferRevisionId || signals.customerDeclinedAll,
    );
    const changesJob =
      output.reduction.jobObservations.length > 0 ||
      signals.jobConfirmed ||
      signals.jobCorrectionRequested;
    const changesOffer =
      output.reduction.offerObservations.length > 0 ||
      signals.supplierDeclined ||
      signals.callbackRequested ||
      signals.offerIsFinal;
    if (begun.snapshot.purpose === "customer_intake" && isCustomerDecision) {
      eventPayload = await applyCustomerDecision(tx, begun, output.reduction);
      eventType = "customer.decision_recorded";
    } else if (begun.snapshot.purpose === "customer_intake" && changesJob) {
      eventPayload = await applyJobReduction(tx, begun, output.reduction);
      eventType = "job.revision_created";
    } else if (begun.negotiationId && signals.supplierAcceptedExactTerms) {
      eventPayload = await applySupplierAcceptance(tx, begun);
      eventType = "award.confirmed";
    } else if (begun.negotiationId && changesOffer) {
      eventPayload = await applyOfferReduction(tx, begun, output.reduction);
      eventType = "offer.revision_created";
    }

    await persistReductionEvidence(
      tx,
      begun,
      output.reduction,
      eventType,
      eventPayload,
      options.sourceArtifact,
    );

    const event = await appendSessionEventInTransaction(tx, {
      workspaceId: begun.workspaceId,
      sessionId: begun.sessionId,
      aggregateType: begun.negotiationId ? "negotiation" : "conversation",
      aggregateId: begun.negotiationId ?? begun.conversationId,
      eventType,
      source: "custom_llm",
      idempotencyKey: `turn:${begun.executionId}`,
      payload: eventPayload,
    });
    if (
      eventType === "offer.revision_created" &&
      eventPayload.comparabilityStatus === "comparable"
    ) {
      const targets = await tx
        .select({
          id: conversations.id,
          negotiationId: conversations.negotiationId,
        })
        .from(conversations)
        .where(eq(conversations.sessionId, begun.sessionId));
      const payload = {
        factKey: "verified_all_in_price",
        amountMinor: eventPayload.totalMinor,
        instruction:
          "A verified anonymous comparable offer is available. Use it only if the configured negotiation phase allows this lever.",
      };
      const values = targets
        .filter((target) => target.id !== begun.conversationId)
        .map((target) => ({
          workspaceId: begun.workspaceId,
          sessionId: begun.sessionId,
          targetConversationId: target.id,
          targetNegotiationId: target.negotiationId,
          sourceEventId: event.id,
          channel: "custom_llm_next_turn",
          payload,
          status: "pending",
        }));
      if (values.length) await tx.insert(contextInjections).values(values);
    }
    if (
      eventType === "customer.decision_recorded" &&
      typeof eventPayload.selectedNegotiationId === "string"
    ) {
      const [target] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.sessionId, begun.sessionId),
            eq(conversations.negotiationId, eventPayload.selectedNegotiationId),
            eq(conversations.purposeKey, "supplier_negotiation"),
          ),
        );
      if (target) {
        await tx.insert(contextInjections).values({
          workspaceId: begun.workspaceId,
          sessionId: begun.sessionId,
          targetConversationId: target.id,
          targetNegotiationId: eventPayload.selectedNegotiationId,
          sourceEventId: event.id,
          channel: "custom_llm_next_turn",
          payload: {
            selectedOfferRevisionId: eventPayload.selectedOfferRevisionId,
            instruction:
              "The customer selected this exact offer. Read back the exact stored terms and ask for explicit supplier acceptance. Do not treat selection alone as commitment.",
          },
          status: "pending",
        });
      }
    }
    if (eventType === "award.confirmed") {
      const targets = await tx
        .select({
          id: conversations.id,
          negotiationId: conversations.negotiationId,
        })
        .from(conversations)
        .where(eq(conversations.sessionId, begun.sessionId));
      const values = targets
        .filter((target) => target.id !== begun.conversationId)
        .map((target) => ({
          workspaceId: begun.workspaceId,
          sessionId: begun.sessionId,
          targetConversationId: target.id,
          targetNegotiationId: target.negotiationId,
          sourceEventId: event.id,
          channel: "custom_llm_next_turn",
          payload: target.negotiationId
            ? {
                instruction:
                  "The winner has confirmed. If this is not the winning negotiation, truthfully notify the supplier they were not selected and end the call.",
              }
            : {
                instruction:
                  "The selected supplier explicitly confirmed the exact terms. Tell the customer the booking is confirmed.",
              },
          status: "pending",
        }));
      if (values.length) await tx.insert(contextInjections).values(values);
    }
    const [assistantTurn] = await tx
      .insert(conversationTurns)
      .values({
        workspaceId: begun.workspaceId,
        conversationId: begun.conversationId,
        providerTurnId: `output:${execution.provider}:${execution.inputFingerprint}`,
        ordinal: null,
        role: "assistant",
        content: output.spokenResponse,
        isFinal: true,
      })
      .returning({ id: conversationTurns.id });
    await tx
      .update(conversationTurnExecutions)
      .set({
        status: "completed",
        responseText: output.spokenResponse,
        responseEnvelope: output,
        reducerOutput: output.reduction,
        contextEventSeq: event.eventSeq,
        completedAt: new Date(),
        leaseExpiresAt: null,
        timings: { assistantTurnId: assistantTurn?.id },
      })
      .where(eq(conversationTurnExecutions.id, begun.executionId));
    return output.spokenResponse;
  });
}

async function persistReductionEvidence(
  db: PactaDatabase,
  begun: BegunBrainTurn,
  reduction: TurnReduction,
  eventType: string,
  eventPayload: Record<string, unknown>,
  sourceArtifact?: BrainTurnEvidenceSource,
) {
  const observations =
    eventType === "job.revision_created"
      ? reduction.jobObservations
      : eventType === "offer.revision_created"
        ? reduction.offerObservations
        : [];
  const revisionId =
    typeof eventPayload.revisionId === "string"
      ? eventPayload.revisionId
      : null;
  if (!observations.length || !revisionId) return;

  for (const [index, observation] of observations.entries()) {
    const attachmentEvidence =
      observation.evidenceSource === "attachment" ||
      (Boolean(sourceArtifact) && !observation.evidenceSource);
    if (attachmentEvidence && !sourceArtifact)
      throw new Error(
        `Reducer attributed ${observation.path} to a missing attachment.`,
      );
    if (!attachmentEvidence && !begun.userTurnId)
      throw new Error(
        `Reducer emitted ${observation.path} without a human turn source.`,
      );
    const evidenceId = deterministicUuid(
      `${begun.executionId}:${index}:${observation.path}:${attachmentEvidence ? "attachment" : "human_turn"}`,
    );
    await db
      .insert(evidence)
      .values({
        id: evidenceId,
        workspaceId: begun.workspaceId,
        sessionId: begun.sessionId,
        sourceArtifactId: attachmentEvidence
          ? sourceArtifact!.artifactId
          : null,
        sourceConversationTurnId: attachmentEvidence ? null : begun.userTurnId,
        locator: attachmentEvidence
          ? {
              kind: "document_quote",
              filename: sourceArtifact!.filename,
              jsonPointer: observation.path,
            }
          : { kind: "conversation_quote", jsonPointer: observation.path },
        excerpt: observation.evidenceQuote,
      })
      .onConflictDoNothing({ target: evidence.id });
    if (eventType === "job.revision_created") {
      await db
        .insert(jobRevisionEvidence)
        .values({
          jobRevisionId: revisionId,
          jsonPointer: observation.path,
          evidenceId,
        })
        .onConflictDoNothing();
    } else {
      await db
        .insert(offerRevisionEvidence)
        .values({
          offerRevisionId: revisionId,
          jsonPointer: observation.path,
          evidenceId,
        })
        .onConflictDoNothing();
    }
  }
}

export async function abortBrainTurn(
  db: PactaDatabase,
  begun: BegunBrainTurn,
  reason: string,
) {
  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as PactaDatabase;
    const [execution] = await tx
      .select({ status: conversationTurnExecutions.status })
      .from(conversationTurnExecutions)
      .where(eq(conversationTurnExecutions.id, begun.executionId))
      .for("update");
    if (!execution || execution.status === "completed") return;
    await tx
      .update(contextInjections)
      .set({
        status: "pending",
        includedInExecutionId: null,
        deliveredAt: null,
      })
      .where(eq(contextInjections.includedInExecutionId, begun.executionId));
    await tx
      .update(conversationTurnExecutions)
      .set({
        status: "failed",
        abortReason: reason.slice(0, 500),
        leaseExpiresAt: null,
        completedAt: new Date(),
      })
      .where(eq(conversationTurnExecutions.id, begun.executionId));
  });
}

async function applyCustomerDecision(
  db: PactaDatabase,
  begun: BegunBrainTurn,
  reduction: TurnReduction,
) {
  const comparable = await db
    .select({
      offerRevisionId: offerRevisions.id,
      negotiationId: negotiations.id,
      supplierId: parties.id,
      supplierName: parties.displayName,
      data: offerRevisions.data,
    })
    .from(offerRevisions)
    .innerJoin(offers, eq(offers.currentRevisionId, offerRevisions.id))
    .innerJoin(negotiations, eq(negotiations.id, offers.negotiationId))
    .innerJoin(
      sessionSuppliers,
      eq(sessionSuppliers.id, negotiations.sessionSupplierId),
    )
    .innerJoin(parties, eq(parties.id, sessionSuppliers.supplierPartyId))
    .where(
      and(
        eq(sessionSuppliers.sessionId, begun.sessionId),
        eq(offerRevisions.comparabilityStatus, "comparable"),
      ),
    );
  if (!comparable.length)
    throw new Error(
      "A customer decision requires at least one comparable offer.",
    );
  const comparison = compareOffers(
    begun.snapshot.config,
    begun.snapshot.job,
    comparable.map((row) => ({ ...row, data: jsonRecord(row.data) })),
  );
  const selectedId = reduction.signals.selectedOfferRevisionId;
  const selected = selectedId
    ? comparable.find((row) => row.offerRevisionId === selectedId)
    : undefined;
  if (selectedId && !selected)
    throw new Error(
      "The selected offer revision is not a current comparable offer in this session.",
    );
  const [run] = await db
    .insert(comparisonRuns)
    .values({
      workspaceId: begun.workspaceId,
      sessionId: begun.sessionId,
      useCaseConfigVersionId: (
        await db
          .select({ id: sessions.useCaseConfigVersionId })
          .from(sessions)
          .where(eq(sessions.id, begun.sessionId))
      )[0]!.id,
      algorithmKey: "configured_lexicographic",
      algorithmVersion: "1",
      result: comparison,
      recommendedOfferRevisionId: comparison.recommendedOfferRevisionId,
    })
    .returning({ id: comparisonRuns.id });
  if (!run) throw new Error("Failed to freeze comparison run.");
  await db.insert(comparisonRunOffers).values(
    comparable.map((row, index) => ({
      comparisonRunId: run.id,
      offerRevisionId: row.offerRevisionId,
      inputOrdinal: index,
    })),
  );
  const action = reduction.signals.customerDeclinedAll
    ? "declined_all"
    : "selected";
  await db.insert(customerDecisions).values({
    workspaceId: begun.workspaceId,
    sessionId: begun.sessionId,
    comparisonRunId: run.id,
    action,
    selectedOfferRevisionId: selected?.offerRevisionId,
    reason: { explicitVoiceSelection: true },
    sourceConversationId: begun.conversationId,
  });
  if (selected) {
    await db.insert(awards).values({
      workspaceId: begun.workspaceId,
      sessionId: begun.sessionId,
      selectedOfferRevisionId: selected.offerRevisionId,
      supplierPartyId: selected.supplierId,
      status: "pending_commitment",
      agreedTerms: jsonRecord(selected.data),
    });
  }
  await db
    .update(sessions)
    .set({ status: selected ? "committing" : "closing" })
    .where(eq(sessions.id, begun.sessionId));
  return {
    comparisonRunId: run.id,
    action,
    recommendedOfferRevisionId: comparison.recommendedOfferRevisionId,
    selectedOfferRevisionId: selected?.offerRevisionId ?? null,
    selectedNegotiationId: selected?.negotiationId ?? null,
    selectedNonRecommended: Boolean(
      selected &&
      selected.offerRevisionId !== comparison.recommendedOfferRevisionId,
    ),
  };
}

async function applySupplierAcceptance(
  db: PactaDatabase,
  begun: BegunBrainTurn,
) {
  const [pending] = await db
    .select({ award: awards, offer: offers })
    .from(awards)
    .innerJoin(
      offerRevisions,
      eq(offerRevisions.id, awards.selectedOfferRevisionId),
    )
    .innerJoin(offers, eq(offers.id, offerRevisions.offerId))
    .where(
      and(
        eq(awards.sessionId, begun.sessionId),
        eq(awards.status, "pending_commitment"),
        eq(offers.negotiationId, begun.negotiationId!),
      ),
    )
    .for("update");
  if (!pending)
    throw new Error(
      "Supplier acceptance does not match a pending customer-selected award.",
    );
  await db
    .update(awards)
    .set({
      status: "confirmed",
      committedAt: new Date(),
      commitmentConversationId: begun.conversationId,
    })
    .where(eq(awards.id, pending.award.id));
  await db
    .update(negotiations)
    .set({
      phaseKey: "closed",
      outcomeKey: "selected_confirmed",
      closedAt: new Date(),
    })
    .where(eq(negotiations.id, begun.negotiationId!));
  await db
    .update(sessions)
    .set({ status: "closing" })
    .where(eq(sessions.id, begun.sessionId));
  return {
    awardId: pending.award.id,
    selectedOfferRevisionId: pending.award.selectedOfferRevisionId,
    supplierPartyId: pending.award.supplierPartyId,
  };
}

async function applyJobReduction(
  db: PactaDatabase,
  begun: BegunBrainTurn,
  reduction: TurnReduction,
) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.sessionId, begun.sessionId))
    .for("update");
  if (!job) throw new Error("Customer conversation has no job aggregate.");
  const reduced = reduceJobDocument(
    begun.snapshot.config,
    begun.snapshot.job,
    reduction,
  );
  const [last] = await db
    .select({ number: jobRevisions.revisionNumber })
    .from(jobRevisions)
    .where(eq(jobRevisions.jobId, job.id))
    .orderBy(desc(jobRevisions.revisionNumber))
    .limit(1);
  const [revision] = await db
    .insert(jobRevisions)
    .values({
      workspaceId: begun.workspaceId,
      jobId: job.id,
      revisionNumber: (last?.number ?? 0) + 1,
      data: reduced.data,
      validationStatus: reduced.valid ? "valid" : "invalid",
      missingRequiredPaths: reduced.missingRequiredPaths,
      validationErrors: reduced.validationErrors,
      sourceConversationId: begun.conversationId,
      createdByTurnExecutionId: begun.executionId,
    })
    .returning({
      id: jobRevisions.id,
      revisionNumber: jobRevisions.revisionNumber,
    });
  if (!revision) throw new Error("Failed to create job revision.");
  const confirmed = reduction.signals.jobConfirmed && reduced.valid;
  await db
    .update(jobs)
    .set({
      currentRevisionId: revision.id,
      status: confirmed
        ? "confirmed"
        : reduced.valid
          ? "ready_for_confirmation"
          : "collecting",
      ...(confirmed ? { confirmedRevisionId: revision.id } : {}),
    })
    .where(eq(jobs.id, job.id));
  if (confirmed) {
    await db.insert(jobConfirmations).values({
      workspaceId: begun.workspaceId,
      sessionId: begun.sessionId,
      jobId: job.id,
      jobRevisionId: revision.id,
      action: "confirmed",
      sourceConversationId: begun.conversationId,
      statement: "Explicit confirmation detected in the source turn.",
      sourceConversationTurnId: begun.userTurnId,
      occurredAt: new Date(),
    });
    await db
      .update(sessions)
      .set({ status: "sourcing" })
      .where(eq(sessions.id, begun.sessionId));
  }
  return {
    jobId: job.id,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    valid: reduced.valid,
    confirmed,
    missingRequiredPaths: reduced.missingRequiredPaths,
  };
}

async function applyOfferReduction(
  db: PactaDatabase,
  begun: BegunBrainTurn,
  reduction: TurnReduction,
) {
  const negotiationId = begun.negotiationId!;
  const [negotiation] = await db
    .select()
    .from(negotiations)
    .where(eq(negotiations.id, negotiationId))
    .for("update");
  if (!negotiation)
    throw new Error("Supplier conversation has no negotiation aggregate.");
  const [offer] = await db
    .select()
    .from(offers)
    .where(eq(offers.negotiationId, negotiationId));
  if (!offer) throw new Error("Supplier negotiation has no offer aggregate.");
  const reduced = reduceOfferDocument(
    begun.snapshot.config,
    begun.snapshot.job,
    begun.snapshot.offer,
    reduction,
  );
  const [last] = await db
    .select({ number: offerRevisions.revisionNumber })
    .from(offerRevisions)
    .where(eq(offerRevisions.offerId, offer.id))
    .orderBy(desc(offerRevisions.revisionNumber))
    .limit(1);
  const [revision] = await db
    .insert(offerRevisions)
    .values({
      workspaceId: begun.workspaceId,
      offerId: offer.id,
      revisionNumber: (last?.number ?? 0) + 1,
      data: reduced.data,
      validationStatus: reduced.valid ? "valid" : "invalid",
      comparabilityStatus: reduced.comparabilityStatus,
      missingRequiredPaths: reduced.missingRequiredPaths,
      clarificationNeeds: reduced.clarificationNeeds,
      validationErrors: reduced.validationErrors,
      sourceConversationId: begun.conversationId,
      createdByTurnExecutionId: begun.executionId,
      capturedAt: new Date(),
    })
    .returning({
      id: offerRevisions.id,
      revisionNumber: offerRevisions.revisionNumber,
    });
  if (!revision) throw new Error("Failed to create offer revision.");
  await db
    .update(offers)
    .set({
      currentRevisionId: revision.id,
      status: reduced.comparabilityStatus,
    })
    .where(eq(offers.id, offer.id));
  if (reduced.comparabilityStatus === "comparable") {
    const totalMinor = numberAt(reduced.data, ["normalized", "totalMinor"]);
    if (totalMinor !== null) {
      await db.insert(leverageFacts).values({
        workspaceId: begun.workspaceId,
        sessionId: begun.sessionId,
        sourceNegotiationId: negotiationId,
        sourceOfferRevisionId: revision.id,
        factKey: "verified_all_in_price",
        payload: { amountMinor: totalMinor },
        verificationStatus: "verified",
        shareability: "anonymous",
      });
    }
    await db
      .update(sessions)
      .set({ status: "reviewing_offers" })
      .where(eq(sessions.id, begun.sessionId));
  } else {
    await db
      .update(sessions)
      .set({ status: "negotiating" })
      .where(eq(sessions.id, begun.sessionId));
  }
  if (reduction.signals.supplierDeclined) {
    await db
      .update(negotiations)
      .set({
        phaseKey: "closed",
        outcomeKey: "supplier_declined",
        closedAt: new Date(),
      })
      .where(eq(negotiations.id, negotiationId));
  }
  return {
    negotiationId,
    offerId: offer.id,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    comparabilityStatus: reduced.comparabilityStatus,
    totalMinor: numberAt(reduced.data, ["normalized", "totalMinor"]),
    missingRequiredPaths: reduced.missingRequiredPaths,
  };
}

export function openDatabase() {
  return createDatabase();
}
