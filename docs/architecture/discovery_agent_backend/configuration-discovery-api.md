# Configuration Discovery API
- **Route handler**: `server/api/discovery/config-suggestions.post.ts` wires auth middleware, request validation, the configuration discovery service, and response shaping. Errors surface via the standard `{ error: { code, message, details } }` contract already used in admin endpoints.
- **Heuristics**: a pluggable selector engine inspects DOM structure (list containers, repeated anchors/headings) and scores candidates. Conflicting candidates return as an array of suggestions ordered by confidence, enabling UI selection.
- **Caching & timeouts**: requests enforce a tight timeout (default 8 seconds) and reuse Nitro’s fetch cache for repeat URLs within a short TTL to avoid hammering upstream sites. Results are never persisted; the endpoint is advisory only.
- **Consumers**: UI workflows fetch suggestions, show operator warnings, and let users copy the `webList` block directly into source configuration forms.
