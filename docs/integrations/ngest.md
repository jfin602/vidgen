# Ngest Integration

Status: CURRENT DIRECTION / CONTRACT DETAILS PARTLY PROVISIONAL

## Purpose

VidGen interfaces directly with ngest over HTTP.

VidGen receives a dedicated bearer credential and calls a dedicated ngest VidGen integration endpoint associated with the intended Distribution Profile.

The exact route name and ngest-side token representation are not locked in this repository.

## Response composition

The VidGen endpoint should compose:

    shared governed Distribution Profile feed
    +
    Profile-associated VidGen controls
            |
            v
      VidGen integration response

The governed feed portion must reuse ngest's existing outward feed semantics rather than reimplement them specifically for VidGen.

The response supplies the generation-relevant feed/control input needed by VidGen. Ngest's generated Profile digest is not creative input to the VidGen pipeline.

## Generic consumers remain unchanged

VidGen controls are integration-specific.

Generic Distribution endpoints and PHP integration packages must not receive VidGen-only control data merely because the same Profile is also used by VidGen.

Conceptually:

    generic bearer token
            |
            v
    generic Distribution endpoint
            |
            v
      normal feed response

and separately:

    VidGen bearer token
            |
            v
    dedicated VidGen endpoint
            |
            v
      governed feed + control

The exact authorization model belongs to ngest, but generic credentials should not implicitly become VidGen credentials.

## Ownership

Ngest owns:
- bearer-token authentication and authorization;
- Distribution Profile association;
- governed Article eligibility and ordering;
- canonical outward Article semantics;
- exact original publisher destinations;
- provenance supplied by the feed;
- persistence and admin editing of Profile-associated VidGen controls;
- assembly and delivery of the dedicated VidGen response.

VidGen owns:
- secure runtime storage/use of its bearer credential;
- HTTP acquisition;
- response validation;
- normalization into CanonicalFeed and CanonicalControl;
- creative input fingerprinting;
- downstream factual enrichment/research;
- all downstream editorial/creative behavior.

## Database boundary

VidGen must not query ngest's Postgres database directly.

The ngest database/table layout is an ngest implementation detail. The dedicated HTTP integration response is the cross-project boundary.

This prevents:
- ngest migrations from silently breaking VidGen;
- ngest database credentials from being shared with VidGen;
- VidGen from depending on private ngest persistence semantics;
- duplicate feed-selection logic from forming outside ngest.

## Publisher retrieval and media rights

Ngest supplies governed Article data and exact original publisher destinations. VidGen may use those URLs as inputs to its own bounded factual-enrichment retrieval.

Where practical, basic publisher-page acquisition should be performed by VidGen's retrieval subsystem rather than delegating ordinary URL fetching to an AI provider. Retrieval must remain bounded, provenance-aware, and safe against untrusted URLs, redirects, content, and response sizes.

Permission to retrieve a publisher page for factual research is not permission to reuse media from that page.

Publisher images/video may enter production only when an explicit rights rule or upstream metadata says reuse is permitted. Otherwise VidGen must use generated media, approved stock/library assets, or deterministic template/graphic fallbacks.

Broader web research beyond governed publisher URLs requires a separately explicit research capability.

## Failure semantics

Phase 1 planning should preserve distinct failure categories where practical:
- missing/invalid VidGen runtime configuration;
- authentication/authorization failure;
- transport failure/timeout;
- malformed or unsupported response contract;
- invalid control semantics;
- deterministic normalization/fingerprinting failure.

Invalid external input must not be silently accepted or partially ignored.

## Digest boundary

VidGen must not rely on the ngest Profile digest as the editorial or script source.

The open-source VidGen engine should visibly perform:
- feed interpretation;
- enrichment/research where configured;
- theme discovery;
- story clustering and selection;
- editorial framing;
- script generation;
- production planning;
- media-generation orchestration;
- assembly.

## Security

The bearer credential is a runtime secret.

It must not be included in:
- canonical creative input;
- input fingerprints;
- generated artifacts;
- provider prompts unless explicitly required for a safe integration reason;
- logs or error payloads;
- rendered output.

Publisher content and control text remain untrusted even though the endpoint itself is authenticated.

## Deferred ngest-side details

This repository intentionally does not lock:
- the final route path;
- the ngest database/table schema;
- token storage format;
- token scope vocabulary;
- admin UI implementation;
- exact pagination/snapshot envelope.

Those must be coordinated against current ngest implementation when cross-repository work is explicitly requested.
