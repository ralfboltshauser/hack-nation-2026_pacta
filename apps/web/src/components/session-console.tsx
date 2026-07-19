"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Check,
  MessageCircle,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useSessionEvents } from "@/lib/supabase/use-session-events";
import {
  projectSessionView,
  type PartyState,
} from "@/lib/session-view-projector";

import { MascotStage } from "./mascot-stage";

type DemoFrame = {
  phase: number;
  activity: string;
  customer: PartyState;
  suppliers: Array<{ state: PartyState; offer?: string; detail?: string }>;
  event: string;
  duration: number;
};

const supplierNames = ["Alpine Haulage", "Rhine Cargo", "Northstar Transit"];
const phases = ["Intake", "Sourcing", "Selection", "Settlement"];
const initialSuppliers = supplierNames.map(() => ({
  state: "queued" as PartyState,
}));
const frames: DemoFrame[] = [
  {
    phase: 0,
    activity: "Opening the customer chat",
    customer: "queued",
    suppliers: initialSuppliers,
    event: "Customer chat is ready",
    duration: 1_500,
  },
  {
    phase: 0,
    activity: "Collecting the load specification",
    customer: "live",
    suppliers: initialSuppliers,
    event: "Customer joined via ElevenLabs chat",
    duration: 2_200,
  },
  {
    phase: 0,
    activity: "Customer confirmed the job",
    customer: "live",
    suppliers: initialSuppliers,
    event: "Load specification confirmed",
    duration: 1_700,
  },
  {
    phase: 1,
    activity: "Calling three carriers in parallel",
    customer: "live",
    suppliers: supplierNames.map(() => ({ state: "ringing" })),
    event: "Three supplier calls started",
    duration: 1_800,
  },
  {
    phase: 1,
    activity: "Qualifying coverage and terms",
    customer: "live",
    suppliers: supplierNames.map(() => ({ state: "live" })),
    event: "All supplier lines connected",
    duration: 2_100,
  },
  {
    phase: 1,
    activity: "Normalizing live quotes",
    customer: "live",
    suppliers: [
      { state: "quoted", offer: "CHF 1,520", detail: "Coverage confirmed" },
      { state: "live" },
      { state: "live" },
    ],
    event: "Comparable offer · CHF 1,520",
    duration: 2_000,
  },
  {
    phase: 1,
    activity: "Using the verified offer as leverage",
    customer: "live",
    suppliers: [
      { state: "quoted", offer: "CHF 1,520", detail: "Firm" },
      { state: "quoted", offer: "CHF 1,460", detail: "Improved after counter" },
      { state: "quoted", offer: "CHF 1,490", detail: "Tolls included" },
    ],
    event: "Best verified offer improved to CHF 1,460",
    duration: 2_500,
  },
  {
    phase: 2,
    activity: "Recommending the best eligible offer",
    customer: "live",
    suppliers: [
      { state: "quoted", offer: "CHF 1,520" },
      { state: "selected", offer: "CHF 1,460", detail: "Recommended" },
      { state: "quoted", offer: "CHF 1,490" },
    ],
    event: "Three eligible offers presented",
    duration: 2_500,
  },
  {
    phase: 2,
    activity: "Customer selected Rhine Cargo",
    customer: "live",
    suppliers: [
      { state: "quoted", offer: "CHF 1,520" },
      { state: "selected", offer: "CHF 1,460", detail: "Customer selected" },
      { state: "quoted", offer: "CHF 1,490" },
    ],
    event: "Explicit customer selection received",
    duration: 2_100,
  },
  {
    phase: 3,
    activity: "Confirming exact terms and closing calls",
    customer: "live",
    suppliers: [
      { state: "closed", offer: "CHF 1,520" },
      { state: "selected", offer: "CHF 1,460", detail: "Terms confirmed" },
      { state: "closed", offer: "CHF 1,490" },
    ],
    event: "Winner committed · other carriers notified",
    duration: 3_500,
  },
];

