import {
  PROTOCOL_VERSION,
  type ActionRejectedEvent,
  type ClientToServerEvent,
  type GamePlayCardEvent,
  type GameStateEvent,
  type LobbyStateEvent,
  type NoticeSeverity,
  type RejectCode,
  type ServerToClientEvent,
  type SystemNoticeEvent
} from "@fun-euchre/protocol";
import {
  applyGameAction,
  nextSeat,
  parseCardId,
  type GameAction,
  type GameRejectCode,
  type GameState,
  type PlayCardGameAction,
  type Seat
} from "@fun-euchre/game-rules";
import { parseGameId, parseLobbyId, parsePlayerId, parseReconnectToken } from "./ids.js";
import type { LobbyRejectCode, LobbyState } from "./lobby.js";
import type { GameId, LobbyId, PlayerId, ReconnectToken } from "./types.js";

export type AdapterFailure = {
  code: RejectCode;
  message: string;
};

export type AdapterResult<T> = { ok: true; data: T } | { ok: false; reject: AdapterFailure };

export type LobbyCreateCommand = {
  kind: "lobby.create";
  requestId: string;
  displayName: string;
};

export type LobbyJoinCommand = {
  kind: "lobby.join";
  requestId: string;
  lobbyId: LobbyId;
  displayName: string;
  reconnectToken: ReconnectToken | null;
};

export type LobbyUpdateNameCommand = {
  kind: "lobby.update_name";
  requestId: string;
  lobbyId: LobbyId;
  playerId: PlayerId;
  displayName: string;
};

export type LobbyStartCommand = {
  kind: "lobby.start";
  requestId: string;
  lobbyId: LobbyId;
  actorPlayerId: PlayerId;
};

export type GamePlayCardCommand = {
  kind: "game.play_card";
  requestId: string;
  gameId: GameId;
  action: PlayCardGameAction;
};

export type DomainCommand =
  | LobbyCreateCommand
  | LobbyJoinCommand
  | LobbyUpdateNameCommand
  | LobbyStartCommand
  | GamePlayCardCommand;

export type DomainRejectCode = LobbyRejectCode | GameRejectCode;

export type GameEventApplyResult = {
  state: GameState;
  outbound: ServerToClientEvent[];
};

function reject(code: RejectCode, message: string): AdapterResult<never> {
  return {
    ok: false,
    reject: { code, message }
  };
}

export function mapDomainRejectCodeToProtocolCode(code: DomainRejectCode): RejectCode {
  switch (code) {
    case "NOT_YOUR_TURN":
    case "INVALID_ACTION":
    case "INVALID_STATE":
    case "UNAUTHORIZED":
      return code;
  }
}

export function toActionRejectedEvent(
  requestId: string | null,
  code: RejectCode,
  message: string
): ActionRejectedEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "action.rejected",
    payload: {
      requestId,
      code,
      message
    }
  };
}

export function toActionRejectedFromDomainFailure(
  requestId: string | null,
  failure: {
    code: DomainRejectCode;
    message: string;
  }
): ActionRejectedEvent {
  return toActionRejectedEvent(
    requestId,
    mapDomainRejectCodeToProtocolCode(failure.code),
    failure.message
  );
}

export function toSystemNoticeEvent(
  severity: NoticeSeverity,
  message: string
): SystemNoticeEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "system.notice",
    payload: {
      severity,
      message
    }
  };
}

function deriveTurn(state: GameState): Seat {
  const nextActiveSeatFromDealer = (): Seat => {
    let candidate = nextSeat(state.dealer);
    for (let index = 0; index < 4; index += 1) {
      if (candidate !== state.partnerSitsOut) {
        return candidate;
      }
      candidate = nextSeat(candidate);
    }

    return nextSeat(state.dealer);
  };

  if (state.phase === "round1_bidding" || state.phase === "round2_bidding") {
    return state.bidding?.turn ?? nextSeat(state.dealer);
  }

  if (state.phase === "play") {
    return state.trick?.turn ?? nextActiveSeatFromDealer();
  }

  if (state.phase === "score" || state.phase === "completed") {
    return state.trick?.winner ?? nextActiveSeatFromDealer();
  }

  return nextActiveSeatFromDealer();
}

function deriveTrickNumber(state: GameState): number {
  const completedTricks = state.tricksWon.teamA + state.tricksWon.teamB;
  const inProgressTrick =
    state.phase === "play" &&
    state.trick !== null &&
    !state.trick.complete &&
    state.trick.plays.length > 0;

  return inProgressTrick ? completedTricks + 1 : completedTricks;
}

export function toLobbyStateEvent(state: LobbyState): LobbyStateEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "lobby.state",
    payload: {
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
    }
  };
}

export function toGameStateEvent(gameId: GameId, state: GameState): GameStateEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "game.state",
    payload: {
      gameId,
      handNumber: state.handNumber,
      trickNumber: deriveTrickNumber(state),
      dealer: state.dealer,
      turn: deriveTurn(state),
      trump: state.trump,
      scores: {
        teamA: state.scores.teamA,
        teamB: state.scores.teamB
      }
    }
  };
}

