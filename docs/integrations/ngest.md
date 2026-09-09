# Ngest Integration

Status: CURRENT DIRECTION / TRANSITIONAL LIVE DEVELOPMENT PATH APPROVED / FUTURE DEDICATED CONTRACT PARTLY PROVISIONAL

## Purpose

VidGen consumes governed ngest Profile output without taking ownership of Source trust, candidate eligibility, moderation, duplicate handling, Profile filtering, ordering, or publisher destinations.

Every Article supplied through the governed Profile feed is a valid production candidate. The VidGen generation engine does not perform another story-worthiness, ranking, clustering, or selection pass. Phase 7's separate Worker may decide whether a newly discovered candidate is admitted to automatic generation based on bounded Web Momentum and cost policy.

The intended production architecture remains a dedicated authenticated VidGen integration response carrying:

    governed Distribution Profile feed
              +
    Profile-associated VidGen controls
              |
              v
      dedicated VidGen response

The owner-approved but currently deferred `c5-config-fix` correction would introduce a transitional live-development transport using ngest's already-implemented Distribution v1 Profile endpoint until the dedicated feed-plus-controls endpoint is available.

## Transitional Distribution v1 development path

When the deferred correction is resumed, its approved runtime configuration is:

    NGEST_BASE_URL
    NGEST_PROFILE_KEY
    NGEST_BEARER_TOKEN
    NGEST_TIMEOUT_MS      # optional

The request shape is:

    GET {NGEST_BASE_URL}/api/v1/distribution/{encoded NGEST_PROFILE_KEY}
    Accept: application/json
    Authorization: Bearer <NGEST_BEARER_TOKEN>

This path is transitional and must remain isolated behind the ngest input adapter. It does not redefine the long-term ngest/VidGen contract.

The adapter is responsible for validating the Distribution v1 transport, requiring the returned `profile.configKey` to match the configured Profile, traversing the documented bounded `?cursor=` continuation contract coherently, and adapting the complete governed snapshot into VidGen's existing post-adapter input shape.

Conceptually:

    ngest Distribution v1
          |
          v
    transport validation
          |
          v
    bounded cursor traversal
          |
          v
    Distribution -> VidGen adapter
          |
          v
    NgestVidGenManifestPage
          |
          v
      CanonicalInput

The transitional adapter:
- preserves canonical Article order and exact stored `originalUrl`;
- maps Distribution `items` to VidGen `articles`;
- maps structured ngest categories to the existing VidGen category-string representation using display names in source order;
- discards Distribution-only `digest` and `generatedAt` state;
- preserves transport API/snapshot provenance;
- supplies VidGen-owned neutral controls:

      {
        "version": "1",
        "editorial": {},
        "script": {},
        "production": {}
      }

The ngest Profile digest is not creative input to VidGen.

## Intended future dedicated integration

The intended production boundary remains separate from permanent Distribution v1.

Conceptually:

    generic Distribution credential
          ->
    /api/v1/distribution/{profile}
          ->
    normal Distribution response

and separately:

    Profile-bound VidGen credential
          ->
    dedicated VidGen endpoint
          ->
    governed feed + Profile-associated VidGen controls

Generic Distribution endpoints and PHP integration packages must not gain VidGen-only controls merely because a Profile is also used by VidGen.

The transitional Distribution-v1 adapter does not weaken this separation. It exists so the current VidGen engine can qualify live governed feed input before the dedicated endpoint is implemented and deployed.

## Production-candidate contract

Ngest owns the decision that an Article appears in the governed Profile feed.

For the current product:
- every supplied Article is a valid governed production candidate;
- ngest remains authoritative for source trust, moderation, duplicate behavior, Profile filtering, and outward Article eligibility;
- the VidGen generation engine must not add a second editorial or source-validity filter;
- the Phase 7 Worker may independently decline automatic generation based on bounded Web Momentum and cost policy;
- Worker admission is an automation/spend decision, not a statement that the ngest Article is invalid or unworthy;
- an operator may still submit a governed story directly to VidGen regardless of a prior Worker skip;
- VidGen may fail an admitted production for technical, validation, safety, or grounding reasons without redefining ngest eligibility.

Feed ordering remains upstream provenance and may also serve as deterministic discovery/execution order. It is not a VidGen ranking exercise.

## Ownership

Ngest owns:
- bearer authentication/authorization for its machine endpoints;
- Distribution Profile association;
- governed Article eligibility;
- canonical outward Article semantics;
- feed ordering;
- canonical Article identity/provenance;
- duplicate/moderation behavior;
- exact original publisher destinations;
- persistence/admin editing of future Profile-associated VidGen controls;
- eventual assembly/delivery of the dedicated VidGen response.

