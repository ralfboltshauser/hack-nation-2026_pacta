import assert from "node:assert/strict";
import test from "node:test";
import {
  buildComparison,
  buildMarketResult,
  carrierOutcomeInstruction,
  explicitlyConfirmedAllIn,
  lastUserMessageFromConversationHistory,
  normalizeCoverage,
  resolveOfferScope,
  selectActionableCompetingOffer,
  validateCarrierOutcome,
} from "../lib/negotiation.mjs";

function offer(carrierName, amount, allIn = true, coverage = {}) {
  return {
    carrierName,
    amount,
    currency: "CHF",
    allIn,
    allInStatus: allIn ? "explicit_yes" : "unclear",
    coverage: {
      fuel: "included",
      tolls: "included",
      cargoInsurance: "excluded",
      ...coverage,
    },
    terms: allIn ? "fuel and tolls included" : "not specified",
  };
}

test("never uses a higher competing offer as leverage", () => {
  const atlas = offer("Atlas Freight", 1400);
  const result = buildMarketResult({
    carrierName: "Atlas Freight",
    offers: [atlas, offer("Bolt Logistics", 1650)],
    marketVersion: 2,
  });

  assert.equal(result.leverage_available, false);
  assert.equal(result.leverage_reason, "current_offer_is_best");
  assert.equal(result.best_competing_offer, null);
  assert.equal(result.safe_leverage_phrase, null);
  assert.match(result.instruction, /Do not cite a higher competing price/);
});

