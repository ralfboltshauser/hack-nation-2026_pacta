CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_provider" text NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"source_party_id" uuid,
	"source_conversation_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"selected_offer_revision_id" uuid NOT NULL,
	"supplier_party_id" uuid NOT NULL,
	"status" text NOT NULL,
	"agreed_terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmation_evidence_id" uuid,
	"commitment_conversation_id" uuid,
	"committed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison_run_offers" (
	"comparison_run_id" uuid NOT NULL,
	"offer_revision_id" uuid NOT NULL,
	"input_ordinal" integer NOT NULL,
	CONSTRAINT "comparison_run_offers_comparison_run_id_offer_revision_id_pk" PRIMARY KEY("comparison_run_id","offer_revision_id"),
	CONSTRAINT "comparison_run_offers_ordinal_check" CHECK ("comparison_run_offers"."input_ordinal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "comparison_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"use_case_config_version_id" uuid NOT NULL,
	"algorithm_key" text NOT NULL,
	"algorithm_version" text NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recommended_offer_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_injections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"target_conversation_id" uuid NOT NULL,
	"target_negotiation_id" uuid,
	"leverage_fact_id" uuid,
	"source_event_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"included_in_execution_id" uuid,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error" jsonb
);
--> statement-breakpoint
CREATE TABLE "conversation_turn_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_turn_key" text,
	"input_fingerprint" text NOT NULL,
	"canonicalization_version" text NOT NULL,
	"logical_user_turn_key" text,
	"reduces_user_turn" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"conversation_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"new_user_turn_id" uuid,
	"reducer_version" text NOT NULL,
	"reducer_output" jsonb,
	"context_event_seq" bigint,
	"response_text" text,
	"response_envelope" jsonb,
	"response_stream" text,
	"abort_reason" text,
	"timings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turn_executions_attempt_count_check" CHECK ("conversation_turn_executions"."attempt_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "conversation_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"provider_turn_id" text,
	"ordinal" integer,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"is_final" boolean DEFAULT true NOT NULL,
	"start_ms" integer,
	"end_ms" integer,
	"provider_occurred_at" timestamp with time zone,
	"raw_event" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"negotiation_id" uuid,
	"purpose_key" text NOT NULL,
	"channel" text NOT NULL,
	"direction" text,
	"provider" text NOT NULL,
	"provider_conversation_id" text,
	"provider_call_id" text,
	"agent_id" text,
	"agent_version_id" text,
	"brain_token_hash" text NOT NULL,
	"brain_token_expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"end_reason" text,
	"last_context_event_seq" bigint DEFAULT 0 NOT NULL,
	"last_delivered_event_seq" bigint DEFAULT 0 NOT NULL,
	"initiated_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"raw_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"comparison_run_id" uuid NOT NULL,
	"action" text NOT NULL,
	"selected_offer_revision_id" uuid,
	"reason" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_decisions_action_check" CHECK ("customer_decisions"."action" in ('selected', 'confirmed', 'revoked', 'declined_all'))
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"source_artifact_id" uuid,
	"source_conversation_turn_id" uuid,
	"locator" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"excerpt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_exactly_one_source_check" CHECK (num_nonnulls("evidence"."source_artifact_id", "evidence"."source_conversation_turn_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "job_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"job_revision_id" uuid NOT NULL,
	"action" text NOT NULL,
	"source_conversation_id" uuid,
	"source_conversation_turn_id" uuid,
	"statement" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_confirmations_action_check" CHECK ("job_confirmations"."action" in ('confirmed', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "job_revision_evidence" (
	"job_revision_id" uuid NOT NULL,
	"json_pointer" text NOT NULL,
	"evidence_id" uuid NOT NULL,
	CONSTRAINT "job_revision_evidence_job_revision_id_json_pointer_evidence_id_pk" PRIMARY KEY("job_revision_id","json_pointer","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "job_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation_status" text NOT NULL,
	"missing_required_paths" text[] DEFAULT '{}'::text[] NOT NULL,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_conversation_id" uuid,
	"created_by_tool_invocation_id" uuid,
	"created_by_turn_execution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_revisions_number_check" CHECK ("job_revisions"."revision_number" > 0),
	CONSTRAINT "job_revisions_one_creator_check" CHECK (num_nonnulls("job_revisions"."created_by_tool_invocation_id", "job_revisions"."created_by_turn_execution_id") <= 1)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_revision_id" uuid,
	"confirmed_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leverage_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"source_negotiation_id" uuid NOT NULL,
	"source_offer_revision_id" uuid NOT NULL,
	"fact_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verification_status" text NOT NULL,
	"shareability" text NOT NULL,
	"valid_until" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "negotiations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_supplier_id" uuid NOT NULL,
	"phase_key" text NOT NULL,
	"outcome_key" text,
	"state_version" integer DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "negotiations_state_version_check" CHECK ("negotiations"."state_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "offer_revision_evidence" (
	"offer_revision_id" uuid NOT NULL,
	"json_pointer" text NOT NULL,
	"evidence_id" uuid NOT NULL,
	CONSTRAINT "offer_revision_evidence_offer_revision_id_json_pointer_evidence_id_pk" PRIMARY KEY("offer_revision_id","json_pointer","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "offer_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation_status" text NOT NULL,
	"comparability_status" text NOT NULL,
	"missing_required_paths" text[] DEFAULT '{}'::text[] NOT NULL,
	"clarification_needs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_conversation_id" uuid NOT NULL,
	"created_by_tool_invocation_id" uuid,
	"created_by_turn_execution_id" uuid,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_revisions_number_check" CHECK ("offer_revisions"."revision_number" > 0),
	CONSTRAINT "offer_revisions_one_creator_check" CHECK (num_nonnulls("offer_revisions"."created_by_tool_invocation_id", "offer_revisions"."created_by_turn_execution_id") <= 1),
	CONSTRAINT "offer_revisions_comparability_check" CHECK ("offer_revisions"."comparability_status" in ('incomplete', 'comparable', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"negotiation_id" uuid NOT NULL,
	"variant_key" text DEFAULT 'default' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"display_name" text NOT NULL,
	"phone_e164" text,
	"timezone" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"action_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text NOT NULL,
	"request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_actions_attempt_count_check" CHECK ("session_actions"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_seq" bigint NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"source" text NOT NULL,
	"idempotency_key" text,
	"causation_event_id" uuid,
	"correlation_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "session_events_seq_check" CHECK ("session_events"."event_seq" > 0)
);
--> statement-breakpoint
CREATE TABLE "session_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"supplier_party_id" uuid NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"disposition" text,
	"disposition_reason" text,
	"closeout_status" text DEFAULT 'not_required' NOT NULL,
	"closeout_conversation_id" uuid,
	"discovery_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"use_case_config_version_id" uuid NOT NULL,
	"customer_party_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"next_event_seq" bigint DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_row_version_check" CHECK ("sessions"."row_version" >= 0),
	CONSTRAINT "sessions_next_event_seq_check" CHECK ("sessions"."next_event_seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tool_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"negotiation_id" uuid,
	"provider" text NOT NULL,
	"provider_tool_call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"status" text NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"error" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "use_case_config_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"use_case_id" uuid NOT NULL,
	"contract_version" text NOT NULL,
	"version" text NOT NULL,
	"content_sha256" text NOT NULL,
	"document" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "use_case_config_versions_status_check" CHECK ("use_case_config_versions"."status" in ('draft', 'published', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "use_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_source_party_id_parties_id_fk" FOREIGN KEY ("source_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_selected_offer_revision_id_offer_revisions_id_fk" FOREIGN KEY ("selected_offer_revision_id") REFERENCES "public"."offer_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_supplier_party_id_parties_id_fk" FOREIGN KEY ("supplier_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_confirmation_evidence_id_evidence_id_fk" FOREIGN KEY ("confirmation_evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_commitment_conversation_id_conversations_id_fk" FOREIGN KEY ("commitment_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_run_offers" ADD CONSTRAINT "comparison_run_offers_comparison_run_id_comparison_runs_id_fk" FOREIGN KEY ("comparison_run_id") REFERENCES "public"."comparison_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_run_offers" ADD CONSTRAINT "comparison_run_offers_offer_revision_id_offer_revisions_id_fk" FOREIGN KEY ("offer_revision_id") REFERENCES "public"."offer_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_runs" ADD CONSTRAINT "comparison_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_runs" ADD CONSTRAINT "comparison_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_runs" ADD CONSTRAINT "comparison_runs_use_case_config_version_id_use_case_config_versions_id_fk" FOREIGN KEY ("use_case_config_version_id") REFERENCES "public"."use_case_config_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_runs" ADD CONSTRAINT "comparison_runs_recommended_offer_revision_id_offer_revisions_id_fk" FOREIGN KEY ("recommended_offer_revision_id") REFERENCES "public"."offer_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_injections" ADD CONSTRAINT "context_injections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_injections" ADD CONSTRAINT "context_injections_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_injections" ADD CONSTRAINT "context_injections_target_conversation_id_conversations_id_fk" FOREIGN KEY ("target_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_injections" ADD CONSTRAINT "context_injections_target_negotiation_id_negotiations_id_fk" FOREIGN KEY ("target_negotiation_id") REFERENCES "public"."negotiations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_injections" ADD CONSTRAINT "context_injections_leverage_fact_id_leverage_facts_id_fk" FOREIGN KEY ("leverage_fact_id") REFERENCES "public"."leverage_facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_injections" ADD CONSTRAINT "context_injections_source_event_id_session_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."session_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_injections" ADD CONSTRAINT "context_injections_included_in_execution_id_conversation_turn_executions_id_fk" FOREIGN KEY ("included_in_execution_id") REFERENCES "public"."conversation_turn_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turn_executions" ADD CONSTRAINT "conversation_turn_executions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turn_executions" ADD CONSTRAINT "conversation_turn_executions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turn_executions" ADD CONSTRAINT "conversation_turn_executions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turn_executions" ADD CONSTRAINT "conversation_turn_executions_new_user_turn_id_conversation_turns_id_fk" FOREIGN KEY ("new_user_turn_id") REFERENCES "public"."conversation_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_negotiation_id_negotiations_id_fk" FOREIGN KEY ("negotiation_id") REFERENCES "public"."negotiations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_decisions" ADD CONSTRAINT "customer_decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_decisions" ADD CONSTRAINT "customer_decisions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_decisions" ADD CONSTRAINT "customer_decisions_comparison_run_id_comparison_runs_id_fk" FOREIGN KEY ("comparison_run_id") REFERENCES "public"."comparison_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_decisions" ADD CONSTRAINT "customer_decisions_selected_offer_revision_id_offer_revisions_id_fk" FOREIGN KEY ("selected_offer_revision_id") REFERENCES "public"."offer_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_decisions" ADD CONSTRAINT "customer_decisions_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_source_artifact_id_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_source_conversation_turn_id_conversation_turns_id_fk" FOREIGN KEY ("source_conversation_turn_id") REFERENCES "public"."conversation_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_confirmations" ADD CONSTRAINT "job_confirmations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_confirmations" ADD CONSTRAINT "job_confirmations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_confirmations" ADD CONSTRAINT "job_confirmations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_confirmations" ADD CONSTRAINT "job_confirmations_job_revision_id_job_revisions_id_fk" FOREIGN KEY ("job_revision_id") REFERENCES "public"."job_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_revision_evidence" ADD CONSTRAINT "job_revision_evidence_job_revision_id_job_revisions_id_fk" FOREIGN KEY ("job_revision_id") REFERENCES "public"."job_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_revision_evidence" ADD CONSTRAINT "job_revision_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_revisions" ADD CONSTRAINT "job_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_revisions" ADD CONSTRAINT "job_revisions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leverage_facts" ADD CONSTRAINT "leverage_facts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leverage_facts" ADD CONSTRAINT "leverage_facts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leverage_facts" ADD CONSTRAINT "leverage_facts_source_negotiation_id_negotiations_id_fk" FOREIGN KEY ("source_negotiation_id") REFERENCES "public"."negotiations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leverage_facts" ADD CONSTRAINT "leverage_facts_source_offer_revision_id_offer_revisions_id_fk" FOREIGN KEY ("source_offer_revision_id") REFERENCES "public"."offer_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_session_supplier_id_session_suppliers_id_fk" FOREIGN KEY ("session_supplier_id") REFERENCES "public"."session_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_revision_evidence" ADD CONSTRAINT "offer_revision_evidence_offer_revision_id_offer_revisions_id_fk" FOREIGN KEY ("offer_revision_id") REFERENCES "public"."offer_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_revision_evidence" ADD CONSTRAINT "offer_revision_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_created_by_turn_execution_id_conversation_turn_executions_id_fk" FOREIGN KEY ("created_by_turn_execution_id") REFERENCES "public"."conversation_turn_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_negotiation_id_negotiations_id_fk" FOREIGN KEY ("negotiation_id") REFERENCES "public"."negotiations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_actions" ADD CONSTRAINT "session_actions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_actions" ADD CONSTRAINT "session_actions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_suppliers" ADD CONSTRAINT "session_suppliers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_suppliers" ADD CONSTRAINT "session_suppliers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_suppliers" ADD CONSTRAINT "session_suppliers_supplier_party_id_parties_id_fk" FOREIGN KEY ("supplier_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_use_case_config_version_id_use_case_config_versions_id_fk" FOREIGN KEY ("use_case_config_version_id") REFERENCES "public"."use_case_config_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_customer_party_id_parties_id_fk" FOREIGN KEY ("customer_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_negotiation_id_negotiations_id_fk" FOREIGN KEY ("negotiation_id") REFERENCES "public"."negotiations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "use_case_config_versions" ADD CONSTRAINT "use_case_config_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "use_case_config_versions" ADD CONSTRAINT "use_case_config_versions_use_case_id_use_cases_id_fk" FOREIGN KEY ("use_case_id") REFERENCES "public"."use_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "use_cases" ADD CONSTRAINT "use_cases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_object_uidx" ON "artifacts" USING btree ("storage_provider","bucket","object_key");--> statement-breakpoint
CREATE INDEX "artifacts_session_idx" ON "artifacts" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "awards_one_active_per_session_uidx" ON "awards" USING btree ("session_id") WHERE "awards"."status" in ('pending_commitment', 'confirmed');--> statement-breakpoint
CREATE INDEX "awards_workspace_idx" ON "awards" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "comparison_runs_session_idx" ON "comparison_runs" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "context_injections_target_status_idx" ON "context_injections" USING btree ("target_conversation_id","status","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "turn_executions_provider_key_uidx" ON "conversation_turn_executions" USING btree ("provider","conversation_id","provider_turn_key") WHERE "conversation_turn_executions"."provider_turn_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "turn_executions_fingerprint_uidx" ON "conversation_turn_executions" USING btree ("provider","conversation_id","input_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "turn_executions_logical_turn_uidx" ON "conversation_turn_executions" USING btree ("conversation_id","logical_user_turn_key") WHERE "conversation_turn_executions"."reduces_user_turn" and "conversation_turn_executions"."logical_user_turn_key" is not null;--> statement-breakpoint
CREATE INDEX "turn_executions_session_idx" ON "conversation_turn_executions" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_turns_conversation_idx" ON "conversation_turns" USING btree ("conversation_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turns_provider_turn_uidx" ON "conversation_turns" USING btree ("conversation_id","provider_turn_id") WHERE "conversation_turns"."provider_turn_id" is not null;--> statement-breakpoint
CREATE INDEX "conversations_session_idx" ON "conversations" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_provider_conversation_uidx" ON "conversations" USING btree ("provider","provider_conversation_id") WHERE "conversations"."provider_conversation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_provider_call_uidx" ON "conversations" USING btree ("provider","provider_call_id") WHERE "conversations"."provider_call_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_brain_token_hash_uidx" ON "conversations" USING btree ("brain_token_hash");--> statement-breakpoint
CREATE INDEX "customer_decisions_session_idx" ON "customer_decisions" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "evidence_session_idx" ON "evidence" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "job_confirmations_session_idx" ON "job_confirmations" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_revisions_job_number_uidx" ON "job_revisions" USING btree ("job_id","revision_number");--> statement-breakpoint
CREATE INDEX "job_revisions_workspace_created_idx" ON "job_revisions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_session_uidx" ON "jobs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "jobs_workspace_idx" ON "jobs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "leverage_facts_session_idx" ON "leverage_facts" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "leverage_facts_source_offer_idx" ON "leverage_facts" USING btree ("source_offer_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "negotiations_session_supplier_uidx" ON "negotiations" USING btree ("session_supplier_id");--> statement-breakpoint
CREATE INDEX "negotiations_workspace_idx" ON "negotiations" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_revisions_offer_number_uidx" ON "offer_revisions" USING btree ("offer_id","revision_number");--> statement-breakpoint
CREATE INDEX "offer_revisions_workspace_created_idx" ON "offer_revisions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_negotiation_variant_uidx" ON "offers" USING btree ("negotiation_id","variant_key");--> statement-breakpoint
CREATE INDEX "offers_workspace_idx" ON "offers" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "parties_workspace_created_idx" ON "parties" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_actions_key_uidx" ON "session_actions" USING btree ("session_id","action_key");--> statement-breakpoint
CREATE INDEX "session_actions_status_idx" ON "session_actions" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_events_session_seq_uidx" ON "session_events" USING btree ("session_id","event_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "session_events_workspace_idempotency_uidx" ON "session_events" USING btree ("workspace_id","idempotency_key") WHERE "session_events"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "session_events_session_recorded_idx" ON "session_events" USING btree ("session_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_suppliers_session_party_uidx" ON "session_suppliers" USING btree ("session_id","supplier_party_id");--> statement-breakpoint
CREATE INDEX "session_suppliers_workspace_idx" ON "session_suppliers" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "sessions_workspace_created_idx" ON "sessions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_config_idx" ON "sessions" USING btree ("use_case_config_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_invocations_provider_call_uidx" ON "tool_invocations" USING btree ("provider","provider_tool_call_id");--> statement-breakpoint
CREATE INDEX "tool_invocations_session_idx" ON "tool_invocations" USING btree ("session_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "use_case_config_versions_version_uidx" ON "use_case_config_versions" USING btree ("use_case_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "use_case_config_versions_hash_uidx" ON "use_case_config_versions" USING btree ("use_case_id","content_sha256");--> statement-breakpoint
CREATE INDEX "use_case_config_versions_workspace_idx" ON "use_case_config_versions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "use_cases_workspace_key_uidx" ON "use_cases" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "use_cases_workspace_idx" ON "use_cases" USING btree ("workspace_id");