export function toDomainCommand(event: ClientToServerEvent): AdapterResult<DomainCommand> {
  switch (event.type) {
    case "lobby.create":
      return {
        ok: true,
        data: {
          kind: "lobby.create",
          requestId: event.requestId,
          displayName: event.payload.displayName
        }
      };

    case "lobby.join": {
      const lobbyId = parseLobbyId(event.payload.lobbyId);
      if (!lobbyId) {
        return reject("INVALID_ACTION", "lobby.join payload.lobbyId is invalid.");
      }

      let reconnectToken: ReconnectToken | null = null;
      if (event.payload.reconnectToken !== undefined && event.payload.reconnectToken !== null) {
        reconnectToken = parseReconnectToken(event.payload.reconnectToken);
        if (!reconnectToken) {
          return reject("INVALID_ACTION", "lobby.join payload.reconnectToken is invalid.");
        }
      }

      return {
        ok: true,
        data: {
          kind: "lobby.join",
          requestId: event.requestId,
          lobbyId,
          displayName: event.payload.displayName,
          reconnectToken
        }
      };
    }

    case "lobby.update_name": {
      const lobbyId = parseLobbyId(event.payload.lobbyId);
      if (!lobbyId) {
        return reject("INVALID_ACTION", "lobby.update_name payload.lobbyId is invalid.");
      }

      const playerId = parsePlayerId(event.payload.playerId);
      if (!playerId) {
        return reject("INVALID_ACTION", "lobby.update_name payload.playerId is invalid.");
      }

      return {
        ok: true,
        data: {
          kind: "lobby.update_name",
          requestId: event.requestId,
          lobbyId,
          playerId,
          displayName: event.payload.displayName
        }
      };
    }

    case "lobby.start": {
      const lobbyId = parseLobbyId(event.payload.lobbyId);
      if (!lobbyId) {
        return reject("INVALID_ACTION", "lobby.start payload.lobbyId is invalid.");
      }

      const actorPlayerId = parsePlayerId(event.payload.actorPlayerId);
      if (!actorPlayerId) {
        return reject("INVALID_ACTION", "lobby.start payload.actorPlayerId is invalid.");
      }

      return {
        ok: true,
        data: {
          kind: "lobby.start",
          requestId: event.requestId,
          lobbyId,
          actorPlayerId
        }
      };
    }

    case "game.play_card": {
      const gameId = parseGameId(event.payload.gameId);
      if (!gameId) {
        return reject("INVALID_ACTION", "game.play_card payload.gameId is invalid.");
      }

      const card = parseCardId(event.payload.cardId);
      if (!card) {
        return reject("INVALID_ACTION", "game.play_card payload.cardId is invalid.");
      }

      return {
        ok: true,
        data: {
          kind: "game.play_card",
          requestId: event.requestId,
          gameId,
          action: {
            type: "play_card",
            actor: event.payload.actorSeat,
            card
          }
        }
      };
    }
  }
}

export function toGamePlayCardAction(
  event: GamePlayCardEvent,
  activeGameId: GameId
): AdapterResult<GameAction> {
  const mapped = toDomainCommand(event);
  if (!mapped.ok) {
    return mapped;
  }

  if (mapped.data.kind !== "game.play_card") {
    return reject(
      "INVALID_ACTION",
      `Unsupported event type "${mapped.data.kind}" for game state transitions.`
    );
  }

  if (mapped.data.gameId !== activeGameId) {
    return reject(
      "INVALID_ACTION",
      `Event gameId "${mapped.data.gameId}" does not match active game "${activeGameId}".`
    );
  }

  return {
    ok: true,
    data: mapped.data.action
  };
}

export function applyProtocolEventToGameState(
  gameId: GameId,
  state: GameState,
  event: ClientToServerEvent
): GameEventApplyResult {
  const mapped = toDomainCommand(event);
  if (!mapped.ok) {
    return {
      state,
      outbound: [
        toActionRejectedEvent(event.requestId, mapped.reject.code, mapped.reject.message)
      ]
    };
  }

  if (mapped.data.kind !== "game.play_card") {
    return {
      state,
      outbound: [
        toActionRejectedEvent(
          event.requestId,
          "INVALID_ACTION",
          `Unsupported event type "${event.type}" for game state transitions.`
        )
      ]
    };
  }

  if (mapped.data.gameId !== gameId) {
    return {
      state,
      outbound: [
        toActionRejectedEvent(
          event.requestId,
          "INVALID_ACTION",
          `Event gameId "${mapped.data.gameId}" does not match active game "${gameId}".`
        )
      ]
    };
  }

  const next = applyGameAction(state, mapped.data.action);
  if (!next.ok) {
    return {
      state,
      outbound: [toActionRejectedFromDomainFailure(event.requestId, next.reject)]
    };
  }

  return {
    state: next.state,
    outbound: [toGameStateEvent(gameId, next.state)]
  };
}
