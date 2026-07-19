import { IntakeChat } from "@/components/intake-chat";

export default async function IntakePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <IntakeChat sessionId={sessionId} />;
}