function statusLabel(state: PartyState) {
  return {
    queued: "Queued",
    ringing: "Ringing",
    live: "Live",
    quoted: "Offer ready",
    selected: "Selected",
    closed: "Closed",
  }[state];
}

function Participant({
  name,
  role,
  state,
  offer,
  detail,
  side,
}: {
  name: string;
  role: string;
  state: PartyState;
  offer?: string;
  detail?: string;
  side: "left" | "right";
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      layout
      className={`participant participant-${side} state-${state}`}
      initial={{ opacity: 0, x: reduceMotion ? 0 : side === "left" ? -14 : 14 }}
      animate={{ opacity: state === "queued" ? 0.42 : 1, x: 0 }}
      transition={{
        duration: reduceMotion ? 0 : 0.35,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      {side === "left" && (
        <div className="participant-copy">
          <strong>{name}</strong>
          <span>{role}</span>
          <small>
            <i />
            {statusLabel(state)}
          </small>
        </div>
      )}
      <div className="participant-orb">
        <UserRound size={19} strokeWidth={1.7} />
      </div>
      {side === "right" && (
        <div className="participant-copy">
          <strong>{name}</strong>
          <span>{role}</span>
          <small>
            <i />
            {statusLabel(state)}
          </small>
        </div>
      )}
      {side === "right" && offer && (
        <motion.div
          className="offer-chip"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <span>{detail ?? "All-in offer"}</span>
          <strong>{offer}</strong>
        </motion.div>
      )}
    </motion.div>
  );
}

export function SessionConsole({
  sessionId,
}: {
  sessionId: string | undefined;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const live = useSessionEvents(sessionId);
  const demoFrame = frames[index]!;
  const frame = useMemo(() => {
    if (sessionId) {
      if (live.view)
        return projectSessionView(live.view, live.events.at(-1)?.eventType);
      return {
        phase: 0,
        activity:
          live.status === "error"
            ? "Unable to load this session"
            : "Connecting to the durable event stream",
        customer: "queued" as PartyState,
        customerName: "Customer",
        customerRole: "customer",
        suppliers: [],
      };
    }
    return {
      phase: demoFrame.phase,
      activity: demoFrame.activity,
      customer: demoFrame.customer,
      customerName: "Acme Manufacturing",
      customerRole: "Shipper",
      suppliers: demoFrame.suppliers.map((supplier, supplierIndex) => ({
        id: `demo-supplier-${supplierIndex}`,
        name: supplierNames[supplierIndex]!,
        role: "Carrier",
        ...supplier,
      })),
    };
  }, [demoFrame, live.events, live.status, live.view, sessionId]);
  const visibleEvents = useMemo(
    () =>
      sessionId
        ? live.events.length
          ? live.events.slice(-4).map((event) => ({
              id: event.id,
              label: event.eventType.replaceAll(".", " · "),
              sequence: event.eventSeq,
            }))
          : [
              {
                id: "waiting",
                label: "Waiting for the first durable event",
                sequence: 0,
              },
            ]
        : frames
            .slice(Math.max(0, index - 3), index + 1)
            .map((item, offset) => ({
              id: `demo-${Math.max(0, index - 3) + offset}`,
              label: item.event,
              sequence: Math.max(0, index - 3) + offset + 1,
            })),
    [index, live.events, sessionId],
  );
  const supplierRouteY = frame.suppliers.map(
    (_, supplierIndex) =>
      (740 * (supplierIndex + 1)) / (frame.suppliers.length + 1),
  );

  useEffect(() => {
    if (sessionId || paused || index === frames.length - 1) return;
    const timer = window.setTimeout(
      () => setIndex((current) => current + 1),
      demoFrame.duration,
    );
    return () => window.clearTimeout(timer);
  }, [demoFrame.duration, index, paused, sessionId]);

  const toggle = () => {
    if (index === frames.length - 1) {
      setIndex(0);
      setPaused(false);
    } else setPaused((value) => !value);
  };

  return (
    <main className="console-shell">
      <header className="console-header">
        <div className="brand">
          <span className="brand-mark">
            <Sparkles size={15} />
          </span>
          <strong>Pacta</strong>
          <small>Live negotiation room</small>
        </div>
        <nav className="phase-tracker" aria-label="Session phases">
          {phases.map((phase, phaseIndex) => (
            <div
              className={`phase ${phaseIndex < frame.phase ? "complete" : ""} ${phaseIndex === frame.phase ? "active" : ""}`}
              key={phase}
            >
              <span>
                {phaseIndex < frame.phase ? (
                  <Check size={10} />
                ) : (
                  phaseIndex + 1
                )}
              </span>
              <small>{phase}</small>
              {phaseIndex < phases.length - 1 && <i />}
            </div>
          ))}
        </nav>
        <div className="system-state">
          <span>
            <i className={live.status === "error" ? "is-error" : ""} />
            {sessionId ? `Realtime ${live.status}` : "Demo live"}
          </span>
          {sessionId && (
            <Link className="intake-link" href={`/intake/${sessionId}`}>
              <MessageCircle size={13} />
              Customer chat
            </Link>
          )}
          {!sessionId && (
            <button
              onClick={toggle}
              aria-label={paused ? "Resume demo" : "Pause demo"}
            >
              {index === frames.length - 1 ? (
                <RotateCcw size={14} />
              ) : paused ? (
                <Play size={14} fill="currentColor" />
              ) : (
                <Pause size={14} fill="currentColor" />
              )}
            </button>
          )}
        </div>
      </header>

      <section className="negotiation-room">
        <svg
          className="connection-map"
          viewBox="0 0 1440 740"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className={`connection customer-connection state-${frame.customer}`}
            d="M 265 370 C 445 370, 505 370, 630 370"
          />
          {supplierRouteY.map((y, supplierIndex) => (
            <path
              key={y}
              className={`connection supplier-connection state-${frame.suppliers[supplierIndex]!.state}`}
              d={`M 810 370 C 930 370, 920 ${y}, 1080 ${y}`}
            />
          ))}
        </svg>

        <div className="customer-column">
          <p className="column-label">Customer</p>
          <Participant
            name={frame.customerName}
            role={frame.customerRole}
            state={frame.customer}
            side="left"
          />
        </div>

        <div className="pacta-center">
          <div className="mascot-aura">
            <MascotStage
              active={sessionId ? live.status === "live" : !paused}
            />
          </div>
          <div className="pacta-title">
            <strong>Pacta</strong>
            <span>Negotiation orchestrator</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              className="activity-pill"
              key={frame.activity}
              initial={{ opacity: 0, y: 5, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -3 }}
            >
              <Radio size={12} />
              <span>{frame.activity}</span>
            </motion.div>
          </AnimatePresence>
        </div>

        <div
          className={`supplier-column ${frame.suppliers.length > 5 ? "is-dense" : ""}`}
        >
          <p className="column-label">
            Suppliers ·{" "}
            {
              frame.suppliers.filter(
                (supplier) => !["queued", "closed"].includes(supplier.state),
              ).length
            }{" "}
            active
          </p>
          <div className="supplier-stack">
            {frame.suppliers.map(({ id, ...supplier }) => (
              <Participant key={id} side="right" {...supplier} />
            ))}
          </div>
        </div>
      </section>

      <section className="event-ledger">
        <div className="ledger-heading">
          <span>
            <ShieldCheck size={14} />
            Verified event stream
          </span>
          <small>Append-only · replayable</small>
        </div>
        <div className="ledger-events">
          <AnimatePresence initial={false} mode="popLayout">
            {visibleEvents.map((event) => (
              <motion.div
                key={event.id}
                className="ledger-event"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <i />
                <span>{event.label}</span>
                <time>{String(event.sequence).padStart(2, "0")}</time>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </section>
      <div className="progress-line">
        <span
          style={{
            transform: `scaleX(${sessionId ? frame.phase / (phases.length - 1) : index / (frames.length - 1)})`,
          }}
        />
      </div>
    </main>
  );
}
