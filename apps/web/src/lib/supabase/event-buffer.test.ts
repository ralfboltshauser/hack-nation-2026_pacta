import { describe, expect, it } from "vitest";

import {
  contiguousEventSequence,
  hasEventGap,
  mergeSessionEvents,
  normalizeSessionEvent,
  type RealtimeSessionEvent,
} from "./event-buffer";

function event(eventSeq: number): RealtimeSessionEvent {
  return {
    id: `event-${eventSeq}`,
    eventSeq,
    eventType: `test.${eventSeq}`,
    payload: {},
  };
}

describe("realtime event buffer", () => {
  it("normalizes Postgres and application field names", () => {
    expect(
      normalizeSessionEvent({
        id: "a",
        event_seq: "2",
        event_type: "job.updated",
        payload: { ok: true },
      }),
    ).toEqual({
      id: "a",
      eventSeq: 2,
      eventType: "job.updated",
      payload: { ok: true },
    });
    expect(
      normalizeSessionEvent({ eventSeq: 0, eventType: "invalid" }),
    ).toBeNull();
  });

  it("deduplicates and orders replay plus reordered broadcasts", () => {
    expect(
      mergeSessionEvents(
        [event(1), event(2)],
        [event(4), event(2), event(3)],
      ).map((item) => item.eventSeq),
    ).toEqual([1, 2, 3, 4]);
  });

  it("detects a missing durable sequence until backfill repairs it", () => {
    const gapped = mergeSessionEvents([event(1)], [event(3)]);
    expect(contiguousEventSequence(gapped)).toBe(1);
    expect(hasEventGap(gapped)).toBe(true);
    expect(hasEventGap(mergeSessionEvents(gapped, [event(2)]))).toBe(false);
  });
});
