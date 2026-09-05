# Question 4 — Canonical Artifact Model

## Question

What is the canonical artifact model for a VidGen run?

## Answer

Decision: Persist every major pipeline stage as a durable, inspectable structured artifact: CanonicalInput, FeedAnalysis, EditorialPlan, Script, ProductionPlan, RenderManifest, and the final video as the terminal artifact.

Confidence: High.

Why: Durable stage artifacts make the MVP observable, debuggable, and reproducible. Each transformation can be inspected independently, failures can be localized to a specific stage, and later stages can be traced back to the exact inputs and intermediate decisions that produced them. This also aligns with the filesystem-artifacts-plus-metadata run-state decision.

Deferred details: Exact schemas, serialization format, schema versioning, producer/version metadata shape, upstream artifact reference format, cache-versus-provenance distinctions, and retention policy remain open for implementation planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future artifact/run contract documentation when this decision is promoted.
