import type {
  ClientToServerEvent,
  Seat,
  ServerToClientEvent
} from "@fun-euchre/protocol";
import type { GameState } from "@fun-euchre/game-rules";
import type { LobbyId } from "./types.js";
import type { GameId } from "./types.js";
import {
  applyProtocolEventToGameState,
  toGamePrivateStateEventsBySeat,
  toActionRejectedEvent,
  type GameEventApplyResult
} from "./protocolAdapter.js";

type GameStoreSnapshot = {
  gameId: GameId;
  lobbyId: LobbyId;
  state: GameState;
};

type GameStorePort = {
  getByGameId(gameId: GameId): GameStoreSnapshot | null;
  upsert(input: {
    gameId: GameId;
    lobbyId: LobbyId;
    state: GameState;
  }): unknown;
};

type ProcessGameEventInput = {
  gameId: GameId;
  state: GameState;
  event: ClientToServerEvent;
};

export type ProcessGameEvent = (
  input: ProcessGameEventInput
) => GameEventApplyResult | Promise<GameEventApplyResult>;

export type GameManagerOptions = {
  gameStore: GameStorePort;
  processGameEvent?: ProcessGameEvent;
  maxTrackedRequestIdsPerGame?: number;
};

export type SubmitGameEventResult = {
  gameId: GameId;
  requestId: string;
  state: GameState | null;
  outbound: ServerToClientEvent[];
  privateOutboundBySeat: Partial<Record<Seat, ServerToClientEvent[]>>;
  persisted: boolean;
};

type RequestHistory = {
  order: string[];
  set: Set<string>;
};

const DEFAULT_MAX_TRACKED_REQUEST_IDS = 512;

export class GameManager {
  private readonly gameStore: GameStorePort;
  private readonly processGameEvent: ProcessGameEvent;
  private readonly maxTrackedRequestIdsPerGame: number;
  private readonly laneByGameId = new Map<GameId, Promise<void>>();
  private readonly requestHistoryByGameId = new Map<GameId, RequestHistory>();

  constructor(options: GameManagerOptions) {
    this.gameStore = options.gameStore;
    this.processGameEvent =
      options.processGameEvent ??
      ((input) => applyProtocolEventToGameState(input.gameId, input.state, input.event));
    this.maxTrackedRequestIdsPerGame =
      options.maxTrackedRequestIdsPerGame ?? DEFAULT_MAX_TRACKED_REQUEST_IDS;
    if (
      !Number.isInteger(this.maxTrackedRequestIdsPerGame) ||
      this.maxTrackedRequestIdsPerGame < 1
    ) {
      throw new Error("maxTrackedRequestIdsPerGame must be a positive integer.");
    }
  }

  submitEvent(gameId: GameId, event: ClientToServerEvent): Promise<SubmitGameEventResult> {
    return this.enqueueForGame(gameId, () => this.submitEventInternal(gameId, event));
  }

  private enqueueForGame<T>(gameId: GameId, work: () => Promise<T>): Promise<T> {
    const previousLane = this.laneByGameId.get(gameId) ?? Promise.resolve();
    const nextWork = previousLane.then(work, work);
    const nextLane = nextWork.then(
      () => undefined,
      () => undefined
    );

    this.laneByGameId.set(gameId, nextLane);
    void nextLane.finally(() => {
      if (this.laneByGameId.get(gameId) === nextLane) {
        this.laneByGameId.delete(gameId);
      }
    });

    return nextWork;
  }

  private async submitEventInternal(
    gameId: GameId,
    event: ClientToServerEvent
  ): Promise<SubmitGameEventResult> {
    const game = this.gameStore.getByGameId(gameId);
    if (!game) {
      this.requestHistoryByGameId.delete(gameId);
      return {
        gameId,
        requestId: event.requestId,
        state: null,
        outbound: [
          toActionRejectedEvent(
            event.requestId,
            "INVALID_STATE",
            `Game "${gameId}" was not found.`
          )
        ],
        privateOutboundBySeat: {},
        persisted: false
      };
    }

    if (this.isDuplicateRequestId(gameId, event.requestId)) {
      return {
        gameId,
        requestId: event.requestId,
        state: game.state,
        outbound: [
          toActionRejectedEvent(
            event.requestId,
            "INVALID_ACTION",
            `Duplicate requestId "${event.requestId}" for game "${gameId}".`
          )
        ],
        privateOutboundBySeat: this.privateOutboundBySeat(gameId, game.state),
        persisted: false
      };
    }

    const result = await this.processGameEvent({
      gameId,
      state: game.state,
      event
    });

    const persisted =
      result.state !== game.state ||
      result.outbound.some((outboundEvent) => outboundEvent.type === "game.state");
    if (persisted) {
      this.gameStore.upsert({
        gameId: game.gameId,
        lobbyId: game.lobbyId,
        state: result.state
      });
    }

    return {
      gameId,
      requestId: event.requestId,
      state: result.state,
      outbound: [...result.outbound],
      privateOutboundBySeat: this.privateOutboundBySeat(gameId, result.state),
      persisted
    };
  }

  private privateOutboundBySeat(
    gameId: GameId,
    state: GameState
  ): Partial<Record<Seat, ServerToClientEvent[]>> {
    const bySeat = toGamePrivateStateEventsBySeat(gameId, state);
    return {
      north: [bySeat.north],
      east: [bySeat.east],
      south: [bySeat.south],
      west: [bySeat.west]
    };
  }

  private isDuplicateRequestId(gameId: GameId, requestId: string): boolean {
    let history = this.requestHistoryByGameId.get(gameId);
    if (!history) {
      history = {
        order: [],
        set: new Set<string>()
      };
      this.requestHistoryByGameId.set(gameId, history);
    }

    if (history.set.has(requestId)) {
      return true;
    }

    history.set.add(requestId);
    history.order.push(requestId);
    if (history.order.length > this.maxTrackedRequestIdsPerGame) {
      const evicted = history.order.shift();
      if (evicted) {
        history.set.delete(evicted);
      }
    }

    return false;
  }
}
