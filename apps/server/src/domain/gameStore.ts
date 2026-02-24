import type { GameState } from "@fun-euchre/game-rules";
import type { RuntimeGameStorePort } from "./runtimePorts.js";
import type { GameId, LobbyId } from "./types.js";

type Clock = () => number;

export type GameStoreRecord = {
  gameId: GameId;
  lobbyId: LobbyId;
  state: GameState;
  createdAtMs: number;
  updatedAtMs: number;
};

export type GameStoreInput = {
  gameId: GameId;
  lobbyId: LobbyId;
  state: GameState;
};

export type InMemoryGameStoreOptions = {
  clock?: Clock;
  ttlMs?: number | null;
};

function cloneGameState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function cloneRecord(record: GameStoreRecord): GameStoreRecord {
  return {
    gameId: record.gameId,
    lobbyId: record.lobbyId,
    state: cloneGameState(record.state),
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs
  };
}

export class InMemoryGameStore implements RuntimeGameStorePort {
  private readonly clock: Clock;
  private readonly ttlMs: number | null;
  private readonly byGameId = new Map<GameId, GameStoreRecord>();
  private readonly gameByLobbyId = new Map<LobbyId, GameId>();

  constructor(options: InMemoryGameStoreOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? null;
    if (this.ttlMs !== null && (!Number.isInteger(this.ttlMs) || this.ttlMs < 0)) {
      throw new Error("ttlMs must be a non-negative integer or null.");
    }
  }

  upsert(input: GameStoreInput): GameStoreRecord {
    const now = this.clock();
    const existing = this.byGameId.get(input.gameId);
    const createdAtMs = existing?.createdAtMs ?? now;

    const nextRecord: GameStoreRecord = {
      gameId: input.gameId,
      lobbyId: input.lobbyId,
      state: cloneGameState(input.state),
      createdAtMs,
      updatedAtMs: now
    };

    if (existing && existing.lobbyId !== input.lobbyId) {
      this.gameByLobbyId.delete(existing.lobbyId);
    }

    this.byGameId.set(nextRecord.gameId, nextRecord);
    this.gameByLobbyId.set(nextRecord.lobbyId, nextRecord.gameId);
    return cloneRecord(nextRecord);
  }

  getByGameId(gameId: GameId): GameStoreRecord | null {
    const record = this.byGameId.get(gameId);
    return record ? cloneRecord(record) : null;
  }

  findByLobbyId(lobbyId: LobbyId): GameStoreRecord | null {
    const gameId = this.gameByLobbyId.get(lobbyId);
    if (!gameId) {
      return null;
    }

    return this.getByGameId(gameId);
  }

  deleteByGameId(gameId: GameId): boolean {
    const record = this.byGameId.get(gameId);
    if (!record) {
      return false;
    }

    this.byGameId.delete(gameId);
    this.gameByLobbyId.delete(record.lobbyId);
    return true;
  }

  listRecords(): GameStoreRecord[] {
    return [...this.byGameId.values()].map((record) => cloneRecord(record));
  }

  replaceAll(records: readonly GameStoreRecord[]): void {
    this.byGameId.clear();
    this.gameByLobbyId.clear();

    for (const record of records) {
      const cloned = cloneRecord(record);
      this.byGameId.set(cloned.gameId, cloned);
      this.gameByLobbyId.set(cloned.lobbyId, cloned.gameId);
    }
  }

  isExpired(record: Pick<GameStoreRecord, "updatedAtMs">, nowMs = this.clock()): boolean {
    if (this.ttlMs === null) {
      return false;
    }

    return nowMs - record.updatedAtMs > this.ttlMs;
  }

  pruneExpired(nowMs = this.clock()): GameId[] {
    const removed: GameId[] = [];
    for (const [gameId, record] of this.byGameId) {
      if (!this.isExpired(record, nowMs)) {
        continue;
      }

      this.byGameId.delete(gameId);
      this.gameByLobbyId.delete(record.lobbyId);
      removed.push(gameId);
    }

    return removed;
  }
}
