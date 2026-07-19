import { describe, expect, it } from "vitest";

import {
  classifyNegotiatorStyleBodySchema,
  evidenceQuoteAppearsInSupplierTurns,
} from "./negotiator-style";

const history = JSON.stringify({
  entries: [
    { role: "agent", message: "Can you give me an all-in quote?" },
    {
      role: "user",
      message: "CHF 900 is the base rate, but tolls and unloading come later.",
    },
  ],
});

describe("negotiator-style classification evidence", () => {
  it("accepts an exact normalized excerpt from a supplier turn", () => {
    expect(
      evidenceQuoteAppearsInSupplierTurns(
        history,
        "tolls and unloading come later",
      ),
    ).toBe(true);
  });

  it("rejects invented evidence and single-word matches", () => {
    expect(
      evidenceQuoteAppearsInSupplierTurns(
        history,
        "This price expires in ten seconds",
      ),
    ).toBe(false);
    expect(evidenceQuoteAppearsInSupplierTurns(history, "tolls")).toBe(false);
  });

  it("limits classifications to the three supported styles", () => {
    expect(
      classifyNegotiatorStyleBodySchema.safeParse({
        conversation_id: "conv_1",
        conversation_history: history,
        negotiator_style: "lowballer_with_hidden_fees",
        evidence_quote: "tolls and unloading come later",
      }).success,
    ).toBe(true);
    expect(
      classifyNegotiatorStyleBodySchema.safeParse({
        conversation_id: "conv_1",
        conversation_history: history,
        negotiator_style: "friendly",
        evidence_quote: "tolls and unloading come later",
      }).success,
    ).toBe(false);
  });
});