The VidGen Worker owns:
- polling cadence and first-start baseline state;
- new-Article discovery from the governed feed;
- bounded Parallel Web Momentum evaluation and automatic-production admission;
- durable orchestration/retry state;
- CLI invocation of VidGen and VidGen Poster.

VidGen owns:
- secure runtime storage/use of its ngest credential;
- HTTP acquisition;
- transport-specific response validation/adaptation;
- neutral control defaults on the transitional Distribution-v1 path;
- CanonicalFeed/CanonicalControl/CanonicalInput normalization;
- generation identity;
- per-story production identity/package lifecycle;
- ClipPlan generation;
- media-generation orchestration;
- FFmpeg assembly;
- final story artifacts.

## Manual development fixture

The video pipeline must remain debuggable without requiring a live ngest call for every run.

The local fixture uses VidGen's validated post-adapter input shape. It is not required to reproduce the upstream Distribution v1 envelope.

Conceptually:

    live Distribution v1
          |
          v
       adapter
          |
          +--------------------+
                               |
    local VidGen-shaped fixture+
                               |
                               v
              validateNgestVidGenManifestPage()
                               |
                               v
                         CanonicalInput

The local fixture is not permission to invent a second creative schema.

The owner-approved `c5-config-fix` sample helper is intended to accept one publisher Article URL, find exactly one governed Article through the live adapter, and materialize a validated one-Article fixture under ignored runtime artifacts. That helper performs no publisher retrieval, provider call, media generation, or rendering.

Phase 7 Worker orchestration must reuse the same canonical/StoryInput boundary for admitted stories rather than inventing a new ngest-specific creative contract. Parallel Web Momentum evidence remains outside that creative boundary.

## Database boundary

VidGen must not query ngest Postgres directly or depend on ngest persistence schema.

HTTP machine interfaces are the cross-project boundary. Distribution v1 is the approved transitional development transport; the dedicated VidGen endpoint remains the intended production feed-plus-controls boundary.

## Publisher retrieval and media rights

Ngest supplies the original publisher destination for each story.

Publisher retrieval is not part of the implemented ClipPlan/media-generation path or current assembly path. The manually debugged pipeline uses a story whose normalized ngest headline and summary are sufficient for a grounded ClipPlan. If the summary is absent, ClipPlan planning fails clearly before provider activity rather than silently retrieving or inventing missing facts.

Publisher-page retrieval may be added later as an explicit fallback capability before live production requires support for insufficient upstream context. Any such implementation must be bounded, provenance-aware, and safe against untrusted URLs, redirects, response sizes, and content types.

Broader web research for creative generation remains deferred. Phase 7's bounded Parallel Search is permitted only as Worker-level Web Momentum evidence and does not enrich StoryInput or model prompts.

Permission to retrieve a publisher page for factual context is not permission to reuse media from the page. Publisher media may enter production only when reuse is explicitly permitted.

## Failure semantics

Keep distinct failures where practical:
- missing/invalid runtime configuration;
- authentication/authorization failure;
- transport failure/timeout;
- malformed/unsupported Distribution response;
- configured/returned Profile mismatch;
- continuation/snapshot inconsistency;
- invalid post-adapter VidGen input;
- invalid control semantics;
- canonical normalization/fingerprinting failure.

Invalid external input must not be silently accepted.

## Continuation

The original Phase 1 client fails closed on non-null continuation because it was written before the upstream request grammar was qualified.

For the owner-approved `c5-config-fix` path, the ngest Distribution v1 continuation grammar is now known:

    GET /api/v1/distribution/{profile}?cursor=<opaque-cursor>

The correction may therefore acquire one coherent complete governed feed snapshot by bounded cursor traversal. It must preserve page/article order, require stable Profile/Publication/snapshot identity, reject loops or unsafe bounds, and fail closed on drift.

This resolves transport acquisition semantics only. Phase 7 now owns Worker polling, candidate discovery, Web Momentum admission, per-story isolation, retries/resume, idempotency, operational limits, generation invocation, and publishing orchestration. Phase 6 remains the implemented simple presenter-headline clip path.

## Security

The bearer credential is a runtime secret.

It must not appear in:
- canonical creative input;
- fingerprints;
- local sample fixtures;
- story artifacts;
- provider prompts;
- logs/error payloads;
- rendered output.

Publisher content and future administrator control text remain untrusted even though the integration is authenticated.

## Deferred ngest-side details

This repository does not lock:
- final dedicated VidGen route implementation/deployment details;
- ngest database/table schema;
- token storage representation;
- dedicated VidGen token lifecycle details;
- admin UI implementation for future VidGen controls.

Those require explicit cross-repository coordination when needed.
