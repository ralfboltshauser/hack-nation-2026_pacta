import { z } from "zod";

const jsonObject = z.record(z.string(), z.unknown());
const pointer = z.string().regex(/^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])+)*$/);
const localizedQuestions = z
  .object({
    voice: z.array(z.string().min(1)).optional(),
    chat: z.array(z.string().min(1)).optional(),
  })
  .strict();

const predicateLeaf = z
  .object({
    source: z.enum(["job", "offer", "session", "facts"]),
    path: pointer,
    op: z.enum([
      "missing",
      "present",
      "eq",
      "neq",
      "in",
      "not_in",
      "lt",
      "lte",
      "gt",
      "gte",
      "contains",
    ]),
    value: z.unknown().optional(),
  })
  .strict();

export type Predicate =
  | z.infer<typeof predicateLeaf>
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate };

const predicate: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    predicateLeaf,
    z.object({ all: z.array(predicate).min(1) }).strict(),
    z.object({ any: z.array(predicate).min(1) }).strict(),
    z.object({ not: predicate }).strict(),
  ]),
);

const ruleEffect = z
  .object({
    blocksComparability: z.boolean().optional(),
    severity: z.enum(["info", "warning", "required", "blocker"]).optional(),
    questions: localizedQuestions.optional(),
    eligible: z.boolean().optional(),
    reason: z.string().optional(),
    warning: z.string().optional(),
  })
  .strict();

const rule = z
  .object({
    id: z.string().min(1),
    when: predicate,
    effect: ruleEffect,
  })
  .strict();

const term = z
  .object({ singular: z.string().min(1), plural: z.string().min(1) })
  .strict();

export const useCaseConfigSchema = z
  .object({
    $schema: z.string().optional(),
    contractVersion: z.literal("1"),
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    terminology: z
      .object({
        customer: term,
        supplier: term,
        job: term,
        offer: term,
        session: term,
      })
      .strict(),
    capabilities: z.record(z.string(), z.boolean()).default({}),
    job: z
      .object({
        schema: jsonObject,
        completion: z
          .object({
            mustBeKnown: z.array(pointer).default([]),
            allowExplicitUnknown: z.array(pointer).default([]),
            confirmation: z
              .object({
                required: z.boolean(),
                readbackPaths: z.array(pointer),
                prompt: z.string().min(1),
              })
              .strict(),
          })
          .strict(),
        fields: z.array(
          z
            .object({
              path: pointer,
              label: z.string().min(1),
              priority: z.number().int(),
              questions: localizedQuestions,
              documentHints: z.array(z.string()).default([]),
              confirmationLabel: z.string().min(1),
              sensitivity: z.enum(["normal", "sensitive"]).default("normal"),
            })
            .strict(),
        ),
      })
      .strict(),
    intake: z
      .object({
        channels: z
          .object({
            voice: z
              .object({
                enabled: z.boolean(),
                askOneQuestionAtATime: z.boolean(),
              })
              .strict(),
            chat: z
              .object({
                enabled: z.boolean(),
                fileInput: z
                  .object({
                    enabled: z.boolean(),
                    acceptedTypes: z.array(z.string()),
                    maxFiles: z.number().int().positive(),
                  })
                  .strict(),
              })
              .strict(),
          })
          .strict(),
        questionSelection: z
          .object({
            strategy: z.literal("highest_priority_missing_field"),
            avoidRepeatingAnsweredFields: z.boolean(),
          })
          .strict(),
        sourceConflict: z
          .object({
            strategy: z.literal("ask_customer"),
            showBothValues: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    suppliers: z
      .object({
        defaultCount: z.number().int().positive(),
        defaultParallelism: z.number().int().positive(),
        maxCount: z.number().int().positive(),
        discovery: z
          .object({
            adapterKey: z.string().min(1),
            queryInputs: z.array(pointer),
            eligibilityRuleIds: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
    offer: z
      .object({
        schema: jsonObject,
        fields: z.array(
          z
            .object({
              path: pointer,
              label: z.string().min(1),
              priority: z.number().int(),
              questions: localizedQuestions,
            })
            .strict(),
        ),
        lineItems: z
          .object({
            enabled: z.boolean(),
            path: pointer,
            catalog: z.array(
              z
                .object({
                  key: z.string().min(1),
                  label: z.string().min(1),
                  aliases: z.array(z.string()).default([]),
                })
                .strict(),
            ),
            unknownItemPolicy: z.enum(["reject", "allow_with_description"]),
          })
          .strict(),
        normalizers: z.array(
          z
            .object({
              functionKey: z.string().min(1),
              inputs: z.array(pointer),
              output: pointer,
            })
            .strict(),
        ),
        completion: z
          .object({
            mustBeKnown: z.array(pointer),
            terminalStatuses: z.array(z.string().min(1)).min(1),
          })
          .strict(),
        clarificationRules: z.array(rule),
        comparability: z
          .object({
            requiredPaths: z.array(pointer),
            ruleIds: z.array(z.string()),
            sameCurrencyRequired: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    negotiation: z
      .object({
        phases: z.array(z.string().min(1)).min(1),
        initialPhase: z.string().min(1),
        transitions: z.array(
          z
            .object({
              from: z.string(),
              to: z.string(),
              when: z.string().optional(),
            })
            .strict(),
        ),
        outcomes: z.array(z.string().min(1)).min(1),
        levers: z.array(
          z
            .object({
              id: z.string().min(1),
              factKey: z.string().min(1),
              allowedPhases: z.array(z.string()),
              discloseSupplierIdentity: z.boolean(),
              prompt: z.string().min(1),
            })
            .strict(),
        ),
        limits: z
          .object({
            maxConcessionRequests: z.number().int().nonnegative(),
            maxDurationSeconds: z.number().int().positive(),
          })
          .strict(),
      })
      .strict(),
    recommendation: z
      .object({
        eligibilityRules: z.array(rule),
        warningRules: z.array(rule),
        metrics: z.array(
          z
            .object({
              id: z.string().min(1),
              source: z.enum(["job", "offer"]),
              path: pointer,
              type: z.enum(["number", "boolean", "string"]),
            })
            .strict(),
        ),
        policies: z.array(
          z
            .object({
              id: z.string().min(1),
              ranking: z.array(
                z
                  .object({
                    metric: z.string(),
                    direction: z.enum(["asc", "desc"]),
                  })
                  .strict(),
              ),
            })
            .strict(),
        ),
        customerMaySelectNonRecommended: z.boolean(),
        requireExplicitCustomerSelection: z.boolean(),
      })
      .strict(),
    customerUpdates: z
      .object({
        materialEventTypes: z.array(z.string()),
        maxSilenceSeconds: z.number().int().positive(),
        noChangeAction: z.literal("skip_turn"),
        dedupeByEventSequence: z.boolean(),
      })
      .strict(),
    completion: z
      .object({
        reviewReadiness: z
          .object({
            mode: z.literal("all_ready_or_deadline"),
            minimumComparableOffers: z.number().int().positive(),
            deadlineSeconds: z.number().int().positive(),
            onDeadline: z.literal("review_available_offers"),
          })
          .strict(),
        keepSupplierCallsOpenUntilCustomerDecision: z.boolean(),
        winnerRequiresExplicitConfirmation: z.boolean(),
        notifyNonSelectedBeforeEnd: z.boolean(),
      })
      .strict(),
    presentation: jsonObject,
    extensions: jsonObject.default({}),
  })
  .strict();

export type UseCaseConfig = z.infer<typeof useCaseConfigSchema>;
export type ConfigRule = z.infer<typeof rule>;
