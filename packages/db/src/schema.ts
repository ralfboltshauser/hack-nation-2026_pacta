import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

const document = <T = Record<string, unknown>>(name: string) =>
  jsonb(name)
    .$type<T>()
    .notNull()
    .default(sql`'{}'::jsonb`);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_members_user_idx").on(table.userId),
    check(
      "workspace_members_role_check",
      sql`${table.role} in ('owner', 'operator', 'viewer')`,
    ),
  ],
);

export const useCases = pgTable(
  "use_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    key: text("key").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("use_cases_workspace_key_uidx").on(
      table.workspaceId,
      table.key,
    ),
    index("use_cases_workspace_idx").on(table.workspaceId),
  ],
);

export const useCaseConfigVersions = pgTable(
  "use_case_config_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    useCaseId: uuid("use_case_id")
      .notNull()
      .references(() => useCases.id),
    contractVersion: text("contract_version").notNull(),
    version: text("version").notNull(),
    contentSha256: text("content_sha256").notNull(),
    document: document("document"),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("use_case_config_versions_version_uidx").on(
      table.useCaseId,
      table.version,
    ),
    uniqueIndex("use_case_config_versions_hash_uidx").on(
      table.useCaseId,
      table.contentSha256,
    ),
    index("use_case_config_versions_workspace_idx").on(table.workspaceId),
    check(
      "use_case_config_versions_status_check",
      sql`${table.status} in ('draft', 'published', 'retired')`,
    ),
  ],
);

