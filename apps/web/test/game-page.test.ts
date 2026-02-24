import assert from "node:assert/strict";
import test from "node:test";
import { renderBiddingPanel } from "../src/components/BiddingPanel.js";
import { renderCardHand } from "../src/components/CardHand.js";
import { renderScoreboard } from "../src/components/Scoreboard.js";
import {
  deriveActionStatusText,
  describeGamePhase,
  resolveActorSeat
} from "../src/pages/gameViewModel.js";

test("resolveActorSeat maps player identity to lobby seat", () => {
  const seat = resolveActorSeat(
    {
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
    },
    "player-2"
  );

  assert.equal(seat, "east");
});

test("renderBiddingPanel disables illegal controls and shows callable trump options", () => {
  const markup = renderBiddingPanel({
    phase: "round2_bidding",
    legalActions: {
      playableCardIds: [],
      canPass: true,
      canOrderUp: false,
      callableTrumpSuits: ["diamonds", "spades"]
    },
    canSubmit: true,
    pending: false
  });

  assert.match(markup, /data-action="pass"/);
  assert.match(markup, /data-action="order-up"[^>]*disabled/);
  assert.match(markup, /data-action="call-trump"[^>]*data-trump="diamonds"/);
  assert.match(markup, /data-action="call-trump"[^>]*data-trump="spades"/);
});

test("renderCardHand marks legal and illegal play buttons", () => {
  const markup = renderCardHand({
    phase: "play",
    canSubmit: true,
    pending: false,
    privateState: {
      gameId: "game-1",
      seat: "north",
      phase: "play",
      handCardIds: ["clubs:9", "hearts:ace"],
      legalActions: {
        playableCardIds: ["hearts:ace"],
        canPass: false,
        canOrderUp: false,
        callableTrumpSuits: []
      }
    }
  });

  assert.match(markup, /data-card-id="hearts:ace"/);
  assert.match(markup, /data-card-id="clubs:9"[^>]*disabled/);
});

test("scoreboard output reflects phase transitions and table context", () => {
  const dealMarkup = renderScoreboard({
    game: {
      gameId: "game-1",
      handNumber: 1,
      trickNumber: 0,
      dealer: "north",
      turn: "east",
      trump: null,
      phase: "deal",
      scores: {
        teamA: 0,
        teamB: 0
      }
    }
  });
  const playMarkup = renderScoreboard({
    game: {
      gameId: "game-1",
      handNumber: 1,
      trickNumber: 2,
      dealer: "north",
      turn: "south",
      trump: "hearts",
      phase: "play",
      scores: {
        teamA: 1,
        teamB: 0
      }
    }
  });

  assert.match(dealMarkup, /Deal/);
  assert.match(playMarkup, /Trick Play/);
  assert.match(playMarkup, /Trump/);
  assert.equal(describeGamePhase("score"), "Score");
});

test("deriveActionStatusText surfaces rejected action feedback inline", () => {
  const status = deriveActionStatusText({
    pendingLabel: null,
    latestRejectionMessage: "Action actor does not match current trick turn.",
    latestNoticeMessage: null,
    actorSeat: "north",
    phase: "play"
  });

  assert.match(status, /Rejected:/);
});

test("deriveActionStatusText indicates waiting seat when it is not actor turn", () => {
  const status = deriveActionStatusText({
    pendingLabel: null,
    latestRejectionMessage: null,
    latestNoticeMessage: null,
    actorSeat: "west",
    phase: "round1_bidding",
    currentTurnSeat: "east"
  });

  assert.equal(status, "Waiting for east to act. You are west.");
});
