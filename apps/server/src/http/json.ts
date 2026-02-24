import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RejectCode } from "@fun-euchre/protocol";

type JsonObject = Record<string, unknown>;

type JsonReadSuccess = {
  ok: true;
  data: JsonObject;
};

type JsonReadFailure = {
  ok: false;
  message: string;
};

export type JsonReadResult = JsonReadSuccess | JsonReadFailure;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
} as const;

function isJsonObject(input: unknown): input is JsonObject {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function normalizeHeaderValue(
  value: string | string[] | undefined
): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBytes = 1_000_000
): Promise<JsonReadResult> {
  let body = "";
  let size = 0;

  try {
    for await (const chunk of request) {
      const chunkText =
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      size += Buffer.byteLength(chunkText);
      if (size > maxBytes) {
        return {
          ok: false,
          message: `Request body exceeds ${maxBytes} bytes.`
        };
      }
      body += chunkText;
    }
  } catch {
    return {
      ok: false,
      message: "Unable to read request body."
    };
  }

  if (body.trim().length === 0) {
    return {
      ok: false,
      message: "Request body must be a JSON object."
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      ok: false,
      message: "Request body must be valid JSON."
    };
  }

  if (!isJsonObject(parsed)) {
    return {
      ok: false,
      message: "Request body must be a JSON object."
    };
  }

  return {
    ok: true,
    data: parsed
  };
}

export function resolveRequestId(
  request: IncomingMessage,
  body: JsonObject
): string {
  const bodyRequestId =
    typeof body.requestId === "string" ? body.requestId.trim() : "";
  if (bodyRequestId.length > 0) {
    return bodyRequestId;
  }

  const headerRequestId = normalizeHeaderValue(request.headers["x-request-id"]);
  if (headerRequestId) {
    return headerRequestId;
  }

  return randomUUID();
}

export function statusCodeForRejectCode(code: RejectCode): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 403;
    case "INVALID_STATE":
    case "NOT_YOUR_TURN":
      return 409;
    case "INVALID_ACTION":
      return 400;
  }
}

export function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(payload));
}

export function writeJsonError(
  response: ServerResponse,
  input: {
    statusCode: number;
    requestId: string | null;
    code: string;
    message: string;
    issues?: string[];
  }
): void {
  const payload: {
    requestId: string | null;
    error: {
      code: string;
      message: string;
      issues?: string[];
    };
  } = {
    requestId: input.requestId,
    error: {
      code: input.code,
      message: input.message
    }
  };
  if (input.issues && input.issues.length > 0) {
    payload.error.issues = input.issues;
  }

  writeJsonResponse(response, input.statusCode, payload);
}
