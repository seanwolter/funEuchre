import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  parseLobbyId,
  parsePlayerId,
  parseReconnectTokenOrThrow,
  parseSessionId
} from "../domain/ids.js";
import type {
  LobbyId,
  PlayerId,
  ReconnectToken,
  SessionId
} from "../domain/types.js";

const TOKEN_PREFIX = "rt1";
const TOKEN_VERSION = 1;
const TOKEN_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const DEFAULT_ALLOWED_CLOCK_SKEW_MS = 5_000;

type TokenPayload = {
  v: number;
  sid: string;
  lid: string;
  pid: string;
  iat: number;
  n: string;
};

export type ReconnectTokenIssueInput = {
  sessionId: SessionId;
  lobbyId: LobbyId;
  playerId: PlayerId;
};

export type ReconnectTokenVerificationConstraints = {
  expectedSessionId?: SessionId;
  expectedLobbyId?: LobbyId;
  expectedPlayerId?: PlayerId;
};

export type ReconnectTokenClaims = {
  sessionId: SessionId;
  lobbyId: LobbyId;
  playerId: PlayerId;
  issuedAtMs: number;
};

export type ReconnectTokenVerificationFailureCode =
  | "MALFORMED"
  | "INVALID_SIGNATURE"
  | "INVALID_CLAIMS"
  | "EXPIRED";

export type ReconnectTokenVerificationFailure = {
  ok: false;
  code: ReconnectTokenVerificationFailureCode;
  message: string;
};

export type ReconnectTokenVerificationSuccess = {
  ok: true;
  claims: ReconnectTokenClaims;
};

export type ReconnectTokenVerificationResult =
  | ReconnectTokenVerificationSuccess
  | ReconnectTokenVerificationFailure;

export type ReconnectTokenManager = {
  issue(input: ReconnectTokenIssueInput): ReconnectToken;
  verify(
    token: ReconnectToken,
    constraints?: ReconnectTokenVerificationConstraints
  ): ReconnectTokenVerificationResult;
};

export type ReconnectTokenManagerOptions = {
  secret: string;
  maxAgeMs: number;
  now?: () => number;
  nonceBytes?: number;
  allowedClockSkewMs?: number;
};

let processFallbackSecret: string | null = null;

function isSafeSegment(value: string): boolean {
  return value.length > 0 && TOKEN_SEGMENT_PATTERN.test(value);
}

function signPayloadSegment(payloadSegment: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(payloadSegment)
    .digest("base64url");
}

function parseTokenPayload(
  payloadSegment: string
): {
  sessionId: SessionId;
  lobbyId: LobbyId;
  playerId: PlayerId;
  issuedAtMs: number;
} | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsedJson !== "object" || parsedJson === null || Array.isArray(parsedJson)) {
    return null;
  }
  const payload = parsedJson as Partial<TokenPayload>;
  if (payload.v !== TOKEN_VERSION) {
    return null;
  }
  const issuedAtMs = payload.iat;
  if (
    typeof issuedAtMs !== "number" ||
    !Number.isInteger(issuedAtMs) ||
    issuedAtMs < 0
  ) {
    return null;
  }
  if (typeof payload.n !== "string" || !isSafeSegment(payload.n)) {
    return null;
  }

  const sessionId = parseSessionId(payload.sid);
  const lobbyId = parseLobbyId(payload.lid);
  const playerId = parsePlayerId(payload.pid);
  if (!sessionId || !lobbyId || !playerId) {
    return null;
  }

  return {
    sessionId,
    lobbyId,
    playerId,
    issuedAtMs
  };
}

