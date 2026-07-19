import { createDatabase } from "@pacta/db";

import {
  ArtifactRequestError,
  stageIntakeArtifact,
} from "@/server/artifacts/intake";
import { hasSessionMembership } from "@/server/sessions/authorization";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const { db, client } = createDatabase();
  try {
    const access = await hasSessionMembership(request, db, sessionId);
    if (!access.authenticated)
      return Response.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    if (!access.authorized)
      return Response.json({ error: "Session access denied" }, { status: 403 });
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json(
        { error: "A multipart form payload is required." },
        { status: 400 },
      );
    }
    return Response.json(await stageIntakeArtifact(db, sessionId, form), {
      status: 201,
    });
  } catch (error) {
    if (error instanceof ArtifactRequestError)
      return Response.json({ error: error.message }, { status: error.status });
    console.error("Customer artifact staging failed", error);
    return Response.json(
      { error: "Customer artifact staging failed" },
      { status: 500 },
    );
  } finally {
    await client.end();
  }
}
