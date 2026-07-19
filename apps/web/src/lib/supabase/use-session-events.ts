"use client";

import { useEffect, useState } from "react";

import type { SessionView } from "../session-view";
import {
  contiguousEventSequence,
  hasEventGap,
  mergeSessionEvents,
  normalizeSessionEvent,
  type RealtimeSessionEvent,
} from "./event-buffer";
import { ensureSessionAccess } from "./session-access";

const replayPageSize = 500;
const subscriptionRetryDelaysMs = [250, 750, 1_500] as const;

type CandidateReconciliation = {
  getEvents: () => RealtimeSessionEvent[];
  publish: (events: RealtimeSessionEvent[]) => void;
  replayFrom: (after: number) => Promise<void>;
  scheduleViewRefresh: () => void;
};

export async function reconcileSessionEventCandidate(
  candidate: RealtimeSessionEvent | undefined,
  reconciliation: CandidateReconciliation,
) {
  const contiguousSequence = contiguousEventSequence(
    reconciliation.getEvents(),
  );
  if (candidate && candidate.eventSeq <= contiguousSequence) return;

  if (candidate && candidate.eventSeq === contiguousSequence + 1) {
    reconciliation.publish([candidate]);
    reconciliation.scheduleViewRefresh();
    return;
  }

  await reconciliation.replayFrom(contiguousSequence);
  if (
    candidate &&
    !reconciliation
      .getEvents()
      .some((event) => event.eventSeq === candidate.eventSeq)
  )
    reconciliation.publish([candidate]);
  if (hasEventGap(reconciliation.getEvents()))
    throw new Error(
      "Durable event replay did not repair a Broadcast sequence gap.",
    );
  reconciliation.scheduleViewRefresh();
}

export function useSessionEvents(sessionId?: string) {
  const [events, setEvents] = useState<RealtimeSessionEvent[]>([]);
  const [view, setView] = useState<SessionView | null>(null);
  const [status, setStatus] = useState<
    "demo" | "connecting" | "live" | "error"
  >(sessionId ? "connecting" : "demo");

  useEffect(() => {
    if (!sessionId) return;
    const activeSessionId = sessionId;
    type RealtimeClient = Awaited<
      ReturnType<typeof ensureSessionAccess>
    >["supabase"];
    let realtimeClient: RealtimeClient | undefined;
    let cancelled = false;
    let channel: ReturnType<RealtimeClient["channel"]> | undefined;
    let buffer: RealtimeSessionEvent[] = [];
    let replayQueue = Promise.resolve();
    let replayHealthy = true;
    let viewRefresh: ReturnType<typeof setTimeout> | undefined;
    let subscriptionRetry: ReturnType<typeof setTimeout> | undefined;
    let consecutiveSubscriptionFailures = 0;

    function publish(incoming: RealtimeSessionEvent[]) {
      buffer = mergeSessionEvents(buffer, incoming);
      if (!cancelled) setEvents(buffer);
    }

    async function connect() {
      const access = await ensureSessionAccess(activeSessionId);
      realtimeClient = access.supabase;
      const authHeaders = access.headers;

      async function refreshView() {
        const response = await fetch(`/api/sessions/${activeSessionId}/view`, {
          headers: authHeaders,
        });
        if (!response.ok)
          throw new Error(`Session projection failed (${response.status}).`);
        if (!cancelled) setView((await response.json()) as SessionView);
      }

      function scheduleViewRefresh(immediate = false) {
        if (viewRefresh) clearTimeout(viewRefresh);
        viewRefresh = setTimeout(
          () => {
            refreshView().catch(() => !cancelled && setStatus("error"));
          },
          immediate ? 0 : 80,
        );
      }

      async function replayFrom(after: number) {
        let cursor = after;
        for (;;) {
          const replay = await fetch(
            `/api/sessions/${activeSessionId}/events?after=${cursor}`,
            { headers: authHeaders },
          );
          if (!replay.ok)
            throw new Error(`Event replay failed (${replay.status}).`);
          const body = (await replay.json()) as {
            events: Record<string, unknown>[];
            nextAfter: number;
          };
          const page = body.events
            .map(normalizeSessionEvent)
            .filter((event): event is RealtimeSessionEvent => Boolean(event));
          publish(page);
          if (page.length < replayPageSize || body.nextAfter <= cursor) break;
          cursor = body.nextAfter;
        }
      }

      function queueCandidate(candidate?: RealtimeSessionEvent) {
        replayQueue = replayQueue
          .then(() =>
            reconcileSessionEventCandidate(candidate, {
              getEvents: () => buffer,
              publish,
              replayFrom,
              scheduleViewRefresh,
            }),
          )
          .catch(() => {
            replayHealthy = false;
            if (!cancelled) setStatus("error");
          });
      }

      function subscribeToSessionEvents() {
        if (cancelled || !realtimeClient) return;
        const client = realtimeClient;
        const candidateChannel = client
          .channel(`session:${activeSessionId}`, { config: { private: true } })
          .on("broadcast", { event: "*" }, (message) => {
            const candidate = normalizeSessionEvent(
              (message.payload ?? message) as Record<string, unknown>,
            );
            if (!candidate) return;
            queueCandidate(candidate);
          });
        channel = candidateChannel;
        candidateChannel.subscribe((nextStatus) => {
          if (cancelled || channel !== candidateChannel) return;
          if (nextStatus === "SUBSCRIBED") {
            consecutiveSubscriptionFailures = 0;
            queueCandidate();
            scheduleViewRefresh(true);
            replayQueue.then(
              () => !cancelled && replayHealthy && setStatus("live"),
            );
            return;
          }
          if (nextStatus !== "CHANNEL_ERROR" && nextStatus !== "TIMED_OUT")
            return;

          const delay =
            subscriptionRetryDelaysMs[consecutiveSubscriptionFailures];
          if (delay === undefined) {
            setStatus("error");
            return;
          }
          consecutiveSubscriptionFailures += 1;
          channel = undefined;
          setStatus("connecting");
          void client.removeChannel(candidateChannel).finally(() => {
            if (cancelled) return;
            subscriptionRetry = setTimeout(subscribeToSessionEvents, delay);
          });
        });
      }

      subscribeToSessionEvents();
    }
    connect().catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
      if (viewRefresh) clearTimeout(viewRefresh);
      if (subscriptionRetry) clearTimeout(subscriptionRetry);
      if (channel && realtimeClient) void realtimeClient.removeChannel(channel);
    };
  }, [sessionId]);

  return { events, status, view };
}
