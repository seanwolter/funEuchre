import type { ServerToClientEvent } from "@fun-euchre/protocol";
import { renderSeatGrid } from "../components/SeatGrid.js";
import {
  deriveStartReadiness,
  renderStartControls
} from "../components/StartControls.js";
import { HttpClientError, type HttpClient } from "../lib/httpClient.js";
import type { SessionClient, SessionIdentity, StoredSession } from "../lib/session.js";
import { createRealtimeClient, type RealtimeClient } from "../realtime/client.js";
import type { GameStore } from "../state/gameStore.js";
import {
  isLocalOnlyBrowserOrigin,
  resolveInviteOrigin
} from "../app/config.js";
import type { RouteView } from "./RouteView.js";
import { buildJoinLobbySubmission } from "./joinLobbySubmission.js";
import { buildInviteLink, resolveInviteLobbyId } from "./lobbyInvite.js";

export const lobbyPage: RouteView = {
  badge: "Lobby Route",
  title: "Gather Players Around One Invite Link",
  subtitle:
    "Hosts create a private room, share one URL, and watch seats fill in real time before launch.",
  bullets: [
    "Reserve four seats with fixed teams and visible host ownership",
    "Surface invite-share controls and seat availability at a glance",
    "Enable game start only when all seats are occupied and connected"
  ],
  panelTitle: "Current Focus",
  panelBody:
    "This route now supports create/join/update-name/start flows with session persistence and realtime seat updates.",
  statusLabel: "Lobby UX active",
  statusText: "Use the controls below to create, join, rename, and start a live lobby."
};

