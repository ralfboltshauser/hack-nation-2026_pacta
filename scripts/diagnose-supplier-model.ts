import { reduceOfferDocument } from "@pacta/core";
import {
  getBuiltinUseCase,
  getPointer,
  hasPointer,
} from "@pacta/use-case-config";

import { generateBrainOutput } from "../apps/web/src/server/brain/model";

const config = getBuiltinUseCase("freight_brokerage");

const confirmedJob = {
  origin: { city: "Zurich", country: "CH" },
  destination: { city: "Munich", country: "DE" },
  pickupWindow: {
    start: "2026-07-20T08:00:00+02:00",
    end: "2026-07-20T10:00:00+02:00",
  },
  deliveryWindow: {
    start: "2026-07-20T16:00:00+02:00",
    end: "2026-07-20T18:00:00+02:00",
  },
  equipmentType: "dry_van_53",
  commodity: "machine parts",
  weightKg: 10_000,
  handlingUnits: 10,
  hazmat: false,
  specialServices: [],
  risk: { criticality: "standard", minimumCoverageMinor: 20_000_000 },
};

const quotes = [
  { name: "Alpine Haulage", total: 152_000, linehaul: 142_000 },
  { name: "Rhine Cargo", total: 146_000, linehaul: 136_000 },
  { name: "Northstar Transit", total: 149_000, linehaul: 139_000 },
].map((quote) => ({
  ...quote,
  message: `This is my final firm quote. Pricing currency is CHF. Line items are linehaul ${quote.linehaul} minor units, flat basis, plus fuel 10000 minor units, flat basis. The all-in total is ${quote.total} minor units and normalized total is ${quote.total} minor units. Pickup commitment is 2026-07-20T08:00:00+02:00, delivery commitment is 2026-07-20T18:00:00+02:00, and equipment is dry_van_53. Quote type is firm, valid until 2026-07-19T20:00:00+02:00, payment terms are net 30, and tolls are included. Cargo coverage is confirmed with a limit of 25000000 minor units. Conditions, exclusions, and unknowns are all empty lists.`,
}));

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("Run counts must be positive integers.");
  }
  return parsed;
}

const models = (
  option("models") ?? "google/gemini-2.5-flash-lite,openai/gpt-4.1-nano"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const sequentialRuns = positiveInteger(option("sequential"), 3);
const parallelRuns = positiveInteger(option("parallel"), 3);

if (parallelRuns !== 3) {
  throw new Error("This diagnostic intentionally requires --parallel=3.");
}

if (!process.env.VERCEL_OIDC_TOKEN && !process.env.AI_GATEWAY_API_KEY) {
  throw new Error(
    "AI Gateway authentication is missing. Pull a short-lived VERCEL_OIDC_TOKEN or set AI_GATEWAY_API_KEY.",
  );
}

type Quote = (typeof quotes)[number];

function requestFor(quote: Quote) {
  return {
    model: "pacta",
    stream: true as const,
    messages: [{ role: "user" as const, content: quote.message }],
    elevenlabs_extra_body: {
      contract_version: "1" as const,
      brain_token: "diagnostic-token-that-is-not-sent-to-pacta",
      workspace_id: "00000000-0000-4000-8000-000000000001",
      session_id: "00000000-0000-4000-8000-000000000002",
      conversation_id: "00000000-0000-4000-8000-000000000003",
      purpose: "supplier_negotiation" as const,
      negotiation_id: "00000000-0000-4000-8000-000000000004",
    },
  };
}

const snapshot = {
  purpose: "supplier_negotiation" as const,
  config,
  job: confirmedJob,
  offer: {},
  negotiation: { phase: "quoting" },
  materialContext: [],
};

function equivalentInstant(value: unknown, expected: string) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) === Date.parse(expected)
  );
}

