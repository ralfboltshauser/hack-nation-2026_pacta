import { readFile } from "node:fs/promises";

import {
  awards,
  conversations,
  createDatabase,
  createSourcingSession,
  customerDecisions,
  publishUseCaseConfiguration,
  sessionEvents,
} from "@pacta/db";
import { useCaseConfigSchema } from "@pacta/use-case-config";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  commitSelectedOffer,
  recordSupplierOutcome,
  selectOffer,
} from "./decisions";
import {
  getCustomerState,
  getNegotiationState,
} from "./state";
import { submitConfirmedJob } from "./submit-confirmed-job";
import { submitNativeOffer } from "./submit-offer";

const databaseUrl = process.env.TEST_DATABASE_URL;

const job = {
  origin: { city: "Zurich", country: "CH" },
  destination: { city: "Munich", country: "DE" },
  pickupWindow: {
    start: "2026-07-20T08:00:00Z",
    end: "2026-07-20T10:00:00Z",
  },
  deliveryWindow: {
    start: "2026-07-21T08:00:00Z",
    end: "2026-07-21T18:00:00Z",
  },
  equipmentType: "dry_van_53",
  commodity: "Machine parts",
  weightKg: 8_000,
  handlingUnits: 12,
  hazmat: false,
  specialServices: [],
  risk: { criticality: "standard", minimumCoverageMinor: 2_000_000 },
};

function history(message: string) {
  return JSON.stringify({ entries: [{ role: "user", message }] });
}

function offer(totalMinor: number) {
  return {
    pricing: {
      currency: "CHF",
      lineItems: [
        {
          code: "linehaul",
          label: "Linehaul",
          amountMinor: totalMinor - 10_000,
          basis: "flat",
        },
        {
          code: "fuel",
          label: "Fuel surcharge",
          amountMinor: 10_000,
          basis: "flat",
        },
      ],
      allInTotalMinor: totalMinor,
    },
    service: {
      pickupCommitment: "2026-07-20T08:00:00Z",
      deliveryCommitment: "2026-07-21T18:00:00Z",
      equipmentType: "dry_van_53",
    },
    terms: {
      quoteType: "firm",
      validUntil: "2026-07-20T07:00:00Z",
      paymentTerms: "Net 30",
      tollsIncluded: true,
    },
    coverage: { confirmed: true, limitMinor: 2_500_000 },
    conditions: [],
    exclusions: [],
    unknowns: [],
  };
}

