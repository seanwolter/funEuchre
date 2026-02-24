import type { ServerToClientEvent } from "@fun-euchre/protocol";
import type { GameState } from "@fun-euchre/game-rules";
import type { LobbyState } from "./lobby.js";
import type {
  GameId,
  LobbyId,
  PlayerId,
  ReconnectToken,
  SessionId
} from "./types.js";

export type RuntimeLobbyStoreRecord = {
  lobbyId: LobbyId;
  state: LobbyState;
  createdAtMs: number;
  updatedAtMs: number;
};

export type RuntimeLobbyStoreInput = {
  state: LobbyState;
};

export type RuntimeLobbyStorePort = {
  upsert(input: RuntimeLobbyStoreInput): RuntimeLobbyStoreRecord;
  getByLobbyId(lobbyId: LobbyId): RuntimeLobbyStoreRecord | null;
  findByPlayerId(playerId: PlayerId): RuntimeLobbyStoreRecord | null;
  deleteByLobbyId(lobbyId: LobbyId): boolean;
  listRecords(): RuntimeLobbyStoreRecord[];
  replaceAll(records: readonly RuntimeLobbyStoreRecord[]): void;
  isExpired(
    record: Pick<RuntimeLobbyStoreRecord, "updatedAtMs">,
    nowMs?: number
  ): boolean;
  pruneExpired(nowMs?: number): LobbyId[];
};

export type RuntimeGameStoreRecord = {
  gameId: GameId;
  lobbyId: LobbyId;
  state: GameState;
  createdAtMs: number;
  updatedAtMs: number;
};

export type RuntimeGameStoreInput = {
  gameId: GameId;
  lobbyId: LobbyId;
  state: GameState;
};

export type RuntimeGameStorePort = {
  upsert(input: RuntimeGameStoreInput): RuntimeGameStoreRecord;
  getByGameId(gameId: GameId): RuntimeGameStoreRecord | null;
  findByLobbyId(lobbyId: LobbyId): RuntimeGameStoreRecord | null;
  deleteByGameId(gameId: GameId): boolean;
  listRecords(): RuntimeGameStoreRecord[];
  replaceAll(records: readonly RuntimeGameStoreRecord[]): void;
  isExpired(
    record: Pick<RuntimeGameStoreRecord, "updatedAtMs">,
    nowMs?: number
  ): boolean;
  pruneExpired(nowMs?: number): GameId[];
};

export type RuntimeSessionStoreRecord = {
  sessionId: SessionId;
  playerId: PlayerId;
  lobbyId: LobbyId;
  gameId: GameId | null;
  reconnectToken: ReconnectToken;
  connected: boolean;
  reconnectByMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type RuntimeSessionStoreInput = {
  sessionId: SessionId;
  playerId: PlayerId;
  lobbyId: LobbyId;
  gameId?: GameId | null;
  reconnectToken: ReconnectToken;
};

export type RuntimeSessionStorePort = {
  upsert(input: RuntimeSessionStoreInput): RuntimeSessionStoreRecord;
  getBySessionId(sessionId: SessionId): RuntimeSessionStoreRecord | null;
  findByPlayerId(playerId: PlayerId): RuntimeSessionStoreRecord | null;
  findByReconnectToken(reconnectToken: ReconnectToken): RuntimeSessionStoreRecord | null;
  setConnection(sessionId: SessionId, connected: boolean): RuntimeSessionStoreRecord | null;
  touch(sessionId: SessionId): RuntimeSessionStoreRecord | null;
  deleteBySessionId(sessionId: SessionId): boolean;
  listRecords(): RuntimeSessionStoreRecord[];
  replaceAll(records: readonly RuntimeSessionStoreRecord[]): void;
  isReconnectExpired(
    record: Pick<RuntimeSessionStoreRecord, "reconnectByMs">,
    nowMs?: number
  ): boolean;
  isExpired(
    record: Pick<RuntimeSessionStoreRecord, "updatedAtMs" | "reconnectByMs">,
    nowMs?: number
  ): boolean;
  pruneExpired(nowMs?: number): SessionId[];
};

export type RuntimeEventSink = (event: ServerToClientEvent) => void | Promise<void>;

export type RuntimeRealtimeRoomId = `lobby:${string}` | `game:${string}`;

export type RuntimeSocketSessionConnection = {
  sessionId: SessionId;
  send: RuntimeEventSink;
};

export type RuntimePublishSuccess = {
  ok: true;
  deliveredSessionIds: SessionId[];
  deliveredEventCount: number;
};

export type RuntimePublishFailure = {
  ok: false;
  code: "UNAUTHORIZED_SOURCE";
  message: string;
  deliveredSessionIds: SessionId[];
  deliveredEventCount: number;
};

export type RuntimePublishResult = RuntimePublishSuccess | RuntimePublishFailure;

export type RuntimeRealtimeFanoutPort = {
  connectSession(connection: RuntimeSocketSessionConnection): void;
  hasSession(sessionId: SessionId): boolean;
  disconnectSession(sessionId: SessionId): void;
  bindSessionToLobby(sessionId: SessionId, lobbyId: LobbyId): boolean;
  unbindSessionFromLobby(sessionId: SessionId, lobbyId: LobbyId): boolean;
  bindSessionToGame(sessionId: SessionId, gameId: GameId): boolean;
  unbindSessionFromGame(sessionId: SessionId, gameId: GameId): boolean;
  listSessionRooms(sessionId: SessionId): RuntimeRealtimeRoomId[];
  sendSessionEvents(
    sessionId: SessionId,
    events: readonly ServerToClientEvent[]
  ): Promise<number>;
  broadcastLobbyEvents(
    lobbyId: LobbyId,
    events: readonly ServerToClientEvent[]
  ): Promise<RuntimePublishResult>;
  broadcastGameEvents(
    gameId: GameId,
    events: readonly ServerToClientEvent[]
  ): Promise<RuntimePublishResult>;
};
