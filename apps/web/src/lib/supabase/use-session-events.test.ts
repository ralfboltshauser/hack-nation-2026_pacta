import { describe, expect, it, vi } from "vitest";

import { mergeSessionEvents, type RealtimeSessionEvent } from "./event-buffer";
import { reconcileSessionEventCandidate } from "./use-session-events";

function event(eventSeq: number): RealtimeSessionEvent {
  return {
    id: `event-${eventSeq}`,
    eventSeq,
    eventType: `test.${eventSeq}`,
    aggregateType: null,
    aggregateId: null,
    payload: {},
  };
}

describe("session event reconciliation", () => {
  it("publishes a contiguous Broadcast event and refreshes the projection", async () => {
    let events = [event(1)];
    const publish = vi.fn((incoming: RealtimeSessionEvent[]) => {
      events = mergeSessionEvents(events, incoming);
    });
    const replayFrom = vi.fn(async () => undefined);
    const scheduleViewRefresh = vi.fn();

    await reconcileSessionEventCandidate(event(2), {
      getEvents: () => events,
      publish,
      replayFrom,
      scheduleViewRefresh,
    });

    expect(events.map((item) => item.eventSeq)).toEqual([1, 2]);
    expect(publish).toHaveBeenCalledOnce();
    expect(replayFrom).not.toHaveBeenCalled();
    expect(scheduleViewRefresh).toHaveBeenCalledOnce();
  });
});
