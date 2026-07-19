# Use-case configuration contract

Status: proposed foundational contract  
Last updated: 2026-07-19

## Core invariant

The engine has no freight, moving, medical, construction, insurance, toll, carrier, or shipper concepts.

The engine knows only universal mechanics:

- a session pins one immutable use-case configuration version;
- a customer conversation produces revisions of one job document;
- intake continues until that document satisfies configured completion and confirmation policy;
- suppliers receive the exact confirmed job revision;
- each supplier conversation produces revisions of one offer document;
- clarification continues until the offer is comparable or reaches a configured terminal outcome;
- negotiations exchange only verified, policy-shareable facts;
- configured rules assess offers and produce a recommendation with reasons;
- the customer—not the recommendation engine—selects an offer;
- every transition, revision, and evidence reference is durable.

The engine can be deployed without a freight configuration, but it cannot start a business session without some valid published use-case configuration. That requirement is not domain coupling: without a job schema, offer schema, and completion policy, “complete,” “comparable,” and “recommended” have no meaning.

Freight is one fixture used to prove the contract.

## Three configuration layers

Do not put every setting into one JSON file.

### 1. Use-case configuration

Versioned declarative business semantics:

- terminology;
- job and offer schemas;
- intake questions;
- document-extraction guidance;
- clarification rules;
- negotiation phases, outcomes, and permitted leverage;
- recommendation policy;
- display metadata.

This document is stored in `use_case_config_versions` and pinned by sessions.

### 2. Deployment configuration

Environment/provider concerns:

- ElevenLabs agent IDs and phone-number IDs;
- Vercel and Supabase URLs;
- model IDs;
- provider credentials;
- webhook secrets;
- Exa/Apollo adapter credentials;
- plan concurrency limits.

Secrets and provider identifiers must not be embedded in a published use-case document.

### 3. Session input

Data selected for one execution:

- customer party;
- intake channel;
- supplier candidates;
- requested supplier count and parallelism;
- optional deadline;
- uploaded artifacts;
- operator overrides allowed by policy.

The use-case config may define safe defaults and limits, but one session owns the actual values.

## Proposed top-level document

```json
{
  "$schema": "https://example.test/use-case-config.schema.json",
  "contractVersion": "1",
  "key": "example_use_case",
  "version": "0.1.0",
  "terminology": {},
  "capabilities": {},
  "job": {},
  "intake": {},
  "suppliers": {},
  "offer": {},
  "negotiation": {},
  "recommendation": {},
  "customerUpdates": {},
  "completion": {},
  "presentation": {},
  "extensions": {}
}
```

Unknown top-level keys fail publication. Each section below is itself closed by default. An `extensions` namespace permits explicitly versioned future capabilities without silently changing the meaning of old configs.

## Terminology

Terminology changes language and presentation, never database relationships.

```json
{
  "terminology": {
    "customer": { "singular": "customer", "plural": "customers" },
    "supplier": { "singular": "supplier", "plural": "suppliers" },
    "job": { "singular": "job", "plural": "jobs" },
    "offer": { "singular": "offer", "plural": "offers" },
    "session": { "singular": "sourcing session", "plural": "sourcing sessions" }
  }
}
```

Agent prompts and UI labels are compiled from these terms. Code continues to use `customer`, `supplier`, `job`, `offer`, and `session`.

## Job contract

`job.schema` is the only authority for the document shape. Use JSON Schema 2020-12, including `required`, `if`/`then`, formats, enums, numeric bounds, and closed objects where appropriate.

Question metadata must reference schema fields by JSON Pointer; it must not restate their types.

```json
{
  "job": {
    "schema": {},
    "completion": {
      "mustBeKnown": ["/exampleField"],
      "allowExplicitUnknown": [],
      "confirmation": {
        "required": true,
        "readbackPaths": ["/exampleField"],
        "prompt": "Please confirm that this specification is correct."
      }
    },
    "fields": [
      {
        "path": "/exampleField",
        "label": "Example field",
        "priority": 10,
        "questions": {
          "voice": ["What should I use for the example field?"],
          "chat": ["What should I use for the example field?"]
        },
        "documentHints": ["example", "example field"],
        "confirmationLabel": "Example field",
        "sensitivity": "normal"
      }
    ]
  }
}
```

