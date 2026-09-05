# Question 14 — Generated Media Strategy and Fallback Hierarchy

## Question

What generated-media strategy and provider fallback hierarchy should VidGen use?

## Answer

Decision: Use a layered generated-media hierarchy with deterministic fallbacks.

Preferred order for the MVP:
1. Veo-generated video when a story or scene materially benefits from generated motion.
2. Generated still imagery when video is unnecessary, too expensive, unavailable, or fails.
3. Deterministic Remotion motion graphics and text treatments when generated imagery is unnecessary or unavailable.
4. Template-only fallback so a failed media-generation job does not prevent the full newscast from rendering.

All generated-media requests and results should pass through provider-neutral VidGen contracts even though Google/Veo is the initial provider implementation.

Confidence: High.

Why: Generated video should enhance the program rather than become a single point of failure. A layered fallback hierarchy keeps editions renderable when provider calls fail, time out, are rejected for quality, or are not worth the cost. Provider-neutral request/result contracts preserve the ability to add or replace providers without changing EditorialPlan, Script, ProductionPlan, or rendering semantics.

Deferred details: Exact still-image provider, Veo model/version, maximum clip duration, retry limits, timeout thresholds, quality-rejection rules, generation budget, image-to-video use, provider capability negotiation, and fallback-selection heuristics remain open for implementation planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future media-provider/fallback contract documentation when this decision is promoted.
