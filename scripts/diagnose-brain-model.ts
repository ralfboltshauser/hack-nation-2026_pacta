import { getBuiltinUseCase } from "@pacta/use-case-config";

import { generateBrainOutput } from "../apps/web/src/server/brain/model";

const customerJob =
  "Origin city Zurich, origin country CH. Destination city Munich, destination country DE. Pickup window starts 2026-07-20T08:00:00+02:00 and ends 2026-07-20T10:00:00+02:00. Delivery window starts 2026-07-20T16:00:00+02:00 and ends 2026-07-20T18:00:00+02:00. Equipment is dry_van_53. Commodity is machine parts, weight is 10000 kg, and there are 10 handling units. Hazmat is false. Special services is an empty list. Risk criticality is standard and minimum coverage is 20000000 minor currency units. I explicitly confirm all of these exact job details.";

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("--runs must be a positive integer.");
  }
  return parsed;
}

function inspectInvalidOutput(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const text = (error as { text?: unknown }).text;
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      keys: Object.keys(parsed),
      jobType: Array.isArray(parsed.jobObservations)
        ? "array"
        : typeof parsed.jobObservations,
      offerType: Array.isArray(parsed.offerObservations)
        ? "array"
        : typeof parsed.offerObservations,
      signals: Array.isArray(parsed.signalKeys) ? parsed.signalKeys : null,
      textLength: text.length,
    };
  } catch {
    return { textLength: text.length, validJson: false };
  }
}

const models = (
  option("models") ??
  "openai/gpt-oss-120b,openai/gpt-4.1-nano,google/gemini-2.5-flash-lite"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const runs = positiveInteger(option("runs"), 5);

if (!process.env.VERCEL_OIDC_TOKEN && !process.env.AI_GATEWAY_API_KEY) {
  throw new Error(
    "AI Gateway authentication is missing. Pull a short-lived VERCEL_OIDC_TOKEN or set AI_GATEWAY_API_KEY.",
  );
}

const request = {
  model: "pacta",
  stream: true as const,
  messages: [
    {
      role: "user" as const,
      content: customerJob,
    },
  ],
  elevenlabs_extra_body: {
    contract_version: "1" as const,
    brain_token: "diagnostic-token-is-never-sent-to-pacta",
    workspace_id: "00000000-0000-4000-8000-000000000001",
    session_id: "00000000-0000-4000-8000-000000000002",
    conversation_id: "00000000-0000-4000-8000-000000000003",
    purpose: "customer_intake" as const,
  },
};
const snapshot = {
  purpose: "customer_intake" as const,
  config: getBuiltinUseCase("freight_brokerage"),
  job: {},
  offer: {},
  negotiation: {},
  materialContext: [],
};

async function main() {
  const results: Array<Record<string, unknown>> = [];
  for (const model of models) {
    process.env.PACTA_BRAIN_MODEL = model;
    for (let run = 1; run <= runs; run += 1) {
      const startedAt = performance.now();
      try {
        const output = await generateBrainOutput(request, snapshot);
        results.push({
          model,
          run,
          ok: true,
          elapsedMs: Math.round(performance.now() - startedAt),
          spokenResponseLength: output.spokenResponse.length,
          jobObservationCount: output.reduction.jobObservations.length,
          signalKeys: Object.entries(output.reduction.signals)
            .filter(([, value]) => value === true || typeof value === "string")
            .map(([key]) => key),
        });
      } catch (error) {
        results.push({
          model,
          run,
          ok: false,
          elapsedMs: Math.round(performance.now() - startedAt),
          errorName: error instanceof Error ? error.name : "unknown",
          errorMessage:
            error instanceof Error ? error.message.slice(0, 240) : "unknown",
          invalidOutput: inspectInvalidOutput(error),
        });
      }
    }
  }

  const summary = models.map((model) => {
    const rows = results.filter((result) => result.model === model);
    const valid = rows.filter((result) => result.ok === true);
    const timings = rows
      .map((result) => result.elapsedMs)
      .filter((value): value is number => typeof value === "number")
      .sort((left, right) => left - right);
    return {
      model,
      valid: valid.length,
      total: rows.length,
      medianMs: timings[Math.floor(timings.length / 2)] ?? null,
      maxMs: timings.at(-1) ?? null,
    };
  });

  console.log(JSON.stringify({ summary, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
