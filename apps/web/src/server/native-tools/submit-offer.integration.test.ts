import { readFile } from "node:fs/promises";

import {
  conversations,
  createDatabase,
  createSourcingSession,
  jobRevisions,
  jobs,
  leverageFacts,
  offerRevisions,
  publishUseCaseConfiguration,
  sessionEvents,
  toolInvocations,
} from "@pacta/db";
import { useCaseConfigSchema } from "@pacta/use-case-config";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/tools/elevenlabs/submit-offer/route";

const databaseUrl = process.env.TEST_DATABASE_URL;

const confirmedJob = {
  origin: { city: "Zurich", country: "CH" },
  destination: { city: "Munich", country: "DE" },
  pickupWindow: {
    start: "2026-07-20T08:00:00Z",
    end: "2026-07-20T10:00:00Z",
  },
  deliveryWindow: {
    start: "2026-07-21T08:00:00Z",
    end: "2026-07-21T18:00:00Z",
  },
  equipmentType: "dry_van_53",
  commodity: "Machine parts",
  weightKg: 8_000,
  handlingUnits: 12,
  hazmat: false,
  specialServices: [],
  risk: { criticality: "standard", minimumCoverageMinor: 2_000_000 },
};

const completeOffer = {
  pricing: {
    currency: "CHF",
    lineItems: [
      {
        code: "linehaul",
        label: "Linehaul",
        amountMinor: 136_000,
        basis: "flat",
      },
      {
        code: "fuel",
        label: "Fuel surcharge",
        amountMinor: 10_000,
        basis: "flat",
      },
    ],
    allInTotalMinor: 146_000,
  },
  service: {
    pickupCommitment: "2026-07-20T08:00:00Z",
    deliveryCommitment: "2026-07-21T18:00:00Z",
    equipmentType: "dry_van_53",
  },
  terms: {
    quoteType: "firm",
    validUntil: "2026-07-20T07:00:00Z",
    paymentTerms: "Net 30",
    tollsIncluded: true,
  },
  coverage: { confirmed: true, limitMinor: 2_500_000 },
  conditions: [],
  exclusions: [],
  unknowns: [],
};

const history = JSON.stringify({
  entries: [
    {
      role: "assistant",
      message: "Please confirm the complete quote.",
    },
    {
      role: "user",
      message:
        "Confirmed: CHF 1,460 all-in, including tolls, with CHF 25,000 coverage and the exact service terms discussed.",
    },
  ],
});

async function setup() {
  process.env.DATABASE_URL = databaseUrl!;
  const rawConfig = JSON.parse(
    await readFile(
      new URL(
        "../../../../../config/use-cases/freight-brokerage/0.1.0.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const config = useCaseConfigSchema.parse(rawConfig);
  const { db, client } = createDatabase(databaseUrl);
  const suffix = crypto.randomUUID().slice(0, 8);
  const published = await publishUseCaseConfiguration(db, {
    workspaceSlug: `native-offer-${suffix}`,
    workspaceName: "Native offer test",
    config,
  });
  const graph = await createSourcingSession(db, {
    workspaceId: published.workspace.id,
    configVersionId: published.configVersion.id,
    customer: { displayName: "Test customer" },
    suppliers: [{ displayName: "Test carrier" }],
  });
  const [jobRevision] = await db
    .insert(jobRevisions)
    .values({
      workspaceId: published.workspace.id,
      jobId: graph.job.id,
      revisionNumber: 1,
      data: confirmedJob,
      validationStatus: "valid",
      missingRequiredPaths: [],
      validationErrors: [],
      sourceConversationId: graph.customer.conversation.id,
    })
    .returning({ id: jobRevisions.id });
  if (!jobRevision) throw new Error("Failed to create the confirmed test job.");
  await db
    .update(jobs)
    .set({
      status: "confirmed",
      currentRevisionId: jobRevision.id,
      confirmedRevisionId: jobRevision.id,
    })
    .where(eq(jobs.id, graph.job.id));
  const providerConversationId = `conv_native_${crypto.randomUUID()}`;
  await db
    .update(conversations)
    .set({
      providerConversationId,
      status: "connected",
      connectedAt: new Date(),
    })
    .where(eq(conversations.id, graph.suppliers[0]!.conversation.id));
  return { db, client, graph, providerConversationId };
}

function requestFor(
  providerConversationId: string,
  toolCallId: string,
  offer: Record<string, unknown>,
) {
  return new Request("http://localhost/api/tools/elevenlabs/submit-offer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tool_call_id: toolCallId,
      tool_name: "submit_offer",
      conversation_id: providerConversationId,
      parameters: {
        conversation_id: providerConversationId,
        conversation_history: history,
        offer,
      },
    }),
  });
}

