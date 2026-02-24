import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_VERSION, type ClientToServerEvent, type GamePlayCardEvent } from "@fun-euchre/protocol";
import { createInitialGameState, createTeamScore, createTrickState, type Card, type GameState } from "@fun-euchre/game-rules";
import { parseGameIdOrThrow, parseLobbyIdOrThrow } from "../src/domain/ids.js";
import { InMemoryGameStore } from "../src/domain/gameStore.js";
import { GameManager } from "../src/domain/gameManager.js";
import { toGameStateEvent } from "../src/domain/protocolAdapter.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

const GAME_ID = parseGameIdOrThrow("game-1");
const LOBBY_ID = parseLobbyIdOrThrow("lobby-1");

function createDeferred<T>(): Deferred<T> {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  if (!resolve) {
    throw new Error("Failed to initialize deferred resolver.");
  }
  return { promise, resolve };
}

function card(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

function buildPlayState(): GameState {
  const base = createInitialGameState({
    dealer: "north",
    handNumber: 1,
    scores: createTeamScore(0, 0)
  });

  return {
    ...base,
    phase: "play",
    hands: {
      north: [card("clubs", "9")],
      east: [card("clubs", "A")],
      south: [card("spades", "9")],
      west: [card("diamonds", "9")]
    },
    upcard: card("hearts", "10"),
    kitty: [card("clubs", "10"), card("clubs", "J"), card("clubs", "Q")],
    bidding: null,
    trump: "hearts",
    maker: "north",
    alone: false,
    partnerSitsOut: null,
    trick: createTrickState("north", "hearts"),
    tricksWon: createTeamScore(),
    lastHand: null,
    winner: null
  };
}

function playCardEvent(
  requestId: string,
  actorSeat: "north" | "east" | "south" | "west",
  cardId: string,
  gameId = "game-1"
): GamePlayCardEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "game.play_card",
    requestId,
    payload: {
      gameId,
      actorSeat,
      cardId
    }
  };
}

function seedGame(
  store: InMemoryGameStore,
  gameId = GAME_ID,
  lobbyId = LOBBY_ID
): GameState {
  const state = buildPlayState();
  store.upsert({
    gameId,
    lobbyId,
    state
  });
  return state;
}

test("GameManager serializes concurrent submissions for the same game in strict order", async () => {
  const store = new InMemoryGameStore();
  seedGame(store);

  const firstStarted = createDeferred<void>();
  const releaseFirst = createDeferred<void>();
  const callOrder: string[] = [];

  const manager = new GameManager({
    gameStore: store,
    processGameEvent: async ({ gameId, state, event }) => {
      callOrder.push(`start:${event.requestId}`);
      if (event.requestId === "req-1") {
        firstStarted.resolve(undefined);
        await releaseFirst.promise;
      }

      const nextState: GameState = {
        ...state,
        handNumber: state.handNumber + 1
      };
      callOrder.push(`end:${event.requestId}`);
      return {
        state: nextState,
        outbound: [toGameStateEvent(gameId, nextState)]
      };
    }
  });

  const first = manager.submitEvent(
    GAME_ID,
    playCardEvent("req-1", "north", "clubs:9") as unknown as ClientToServerEvent
  );
  const second = manager.submitEvent(
    GAME_ID,
    playCardEvent("req-2", "east", "clubs:A") as unknown as ClientToServerEvent
  );

  await firstStarted.promise;
  await Promise.resolve();
  assert.deepEqual(callOrder, ["start:req-1"]);

  releaseFirst.resolve(undefined);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(callOrder, ["start:req-1", "end:req-1", "start:req-2", "end:req-2"]);
  assert.equal(firstResult.persisted, true);
  assert.equal(secondResult.persisted, true);

  const stored = store.getByGameId(GAME_ID);
  assert.ok(stored);
  assert.equal(stored.state.handNumber, buildPlayState().handNumber + 2);
});

