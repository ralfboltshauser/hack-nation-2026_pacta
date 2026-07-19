import { SessionConsole } from "@/components/session-console";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Start a negotiation — Pacta",
  description:
    "Configure a Pacta negotiation room and follow the verified live session.",
};

export default async function NegotiatePage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string | string[] }>;
}) {
  const { session } = await searchParams;
  const sessionId = Array.isArray(session) ? session[0] : session;
  return <SessionConsole sessionId={sessionId} />;
}
