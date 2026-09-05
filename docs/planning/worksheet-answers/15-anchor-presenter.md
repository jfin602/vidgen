# Question 15 — Anchor / Presenter

## Question

Will the program use an anchor/presenter, and how is that presenter produced?

## Answer

Decision: The newscast will include an anchor/presenter from the start, and the MVP architecture must treat anchor scenes as a first-class production requirement.

The later Question 16 decision resolves the initial production path: presenter/anchor segments should be generated through Veo using scripted text together with source/reference images for the intended anchor.

Confidence: High.

Why: An anchor is already part of the intended program concept, so presenter support needs to influence the template model, Script contract, scene planning, media-generation contracts, and composition architecture from the beginning. Deferring anchor support would risk forcing downstream redesign once presenter scenes are introduced.

Deferred details: Exact Veo model/version, reference-image requirements, anchor identity/continuity strategy across generated clips, pronunciation/dialogue controls, generated-audio handling, presenter-shot template details, retry/regeneration policy, and any future alternate presenter/lip-sync provider remain open.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future presenter/template/provider contract documentation.
