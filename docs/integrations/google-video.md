# Google Agent Platform Video Integration

Status: CURRENT PROVIDER DIRECTION / AGENT PLATFORM ONLY

## Purpose

Gemini Enterprise Agent Platform is VidGen's sole supported Google model platform.

VidGen remains Google-first but must keep text, video, and speech behind thin provider-neutral capability boundaries so the platform can be replaced later without changing StoryInput, ClipPlan, generated-media, assembly, or publication contracts.

Conceptually:

    provider-neutral capability boundary
                    |
                    v
      Gemini Enterprise Agent Platform
          /          |          \
         v           v           v
       text         video       speech
         \           |          /
          \          |         /
           v         v        v
              neutral results
                    |
                    v
             existing VidGen flows

The earlier product direction that treated Gemini Developer API and Vertex AI as parallel supported VidGen backends is historical/superseded.

## Current implementation status

At package/engine version 0.6.5, `c6-agent-platform` has removed the product-facing Developer/Vertex backend distinction while preserving the provider-neutral contracts and downstream behavior. The historical `c6-vertex-adapter` task records remain unchanged history.

## Capability-specific integration

Agent Platform is one supported platform, but its capabilities do not need to share one transport or authentication mechanism.

Keep separate boundaries for:
- structured text generation;
- presenter/content video generation;
- speech generation.

Do not build one large Google client merely because the capabilities belong to the same platform.

Each capability may own:
- its supported endpoint shape;
- authentication acquisition;
- project/location/model configuration;
- request and polling behavior;
- bounded response parsing;
- output retrieval or staging;
- capability checks;
- safe provider provenance.

These details remain runtime/integration concerns rather than StoryInput, CanonicalControl, ClipPlan, template, or model-output semantics.

## Authentication

Authentication is capability-specific runtime state.

A successful credential path for one Agent Platform capability must not be treated as proof that the same credential path is valid for another capability.

Qualification is capability-specific. No source-level implementation result is live-provider, render, or human-playback evidence.

Credentials, access tokens, service-account material, and API keys must never enter:
- StoryInput or CanonicalInput;
- prompts;
- fingerprints;
- generated-media manifests;
- headline sidecars;
- logs or public error text;
- rendered output.

Use only authentication mechanisms supported by the selected Agent Platform capability. Do not invent credential formats or silently copy credentials between capability adapters.

## Video direction

Veo remains the initial Google video model family for VidGen presenter/content generation.

The video adapter must preserve the existing provider-neutral VidGen semantics where the selected Agent Platform Veo model supports them:
- one to three approved local presenter reference images;
- portrait 9:16 generation;
- exact assigned presenter dialogue;
- bounded initial generation and extension behavior required by the simple path;
- cinematic presenter/content generation required by the preserved template path;
- bounded polling and output retrieval;
- safe operation provenance.

If a selected model or supported API path cannot satisfy a required VidGen capability, fail configuration or generation clearly rather than dropping references, changing dialogue semantics, or silently routing through a legacy backend.

## Provider-neutral behavior

Platform transport must not change:
- StoryInput or CanonicalInput;
- simple presenter-copy semantics;
- simple duration planning;
- approved reference-image validation;
- ClipPlan or AssemblyTemplate semantics;
- GeneratedMediaUnit meaning;
- FFmpeg finishing/assembly;
- output naming;
- success/failure publication semantics.

The Agent Platform adapter layer returns only the neutral media/model result required by the existing production workflow.

## Runtime configuration

Runtime configuration may include capability-specific model, project, location, credential, timeout, polling, and staging settings. Text uses `GEMINI_API_KEY`, `GOOGLE_CLOUD_PROJECT`, and `VIDGEN_TEXT_MODEL`; Veo uses ADC plus `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, and `VIDGEN_VIDEO_MODEL`; speech uses ADC plus `GOOGLE_CLOUD_PROJECT`, `VIDGEN_TTS_MODEL`, `VIDGEN_TTS_VOICE`, and `VIDGEN_TTS_LANGUAGE_CODE`.

Provider/model selections remain VidGen runtime configuration, not template or upstream control data.

## Output and staging safety

Any provider-returned URI, operation identifier, object name, or media response is untrusted.

When a capability requires remote staging or retrieval, the adapter must:
- constrain access to explicitly configured/expected provider boundaries;
- bound response and download size;
- bound request and polling time;
- reject redirects unless explicitly required and safely constrained;
- validate expected media type/signature before returning neutral media;
- avoid persisting credentials, signed URLs, unrestricted storage paths, or raw provider responses;
- define bounded cleanup/lifecycle behavior where staging objects are created.

Reference images continue to originate from VidGen's approved local-reference boundary. Agent Platform migration does not authorize publisher-media retrieval or reuse.

## Failure semantics

Do not silently fall back to legacy Developer API or Vertex backends when an Agent Platform capability fails.

Failures should distinguish, where practical:
- configuration;
- authentication/authorization;
- unsupported model capability;
- provider request or polling failure;
- unsafe or malformed provider output;
- bounded retrieval failure;
- normal downstream VidGen validation failure.

A failed provider run must not appear successful or publish incomplete artifacts.

## Provenance

Durable provider provenance should record only safe identifiers needed to reproduce and inspect generation, such as:
- Agent Platform/provider identity;
- configured/effective model;
- bounded request or operation identity when available.

Never persist credentials, access tokens, API keys, raw provider responses, signed URLs, or unrestricted provider storage paths.

## Qualification

Mocked deterministic tests prove orchestration and safety boundaries but do not prove live Agent Platform capability behavior.

Qualification must be capability-specific.

For text, the owner has observed a successful live Agent Platform API-key request.

Before claiming live Veo support, directly observe at least:
- authentication/authorization;
- selected model availability;
- presenter reference-image support;
- initial generation;
- extension behavior when exercised;
- bounded output retrieval;
- downstream FFmpeg compatibility.

A successful text call is not evidence of video behavior. A successful video call is not evidence of speech behavior.

## Implementation boundary

The correction retains provider-neutral core interfaces, simple/cinematic behavior outside Google transport adapters, durable artifact meanings, and failure honesty. Historical task files and prior commit history remain unchanged.

## Non-goals

The Agent Platform correction does not include:
- Flow/browser automation;
- reverse-engineering private Google consumer endpoints;
- a generalized multi-provider framework;
- ngest changes;
- live multi-story fan-out;
- database/queue work;
- automated publishing;
- new creative stages;
- publisher media retrieval;
- changes to FFmpeg finishing/assembly semantics.
