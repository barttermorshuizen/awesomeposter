# Styling Guidelines
- Keep to Vuetify layout primitives (`v-container`, `v-row`) to align with other screens.
- Filters use `v-chip-group` + `v-select` so keyboard navigation remains intact.
- Detail drawer mirrors the HitL panel spacing scale (`pa-4`, `gap-4`).
- Status pills rely on the existing color tokens (e.g., `success`, `warning`); avoid bespoke hex values.
- Long tables use `v-data-table-server` with `fixed-header` and `height="calc(100vh - ???)"` to maintain scroll performance without new libs.
- For bulk action confirmation, reuse `v-dialog` + `v-toolbar` top rows to stay consistent with other modals.

## Theme Tokens
No new global CSS variables are required. If telemetry charts need accent colors, use Vuetify theme variants (`surface-variant`, `primary-lighten1`) rather than introducing custom palette entries.
