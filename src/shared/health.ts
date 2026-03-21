/**
 * Health check Lambda handler.
 *
 * Returns 200 with basic service info. Used as a smoke test
 * for the API Gateway deployment.
 */

import type { APIGatewayProxyHandler } from "aws-lambda";
import { success } from "./response.js";

export const handler: APIGatewayProxyHandler = async () => {
  return success(200, {
    status: "ok",
    version: "0.1.0",
    service: "codevolve",
  });
};
