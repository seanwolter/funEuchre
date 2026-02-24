import {
  LOBBY_PHASE_VALUES,
  SEAT_VALUES,
  TEAM_VALUES,
  type Team,
  type Seat
} from "@fun-euchre/protocol";
import type { GameState } from "@fun-euchre/game-rules";
import {
  parseGameId,
  parseLobbyId,
  parsePlayerId,
  parseReconnectToken,
  parseSessionId
} from "../../domain/ids.js";
import type { LobbyState } from "../../domain/lobby.js";
import type {
  RuntimeGameStorePort,
  RuntimeGameStoreRecord,
  RuntimeLobbyStorePort,
  RuntimeLobbyStoreRecord,
  RuntimeSessionStorePort,
  RuntimeSessionStoreRecord
} from "../../domain/runtimePorts.js";

export const RUNTIME_SNAPSHOT_SCHEMA = "fun-euchre.runtime.snapshot";
export const RUNTIME_SNAPSHOT_VERSION = 1 as const;

export type RuntimeSnapshot = {
  schema: typeof RUNTIME_SNAPSHOT_SCHEMA;
  version: typeof RUNTIME_SNAPSHOT_VERSION;
  generatedAtMs: number;
  lobbyRecords: RuntimeLobbyStoreRecord[];
  gameRecords: RuntimeGameStoreRecord[];
  sessionRecords: RuntimeSessionStoreRecord[];
};

export type RuntimeSnapshotDependencies = {
  lobbyStore: RuntimeLobbyStorePort;
  gameStore: RuntimeGameStorePort;
  sessionStore: RuntimeSessionStorePort;
};

export type ParseSnapshotResult =
  | {
      ok: true;
      snapshot: RuntimeSnapshot;
    }
  | {
      ok: false;
      message: string;
    };

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function deepClone<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

