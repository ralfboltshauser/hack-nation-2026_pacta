import "server-only";

import {
  appendSessionEventInTransaction,
  awards,
  comparisonRunOffers,
  comparisonRuns,
  conversations,
  customerDecisions,
  negotiations,
  offerRevisions,
  offers,
  sessionSuppliers,
  sessions,
  type PactaDatabase,
} from "@pacta/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  comparisonState,
  loadComparableOffers,
  loadConfirmedJob,
  loadLatestAward,
  loadNativeConversationContext,
} from "./state";

const historySchema = z
  .object({
    entries: z.array(z.unknown()),
  })
  .passthrough();

function latestUserMessage(serializedHistory: string) {
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
      return { role: "user", message: record.message };
  }
  return null;
}

export const selectOfferBodySchema = z
  .object({
    conversation_id: z.string().min(1),
    conversation_history: z.string().min(1),
    action: z.enum(["select", "decline_all"]),
    selected_offer_revision_id: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === "select" && !value.selected_offer_revision_id)
      context.addIssue({
        code: "custom",
        path: ["selected_offer_revision_id"],
        message: "A selection requires an offer revision ID.",
      });
    if (value.action === "decline_all" && value.selected_offer_revision_id)
      context.addIssue({
        code: "custom",
        path: ["selected_offer_revision_id"],
        message: "Declining all offers cannot include a selected offer.",
      });
  });

export async function selectOffer(db: PactaDatabase, rawBody: unknown) {
  const body = selectOfferBodySchema.parse(rawBody);
  const latestUser = latestUserMessage(body.conversation_history);
  if (!latestUser)
    return {
      accepted: false as const,
      reason: "explicit_customer_choice_required",
      nextAction:
        "Ask the customer to explicitly select one exact offer or decline all offers.",
    };
  const context = await loadNativeConversationContext(
    db,
    body.conversation_id,
  );
  if (context.conversation.purposeKey !== "customer_intake")
    throw new Error("Only the customer conversation can select an offer.");

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as PactaDatabase;
    const [lockedSession] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, context.session.id))
      .for("update");
    if (!lockedSession) throw new Error("Session disappeared.");
    const [lockedConversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, context.conversation.id))
      .for("update");
    if (!lockedConversation || lockedConversation.endedAt)
      throw new Error("Customer conversation is terminal.");

    const [existingDecision] = await tx
      .select()
      .from(customerDecisions)
      .where(eq(customerDecisions.sessionId, lockedSession.id))
      .orderBy(desc(customerDecisions.createdAt))
      .limit(1);
    const requestedId = body.selected_offer_revision_id ?? null;
    const requestedAction = body.action === "select" ? "selected" : "declined_all";
    if (existingDecision) {
      if (
        existingDecision.action === requestedAction &&
        existingDecision.selectedOfferRevisionId === requestedId
      ) {
        const existingAward = await loadLatestAward(tx, lockedSession.id);
        return {
          accepted: true as const,
          created: false,
          action: requestedAction,
          selectedOfferRevisionId: requestedId,
          awardStatus: existingAward?.status ?? null,
          nextAction:
            requestedAction === "selected"
              ? "The same customer selection is already recorded. Wait for supplier commitment."
              : "The customer already declined all offers. Close the session truthfully.",
        };
      }
      return {
        accepted: false as const,
        reason: "customer_choice_already_recorded",
        nextAction:
          "A different customer decision already exists. Stop and use an explicit correction flow.",
      };
    }

    const [job, comparable] = await Promise.all([
      loadConfirmedJob(tx, lockedSession.id),
      loadComparableOffers(tx, lockedSession.id),
    ]);
    if (!job.confirmed)
      throw new Error("Offers cannot be selected before job confirmation.");
    if (!comparable.length)
      return {
        accepted: false as const,
        reason: "no_comparable_offers",
        nextAction: "Continue supplier negotiations; no offer can be selected yet.",
      };
    const selected = requestedId
      ? comparable.find((offer) => offer.offerRevisionId === requestedId)
      : null;
    if (requestedId && !selected)
      return {
        accepted: false as const,
        reason: "offer_not_current_or_comparable",
        nextAction:
          "Present the current comparable offers again and ask for one exact choice.",
      };

    const comparison = comparisonState(context.config, job.data, comparable);
    const [run] = await tx
      .insert(comparisonRuns)
      .values({
        workspaceId: lockedSession.workspaceId,
        sessionId: lockedSession.id,
        useCaseConfigVersionId: lockedSession.useCaseConfigVersionId,
        algorithmKey: "configured_lexicographic",
        algorithmVersion: "1",
        result: comparison,
        recommendedOfferRevisionId: comparison.recommendedOfferRevisionId,
      })
      .returning({ id: comparisonRuns.id });
    if (!run) throw new Error("Could not freeze the offer comparison.");
    await tx.insert(comparisonRunOffers).values(
      comparable.map((offer, inputOrdinal) => ({
        comparisonRunId: run.id,
        offerRevisionId: offer.offerRevisionId,
        inputOrdinal,
      })),
    );
    await tx.insert(customerDecisions).values({
      workspaceId: lockedSession.workspaceId,
      sessionId: lockedSession.id,
      comparisonRunId: run.id,
      action: requestedAction,
      selectedOfferRevisionId: selected?.offerRevisionId,
      reason: { explicitStatement: latestUser.message },
      sourceConversationId: lockedConversation.id,
    });
    let awardId: string | null = null;
    if (selected) {
      const [award] = await tx
        .insert(awards)
        .values({
          workspaceId: lockedSession.workspaceId,
          sessionId: lockedSession.id,
          selectedOfferRevisionId: selected.offerRevisionId,
          supplierPartyId: selected.supplierId,
          status: "pending_commitment",
          agreedTerms: selected.data,
        })
        .returning({ id: awards.id });
      if (!award) throw new Error("Could not create the pending award.");
      awardId = award.id;
    }
    await tx
      .update(sessions)
      .set({
        status: selected ? "committing" : "closing",
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, lockedSession.id));
    await appendSessionEventInTransaction(tx, {
      workspaceId: lockedSession.workspaceId,
      sessionId: lockedSession.id,
      aggregateType: "session",
      aggregateId: lockedSession.id,
      eventType: "customer.decision_recorded",
      source: "elevenlabs_native_tool",
      idempotencyKey: `customer-decision:${lockedSession.id}`,
      payload: {
        action: requestedAction,
        comparisonRunId: run.id,
        recommendedOfferRevisionId: comparison.recommendedOfferRevisionId,
        selectedOfferRevisionId: selected?.offerRevisionId ?? null,
        selectedNegotiationId: selected?.negotiationId ?? null,
      },
    });
    return {
      accepted: true as const,
      created: true,
      action: requestedAction,
      selectedOfferRevisionId: selected?.offerRevisionId ?? null,
      awardId,
      awardStatus: selected ? "pending_commitment" : null,
      nextAction: selected
        ? "Tell the customer their choice is recorded but not committed yet. Wait while the selected supplier confirms the exact terms."
        : "Confirm that no supplier was selected and close the remaining calls.",
    };
  });
}

