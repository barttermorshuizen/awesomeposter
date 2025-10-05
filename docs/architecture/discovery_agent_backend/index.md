# Discovery Agent Backend Architecture

## Table of Contents

- [Discovery Agent Backend Architecture](#table-of-contents)
  - [Context & Reuse](./context-reuse.md)
  - [Change Log](./change-log.md)
  - [High-Level Architecture](./high-level-architecture.md)
  - [Responsibilities by Layer](./responsibilities-by-layer.md)
    - [Nitro API ()](./responsibilities-by-layer.md#nitro-api)
    - [Scheduled Jobs ()](./responsibilities-by-layer.md#scheduled-jobs)
    - [Agents Server ()](./responsibilities-by-layer.md#agents-server)
  - [Data Model Additions](./data-model-additions.md)
    - [Configuration Schema & Storage](./data-model-additions.md#configuration-schema-storage)
  - [API Contracts & Services](./api-contracts-services.md)
  - [Jobs, Scheduling, and Throughput](./jobs-scheduling-and-throughput.md)
    - [Ingestion Pipeline](./jobs-scheduling-and-throughput.md#ingestion-pipeline)
  - [Observability & Logging](./observability-logging.md)
  - [Configuration Discovery API](./configuration-discovery-api.md)
  - [Security & Compliance](./security-compliance.md)
  - [Testing Strategy](./testing-strategy.md)
  - [Decisions & Follow-ups](./decisions-follow-ups.md)
