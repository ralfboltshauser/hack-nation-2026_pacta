-- A party is a workspace-level CRM identity. Its customer/supplier role is
-- scoped to a stable use case so freight and moving can maintain independent
-- rosters without duplicating contact data or mutating published config JSON.
CREATE TABLE "use_case_party_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"use_case_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"relationship_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "use_case_party_roles_role_check" CHECK ("use_case_party_roles"."role_key" in ('customer', 'supplier')),
	CONSTRAINT "use_case_party_roles_status_check" CHECK ("use_case_party_roles"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "use_case_party_roles" ADD CONSTRAINT "use_case_party_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "use_case_party_roles" ADD CONSTRAINT "use_case_party_roles_use_case_id_use_cases_id_fk" FOREIGN KEY ("use_case_id") REFERENCES "public"."use_cases"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "use_case_party_roles" ADD CONSTRAINT "use_case_party_roles_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "use_case_party_roles_membership_uidx" ON "use_case_party_roles" USING btree ("use_case_id", "party_id", "role_key");
--> statement-breakpoint
CREATE INDEX "use_case_party_roles_roster_idx" ON "use_case_party_roles" USING btree ("use_case_id", "role_key", "status");
--> statement-breakpoint
CREATE INDEX "use_case_party_roles_workspace_party_idx" ON "use_case_party_roles" USING btree ("workspace_id", "party_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.pacta_validate_use_case_party_role_workspace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.use_cases
    WHERE id = NEW.use_case_id AND workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'use-case CRM role must belong to the use case workspace';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.parties
    WHERE id = NEW.party_id AND workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'use-case CRM role must belong to the party workspace';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER use_case_party_roles_validate_workspace BEFORE INSERT OR UPDATE OF workspace_id, use_case_id, party_id ON "use_case_party_roles" FOR EACH ROW EXECUTE FUNCTION public.pacta_validate_use_case_party_role_workspace();
--> statement-breakpoint
CREATE TRIGGER use_case_party_roles_set_updated_at BEFORE UPDATE ON "use_case_party_roles" FOR EACH ROW EXECUTE FUNCTION public.pacta_set_updated_at();
