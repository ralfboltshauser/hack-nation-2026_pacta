import { z } from "zod";

export const negotiatorStyles = [
  "tough_negotiator",
  "lowballer_with_hidden_fees",
  "hard_sell_upseller",
] as const;

export const negotiatorStyleSchema = z.enum(negotiatorStyles);

export type NegotiatorStyle = z.infer<typeof negotiatorStyleSchema>;

export type NegotiatorStylePlaybook = {
  label: string;
  detection: string;
  objective: string;
  actions: readonly string[];
  avoid: string;
};

export const negotiatorStylePlaybooks: Record<
  NegotiatorStyle,
  NegotiatorStylePlaybook
> = {
  tough_negotiator: {
    label: "Tough negotiator",
    detection:
      "Gruff or terse replies, refusal to quote by phone, repeated brush-offs, or a firm-position stance before the commercial scope is complete.",
    objective:
      "Lower friction and earn one decision-ready, all-in quote without matching the supplier's aggression.",
    actions: [
      "Acknowledge the supplier's time once, then use short, closed questions.",
      "Explain the concrete exchange: a firm comparable quote can be considered now.",
      "If they refuse phone pricing, ask for the minimum approved channel or person that can provide a firm quote while keeping this call moving.",
      "Ask for one concrete concession at a time and use only verified anonymous leverage.",
    ],
    avoid:
      "Do not mirror hostility, over-explain, threaten, or invent urgency or competitor terms.",
  },
  lowballer_with_hidden_fees: {
    label: "Lowballer with hidden fees",
    detection:
      "A low headline price paired with omitted, deferred, conditional, or hedged fees, inclusions, coverage, or service terms.",
    objective:
      "Convert the headline into a firm all-in offer whose scope can be compared safely.",
    actions: [
      "Pause price bargaining until every configured cost and scope field is explicit.",
      "Ask whether fuel, tolls, accessorials, coverage, and other configured items are included, excluded, or still unknown.",
      "Read back the all-in total together with conditions and exclusions before treating it as comparable.",
      "Negotiate the normalized all-in offer, not the attractive headline number.",
    ],
    avoid:
      "Do not praise, repeat, compare, or submit a headline price as though it were complete.",
  },
  hard_sell_upseller: {
    label: "Hard-sell upseller",
    detection:
      "Pressure, artificial urgency, or repeated attempts to redirect the confirmed baseline request toward upgrades, bundles, or premium extras.",
    objective:
      "Keep the negotiation anchored to the confirmed job while separating optional value from the comparable baseline.",
    actions: [
      "Restate the confirmed baseline scope and ask for its standalone firm all-in price first.",
      "Separate each optional upgrade and its incremental price from the baseline offer.",
      "Ask for a concrete validity deadline instead of accepting vague urgency.",
      "Consider an upgrade only after the baseline is complete and only when it serves a confirmed customer need.",
    ],
    avoid:
      "Do not let pressure, scarcity claims, or bundled extras silently change the confirmed job or comparison scope.",
  },
};

export function negotiatorStylePromptGuide() {
  return negotiatorStyles
    .map((style) => {
      const playbook = negotiatorStylePlaybooks[style];
      return `## ${playbook.label} (${style})\nEvidence: ${playbook.detection}\nObjective: ${playbook.objective}\nActions:\n${playbook.actions.map((action) => `- ${action}`).join("\n")}\nAvoid: ${playbook.avoid}`;
    })
    .join("\n\n");
}
