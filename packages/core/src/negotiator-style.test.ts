import { describe, expect, it } from "vitest";

import {
  negotiatorStylePlaybooks,
  negotiatorStylePromptGuide,
  negotiatorStyles,
} from "./negotiator-style";

describe("negotiator style playbooks", () => {
  it("covers the three explicit counterparty tactics", () => {
    expect(negotiatorStyles).toEqual([
      "tough_negotiator",
      "lowballer_with_hidden_fees",
      "hard_sell_upseller",
    ]);
  });

  it.each(negotiatorStyles)("gives %s an actionable strategy", (style) => {
    const playbook = negotiatorStylePlaybooks[style];
    expect(playbook.detection.length).toBeGreaterThan(20);
    expect(playbook.objective.length).toBeGreaterThan(20);
    expect(playbook.actions.length).toBeGreaterThanOrEqual(3);
    expect(playbook.avoid.length).toBeGreaterThan(20);
  });

  it("renders every style into the supplier system-prompt guide", () => {
    const guide = negotiatorStylePromptGuide();
    for (const style of negotiatorStyles) expect(guide).toContain(style);
  });
});
