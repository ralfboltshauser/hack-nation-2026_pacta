import {
  awards,
  conversations,
  createDatabase,
  jobRevisions,
  jobs,
  negotiations,
  offerRevisions,
  offers,
  parties,
  sessions,
  sessionSuppliers,
  useCaseConfigVersions,
} from "@pacta/db";
import { useCaseConfigSchema } from "@pacta/use-case-config";
import { desc, eq } from "drizzle-orm";

import type { SessionView } from "@/lib/session-view";
import { hasSessionMembership } from "@/server/sessions/authorization";

export const runtime = "nodejs";

function document(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET(
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

    const [base] = await db
      .select({
        session: sessions,
        customer: parties,
        configDocument: useCaseConfigVersions.document,
      })
      .from(sessions)
      .innerJoin(parties, eq(parties.id, sessions.customerPartyId))
      .innerJoin(
        useCaseConfigVersions,
        eq(useCaseConfigVersions.id, sessions.useCaseConfigVersionId),
      )
      .where(eq(sessions.id, sessionId));
    if (!base)
      return Response.json({ error: "Session not found" }, { status: 404 });
    const config = useCaseConfigSchema.parse(base.configDocument);
    const [job] = await db
      .select({ job: jobs, revision: jobRevisions })
      .from(jobs)
      .leftJoin(jobRevisions, eq(jobRevisions.id, jobs.currentRevisionId))
      .where(eq(jobs.sessionId, sessionId));
    if (!job) throw new Error("Session job is missing.");
    const callRows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.sessionId, sessionId));
    const customerCall = callRows.find(
      (call) =>
        call.partyId === base.customer.id &&
        call.purposeKey === "customer_intake",
    );
    if (!customerCall)
      throw new Error("Session customer conversation is missing.");

    const supplierRows = await db
      .select({
        sessionSupplier: sessionSuppliers,
        party: parties,
        negotiation: negotiations,
        offer: offers,
        offerRevision: offerRevisions,
      })
      .from(sessionSuppliers)
      .innerJoin(parties, eq(parties.id, sessionSuppliers.supplierPartyId))
      .innerJoin(
        negotiations,
        eq(negotiations.sessionSupplierId, sessionSuppliers.id),
      )
      .innerJoin(offers, eq(offers.negotiationId, negotiations.id))
      .leftJoin(offerRevisions, eq(offerRevisions.id, offers.currentRevisionId))
      .where(eq(sessionSuppliers.sessionId, sessionId))
      .orderBy(sessionSuppliers.priority);
    const [award] = await db
      .select()
      .from(awards)
      .where(eq(awards.sessionId, sessionId))
      .orderBy(desc(awards.createdAt))
      .limit(1);

    const view: SessionView = {
      sessionId,
      status: base.session.status,
      job: {
        status: job.job.status,
        data: document(job.revision?.data),
        missingRequiredPaths: job.revision?.missingRequiredPaths ?? [],
        confirmed: job.job.status === "confirmed",
      },
      customer: {
        partyId: base.customer.id,
        conversationId: customerCall.id,
        displayName: base.customer.displayName,
        roleLabel: config.terminology.customer.singular,
        conversationStatus: customerCall.status,
      },
      suppliers: supplierRows.map((row) => {
        const call = callRows.find(
          (candidate) => candidate.negotiationId === row.negotiation.id,
        );
        if (!call)
          throw new Error(
            `Supplier conversation is missing for negotiation ${row.negotiation.id}.`,
          );
        return {
          partyId: row.party.id,
          conversationId: call.id,
          displayName: row.party.displayName,
          roleLabel: config.terminology.supplier.singular,
          conversationStatus: call.status,
          negotiationId: row.negotiation.id,
          negotiationPhase: row.negotiation.phaseKey,
          negotiationOutcome: row.negotiation.outcomeKey,
          offerRevisionId: row.offerRevision?.id ?? null,
          offerStatus: row.offer.status,
          offerData: document(row.offerRevision?.data),
          selected: row.party.id === award?.supplierPartyId,
        };
      }),
      selectedOfferRevisionId: award?.selectedOfferRevisionId ?? null,
      awardStatus: award?.status ?? null,
    };
    return Response.json(view, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } finally {
    await client.end();
  }
}
