# VidGen

VidGen is a standalone news video generation engine.

Ngest supplies a governed, pre-curated feed in which every delivered story is already intended for content production. VidGen does not rank, cluster, select, or reject those stories. Its job is to turn each supplied story into its own self-contained, postable video clip.

## Current MVP direction

VidGen now has two production paths sharing the same governed input and StoryInput boundary:

    ngest-shaped story input
            |
            v
      validate/normalize
            |
            v
        StoryInput
         /     \
        /       \
       v         v
 simple path   cinematic path
   CURRENT       PRESERVED
  PRIORITY
       |         |
       v         v
 presenter     AssemblyTemplate
 copy/video      + ClipPlan
       |         |
       v         v
 lower third   generated media
       |         |
       v         v
 MP4 + JSON    FFmpeg assembly

Current simple-path direction:
- manually invoked CLI development flow, one selected story at a time;
- one presenter and one continuous presenter clip;
- headline and source display name rendered deterministically in the lower third;
- configurable `maxSeconds` from 4 through 20 seconds inclusive;
- `maxSeconds` is a hard ceiling, not a target duration;
- the engine should prefer the shortest useful provider-supported duration that does not exceed the ceiling;
- final output is a postable vertical MP4 paired with article/provenance metadata JSON;
- 1080x1920 9:16 H.264 MP4 at 30 fps remains the initial output target;
- no B-roll, separate voiceover, intro/outro, ClipPlan, AssemblyTemplate, cinematic GeneratedMediaUnit resolution, or cinematic AssemblyPlan is required by the simple path;
- Google-first presenter generation remains behind thin provider-neutral boundaries; the existing Developer API Veo backend is preserved, and the owner-approved `c6-vertex-adapter` correction adds Vertex AI Veo as a parallel backend;
- FFmpeg/FFprobe remain the deterministic finishing and qualification tools.

The implemented cinematic `story -> plan -> media -> assemble` pipeline remains supported and must not regress. See docs/template-system.md for that preserved assembly-template contract.

## System boundary

Ngest owns governed source trust, normalization, Article identity/provenance, duplicate/moderation behavior, Profile filtering/order, production eligibility, original publisher destinations, authentication, and delivery.

VidGen owns boundary validation, story-level production identity, simple presenter-headline generation, cinematic ClipPlan generation, source traceability, generated media, deterministic FFmpeg finishing/assembly, and final artifacts.

VidGen does not connect directly to ngest persistence.

## Current state

Phases 1 and 2 are complete and closed at versions 0.1.5 and 0.2.5. Phase 3 was manually owner-closed at version 0.3.4. Phase 4 was manually owner-closed at version 0.4.4. Phase 5 was manually owner-closed at version 0.5.3 after its closeout review/repair. The repository now provides:
- the Node.js + TypeScript CLI foundation;
- secure bearer-authenticated ngest acquisition at the input boundary;
- local VidGen-shaped fixture ingress through the same post-adapter validation/normalization path;
- CanonicalFeed, CanonicalControl, CanonicalInput, and explicit StoryInput;
- deterministic input and story fingerprinting;
- a validated declarative default-news-40s assembly template with template-owned slot authoring semantics;
- a strict provider-neutral ClipPlan contract and template-derived structured-output schema;
- a Google Gemini structured-text adapter with runtime model configuration;
- a manual `vidgen story` workflow that creates an independent story workspace;
- a manual `vidgen plan` workflow that performs one normal-path model call and persists validated `clip-plan.json` plus safe planning metadata;
- deterministic per-segment generated-media units derived from AssemblyTemplate + validated ClipPlan;
- provider-neutral video/speech generation contracts with Google Veo and Gemini TTS adapters;
- a manual `vidgen media` workflow that consumes an existing planned story workspace and writes raw story-local presenter/video/voiceover assets;
- story-local reuse keyed by effective generation input plus current asset hash/size validation;
- resumable `media-run.json` and strict provider-neutral `generated-media.json` handoff metadata;
- filesystem-backed run/story/planning/media metadata with atomic persistence;
- strict local generated/standardized media qualification through bounded FFprobe;
- deterministic AssemblyPlan creation and a no-shell FFmpeg renderer;
- a manual `vidgen assemble` workflow with `assembly-run.json`, strict `final-clip.json`, post-render validation, and atomic `final/clip.mp4` publication;
- deterministic tests.

The project was simplified after Phase 1. FeedAnalysis, EditorialPlan, separate Script and ProductionPlan stages, Remotion composition, edition-level planning, and story-selection logic are no longer part of the current MVP.

The repository package baseline is 0.6.5. Phase 5's deterministic assembly path is implemented. The original Phase 5 closeout host lacked ffmpeg/ffprobe and owner-supplied real media, so that closeout did not establish a real render. Since then, the deployment VPS has directly qualified FFmpeg 6.1.1, FFprobe 6.1.1, libx264, AAC, and the required assembly filters. `c5-optional-assets` is closed: intro and outro are independently optional, omitted wrappers contribute no placeholder media, duration, identity, or provenance, and supplied wrappers remain fully qualified. A complete owner-media generated story render and human playback review are still unclaimed. `c5-config-fix` remains owner-approved but is deferred. Phase 6 simple presenter-headline implementation has reached the 0.6.5 baseline while preserving the completed cinematic pipeline. The owner-approved `c6-vertex-adapter` correction adds Vertex AI Veo as a parallel backend without replacing the existing Developer API backend. Live story fan-out and operational hardening remain Phase 7. The future dedicated ngest VidGen feed-plus-controls endpoint remains the intended production boundary.

## Start here

Read BOOT.md first.

Documentation:
- docs/README.md
- docs/project-overview.md
- docs/architecture.md
- docs/template-system.md
- docs/integrations/ngest.md
- docs/control-interface.md
- docs/roadmap/initial-roadmap.md
- docs/planning/initial-engineering-question-worksheet.md

## Runner commands

Validate a stack:

    npm run codex:phase:validate -- <task-folder>

Run implementation prompts:

    npm run codex:phase -- <task-folder>

Run implementation plus closeout execution:

    npm run codex:phase -- <task-folder> --closeout

Run tests:

    npm test

Create a committed documentation snapshot:

    npm run docs:snapshot
