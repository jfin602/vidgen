# Question 19 — First-Class Output Formats

## Question

What output formats are first-class for v1?

## Answer

Decision: Use 16:9 landscape as the first-class master format and support 9:16 vertical as a derived variant from the start. Defer 1:1 square output.

Initial delivery targets:
- 16:9 landscape master at 1920x1080;
- 9:16 vertical variant at 1080x1920;
- MP4 container with H.264 video for the MVP;
- 30 fps;
- burned-in captions for the MVP;
- templates designed responsively from the beginning so vertical output is not a later retrofit;
- edition duration remains configurable rather than hard-coded at this stage.

Confidence: High.

Why: Landscape is the natural primary format for a newscast, while vertical distribution is important enough to support from the beginning. Designing templates responsively now avoids costly composition rewrites later. H.264 MP4 and 30 fps provide broad playback compatibility and a simple MVP delivery baseline.

Deferred details: Audio codec/bitrate, exact H.264 profile and encoding settings, caption sidecar formats, vertical-specific editorial differences, maximum/minimum edition duration, thumbnail/poster output, and additional formats such as 1:1 remain open for implementation planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future rendering/output contract documentation when this decision is promoted.
