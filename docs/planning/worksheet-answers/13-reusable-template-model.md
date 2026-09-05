# Question 13 — Reusable Newscast Template Model

## Question

What is the reusable newscast template model?

## Answer

Decision: Use a code + data template model.

Remotion components should define deterministic visual and animation behavior for reusable scene types such as the program shell, intro/outro, headline cards, story openers, B-roll layouts, quote/stat cards, lower thirds, transitions, presenter scenes where applicable, and closing scenes.

Separate JSON template definitions should describe the production-facing contract for each template, including available content slots, timing constraints, safe areas, supported media types, configurable parameters, and other structured capabilities that ProductionPlan may use.

ProductionPlan should select templates and fill only their declared slots. Editorial stages should not import, depend on, or reason directly about Remotion implementation components. Adding a new template should normally require adding the new rendering component and its template definition rather than changing editorial logic.

Confidence: High.

Why: Separating rendering implementation from a structured template contract keeps the production system extensible while preserving clean stage boundaries. ProductionPlan can work against stable, inspectable capabilities expressed as data, while Remotion remains free to implement those capabilities in code. This prevents compositor details from leaking backward into editorial reasoning and makes new templates easier to add safely.

Deferred details: Exact template JSON Schema, template registry/discovery mechanism, scene taxonomy, timing model, slot vocabulary, safe-area representation, responsive behavior, validation rules, and how template versions are referenced by ProductionPlan remain open for implementation planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future template/ProductionPlan contract documentation when this decision is promoted.