Important semantics:

- missing means not collected;
- `null` means explicitly unknown only when the schema and completion policy allow it;
- `false`, `0`, and `[]` are known values and cannot be treated as missing;
- a schema-valid draft is not a confirmed job;
- confirmation always references an immutable job revision ID;
- supplier calls receive the confirmed revision document verbatim, not a regenerated summary.

## Intake channels

Voice, text, and file-assisted chat are adapters around the same intake planner and reducer.

```json
{
  "intake": {
    "channels": {
      "voice": {
        "enabled": true,
        "askOneQuestionAtATime": true
      },
      "chat": {
        "enabled": true,
        "fileInput": {
          "enabled": true,
          "acceptedTypes": ["application/pdf", "image/png", "image/jpeg"],
          "maxFiles": 3
        }
      }
    },
    "questionSelection": {
      "strategy": "highest_priority_missing_field",
      "avoidRepeatingAnsweredFields": true
    },
    "sourceConflict": {
      "strategy": "ask_customer",
      "showBothValues": true
    }
  }
}
```

The flow for every channel is identical:

1. extract observations from the new user turn or file;
2. apply only evidence-supported changes to a new job revision;
3. validate against the pinned JSON Schema;
4. compute missing/unknown/contradictory paths;
5. ask the next configured question;
6. when complete, present the configured readback;
7. store explicit confirmation of that exact revision.

The implemented customer adapter is an ElevenLabs text-only conversation. For PDF/image turns, the browser privately stages the durable artifact, uploads the same file to ElevenLabs, and includes an opaque marker that lets the authenticated Custom LLM load and verify the private copy. There is no parallel Vercel chat route.

The chat conversation remains open during supplier sourcing. Committed material events stream to the UI immediately and become agent context on the customer's next turn. The MVP does not claim that `contextual_update` forces an unsolicited agent turn and does not misrepresent system context as customer speech.

## Supplier discovery and call set

Supplier discovery is an adapter, not a freight feature and not part of the core negotiation state.

```json
{
  "suppliers": {
    "defaultCount": 3,
    "defaultParallelism": 3,
    "maxCount": 10,
    "discovery": {
      "adapterKey": "static.v1",
      "queryInputs": ["/exampleField"],
      "eligibilityRuleIds": []
    }
  }
}
```

The MVP uses `static.v1` with supplied phone numbers. Later adapters may be `exa.web.v1`, `apollo.people.v1`, or another registry entry. The config selects an adapter and declares safe inputs; application code owns API calls, authentication, validation, deduplication, and consent policy.

## Offer contract

`offer.schema` is the authority for the supplier's structured output. It can be completely different across use cases.

```json
{
  "offer": {
    "schema": {},
    "fields": [],
    "lineItems": {
      "enabled": true,
      "path": "/pricing/lineItems",
      "catalog": [],
      "unknownItemPolicy": "allow_with_description"
    },
    "normalizers": [],
    "completion": {
      "mustBeKnown": [],
      "terminalStatuses": ["comparable", "declined", "callback", "unreachable"]
    },
    "clarificationRules": []
  }
}
```

Example line-item definition:

```json
{
  "key": "example_fee",
  "label": "Example fee",
  "aliases": ["example charge"],
  "amountPath": "/amountMinor",
  "currencyPath": "/currency",
  "sign": "charge",
  "clarifyPresence": true
}
```

The engine does not know insurance, tolls, fuel, labor, tax, parts, or deductibles. A use-case catalog defines them and their spoken aliases.

## Clarification rules

JSON Schema answers “is this document shaped correctly?” Clarification rules answer “what must the agent ask before this offer can be compared or recommended?”

```json
{
  "id": "clarify_example_condition",
  "when": {
    "all": [
      { "source": "offer", "path": "/example/included", "op": "missing" },
      { "source": "job", "path": "/exampleRequired", "op": "eq", "value": true }
    ]
  },
  "effect": {
    "blocksComparability": true,
    "severity": "required",
    "questions": {
      "voice": ["Does your price include the example condition?"],
      "chat": ["Does the offer include the example condition?"]
    }
  }
}
```

Allowed predicate operations in contract version 1:

