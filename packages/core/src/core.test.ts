import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { compileUseCaseConfig } from "@pacta/use-case-config";
import { describe, expect, it } from "vitest";

import { compareOffers } from "./comparison";
import { replaySessionEvents } from "./event-replay";
import { reduceJobDocument, reduceOfferDocument } from "./reducer";
import type { SessionEvent } from "./types";

async function freight() {
  const raw = await readFile(
    resolve(
      import.meta.dirname,
      "../../../config/use-cases/freight-brokerage/0.1.0.json",
    ),
    "utf8",
  );
  return compileUseCaseConfig(JSON.parse(raw) as unknown).document;
}

const evidenceQuote = "directly stated by test participant";

describe("domain reducer", () => {
  it("creates a complete job revision while preserving explicit false and empty values", async () => {
    const config = await freight();
    const result = reduceJobDocument(
      config,
      {},
      {
        jobObservations: [
          ["/origin", { city: "Zurich", country: "CH" }],
          ["/destination", { city: "Munich", country: "DE" }],
          [
            "/pickupWindow",
            { start: "2026-07-21T08:00:00Z", end: "2026-07-21T10:00:00Z" },
          ],
          [
            "/deliveryWindow",
            { start: "2026-07-22T12:00:00Z", end: "2026-07-22T16:00:00Z" },
          ],
          ["/equipmentType", "dry_van_53"],
          ["/commodity", "Machine parts"],
          ["/weightKg", 8000],
          ["/handlingUnits", 12],
          ["/hazmat", false],
          ["/specialServices", []],
          [
            "/risk",
            { criticality: "critical", minimumCoverageMinor: 25000000 },
          ],
        ].map(([path, value]) => ({ path, value, evidenceQuote })),
        offerObservations: [],
        signals: {},
      },
    );

    expect(result.valid).toBe(true);
    expect(result.missingRequiredPaths).toEqual([]);
    expect(result.data.hazmat).toBe(false);
    expect(result.data.specialServices).toEqual([]);
  });

  it("normalizes line items and blocks an offer with unresolved material terms", async () => {
    const config = await freight();
    const result = reduceOfferDocument(
      config,
      { risk: { criticality: "critical", minimumCoverageMinor: 25000000 } },
      {},
      {
        jobObservations: [],
        offerObservations: [
          [
            "/pricing",
            {
              currency: "CHF",
              lineItems: [
                {
                  code: "linehaul",
                  label: "Linehaul",
                  amountMinor: 140000,
                  basis: "flat",
                },
              ],
              allInTotalMinor: 140000,
            },
          ],
          [
            "/service",
            {
              pickupCommitment: "2026-07-21T08:00:00Z",
              deliveryCommitment: "2026-07-22T15:00:00Z",
              equipmentType: "dry_van_53",
            },
          ],
          [
            "/terms",
            {
              quoteType: "firm",
              validUntil: "2026-07-20T18:00:00Z",
              paymentTerms: "net_30",
            },
          ],
          ["/coverage", { confirmed: true, limitMinor: 25000000 }],
          ["/conditions", []],
          ["/exclusions", []],
          ["/unknowns", []],
        ].map(([path, value]) => ({ path, value, evidenceQuote })),
        signals: { offerIsFinal: true },
      },
    );

    expect(result.data.normalized).toEqual({ totalMinor: 140000 });
    expect(result.comparabilityStatus).toBe("blocked");
    expect(result.clarificationNeeds.map((need) => need.id)).toContain(
      "freight_tolls_resolved",
    );
  });

  it("recommends only eligible offers while preserving customer choice", async () => {
    const config = await freight();
    const result = compareOffers(
      config,
      { risk: { criticality: "critical" } },
      [
        {
          offerRevisionId: "10000000-0000-4000-8000-000000000001",
          supplierId: "s1",
          supplierName: "Cheap uninsured",
          data: {
            normalized: { totalMinor: 100000 },
            coverage: { confirmed: false, limitMinor: 0 },
          },
        },
        {
          offerRevisionId: "10000000-0000-4000-8000-000000000002",
          supplierId: "s2",
          supplierName: "Covered",
          data: {
            normalized: { totalMinor: 125000 },
            coverage: { confirmed: true, limitMinor: 30000000 },
          },
        },
      ],
    );

    expect(result.recommendedOfferRevisionId).toBe(
      "10000000-0000-4000-8000-000000000002",
    );
    expect(
      result.offers.find((offer) => offer.supplierId === "s1")?.eligible,
    ).toBe(false);
  });
});

describe("event replay", () => {
  function event(eventSeq: number, eventType: string): SessionEvent {
    return {
      id: `e${eventSeq}`,
      sessionId: "s",
      eventSeq,
      eventType,
      aggregateType: "session",
      aggregateId: "s",
      occurredAt: new Date(0).toISOString(),
      payload: {},
    };
  }

  it("reconstructs contiguous state deterministically", () => {
    const projection = replaySessionEvents([
      event(3, "session.completed"),
      event(1, "session.started"),
      event(2, "job.confirmed"),
    ]);
    expect(projection.status).toBe("completed");
    expect(projection.lastEventSeq).toBe(3);
  });

  it("refuses to paper over a missing event", () => {
    expect(() =>
      replaySessionEvents([
        event(1, "session.started"),
        event(3, "session.completed"),
      ]),
    ).toThrow("Session event gap");
  });
});
