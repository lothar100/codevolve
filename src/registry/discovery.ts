/**
 * Discovery handler - GET /v1
 *
 * Returns a machine-readable index of API endpoints, auth schemes,
 * and pointers to documentation. Designed for AI agents arriving
 * without prior context.
 */

import type { APIGatewayProxyHandler } from "aws-lambda";
import { success } from "../shared/response.js";

const RATE_LIMITS = {
  "POST /intent": "100 req/min",
  "POST /chains": "20 req/min",
  "POST /execute": "50 req/min",
  "POST /validate/{skill_id}": "30 req/min",
  "POST /events": "10 req/min (up to 100 events per batch)",
  default: "200 req/min for other CRUD and analytics reads",
};

const ENDPOINTS = [
  // Skills
  { method: "POST", path: "/skills", auth: "api_key", description: "Create a new skill" },
  { method: "GET", path: "/skills", auth: "none", description: "List and filter skills" },
  { method: "GET", path: "/skills/{id}", auth: "none", description: "Get a skill by ID (optionally with ?version=)" },
  { method: "GET", path: "/skills/{id}/versions", auth: "none", description: "List all versions of a skill" },
  { method: "POST", path: "/skills/{id}/promote-canonical", auth: "api_key", description: "Promote a skill to canonical status" },
  { method: "POST", path: "/skills/{id}/archive", auth: "none", description: "Soft-archive a skill and remove it from routing" },
  { method: "POST", path: "/skills/{id}/unarchive", auth: "none", description: "Restore an archived skill to active use" },
  // Problems
  { method: "POST", path: "/problems", auth: "api_key", description: "Create a new problem" },
  { method: "GET", path: "/problems", auth: "none", description: "List and filter problems" },
  { method: "GET", path: "/problems/{id}", auth: "none", description: "Get a problem and all its skills" },
  // Core agent workflow
  { method: "POST", path: "/intent", auth: "none", description: "Route a natural-language intent to ranked skill matches; callers execute chosen skills locally" },
  { method: "POST", path: "/chains", auth: "none", description: "Resolve an ordered local-execution chain from explicit steps or a prior intent chain suggestion" },
  { method: "POST", path: "/execute", auth: "none", description: "Record caller-owned local execution telemetry; the server does not run the skill or manage an execution cache" },
  { method: "POST", path: "/validate/{skill_id}", auth: "api_key", description: "Record caller-reported validation feedback counts to update confidence and status" },
  // Analytics
  { method: "GET", path: "/analytics/dashboards/{type}", auth: "none", description: "Analytics dashboard data. type: intent-performance | execution-caching | skill-quality | evolution-gap | agent-behavior" },
  // Auth
  { method: "POST", path: "/auth/register", auth: "none", description: "Register a standalone agent principal and receive its first API key" },
  { method: "POST", path: "/auth/keys", auth: "api_key", description: "Create a child API key for the current agent account" },
  { method: "GET", path: "/auth/keys", auth: "api_key", description: "List API keys for the current agent account" },
  { method: "DELETE", path: "/auth/keys/{key_id}", auth: "api_key", description: "Revoke an API key" },
  { method: "POST", path: "/auth/accounts/{account_id}/status", auth: "cognito", description: "Set account status for an existing agent account" },
  // Users
  { method: "GET", path: "/users/me/trusted-mountain", auth: "cognito", description: "Get the authenticated user's trusted mountain view" },
  { method: "POST", path: "/users/me/trusted-mountain", auth: "cognito", description: "Update trusted mountain skill preferences for the authenticated user" },
  { method: "DELETE", path: "/users/me/trusted-mountain/{skill_id}", auth: "cognito", description: "Remove a skill from the authenticated user's trusted mountain" },
  // Meta
  { method: "GET", path: "/health", auth: "none", description: "Service health check" },
  { method: "GET", path: "/", auth: "none", description: "This discovery document" },
];

const AUTH_SCHEMES = {
  none: "No authentication required",
  api_key: "Pass X-Api-Key with a previously issued codeVolve agent key for write, validation, and key-management routes",
  cognito: "Used for internal controls and the current trusted-mountain user surface",
};

function buildMcpQuickstart(baseUrl: string) {
  return {
    transport: "stdio",
    env: {
      CODEVOLVE_API_URL: baseUrl,
      CODEVOLVE_API_KEY: "Required for write actions such as feedback_skill and submit_skill",
      CODEVOLVE_AGENT_ID: "Optional caller identifier. Defaults to mcp-server.",
    },
    first_steps: [
      "Set CODEVOLVE_API_URL to the public beta base URL.",
      "Bootstrap an API key with POST /auth/register and set CODEVOLVE_API_KEY before write actions.",
      "Route with resolve_skill or fetch directly with get_skill / codevolve://skills/{skill_id}.",
      "Run the implementation locally in your own environment.",
      "Report aggregate pass/fail counts with feedback_skill.",
    ],
    tools: [
      {
        name: "resolve_skill",
        description: "Route a natural-language intent through POST /intent.",
      },
      {
        name: "get_skill",
        description: "Fetch one skill implementation, tests, and validation metrics.",
      },
      {
        name: "feedback_skill",
        description: "Report caller-run local test results through POST /validate/{skill_id}.",
      },
    ],
    resources: [
      {
        uri: "codevolve://skills/{skill_id}",
        description: "Read the full skill payload as JSON for local execution.",
      },
      {
        uri: "codevolve://skills?language=typescript",
        description: "List skills with optional query parameters.",
      },
    ],
    compatibility_aliases: [
      {
        name: "validate_skill",
        preferred_replacement: "feedback_skill",
      },
    ],
  };
}

function getHeader(
  headers: Record<string, string | undefined> | null | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }

  return undefined;
}

function normalizeBasePath(path: string | null | undefined): string {
  if (!path || path === "/") {
    return "";
  }

  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function joinUrl(origin: string, path: string): string {
  return path ? `${origin}${path}` : origin;
}

function deriveBaseUrl(event: Parameters<APIGatewayProxyHandler>[0]): string {
  const protocol = getHeader(event.headers, "x-forwarded-proto") ?? "https";
  const host = event.requestContext?.domainName ?? getHeader(event.headers, "host");
  const basePath = normalizeBasePath(event.requestContext?.path ?? event.path);

  if (!host) {
    return basePath || "/";
  }

  return joinUrl(`${protocol}://${host}`, basePath);
}

function deriveOpenApiUrl(baseUrl: string): string {
  return baseUrl === "/" ? "/openapi.json" : `${baseUrl}/openapi.json`;
}

function deriveDocsUrl(baseUrl: string): string {
  const configuredDocsUrl = process.env.PUBLIC_DOCS_URL?.trim();
  if (configuredDocsUrl) {
    return configuredDocsUrl;
  }

  // Until a separate public docs host exists, discovery itself is the public onboarding surface.
  return baseUrl;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const baseUrl = deriveBaseUrl(event);

  return success(200, {
    service: "codevolve",
    version: "0.1.0",
    description: "AI-native registry of programming problems and reusable skills. Canonical beta flow: route with /intent or use exact lookup, fetch skill details, execute locally, then optionally report execution telemetry and validation feedback. The API does not run skills or manage a server-side execution cache.",
    base_url: baseUrl,
    docs_url: deriveDocsUrl(baseUrl),
    openapi_url: deriveOpenApiUrl(baseUrl),
    auth_schemes: AUTH_SCHEMES,
    rate_limits: RATE_LIMITS,
    mcp: buildMcpQuickstart(baseUrl),
    endpoints: ENDPOINTS,
  });
};
