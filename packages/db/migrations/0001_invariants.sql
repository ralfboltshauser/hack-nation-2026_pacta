CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_current_revision_fk" FOREIGN KEY ("current_revision_id") REFERENCES "job_revisions"("id") DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_confirmed_revision_fk" FOREIGN KEY ("confirmed_revision_id") REFERENCES "job_revisions"("id") DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_current_revision_fk" FOREIGN KEY ("current_revision_id") REFERENCES "offer_revisions"("id") DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "job_revisions" ADD CONSTRAINT "job_revisions_source_conversation_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "conversations"("id");
--> statement-breakpoint
ALTER TABLE "job_revisions" ADD CONSTRAINT "job_revisions_tool_invocation_fk" FOREIGN KEY ("created_by_tool_invocation_id") REFERENCES "tool_invocations"("id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "job_revisions" ADD CONSTRAINT "job_revisions_turn_execution_fk" FOREIGN KEY ("created_by_turn_execution_id") REFERENCES "conversation_turn_executions"("id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "job_confirmations" ADD CONSTRAINT "job_confirmations_source_conversation_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "conversations"("id");
--> statement-breakpoint
ALTER TABLE "job_confirmations" ADD CONSTRAINT "job_confirmations_source_turn_fk" FOREIGN KEY ("source_conversation_turn_id") REFERENCES "conversation_turns"("id");
--> statement-breakpoint
ALTER TABLE "session_suppliers" ADD CONSTRAINT "session_suppliers_closeout_conversation_fk" FOREIGN KEY ("closeout_conversation_id") REFERENCES "conversations"("id");
--> statement-breakpoint
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_tool_invocation_fk" FOREIGN KEY ("created_by_tool_invocation_id") REFERENCES "tool_invocations"("id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_causation_fk" FOREIGN KEY ("causation_event_id") REFERENCES "session_events"("id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.pacta_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER parties_set_updated_at BEFORE UPDATE ON "parties" FOR EACH ROW EXECUTE FUNCTION public.pacta_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER sessions_set_updated_at BEFORE UPDATE ON "sessions" FOR EACH ROW EXECUTE FUNCTION public.pacta_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER jobs_set_updated_at BEFORE UPDATE ON "jobs" FOR EACH ROW EXECUTE FUNCTION public.pacta_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER session_suppliers_set_updated_at BEFORE UPDATE ON "session_suppliers" FOR EACH ROW EXECUTE FUNCTION public.pacta_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER negotiations_set_updated_at BEFORE UPDATE ON "negotiations" FOR EACH ROW EXECUTE FUNCTION public.pacta_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER conversations_set_updated_at BEFORE UPDATE ON "conversations" FOR EACH ROW EXECUTE FUNCTION public.pacta_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER conversation_turns_set_updated_at BEFORE UPDATE ON "conversation_turns" FOR EACH ROW EXECUTE FUNCTION public.pacta_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER turn_executions_set_updated_at BEFORE UPDATE ON "conversation_turn_executions" FOR EACH ROW EXECUTE FUNCTION public.pacta_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER offers_set_updated_at BEFORE UPDATE ON "offers" FOR EACH ROW EXECUTE FUNCTION public.pacta_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER awards_set_updated_at BEFORE UPDATE ON "awards" FOR EACH ROW EXECUTE FUNCTION public.pacta_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER session_actions_set_updated_at BEFORE UPDATE ON "session_actions" FOR EACH ROW EXECUTE FUNCTION public.pacta_set_updated_at();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.pacta_protect_published_config()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'published' THEN
    RAISE EXCEPTION 'published use-case configurations cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' AND (
    NEW.document IS DISTINCT FROM OLD.document OR
    NEW.contract_version IS DISTINCT FROM OLD.contract_version OR
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 OR
    NEW.use_case_id IS DISTINCT FROM OLD.use_case_id OR
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
  ) THEN
    RAISE EXCEPTION 'published use-case configuration content is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER use_case_config_versions_protect_published BEFORE UPDATE OR DELETE ON "use_case_config_versions" FOR EACH ROW EXECUTE FUNCTION public.pacta_protect_published_config();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.pacta_reject_fact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER job_revisions_append_only BEFORE UPDATE OR DELETE ON "job_revisions" FOR EACH ROW EXECUTE FUNCTION public.pacta_reject_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER offer_revisions_append_only BEFORE UPDATE OR DELETE ON "offer_revisions" FOR EACH ROW EXECUTE FUNCTION public.pacta_reject_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER job_confirmations_append_only BEFORE UPDATE OR DELETE ON "job_confirmations" FOR EACH ROW EXECUTE FUNCTION public.pacta_reject_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER session_events_append_only BEFORE UPDATE OR DELETE ON "session_events" FOR EACH ROW EXECUTE FUNCTION public.pacta_reject_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER comparison_runs_append_only BEFORE UPDATE OR DELETE ON "comparison_runs" FOR EACH ROW EXECUTE FUNCTION public.pacta_reject_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER comparison_run_offers_append_only BEFORE UPDATE OR DELETE ON "comparison_run_offers" FOR EACH ROW EXECUTE FUNCTION public.pacta_reject_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER customer_decisions_append_only BEFORE UPDATE OR DELETE ON "customer_decisions" FOR EACH ROW EXECUTE FUNCTION public.pacta_reject_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER evidence_append_only BEFORE UPDATE OR DELETE ON "evidence" FOR EACH ROW EXECUTE FUNCTION public.pacta_reject_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER job_revision_evidence_append_only BEFORE UPDATE OR DELETE ON "job_revision_evidence" FOR EACH ROW EXECUTE FUNCTION public.pacta_reject_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER offer_revision_evidence_append_only BEFORE UPDATE OR DELETE ON "offer_revision_evidence" FOR EACH ROW EXECUTE FUNCTION public.pacta_reject_fact_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.pacta_validate_job_revision_pointers()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM job_revisions r WHERE r.id = NEW.current_revision_id AND r.job_id = NEW.id AND r.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'current job revision must belong to the same job and workspace';
  END IF;
  IF NEW.confirmed_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM job_revisions r WHERE r.id = NEW.confirmed_revision_id AND r.job_id = NEW.id AND r.workspace_id = NEW.workspace_id AND r.validation_status = 'valid'
  ) THEN
    RAISE EXCEPTION 'confirmed job revision must be valid and belong to the same job and workspace';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER jobs_validate_revision_pointers BEFORE INSERT OR UPDATE OF current_revision_id, confirmed_revision_id ON "jobs" FOR EACH ROW EXECUTE FUNCTION public.pacta_validate_job_revision_pointers();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.pacta_validate_offer_revision_pointer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM offer_revisions r WHERE r.id = NEW.current_revision_id AND r.offer_id = NEW.id AND r.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'current offer revision must belong to the same offer and workspace';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER offers_validate_revision_pointer BEFORE INSERT OR UPDATE OF current_revision_id ON "offers" FOR EACH ROW EXECUTE FUNCTION public.pacta_validate_offer_revision_pointer();
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workspaces', 'use_cases', 'use_case_config_versions', 'parties', 'sessions', 'jobs',
    'job_revisions', 'job_confirmations', 'session_suppliers', 'negotiations', 'conversations',
    'conversation_turns', 'conversation_turn_executions', 'offers', 'offer_revisions',
    'leverage_facts', 'context_injections', 'comparison_runs', 'comparison_run_offers',
    'customer_decisions', 'awards', 'session_events', 'tool_invocations', 'session_actions',
    'artifacts', 'evidence', 'job_revision_evidence', 'offer_revision_evidence'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END;
$$;
