import { describe, expect, it } from "vitest";

import { documentJobRequestSchema } from "./document-job-contract";

describe("document job request contract", () => {
  it("accepts document-first intake without a customer phone number", () => {
    const result = documentJobRequestSchema.parse({
      customer: { displayName: "Acme Logistics" },
      suppliers: [{ phoneE164: "+41791234567" }],
    });

    expect(result).toEqual({
      useCase: "freight_brokerage",
      customer: { displayName: "Acme Logistics" },
      suppliers: [{ phoneE164: "+41791234567" }],
    });
  });

  it("rejects invalid or excessive supplier targets", () => {
    expect(
      documentJobRequestSchema.safeParse({
        suppliers: [{ phoneE164: "079 123 45 67" }],
      }).success,
    ).toBe(false);
    expect(
      documentJobRequestSchema.safeParse({
        suppliers: Array.from({ length: 4 }, (_, index) => ({
          phoneE164: `+4179123456${index}`,
        })),
      }).success,
    ).toBe(false);
  });
});
