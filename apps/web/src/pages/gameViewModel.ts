import type { GamePhase, LobbyStatePayload, Seat } from "@fun-euchre/protocol";

export type ActionStatusInput = {
  pendingLabel: string | null;
  latestRejectionMessage: string | null;
  latestNoticeMessage: string | null;
  actorSeat: Seat | null;
  phase: GamePhase | null;
};

export function resolveActorSeat(
  lobby: LobbyStatePayload | null,
  playerId: string | null
): Seat | null {
  if (!lobby || !playerId) {
    return null;
  }

  for (const seat of lobby.seats) {
    if (seat.playerId === playerId) {
      return seat.seat;
    }
  }

  return null;
}

export function describeGamePhase(phase: GamePhase | null): string {
  switch (phase) {
    case "deal":
      return "Deal";
    case "round1_bidding":
      return "Round 1 Bidding";
    case "round2_bidding":
      return "Round 2 Bidding";
    case "play":
      return "Trick Play";
    case "score":
      return "Score";
    case "completed":
      return "Completed";
    case null:
      return "Waiting for game start";
  }
}

export function deriveActionStatusText(input: ActionStatusInput): string {
  if (input.pendingLabel) {
    return `Submitting ${input.pendingLabel}...`;
  }
  if (input.latestRejectionMessage) {
    return `Rejected: ${input.latestRejectionMessage}`;
  }
  if (!input.actorSeat) {
    return "Join a lobby seat to submit game actions.";
  }
  if (!input.phase) {
    return "Waiting for game state.";
  }
  if (input.latestNoticeMessage) {
    return input.latestNoticeMessage;
  }

  return `Ready for ${describeGamePhase(input.phase)} actions as ${input.actorSeat}.`;
}
