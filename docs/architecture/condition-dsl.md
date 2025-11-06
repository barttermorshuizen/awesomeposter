# Condition DSL Parser & Validation

This module lives under `packages/shared/src/condition-dsl/` and provides the shared parsing,
rendering, and evaluation utilities used by both the Vue playground and Nitro services.

## Registry

- The catalog is defined in `catalog.ts` and exported as `conditionVariableCatalog`.
- Each entry includes `id`, `path`, `type`, optional `group/description/example`, and an explicit
  `allowedOperators` list (defaults are derived from the variable type).
- Facet-backed entries expose `dslPath` aliases (for example `facets.planKnobs.hookIntensity`) that map
  to the canonical JSON path (`metadata.runContextSnapshot.facets.planKnobs.value.hookIntensity`).
  Legacy aliases that include `.value` remain accepted. The parser accepts either form and normalises DSL
  aliases back to canonical paths when producing
  JSON-Logic.
- Update this file when adding policy metrics; consumers read it at runtime so no extra wiring is
  required.

## API surface

| Function | Description |
| --- | --- |
| `parseDsl(expression, catalog)` | Tokenises and parses the DSL into an AST, validates identifiers/operators against the supplied catalog, and returns JSON-Logic, canonical DSL, referenced variables, and warnings. Validation failures include rich line/column ranges. |
| `toDsl(jsonLogic, catalog)` | Converts supported JSON-Logic payloads back into the canonical DSL string. |
| `evaluateCondition(jsonLogic, payload)` | Lightweight evaluator used by the playground to preview results and resolved variable values. |
| `conditionVariableCatalog` | Default registry shared by UI and server logic. |

`parseDsl` accepts both canonical paths and aliases; `toDsl` always renders the shorter alias when one
is available so human-authored expressions stay tidy while the runtime continues to persist the
canonical run-context path.

## Quantifier Support

- The grammar accepts `some(<collection>, <predicate>)` and `all(<collection>, <predicate>)`.
- `<collection>` must resolve to a catalog variable whose type is `array`. Validation surfaces an `invalid_quantifier` error when a non-array source is used.
- Predicates evaluate against the current item. The default alias is `item`; authors may override it with `as <alias>` (e.g. `some(results as r, r.status == "ready")`).
- Aliases must be referenced inside the predicate. Missing alias usage triggers an `invalid_quantifier` diagnostic.
- JSON-Logic output encodes the quantifier as `[collection, predicate, alias?]`. The alias element is omitted when the default `item` alias is used.
- `toDsl` infers the alias from the JSON-Logic payload, including legacy payloads that omit explicit alias metadata, and renders the canonical DSL with `item.` prefixes.

## Server helper

- `server/utils/condition-dsl.ts` exposes `validateConditionInput({ dsl?, jsonLogic? })`.
- `packages/flex-agents-server/src/utils/condition-dsl.ts` exposes the same helper for the Flex
  runtime. `routes/api/v1/flex/run.stream.post.ts` calls it before orchestrating a run.
- When DSL is supplied the helper reuses `parseDsl`; failures throw an `H3Error` with
  `statusCode: 400`, `statusMessage: "Invalid condition expression."`, and a `data` payload
  containing `{ code: 'invalid_condition_dsl', errors }`.
- If only JSON-Logic is provided, the helper passes the payload through to preserve backwards
  compatibility.

Both Nitro surfaces replace the incoming `trigger.condition` with a canonical object containing the
compiled JSON-Logic, the submitted DSL string, the canonical rendering, any parser warnings, and the
list of referenced variable paths. Admin tooling can therefore round-trip readable expressions while
the orchestrator keeps executing deterministic JSON-Logic.

## Tests & fixtures

- Golden fixtures live in `tests/fixtures/condition-dsl/` for regression coverage.
  - `quantifier-*.dsl/json` fixtures pin the `some`/`all` syntax and alias rendering.
- Unit tests:
  - `packages/shared/__tests__/condition-dsl.spec.ts` exercises round-trip parsing/rendering,
    unknown variable/type errors, and evaluator behaviour.
  - `server/utils/__tests__/condition-dsl-helper.spec.ts` covers the Nitro helper contract.
  - `src/lib/__tests__/conditionPlaygroundCatalog.spec.ts` ensures the UI catalog mirrors the
    shared registry.

Keep this document in sync with future grammar or registry changes so downstream teams can rely on
the shared contract.
