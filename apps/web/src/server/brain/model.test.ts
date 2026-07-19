import { describe, expect, it } from "vitest";

import { parseBrainModelOutput } from "./model";

const signals = {
  jobConfirmed: false,
  jobCorrectionRequested: false,
  supplierDeclined: false,
  callbackRequested: false,
  offerIsFinal: false,
  selectedOfferRevisionId: null,
  supplierAcceptedExactTerms: false,
  customerDeclinedAll: false,
};

describe("brain model output", () => {
  it("decodes use-case-agnostic JSON observation values", () => {
    const output = parseBrainModelOutput({
      spokenResponse: "Thanks.",
      responseAction: "speak",
      reduction: {
        jobObservations: [
          {
            path: "/origin/city",
            valueJson: '"Zurich"',
            evidenceQuote: "Zurich",
            evidenceSource: "human_turn",
          },
          {
            path: "/specialServices",
            valueJson: "[]",
            evidenceQuote: "no special services",
            evidenceSource: null,
          },
        ],
        offerObservations: [
          {
            path: "/lineItems",
            valueJson: '[{"code":"linehaul","amountMinor":136000}]',
            evidenceQuote: "linehaul 136000 minor units",
            evidenceSource: "human_turn",
          },
        ],
        signals,
      },
    });

    expect(output.reduction.jobObservations[0]?.value).toBe("Zurich");
    expect(output.reduction.jobObservations[1]).toMatchObject({ value: [] });
    expect(output.reduction.jobObservations[1]).not.toHaveProperty(
      "evidenceSource",
    );
    expect(output.reduction.offerObservations[0]?.value).toEqual([
      { code: "linehaul", amountMinor: 136000 },
    ]);
  });

  it("rejects an observation that is not valid JSON", () => {
    expect(() =>
      parseBrainModelOutput({
        spokenResponse: "Thanks.",
        responseAction: "speak",
        reduction: {
          jobObservations: [
            {
              path: "/origin/city",
              valueJson: "Zurich",
              evidenceQuote: "Zurich",
              evidenceSource: "human_turn",
            },
          ],
          offerObservations: [],
          signals,
        },
      }),
    ).toThrow("invalid JSON");
  });
});
