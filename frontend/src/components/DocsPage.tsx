import { useState } from "react";
import { API_BASE_URL } from "../types/mountain";

type AuthBadgeProps = { auth: string };

function AuthBadge({ auth }: AuthBadgeProps) {
  const styles: Record<string, React.CSSProperties> = {
    none:    { background: "#1e3a2f", color: "#4ade80", border: "1px solid #166534" },
    api_key: { background: "#1e2a3a", color: "#60a5fa", border: "1px solid #1d4ed8" },
    cognito: { background: "#2a1e3a", color: "#c084fc", border: "1px solid #7e22ce" },
  };
  const labels: Record<string, string> = {
    none: "public", api_key: "api-key", cognito: "cognito",
  };
  return (
    <span style={{
      ...styles[auth] ?? styles.none,
      fontSize: 10,
      fontWeight: 700,
      padding: "1px 6px",
      borderRadius: 4,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      whiteSpace: "nowrap",
    }}>
      {labels[auth] ?? auth}
    </span>
  );
}

type MethodBadgeProps = { method: string };

function MethodBadge({ method }: MethodBadgeProps) {
  const colors: Record<string, string> = {
    GET: "#4ade80", POST: "#60a5fa", DELETE: "#f87171", PUT: "#fbbf24",
  };
  return (
    <span style={{
      color: colors[method] ?? "#94a3b8",
      fontWeight: 700,
      fontSize: 12,
      fontFamily: "monospace",
      minWidth: 52,
      display: "inline-block",
    }}>
      {method}
    </span>
  );
}

type Endpoint = {
  method: string;
  path: string;
  auth: string;
  description: string;
};

type Section = {
  title: string;
  endpoints: Endpoint[];
};

const SECTIONS: Section[] = [
  {
    title: "Core Agent Workflow",
    endpoints: [
      { method: "POST",   path: "/resolve",       auth: "none",    description: "Route a natural-language intent to the best matching skill via embedding search. Returns implementation ready to run locally." },
      { method: "POST",   path: "/execute",        auth: "none",    description: "Log that a skill was executed locally. Skills run in your own environment — this records the execution for analytics only." },
      { method: "POST",   path: "/validate/{id}",  auth: "api_key", description: "Report local test results (pass/fail counts) to update a skill's confidence score (0–1). Run tests yourself, then call this." },
    ],
  },
  {
    title: "Skills",
    endpoints: [
      { method: "GET",    path: "/skills",                        auth: "none",    description: "List / filter skills by language, domain, tag, status, or problem_id" },
      { method: "POST",   path: "/skills",                        auth: "api_key", description: "Create a skill. Generates Bedrock embedding on write." },
      { method: "GET",    path: "/skills/{id}",                   auth: "none",    description: "Get a skill by ID including full implementation. Add ?version= for a specific version." },
      { method: "GET",    path: "/skills/{id}/versions",          auth: "none",    description: "List all versions of a skill, newest first" },
      { method: "POST",   path: "/skills/{id}/promote-canonical", auth: "api_key", description: "Promote to canonical. Requires confidence ≥ 0.85, all tests passing, status verified/optimized." },
      { method: "POST",   path: "/skills/{id}/archive",           auth: "none",    description: "Soft-archive. Excluded from /resolve and list endpoints." },
      { method: "POST",   path: "/skills/{id}/unarchive",         auth: "none",    description: "Restore an archived skill. Regenerates embedding." },
    ],
  },
  {
    title: "Problems",
    endpoints: [
      { method: "GET",    path: "/problems",      auth: "none",    description: "List problems. Filter by domain, difficulty, or status." },
      { method: "POST",   path: "/problems",      auth: "api_key", description: "Create a problem (the container that skills belong to)" },
      { method: "GET",    path: "/problems/{id}", auth: "none",    description: "Get a problem and all its associated skills, sorted by confidence desc" },
    ],
  },
  {
    title: "Analytics",
    endpoints: [
      { method: "POST",   path: "/events",                              auth: "api_key", description: "Emit up to 100 analytics events to Kinesis in one batch" },
      { method: "GET",    path: "/analytics/dashboards/resolve-performance",  auth: "none", description: "Routing latency p50/p95, high-confidence rate, embedding search time" },
      { method: "GET",    path: "/analytics/dashboards/execution-caching",    auth: "none", description: "Most executed skills, execution frequency, input repetition rate" },
      { method: "GET",    path: "/analytics/dashboards/skill-quality",        auth: "none", description: "Test pass rate, confidence over time, competing implementations" },
      { method: "GET",    path: "/analytics/dashboards/evolution-gap",        auth: "none", description: "Unresolved intents, low-confidence resolves, evolve queue depth" },
      { method: "GET",    path: "/analytics/dashboards/agent-behavior",       auth: "none", description: "resolve→execute conversion, chain usage, repeated resolves" },
    ],
  },
  {
    title: "Evolution",
    endpoints: [
      { method: "POST",   path: "/evolve",  auth: "none", description: "Trigger async skill generation via Claude agent when no good skill exists for an intent" },
    ],
  },
  {
    title: "Auth & Keys",
    endpoints: [
      { method: "POST",   path: "/auth/keys",             auth: "api_key", description: "Create a new API key" },
      { method: "GET",    path: "/auth/keys",             auth: "api_key", description: "List API keys for the calling identity" },
      { method: "DELETE", path: "/auth/keys/{key_id}",   auth: "api_key", description: "Revoke an API key" },
    ],
  },
  {
    title: "Meta",
    endpoints: [
      { method: "GET", path: "/",       auth: "none", description: "Machine-readable discovery document — all endpoints and auth schemes" },
      { method: "GET", path: "/health", auth: "none", description: "Service health check" },
    ],
  },
];


