import { readFile } from "node:fs/promises";

import {
  artifacts,
  conversationTurnExecutions,
  createDatabase,
  createSourcingSession,
  evidence,
  jobRevisionEvidence,
  jobRevisions,
  publishUseCaseConfiguration,
} from "@pacta/db";
import { useCaseConfigSchema } from "@pacta/use-case-config";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { handleChatCompletion } from "@/server/brain/handler";
import type { BrainSnapshot, IntakeBrainInput } from "@/server/brain/model";

import { artifactMarker, stageIntakeArtifact } from "./intake";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("ElevenLabs multimodal customer intake", () => {
  it("stages the private file and reduces one idempotent attachment-backed turn", async () => {
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
      workspaceSlug: `multimodal-test-${crypto.randomUUID().slice(0, 8)}`,
      workspaceName: "Multimodal integration test",
      config,
    });
    const graph = await createSourcingSession(db, {
      workspaceId: published.workspace.id,
      configVersionId: published.configVersion.id,
      customer: { displayName: "Test customer", phoneE164: "+14155550100" },
      suppliers: [],
    });
    const artifactId = crypto.randomUUID();
    const form = new FormData();
    form.set("turnId", artifactId);
    form.set(
      "file",
      new File(["Pickup: Zurich, Switzerland"], "load.pdf", {
        type: "application/pdf",
      }),
    );
    const upload = vi.fn(async () => undefined);
    const staged = await stageIntakeArtifact(db, graph.session.id, form, {
      upload,
    });
    await stageIntakeArtifact(db, graph.session.id, form, { upload });
    expect(staged.marker).toBe(artifactMarker(artifactId));
    expect(upload).toHaveBeenCalledTimes(1);

    const body = {
      model: "pacta-test",
      stream: true,
      messages: [
        {
          role: "user",
          content: `Please read this load sheet.\n\n${staged.marker}`,
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
    };
    let reducedMessage = "";
    const dependencies = {
      loadArtifact: async () => ({
        artifactId,
        data: new TextEncoder().encode("Pickup: Zurich, Switzerland"),
        filename: "load.pdf",
        mediaType: "application/pdf",
      }),
      generateIntake: async (
        _snapshot: BrainSnapshot,
        input: IntakeBrainInput,
      ) => {
        reducedMessage = input.message;
        return {
          spokenResponse: "I found Zurich. Which destination should I use?",
          reduction: {
            jobObservations: [
              {
                path: "/origin/city",
                value: "Zurich",
                evidenceQuote: "Zurich",
                evidenceSource: "attachment" as const,
              },
              {
                path: "/origin/country",
                value: "Switzerland",
                evidenceQuote: "Switzerland",
                evidenceSource: "attachment" as const,
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
    };
    const makeRequest = () =>
      new Request("http://localhost/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const first = await handleChatCompletion(makeRequest(), dependencies);
    const replay = await handleChatCompletion(makeRequest(), dependencies);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(reducedMessage).toBe("Please read this load sheet.");

    const artifactRows = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.sessionId, graph.session.id));
    const revisionRows = await db
      .select()
      .from(jobRevisions)
      .where(eq(jobRevisions.jobId, graph.job.id));
    const evidenceRows = await db
      .select()
      .from(evidence)
      .where(eq(evidence.sessionId, graph.session.id));
    const links = revisionRows[0]
      ? await db
          .select()
          .from(jobRevisionEvidence)
          .where(eq(jobRevisionEvidence.jobRevisionId, revisionRows[0].id))
      : [];
    const executions = await db
      .select()
      .from(conversationTurnExecutions)
      .where(
        eq(
          conversationTurnExecutions.conversationId,
          graph.customer.conversation.id,
        ),
      );
    expect(artifactRows).toHaveLength(1);
    expect(revisionRows).toHaveLength(1);
    expect(revisionRows[0]?.data).toMatchObject({
      origin: { city: "Zurich", country: "Switzerland" },
    });
    expect(evidenceRows).toHaveLength(2);
    expect(
      evidenceRows.every(
        (row) =>
          row.sourceArtifactId === artifactId &&
          row.sourceConversationTurnId === null,
      ),
    ).toBe(true);
    expect(links).toHaveLength(2);
    expect(executions).toHaveLength(1);
    await client.end();
  });
});
