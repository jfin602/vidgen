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
- publisher-page retrieval only when story context actually requires it;
- no initial approval workflow, global cache, database, queue, or distributed orchestration.

See docs/template-system.md for the assembly-template contract.

## System boundary

Ngest owns governed source trust, normalization, Article identity/provenance, duplicate/moderation behavior, Profile filtering/order, production eligibility, original publisher destinations, authentication, and delivery.

VidGen owns boundary validation, story-level production identity, optional bounded context preparation, ClipPlan generation, source traceability, generated media, FFmpeg assembly, and final story packages.

VidGen does not connect directly to ngest persistence.

## Current state

Phase 1 is complete and closed at version 0.1.5. It already provides:
- the Node.js + TypeScript CLI foundation;
- secure bearer-authenticated ngest manifest acquisition;
- transport validation;
- CanonicalFeed, CanonicalControl, and CanonicalInput;
- deterministic SHA-256 input fingerprinting;
- filesystem-backed run metadata and atomic CanonicalInput persistence;
- deterministic tests.

The project was simplified after Phase 1. FeedAnalysis, EditorialPlan, separate Script and ProductionPlan stages, Remotion composition, edition-level planning, and story-selection logic are no longer part of the current MVP.

The repository remains on the 0.2.0 Phase 2 planning baseline.

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
