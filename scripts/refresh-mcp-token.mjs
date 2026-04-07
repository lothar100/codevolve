/**
 * Refreshes the Cognito ID token for the codeVolve MCP server and writes it
 * back into .mcp.json so the MCP server picks it up on next restart.
 *
 * Usage: node scripts/refresh-mcp-token.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env") });

const {
  CODEVOLVE_COGNITO_USERNAME,
  CODEVOLVE_COGNITO_PASSWORD,
  CODEVOLVE_COGNITO_CLIENT_ID,
  CODEVOLVE_COGNITO_REGION = "us-east-2",
} = process.env;

if (!CODEVOLVE_COGNITO_USERNAME || !CODEVOLVE_COGNITO_PASSWORD || !CODEVOLVE_COGNITO_CLIENT_ID) {
  console.error("Missing required env vars. Check your .env file.");
  process.exit(1);
}

const res = await fetch(
  `https://cognito-idp.${CODEVOLVE_COGNITO_REGION}.amazonaws.com/`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CODEVOLVE_COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: CODEVOLVE_COGNITO_USERNAME,
        PASSWORD: CODEVOLVE_COGNITO_PASSWORD,
      },
    }),
  }
);

if (!res.ok) {
  const err = await res.text();
  console.error("Cognito auth failed:", err);
  process.exit(1);
}

const { AuthenticationResult } = await res.json();
const token = AuthenticationResult?.IdToken;
if (!token) {
  console.error("No IdToken in response");
  process.exit(1);
}

const mcpPath = join(root, ".mcp.json");
const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
mcp.mcpServers.codevolve.env.CODEVOLVE_API_KEY = token;
writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + "\n");

console.log("✓ .mcp.json updated with fresh token (expires in 1 hour)");
console.log("  Restart Claude Code for the new token to take effect.");
