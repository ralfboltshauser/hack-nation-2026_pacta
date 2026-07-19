-- Hack-MVP policy: public application data intentionally has no RLS boundary.
-- Keep the existing policies checked in so RLS can be re-enabled later.
DO $$
DECLARE
  pacta_table text;
BEGIN
  FOREACH pacta_table IN ARRAY ARRAY[
    'artifacts',
    'awards',
    'comparison_run_offers',
    'comparison_runs',
    'context_injections',
    'conversation_turn_executions',
    'conversation_turns',
    'conversations',
    'customer_decisions',
    'evidence',
    'job_confirmations',
    'job_revision_evidence',
    'job_revisions',
    'jobs',
    'leverage_facts',
    'negotiations',
    'offer_revision_evidence',
    'offer_revisions',
    'offers',
    'parties',
    'session_actions',
    'session_events',
    'session_suppliers',
    'sessions',
    'tool_invocations',
    'use_case_config_versions',
    'use_cases',
    'workspace_members',
    'workspaces'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY',
      pacta_table
    );
  END LOOP;
END;
$$;
--> statement-breakpoint

-- Hack-MVP storage policy: the Pacta bucket is intentionally public and
-- writable by anonymous/authenticated Supabase clients. Keep this scoped to
-- one bucket instead of disabling protection for every Storage bucket.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets
    SET public = true
    WHERE id = 'pacta-private';
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS pacta_session_members_read_private_objects
      ON storage.objects;
    DROP POLICY IF EXISTS pacta_session_members_upload_private_objects
      ON storage.objects;
    DROP POLICY IF EXISTS pacta_mvp_public_objects
      ON storage.objects;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
      AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects
        TO anon, authenticated;
      CREATE POLICY pacta_mvp_public_objects
        ON storage.objects
        FOR ALL
        TO anon, authenticated
        USING (bucket_id = 'pacta-private')
        WITH CHECK (bucket_id = 'pacta-private');
    END IF;
  END IF;
END;
$$;
