# Question 9 — Human Review Gates

## Question

Where, if anywhere, should human review occur in the first complete pipeline?

## Answer

Decision: Use configurable approval gates. The default MVP development flow should pause after Script and before expensive media-generation work begins. Fully automatic execution should remain possible when approval gating is disabled.

Confidence: High.

Why: A pre-generation review point provides a practical safety and cost-control boundary. Editorial or factual problems can be caught before invoking expensive video/media providers, while configurable gating preserves the ability to demonstrate a fully automated pipeline when appropriate.

Deferred details: Exact CLI interaction, which stages may independently define gates, whether approval state is persisted in run metadata, timeout behavior, non-interactive automation behavior, and whether later production deployments default to automatic or gated execution remain open.

Docs affected: docs/architecture.md, docs/workflow.md, docs/roadmap/initial-roadmap.md, and future run/execution contract documentation when this decision is promoted.
