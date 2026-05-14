---
name: project_arch05_vector_search
description: Key decisions made in ARCH-05 for Phase 2 vector search — latency targets, migration trigger, embedding format, and a clarification that supersedes ADR-004's 100ms figure
type: project
---

ARCH-05 (2026-03-21) produced docs/vector-search.md and ADR-005 in docs/decisions.md.

Key decisions:
- Embedding fields: name + description + domain (space-joined) + tags (space-joined). Format: "{name}. {description} domain:{domains} tags:{tags}". Max 8192 chars.
- Model: amazon.titan-embed-text-v2:0, 1024 dims, normalize=true (L2-normalized by Bedrock).
- Storage: embedding attribute (L of N) on codevolve-skills. Already in schema — no migration needed.
- Similarity: dot product on Float32Array (cosine equiv for normalized vectors). In-process in resolve Lambda.
- Boost: +0.05/tag match, +0.10/domain match, capped at +0.20. Final confidence = cosine + boost, capped at 1.0.
- Threshold: >= 0.70 to return a match. Below threshold: 404 NO_MATCH + trigger /evolve.
- Phase 2 latency target: p95 < 500ms at 5K skills (NOT 100ms — that is the post-OpenSearch SLO).
- Migration trigger: 5,000 active skills (hard count), not a latency threshold.
- ADR-004 said "p95 > 100ms triggers migration" — ADR-005 supersedes that specific claim. The 100ms target is post-migration, not Phase 2. Do not restate the 100ms figure as a Phase 2 target.
- Lambda config: 512 MB memory, 10s timeout for resolve handler.
- Archived skills and null-embedding skills are always excluded from resolve results.
- Bedrock failure returns 503 EMBEDDING_ERROR — never fall through to a random result.
