"use client";

import {
  AnimatePresence,
  motion,
  useAnimationFrame,
  useReducedMotion,
} from "motion/react";
import { Bot, Check, LockKeyhole, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ProjectedSessionFrame } from "@/lib/session-view-projector";
import { projectSessionView } from "@/lib/session-view-projector";
import type { RealtimeSessionEvent } from "@/lib/supabase/event-buffer";
import { useSessionEvents } from "@/lib/supabase/use-session-events";

import { MascotStage } from "./mascot-stage";

const VIEWBOX = { width: 1_440, height: 720 };
const PACTA = { x: 720, y: 360 };
const CUSTOMER = { x: 215, y: 360 };
const phases = ["Intake", "Sourcing", "Selection", "Settlement"];

type Point = { x: number; y: number };
type Route = { start: Point; c1: Point; c2: Point; end: Point };
type VisualCallState =
  | "queued"
  | "calling"
  | "live"
  | "holding"
  | "confirming"
  | "confirmed"
  | "ended";

type SupplierVisual = ProjectedSessionFrame["suppliers"][number] & {
  x: number;
  y: number;
  conversationId: string;
  partyId: string;
  negotiationPhase: string;
  negotiationOutcome: string | null;
  visualState: VisualCallState;
};

type EventPresentation = {
  id: string;
  label: string;
  route: "customer" | "supplier" | null;
  direction: "in" | "out";
  supplierIndex: number | null;
  locked: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll(".", " · ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pointAt(route: Route, t: number) {
  const mt = 1 - t;
  return {
    x:
      mt ** 3 * route.start.x +
      3 * mt ** 2 * t * route.c1.x +
      3 * mt * t ** 2 * route.c2.x +
      t ** 3 * route.end.x,
    y:
      mt ** 3 * route.start.y +
      3 * mt ** 2 * t * route.c1.y +
      3 * mt * t ** 2 * route.c2.y +
      t ** 3 * route.end.y,
  };
}

function tangentAt(route: Route, t: number) {
  const mt = 1 - t;
  return {
    x:
      3 * mt ** 2 * (route.c1.x - route.start.x) +
      6 * mt * t * (route.c2.x - route.c1.x) +
      3 * t ** 2 * (route.end.x - route.c2.x),
    y:
      3 * mt ** 2 * (route.c1.y - route.start.y) +
      6 * mt * t * (route.c2.y - route.c1.y) +
      3 * t ** 2 * (route.end.y - route.c2.y),
  };
}

function routePath(route: Route) {
  return `M ${route.start.x} ${route.start.y} C ${route.c1.x} ${route.c1.y}, ${route.c2.x} ${route.c2.y}, ${route.end.x} ${route.end.y}`;
}

function gaussian(value: number, center: number, width: number) {
  const distance = (value - center) / width;
  return Math.exp(-distance * distance * 2.1);
}

function voicePath(
  route: Route,
  time: number,
  strand: number,
  intensity: number,
  direction: "in" | "out",
  seed: number,
) {
  const sampleCount = 64;
  const phaseDirection = direction === "in" ? -1 : 1;
  const phrase = 0.54 + 0.46 * ((Math.sin(time * 0.0021 + seed * 8) + 1) / 2);
  let path = "";
  let drawing = false;

  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const envelope = gaussian(t, 0.5, 0.08);
    if (envelope < 0.012) {
      drawing = false;
      continue;
    }
    const point = pointAt(route, t);
    const tangent = tangentAt(route, t);
    const length = Math.hypot(tangent.x, tangent.y) || 1;
    const normal = { x: -tangent.y / length, y: tangent.x / length };
    const carrier =
      Math.sin(
        t * 112 + phaseDirection * time * 0.0105 + seed * 11 + strand * 0.72,
      ) +
      Math.sin(t * 51 - phaseDirection * time * 0.007 + strand * 1.15) * 0.34;
    const strandBias = (strand - 2) * 0.68 * envelope * intensity;
    const amplitude = (9.4 - Math.abs(strand - 2) * 0.82) * intensity * phrase;
    const offset = carrier * amplitude * envelope + strandBias;
    const x = point.x + normal.x * offset;
    const y = point.y + normal.y * offset;
    path += `${drawing ? " L" : " M"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    drawing = true;
  }
  return path;
}

function makeCustomerRoute(): Route {
  return {
    start: { x: CUSTOMER.x + 35, y: CUSTOMER.y },
    c1: { x: 410, y: CUSTOMER.y },
    c2: { x: 575, y: PACTA.y },
    end: { x: PACTA.x - 45, y: PACTA.y },
  };
}

function makeSupplierRoute(supplier: Pick<SupplierVisual, "x" | "y">): Route {
  return {
    start: { x: PACTA.x + 45, y: PACTA.y },
    c1: { x: 845, y: PACTA.y },
    c2: { x: supplier.x - 170, y: supplier.y },
    end: { x: supplier.x - 35, y: supplier.y },
  };
}

function VoiceConnection({
  route,
  visible,
  state,
  focused,
  direction,
  seed,
}: {
  route: Route;
  visible: boolean;
  state: VisualCallState;
  focused: boolean;
  direction: "in" | "out";
  seed: number;
}) {
  const strandRefs = useRef<Array<SVGPathElement | null>>([]);
  const reduceMotion = useReducedMotion();
  const baseIntensity =
    state === "live"
      ? 0.76
      : state === "holding"
        ? 0.34
        : state === "confirming"
          ? 0.86
          : state === "confirmed"
            ? 0.42
            : 0;

  const draw = (time: number) => {
    const intensity = focused ? 1 : baseIntensity;
    strandRefs.current.forEach((path, strand) => {
      if (!path) return;
      path.setAttribute(
        "d",
        intensity > 0
          ? voicePath(
              route,
              reduceMotion ? seed * 8_000 : time,
              strand,
              intensity,
              direction,
              seed,
            )
          : "",
      );
    });
  };

  useEffect(() => draw(seed * 8_000));
  useAnimationFrame((time) => {
    if (!reduceMotion && visible && (focused || baseIntensity > 0)) draw(time);
  });

  return (
    <g
      className={`voice-connection state-${state} ${focused ? "is-focused" : ""}`}
    >
      <motion.path
        className="voice-base"
        d={routePath(route)}
        initial={{ pathLength: reduceMotion && visible ? 1 : 0, opacity: 0 }}
        animate={{ pathLength: visible ? 1 : 0, opacity: visible ? 1 : 0 }}
        transition={{
          duration: reduceMotion ? 0.16 : 0.5,
          ease: [0.23, 1, 0.32, 1],
        }}
      />
      {[0, 1, 2, 3, 4].map((strand) => (
        <path
          className="voice-strand"
          key={strand}
          ref={(node) => {
            strandRefs.current[strand] = node;
          }}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

function visualStatusLabel(state: VisualCallState) {
  if (state === "calling") return "Ringing";
  if (state === "holding") return "Holding";
  if (state === "confirming") return "Confirming";
  if (state === "confirmed") return "Confirmed";
  if (state === "ended") return "Ended";
  if (state === "queued") return "Queued";
  return "Live";
}

function SupplierInsight({ supplier }: { supplier: SupplierVisual }) {
  const reduceMotion = useReducedMotion();
  const hasOffer = Boolean(supplier.offer);
  const tone =
    supplier.visualState === "confirmed"
      ? "green"
      : supplier.visualState === "confirming"
        ? "blue"
        : supplier.visualState === "ended"
          ? "neutral"
          : hasOffer
            ? "amber"
            : "neutral";
  const offerDetail =
    supplier.visualState === "confirmed"
      ? "Offer confirmed"
      : supplier.visualState === "confirming"
        ? "Confirming"
        : supplier.visualState === "ended" && hasOffer
          ? supplier.negotiationOutcome === "selected_confirmed"
            ? "Offer confirmed"
            : "Not selected"
          : (supplier.detail ?? (hasOffer ? "Offer received" : null));

  if (supplier.visualState === "calling" || supplier.visualState === "queued")
    return null;

  return (
    <div className="supplier-insight-wrap">
      <span className="insight-link" aria-hidden="true" />
      <motion.div
        layout={reduceMotion ? false : "size"}
        className={`supplier-insight tone-${tone}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{
          opacity: {
            duration: reduceMotion ? 0.12 : 0.2,
            ease: [0.23, 1, 0.32, 1],
          },
          layout: reduceMotion
            ? { duration: 0 }
            : { type: "spring", duration: 0.28, bounce: 0.06 },
        }}
      >
        <div className="negotiator-pattern">
          <span className="pattern-glyph" aria-hidden="true" />
          <span className="pattern-copy">
            <small>Negotiation state</small>
            <strong>{humanize(supplier.negotiationPhase)}</strong>
          </span>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {hasOffer && offerDetail && (
            <motion.div
              className="insight-primary"
              key={`${offerDetail}-${supplier.offer}`}
              initial={{
                opacity: 0,
                transform: reduceMotion ? "none" : "translateY(3px)",
              }}
              animate={{ opacity: 1, transform: "translateY(0)" }}
              exit={{ opacity: 0 }}
              transition={{
                duration: reduceMotion ? 0.12 : 0.24,
                ease: [0.23, 1, 0.32, 1],
              }}
            >
              <i className="offer-dot" aria-hidden="true" />
              <span>{offerDetail}</span>
              <strong>{supplier.offer}</strong>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function CallNode({
  participant,
  state,
  focused,
  selected,
  visible,
  customer,
}: {
  participant:
    | (SupplierVisual & { role: string })
    | { name: string; role: string; x: number; y: number };
  state: VisualCallState;
  focused: boolean;
  selected?: boolean;
  visible: boolean;
  customer?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  if (!visible) return null;
  const status = visualStatusLabel(state);
  const live = !["queued", "calling", "ended"].includes(state);
  const supplier = customer ? null : (participant as SupplierVisual);

  return (
    <div
      className={`node-anchor ${customer ? "is-customer" : "is-supplier"}`}
      style={{
        left: `${(participant.x / VIEWBOX.width) * 100}%`,
        top: `${(participant.y / VIEWBOX.height) * 100}%`,
      }}
    >
      <motion.div
        className={`call-node status-${state} ${focused ? "is-focused" : ""} ${selected ? "is-selected" : ""}`}
        initial={{
          opacity: 0,
          transform: reduceMotion ? "scale(1)" : "scale(.95)",
        }}
        animate={{ opacity: 1, transform: "scale(1)" }}
        exit={{ opacity: 0, transform: "scale(.98)" }}
        transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
        aria-label={`${participant.name}, ${participant.role}, ${status}`}
      >
        {customer && (
          <div className="node-copy customer-copy">
            <strong>{participant.name}</strong>
            <span>{participant.role}</span>
            <small className={`node-status ${live ? "is-live" : ""}`}>
              <i />
              {status}
            </small>
          </div>
        )}
        <div className="agent-disc" aria-hidden="true">
          <Bot size={20} strokeWidth={1.7} />
        </div>
        {!customer && (
          <div className="node-copy">
            <strong>{participant.name}</strong>
            <span>{participant.role}</span>
            <div className="status-line">
              <small className={`node-status ${live ? "is-live" : ""}`}>
                <i />
                {status}
              </small>
              {state === "holding" && (
                <small className="holding-status">
                  <i /> Holding
                </small>
              )}
            </div>
          </div>
        )}
        {supplier && <SupplierInsight supplier={supplier} />}
      </motion.div>
    </div>
  );
}

function PactaCore({ event }: { event: EventPresentation }) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      className="pacta-anchor"
      style={{
        left: `${(PACTA.x / VIEWBOX.width) * 100}%`,
        top: `${(PACTA.y / VIEWBOX.height) * 100}%`,
      }}
    >
      <div className="pacta-core" aria-label="Pacta orchestrator">
        <span className="pacta-orbit orbit-one" />
        <span className="pacta-orbit orbit-two" />
        <span className="pacta-signal">
          <MascotStage className="pacta-3d-stage" eventId={event.id} />
        </span>
      </div>
      <div className="pacta-label">
        <strong>Pacta</strong>
        <span>Orchestrator</span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          className={`current-event ${event.locked ? "is-locked" : ""}`}
          key={`${event.id}-${event.label}`}
          initial={{
            opacity: 0,
            transform: reduceMotion ? "none" : "translateY(4px)",
            filter: "blur(2px)",
          }}
          animate={{
            opacity: 1,
            transform: "translateY(0)",
            filter: "blur(0px)",
          }}
          exit={{
            opacity: 0,
            transform: reduceMotion ? "none" : "translateY(-2px)",
            filter: "blur(1px)",
          }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          aria-live="polite"
          data-testid="live-current-event"
        >
          {event.locked && <LockKeyhole size={12} />}
          <span>{event.label}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function supplierPosition(index: number, count: number) {
  const y = (VIEWBOX.height * (index + 1)) / (count + 1);
  const offsets = count === 3 ? [-18, 18, -10] : count === 2 ? [-8, 10] : [0];
  return { x: 1_015 + (offsets[index] ?? 0), y };
}

function supplierVisualState(
  state: ProjectedSessionFrame["suppliers"][number]["state"],
  sessionStatus: string,
  awardStatus: string | null,
): VisualCallState {
  if (sessionStatus === "completed") return "ended";
  if (state === "closed") return "ended";
  if (state === "ringing") return "calling";
  if (state === "selected")
    return awardStatus === "confirmed" ? "confirmed" : "confirming";
  if (
    state === "quoted" &&
    ["reviewing_offers", "committing", "closing"].includes(sessionStatus)
  )
    return "holding";
  if (state === "quoted" || state === "live") return "live";
  return "queued";
}

function customerVisualState(
  state: ProjectedSessionFrame["customer"],
  sessionStatus: string,
): VisualCallState {
  if (sessionStatus === "completed" || state === "closed") return "ended";
  if (state === "ringing") return "calling";
  if (state === "live" || state === "quoted" || state === "selected")
    return "live";
  return "queued";
}

function findSupplierIndex(
  event: RealtimeSessionEvent,
  suppliers: SupplierVisual[],
) {
  const payload = record(event.payload);
  const candidates = [
    payload.partyId,
    payload.negotiationId,
    payload.selectedNegotiationId,
    payload.supplierPartyId,
    event.aggregateId,
  ].filter((value): value is string => typeof value === "string");
  return suppliers.findIndex((supplier) =>
    candidates.some((candidate) =>
      [supplier.id, supplier.partyId, supplier.conversationId].includes(
        candidate,
      ),
    ),
  );
}

function eventPresentation(
  event: RealtimeSessionEvent | undefined,
  suppliers: SupplierVisual[],
  sessionStatus: string,
  awardStatus: string | null,
): EventPresentation {
  if (!event)
    return {
      id: "connecting",
      label: "Connecting to the live session",
      route: null,
      direction: "out",
      supplierIndex: null,
      locked: false,
    };
  const payload = record(event.payload);
  const supplierIndex = findSupplierIndex(event, suppliers);
  const supplier = suppliers[supplierIndex];
  const payloadLabel = typeof payload.label === "string" ? payload.label : null;
  const labels: Record<string, string> = {
    "session.started": "Pacta is ready",
    "job.revision_created": "Structuring the customer request",
    "job.confirmed": "Job confirmed",
    "customer.decision_recorded": supplier
      ? `Customer selected ${supplier.name}${supplier.offer ? ` · ${supplier.offer}` : ""}`
      : "Customer selected an offer",
    "award.confirmed": supplier
      ? `${supplier.name} accepted the job`
      : "Selected supplier accepted the job",
    "supplier.closeout_completed": "Closing an unselected supplier call",
    "session.completed": "All calls complete",
  };
  let label =
    payloadLabel ?? labels[event.eventType] ?? humanize(event.eventType);
  if (event.eventType === "conversation.initiated")
    label = supplier ? `Calling ${supplier.name}` : "Calling the customer";
  if (event.eventType === "conversation.connected")
    label = supplier ? `${supplier.name} connected` : "Customer connected";
  if (event.eventType === "conversation.initiation_failed")
    label = supplier ? `${supplier.name} call failed` : "Call failed";
  if (event.eventType === "conversation.ended")
    label = supplier ? `${supplier.name} call ended` : "Customer call ended";
  if (event.eventType === "offer.revision_created" && supplier)
    label = `Offer received · ${supplier.offer ?? supplier.name}`;

  const customerEvent =
    supplierIndex < 0 &&
    (event.eventType.startsWith("job.") ||
      event.eventType.startsWith("customer.") ||
      event.eventType === "session.completed" ||
      (event.eventType.startsWith("conversation.") &&
        payload.purpose === "customer_intake"));
  const supplierEvent = supplierIndex >= 0;
  const direction: "in" | "out" = [
    "offer.revision_created",
    "award.confirmed",
    "customer.decision_recorded",
    "conversation.connected",
  ].includes(event.eventType)
    ? "in"
    : "out";
  return {
    id: event.eventType,
    label,
    route: supplierEvent ? "supplier" : customerEvent ? "customer" : null,
    direction,
    supplierIndex: supplierEvent ? supplierIndex : null,
    locked: sessionStatus === "committing" && awardStatus !== "confirmed",
  };
}

function Clock() {
  const [parts, setParts] = useState({ time: "--:--", zone: "" });
  useEffect(() => {
    const update = () => {
      const formatter = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Europe/Zurich",
        timeZoneName: "short",
      });
      const formatted = formatter.formatToParts(new Date());
      setParts({
        time: `${formatted.find((part) => part.type === "hour")?.value ?? "--"}:${formatted.find((part) => part.type === "minute")?.value ?? "--"}`,
        zone:
          formatted.find((part) => part.type === "timeZoneName")?.value ?? "",
      });
    };
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <time>
      {parts.time} <em>{parts.zone}</em>
    </time>
  );
}

function Header({
  phase,
  complete,
  realtimeStatus,
}: {
  phase: number;
  complete: boolean;
  realtimeStatus: "connecting" | "live" | "error";
}) {
  const statusLabel =
    realtimeStatus === "live"
      ? "System live"
      : realtimeStatus === "error"
        ? "Realtime unavailable"
        : "Syncing";
  return (
    <header className="topbar">
      <div className="live-brand">
        <strong>Pacta</strong>
        <span>AI negotiation orchestrator</span>
      </div>
      <nav className="live-phase-tracker" aria-label="Call lifecycle">
        {phases.map((label, index) => {
          const isComplete = index < phase || complete;
          const active = index === phase && !complete;
          return (
            <div
              className={`live-phase ${isComplete ? "is-complete" : ""} ${active ? "is-active" : ""}`}
              key={label}
            >
              <span>
                {isComplete ? <Check size={11} strokeWidth={2.4} /> : <i />}
              </span>
              <small>{label}</small>
              {index < phases.length - 1 && <b />}
            </div>
          );
        })}
      </nav>
      <div className="system-meta">
        <span className={`system-live status-${realtimeStatus}`}>
          <i /> {statusLabel}
        </span>
        <Clock />
        <Link href="/negotiate" aria-label="Start a new negotiation">
          <RotateCcw size={14} />
        </Link>
      </div>
    </header>
  );
}

export function LiveSessionConsole({ sessionId }: { sessionId: string }) {
  const live = useSessionEvents(sessionId);
  const frame = useMemo<ProjectedSessionFrame>(() => {
    if (live.view) return projectSessionView(live.view);
    return {
      phase: 0,
      customer: "queued",
      customerName: "Customer call",
      customerRole: "Calling agent",
      suppliers: [],
    };
  }, [live.view]);
  const sessionStatus = live.view?.status ?? "customer_intake";
  const awardStatus = live.view?.awardStatus ?? null;
  const suppliers = useMemo<SupplierVisual[]>(
    () =>
      frame.suppliers.map((supplier, index) => {
        const source = live.view?.suppliers.find(
          (candidate) => candidate.negotiationId === supplier.id,
        );
        return {
          ...supplier,
          ...supplierPosition(index, frame.suppliers.length),
          conversationId: source?.conversationId ?? "",
          partyId: source?.partyId ?? "",
          negotiationPhase: source?.negotiationPhase ?? "queued",
          negotiationOutcome: source?.negotiationOutcome ?? null,
          visualState: supplierVisualState(
            supplier.state,
            sessionStatus,
            awardStatus,
          ),
        };
      }),
    [awardStatus, frame.suppliers, live.view?.suppliers, sessionStatus],
  );
  const currentEvent = useMemo(
    () =>
      eventPresentation(
        live.events.at(-1),
        suppliers,
        sessionStatus,
        awardStatus,
      ),
    [awardStatus, live.events, sessionStatus, suppliers],
  );
  const customerState = customerVisualState(frame.customer, sessionStatus);
  const customerVisible = Boolean(live.view) && customerState !== "queued";
  const customerRoute = useMemo(makeCustomerRoute, []);
  const supplierRoutes = useMemo(
    () => suppliers.map(makeSupplierRoute),
    [suppliers],
  );
  const complete = sessionStatus === "completed";

  return (
    <main
      className="live-console"
      data-realtime-status={live.status}
      data-session-status={sessionStatus}
    >
      <Header
        phase={frame.phase}
        complete={complete}
        realtimeStatus={live.status === "demo" ? "connecting" : live.status}
      />
      <section className="network-shell" aria-label="Live negotiation map">
        <div className="network-canvas">
          <svg
            className="network-lines"
            viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
            aria-hidden="true"
          >
            <VoiceConnection
              route={customerRoute}
              visible={customerVisible}
              state={customerState}
              focused={currentEvent.route === "customer"}
              direction={
                currentEvent.route === "customer"
                  ? currentEvent.direction
                  : "in"
              }
              seed={0.17}
            />
            {suppliers.map((supplier, index) => {
              const focused =
                currentEvent.route === "supplier" &&
                currentEvent.supplierIndex === index;
              return (
                <VoiceConnection
                  direction={focused ? currentEvent.direction : "in"}
                  focused={focused}
                  key={supplier.id}
                  route={supplierRoutes[index]!}
                  seed={0.28 + index * 0.137}
                  state={supplier.visualState}
                  visible={supplier.visualState !== "queued"}
                />
              );
            })}
          </svg>

          <PactaCore event={currentEvent} />

          <AnimatePresence>
            <CallNode
              customer
              focused={currentEvent.route === "customer"}
              key="customer"
              participant={{
                name: frame.customerName || "Customer call",
                role: frame.customerRole || "Calling agent",
                ...CUSTOMER,
              }}
              state={customerState}
              visible={customerVisible}
            />
            {suppliers.map((supplier, index) => (
              <CallNode
                focused={
                  currentEvent.route === "supplier" &&
                  currentEvent.supplierIndex === index
                }
                key={supplier.id}
                participant={supplier}
                selected={supplier.state === "selected"}
                state={supplier.visualState}
                visible={supplier.visualState !== "queued"}
              />
            ))}
          </AnimatePresence>
        </div>
      </section>
      <div className="live-progress" aria-hidden="true">
        <span
          style={{
            transform: `scaleX(${complete ? 1 : frame.phase / (phases.length - 1)})`,
          }}
        />
      </div>
    </main>
  );
}
