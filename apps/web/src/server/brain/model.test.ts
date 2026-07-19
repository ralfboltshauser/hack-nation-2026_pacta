import { readFile } from "node:fs/promises";

import { chatCompletionRequestSchema } from "@pacta/elevenlabs";
import { useCaseConfigSchema } from "@pacta/use-case-config";
import { describe, expect, it } from "vitest";

import { buildBrainPrompt, parseBrainModelOutput } from "./model";

describe("brain model output", () => {
  it("decodes use-case-agnostic JSON observation values", () => {
    const output = parseBrainModelOutput({
      say: "Thanks.",
      act: "speak",
      job: [
        {
          path: "/origin/city",
          json: '"Zurich"',
          quote: "Zurich",
        },
        {
          path: "/specialServices",
          json: "[]",
          quote: "no special services",
        },
      ],
      offer: [
        {
          path: "/lineItems",
          json: '[{"code":"linehaul","amountMinor":136000}]',
          quote: "linehaul 136000 minor units",
        },
      ],
      signals: ["job_confirmed"],
      selectedOfferRevisionId: null,
    });

    expect(output.reduction.jobObservations[0]?.value).toBe("Zurich");
    expect(output.reduction.jobObservations[1]).toMatchObject({ value: [] });
    expect(output.reduction.jobObservations[1]).not.toHaveProperty(
      "evidenceSource",
    );
    expect(output.reduction.offerObservations[0]?.value).toEqual([
      { code: "linehaul", amountMinor: 136000 },
    ]);
    expect(output.reduction.signals.jobConfirmed).toBe(true);
    expect(output.reduction.signals.offerIsFinal).toBe(false);
  });

  it("rejects an observation that is not valid JSON", () => {
    expect(() =>
      parseBrainModelOutput({
        say: "Thanks.",
        act: "speak",
        job: [
          {
            path: "/origin/city",
            json: "Zurich",
            quote: "Zurich",
          },
        ],
        offer: [],
        signals: [],
        selectedOfferRevisionId: null,
      }),
    ).toThrow("invalid JSON");
  });

  it("preserves evidence sources for authenticated file intake", () => {
    const output = parseBrainModelOutput(
      {
        say: "Please confirm the pickup city.",
        act: "speak",
        job: [
          {
            path: "/origin/city",
            json: '"Zurich"',
            quote: "Pickup: Zurich",
            source: "attachment",
          },
        ],
        offer: [],
        signals: [],
        selectedOfferRevisionId: null,
      },
      "intake",
    );

    expect(output.reduction.jobObservations[0]).toMatchObject({
      value: "Zurich",
      evidenceSource: "attachment",
    });
  });

  it("sends each role only the contracts it needs", async () => {
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
    const request = chatCompletionRequestSchema.parse({
      model: "pacta",
      stream: true,
      messages: [
        { role: "system", content: "Provider-owned duplicate instructions" },
        { role: "user", content: "Pickup in Zurich." },
      ],
      elevenlabs_extra_body: {
        contract_version: "1",
        brain_token: "a".repeat(32),
        workspace_id: "00000000-0000-4000-8000-000000000001",
        session_id: "00000000-0000-4000-8000-000000000002",
        conversation_id: "00000000-0000-4000-8000-000000000003",
        purpose: "customer_intake",
      },
    });
    const snapshot = {
      purpose: "customer_intake" as const,
      config,
      job: {},
      offer: {},
      negotiation: {},
      materialContext: [],
    };
    const customer = buildBrainPrompt(request, snapshot);
    expect(customer).toHaveProperty("jobContract");
    expect(customer).not.toHaveProperty("offerContract");
    expect(customer.conversation).toEqual([
      { role: "user", content: "Pickup in Zurich." },
    ]);

    const supplier = buildBrainPrompt(request, {
      ...snapshot,
      purpose: "supplier_negotiation",
    });
    expect(supplier).toHaveProperty("offerContract");
    expect(supplier).not.toHaveProperty("jobContract");
  });
});
