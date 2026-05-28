import type { APIGatewayProxyEvent } from "aws-lambda";

export const RESPONSE_FORMAT_JSON = "json";
export const RESPONSE_FORMAT_TOON = "toon";
export const DEFAULT_RESPONSE_FORMAT = RESPONSE_FORMAT_JSON;

export type ResponseFormat =
  | typeof RESPONSE_FORMAT_JSON
  | typeof RESPONSE_FORMAT_TOON;

export const JSON_CONTENT_TYPE = "application/json";
export const TOON_CONTENT_TYPE = "text/toon; charset=utf-8";

function getHeader(
  headers: Record<string, string | undefined> | null | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }

  return undefined;
}

export function normalizeResponseFormat(value: unknown): ResponseFormat {
  return value === RESPONSE_FORMAT_TOON
    ? RESPONSE_FORMAT_TOON
    : DEFAULT_RESPONSE_FORMAT;
}

export function contentTypeForResponseFormat(
  format: ResponseFormat,
): string {
  return format === RESPONSE_FORMAT_TOON
    ? TOON_CONTENT_TYPE
    : JSON_CONTENT_TYPE;
}

export function resolveResponseFormat(
  event: Pick<APIGatewayProxyEvent, "headers" | "requestContext">,
): ResponseFormat {
  const accept = getHeader(event.headers, "accept");
  const acceptOverride = resolveResponseFormatFromAccept(accept);
  if (acceptOverride) {
    return acceptOverride;
  }

  const authorizerFormat =
    event.requestContext?.authorizer?.["response_format"];

  return normalizeResponseFormat(authorizerFormat);
}

function resolveResponseFormatFromAccept(
  acceptHeader: string | undefined,
): ResponseFormat | undefined {
  if (!acceptHeader) {
    return undefined;
  }

  const candidates = acceptHeader
    .split(",")
    .map((part, index) => {
      const [rawType, ...rawParams] = part.split(";");
      const mediaType = rawType.trim().toLowerCase();
      if (!mediaType) {
        return null;
      }

      let quality = 1;
      for (const rawParam of rawParams) {
        const [rawKey, rawValue] = rawParam.split("=");
        if (rawKey?.trim().toLowerCase() !== "q") {
          continue;
        }

        const parsed = Number(rawValue?.trim());
        if (!Number.isNaN(parsed)) {
          quality = parsed;
        }
      }

      return {
        index,
        mediaType,
        quality,
      };
    })
    .filter(
      (
        candidate,
      ): candidate is { index: number; mediaType: string; quality: number } =>
        candidate !== null && candidate.quality > 0,
    )
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const candidate of candidates) {
    if (
      candidate.mediaType === "text/toon" ||
      candidate.mediaType === "application/toon"
    ) {
      return RESPONSE_FORMAT_TOON;
    }

    if (
      candidate.mediaType === JSON_CONTENT_TYPE ||
      candidate.mediaType === "application/*" ||
      candidate.mediaType === "*/*"
    ) {
      return RESPONSE_FORMAT_JSON;
    }
  }

  return undefined;
}
