import { readFile } from "node:fs/promises";

import {
  awards,
  conversations,
  conversationTurnExecutions,
  contextInjections,
  createDatabase,
  createSourcingSession,
  jobRevisions,
  offerRevisions,
  publishUseCaseConfiguration,
  sessionEvents,
  sessions,
} from "@pacta/db";
import { useCaseConfigSchema } from "@pacta/use-case-config";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { handleChatCompletion } from "./handler";
import type { BrainSnapshot } from "./model";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("Custom LLM handler", () => {
  it("persists one reduction and replays the same provider retry", async () => {
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
      workspaceSlug: `brain-test-${suffix}`,
      workspaceName: "Brain integration test",
      config,
    });
    const graph = await createSourcingSession(db, {
      workspaceId: published.workspace.id,
      configVersionId: published.configVersion.id,
      customer: { displayName: "Test shipper", phoneE164: "+14155550100" },
      suppliers: [],
    });
    const body = {
      model: "pacta-test",
      stream: true,
      messages: [
        { role: "system", content: "You are Pacta." },
        { role: "assistant", content: "Where should we pick up?" },
        { role: "user", content: "Pick it up in Zurich." },
      ],
      elevenlabs_extra_body: {
        contract_version: "1",
        brain_token: graph.customer.brainToken,
        workspace_id: published.workspace.id,
        session_id: graph.session.id,
        conversation_id: graph.customer.conversation.id,
        purpose: "customer_intake",
      },
    };
    const generationStarted = Promise.withResolvers<void>();
    const releaseGeneration = Promise.withResolvers<void>();
    let generationCount = 0;
    const generate = async () => {
      generationCount += 1;
      generationStarted.resolve();
      await releaseGeneration.promise;
      return {
        spokenResponse: "Thanks. Which country is the pickup in?",
        reduction: {
          jobObservations: [
            {
              path: "/origin/city",
              value: "Zurich",
              evidenceQuote: "Zurich",
            },
          ],
          offerObservations: [],
          signals: {
            jobConfirmed: false,
            jobCorrectionRequested: false,
            supplierDeclined: false,
            callbackRequested: false,
            offerIsFinal: false,
            selectedOfferRevisionId: null,
            supplierAcceptedExactTerms: false,
            customerDeclinedAll: false,
          },
        },
      };
    };
    const makeRequest = (messages = body.messages) =>
      new Request("http://localhost/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, messages }),
      });

    const first = await handleChatCompletion(makeRequest(), { generate });
    const firstText = first.text();
    await generationStarted.promise;
    const retry = await handleChatCompletion(
      makeRequest([
        ...body.messages,
        { role: "assistant", content: "One moment... " },
      ]),
      { generate },
    );
    const retryText = retry.text();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(generationCount).toBe(1);
    releaseGeneration.resolve();
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    await expect(firstText).resolves.toContain("Which country");
    await expect(retryText).resolves.toContain("Which country");

    const revisions = await db
      .select()
      .from(jobRevisions)
      .where(eq(jobRevisions.jobId, graph.job.id));
    const executions = await db
      .select()
      .from(conversationTurnExecutions)
      .where(
        eq(
          conversationTurnExecutions.conversationId,
          graph.customer.conversation.id,
        ),
      );
    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, graph.session.id));
    expect(revisions).toHaveLength(1);
    expect(executions).toHaveLength(1);
    expect(executions[0]?.canonicalizationVersion).toBe(
      "elevenlabs-chat-completions.v2",
    );
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "conversation.connected",
        "job.revision_created",
      ]),
    );
    expect(revisions[0]?.data).toMatchObject({ origin: { city: "Zurich" } });

    const lateGenerationStarted = Promise.withResolvers<void>();
    const releaseLateGeneration = Promise.withResolvers<void>();
    const lateResponse = await handleChatCompletion(
      makeRequest([
        ...body.messages,
        { role: "assistant", content: "I recorded Zurich." },
        { role: "user", content: "Change the pickup city to Basel." },
      ]),
      {
        generate: async () => {
          lateGenerationStarted.resolve();
          await releaseLateGeneration.promise;
          return {
            spokenResponse: "I changed the pickup city to Basel.",
            reduction: {
              jobObservations: [
                {
                  path: "/origin/city",
                  value: "Basel",
                  evidenceQuote: "Basel",
                },
              ],
              offerObservations: [],
              signals: {
                jobConfirmed: false,
                jobCorrectionRequested: false,
                supplierDeclined: false,
                callbackRequested: false,
                offerIsFinal: false,
                selectedOfferRevisionId: null,
                supplierAcceptedExactTerms: false,
                customerDeclinedAll: false,
              },
            },
          };
        },
      },
    );
    const lateText = lateResponse.text();
    await lateGenerationStarted.promise;
    await db
      .update(conversations)
      .set({ status: "ended", endedAt: new Date() })
      .where(eq(conversations.id, graph.customer.conversation.id));
    releaseLateGeneration.resolve();
    await expect(lateText).resolves.toContain("The response stream failed");
    const revisionsAfterEnd = await db
      .select()
      .from(jobRevisions)
      .where(eq(jobRevisions.jobId, graph.job.id));
    expect(revisionsAfterEnd).toHaveLength(1);
    const executionsAfterEnd = await db
      .select()
      .from(conversationTurnExecutions)
      .where(
        eq(
          conversationTurnExecutions.conversationId,
          graph.customer.conversation.id,
        ),
      );
    expect(executionsAfterEnd).toHaveLength(2);
    expect(executionsAfterEnd.map((execution) => execution.status)).toEqual(
      expect.arrayContaining(["completed", "failed"]),
    );
    await client.end();
  }, 30_000);

  it("injects a verified anonymous offer into another live negotiation", async () => {
    process.env.DATABASE_URL = databaseUrl!;
    const config = useCaseConfigSchema.parse(
      JSON.parse(
        await readFile(
          new URL(
            "../../../../../config/use-cases/freight-brokerage/0.1.0.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    const { db, client } = createDatabase(databaseUrl);
    const published = await publishUseCaseConfiguration(db, {
      workspaceSlug: `leverage-test-${crypto.randomUUID().slice(0, 8)}`,
      workspaceName: "Leverage integration test",
      config,
    });
    const graph = await createSourcingSession(db, {
      workspaceId: published.workspace.id,
      configVersionId: published.configVersion.id,
      customer: { displayName: "Shipper", phoneE164: "+14155550100" },
      suppliers: [
        { displayName: "Carrier one", phoneE164: "+14155550101" },
        { displayName: "Carrier two", phoneE164: "+14155550102" },
      ],
    });
    const flags = {
      jobConfirmed: false,
      jobCorrectionRequested: false,
      supplierDeclined: false,
      callbackRequested: false,
      offerIsFinal: true,
      selectedOfferRevisionId: null,
      supplierAcceptedExactTerms: false,
      customerDeclinedAll: false,
    };
    const requestFor = (supplierIndex: number, text: string) => {
      const supplier = graph.suppliers[supplierIndex]!;
      return new Request("http://localhost/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "pacta-test",
          stream: true,
          tools: [
            {
              type: "function",
              function: {
                name: "end_call",
                description:
                  "End the conversation after a verified terminal outcome.",
                parameters: { type: "object" },
              },
            },
          ],
          messages: [{ role: "user", content: text }],
          elevenlabs_extra_body: {
            contract_version: "1",
            brain_token: supplier.brainToken,
            workspace_id: published.workspace.id,
            session_id: graph.session.id,
            conversation_id: supplier.conversation.id,
            negotiation_id: supplier.negotiation.id,
            purpose: "supplier_negotiation",
          },
        }),
      });
    };
    const first = await handleChatCompletion(
      requestFor(0, "All in, one thousand five hundred francs."),
      {
        generate: async () => ({
          spokenResponse: "Thank you. I have recorded that firm offer.",
          reduction: {
            jobObservations: [],
            offerObservations: [
              {
                path: "/pricing/currency",
                value: "CHF",
                evidenceQuote: "francs",
              },
              {
                path: "/pricing/lineItems",
                value: [
                  {
                    code: "linehaul",
                    label: "Linehaul",
                    amountMinor: 150000,
                    basis: "flat",
                  },
                ],
                evidenceQuote: "one thousand five hundred",
              },
              {
                path: "/pricing/allInTotalMinor",
                value: 150000,
                evidenceQuote: "All in, one thousand five hundred",
              },
              {
                path: "/service/pickupCommitment",
                value: "2026-07-20T08:00:00Z",
                evidenceQuote: "All in",
              },
              {
                path: "/service/deliveryCommitment",
                value: "2026-07-21T16:00:00Z",
                evidenceQuote: "All in",
              },
              {
                path: "/service/equipmentType",
                value: "dry_van_53",
                evidenceQuote: "All in",
              },
              {
                path: "/terms/quoteType",
                value: "firm",
                evidenceQuote: "offer",
              },
              {
                path: "/terms/validUntil",
                value: "2026-07-19T18:00:00Z",
                evidenceQuote: "offer",
              },
              {
                path: "/terms/paymentTerms",
                value: "net_30",
                evidenceQuote: "offer",
              },
              {
                path: "/terms/tollsIncluded",
                value: true,
                evidenceQuote: "All in",
              },
              {
                path: "/coverage/confirmed",
                value: true,
                evidenceQuote: "All in",
              },
              {
                path: "/coverage/limitMinor",
                value: 5000000,
                evidenceQuote: "All in",
              },
              { path: "/conditions", value: [], evidenceQuote: "All in" },
              { path: "/exclusions", value: [], evidenceQuote: "All in" },
              { path: "/unknowns", value: [], evidenceQuote: "All in" },
            ],
            signals: flags,
          },
        }),
      },
    );
    expect(first.status).toBe(200);
    await first.text();

    let secondSnapshot: BrainSnapshot | undefined;
    const second = await handleChatCompletion(
      requestFor(1, "Can you tell me where things stand?"),
      {
        generate: async (_request, snapshot) => {
          secondSnapshot = snapshot;
          return {
            spokenResponse:
              "I have a verified comparable offer. Can you improve yours?",
            reduction: {
              jobObservations: [],
              offerObservations: [],
              signals: { ...flags, offerIsFinal: false },
            },
          };
        },
      },
    );
    expect(second.status).toBe(200);
    await second.text();
    expect(secondSnapshot?.materialContext).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "injected.offer.revision_created",
          payload: expect.objectContaining({ amountMinor: 150000 }),
        }),
      ]),
    );
    const injections = await db
      .select()
      .from(contextInjections)
      .where(
        eq(
          contextInjections.targetConversationId,
          graph.suppliers[1]!.conversation.id,
        ),
      );
    expect(injections).toHaveLength(1);
    expect(injections[0]?.status).toBe("delivered");

    const [firstOfferRevision] = await db
      .select()
      .from(offerRevisions)
      .where(eq(offerRevisions.offerId, graph.suppliers[0]!.offer.id));
    expect(firstOfferRevision?.comparabilityStatus).toBe("comparable");
    const customerSelectionRequest = new Request(
      "http://localhost/api/v1/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "pacta-test",
          stream: true,
          messages: [
            {
              role: "user",
              content: "Choose Carrier one at exactly those terms.",
            },
          ],
          elevenlabs_extra_body: {
            contract_version: "1",
            brain_token: graph.customer.brainToken,
            workspace_id: published.workspace.id,
            session_id: graph.session.id,
            conversation_id: graph.customer.conversation.id,
            purpose: "customer_intake",
          },
        }),
      },
    );
    let customerSnapshot: BrainSnapshot | undefined;
    const customerSelection = await handleChatCompletion(
      customerSelectionRequest,
      {
        generate: async (_request, snapshot) => {
          customerSnapshot = snapshot;
          return {
            spokenResponse:
              "Understood. I will ask Carrier one to confirm the exact terms.",
            reduction: {
              jobObservations: [],
              offerObservations: [],
              signals: {
                ...flags,
                offerIsFinal: false,
                selectedOfferRevisionId: firstOfferRevision!.id,
              },
            },
          };
        },
      },
    );
    expect(customerSelection.status).toBe(200);
    await customerSelection.text();
    expect(customerSnapshot?.materialContext).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "injected.offer.revision_created",
          payload: expect.objectContaining({
            factKey: "comparable_offer_snapshot",
            offers: expect.arrayContaining([
              expect.objectContaining({
                offerRevisionId: firstOfferRevision!.id,
                supplierName: "Carrier one",
              }),
            ]),
            comparison: expect.objectContaining({
              recommendedOfferRevisionId: firstOfferRevision!.id,
            }),
          }),
        }),
      ]),
    );

    const supplierAcceptance = await handleChatCompletion(
      requestFor(0, "Yes, I accept those exact terms and commit."),
      {
        generate: async () => ({
          spokenResponse: "Confirmed. Thank you.",
          reduction: {
            jobObservations: [],
            offerObservations: [],
            signals: {
              ...flags,
              offerIsFinal: false,
              supplierAcceptedExactTerms: true,
            },
          },
        }),
      },
    );
    expect(supplierAcceptance.status).toBe(200);
    expect(await supplierAcceptance.text()).toContain('"name":"end_call"');
    const supplierAcceptanceRetry = await handleChatCompletion(
      requestFor(0, "Yes, I accept those exact terms and commit."),
      {
        generate: async () => {
          throw new Error(
            "A completed provider retry must replay the stored terminal response.",
          );
        },
      },
    );
    expect(supplierAcceptanceRetry.status).toBe(200);
    expect(await supplierAcceptanceRetry.text()).toContain('"name":"end_call"');
    const [award] = await db
      .select()
      .from(awards)
      .where(eq(awards.sessionId, graph.session.id));
    const [completedSession] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, graph.session.id));
    expect(award?.status).toBe("confirmed");
    expect(completedSession?.status).toBe("closing");
    await client.end();
  }, 30_000);
});