export const commitSelectedOfferBodySchema = z
  .object({
    conversation_id: z.string().min(1),
    conversation_history: z.string().min(1),
  })
  .strict();

export async function commitSelectedOffer(
  db: PactaDatabase,
  rawBody: unknown,
) {
  const body = commitSelectedOfferBodySchema.parse(rawBody);
  const latestUser = latestUserMessage(body.conversation_history);
  if (!latestUser)
    return {
      accepted: false as const,
      reason: "explicit_supplier_commitment_required",
      nextAction:
        "Read back the exact selected terms and ask the supplier for explicit commitment.",
    };
  const context = await loadNativeConversationContext(
    db,
    body.conversation_id,
  );
  const negotiationId = context.conversation.negotiationId;
  if (
    context.conversation.purposeKey !== "supplier_negotiation" ||
    !negotiationId
  )
    throw new Error("Only the selected supplier conversation can commit.");

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as PactaDatabase;
    const [lockedSession] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, context.session.id))
      .for("update");
    if (!lockedSession) throw new Error("Session disappeared.");
    const [awardRow] = await tx
      .select({ award: awards, offer: offers })
      .from(awards)
      .innerJoin(
        offerRevisions,
        eq(offerRevisions.id, awards.selectedOfferRevisionId),
      )
      .innerJoin(offers, eq(offers.id, offerRevisions.offerId))
      .where(
        and(
          eq(awards.sessionId, lockedSession.id),
          eq(offers.negotiationId, negotiationId),
        ),
      )
      .for("update");
    if (!awardRow)
      return {
        accepted: false as const,
        reason: "supplier_not_selected",
        nextAction:
          "Do not claim commitment. This supplier does not match the pending selected offer.",
      };
    if (awardRow.award.status === "confirmed")
      return {
        accepted: true as const,
        created: false,
        awardId: awardRow.award.id,
        selectedOfferRevisionId: awardRow.award.selectedOfferRevisionId,
        nextAction: "The same commitment is already recorded. Thank the supplier and close the call.",
      };
    if (awardRow.award.status !== "pending_commitment")
      throw new Error(`Award cannot commit from ${awardRow.award.status}.`);

    await tx
      .update(awards)
      .set({
        status: "confirmed",
        committedAt: new Date(),
        commitmentConversationId: context.conversation.id,
      })
      .where(eq(awards.id, awardRow.award.id));
    await tx
      .update(negotiations)
      .set({
        phaseKey: "closed",
        outcomeKey: "selected_confirmed",
        closedAt: new Date(),
      })
      .where(eq(negotiations.id, negotiationId));
    await tx
      .update(sessions)
      .set({ status: "closing", updatedAt: new Date() })
      .where(eq(sessions.id, lockedSession.id));
    await appendSessionEventInTransaction(tx, {
      workspaceId: lockedSession.workspaceId,
      sessionId: lockedSession.id,
      aggregateType: "award",
      aggregateId: awardRow.award.id,
      eventType: "award.confirmed",
      source: "elevenlabs_native_tool",
      idempotencyKey: `award:${awardRow.award.id}:confirmed`,
      payload: {
        awardId: awardRow.award.id,
        selectedOfferRevisionId: awardRow.award.selectedOfferRevisionId,
        supplierPartyId: awardRow.award.supplierPartyId,
        commitmentStatement: latestUser.message,
      },
    });
    return {
      accepted: true as const,
      created: true,
      awardId: awardRow.award.id,
      selectedOfferRevisionId: awardRow.award.selectedOfferRevisionId,
      nextAction:
        "Commitment is recorded. Thank the supplier and close the call; the customer and non-selected suppliers will now be updated.",
    };
  });
}

