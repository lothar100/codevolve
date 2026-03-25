/**
 * codeVolve MCP Server entry point.
 *
 * Run with: node dist/mcp/server.js
 *
 * Required environment variable:
 *   CODEVOLVE_API_URL — base URL of the codeVolve REST API
 *
 * Optional environment variables:
 *   CODEVOLVE_API_KEY    — forwarded as Authorization: Bearer {key}
 *   CODEVOLVE_AGENT_ID   — sent as X-Agent-Id header (default: mcp-server)
 *   CODEVOLVE_TIMEOUT_MS — HTTP request timeout in ms (default: 35000)
 */

export * from "./client.js";
export * from "./tools.js";
export * from "./resources.js";
