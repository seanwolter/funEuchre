import type { GamePrivateStatePayload, GamePhase } from "@fun-euchre/protocol";

export type CardHandModel = {
  privateState: GamePrivateStatePayload | null;
  phase: GamePhase | null;
  canSubmit: boolean;
  pending: boolean;
};

function isPlayablePhase(phase: GamePhase | null): boolean {
  return phase === "play";
}

function cardButton(cardId: string, disabled: boolean): string {
  const classes = ["card-button", disabled ? "illegal" : "legal"].join(" ");
  return `
    <button
      type="button"
      class="${classes}"
      data-action="play-card"
      data-card-id="${cardId}"
      aria-label="Play ${cardId}"
      aria-disabled="${disabled ? "true" : "false"}"
      ${disabled ? "disabled" : ""}
    >
      ${cardId}
    </button>
  `;
}

export function renderCardHand(model: CardHandModel): string {
  if (!model.privateState) {
    return `
      <section class="game-panel" aria-labelledby="card-hand-title">
        <h3 id="card-hand-title">Your Hand</h3>
        <p class="game-hint">Private hand projection has not been received yet.</p>
      </section>
    `;
  }

  const playableIds = new Set(model.privateState.legalActions.playableCardIds);
  const playablePhase = isPlayablePhase(model.phase);
  const handMarkup = model.privateState.handCardIds
    .map((cardId) => {
      const isLegal = playablePhase && playableIds.has(cardId) && model.canSubmit && !model.pending;
      return `<li>${cardButton(cardId, !isLegal)}</li>`;
    })
    .join("");

  return `
    <section class="game-panel" aria-labelledby="card-hand-title">
      <h3 id="card-hand-title">Your Hand</h3>
      <p class="game-hint">
        ${playablePhase ? "Playable cards are highlighted." : "Card play controls unlock during trick play."}
      </p>
      <ul class="card-hand-grid" aria-label="Your hand cards">${handMarkup}</ul>
    </section>
  `;
}
