import type { LobbySeatState, LobbyStatePayload } from "@fun-euchre/protocol";
import type { SessionIdentity } from "../lib/session.js";

export type SeatReadiness = "open" | "connected" | "disconnected";

export type SeatGridModel = {
  lobby: LobbyStatePayload | null;
  sessionIdentity: SessionIdentity | null;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function teamLabel(team: LobbySeatState["team"]): string {
  return team === "teamA" ? "Team A" : "Team B";
}

function seatLabel(seat: LobbySeatState["seat"]): string {
  return seat.charAt(0).toUpperCase() + seat.slice(1);
}

function occupantLabel(seat: LobbySeatState): string {
  if (!seat.playerId || !seat.displayName) {
    return "Open seat";
  }

  return seat.displayName;
}

export function seatReadiness(seat: LobbySeatState): SeatReadiness {
  if (!seat.playerId) {
    return "open";
  }
  if (seat.connected) {
    return "connected";
  }
  return "disconnected";
}

function readinessLabel(readiness: SeatReadiness): string {
  switch (readiness) {
    case "open":
      return "Open";
    case "connected":
      return "Connected";
    case "disconnected":
      return "Disconnected";
  }
}

export function isSeatFilled(seat: LobbySeatState): boolean {
  return Boolean(seat.playerId);
}

export function renderSeatGrid(model: SeatGridModel): string {
  if (!model.lobby) {
    return `
      <p class="seat-grid-empty">
        Create or join a lobby to see seat assignments and team readiness.
      </p>
    `;
  }

  const seatsMarkup = model.lobby.seats
    .map((seat) => {
      const readiness = seatReadiness(seat);
      const occupant = occupantLabel(seat);
      const isSelf = seat.playerId !== null && seat.playerId === model.sessionIdentity?.playerId;
      const classes = ["seat-card", `seat-${seat.seat}`, `readiness-${readiness}`].join(" ");
      const ariaLabel = `${seatLabel(seat.seat)} seat, ${teamLabel(seat.team)}, ${occupant}, ${readinessLabel(readiness)}${isSelf ? ", you" : ""}`;

      return `
        <li class="${classes}" aria-label="${escapeHtml(ariaLabel)}">
          <header class="seat-card-header">
            <span class="seat-name">${seatLabel(seat.seat)}</span>
            <span class="team-chip">${teamLabel(seat.team)}</span>
          </header>
          <p class="seat-occupant">${escapeHtml(occupant)}</p>
          <p class="seat-meta">
            <span class="seat-readiness">${readinessLabel(readiness)}</span>
            ${isSelf ? '<span class="seat-self">You</span>' : ""}
          </p>
        </li>
      `;
    })
    .join("");

  return `<ol class="seat-grid" aria-label="Lobby seat assignments">${seatsMarkup}</ol>`;
}
