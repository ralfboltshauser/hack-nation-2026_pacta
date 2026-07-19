import {
  compileUseCaseConfig,
  evaluatePredicate,
  hasPointer,
  schemaHasPointer,
  setPointer,
  type UseCaseConfig,
} from "@pacta/use-case-config";
import { z } from "zod";

import type { StructuredDocumentRevision } from "./types";

const observation = z
  .object({
    path: z.string().startsWith("/"),
    value: z.unknown(),
    evidenceQuote: z.string().min(1),
    evidenceSource: z.enum(["human_turn", "attachment"]).optional(),
  })
  .strict();

export const turnReductionSchema = z
  .object({
    jobObservations: z.array(observation).default([]),
    offerObservations: z.array(observation).default([]),
    signals: z
      .object({
        jobConfirmed: z.boolean().default(false),
        jobCorrectionRequested: z.boolean().default(false),
        supplierDeclined: z.boolean().default(false),
        callbackRequested: z.boolean().default(false),
        offerIsFinal: z.boolean().default(false),
        selectedOfferRevisionId: z.string().uuid().nullable().default(null),
        supplierAcceptedExactTerms: z.boolean().default(false),
        customerDeclinedAll: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();

export type TurnReduction = z.infer<typeof turnReductionSchema>;

function clone(document: Record<string, unknown>) {
  return structuredClone(document);
}

function applyObservations(
  current: Record<string, unknown>,
  observations: z.infer<typeof observation>[],
  schema: Record<string, unknown>,
) {
  const next = clone(current);
  for (const item of observations) {
    if (!schemaHasPointer(schema, item.path))
      throw new Error(`Reducer emitted an unconfigured path: ${item.path}`);
    setPointer(next, item.path, item.value);
  }
  return next;
}

export function reduceJobDocument(
  config: UseCaseConfig,
  current: Record<string, unknown>,
  reductionInput: unknown,
): StructuredDocumentRevision & { reduction: TurnReduction } {
  const reduction = turnReductionSchema.parse(reductionInput);
  const data = applyObservations(
    current,
    reduction.jobObservations,
    config.job.schema,
  );
  const validation = compileUseCaseConfig(config).validateJob(data);
  const mustBeKnownMissing = config.job.completion.mustBeKnown.filter(
    (path) => !hasPointer(data, path),
  );
  const missingRequiredPaths = [
    ...new Set([...validation.missingRequiredPaths, ...mustBeKnownMissing]),
  ].sort();

  return {
    data,
    valid: validation.valid && missingRequiredPaths.length === 0,
    missingRequiredPaths,
    validationErrors: validation.errors,
    reduction,
  };
}

function sumLineItems(document: Record<string, unknown>, path: string) {
  const parts = path.slice(1).split("/");
  let current: unknown = document;
  for (const part of parts)
    current =
      current && typeof current === "object"
        ? (current as Record<string, unknown>)[part]
        : undefined;
  if (!Array.isArray(current)) return null;
  let total = 0;
  for (const item of current) {
    const amount =
      item && typeof item === "object"
        ? (item as Record<string, unknown>).amountMinor
        : undefined;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount))
      return null;
    total += amount;
  }
  return total;
}

export function reduceOfferDocument(
  config: UseCaseConfig,
  job: Record<string, unknown>,
  current: Record<string, unknown>,
  reductionInput: unknown,
) {
  const reduction = turnReductionSchema.parse(reductionInput);
  const data = applyObservations(
    current,
    reduction.offerObservations,
    config.offer.schema,
  );

  for (const normalizer of config.offer.normalizers) {
    if (normalizer.functionKey === "money.sum_line_items.v1") {
      const total = sumLineItems(data, normalizer.inputs[0]!);
      if (total !== null) setPointer(data, normalizer.output, total);
    }
  }

  const validation = compileUseCaseConfig(config).validateOffer(data);
  const missing = config.offer.completion.mustBeKnown.filter(
    (path) => !hasPointer(data, path),
  );
  const clarificationNeeds = config.offer.clarificationRules
    .filter((rule) =>
      evaluatePredicate(rule.when, {
        job,
        offer: data,
        session: {},
        facts: {},
      }),
    )
    .map((rule) => ({ id: rule.id, ...rule.effect }));
  const blocked = clarificationNeeds.some((need) => need.blocksComparability);
  const requiredComparabilityMissing =
    config.offer.comparability.requiredPaths.filter(
      (path) => !hasPointer(data, path),
    );
  const missingRequiredPaths = [
    ...new Set([
      ...validation.missingRequiredPaths,
      ...missing,
      ...requiredComparabilityMissing,
    ]),
  ].sort();

  return {
    data,
    valid: validation.valid,
    missingRequiredPaths,
    validationErrors: validation.errors,
    clarificationNeeds,
    comparabilityStatus:
      validation.valid && missingRequiredPaths.length === 0 && !blocked
        ? "comparable"
        : blocked
          ? "blocked"
          : "incomplete",
    reduction,
  } as const;
}