export const parties = pgTable(
  "parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    roleKeys: text("role_keys")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    displayName: text("display_name").notNull(),
    phoneE164: text("phone_e164"),
    timezone: text("timezone"),
    locale: text("locale").notNull().default("en"),
    attributes: document("attributes"),
    externalRefs: document("external_refs"),
    ...timestamps,
  },
  (table) => [
    index("parties_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    useCaseConfigVersionId: uuid("use_case_config_version_id")
      .notNull()
      .references(() => useCaseConfigVersions.id),
    customerPartyId: uuid("customer_party_id")
      .notNull()
      .references(() => parties.id),
    status: text("status").notNull().default("draft"),
    rowVersion: integer("row_version").notNull().default(0),
    nextEventSeq: bigint("next_event_seq", { mode: "number" })
      .notNull()
      .default(0),
    data: document("data"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    ...timestamps,
  },
  (table) => [
    index("sessions_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("sessions_config_idx").on(table.useCaseConfigVersionId),
    check("sessions_row_version_check", sql`${table.rowVersion} >= 0`),
    check("sessions_next_event_seq_check", sql`${table.nextEventSeq} >= 0`),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    status: text("status").notNull().default("draft"),
    currentRevisionId: uuid("current_revision_id"),
    confirmedRevisionId: uuid("confirmed_revision_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("jobs_session_uidx").on(table.sessionId),
    index("jobs_workspace_idx").on(table.workspaceId),
  ],
);

export const jobRevisions = pgTable(
  "job_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    revisionNumber: integer("revision_number").notNull(),
    data: document("data"),
    validationStatus: text("validation_status").notNull(),
    missingRequiredPaths: text("missing_required_paths")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    validationErrors: jsonb("validation_errors")
      .$type<unknown[]>()
      .notNull()
      .default([]),
    sourceConversationId: uuid("source_conversation_id"),
    createdByToolInvocationId: uuid("created_by_tool_invocation_id"),
    createdByTurnExecutionId: uuid("created_by_turn_execution_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("job_revisions_job_number_uidx").on(
      table.jobId,
      table.revisionNumber,
    ),
    index("job_revisions_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    check("job_revisions_number_check", sql`${table.revisionNumber} > 0`),
    check(
      "job_revisions_one_creator_check",
      sql`num_nonnulls(${table.createdByToolInvocationId}, ${table.createdByTurnExecutionId}) <= 1`,
    ),
  ],
);

export const jobConfirmations = pgTable(
  "job_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    jobRevisionId: uuid("job_revision_id")
      .notNull()
      .references(() => jobRevisions.id),
    action: text("action").notNull(),
    sourceConversationId: uuid("source_conversation_id"),
    sourceConversationTurnId: uuid("source_conversation_turn_id"),
    statement: text("statement").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("job_confirmations_session_idx").on(table.sessionId, table.createdAt),
    check(
      "job_confirmations_action_check",
      sql`${table.action} in ('confirmed', 'revoked')`,
    ),
  ],
);

export const sessionSuppliers = pgTable(
  "session_suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    supplierPartyId: uuid("supplier_party_id")
      .notNull()
      .references(() => parties.id),
    priority: integer("priority").notNull().default(0),
    status: text("status").notNull().default("pending"),
    disposition: text("disposition"),
    dispositionReason: text("disposition_reason"),
    closeoutStatus: text("closeout_status").notNull().default("not_required"),
    closeoutConversationId: uuid("closeout_conversation_id"),
    discoveryData: document("discovery_data"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("session_suppliers_session_party_uidx").on(
      table.sessionId,
      table.supplierPartyId,
    ),
    index("session_suppliers_workspace_idx").on(table.workspaceId),
  ],
);

export const negotiations = pgTable(
  "negotiations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionSupplierId: uuid("session_supplier_id")
      .notNull()
      .references(() => sessionSuppliers.id),
    phaseKey: text("phase_key").notNull(),
    outcomeKey: text("outcome_key"),
    stateVersion: integer("state_version").notNull().default(0),
    data: document("data"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("negotiations_session_supplier_uidx").on(
      table.sessionSupplierId,
    ),
    index("negotiations_workspace_idx").on(table.workspaceId),
    check("negotiations_state_version_check", sql`${table.stateVersion} >= 0`),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    negotiationId: uuid("negotiation_id").references(() => negotiations.id),
    purposeKey: text("purpose_key").notNull(),
    channel: text("channel").notNull(),
    direction: text("direction"),
    provider: text("provider").notNull(),
    providerConversationId: text("provider_conversation_id"),
    providerCallId: text("provider_call_id"),
    agentId: text("agent_id"),
    agentVersionId: text("agent_version_id"),
    brainTokenHash: text("brain_token_hash").notNull(),
    brainTokenExpiresAt: timestamp("brain_token_expires_at", {
      withTimezone: true,
    }).notNull(),
    status: text("status").notNull().default("created"),
    endReason: text("end_reason"),
    lastContextEventSeq: bigint("last_context_event_seq", { mode: "number" })
      .notNull()
      .default(0),
    lastDeliveredEventSeq: bigint("last_delivered_event_seq", {
      mode: "number",
    })
      .notNull()
      .default(0),
    initiatedAt: timestamp("initiated_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    rawMetadata: document("raw_metadata"),
    ...timestamps,
  },
  (table) => [
    index("conversations_session_idx").on(table.sessionId, table.createdAt),
    uniqueIndex("conversations_provider_conversation_uidx")
      .on(table.provider, table.providerConversationId)
      .where(sql`${table.providerConversationId} is not null`),
    uniqueIndex("conversations_provider_call_uidx")
      .on(table.provider, table.providerCallId)
      .where(sql`${table.providerCallId} is not null`),
    uniqueIndex("conversations_brain_token_hash_uidx").on(table.brainTokenHash),
  ],
);

export const conversationTurns = pgTable(
  "conversation_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    providerTurnId: text("provider_turn_id"),
    ordinal: integer("ordinal"),
    role: text("role").notNull(),
    content: jsonb("content").$type<unknown>().notNull(),
    isFinal: boolean("is_final").notNull().default(true),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    providerOccurredAt: timestamp("provider_occurred_at", {
      withTimezone: true,
    }),
    rawEvent: jsonb("raw_event").$type<unknown>(),
    ...timestamps,
  },
  (table) => [
    index("conversation_turns_conversation_idx").on(
      table.conversationId,
      table.ordinal,
    ),
    uniqueIndex("conversation_turns_provider_turn_uidx")
      .on(table.conversationId, table.providerTurnId)
      .where(sql`${table.providerTurnId} is not null`),
  ],
);

export const conversationTurnExecutions = pgTable(
  "conversation_turn_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    provider: text("provider").notNull(),
    providerTurnKey: text("provider_turn_key"),
    inputFingerprint: text("input_fingerprint").notNull(),
    canonicalizationVersion: text("canonicalization_version").notNull(),
    logicalUserTurnKey: text("logical_user_turn_key"),
    reducesUserTurn: boolean("reduces_user_turn").notNull().default(false),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(1),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    conversationSnapshot: document("conversation_snapshot"),
    newUserTurnId: uuid("new_user_turn_id").references(
      () => conversationTurns.id,
    ),
    reducerVersion: text("reducer_version").notNull(),
    reducerOutput: jsonb("reducer_output").$type<unknown>(),
    contextEventSeq: bigint("context_event_seq", { mode: "number" }),
    responseText: text("response_text"),
    responseEnvelope: jsonb("response_envelope").$type<unknown>(),
    responseStream: text("response_stream"),
    abortReason: text("abort_reason"),
    timings: document("timings"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("turn_executions_provider_key_uidx")
      .on(table.provider, table.conversationId, table.providerTurnKey)
      .where(sql`${table.providerTurnKey} is not null`),
    uniqueIndex("turn_executions_fingerprint_uidx").on(
      table.provider,
      table.conversationId,
      table.inputFingerprint,
    ),
    uniqueIndex("turn_executions_logical_turn_uidx")
      .on(table.conversationId, table.logicalUserTurnKey)
      .where(
        sql`${table.reducesUserTurn} and ${table.logicalUserTurnKey} is not null`,
      ),
    index("turn_executions_session_idx").on(table.sessionId, table.createdAt),
    check(
      "turn_executions_attempt_count_check",
      sql`${table.attemptCount} > 0`,
    ),
  ],
);

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    negotiationId: uuid("negotiation_id")
      .notNull()
      .references(() => negotiations.id),
    variantKey: text("variant_key").notNull().default("default"),
    status: text("status").notNull().default("draft"),
    currentRevisionId: uuid("current_revision_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("offers_negotiation_variant_uidx").on(
      table.negotiationId,
      table.variantKey,
    ),
    index("offers_workspace_idx").on(table.workspaceId),
  ],
);

