ALTER FUNCTION public.pacta_set_updated_at() SET search_path = '';
--> statement-breakpoint
ALTER FUNCTION public.pacta_protect_published_config() SET search_path = '';
--> statement-breakpoint
ALTER FUNCTION public.pacta_reject_fact_mutation() SET search_path = '';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.pacta_validate_job_revision_pointers()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.job_revisions revision
    WHERE revision.id = NEW.current_revision_id
      AND revision.job_id = NEW.id
      AND revision.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'current job revision must belong to the same job and workspace';
  END IF;
  IF NEW.confirmed_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.job_revisions revision
    WHERE revision.id = NEW.confirmed_revision_id
      AND revision.job_id = NEW.id
      AND revision.workspace_id = NEW.workspace_id
      AND revision.validation_status = 'valid'
  ) THEN
    RAISE EXCEPTION 'confirmed job revision must be valid and belong to the same job and workspace';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.pacta_validate_offer_revision_pointer()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.offer_revisions revision
    WHERE revision.id = NEW.current_revision_id
      AND revision.offer_id = NEW.id
      AND revision.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'current offer revision must belong to the same offer and workspace';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.pacta_broadcast_session_event() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.pacta_broadcast_session_event() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.pacta_broadcast_session_event() FROM authenticated;
  END IF;
END;
$$;
