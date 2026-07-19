# Use-case configurations

Every runnable session pins one immutable configuration version. The engine itself contains no freight, carrier, toll, insurance, construction, or other domain concepts.

A published configuration defines:

- terminology;
- job JSON Schema, intake questions, document hints, completion, and confirmation;
- supplier discovery adapter requirements and session limits;
- offer JSON Schema, line-item catalog, normalization, and clarification rules;
- negotiation phases, outcomes, permitted leverage, and honesty constraints;
- recommendation eligibility, scoring, trade-offs, and presentation.

Provider credentials and deployment IDs are not use-case configuration. Customer, supplier, and uploaded-file choices for one run are session input.

The contract is specified in [`../../docs/architecture/use-case-configuration.md`](../../docs/architecture/use-case-configuration.md). The first implementation should include a freight example and one structurally different non-freight conformance fixture. Neither exists yet.
