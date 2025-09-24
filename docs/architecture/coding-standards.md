# Coding Standards

This project spans a Vue 3 SPA, a Nitro API surface, and an OpenAI Agents server. All code is TypeScript-first and uses the flat ESLint config in `eslint.config.ts`. The following standards keep contributors aligned.

## 1. Language & Module Conventions

- **TypeScript everywhere**: All runtime code (Vue components, Nitro routes, agents server, shared packages) must be written in TypeScript. Enable `strict` options inherited from repo `tsconfig`. Avoid `any`; prefer precise typing with Zod schemas where dynamic data enters.
- **ES Module syntax**: Use `import`/`export` exclusively. No CommonJS helpers (`require`, `module.exports`).
- **Async boundaries**: Always `await` Promises. Wrap orchestrator / API interactions in `try/catch` and surface domain-specific errors with context.
- **Environment access**: Read env vars through Nitro runtime utilities or explicit config modules; never scatter `process.env` lookups.

## 2. Vue SPA Practices

- **Single File Components**: Use `<script setup lang="ts">` with Composition API, as demonstrated in `src/components/MainLayout.vue` and `App.vue`.
- **Component scope**:
  - `src/components` for reusable pieces.
  - `src/views` for route-level screens.
  - `src/stores` for Pinia state; expose getters/actions explicitly.
- **Styling**: Prefer scoped styles in SFCs. Use Vuetify utility classes when possible instead of bespoke CSS.
- **Routing**: Register routes in `src/router` using lazy-loaded components where feasible. Route names are kebab-case.
- **State**: Stores live under `src/stores` and must avoid direct mutation of other stores.

## 3. Nitro API & Background Jobs

- **Route placement**: HTTP handlers reside in `server/api/**`. Export default `defineEventHandler` functions.
- **Jobs & utilities**: Background tasks under `server/jobs`, shared utilities in `server/utils`.
- **Auth middleware**: Keep `defineEventHandler` thin; push validation/business logic into reusable services under `packages/shared` when applicable.

## 4. Agents Server Standards

- **Location**: Code lives in `packages/agents-server/src`. Keep orchestrator logic under `src/orchestrator` and persistence/services under `src/server`.
- **Schema validation**: Use Zod for payload validation (already a dependency).
- **Logging**: Use Winston (configured in agents server) for structured logs; include correlation IDs from orchestrator where available.
- **OpenAI Agents SDK**: Follow SDK helper APIs for plan persistence & rehydration; encapsulate interactions behind services for testability.

## 5. Shared Packages

- **@awesomeposter/shared**: Holds domain models, Zod schemas, helper utilities. Keep these framework-agnostic.
- **@awesomeposter/db**: Drizzle ORM schemas/migrations. Ensure migrations match runtime models.

## 6. Linting & Formatting

- Run `npm run lint` before committing. The config enforces:
  - Vue essential rules (`eslint-plugin-vue` flat preset)
  - TypeScript best practices via `@vue/eslint-config-typescript`
  - Vitest plugin on files under `src/**/__tests__`
- Use Prettier defaults (handled by IDE). No manual `eslint-disable` unless justified and documented.

## 7. Testing Expectations

- **Unit tests**: Vitest (`npm run test:unit`). Vue components use Vue Test Utils; backend logic uses plain Vitest.
- **Integration tests**: Agents server has suites under `packages/agents-server/tests`; API tests belong under `server/api/__tests__` (create if absent).
- **Naming**: Test files end with `.spec.ts` or `.test.ts`. Colocate next to source or under `__tests__` directories as existing patterns do.

## 8. Git & CI Hygiene

- Keep commits scoped to a story/task.
- Update story Dev Agent Record only when instructed.
- Pending migrations must be reversible; annotate in PR description.
- Ensure `npm run build` and `npm run test:unit` succeed locally before handing off.

Adhering to these standards maintains consistency across the client, API, and agents layers while supporting rapid iteration.
