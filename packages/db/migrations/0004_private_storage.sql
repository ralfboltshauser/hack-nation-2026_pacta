DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'pacta-private',
      'pacta-private',
      false,
      10485760,
      ARRAY['application/pdf', 'text/plain', 'text/csv', 'application/json']
    )
    ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE $policy$
        CREATE POLICY pacta_session_members_read_private_objects
        ON storage.objects FOR SELECT TO authenticated
        USING (
          bucket_id = 'pacta-private'
          AND EXISTS (
            SELECT 1
            FROM public.sessions session
            JOIN public.workspace_members member ON member.workspace_id = session.workspace_id
            WHERE session.workspace_id::text = split_part(storage.objects.name, '/', 1)
              AND session.id::text = split_part(storage.objects.name, '/', 2)
              AND member.user_id = (SELECT auth.uid())
          )
        )
      $policy$;
      EXECUTE $policy$
        CREATE POLICY pacta_session_members_upload_private_objects
        ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (
          bucket_id = 'pacta-private'
          AND EXISTS (
            SELECT 1
            FROM public.sessions session
            JOIN public.workspace_members member ON member.workspace_id = session.workspace_id
            WHERE session.workspace_id::text = split_part(storage.objects.name, '/', 1)
              AND session.id::text = split_part(storage.objects.name, '/', 2)
              AND member.user_id = (SELECT auth.uid())
          )
        )
      $policy$;
    END IF;
  END IF;
END;
$$;