- `missing`, `present`;
- `eq`, `neq`, `in`, `not_in`;
- `lt`, `lte`, `gt`, `gte` for schema-declared numbers;
- `contains` for arrays;
- `all`, `any`, `not` composition.

Sources are limited to `job`, `offer`, `session`, and verified `facts`. Values are literals; there is no JavaScript, SQL, network access, regular-expression execution, or arbitrary JSON Logic. Publishing validates every pointer and operand type.

Missing-value semantics are deterministic: `missing` and `present` inspect existence; all comparison operations evaluate false when the path is absent. A rule that should match either absent or explicit false must say so with `any`. This prevents accidental eligibility caused by three-valued logic hidden inside an implementation.

## Normalization and comparability

Configuration may reference a small application-owned registry of deterministic functions.

```json
{
  "offer": {
    "normalizers": [
      {
        "functionKey": "money.sum_line_items.v1",
        "inputs": ["/pricing/lineItems"],
        "output": "/normalized/totalMinor"
      }
    ],
    "comparability": {
      "requiredPaths": ["/normalized/totalMinor"],
      "ruleIds": ["clarify_example_condition"],
      "sameCurrencyRequired": true
    }
  }
}
```

Only pre-registered pure functions are allowed. A function version is part of the comparison audit trail. Unknown material fees, unresolved scope differences, incompatible units, or blocked clarification rules make an offer non-comparable; the model cannot override that classification.

## Negotiation contract

The engine supplies the state-machine mechanism; the config supplies legal phase and outcome keys.

```json
{
  "negotiation": {
    "phases": [
      "presenting_job",
      "qualifying",
      "quoting",
      "clarifying",
      "bargaining",
      "waiting",
      "closing",
      "closed"
    ],
    "initialPhase": "presenting_job",
    "transitions": [],
    "outcomes": [
      "selected_confirmed",
      "not_selected_notified",
      "supplier_declined",
      "incompatible",
      "callback_committed",
      "unreachable",
      "disconnected_without_recovery",
      "commitment_failed",
      "cancelled",
      "failed"
    ],
    "levers": [],
    "limits": {
      "maxConcessionRequests": 2,
      "maxDurationSeconds": 600
    }
  }
}
```

Each leverage definition declares:

- which verified fact type may be used;
- eligibility and freshness conditions;
- what can be disclosed;
- what must be redacted;
- which phase may use it;
- a configured question or rhetorical goal;
- whether withdrawal/correction revokes it.

The supplier name is not exposed with a competing offer unless the config explicitly permits it. A fabricated or merely inferred offer never becomes a leverage fact.

## Recommendation contract

The application recommends; the customer decides.

Recommendation is not one universal cheapest-price sorter. The config produces four separate outputs for every offer:

- `eligible`: whether it may reasonably be selected;
- `blockers`: use-case-specific disqualifying facts;
- `warnings`: material risks that do not necessarily disqualify;
- `tradeoffs`: normalized metrics used for explanation.

Then a deterministic policy may nominate one recommended offer and explain which configured rules caused that result.

```json
{
  "recommendation": {
    "eligibilityRules": [],
    "warningRules": [],
    "metrics": [],
    "policies": [
      {
        "id": "default",
        "ranking": [
          { "metric": "risk", "direction": "asc" },
          { "metric": "normalized_total", "direction": "asc" }
        ]
      }
    ],
    "customerMaySelectNonRecommended": true,
    "requireExplicitCustomerSelection": true
  }
}
```

A high-risk job may select a policy where missing coverage is a blocker. A low-risk job may treat the same missing coverage as a warning and prefer lower cost. Those are use-case rules over configured job/offer paths, never freight branches in engine code.

The final customer decision stores the selected immutable offer revision even when it differs from the recommendation.

## Customer and supplier waiting behavior

```json
{
  "customerUpdates": {
    "materialEventTypes": [
      "conversation.connected",
      "offer.became_comparable",
      "offer.revision_created",
      "negotiation.outcome_recorded"
    ],
    "maxSilenceSeconds": 25,
    "noChangeAction": "skip_turn",
    "dedupeByEventSequence": true
  },
  "completion": {
    "reviewReadiness": {
      "mode": "all_ready_or_deadline",
      "minimumComparableOffers": 1,
      "deadlineSeconds": 180,
      "onDeadline": "review_available_offers"
    },
    "keepSupplierCallsOpenUntilCustomerDecision": true,
    "winnerRequiresExplicitConfirmation": true,
    "notifyNonSelectedBeforeEnd": true
  }
}
```