export const offerRevisions = pgTable(
  "offer_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id),
    revisionNumber: integer("revision_number").notNull(),
    data: document("data"),
    validationStatus: text("validation_status").notNull(),
    comparabilityStatus: text("comparability_status").notNull(),
    missingRequiredPaths: text("missing_required_paths")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    clarificationNeeds: jsonb("clarification_needs")
      .$type<unknown[]>()
      .notNull()
      .default([]),
    validationErrors: jsonb("validation_errors")
      .$type<unknown[]>()
      .notNull()
      .default([]),
    sourceConversationId: uuid("source_conversation_id")
      .notNull()
      .references(() => conversations.id),
    createdByToolInvocationId: uuid("created_by_tool_invocation_id"),
    createdByTurnExecutionId: uuid("created_by_turn_execution_id").references(
      () => conversationTurnExecutions.id,
    ),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("offer_revisions_offer_number_uidx").on(
      table.offerId,
      table.revisionNumber,
    ),
    index("offer_revisions_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    check("offer_revisions_number_check", sql`${table.revisionNumber} > 0`),
    check(
      "offer_revisions_one_creator_check",
      sql`num_nonnulls(${table.createdByToolInvocationId}, ${table.createdByTurnExecutionId}) <= 1`,
    ),
    check(
      "offer_revisions_comparability_check",
      sql`${table.comparabilityStatus} in ('incomplete', 'comparable', 'blocked')`,
    ),
  ],
);

