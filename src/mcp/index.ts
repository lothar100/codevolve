// MCP server entry point — runs main() from server.ts.
// This file is NOT imported in tests; server.ts is imported directly.

import { main } from "./server.js";

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
