# Native offer transaction deadlock — 2026-07-19

Status: fixed and regression-tested without retries

## Failure

A clean PostgreSQL 17 run with three supplier offers submitted in parallel failed with SQLSTATE `40P01` at `appendSessionEventInTransaction` while acquiring `SELECT ... FROM sessions FOR UPDATE`.

The failure was in Pacta's transaction lock order. It was not caused by ElevenLabs, Vercel, Supabase Realtime, or invalid offer data.

## Failing sequence

```mermaid
sequenceDiagram
    participant A as "Supplier transaction A"
    participant B as "Supplier transaction B"
    participant S as "Session row"

    A->>S: "Insert child rows; FK check takes KEY SHARE"
    B->>S: "Insert child rows; FK check takes KEY SHARE"
    A->>S: "Append event; request UPDATE lock"
    Note over A,S: "Waits for B's KEY SHARE"
    B->>S: "Append event; request UPDATE lock"
    Note over B,S: "Waits for A's KEY SHARE"
    S-->>A: "Postgres aborts one transaction with 40P01"
```

Each transaction locked its negotiation and offer, inserted rows referencing the shared session, and only then tried to lock the session to allocate the ordered event sequence. Parallel transactions therefore attempted a lock upgrade while holding mutually compatible key-share locks.

## Fix

All native business writers use one parent-to-child order:

```mermaid
sequenceDiagram
    participant A as "Supplier transaction A"
    participant B as "Supplier transaction B"
    participant S as "Session row"

    A->>S: "Lock session FOR UPDATE"
    B->>S: "Wait"
    A->>S: "Lock negotiation and offer; insert revision and event"
    A-->>S: "Commit"
    S-->>B: "Acquire session lock and continue"
```

The session lock covers only the short deterministic database transaction. Model inference and provider network work remain outside it. No retry was added.

## Verification

- Three supplier offers submitted concurrently complete without a deadlock.
- Duplicate provider deliveries and same-offer fanout still converge on one immutable revision.
- The complete native flow—confirmed job, three comparable offers, selection, commitment, and two non-winner closeouts—passes against a clean migrated PostgreSQL database.