describe.skipIf(!databaseUrl)("native v0 commercial flow", () => {
  it("runs customer intake through three offers, selection, commitment, and closeout", async () => {
    process.env.DATABASE_URL = databaseUrl!;
    process.env.PACTA_OUTBOUND_CALLS_ENABLED = "false";
    const { db, client } = createDatabase(databaseUrl);
    try {
      const config = useCaseConfigSchema.parse(
        JSON.parse(
          await readFile(
            new URL(
              "../../../../../config/use-cases/freight-brokerage/0.1.0.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      );
      const suffix = crypto.randomUUID().slice(0, 8);
      const published = await publishUseCaseConfiguration(db, {
        workspaceSlug: `native-flow-${suffix}`,
        workspaceName: "Native flow test",
        config,
      });
      const graph = await createSourcingSession(db, {
        workspaceId: published.workspace.id,
        configVersionId: published.configVersion.id,
        customer: { displayName: "Customer" },
        suppliers: [
          { displayName: "Supplier 1" },
          { displayName: "Supplier 2" },
          { displayName: "Supplier 3" },
        ],
      });
      const customerProviderId = `conv_customer_${crypto.randomUUID()}`;
      await db
        .update(conversations)
        .set({ providerConversationId: customerProviderId, status: "connected" })
        .where(eq(conversations.id, graph.customer.conversation.id));
      const customerHistory = history(
        "I explicitly confirm the complete job exactly as stated.",
      );
      const confirmed = await submitConfirmedJob(db, {
        conversation_id: customerProviderId,
        conversation_history: customerHistory,
        job,
      });
      expect(confirmed).toMatchObject({ accepted: true, created: true });

      const providerIds = graph.suppliers.map(
        (_, index) => `conv_supplier_${index}_${crypto.randomUUID()}`,
      );
      await Promise.all(
        graph.suppliers.map((supplier, index) =>
          db
            .update(conversations)
            .set({
              providerConversationId: providerIds[index],
              status: "connected",
            })
            .where(eq(conversations.id, supplier.conversation.id)),
        ),
      );
      const totals = [152_000, 146_000, 149_000];
      const submitted = await Promise.all(
        providerIds.map((conversationId, index) =>
          submitNativeOffer(db, {
            conversation_id: conversationId,
            conversation_history: history(
              `I confirm my firm all-in CHF ${totals[index]! / 100} quote and all exact terms.`,
            ),
            offer: offer(totals[index]!),
          }),
        ),
      );
      expect(
        submitted.every(
          (result) =>
            (result as { accepted?: boolean }).accepted === true,
        ),
      ).toBe(true);

      const customerState = await getCustomerState(db, {
        conversation_id: customerProviderId,
      });
      expect(customerState.offers).toHaveLength(3);
      const recommendedId = customerState.comparison?.recommendedOfferRevisionId;
      expect(recommendedId).toBeTruthy();
      const recommended = customerState.offers.find(
        (candidate) => candidate.offerRevisionId === recommendedId,
      );
      expect(recommended?.supplierName).toBe("Supplier 2");

      const decision = await selectOffer(db, {
        conversation_id: customerProviderId,
        conversation_history: history(
          "I explicitly select Supplier 2 on its exact stored offer terms.",
        ),
        action: "select",
        selected_offer_revision_id: recommendedId,
      });
      expect(decision).toMatchObject({
        accepted: true,
        created: true,
        awardStatus: "pending_commitment",
      });
      const selectedProviderId = providerIds[1]!;
      const selectedState = await getNegotiationState(db, {
        conversation_id: selectedProviderId,
      });
      expect(selectedState.award).toMatchObject({
        status: "pending_commitment",
        thisSupplierSelected: true,
      });

      const commitment = await commitSelectedOffer(db, {
        conversation_id: selectedProviderId,
        conversation_history: history(
          "Yes, I explicitly commit to the exact selected job and offer terms.",
        ),
      });
      expect(commitment).toMatchObject({ accepted: true, created: true });
      await Promise.all(
        providerIds
          .filter((providerId) => providerId !== selectedProviderId)
          .map((providerId) =>
            recordSupplierOutcome(db, {
              conversation_id: providerId,
              outcome: "not_selected_notified",
            }),
          ),
      );

      const finalState = await getCustomerState(db, {
        conversation_id: customerProviderId,
      });
      expect(finalState.award?.status).toBe("confirmed");
      expect(finalState.nextAction).toContain("committed");
      const storedAwards = await db
        .select()
        .from(awards)
        .where(eq(awards.sessionId, graph.session.id));
      const storedDecisions = await db
        .select()
        .from(customerDecisions)
        .where(eq(customerDecisions.sessionId, graph.session.id));
      const milestoneEvents = await db
        .select()
        .from(sessionEvents)
        .where(
          and(
            eq(sessionEvents.sessionId, graph.session.id),
            eq(sessionEvents.source, "elevenlabs_native_tool"),
          ),
        );
      expect(storedAwards).toHaveLength(1);
      expect(storedAwards[0]!.status).toBe("confirmed");
      expect(storedDecisions).toHaveLength(1);
      expect(
        milestoneEvents.map((event) => event.eventType),
      ).toEqual(
        expect.arrayContaining([
          "customer.decision_recorded",
          "award.confirmed",
          "supplier.closeout_completed",
        ]),
      );
    } finally {
      await client.end();
    }
  }, 30_000);
});
