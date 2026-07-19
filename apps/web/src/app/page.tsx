import { LandingPage } from "@/components/landing-page";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Pacta — One request in. A live market out.",
  description:
    "AI-native negotiation infrastructure for parallel supplier conversations, verified leverage, and human-controlled commitment.",
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string | string[] }>;
}) {
  const { session } = await searchParams;
  const sessionId = Array.isArray(session) ? session[0] : session;
  if (sessionId) {
    redirect(`/negotiate?session=${encodeURIComponent(sessionId)}`);
  }

  return <LandingPage />;
}
