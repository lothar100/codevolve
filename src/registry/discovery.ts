/**
 * Discovery handler — GET /v1
 *
 * Returns a machine-readable index of all API endpoints, auth schemes,
 * rate limits, and pointers to documentation. Designed for AI agents
 * arriving at the API without prior context.
 */

import type { APIGatewayProxyHandler } from "aws-lambda";
import { success } from "../shared/response.js";

const DOCS_URL = "https://codevolve.dev/docs";
const OPENAPI_URL = "https://api.codevolve.dev/v1/openapi.json"; // future

const ENDPOINTS = [
  // Skills
  { method: "POST",   path: "/skills",                           auth: "api_key",  description: "Create a new skill" },
  { method: "GET",    path: "/skills",                           auth: "none",     description: "List / filter skills" },
  { method: "GET",    path: "/skills/{id}",                      auth: "none",     description: "Get a skill by ID (optionally with ?version=)" },
  { method: "GET",    path: "/skills/{id}/versions",             auth: "none",     description: "List all versions of a skill" },
  { method: "POST",   path: "/skills/{id}/promote-canonical",    auth: "api_key",  description: "Promote skill to canonical status" },
  { method: "POST",   path: "/skills/{id}/archive",              auth: "none",     description: "Soft-archive a skill" },
  { method: "POST",   path: "/skills/{id}/unarchive",            auth: "none",     description: "Restore an archived skill" },
  // Problems
  { method: "POST",   path: "/problems",                         auth: "api_key",  description: "Create a new problem" },
  { method: "GET",    path: "/problems",                         auth: "none",     description: "List / filter problems" },
  { method: "GET",    path: "/problems/{id}",                    auth: "none",     description: "Get a problem and all its skills" },
  // Core agent workflow
  { method: "POST",   path: "/intent",                           auth: "none",     description: "Route a natural-language intent to the best matching skill" },
  { method: "POST",   path: "/validate/{skill_id}",              auth: "api_key",  description: "Report local test results (pass/fail counts) to update a skill's confidence score" },
  // Telemetry
  { method: "POST",   path: "/events",                           auth: "api_key",  description: "Emit analytics events (batch up to 100)" },
  // Analytics
  { method: "GET",    path: "/analytics/dashboards/{type}",      auth: "none",     description: "Dashboard data. type: resolve-performance | execution-caching | skill-quality | evolution-gap | agent-behavior" },
  // Evolution
  { method: "POST",   path: "/evolve",                           auth: "none",     description: "Trigger async skill generation or improvement via Claude agent" },
  // Auth
  { method: "POST",   path: "/auth/keys",                        auth: "api_key",  description: "Create a new API key" },
  { method: "GET",    path: "/auth/keys",                        auth: "api_key",  description: "List API keys for the calling identity" },
  { method: "DELETE", path: "/auth/keys/{key_id}",               auth: "api_key",  description: "Revoke an API key" },
  // Users
  { method: "GET",    path: "/users/me/trusted-mountain",        auth: "cognito",  description: "Get the authenticated user's personalised mountain view" },
  { method: "POST",   path: "/users/me/trusted-mountain",        auth: "cognito",  description: "Update trusted mountain skill preferences" },
  { method: "DELETE", path: "/users/me/trusted-mountain/{skill_id}", auth: "cognito", description: "Remove a skill from the trusted mountain" },
  // Meta
  { method: "GET",    path: "/health",                           auth: "none",     description: "Service health check" },
  { method: "GET",    path: "/",                                 auth: "none",     description: "This discovery document" },
];

const AUTH_SCHEMES = {
  none: "No authentication required",
  api_key: "Pass X-Api-Key header with a key obtained from POST /auth/keys",
  cognito: "Pass Authorization header with a Cognito JWT (Bearer token)",
};

export const handler: APIGatewayProxyHandler = async () => {
  return success(200, {
    service: "codevolve",
    version: "0.1.0",
    description: "AI-native registry of programming problems and reusable algorithmic skills. Skills are local CLI tools — fetch implementations via /skills and run them in your own environment.",
    base_url: "https://api.codevolve.dev/v1",
    docs_url: DOCS_URL,
    openapi_url: OPENAPI_URL,
    auth_schemes: AUTH_SCHEMES,
    endpoints: ENDPOINTS,
  });
};
