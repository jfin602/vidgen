# Initial Engineering Question Worksheet

Status: HISTORICAL / PARTIALLY SUPERSEDED
Purpose: Preserve the 20 pre-Phase-1 engineering decisions and record which were later superseded by the single-story pipeline rebase.

The worksheet was completed on 2026-09-05 before Phase 1 implementation. Each question has its original decision record under docs/planning/worksheet-answers/.

Phase 1 was then implemented and closed at 0.1.5.

Later on 2026-09-05, the owner deliberately simplified VidGen from an edition-oriented newscast engine to a template-driven single-story clip generator. The original answer files remain unchanged as historical records.

Where historical answers conflict with current docs, the current authority is:
- docs/project-overview.md;
- docs/architecture.md;
- docs/template-system.md;
- docs/roadmap/initial-roadmap.md;
- relevant current integration/control docs.

## Current supersession summary

Clearly superseded:
- Question 7: separate FeedAnalysis and EditorialPlan stages are removed.
- Question 9: the initial approval-gate workflow is removed.
- Question 10: separate Script and ProductionPlan stages are replaced by one ClipPlan.
- Question 12: Remotion + FFmpeg is replaced by FFmpeg-only MVP assembly.
- Question 13: Remotion code + JSON production templates are replaced by declarative assembly templates plus standardized media.
- Question 19: 16:9 master + 9:16 derivative is replaced by 9:16 as the initial first-class output.
- Question 20: one edition at a time is replaced by one manually selected story at a time for initial development, followed later by independent per-story fan-out.

Partially superseded or narrowed:
- Question 4: durable-artifact philosophy remains, but the number of major stage artifacts is drastically reduced.
- Question 6: publisher retrieval remains allowed but is conditional; broader research is deferred.
- Question 11: template-first production remains and is strengthened; templates now remove most production reasoning.
- Question 14: generated-media strategy is narrowed to the media required by the selected template rather than a broad fallback/composition hierarchy.
- Question 16: presenter direction remains, while the off-screen narration/voiceover mechanism is still unresolved.
- Question 17: FFmpeg finishing remains; Remotion-owned graphics/design-system assumptions are superseded.

Still materially aligned:
- Question 1: Node.js + TypeScript.
- Question 2: CLI execution for the MVP.
- Question 3: filesystem artifacts plus structured metadata.
- Question 5: Google-first with replaceable provider boundaries.
- Question 8: validated structured model output.
- Question 15: presenter/anchor is first-class.
- Question 18: asset rights and reuse boundaries remain important.

## Original completed questions

1. Primary runtime and language
   - Record: worksheet-answers/01-primary-runtime-and-language.md
   - Historical decision: Node.js + TypeScript.

2. First execution model
   - Record: worksheet-answers/02-first-execution-model.md
   - Historical decision: CLI.

3. Durable run state
   - Record: worksheet-answers/03-durable-run-state.md
   - Historical decision: filesystem artifacts plus structured metadata.

4. Canonical artifact model
   - Record: worksheet-answers/04-canonical-artifact-model.md
   - Historical decision: durable structured artifacts for every major stage plus final video.

5. AI provider abstraction
   - Record: worksheet-answers/05-ai-provider-abstraction.md
   - Historical decision: Google-first with modular provider boundaries; Veo for video.

6. Research/enrichment
   - Record: worksheet-answers/06-research-and-enrichment.md
   - Historical decision: layered downstream research with bounded publisher retrieval.

7. FeedAnalysis vs EditorialPlan
   - Record: worksheet-answers/07-feed-analysis-vs-editorial-plan.md
   - Historical decision: separate stages.
   - Current status: superseded.

8. Structured output and validation
   - Record: worksheet-answers/08-structured-output-and-validation.md
   - Historical decision: standardized JSON plus layered validation.

9. Human review gates
   - Record: worksheet-answers/09-human-review-gates.md
   - Historical decision: configurable gate after Script.
   - Current status: superseded for initial pipeline.

10. Script contract
    - Record: worksheet-answers/10-script-contract.md
    - Historical decision: structured Script feeding ProductionPlan.
    - Current status: superseded by ClipPlan.

11. Template-driven vs generative
    - Record: worksheet-answers/11-template-driven-vs-generative.md
    - Historical decision: template-first hybrid.
    - Current status: retained and simplified further.

12. Compositor/rendering
    - Record: worksheet-answers/12-compositor-and-rendering.md
    - Historical decision: Remotion + FFmpeg.
    - Current status: superseded by FFmpeg-only MVP assembly.

13. Reusable template model
    - Record: worksheet-answers/13-reusable-template-model.md
    - Historical decision: Remotion components + JSON definitions.
    - Current status: superseded by assembly-template definitions.

14. Generated-media strategy
    - Record: worksheet-answers/14-generated-media-strategy.md
    - Historical decision: broad generated-media fallback hierarchy.
    - Current status: narrowed to template-required media.

15. Anchor/presenter
    - Record: worksheet-answers/15-anchor-presenter.md
    - Historical decision: presenter first-class; Veo text + reference-image direction.
    - Current status: retained.

16. Narration/timing
    - Record: worksheet-answers/16-narration-and-timing.md
    - Historical decision: no separate audio-first authority selected.
    - Current status: off-screen voiceover mechanism remains open.

17. Deterministic graphics/audio
    - Record: worksheet-answers/17-deterministic-graphics-and-audio.md
    - Historical decision: Remotion design system + FFmpeg finishing.
    - Current status: Remotion portion superseded.

18. Asset rights
    - Record: worksheet-answers/18-asset-source-priority-and-rights.md
    - Historical decision: explicitly permitted publisher media -> generated -> approved stock/library -> deterministic fallback.
    - Current status: rights boundary retained.

19. Output formats
    - Record: worksheet-answers/19-output-formats.md
    - Historical decision: 16:9 master + 9:16 derivative.
    - Current status: superseded by initial 9:16-only target.

20. Runtime/recovery
    - Record: worksheet-answers/20-runtime-limits-and-recovery.md
    - Historical decision: one edition at a time with resumability/reuse.
    - Current status: simplified to one story at a time initially, with story-local reuse.

## Current unresolved implementation decisions

Important open items now include:
- exact StoryInput/story-production identity;
- exact story-package layout;
- exact ClipPlan schema;
- exact template JSON Schema/registry;
- actual standardized intro/outro media duration relationship to the locked logical template timing;
- exact Veo version and presenter-continuity method;
- off-screen narration/voiceover provider;
- exact FFmpeg audio/caption/encoding settings;
- retry/backoff/spend defaults;
- live ngest continuation semantics before multi-page fan-out.

See current architecture, template, and roadmap docs rather than using the historical answers as implementation requirements.