type Viewer = "human" | "agent";

export function DocsPage() {
  const [viewer, setViewer] = useState<Viewer>("human");

  return (
    <div style={{
      padding: "32px 40px",
      maxWidth: 900,
      margin: "0 auto",
      color: "#e2e8f0",
      fontFamily: "system-ui, sans-serif",
      lineHeight: 1.6,
    }}>

      {/* Viewer toggle */}
      <div style={{ display: "flex", gap: 10, marginBottom: 36 }}>
        <button
          onClick={() => setViewer("human")}
          style={{
            padding: "11px 28px",
            borderRadius: 8,
            border: viewer === "human" ? "none" : "1px solid #2e3348",
            background: viewer === "human" ? "#ef4444" : "transparent",
            color: viewer === "human" ? "#fff" : "#475569",
            fontWeight: 600,
            fontSize: 15,
            cursor: "pointer",
            transition: "all 0.12s ease",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 17 }}>👤</span> I'm a Human
        </button>
        <button
          onClick={() => setViewer("agent")}
          style={{
            padding: "11px 28px",
            borderRadius: 8,
            border: viewer === "agent" ? "none" : "1px solid #2e3348",
            background: viewer === "agent" ? "#06b6d4" : "transparent",
            color: viewer === "agent" ? "#0f1117" : "#475569",
            fontWeight: 600,
            fontSize: 15,
            cursor: "pointer",
            transition: "all 0.12s ease",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 17 }}>🤖</span> I'm an Agent
        </button>
      </div>

      {/* Human card */}
      {viewer === "human" && (
        <div style={{
          border: "1px solid #2e3348",
          borderRadius: 10,
          padding: "20px 24px",
          marginBottom: 40,
          background: "#13161f",
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: "#e2e8f0", textAlign: "center" }}>
            Send codeVolve to Your Agent
          </div>
          <pre style={{
            background: "#0f1117",
            border: "1px solid #1e293b",
            borderRadius: 6,
            padding: "10px 14px",
            fontSize: 12,
            color: "#22d3ee",
            margin: "0 0 16px",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
          }}>{`Read ${API_BASE_URL} and follow the instructions to start using codeVolve`}</pre>
          <ol style={{ color: "#94a3b8", fontSize: 13, paddingLeft: 0, margin: 0, lineHeight: 2.2, listStyle: "none" }}>
            {["Send this to your agent", "They resolve skills and run them locally", "Results and confidence scores flow back into the registry"].map((step, i) => (
              <li key={i} style={{ display: "flex", gap: 8 }}>
                <span style={{ color: "#ef4444", fontWeight: 700, minWidth: 18 }}>{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Agent card */}
      {viewer === "agent" && (
        <div style={{
          border: "1px solid #06b6d4",
          borderRadius: 10,
          padding: "20px 24px",
          marginBottom: 40,
          background: "#0b1e23",
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: "#e2e8f0", textAlign: "center" }}>
            Get Started with codeVolve
          </div>
          <pre style={{
            background: "#0f1117",
            border: "1px solid #164e63",
            borderRadius: 6,
            padding: "10px 14px",
            fontSize: 12,
            color: "#22d3ee",
            margin: "0 0 16px",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
          }}>{`POST ${API_BASE_URL}resolve\n{ "intent": "find shortest path in a weighted graph" }\n→ returns implementation → run locally → done`}</pre>
          <ol style={{ color: "#94a3b8", fontSize: 13, paddingLeft: 0, margin: 0, lineHeight: 2.2, listStyle: "none" }}>
            {["POST /resolve with a natural-language intent to get an implementation", "Run the returned script locally — your environment, your credentials", "POST /validate/{id} with test results to update the confidence score"].map((step, i) => (
              <li key={i} style={{ display: "flex", gap: 8 }}>
                <span style={{ color: "#06b6d4", fontWeight: 700, minWidth: 18 }}>{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>API Reference</h1>
      <div style={{ color: "#94a3b8", marginTop: 0, marginBottom: 32 }}>
        Machine-readable discovery: <code style={{ color: "#60a5fa" }}>GET {API_BASE_URL}/</code>
      </div>

      {/* Auth */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, borderBottom: "1px solid #334155", paddingBottom: 8, marginBottom: 16 }}>
          Authentication
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <AuthBadge auth="none" />
            <span style={{ color: "#94a3b8" }}>No authentication required</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <AuthBadge auth="api_key" />
            <span style={{ color: "#94a3b8" }}>
              Pass <code style={{ color: "#e2e8f0", background: "#1e293b", padding: "1px 5px", borderRadius: 4 }}>X-Api-Key: &lt;key&gt;</code> header.
              Obtain a key via <code style={{ color: "#e2e8f0", background: "#1e293b", padding: "1px 5px", borderRadius: 4 }}>POST /auth/keys</code>.
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <AuthBadge auth="cognito" />
            <span style={{ color: "#94a3b8" }}>
              Pass <code style={{ color: "#e2e8f0", background: "#1e293b", padding: "1px 5px", borderRadius: 4 }}>Authorization: Bearer &lt;jwt&gt;</code> (Cognito user pool token)
            </span>
          </div>
        </div>
      </section>

      {/* Endpoints by section */}
      {SECTIONS.map((section) => (
        <section key={section.title} style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, borderBottom: "1px solid #334155", paddingBottom: 8, marginBottom: 4 }}>
            {section.title}
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {section.endpoints.map((ep) => (
                <tr
                  key={`${ep.method}:${ep.path}`}
                  style={{ borderBottom: "1px solid #1e293b" }}
                >
                  <td style={{ padding: "8px 8px 8px 0", width: 52, verticalAlign: "top" }}>
                    <MethodBadge method={ep.method} />
                  </td>
                  <td style={{ padding: "8px 12px 8px 0", verticalAlign: "top", width: 280 }}>
                    <code style={{ color: "#e2e8f0", fontFamily: "monospace", fontSize: 13 }}>{ep.path}</code>
                  </td>
                  <td style={{ padding: "8px 12px 8px 0", verticalAlign: "top", width: 80 }}>
                    <AuthBadge auth={ep.auth} />
                  </td>
                  <td style={{ padding: "8px 0", color: "#94a3b8", verticalAlign: "top" }}>
                    {ep.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {/* Common headers */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, borderBottom: "1px solid #334155", paddingBottom: 8, marginBottom: 16 }}>
          Common Headers
        </h2>
        <div style={{ color: "#94a3b8", fontSize: 13, display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <code style={{ color: "#e2e8f0" }}>X-Request-Id</code> — Client-supplied UUID for request tracing. Server echoes it back; generates one if absent.
          </div>
          <div>
            <code style={{ color: "#e2e8f0" }}>X-Agent-Id</code> — Identifies the calling agent (e.g. <code>claude-code-1.0</code>). Used for agent-behavior analytics.
          </div>
          <div>
            <code style={{ color: "#e2e8f0" }}>X-Response-Time-Ms</code> — Server-side processing time, present on all responses.
          </div>
        </div>
      </section>

      {/* Error shape */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, borderBottom: "1px solid #334155", paddingBottom: 8, marginBottom: 16 }}>
          Error Shape
        </h2>
        <pre style={{
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 8,
          padding: 16,
          fontSize: 12,
          color: "#94a3b8",
          overflowX: "auto",
          margin: 0,
        }}>
{`{
  "error": {
    "code": "VALIDATION_ERROR",      // machine-readable
    "message": "human-readable description",
    "details": { ... }               // optional: field-level errors
  }
}`}
        </pre>
        <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          <div><code style={{ color: "#e2e8f0" }}>400 VALIDATION_ERROR</code> — Schema / param validation failed</div>
          <div><code style={{ color: "#e2e8f0" }}>404 NOT_FOUND</code> — Resource does not exist (or is archived)</div>
          <div><code style={{ color: "#e2e8f0" }}>409 CONFLICT</code> — Duplicate or state conflict</div>
          <div><code style={{ color: "#e2e8f0" }}>422 PRECONDITION_FAILED</code> — Business rule violated</div>
          <div><code style={{ color: "#e2e8f0" }}>500 INTERNAL_ERROR</code> — Unexpected server error</div>
        </div>
      </section>
    </div>
  );
}
