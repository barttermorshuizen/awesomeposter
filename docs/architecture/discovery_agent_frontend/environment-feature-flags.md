# Environment & Feature Flags
- Discovery UI respects a shared config endpoint (e.g., `/api/config/me`) that already feeds client metadata. Extend it to include `discoveryEnabled`, `discoveryClientId`, and SSE token if required.
- No new public env vars are introduced. When server-side bearer auth is enforced (similar to HITL), reuse `VITE_AGENTS_AUTH_BEARER` by scoping Nitro middleware to accept the same header.
- If future pilots require a dedicated SSE host, we can add `VITE_DISCOVERY_SSE_BASE_URL` but leave it unset by default to avoid premature config churn.
