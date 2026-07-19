import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useAnimationFrame,
  useReducedMotion,
} from "motion/react";
import {
  Bot,
  Check,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { PactaMascot3D } from "./PactaMascot3D";

const VIEWBOX = { width: 1440, height: 720 };
const PACTA = { x: 720, y: 360 };
const CUSTOMER = { x: 215, y: 360 };
const SELECTED_SUPPLIER = 1;

const suppliers = [
  { name: "Lumen Electrical", x: 995, y: 82, spawnAt: 6, connectedAt: 9 },
  { name: "Volt & Co.", x: 1030, y: 222, spawnAt: 5, connectedAt: 7 },
  { name: "Kreis 6 Elektro", x: 1000, y: 360, spawnAt: 8, connectedAt: 11 },
  { name: "Brightline", x: 1030, y: 510, spawnAt: 10, connectedAt: 13 },
  { name: "Nord Electric", x: 980, y: 646, spawnAt: 12, connectedAt: 14 },
];

const flow = [
  { id: "ready", phase: 0, label: "Pacta is ready", duration: 1700 },
  { id: "customer-agent", phase: 0, label: "Spawning customer agent", duration: 1700 },
  { id: "customer-ringing", phase: 0, label: "Calling the customer", duration: 1800 },
  { id: "customer-connected", phase: 0, label: "Customer connected", duration: 2200 },
  {
    id: "job-confirmed",
    phase: 0,
    label: "Job confirmed",
    capsule: "Job confirmed",
    route: "customer",
    direction: "in",
    tone: "blue",
    duration: 2400,
  },
  { id: "spawn-volt", phase: 1, label: "Spawning Volt agent", target: 1, duration: 900 },
  { id: "spawn-lumen", phase: 1, label: "Spawning Lumen agent", target: 0, duration: 850 },
  { id: "connect-volt", phase: 1, label: "Volt call connected", target: 1, duration: 1100 },
  { id: "spawn-kreis", phase: 1, label: "Spawning Kreis 6 agent", target: 2, duration: 850 },
  { id: "connect-lumen", phase: 1, label: "Lumen call connected", target: 0, duration: 1050 },
  { id: "spawn-brightline", phase: 1, label: "Spawning Brightline agent", target: 3, duration: 850 },
  { id: "connect-kreis", phase: 1, label: "Kreis 6 call connected", target: 2, duration: 1050 },
  { id: "spawn-nord", phase: 1, label: "Spawning Nord agent", target: 4, duration: 850 },
  { id: "connect-brightline", phase: 1, label: "Brightline call connected", target: 3, duration: 1050 },
  { id: "connect-nord", phase: 1, label: "Five supplier calls live", target: 4, duration: 2200 },
  {
    id: "offer-volt",
    phase: 1,
    label: "Offer received · CHF 420",
    capsule: "Offer received · CHF 420",
    target: 1,
    route: "supplier",
    direction: "in",
    tone: "amber",
    duration: 2300,
  },
  {
    id: "offer-lumen",
    phase: 1,
    label: "Offer received · CHF 395",
    capsule: "Offer received · CHF 395",
    target: 0,
    route: "supplier",
    direction: "in",
    tone: "amber",
    duration: 2200,
  },
  {
    id: "offer-kreis",
    phase: 1,
    label: "Offer received · CHF 410",
    capsule: "Offer received · CHF 410",
    target: 2,
    route: "supplier",
    direction: "in",
    tone: "amber",
    duration: 2200,
  },
  {
    id: "offer-brightline",
    phase: 1,
    label: "Offer received · CHF 465",
    capsule: "Offer received · CHF 465",
    target: 3,
    route: "supplier",
    direction: "in",
    tone: "amber",
    duration: 2200,
  },
  {
    id: "offer-nord",
    phase: 1,
    label: "Offer received · CHF 405",
    capsule: "Offer received · CHF 405",
    target: 4,
    route: "supplier",
    direction: "in",
    tone: "amber",
    duration: 2400,
  },
  {
    id: "counter-lumen",
    phase: 1,
    label: "Counteroffer delivered · CHF 405",
    capsule: "Counteroffer · CHF 405",
    target: 0,
    route: "supplier",
    direction: "out",
    tone: "blue",
    duration: 2300,
  },
  {
    id: "lumen-holds",
    phase: 1,
    label: "Lumen holds · CHF 395",
    capsule: "Offer held · CHF 395",
    target: 0,
    route: "supplier",
    direction: "in",
    tone: "amber",
    duration: 2200,
  },
  {
    id: "counter-volt",
    phase: 1,
    label: "Counteroffer delivered · CHF 395",
    capsule: "Counteroffer · CHF 395",
    target: 1,
    route: "supplier",
    direction: "out",
    tone: "blue",
    duration: 2300,
  },
  {
    id: "volt-improves",
    phase: 1,
    label: "Best offer · CHF 380",
    capsule: "Best offer · CHF 380",
    target: 1,
    route: "supplier",
    direction: "in",
    tone: "green",
    duration: 2500,
  },
  {
    id: "counter-nord",
    phase: 1,
    label: "Counteroffer delivered · CHF 380",
    capsule: "Counteroffer · CHF 380",
    target: 4,
    route: "supplier",
    direction: "out",
    tone: "blue",
    duration: 2300,
  },
  {
    id: "nord-improves",
    phase: 1,
    label: "Nord improves · CHF 385",
    capsule: "Revised offer · CHF 385",
    target: 4,
    route: "supplier",
    direction: "in",
    tone: "green",
    duration: 2500,
  },
  {
    id: "offers-ready",
    phase: 2,
    label: "Presenting five verified offers",
    capsule: "5 verified offers",
    route: "customer",
    direction: "out",
    tone: "blue",
    duration: 3000,
  },
  {
    id: "customer-selects",
    phase: 2,
    label: "Customer selected Volt · CHF 380",
    capsule: "Volt · CHF 380 selected",
    route: "customer",
    direction: "in",
    tone: "green",
    duration: 2800,
  },
  {
    id: "confirm-offer",
    phase: 3,
    label: "Awaiting supplier acceptance",
    capsule: "Confirming offer · CHF 380",
    target: 1,
    route: "supplier",
    direction: "out",
    tone: "blue",
    locked: true,
    duration: 3300,
  },
  {
    id: "supplier-accepts",
    phase: 3,
    label: "Volt accepted the job",
    capsule: "Supplier accepted",
    target: 1,
    route: "supplier",
    direction: "in",
    tone: "green",
    duration: 2800,
  },
  {
    id: "close-rejected",
    phase: 3,
    label: "Closing four unselected calls",
    targets: [0, 2, 3, 4],
    route: "supplier",
    direction: "out",
    tone: "neutral",
    duration: 2600,
  },
  {
    id: "booking-confirmed",
    phase: 3,
    label: "Booking confirmed with customer",
    capsule: "Booking confirmed",
    route: "customer",
    direction: "out",
    tone: "green",
    duration: 2800,
  },
  { id: "complete", phase: 3, label: "All calls complete", complete: true, duration: 5000 },
];

const phases = ["Intake", "Sourcing", "Selection", "Settlement"];

function cubicPoint(route, t) {
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

function cubicTangent(route, t) {
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

function routePath(route) {
  return `M ${route.start.x} ${route.start.y} C ${route.c1.x} ${route.c1.y}, ${route.c2.x} ${route.c2.y}, ${route.end.x} ${route.end.y}`;
}

function gaussian(value, center, width) {
  const distance = (value - center) / width;
  return Math.exp(-distance * distance * 2.1);
}

function voicePath(route, time, strand, intensity, direction, seed) {
  const sampleCount = 64;
  const center = 0.5;
  const phaseDirection = direction === "in" ? -1 : 1;
  const phrase = 0.54 + 0.46 * ((Math.sin(time * 0.0021 + seed * 8) + 1) / 2);
  let path = "";
  let drawing = false;

  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const envelope = gaussian(t, center, 0.08);

    if (envelope < 0.012) {
      drawing = false;
      continue;
    }

    const point = cubicPoint(route, t);
    const tangent = cubicTangent(route, t);
    const length = Math.hypot(tangent.x, tangent.y) || 1;
    const normal = { x: -tangent.y / length, y: tangent.x / length };
    const carrier =
      Math.sin(t * 112 + phaseDirection * time * 0.0105 + seed * 11 + strand * 0.72) +
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

function makeCustomerRoute() {
  return {
    start: { x: CUSTOMER.x + 35, y: CUSTOMER.y },
    c1: { x: 410, y: CUSTOMER.y },
    c2: { x: 575, y: PACTA.y },
    end: { x: PACTA.x - 45, y: PACTA.y },
  };
}

function makeSupplierRoute(supplier) {
  return {
    start: { x: PACTA.x + 45, y: PACTA.y },
    c1: { x: 845, y: PACTA.y },
    c2: { x: supplier.x - 170, y: supplier.y },
    end: { x: supplier.x - 35, y: supplier.y },
  };
}

function VoiceConnection({ route, visible, state, focused, direction = "out", seed }) {
  const strandRefs = useRef([]);
  const reduceMotion = useReducedMotion();
  const baseIntensity = state === "live"
    ? 0.76
    : state === "holding"
      ? 0.34
    : state === "selected"
      ? 0.58
      : state === "confirming"
        ? 0.86
        : state === "confirmed"
          ? 0.42
          : 0;

  const draw = (time) => {
    const intensity = focused ? 1 : baseIntensity;
    strandRefs.current.forEach((path, strand) => {
      if (!path) return;
      path.setAttribute(
        "d",
        intensity > 0
          ? voicePath(route, reduceMotion ? seed * 8000 : time, strand, intensity, direction, seed)
          : "",
      );
    });
  };

  useEffect(() => draw(seed * 8000), [baseIntensity, direction, focused, reduceMotion, seed]);
  useAnimationFrame((time) => {
    if (!reduceMotion && visible && (focused || baseIntensity > 0)) draw(time);
  });

  return (
    <g className={`voice-connection state-${state} ${visible ? "is-visible" : ""} ${focused ? "is-focused" : ""}`}>
      <motion.path
        className="voice-base"
        d={routePath(route)}
        initial={{ pathLength: reduceMotion && visible ? 1 : 0, opacity: 0 }}
        animate={{ pathLength: visible ? 1 : 0, opacity: visible ? 1 : 0 }}
        transition={{ duration: reduceMotion ? 0.16 : 0.5, ease: [0.23, 1, 0.32, 1] }}
      />
      {[0, 1, 2, 3, 4].map((strand) => (
        <path
          key={strand}
          ref={(node) => { strandRefs.current[strand] = node; }}
          className="voice-strand"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

function SupplierInsight({ insight }) {
  const reduceMotion = useReducedMotion();
  if (!insight) return null;

  return (
    <div className="supplier-insight-wrap">
      <span className="insight-link" aria-hidden="true" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key="supplier-insight"
          layout={reduceMotion ? false : "size"}
          className={`supplier-insight tone-${insight.tone || "neutral"} ${insight.persona ? "has-persona" : ""} ${insight.detail ? "has-offer" : "persona-only"}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            opacity: { duration: reduceMotion ? 0.12 : 0.2, ease: [0.23, 1, 0.32, 1] },
            layout: reduceMotion ? { duration: 0 } : { type: "spring", duration: 0.28, bounce: 0.06 },
          }}
        >
          <AnimatePresence initial={false}>
            {insight.persona && (
              <motion.div
                key={insight.persona}
                className="negotiator-pattern"
                initial={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(3px)" }}
                animate={{ opacity: 1, transform: "translateY(0)" }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: reduceMotion ? 0.12 : 0.24,
                  delay: reduceMotion ? 0 : 0.38,
                  ease: [0.23, 1, 0.32, 1],
                }}
              >
                <span className="pattern-glyph" aria-hidden="true" />
                <span className="pattern-copy">
                  <small>Negotiation pattern</small>
                  <strong>{insight.persona}</strong>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence mode="wait" initial={false}>
            {insight.detail && (
              <motion.div
                key={`${insight.value}-${insight.detail}`}
                className="insight-primary"
                initial={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(3px)" }}
                animate={{ opacity: 1, transform: "translateY(0)" }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0.12 : 0.24, ease: [0.23, 1, 0.32, 1] }}
              >
                <i className="offer-dot" aria-hidden="true" />
                <span>{insight.detail}</span>
                <strong>{insight.value}</strong>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function CallNode({ participant, status, focused, selected, insight, customer = false, visible }) {
  const reduceMotion = useReducedMotion();
  if (!visible) return null;
  const live = ["live", "holding", "selected", "confirming", "confirmed"].includes(status);
  const statusText = status === "calling"
    ? "Ringing"
    : status === "ended"
      ? "Ended"
      : status === "confirming"
        ? "Confirming"
        : status === "confirmed"
          ? "Confirmed"
          : "Live";

  return (
    <div
      className={`node-anchor ${customer ? "is-customer" : "is-supplier"}`}
      style={{ left: `${(participant.x / VIEWBOX.width) * 100}%`, top: `${(participant.y / VIEWBOX.height) * 100}%` }}
    >
      <motion.div
        className={`call-node status-${status} ${focused ? "is-focused" : ""} ${selected ? "is-selected" : ""}`}
        initial={{ opacity: 0, transform: reduceMotion ? "scale(1)" : "scale(.95)" }}
        animate={{ opacity: 1, transform: "scale(1)" }}
        exit={{ opacity: 0, transform: "scale(.98)" }}
        transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
      >
        {customer && (
          <div className="node-copy customer-copy">
            <strong>Customer call</strong>
            <span>Calling agent</span>
            <small className={`node-status ${live ? "is-live" : ""}`}><i />{statusText}</small>
          </div>
        )}
        <div className="agent-disc" aria-hidden="true"><Bot size={20} strokeWidth={1.7} /></div>
        {!customer && (
          <div className="node-copy">
            <strong>{participant.name}</strong>
            <span>Calling agent</span>
            <div className="status-line">
              <small className={`node-status ${live ? "is-live" : ""}`}><i />{statusText}</small>
              {status === "holding" && <small className="holding-status"><i />Holding</small>}
            </div>
          </div>
        )}
        {!customer && <SupplierInsight insight={insight} />}
      </motion.div>
    </div>
  );
}

function PactaCore({ event }) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      className="pacta-anchor"
      style={{ left: `${(PACTA.x / VIEWBOX.width) * 100}%`, top: `${(PACTA.y / VIEWBOX.height) * 100}%` }}
    >
      <div className="pacta-core" aria-label="Pacta orchestrator">
        <span className="pacta-orbit orbit-one" />
        <span className="pacta-orbit orbit-two" />
        <span className="pacta-signal">
          <PactaMascot3D eventId={event.id} />
        </span>
      </div>
      <div className="pacta-label"><strong>Pacta</strong><span>Orchestrator</span></div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={event.id}
          className={`current-event ${event.locked ? "is-locked" : ""}`}
          initial={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(4px)", filter: "blur(2px)" }}
          animate={{ opacity: 1, transform: "translateY(0)", filter: "blur(0px)" }}
          exit={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(-2px)", filter: "blur(1px)" }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        >
          {event.locked && <LockKeyhole size={12} />}
          <span>{event.label}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function supplierStatus(supplier, index, eventIndex) {
  if (eventIndex < supplier.connectedAt) return "calling";
  const confirmingAt = flow.findIndex(({ id }) => id === "confirm-offer");
  const confirmedAt = flow.findIndex(({ id }) => id === "supplier-accepts");
  const closeoutAt = flow.findIndex(({ id }) => id === "close-rejected");
  if (eventIndex >= flow.length - 1 || (index !== SELECTED_SUPPLIER && eventIndex > closeoutAt)) return "ended";
  if (index === SELECTED_SUPPLIER && eventIndex >= confirmedAt) return "confirmed";
  if (index === SELECTED_SUPPLIER && eventIndex >= confirmingAt) return "confirming";
  if (eventIndex >= confirmingAt && index !== SELECTED_SUPPLIER) return "holding";
  if (eventIndex >= confirmingAt && index === SELECTED_SUPPLIER) return "selected";
  return "live";
}

const insightUpdates = {
  "offer-volt": { target: 1, detail: "Offer received", value: "CHF 420", tone: "amber" },
  "offer-lumen": { target: 0, detail: "Offer received", value: "CHF 395", tone: "amber" },
  "offer-kreis": { target: 2, detail: "Offer received", value: "CHF 410", tone: "amber" },
  "offer-brightline": { target: 3, detail: "Offer received", value: "CHF 465", tone: "amber" },
  "offer-nord": { target: 4, detail: "Offer received", value: "CHF 405", tone: "amber" },
  "lumen-holds": { target: 0, detail: "Final offer", value: "CHF 395", tone: "amber" },
  "volt-improves": { target: 1, detail: "Revised offer", value: "CHF 380", tone: "green" },
  "nord-improves": { target: 4, detail: "Revised offer", value: "CHF 385", tone: "green" },
  "customer-selects": { target: 1, detail: "Customer selected", value: "CHF 380", tone: "blue" },
  "confirm-offer": { target: 1, detail: "Confirming", value: "CHF 380", tone: "blue" },
  "supplier-accepts": { target: 1, detail: "Offer confirmed", value: "CHF 380", tone: "green" },
};

const personaUpdates = {
  "connect-volt": { target: 1, persona: "Flexible dealmaker" },
  "connect-lumen": { target: 0, persona: "Tough negotiator" },
  "connect-kreis": { target: 2, persona: "Detail-driven verifier" },
  "connect-brightline": { target: 3, persona: "Hard-sell upseller" },
  "connect-nord": { target: 4, persona: "Lowballer with hidden fees" },
};

function supplierInsight(index, eventIndex) {
  let latest = null;
  let persona = null;
  for (let cursor = 0; cursor <= eventIndex; cursor += 1) {
    const update = insightUpdates[flow[cursor].id];
    if (update?.target === index) latest = update;
    const personaUpdate = personaUpdates[flow[cursor].id];
    if (personaUpdate?.target === index) persona = personaUpdate.persona;
  }
  const closeoutAt = flow.findIndex(({ id }) => id === "close-rejected");
  if (eventIndex >= closeoutAt && index !== SELECTED_SUPPLIER && latest) {
    latest = { ...latest, detail: "Not selected", tone: "neutral" };
  }
  return latest || persona ? { ...latest, persona } : null;
}

function NetworkScene({ eventIndex }) {
  const event = flow[eventIndex];
  const customerRoute = useMemo(() => makeCustomerRoute(), []);
  const supplierRoutes = useMemo(() => suppliers.map(makeSupplierRoute), []);
  const customerVisible = eventIndex >= 1;
  const customerStatus = eventIndex < 3 ? "calling" : eventIndex >= flow.length - 1 ? "ended" : "live";
  const supplierIsFocused = (index) => event.route === "supplier"
    && (event.target === index || event.targets?.includes(index));
  return (
    <main className="network-shell">
      <div className="network-canvas">
        <svg className="network-lines" viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} aria-hidden="true">
          <VoiceConnection
            route={customerRoute}
            visible={customerVisible}
            state={customerStatus === "live" ? "live" : customerStatus}
            focused={event.route === "customer"}
            direction={event.route === "customer" ? event.direction : "in"}
            seed={0.17}
          />
          {suppliers.map((supplier, index) => {
            const status = supplierStatus(supplier, index, eventIndex);
            return (
              <VoiceConnection
                key={supplier.name}
                route={supplierRoutes[index]}
                visible={eventIndex >= supplier.spawnAt}
                state={status}
                focused={supplierIsFocused(index)}
                direction={supplierIsFocused(index) ? event.direction : index % 2 ? "in" : "out"}
                seed={0.28 + index * 0.137}
              />
            );
          })}
        </svg>

        <PactaCore event={event} />

        <AnimatePresence>
          <CallNode
            key="customer"
            participant={CUSTOMER}
            status={customerStatus}
            focused={event.route === "customer"}
            customer
            visible={customerVisible}
          />
          {suppliers.map((supplier, index) => (
            <CallNode
              key={supplier.name}
              participant={supplier}
              status={supplierStatus(supplier, index, eventIndex)}
              focused={supplierIsFocused(index)}
              selected={index === SELECTED_SUPPLIER && eventIndex >= flow.findIndex(({ id }) => id === "confirm-offer")}
              insight={supplierInsight(index, eventIndex)}
              visible={eventIndex >= supplier.spawnAt}
            />
          ))}
        </AnimatePresence>
      </div>
    </main>
  );
}

function Header({ eventIndex, paused, onToggle }) {
  const event = flow[eventIndex];
  const isComplete = event.complete;

  return (
    <header className="topbar">
      <div className="brand"><strong>Pacta</strong><span>AI negotiation orchestrator</span></div>
      <nav className="phase-tracker" aria-label="Call lifecycle">
        {phases.map((phase, index) => {
          const complete = index < event.phase || isComplete;
          const active = index === event.phase && !isComplete;
          return (
            <div key={phase} className={`phase ${complete ? "is-complete" : ""} ${active ? "is-active" : ""}`}>
              <span>{complete ? <Check size={11} strokeWidth={2.4} /> : <i />}</span>
              <small>{phase}</small>
              {index < phases.length - 1 && <b />}
            </div>
          );
        })}
      </nav>
      <div className="system-meta">
        <span className="system-live"><i />System live</span>
        <time>09:42 <em>CET</em></time>
        <button type="button" onClick={onToggle} aria-label={paused ? "Play mock flow" : "Pause mock flow"}>
          {isComplete ? <RotateCcw size={15} /> : paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
        </button>
      </div>
    </header>
  );
}

export default function App() {
  const query = new URLSearchParams(window.location.search);
  const requestedEvent = Number(query.get("event"));
  const hasRequestedEvent = query.has("event") && Number.isInteger(requestedEvent);
  const initialEvent = hasRequestedEvent ? Math.min(Math.max(requestedEvent, 0), flow.length - 1) : 0;
  const [eventIndex, setEventIndex] = useState(initialEvent);
  const [paused, setPaused] = useState(hasRequestedEvent);

  useEffect(() => {
    if (paused || eventIndex >= flow.length - 1) return undefined;
    const timer = window.setTimeout(() => setEventIndex((current) => current + 1), flow[eventIndex].duration);
    return () => window.clearTimeout(timer);
  }, [eventIndex, paused]);

  const restart = () => {
    setEventIndex(0);
    setPaused(false);
  };

  const toggle = () => {
    if (eventIndex >= flow.length - 1) {
      restart();
      return;
    }
    setPaused((current) => !current);
  };

  return (
    <div className="app-shell">
      <Header eventIndex={eventIndex} paused={paused} onToggle={toggle} />
      <NetworkScene eventIndex={eventIndex} />
      <div className="mock-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${eventIndex / (flow.length - 1)})` }} />
      </div>
    </div>
  );
}
