# Project Overview

Status: DRAFT / PROVISIONAL

## Purpose

VidGen is intended to turn a bounded, governed news feed into a cinematic or broadcast-style video edition.

The first concrete integration target is ngest. ngest can provide a Profile-scoped VidGen manifest containing governed feed items plus bounded administrator controls. VidGen consumes that input as an external engine rather than becoming part of the ngest aggregation runtime.

## Core direction

A VidGen run may eventually include:

1. acquire and validate the input manifest;
2. research or enrich selected stories within explicit safety and provenance limits;
3. develop an edition theme and story structure;
4. write a script;
5. produce scene and shot plans;
6. generate or acquire allowed media assets through provider adapters;
7. compose narration, visuals, titles, transitions, and timing;
8. render a final video;
9. retain enough run metadata and artifacts to explain what was produced from which input.

The exact set of stages, providers, data models, and storage technology is not yet locked.

## Boundary with ngest

ngest should remain the authority for its own canonical feed selection, source provenance, article destinations, and administrator-controlled manifest input.

VidGen should not reimplement ngest source collection, moderation, duplicate policy, canonical feed ordering, or Profile filtering simply to produce a video.

VidGen owns downstream creative decisions and generated artifacts.

## Initial product goal

The first useful milestone is a reproducible end-to-end prototype that can consume one valid feed manifest and produce one coherent news-show-style video edition.

Quality matters, but the early architecture should make it easy to replace individual research, script, media-generation, speech, composition, or render providers as the project learns.

## Open questions

Examples intentionally left open:
- exact manifest client and authentication flow;
- persistence technology;
- job/queue topology;
- story selection policy;
- research providers;
- script/model providers;
- image/video generation providers;
- TTS/narration provider;
- compositor/render stack;
- artifact storage;
- approval/review workflow;
- publishing destinations;
- cost controls;
- retry/resume semantics;
- public API or UI requirements.

These should be decided through planning and evidence, not assumed by bootstrap docs.
