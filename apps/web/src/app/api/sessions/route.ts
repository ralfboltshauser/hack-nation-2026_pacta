import {
  appendSessionEvent,
  createDatabase,
  createSourcingSession,
  publishUseCaseConfiguration,
} from "@pacta/db";
import { getBuiltinUseCase } from "@pacta/use-case-config";
import { z } from "zod";

import {
  outboundCallsEnabled,
  runSessionAction,
} from "@/server/orchestration/calls";

const partyInput = z
  .object({
    partyId: z.string().uuid().optional(),
    displayName: z.string().min(1).max(100).optional(),
    phoneE164: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.partyId) === Boolean(value.phoneE164))
      context.addIssue({
        code: "custom",
        message: "Provide exactly one of CRM partyId or ad-hoc phoneE164.",
      });
  });
const requestSchema = z
  .object({
    useCase: z
      .enum(["freight_brokerage", "contractor_bids"])
      .default("freight_brokerage"),
    customer: partyInput,
    suppliers: z.array(partyInput).min(1).max(3),
  })
  .strict();

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!outboundCallsEnabled())
    return Response.json(
      {
        error:
          "Outbound phone calls are temporarily unavailable. No session was created.",
      },
      { status: 503 },
    );
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Invalid session request", details: parsed.error.issues },
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
        ...(parsed.data.customer.partyId
          ? { partyId: parsed.data.customer.partyId }
          : {}),
        displayName: parsed.data.customer.displayName ?? "Customer",
        ...(parsed.data.customer.phoneE164
          ? { phoneE164: parsed.data.customer.phoneE164 }
          : {}),
      },
      suppliers: parsed.data.suppliers.map((supplierInput, index) => ({
        ...(supplierInput.partyId ? { partyId: supplierInput.partyId } : {}),
        displayName: supplierInput.displayName ?? `Supplier ${index + 1}`,
        ...(supplierInput.phoneE164
          ? { phoneE164: supplierInput.phoneE164 }
          : {}),
      })),
      data: { demoPublic: true },
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
      },
    });
    const launch = await runSessionAction(graph.session.id, "call_customer");
    return Response.json(
      {
        sessionId: graph.session.id,
        customerConversationId: graph.customer.conversation.id,
        supplierCount: graph.suppliers.length,
        intakeUrl: `/intake/${graph.session.id}`,
        launch,
      },
      { status: 201 },
    );
  } finally {
    await client.end();
  }
}
