# Ngest Integration

Status: CURRENT DIRECTION / CONTRACT DETAILS PARTLY PROVISIONAL

## Purpose

VidGen interfaces with ngest over a dedicated authenticated integration boundary.

Ngest supplies a governed, pre-curated feed plus Profile-associated VidGen controls.

Every story supplied through this integration is already intended for content production. VidGen does not perform another story-worthiness, ranking, clustering, or selection pass.

## Response composition

Conceptually:

    governed Distribution Profile feed
              +
    Profile-associated VidGen controls
              |
              v
      VidGen integration response

The feed portion must reuse ngest's existing outward Article semantics rather than create VidGen-specific copies of eligibility, ordering, normalization, moderation, duplicate handling, or provenance logic.

Ngest's generated Profile digest is not creative input to VidGen.

## Generic consumers remain unchanged

VidGen controls are integration-specific.

Generic Distribution endpoints and PHP integration packages must not receive VidGen-only controls merely because the same Profile is also used by VidGen.

Conceptually:

    generic credential
          ->
    normal Distribution endpoint
          ->
    normal feed response

and separately:

    VidGen credential
          ->
    dedicated VidGen endpoint
          ->
    governed feed + VidGen controls

## Production-eligibility contract

Ngest owns the decision that a story appears in the VidGen feed.

For the current product:
- every supplied Article is production-worthy;
- every supplied Article is intended to enter its own story-production pipeline;
- VidGen must not add a second eligibility filter;
- VidGen may fail a production for technical, validation, safety, or grounding reasons, but that is not editorial re-selection.

Feed ordering may remain useful as upstream provenance or later execution order, but it is not a VidGen ranking exercise.

## Ownership

Ngest owns:
- bearer authentication/authorization;
- Distribution Profile association;
- governed Article eligibility;
- canonical outward Article semantics;
- feed ordering;
- canonical Article identity/provenance;
- duplicate/moderation behavior;
- exact original publisher destinations;
- persistence/admin editing of Profile-associated VidGen controls;
- assembly/delivery of the dedicated VidGen response.

VidGen owns:
- secure runtime storage/use of its bearer credential;
- HTTP acquisition;
- response validation;
- CanonicalFeed/CanonicalControl/CanonicalInput normalization;
- generation identity;
- per-story production identity/package lifecycle;
- conditional downstream factual context preparation;
- ClipPlan generation;
- media-generation orchestration;
- FFmpeg assembly;
- final story artifacts.

## Manual development fixture

The initial video pipeline is intentionally debugged without requiring a live ngest call for every run.

A manually selected sample story should be packaged in the same external shape that the ngest VidGen integration would return and should pass through the same validation/normalization boundary.

Conceptually:

    local ngest-shaped fixture ----+
                                   |
                                   v
                           common validation
                                   |
    live ngest response -----------+
                                   |
                                   v
                             CanonicalInput

The local fixture is not permission to invent a second schema.

Once the single-story video pipeline is qualified, live ngest feed fan-out should reuse the same downstream story pipeline.

## Database boundary

VidGen must not query ngest Postgres directly or depend on ngest persistence schema.

The dedicated HTTP integration response is the cross-project boundary.

## Publisher retrieval and media rights

Ngest supplies the original publisher destination for each story.

VidGen may conditionally retrieve that governed publisher page when the supplied headline/summary/metadata are insufficient for a grounded ClipPlan.

Retrieval must remain bounded, provenance-aware, and safe against untrusted URLs, redirects, response sizes, and content types.

Broader web research is deferred.

Permission to retrieve a publisher page for factual context is not permission to reuse media from the page.

Publisher media may enter production only when reuse is explicitly permitted.

## Failure semantics

Keep distinct failures where practical:
- missing/invalid runtime configuration;
- authentication/authorization failure;
- transport failure/timeout;
- malformed/unsupported response contract;
- invalid control semantics;
- canonical normalization/fingerprinting failure;
- unsupported continuation.

Invalid external input must not be silently accepted.

## Continuation

Phase 1 currently fails closed when ngest returns a non-null nextCursor because exact continuation request semantics have not been qualified in this repository.

That does not block manual single-story video development.

Live multi-page production fan-out must not invent continuation semantics; the upstream contract must be explicitly resolved first.

## Security

The bearer credential is a runtime secret.

It must not appear in:
- canonical creative input;
- fingerprints;
- story artifacts;
- provider prompts unless explicitly required for a safe integration reason;
- logs/error payloads;
- rendered output.

Publisher content and control text remain untrusted even though the integration is authenticated.

## Deferred ngest-side details

This repository does not lock:
- final route path;
- ngest database/table schema;
- token storage format;
- token scope vocabulary;
- admin UI implementation;
- exact pagination/snapshot envelope.

Those require explicit cross-repository coordination when needed.