test("GameManager queue is scoped per game and does not block a different game", async () => {
  const store = new InMemoryGameStore();
  const gameOneId = parseGameIdOrThrow("game-A");
  const gameTwoId = parseGameIdOrThrow("game-B");
  const lobbyOneId = parseLobbyIdOrThrow("lobby-A");
  const lobbyTwoId = parseLobbyIdOrThrow("lobby-B");
  seedGame(store, gameOneId, lobbyOneId);
  seedGame(store, gameTwoId, lobbyTwoId);

  const gate = createDeferred<void>();
  const gameOneStarted = createDeferred<void>();
  const callOrder: string[] = [];

  const manager = new GameManager({
    gameStore: store,
    processGameEvent: async ({ gameId, state, event }) => {
      callOrder.push(`start:${gameId}:${event.requestId}`);
      if (gameId === gameOneId) {
        gameOneStarted.resolve(undefined);
        await gate.promise;
      }
      const nextState: GameState = {
        ...state,
        handNumber: state.handNumber + 1
      };
      callOrder.push(`end:${gameId}:${event.requestId}`);
      return {
        state: nextState,
        outbound: [toGameStateEvent(gameId, nextState)]
      };
    }
  });

  const blocked = manager.submitEvent(gameOneId, playCardEvent("req-A", "north", "clubs:9"));
  await gameOneStarted.promise;

  const otherGame = await manager.submitEvent(gameTwoId, playCardEvent("req-B", "north", "clubs:9", "game-B"));
  assert.equal(otherGame.persisted, true);
  assert.equal(otherGame.outbound[0]?.type, "game.state");
  assert.deepEqual(callOrder, ["start:game-A:req-A", "start:game-B:req-B", "end:game-B:req-B"]);

  gate.resolve(undefined);
  await blocked;
  assert.deepEqual(callOrder, [
    "start:game-A:req-A",
    "start:game-B:req-B",
    "end:game-B:req-B",
    "end:game-A:req-A"
  ]);
});

test("GameManager rejects duplicate request ids consistently", async () => {
  const store = new InMemoryGameStore();
  seedGame(store);
  const manager = new GameManager({ gameStore: store });

  const initial = playCardEvent("req-dup", "north", "clubs:9");
  const first = await manager.submitEvent(GAME_ID, initial);
  assert.equal(first.persisted, true);
  assert.equal(first.outbound[0]?.type, "game.state");

  const duplicate = await manager.submitEvent(GAME_ID, initial);
  assert.equal(duplicate.persisted, false);
  assert.deepEqual(duplicate.outbound, [
    {
      version: PROTOCOL_VERSION,
      type: "action.rejected",
      payload: {
        requestId: "req-dup",
        code: "INVALID_ACTION",
        message: 'Duplicate requestId "req-dup" for game "game-1".'
      }
    }
  ]);

  const afterDuplicate = store.getByGameId(GAME_ID);
  assert.ok(afterDuplicate);
  assert.deepEqual(afterDuplicate.state, first.state);
});

test("GameManager rejects late actions without persisting a new state", async () => {
  const store = new InMemoryGameStore();
  seedGame(store);
  const manager = new GameManager({ gameStore: store });

  const first = await manager.submitEvent(
    GAME_ID,
    playCardEvent("req-first", "north", "clubs:9")
  );
  assert.equal(first.persisted, true);

  const late = await manager.submitEvent(
    GAME_ID,
    playCardEvent("req-late", "north", "clubs:9")
  );
  assert.equal(late.persisted, false);
  assert.deepEqual(late.outbound, [
    {
      version: PROTOCOL_VERSION,
      type: "action.rejected",
      payload: {
        requestId: "req-late",
        code: "NOT_YOUR_TURN",
        message: "Action actor does not match current trick turn."
      }
    }
  ]);

  const stored = store.getByGameId(GAME_ID);
  assert.ok(stored);
  assert.deepEqual(stored.state, first.state);
});
