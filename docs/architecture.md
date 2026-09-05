# Architecture Notes

Status: CURRENT DIRECTION / EARLY-STAGE

## Conceptual pipeline

    ngest VidGen integration endpoint
               |
               v
      authenticated acquisition
               |
               v
        boundary validation
               |
               v
    CanonicalFeed + CanonicalControl
               |
               v
      input identity / run context
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
        ProductionPlan
               |
               v
        provider adapters
        /      |       \
     media   voice    other
        \      |       /
               v
        composition/render
               |
               v
       artifacts + run record

This is a responsibility sketch, not a committed module tree.

## Ngest integration boundary

VidGen's production input comes from a dedicated bearer-authenticated ngest integration endpoint.

The endpoint should compose:
- the same governed Distribution Profile feed semantics used by ngest's outward feed producer; and
- Profile-associated VidGen controls.

It must not create a second implementation of Article eligibility, ordering, normalization, provenance, duplicate handling, moderation, or Profile filtering.

Generic ngest Distribution endpoints and PHP integration packages remain unchanged and do not receive VidGen-specific controls.

VidGen must not connect directly to ngest persistence or depend on ngest database schema.

See docs/integrations/ngest.md.

## Input normalization boundary

The external ngest response is transport input, not the VidGen domain model.

VidGen should validate and normalize once at the edge:

    ngest response
          |
          v
    validate/normalize
          |
          +--> CanonicalFeed
          |
          +--> CanonicalControl

Feed analysis, editorial planning, scripting, and production should not contain ngest endpoint, pagination, authentication, or persistence semantics.

Only the input boundary should need to understand supported external response/control versions.

## Control boundary

Controls represent administrator intent, preferences, and constraints. They are not pre-generated creative output.

Ngest owns control persistence, Profile association, administrator configuration, authorization, and delivery.

VidGen owns control validation at its semantic boundary, normalization, defaults, hard-constraint enforcement, preference handling, and all creative consequences.

See docs/control-interface.md.

## Creative pipeline boundary

Feed interpretation, theme discovery, story selection and grouping, editorial framing, script writing, scene/production planning, generated media, narration, and final assembly belong to VidGen.

Generated outputs must never be confused with upstream canonical feed truth.

VidGen does not consume the ngest Profile digest as pre-written creative output.

## Input identity

VidGen should derive deterministic generation identity from generation-relevant canonical input:

    CanonicalFeed
    +
    CanonicalControl
            |
            v
    deterministic canonical serialization
            |
            v
          SHA-256
            |
            v
       inputFingerprint

The bearer credential is never part of the creative fingerprint.

An ngest snapshot/revision may be retained as provenance/debugging metadata, but it must not by itself define VidGen generation identity.

## Artifact and provenance boundary

As implementation matures, a run should be explainable from:
- the canonical input and input fingerprint;
- engine/build configuration;
- canonical controls;
- provider/model configuration;
- intermediate creative artifacts;
- Article support/provenance relationships;
- provider jobs and generated assets;
- final output identity.

A useful conceptual artifact sequence is:

    01 input snapshot
    02 FeedAnalysis
    03 EditorialPlan
    04 Script
    05 ProductionPlan
    06 RenderManifest
    07 final video

Exact filenames and storage layout are not locked.

Traceability should survive creative transformation:

    generated factual segment
        -> editorial story
        -> supporting Article IDs
        -> governed Article
        -> original publisher URL

## Provider boundary

External AI, research, speech, image, video, or rendering services should be replaceable adapters where practical.

Provider-specific request/response details should not become the core domain model unless they are genuinely part of VidGen's durable operational state.

## Network/content safety

Bearer tokens, provider credentials, and other secrets must not enter generated artifacts, prompts unnecessarily, logs, or client-visible output.

Publisher URLs, redirects, page content, administrator guidance, model output, and provider responses are untrusted.

Any future retrieval subsystem should use explicit policy, redirect limits, timeouts, size limits, and SSRF-safe address validation rather than inheriting trust from a model, Article field, or control value.

Automatic article-page retrieval should initially be constrained to governed publisher URLs supplied by the input unless a separately configured research capability explicitly grants broader access.

## Production-plan checkpoint

ProductionPlan should not be frozen from assumptions.

The engine should first generate and evaluate materially different FeedAnalysis, EditorialPlan, and Script outputs. Production requirements should then be derived from observed scripts before a stable ProductionPlan v1 is designed.

This intentionally preserves room for iteration around scenes, shots, anchor use, B-roll, graphics, lower thirds, transitions, narration timing, music, captions, and provider job structure.

## Deployment shape

No VidGen deployment topology is chosen yet.

A future implementation may use a CLI worker, service, queue workers, or a combination. Do not introduce distributed infrastructure before real workload evidence requires it.
