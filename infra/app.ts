#!/usr/bin/env node

/**
 * CDK app entry point for codeVolve.
 */

import * as cdk from "aws-cdk-lib";
import { CodevolveStack } from "./codevolve-stack";

const app = new cdk.App();

new CodevolveStack(app, "CodevolveStack", {
  env: {
    account: "178778217786",
    region: "us-east-2",
  },
  description: "codeVolve — AI-native skill registry",
});
