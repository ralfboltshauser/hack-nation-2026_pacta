import { and, eq, sql } from "drizzle-orm";

import type { PactaDatabase } from "./client";
import { sessionEvents, sessions } from "./schema";

export type AppendSessionEventInput = {
  workspaceId: string;
  sessionId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  source: string;
  idempotencyKey?: string;
  correlationId?: string;
  occurredAt?: Date;
  payload?: Record<string, unknown>;
};

export async function appendSessionEventInTransaction(
  db: PactaDatabase,
  input: AppendSessionEventInput,
) {
  const [lockedSession] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, input.sessionId))
    .for("update");
  if (!lockedSession)
    throw new Error("Session not found while allocating event sequence");
  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.workspaceId, input.workspaceId),
          eq(sessionEvents.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing) return existing;
  }
  const [session] = await db
    .update(sessions)
    .set({
      nextEventSeq: sql`${sessions.nextEventSeq} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, input.sessionId))
    .returning({ eventSeq: sessions.nextEventSeq });
  if (!session)
    throw new Error("Session not found while allocating event sequence");

  const [event] = await db
    .insert(sessionEvents)
    .values({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      eventSeq: session.eventSeq,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      occurredAt: input.occurredAt ?? new Date(),
      payload: input.payload ?? {},
    })
    .returning();
  return event!;
}

export async function appendSessionEvent(
  db: PactaDatabase,
  input: AppendSessionEventInput,
) {
  return db.transaction(async (tx) => {
    return appendSessionEventInTransaction(
      tx as unknown as PactaDatabase,
      input,
    );
  });
}