function asNonNegativeInteger(input: unknown, label: string): number {
  if (!Number.isInteger(input) || (input as number) < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return input as number;
}

function asNullableString(input: unknown, label: string): string | null {
  if (input === null) {
    return null;
  }
  if (typeof input !== "string") {
    throw new Error(`${label} must be a string or null.`);
  }
  return input;
}

function asBoolean(input: unknown, label: string): boolean {
  if (typeof input !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return input;
}

function asLobbyState(input: unknown, label: string): LobbyState {
  if (!isObject(input)) {
    throw new Error(`${label} must be an object.`);
  }

  const lobbyId = parseLobbyId(input.lobbyId);
  if (!lobbyId) {
    throw new Error(`${label}.lobbyId is invalid.`);
  }
  const hostPlayerId = parsePlayerId(input.hostPlayerId);
  if (!hostPlayerId) {
    throw new Error(`${label}.hostPlayerId is invalid.`);
  }
  if (
    typeof input.phase !== "string" ||
    !LOBBY_PHASE_VALUES.includes(input.phase as (typeof LOBBY_PHASE_VALUES)[number])
  ) {
    throw new Error(`${label}.phase is invalid.`);
  }
  if (!Array.isArray(input.seats)) {
    throw new Error(`${label}.seats must be an array.`);
  }

  const seats = input.seats.map((seatInput, index) => {
    if (!isObject(seatInput)) {
      throw new Error(`${label}.seats[${index}] must be an object.`);
    }
    if (
      typeof seatInput.seat !== "string" ||
      !SEAT_VALUES.includes(seatInput.seat as Seat)
    ) {
      throw new Error(`${label}.seats[${index}].seat is invalid.`);
    }
    if (
      typeof seatInput.team !== "string" ||
      !TEAM_VALUES.includes(seatInput.team as Team)
    ) {
      throw new Error(`${label}.seats[${index}].team is invalid.`);
    }

    const playerId =
      seatInput.playerId === null ? null : parsePlayerId(seatInput.playerId);
    if (seatInput.playerId !== null && !playerId) {
      throw new Error(`${label}.seats[${index}].playerId is invalid.`);
    }

    return {
      seat: seatInput.seat as Seat,
      team: seatInput.team as Team,
      playerId,
      displayName: asNullableString(
        seatInput.displayName,
        `${label}.seats[${index}].displayName`
      ),
      connected: asBoolean(seatInput.connected, `${label}.seats[${index}].connected`)
    };
  });

  return {
    lobbyId,
    hostPlayerId,
    phase: input.phase as (typeof LOBBY_PHASE_VALUES)[number],
    seats
  };
}

function asGameState(input: unknown, label: string): GameState {
  if (!isObject(input)) {
    throw new Error(`${label} must be an object.`);
  }

  return deepClone(input) as GameState;
}

function parseLobbyStoreRecord(input: unknown, index: number): RuntimeLobbyStoreRecord {
  const label = `lobbyRecords[${index}]`;
  if (!isObject(input)) {
    throw new Error(`${label} must be an object.`);
  }

  const lobbyId = parseLobbyId(input.lobbyId);
  if (!lobbyId) {
    throw new Error(`${label}.lobbyId is invalid.`);
  }

  return {
    lobbyId,
    state: asLobbyState(input.state, `${label}.state`),
    createdAtMs: asNonNegativeInteger(input.createdAtMs, `${label}.createdAtMs`),
    updatedAtMs: asNonNegativeInteger(input.updatedAtMs, `${label}.updatedAtMs`)
  };
}

function parseGameStoreRecord(input: unknown, index: number): RuntimeGameStoreRecord {
  const label = `gameRecords[${index}]`;
  if (!isObject(input)) {
    throw new Error(`${label} must be an object.`);
  }

  const gameId = parseGameId(input.gameId);
  if (!gameId) {
    throw new Error(`${label}.gameId is invalid.`);
  }
  const lobbyId = parseLobbyId(input.lobbyId);
  if (!lobbyId) {
    throw new Error(`${label}.lobbyId is invalid.`);
  }

  return {
    gameId,
    lobbyId,
    state: asGameState(input.state, `${label}.state`),
    createdAtMs: asNonNegativeInteger(input.createdAtMs, `${label}.createdAtMs`),
    updatedAtMs: asNonNegativeInteger(input.updatedAtMs, `${label}.updatedAtMs`)
  };
}

function parseSessionStoreRecord(input: unknown, index: number): RuntimeSessionStoreRecord {
  const label = `sessionRecords[${index}]`;
  if (!isObject(input)) {
    throw new Error(`${label} must be an object.`);
  }

  const sessionId = parseSessionId(input.sessionId);
  if (!sessionId) {
    throw new Error(`${label}.sessionId is invalid.`);
  }
  const playerId = parsePlayerId(input.playerId);
  if (!playerId) {
    throw new Error(`${label}.playerId is invalid.`);
  }
  const lobbyId = parseLobbyId(input.lobbyId);
  if (!lobbyId) {
    throw new Error(`${label}.lobbyId is invalid.`);
  }
  const reconnectToken = parseReconnectToken(input.reconnectToken);
  if (!reconnectToken) {
    throw new Error(`${label}.reconnectToken is invalid.`);
  }

  const gameId = input.gameId === null ? null : parseGameId(input.gameId);
  if (input.gameId !== null && !gameId) {
    throw new Error(`${label}.gameId is invalid.`);
  }

  const reconnectByMs =
    input.reconnectByMs === null
      ? null
      : asNonNegativeInteger(input.reconnectByMs, `${label}.reconnectByMs`);

  return {
    sessionId,
    playerId,
    lobbyId,
    gameId,
    reconnectToken,
    connected: asBoolean(input.connected, `${label}.connected`),
    reconnectByMs,
    createdAtMs: asNonNegativeInteger(input.createdAtMs, `${label}.createdAtMs`),
    updatedAtMs: asNonNegativeInteger(input.updatedAtMs, `${label}.updatedAtMs`)
  };
}

export function createRuntimeSnapshot(
  dependencies: RuntimeSnapshotDependencies,
  generatedAtMs = Date.now()
): RuntimeSnapshot {
  return {
    schema: RUNTIME_SNAPSHOT_SCHEMA,
    version: RUNTIME_SNAPSHOT_VERSION,
    generatedAtMs,
    lobbyRecords: dependencies.lobbyStore.listRecords().map((record) => deepClone(record)),
    gameRecords: dependencies.gameStore.listRecords().map((record) => deepClone(record)),
    sessionRecords: dependencies.sessionStore
      .listRecords()
      .map((record) => deepClone(record))
  };
}

export function applyRuntimeSnapshot(
  dependencies: RuntimeSnapshotDependencies,
  snapshot: RuntimeSnapshot
): void {
  dependencies.lobbyStore.replaceAll(snapshot.lobbyRecords);
  dependencies.gameStore.replaceAll(snapshot.gameRecords);
  dependencies.sessionStore.replaceAll(snapshot.sessionRecords);
}

export function parseRuntimeSnapshot(input: unknown): ParseSnapshotResult {
  try {
    if (!isObject(input)) {
      throw new Error("Snapshot document must be an object.");
    }
    if (input.schema !== RUNTIME_SNAPSHOT_SCHEMA) {
      throw new Error("Snapshot schema is not supported.");
    }
    if (input.version !== RUNTIME_SNAPSHOT_VERSION) {
      throw new Error("Snapshot version is not supported.");
    }
    if (!Array.isArray(input.lobbyRecords)) {
      throw new Error("snapshot.lobbyRecords must be an array.");
    }
    if (!Array.isArray(input.gameRecords)) {
      throw new Error("snapshot.gameRecords must be an array.");
    }
    if (!Array.isArray(input.sessionRecords)) {
      throw new Error("snapshot.sessionRecords must be an array.");
    }

    const snapshot: RuntimeSnapshot = {
      schema: RUNTIME_SNAPSHOT_SCHEMA,
      version: RUNTIME_SNAPSHOT_VERSION,
      generatedAtMs: asNonNegativeInteger(input.generatedAtMs, "snapshot.generatedAtMs"),
      lobbyRecords: input.lobbyRecords.map((record, index) =>
        parseLobbyStoreRecord(record, index)
      ),
      gameRecords: input.gameRecords.map((record, index) =>
        parseGameStoreRecord(record, index)
      ),
      sessionRecords: input.sessionRecords.map((record, index) =>
        parseSessionStoreRecord(record, index)
      )
    };

    return {
      ok: true,
      snapshot
    };
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message
    };
  }
}
