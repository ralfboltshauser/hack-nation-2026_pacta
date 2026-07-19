import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type PactaDatabase } from "./client";
import { appendSessionEvent } from "./events";
import {
  jobRevisions,
  jobs,
  parties,
  sessionActions,
  sessionEvents,
  sessions,
  useCasePartyRoles,
  useCaseConfigVersions,
  useCases,
  workspaces,
} from "./schema";

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;

integration("Postgres invariants", () => {
  let db: PactaDatabase;
  let client: ReturnType<typeof createDatabase>["client"];
  let workspaceId: string;
  let sessionId: string;
  let configVersionId: string;
  let useCaseId: string;

  beforeAll(async () => {
    ({ db, client } = createDatabase(process.env.TEST_DATABASE_URL));
    const [workspace] = await db
      .insert(workspaces)
      .values({ slug: `test-${crypto.randomUUID()}`, name: "Integration" })
      .returning();
    workspaceId = workspace!.id;
    const [useCase] = await db
      .insert(useCases)
      .values({ workspaceId, key: "integration", displayName: "Integration" })
      .returning();
    useCaseId = useCase!.id;
    const [config] = await db
      .insert(useCaseConfigVersions)
      .values({
        workspaceId,
        useCaseId: useCase!.id,
        contractVersion: "1",
        version: "0.1.0",
        contentSha256: crypto.randomUUID().replaceAll("-", ""),
        document: {},
        status: "published",
        publishedAt: new Date(),
      })
      .returning();
    configVersionId = config!.id;
    const [customer] = await db
      .insert(parties)
      .values({ workspaceId, displayName: "Customer", roleKeys: ["customer"] })
      .returning();
    const [session] = await db
      .insert(sessions)
      .values({
        workspaceId,
        useCaseConfigVersionId: configVersionId,
        customerPartyId: customer!.id,
        status: "intake",
      })
      .returning();
    sessionId = session!.id;
  });

  afterAll(async () => {
    await client.end();
  });

  it("keeps published configuration content immutable", async () => {
    await expect(
      db
        .update(useCaseConfigVersions)
        .set({ document: { changed: true } })
        .where(eq(useCaseConfigVersions.id, configVersionId)),
    ).rejects.toBeDefined();
    const [persisted] = await db
      .select({ document: useCaseConfigVersions.document })
      .from(useCaseConfigVersions)
      .where(eq(useCaseConfigVersions.id, configVersionId));
    expect(persisted?.document).toEqual({});
  });

  it("scopes CRM roles to one use case and workspace", async () => {
    const [supplier] = await db
      .insert(parties)
      .values({
        workspaceId,
        displayName: "Reusable supplier",
        roleKeys: ["supplier"],
      })
      .returning();

    await db.insert(useCasePartyRoles).values({
      workspaceId,
      useCaseId,
      partyId: supplier!.id,
      roleKey: "supplier",
      relationshipData: { accountOwner: "integration" },
    });

    await expect(
      db.insert(useCasePartyRoles).values({
        workspaceId,
        useCaseId,
        partyId: supplier!.id,
        roleKey: "supplier",
      }),
    ).rejects.toBeDefined();

    const [otherWorkspace] = await db
      .insert(workspaces)
      .values({
        slug: `other-${crypto.randomUUID()}`,
        name: "Other workspace",
      })
      .returning();
    const [foreignParty] = await db
      .insert(parties)
      .values({
        workspaceId: otherWorkspace!.id,
        displayName: "Foreign supplier",
      })
      .returning();

    await expect(
      db.insert(useCasePartyRoles).values({
        workspaceId,
        useCaseId,
        partyId: foreignParty!.id,
        roleKey: "supplier",
      }),
    ).rejects.toBeDefined();
  });

  it("allocates committed per-session event sequences under concurrency", async () => {
    await Promise.all(
      ["one", "two", "three", "four"].map((label) =>
        appendSessionEvent(db, {
          workspaceId,
          sessionId,
          aggregateType: "session",
          aggregateId: sessionId,
          eventType: `test.${label}`,
          source: "integration",
          idempotencyKey: `integration:${label}`,
          payload: { label },
        }),
      ),
    );
    const rows = await db
      .select({ eventSeq: sessionEvents.eventSeq })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId))
      .orderBy(sessionEvents.eventSeq);
    expect(rows.map((row) => row.eventSeq)).toEqual([1, 2, 3, 4]);
  });

  it("replays an idempotent event append without consuming a sequence", async () => {
    const first = await appendSessionEvent(db, {
      workspaceId,
      sessionId,
      aggregateType: "session",
      aggregateId: sessionId,
      eventType: "test.one",
      source: "integration",
      idempotencyKey: "integration:one",
    });
    const second = await appendSessionEvent(db, {
      workspaceId,
      sessionId,
      aggregateType: "session",
      aggregateId: sessionId,
      eventType: "test.one",
      source: "integration",
      idempotencyKey: "integration:one",
    });
    expect(second.id).toBe(first.id);
    const rows = await db
      .select({ eventSeq: sessionEvents.eventSeq })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId));
    expect(rows).toHaveLength(4);
  });

  it("rejects mutation of append-only event facts", async () => {
    await expect(
      db
        .update(sessionEvents)
        .set({ payload: { rewritten: true } })
        .where(eq(sessionEvents.sessionId, sessionId)),
    ).rejects.toBeDefined();
    const persisted = await db
      .select({ payload: sessionEvents.payload })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId));
    expect(persisted.every((event) => !("rewritten" in event.payload))).toBe(
      true,
    );
  });

  it("prevents a job from confirming another job's revision", async () => {
    const [first] = await db
      .insert(jobs)
      .values({ workspaceId, sessionId })
      .returning();
    const [otherCustomer] = await db
      .insert(parties)
      .values({
        workspaceId,
        displayName: "Other customer",
        roleKeys: ["customer"],
      })
      .returning();
    const [otherSession] = await db
      .insert(sessions)
      .values({
        workspaceId,
        useCaseConfigVersionId: configVersionId,
        customerPartyId: otherCustomer!.id,
      })
      .returning();
    const [second] = await db
      .insert(jobs)
      .values({ workspaceId, sessionId: otherSession!.id })
      .returning();
    const [revision] = await db
      .insert(jobRevisions)
      .values({
        workspaceId,
        jobId: second!.id,
        revisionNumber: 1,
        validationStatus: "valid",
        data: {},
        missingRequiredPaths: [],
        validationErrors: [],
      })
      .returning();

    await expect(
      db
        .update(jobs)
        .set({ confirmedRevisionId: revision!.id })
        .where(eq(jobs.id, first!.id)),
    ).rejects.toBeDefined();
    const [persisted] = await db
      .select({ confirmedRevisionId: jobs.confirmedRevisionId })
      .from(jobs)
      .where(eq(jobs.id, first!.id));
    expect(persisted?.confirmedRevisionId).toBeNull();
  });

  it("makes externally visible session actions idempotent", async () => {
    await db.insert(sessionActions).values({
      workspaceId,
      sessionId,
      actionType: "start_supplier_round",
      actionKey: "start_supplier_round:1",
      requestedBy: "integration",
    });
    await expect(
      db.insert(sessionActions).values({
        workspaceId,
        sessionId,
        actionType: "start_supplier_round",
        actionKey: "start_supplier_round:1",
        requestedBy: "integration",
      }),
    ).rejects.toBeDefined();
    const persisted = await db
      .select({ id: sessionActions.id })
      .from(sessionActions)
      .where(eq(sessionActions.sessionId, sessionId));
    expect(persisted).toHaveLength(1);
  });
});
