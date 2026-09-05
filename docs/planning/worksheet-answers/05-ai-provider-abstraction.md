# Question 5 — AI Provider Abstraction

## Question

How provider-neutral should the first AI orchestration layer be?

## Answer

Decision: Stay within the Google provider ecosystem for the MVP, including Veo for video generation, while keeping AI and media-provider integrations highly modularized behind explicit provider boundaries.

Confidence: High.

Why: Using one provider ecosystem initially reduces integration complexity and keeps the MVP focused, while a strong adapter boundary prevents Google-specific request/response behavior from leaking into the rest of VidGen. Upstream pipeline stages should produce provider-neutral requests or domain artifacts, and downstream stages should consume provider-neutral results, so adding or replacing providers later does not require changing unrelated pipeline behavior.

Deferred details: Exact Google model choices for analysis, planning, scripting, image generation, narration, and other stages; concrete provider interface shapes; fallback providers; provider capability negotiation; retry/error normalization; and multi-provider routing remain open for later planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future provider-adapter contract documentation when this decision is promoted.
