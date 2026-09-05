# Project Overview

Status: CURRENT MVP DIRECTION / EARLY-STAGE

## Purpose

VidGen turns a bounded, governed news feed into a cinematic or broadcast-style video edition.

The primary production integration is ngest. VidGen receives its own bearer credential and calls a dedicated ngest VidGen integration endpoint. That endpoint composes the same governed Distribution Profile feed semantics used by ngest's outward distribution system with Profile-associated VidGen controls.

Generic Distribution consumers, including PHP integration packages, remain unaware of VidGen-only controls.

## Core architectural law

Ngest determines which governed Articles are available in the feed.

VidGen determines what those Articles mean together and how to turn them into a program.

Administrator influence reaches VidGen through bounded controls containing intent, preferences, and constraints rather than pre-generated themes, rankings, scripts, scene prompts, or production decisions.

## Boundary with ngest

Ngest owns:
- approved-source trust;
- collection;
- normalization;
- canonical Article identity;
- provenance;
- duplicate handling;
- moderation;
- canonical outward eligibility;
- Distribution Profile selection;
- feed ordering;
- exact original publisher URLs;
- bearer-token authorization;
- Profile-associated persistence and delivery of VidGen controls.

VidGen owns:
- authenticated acquisition from the ngest VidGen endpoint;
- boundary validation and normalization;
- canonical feed and control models;
- input fingerprinting;
- bounded research/enrichment;
- feed analysis and theme discovery;
- story ranking, grouping, selection, and editorial framing;
- structured script generation;
- source traceability through generated artifacts;
- production planning;
- generated/acquired media orchestration;
- presenter generation;
- captions, graphics, branding, and audio packaging;
- assembly and rendering;
- final artifacts and run provenance.

VidGen must not reproduce ngest's Source trust, moderation, duplicate, Profile filtering, or canonical outward eligibility logic.

VidGen must not connect directly to ngest's database.

VidGen does not use the ngest Profile digest as creative input. Competition-visible editorial intelligence belongs inside VidGen.

## Current MVP technical direction

The current application direction is:
- Node.js + TypeScript;
- CLI execution;
- one edition at a time;
- filesystem-backed durable artifacts and structured metadata;
- standardized VidGen-owned JSON schemas for pipeline artifacts;
- Google-first AI/media integrations behind provider-neutral adapters;
- Veo for generated video and initial anchor/presenter generation;
- Remotion + FFmpeg for deterministic composition and media finishing.

The current production direction is template-first hybrid:
- a deterministic broadcast shell;
- reusable Remotion scene components;
- JSON template definitions exposing slots, timing constraints, safe areas, supported media, and configuration;
- generated Veo video/still media filling production slots where useful;
- deterministic Remotion motion graphics and template-only fallbacks when generation is unnecessary or fails;
- a first-class anchor/presenter generated initially through the Veo text + source/reference-image path;
- deterministic lower thirds, source labels, captions, branding, intro/outro, transitions, music placement, stingers, ducking, and responsive layout behavior.

The initial output baseline is:
- 1920x1080 16:9 master;
- 1080x1920 9:16 derived variant;
- responsive templates from the beginning;
- H.264 MP4;
- 30 fps;
- burned-in captions;
- configurable edition duration.

## Intended pipeline

A VidGen run evolves through explicit durable stages:

    ngest VidGen endpoint
            |
            v
    validate + normalize
            |
            v
      CanonicalInput
      - CanonicalFeed
      - CanonicalControl
      - inputFingerprint
      - provenance/run metadata
            |
            v
       FeedAnalysis
            |
            v
      EditorialPlan
            |
            v
          Script
            |
            v
      approval gate
       (configurable)
            |
            v
      ProductionPlan
            |
            v
    generated/acquired
          assets
            |
            v
      RenderManifest
            |
            v
   Remotion + FFmpeg
            |
            v
       final program

CanonicalInput, FeedAnalysis, EditorialPlan, Script, ProductionPlan, and RenderManifest are durable structured JSON artifacts. The final video is the terminal media artifact.

No downstream stage consumes unvalidated model output.

## Research and asset rights

VidGen may retrieve governed original publisher URLs for factual enrichment using its own bounded HTTP retrieval where practical. Broader web research requires an explicit research capability.

Research access and media reuse are separate permissions. The ability to retrieve a publisher page for factual context does not imply permission to reuse images or video found on that page.

Production asset priority is:
1. governed publisher media only when reuse is explicitly permitted;
2. generated media;
3. approved stock/library assets;
4. deterministic templates/graphics.

## Review, recovery, and cost behavior

The MVP supports configurable approval gates. During development the default pause is after Script and before expensive media generation; automatic mode remains possible.

Every completed valid stage is persisted so a failed CLI run can resume from the last reusable stage. Matching expensive provider-generated assets may be reused when their effective generation inputs match.

Identical CanonicalInput + controls must not automatically return an old completed final edition. Valid intermediate work/assets may be reused while the final composition may be regenerated.

Provider/network operations use bounded retries/timeouts and a configurable per-run spend ceiling. Exact values remain provisional.

## Production design checkpoint

The high-level production architecture is chosen, but the exact ProductionPlan schema is not.

After Phase 4, materially different Script artifacts should be generated and inspected. ProductionPlan v1 should then be derived from observed script needs while preserving the already-selected template-first, provider-neutral, Veo, Remotion, FFmpeg, presenter, and fallback architecture.

If downstream production work would need to invent script-owned semantics, the Script contract must be corrected first.

## Still intentionally open

The following remain intentionally unresolved:
- exact ngest VidGen route name;
- exact ngest persistence/table schema for controls;
- exact token/scope representation inside ngest;
- exact control v1 field set, ranges, and defaults;
- exact Node.js version and TypeScript/tooling configuration;
- exact JSON schemas and schema-versioning conventions;
- exact filesystem run-directory and metadata layout;
- exact Google model choices for analysis/planning/scripting and generated stills;
- exact Veo model/version and presenter consistency strategy;
- exact provider interface shapes and future fallback providers;
- exact retrieval extraction, caching, redirect, timeout, size, and SSRF policies;
- exact ProductionPlan schema;
- exact template registry/schema and scene taxonomy;
- off-screen narration/audio ownership outside visible presenter clips;
- exact retry counts/backoff and provider-spend defaults;
- exact codec profile/audio encoding/loudness settings;
- future worker/service/API topology;
- database/queue requirements if later workload requires them;
- publishing destinations;
- public VidGen API or UI requirements.

These should be resolved through implementation planning and evidence rather than assumed.
