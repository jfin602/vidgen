# VidGen Control Interface

Status: CURRENT COMPATIBILITY / FINAL FIELD SET DEFERRED

## Purpose

VidGen controls let an administrator influence how supplied stories are presented without moving creative-generation behavior into ngest.

Controls carry preferences or constraints. They do not carry generated creative output and they do not decide which stories are production-worthy.

## Current implementation compatibility

Phase 1 already normalizes a provisional control shell:

    control
      |
      +-- version
      +-- editorial
      +-- script
      +-- production

That shell is implemented and may remain temporarily for compatibility.

It must not be interpreted as the current desired stage graph. The single-story pipeline no longer contains separate editorial, script, and production-planning stages.

Do not perform a breaking control-schema redesign merely to rename branches before real clip behavior demonstrates which controls are actually needed.

## Current product rule

Every story supplied by ngest is already intended for production.

Therefore VidGen controls should not include story-selection concepts such as:
- targetStoryCount;
- maximumStoryCount;
- mustIncludeArticleIds;
- excludeArticleIds;
- story-ranking guidance.

Those responsibilities are no longer part of VidGen's MVP.

## Likely useful clip-level controls

The final minimal control contract should be derived from real clips.

Possible future controls may include:
- template selection where more than one template exists;
- tone/style guidance;
- audience guidance;
- high-level visual-style guidance;
- caption preference;
- later explicit content/presentation constraints.

A fixed cinematic template should own its normal timing. Avoid adding arbitrary duration controls that force the model to redesign the selected cinematic template.

The Phase 6 simple presenter-headline CLI is intentionally different: it may accept a `maxSeconds` execution constraint from 4 through 20 seconds inclusive. That value is a hard output ceiling, not a target duration and not currently a persistent ngest `CanonicalControl` field. Provider-specific duration granularity remains a runtime/provider concern.

The exact v1 field set is intentionally not locked yet.

## Defaults

Both the manual cinematic workflow and the simple presenter-headline workflow should be capable of running with engine defaults and little or no administrator customization.

Defaults belong to VidGen.

This keeps early video debugging focused on the production pipeline rather than building a broad configuration system first.

## Ownership

Ngest owns:
- persistence;
- Profile association;
- administrator editing;
- authorization;
- transport delivery.

VidGen owns:
- supported-version handling;
- semantic validation;
- normalization/defaults;
- safe interpretation;
- template/ClipPlan/media consequences.

Ngest should not need to understand provider prompts or how a style preference changes generated media.

## Valid control vs generated output

Reasonable control concepts:
- desired tone;
- audience;
- high-level style;
- supported template choice;
- caption preference.

Invalid control concepts:
- generated script;
- generated ClipPlan;
- scene prompts;
- provider job instructions;
- final media decisions;
- pre-generated story ranking.

Those are VidGen outputs or runtime/provider concerns.

## Declarative controls

Controls should describe desired outcomes rather than provider tuning.

Prefer:

    tone: analytical

over:

    use model X with temperature Y

Provider/model parameters belong to VidGen runtime/provider configuration.

## Validation principles

The input boundary should:
1. validate the supported control version;
2. reject obviously unsafe/secret-bearing content;
3. validate field semantics once the minimal control contract is locked;
4. normalize defaults;
5. keep controls immutable downstream;
6. include generation-relevant controls in appropriate fingerprints.

Until the long-term field set is contracted, the existing Phase 1 compatibility shell remains provisional.

## Topic independence

Shared control semantics must not hard-code a publication topic.

Administrator-provided style/audience guidance may naturally be topic-specific.

## Provenance and trust

Control text is untrusted input.

Controls cannot:
- fabricate Article provenance;
- override grounding requirements;
- authorize publisher-media reuse;
- become executable instructions;
- contain secrets.

## Secrets

Controls must never contain:
- bearer tokens;
- provider API keys;
- database credentials;
- passwords;
- hidden system prompts;
- internal authentication state.

Secrets belong to runtime credential boundaries.

## Deferred

- final v1 control schema;
- migration away from the Phase 1 branch names;
- exact template-selection semantics;
- exact caption/style controls;
- additional control versions.

These should be resolved from working single-story clips rather than speculative stage design.
