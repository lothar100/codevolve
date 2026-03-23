/**
 * codeVolve MCP Server — entry point
 *
 * Starts the stdio MCP server. Run via:
 *   node dist/mcp/index.js
 *
 * Environment variables:
 *   CODEVOLVE_API_URL  — base URL of the codeVolve REST API (default: prod URL)
 *   CODEVOLVE_API_KEY  — optional API key sent as x-api-key header
 */

import { startServer } from "./server.js";

startServer().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[codevolve-mcp] Fatal error: ${message}\n`);
  process.exit(1);
});
