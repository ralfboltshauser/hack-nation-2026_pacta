import { createDatabase } from "@pacta/db";
import { sql } from "drizzle-orm";

const productionRequired = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_CUSTOMER_AGENT_ID",
  "ELEVENLABS_SUPPLIER_AGENT_ID",
  "ELEVENLABS_CUSTOM_LLM_SECRET",
  "ELEVENLABS_WEBHOOK_SECRET",
  "PACTA_DEMO_ACCESS_KEY",
] as const;

export async function getReadiness() {
  const required =
    process.env.NODE_ENV === "production"
      ? productionRequired
      : (["DATABASE_URL"] as const);
  const missing: string[] = required.filter((name) => !process.env[name]);
  const outboundCalls = process.env.PACTA_OUTBOUND_CALLS_ENABLED === "true";
  if (outboundCalls && !process.env.ELEVENLABS_PHONE_NUMBER_ID)
    missing.push("ELEVENLABS_PHONE_NUMBER_ID");
  let database = "missing";
  if (process.env.DATABASE_URL) {
    const connection = createDatabase();
    try {
      await connection.db.execute(sql`select 1`);
      database = "ready";
    } catch {
      database = "unreachable";
    } finally {
      await connection.client.end();
    }
  }

  return {
    ok: missing.length === 0 && database === "ready",
    checks: {
      environment: missing.length === 0 ? "ready" : "missing",
      database,
      outboundCalls: outboundCalls ? "armed" : "disarmed",
    },
    missing,
  };
}
