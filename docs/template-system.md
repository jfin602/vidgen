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

Phase 2 implemented the built-in template registry, runtime validator, strict JSON Schema, and `templates/default-news-40s.json` declarative definition.

## What a template may declare

A template may describe:
- template ID and version;
- ordered segments;
- expected or fixed segment duration;
- declared ClipPlan content slots;
- small slot authoring semantics;
- required generated asset roles;
- standardized asset references;
- whether a segment requires off-screen narration;
- basic output/normalization constraints.

Phase 3 implemented the minimal generic authoring semantics required on every content slot:

    id
    usage: spoken | display
    instruction

These are the implemented field names. Core ClipPlan generation remains free of hard-coded knowledge that a particular slot ID means hook, narration, headline, or closing.

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

## ClipPlan slot filling

ClipPlan is a generic filling of the selected template's declared content slots.

Conceptually:

    StoryInput
        +
    AssemblyTemplate
        |
        v
    one model call
        |
        v
    ClipPlan slots

For default-news-40s, the slot values are expected to cover hook, headline, narration, supporting information, and closing content.

The model must not add segments, alter timing, select media types, create provider instructions, or invent a second shot/production plan.

## Standardized intro and outro

The MVP uses premade, standardized intro and outro media.

The intended assembly is conceptually:

    standardized intro
          +
    generated story media
          +
    standardized outro

Phase 2 intentionally kept intro/outro references role-only because the real standardized media files were not present. Phase 5 implemented qualification of explicit owner-supplied local intro/outro files: file identity, duration, stream/media properties, and their relationship to the locked story timing are measured rather than guessed or delegated to the creative model. The Phase 5 closeout did not have the real owner assets or ffmpeg/ffprobe runtime available, so no real-media qualification result is claimed.

## Default generated-media expectation

The current simplification target is to generate only:
- anchor/presenter clip #1;
- the main content/B-roll clip;
- off-screen voiceover for the content clip;
- anchor/presenter clip #2 when the template requires a distinct second presenter segment.

Headline/supporting/closing treatments should use standardized or simple deterministic behavior where possible.

Do not introduce a separate generated-graphic pipeline unless real clips demonstrate that it is necessary.

## Deterministic generated-role input resolution

Phase 4 derives generated media directly from filled template slots plus the template's declared segment/generated-role relationships.

The implemented rule is one GeneratedMediaUnit per segment-role reference, preserving segment order and role order. Reusing the same role ID in multiple segments therefore creates multiple timing-scoped units rather than one merged creative asset.

For the default template:

    hook / opening-anchor
      <- hook + headline
      spoken <- hook only

    content / content-video
      <- narration

    content / content-voiceover
      <- narration

    support / supporting-anchor
      <- supporting-information

    closing / supporting-anchor
      <- closing

Provider adapters translate these deterministic units into Veo/TTS requests without adding a shot-planning or second story-interpretation artifact.

## Validation

Before final assembly, VidGen should be able to prove:
- the selected template exists and is supported;
- every declared content slot has usable authoring semantics;
- the ClipPlan fills every required story-content slot exactly once;
- the ClipPlan contains no undeclared slots;
- no undeclared production structure is being smuggled in through ClipPlan;
- generated-media.json contains exactly one ready local asset for every resolved GeneratedMediaUnit;
- generated assets match their recorded hashes/identities;
- required standardized assets are available and qualified;
- all media can be normalized to the template's assembly constraints.

The strict AssemblyTemplate schema/runtime validator now includes the Phase 3 slot authoring contract. The implemented ClipPlan producer consumes that validated template directly and preserves generic non-default/non-40-second template validation.

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
