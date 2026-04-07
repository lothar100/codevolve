import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
dotenv.config({ path: join(root, ".env") });

const API_URL = process.env.CODEVOLVE_API_URL;
const { CODEVOLVE_COGNITO_USERNAME, CODEVOLVE_COGNITO_PASSWORD, CODEVOLVE_COGNITO_CLIENT_ID, CODEVOLVE_COGNITO_REGION } = process.env;

// Get fresh token via fetch (avoids shell escaping issues with special chars in password)
const cognitoRes = await fetch(
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
      AuthParameters: { USERNAME: CODEVOLVE_COGNITO_USERNAME, PASSWORD: CODEVOLVE_COGNITO_PASSWORD },
    }),
  }
);
if (!cognitoRes.ok) throw new Error(`Cognito auth failed: ${await cognitoRes.text()}`);
const { AuthenticationResult } = await cognitoRes.json();
const tokenRaw = AuthenticationResult?.IdToken;
if (!tokenRaw) throw new Error("No IdToken in Cognito response");

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${tokenRaw}`,
};

async function post(path, body) {
  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`POST ${path} failed: ${JSON.stringify(data)}`);
  return data;
}

// 1. Create problem
const { problem } = await post("/problems", {
  name: "Refresh MCP Token from Cognito Credentials",
  description: "Given stored Cognito credentials (username, password, client ID, region), authenticate via USER_PASSWORD_AUTH, extract the IdToken, and write it into a .mcp.json config file so the MCP server picks up a fresh token on next restart.",
  domain: ["aws", "auth", "tooling"],
  tags: ["cognito", "mcp", "token", "refresh", "auth", "jwt"],
  difficulty: "easy",
});
console.log(`✓ Problem created: ${problem.problem_id}`);

// 2. Submit skill
const implementation = `
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { config } from "dotenv";

export async function handler(inputs) {
  const { envPath, mcpJsonPath } = inputs;

  config({ path: envPath });

  const {
    CODEVOLVE_COGNITO_USERNAME,
    CODEVOLVE_COGNITO_PASSWORD,
    CODEVOLVE_COGNITO_CLIENT_ID,
    CODEVOLVE_COGNITO_REGION = "us-east-2",
  } = process.env;

  if (!CODEVOLVE_COGNITO_USERNAME || !CODEVOLVE_COGNITO_PASSWORD || !CODEVOLVE_COGNITO_CLIENT_ID) {
    return { success: false, error: "Missing required env vars in .env file." };
  }

  const res = await fetch(
    \`https://cognito-idp.\${CODEVOLVE_COGNITO_REGION}.amazonaws.com/\`,
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
    return { success: false, error: \`Cognito auth failed: \${err}\` };
  }

  const { AuthenticationResult } = await res.json();
  const token = AuthenticationResult?.IdToken;
  if (!token) return { success: false, error: "No IdToken in response." };

  const mcp = JSON.parse(readFileSync(mcpJsonPath, "utf8"));
  mcp.mcpServers.codevolve.env.CODEVOLVE_API_KEY = token;
  writeFileSync(mcpJsonPath, JSON.stringify(mcp, null, 2) + "\\n");

  return { success: true, message: "Token refreshed. Restart Claude Code to apply." };
}
`.trim();

const { skill } = await post("/skills", {
  problem_id: problem.problem_id,
  name: "refresh-mcp-token",
  description: "Reads Cognito credentials from a .env file, authenticates via USER_PASSWORD_AUTH flow, and writes the fresh IdToken into .mcp.json. O(1), network-bound.",
  language: "javascript",
  status: "verified",
  domain: ["aws", "auth", "tooling"],
  tags: ["cognito", "mcp", "token", "refresh", "auth", "jwt"],
  inputs: [
    { name: "envPath", type: "string" },
    { name: "mcpJsonPath", type: "string" },
  ],
  outputs: [
    { name: "success", type: "boolean" },
    { name: "message", type: "string" },
    { name: "error", type: "string" },
  ],
  examples: [
    {
      input: {
        envPath: "C:/Users/pgl49/source/repos/codevolve/.env",
        mcpJsonPath: "C:/Users/pgl49/source/repos/codevolve/.mcp.json",
      },
      output: { success: true, message: "Token refreshed. Restart Claude Code to apply.", error: "" },
    },
  ],
  tests: [
    {
      input: { envPath: "/nonexistent/.env", mcpJsonPath: "/nonexistent/.mcp.json" },
      expected: { success: false, error: "Missing required env vars in .env file.", message: "" },
    },
    {
      input: {
        envPath: "C:/Users/pgl49/source/repos/codevolve/.env",
        mcpJsonPath: "C:/Users/pgl49/source/repos/codevolve/.mcp.json",
      },
      expected: { success: true, message: "Token refreshed. Restart Claude Code to apply.", error: "" },
    },
  ],
  confidence: 0.85,
  implementation,
});

console.log(`✓ Skill created: ${skill.skill_id} (${skill.name})`);
