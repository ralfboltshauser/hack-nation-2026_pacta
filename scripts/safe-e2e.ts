import { TextConversation, type Callbacks } from "@elevenlabs/client";
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
    negotiationOutcome: string | null;
  }>;
  selectedOfferRevisionId: string | null;
  awardStatus: string | null;
};

type SignedTextSession = {
  signedUrl: string;
  customLlmExtraBody?: Record<string, unknown>;
  dynamicVariables?: Record<string, string | number | boolean>;
};

type AgentToolRequest = Parameters<
  NonNullable<Callbacks["onAgentToolRequest"]>
>[0];
type AgentToolResponse = Parameters<
  NonNullable<Callbacks["onAgentToolResponse"]>
>[0];

function toolResponseBlocked(response: AgentToolResponse) {
  return "is_blocked" in response && response.is_blocked === true;
}

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
  private readonly toolRequests: AgentToolRequest[];
  private readonly toolResponses: AgentToolResponse[];
  private readonly errors: string[];
  private disconnected = false;

  private constructor(
    private readonly conversation: TextConversation,
    private readonly label: string,
    private readonly runtime: "custom_llm" | "native_tools",
    agentMessages: string[],
    toolRequests: AgentToolRequest[],
    toolResponses: AgentToolResponse[],
    errors: string[],
  ) {
    this.agentMessages = agentMessages;
    this.toolRequests = toolRequests;
    this.toolResponses = toolResponses;
    this.errors = errors;
  }

  static async connect(input: {
    label: string;
    session: SignedTextSession;
    bind: (providerConversationId: string) => Promise<void>;
  }) {
    const agentMessages: string[] = [];
    const toolRequests: AgentToolRequest[] = [];
    const toolResponses: AgentToolResponse[] = [];
    const errors: string[] = [];
    const lifecycle: {
      harness: TextHarness | undefined;
      disconnectBeforeReady: boolean;
    } = { harness: undefined, disconnectBeforeReady: false };
    const runtime =
      input.session.customLlmExtraBody &&
      Object.keys(input.session.customLlmExtraBody).length > 0
        ? "custom_llm"
        : "native_tools";
    const conversation = await TextConversation.startSession({
      signedUrl: input.session.signedUrl,
      connectionType: "websocket",
      textOnly: true,
      overrides: { conversation: { textOnly: true } },
      ...(input.session.customLlmExtraBody
        ? { customLlmExtraBody: input.session.customLlmExtraBody }
        : {}),
      ...(input.session.dynamicVariables
        ? { dynamicVariables: input.session.dynamicVariables }
        : {}),
      onMessage: ({ role, message }) => {
        if (role === "agent") agentMessages.push(message);
      },
      onAgentToolRequest: (request) => {
        toolRequests.push(request);
        console.log(
          `[${input.label}] tool request ${request.tool_name} (${request.tool_call_id})`,
        );
      },
      onAgentToolResponse: (response) => {
        toolResponses.push(response);
        console.log(
          `[${input.label}] tool response ${response.tool_name} (${response.tool_call_id}) called=${response.is_called} error=${response.is_error}`,
        );
      },
      onDisconnect: () => {
        if (lifecycle.harness) lifecycle.harness.disconnected = true;
        else lifecycle.disconnectBeforeReady = true;
      },
      onError: (message) => {
        errors.push(message);
        console.error(`[${input.label}] ElevenLabs error: ${message}`);
      },
    });
    const harness = new TextHarness(
      conversation,
      input.label,
      runtime,
      agentMessages,
      toolRequests,
      toolResponses,
      errors,
    );
    lifecycle.harness = harness;
    harness.disconnected = lifecycle.disconnectBeforeReady;
    await input.bind(conversation.getId());
    await harness.waitForNextAgentMessage(0, 30_000).catch(() => null);
    harness.assertNoToolErrors();
    return harness;
  }

  async send(message: string, timeoutMs = 60_000) {
    if (this.disconnected)
      throw new Error(`${this.label} disconnected before: ${message}`);
    const before = this.agentMessages.length;
    const startedAt = performance.now();
    this.conversation.sendUserMessage(message);
    const response = await this.waitForNextAgentMessage(before, timeoutMs);
    this.assertNoToolErrors();
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

  usesNativeTools() {
    return this.runtime === "native_tools";
  }

  assertNoToolErrors() {
    const failed = this.toolResponses.filter(
      (response) => response.is_error || toolResponseBlocked(response),
    );
    if (this.errors.length || failed.length)
      throw new Error(
        `${this.label} reported ElevenLabs/tool errors: ${JSON.stringify({
          errors: this.errors,
          failedTools: failed.map((response) => ({
            name: response.tool_name,
            toolCallId: response.tool_call_id,
            isError: response.is_error,
            isBlocked: toolResponseBlocked(response),
            isCalled: response.is_called,
          })),
        })}`,
      );
  }

  assertToolCalls(
    expected: Record<string, { minimum: number; maximum: number }>,
  ) {
    this.assertNoToolErrors();
    const counts = new Map<string, number>();
    for (const request of this.toolRequests)
      counts.set(request.tool_name, (counts.get(request.tool_name) ?? 0) + 1);

    for (const [toolName, range] of Object.entries(expected)) {
      const count = counts.get(toolName) ?? 0;
      if (count < range.minimum || count > range.maximum)
        throw new Error(
          `${this.label} expected ${toolName} ${range.minimum}-${range.maximum} times; observed ${count}. Full trace: ${JSON.stringify(this.toolSummary())}`,
        );
      const requests = this.toolRequests.filter(
        (request) => request.tool_name === toolName,
      );
      for (const request of requests) {
        const succeeded = this.toolResponses.some(
          (response) =>
            response.tool_call_id === request.tool_call_id &&
            response.is_called &&
            !response.is_error &&
            !toolResponseBlocked(response),
        );
        if (!succeeded)
          throw new Error(
            `${this.label} received no successful response for ${toolName} (${request.tool_call_id}). Full trace: ${JSON.stringify(this.toolSummary())}`,
          );
      }
    }
  }

  toolSummary() {
    return {
      label: this.label,
      runtime: this.runtime,
      requests: this.toolRequests.map((request) => ({
        name: request.tool_name,
        toolCallId: request.tool_call_id,
      })),
      responses: this.toolResponses.map((response) => ({
        name: response.tool_name,
        toolCallId: response.tool_call_id,
        isCalled: response.is_called,
        isError: response.is_error,
        isBlocked: toolResponseBlocked(response),
      })),
      errors: this.errors,
    };
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

const customerJob =
  "Origin is Zurich. Destination is Munich. Pickup time is 2026-07-21T08:00:00+02:00. I explicitly confirm these exact job details.";

const supplierQuotes = [
  { name: "Alpine Haulage", spokenPrice: "1,520" },
  { name: "Rhine Cargo", spokenPrice: "1,460" },
  { name: "Northstar Transit", spokenPrice: "1,490" },
].map((quote) => ({
  ...quote,
  message: `My all-in price is ${quote.spokenPrice} Swiss francs.`,
  clarificationMessage: `Yes. ${quote.spokenPrice} Swiss francs is my complete all-in total. It includes fuel, tolls, and accessorials, with no additional charges.`,
}));

function assertRuntimeToolGate(input: {
  customer: TextHarness;
  suppliers: Array<{ displayName: string; harness: TextHarness }>;
  selected: { displayName: string; harness: TextHarness };
}) {
  const harnesses = [
    input.customer,
    ...input.suppliers.map((supplier) => supplier.harness),
  ];
  harnesses.forEach((harness) => harness.assertNoToolErrors());
  const nativeCount = harnesses.filter((harness) =>
    harness.usesNativeTools(),
  ).length;
  if (nativeCount === 0) {
    console.log(
      "Custom LLM runtime detected; native milestone callback assertions are not applicable.",
    );
    return "custom_llm" as const;
  }
  if (nativeCount !== harnesses.length)
    throw new Error(
      `Mixed ElevenLabs runtimes detected across the safe E2E harnesses: ${JSON.stringify(harnesses.map((harness) => harness.toolSummary()))}`,
    );

  input.customer.assertToolCalls({
    submit_confirmed_job: { minimum: 1, maximum: 1 },
    get_customer_state: { minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    select_offer: { minimum: 1, maximum: 1 },
  });
  for (const supplier of input.suppliers) {
    supplier.harness.assertToolCalls({
      get_negotiation_state: {
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      submit_offer: { minimum: 1, maximum: 1 },
      commit_selected_offer:
        supplier === input.selected
          ? { minimum: 1, maximum: 1 }
          : { minimum: 0, maximum: 0 },
      record_supplier_outcome:
        supplier === input.selected
          ? { minimum: 0, maximum: 0 }
          : { minimum: 1, maximum: 1 },
    });
  }
  console.log("Native ElevenLabs milestone tool gate passed.");
  return "native_tools" as const;
}

async function main() {
  const origin = baseUrl();
  const demoAccessKey = required("PACTA_DEMO_ACCESS_KEY");
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
      "x-pacta-demo-key": demoAccessKey,
    },
    body: JSON.stringify({
      useCase: "freight_brokerage",
      customer: {
        displayName: "Safe E2E Customer",
        phoneE164: "+14155550100",
      },
      suppliers: supplierQuotes.map((quote, index) => ({
        displayName: quote.name,
        phoneE164: `+1415555020${index}`,
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
  view = await readView();
  const suppliersNeedingClarification = suppliers.filter((supplier) => {
    const current = view.suppliers.find(
      (candidate) => candidate.conversationId === supplier.conversationId,
    );
    return current?.offerStatus !== "comparable";
  });
  if (suppliersNeedingClarification.length) {
    console.log(
      `Answering one explicit offer clarification for: ${suppliersNeedingClarification
        .map((supplier) => supplier.displayName)
        .join(", ")}.`,
    );
    await Promise.all(
      suppliersNeedingClarification.map((supplier) => {
        const quote = supplierQuotes.find(
          (candidate) => candidate.name === supplier.displayName,
        );
        if (!quote)
          throw new Error(`No quote fixture for ${supplier.displayName}.`);
        return supplier.harness.send(quote.clarificationMessage);
      }),
    );
  }
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
    "I explicitly select Rhine Cargo's 1,460 Swiss franc offer on its exact stored terms.",
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
  view = await waitFor(
    "non-selected supplier closeout",
    readView,
    (state) =>
      state.suppliers
        .filter(
          (supplier) => supplier.conversationId !== selected.conversationId,
        )
        .every(
          (supplier) => supplier.negotiationOutcome === "not_selected_notified",
        ),
    30_000,
  );
  console.log("Both non-selected supplier outcomes are stored.");
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
  const runtime = assertRuntimeToolGate({ customer, suppliers, selected });
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
        runtime,
        timings: activeHarnesses.map((harness) => harness.timingSummary()),
        tools: activeHarnesses.map((harness) => harness.toolSummary()),
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
