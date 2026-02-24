import type { GameLegalActionsPayload, GamePhase, Suit } from "@fun-euchre/protocol";

export type BiddingPanelModel = {
  phase: GamePhase | null;
  legalActions: GameLegalActionsPayload | null;
  canSubmit: boolean;
  pending: boolean;
};

function isBiddingPhase(phase: GamePhase | null): boolean {
  return phase === "round1_bidding" || phase === "round2_bidding";
}

function renderSuitButtons(model: BiddingPanelModel): string {
  if (model.phase !== "round2_bidding" || !model.legalActions) {
    return "";
  }
  if (model.legalActions.callableTrumpSuits.length === 0) {
    return `<p class="game-hint">No trump suits available.</p>`;
  }

  return `
    <div class="inline-actions">
      ${model.legalActions.callableTrumpSuits
        .map((suit) => renderCallTrumpButton(suit, model))
        .join("")}
    </div>
  `;
}

function renderCallTrumpButton(suit: Suit, model: BiddingPanelModel): string {
  const disabled =
    !model.canSubmit || model.pending || !model.legalActions?.callableTrumpSuits.includes(suit);
  const ariaLabel = `Call ${suit} trump`;

  return `
    <button
      type="button"
      class="action-button"
      data-action="call-trump"
      data-trump="${suit}"
      aria-label="${ariaLabel}"
      aria-disabled="${disabled ? "true" : "false"}"
      ${disabled ? "disabled" : ""}
    >
      Call ${suit}
    </button>
  `;
}

export function renderBiddingPanel(model: BiddingPanelModel): string {
  if (!isBiddingPhase(model.phase)) {
    return `
      <section class="game-panel" aria-labelledby="bidding-panel-title">
        <h3 id="bidding-panel-title">Bidding</h3>
        <p class="game-hint">Bidding controls activate during round 1 or round 2 bidding phases.</p>
      </section>
    `;
  }

  const canPass = Boolean(model.legalActions?.canPass && model.canSubmit && !model.pending);
  const canOrderUp = Boolean(
    model.phase === "round1_bidding" &&
      model.legalActions?.canOrderUp &&
      model.canSubmit &&
      !model.pending
  );
  const passDisabled = canPass ? "" : "disabled";
  const orderUpDisabled = canOrderUp ? "" : "disabled";

  return `
    <section class="game-panel" aria-labelledby="bidding-panel-title">
      <h3 id="bidding-panel-title">Bidding</h3>
      <p class="game-hint">
        Submit pass/order-up/call-trump intents. Controls are disabled when actions are illegal.
      </p>
      <div class="inline-actions" role="group" aria-label="Bidding actions">
        <button
          type="button"
          class="action-button"
          data-action="pass"
          aria-label="Pass bidding turn"
          aria-disabled="${canPass ? "false" : "true"}"
          ${passDisabled}
        >
          Pass
        </button>
        <button
          type="button"
          class="action-button"
          data-action="order-up"
          aria-label="Order up trump"
          aria-disabled="${canOrderUp ? "false" : "true"}"
          ${orderUpDisabled}
        >
          Order Up
        </button>
      </div>
      ${renderSuitButtons(model)}
    </section>
  `;
}
