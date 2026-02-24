import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTOCOL_VERSION,
  parseClientToServerEvent,
  parseServerToClientEvent,
  validateClientToServerEvent,
  validateServerToClientEvent
} from "../src/index.js";

const goldenClientSequence: unknown[] = [
  {
    version: PROTOCOL_VERSION,
    type: "lobby.create",
    requestId: "contract-create",
    payload: {
      displayName: "Host"
    }
  },
  {
    version: PROTOCOL_VERSION,
    type: "lobby.join",
    requestId: "contract-join-east",
    payload: {
      lobbyId: "contract-lobby-1",
      displayName: "East"
    }
  },
  {
    version: PROTOCOL_VERSION,
    type: "lobby.start",
    requestId: "contract-start",
    payload: {
      lobbyId: "contract-lobby-1",
      actorPlayerId: "player-host"
    }
  },
  {
    version: PROTOCOL_VERSION,
    type: "game.pass",
    requestId: "contract-pass-east",
    payload: {
      gameId: "contract-game-1",
      actorSeat: "east"
    }
  },
  {
    version: PROTOCOL_VERSION,
    type: "game.play_card",
    requestId: "contract-play-illegal",
    payload: {
      gameId: "contract-game-1",
      actorSeat: "east",
      cardId: "clubs:9"
    }
  },
  {
    version: PROTOCOL_VERSION,
    type: "lobby.join",
    requestId: "contract-reconnect-east",
    payload: {
      lobbyId: "contract-lobby-1",
      displayName: "East",
      reconnectToken: "reconnect-east-token"
    }
  }
];

const goldenServerSequence: unknown[] = [
  {
    version: PROTOCOL_VERSION,
    type: "lobby.state",
    ordering: {
      sequence: 1,
      emittedAtMs: 1_700_000_000_001
    },
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
    version: PROTOCOL_VERSION,
    type: "game.state",
    ordering: {
      sequence: 1,
      emittedAtMs: 1_700_000_000_002
    },
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
    version: PROTOCOL_VERSION,
    type: "game.state",
    ordering: {
      sequence: 2,
      emittedAtMs: 1_700_000_000_003
    },
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
    version: PROTOCOL_VERSION,
    type: "action.rejected",
    ordering: {
      sequence: 3,
      emittedAtMs: 1_700_000_000_004
    },
    payload: {
      requestId: "contract-play-illegal",
      code: "INVALID_STATE",
      message: "play_card is only allowed during play phase."
    }
  },
  {
    version: PROTOCOL_VERSION,
    type: "lobby.state",
    ordering: {
      sequence: 2,
      emittedAtMs: 1_700_000_000_005
    },
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
  }
];

test("golden client contract sequence validates and parses for create/join/start/pass/play/reconnect flows", () => {
  const parsedTypes: string[] = [];

  for (const event of goldenClientSequence) {
    const validated = validateClientToServerEvent(event);
    assert.equal(validated.ok, true);
    if (!validated.ok) {
      continue;
    }
    const parsed = parseClientToServerEvent(event);
    parsedTypes.push(parsed.type);
  }

  assert.deepEqual(parsedTypes, [
    "lobby.create",
    "lobby.join",
    "lobby.start",
    "game.pass",
    "game.play_card",
    "lobby.join"
  ]);
});

test("golden server contract sequence validates and parses for lobby/game/reconnect projections", () => {
  const parsedTypes: string[] = [];

  for (const event of goldenServerSequence) {
    const validated = validateServerToClientEvent(event);
    assert.equal(validated.ok, true);
    if (!validated.ok) {
      continue;
    }
    const parsed = parseServerToClientEvent(event);
    parsedTypes.push(parsed.type);
  }

  assert.deepEqual(parsedTypes, [
    "lobby.state",
    "game.state",
    "game.state",
    "action.rejected",
    "lobby.state"
  ]);
});

test("contract drift is rejected when critical fields violate schema", () => {
  const invalidGameState = {
    version: PROTOCOL_VERSION,
    type: "game.state",
    ordering: {
      sequence: 4,
      emittedAtMs: 1_700_000_000_006
    },
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
        teamA: "0",
        teamB: 0
      }
    }
  };

  const validated = validateServerToClientEvent(invalidGameState);
  assert.equal(validated.ok, false);
  assert.throws(() => {
    parseServerToClientEvent(invalidGameState);
  }, /Invalid server event/);
});
