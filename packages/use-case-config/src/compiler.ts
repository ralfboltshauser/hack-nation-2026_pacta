import { createHash } from "node:crypto";

import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { schemaHasPointer } from "./pointers";
import {
  useCaseConfigSchema,
  type Predicate,
  type UseCaseConfig,
} from "./schema";

const normalizers = new Set(["money.sum_line_items.v1"]);
const discoveryAdapters = new Set([
  "static.v1",
  "exa.web.v1",
  "apollo.people.v1",
]);

export type DocumentValidation = {
  valid: boolean;
  errors: ErrorObject[];
  missingRequiredPaths: string[];
};

export type CompiledUseCaseConfig = {
  document: UseCaseConfig;
  contentSha256: string;
  validateJob(data: unknown): DocumentValidation;
  validateOffer(data: unknown): DocumentValidation;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function pointerEscape(value: string) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function missingPaths(errors: ErrorObject[] | null | undefined) {
  return [
    ...new Set(
      (errors ?? [])
        .filter((error) => error.keyword === "required")
        .map((error) => {
          const property = String(
            (error.params as { missingProperty?: unknown }).missingProperty ??
              "",
          );
          return `${error.instancePath}/${pointerEscape(property)}`;
        }),
    ),
  ].sort();
}

function wrapValidator(
  validate: ValidateFunction,
): (data: unknown) => DocumentValidation {
  return (data) => {
    const valid = Boolean(validate(data));
    const errors = [...(validate.errors ?? [])];
    return { valid, errors, missingRequiredPaths: missingPaths(errors) };
  };
}

function assertUnique(values: string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function visitPredicate(
  predicate: Predicate,
  visit: (leaf: Extract<Predicate, { source: string }>) => void,
) {
  if ("all" in predicate)
    predicate.all.forEach((child) => visitPredicate(child, visit));
  else if ("any" in predicate)
    predicate.any.forEach((child) => visitPredicate(child, visit));
  else if ("not" in predicate) visitPredicate(predicate.not, visit);
  else visit(predicate);
}

function assertPointer(
  schema: Record<string, unknown>,
  pointer: string,
  label: string,
) {
  if (!schemaHasPointer(schema, pointer))
    throw new Error(`${label} points to unknown schema path ${pointer}`);
}

export function compileUseCaseConfig(input: unknown): CompiledUseCaseConfig {
  const document = useCaseConfigSchema.parse(input);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const validateJob = ajv.compile(document.job.schema);
  const validateOffer = ajv.compile(document.offer.schema);

  const jobPointers = [
    ...document.job.fields.map((field) => field.path),
    ...document.job.completion.mustBeKnown,
    ...document.job.completion.allowExplicitUnknown,
    ...document.job.completion.confirmation.readbackPaths,
    ...document.suppliers.discovery.queryInputs,
  ];
  jobPointers.forEach((path) =>
    assertPointer(document.job.schema, path, "Job configuration"),
  );

  const offerPointers = [
    ...document.offer.fields.map((field) => field.path),
    document.offer.lineItems.path,
    ...document.offer.completion.mustBeKnown,
    ...document.offer.comparability.requiredPaths,
    ...document.offer.normalizers.flatMap((normalizer) => [
      ...normalizer.inputs,
      normalizer.output,
    ]),
  ];
  offerPointers.forEach((path) =>
    assertPointer(document.offer.schema, path, "Offer configuration"),
  );

  for (const rule of [
    ...document.offer.clarificationRules,
    ...document.recommendation.eligibilityRules,
    ...document.recommendation.warningRules,
  ]) {
    visitPredicate(rule.when, (leaf) => {
      if (leaf.source === "job")
        assertPointer(document.job.schema, leaf.path, `Rule ${rule.id}`);
      if (leaf.source === "offer")
        assertPointer(document.offer.schema, leaf.path, `Rule ${rule.id}`);
    });
  }

  if (!discoveryAdapters.has(document.suppliers.discovery.adapterKey)) {
    throw new Error(
      `Unknown discovery adapter: ${document.suppliers.discovery.adapterKey}`,
    );
  }
  for (const normalizer of document.offer.normalizers) {
    if (!normalizers.has(normalizer.functionKey))
      throw new Error(`Unknown normalizer: ${normalizer.functionKey}`);
  }

  assertUnique(
    document.job.fields.map((field) => field.path),
    "job field path",
  );
  assertUnique(
    document.offer.fields.map((field) => field.path),
    "offer field path",
  );
  assertUnique(
    document.offer.lineItems.catalog.map((item) => item.key),
    "line-item key",
  );
  assertUnique(document.negotiation.phases, "negotiation phase");
  assertUnique(document.negotiation.outcomes, "negotiation outcome");
  assertUnique(
    document.negotiation.levers.map((lever) => lever.id),
    "negotiation lever",
  );

  if (
    !document.negotiation.phases.includes(document.negotiation.initialPhase)
  ) {
    throw new Error("Negotiation initial phase must exist in phases");
  }
  if (document.suppliers.defaultParallelism > document.suppliers.defaultCount) {
    throw new Error(
      "Default supplier parallelism cannot exceed default supplier count",
    );
  }
  if (document.suppliers.defaultCount > document.suppliers.maxCount) {
    throw new Error("Default supplier count cannot exceed maxCount");
  }

  return {
    document,
    contentSha256: createHash("sha256").update(stable(document)).digest("hex"),
    validateJob: wrapValidator(validateJob),
    validateOffer: wrapValidator(validateOffer),
  };
}
