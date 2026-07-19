import type { SessionEvent } from "./types";

export type SessionProjection = {
  lastEventSeq: number;
  status: string;
  currentEvent: string;
  customer: { status: string };
  suppliers: Record<
    string,
    { status: string; name?: string; offer?: Record<string, unknown> }
  >;
  selectedOfferRevisionId: string | null;
};

export const emptySessionProjection: SessionProjection = {
  lastEventSeq: 0,
  status: "draft",
  currentEvent: "Ready",
  customer: { status: "idle" },
  suppliers: {},
  selectedOfferRevisionId: null,
};

export function applySessionEvent(
  projection: SessionProjection,
  event: SessionEvent,
): SessionProjection {
  if (event.eventSeq <= projection.lastEventSeq) return projection;
  if (event.eventSeq !== projection.lastEventSeq + 1) {
    throw new Error(
      `Session event gap: expected ${projection.lastEventSeq + 1}, received ${event.eventSeq}`,
    );
  }
  const next = structuredClone(projection);
  next.lastEventSeq = event.eventSeq;
  next.currentEvent =
    typeof event.payload.label === "string"
      ? event.payload.label
      : event.eventType;

  if (event.eventType === "session.started") next.status = "intake";
  if (event.eventType === "job.confirmed") next.status = "sourcing";
  if (event.eventType === "session.completed") next.status = "completed";
  if (event.eventType === "customer.offer_selected") {
    next.status = "committing";
    next.selectedOfferRevisionId =
      typeof event.payload.offerRevisionId === "string"
        ? event.payload.offerRevisionId
        : null;
  }
  if (event.eventType.startsWith("conversation.")) {
    const purpose = event.payload.purpose;
    const status = event.eventType.slice("conversation.".length);
    if (purpose === "customer_session") next.customer.status = status;
    if (
      purpose === "supplier_negotiation" &&
      typeof event.aggregateId === "string"
    ) {
      next.suppliers[event.aggregateId] ??= { status: "created" };
      next.suppliers[event.aggregateId]!.status = status;
      if (typeof event.payload.partyName === "string")
        next.suppliers[event.aggregateId]!.name = event.payload.partyName;
    }
  }
  if (
    event.eventType === "offer.revision_created" &&
    typeof event.payload.negotiationId === "string"
  ) {
    next.suppliers[event.payload.negotiationId] ??= { status: "connected" };
    next.suppliers[event.payload.negotiationId]!.offer = event.payload
      .offer as Record<string, unknown>;
  }
  return next;
}

export function replaySessionEvents(
  events: SessionEvent[],
  initial: SessionProjection = emptySessionProjection,
) {
  return [...events]
    .sort((left, right) => left.eventSeq - right.eventSeq)
    .reduce(applySessionEvent, structuredClone(initial));
}
