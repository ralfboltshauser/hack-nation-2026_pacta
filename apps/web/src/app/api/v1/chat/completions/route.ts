import { handleChatCompletion } from "@/server/brain/handler";
import { runSessionAction } from "@/server/orchestration/calls";
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleChatCompletion(request, {
    onCommitted: ({ request: completionRequest, output }) => {
      if (
        completionRequest.elevenlabs_extra_body.purpose === "customer_intake" &&
        output.reduction.signals.jobConfirmed
      ) {
        after(() =>
          runSessionAction(
            completionRequest.elevenlabs_extra_body.session_id,
            "call_suppliers",
          ),
        );
      }
    },
  });
}
