import { readFile } from "node:fs/promises";

import {
  conversations,
  createDatabase,
  createSourcingSession,
  jobConfirmations,
  jobRevisions,
  publishUseCaseConfiguration,
  sessionEvents,
} from "@pacta/db";
import { useCaseConfigSchema } from "@pacta/use-case-config";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { submitConfirmedJob } from "./submit-confirmed-job";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("native submit-confirmed-job", () => {
  it("validates, confirms, emits events, and deduplicates concurrent calls", async () => {
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
    const published = await publishUseCaseConfiguration(db, {
      workspaceSlug: `native-job-${crypto.randomUUID().slice(0, 8)}`,
      workspaceName: "Native job test",
      config,
    });
    const graph = await createSourcingSession(db, {
      workspaceId: published.workspace.id,
      configVersionId: published.configVersion.id,
      customer: { displayName: "Test customer" },
      suppliers: [],
    });
    const providerConversationId = `conv_${crypto.randomUUID()}`;
    await db
      .update(conversations)
      .set({
        providerConversationId,
        status: "connected",
        connectedAt: new Date(),
      })
      .where(eq(conversations.id, graph.customer.conversation.id));

    const job = {
      origin: { city: "Zurich", country: "CH" },
      destination: { city: "Berlin", country: "DE" },
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
      risk: { criticality: "standard", minimumCoverageMinor: 0 },
    };
    const history = JSON.stringify({
      entries: [
        { role: "assistant", message: "Please confirm this exact job." },
        {
          role: "assistant",
          tool_requests: [{ tool_name: "submit_confirmed_job" }],
        },
        {
          role: "assistant",
          tool_results: [{ tool_name: "submit_confirmed_job" }],
        },
        { role: "user", message: "Yes, I confirm this exact job." },
      ],
    });

    const incomplete = await submitConfirmedJob(db, {
      conversation_id: providerConversationId,
      conversation_history: history,
      job: { origin: job.origin },
    });
    expect(incomplete).toMatchObject({
      accepted: false,
      reason: "job_incomplete",
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        submitConfirmedJob(db, {
          conversation_id: providerConversationId,
          conversation_history: history,
          job,
        }),
      ),
    );
    expect(results.filter((result) => result.accepted)).toHaveLength(10);
    expect(
      results.filter((result) => result.accepted && result.created),
    ).toHaveLength(1);
    expect(
      new Set(
        results.flatMap((result) =>
          result.accepted ? [result.jobRevisionId] : [],
        ),
      ).size,
    ).toBe(1);

    const revisions = await db
      .select()
      .from(jobRevisions)
      .where(eq(jobRevisions.jobId, graph.job.id));
    const confirmations = await db
      .select()
      .from(jobConfirmations)
      .where(eq(jobConfirmations.jobId, graph.job.id));
    const events = await db
      .select()
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.sessionId, graph.session.id),
          inArray(sessionEvents.eventType, [
            "job.revision_created",
            "job.confirmed",
          ]),
        ),
      );
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.data).toEqual(job);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]?.statement).toBe("Yes, I confirm this exact job.");
    expect(events.map((event) => event.eventType).sort()).toEqual([
      "job.confirmed",
      "job.revision_created",
    ]);

    await client.end();
  }, 30_000);
});
