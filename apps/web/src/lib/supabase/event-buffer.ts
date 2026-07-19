export type RealtimeSessionEvent = {
  id: string;
  eventSeq: number;
  eventType: string;
  payload: Record<string, unknown>;
};

export function normalizeSessionEvent(
  raw: Record<string, unknown>,
): RealtimeSessionEvent | null {
  const eventSeq = Number(raw.eventSeq ?? raw.event_seq);
  const eventType = raw.eventType ?? raw.event_type;
  if (
    !Number.isSafeInteger(eventSeq) ||
    eventSeq < 1 ||
    typeof eventType !== "string"
  )
    return null;
  return {
    id: String(raw.id ?? `${eventSeq}:${eventType}`),
    eventSeq,
    eventType,
    payload:
      raw.payload &&
      typeof raw.payload === "object" &&
      !Array.isArray(raw.payload)
        ? (raw.payload as Record<string, unknown>)
        : {},
  };
}

export function mergeSessionEvents(
  current: RealtimeSessionEvent[],
  incoming: RealtimeSessionEvent[],
): RealtimeSessionEvent[] {
  const bySequence = new Map(current.map((event) => [event.eventSeq, event]));
  for (const event of incoming)
    bySequence.set(event.eventSeq, bySequence.get(event.eventSeq) ?? event);
  return [...bySequence.values()].sort(
    (left, right) => left.eventSeq - right.eventSeq,
  );
}

export function contiguousEventSequence(events: RealtimeSessionEvent[]) {
  let last = 0;
  for (const event of events) {
    if (event.eventSeq <= last) continue;
    if (event.eventSeq !== last + 1) break;
    last = event.eventSeq;
  }
  return last;
}

export function hasEventGap(events: RealtimeSessionEvent[]) {
  return (
    events.length > 0 &&
    contiguousEventSequence(events) !== events.at(-1)?.eventSeq
  );
}