describe.skipIf(!databaseUrl)("native submit-offer", () => {
  it("normalizes one immutable revision and replays a concurrent provider retry", async () => {
    const { db, client, graph, providerConversationId } = await setup();
    try {
      const toolCallId = `tool_${crypto.randomUUID()}`;
      const distinctToolCallIds = Array.from(
        { length: 3 },
        () => `tool_${crypto.randomUUID()}`,
      );
      const responses = await Promise.all(
        [toolCallId, toolCallId, ...distinctToolCallIds].map((callId) =>
          POST(requestFor(providerConversationId, callId, completeOffer)),
        ),
      );
      expect(responses.every((response) => response.status === 200)).toBe(true);
      const bodies = (await Promise.all(
        responses.map((response) => response.json()),
      )) as {
        accepted: boolean;
        created: boolean;
        offerRevisionId: string;
        normalizedOffer: Record<string, unknown>;
      }[];
      expect(bodies.every((body) => body.accepted)).toBe(true);
      expect(new Set(bodies.map((body) => body.offerRevisionId)).size).toBe(1);
      expect(bodies[0]!.normalizedOffer).toMatchObject({
        normalized: { totalMinor: 146_000 },
      });

      const conflictingRetry = await POST(
        requestFor(providerConversationId, toolCallId, {
          ...completeOffer,
          pricing: {
            ...completeOffer.pricing,
            allInTotalMinor: 146_001,
          },
        }),
      );
      expect(conflictingRetry.status).toBe(409);
      await expect(conflictingRetry.json()).resolves.toEqual({
        error:
          "This provider tool-call ID was reused with a different request.",
      });

      const revisions = await db
        .select()
        .from(offerRevisions)
        .where(eq(offerRevisions.offerId, graph.suppliers[0]!.offer.id));
      const invocations = await db
        .select()
        .from(toolInvocations)
        .where(
          eq(
            toolInvocations.conversationId,
            graph.suppliers[0]!.conversation.id,
          ),
        );
      const events = await db
        .select()
        .from(sessionEvents)
        .where(
          and(
            eq(sessionEvents.sessionId, graph.session.id),
            eq(sessionEvents.eventType, "offer.revision_created"),
          ),
        );
      const facts = await db
        .select()
        .from(leverageFacts)
        .where(eq(leverageFacts.sessionId, graph.session.id));
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({
        revisionNumber: 1,
        validationStatus: "valid",
        comparabilityStatus: "comparable",
      });
      expect(invocations.map((invocation) => invocation.id)).toContain(
        revisions[0]!.createdByToolInvocationId,
      );
      expect(revisions[0]!.data).toMatchObject({
        ...completeOffer,
        normalized: { totalMinor: 146_000 },
      });
      expect(invocations).toHaveLength(4);
      expect(
        invocations.every((invocation) => invocation.status === "succeeded"),
      ).toBe(true);
      expect(events).toHaveLength(1);
      expect(facts).toHaveLength(1);
      expect(facts[0]!.payload).toEqual({ amountMinor: 146_000 });
    } finally {
      await client.end();
    }
  }, 30_000);

  it("does not create a revision for an incomplete or client-normalized offer", async () => {
    const { db, client, graph, providerConversationId } = await setup();
    try {
      const incompleteId = `tool_${crypto.randomUUID()}`;
      const incompleteResponse = await POST(
        requestFor(providerConversationId, incompleteId, {
          pricing: completeOffer.pricing,
        }),
      );
      expect(incompleteResponse.status).toBe(200);
      await expect(incompleteResponse.json()).resolves.toMatchObject({
        accepted: false,
        comparabilityStatus: "blocked",
        missingRequiredPaths: expect.arrayContaining([
          "/coverage",
          "/service",
          "/terms",
        ]),
      });

      const derivedResponse = await POST(
        requestFor(providerConversationId, `tool_${crypto.randomUUID()}`, {
          ...completeOffer,
          normalized: { totalMinor: 1 },
        }),
      );
      expect(derivedResponse.status).toBe(422);
      await expect(derivedResponse.json()).resolves.toMatchObject({
        error: expect.stringContaining("/normalized/totalMinor"),
      });

      const revisions = await db
        .select()
        .from(offerRevisions)
        .where(eq(offerRevisions.offerId, graph.suppliers[0]!.offer.id));
      const invocations = await db
        .select()
        .from(toolInvocations)
        .where(eq(toolInvocations.providerToolCallId, incompleteId));
      expect(revisions).toHaveLength(0);
      expect(invocations).toHaveLength(1);
      expect(invocations[0]).toMatchObject({ status: "succeeded" });
    } finally {
      await client.end();
    }
  }, 30_000);

  it("rejects mismatched provider conversation identities", async () => {
    const { client, providerConversationId } = await setup();
    try {
      const request = requestFor(
        providerConversationId,
        `tool_${crypto.randomUUID()}`,
        completeOffer,
      );
      const body = (await request.json()) as Record<string, unknown>;
      body.conversation_id = `conv_other_${crypto.randomUUID()}`;
      const response = await POST(
        new Request(request.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "Envelope and system conversation IDs do not match.",
      });
    } finally {
      await client.end();
    }
  }, 30_000);
});
