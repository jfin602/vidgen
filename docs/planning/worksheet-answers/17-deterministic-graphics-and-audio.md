# Question 17 — Deterministic Graphics, Captions, and Audio Packaging

## Question

How should deterministic graphics, captions, and audio packaging work?

## Answer

Decision: Remotion should own deterministic presentation systems through a shared VidGen design-system/configuration layer. FFmpeg should handle lower-level media and audio finishing where it is the better fit.

Deterministic responsibilities should include:
- lower thirds;
- source labels;
- headline treatments;
- quote/stat cards;
- captions;
- logos and branding;
- intro/outro sequences;
- transitions;
- music-bed placement;
- stingers;
- audio ducking rules;
- safe areas and responsive behavior across supported aspect ratios.

These elements should be driven by reusable design tokens and structured configuration rather than generated ad hoc for each edition.

Confidence: High.

Why: A shared deterministic design system gives the program a coherent broadcast identity and makes output predictable, testable, and reusable across templates. Keeping these responsibilities in Remotion aligns with the chosen compositor stack, while FFmpeg remains appropriate for normalization, encoding, muxing, and lower-level audio/video processing.

Deferred details: Exact design-token schema, typography choices, caption engine details, transition library, music/stinger asset policy, loudness targets, ducking thresholds, responsive breakpoints, and per-aspect-ratio overrides remain open for implementation planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future design-system/rendering/audio contract documentation when this decision is promoted.