export const leverageFacts = pgTable(
  "leverage_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    sourceNegotiationId: uuid("source_negotiation_id")
      .notNull()
      .references(() => negotiations.id),
    sourceOfferRevisionId: uuid("source_offer_revision_id")
      .notNull()
      .references(() => offerRevisions.id),
    factKey: text("fact_key").notNull(),
    payload: document("payload"),
    verificationStatus: text("verification_status").notNull(),
    shareability: text("shareability").notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("leverage_facts_session_idx").on(table.sessionId, table.createdAt),
    index("leverage_facts_source_offer_idx").on(table.sourceOfferRevisionId),
  ],
);

export const sessionEvents = pgTable(
  "session_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventSeq: bigint("event_seq", { mode: "number" }).notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    source: text("source").notNull(),
    idempotencyKey: text("idempotency_key"),
    causationEventId: uuid("causation_event_id"),
    correlationId: text("correlation_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    payload: document("payload"),
  },
  (table) => [
    uniqueIndex("session_events_session_seq_uidx").on(
      table.sessionId,
      table.eventSeq,
    ),
    uniqueIndex("session_events_workspace_idempotency_uidx")
      .on(table.workspaceId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("session_events_session_recorded_idx").on(
      table.sessionId,
      table.recordedAt,
    ),
    check("session_events_seq_check", sql`${table.eventSeq} > 0`),
  ],
);

export const contextInjections = pgTable(
  "context_injections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    targetConversationId: uuid("target_conversation_id")
      .notNull()
      .references(() => conversations.id),
    targetNegotiationId: uuid("target_negotiation_id").references(
      () => negotiations.id,
    ),
    leverageFactId: uuid("leverage_fact_id").references(() => leverageFacts.id),
    sourceEventId: uuid("source_event_id")
      .notNull()
      .references(() => sessionEvents.id),
    channel: text("channel").notNull(),
    payload: document("payload"),
    status: text("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    includedInExecutionId: uuid("included_in_execution_id").references(
      () => conversationTurnExecutions.id,
    ),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    error: jsonb("error").$type<unknown>(),
  },
  (table) => [
    index("context_injections_target_status_idx").on(
      table.targetConversationId,
      table.status,
      table.requestedAt,
    ),
  ],
);

export const comparisonRuns = pgTable(
  "comparison_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    useCaseConfigVersionId: uuid("use_case_config_version_id")
      .notNull()
      .references(() => useCaseConfigVersions.id),
    algorithmKey: text("algorithm_key").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    result: document("result"),
    recommendedOfferRevisionId: uuid(
      "recommended_offer_revision_id",
    ).references(() => offerRevisions.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("comparison_runs_session_idx").on(table.sessionId, table.createdAt),
  ],
);

export const comparisonRunOffers = pgTable(
  "comparison_run_offers",
  {
    comparisonRunId: uuid("comparison_run_id")
      .notNull()
      .references(() => comparisonRuns.id),
    offerRevisionId: uuid("offer_revision_id")
      .notNull()
      .references(() => offerRevisions.id),
    inputOrdinal: integer("input_ordinal").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.comparisonRunId, table.offerRevisionId] }),
    check(
      "comparison_run_offers_ordinal_check",
      sql`${table.inputOrdinal} >= 0`,
    ),
  ],
);

