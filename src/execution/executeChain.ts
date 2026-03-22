/**
 * POST /execute/chain — Chain multiple skill executions sequentially.
 *
 * TODO IMPL-06: chain execution is a stub.
 * Full chaining implementation deferred to a Phase 2 follow-up task.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

export const handler = async (
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 501,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type,Accept,X-Request-Id,X-Agent-Id,Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Skill chaining is not yet implemented.",
      },
    }),
  };
};
