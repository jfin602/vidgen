# Question 8 — Structured Output and Validation

## Question

What structured-output and validation strategy should model-assisted stages use?

## Answer

Decision: All pipeline artifacts should use standardized JSON schemas. Model-assisted stages should use layered validation before their output is accepted as trusted internal data.

The validation strategy should combine:
- provider-native structured output where supported;
- VidGen-owned JSON Schema validation;
- runtime type validation;
- deterministic semantic validators;
- bounded repair/retry for malformed or incomplete model output;
- rejection when required provenance, supporting Article references, or other required semantics are missing.

No downstream stage should consume unvalidated model output directly.

Confidence: High.

Why: Standardized JSON artifacts create stable producer/consumer boundaries across the entire pipeline and make every stage inspectable, testable, serializable, and versionable. Layered validation adds defense in depth: provider-native structure reduces malformed responses, VidGen-owned schemas preserve provider independence, runtime checks protect implementation boundaries, and semantic validators enforce rules that shape validation alone cannot guarantee.

Deferred details: Exact artifact schemas, schema versioning strategy, runtime validation library, repair prompt strategy, retry counts, which semantic failures are repairable versus terminal, and human-review handling remain open for implementation planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future artifact/schema contract documentation when this decision is promoted.
