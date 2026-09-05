# Question 20 — Render / Runtime Limits and Recovery Guarantees

## Question

What are the render/runtime limits and recovery guarantees?

## Answer

Decision: Use a simple, observable single-run operational model for the MVP.

Initial operational envelope:
- VidGen runs as a CLI process;
- one edition is processed at a time;
- ordinary CPU-host assumptions are acceptable for orchestration, Remotion, and FFmpeg, while provider-side infrastructure handles Veo generation;
- every completed pipeline artifact is persisted so a failed run can resume from the last valid completed stage;
- successful expensive provider-generated assets may be reused when their effective generation inputs match;
- provider retries must be bounded;
- provider spend should be constrained by a configurable per-run ceiling;
- identical CanonicalInput + controls should not automatically return a previously completed final edition; validated intermediate work and expensive generated assets may be reused, while the final composition/render may still be regenerated;
- no hard edition-wide wall-clock deadline is required initially, but individual provider/network operations must be bounded, observable, and fail explicitly.

Confidence: High.

Why: The MVP should favor debuggability, cost control, and safe recovery over premature concurrency or distributed execution. Persisting stage artifacts allows interrupted runs to resume without repeating valid work, while reuse of expensive provider assets reduces unnecessary generation cost. Keeping final rendering distinct from cached intermediate work preserves flexibility when compositor logic, branding, captions, or output settings change.

Deferred details: Exact retry counts and backoff policy, input-fingerprint algorithm, asset cache-key rules, spend-ceiling defaults, cache invalidation, partial-stage recovery semantics, render timeouts, provider-job resume behavior, later concurrency limits, and any future multi-worker execution model remain open for implementation planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/workflow.md, docs/roadmap/initial-roadmap.md, and future run-state/recovery/provider contract documentation when this decision is promoted.
