# Question 15 — Anchor / Presenter

## Question

Will the program use an anchor/presenter, and how is that presenter produced?

## Answer

Decision: The newscast will include an anchor/presenter from the start, and the MVP architecture must be designed with anchor scenes as a first-class production requirement rather than treating them as a later optional enhancement.

Confidence: High.

Why: An anchor is already part of the intended program concept, so presenter support needs to influence the template model, script structure, narration timing, scene planning, and composition contracts from the beginning. Deferring anchor support would risk forcing downstream redesign once presenter scenes are introduced.

Deferred details: The exact anchor-production method remains open. This includes whether the anchor is generated video, an avatar/lip-sync system, deterministic footage, another provider-backed approach, or a hybrid. Exact consistency requirements, lip-sync workflow, presenter-shot templates, and provider choice also remain open for production planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future presenter/template/provider contract documentation when this decision is promoted.
