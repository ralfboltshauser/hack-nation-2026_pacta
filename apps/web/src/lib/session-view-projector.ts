import type { SessionView, SessionViewSupplier } from "./session-view";

export type PartyState =
  "queued" | "ringing" | "live" | "quoted" | "selected" | "closed";

export type ProjectedSessionFrame = {
  phase: number;
  activity: string;
  customer: PartyState;
  customerName: string;
  customerRole: string;
  suppliers: Array<{
    id: string;
    name: string;
    role: string;
    state: PartyState;
    offer?: string;
    detail?: string;
  }>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function callState(status: string): PartyState {
  if (["initiating", "initiated", "dialing"].includes(status)) return "ringing";
  if (["connected", "in_progress", "holding"].includes(status)) return "live";
  if (["ended", "failed", "initiation_unknown"].includes(status))
    return "closed";
  return "queued";
}

function offerLabel(supplier: SessionViewSupplier) {
  const normalized = record(supplier.offerData.normalized);
  const pricing = record(supplier.offerData.pricing);
  const totalMinor =
    typeof normalized.totalMinor === "number"
      ? normalized.totalMinor
      : typeof pricing.allInTotalMinor === "number"
        ? pricing.allInTotalMinor
        : null;
  const currency =
    typeof pricing.currency === "string" ? pricing.currency : null;
  if (totalMinor === null) return undefined;
  if (!currency) return `${(totalMinor / 100).toLocaleString()} total`;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(totalMinor / 100);
  } catch {
    return `${currency} ${(totalMinor / 100).toLocaleString()}`;
  }
}

function supplierState(supplier: SessionViewSupplier): PartyState {
  if (supplier.selected) return "selected";
  const state = callState(supplier.conversationStatus);
  if (state === "closed") return state;
  if (supplier.offerRevisionId) return "quoted";
  return state;
}

function phase(status: string) {
  if (["sourcing", "negotiating"].includes(status)) return 1;
  if (["reviewing_offers", "committing"].includes(status)) return 2;
  if (["closing", "completed"].includes(status)) return 3;
  return 0;
}

const eventActivities: Record<string, string> = {
  "conversation.initiated": "A call is ringing",
  "conversation.connected": "A participant joined the negotiation",
  "conversation.ended": "A participant left the call",
  "conversation.initiation_failed": "A call could not be connected",
  "job.revision_created": "Updating the configured job",
  "offer.revision_created": "Normalizing a supplier offer",
  "customer.decision_recorded": "Recording the customer’s selection",
  "award.confirmed": "Supplier confirmed the exact terms",
  "session.completed": "Transaction complete",
};

export function projectSessionView(
  view: SessionView,
  latestEventType?: string,
): ProjectedSessionFrame {
  return {
    phase: phase(view.status),
    activity:
      latestEventType && eventActivities[latestEventType]
        ? eventActivities[latestEventType]
        : view.status.replaceAll("_", " "),
    customer: callState(view.customer.conversationStatus),
    customerName: view.customer.displayName,
    customerRole: view.customer.roleLabel,
    suppliers: view.suppliers.map((supplier) => {
      const offer = offerLabel(supplier);
      const detail = supplier.selected
        ? view.awardStatus === "confirmed"
          ? "Terms confirmed"
          : "Customer selected"
        : supplier.offerRevisionId
          ? supplier.offerStatus.replaceAll("_", " ")
          : undefined;
      return {
        id: supplier.negotiationId,
        name: supplier.displayName,
        role: supplier.roleLabel,
        state: supplierState(supplier),
        ...(offer ? { offer } : {}),
        ...(detail ? { detail } : {}),
      };
    }),
  };
}
