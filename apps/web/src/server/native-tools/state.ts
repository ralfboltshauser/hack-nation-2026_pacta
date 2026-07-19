import "server-only";

import { compareOffers, type ComparableOffer } from "@pacta/core";
import {
  awards,
  conversations,
  jobRevisions,
  jobs,
  negotiations,
  offerRevisions,
  offers,
  parties,
  sessions,
  sessionSuppliers,
  useCaseConfigVersions,
  type PactaDatabase,
} from "@pacta/db";
import {
  useCaseConfigSchema,
  type UseCaseConfig,
} from "@pacta/use-case-config";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

export const nativeStateBodySchema = z
  .object({ conversation_id: z.string().min(1) })
  .strict();

export function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function loadNativeConversationContext(
  db: PactaDatabase,
  providerConversationId: string,
) {
  const [row] = await db
    .select({
      conversation: conversations,
      session: sessions,
      configDocument: useCaseConfigVersions.document,
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
      ),
    );
  if (!row) throw new Error("Unknown ElevenLabs conversation.");
  return {
    ...row,
    config: useCaseConfigSchema.parse(row.configDocument),
  };
}

export async function loadConfirmedJob(
  db: PactaDatabase,
  sessionId: string,
) {
  const [row] = await db
    .select({ job: jobs, revision: jobRevisions })
    .from(jobs)
    .leftJoin(jobRevisions, eq(jobRevisions.id, jobs.confirmedRevisionId))
    .where(eq(jobs.sessionId, sessionId));
  if (!row) throw new Error("Session has no job aggregate.");
  return {
    confirmed: Boolean(row.job.confirmedRevisionId),
    revisionId: row.job.confirmedRevisionId,
    data: jsonRecord(row.revision?.data),
  };
}

export type SessionComparableOffer = ComparableOffer & {
  negotiationId: string;
};

export async function loadComparableOffers(
  db: PactaDatabase,
  sessionId: string,
): Promise<SessionComparableOffer[]> {
  const rows = await db
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
        eq(sessionSuppliers.sessionId, sessionId),
        eq(offerRevisions.comparabilityStatus, "comparable"),
      ),
    );
  return rows.map((row) => ({ ...row, data: jsonRecord(row.data) }));
}

export async function loadLatestAward(
  db: PactaDatabase,
  sessionId: string,
) {
  const [award] = await db
    .select()
    .from(awards)
    .where(eq(awards.sessionId, sessionId))
    .orderBy(desc(awards.createdAt))
    .limit(1);
  return award ?? null;
}

export function comparisonState(
  config: UseCaseConfig,
  job: Record<string, unknown>,
  comparable: SessionComparableOffer[],
) {
  return compareOffers(config, job, comparable);
}

export async function getCustomerState(
  db: PactaDatabase,
  rawBody: unknown,
) {
  const body = nativeStateBodySchema.parse(rawBody);
  const context = await loadNativeConversationContext(
    db,
    body.conversation_id,
  );
  if (context.conversation.purposeKey !== "customer_intake")
    throw new Error("Only the customer conversation can read customer state.");
  const [job, comparable, award, supplierRows] = await Promise.all([
    loadConfirmedJob(db, context.session.id),
    loadComparableOffers(db, context.session.id),
    loadLatestAward(db, context.session.id),
    db
      .select({
        supplierId: parties.id,
        supplierName: parties.displayName,
        conversationStatus: conversations.status,
        negotiationPhase: negotiations.phaseKey,
        negotiationOutcome: negotiations.outcomeKey,
      })
      .from(sessionSuppliers)
      .innerJoin(parties, eq(parties.id, sessionSuppliers.supplierPartyId))
      .innerJoin(
        negotiations,
        eq(negotiations.sessionSupplierId, sessionSuppliers.id),
      )
      .innerJoin(
        conversations,
        eq(conversations.negotiationId, negotiations.id),
      )
      .where(eq(sessionSuppliers.sessionId, context.session.id)),
  ]);
  const comparison = job.confirmed
    ? comparisonState(context.config, job.data, comparable)
    : null;
  const sourcingReady = supplierRows.every(
    (supplier) =>
      comparable.some((offer) => offer.supplierId === supplier.supplierId) ||
      supplier.negotiationOutcome !== null ||
      ["ended", "failed", "initiation_unknown"].includes(
        supplier.conversationStatus,
      ),
  );
  const nextAction = !job.confirmed
    ? "Continue collecting and then explicitly confirm the complete job."
    : award?.status === "confirmed"
      ? "Tell the customer the selected supplier committed to the exact terms, then close the customer call."
      : award?.status === "pending_commitment"
        ? "Tell the customer their selection is being confirmed with the supplier; do not claim commitment yet."
        : sourcingReady && comparable.length
          ? "Present the verified offers and configured recommendation, then ask the customer to select one exact offer."
          : sourcingReady
            ? "All supplier attempts are terminal and no comparable offer exists. Tell the customer truthfully and ask whether to end the session."
            : "Briefly update the customer on verified progress, explain that supplier negotiations are still in progress, and continue waiting."
  return {
    sessionStatus: context.session.status,
    job,
    suppliers: supplierRows,
    sourcingReady,
    offers: comparable,
    comparison,
    award: award
      ? {
          status: award.status,
          selectedOfferRevisionId: award.selectedOfferRevisionId,
        }
      : null,
    nextAction,
  };
}

