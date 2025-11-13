# 15.12 Facet Widget Surfaces

Human-facing flex tasks render input/output facets through a shared widget pipeline so designers and engineers can add new surfaces without duplicating view logic.

## Input Widgets

- `FlexTaskPanel` resolves the list of input facets per task and renders each one inside a single expansion panel container. This keeps the layout identical for generic JSON payloads and bespoke widgets.
- Custom widgets (e.g., `CompanyInformationWidget`, `PostVisualInputGallery`) receive the same props as fallback widgets: `definition`, `schema`, `modelValue`, and the full task context. They are responsible for showing their own structured UI but must avoid injecting extra collapsible shells—the parent panel already provides the expand/collapse affordance.
- Fallback facets (no custom widget) show a prettified JSON block inside the same container so operators can still view raw payloads.
- Feedback chips in the panel title surface per-facet comment counts; the inline composer control sits inside the panel body to keep interactions contextual.

## Output Widgets

- Output facets reuse the same registry (`src/components/flex-tasks/widgets/registry.ts`) but render in the submission section of the panel. Widgets receive model updates through `v-model` so their changes propagate into the draft payload map.
- Default/fallback output facets render the `DefaultFacetWidget` which is a JSON editor wrapped in the same expansion panel scaffolding as custom widgets.

## Widget Registry & Decorators

- `registerFacetWidget(facetName, component, direction)` stores the Vue component (`Component` marked raw) keyed by facet name + direction. Input widgets use the `.input` namespace; output widgets use `.output`.
- Decorators (e.g., `feedback.inline`) register through `registerInputFacetDecorator`. Decorators subscribe to specific facets (like `feedback`) and are injected automatically based on the task’s declared facets.
- The inline feedback decorator wraps any input facet panel with:
  - A badge placed inside the panel header (`<template #actions>`).
  - A contextual composer below the widget content (button, severity toggle, comment list).
  - Author-aware deletion: only the current operator can remove their entries; entries store their source index so removals map back into the draft array.
  - Resolve/undo icon controls with tooltips so operators can flip the `resolution` field in-place. These controls emit the same decorator events as the composer, ensuring addressed items persist through the Ajv validator and telemetry snapshots.

## Guidelines for New Widgets

1. **Keep layout lean** – rely on the parent expansion panel for structure. Avoid embedding additional `v-expansion-panels` unless the facet explicitly represents a hierarchical payload.
2. **Respect read-only state** – the parent will pass `readonly` when a task is locked; widgets must disable editing accordingly.
3. **Surface metadata** – show relevant descriptions/tooltips at the top of the panel body using the provided `definition.title`/`definition.description`.
4. **Emit changes once** – use `@update:model-value` to send normalized data structures back to `FlexTaskPanel`. The panel handles pointer mapping and submission.
5. **Leverage decorators** – if a facet supports inline actions (feedback, validation, assets, etc.), register them through the decorator API so they can be attached declaratively without modifying every widget.

Refer to `src/components/flex-tasks/widgets/` for canonical widget implementations and `FlexTaskPanel.vue` for the shared panel scaffolding. This document should be updated whenever the widget contract changes so future contributors understand how to hook into the system.*** End Patch*** End Patch
