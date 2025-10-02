# Frontend Tech Stack
The discovery UI reuses the approved stack. Versions stay in lockstep with `package.json` to avoid dependency drift.

| Category | Technology | Version | Purpose | Rationale |
| --- | --- | --- | --- | --- |
| Framework | Vue 3 (Composition API) | ^3.5.18 | SPA runtime | Already powers the app; discovery screens composed with `<script setup>` for parity. |
| UI Library | Vuetify 3 | ^3.9.6 | Component system, layout primitives | Existing design system; gives consistent visuals and accessibility helpers. |
| State Management | Pinia 3 | ^3.0.3 | Domain stores for briefs, sources, telemetry | Matches current stores (`hitl`, `ui`); no learning curve. |
| Routing | vue-router 4 | ^4.5.1 | Route-level screen management | Same history + lazy-load pattern as rest of app. |
| Build Tool | Vite 7 | ^7.0.6 | Dev server & bundler | Already configured; new modules auto-picked up. |
| Styling | Vuetify theme + Sass | ^1.91.0 | Tokens, overrides, scoped styles | Maintains central theming; only scoped Sass when Vuetify slots fall short. |
| Testing | Vitest + Vue Test Utils | ^3.2.4 / ^2.4.6 | Unit + component testing | Existing testing toolchain; no extra libs. |
| Component Library | Vuetify 3 | ^3.9.6 | Cards, data tables, dialogs | Reuse data table, filter chips, virtual scroll. |
| Form Handling | Native Vuetify inputs + composables | – | Source/keyword forms | Avoid extra form libs; validation handled via composables + Zod schemas shared from Nitro. |
| Animation | Vuetify transitions | – | List/detail transitions | Use built-in transitions (e.g., `expand-transition`) to limit dependencies. |
| Dev Tools | Vite Dev Server, Vue DevTools | – | DX | Current dev workflow continues to apply. |
