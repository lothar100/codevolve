import type { Config } from "jest";

const config: Config = {
  projects: [
    {
      displayName: "unit",
      preset: "ts-jest",
      testEnvironment: "node",
      testMatch: ["<rootDir>/tests/unit/**/*.test.ts"],
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
      preset: "ts-jest",
      testEnvironment: "node",
      testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
      moduleFileExtensions: ["ts", "js", "json"],
      moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
      },
      transform: {
        "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
      },
    },
  ],
};

export default config;
