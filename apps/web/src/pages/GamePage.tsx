import type { Seat, ServerToClientEvent, Suit } from "@fun-euchre/protocol";
import { renderBiddingPanel } from "../components/BiddingPanel.js";
import { renderCardHand } from "../components/CardHand.js";
import { renderScoreboard } from "../components/Scoreboard.js";
import { renderTrickTable } from "../components/TrickTable.js";
import { HttpClientError, type HttpClient } from "../lib/httpClient.js";
import type { SessionClient, SessionIdentity } from "../lib/session.js";
import { createRealtimeClient, type RealtimeClient } from "../realtime/client.js";
import type { GameStore } from "../state/gameStore.js";
import {
  deriveActionStatusText,
  describeGamePhase,
  resolveActorSeat
} from "./gameViewModel.js";
import type { RouteView } from "./RouteView.js";

export const gamePage: RouteView = {
  badge: "Game Route",
  title: "Render Authoritative Bids and Trick Progression",
  subtitle:
    "Gameplay view reflects server state exactly, with clear context for dealer, trump, and current turn.",
  bullets: [
    "Separate public table state from seat-private hand hints",
    "Highlight bidding prompts and legal action windows per phase",
    "Keep scores and trick context visible across desktop and mobile"
  ],
  panelTitle: "Current Focus",
  panelBody:
    "Gameplay controls now submit pass/order-up/call-trump/play-card intents with legal-action gating.",
  statusLabel: "Gameplay controls active",
  statusText: "Phase, score, bidding, trick, and private hand panels are now wired to authoritative state."
};

type GamePageMountOptions = {
  root: HTMLElement;
  documentRef: Document;
  win: Window;
  tabsMarkup: string;
  store: GameStore;
  httpClient: HttpClient;
  sessionClient: SessionClient;
  initialFeedback?: {
    tone: FeedbackTone;
    message: string;
  } | null;
};

type FeedbackTone = "info" | "success" | "warning" | "error";

type GameElements = {
  feedback: HTMLElement;
  score: HTMLElement;
  trick: HTMLElement;
  bidding: HTMLElement;
  hand: HTMLElement;
  phaseText: HTMLElement;
  seatText: HTMLElement;
};

type ElementConstructor<TElement extends HTMLElement> = new (
  ...args: never[]
) => TElement;

type ActionContext = {
  gameId: string;
  actorSeat: Seat;
  phase: string | null;
  playableCardIds: Set<string>;
  canPass: boolean;
  canOrderUp: boolean;
  callableTrumpSuits: readonly Suit[];
};

const SUIT_VALUES = ["clubs", "diamonds", "hearts", "spades"] as const;

function parseSuit(input: string | undefined): Suit | null {
  if (!input) {
    return null;
  }
  if (SUIT_VALUES.includes(input as Suit)) {
    return input as Suit;
  }
  return null;
}

function requireElement<TElement extends HTMLElement>(
  documentRef: Document,
  id: string,
  constructorRef: ElementConstructor<TElement>
): TElement {
  const element = documentRef.getElementById(id);
  if (!element) {
    throw new Error(`Expected #${id} in game page markup.`);
  }
  if (!(element instanceof constructorRef)) {
    throw new Error(`Expected #${id} to be the correct element type.`);
  }

  return element;
}

