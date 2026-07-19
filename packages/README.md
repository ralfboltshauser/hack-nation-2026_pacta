# Packages

Reusable, non-deployable TypeScript modules live here.

| Package                                | Ownership                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------- |
| [`core/`](core/)                       | Negotiation types, reducer, event replay, and offer comparison            |
| [`db/`](db/)                           | Drizzle schema, migrations, persistence, and database integration tests   |
| [`elevenlabs/`](elevenlabs/)           | Provider contracts, client, runtime, SSE, and webhook normalization       |
| [`use-case-config/`](use-case-config/) | Versioned configuration schema, compiler, planner, and built-in use cases |

Packages expose source entry points inside the workspace and contain no independently deployed services.