export const customerDecisions = pgTable(
  "customer_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    comparisonRunId: uuid("comparison_run_id")
      .notNull()
      .references(() => comparisonRuns.id),
    action: text("action").notNull(),
    selectedOfferRevisionId: uuid("selected_offer_revision_id").references(
      () => offerRevisions.id,
    ),
    reason: document("reason"),
    sourceConversationId: uuid("source_conversation_id").references(
      () => conversations.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("customer_decisions_session_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    check(
      "customer_decisions_action_check",
      sql`${table.action} in ('selected', 'confirmed', 'revoked', 'declined_all')`,
    ),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    kind: text("kind").notNull(),
    storageProvider: text("storage_provider").notNull(),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    sourcePartyId: uuid("source_party_id").references(() => parties.id),
    sourceConversationId: uuid("source_conversation_id").references(
      () => conversations.id,
    ),
    metadata: document("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("artifacts_object_uidx").on(
      table.storageProvider,
      table.bucket,
      table.objectKey,
    ),
    index("artifacts_session_idx").on(table.sessionId, table.createdAt),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    sourceArtifactId: uuid("source_artifact_id").references(() => artifacts.id),
    sourceConversationTurnId: uuid("source_conversation_turn_id").references(
      () => conversationTurns.id,
    ),
    locator: document("locator"),
    excerpt: text("excerpt"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("evidence_session_idx").on(table.sessionId, table.createdAt),
    check(
      "evidence_exactly_one_source_check",
      sql`num_nonnulls(${table.sourceArtifactId}, ${table.sourceConversationTurnId}) = 1`,
    ),
  ],
);

export const awards = pgTable(
  "awards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    selectedOfferRevisionId: uuid("selected_offer_revision_id")
      .notNull()
      .references(() => offerRevisions.id),
    supplierPartyId: uuid("supplier_party_id")
      .notNull()
      .references(() => parties.id),
    status: text("status").notNull(),
    agreedTerms: document("agreed_terms"),
    confirmationEvidenceId: uuid("confirmation_evidence_id").references(
      () => evidence.id,
    ),
    commitmentConversationId: uuid("commitment_conversation_id").references(
      () => conversations.id,
    ),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("awards_one_active_per_session_uidx")
      .on(table.sessionId)
      .where(sql`${table.status} in ('pending_commitment', 'confirmed')`),
    index("awards_workspace_idx").on(table.workspaceId),
  ],
);

export const toolInvocations = pgTable(
  "tool_invocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    negotiationId: uuid("negotiation_id").references(() => negotiations.id),
    provider: text("provider").notNull(),
    providerToolCallId: text("provider_tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    status: text("status").notNull(),
    request: jsonb("request").$type<unknown>().notNull(),
    response: jsonb("response").$type<unknown>(),
    error: jsonb("error").$type<unknown>(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("tool_invocations_provider_call_uidx").on(
      table.provider,
      table.providerToolCallId,
    ),
    index("tool_invocations_session_idx").on(table.sessionId, table.receivedAt),
  ],
);

export const sessionActions = pgTable(
  "session_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    actionType: text("action_type").notNull(),
    actionKey: text("action_key").notNull(),
    status: text("status").notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    request: document("request"),
    result: jsonb("result").$type<unknown>(),
    attemptCount: integer("attempt_count").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: jsonb("last_error").$type<unknown>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("session_actions_key_uidx").on(
      table.sessionId,
      table.actionKey,
    ),
    index("session_actions_status_idx").on(table.status, table.createdAt),
    check(
      "session_actions_attempt_count_check",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);

export const jobRevisionEvidence = pgTable(
  "job_revision_evidence",
  {
    jobRevisionId: uuid("job_revision_id")
      .notNull()
      .references(() => jobRevisions.id),
    jsonPointer: text("json_pointer").notNull(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id),
  },
  (table) => [
    primaryKey({
      columns: [table.jobRevisionId, table.jsonPointer, table.evidenceId],
    }),
  ],
);

export const offerRevisionEvidence = pgTable(
  "offer_revision_evidence",
  {
    offerRevisionId: uuid("offer_revision_id")
      .notNull()
      .references(() => offerRevisions.id),
    jsonPointer: text("json_pointer").notNull(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id),
  },
  (table) => [
    primaryKey({
      columns: [table.offerRevisionId, table.jsonPointer, table.evidenceId],
    }),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type SessionEventRow = typeof sessionEvents.$inferSelect;
