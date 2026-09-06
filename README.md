# VidGen

VidGen is a standalone template-driven news clip generator.

Ngest supplies a governed, pre-curated feed in which every delivered story is already intended for content production. VidGen does not rank, cluster, select, or reject those stories. Its job is to turn each supplied story into its own self-contained, postable video clip.

## Current MVP direction

The smallest current pipeline is:

    ngest-shaped story input
            |
            v
      validate/normalize
            |
            v
      story package
            |
            v
        ClipPlan
     one creative step
            |
            v
    generated media
            |
            v
      FFmpeg assembly
            |
            v
        final clip

Current standards:
- Node.js + TypeScript;
- manually invoked CLI development flow;
- one selected story at a time while the video pipeline is being qualified;
- local sample input shaped like the real ngest integration contract;
- one story = one independent artifact directory;
- one validated ClipPlan per story;
- fixed assembly templates own timing and media-slot structure;
- default template uses presenter, generated content/voiceover, presenter, and closing beats;
- standardized premade intro/outro assets;
- Google-first generated media with Veo as the initial presenter/video direction;
- FFmpeg for deterministic clip assembly and finishing;
- no Remotion in the MVP;
- 1080x1920 9:16 H.264 MP4 at 30 fps as the initial output target;
- ClipPlan planning works directly from sufficiently described ngest StoryInput; publisher retrieval is deferred as a later fallback;
- no initial approval workflow, global cache, database, queue, or distributed orchestration.

See docs/template-system.md for the assembly-template contract.

## System boundary

Ngest owns governed source trust, normalization, Article identity/provenance, duplicate/moderation behavior, Profile filtering/order, production eligibility, original publisher destinations, authentication, and delivery.

VidGen owns boundary validation, story-level production identity, ClipPlan generation, source traceability, generated media, FFmpeg assembly, and final story packages.

VidGen does not connect directly to ngest persistence.

## Current state

Phases 1 and 2 are complete and closed at versions 0.1.5 and 0.2.5. Phase 3 was manually owner-closed at version 0.3.4. Phase 4 was manually owner-closed at version 0.4.4 after its P5 review/repair pass. The repository now provides:
- the Node.js + TypeScript CLI foundation;
- secure bearer-authenticated ngest manifest acquisition;
- local ngest-shaped fixture ingress through the same transport validator;
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
- deterministic tests.

The project was simplified after Phase 1. FeedAnalysis, EditorialPlan, separate Script and ProductionPlan stages, Remotion composition, edition-level planning, and story-selection logic are no longer part of the current MVP.

The repository is on the 0.5.0 Phase 5 planning baseline. Phase 5 owns deterministic probing, qualification, normalization, trimming, audio muxing, standardized intro/outro integration, and FFmpeg assembly of the already planned/generated story package into the first complete vertical clip. Publisher retrieval and live feed fan-out remain later work.

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
