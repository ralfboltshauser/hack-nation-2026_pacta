import {
  evaluatePredicate,
  getPointer,
  type UseCaseConfig,
} from "@pacta/use-case-config";

import type { ComparableOffer } from "./types";

type OfferEvaluation = {
  offerRevisionId: string;
  supplierId: string;
  supplierName: string;
  eligible: boolean;
  blockers: string[];
  warnings: string[];
  metrics: Record<string, string | number | boolean | null>;
  rank: number | null;
};

export function compareOffers(
  config: UseCaseConfig,
  job: Record<string, unknown>,
  offers: ComparableOffer[],
) {
  const evaluations: OfferEvaluation[] = offers.map((offer) => {
    const sources = { job, offer: offer.data, session: {}, facts: {} };
    const blockers = config.recommendation.eligibilityRules
      .filter((rule) => evaluatePredicate(rule.when, sources))
      .map((rule) => rule.effect.reason ?? rule.id);
    const warnings = config.recommendation.warningRules
      .filter((rule) => evaluatePredicate(rule.when, sources))
      .map((rule) => rule.effect.warning ?? rule.effect.reason ?? rule.id);
    const metrics = Object.fromEntries(
      config.recommendation.metrics.map((metric) => {
        const source = metric.source === "job" ? job : offer.data;
        const value = getPointer(source, metric.path);
        return [
          metric.id,
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
            ? value
            : null,
        ];
      }),
    );
    return {
      offerRevisionId: offer.offerRevisionId,
      supplierId: offer.supplierId,
      supplierName: offer.supplierName,
      eligible: blockers.length === 0,
      blockers,
      warnings,
      metrics,
      rank: null,
    };
  });

  const policy = config.recommendation.policies[0];
  const eligible = evaluations.filter((evaluation) => evaluation.eligible);
  eligible.sort((left, right) => {
    for (const criterion of policy?.ranking ?? []) {
      const leftValue = left.metrics[criterion.metric];
      const rightValue = right.metrics[criterion.metric];
      if (
        typeof leftValue !== "number" ||
        typeof rightValue !== "number" ||
        leftValue === rightValue
      )
        continue;
      return criterion.direction === "asc"
        ? leftValue - rightValue
        : rightValue - leftValue;
    }
    return left.offerRevisionId.localeCompare(right.offerRevisionId);
  });
  eligible.forEach((evaluation, index) => {
    evaluation.rank = index + 1;
  });

  return {
    policyId: policy?.id ?? "none",
    recommendedOfferRevisionId: eligible[0]?.offerRevisionId ?? null,
    offers: evaluations,
  };
}
