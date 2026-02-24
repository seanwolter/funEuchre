import type { LobbyState } from "./lobby.js";
import type { LobbyId, PlayerId } from "./types.js";

type Clock = () => number;

export type LobbyStoreRecord = {
  lobbyId: LobbyId;
  state: LobbyState;
  createdAtMs: number;
  updatedAtMs: number;
};

export type LobbyStoreInput = {
  state: LobbyState;
};

export type InMemoryLobbyStoreOptions = {
  clock?: Clock;
  ttlMs?: number | null;
};

function cloneLobbyState(state: LobbyState): LobbyState {
  return {
    lobbyId: state.lobbyId,
    hostPlayerId: state.hostPlayerId,
    phase: state.phase,
    seats: state.seats.map((seat) => ({
      seat: seat.seat,
      team: seat.team,
      playerId: seat.playerId,
      displayName: seat.displayName,
      connected: seat.connected
    }))
  };
}

function cloneRecord(record: LobbyStoreRecord): LobbyStoreRecord {
  return {
    lobbyId: record.lobbyId,
    state: cloneLobbyState(record.state),
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs
  };
}

export class InMemoryLobbyStore {
  private readonly clock: Clock;
  private readonly ttlMs: number | null;
  private readonly byLobbyId = new Map<LobbyId, LobbyStoreRecord>();
  private readonly lobbyByPlayerId = new Map<PlayerId, LobbyId>();

  constructor(options: InMemoryLobbyStoreOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? null;
    if (this.ttlMs !== null && (!Number.isInteger(this.ttlMs) || this.ttlMs < 0)) {
      throw new Error("ttlMs must be a non-negative integer or null.");
    }
  }

  upsert(input: LobbyStoreInput): LobbyStoreRecord {
    const now = this.clock();
    const existing = this.byLobbyId.get(input.state.lobbyId);
    const createdAtMs = existing?.createdAtMs ?? now;

    const nextRecord: LobbyStoreRecord = {
      lobbyId: input.state.lobbyId,
      state: cloneLobbyState(input.state),
      createdAtMs,
      updatedAtMs: now
    };

    if (existing) {
      this.clearPlayerIndex(existing.state);
    }

    this.byLobbyId.set(nextRecord.lobbyId, nextRecord);
    this.setPlayerIndex(nextRecord.state);
    return cloneRecord(nextRecord);
  }

  getByLobbyId(lobbyId: LobbyId): LobbyStoreRecord | null {
    const record = this.byLobbyId.get(lobbyId);
    return record ? cloneRecord(record) : null;
  }

  findByPlayerId(playerId: PlayerId): LobbyStoreRecord | null {
    const lobbyId = this.lobbyByPlayerId.get(playerId);
    if (!lobbyId) {
      return null;
    }

    return this.getByLobbyId(lobbyId);
  }

  deleteByLobbyId(lobbyId: LobbyId): boolean {
    const record = this.byLobbyId.get(lobbyId);
    if (!record) {
      return false;
    }

    this.byLobbyId.delete(lobbyId);
    this.clearPlayerIndex(record.state);
    return true;
  }

  isExpired(record: Pick<LobbyStoreRecord, "updatedAtMs">, nowMs = this.clock()): boolean {
    if (this.ttlMs === null) {
      return false;
    }

    return nowMs - record.updatedAtMs > this.ttlMs;
  }

  pruneExpired(nowMs = this.clock()): LobbyId[] {
    const removed: LobbyId[] = [];
    for (const [lobbyId, record] of this.byLobbyId) {
      if (!this.isExpired(record, nowMs)) {
        continue;
      }

      this.byLobbyId.delete(lobbyId);
      this.clearPlayerIndex(record.state);
      removed.push(lobbyId);
    }

    return removed;
  }

  private setPlayerIndex(state: LobbyState): void {
    for (const seat of state.seats) {
      if (seat.playerId !== null) {
        this.lobbyByPlayerId.set(seat.playerId, state.lobbyId);
      }
    }
  }

  private clearPlayerIndex(state: LobbyState): void {
    for (const seat of state.seats) {
      if (seat.playerId !== null) {
        this.lobbyByPlayerId.delete(seat.playerId);
      }
    }
  }
}
