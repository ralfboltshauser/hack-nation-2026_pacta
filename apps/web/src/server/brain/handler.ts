import {
  chatCompletionHeaders,
  chatCompletionRequestSchema,
  createDeferredChatCompletionSse,
  ELEVENLABS_BUFFER_TEXT,
  extractContentText,
  extractLastUserText,
  fingerprintChatCompletion,
} from "@pacta/elevenlabs";
import type { ChatCompletionRequest } from "@pacta/elevenlabs";

import {
  artifactIdFromMessages,
  loadIntakeArtifact,
  stripArtifactMarker,
} from "@/server/artifacts/intake";

import {
  generateBrainOutput,
  generateIntakeBrainOutput,
  type BrainOutput,
} from "./model";
import {
  abortBrainTurn,
  beginBrainTurn,
  BrainAuthenticationError,
  BrainTurnInProgressError,
  completeBrainTurn,
  openDatabase,
} from "./persistence";

export type BrainHandlerDependencies = {
  generate?: typeof generateBrainOutput;
  generateIntake?: typeof generateIntakeBrainOutput;
  loadArtifact?: typeof loadIntakeArtifact;
  onCommitted?: (input: {
    request: ChatCompletionRequest;
    output: BrainOutput;
  }) => void;
};

function hasTool(request: ChatCompletionRequest, name: string) {
  return (
    request.tools?.some((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const tool = candidate as Record<string, unknown>;
      if (tool.name === name) return true;
      const fn = tool.function;
      return Boolean(
        fn &&
        typeof fn === "object" &&
        (fn as Record<string, unknown>).name === name,
      );
    }) ?? false
  );
}

function hasVerifiedTerminalState(
  begun: Awaited<ReturnType<typeof beginBrainTurn>>,
  output: BrainOutput,
) {
  const signals = output.reduction.signals;
  if (
    begun.snapshot.purpose === "customer_intake" &&
    signals.customerDeclinedAll
  )
    return "customer_declined_all";
  if (begun.snapshot.purpose !== "customer_intake" && signals.supplierDeclined)
    return "supplier_declined";
  if (
    begun.snapshot.purpose !== "customer_intake" &&
    signals.supplierAcceptedExactTerms
  )
    return "supplier_committed";
  if (
    begun.snapshot.materialContext.some((event) =>
      event.eventType.endsWith("award.confirmed"),
    )
  )
    return "award_confirmed";
  return null;
}

function completionResult(
  request: ChatCompletionRequest,
  begun: Awaited<ReturnType<typeof beginBrainTurn>>,
  output: BrainOutput,
  text: string,
) {
  const terminalReason = hasVerifiedTerminalState(begun, output);
  if (terminalReason && hasTool(request, "end_call")) {
    return {
      type: "tool_call" as const,
      tool: {
        name: "end_call",
        arguments: { reason: terminalReason, message: text },
      },
    };
  }
  if (output.responseAction === "skip" && hasTool(request, "skip_turn")) {
    return {
      type: "tool_call" as const,
      tool: {
        name: "skip_turn",
        arguments: { reason: "No new material update is ready." },
      },
    };
  }
  return { type: "text" as const, text };
}

