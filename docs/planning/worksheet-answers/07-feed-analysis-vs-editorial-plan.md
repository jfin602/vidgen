# Question 7 — FeedAnalysis vs EditorialPlan

## Question

Should FeedAnalysis and EditorialPlan remain separate model stages?

## Answer

Decision: Yes. FeedAnalysis and EditorialPlan remain separate stages. FeedAnalysis is responsible for discovering themes, clusters, entities, uncertainty, and candidate stories. EditorialPlan is responsible for choosing the final editorial structure, including selected stories, ordering, opening, closing, and transitions.

EditorialPlan should use a defined JSON-based structured format. An AI model should be able to generate a valid EditorialPlan, but the initial production system will use deterministic template compositions that consume the plan and fill predefined composition slots rather than requiring the AI to invent the final visual composition structure.

Confidence: High.

Why: Separating analysis from editorial selection keeps each responsibility inspectable and makes it possible to change editorial strategy without repeating feed analysis. A structured JSON EditorialPlan creates a stable producer/consumer boundary between AI-assisted editorial reasoning and deterministic production/template logic. This also reduces the risk that downstream composition code has to infer or reinvent editorial meaning.

Deferred details: Exact EditorialPlan JSON Schema, required versus optional fields, schema versioning, validation/repair behavior, template-selection fields, and whether any non-AI editorial planning mode is supported remain open for implementation planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future EditorialPlan/schema contract documentation when this decision is promoted.
