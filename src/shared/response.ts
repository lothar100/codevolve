/**
 * Standard API Gateway response helpers.
 *
 * All responses include CORS headers and consistent JSON formatting.
 */

import type { APIGatewayProxyResult } from "aws-lambda";
import type { ApiError } from "./types.js";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,Accept,X-Request-Id,X-Agent-Id,Authorization,X-Api-Key",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Content-Type": "application/json",
};

/**
 * Return a success response with the given status code and body.
 */
export function success(
  statusCode: number,
  body: unknown,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Return an error response matching the ApiError schema.
 */
export function error(
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): APIGatewayProxyResult {
  const errorBody: ApiError = {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(errorBody),
  };
}
