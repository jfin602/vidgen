# VidGen Control Interface

Status: CURRENT DIRECTION / FIELD SET PROVISIONAL

## Purpose

The control interface lets an administrator influence what VidGen creates without moving VidGen's editorial or creative intelligence into ngest.

Controls carry intent, preferences, and constraints.

They do not carry derived creative output.

## Delivery model

Ngest persists Profile-associated VidGen controls and delivers them only through the dedicated authenticated VidGen integration endpoint.

Generic Distribution/PHP integration responses remain unaware of VidGen controls.

Conceptually:

    ngest Admin
        |
        v
    Profile-associated VidGen controls
        |
        v
    ngest persistence
        |
        v
    dedicated VidGen integration endpoint
        |
        v
    VidGen CanonicalControl

The exact ngest storage/table schema is not part of the VidGen contract.

## Ownership

Ngest owns:
- persistence;
- Profile association;
- administrator editing;
- authorization;
- transport-level contract delivery.

VidGen owns:
- semantic validation;
- version support;
- normalization;
- defaults;
- hard-constraint enforcement;
- preference interpretation;
- editorial consequences;
- script consequences;
- production consequences.

Ngest should not need to understand how a setting such as tone or target duration changes internal model reasoning.

## Stage-aware categories

The planned control shape is grouped by the stage it influences:

    control
    |
    +-- version
    |
    +-- editorial
    |
    +-- script
    |
    +-- production

The exact v1 field set remains provisional.

### Editorial candidates

Possible controls include:
- targetStoryCount;
- maximumStoryCount;
- mustIncludeArticleIds;
- excludeArticleIds;
- focusGuidance;
- audience.

Editorial controls influence what VidGen chooses to make from supplied governed Articles. They do not alter upstream feed truth.

### Script candidates

Possible controls include:
- targetDurationSeconds;
- styleGuidance;
- tone;
- pace.

These influence how an EditorialPlan becomes spoken/presented content.

### Production candidates

Possible controls include:
- format;
- aspectRatio;
- visualStyleGuidance;
- captions.

These influence presentation requirements and preferences, not generated scene decisions.

## Valid control vs generated output

Valid control examples:
- target duration;
- maximum story count;
- audience;
- focus guidance;
- desired writing style;
- aspect ratio;
- caption preference;
- high-level visual style guidance.

Invalid control concepts:
- pre-generated theme;
- pre-generated story ranking;
- generated script;
- scene prompts;
- shot list;
- final production decisions.

Those are VidGen outputs.

## Declarative controls

Controls should describe desired outcomes or boundaries rather than expose internal model/provider tuning.

Prefer:

    target duration: 3 minutes

over:

    generate exactly 412 narration words

Prefer:

    tone: analytical

over:

    use provider X with temperature Y

Provider/model tuning belongs to VidGen runtime/provider configuration, not ordinary editorial controls.

## Hard constraints and preferences

The contract should distinguish semantics clearly even if hard constraints and preferences are not encoded as separate JSON branches.

Hard constraints must be satisfied or the affected stage fails cleanly.

Likely examples:
- excluded Article IDs;
- maximum story count;
- output aspect ratio;
- captions disabled;
- later explicit content prohibitions.

Preferences should be attempted but may allow documented bounded deviation.

Likely examples:
- target story count;
- target duration;
- tone;
- style;
- pacing;
- focus guidance.

## Validation principles

Before creative analysis begins, VidGen should:
1. validate the supported control version;
2. reject unsupported/unknown fields once a schema is locked;
3. verify referenced Article IDs exist in CanonicalFeed;
4. reject contradictory include/exclude references;
5. enforce string, array, and numeric bounds;
6. normalize nullable/default values;
7. create an immutable CanonicalControl;
8. compute creative input identity only after normalization.

Invalid control must never be silently ignored.

## Defaults

VidGen should be capable of sensible operation when supported control categories contain no administrator overrides.

Defaults belong to VidGen.

Ngest persists overrides and transports them; it does not define hidden creative defaults on VidGen's behalf.

## Topic independence

Shared control semantics must not hard-code filmmaking, indie publishing, technology, or another publication topic.

Administrator-provided audience/focus/style text may of course be topic-specific.

## Provenance and trust

Controls may influence emphasis, omission, framing, style, and presentation, but cannot:
- introduce fabricated Articles;
- silently replace publisher provenance;
- override grounding requirements;
- turn untrusted control text into executable instructions.

Control text is untrusted input.

## Versioning

The control object should have its own explicit version so its semantics can evolve without forcing unrelated creative-stage version branches.

Only the VidGen input boundary should understand supported external control versions. Downstream stages consume CanonicalControl.

A compatibility matrix may be introduced once more than one control version exists.

## Secrets

Controls must never contain:
- bearer tokens;
- provider API keys;
- database credentials;
- hidden system prompts;
- internal authentication state.

Secrets belong to runtime configuration and credential boundaries.
