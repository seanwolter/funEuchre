import type {
  GameId,
  LobbyId,
  PlayerId,
  ReconnectToken,
  SessionId
} from "./types.js";
import { createNoopLogger, type StructuredLogger } from "../observability/logger.js";

type Clock = () => number;

export type SessionStoreRecord = {
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

export type SessionStoreInput = {
  sessionId: SessionId;
  playerId: PlayerId;
  lobbyId: LobbyId;
  gameId?: GameId | null;
  reconnectToken: ReconnectToken;
};

export type SessionIdentity = {
  sessionId: SessionId;
  playerId: PlayerId;
  lobbyId: LobbyId;
  reconnectToken: ReconnectToken;
};

export type InMemorySessionStoreOptions = {
  clock?: Clock;
  reconnectWindowMs?: number;
  ttlMs?: number | null;
  logger?: StructuredLogger;
};

export function toSessionIdentity(
  record: Pick<
    SessionStoreRecord,
    "sessionId" | "playerId" | "lobbyId" | "reconnectToken"
  >
): SessionIdentity {
  return {
    sessionId: record.sessionId,
    playerId: record.playerId,
    lobbyId: record.lobbyId,
    reconnectToken: record.reconnectToken
  };
}

function cloneRecord(record: SessionStoreRecord): SessionStoreRecord {
  return {
    sessionId: record.sessionId,
    playerId: record.playerId,
    lobbyId: record.lobbyId,
    gameId: record.gameId,
    reconnectToken: record.reconnectToken,
    connected: record.connected,
    reconnectByMs: record.reconnectByMs,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs
  };
}

export class InMemorySessionStore {
  private readonly clock: Clock;
  private readonly reconnectWindowMs: number;
  private readonly ttlMs: number | null;
  private readonly logger: StructuredLogger;
  private readonly bySessionId = new Map<SessionId, SessionStoreRecord>();
  private readonly sessionByPlayerId = new Map<PlayerId, SessionId>();
  private readonly sessionByReconnectToken = new Map<ReconnectToken, SessionId>();

  constructor(options: InMemorySessionStoreOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.reconnectWindowMs = options.reconnectWindowMs ?? 60_000;
    this.ttlMs = options.ttlMs ?? null;
    this.logger = options.logger ?? createNoopLogger();
    if (!Number.isInteger(this.reconnectWindowMs) || this.reconnectWindowMs < 0) {
      throw new Error("reconnectWindowMs must be a non-negative integer.");
    }
    if (this.ttlMs !== null && (!Number.isInteger(this.ttlMs) || this.ttlMs < 0)) {
      throw new Error("ttlMs must be a non-negative integer or null.");
    }
  }

  upsert(input: SessionStoreInput): SessionStoreRecord {
    this.deleteBySessionId(input.sessionId);
    const existingPlayerSessionId = this.sessionByPlayerId.get(input.playerId);
    if (existingPlayerSessionId) {
      this.deleteBySessionId(existingPlayerSessionId);
    }
    const existingReconnectSessionId = this.sessionByReconnectToken.get(input.reconnectToken);
    if (existingReconnectSessionId) {
      this.deleteBySessionId(existingReconnectSessionId);
    }

    const now = this.clock();
    const record: SessionStoreRecord = {
      sessionId: input.sessionId,
      playerId: input.playerId,
      lobbyId: input.lobbyId,
      gameId: input.gameId ?? null,
      reconnectToken: input.reconnectToken,
      connected: true,
      reconnectByMs: null,
      createdAtMs: now,
      updatedAtMs: now
    };

    this.bySessionId.set(record.sessionId, record);
    this.sessionByPlayerId.set(record.playerId, record.sessionId);
    this.sessionByReconnectToken.set(record.reconnectToken, record.sessionId);
    return cloneRecord(record);
  }

  getBySessionId(sessionId: SessionId): SessionStoreRecord | null {
    const record = this.bySessionId.get(sessionId);
    return record ? cloneRecord(record) : null;
  }

  findByPlayerId(playerId: PlayerId): SessionStoreRecord | null {
    const sessionId = this.sessionByPlayerId.get(playerId);
    if (!sessionId) {
      return null;
    }
    return this.getBySessionId(sessionId);
  }

  findByReconnectToken(reconnectToken: ReconnectToken): SessionStoreRecord | null {
    const sessionId = this.sessionByReconnectToken.get(reconnectToken);
    if (!sessionId) {
      return null;
    }
    return this.getBySessionId(sessionId);
  }

  setConnection(sessionId: SessionId, connected: boolean): SessionStoreRecord | null {
    const record = this.bySessionId.get(sessionId);
    if (!record) {
      return null;
    }

    const now = this.clock();
    const next: SessionStoreRecord = {
      ...record,
      connected,
      reconnectByMs: connected ? null : now + this.reconnectWindowMs,
      updatedAtMs: now
    };

    this.bySessionId.set(next.sessionId, next);
    if (record.connected !== connected) {
      if (connected) {
        this.logger.logReconnect({
          message: "Session reconnected.",
          lobbyId: next.lobbyId,
          gameId: next.gameId,
          playerId: next.playerId,
          requestId: null,
          metadata: {
            sessionId: next.sessionId
          }
        });
      } else {
        this.logger.logDisconnect({
          message: "Session disconnected.",
          lobbyId: next.lobbyId,
          gameId: next.gameId,
          playerId: next.playerId,
          requestId: null,
          metadata: {
            sessionId: next.sessionId,
            reconnectByMs: next.reconnectByMs
          }
        });
      }
    }
    return cloneRecord(next);
  }

  touch(sessionId: SessionId): SessionStoreRecord | null {
    const record = this.bySessionId.get(sessionId);
    if (!record) {
      return null;
    }

    const now = this.clock();
    const next: SessionStoreRecord = {
      ...record,
      updatedAtMs: now
    };
    this.bySessionId.set(next.sessionId, next);
    return cloneRecord(next);
  }

  deleteBySessionId(sessionId: SessionId): boolean {
    const record = this.bySessionId.get(sessionId);
    if (!record) {
      return false;
    }

    this.bySessionId.delete(sessionId);
    this.sessionByPlayerId.delete(record.playerId);
    this.sessionByReconnectToken.delete(record.reconnectToken);
    return true;
  }

  isReconnectExpired(
    record: Pick<SessionStoreRecord, "reconnectByMs">,
    nowMs = this.clock()
  ): boolean {
    return record.reconnectByMs !== null && nowMs > record.reconnectByMs;
  }

  isExpired(
    record: Pick<SessionStoreRecord, "updatedAtMs" | "reconnectByMs">,
    nowMs = this.clock()
  ): boolean {
    if (this.isReconnectExpired(record, nowMs)) {
      return true;
    }
    if (this.ttlMs === null) {
      return false;
    }

    return nowMs - record.updatedAtMs > this.ttlMs;
  }

  pruneExpired(nowMs = this.clock()): SessionId[] {
    const removed: SessionId[] = [];
    for (const [sessionId, record] of this.bySessionId) {
      if (!this.isExpired(record, nowMs)) {
        continue;
      }

      this.deleteBySessionId(sessionId);
      removed.push(sessionId);
    }

    return removed;
  }
}
