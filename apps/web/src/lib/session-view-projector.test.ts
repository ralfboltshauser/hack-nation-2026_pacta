import { describe, expect, it } from "vitest";

import type { SessionView } from "./session-view";
import { projectSessionView } from "./session-view-projector";

const view: SessionView = {
  sessionId: "session",
  status: "committing",
  job: {
    status: "confirmed",
    data: {},
    missingRequiredPaths: [],
    confirmed: true,
  },
  customer: {
    partyId: "customer",
    conversationId: "customer-call",
    displayName: "Acme",
    roleLabel: "shipper",
    conversationStatus: "connected",
  },
  suppliers: [
    {
      partyId: "supplier-a",
      conversationId: "call-a",
      displayName: "Carrier A",
      roleLabel: "carrier",
      conversationStatus: "connected",
      negotiationId: "negotiation-a",
      negotiationPhase: "closing",
      negotiationOutcome: null,
      offerRevisionId: "revision-a",
      offerStatus: "comparable",
      offerData: {
        pricing: { currency: "CHF", allInTotalMinor: 146000 },
        normalized: { totalMinor: 146000 },
      },
      selected: true,
    },
    {
      partyId: "supplier-b",
      conversationId: "call-b",
      displayName: "Carrier B",
      roleLabel: "carrier",
      conversationStatus: "ended",
      negotiationId: "negotiation-b",
      negotiationPhase: "closed",
      negotiationOutcome: "supplier_declined",
      offerRevisionId: null,
      offerStatus: "draft",
      offerData: {},
      selected: false,
    },
  ],
  selectedOfferRevisionId: "revision-a",
  awardStatus: "pending_commitment",
};

describe("session view projector", () => {
  it("projects real party state and normalized price without inventing suppliers", () => {
    const result = projectSessionView(view);
    expect(result.phase).toBe(2);
    expect(result.customerName).toBe("Acme");
    expect(result.suppliers).toHaveLength(2);
    expect(result.suppliers[0]).toMatchObject({
      name: "Carrier A",
      state: "selected",
      offer: "CHF 1,460",
    });
    expect(result.suppliers[1]?.state).toBe("closed");
  });
});
