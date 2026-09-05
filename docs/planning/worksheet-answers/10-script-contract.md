# Question 10 — Script Contract

## Question

What must Script provide so ProductionPlan never has to reinvent editorial meaning?

## Answer

Decision: Script should be a standardized structured JSON artifact in which narration is only one field. Each script segment must carry enough editorial semantics for ProductionPlan to translate intent into production choices without re-deciding what the story means.

At minimum, segment-level data should be designed to carry concepts such as:
- stable segment identity;
- supporting Article IDs and provenance references;
- narration text;
- intended or target duration;
- emphasis or priority;
- quoted or on-screen text;
- visualizable entities, events, subjects, or concepts;
- transition intent;
- factual claims or sensitive details requiring source or visual caution.

Confidence: High.

Why: ProductionPlan should be a production-design stage, not a second editorial reasoning stage. Carrying editorial semantics forward in Script creates a clean producer/consumer boundary, keeps downstream behavior deterministic where possible, and preserves traceability from final media choices back to the approved editorial intent and source material.

Deferred details: Exact Script JSON Schema, required versus optional fields, timing representation, claim-level provenance granularity, transition vocabulary, visual-intent taxonomy, and whether some fields are generated in EditorialPlan and merely propagated through Script remain open for implementation planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future Script/ProductionPlan schema contract documentation when this decision is promoted.