test("uses a strictly lower comparable all-in offer", () => {
  const result = buildMarketResult({
    carrierName: "Bolt Logistics",
    offers: [offer("Atlas Freight", 1500), offer("Bolt Logistics", 1650)],
    marketVersion: 2,
  });

  assert.equal(result.leverage_available, true);
  assert.equal(result.best_competing_offer.amount, 1500);
  assert.match(result.safe_leverage_phrase, /1'500/);
});

test("does not compare an unconfirmed quote against an all-in quote", () => {
  const atlas = offer("Atlas Freight", 1400, false);
  const selection = selectActionableCompetingOffer(atlas, [
    atlas,
    offer("Bolt Logistics", 1300),
  ]);

  assert.equal(selection.offer, null);
  assert.equal(selection.reason, "current_offer_not_all_in");
});

test("does not expose leverage before this carrier has quoted", () => {
  const result = buildMarketResult({
    carrierName: "Atlas Freight",
    offers: [offer("Bolt Logistics", 1500)],
    marketVersion: 1,
  });

  assert.equal(result.leverage_available, false);
  assert.equal(result.leverage_reason, "current_offer_missing");
  assert.equal(result.best_competing_offer, null);
});

test("does not treat a list of included services as explicit all-in confirmation", () => {
  assert.equal(explicitlyConfirmedAllIn("explicit_yes", "transport"), false);
  assert.equal(
    explicitlyConfirmedAllIn("explicit_yes", "transport plus insurance"),
    false,
  );
  assert.equal(
    explicitlyConfirmedAllIn("explicit_yes", "Yes, CHF 1,600 is all-in"),
    true,
  );
  assert.equal(explicitlyConfirmedAllIn("explicit_yes", "yes"), true);
  assert.equal(explicitlyConfirmedAllIn("unclear", "all-in"), false);
});

test("normalizes missing coverage fields to unknown", () => {
  assert.deepEqual(normalizeCoverage({ fuel_status: "included" }), {
    fuel: "included",
    tolls: "unknown",
    cargoInsurance: "unknown",
  });
});

test("blocks headline-price leverage when insurance coverage differs", () => {
  const result = buildMarketResult({
    carrierName: "Bolt Logistics",
    offers: [
      offer("Atlas Freight", 1500, true, { cargoInsurance: "excluded" }),
      offer("Bolt Logistics", 1600, true, { cargoInsurance: "included" }),
    ],
    marketVersion: 2,
  });

  assert.equal(result.leverage_available, false);
  assert.equal(result.leverage_reason, "coverage_mismatch");
  assert.equal(result.comparison_gap.differences[0].field, "cargoInsurance");
  assert.equal(result.comparison_gap.amount, undefined);
  assert.equal(result.comparison_gap.currency, undefined);
  assert.equal(result.comparison_gap.carrier_name, undefined);
  assert.doesNotMatch(JSON.stringify(result), /1500|Atlas Freight/);
  assert.match(result.instruction, /not comparable/i);
});

test("does not treat unknown coverage on both offers as verified matching", () => {
  const result = buildMarketResult({
    carrierName: "Bolt Logistics",
    offers: [
      offer("Atlas Freight", 1500, true, { cargoInsurance: "unknown" }),
      offer("Bolt Logistics", 1650, true, { cargoInsurance: "unknown" }),
    ],
    marketVersion: 2,
  });

  assert.equal(result.leverage_available, false);
  assert.equal(result.leverage_reason, "coverage_unresolved");
  assert.deepEqual(result.comparison_gap.differences[0], {
    field: "cargoInsurance",
    current: "unknown",
    competing: "unknown",
    reason: "unresolved",
  });
  assert.match(result.instruction, /Unknown never means matching/);
});

test("inherits verified scope for an affirmative price-only revision", () => {
  const previousOffer = {
    ...offer("Bolt Logistics", 1650),
    version: 2,
  };
  const result = resolveOfferScope({
    allInStatus: "explicit_yes",
    allInEvidence: "yes let's do 1450",
    submittedCoverage: previousOffer.coverage,
    previousOffer,
    amount: 1450,
    currency: "CHF",
  });

  assert.equal(result.allIn, true);
  assert.equal(result.allInStatus, "inherited_revision");
  assert.equal(result.allInBasis, "previous_offer_scope");
  assert.equal(result.scopeInheritedFromVersion, 2);
  assert.deepEqual(result.coverage, previousOffer.coverage);
});

test("does not inherit scope when a revised offer changes coverage", () => {
  const previousOffer = {
    ...offer("Bolt Logistics", 1650),
    version: 2,
  };
  const result = resolveOfferScope({
    allInStatus: "explicit_yes",
    allInEvidence: "yes let's do 1450 but tolls are extra",
    submittedCoverage: { ...previousOffer.coverage, tolls: "excluded" },
    previousOffer,
    amount: 1450,
    currency: "CHF",
  });

  assert.equal(result.allIn, false);
  assert.equal(result.allInBasis, "unconfirmed");
  assert.equal(result.scopeInheritedFromVersion, null);
});

test("a quote update does not erase previously verified coverage when a field is omitted", () => {
  const previousOffer = {
    ...offer("Atlas Freight", 1500, true, { cargoInsurance: "excluded" }),
    version: 1,
  };
  const result = resolveOfferScope({
    allInStatus: "explicit_yes",
    allInEvidence: "our revised all-in offer is CHF 1,400, including fuel and tolls",
    submittedCoverage: {
      fuel: "included",
      tolls: "included",
      cargoInsurance: "unknown",
    },
    previousOffer,
    amount: 1400,
    currency: "CHF",
  });

  assert.equal(result.allIn, true);
  assert.equal(result.coverage.cargoInsurance, "excluded");
});

test("does not repeat unchanged leverage after it was already presented", () => {
  const result = buildMarketResult({
    carrierName: "Bolt Logistics",
    offers: [offer("Atlas Freight", 1500), offer("Bolt Logistics", 1650)],
    marketVersion: 2,
    leverageAlreadyPresented: true,
  });

  assert.equal(result.leverage_available, false);
  assert.equal(result.leverage_reason, "unchanged_leverage_already_presented");
  assert.equal(result.safe_leverage_phrase, null);
  assert.match(result.instruction, /Do not repeat/);
});

test("carrier-side outcomes cannot conditionally accept an offer", () => {
  assert.equal(validateCarrierOutcome("quote_submitted"), "quote_submitted");
  assert.throws(
    () => validateCarrierOutcome("conditional_acceptance"),
    /unsupported carrier outcome/,
  );
  assert.match(carrierOutcomeInstruction("quote_submitted"), /submitted/i);
  assert.match(carrierOutcomeInstruction("quote_submitted"), /Do not say accepted/);
  assert.match(carrierOutcomeInstruction("quote_confirmed"), /remains under review/);
  assert.match(carrierOutcomeInstruction("quote_confirmed"), /Do not say it was submitted/);
});

test("uses the platform conversation history as authoritative user evidence", () => {
  const history = JSON.stringify({
    "x-elevenlabs-history": true,
    entries: [
      { role: "user", message: "CHF 1,650 all-in" },
      { role: "agent", message: "Can you beat CHF 1,500?" },
      { role: "user", message: "yes let's do 1450" },
    ],
  });
  assert.equal(
    lastUserMessageFromConversationHistory(history),
    "yes let's do 1450",
  );
  assert.equal(lastUserMessageFromConversationHistory("not json"), null);
});

test("inherits all-in scope while updating coverage at the same price", () => {
  const previousOffer = {
    ...offer("Atlas Freight", 1500, true, { cargoInsurance: "unknown" }),
    version: 1,
  };
  const result = resolveOfferScope({
    allInStatus: "explicit_yes",
    allInEvidence: "no",
    submittedCoverage: { ...previousOffer.coverage, cargoInsurance: "excluded" },
    previousOffer,
    amount: 1500,
    currency: "CHF",
  });

  assert.equal(result.allIn, true);
  assert.equal(result.allInStatus, "inherited_scope_update");
  assert.equal(result.allInBasis, "previous_offer_scope");
  assert.equal(result.coverage.cargoInsurance, "excluded");
});

test("ranks and recommends only complete offers with identical scope", () => {
  const result = buildComparison([
    offer("Atlas Freight", 1500, true, { cargoInsurance: "excluded" }),
    offer("Bolt Logistics", 1450, true, { cargoInsurance: "excluded" }),
  ]);

  assert.equal(result.status, "ready");
  assert.equal(result.ranked_offers[0].carrier_name, "Bolt Logistics");
  assert.equal(result.ranked_offers[1].carrier_name, "Atlas Freight");
  assert.equal(result.recommended_offer.amount, 1450);
});

test("does not recommend the cheapest headline when complete scopes differ", () => {
  const result = buildComparison([
    offer("Atlas Freight", 1400, true, { cargoInsurance: "excluded" }),
    offer("Bolt Logistics", 1500, true, { cargoInsurance: "included" }),
  ]);

  assert.equal(result.status, "blocked_scope_mismatch");
  assert.equal(result.ranked_offers.length, 0);
  assert.equal(result.recommended_offer, null);
});

test("does not recommend while any offer has unresolved comparison terms", () => {
  const result = buildComparison([
    offer("Atlas Freight", 1500, true, { cargoInsurance: "excluded" }),
    offer("Bolt Logistics", 1450, true, { cargoInsurance: "unknown" }),
  ]);

  assert.equal(result.status, "blocked_incomplete");
  assert.deepEqual(result.blockers, [
    { carrier_name: "Bolt Logistics", reasons: ["cargoInsurance_unknown"] },
  ]);
  assert.equal(result.recommended_offer, null);
});

test("does not claim submission when only another call has unresolved coverage", () => {
  const result = buildMarketResult({
    carrierName: "Atlas Freight",
    offers: [
      offer("Atlas Freight", 1500, true, { cargoInsurance: "excluded" }),
      offer("Bolt Logistics", 1650, true, { cargoInsurance: "unknown" }),
    ],
    marketVersion: 2,
  });

  assert.equal(result.leverage_reason, "coverage_unresolved");
  assert.match(result.instruction, /quote is complete/);
  assert.match(result.instruction, /remains under review/);
  assert.match(result.instruction, /do not say it was submitted/i);
});
