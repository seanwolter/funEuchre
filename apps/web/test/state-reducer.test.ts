import assert from "node:assert/strict";
import test from "node:test";
import type { ServerToClientEvent } from "@fun-euchre/protocol";
import { createGameStore } from "../src/state/gameStore.js";
import { toClientStateSnapshot } from "../src/state/reducer.js";

const lobbyStateEvent: ServerToClientEvent = {
  version: 1,
  type: "lobby.state",
  payload: {
    lobbyId: "lobby-1",
    hostPlayerId: "player-1",
    phase: "waiting",
    seats: [
      {
        seat: "north",
        team: "teamA",
        playerId: "player-1",
        displayName: "Host",
        connected: true
      },
      {
        seat: "east",
        team: "teamB",
        playerId: "player-2",
        displayName: "East",
        connected: true
      },
      {
        seat: "south",
        team: "teamA",
        playerId: null,
        displayName: null,
        connected: false
      },
      {
        seat: "west",
        team: "teamB",
        playerId: null,
        displayName: null,
        connected: false
      }
    ]
  }
};

const gameStateEvent: ServerToClientEvent = {
  version: 1,
  type: "game.state",
  payload: {
    gameId: "game-1",
    handNumber: 1,
    trickNumber: 0,
    dealer: "north",
    turn: "east",
    trump: null,
    phase: "round1_bidding",
    maker: null,
    alone: false,
    partnerSitsOut: null,
    scores: {
      teamA: 0,
      teamB: 0
    },
    bidding: {
      round: 1,
      turn: "east",
      upcardSuit: "clubs",
      turnedDownSuit: "clubs",
      passesInRound: 1,
      maker: null,
      trump: null,
      alone: false,
      availableTrumpSuits: ["clubs", "diamonds", "hearts", "spades"]
    },
    trick: {
      leader: "east",
      leadSuit: null,
      complete: false,
      winner: null,
      plays: []
    }
  }
};

const privateStateEvent: ServerToClientEvent = {
  version: 1,
  type: "game.private_state",
  payload: {
    gameId: "game-1",
    seat: "north",
    phase: "round1_bidding",
    handCardIds: ["clubs:9", "clubs:10", "hearts:ace", "spades:king", "diamonds:queen"],
    legalActions: {
      playableCardIds: [],
      canPass: true,
      canOrderUp: true,
      callableTrumpSuits: ["diamonds", "hearts", "spades"]
    }
  }
};

const noticeEvent: ServerToClientEvent = {
  version: 1,
  type: "system.notice",
  payload: {
    severity: "info",
    message: "Lobby synced."
  }
};

const rejectedEvent: ServerToClientEvent = {
  version: 1,
  type: "action.rejected",
  payload: {
    requestId: "req-1",
    code: "NOT_YOUR_TURN",
    message: "Action actor does not match current trick turn."
  }
};

test("HTTP and realtime event ingestion produce identical client snapshots", () => {
  const events: readonly ServerToClientEvent[] = [
    lobbyStateEvent,
    gameStateEvent,
    privateStateEvent,
    noticeEvent,
    rejectedEvent
  ];

  const httpStore = createGameStore();
  const httpResult = httpStore.dispatchEvents("http", events);
  assert.equal(httpResult.appliedCount, events.length);
  assert.equal(httpResult.ignoredDuplicateCount, 0);
  assert.equal(httpResult.ignoredStaleCount, 0);

  const realtimeStore = createGameStore();
  for (const event of events) {
    const result = realtimeStore.dispatchEvents("realtime", [event]);
    assert.equal(result.appliedCount, 1);
    assert.equal(result.ignoredDuplicateCount, 0);
    assert.equal(result.ignoredStaleCount, 0);
  }

  assert.deepEqual(
    toClientStateSnapshot(realtimeStore.getState()),
    toClientStateSnapshot(httpStore.getState())
  );
});

test("duplicate events from websocket after HTTP outbound are ignored deterministically", () => {
  const store = createGameStore();
  const first = store.dispatchEvents("http", [lobbyStateEvent, noticeEvent, rejectedEvent]);
  assert.equal(first.appliedCount, 3);

  const duplicateReplay = store.dispatchEvents("realtime", [
    lobbyStateEvent,
    noticeEvent,
    rejectedEvent
  ]);
  assert.equal(duplicateReplay.appliedCount, 0);
  assert.equal(duplicateReplay.ignoredDuplicateCount, 3);
  assert.equal(duplicateReplay.ignoredStaleCount, 0);

  const snapshot = toClientStateSnapshot(store.getState());
  assert.equal(snapshot.notices.length, 1);
  assert.equal(snapshot.rejections.length, 1);
});

test("out-of-order stale game projections are ignored and do not regress state", () => {
  const newerState: ServerToClientEvent = {
    version: 1,
    type: "game.state",
    payload: {
      gameId: "game-1",
      handNumber: 2,
      trickNumber: 1,
      dealer: "east",
      turn: "south",
      trump: "hearts",
      phase: "play",
      scores: {
        teamA: 1,
        teamB: 0
      },
      trick: {
        leader: "south",
        leadSuit: "hearts",
        complete: false,
        winner: null,
        plays: [
          {
            seat: "south",
            cardId: "hearts:ace"
          }
        ]
      }
    }
  };

  const staleState: ServerToClientEvent = {
    version: 1,
    type: "game.state",
    payload: {
      gameId: "game-1",
      handNumber: 1,
      trickNumber: 4,
      dealer: "north",
      turn: "west",
      trump: "spades",
      phase: "score",
      scores: {
        teamA: 0,
        teamB: 1
      }
    }
  };

  const store = createGameStore();
  const freshResult = store.dispatchEvents("realtime", [newerState]);
  assert.equal(freshResult.appliedCount, 1);

  const staleResult = store.dispatchEvents("realtime", [staleState]);
  assert.equal(staleResult.appliedCount, 0);
  assert.equal(staleResult.ignoredDuplicateCount, 0);
  assert.equal(staleResult.ignoredStaleCount, 1);

  const state = store.getState();
  assert.equal(state.game?.handNumber, 2);
  assert.equal(state.game?.trickNumber, 1);
  assert.equal(state.game?.phase, "play");
});
