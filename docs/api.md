# codeVolve — API Reference

> Maintained by Quimby. Full contracts written by Jorven as part of ARCH-02.

---

*API contracts will be written by Jorven in task ARCH-02.*

## Endpoints (planned)

| Method | Path | Description |
|--------|------|-------------|
| POST | /skills | Create skill |
| GET  | /skills/:id | Get skill by ID |
| GET  | /skills | List/filter skills |
| POST | /skills/:id/promote-canonical | Set as canonical |
| POST | /problems | Create problem |
| GET  | /problems/:id | Get problem + all skills |
| POST | /resolve | Route intent → best skill |
| POST | /execute | Run skill with inputs |
| POST | /execute/chain | Chain multiple skills |
| POST | /validate/:skill_id | Run tests, update confidence |
| POST | /events | Emit analytics event |
| GET  | /analytics/dashboards/:type | Dashboard data |
| POST | /evolve | Async skill generation from gap |
| POST | /skills/:id/archive | Archive a skill |
| POST | /skills/:id/unarchive | Reverse archival |
