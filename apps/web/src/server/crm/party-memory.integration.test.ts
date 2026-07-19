import { readFile } from "node:fs/promises";

import {
  conversations,
  createDatabase,
  createSourcingSession,
  partyMemoryObservations,
  publishUseCaseConfiguration,
  useCasePartyRoles,
} from "@pacta/db";
import { useCaseConfigSchema } from "@pacta/use-case-config";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  loadConversationPartyMemoryPromptContext,
  storePartyMemory,
} from "./party-memory";
import { handleChatCompletion } from "../brain/handler";

const databaseUrl = process.env.TEST_DATABASE_URL;

function history(message: string) {
  return JSON.stringify({ entries: [{ role: "user", message }] });
}

describe.skipIf(!databaseUrl)("party CRM memory persistence", () => {
  it("stores evidence idempotently, supersedes corrections, and injects memory on a later CRM call", async () => {
    process.env.DATABASE_URL = databaseUrl!;
    const { db, client } = createDatabase(databaseUrl);
    try {
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
      const suffix = crypto.randomUUID().slice(0, 8);
      const published = await publishUseCaseConfiguration(db, {
        workspaceSlug: `party-memory-${suffix}`,
        workspaceName: "Party memory test",
        config,
      });
      const first = await createSourcingSession(db, {
        workspaceId: published.workspace.id,
        configVersionId: published.configVersion.id,
        customer: { displayName: "First customer" },
        suppliers: [{ displayName: "Reusable carrier" }],
      });
      const source = first.suppliers[0]!;
      const providerConversationId = `conv_memory_${crypto.randomUUID()}`;
      await db
        .update(conversations)
        .set({ providerConversationId, status: "connected" })
        .where(eq(conversations.id, source.conversation.id));

      const initialBody = {
        conversation_id: providerConversationId,
        conversation_history: history("Please call me in the morning."),
        memory_token: source.brainToken,
        category: "communication_preference",
        memory_key: "preferred_call_time",
        content: "Prefers calls in the morning.",
        evidence_quote: "call me in the morning",
      };
      await expect(
        storePartyMemory(db, {
          ...initialBody,
          memory_token: "x".repeat(43),
        }),
      ).rejects.toThrow("Unknown ElevenLabs conversation");
      const initial = await storePartyMemory(db, initialBody);
      expect(initial).toMatchObject({
        accepted: true,
        created: true,
      });
      expect(await storePartyMemory(db, initialBody)).toMatchObject({
        accepted: true,
        created: false,
      });
      const correction = await storePartyMemory(db, {
        ...initialBody,
        conversation_history: history(
          "Actually, please call me only after four in the afternoon.",
        ),
        content: "Prefers calls after 16:00.",
        evidence_quote: "call me only after four in the afternoon",
      });
      expect(correction).toMatchObject({
        accepted: true,
        created: true,
        ...("memoryId" in initial
          ? { supersedesMemoryId: initial.memoryId }
          : {}),
      });

      await db.insert(useCasePartyRoles).values({
        workspaceId: published.workspace.id,
        useCaseId: published.useCase.id,
        partyId: source.supplier.id,
        roleKey: "supplier",
      });
      const second = await createSourcingSession(db, {
        workspaceId: published.workspace.id,
        configVersionId: published.configVersion.id,
        customer: { displayName: "Second customer" },
        suppliers: [{ partyId: source.supplier.id }],
      });
      expect(second.suppliers[0]!.supplier.id).toBe(source.supplier.id);
      const promptContext = JSON.parse(
        await loadConversationPartyMemoryPromptContext(
          db,
          second.suppliers[0]!.conversation.id,
        ),
      ) as Array<{ key: string; fact: string }>;
      expect(promptContext).toEqual([
        expect.objectContaining({
          key: "preferred_call_time",
          fact: "Prefers calls after 16:00.",
        }),
      ]);

      let customLlmMemoryContext: string | undefined;
      const customLlmResponse = await handleChatCompletion(
        new Request("http://localhost/api/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "pacta-test",
            stream: true,
            messages: [
              {
                role: "user",
                content: "For future jobs, email confirmations work best.",
              },
            ],
            tools: [
              {
                type: "function",
                function: { name: "store_party_memory", parameters: {} },
              },
            ],
            elevenlabs_extra_body: {
              contract_version: "1",
              brain_token: second.suppliers[0]!.brainToken,
              workspace_id: published.workspace.id,
              session_id: second.session.id,
              conversation_id: second.suppliers[0]!.conversation.id,
              purpose: "supplier_negotiation",
              negotiation_id: second.suppliers[0]!.negotiation.id,
            },
          }),
        }),
        {
          generate: async (_request, snapshot) => {
            customLlmMemoryContext = snapshot.partyMemory;
            return {
              spokenResponse: "Understood.",
              reduction: {
                jobObservations: [],
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
              supplierMemory: {
                category: "communication_preference",
                memoryKey: "confirmation_channel",
                content: "Prefers confirmations by email.",
                evidenceQuote: "email confirmations work best",
              },
            };
          },
        },
      );
      const customLlmBody = await customLlmResponse.text();
      expect(customLlmMemoryContext).toContain("Prefers calls after 16:00.");
      expect(customLlmBody).toContain('"name":"store_party_memory"');
      expect(customLlmBody).toContain("confirmation_channel");

      const stored = await db
        .select()
        .from(partyMemoryObservations)
        .where(eq(partyMemoryObservations.partyId, source.supplier.id));
      expect(stored).toHaveLength(2);
      expect(stored.find((row) => row.content.includes("16:00"))).toMatchObject(
        {
          supersedesObservationId:
            "memoryId" in initial ? initial.memoryId : null,
        },
      );
    } finally {
      await client.end();
    }
  });
});
