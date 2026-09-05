# Question 16 — Narration / TTS Timing

## Question

What narration/TTS system owns spoken timing?

## Answer

Decision: Do not use a separate audio-first TTS pipeline as the timing authority for the MVP. Presenter/anchor segments should follow the Veo generation path and be generated from the scripted text together with source/reference images for the intended anchor.

For anchor segments, Script should provide the spoken text and production intent, ProductionPlan should provide the relevant presenter/reference-image inputs and generation instructions, and the resulting Veo presenter clip should become the timed media asset consumed by final composition.

Remotion + FFmpeg remain responsible for assembling those generated presenter clips with B-roll, deterministic graphics, transitions, captions, music, and other program elements.

Confidence: High.

Why: The MVP already intends to use Veo and has a specific anchor concept in mind. Generating the presenter directly from text plus source/reference images keeps the first implementation within the Google/Veo production path and avoids introducing a separate TTS-to-lip-sync subsystem before it is proven necessary.

Deferred details: Exact Veo model/version, anchor reference-image requirements, continuity/identity strategy across presenter clips, pronunciation controls, dialogue fidelity validation, generated-audio handling, clip-duration constraints, retry/regeneration policy, and whether a dedicated TTS or lip-sync path is introduced later remain open for implementation planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future Script/ProductionPlan/presenter/provider contract documentation when this decision is promoted.
