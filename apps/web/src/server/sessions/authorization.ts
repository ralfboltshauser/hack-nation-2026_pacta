import { sessions, workspaceMembers, type PactaDatabase } from "@pacta/db";
import { and, eq } from "drizzle-orm";

import { requireSupabaseUser } from "@/server/supabase/auth";

export async function hasSessionMembership(
  request: Request,
  db: PactaDatabase,
  sessionId: string,
) {
  const user = await requireSupabaseUser(request);
  if (!user) return { authenticated: false, authorized: false } as const;
  const [membership] = await db
    .select({ sessionId: sessions.id })
    .from(sessions)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, sessions.workspaceId),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(eq(sessions.id, sessionId));
  return {
    authenticated: true,
    authorized: Boolean(membership),
    user,
  } as const;
}
