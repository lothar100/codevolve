import type { Config } from "jest";
import path from "path";

// Normalize rootDir to use forward slashes so micromatch glob matching works
// correctly on Windows paths that contain special characters (e.g. "\.claude").
const ROOT_DIR = path.resolve(__dirname).replace(/\\/g, "/");

const config: Config = {
  rootDir: ROOT_DIR,
  projects: [
    {
      displayName: "unit",
      rootDir: ROOT_DIR,
      preset: "ts-jest",
      testEnvironment: "node",
      testMatch: [`${ROOT_DIR}/tests/unit/**/*.test.ts`],
      moduleFileExtensions: ["ts", "js", "json"],
      moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
      },
      transform: {
        "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
      },
    },
    {
      displayName: "integration",
      rootDir: ROOT_DIR,
      preset: "ts-jest",
      testEnvironment: "node",
      testMatch: [`${ROOT_DIR}/tests/integration/**/*.test.ts`],
      moduleFileExtensions: ["ts", "js", "json"],
      moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
      },
      transform: {
        "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
      },
    },
    {
      // Plain JS tests for the Node 22 skill runner (handler is JS, not TS)
      displayName: "runners",
      rootDir: ROOT_DIR,
      testEnvironment: "node",
      testMatch: [`${ROOT_DIR}/tests/unit/runners/**/*.test.js`],
      moduleFileExtensions: ["js", "json"],
    },
  ],
};

export default config;
