-- Evidence-backed CRM memory is append-only. A newer row with the same
-- (party, use case, memory key) supersedes an older observation without
-- rewriting what a prior conversation established.
CREATE TABLE "party_memory_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"use_case_id" uuid NOT NULL,
	"source_conversation_id" uuid NOT NULL,
	"category_key" text NOT NULL,
	"memory_key" text NOT NULL,
	"content" text NOT NULL,
	"evidence_statement" text NOT NULL,
	"observation_fingerprint" text NOT NULL,
	"supersedes_observation_id" uuid,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_memory_observations_category_check" CHECK ("party_memory_observations"."category_key" in ('communication_preference', 'commercial_preference', 'operating_capability', 'relationship_fact')),
	CONSTRAINT "party_memory_observations_key_check" CHECK ("party_memory_observations"."memory_key" ~ '^[a-z][a-z0-9_]{2,63}$'),
	CONSTRAINT "party_memory_observations_content_check" CHECK (char_length("party_memory_observations"."content") between 1 and 500),
	CONSTRAINT "party_memory_observations_evidence_check" CHECK (char_length("party_memory_observations"."evidence_statement") between 1 and 1000),
	CONSTRAINT "party_memory_observations_fingerprint_check" CHECK ("party_memory_observations"."observation_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "party_memory_observations" ADD CONSTRAINT "party_memory_observations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "party_memory_observations" ADD CONSTRAINT "party_memory_observations_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "party_memory_observations" ADD CONSTRAINT "party_memory_observations_use_case_id_use_cases_id_fk" FOREIGN KEY ("use_case_id") REFERENCES "public"."use_cases"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "party_memory_observations" ADD CONSTRAINT "party_memory_source_conversation_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "party_memory_observations" ADD CONSTRAINT "party_memory_supersedes_fk" FOREIGN KEY ("supersedes_observation_id") REFERENCES "public"."party_memory_observations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "party_memory_observations_fingerprint_uidx" ON "party_memory_observations" USING btree ("observation_fingerprint");
--> statement-breakpoint
CREATE INDEX "party_memory_observations_lookup_idx" ON "party_memory_observations" USING btree ("party_id", "use_case_id", "observed_at");
--> statement-breakpoint
CREATE INDEX "party_memory_observations_source_idx" ON "party_memory_observations" USING btree ("source_conversation_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.pacta_validate_party_memory_observation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.parties
    WHERE id = NEW.party_id AND workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'party memory must belong to the party workspace';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.use_cases
    WHERE id = NEW.use_case_id AND workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'party memory must belong to the use case workspace';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.sessions s ON s.id = c.session_id
    JOIN public.use_case_config_versions ucv ON ucv.id = s.use_case_config_version_id
    WHERE c.id = NEW.source_conversation_id
      AND c.workspace_id = NEW.workspace_id
      AND c.party_id = NEW.party_id
      AND c.purpose_key LIKE 'supplier\_%' ESCAPE '\'
      AND ucv.use_case_id = NEW.use_case_id
  ) THEN
    RAISE EXCEPTION 'party memory source must be a supplier conversation with the same party, workspace, and use case';
  END IF;

  IF NEW.supersedes_observation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.party_memory_observations
    WHERE id = NEW.supersedes_observation_id
      AND workspace_id = NEW.workspace_id
      AND party_id = NEW.party_id
      AND use_case_id = NEW.use_case_id
      AND memory_key = NEW.memory_key
  ) THEN
    RAISE EXCEPTION 'superseded party memory must have the same party, use case, and memory key';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER party_memory_observations_validate BEFORE INSERT ON "party_memory_observations" FOR EACH ROW EXECUTE FUNCTION public.pacta_validate_party_memory_observation();
--> statement-breakpoint
CREATE TRIGGER party_memory_observations_append_only BEFORE UPDATE OR DELETE ON "party_memory_observations" FOR EACH ROW EXECUTE FUNCTION public.pacta_reject_fact_mutation();
