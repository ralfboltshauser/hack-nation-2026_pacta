import { TextConversation } from "@elevenlabs/client";
import { createClient } from "@supabase/supabase-js";

type SessionView = {
  sessionId: string;
  status: string;
  job: { confirmed: boolean; missingRequiredPaths: string[] };
  customer: { conversationId: string; conversationStatus: string };
  suppliers: Array<{
    conversationId: string;
    displayName: string;
    offerRevisionId: string | null;
    offerStatus: string;
    selected: boolean;
    conversationStatus: string;
  }>;
  selectedOfferRevisionId: string | null;
  awardStatus: string | null;
};

type SignedTextSession = {
  signedUrl: string;
  customLlmExtraBody: Record<string, unknown>;
  dynamicVariables?: Record<string, string | number | boolean>;
};

type StartedSession = {
  sessionId: string;
  intakeUrl: string;
  supplierCount: number;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function baseUrl() {
  return (process.env.PACTA_BASE_URL ?? "https://pacta.openexp.dev").replace(
    /\/$/,
    "",
  );
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok)
    throw new Error(
      `${init.method ?? "GET"} ${url} failed (${response.status}): ${JSON.stringify(body)}`,
    );
  return body as T;
}

async function waitFor<T>(
  description: string,
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs = 90_000,
) {
  const deadline = Date.now() + timeoutMs;
  let latest = await read();
  while (!ready(latest)) {
    if (Date.now() >= deadline)
      throw new Error(
        `Timed out waiting for ${description}. Last state: ${JSON.stringify(latest)}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 750));
    latest = await read();
  }
  return latest;
}

class TextHarness {
  private readonly agentMessages: string[];
  private readonly roundTripMs: number[] = [];
  private disconnected = false;

  private constructor(
    private readonly conversation: TextConversation,
    private readonly label: string,
    agentMessages: string[],
  ) {
    this.agentMessages = agentMessages;
  }

  static async connect(input: {
    label: string;
    session: SignedTextSession;
    bind: (providerConversationId: string) => Promise<void>;
  }) {
    const agentMessages: string[] = [];
    let harness: TextHarness | undefined;
    let disconnectBeforeReady = false;
    const conversation = await TextConversation.startSession({
      signedUrl: input.session.signedUrl,
      connectionType: "websocket",
      textOnly: true,
      overrides: { conversation: { textOnly: true } },
      customLlmExtraBody: input.session.customLlmExtraBody,
      dynamicVariables: input.session.dynamicVariables,
      onMessage: ({ role, message }) => {
        if (role === "agent") agentMessages.push(message);
      },
      onDisconnect: () => {
        if (harness) harness.disconnected = true;
        else disconnectBeforeReady = true;
      },
      onError: (message) => {
        console.error(`[${input.label}] ElevenLabs error: ${message}`);
      },
    });
    harness = new TextHarness(conversation, input.label, agentMessages);
    harness.disconnected = disconnectBeforeReady;
    await input.bind(conversation.getId());
    await harness.waitForNextAgentMessage(0, 30_000).catch(() => null);
    return harness;
  }

  async send(message: string, timeoutMs = 60_000) {
    if (this.disconnected)
      throw new Error(`${this.label} disconnected before: ${message}`);
    const before = this.agentMessages.length;
    const startedAt = performance.now();
    this.conversation.sendUserMessage(message);
    const response = await this.waitForNextAgentMessage(before, timeoutMs);
    const elapsed = Math.round(performance.now() - startedAt);
    this.roundTripMs.push(elapsed);
    console.log(
      `[${this.label}] (${elapsed} ms) ${response ?? "conversation ended"}`,
    );
    return response;
  }

  timingSummary() {
    return { label: this.label, roundTripMs: this.roundTripMs };
  }

  async close() {
    if (this.disconnected) return;
    await this.conversation.endSession().catch(() => undefined);
    this.disconnected = true;
  }

  private async waitForNextAgentMessage(before: number, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (this.agentMessages.length <= before && !this.disconnected) {
      if (Date.now() >= deadline)
        throw new Error(`Timed out waiting for ${this.label}.`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.agentMessages[before] ?? null;
  }
}

const activeHarnesses: TextHarness[] = [];

const customerJob = `Origin city Zurich, origin country CH. Destination city Munich, destination country DE. Pickup window starts 2026-07-20T08:00:00+02:00 and ends 2026-07-20T10:00:00+02:00. Delivery window starts 2026-07-20T16:00:00+02:00 and ends 2026-07-20T18:00:00+02:00. Equipment is dry_van_53. Commodity is machine parts, weight is 10000 kg, and there are 10 handling units. Hazmat is false. Special services is an empty list. Risk criticality is standard and minimum coverage is 20000000 minor currency units. I explicitly confirm all of these exact job details.`;

const supplierQuotes = [
  { name: "Alpine Haulage", total: 152_000, linehaul: 142_000 },
  { name: "Rhine Cargo", total: 146_000, linehaul: 136_000 },
  { name: "Northstar Transit", total: 149_000, linehaul: 139_000 },
].map((quote) => ({
  ...quote,
  message: `This is my final firm quote. Pricing currency is CHF. Line items are linehaul ${quote.linehaul} minor units, flat basis, plus fuel 10000 minor units, flat basis. The all-in total is ${quote.total} minor units and normalized total is ${quote.total} minor units. Pickup commitment is 2026-07-20T08:00:00+02:00, delivery commitment is 2026-07-20T18:00:00+02:00, and equipment is dry_van_53. Quote type is firm, valid until 2026-07-19T20:00:00+02:00, payment terms are net 30, and tolls are included. Cargo coverage is confirmed with a limit of 25000000 minor units. Conditions, exclusions, and unknowns are all empty lists.`,
}));

async function main() {
  const origin = baseUrl();
  const demoKey = required("PACTA_DEMO_ACCESS_KEY");
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  const readiness = await jsonRequest<{
    ok: boolean;
    checks: { outboundCalls: string };
  }>(`${origin}/api/health/ready`, {});
  if (!readiness.ok || readiness.checks.outboundCalls !== "disarmed")
    throw new Error(
      `Refusing safe E2E because outbound calls are not explicitly disarmed: ${JSON.stringify(readiness)}`,
    );

  const started = await jsonRequest<StartedSession>(`${origin}/api/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pacta-demo-key": demoKey,
    },
    body: JSON.stringify({
      useCase: "freight_brokerage",
      customer: { displayName: "Safe E2E Customer" },
      suppliers: supplierQuotes.map((quote, index) => ({
        displayName: quote.name,
        phoneE164: `+1415555010${index}`,
      })),
    }),
  });
  if (started.supplierCount !== 3)
    throw new Error(`Expected three suppliers, got ${started.supplierCount}.`);
  console.log(
    `Created safe session ${started.sessionId}. No call API was invoked.`,
  );

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await supabase.auth.signInAnonymously();
  if (signedIn.error || !signedIn.data.session)
    throw signedIn.error ?? new Error("Anonymous sign-in returned no session.");
  const authHeaders = {
    authorization: `Bearer ${signedIn.data.session.access_token}`,
    "content-type": "application/json",
    "x-pacta-demo-key": demoKey,
  };
  await jsonRequest(`${origin}/api/sessions/${started.sessionId}/join`, {
    method: "POST",
    headers: authHeaders,
  });

  const readView = () =>
    jsonRequest<SessionView>(
      `${origin}/api/sessions/${started.sessionId}/view`,
      { headers: authHeaders },
    );

  const customerSession = await jsonRequest<SignedTextSession>(
    `${origin}/api/sessions/${started.sessionId}/chat/session`,
    { method: "POST", headers: authHeaders },
  );
  const customer = await TextHarness.connect({
    label: "customer",
    session: customerSession,
    bind: (providerConversationId) =>
      jsonRequest(`${origin}/api/sessions/${started.sessionId}/chat/bind`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ providerConversationId }),
      }),
  });
  activeHarnesses.push(customer);
  await customer.send(customerJob);
  let view = await readView();
  if (!view.job.confirmed) {
    await customer.send(
      `I explicitly confirm the complete job exactly as stated. Missing paths reported by the application are: ${view.job.missingRequiredPaths.join(", ") || "none"}.`,
    );
  }
  view = await waitFor(
    "confirmed job",
    readView,
    (state) => state.job.confirmed,
  );
  console.log("Customer job is structurally valid and explicitly confirmed.");

  const suppliers = await Promise.all(
    view.suppliers.map(async (supplier) => {
      const session = await jsonRequest<SignedTextSession>(
        `${origin}/api/sessions/${started.sessionId}/supplier-chat/${supplier.conversationId}/session`,
        { method: "POST", headers: authHeaders },
      );
      const harness = await TextHarness.connect({
        label: supplier.displayName,
        session,
        bind: (providerConversationId) =>
          jsonRequest(
            `${origin}/api/sessions/${started.sessionId}/supplier-chat/${supplier.conversationId}/bind`,
            {
              method: "POST",
              headers: authHeaders,
              body: JSON.stringify({ providerConversationId }),
            },
          ),
      });
      activeHarnesses.push(harness);
      return { ...supplier, harness };
    }),
  );
  await Promise.all(
    suppliers.map((supplier) => {
      const quote = supplierQuotes.find(
        (candidate) => candidate.name === supplier.displayName,
      );
      if (!quote)
        throw new Error(`No quote fixture for ${supplier.displayName}.`);
      return supplier.harness.send(quote.message);
    }),
  );
  view = await waitFor(
    "three comparable offers",
    readView,
    (state) =>
      state.suppliers.length === 3 &&
      state.suppliers.every(
        (supplier) => supplier.offerStatus === "comparable",
      ),
  );
  console.log("All three supplier offers are structured and comparable.");

  await customer.send(
    "Present the current offers and your configured recommendation. I have not selected one yet.",
  );
  await customer.send(
    "I explicitly select Rhine Cargo's CHF 1,460 offer on its exact stored terms.",
  );
  view = await waitFor(
    "customer selection",
    readView,
    (state) => state.awardStatus === "pending_commitment",
  );
  const selected = suppliers.find((supplier) =>
    view.suppliers.some(
      (current) =>
        current.conversationId === supplier.conversationId && current.selected,
    ),
  );
  if (!selected || selected.displayName !== "Rhine Cargo")
    throw new Error(
      `Expected Rhine Cargo to be selected: ${JSON.stringify(view.suppliers)}`,
    );
  console.log(
    "Customer selection is stored; customer has not been told confirmed.",
  );

  await selected.harness.send(
    "Yes. I explicitly accept and commit to the exact stored quote terms selected by the customer.",
  );
  view = await waitFor(
    "supplier commitment",
    readView,
    (state) => state.awardStatus === "confirmed",
  );
  console.log(
    "Selected supplier commitment is stored before customer closeout.",
  );

  await Promise.all([
    customer.send("Do we now have the selected supplier's commitment?"),
    ...suppliers
      .filter((supplier) => supplier !== selected)
      .map((supplier) =>
        supplier.harness.send("Has the customer made a final decision?"),
      ),
  ]);
  await Promise.all([
    customer.close(),
    ...suppliers.map(({ harness }) => harness.close()),
  ]);

  view = await waitFor(
    "post-call webhooks and completed session",
    readView,
    (state) => state.status === "completed",
    120_000,
  );
  if (view.awardStatus !== "confirmed")
    throw new Error(
      `Completed session has no confirmed award: ${JSON.stringify(view)}`,
    );
  console.log(
    JSON.stringify(
      {
        result: "passed",
        sessionId: started.sessionId,
        dashboardUrl: `${origin}/?session=${started.sessionId}`,
        intakeUrl: `${origin}${started.intakeUrl}`,
        outboundCalls: readiness.checks.outboundCalls,
        suppliers: view.suppliers.length,
        awardStatus: view.awardStatus,
        sessionStatus: view.status,
        timings: activeHarnesses.map((harness) => harness.timingSummary()),
      },
      null,
      2,
    ),
  );
}

main().catch(async (error) => {
  await Promise.all(activeHarnesses.map((harness) => harness.close()));
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
