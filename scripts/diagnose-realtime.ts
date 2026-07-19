import { createClient } from "@supabase/supabase-js";

import {
  appendSessionEvent,
  createDatabase,
} from "../packages/db/src/index.ts";

type DurableEvent = {
  id: string;
  eventSeq: number;
  eventType: string;
  payload: Record<string, unknown>;
};

type BroadcastEnvelope = {
  event?: string;
  payload?: Record<string, unknown>;
};

const sessionId = process.argv[2];
if (!sessionId) {
  throw new Error(
    "Usage: tsx scripts/diagnose-realtime.ts <public-demo-session-id>",
  );
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 15_000,
) {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer!));
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as T;
  if (!response.ok) {
    throw new Error(
      `${url} failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function main() {
  const origin = (
    process.env.PACTA_BASE_URL ?? "https://pacta.openexp.dev"
  ).replace(/\/$/, "");
  const supabase = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const readiness = await jsonRequest<{
    ok: boolean;
    checks: { outboundCalls: string };
  }>(`${origin}/api/health/ready`);
  if (!readiness.ok || readiness.checks.outboundCalls !== "disarmed") {
    throw new Error(
      `Refusing diagnostic while outbound calls are not disarmed: ${JSON.stringify(readiness)}`,
    );
  }

  const signedIn = await supabase.auth.signInAnonymously();
  if (signedIn.error || !signedIn.data.session) {
    throw signedIn.error ?? new Error("Anonymous sign-in returned no session.");
  }
  const accessToken = signedIn.data.session.access_token;
  const headers = { authorization: `Bearer ${accessToken}` };

  await jsonRequest(`${origin}/api/sessions/${sessionId}/join`, {
    method: "POST",
    headers,
  });
  await supabase.realtime.setAuth(accessToken);

  const replayBefore = await jsonRequest<{
    events: DurableEvent[];
    nextAfter: number;
  }>(`${origin}/api/sessions/${sessionId}/events?after=0`, { headers });

  let resolveSubscribed!: () => void;
  let rejectSubscribed!: (error: Error) => void;
  const subscribed = new Promise<void>((resolve, reject) => {
    resolveSubscribed = resolve;
    rejectSubscribed = reject;
  });
  let resolveBroadcast!: (message: BroadcastEnvelope) => void;
  const broadcastReceived = new Promise<BroadcastEnvelope>((resolve) => {
    resolveBroadcast = resolve;
  });

  const channel = supabase
    .channel(`session:${sessionId}`, { config: { private: true } })
    .on("broadcast", { event: "*" }, (message) => {
      resolveBroadcast(message as BroadcastEnvelope);
    })
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") resolveSubscribed();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        rejectSubscribed(
          error ?? new Error(`Realtime subscription entered ${status}.`),
        );
      }
    });

  try {
    await withTimeout(subscribed, "Realtime private-channel subscription");

    const probeId = crypto.randomUUID();
    const { db, client } = createDatabase();
    let inserted: DurableEvent;
    try {
      const [session] = await client<
        { id: string; workspaceId: string }[]
      >`select id::text, workspace_id::text as "workspaceId" from sessions where id = ${sessionId}::uuid`;
      if (!session) throw new Error(`Session ${sessionId} does not exist.`);
      inserted = (await appendSessionEvent(db, {
        workspaceId: session.workspaceId,
        sessionId,
        aggregateType: "session",
        aggregateId: sessionId,
        eventType: "diagnostic.realtime_probe",
        source: "diagnostic",
        idempotencyKey: `realtime-probe:${probeId}`,
        correlationId: probeId,
        payload: { probeId },
      })) as DurableEvent;
    } finally {
      await client.end();
    }

    const liveEnvelope = await withTimeout(
      broadcastReceived,
      "Realtime Broadcast delivery",
    );
    const livePayload = (liveEnvelope.payload ?? liveEnvelope) as Record<
      string,
      unknown
    >;
    const liveSequence = Number(livePayload.eventSeq ?? livePayload.event_seq);
    const liveType = livePayload.eventType ?? livePayload.event_type;

    const replayAfter = await jsonRequest<{
      events: DurableEvent[];
      nextAfter: number;
    }>(
      `${origin}/api/sessions/${sessionId}/events?after=${replayBefore.nextAfter}`,
      { headers },
    );
    const replayed = replayAfter.events.find(
      (event) =>
        event.id === inserted.id || event.eventSeq === inserted.eventSeq,
    );

    const result = {
      sessionId,
      anonymousAuth: "verified",
      membershipJoin: "verified",
      privateSubscription: "verified",
      durableInsert: {
        id: inserted.id,
        eventSeq: inserted.eventSeq,
        eventType: inserted.eventType,
      },
      liveBroadcast: {
        verified:
          liveSequence === inserted.eventSeq && liveType === inserted.eventType,
        eventSeq: liveSequence,
        eventType: liveType,
      },
      durableReplay: {
        verified: Boolean(replayed),
        eventSeq: replayed?.eventSeq,
        eventType: replayed?.eventType,
      },
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.liveBroadcast.verified || !result.durableReplay.verified) {
      process.exitCode = 1;
    }
  } finally {
    await supabase.removeChannel(channel);
    await supabase.auth.signOut();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