function inspectSemantics(
  quote: Quote,
  output: Awaited<ReturnType<typeof generateBrainOutput>>,
) {
  const reduced = reduceOfferDocument(
    config,
    confirmedJob,
    {},
    output.reduction,
  );
  const configuredFieldCoverage = Object.fromEntries(
    config.offer.fields.map(({ path }) => [
      path,
      hasPointer(reduced.data, path),
    ]),
  );
  const lineItems = getPointer(reduced.data, "/pricing/lineItems");
  const expectedAmounts = new Map([
    ["linehaul", quote.linehaul],
    ["fuel", 10_000],
  ]);
  const lineItemsExact =
    Array.isArray(lineItems) &&
    lineItems.length === 2 &&
    lineItems.every((item) => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.code === "string" &&
        expectedAmounts.get(record.code) === record.amountMinor &&
        record.basis === "flat" &&
        typeof record.label === "string" &&
        record.label.length > 0
      );
    });
  const expectedValuesExact =
    getPointer(reduced.data, "/pricing/currency") === "CHF" &&
    getPointer(reduced.data, "/pricing/allInTotalMinor") === quote.total &&
    lineItemsExact &&
    equivalentInstant(
      getPointer(reduced.data, "/service/pickupCommitment"),
      "2026-07-20T08:00:00+02:00",
    ) &&
    equivalentInstant(
      getPointer(reduced.data, "/service/deliveryCommitment"),
      "2026-07-20T18:00:00+02:00",
    ) &&
    getPointer(reduced.data, "/service/equipmentType") === "dry_van_53" &&
    getPointer(reduced.data, "/terms/quoteType") === "firm" &&
    equivalentInstant(
      getPointer(reduced.data, "/terms/validUntil"),
      "2026-07-19T20:00:00+02:00",
    ) &&
    getPointer(reduced.data, "/terms/paymentTerms") === "net 30" &&
    getPointer(reduced.data, "/terms/tollsIncluded") === true &&
    getPointer(reduced.data, "/coverage/confirmed") === true &&
    getPointer(reduced.data, "/coverage/limitMinor") === 25_000_000 &&
    ["/conditions", "/exclusions", "/unknowns"].every((path) => {
      const value = getPointer(reduced.data, path);
      return Array.isArray(value) && value.length === 0;
    }) &&
    getPointer(reduced.data, "/normalized/totalMinor") === quote.total;
  const offerIsFinal = output.reduction.signals.offerIsFinal;
  const allConfiguredFields = Object.values(configuredFieldCoverage).every(
    Boolean,
  );
  const semanticallyComplete =
    reduced.valid &&
    reduced.comparabilityStatus === "comparable" &&
    allConfiguredFields &&
    expectedValuesExact &&
    offerIsFinal;

  return {
    semanticallyComplete,
    fullOfferSchemaValid: reduced.valid,
    comparable: reduced.comparabilityStatus === "comparable",
    allConfiguredFields,
    configuredFieldCoverage,
    expectedValuesExact,
    offerIsFinal,
    observationCount: output.reduction.offerObservations.length,
    missingRequiredPaths: reduced.missingRequiredPaths,
    validationErrorCount: reduced.validationErrors.length,
  };
}

function inspectInvalidOutput(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const text = (error as { text?: unknown }).text;
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      keys: Object.keys(parsed),
      offerObservationType: Array.isArray(parsed.offerObservations)
        ? "array"
        : typeof parsed.offerObservations,
      signalKeys: Array.isArray(parsed.signalKeys) ? parsed.signalKeys : null,
      textLength: text.length,
    };
  } catch {
    return { validJson: false, textLength: text.length };
  }
}

async function runOne(input: {
  model: string;
  mode: "sequential" | "parallel";
  run: number;
  quote: Quote;
}) {
  const startedAt = performance.now();
  try {
    const output = await generateBrainOutput(requestFor(input.quote), snapshot);
    return {
      model: input.model,
      mode: input.mode,
      run: input.run,
      quote: input.quote.name,
      structuredValid: true,
      elapsedMs: Math.round(performance.now() - startedAt),
      ...inspectSemantics(input.quote, output),
    };
  } catch (error) {
    return {
      model: input.model,
      mode: input.mode,
      run: input.run,
      quote: input.quote.name,
      structuredValid: false,
      semanticallyComplete: false,
      elapsedMs: Math.round(performance.now() - startedAt),
      errorName: error instanceof Error ? error.name : "unknown",
      errorMessage:
        error instanceof Error ? error.message.slice(0, 300) : "unknown",
      invalidOutput: inspectInvalidOutput(error),
    };
  }
}

async function main() {
  const results: Array<Awaited<ReturnType<typeof runOne>>> = [];
  for (const model of models) {
    process.env.PACTA_BRAIN_MODEL = model;
    for (let index = 0; index < sequentialRuns; index += 1) {
      results.push(
        await runOne({
          model,
          mode: "sequential",
          run: index + 1,
          quote: quotes[index % quotes.length]!,
        }),
      );
    }
    results.push(
      ...(await Promise.all(
        quotes.map((quote, index) =>
          runOne({
            model,
            mode: "parallel",
            run: index + 1,
            quote,
          }),
        ),
      )),
    );
  }

  const summary = models.flatMap((model) =>
    (["sequential", "parallel"] as const).map((mode) => {
      const rows = results.filter(
        (result) => result.model === model && result.mode === mode,
      );
      const timings = rows
        .map(({ elapsedMs }) => elapsedMs)
        .sort((left, right) => left - right);
      return {
        model,
        mode,
        structuredValid: rows.filter((row) => row.structuredValid).length,
        semanticallyComplete: rows.filter((row) => row.semanticallyComplete)
          .length,
        total: rows.length,
        minMs: timings[0] ?? null,
        medianMs: timings[Math.floor(timings.length / 2)] ?? null,
        maxMs: timings.at(-1) ?? null,
        parallelWallMs:
          mode === "parallel" ? Math.max(0, ...timings) : undefined,
      };
    }),
  );

  console.log(JSON.stringify({ summary, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
