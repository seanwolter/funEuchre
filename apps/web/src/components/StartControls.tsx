import type { LobbyStatePayload } from "@fun-euchre/protocol";
import type { SessionIdentity } from "../lib/session.js";
import { isSeatFilled } from "./SeatGrid.js";

export type StartReadinessState = {
  canStart: boolean;
  isHost: boolean;
  allSeatsFilled: boolean;
  allSeatsConnected: boolean;
  disabledReason: string;
  waitingSeats: number;
  disconnectedSeats: number;
};

export type StartControlsModel = {
  lobby: LobbyStatePayload | null;
  sessionIdentity: SessionIdentity | null;
};

function pluralize(count: number, noun: string): string {
  if (count === 1) {
    return `${count} ${noun}`;
  }
  return `${count} ${noun}s`;
}

export function deriveStartReadiness(model: StartControlsModel): StartReadinessState {
  if (!model.lobby) {
    return {
      canStart: false,
      isHost: false,
      allSeatsFilled: false,
      allSeatsConnected: false,
      disabledReason: "Create or join a lobby to enable game start controls.",
      waitingSeats: 4,
      disconnectedSeats: 0
    };
  }

  const isHost = model.sessionIdentity?.playerId === model.lobby.hostPlayerId;
  const waitingSeats = model.lobby.seats.filter((seat) => !isSeatFilled(seat)).length;
  const disconnectedSeats = model.lobby.seats.filter(
    (seat) => seat.playerId && !seat.connected
  ).length;
  const allSeatsFilled = waitingSeats === 0;
  const allSeatsConnected = disconnectedSeats === 0 && allSeatsFilled;

  if (!isHost) {
    return {
      canStart: false,
      isHost,
      allSeatsFilled,
      allSeatsConnected,
      disabledReason: "Only the host can start the lobby.",
      waitingSeats,
      disconnectedSeats
    };
  }

  if (model.lobby.phase !== "waiting") {
    return {
      canStart: false,
      isHost,
      allSeatsFilled,
      allSeatsConnected,
      disabledReason: `Lobby is currently in "${model.lobby.phase}" phase.`,
      waitingSeats,
      disconnectedSeats
    };
  }

  if (!allSeatsFilled) {
    return {
      canStart: false,
      isHost,
      allSeatsFilled,
      allSeatsConnected,
      disabledReason: `Waiting for ${pluralize(waitingSeats, "open seat")}.`,
      waitingSeats,
      disconnectedSeats
    };
  }

  if (!allSeatsConnected) {
    return {
      canStart: false,
      isHost,
      allSeatsFilled,
      allSeatsConnected,
      disabledReason: `Waiting for ${pluralize(disconnectedSeats, "disconnected player")} to reconnect.`,
      waitingSeats,
      disconnectedSeats
    };
  }

  return {
    canStart: true,
    isHost,
    allSeatsFilled,
    allSeatsConnected,
    disabledReason: "All players are ready.",
    waitingSeats,
    disconnectedSeats
  };
}

export function renderStartControls(state: StartReadinessState): string {
  const waitingClass = state.allSeatsFilled ? "readiness-pill ready" : "readiness-pill";
  const connectedClass = state.allSeatsConnected ? "readiness-pill ready" : "readiness-pill";
  const buttonDisabled = !state.canStart;

  return `
    <section class="start-controls" aria-labelledby="start-controls-title">
      <h3 id="start-controls-title">Start Controls</h3>
      <div class="readiness-row">
        <span class="${waitingClass}">Seats ${state.allSeatsFilled ? "Full" : "Pending"}</span>
        <span class="${connectedClass}">Connections ${
          state.allSeatsConnected ? "Ready" : "Pending"
        }</span>
      </div>
      <p id="start-hint-text" class="start-hint">${state.disabledReason}</p>
      <button
        id="lobby-start-button"
        class="action-button accent"
        type="button"
        aria-describedby="start-hint-text"
        aria-disabled="${buttonDisabled ? "true" : "false"}"
        ${buttonDisabled ? "disabled" : ""}
      >
        Start Game
      </button>
    </section>
  `;
}
