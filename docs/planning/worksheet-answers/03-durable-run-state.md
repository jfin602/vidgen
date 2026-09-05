# Question 3 — Durable Run State

## Question

What durable run state is required before the first end-to-end video exists?

## Answer

Decision: Filesystem artifacts plus metadata for the MVP.

Confidence: High.

Why: The MVP should keep each run observable and inspectable without introducing database-backed job state prematurely. Durable filesystem artifacts and structured metadata provide enough visibility into pipeline progress, intermediate outputs, provenance, and failures while preserving a simple local/CLI execution model.

Deferred details: Exact run-directory layout, metadata schema, resume semantics, provider-job polling persistence, idempotency rules, cache behavior, and whether a database is later required for multi-worker or service operation remain open.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future run/artifact contract documentation when this decision is promoted.