export const recordSupplierOutcomeBodySchema = z
  .object({
    conversation_id: z.string().min(1),
    outcome: z.enum([
      "declined",
      "no_answer",
      "callback_requested",
      "not_selected_notified",
    ]),
    detail: z.string().max(500).optional(),
  })
  .strict();

export async function recordSupplierOutcome(
  db: PactaDatabase,
  rawBody: unknown,
) {
  const body = recordSupplierOutcomeBodySchema.parse(rawBody);
  const context = await loadNativeConversationContext(
    db,
    body.conversation_id,
  );
  const negotiationId = context.conversation.negotiationId;
  if (
    context.conversation.purposeKey !== "supplier_negotiation" ||
    !negotiationId
  )
    throw new Error("Only a supplier negotiation can record this outcome.");

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as PactaDatabase;
    const [lockedSession] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, context.session.id))
      .for("update");
    if (!lockedSession) throw new Error("Session disappeared.");
    const [negotiationRow] = await tx
      .select({
        negotiation: negotiations,
        sessionSupplier: sessionSuppliers,
      })
      .from(negotiations)
      .innerJoin(
        sessionSuppliers,
        eq(sessionSuppliers.id, negotiations.sessionSupplierId),
      )
      .where(eq(negotiations.id, negotiationId))
      .for("update");
    if (!negotiationRow) throw new Error("Negotiation disappeared.");
    if (negotiationRow.negotiation.outcomeKey === body.outcome)
      return {
        accepted: true as const,
        created: false,
        outcome: body.outcome,
        nextAction: "The same supplier outcome is already recorded. Close the call.",
      };

    if (body.outcome === "not_selected_notified") {
      const award = await loadLatestAward(tx, lockedSession.id);
      if (!award || award.status !== "confirmed")
        return {
          accepted: false as const,
          reason: "winner_not_committed",
          nextAction:
            "Do not reject this supplier until the selected supplier has committed.",
        };
      if (award.supplierPartyId === negotiationRow.sessionSupplier.supplierPartyId)
        return {
          accepted: false as const,
          reason: "selected_supplier_cannot_be_rejected",
          nextAction: "This is the selected supplier. Do not send a non-selection notice.",
        };
    }

    await tx
      .update(negotiations)
      .set({
        phaseKey: "closed",
        outcomeKey: body.outcome,
        closedAt: new Date(),
        data: body.detail ? { detail: body.detail } : {},
      })
      .where(eq(negotiations.id, negotiationRow.negotiation.id));
    await tx
      .update(sessionSuppliers)
      .set({
        status: body.outcome,
        dispositionReason: body.detail ?? body.outcome,
        closeoutStatus:
          body.outcome === "not_selected_notified" ? "completed" : "not_required",
      })
      .where(eq(sessionSuppliers.id, negotiationRow.sessionSupplier.id));
    const eventType =
      body.outcome === "not_selected_notified"
        ? "supplier.closeout_completed"
        : "supplier.outcome_recorded";
    await appendSessionEventInTransaction(tx, {
      workspaceId: lockedSession.workspaceId,
      sessionId: lockedSession.id,
      aggregateType: "negotiation",
      aggregateId: negotiationRow.negotiation.id,
      eventType,
      source: "elevenlabs_native_tool",
      idempotencyKey: `negotiation:${negotiationRow.negotiation.id}:outcome:${body.outcome}`,
      payload: { outcome: body.outcome, detail: body.detail ?? null },
    });
    return {
      accepted: true as const,
      created: true,
      outcome: body.outcome,
      nextAction: "The supplier outcome is recorded. Close the call politely.",
    };
  });
}