export async function getNegotiationState(
  db: PactaDatabase,
  rawBody: unknown,
) {
  const body = nativeStateBodySchema.parse(rawBody);
  const context = await loadNativeConversationContext(
    db,
    body.conversation_id,
  );
  if (
    context.conversation.purposeKey !== "supplier_negotiation" ||
    !context.conversation.negotiationId
  )
    throw new Error("Only a supplier negotiation can read negotiation state.");
  const [job, comparable, award, ownRows] = await Promise.all([
    loadConfirmedJob(db, context.session.id),
    loadComparableOffers(db, context.session.id),
    loadLatestAward(db, context.session.id),
    db
      .select({
        negotiation: negotiations,
        supplierId: parties.id,
        supplierName: parties.displayName,
        offerRevision: offerRevisions,
      })
      .from(negotiations)
      .innerJoin(
        sessionSuppliers,
        eq(sessionSuppliers.id, negotiations.sessionSupplierId),
      )
      .innerJoin(parties, eq(parties.id, sessionSuppliers.supplierPartyId))
      .innerJoin(offers, eq(offers.negotiationId, negotiations.id))
      .leftJoin(offerRevisions, eq(offerRevisions.id, offers.currentRevisionId))
      .where(eq(negotiations.id, context.conversation.negotiationId)),
  ]);
  const own = ownRows[0];
  if (!own) throw new Error("Supplier negotiation aggregate is missing.");
  const ownComparable = comparable.find(
    (offer) => offer.negotiationId === own.negotiation.id,
  );
  const competitors = comparable.filter(
    (offer) => offer.negotiationId !== own.negotiation.id,
  );
  const comparison = job.confirmed
    ? comparisonState(context.config, job.data, comparable)
    : null;
  const bestCompetitorId = comparison?.offers
    .filter(
      (evaluation) =>
        evaluation.eligible &&
        evaluation.rank !== null &&
        competitors.some(
          (offer) => offer.offerRevisionId === evaluation.offerRevisionId,
        ),
    )
    .sort((left, right) => left.rank! - right.rank!)[0]?.offerRevisionId;
  const bestCompetitor = competitors.find(
    (offer) => offer.offerRevisionId === bestCompetitorId,
  );
  const ownSelected = award?.supplierPartyId === own.supplierId;
  const nextAction = !job.confirmed
    ? "Wait; the customer has not confirmed the job."
    : award?.status === "confirmed"
      ? ownSelected
        ? "The commitment is recorded. Thank the supplier and close the call."
        : "Truthfully notify the supplier that another offer was selected, record the closeout, and close the call."
      : award?.status === "pending_commitment"
        ? ownSelected
          ? "Read back the exact selected job and offer terms, ask for explicit commitment, and call commit_selected_offer only after acceptance."
          : "Wait while the selected supplier commitment is pending; do not claim a final outcome."
        : !ownComparable
          ? "Present the confirmed job and collect every configured field required for a comparable offer."
          : bestCompetitor
            ? "A verified anonymous comparable alternative exists. Ask whether this supplier can improve its offer without inventing competitor identity or terms."
            : "The current offer is comparable. Ask whether it is final and remain available while the customer decides."
  return {
    sessionStatus: context.session.status,
    job,
    negotiation: {
      id: own.negotiation.id,
      phase: own.negotiation.phaseKey,
      outcome: own.negotiation.outcomeKey,
      supplierName: own.supplierName,
    },
    ownOffer: own.offerRevision
      ? {
          revisionId: own.offerRevision.id,
          comparabilityStatus: own.offerRevision.comparabilityStatus,
          data: jsonRecord(own.offerRevision.data),
        }
      : null,
    anonymousLeverage: bestCompetitor
      ? {
          offerRevisionId: bestCompetitor.offerRevisionId,
          terms: bestCompetitor.data,
        }
      : null,
    award: award
      ? {
          status: award.status,
          selectedOfferRevisionId: award.selectedOfferRevisionId,
          thisSupplierSelected: ownSelected,
        }
      : null,
    nextAction,
  };
}
