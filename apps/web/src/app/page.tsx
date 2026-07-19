import { SessionConsole } from "@/components/session-console";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;
  return <SessionConsole sessionId={session} />;
}
