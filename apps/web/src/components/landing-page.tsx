"use client";

import {
  ArrowDown,
  ArrowRight,
  Check,
  FileText,
  LockKeyhole,
  MessageSquareText,
  PhoneCall,
  Route,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import Image from "next/image";
import Link from "next/link";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useRef,
  useState,
} from "react";

import { MascotStage } from "./mascot-stage";
import styles from "./landing-page.module.css";

const easeOut = [0.23, 1, 0.32, 1] as const;
const mascotPoster = "/mascot/blender-front.png";

const marketSteps = [
  {
    number: "01",
    title: "Confirm the request",
    detail: "One immutable brief becomes the shared contract.",
  },
  {
    number: "02",
    title: "Open independent lines",
    detail: "Supplier conversations progress in parallel.",
  },
  {
    number: "03",
    title: "Return comparable truth",
    detail: "Typed offers enter one authoritative state.",
  },
  {
    number: "04",
    title: "Keep the human gate",
    detail: "The customer chooses before the supplier commits.",
  },
];

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string | undefined;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      data-reveal="true"
      initial={{
        opacity: 0,
        transform: "translate3d(0, 22px, 0)",
      }}
      whileInView={{ opacity: 1, transform: "translate3d(0, 0, 0)" }}
      viewport={{ once: true, amount: 0.18 }}
      transition={{
        duration: reduceMotion ? 0.18 : 0.68,
        delay: reduceMotion ? 0 : delay,
        ease: easeOut,
      }}
    >
      {children}
    </motion.div>
  );
}

