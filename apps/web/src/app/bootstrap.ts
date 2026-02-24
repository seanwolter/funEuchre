import type { HttpClient } from "../lib/httpClient.js";
import type { SessionClient, StoredSession } from "../lib/session.js";
import type { GameStore } from "../state/gameStore.js";

export type BootstrapStatus = "idle" | "reconnecting" | "reconnected" | "expired" | "failed";

export type BootstrapNotice = {
  tone: "info" | "success" | "warning" | "error";
  message: string;
};

export type BootstrapResult = {
  status: BootstrapStatus;
  session: StoredSession | null;
  notice: BootstrapNotice | null;
};

export type BootstrapOptions = {
  store: GameStore;
  httpClient: HttpClient;
  sessionClient: SessionClient;
};

type ErrorLike = {
  code?: string;
  message?: string;
};

function asErrorLike(error: unknown): ErrorLike {
  if (typeof error !== "object" || error === null) {
    return {};
  }
  const value = error as Record<string, unknown>;
  const result: ErrorLike = {};
  if (typeof value.code === "string") {
    result.code = value.code;
  }
  if (typeof value.message === "string") {
    result.message = value.message;
  }
  return result;
}

function includesReconnectExpiryHint(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("reconnect") ||
    normalized.includes("forfeit") ||
    normalized.includes("expired") ||
    normalized.includes("timeout")
  );
}

function dispatchNotice(
  store: GameStore,
  severity: "info" | "warning" | "error",
  message: string
): void {
  store.dispatchEvents("http", [
    {
      version: 1,
      type: "system.notice",
      payload: {
        severity,
        message
      }
    }
  ]);
}

export async function bootstrapAppSession(
  options: BootstrapOptions
): Promise<BootstrapResult> {
  const hydrated = options.sessionClient.hydrate();
  if (!hydrated) {
    return {
      status: "idle",
      session: null,
      notice: null
    };
  }

  const reconnectingMessage = `Reconnecting as ${hydrated.displayName}...`;
  dispatchNotice(options.store, "info", reconnectingMessage);

  try {
    const rejoined = await options.httpClient.joinLobby({
      lobbyId: hydrated.identity.lobbyId,
      displayName: hydrated.displayName,
      reconnectToken: hydrated.identity.reconnectToken
    });
    const refreshedSession = options.sessionClient.update({
      identity: rejoined.identity,
      displayName: hydrated.displayName
    });
    options.store.dispatchEvents("http", rejoined.outbound);

    const message = `Reconnected to lobby ${rejoined.identity.lobbyId}.`;
    dispatchNotice(options.store, "info", message);
    return {
      status: "reconnected",
      session: refreshedSession,
      notice: {
        tone: "success",
        message
      }
    };
  } catch (error) {
    const errorLike = asErrorLike(error);
    const message = errorLike.message ?? "Reconnect attempt failed.";
    const code = errorLike.code ?? "";
    const invalidReconnect = code === "UNAUTHORIZED" || code === "INVALID_STATE";
    if (invalidReconnect) {
      options.sessionClient.clear();
      options.store.reset();

      const reconnectExpired = includesReconnectExpiryHint(message);
      const noticeMessage = reconnectExpired
        ? "Reconnect window expired or seat forfeited. Join a lobby again to keep playing."
        : "Saved session is no longer valid. Join the lobby again.";
      dispatchNotice(options.store, "warning", noticeMessage);
      return {
        status: "expired",
        session: null,
        notice: {
          tone: "warning",
          message: noticeMessage
        }
      };
    }

    const noticeMessage =
      "Reconnect failed due network or server error. Retry from lobby controls.";
    dispatchNotice(options.store, "warning", noticeMessage);
    return {
      status: "failed",
      session: hydrated,
      notice: {
        tone: "warning",
        message: noticeMessage
      }
    };
  }
}
