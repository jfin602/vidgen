# Question 18 — Asset-Source Priority and Rights / Safety

## Question

What is the asset-source priority and rights/safety policy?

## Answer

Decision: Use a rights-aware asset hierarchy for the MVP:
1. Governed publisher media only when its use is explicitly permitted by upstream metadata or another accepted rights rule.
2. Generated media.
3. Approved stock/library assets.
4. Deterministic templates and graphics as the guaranteed fallback.

VidGen must not assume that media found on a publisher page is reusable merely because it is publicly accessible. Remote publisher images or video should only enter production when VidGen has an explicit basis for using them.

Confidence: High.

Why: The production pipeline needs a dependable visual-source hierarchy that does not silently create licensing or attribution problems. Generated media and deterministic templates provide safe fallback paths when publisher assets are unavailable, unclear, or unsuitable, while preserving the option to use governed source media when rights are explicit.

Deferred details: Exact rights metadata shape, attribution requirements, stock/library providers, remote-download rules, caching, content-safety validation, unusable-media rejection criteria, and future acquisition-provider policies remain open for implementation planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/integrations/ngest.md, docs/roadmap/initial-roadmap.md, and future media-rights/asset contract documentation when this decision is promoted.
