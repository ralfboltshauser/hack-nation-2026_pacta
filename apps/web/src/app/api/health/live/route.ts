export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, service: "pacta-web" }, { status: 200 });
}
