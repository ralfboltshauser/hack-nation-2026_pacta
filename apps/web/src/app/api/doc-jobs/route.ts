import {
  appendSessionEvent,
  createDatabase,
  createSourcingSession,
  publishUseCaseConfiguration,
} from "@pacta/db";
import { getBuiltinUseCase } from "@pacta/use-case-config";

import { documentJobRequestSchema } from "@/lib/document-job-contract";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const parsed = documentJobRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Invalid document job request", details: parsed.error.issues },
      { status: 422 },
    );

  const { db, client } = createDatabase();
  try {
    const config = getBuiltinUseCase(parsed.data.useCase);
    const published = await publishUseCaseConfiguration(db, {
      workspaceSlug: "pacta-demo",
      workspaceName: "Pacta Demo",
      config,
    });
    const graph = await createSourcingSession(db, {
      workspaceId: published.workspace.id,
      configVersionId: published.configVersion.id,
      customer: {
        displayName: parsed.data.customer.displayName ?? "Document customer",
      },
      suppliers: parsed.data.suppliers.map((supplier, index) => ({
        displayName: supplier.displayName ?? `Supplier ${index + 1}`,
        phoneE164: supplier.phoneE164,
      })),
      customerConversation: {
        channel: "text_chat",
        direction: "inbound",
      },
      data: { demoPublic: true, intakeChannel: "document_chat" },
    });
    await appendSessionEvent(db, {
      workspaceId: graph.session.workspaceId,
      sessionId: graph.session.id,
      aggregateType: "session",
      aggregateId: graph.session.id,
      eventType: "session.started",
      source: "dashboard",
      idempotencyKey: `session:${graph.session.id}:started`,
      payload: {
        customerPartyId: graph.customer.party.id,
        supplierCount: graph.suppliers.length,
        intakeChannel: "document_chat",
      },
    });

    return Response.json(
      {
        sessionId: graph.session.id,
        customerConversationId: graph.customer.conversation.id,
        supplierCount: graph.suppliers.length,
        intakeUrl: `/doc-job?session=${graph.session.id}`,
        customerCallStarted: false,
      },
      { status: 201 },
    );
  } finally {
    await client.end();
  }
}
