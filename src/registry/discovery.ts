/**
 * Discovery handler - GET /v1
 *
 * Returns a machine-readable index of API endpoints, auth schemes,
 * and pointers to documentation. Designed for AI agents arriving
 * without prior context.
 */

import type { APIGatewayProxyHandler } from "aws-lambda";
import { success } from "../shared/response.js";

const DOCS_URL = "https://codevolve.dev/docs";
const OPENAPI_URL = "https://api.codevolve.dev/v1/openapi.json"; // future

const ENDPOINTS = [
  // Skills
  { method: "POST", path: "/skills", auth: "api_key", description: "Create a new skill" },
  { method: "GET", path: "/skills", auth: "none", description: "List and filter skills" },
  { method: "GET", path: "/skills/{id}", auth: "none", description: "Get a skill by ID (optionally with ?version=)" },
  { method: "GET", path: "/skills/{id}/versions", auth: "none", description: "List all versions of a skill" },
  { method: "POST", path: "/skills/{id}/promote-canonical", auth: "api_key", description: "Promote a skill to canonical status" },
  { method: "POST", path: "/skills/{id}/archive", auth: "none", description: "Soft-archive a skill" },
  { method: "POST", path: "/skills/{id}/unarchive", auth: "none", description: "Restore an archived skill" },
  // Problems
  { method: "POST", path: "/problems", auth: "api_key", description: "Create a new problem" },
  { method: "GET", path: "/problems", auth: "none", description: "List and filter problems" },
  { method: "GET", path: "/problems/{id}", auth: "none", description: "Get a problem and all its skills" },
  // Core agent workflow
  { method: "POST", path: "/intent", auth: "none", description: "Route a natural-language intent to the best matching skill and return ranked match metadata" },
  { method: "POST", path: "/chains", auth: "none", description: "Resolve an ordered local-execution chain from explicit steps or a prior intent chain suggestion" },
  { method: "POST", path: "/execute", auth: "none", description: "Report a local skill execution for telemetry; the server does not run the skill" },
  { method: "POST", path: "/validate/{skill_id}", auth: "api_key", description: "Report local test feedback (pass/fail counts) to update a skill's confidence score" },
  // Analytics
  { method: "GET", path: "/analytics/dashboards/{type}", auth: "none", description: "Dashboard data. type: intent-performance | execution-caching | skill-quality | evolution-gap | agent-behavior" },
  // Auth
  { method: "POST", path: "/auth/keys", auth: "api_key", description: "Create a child API key for the current agent account" },
  { method: "GET", path: "/auth/keys", auth: "api_key", description: "List API keys for the current agent account" },
  { method: "DELETE", path: "/auth/keys/{key_id}", auth: "api_key", description: "Revoke an API key" },
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
  api_key: "Pass X-Api-Key header with a beta key issued through Moltbook onboarding, or a child key created from an existing agent key",
  cognito: "Ops-only for now. Reserved for internal control and future human product flows",
};

export const handler: APIGatewayProxyHandler = async () => {
  return success(200, {
    service: "codevolve",
    version: "0.1.0",
    description: "AI-native registry of programming problems and reusable algorithmic skills. Canonical flow: route intent or use exact lookup, fetch skill details, run implementations locally, then report validation results if needed.",
    base_url: "https://api.codevolve.dev/v1",
    docs_url: DOCS_URL,
    openapi_url: OPENAPI_URL,
    auth_schemes: AUTH_SCHEMES,
    endpoints: ENDPOINTS,
  });
};
