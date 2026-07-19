export type SessionViewParty = {
  partyId: string;
  conversationId: string;
  displayName: string;
  roleLabel: string;
  conversationStatus: string;
};

export type SessionViewSupplier = SessionViewParty & {
  negotiationId: string;
  negotiationPhase: string;
  negotiationOutcome: string | null;
  offerRevisionId: string | null;
  offerStatus: string;
  offerData: Record<string, unknown>;
  selected: boolean;
};

export type SessionView = {
  sessionId: string;
  status: string;
  job: {
    status: string;
    data: Record<string, unknown>;
    missingRequiredPaths: string[];
    confirmed: boolean;
  };
  customer: SessionViewParty;
  suppliers: SessionViewSupplier[];
  selectedOfferRevisionId: string | null;
  awardStatus: string | null;
};
