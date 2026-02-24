import assert from "node:assert/strict";
import test from "node:test";
import type { ServerToClientEvent } from "@fun-euchre/protocol";
import { createGameStore } from "../src/state/gameStore.js";
import { toClientStateSnapshot } from "../src/state/reducer.js";

const goldenContractSequenceRaw: readonly ServerToClientEvent[] = [
  {
    version: 1,
    type: "lobby.state",
    payload: {
      lobbyId: "contract-lobby-1",
      hostPlayerId: "player-host",
      phase: "waiting",
      seats: [
        {
          seat: "north",
          team: "teamA",
          playerId: "player-host",
          displayName: "Host",
          connected: true
        },
        {
          seat: "east",
          team: "teamB",
          playerId: null,
          displayName: null,
          connected: false
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
  },
  {
    version: 1,
    type: "lobby.state",
    payload: {
      lobbyId: "contract-lobby-1",
      hostPlayerId: "player-host",
      phase: "waiting",
      seats: [
        {
          seat: "north",
          team: "teamA",
          playerId: "player-host",
          displayName: "Host",
          connected: true
        },
        {
          seat: "east",
          team: "teamB",
          playerId: "player-east",
          displayName: "East",
          connected: true
        },
        {
          seat: "south",
          team: "teamA",
          playerId: "player-south",
          displayName: "South",
          connected: true
        },
        {
          seat: "west",
          team: "teamB",
          playerId: "player-west",
          displayName: "West",
          connected: true
        }
      ]
    }
  },
  {
    version: 1,
    type: "lobby.state",
    payload: {
      lobbyId: "contract-lobby-1",
      hostPlayerId: "player-host",
      phase: "in_game",
      seats: [
        {
          seat: "north",
          team: "teamA",
          playerId: "player-host",
          displayName: "Host",
          connected: true
        },
        {
          seat: "east",
          team: "teamB",
          playerId: "player-east",
          displayName: "East Reconnected",
          connected: true
        },
        {
          seat: "south",
          team: "teamA",
          playerId: "player-south",
          displayName: "South",
          connected: true
        },
        {
          seat: "west",
          team: "teamB",
          playerId: "player-west",
          displayName: "West",
          connected: true
        }
      ]
    }
  },
  {
    version: 1,
    type: "game.state",
    payload: {
      gameId: "contract-game-1",
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
        passesInRound: 0,
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
  },
  {
    version: 1,
    type: "game.state",
    payload: {
      gameId: "contract-game-1",
      handNumber: 1,
      trickNumber: 0,
      dealer: "north",
      turn: "south",
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
        turn: "south",
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
  },
  {
    version: 1,
    type: "action.rejected",
    payload: {
      requestId: "contract-play-illegal",
      code: "INVALID_STATE",
      message: "play_card is only allowed during play phase."
    }
  },
  {
    version: 1,
    type: "lobby.state",
    payload: {
      lobbyId: "contract-lobby-1",
      hostPlayerId: "player-host",
      phase: "in_game",
      seats: [
        {
          seat: "north",
          team: "teamA",
          playerId: "player-host",
          displayName: "Host",
          connected: true
        },
        {
          seat: "east",
          team: "teamB",
          playerId: "player-east",
          displayName: "East",
          connected: false
        },
        {
          seat: "south",
          team: "teamA",
          playerId: "player-south",
          displayName: "South",
          connected: true
        },
        {
          seat: "west",
          team: "teamB",
          playerId: "player-west",
          displayName: "West",
          connected: true
        }
      ]
    }
  },
  {
    version: 1,
    type: "lobby.state",
    payload: {
      lobbyId: "contract-lobby-1",
      hostPlayerId: "player-host",
      phase: "in_game",
      seats: [
        {
          seat: "north",
          team: "teamA",
          playerId: "player-host",
          displayName: "Host",
          connected: true
        },
        {
          seat: "east",
          team: "teamB",
          playerId: "player-east",
          displayName: "East",
          connected: true
        },
        {
          seat: "south",
          team: "teamA",
          playerId: "player-south",
          displayName: "South",
          connected: true
        },
        {
          seat: "west",
          team: "teamB",
          playerId: "player-west",
          displayName: "West",
          connected: true
        }
      ]
    }
  },
  {
    version: 1,
    type: "game.state",
    payload: {
      gameId: "contract-game-1",
      handNumber: 1,
      trickNumber: 0,
      dealer: "north",
      turn: "south",
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
        turn: "south",
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
  }
];

const GOLDEN_SEQUENCE_BY_EVENT = [1, 2, 3, 1, 2, 3, 4, 5, 2] as const;

const goldenContractSequence: readonly ServerToClientEvent[] =
  goldenContractSequenceRaw.map((event, index) => ({
    ...event,
    ordering: {
      sequence: GOLDEN_SEQUENCE_BY_EVENT[index] ?? 1,
      emittedAtMs: 1_700_000_000_000 + index
    }
  }));

test("golden contract sequence yields identical state via HTTP envelope and websocket replay", () => {
  const httpStore = createGameStore();
  const httpResult = httpStore.dispatchEvents("http", goldenContractSequence);
  assert.equal(httpResult.appliedCount, goldenContractSequence.length - 1);
  assert.equal(httpResult.ignoredDuplicateCount, 0);
  assert.equal(httpResult.ignoredStaleCount, 1);

  const realtimeStore = createGameStore();
  let realtimeAppliedCount = 0;
  let realtimeDuplicateCount = 0;
  let realtimeStaleCount = 0;
  for (const event of goldenContractSequence) {
    const result = realtimeStore.dispatchEvents("realtime", [event]);
    realtimeAppliedCount += result.appliedCount;
    realtimeDuplicateCount += result.ignoredDuplicateCount;
    realtimeStaleCount += result.ignoredStaleCount;
  }
  assert.equal(realtimeAppliedCount, httpResult.appliedCount);
  assert.equal(realtimeDuplicateCount, httpResult.ignoredDuplicateCount);
  assert.equal(realtimeStaleCount, httpResult.ignoredStaleCount);

  assert.deepEqual(
    toClientStateSnapshot(realtimeStore.getState()),
    toClientStateSnapshot(httpStore.getState())
  );

  const finalState = httpStore.getState();
  assert.equal(finalState.lobby?.phase, "in_game");
  const eastSeat = finalState.lobby?.seats.find((seat) => seat.seat === "east");
  assert.equal(eastSeat?.connected, true);
  assert.equal(finalState.game?.phase, "round1_bidding");
  assert.equal(finalState.game?.bidding?.passesInRound, 1);
  assert.equal(finalState.game?.turn, "south");
  assert.equal(finalState.rejections.length, 1);
  assert.equal(finalState.rejections[0]?.requestId, "contract-play-illegal");
});

test("reconnect replay events are treated as deterministic duplicates after HTTP outbound", () => {
  const reconnectOutbound = goldenContractSequence.slice(-2);
  const store = createGameStore();
  const first = store.dispatchEvents("http", reconnectOutbound);
  assert.equal(first.appliedCount, reconnectOutbound.length);

  const replay = store.dispatchEvents("realtime", reconnectOutbound);
  assert.equal(replay.appliedCount, 0);
  assert.equal(replay.ignoredDuplicateCount, reconnectOutbound.length);
  assert.equal(replay.ignoredStaleCount, 0);
});

test("sequence ordering rejects out-of-order replay even when payload looks newer", () => {
  const store = createGameStore();
  const fresh: ServerToClientEvent = {
    version: 1,
    type: "game.state",
    ordering: {
      sequence: 10,
      emittedAtMs: 1_700_000_100_010
    },
    payload: {
      gameId: "contract-game-2",
      handNumber: 2,
      trickNumber: 3,
      dealer: "south",
      turn: "west",
      trump: "hearts",
      phase: "play",
      scores: {
        teamA: 1,
        teamB: 0
      }
    }
  };
  const staleOutOfOrder: ServerToClientEvent = {
    version: 1,
    type: "game.state",
    ordering: {
      sequence: 9,
      emittedAtMs: 1_700_000_100_009
    },
    payload: {
      gameId: "contract-game-2",
      handNumber: 99,
      trickNumber: 99,
      dealer: "east",
      turn: "north",
      trump: "spades",
      phase: "completed",
      scores: {
        teamA: 10,
        teamB: 0
      }
    }
  };

  const first = store.dispatchEvents("realtime", [fresh]);
  assert.equal(first.appliedCount, 1);
  const second = store.dispatchEvents("realtime", [staleOutOfOrder]);
  assert.equal(second.appliedCount, 0);
  assert.equal(second.ignoredDuplicateCount, 0);
  assert.equal(second.ignoredStaleCount, 1);

  const state = store.getState();
  assert.equal(state.game?.handNumber, 2);
  assert.equal(state.game?.trickNumber, 3);
  assert.equal(state.game?.phase, "play");
});
