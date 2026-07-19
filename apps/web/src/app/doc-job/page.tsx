import { DocumentJobFlow } from "@/components/document-job-flow";

export default async function DocumentJobPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;
  return <DocumentJobFlow initialSessionId={session} />;
}