type LobbyPageMountOptions = {
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

type LobbyElements = {
  createForm: HTMLFormElement;
  createDisplayName: HTMLInputElement;
  createSubmit: HTMLButtonElement;
  joinForm: HTMLFormElement;
  joinLobbyId: HTMLInputElement;
  joinDisplayName: HTMLInputElement;
  joinReconnectToken: HTMLInputElement;
  joinSubmit: HTMLButtonElement;
  renameForm: HTMLFormElement;
  renameDisplayName: HTMLInputElement;
  renameSubmit: HTMLButtonElement;
  feedback: HTMLElement;
  seatGrid: HTMLElement;
  startControls: HTMLElement;
  inviteLinkInput: HTMLInputElement;
  copyInviteButton: HTMLButtonElement;
  shareInviteButton: HTMLButtonElement;
};

function asNonEmptyString(input: string): string | null {
  const normalized = input.trim();
  return normalized.length > 0 ? normalized : null;
}

type ElementConstructor<TElement extends HTMLElement> = new (
  ...args: never[]
) => TElement;

function requireElement<TElement extends HTMLElement>(
  documentRef: Document,
  id: string,
  constructorRef: ElementConstructor<TElement>
): TElement {
  const element = documentRef.getElementById(id);
  if (!element) {
    throw new Error(`Expected #${id} in lobby page markup.`);
  }

  if (!(element instanceof constructorRef)) {
    throw new Error(`Expected #${id} to be the correct element type.`);
  }

  return element;
}

function lobbyMarkup(tabsMarkup: string): string {
  return `
    <div class="shell">
      <header class="masthead">
        <span class="badge">${lobbyPage.badge}</span>
        <h1>${lobbyPage.title}</h1>
        <p>${lobbyPage.subtitle}</p>
        <nav class="tabs" aria-label="Primary">${tabsMarkup}</nav>
      </header>

      <main class="content-grid">
        <section class="panel lobby-panel" aria-labelledby="lobby-controls-heading">
          <h2 id="lobby-controls-heading">Lobby Controls</h2>
          <p class="panel-lead">
            Create a lobby, join via invite code, or update your display name before kickoff.
          </p>

          <form id="lobby-create-form" class="stack-form">
            <h3>Create Lobby</h3>
            <label for="lobby-create-display-name">Display Name</label>
            <input id="lobby-create-display-name" name="displayName" autocomplete="nickname" />
            <button id="lobby-create-submit" class="action-button" type="submit">
              Create Lobby
            </button>
          </form>

          <form id="lobby-join-form" class="stack-form">
            <h3>Join Lobby</h3>
            <label for="lobby-join-id">Lobby ID</label>
            <input id="lobby-join-id" name="lobbyId" autocomplete="off" />
            <label for="lobby-join-display-name">Display Name</label>
            <input id="lobby-join-display-name" name="displayName" autocomplete="nickname" />
            <label for="lobby-join-reconnect-token">Reconnect Token (optional)</label>
            <input
              id="lobby-join-reconnect-token"
              name="reconnectToken"
              placeholder="Leave blank unless recovering your own session"
              autocomplete="off"
            />
            <button id="lobby-join-submit" class="action-button" type="submit">
              Join Lobby
            </button>
          </form>

          <form id="lobby-rename-form" class="stack-form">
            <h3>Update Display Name</h3>
            <label for="lobby-rename-display-name">New Display Name</label>
            <input id="lobby-rename-display-name" name="displayName" autocomplete="nickname" />
            <button id="lobby-rename-submit" class="action-button" type="submit">
              Update Name
            </button>
          </form>

          <p id="lobby-feedback" class="inline-feedback" role="status" aria-live="polite"></p>
        </section>

        <aside class="panel lobby-panel" aria-labelledby="lobby-state-heading">
          <h2 id="lobby-state-heading">Seat Readiness</h2>
          <div id="lobby-seat-grid"></div>
          <section class="invite-controls" aria-labelledby="invite-controls-heading">
            <h3 id="invite-controls-heading">Invite Link</h3>
            <label for="lobby-invite-link" class="visually-hidden">Invite Link</label>
            <input id="lobby-invite-link" readonly />
            <div class="invite-buttons">
              <button id="lobby-copy-invite" class="action-button" type="button">
                Copy Invite
              </button>
              <button id="lobby-share-invite" class="action-button" type="button">
                Share Invite
              </button>
            </div>
          </section>
          <div id="lobby-start-controls"></div>
        </aside>
      </main>
    </div>
  `;
}

function extractLobbyIdForInvite(
  session: StoredSession | null,
  events: readonly ServerToClientEvent[],
  fallbackFromStore: string | null
): string | null {
  if (fallbackFromStore) {
    return fallbackFromStore;
  }

  for (const event of events) {
    if (event.type === "lobby.state") {
      return event.payload.lobbyId;
    }
  }

  return session?.identity.lobbyId ?? null;
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

export function mountLobbyPage(options: LobbyPageMountOptions): () => void {
  options.root.innerHTML = lobbyMarkup(options.tabsMarkup);

  const elements: LobbyElements = {
    createForm: requireElement(options.documentRef, "lobby-create-form", HTMLFormElement),
    createDisplayName: requireElement(
      options.documentRef,
      "lobby-create-display-name",
      HTMLInputElement
    ),
    createSubmit: requireElement(
      options.documentRef,
      "lobby-create-submit",
      HTMLButtonElement
    ),
    joinForm: requireElement(options.documentRef, "lobby-join-form", HTMLFormElement),
    joinLobbyId: requireElement(options.documentRef, "lobby-join-id", HTMLInputElement),
    joinDisplayName: requireElement(
      options.documentRef,
      "lobby-join-display-name",
      HTMLInputElement
    ),
    joinReconnectToken: requireElement(
      options.documentRef,
      "lobby-join-reconnect-token",
      HTMLInputElement
    ),
    joinSubmit: requireElement(options.documentRef, "lobby-join-submit", HTMLButtonElement),
    renameForm: requireElement(options.documentRef, "lobby-rename-form", HTMLFormElement),
    renameDisplayName: requireElement(
      options.documentRef,
      "lobby-rename-display-name",
      HTMLInputElement
    ),
    renameSubmit: requireElement(
      options.documentRef,
      "lobby-rename-submit",
      HTMLButtonElement
    ),
    feedback: requireElement(options.documentRef, "lobby-feedback", HTMLElement),
    seatGrid: requireElement(options.documentRef, "lobby-seat-grid", HTMLElement),
    startControls: requireElement(options.documentRef, "lobby-start-controls", HTMLElement),
    inviteLinkInput: requireElement(options.documentRef, "lobby-invite-link", HTMLInputElement),
    copyInviteButton: requireElement(
      options.documentRef,
      "lobby-copy-invite",
      HTMLButtonElement
    ),
    shareInviteButton: requireElement(
      options.documentRef,
      "lobby-share-invite",
      HTMLButtonElement
    )
  };

  let currentSession = options.sessionClient.hydrate();
  let realtimeClient: RealtimeClient | null = null;
  let realtimeSessionId: string | null = null;
  const inviteOrigin = resolveInviteOrigin(options.win);

  const setFeedback = (message: string, tone: FeedbackTone): void => {
    elements.feedback.dataset.tone = tone;
    elements.feedback.textContent = message;
  };

  const syncInviteField = (lobbyId: string | null): void => {
    if (!lobbyId) {
      elements.inviteLinkInput.value = "";
      return;
    }

    elements.inviteLinkInput.value = buildInviteLink(
      options.win.location.href,
      lobbyId,
      inviteOrigin
    );
  };

  const renderPanels = (): void => {
    const snapshot = options.store.getState();
    const lobby = snapshot.lobby;
    elements.seatGrid.innerHTML = renderSeatGrid({
      lobby,
      sessionIdentity: currentSession?.identity ?? null
    });

    const readiness = deriveStartReadiness({
      lobby,
      sessionIdentity: currentSession?.identity ?? null
    });
    elements.startControls.innerHTML = renderStartControls(readiness);

    const lobbyId = lobby?.lobbyId ?? currentSession?.identity.lobbyId ?? null;
    syncInviteField(lobbyId);

    if (!elements.joinLobbyId.value.trim() && lobbyId) {
      elements.joinLobbyId.value = lobbyId;
    }
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
          const message = event.message ?? "Realtime connection is unavailable.";
          const tone: FeedbackTone = event.status === "connecting" ? "info" : "warning";
          setFeedback(message, tone);
        }
      }
    });

    await realtimeClient.connect({
      lobbyId: identity.lobbyId,
      gameId: options.store.getState().game?.gameId ?? null
    });
    realtimeSessionId = identity.sessionId;
  };

  const withBusyButton = async (
    button: HTMLButtonElement,
    action: () => Promise<void>
  ): Promise<void> => {
    if (button.disabled) {
      return;
    }

    button.disabled = true;
    try {
      await action();
    } finally {
      button.disabled = false;
    }
  };

  const handleCreate = async (event: Event): Promise<void> => {
    event.preventDefault();
    await withBusyButton(elements.createSubmit, async () => {
      const displayName = asNonEmptyString(elements.createDisplayName.value);
      if (!displayName) {
        setFeedback("Create lobby requires a display name.", "error");
        return;
      }

      try {
        const created = await options.httpClient.createLobby({
          displayName
        });
        currentSession = options.sessionClient.update({
          identity: created.identity,
          displayName
        });
        pushOutbound(created.outbound);
        await ensureRealtime(created.identity);

        elements.joinLobbyId.value = created.identity.lobbyId;
        elements.joinReconnectToken.value = "";
        elements.joinDisplayName.value = displayName;
        elements.renameDisplayName.value = displayName;

        const lobbyId = extractLobbyIdForInvite(
          currentSession,
          created.outbound,
          options.store.getState().lobby?.lobbyId ?? null
        );
        syncInviteField(lobbyId);
        setFeedback(`Created lobby ${created.identity.lobbyId}. Invite players to join.`, "success");
      } catch (error) {
        setFeedback(`Create lobby failed: ${errorMessage(error)}`, "error");
      } finally {
        renderPanels();
      }
    });
  };

  const handleJoin = async (event: Event): Promise<void> => {
    event.preventDefault();
    await withBusyButton(elements.joinSubmit, async () => {
      const joinSubmission = buildJoinLobbySubmission({
        lobbyId: elements.joinLobbyId.value,
        displayName: elements.joinDisplayName.value,
        reconnectToken: elements.joinReconnectToken.value
      });
      if (!joinSubmission.ok) {
        setFeedback(joinSubmission.message, "error");
        return;
      }

      try {
        const joined = await options.httpClient.joinLobby(joinSubmission.input);
        currentSession = options.sessionClient.update({
          identity: joined.identity,
          displayName: joinSubmission.input.displayName
        });
        pushOutbound(joined.outbound);
        await ensureRealtime(joined.identity);

        elements.joinReconnectToken.value = "";
        elements.renameDisplayName.value = joinSubmission.input.displayName;
        const resolvedLobbyId = extractLobbyIdForInvite(
          currentSession,
          joined.outbound,
          options.store.getState().lobby?.lobbyId ?? null
        );
        syncInviteField(resolvedLobbyId);
        setFeedback(`Joined lobby ${joined.identity.lobbyId}.`, "success");
      } catch (error) {
        setFeedback(`Join lobby failed: ${errorMessage(error)}`, "error");
      } finally {
        renderPanels();
      }
    });
  };

  const handleRename = async (event: Event): Promise<void> => {
    event.preventDefault();
    await withBusyButton(elements.renameSubmit, async () => {
      const displayName = asNonEmptyString(elements.renameDisplayName.value);
      if (!displayName) {
        setFeedback("Update name requires a non-empty display name.", "error");
        return;
      }
      if (!currentSession) {
        setFeedback("Join a lobby before updating your display name.", "warning");
        return;
      }

      const lobbyId =
        options.store.getState().lobby?.lobbyId ?? currentSession.identity.lobbyId;
      try {
        const renamed = await options.httpClient.updateLobbyName({
          lobbyId,
          playerId: currentSession.identity.playerId,
          displayName
        });
        pushOutbound(renamed.outbound);
        currentSession = options.sessionClient.update({
          identity: currentSession.identity,
          displayName
        });
        elements.createDisplayName.value = displayName;
        elements.joinDisplayName.value = displayName;
        setFeedback("Display name updated.", "success");
      } catch (error) {
        setFeedback(`Update name failed: ${errorMessage(error)}`, "error");
      } finally {
        renderPanels();
      }
    });
  };

  const handleStart = async (): Promise<void> => {
    if (!currentSession) {
      setFeedback("Join a lobby before starting a game.", "warning");
      return;
    }

    const lobby = options.store.getState().lobby;
    const readiness = deriveStartReadiness({
      lobby,
      sessionIdentity: currentSession.identity
    });
    if (!readiness.canStart || !lobby) {
      setFeedback(readiness.disabledReason, "warning");
      return;
    }

    const startButton = options.documentRef.getElementById("lobby-start-button");
    const typedStartButton = startButton as HTMLButtonElement | null;
    if (typedStartButton) {
      typedStartButton.disabled = true;
    }
    try {
      const started = await options.httpClient.startLobby({
        lobbyId: lobby.lobbyId,
        actorPlayerId: currentSession.identity.playerId
      });
      pushOutbound(started.outbound);
      setFeedback("Game started. Routing to game board next phase.", "success");
    } catch (error) {
      setFeedback(`Start lobby failed: ${errorMessage(error)}`, "error");
    } finally {
      if (typedStartButton) {
        typedStartButton.disabled = false;
      }
      renderPanels();
    }
  };

  const handleCopyInvite = async (): Promise<void> => {
    const lobbyId =
      options.store.getState().lobby?.lobbyId ?? currentSession?.identity.lobbyId ?? null;
    if (!lobbyId) {
      setFeedback("Create or join a lobby before sharing invite links.", "warning");
      return;
    }

    const inviteLink = buildInviteLink(options.win.location.href, lobbyId, inviteOrigin);
    const localOnlyInvite = !inviteOrigin && isLocalOnlyBrowserOrigin(options.win);
    syncInviteField(lobbyId);
    if (localOnlyInvite) {
      setFeedback(
        "Invite link points to localhost. Set PUBLIC_ORIGIN to a LAN URL so other devices can join.",
        "warning"
      );
    }
    const clipboard = options.win.navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      setFeedback("Clipboard API unavailable. Copy the link from the field.", "warning");
      return;
    }

    try {
      await clipboard.writeText(inviteLink);
      if (localOnlyInvite) {
        setFeedback(
          "Copied localhost invite link. It only works on this machine unless PUBLIC_ORIGIN is configured.",
          "warning"
        );
      } else {
        setFeedback("Invite link copied to clipboard.", "success");
      }
    } catch {
      setFeedback("Clipboard write failed. Copy the link from the field.", "warning");
    }
  };

  const handleShareInvite = async (): Promise<void> => {
    const lobbyId =
      options.store.getState().lobby?.lobbyId ?? currentSession?.identity.lobbyId ?? null;
    if (!lobbyId) {
      setFeedback("Create or join a lobby before sharing invite links.", "warning");
      return;
    }

    const inviteLink = buildInviteLink(options.win.location.href, lobbyId, inviteOrigin);
    const localOnlyInvite = !inviteOrigin && isLocalOnlyBrowserOrigin(options.win);
    if (localOnlyInvite) {
      setFeedback(
        "Invite link points to localhost. Set PUBLIC_ORIGIN to a LAN URL so other devices can join.",
        "warning"
      );
    }
    const shareFn = options.win.navigator.share;
    if (typeof shareFn !== "function") {
      await handleCopyInvite();
      return;
    }

    try {
      await shareFn.call(options.win.navigator, {
        title: "Join my Fun Euchre lobby",
        text: "Join this private lobby:",
        url: inviteLink
      });
      if (localOnlyInvite) {
        setFeedback(
          "Shared localhost invite link. It only works on this machine unless PUBLIC_ORIGIN is configured.",
          "warning"
        );
      } else {
        setFeedback("Invite link shared.", "success");
      }
    } catch {
      setFeedback("Share was cancelled or unavailable. Use copy instead.", "warning");
    }
  };

  const handleStartClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.id !== "lobby-start-button") {
      return;
    }

    void handleStart();
  };

  const storeUnsubscribe = options.store.subscribe(() => {
    renderPanels();
    const snapshot = options.store.getState();
    const latestNotice = snapshot.notices.at(-1);
    if (latestNotice && (!elements.feedback.textContent || elements.feedback.dataset.tone === "info")) {
      const tone: FeedbackTone =
        latestNotice.severity === "error"
          ? "error"
          : latestNotice.severity === "warning"
            ? "warning"
            : "info";
      setFeedback(latestNotice.message, tone);
    }
  });

  const initialInviteLobbyId = resolveInviteLobbyId(options.win.location.href);
  if (initialInviteLobbyId) {
    elements.joinLobbyId.value = initialInviteLobbyId;
  }
  if (currentSession) {
    const displayName = currentSession.displayName;
    elements.createDisplayName.value = displayName;
    elements.joinDisplayName.value = displayName;
    elements.renameDisplayName.value = displayName;
    elements.joinReconnectToken.value = "";
    if (!elements.joinLobbyId.value.trim()) {
      elements.joinLobbyId.value = currentSession.identity.lobbyId;
    }
  }

  elements.createForm.addEventListener("submit", (event) => {
    void handleCreate(event);
  });
  elements.joinForm.addEventListener("submit", (event) => {
    void handleJoin(event);
  });
  elements.renameForm.addEventListener("submit", (event) => {
    void handleRename(event);
  });
  elements.startControls.addEventListener("click", handleStartClick);
  elements.copyInviteButton.addEventListener("click", () => {
    void handleCopyInvite();
  });
  elements.shareInviteButton.addEventListener("click", () => {
    void handleShareInvite();
  });

  renderPanels();
  if (options.initialFeedback) {
    setFeedback(options.initialFeedback.message, options.initialFeedback.tone);
  } else {
    setFeedback("Ready for create/join/start actions.", "info");
  }

  if (currentSession) {
    void ensureRealtime(currentSession.identity).catch((error) => {
      setFeedback(`Realtime connect failed: ${errorMessage(error)}`, "warning");
      renderPanels();
    });
  }

  return () => {
    storeUnsubscribe();
    elements.startControls.removeEventListener("click", handleStartClick);
    if (realtimeClient) {
      realtimeClient.disconnect();
      realtimeClient = null;
      realtimeSessionId = null;
    }
  };
}
