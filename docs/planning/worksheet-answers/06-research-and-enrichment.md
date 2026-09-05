# Question 6 — Research and Enrichment

## Question

What research/enrichment is VidGen allowed to perform, and at which stage?

## Answer

Decision: Use a layered research model. CanonicalInput remains the governed ngest input. VidGen may retrieve the original publisher URLs supplied by ngest for enrichment, and broader web research is allowed only through an explicit research capability or stage. External research must remain provenance-aware and distinct from upstream canonical feed truth.

Confidence: High.

Why: VidGen needs enough context to produce accurate, useful editorial output without blurring the ownership boundary between ngest feed truth and VidGen-generated enrichment. Keeping retrieval and research as explicit downstream capabilities preserves provenance, makes failures observable, and allows the research strategy to evolve independently of the rest of the pipeline.

VidGen should prefer performing bounded HTTP retrieval of supplied publisher URLs itself when practical rather than relying on an AI provider's URL-context or browsing capability for basic page acquisition. This can reduce model/provider usage and gives VidGen direct control over timeouts, response-size limits, content-type handling, caching, provenance, and failure behavior. Retrieved content remains untrusted input and must be normalized before model-assisted stages consume it.

Deferred details: Exact HTTP client/tooling, robots/licensing policy, redirect policy, SSRF protections, allowed content types, timeout and size limits, caching behavior, article extraction strategy, broader-web research provider, factual support rules, and fallback behavior for inaccessible publisher pages remain open for implementation planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/integrations/ngest.md, docs/roadmap/initial-roadmap.md, and future research/retrieval contract documentation when this decision is promoted.
