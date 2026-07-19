import { createDatabase, sessions, workspaceMembers } from "@pacta/db";
import { eq } from "drizzle-orm";

import { requireSupabaseUser } from "@/server/supabase/auth";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const user = await requireSupabaseUser(request);
  if (!user)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const { sessionId } = await context.params;
  const { db, client } = createDatabase();
  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    if (!session)
      return Response.json({ error: "Session not found" }, { status: 404 });
    const publicDemo = session.data.demoPublic === true;
    const suppliedKey = request.headers.get("x-pacta-demo-key");
    const expectedKey = process.env.PACTA_DEMO_ACCESS_KEY;
    if (!publicDemo && (!expectedKey || suppliedKey !== expectedKey)) {
      return Response.json({ error: "Session access denied" }, { status: 403 });
    }
    await db
      .insert(workspaceMembers)
      .values({
        workspaceId: session.workspaceId,
        userId: user.id,
        role: "viewer",
      })
      .onConflictDoNothing();
    return Response.json({ joined: true, topic: `session:${session.id}` });
  } finally {
    await client.end();
  }
}
