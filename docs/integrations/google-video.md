# Google Video Generation Integration

Status: CURRENT PROVIDER DIRECTION / VERTEX BACKEND OWNER-APPROVED FOR PHASE 6 CORRECTION

## Purpose

VidGen is Google-first for generated video, but video-generation workflows must depend on provider-neutral contracts rather than one Google transport.

The existing Gemini Developer API Veo backend remains supported and must not be replaced or destabilized by the Vertex addition.

The owner-approved `c6-vertex-adapter` correction adds Vertex AI Veo as a parallel backend at the same provider-neutral video boundaries.

Conceptually:

    VideoGenerationClient / PresenterVideoGenerationClient
                    |
             backend selection
              /          \
             v            v
    Developer API      Vertex AI
       Veo                Veo
             \            /
              v          v
          provider-neutral result
                    |
                    v
         existing VidGen workflows

Backend selection is runtime configuration. It is not StoryInput, CanonicalControl, ClipPlan, template, model-output, or ngest state.

## Existing Developer API backend

The existing Google Veo Developer API adapter is the current working implementation.

Its behavior, authentication, request semantics, duration handling, polling, download safety, provenance, and cinematic/simple-path contracts are regression-sensitive and must remain supported.

Current authentication uses:

    GEMINI_API_KEY

Current model/runtime configuration remains owned by VidGen rather than templates or upstream controls.

The Vertex correction must not silently redirect existing Developer API configuration to Vertex.

## Vertex AI backend

Vertex AI is an alternate Google Veo transport intended to let VidGen use Google Cloud project billing/credits while preserving the same provider-neutral VidGen boundaries.

Initial direction:
- use Application Default Credentials rather than `GEMINI_API_KEY`;
- use an explicitly configured Google Cloud project;
- use an explicitly configured supported region, initially `us-central1`;
- keep the Vertex model runtime-configurable;
- prefer a Veo 3.1 model that supports the existing approved presenter-reference contract;
- treat Lite variants that do not support required presenter asset references as incompatible configuration rather than silently omitting references;
- preserve the current simple-path 8-second reference-image generation and bounded extension semantics where the selected Vertex model supports them;
- preserve cinematic generation semantics only where the selected Vertex model supports the required request.

Exact environment-variable names are implementation-planning decisions. Configuration should remain grouped by backend rather than forcing Vertex credentials into Developer API settings.

## Authentication boundary

Vertex authentication is a runtime credential concern.

Application Default Credentials and any underlying service-account or user credential material must never enter:
- StoryInput or CanonicalInput;
- prompts;
- fingerprints;
- generated-media manifests;
- headline sidecars;
- logs or public error text;
- rendered output.

The adapter should acquire credentials through supported Google Cloud authentication mechanisms rather than inventing a credential file format.

## Cloud Storage staging boundary

Vertex may use Google Cloud Storage for generated-video output staging.

That storage is provider staging, not VidGen's durable artifact store.

The Vertex adapter must:
- use an explicitly configured bucket/prefix owned for VidGen provider staging;
- treat every provider-returned URI/object name as untrusted;
- accept only objects inside the configured staging boundary;
- bound download size and time;
- validate expected media type/signature before crossing the provider-neutral result boundary;
- avoid exposing signed URLs, access tokens, bucket credentials, or absolute credential paths in durable artifacts;
- define bounded cleanup/lifecycle behavior so provider staging does not accumulate indefinitely.

Reference images should continue to originate from VidGen's existing approved local-reference boundary. Do not require publisher-image retrieval or broaden media rights to support Vertex.

## Provider-neutral behavior

Above the adapter, backend choice must be invisible to production logic.

The backend must not change:
- StoryInput or CanonicalInput;
- simple presenter-copy semantics;
- simple duration planning;
- approved reference-image validation;
- ClipPlan or AssemblyTemplate semantics;
- GeneratedMediaUnit meaning;
- FFmpeg finishing/assembly;
- output naming;
- success/failure publication semantics.

Provider-specific request shapes, authentication, polling, output retrieval, and Cloud Storage handling remain inside the adapter.

Do not create a large generalized provider framework merely because there are now two Google transports.

## Backend selection and failure semantics

Initial backend selection should be explicit.

Conceptually:

    developer
    vertex

Do not automatically fall back from Vertex to Developer API, or from Developer API to Vertex, when a generation fails.

Silent fallback would make billing, provenance, reproducibility, model behavior, and debugging ambiguous.

Failures should distinguish configuration/authentication, provider request/poll failure, unsafe output location, bounded-download failure, malformed media, unsupported model capability, and normal downstream VidGen validation failures where practical.

## Provenance

Durable provider provenance must make the effective backend distinguishable while remaining provider-neutral to consumers.

Record only safe identifiers needed to understand generation, such as provider/backend identity, configured/effective model, and bounded request/operation identity when available.

Never persist raw Vertex responses, credentials, access tokens, signed URLs, or unrestricted Cloud Storage paths.

## Qualification

Mocked deterministic tests prove orchestration and safety boundaries but do not prove live Vertex behavior.

The correction should include one explicitly observed live Vertex qualification when project access, quota, credentials, staging storage, and model availability permit it.

Live qualification should separately verify:
- authentication;
- model availability;
- presenter reference-image support;
- initial generation;
- extension behavior when exercised;
- bounded output retrieval;
- downstream FFmpeg compatibility.

Do not treat a live Developer API run as proof of Vertex behavior or vice versa.

## Non-goals

The Vertex correction does not include:
- Flow/browser automation;
- reverse-engineering private Google consumer endpoints;
- a generalized multi-provider framework;
- ngest changes;
- live multi-story fan-out;
- database/queue work;
- automated publishing;
- new creative stages;
- publisher media retrieval.
