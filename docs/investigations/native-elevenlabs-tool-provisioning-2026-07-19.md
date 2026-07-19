# Native ElevenLabs tool provisioning: 422 root cause and verification

Date: 2026-07-19 (Europe/Zurich)

Scope: preview-only ElevenLabs agents and standalone webhook tools. No production agent ID was changed and no outbound-call API was invoked.

## Observed sequence

```mermaid
sequenceDiagram
    participant C as "Use-case config"
    participant S as "Schema compiler"
    participant P as "Preview provisioner"
    participant E as "ElevenLabs API"

    C->>S: "Job/offer JSON Schema"
    Note over C,S: "VERIFIED: config parsed and compiled"
    S->>P: "Primitive leaves such as {type: string}"
    Note over S,P: "FAILED CONTRACT: no description/value source"
    P->>E: "POST /v1/convai/tools"
    E-->>P: "422: literal needs description or another value source"
    Note over P,E: "VISIBLE FAILURE; earliest cause was compiler output"
    P->>E: "List exact preview resources"
    E-->>P: "No tools or agents found"
    Note over P,E: "VERIFIED: zero partial resources after failure"
    S->>P: "Leaves include deterministic descriptions"
    Note over S,P: "FIXED and covered by compiler tests"
    P->>E: "Create/update seven exact webhook tools"
    E-->>P: "Accepted; seven stable tool IDs"
    P->>E: "Create/update two text-only agents with tool IDs"
    E-->>P: "Accepted; two stable agent IDs"
    P->>E: "Read back tools and agents"
    E-->>P: "Exact schemas, bindings, client events and system tools"
    P->>E: "Repeat dry-run"
    E-->>P: "All resources resolve as updates; no duplicates"
```

## Primary evidence

- `2026-07-19T10:55:00.205+02:00`: ElevenLabs returned HTTP 422 at nested job-schema leaves such as `job.origin.city`. Exact message: `Must set one of: description, dynamic_variable, is_system_provided, constant_value, or is_omitted`; the rejected input was `{ "type": "string" }`.
- `2026-07-19T10:55:55.201+02:00`: an immediate exact-name dry-run still reported both tools and both agents as `create`. The failed request therefore created zero partial resources.
- `2026-07-19T10:56:05.497+02:00`: the first corrected apply created the two milestone tools and two text-only preview agents.
- `2026-07-19T11:05:08.606+02:00`: the complete seven-tool text toolbox was accepted. Five tools were created and the original two updated.
- `2026-07-19T11:08:25.925+02:00`: all seven tools were renamed in place to their provider-visible runtime contract names; IDs were preserved.
- Final provider readback: exactly seven short-name tools, zero legacy prefixed tools, three customer tool bindings, four supplier tool bindings, `agent_tool_request` and `agent_tool_response_full_payload` client events, and `end_call` plus `skip_turn` on both agents. Both agents remain `textOnly: true`; customer file input is enabled and supplier file input is explicitly disabled.

The provider documentation says webhook body values are generated from parameter descriptions, and recommends detailed descriptions for each argument. Its create-tool example likewise gives a primitive property a description. System variables `system__conversation_id` and `system__conversation_history` are provider-populated and cannot be overridden by client initiation data:

- [Webhook tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/webhook-tools)
- [Create tool API](https://elevenlabs.io/docs/eleven-agents/api-reference/tools/create)
- [Dynamic variables](https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables)

## Root cause and fix

The visible fault was the ElevenLabs create-tool boundary, but the earliest causal fault was our JSON-Schema-to-tool-schema compiler. Generic JSON Schema permits primitive leaves without descriptions; ElevenLabs' tool schema requires every literal to have an LLM description or another value source. The compiler now emits a deterministic fallback description (`Explicit value for <JSON pointer>.`) when the domain schema has none. The provisioner independently walks every request schema and fails locally before mutation if this provider contract is violated again.

The exact seven server contracts are now `submit_confirmed_job`, `get_customer_state`, `select_offer`, `get_negotiation_state`, `submit_offer`, `commit_selected_offer`, and `record_supplier_outcome`. The prefixed preview names were migrated in place, leaving no orphaned prefixed tools.

## Remaining uncertainty

The default text configuration is live-provider verified. `--voice` is implemented as an explicit later mode (`textOnly: false`, 180-second maximum, 150-second silence timeout, recording disabled, and supplier voicemail detection), but it has intentionally not been applied or used to place a call. Therefore its structure is SDK-type-checked and dry-run verified, not yet live-provider verified.
