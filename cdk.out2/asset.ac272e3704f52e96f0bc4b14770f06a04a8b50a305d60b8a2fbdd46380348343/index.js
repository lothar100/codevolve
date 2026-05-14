"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/registry/discovery.ts
var discovery_exports = {};
__export(discovery_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(discovery_exports);

// src/shared/response.ts
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Accept,X-Request-Id,X-Agent-Id,Authorization,X-Api-Key",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Content-Type": "application/json"
};
function success(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

// src/registry/discovery.ts
var DOCS_URL = "https://codevolve.dev/docs";
var OPENAPI_URL = "https://api.codevolve.dev/v1/openapi.json";
var ENDPOINTS = [
  // Skills
  { method: "POST", path: "/skills", auth: "api_key", description: "Create a new skill" },
  { method: "GET", path: "/skills", auth: "none", description: "List / filter skills" },
  { method: "GET", path: "/skills/{id}", auth: "none", description: "Get a skill by ID (optionally with ?version=)" },
  { method: "GET", path: "/skills/{id}/versions", auth: "none", description: "List all versions of a skill" },
  { method: "POST", path: "/skills/{id}/promote-canonical", auth: "api_key", description: "Promote skill to canonical status" },
  { method: "POST", path: "/skills/{id}/archive", auth: "none", description: "Soft-archive a skill" },
  { method: "POST", path: "/skills/{id}/unarchive", auth: "none", description: "Restore an archived skill" },
  // Problems
  { method: "POST", path: "/problems", auth: "api_key", description: "Create a new problem" },
  { method: "GET", path: "/problems", auth: "none", description: "List / filter problems" },
  { method: "GET", path: "/problems/{id}", auth: "none", description: "Get a problem and all its skills" },
  // Core agent workflow
  { method: "POST", path: "/resolve", auth: "none", description: "Route a natural-language intent to the best matching skill" },
  { method: "POST", path: "/execute", auth: "none", description: "Execute a skill with given inputs (cache-aware)" },
  { method: "POST", path: "/execute/chain", auth: "none", description: "Execute a sequence of skills, piping outputs into inputs" },
  { method: "POST", path: "/validate/{skill_id}", auth: "api_key", description: "Run a skill's test suite and update its confidence score" },
  // Telemetry
  { method: "POST", path: "/events", auth: "api_key", description: "Emit analytics events (batch up to 100)" },
  // Analytics
  { method: "GET", path: "/analytics/dashboards/{type}", auth: "none", description: "Dashboard data. type: resolve-performance | execution-caching | skill-quality | evolution-gap | agent-behavior" },
  // Evolution
  { method: "POST", path: "/evolve", auth: "none", description: "Trigger async skill generation or improvement via Claude agent" },
  // Auth
  { method: "POST", path: "/auth/keys", auth: "api_key", description: "Create a new API key" },
  { method: "GET", path: "/auth/keys", auth: "api_key", description: "List API keys for the calling identity" },
  { method: "DELETE", path: "/auth/keys/{key_id}", auth: "api_key", description: "Revoke an API key" },
  // Users
  { method: "GET", path: "/users/me/trusted-mountain", auth: "cognito", description: "Get the authenticated user's personalised mountain view" },
  { method: "POST", path: "/users/me/trusted-mountain", auth: "cognito", description: "Update trusted mountain skill preferences" },
  { method: "DELETE", path: "/users/me/trusted-mountain/{skill_id}", auth: "cognito", description: "Remove a skill from the trusted mountain" },
  // Meta
  { method: "GET", path: "/health", auth: "none", description: "Service health check" },
  { method: "GET", path: "/", auth: "none", description: "This discovery document" }
];
var AUTH_SCHEMES = {
  none: "No authentication required",
  api_key: "Pass X-Api-Key header with a key obtained from POST /auth/keys",
  cognito: "Pass Authorization header with a Cognito JWT (Bearer token)"
};
var RATE_LIMITS = {
  "POST /resolve": "100 req/min",
  "POST /execute": "50 req/min",
  "POST /execute/chain": "20 req/min",
  "POST /validate/:id": "30 req/min",
  "POST /events": "10 req/min (up to 100 events per request \u2014 effective 1,000 events/min)",
  "POST /evolve": "5 req/min",
  "all other": "200 req/min"
};
var handler = async () => {
  return success(200, {
    service: "codevolve",
    version: "0.1.0",
    description: "AI-native registry of programming problems and reusable algorithmic skills",
    base_url: "https://api.codevolve.dev/v1",
    docs_url: DOCS_URL,
    openapi_url: OPENAPI_URL,
    auth_schemes: AUTH_SCHEMES,
    rate_limits: RATE_LIMITS,
    endpoints: ENDPOINTS
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
