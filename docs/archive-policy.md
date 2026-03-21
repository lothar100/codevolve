# codeVolve — Archive Policy

> Maintained by Quimby. Defined by Amber (DESIGN-03), reviewed by Jorven.

---

*Archive threshold policy will be defined here by Amber in task DESIGN-03.*

## Principles (established)

- Archive is never deletion. Records are preserved with `status: "archived"`.
- Archived skills are excluded from `/resolve` routing and OpenSearch index.
- Archived problems are hidden from the mountain visualization by default (toggleable).
- ClickHouse/BigQuery analytics events for archived skills are never deleted.
- All archive decisions are reversible via `POST /skills/:id/unarchive`.
- Archive evaluation runs every 24 hours via the Decision Engine Lambda.
