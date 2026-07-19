const coverageFields = ["fuel", "tolls", "cargoInsurance"];
const coverageValues = new Set(["included", "excluded", "unknown"]);
const explicitAllInPattern =
  /\b(all[ -]?in|total (?:price|cost)|everything included|no (?:other|additional|extra) (?:charges|fees|costs))\b/i;
const directAffirmationPattern = /^(?:yes|yeah|yep|correct|exactly|that's right)[.!]?$/i;
const contextualAffirmationPattern =
  /^(?:yes|yeah|yep|correct|exactly|that's right)\b/i;
const carrierOutcomeValues = new Set([
  "quote_confirmed",
  "quote_submitted",
  "callback",
  "decline",
]);

function summarizeOffer(offer) {
  if (!offer) return null;
  return {
    amount: offer.amount,
    currency: offer.currency,
    all_in: offer.allIn,
    all_in_status: offer.allInStatus,
    all_in_basis: offer.allInBasis,
    scope_inherited_from_version: offer.scopeInheritedFromVersion,
    terms: offer.terms,
    coverage: offer.coverage,
  };
}

function money(amount, currency) {
  return new Intl.NumberFormat("en-CH", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function normalizedCoverageValue(value) {
  return coverageValues.has(value) ? value : "unknown";
}

function unresolvedCoverageFields(offer) {
  return coverageFields.filter(
    (field) => normalizedCoverageValue(offer?.coverage?.[field]) === "unknown",
  );
}

function comparisonScopeKey(offer) {
  return JSON.stringify([
    offer.currency,
    ...coverageFields.map((field) => normalizedCoverageValue(offer.coverage?.[field])),
  ]);
}

export function buildComparison(offers) {
  const candidates = offers.map((offer) => ({
    offer,
    blockers: [
      ...(!offer.allIn ? ["all_in_unconfirmed"] : []),
      ...unresolvedCoverageFields(offer).map((field) => `${field}_unknown`),
    ],
  }));
  const complete = candidates.filter((candidate) => candidate.blockers.length === 0);
  const scopes = new Set(complete.map((candidate) => comparisonScopeKey(candidate.offer)));

  let status = "collecting";
  let reason = "At least two complete offers with matching scope are required.";
  if (candidates.some((candidate) => candidate.blockers.length > 0)) {
    status = "blocked_incomplete";
    reason = "One or more offers still has unconfirmed or unknown terms.";
  } else if (scopes.size > 1) {
    status = "blocked_scope_mismatch";
    reason = "Complete offers have materially different coverage and cannot be headline-ranked.";
  } else if (complete.length >= 2) {
    status = "ready";
    reason = "All current offers are complete and share the same comparison scope.";
  }

  const ranked = status === "ready"
    ? complete
        .map((candidate) => candidate.offer)
        .sort((left, right) => left.amount - right.amount)
        .map((offer, index) => ({
          rank: index + 1,
          carrier_name: offer.carrierName,
          conversation_id: offer.conversationId,
          offer_version: offer.version,
          amount: offer.amount,
          currency: offer.currency,
          coverage: offer.coverage,
          evidence: offer.allInEvidence,
        }))
    : [];

  return {
    status,
    reason,
    evaluated_offer_count: candidates.length,
    blockers: candidates
      .filter((candidate) => candidate.blockers.length > 0)
      .map((candidate) => ({
        carrier_name: candidate.offer.carrierName,
        reasons: candidate.blockers,
      })),
    ranked_offers: ranked,
    recommended_offer: ranked[0] ?? null,
  };
}

export function normalizeCoverage(body) {
  return {
    fuel: normalizedCoverageValue(body.fuel_status),
    tolls: normalizedCoverageValue(body.tolls_status),
    cargoInsurance: normalizedCoverageValue(body.cargo_insurance_status),
  };
}

export function explicitlyConfirmedAllIn(status, evidence) {
  const exactWords = String(evidence ?? "").trim();
  return (
    status === "explicit_yes" &&
    (explicitAllInPattern.test(exactWords) || directAffirmationPattern.test(exactWords))
  );
}

export function lastUserMessageFromConversationHistory(value) {
  let history = value;
  if (typeof history === "string") {
    try {
      history = JSON.parse(history);
    } catch {
      return null;
    }
  }
  const entries = Array.isArray(history?.entries) ? history.entries : [];
  const latest = [...entries]
    .reverse()
    .find((entry) => entry?.role === "user" && typeof entry.message === "string");
  return latest?.message?.trim() || null;
}

function evidenceContainsAmount(evidence, amount) {
  const numericCandidates = String(evidence ?? "").match(/\d[\d\s,'’.]*/g) ?? [];
  return numericCandidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    return digits && Number(digits) === amount;
  });
}

function coverageIsUnchanged(left, right) {
  return coverageFields.every(
    (field) =>
      normalizedCoverageValue(left?.[field]) ===
      normalizedCoverageValue(right?.[field]),
  );
}

function mergeKnownCoverage(previousCoverage, submittedCoverage) {
  if (!previousCoverage) return submittedCoverage;
  return Object.fromEntries(
    coverageFields.map((field) => {
      const submitted = normalizedCoverageValue(submittedCoverage?.[field]);
      const previous = normalizedCoverageValue(previousCoverage?.[field]);
      return [field, submitted === "unknown" ? previous : submitted];
    }),
  );
}

export function resolveOfferScope({
  allInStatus,
  allInEvidence,
  submittedCoverage,
  previousOffer,
  amount,
  currency,
}) {
  // record_offer updates an existing carrier quote. A field omitted from a
  // revision must not erase a fact that was already verified in this call.
  const effectiveCoverage = mergeKnownCoverage(
    previousOffer?.currency === currency ? previousOffer.coverage : null,
    submittedCoverage,
  );

  if (explicitlyConfirmedAllIn(allInStatus, allInEvidence)) {
    return {
      allIn: true,
      allInStatus,
      allInBasis: "explicit_current_utterance",
      scopeInheritedFromVersion: null,
      coverage: effectiveCoverage,
    };
  }

  const isContextualPriceRevision =
    allInStatus === "explicit_yes" &&
    previousOffer?.allIn === true &&
    previousOffer.currency === currency &&
    previousOffer.amount !== amount &&
    contextualAffirmationPattern.test(String(allInEvidence ?? "").trim()) &&
    evidenceContainsAmount(allInEvidence, amount) &&
    coverageIsUnchanged(effectiveCoverage, previousOffer.coverage);

  if (isContextualPriceRevision) {
    return {
      allIn: true,
      allInStatus: "inherited_revision",
      allInBasis: "previous_offer_scope",
      scopeInheritedFromVersion: previousOffer.version ?? null,
      coverage: previousOffer.coverage,
    };
  }

  const isSamePriceScopeUpdate =
    previousOffer?.allIn === true &&
    previousOffer.currency === currency &&
    previousOffer.amount === amount &&
    allInStatus !== "explicit_no";

  if (isSamePriceScopeUpdate) {
    return {
      allIn: true,
      allInStatus: "inherited_scope_update",
      allInBasis: "previous_offer_scope",
      scopeInheritedFromVersion: previousOffer.version ?? null,
      coverage: effectiveCoverage,
    };
  }

  return {
    allIn: false,
    allInStatus,
    allInBasis: "unconfirmed",
    scopeInheritedFromVersion: null,
    coverage: effectiveCoverage,
  };
}

function coverageDifferences(left, right) {
  return coverageFields
    .map((field) => {
      const current = normalizedCoverageValue(left.coverage?.[field]);
      const competing = normalizedCoverageValue(right.coverage?.[field]);
      if (current === "unknown" || competing === "unknown") {
        return { field, current, competing, reason: "unresolved" };
      }
      if (current !== competing) {
        return { field, current, competing, reason: "mismatch" };
      }
      return null;
    })
    .filter(Boolean);
}

export function selectActionableCompetingOffer(currentOffer, offers) {
  if (!currentOffer) {
    return { offer: null, reason: "current_offer_missing", comparisonGap: null };
  }
  if (!currentOffer.allIn) {
    return { offer: null, reason: "current_offer_not_all_in", comparisonGap: null };
  }

  const candidates = offers
    .filter(
      (offer) =>
        offer.carrierName !== currentOffer.carrierName &&
        offer.currency === currentOffer.currency &&
        offer.allIn,
    )
    .sort((left, right) => left.amount - right.amount);

  if (candidates.length === 0) {
    return {
      offer: null,
      reason: "no_comparable_competing_offer",
      comparisonGap: null,
    };
  }

  const comparable = candidates.filter(
    (offer) => coverageDifferences(currentOffer, offer).length === 0,
  );
  if (comparable.length === 0) {
    const closest = candidates[0];
    const differences = coverageDifferences(currentOffer, closest);
    return {
      offer: null,
      reason: differences.some((difference) => difference.reason === "unresolved")
        ? "coverage_unresolved"
        : "coverage_mismatch",
      comparisonGap: {
        differences,
      },
    };
  }

  const better = comparable.find((offer) => offer.amount < currentOffer.amount);
  if (!better) {
    return { offer: null, reason: "current_offer_is_best", comparisonGap: null };
  }

  return { offer: better, reason: "better_competing_offer", comparisonGap: null };
}

export function validateCarrierOutcome(value) {
  if (!carrierOutcomeValues.has(value)) {
    throw new Error(`unsupported carrier outcome ${value}`);
  }
  return value;
}

export function carrierOutcomeInstruction(outcome) {
  if (outcome === "quote_submitted") {
    return (
      "Tell the carrier its quote was submitted to the shipper for review. " +
      "Do not say accepted, conditionally accepted, bound, booked, awarded, or selected."
    );
  }
  if (outcome === "quote_confirmed") {
    return (
      "Tell the carrier its quote is recorded as confirmed and remains under review. " +
      "Do not say it was submitted, accepted, bound, booked, awarded, or selected. Keep the call open."
    );
  }
  return "Acknowledge the structured outcome once and continue according to the carrier's request.";
}

export function buildMarketResult({
  carrierName,
  offers,
  marketVersion,
  leverageAlreadyPresented = false,
}) {
  const currentOffer = offers.find((offer) => offer.carrierName === carrierName) ?? null;
  let leverage = selectActionableCompetingOffer(currentOffer, offers);

  if (leverage.offer && leverageAlreadyPresented) {
    leverage = {
      offer: null,
      reason: "unchanged_leverage_already_presented",
      comparisonGap: null,
    };
  }

  let instruction;
  const currentUnknownFields = unresolvedCoverageFields(currentOffer);
  if (leverage.reason === "current_offer_missing") {
    instruction =
      "No current quote from this carrier is recorded. Ask for its concrete price before negotiating or mentioning another price.";
  } else if (leverage.reason === "current_offer_not_all_in") {
    instruction =
      "This carrier has not explicitly confirmed that the quote is the total price with no additional charges. Ask that yes-or-no question by itself. Then separately clarify fuel, tolls, and cargo insurance. Do not mention a competing price.";
  } else if (leverage.reason === "coverage_mismatch") {
    const fields = leverage.comparisonGap.differences.map((difference) => difference.field).join(", ");
    instruction =
      `The quote scopes differ on ${fields}, so headline prices are not comparable. Do not cite the competing price. Clarify or quantify those coverage differences first.`;
  } else if (leverage.reason === "coverage_unresolved") {
    const fields = leverage.comparisonGap.differences.map((difference) => difference.field).join(", ");
    instruction = currentUnknownFields.length > 0
      ? `This carrier's quote still has unknown coverage for ${currentUnknownFields.join(", ")}. Unknown never means matching. Do not cite the competing price. Clarify those fields first.`
      : `This carrier's quote is complete, but another live quote still has unresolved coverage for ${fields}. Do not cite the competing price and do not ask this carrier to clarify another carrier's terms. Say this quote is recorded and remains under review. Do not say it was submitted or accepted.`;
  } else if (leverage.reason === "no_comparable_competing_offer") {
    instruction = currentOffer?.allIn && currentUnknownFields.length === 0
      ? "This carrier's quote is complete and recorded, but no comparable competing offer exists yet. Do not mention another price. Say the quote remains under review; do not say it was submitted or accepted."
      : "No verified comparable competing all-in offer exists. Do not mention a competing price. Clarify this carrier's unknown terms.";
  } else if (leverage.reason === "current_offer_is_best") {
    instruction =
      "This carrier's current offer is already lower than every verified offer with matching coverage. Do not cite a higher competing price. You may ask whether there is further flexibility without naming another price.";
  } else if (leverage.reason === "unchanged_leverage_already_presented") {
    instruction =
      "You already presented this unchanged leverage. Do not repeat the competing price or ask the same question again. Address the carrier's objection: clarify or quantify coverage, request a revised offer, or record a quote confirmation, quote submission, callback, or decline.";
  } else {
    instruction =
      "A strictly lower verified offer with matching coverage exists. Use safe_leverage_phrase once and do not cite any other competing price.";
  }

  return {
    market_version: marketVersion,
    current_offer: summarizeOffer(currentOffer),
    leverage_available: Boolean(leverage.offer),
    leverage_reason: leverage.reason,
    comparison_gap: leverage.comparisonGap,
    best_competing_offer: leverage.offer
      ? { ...summarizeOffer(leverage.offer), verified: true }
      : null,
    safe_leverage_phrase: leverage.offer
      ? `I have a verified competing all-in offer with matching coverage of ${money(leverage.offer.amount, leverage.offer.currency)}. Can you beat it?`
      : null,
    instruction,
  };
}
