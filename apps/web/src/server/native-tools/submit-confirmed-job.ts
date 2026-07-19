import "server-only";

import { createHash } from "node:crypto";

import {
  appendSessionEventInTransaction,
  conversations,
  conversationTurns,
  jobConfirmations,
  jobRevisions,
  jobs,
  sessions,
  useCaseConfigVersions,
  type PactaDatabase,
} from "@pacta/db";
import {
  compileUseCaseConfig,
  hasPointer,
  useCaseConfigSchema,
} from "@pacta/use-case-config";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

export const submitConfirmedJobBodySchema = z
  .object({
    conversation_id: z.string().min(1),
    conversation_history: z.string().min(1),
    job: z.record(z.string(), z.unknown()),
  })
  .strict();

export type SubmitConfirmedJobBody = z.infer<
  typeof submitConfirmedJobBodySchema
>;

type HistoryEntry = { role: string; message: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function latestUserMessage(serializedHistory: string) {
  let history: unknown;
  try {
    history = JSON.parse(serializedHistory);
  } catch {
    return null;
  }
  const entries = z
    .object({
      entries: z.array(z.unknown()),
    })
    .passthrough()
    .safeParse(history);
  if (!entries.success) return null;
  for (const entry of [...entries.data.entries].reverse()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (
      record.role === "user" &&
      typeof record.message === "string" &&
      record.message.trim()
    )
      return { role: "user", message: record.message };
  }
  return null;
}

function confirmationTurnKey(conversationId: string, entry: HistoryEntry) {
  return `native:confirmation:${createHash("sha256")
    .update(`${conversationId}\0${entry.message}`)
    .digest("hex")}`;
}

export async function submitConfirmedJob(db: PactaDatabase, rawBody: unknown) {
  const body = submitConfirmedJobBodySchema.parse(rawBody);
  const [context] = await db
    .select({
      conversation: conversations,
      session: sessions,
      configDocument: useCaseConfigVersions.document,
    })
    .from(conversations)
    .innerJoin(sessions, eq(sessions.id, conversations.sessionId))
    .innerJoin(
      useCaseConfigVersions,
      eq(useCaseConfigVersions.id, sessions.useCaseConfigVersionId),
    )
    .where(
      and(
        eq(conversations.provider, "elevenlabs"),
        eq(conversations.providerConversationId, body.conversation_id),
      ),
    );
  if (!context) throw new Error("Unknown ElevenLabs conversation.");
  if (context.conversation.purposeKey !== "customer_intake")
    throw new Error("Only the customer-intake conversation can confirm a job.");

  const config = compileUseCaseConfig(
    useCaseConfigSchema.parse(context.configDocument),
  );
  const validation = config.validateJob(body.job);
  const mustBeKnownMissing = config.document.job.completion.mustBeKnown.filter(
    (path) => !hasPointer(body.job, path),
  );
  const missingRequiredPaths = [
    ...new Set([...validation.missingRequiredPaths, ...mustBeKnownMissing]),
  ].sort();
  if (!validation.valid || missingRequiredPaths.length > 0) {
    return {
      accepted: false as const,
      reason: "job_incomplete",
      missingRequiredPaths,
      validationErrors: validation.errors,
      nextAction:
        "Ask the customer only for the returned missing or invalid fields.",
    };
  }

  const latestUser = latestUserMessage(body.conversation_history);
  if (!latestUser) {
    return {
      accepted: false as const,
      reason: "confirmation_required",
      missingRequiredPaths: [] as string[],
      validationErrors: [] as unknown[],
      nextAction:
        "Read back the configured job and ask the customer to explicitly confirm it before calling this tool again.",
    };
  }

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as PactaDatabase;
    const [lockedSession] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, context.session.id))
      .for("update");
    if (!lockedSession) throw new Error("Session disappeared.");
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, context.conversation.id))
      .for("update");
    if (!conversation || conversation.endedAt)
      throw new Error("Customer conversation is already terminal.");
    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.sessionId, lockedSession.id))
      .for("update");
    if (!job) throw new Error("Session has no job aggregate.");

    if (job.confirmedRevisionId) {
      const [confirmed] = await tx
        .select()
        .from(jobRevisions)
        .where(eq(jobRevisions.id, job.confirmedRevisionId));
      if (confirmed && canonical(confirmed.data) === canonical(body.job)) {
        return {
          accepted: true as const,
          created: false,
          sessionId: lockedSession.id,
          jobRevisionId: confirmed.id,
          jobRevisionNumber: confirmed.revisionNumber,
          nextAction:
            "The same job is already confirmed. Continue with the current sourcing state.",
        };
      }
      return {
        accepted: false as const,
        reason: "confirmed_job_differs",
        missingRequiredPaths: [] as string[],
        validationErrors: [] as unknown[],
        nextAction:
          "The customer changed an already confirmed job. Stop and start an explicit correction flow.",
      };
    }
    if (lockedSession.status !== "customer_intake")
      throw new Error(
        `Session cannot confirm a job from ${lockedSession.status}.`,
      );

    const providerTurnId = confirmationTurnKey(conversation.id, latestUser);
    await tx
      .insert(conversationTurns)
      .values({
        workspaceId: lockedSession.workspaceId,
        conversationId: conversation.id,
        providerTurnId,
        role: "user",
        content: latestUser.message,
        isFinal: true,
      })
      .onConflictDoNothing();
    const [sourceTurn] = await tx
      .select({ id: conversationTurns.id })
      .from(conversationTurns)
      .where(
        and(
          eq(conversationTurns.conversationId, conversation.id),
          eq(conversationTurns.providerTurnId, providerTurnId),
        ),
      );
    if (!sourceTurn) throw new Error("Could not persist confirmation turn.");

    const [lastRevision] = await tx
      .select({ revisionNumber: jobRevisions.revisionNumber })
      .from(jobRevisions)
      .where(eq(jobRevisions.jobId, job.id))
      .orderBy(desc(jobRevisions.revisionNumber))
      .limit(1);
    const [revision] = await tx
      .insert(jobRevisions)
      .values({
        workspaceId: lockedSession.workspaceId,
        jobId: job.id,
        revisionNumber: (lastRevision?.revisionNumber ?? 0) + 1,
        data: body.job,
        validationStatus: "valid",
        missingRequiredPaths: [],
        validationErrors: [],
        sourceConversationId: conversation.id,
      })
      .returning({
        id: jobRevisions.id,
        revisionNumber: jobRevisions.revisionNumber,
      });
    if (!revision) throw new Error("Could not create confirmed job revision.");

    await tx
      .update(jobs)
      .set({
        currentRevisionId: revision.id,
        confirmedRevisionId: revision.id,
        status: "confirmed",
      })
      .where(eq(jobs.id, job.id));
    await tx.insert(jobConfirmations).values({
      workspaceId: lockedSession.workspaceId,
      sessionId: lockedSession.id,
      jobId: job.id,
      jobRevisionId: revision.id,
      action: "confirmed",
      sourceConversationId: conversation.id,
      sourceConversationTurnId: sourceTurn.id,
      statement: latestUser.message,
      occurredAt: new Date(),
    });
    await tx
      .update(sessions)
      .set({ status: "sourcing", updatedAt: new Date() })
      .where(eq(sessions.id, lockedSession.id));

    await appendSessionEventInTransaction(tx, {
      workspaceId: lockedSession.workspaceId,
      sessionId: lockedSession.id,
      aggregateType: "job",
      aggregateId: job.id,
      eventType: "job.revision_created",
      source: "elevenlabs_native_tool",
      idempotencyKey: `native:job-revision:${revision.id}`,
      payload: {
        jobId: job.id,
        jobRevisionId: revision.id,
        revisionNumber: revision.revisionNumber,
      },
    });
    await appendSessionEventInTransaction(tx, {
      workspaceId: lockedSession.workspaceId,
      sessionId: lockedSession.id,
      aggregateType: "job",
      aggregateId: job.id,
      eventType: "job.confirmed",
      source: "elevenlabs_native_tool",
      idempotencyKey: `native:job-confirmed:${revision.id}`,
      payload: {
        jobId: job.id,
        jobRevisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        label: "Job confirmed — starting supplier outreach",
      },
    });

    return {
      accepted: true as const,
      created: true,
      sessionId: lockedSession.id,
      jobRevisionId: revision.id,
      jobRevisionNumber: revision.revisionNumber,
      nextAction:
        "The job is durably confirmed. Tell the customer sourcing is starting.",
    };
  });
}
