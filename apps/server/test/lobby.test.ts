import assert from "node:assert/strict";
import test from "node:test";
import {
  createLobbyState,
  isLobbyReadyToStart,
  joinLobby,
  setLobbyPlayerConnection,
  startLobbyGame,
  updateLobbyDisplayName,
  type LobbyState,
  type LobbyTransitionResult
} from "../src/domain/lobby.js";
import { parseLobbyIdOrThrow, parsePlayerIdOrThrow } from "../src/domain/ids.js";

function expectSuccess(result: LobbyTransitionResult): LobbyState {
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }

  return result.state;
}

function findSeat(state: LobbyState, seat: "north" | "east" | "south" | "west") {
  const found = state.seats.find((entry) => entry.seat === seat);
  if (!found) {
    throw new Error(`Expected seat ${seat} to exist.`);
  }
  return found;
}

test("createLobbyState initializes deterministic seat/team mapping with host in north", () => {
  const lobby = createLobbyState({
    lobbyId: parseLobbyIdOrThrow("lobby-1"),
    hostPlayerId: parsePlayerIdOrThrow("player-1"),
    hostDisplayName: "Host"
  });

  assert.equal(lobby.phase, "waiting");
  assert.equal(lobby.hostPlayerId, "player-1");
  assert.deepEqual(
    lobby.seats.map((seat) => [seat.seat, seat.team]),
    [
      ["north", "teamA"],
      ["east", "teamB"],
      ["south", "teamA"],
      ["west", "teamB"]
    ]
  );

  const north = findSeat(lobby, "north");
  assert.equal(north.playerId, "player-1");
  assert.equal(north.displayName, "Host");
  assert.equal(north.connected, true);
});

test("joinLobby assigns players to open seats in deterministic order", () => {
  let lobby = createLobbyState({
    lobbyId: parseLobbyIdOrThrow("lobby-1"),
    hostPlayerId: parsePlayerIdOrThrow("player-1"),
    hostDisplayName: "Host"
  });

  lobby = expectSuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-2"),
      displayName: "East"
    })
  );
  lobby = expectSuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-3"),
      displayName: "South"
    })
  );
  lobby = expectSuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-4"),
      displayName: "West"
    })
  );

  assert.equal(findSeat(lobby, "east").playerId, "player-2");
  assert.equal(findSeat(lobby, "south").playerId, "player-3");
  assert.equal(findSeat(lobby, "west").playerId, "player-4");
  assert.equal(isLobbyReadyToStart(lobby), true);
});

test("joinLobby rejects duplicate seat claims and over-capacity joins", () => {
  let lobby = createLobbyState({
    lobbyId: parseLobbyIdOrThrow("lobby-1"),
    hostPlayerId: parsePlayerIdOrThrow("player-1"),
    hostDisplayName: "Host"
  });

  lobby = expectSuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-2"),
      displayName: "East"
    })
  );

  const duplicateJoin = joinLobby(lobby, {
    playerId: parsePlayerIdOrThrow("player-2"),
    displayName: "East again"
  });
  assert.deepEqual(duplicateJoin, {
    ok: false,
    code: "INVALID_ACTION",
    message: "Player is already seated in this lobby."
  });

  lobby = expectSuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-3"),
      displayName: "South"
    })
  );
  lobby = expectSuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-4"),
      displayName: "West"
    })
  );

  const fullLobbyJoin = joinLobby(lobby, {
    playerId: parsePlayerIdOrThrow("player-5"),
    displayName: "Overflow"
  });
  assert.deepEqual(fullLobbyJoin, {
    ok: false,
    code: "INVALID_STATE",
    message: "Lobby is full."
  });
});

test("updateLobbyDisplayName only allows seated players while waiting", () => {
  let lobby = createLobbyState({
    lobbyId: parseLobbyIdOrThrow("lobby-1"),
    hostPlayerId: parsePlayerIdOrThrow("player-1"),
    hostDisplayName: "Host"
  });
  lobby = expectSuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-2"),
      displayName: "Original"
    })
  );

  lobby = expectSuccess(
    updateLobbyDisplayName(lobby, {
      playerId: parsePlayerIdOrThrow("player-2"),
      displayName: "Renamed"
    })
  );
  assert.equal(findSeat(lobby, "east").displayName, "Renamed");

  const unknownPlayer = updateLobbyDisplayName(lobby, {
    playerId: parsePlayerIdOrThrow("player-9"),
    displayName: "Ghost"
  });
  assert.deepEqual(unknownPlayer, {
    ok: false,
    code: "UNAUTHORIZED",
    message: "Player is not seated in this lobby."
  });
});

test("startLobbyGame enforces host authorization and full lobby precondition", () => {
  let lobby = createLobbyState({
    lobbyId: parseLobbyIdOrThrow("lobby-1"),
    hostPlayerId: parsePlayerIdOrThrow("player-1"),
    hostDisplayName: "Host"
  });
  lobby = expectSuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-2"),
      displayName: "East"
    })
  );

  const startTooEarly = startLobbyGame(lobby, {
    actorPlayerId: parsePlayerIdOrThrow("player-1")
  });
  assert.deepEqual(startTooEarly, {
    ok: false,
    code: "INVALID_STATE",
    message: "All seats must be occupied before starting."
  });

  lobby = expectSuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-3"),
      displayName: "South"
    })
  );
  lobby = expectSuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-4"),
      displayName: "West"
    })
  );

  const unauthorizedStart = startLobbyGame(lobby, {
    actorPlayerId: parsePlayerIdOrThrow("player-2")
  });
  assert.deepEqual(unauthorizedStart, {
    ok: false,
    code: "UNAUTHORIZED",
    message: "Only the host may start the lobby."
  });

  lobby = expectSuccess(
    startLobbyGame(lobby, {
      actorPlayerId: parsePlayerIdOrThrow("player-1")
    })
  );
  assert.equal(lobby.phase, "in_game");
});

test("setLobbyPlayerConnection toggles connectivity for seated players", () => {
  let lobby = createLobbyState({
    lobbyId: parseLobbyIdOrThrow("lobby-1"),
    hostPlayerId: parsePlayerIdOrThrow("player-1"),
    hostDisplayName: "Host"
  });
  lobby = expectSuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-2"),
      displayName: "East"
    })
  );

  lobby = expectSuccess(
    setLobbyPlayerConnection(lobby, {
      playerId: parsePlayerIdOrThrow("player-2"),
      connected: false
    })
  );
  assert.equal(findSeat(lobby, "east").connected, false);

  const unknownPlayer = setLobbyPlayerConnection(lobby, {
    playerId: parsePlayerIdOrThrow("player-9"),
    connected: true
  });
  assert.deepEqual(unknownPlayer, {
    ok: false,
    code: "UNAUTHORIZED",
    message: "Player is not seated in this lobby."
  });
});