function verifySignature(
  payloadSegment: string,
  signatureSegment: string,
  secret: string
): boolean {
  if (!isSafeSegment(signatureSegment)) {
    return false;
  }

  const expected = signPayloadSegment(payloadSegment, secret);
  const actualBuffer = Buffer.from(signatureSegment);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function resolveReconnectTokenSecret(secret: string | null | undefined): string {
  if (typeof secret === "string" && secret.trim().length > 0) {
    return secret.trim();
  }

  if (processFallbackSecret === null) {
    processFallbackSecret = randomBytes(32).toString("base64url");
  }
  return processFallbackSecret;
}

export function createReconnectTokenManager(
  options: ReconnectTokenManagerOptions
): ReconnectTokenManager {
  const secret = options.secret.trim();
  const now = options.now ?? (() => Date.now());
  const maxAgeMs = options.maxAgeMs;
  const nonceBytes = options.nonceBytes ?? 12;
  const allowedClockSkewMs = options.allowedClockSkewMs ?? DEFAULT_ALLOWED_CLOCK_SKEW_MS;
  if (secret.length === 0) {
    throw new Error("Reconnect token secret must be non-empty.");
  }
  if (!Number.isInteger(maxAgeMs) || maxAgeMs < 1) {
    throw new Error("Reconnect token maxAgeMs must be an integer >= 1.");
  }
  if (!Number.isInteger(nonceBytes) || nonceBytes < 8) {
    throw new Error("Reconnect token nonceBytes must be an integer >= 8.");
  }
  if (!Number.isInteger(allowedClockSkewMs) || allowedClockSkewMs < 0) {
    throw new Error("Reconnect token allowedClockSkewMs must be an integer >= 0.");
  }

  function issue(input: ReconnectTokenIssueInput): ReconnectToken {
    const payload: TokenPayload = {
      v: TOKEN_VERSION,
      sid: input.sessionId,
      lid: input.lobbyId,
      pid: input.playerId,
      iat: now(),
      n: randomBytes(nonceBytes).toString("base64url")
    };
    const payloadSegment = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signatureSegment = signPayloadSegment(payloadSegment, secret);
    return parseReconnectTokenOrThrow(
      `${TOKEN_PREFIX}.${payloadSegment}.${signatureSegment}`
    );
  }

  function verify(
    token: ReconnectToken,
    constraints: ReconnectTokenVerificationConstraints = {}
  ): ReconnectTokenVerificationResult {
    const segments = token.split(".");
    if (segments.length !== 3) {
      return {
        ok: false,
        code: "MALFORMED",
        message: "Reconnect token is malformed."
      };
    }

    const [prefix, payloadSegmentRaw, signatureSegmentRaw] = segments;
    if (
      prefix !== TOKEN_PREFIX ||
      payloadSegmentRaw === undefined ||
      signatureSegmentRaw === undefined ||
      !isSafeSegment(payloadSegmentRaw) ||
      !isSafeSegment(signatureSegmentRaw)
    ) {
      return {
        ok: false,
        code: "MALFORMED",
        message: "Reconnect token is malformed."
      };
    }
    const payloadSegment = payloadSegmentRaw;
    const signatureSegment = signatureSegmentRaw;

    if (!verifySignature(payloadSegment, signatureSegment, secret)) {
      return {
        ok: false,
        code: "INVALID_SIGNATURE",
        message: "Reconnect token signature is invalid."
      };
    }

    const payload = parseTokenPayload(payloadSegment);
    if (!payload) {
      return {
        ok: false,
        code: "MALFORMED",
        message: "Reconnect token payload is malformed."
      };
    }

    const nowMs = now();
    if (payload.issuedAtMs > nowMs + allowedClockSkewMs) {
      return {
        ok: false,
        code: "INVALID_CLAIMS",
        message: "Reconnect token claims are invalid."
      };
    }
    if (nowMs > payload.issuedAtMs + maxAgeMs) {
      return {
        ok: false,
        code: "EXPIRED",
        message: "Reconnect token has expired."
      };
    }

    if (
      (constraints.expectedSessionId !== undefined &&
        constraints.expectedSessionId !== payload.sessionId) ||
      (constraints.expectedLobbyId !== undefined &&
        constraints.expectedLobbyId !== payload.lobbyId) ||
      (constraints.expectedPlayerId !== undefined &&
        constraints.expectedPlayerId !== payload.playerId)
    ) {
      return {
        ok: false,
        code: "INVALID_CLAIMS",
        message: "Reconnect token claims are invalid."
      };
    }

    return {
      ok: true,
      claims: {
        sessionId: payload.sessionId,
        lobbyId: payload.lobbyId,
        playerId: payload.playerId,
        issuedAtMs: payload.issuedAtMs
      }
    };
  }

  return {
    issue,
    verify
  };
}
