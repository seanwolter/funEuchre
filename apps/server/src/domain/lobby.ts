import { SEAT_VALUES, type LobbyPhase, type Seat, type Team } from "@fun-euchre/protocol";
import type { LobbyId, PlayerId } from "./types.js";

export const LOBBY_REJECT_CODE_VALUES = [
  "INVALID_ACTION",
  "INVALID_STATE",
  "UNAUTHORIZED"
] as const;

export type LobbyRejectCode = (typeof LOBBY_REJECT_CODE_VALUES)[number];

export type LobbySeat = {
  seat: Seat;
  team: Team;
  playerId: PlayerId | null;
  displayName: string | null;
  connected: boolean;
};

export type LobbyState = {
  lobbyId: LobbyId;
  hostPlayerId: PlayerId;
  phase: LobbyPhase;
  seats: LobbySeat[];
};

export type CreateLobbyInput = {
  lobbyId: LobbyId;
  hostPlayerId: PlayerId;
  hostDisplayName: string;
};

export type JoinLobbyInput = {
  playerId: PlayerId;
  displayName: string;
};

export type UpdateNameInput = {
  playerId: PlayerId;
  displayName: string;
};

export type StartLobbyInput = {
  actorPlayerId: PlayerId;
};

export type LobbyConnectionInput = {
  playerId: PlayerId;
  connected: boolean;
};

export type LobbyTransitionSuccess = {
  ok: true;
  state: LobbyState;
};

export type LobbyTransitionFailure = {
  ok: false;
  code: LobbyRejectCode;
  message: string;
};

export type LobbyTransitionResult = LobbyTransitionSuccess | LobbyTransitionFailure;

function reject(code: LobbyRejectCode, message: string): LobbyTransitionFailure {
  return {
    ok: false,
    code,
    message
  };
}

function teamForSeat(seat: Seat): Team {
  return seat === "north" || seat === "south" ? "teamA" : "teamB";
}

function normalizeDisplayName(displayName: string): string | null {
  const trimmed = displayName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cloneSeat(seat: LobbySeat): LobbySeat {
  return {
    seat: seat.seat,
    team: seat.team,
    playerId: seat.playerId,
    displayName: seat.displayName,
    connected: seat.connected
  };
}

function cloneSeats(seats: readonly LobbySeat[]): LobbySeat[] {
  return seats.map((seat) => cloneSeat(seat));
}

function findSeatByPlayerId(seats: readonly LobbySeat[], playerId: PlayerId): LobbySeat | null {
  for (const seat of seats) {
    if (seat.playerId === playerId) {
      return seat;
    }
  }

  return null;
}

function findFirstOpenSeat(seats: readonly LobbySeat[]): LobbySeat | null {
  for (const seat of seats) {
    if (seat.playerId === null) {
      return seat;
    }
  }

  return null;
}

function assignPlayerToSeat(
  seats: readonly LobbySeat[],
  targetSeat: Seat,
  playerId: PlayerId,
  displayName: string,
  connected: boolean
): LobbySeat[] {
  return seats.map((seat) => {
    if (seat.seat !== targetSeat) {
      return cloneSeat(seat);
    }

    return {
      seat: seat.seat,
      team: seat.team,
      playerId,
      displayName,
      connected
    };
  });
}

function updateSeatConnection(
  seats: readonly LobbySeat[],
  playerId: PlayerId,
  connected: boolean
): LobbySeat[] {
  return seats.map((seat) => {
    if (seat.playerId !== playerId) {
      return cloneSeat(seat);
    }

    return {
      seat: seat.seat,
      team: seat.team,
      playerId: seat.playerId,
      displayName: seat.displayName,
      connected
    };
  });
}

function updateSeatDisplayName(
  seats: readonly LobbySeat[],
  playerId: PlayerId,
  displayName: string
): LobbySeat[] {
  return seats.map((seat) => {
    if (seat.playerId !== playerId) {
      return cloneSeat(seat);
    }

    return {
      seat: seat.seat,
      team: seat.team,
      playerId: seat.playerId,
      displayName,
      connected: seat.connected
    };
  });
}

function createEmptySeats(): LobbySeat[] {
  return SEAT_VALUES.map((seat) => ({
    seat,
    team: teamForSeat(seat),
    playerId: null,
    displayName: null,
    connected: false
  }));
}

export function isLobbyReadyToStart(state: LobbyState): boolean {
  return state.seats.every((seat) => seat.playerId !== null);
}

export function createLobbyState(input: CreateLobbyInput): LobbyState {
  const hostDisplayName = normalizeDisplayName(input.hostDisplayName);
  if (!hostDisplayName) {
    throw new Error("Host display name must be non-empty.");
  }

  const seats = assignPlayerToSeat(
    createEmptySeats(),
    "north",
    input.hostPlayerId,
    hostDisplayName,
    true
  );

  return {
    lobbyId: input.lobbyId,
    hostPlayerId: input.hostPlayerId,
    phase: "waiting",
    seats
  };
}

export function joinLobby(state: LobbyState, input: JoinLobbyInput): LobbyTransitionResult {
  if (state.phase !== "waiting") {
    return reject("INVALID_STATE", "Lobby can only be joined while waiting.");
  }

  const displayName = normalizeDisplayName(input.displayName);
  if (!displayName) {
    return reject("INVALID_ACTION", "displayName must be non-empty.");
  }

  if (findSeatByPlayerId(state.seats, input.playerId)) {
    return reject("INVALID_ACTION", "Player is already seated in this lobby.");
  }

  const openSeat = findFirstOpenSeat(state.seats);
  if (!openSeat) {
    return reject("INVALID_STATE", "Lobby is full.");
  }

  return {
    ok: true,
    state: {
      ...state,
      seats: assignPlayerToSeat(state.seats, openSeat.seat, input.playerId, displayName, true)
    }
  };
}

export function updateLobbyDisplayName(
  state: LobbyState,
  input: UpdateNameInput
): LobbyTransitionResult {
  if (state.phase !== "waiting") {
    return reject("INVALID_STATE", "Display names can only be updated while waiting.");
  }

  const displayName = normalizeDisplayName(input.displayName);
  if (!displayName) {
    return reject("INVALID_ACTION", "displayName must be non-empty.");
  }

  if (!findSeatByPlayerId(state.seats, input.playerId)) {
    return reject("UNAUTHORIZED", "Player is not seated in this lobby.");
  }

  return {
    ok: true,
    state: {
      ...state,
      seats: updateSeatDisplayName(state.seats, input.playerId, displayName)
    }
  };
}

export function setLobbyPlayerConnection(
  state: LobbyState,
  input: LobbyConnectionInput
): LobbyTransitionResult {
  if (!findSeatByPlayerId(state.seats, input.playerId)) {
    return reject("UNAUTHORIZED", "Player is not seated in this lobby.");
  }

  return {
    ok: true,
    state: {
      ...state,
      seats: updateSeatConnection(state.seats, input.playerId, input.connected)
    }
  };
}

export function startLobbyGame(state: LobbyState, input: StartLobbyInput): LobbyTransitionResult {
  if (state.phase !== "waiting") {
    return reject("INVALID_STATE", "Lobby has already started.");
  }

  if (input.actorPlayerId !== state.hostPlayerId) {
    return reject("UNAUTHORIZED", "Only the host may start the lobby.");
  }

  if (!isLobbyReadyToStart(state)) {
    return reject("INVALID_STATE", "All seats must be occupied before starting.");
  }

  return {
    ok: true,
    state: {
      ...state,
      phase: "in_game"
    }
  };
}