async function beginBrainTurnWithWait(
  db: Parameters<typeof beginBrainTurn>[0],
  request: ChatCompletionRequest,
  fingerprint: string,
) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await beginBrainTurn(db, request, fingerprint);
    } catch (error) {
      if (
        !(error instanceof BrainTurnInProgressError) ||
        Date.now() >= deadline
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

export async function handleChatCompletion(
  request: Request,
  dependencies: BrainHandlerDependencies = {},
) {
  const requestStartedAt = performance.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = chatCompletionRequestSchema.safeParse(body);
  if (!parsed.success)
    return Response.json(
      {
        error: "Invalid chat completion request",
        details: parsed.error.issues,
      },
      { status: 422 },
    );

  return new Response(
    createDeferredChatCompletionSse(
      async () => {
        const { db, client } = openDatabase();
        let begun: Awaited<ReturnType<typeof beginBrainTurn>> | undefined;
        let beginCompletedAt = requestStartedAt;
        let generationCompletedAt = requestStartedAt;
        try {
          const fingerprint = fingerprintChatCompletion(parsed.data);
          begun = await beginBrainTurnWithWait(db, parsed.data, fingerprint);
          beginCompletedAt = performance.now();
          generationCompletedAt = beginCompletedAt;
          const artifactId = artifactIdFromMessages(parsed.data.messages);
          const sourceArtifact =
            !begun.replayText && artifactId
              ? await (dependencies.loadArtifact ?? loadIntakeArtifact)(
                  db,
                  begun,
                  artifactId,
                )
              : null;
          const output: BrainOutput =
            begun.replayOutput ??
            (begun.replayText
              ? {
                  spokenResponse: begun.replayText,
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
                }
              : sourceArtifact
                ? await (
                    dependencies.generateIntake ?? generateIntakeBrainOutput
                  )(begun.snapshot, {
                    message: stripArtifactMarker(
                      extractLastUserText(parsed.data),
                    ),
                    conversationHistory: parsed.data.messages
                      .slice(0, -1)
                      .flatMap((message) => {
                        const content = stripArtifactMarker(
                          extractContentText(message.content),
                        );
                        return content &&
                          (message.role === "user" ||
                            message.role === "assistant")
                          ? [{ role: message.role, content } as const]
                          : [];
                      }),
                    file: {
                      data: sourceArtifact.data,
                      mediaType: sourceArtifact.mediaType,
                      filename: sourceArtifact.filename,
                    },
                  })
                : await (dependencies.generate ?? generateBrainOutput)(
                    parsed.data,
                    begun.snapshot,
                  ));
          generationCompletedAt = performance.now();
          const text =
            begun.replayText ??
            (await completeBrainTurn(
              db,
              begun,
              output,
              sourceArtifact
                ? {
                    sourceArtifact: {
                      artifactId: sourceArtifact.artifactId,
                      filename: sourceArtifact.filename,
                    },
                  }
                : {},
            ));
          if (!begun.replayText)
            dependencies.onCommitted?.({ request: parsed.data, output });
          const completedAt = performance.now();
          console.info("Custom LLM turn timing", {
            executionId: begun.executionId,
            purpose: begun.snapshot.purpose,
            replay: Boolean(begun.replayText),
            beginMs: Math.round(beginCompletedAt - requestStartedAt),
            generationMs: Math.round(generationCompletedAt - beginCompletedAt),
            commitMs: Math.round(completedAt - generationCompletedAt),
            totalMs: Math.round(completedAt - requestStartedAt),
          });
          return completionResult(parsed.data, begun, output, text);
        } catch (error) {
          if (begun && !begun.replayText) {
            await abortBrainTurn(
              db,
              begun,
              error instanceof Error
                ? error.message
                : "Unknown generation failure",
            ).catch(() => undefined);
          }
          if (
            !(error instanceof BrainAuthenticationError) &&
            !(error instanceof BrainTurnInProgressError)
          )
            console.error("Custom LLM turn failed", {
              executionId: begun?.executionId ?? null,
              purpose: parsed.data.elevenlabs_extra_body.purpose,
              beginMs: Math.round(beginCompletedAt - requestStartedAt),
              generationMs: Math.round(
                generationCompletedAt - beginCompletedAt,
              ),
              totalMs: Math.round(performance.now() - requestStartedAt),
              errorName: error instanceof Error ? error.name : "unknown",
              errorMessage:
                error instanceof Error ? error.message : "Unknown failure",
            });
          throw error;
        } finally {
          await client.end();
        }
      },
      { bufferText: ELEVENLABS_BUFFER_TEXT, model: parsed.data.model },
    ),
    { headers: chatCompletionHeaders() },
  );
}
