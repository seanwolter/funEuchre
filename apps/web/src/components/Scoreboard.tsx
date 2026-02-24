import type { GameStatePayload, Seat } from "@fun-euchre/protocol";
import { describeGamePhase } from "../pages/gameViewModel.js";

export type ScoreboardModel = {
  game: GameStatePayload | null;
};

function seatLabel(seat: Seat | null | undefined): string {
  if (!seat) {
    return "Unknown";
  }
  return seat.charAt(0).toUpperCase() + seat.slice(1);
}

export function renderScoreboard(model: ScoreboardModel): string {
  if (!model.game) {
    return `
      <section class="game-panel" aria-labelledby="scoreboard-title">
        <h3 id="scoreboard-title">Scoreboard</h3>
        <p>Waiting for active game state.</p>
      </section>
    `;
  }

  const phase = describeGamePhase(model.game.phase ?? null);
  const trump = model.game.trump ?? "Unset";
  const maker = seatLabel(model.game.maker ?? null);
  const dealer = seatLabel(model.game.dealer);
  const turn = seatLabel(model.game.turn);

  return `
    <section class="game-panel" aria-labelledby="scoreboard-title" aria-live="polite">
      <h3 id="scoreboard-title">Scoreboard</h3>
      <div class="phase-row">
        <span class="phase-badge">${phase}</span>
        <span>Hand ${model.game.handNumber} · Trick ${model.game.trickNumber}</span>
      </div>
      <dl class="scoreboard-grid">
        <div>
          <dt>Team A</dt>
          <dd>${model.game.scores.teamA}</dd>
        </div>
        <div>
          <dt>Team B</dt>
          <dd>${model.game.scores.teamB}</dd>
        </div>
        <div>
          <dt>Trump</dt>
          <dd>${trump}</dd>
        </div>
        <div>
          <dt>Maker</dt>
          <dd>${maker}</dd>
        </div>
        <div>
          <dt>Dealer</dt>
          <dd>${dealer}</dd>
        </div>
        <div>
          <dt>Turn</dt>
          <dd>${turn}</dd>
        </div>
      </dl>
    </section>
  `;
}
