# Architecture Notes

Status: DRAFT / PROVISIONAL

## Conceptual pipeline

    Upstream governed manifest
              |
              v
      Manifest acquisition
              |
              v
      Run / edition context
              |
              v
    Research + story shaping
              |
              v
        Script planning
              |
              v
       Scene / shot plan
              |
              v
       Provider adapters
       /      |       \
    media   voice    other
       \      |       /
              v
       Composition / render
              |
              v
      Artifacts + run record

This is a responsibility sketch, not a committed module tree.

## Important early boundaries

### Manifest boundary

The upstream manifest is an input contract. VidGen should validate and normalize it at the edge, then operate on an internal representation rather than allowing upstream transport details to leak through the full pipeline.

### Creative pipeline boundary

Story selection, theme development, script writing, scene planning, and generated media belong to VidGen.

Generated outputs should never be confused with upstream canonical feed truth.

### Provider boundary

External AI, research, speech, image, video, or rendering services should be treated as replaceable providers where practical.

Provider-specific request/response details should not become the domain model unless they are genuinely part of VidGen's durable state.

### Artifact/provenance boundary

As the implementation matures, a run should be explainable from:
- the exact input identity;
- engine/build configuration;
- operator controls;
- provider/model configuration;
- generated intermediate artifacts;
- final output identity.

The detailed run identity and retention rules are still open.

### Network/content safety

Publisher URLs, redirects, page content, manifest control text, model output, and provider responses are untrusted.

Any future retrieval subsystem should use explicit allow/deny policy, redirect limits, timeouts, size limits, and SSRF-safe address validation rather than inheriting trust from a model or manifest field.

## Deployment shape

No deployment topology is chosen yet.

A future implementation may use a CLI worker, web service, queue workers, or a combination. Do not introduce distributed infrastructure before the first real workload proves it necessary.
