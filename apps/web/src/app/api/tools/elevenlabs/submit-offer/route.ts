import { createDatabase } from "@pacta/db";

import {
  NativeSubmitOfferError,
  submitNativeOffer,
} from "@/server/native-tools/submit-offer";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { db, client } = createDatabase();
  try {
    const result = await submitNativeOffer(db, body);
    return Response.json(result);
  } catch (error) {
    if (error instanceof NativeSubmitOfferError)
      return Response.json({ error: error.message }, { status: error.status });
    console.error("Native ElevenLabs submit_offer failed", error);
    return Response.json(
      { error: "submit_offer failed unexpectedly." },
      { status: 500 },
    );
  } finally {
    await client.end();
  }
}
