import {
  createDatabase,
  createSourcingSession,
  publishUseCaseConfiguration,
} from "@pacta/db";
import { getBuiltinUseCase } from "@pacta/use-case-config";
import { z } from "zod";

import { hasDemoAccess } from "@/server/access";

const customer = z
  .object({
    displayName: z.string().min(1).max(100),
    phoneE164: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
  })
  .strict();
const supplier = z
  .object({
    displayName: z.string().min(1).max(100),
    phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  })
  .strict();
const requestSchema = z
  .object({
    useCase: z
      .enum(["freight_brokerage", "contractor_bids"])
      .default("freight_brokerage"),
    customer,
    suppliers: z.array(supplier).min(1).max(10),
  })
  .strict();

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasDemoAccess(request))
    return Response.json(
      { error: "Demo access key required" },
      { status: 401 },
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
        displayName: parsed.data.customer.displayName,
        ...(parsed.data.customer.phoneE164
          ? { phoneE164: parsed.data.customer.phoneE164 }
          : {}),
      },
      suppliers: parsed.data.suppliers,
      data: { demoPublic: true },
    });
    return Response.json(
      {
        sessionId: graph.session.id,
        customerConversationId: graph.customer.conversation.id,
        supplierCount: graph.suppliers.length,
        intakeUrl: `/intake/${graph.session.id}`,
      },
      { status: 201 },
    );
  } finally {
    await client.end();
  }
}
