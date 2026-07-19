ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.pacta_broadcast_session_event()
RETURNS trigger
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    EXECUTE 'SELECT realtime.send($1, $2, $3, $4)'
      USING to_jsonb(NEW), NEW.event_type, 'session:' || NEW.session_id::text, true;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER session_events_broadcast
AFTER INSERT ON public.session_events
FOR EACH ROW EXECUTE FUNCTION public.pacta_broadcast_session_event();
--> statement-breakpoint
DO $$
BEGIN
  IF to_regnamespace('auth') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON public.workspace_members, public.sessions TO authenticated';
    EXECUTE $policy$
      CREATE POLICY workspace_members_select_own
      ON public.workspace_members FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()))
    $policy$;
    EXECUTE $policy$
      CREATE POLICY sessions_select_for_workspace_members
      ON public.sessions FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.workspace_members member
          WHERE member.workspace_id = sessions.workspace_id
            AND member.user_id = (SELECT auth.uid())
        )
      )
    $policy$;
  END IF;
  IF to_regclass('realtime.messages') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE $policy$
      CREATE POLICY pacta_members_receive_session_broadcasts
      ON realtime.messages FOR SELECT TO authenticated
      USING (
        realtime.messages.extension = 'broadcast'
        AND split_part((SELECT realtime.topic()), ':', 1) = 'session'
        AND EXISTS (
          SELECT 1
          FROM public.sessions session
          JOIN public.workspace_members member ON member.workspace_id = session.workspace_id
          WHERE session.id::text = split_part((SELECT realtime.topic()), ':', 2)
            AND member.user_id = (SELECT auth.uid())
        )
      )
    $policy$;
  END IF;
END;
$$;
