# Non-Functional Requirements
- Flag changes propagate within minutes across services (cache invalidation strategy defined).
- System must fail safe: if flag state unknown, default to disabled.
- Administrative interface requires authentication and respects least privilege.
