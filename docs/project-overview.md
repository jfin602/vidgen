# Project Overview

Status: CURRENT DIRECTION / EARLY-STAGE

## Purpose

VidGen turns a bounded, governed news feed into a cinematic or broadcast-style video edition.

The primary production integration is ngest. VidGen receives its own bearer credential and calls a dedicated ngest VidGen integration endpoint. That endpoint composes the same governed Distribution Profile feed semantics used by ngest's outward distribution system with Profile-associated VidGen controls.

Generic Distribution consumers, including PHP integration packages, remain unaware of VidGen-only controls.

## Core architectural law

Ngest determines which governed Articles are available in the feed.

VidGen determines what those Articles mean together and how to turn them into a program.

Administrator influence reaches VidGen through bounded controls containing intent, preferences, and constraints rather than pre-generated themes, rankings, scripts, scene prompts, or production decisions.

## Boundary with ngest

Ngest owns:
- approved-source trust;
- collection;
- normalization;
- canonical Article identity;
- provenance;
- duplicate handling;
- moderation;
- canonical outward eligibility;
- Distribution Profile selection;
- feed ordering;
- exact original publisher URLs;
- bearer-token authorization;
- Profile-associated persistence and delivery of VidGen controls.

VidGen owns:
- authenticated acquisition from the ngest VidGen endpoint;
- boundary validation and normalization;
- canonical feed and control models;
- input fingerprinting;
- bounded enrichment/research where later permitted;
- feed analysis and theme discovery;
- story ranking, grouping, selection, and editorial framing;
- script generation;
- source traceability through generated artifacts;
- production planning;
- media and narration generation;
- captions and graphics;
- assembly and rendering;
- final artifacts and run provenance.

VidGen must not reproduce ngest's Source trust, moderation, duplicate, Profile filtering, or canonical outward eligibility logic.

VidGen must not connect directly to ngest's database.

VidGen does not use the ngest Profile digest as creative input. Competition-visible editorial intelligence belongs inside VidGen.

## Intended pipeline

A VidGen run is expected to evolve through explicit intermediate stages:

    ngest VidGen endpoint
            |
            v
    CanonicalFeed + CanonicalControl
            |
            v
       FeedAnalysis
            |
            v
      EditorialPlan
            |
            v
          Script
            |
            v
      ProductionPlan
            |
            v
     generated media
            |
            v
     composition/render
            |
            v
       final program

Intermediate artifacts should remain inspectable enough to support reproducibility, debugging, review, retry/recovery, and hackathon demonstration.

## Initial product goal

The first useful milestone is a reproducible engine foundation that can authenticate to the dedicated ngest VidGen endpoint, validate and normalize its response, create deterministic generation identity, and expose clean canonical input to later creative stages.

After that foundation, the roadmap develops FeedAnalysis, EditorialPlan, and Script as separate visible stages before locking the production-plan contract.

## Intentionally open questions

Examples intentionally left open:
- exact ngest VidGen route name;
- exact ngest persistence/table schema for controls;
- exact token/scope representation inside ngest;
- exact control v1 field set, ranges, and defaults;
- VidGen persistence technology;
- job/queue topology;
- research providers;
- model/provider selection;
- image/video generation providers;
- TTS/narration provider;
- compositor/render stack;
- artifact storage;
- approval/review workflow;
- publishing destinations;
- cost controls;
- detailed retry/resume semantics;
- public VidGen API or UI requirements.

These should be decided through planning and evidence rather than assumed by bootstrap documentation.
