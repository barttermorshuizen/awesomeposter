# Condition DSL Parser & Validation

This module lives under `packages/shared/src/condition-dsl/` and provides the shared parsing,
rendering, and evaluation utilities used by both the Vue playground and Nitro services.

## Registry

- The catalog is defined in `catalog.ts` and exported as `conditionVariableCatalog`.
- Each entry includes `id`, `path`, `type`, optional `group/description/example`, and an explicit
  `allowedOperators` list (defaults are derived from the variable type).
- Update this file when adding policy metrics; consumers read it at runtime so no extra wiring is
  required.

## API surface

| Function | Description |
| --- | --- |
| `parseDsl(expression, catalog)` | Tokenises and parses the DSL into an AST, validates identifiers/operators against the supplied catalog, and returns JSON-Logic, canonical DSL, referenced variables, and warnings. Validation failures include rich line/column ranges. |
| `toDsl(jsonLogic, catalog)` | Converts supported JSON-Logic payloads back into the canonical DSL string. |
| `evaluateCondition(jsonLogic, payload)` | Lightweight evaluator used by the playground to preview results and resolved variable values. |
| `conditionVariableCatalog` | Default registry shared by UI and server logic. |

## Server helper

- `server/utils/condition-dsl.ts` exposes `validateConditionInput({ dsl?, jsonLogic? })`.
- When DSL is supplied it reuses `parseDsl`; failures throw an `H3Error` with `statusCode: 400`,
  `statusMessage: "Invalid condition expression."`, and a `data` payload containing
  `{ code: 'invalid_condition_dsl', errors }`.
- If only JSON-Logic is provided, the helper passes the payload through to preserve backwards
  compatibility.

## Tests & fixtures

- Golden fixtures live in `tests/fixtures/condition-dsl/` for regression coverage.
- Unit tests:
  - `packages/shared/__tests__/condition-dsl.spec.ts` exercises round-trip parsing/rendering,
    unknown variable/type errors, and evaluator behaviour.
  - `server/utils/__tests__/condition-dsl-helper.spec.ts` covers the Nitro helper contract.
  - `src/lib/__tests__/conditionPlaygroundCatalog.spec.ts` ensures the UI catalog mirrors the
    shared registry.

Keep this document in sync with future grammar or registry changes so downstream teams can rely on
the shared contract.
