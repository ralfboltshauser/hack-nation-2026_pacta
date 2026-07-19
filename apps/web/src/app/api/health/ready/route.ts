import { getReadiness } from "@/lib/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await getReadiness();
  return Response.json(readiness, { status: readiness.ok ? 200 : 503 });
}
