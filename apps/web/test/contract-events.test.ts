import assert from "node:assert/strict";
import test from "node:test";
import type { ServerToClientEvent } from "@fun-euchre/protocol";
import { createGameStore } from "../src/state/gameStore.js";
import { toClientStateSnapshot } from "../src/state/reducer.js";

const goldenContractSequence: readonly ServerToClientEvent[] = [
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

test("golden contract sequence yields identical state via HTTP envelope and websocket replay", () => {
  const httpStore = createGameStore();
  const httpResult = httpStore.dispatchEvents("http", goldenContractSequence);
  assert.equal(httpResult.appliedCount, goldenContractSequence.length - 1);
  assert.equal(httpResult.ignoredDuplicateCount, 1);

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
  assert.equal(realtimeStaleCount, 0);

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