function MarketStory({
  scrollContainer,
}: {
  scrollContainer: RefObject<HTMLDivElement | null>;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeStep, setActiveStep] = useState(0);
  const { scrollYProgress } = useScroll({
    container: scrollContainer,
    target: sectionRef,
    offset: ["start start", "end end"],
  });
  const progress = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 30,
    mass: 0.28,
  });

  useMotionValueEvent(progress, "change", (value) => {
    const nextStep = value < 0.22 ? 0 : value < 0.48 ? 1 : value < 0.76 ? 2 : 3;
    setActiveStep((current) => (current === nextStep ? current : nextStep));
  });

  const requestTransform = useTransform(
    progress,
    [0, 0.16, 0.31, 0.48],
    [
      "translate3d(-190px, 86px, 0) scale(0.94)",
      "translate3d(-34px, 86px, 0) scale(1)",
      "translate3d(-34px, -112px, 0) scale(0.82)",
      "translate3d(-34px, -112px, 0) scale(0.82)",
    ],
  );
  const requestOpacity = useTransform(
    progress,
    [0, 0.08, 0.43, 0.54],
    [0, 1, 1, 0.34],
  );
  const firstSupplierTransform = useTransform(
    progress,
    [0.18, 0.37, 1],
    [
      "translate3d(-150px, 128px, 0) scale(0.92)",
      "translate3d(0, 0, 0) scale(1)",
      "translate3d(0, 0, 0) scale(1)",
    ],
  );
  const secondSupplierTransform = useTransform(
    progress,
    [0.22, 0.41, 1],
    [
      "translate3d(-166px, 0, 0) scale(0.92)",
      "translate3d(0, 0, 0) scale(1)",
      "translate3d(0, 0, 0) scale(1)",
    ],
  );
  const thirdSupplierTransform = useTransform(
    progress,
    [0.26, 0.45, 1],
    [
      "translate3d(-150px, -128px, 0) scale(0.92)",
      "translate3d(0, 0, 0) scale(1)",
      "translate3d(0, 0, 0) scale(1)",
    ],
  );
  const supplierOpacity = useTransform(progress, [0.16, 0.35], [0, 1]);
  const firstLineTransform = useTransform(
    progress,
    [0.23, 0.36],
    ["rotate(-20deg) scaleX(0)", "rotate(-20deg) scaleX(1)"],
  );
  const secondLineTransform = useTransform(
    progress,
    [0.27, 0.4],
    ["rotate(0deg) scaleX(0)", "rotate(0deg) scaleX(1)"],
  );
  const thirdLineTransform = useTransform(
    progress,
    [0.31, 0.44],
    ["rotate(20deg) scaleX(0)", "rotate(20deg) scaleX(1)"],
  );
  const firstOfferTransform = useTransform(
    progress,
    [0.46, 0.62, 0.82],
    [
      "translate3d(176px, -112px, 0) scale(0.92)",
      "translate3d(24px, -42px, 0) scale(1)",
      "translate3d(8px, -36px, 0) scale(0.96)",
    ],
  );
  const secondOfferTransform = useTransform(
    progress,
    [0.51, 0.68, 0.84],
    [
      "translate3d(178px, 0, 0) scale(0.92)",
      "translate3d(22px, 8px, 0) scale(1)",
      "translate3d(8px, 8px, 0) scale(0.96)",
    ],
  );
  const thirdOfferTransform = useTransform(
    progress,
    [0.56, 0.73, 0.86],
    [
      "translate3d(176px, 112px, 0) scale(0.92)",
      "translate3d(24px, 58px, 0) scale(1)",
      "translate3d(8px, 52px, 0) scale(0.96)",
    ],
  );
  const offersOpacity = useTransform(
    progress,
    [0.45, 0.57, 0.92],
    [0, 1, 0.24],
  );
  const decisionOpacity = useTransform(progress, [0.76, 0.9], [0, 1]);
  const decisionTransform = useTransform(
    progress,
    [0.76, 0.92],
    ["translate3d(0, 18px, 0) scale(0.96)", "translate3d(0, 0, 0) scale(1)"],
  );
  const haloTransform = useTransform(
    progress,
    [0, 0.5, 1],
    ["scale(0.82)", "scale(1)", "scale(1.15)"],
  );

  return (
    <section className={styles.marketStory} id="market" ref={sectionRef}>
      <div className={styles.marketSticky}>
        <div className={styles.marketCopy}>
          <p className={styles.sectionKicker}>
            One contract. Many conversations.
          </p>
          <h2>
            Pacta opens the market
            <br />
            <em>in parallel.</em>
          </h2>
          <div className={styles.marketStepList}>
            {marketSteps.map((step, index) => (
              <div
                className={`${styles.marketStep} ${
                  index === activeStep ? styles.marketStepActive : ""
                }`}
                key={step.number}
              >
                <span>{step.number}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className={styles.marketVisual}
          role="img"
          aria-label="A confirmed request branching through Pacta into three independent supplier conversations and returning as comparable offers"
        >
          <div className={styles.marketGrid} aria-hidden="true" />
          <motion.div
            className={styles.marketHalo}
            style={{ transform: haloTransform }}
          />

          <motion.div
            className={styles.requestPacket}
            data-testid="market-request"
            style={{ transform: requestTransform, opacity: requestOpacity }}
          >
            <span>Confirmed request</span>
            <strong>Basel → Lausanne</strong>
            <small>Pickup · 09:00</small>
            <i>
              <LockKeyhole size={11} /> Locked
            </i>
          </motion.div>

          <div className={styles.marketMascot}>
            <span className={styles.marketMascotLabel}>PACTA</span>
            <Image src={mascotPoster} alt="" fill sizes="280px" />
            <span className={styles.marketPulse} aria-hidden="true" />
          </div>

          <motion.span
            className={`${styles.marketLine} ${styles.marketLineOne}`}
            style={{ transform: firstLineTransform, opacity: supplierOpacity }}
          />
          <motion.span
            className={`${styles.marketLine} ${styles.marketLineTwo}`}
            style={{ transform: secondLineTransform, opacity: supplierOpacity }}
          />
          <motion.span
            className={`${styles.marketLine} ${styles.marketLineThree}`}
            style={{ transform: thirdLineTransform, opacity: supplierOpacity }}
          />

          <motion.div
            className={`${styles.supplierNode} ${styles.supplierNodeOne}`}
            style={{
              transform: firstSupplierTransform,
              opacity: supplierOpacity,
            }}
          >
            <span>Call 01</span>
            <strong>Independent line</strong>
            <i />
          </motion.div>
          <motion.div
            className={`${styles.supplierNode} ${styles.supplierNodeTwo}`}
            style={{
              transform: secondSupplierTransform,
              opacity: supplierOpacity,
            }}
          >
            <span>Call 02</span>
            <strong>Independent line</strong>
            <i />
          </motion.div>
          <motion.div
            className={`${styles.supplierNode} ${styles.supplierNodeThree}`}
            style={{
              transform: thirdSupplierTransform,
              opacity: supplierOpacity,
            }}
          >
            <span>Call 03</span>
            <strong>Independent line</strong>
            <i />
          </motion.div>

          <motion.div
            className={`${styles.offerChip} ${styles.offerChipOne}`}
            style={{ transform: firstOfferTransform, opacity: offersOpacity }}
          >
            <Check size={12} /> Comparable
          </motion.div>
          <motion.div
            className={`${styles.offerChip} ${styles.offerChipTwo}`}
            style={{ transform: secondOfferTransform, opacity: offersOpacity }}
          >
            <Check size={12} /> Evidence linked
          </motion.div>
          <motion.div
            className={`${styles.offerChip} ${styles.offerChipThree}`}
            style={{ transform: thirdOfferTransform, opacity: offersOpacity }}
          >
            <Check size={12} /> Scope matched
          </motion.div>

          <motion.div
            className={styles.decisionCard}
            style={{ opacity: decisionOpacity, transform: decisionTransform }}
          >
            <span>Ready for your decision</span>
            <strong>3 verified offers</strong>
            <small>Selection is not commitment.</small>
          </motion.div>
        </div>

        <div className={styles.marketCounter} aria-hidden="true">
          <span>0{activeStep + 1}</span>
          <i />
          <small>04</small>
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const pointerX = useMotionValue(-120);
  const pointerY = useMotionValue(-120);
  const cursorX = useSpring(pointerX, {
    stiffness: 620,
    damping: 42,
    mass: 0.36,
  });
  const cursorY = useSpring(pointerY, {
    stiffness: 620,
    damping: 42,
    mass: 0.36,
  });
  const cursorTransform = useMotionTemplate`translate3d(${cursorX}px, ${cursorY}px, 0)`;
  const [cursorVisible, setCursorVisible] = useState(false);
  const [cursorActive, setCursorActive] = useState(false);
  const { scrollYProgress } = useScroll({ container: pageRef });
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 190,
    damping: 32,
    mass: 0.25,
  });
  const progressTransform = useTransform(
    smoothProgress,
    (value) => `scaleX(${value})`,
  );

  const trackPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || reduceMotion) return;
    pointerX.set(event.clientX - 18);
    pointerY.set(event.clientY - 18);
  };

  const activateCursor = () => setCursorActive(true);
  const releaseCursor = () => setCursorActive(false);

  return (
    <div
      className={styles.page}
      data-testid="landing-page"
      ref={pageRef}
      onPointerMove={trackPointer}
      onPointerEnter={() => setCursorVisible(true)}
      onPointerLeave={() => setCursorVisible(false)}
    >
      <motion.div
        className={`${styles.cursorSignal} ${cursorActive ? styles.cursorSignalActive : ""}`}
        data-testid="cursor-signal"
        style={{
          transform: cursorTransform,
          opacity: cursorVisible && !reduceMotion ? 1 : 0,
        }}
        aria-hidden="true"
      >
        <span />
      </motion.div>

      <nav className={styles.nav} aria-label="Primary navigation">
        <Link className={styles.wordmark} href="#top" aria-label="Pacta home">
          <span className={styles.wordmarkGlyph} aria-hidden="true">
            <i />
            <i />
          </span>
          <strong>PACTA</strong>
        </Link>
        <div className={styles.navLinks}>
          <Link href="#market">How it works</Link>
          <Link href="#trust">Trust model</Link>
          <Link href="#markets">Markets</Link>
        </div>
        <Link
          className={styles.navCta}
          href="/negotiate"
          onPointerEnter={activateCursor}
          onPointerLeave={releaseCursor}
        >
          Start a negotiation
          <ArrowRight size={14} />
        </Link>
        <motion.span
          className={styles.navProgress}
          style={{ transform: progressTransform }}
        />
      </nav>

      <main>
        <section className={styles.hero} id="top">
          <div className={styles.heroNoise} aria-hidden="true" />
          <motion.div
            className={styles.heroGlow}
            style={{ transform: cursorTransform }}
            aria-hidden="true"
          />

          <div className={styles.heroCopy}>
            <motion.p
              className={styles.heroKicker}
              initial={{ opacity: 0, transform: "translate3d(0, 12px, 0)" }}
              animate={{ opacity: 1, transform: "translate3d(0, 0, 0)" }}
              transition={{
                duration: reduceMotion ? 0.18 : 0.62,
                ease: easeOut,
              }}
            >
              <span /> AI-native negotiation infrastructure
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, transform: "translate3d(0, 34px, 0)" }}
              animate={{ opacity: 1, transform: "translate3d(0, 0, 0)" }}
              transition={{
                duration: reduceMotion ? 0.18 : 0.88,
                delay: reduceMotion ? 0 : 0.08,
                ease: easeOut,
              }}
            >
              One request in.
              <br />A <em>live market</em> out.
            </motion.h1>
            <motion.p
              className={styles.heroLede}
              initial={{ opacity: 0, transform: "translate3d(0, 18px, 0)" }}
              animate={{ opacity: 1, transform: "translate3d(0, 0, 0)" }}
              transition={{
                duration: reduceMotion ? 0.18 : 0.72,
                delay: reduceMotion ? 0 : 0.2,
                ease: easeOut,
              }}
            >
              Confirm the brief once. Run supplier conversations in parallel.
              Compare verified offers. Keep the final decision yours.
            </motion.p>
            <motion.div
              className={styles.heroActions}
              initial={{ opacity: 0, transform: "translate3d(0, 16px, 0)" }}
              animate={{ opacity: 1, transform: "translate3d(0, 0, 0)" }}
              transition={{
                duration: reduceMotion ? 0.18 : 0.68,
                delay: reduceMotion ? 0 : 0.3,
                ease: easeOut,
              }}
            >
              <Link
                className={styles.primaryCta}
                href="/negotiate"
                onPointerEnter={activateCursor}
                onPointerLeave={releaseCursor}
              >
                Start a negotiation
                <ArrowRight size={16} />
              </Link>
              <Link className={styles.textCta} href="#market">
                Watch the market open <ArrowDown size={15} />
              </Link>
            </motion.div>
          </div>

          <motion.div
            className={styles.heroMascotShell}
            initial={{
              opacity: 0,
              transform: "translate3d(0, 30px, 0) scale(0.96)",
            }}
            animate={{ opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" }}
            transition={{
              duration: reduceMotion ? 0.18 : 1,
              delay: reduceMotion ? 0 : 0.16,
              ease: easeOut,
            }}
            onPointerEnter={activateCursor}
            onPointerLeave={releaseCursor}
          >
            <span className={styles.heroOrbit} aria-hidden="true" />
            <span className={styles.heroOrbitInner} aria-hidden="true" />
            <span className={styles.heroStatus}>Ready</span>
            <MascotStage className={styles.heroMascotStage} />
            <div className={styles.heroMascotHint}>
              <Sparkles size={12} /> I follow your lead. Try me.
            </div>
          </motion.div>

          <div className={styles.heroProof}>
            <span>Human-gated</span>
            <span>Evidence-backed</span>
            <span>Use-case configurable</span>
          </div>

          <div className={styles.scrollCue} aria-hidden="true">
            <span>Scroll to open the market</span>
            <i />
          </div>
        </section>

        <section className={styles.serialSection}>
          <Reveal className={styles.serialHeading}>
            <p className={styles.sectionKicker}>The old shape</p>
            <h2>
              One job becomes the same phone call,
              <br />
              <em>repeated.</em>
            </h2>
          </Reveal>
          <div className={styles.serialRail}>
            <Reveal className={styles.serialBrief} delay={0.04}>
              <FileText size={18} />
              <span>One customer brief</span>
              <strong>Basel → Lausanne</strong>
            </Reveal>
            <div className={styles.serialLine} aria-hidden="true">
              <i />
            </div>
            {["Explain", "Wait", "Write it down"].map((label, index) => (
              <Reveal
                className={styles.serialCall}
                delay={0.1 + index * 0.06}
                key={label}
              >
                <span>0{index + 1}</span>
                <PhoneCall size={17} />
                <strong>{label}</strong>
                <small>Then start again</small>
              </Reveal>
            ))}
          </div>
          <Reveal className={styles.serialThesis} delay={0.2}>
            <span>Serial repetition fragments the truth.</span>
            <strong>
              Pacta gives every conversation the same confirmed facts.
            </strong>
          </Reveal>
        </section>

        <MarketStory scrollContainer={pageRef} />

        <section className={styles.trustSection} id="trust">
          <div className={styles.trustIntro}>
            <Reveal>
              <p className={styles.sectionKicker}>Comparable truth</p>
              <h2>
                A quote becomes leverage
                <br />
                only after it <em>checks out.</em>
              </h2>
            </Reveal>
            <Reveal className={styles.trustLede} delay={0.08}>
              Pacta does not turn raw transcript fragments into facts. Typed
              offer data is validated, linked to evidence, and checked for a
              comparable scope first.
            </Reveal>
          </div>

          <div className={styles.truthMachine}>
            <Reveal className={styles.rawOffer} delay={0.04}>
              <span>Incoming quote</span>
              <strong>“About 490, plus extras.”</strong>
              <small>Unstructured · scope unclear</small>
            </Reveal>
            <Reveal className={styles.validationGate} delay={0.1}>
              <span className={styles.gateRing}>
                <ShieldCheck size={24} />
              </span>
              <strong>Evidence gate</strong>
              <div>
                <span>
                  <Check size={11} /> Typed amount
                </span>
                <span>
                  <Check size={11} /> Currency matched
                </span>
                <span>
                  <Check size={11} /> Scope comparable
                </span>
              </div>
            </Reveal>
            <Reveal className={styles.verifiedOffer} delay={0.16}>
              <span>
                <i /> Verified comparable offer
              </span>
              <strong>CHF 490 all-in</strong>
              <small>Anonymous leverage at the next turn</small>
            </Reveal>
          </div>

          <div className={styles.trustPrinciples}>
            <Reveal className={styles.principleCard} delay={0.02}>
              <MessageSquareText size={18} />
              <span>Independent conversations</span>
              <p>Supplier agents do not talk directly to one another.</p>
            </Reveal>
            <Reveal className={styles.principleCard} delay={0.08}>
              <LockKeyhole size={18} />
              <span>Authoritative shared state</span>
              <p>
                Committed events—not interface animation—are the source of
                truth.
              </p>
            </Reveal>
            <Reveal className={styles.principleCard} delay={0.14}>
              <ShieldCheck size={18} />
              <span>Evidence before leverage</span>
              <p>Only verified comparable facts can cross into another call.</p>
            </Reveal>
          </div>
        </section>

        <section className={styles.controlSection} id="control">
          <div className={styles.controlGlow} aria-hidden="true" />
          <Reveal className={styles.controlCopy}>
            <p className={styles.sectionKicker}>Consequential control</p>
            <h2>
              You choose.
              <br />
              The supplier <em>commits.</em>
            </h2>
            <p>
              Pacta coordinates the market, but it does not collapse two
              consequential decisions into one convenient status.
            </p>
          </Reveal>

          <div className={styles.commitmentFlow}>
            <Reveal className={styles.commitmentCard} delay={0.06}>
              <span>01 · Human gate</span>
              <strong>Customer selected</strong>
              <small>Preferred offer recorded</small>
              <i>
                <Check size={13} /> Choice captured
              </i>
            </Reveal>
            <div className={styles.commitmentArrow} aria-hidden="true">
              <ArrowRight size={21} />
              <span>Exact terms sent</span>
            </div>
            <Reveal
              className={`${styles.commitmentCard} ${styles.commitmentCardFinal}`}
              delay={0.14}
            >
              <span>02 · Supplier gate</span>
              <strong>Terms accepted</strong>
              <small>Operational commitment confirmed</small>
              <i>
                <LockKeyhole size={13} /> Commitment locked
              </i>
            </Reveal>
          </div>

          <div className={styles.controlMascot} aria-hidden="true">
            <span />
            <Image src={mascotPoster} alt="" fill sizes="340px" />
          </div>
        </section>

        <section className={styles.marketsSection} id="markets">
          <Reveal className={styles.marketsHeading}>
            <p className={styles.sectionKicker}>Configuration-native</p>
            <h2>
              The market changes.
              <br />
              <em>Pacta stays.</em>
            </h2>
            <p>
              Terminology, request fields, offer schemas, negotiation policy,
              and recommendation rules live in versioned configurations—not in a
              one-off workflow.
            </p>
          </Reveal>

          <div className={styles.marketCards}>
            <Reveal
              className={`${styles.marketCard} ${styles.freightCard}`}
              delay={0.04}
            >
              <div className={styles.marketCardTopline}>
                <span>Implemented configuration</span>
                <small>freight_brokerage@0.2.0</small>
              </div>
              <Route size={30} />
              <h3>Freight brokerage</h3>
              <p>Route, pickup time, and one all-in CHF quote.</p>
              <div className={styles.freightRoute} aria-hidden="true">
                <span>Basel</span>
                <i />
                <span>Lausanne</span>
              </div>
            </Reveal>
            <Reveal
              className={`${styles.marketCard} ${styles.contractorCard}`}
              delay={0.1}
            >
              <div className={styles.marketCardTopline}>
                <span>Implemented configuration</span>
                <small>contractor_bids@0.1.0</small>
              </div>
              <FileText size={30} />
              <h3>Contractor bids</h3>
              <p>Scope, schedule, terms, line items, and exclusions.</p>
              <div className={styles.contractorFields} aria-hidden="true">
                <span>Scope</span>
                <span>Timeline</span>
                <span>Terms</span>
              </div>
            </Reveal>
          </div>
        </section>

        <section className={styles.finalSection} id="close">
          <div className={styles.finalRings} aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <Reveal className={styles.finalMascot}>
            <Image src={mascotPoster} alt="Pacta mascot" fill sizes="460px" />
          </Reveal>
          <Reveal className={styles.finalCopy} delay={0.06}>
            <p className={styles.sectionKicker}>Pacta</p>
            <h2>
              The market still speaks by phone.
              <br />
              <em>Now software can negotiate back.</em>
            </h2>
            <p>One confirmed request. Parallel conversations. Your decision.</p>
            <Link
              className={styles.finalCta}
              href="/negotiate"
              onPointerEnter={activateCursor}
              onPointerLeave={releaseCursor}
            >
              Open a negotiation room
              <ArrowRight size={17} />
            </Link>
          </Reveal>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.wordmark}>
          <span className={styles.wordmarkGlyph} aria-hidden="true">
            <i />
            <i />
          </span>
          <strong>PACTA</strong>
        </div>
        <p>Human-gated negotiation infrastructure.</p>
        <Link href="#top">Back to top ↑</Link>
      </footer>
    </div>
  );
}