These are orchestration policies, not provider code. A supplier is ready when it has a sufficiently firm comparable offer and is waiting, or it has a terminal non-offer disposition. `all_ready_or_deadline` starts review after every supplier is ready or the sourcing deadline expires. The adapter maps waiting and updates onto ElevenLabs silence turns and system tools. If another provider cannot implement the required behavior, the capability check fails before a session starts.

## Presentation

UI configuration may declare:

- labels and pluralization;
- summary paths;
- comparison columns;
- formatting hints for money, dates, duration, units, and booleans;
- icons and semantic colors selected from an application-owned catalog;
- redaction rules for public/demo views.

It may not contain raw HTML, executable components, CSS, SQL, or arbitrary formatter code.

## Freight example fragment

This fragment illustrates configuration power; none of these keys belong to the engine:

```json
{
  "offer": {
    "lineItems": {
      "catalog": [
        {
          "key": "linehaul",
          "label": "Linehaul",
          "aliases": ["transport", "base rate"]
        },
        {
          "key": "fuel",
          "label": "Fuel surcharge",
          "aliases": ["fuel", "diesel surcharge"]
        },
        {
          "key": "tolls",
          "label": "Tolls",
          "aliases": ["road tolls", "road charges"]
        },
        {
          "key": "insurance",
          "label": "Cargo insurance",
          "aliases": ["coverage", "goods insurance"]
        }
      ]
    },
    "clarificationRules": [
      {
        "id": "freight_tolls_resolved",
        "when": {
          "source": "offer",
          "path": "/terms/tollsIncluded",
          "op": "missing"
        },
        "effect": {
          "blocksComparability": true,
          "severity": "required",
          "questions": {
            "voice": ["Are all road tolls included in that price?"]
          }
        }
      }
    ]
  },
  "recommendation": {
    "eligibilityRules": [
      {
        "id": "critical_load_requires_coverage",
        "when": {
          "all": [
            {
              "source": "job",
              "path": "/risk/criticality",
              "op": "eq",
              "value": "critical"
            },
            {
              "any": [
                {
                  "source": "offer",
                  "path": "/coverage/confirmed",
                  "op": "missing"
                },
                {
                  "source": "offer",
                  "path": "/coverage/confirmed",
                  "op": "eq",
                  "value": false
                }
              ]
            }
          ]
        },
        "effect": {
          "eligible": false,
          "reason": "Required cargo coverage is not confirmed."
        }
      }
    ]
  }
}
```

## Publication and compilation

A configuration becomes publishable only if the compiler can:

1. validate the meta-schema;
2. validate the job and offer JSON Schemas;
3. resolve every JSON Pointer against its schema;
4. type-check every predicate;
5. resolve every normalizer and discovery adapter key against an allowlisted registry;
6. detect duplicate field, phase, outcome, rule, metric, and line-item keys;
7. prove the transition graph has valid terminal paths;
8. detect question dependency cycles;
9. validate that readback and comparison paths exist;
10. run config-specific fixtures for complete/incomplete jobs, comparable/non-comparable offers, recommendation policy, and leverage revocation;
11. compute a content hash and store an immutable published version.

Sessions pin the published ID and content hash. Draft configurations may change; published configurations and their referenced function versions may not.

## Deliberately outside configuration

- database table or column definitions;
- arbitrary code, SQL, regular expressions, or network requests;
- secrets and provider credentials;
- permission to make payments or legally bind a customer;
- model-generated personality labels;
- silent changes learned from historical calls;
- provider retry semantics;
- UI component code;
- one-off session parties and phone numbers.

These boundaries keep the engine portable without turning configuration into an unsafe programming language.

## Required proof

Before calling the contract truly use-case agnostic, implement two deliberately different fixtures and run the same engine tests against both. Freight plus a small non-logistics fixture—such as contractor bids—should differ in job paths, offer fields, line items, clarification rules, terminology, and recommendation policy without requiring an engine code change.
