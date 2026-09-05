# Initial Engineering Question Worksheet

Status: COMPLETE / PROMOTED TO CURRENT MVP DIRECTION
Purpose: Record the 20 highest-impact pre-implementation engineering questions that were resolved before Phase 1 planning.

The worksheet was completed on 2026-09-05. Each question has its own decision record under docs/planning/worksheet-answers/.

Accepted decisions have been promoted into:
- docs/project-overview.md;
- docs/architecture.md;
- docs/roadmap/initial-roadmap.md;
- relevant integration documentation.

The answer files remain historical decision records. If an answer file later conflicts with current architecture or roadmap documentation, the promoted current documentation governs unless the owner explicitly reopens the decision.

## Completed questions

1. What should the primary VidGen runtime and language be?
   - Record: worksheet-answers/01-primary-runtime-and-language.md
   - Direction: Node.js + TypeScript.

2. What should the first execution model be?
   - Record: worksheet-answers/02-first-execution-model.md
   - Direction: CLI for the MVP.

3. What durable run state is required before the first end-to-end video exists?
   - Record: worksheet-answers/03-durable-run-state.md
   - Direction: filesystem artifacts plus structured metadata.

4. What is the canonical artifact model for a VidGen run?
   - Record: worksheet-answers/04-canonical-artifact-model.md
   - Direction: durable structured artifacts for every major stage plus final video.

5. How provider-neutral should the first AI orchestration layer be?
   - Record: worksheet-answers/05-ai-provider-abstraction.md
   - Direction: Google-first MVP with strongly modular provider boundaries; Veo for video.

6. What research/enrichment is VidGen allowed to perform, and at which stage?
   - Record: worksheet-answers/06-research-and-enrichment.md
   - Direction: layered downstream research; bounded VidGen-controlled publisher retrieval; broader research only through an explicit capability.

7. Should FeedAnalysis and EditorialPlan remain separate model stages?
   - Record: worksheet-answers/07-feed-analysis-vs-editorial-plan.md
   - Direction: yes; EditorialPlan is structured JSON and production consumes it through stable contracts.

8. What structured-output and validation strategy should model-assisted stages use?
   - Record: worksheet-answers/08-structured-output-and-validation.md
   - Direction: standardized JSON schemas plus layered provider/schema/runtime/semantic validation.

9. Where, if anywhere, should human review occur in the first complete pipeline?
   - Record: worksheet-answers/09-human-review-gates.md
   - Direction: configurable gates; default development pause after Script and before expensive generation.

10. What must Script provide so ProductionPlan never has to reinvent editorial meaning?
    - Record: worksheet-answers/10-script-contract.md
    - Direction: Script is structured JSON carrying narration plus segment-level editorial semantics and provenance.

11. How template-driven should the newscast be versus fully generative?
    - Record: worksheet-answers/11-template-driven-vs-generative.md
    - Direction: template-first hybrid production.

12. What compositor/rendering technology should own final assembly?
    - Record: worksheet-answers/12-compositor-and-rendering.md
    - Direction: Remotion + FFmpeg.

13. What is the reusable newscast template model?
    - Record: worksheet-answers/13-reusable-template-model.md
    - Direction: Remotion code components plus JSON template definitions.

14. What generated-media strategy and provider fallback hierarchy should VidGen use?
    - Record: worksheet-answers/14-generated-media-strategy.md
    - Direction: Veo video -> generated still -> Remotion graphics -> template-only fallback.

15. Will the program use an anchor/presenter, and how is that presenter produced?
    - Record: worksheet-answers/15-anchor-presenter.md
    - Direction: presenter is first-class from the start; initial generation path is Veo from scripted text plus source/reference images.

16. What narration/TTS system owns spoken timing?
    - Record: worksheet-answers/16-narration-and-timing.md
    - Direction: no separate audio-first TTS authority for the MVP; presenter clips follow the Veo text + reference-image path.

17. How should deterministic graphics, captions, and audio packaging work?
    - Record: worksheet-answers/17-deterministic-graphics-and-audio.md
    - Direction: Remotion-owned deterministic design system; FFmpeg for lower-level finishing.

18. What is the asset-source priority and rights/safety policy?
    - Record: worksheet-answers/18-asset-source-priority-and-rights.md
    - Direction: explicitly permitted governed publisher media -> generated media -> approved stock/library assets -> deterministic fallback.

19. What output formats are first-class for v1?
    - Record: worksheet-answers/19-output-formats.md
    - Direction: 1920x1080 16:9 master plus 1080x1920 9:16 derived variant, H.264 MP4, 30 fps, burned captions.

20. What are the render/runtime limits and recovery guarantees?
    - Record: worksheet-answers/20-runtime-limits-and-recovery.md
    - Direction: single-run CLI, one edition at a time, durable resumability, bounded retries, reusable expensive assets, configurable spend ceiling.

## Remaining deferred decisions

Completion of this worksheet does not freeze every implementation detail.

Important deferred items include:
- exact JSON schemas and versioning;
- exact run-directory/metadata layout;
- exact Google model choices outside the current Veo direction;
- exact Veo version and presenter-continuity method;
- exact retry/backoff/spend defaults;
- exact template taxonomy and ProductionPlan schema;
- exact audio ownership for off-screen narration;
- exact codec/audio/loudness tuning;
- future service/worker/API/database/queue topology.

See docs/architecture.md and docs/roadmap/initial-roadmap.md for the current promoted direction.
