/**
 * Standard API Gateway response helpers.
 *
 * All responses include CORS headers and consistent formatting.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import { encode as encodeToToon } from "@toon-format/toon";
import type { ApiError } from "./types.js";
import {
  contentTypeForResponseFormat,
  DEFAULT_RESPONSE_FORMAT,
  JSON_CONTENT_TYPE,
  resolveResponseFormat,
  type ResponseFormat,
} from "./responseFormat.js";

type ResponseContext = {
  format: ResponseFormat;
};

const responseContextStorage = new AsyncLocalStorage<ResponseContext>();

const BASE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,Accept,X-Request-Id,X-Agent-Id,Authorization,X-Api-Key",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  Vary: "Accept",
};

function currentResponseFormat(): ResponseFormat {
  return responseContextStorage.getStore()?.format ?? DEFAULT_RESPONSE_FORMAT;
}

function isProxyEvent(
  value: unknown,
): value is APIGatewayProxyEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "requestContext" in value &&
    "headers" in value
  );
}

function responseFormatFromEvent(
  event?: APIGatewayProxyEvent,
): ResponseFormat {
  return event ? resolveResponseFormat(event) : currentResponseFormat();
}

function headersFor(format: ResponseFormat): Record<string, string> {
  return {
    ...BASE_CORS_HEADERS,
    "Content-Type": contentTypeForResponseFormat(format),
  };
}

function serializeBody(format: ResponseFormat, body: unknown): string {
  return format === "toon"
    ? encodeToToon(body)
    : JSON.stringify(body);
}

export async function withResponseContext<T>(
  event: APIGatewayProxyEvent,
  fn: () => Promise<T>,
): Promise<T> {
  const format = resolveResponseFormat(event);
  return responseContextStorage.run({ format }, fn);
}

/**
 * Return a success response with the given status code and body.
 */
export function success(
  statusCode: number,
  body: unknown,
  event?: APIGatewayProxyEvent,
): APIGatewayProxyResult {
  const format = responseFormatFromEvent(event);

  return {
    statusCode,
    headers: headersFor(format),
    body: serializeBody(format, body),
  };
}

/**
 * Return an error response matching the ApiError schema.
 */
export function error(
  statusCode: number,
  code: string,
  message: string,
  detailsOrEvent?: Record<string, unknown> | APIGatewayProxyEvent,
  event?: APIGatewayProxyEvent,
): APIGatewayProxyResult {
  const details = isProxyEvent(detailsOrEvent)
    ? undefined
    : detailsOrEvent;
  const responseEvent = isProxyEvent(detailsOrEvent)
    ? detailsOrEvent
    : event;
  const errorBody: ApiError = {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
  const format = responseFormatFromEvent(responseEvent);

  return {
    statusCode,
    headers: headersFor(format),
    body: serializeBody(format, errorBody),
  };
}

export function noContent(
  statusCode = 204,
  _event?: APIGatewayProxyEvent,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: BASE_CORS_HEADERS,
    body: "",
  };
}

export function jsonHeaders(): Record<string, string> {
  return {
    ...BASE_CORS_HEADERS,
    "Content-Type": JSON_CONTENT_TYPE,
  };
}
