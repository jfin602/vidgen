# Template System

Status: CURRENT MVP DIRECTION / INITIAL CONTRACT

## Purpose

VidGen templates remove repeated production reasoning.

A template defines the deterministic assembly skeleton for a story clip. ClipPlan supplies story-specific content for declared slots. Media generation realizes the required generated assets. FFmpeg assembles the result.

Templates are assembly contracts, not AI-generated shot lists and not Remotion components.

## Core rule

    Template
      = structure and required media slots

    ClipPlan
      = story-specific content

    Generated assets
      = realized presenter/content/audio media

    FFmpeg
      = deterministic assembly

The story model should not decide the number of segments, their basic order, or which segment type is required when the selected template already defines those decisions.

## Extensibility

Adding a new template should normally require:
- a new declarative template definition;
- any standardized media files owned by that template;
- deterministic validation/assembly support only when the existing generic assembler cannot express the new sequence.

It should not normally require changing story interpretation or adding a new model reasoning stage.

Conceptually:

    templates/
      default-news-40s.json
      breaking-news-25s.json
      explainer-60s.json

The exact registry location and JSON Schema remain Phase 2 implementation decisions.

## What a template may declare

A template may describe:
- template ID and version;
- ordered segments;
- expected or fixed segment duration;
- segment type;
- required ClipPlan content fields;
- required generated asset type;
- standardized asset references;
- whether a segment requires off-screen narration;
- basic output/normalization constraints.

Avoid provider-specific model parameters in ordinary template definitions. Provider tuning belongs to provider/runtime configuration.

## Locked default template

The default logical story structure is:

    0-05 sec
      Hook
      Presenter
      Headline treatment

    05-15 sec
      Narration
      Generated visual

    15-28 sec
      Presenter
      Supporting information

    28-40 sec
      Closing beat

This structure is the default. The model fills it rather than redesigning it.

## Standardized intro and outro

The MVP uses premade, standardized intro and outro media.

The intended assembly is conceptually:

    standardized intro
          +
    generated story media
          +
    standardized outro

The exact duration relationship between these fixed clips and the locked 0-40 logical story timing is intentionally left for Phase 2 qualification against the actual media files. The implementation should resolve that deterministically and document the resulting template version rather than asking the creative model to make the decision.

## Default generated-media expectation

The current simplification target is to generate only:
- anchor/presenter clip #1;
- the main content/B-roll clip;
- off-screen voiceover for the content clip;
- anchor/presenter clip #2 when the template requires a distinct second presenter segment.

Headline/supporting/closing treatments should use standardized or simple deterministic behavior where possible.

Do not introduce a separate generated-graphic pipeline unless real clips demonstrate that it is necessary.

## Validation

Before generation/assembly, VidGen should be able to prove:
- the selected template exists and is supported;
- the ClipPlan fills every required story-content slot;
- no undeclared production structure is being smuggled in through ClipPlan;
- required standardized assets are available;
- generated asset expectations are well-defined;
- resulting media can be normalized to the template's assembly constraints.

Exact schema and validator implementation remain provisional until Phase 2 planning.

## Story package linkage

A story package should record the template ID/version and identities of standardized assets used.

Shared template definitions and standardized intro/outro media may remain outside individual story directories; they do not need to be duplicated into every story package.

## Deferred

- advanced transitions;
- responsive multi-aspect templates;
- programmable composition framework;
- complex graphic layout systems;
- template inheritance;
- visual editors;
- runtime template marketplace/discovery;
- provider-specific template tuning.
