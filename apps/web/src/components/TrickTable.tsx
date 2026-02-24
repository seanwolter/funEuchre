import type { GameStatePayload, TrickPlaySummary } from "@fun-euchre/protocol";

export type TrickTableModel = {
  game: GameStatePayload | null;
};

function seatLabel(value: TrickPlaySummary["seat"]): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function trickRows(game: GameStatePayload): string {
  const plays = game.trick?.plays ?? [];
  if (plays.length === 0) {
    return `
      <tr>
        <td colspan="2">No cards played in current trick.</td>
      </tr>
    `;
  }

  return plays
    .map(
      (play) => `
        <tr>
          <td>${seatLabel(play.seat)}</td>
          <td>${play.cardId}</td>
        </tr>
      `
    )
    .join("");
}

export function renderTrickTable(model: TrickTableModel): string {
  if (!model.game) {
    return `
      <section class="game-panel" aria-labelledby="trick-table-title">
        <h3 id="trick-table-title">Current Trick</h3>
        <p>Waiting for game trick projection.</p>
      </section>
    `;
  }

  const trick = model.game.trick;
  const leadSuit = trick?.leadSuit ?? "Unset";
  const winner = trick?.winner ?? "Unresolved";

  return `
    <section class="game-panel" aria-labelledby="trick-table-title">
      <h3 id="trick-table-title">Current Trick</h3>
      <div class="trick-meta">
        <span>Lead Suit: ${leadSuit}</span>
        <span>Winner: ${winner}</span>
      </div>
      <div class="trick-table-scroll">
        <table class="trick-table">
          <caption class="visually-hidden">Cards played in the current trick</caption>
          <thead>
            <tr>
              <th scope="col">Seat</th>
              <th scope="col">Card</th>
            </tr>
          </thead>
          <tbody>${trickRows(model.game)}</tbody>
        </table>
      </div>
    </section>
  `;
}
