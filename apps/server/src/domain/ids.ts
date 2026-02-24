import type {
  DomainIdFactory,
  GameId,
  LobbyId,
  PlayerId,
  ReconnectToken,
  SessionId
} from "./types.js";

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i;

type IncrementalIdFactoryOptions = {
  prefix?: string;
  startAt?: number;
};

function asIdentifier(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (!IDENTIFIER_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function asDomainId<T extends string>(input: unknown): T | null {
  const parsed = asIdentifier(input);
  return parsed === null ? null : (parsed as T);
}

function mustParse<T extends string>(label: string, input: unknown): T {
  const parsed = asDomainId<T>(input);
  if (!parsed) {
    throw new Error(`Invalid ${label}.`);
  }

  return parsed;
}

export function parseLobbyId(input: unknown): LobbyId | null {
  return asDomainId<LobbyId>(input);
}

export function parseGameId(input: unknown): GameId | null {
  return asDomainId<GameId>(input);
}

export function parsePlayerId(input: unknown): PlayerId | null {
  return asDomainId<PlayerId>(input);
}

export function parseSessionId(input: unknown): SessionId | null {
  return asDomainId<SessionId>(input);
}

export function parseReconnectToken(input: unknown): ReconnectToken | null {
  return asDomainId<ReconnectToken>(input);
}

export function parseLobbyIdOrThrow(input: unknown): LobbyId {
  return mustParse<LobbyId>("lobbyId", input);
}

export function parseGameIdOrThrow(input: unknown): GameId {
  return mustParse<GameId>("gameId", input);
}

export function parsePlayerIdOrThrow(input: unknown): PlayerId {
  return mustParse<PlayerId>("playerId", input);
}

export function parseSessionIdOrThrow(input: unknown): SessionId {
  return mustParse<SessionId>("sessionId", input);
}

export function parseReconnectTokenOrThrow(input: unknown): ReconnectToken {
  return mustParse<ReconnectToken>("reconnectToken", input);
}

export function isLobbyId(input: unknown): input is LobbyId {
  return parseLobbyId(input) !== null;
}

export function isGameId(input: unknown): input is GameId {
  return parseGameId(input) !== null;
}

export function isPlayerId(input: unknown): input is PlayerId {
  return parsePlayerId(input) !== null;
}

export function isSessionId(input: unknown): input is SessionId {
  return parseSessionId(input) !== null;
}

export function isReconnectToken(input: unknown): input is ReconnectToken {
  return parseReconnectToken(input) !== null;
}

export function createIncrementalIdFactory(
  options: IncrementalIdFactoryOptions = {}
): DomainIdFactory {
  const prefix = options.prefix ?? "local";
  let sequence = options.startAt ?? 0;
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error("startAt must be a non-negative integer.");
  }

  function nextValue(kind: string): string {
    sequence += 1;
    return `${prefix}-${kind}-${sequence}`;
  }

  return {
    nextLobbyId: () => parseLobbyIdOrThrow(nextValue("lobby")),
    nextGameId: () => parseGameIdOrThrow(nextValue("game")),
    nextPlayerId: () => parsePlayerIdOrThrow(nextValue("player")),
    nextSessionId: () => parseSessionIdOrThrow(nextValue("session")),
    nextReconnectToken: () => parseReconnectTokenOrThrow(nextValue("reconnect"))
  };
}