function gameMarkup(tabsMarkup: string): string {
  return `
    <div class="shell">
      <header class="masthead">
        <span class="badge">${gamePage.badge}</span>
        <h1>${gamePage.title}</h1>
        <p>${gamePage.subtitle}</p>
        <nav class="tabs" aria-label="Primary">${tabsMarkup}</nav>
      </header>

      <main class="content-grid game-layout">
        <section class="panel game-panel-stack" aria-labelledby="game-action-heading">
          <h2 id="game-action-heading">Action Console</h2>
          <p id="game-phase-text" class="game-phase"></p>
          <p id="game-seat-text" class="game-phase"></p>
          <p id="game-feedback" class="inline-feedback" role="status" aria-live="polite"></p>
          <div id="game-bidding-panel"></div>
          <div id="game-card-hand"></div>
        </section>

        <aside class="panel game-panel-stack" aria-labelledby="game-state-heading">
          <h2 id="game-state-heading">Game State</h2>
          <div id="game-scoreboard"></div>
          <div id="game-trick-table"></div>
        </aside>
      </main>
    </div>
  `;
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpClientError) {
    if (error.issues.length > 0) {
      return `${error.message} ${error.issues.join(" ")}`;
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function latestRejectionMessage(events: readonly ServerToClientEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = events[index];
    if (candidate?.type === "action.rejected") {
      return candidate.payload.message;
    }
  }

  return null;
}

export function mountGamePage(options: GamePageMountOptions): () => void {
  options.root.innerHTML = gameMarkup(options.tabsMarkup);

  const elements: GameElements = {
    feedback: requireElement(options.documentRef, "game-feedback", HTMLElement),
    score: requireElement(options.documentRef, "game-scoreboard", HTMLElement),
    trick: requireElement(options.documentRef, "game-trick-table", HTMLElement),
    bidding: requireElement(options.documentRef, "game-bidding-panel", HTMLElement),
    hand: requireElement(options.documentRef, "game-card-hand", HTMLElement),
    phaseText: requireElement(options.documentRef, "game-phase-text", HTMLElement),
    seatText: requireElement(options.documentRef, "game-seat-text", HTMLElement)
  };

  let currentSession = options.sessionClient.hydrate();
  let realtimeClient: RealtimeClient | null = null;
  let realtimeSessionId: string | null = null;
  let pendingLabel: string | null = null;
  let localStatus: { tone: FeedbackTone; message: string } | null = null;

  const setLocalStatus = (tone: FeedbackTone, message: string): void => {
    localStatus = {
      tone,
      message
    };
  };

  const applyFeedback = (tone: FeedbackTone, message: string): void => {
    elements.feedback.dataset.tone = tone;
    elements.feedback.textContent = message;
  };

  const pushOutbound = (events: readonly ServerToClientEvent[]): void => {
    if (realtimeClient) {
      realtimeClient.dispatchHttpOutbound(events);
      return;
    }
    options.store.dispatchEvents("http", events);
  };

  const ensureRealtime = async (identity: SessionIdentity): Promise<void> => {
    if (realtimeClient && realtimeSessionId === identity.sessionId) {
      return;
    }

    if (realtimeClient) {
      realtimeClient.disconnect();
      realtimeClient = null;
      realtimeSessionId = null;
    }

    realtimeClient = createRealtimeClient({
      identity,
      store: options.store,
      baseUrl: options.win.location.href,
      onLifecycle: (event) => {
        if (
          event.status === "connecting" ||
          event.status === "error" ||
          event.status === "disconnected"
        ) {
          setLocalStatus(
            event.status === "connecting" ? "info" : "warning",
            event.message ?? "Realtime connection unavailable. Using HTTP responses only."
          );
          renderPanels();
        }
      }
    });
    await realtimeClient.connect({
      lobbyId: identity.lobbyId,
      gameId: options.store.getState().game?.gameId ?? null
    });
    realtimeSessionId = identity.sessionId;
  };

  const currentActionContext = (): ActionContext | null => {
    if (!currentSession) {
      return null;
    }

    const snapshot = options.store.getState();
    const game = snapshot.game;
    const privateState = snapshot.privateGame;
    const actorSeat = resolveActorSeat(snapshot.lobby, currentSession.identity.playerId);
    if (!game || !privateState || !actorSeat) {
      return null;
    }
    if (privateState.gameId !== game.gameId) {
      return null;
    }

    return {
      gameId: game.gameId,
      actorSeat,
      phase: privateState.phase,
      playableCardIds: new Set(privateState.legalActions.playableCardIds),
      canPass: privateState.legalActions.canPass,
      canOrderUp: privateState.legalActions.canOrderUp,
      callableTrumpSuits: privateState.legalActions.callableTrumpSuits
    };
  };

  const renderPanels = (): void => {
    const snapshot = options.store.getState();
    const actorSeat = resolveActorSeat(
      snapshot.lobby,
      currentSession?.identity.playerId ?? null
    );
    const phase = snapshot.privateGame?.phase ?? snapshot.game?.phase ?? null;
    const canSubmit = Boolean(currentActionContext());

    elements.phaseText.textContent = `Phase: ${describeGamePhase(phase)}`;
    elements.seatText.textContent = actorSeat
      ? `Seat: ${actorSeat}`
      : "Seat: unavailable for gameplay actions.";

    elements.score.innerHTML = renderScoreboard({
      game: snapshot.game
    });
    elements.trick.innerHTML = renderTrickTable({
      game: snapshot.game
    });
    elements.bidding.innerHTML = renderBiddingPanel({
      phase,
      legalActions: snapshot.privateGame?.legalActions ?? null,
      canSubmit,
      pending: pendingLabel !== null
    });
    elements.hand.innerHTML = renderCardHand({
      privateState: snapshot.privateGame,
      phase,
      canSubmit,
      pending: pendingLabel !== null
    });

    const rejectionMessage = snapshot.rejections.at(-1)?.message ?? null;
    const noticeMessage = snapshot.notices.at(-1)?.message ?? null;
    if (pendingLabel) {
      applyFeedback(
        "info",
        deriveActionStatusText({
          pendingLabel,
          latestRejectionMessage: null,
          latestNoticeMessage: null,
          actorSeat,
          phase
        })
      );
      return;
    }
    if (rejectionMessage) {
      applyFeedback(
        "error",
        deriveActionStatusText({
          pendingLabel: null,
          latestRejectionMessage: rejectionMessage,
          latestNoticeMessage: noticeMessage,
          actorSeat,
          phase
        })
      );
      return;
    }
    if (localStatus) {
      applyFeedback(localStatus.tone, localStatus.message);
      return;
    }

    applyFeedback(
      "info",
      deriveActionStatusText({
        pendingLabel: null,
        latestRejectionMessage: null,
        latestNoticeMessage: noticeMessage,
        actorSeat,
        phase
      })
    );
  };

  const submitIntent = async (
    label: string,
    submit: (context: ActionContext) => Promise<{
      outbound: ServerToClientEvent[];
    }>
  ): Promise<void> => {
    const context = currentActionContext();
    if (!context) {
      setLocalStatus("warning", "Action unavailable until lobby seat and game state are synchronized.");
      renderPanels();
      return;
    }

    pendingLabel = label;
    localStatus = null;
    renderPanels();
    try {
      const response = await submit(context);
      pushOutbound(response.outbound);
      const rejected = latestRejectionMessage(response.outbound);
      if (rejected) {
        setLocalStatus("error", `Rejected: ${rejected}`);
      } else {
        setLocalStatus("success", `${label} submitted.`);
      }
    } catch (error) {
      setLocalStatus("error", `${label} failed: ${errorMessage(error)}`);
    } finally {
      pendingLabel = null;
      renderPanels();
    }
  };

  const handleActionClick = (event: Event): void => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) {
      return;
    }
    const button = rawTarget.closest("button[data-action]");
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return;
    }

    const action = button.dataset.action;
    if (!action) {
      return;
    }

    if (action === "pass") {
      void submitIntent("Pass", async (context) => {
        if (!context.canPass) {
          throw new Error("Pass is not legal in current state.");
        }
        return options.httpClient.submitAction({
          type: "game.pass",
          payload: {
            gameId: context.gameId,
            actorSeat: context.actorSeat
          }
        });
      });
      return;
    }

    if (action === "order-up") {
      void submitIntent("Order Up", async (context) => {
        if (!context.canOrderUp) {
          throw new Error("Order up is not legal in current state.");
        }
        return options.httpClient.submitAction({
          type: "game.order_up",
          payload: {
            gameId: context.gameId,
            actorSeat: context.actorSeat
          }
        });
      });
      return;
    }

    if (action === "call-trump") {
      const trump = parseSuit(button.dataset.trump);
      void submitIntent("Call Trump", async (context) => {
        if (!trump || !context.callableTrumpSuits.includes(trump)) {
          throw new Error("Selected trump suit is not legal in current state.");
        }
        return options.httpClient.submitAction({
          type: "game.call_trump",
          payload: {
            gameId: context.gameId,
            actorSeat: context.actorSeat,
            trump
          }
        });
      });
      return;
    }

    if (action === "play-card") {
      const cardId = button.dataset.cardId?.trim() ?? "";
      void submitIntent("Play Card", async (context) => {
        if (!cardId || !context.playableCardIds.has(cardId)) {
          throw new Error("Selected card is not legal in current state.");
        }
        return options.httpClient.submitAction({
          type: "game.play_card",
          payload: {
            gameId: context.gameId,
            actorSeat: context.actorSeat,
            cardId
          }
        });
      });
    }
  };

  const unsubscribe = options.store.subscribe(() => {
    renderPanels();
  });

  if (currentSession) {
    void ensureRealtime(currentSession.identity).catch((error) => {
      setLocalStatus("warning", `Realtime connect failed: ${errorMessage(error)}`);
      renderPanels();
    });
  } else if (options.initialFeedback) {
    setLocalStatus(options.initialFeedback.tone, options.initialFeedback.message);
  } else {
    setLocalStatus("warning", "No stored session identity. Join a lobby to play.");
  }

  options.root.addEventListener("click", handleActionClick);
  renderPanels();

  return () => {
    unsubscribe();
    options.root.removeEventListener("click", handleActionClick);
    if (realtimeClient) {
      realtimeClient.disconnect();
      realtimeClient = null;
      realtimeSessionId = null;
    }
  };
}
