# Question 11 — Template-Driven vs Fully Generative Production

## Question

How template-driven should the newscast be versus fully generative?

## Answer

Decision: Use a template-first hybrid production model for the MVP.

The program should use a stable deterministic broadcast shell and reusable scene/composition templates. Generated media such as Veo clips or generated stills should fill defined media slots within that structure. Deterministic elements should include the core program structure, typography, lower thirds, headline treatments, transitions, branding, and other repeatable broadcast graphics.

AI-assisted stages may decide what content belongs in the available production slots, but they should not invent the fundamental composition system for each edition during the MVP.

Confidence: High.

Why: A template-first hybrid approach provides much stronger reliability, visual consistency, cost control, and render predictability than a fully generative program structure, while still allowing each edition to feel unique through generated story media and editorial choices. It also matches the client's acceptance of basic newscast templates and creates a clear contract between EditorialPlan/ProductionPlan and the compositor.

Deferred details: Exact scene library, template-selection rules, how much timing flexibility individual templates expose, how generated stills versus video are chosen, and how much structural variation later versions may introduce remain open for production-architecture planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future template/composition contract documentation when this decision is promoted.
