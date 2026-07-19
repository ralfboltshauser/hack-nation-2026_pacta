export const sessionStatuses = [
  "draft",
  "intake",
  "customer_intake",
  "awaiting_customer_confirmation",
  "sourcing",
  "negotiating",
  "reviewing_offers",
  "committing",
  "closing",
  "completed",
  "failed",
  "cancelled",
] as const;

export type SessionStatus = (typeof sessionStatuses)[number];

export const conversationStatuses = [
  "created",
  "initiating",
  "initiated",
  "dialing",
  "connected",
  "in_progress",
  "holding",
  "ended",
  "failed",
  "initiation_unknown",
] as const;

export type ConversationStatus = (typeof conversationStatuses)[number];

export type SessionEvent<T = Record<string, unknown>> = {
  id: string;
  sessionId: string;
  eventSeq: number;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  payload: T;
};

export type StructuredDocumentRevision = {
  data: Record<string, unknown>;
  valid: boolean;
  missingRequiredPaths: string[];
  validationErrors: unknown[];
};

export type ComparableOffer = {
  offerRevisionId: string;
  supplierId: string;
  supplierName: string;
  data: Record<string, unknown>;
};
