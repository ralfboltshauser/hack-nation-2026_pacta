import {
  chatCompletionHeaders,
  chatCompletionRequestSchema,
  createChatCompletionSse,
  createChatCompletionToolCallSse,
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

function completionStream(
  request: ChatCompletionRequest,
  begun: Awaited<ReturnType<typeof beginBrainTurn>>,
  output: BrainOutput,
  text: string,
) {
  const terminalReason = hasVerifiedTerminalState(begun, output);
  if (terminalReason && hasTool(request, "end_call")) {
    return createChatCompletionToolCallSse(
      {
        name: "end_call",
        arguments: { reason: terminalReason, message: text },
      },
      { model: request.model },
    );
  }
  if (output.responseAction === "skip" && hasTool(request, "skip_turn")) {
    return createChatCompletionToolCallSse(
      {
        name: "skip_turn",
        arguments: { reason: "No new material update is ready." },
      },
      { model: request.model },
    );
  }
  return createChatCompletionSse([text], { model: request.model });
}

export async function handleChatCompletion(
  request: Request,
  dependencies: BrainHandlerDependencies = {},
) {
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

  const { db, client } = openDatabase();
  let begun: Awaited<ReturnType<typeof beginBrainTurn>> | undefined;
  try {
    const fingerprint = fingerprintChatCompletion(parsed.data);
    begun = await beginBrainTurn(db, parsed.data, fingerprint);
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
          ? await (dependencies.generateIntake ?? generateIntakeBrainOutput)(
              begun.snapshot,
              {
                message: stripArtifactMarker(extractLastUserText(parsed.data)),
                conversationHistory: parsed.data.messages
                  .slice(0, -1)
                  .flatMap((message) => {
                    const content = stripArtifactMarker(
                      extractContentText(message.content),
                    );
                    return content &&
                      (message.role === "user" || message.role === "assistant")
                      ? [{ role: message.role, content } as const]
                      : [];
                  }),
                file: {
                  data: sourceArtifact.data,
                  mediaType: sourceArtifact.mediaType,
                  filename: sourceArtifact.filename,
                },
              },
            )
          : await (dependencies.generate ?? generateBrainOutput)(
              parsed.data,
              begun.snapshot,
            ));
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
    return new Response(completionStream(parsed.data, begun, output, text), {
      headers: chatCompletionHeaders(),
    });
  } catch (error) {
    if (begun && !begun.replayText) {
      await abortBrainTurn(
        db,
        begun,
        error instanceof Error ? error.message : "Unknown generation failure",
      ).catch(() => undefined);
    }
    if (error instanceof BrainAuthenticationError)
      return Response.json({ error: error.message }, { status: 401 });
    if (error instanceof BrainTurnInProgressError)
      return Response.json(
        { error: error.message },
        { status: 409, headers: { "Retry-After": "1" } },
      );
    console.error("Custom LLM turn failed", error);
    return Response.json({ error: "Custom LLM turn failed" }, { status: 500 });
  } finally {
    await client.end();
  }
}
