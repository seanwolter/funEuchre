import {
  validateServerToClientEvent,
  type ServerToClientEvent
} from "@fun-euchre/protocol";
import { createRequestId, type RequestIdFactory } from "../lib/requestId.js";
import type { SessionIdentity } from "../lib/session.js";
import type { GameStore } from "../state/gameStore.js";
import type { ReducerResult } from "../state/reducer.js";

type WebSocketFactory = (url: string) => WebSocket;

type SubscribeOptions = {
  lobbyId?: string;
  gameId?: string | null;
};

export type RealtimeClientStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "subscribed"
  | "disconnected"
  | "error";

export type RealtimeLifecycleEvent = {
  status: RealtimeClientStatus;
  code?: string;
  message?: string;
};

export type RealtimeClientOptions = {
  identity: SessionIdentity;
  store: GameStore;
  baseUrl?: string;
  webSocketFactory?: WebSocketFactory;
  requestIdFactory?: RequestIdFactory;
  onLifecycle?: (event: RealtimeLifecycleEvent) => void;
};

export type RealtimeClient = {
  connect(subscribe?: SubscribeOptions): Promise<void>;
  disconnect(code?: number, reason?: string): void;
  status(): RealtimeClientStatus;
  dispatchHttpOutbound(events: readonly ServerToClientEvent[]): ReducerResult;
};

type WsControlMessage = {
  type: "ws.ready" | "ws.subscribed" | "ws.error";
  payload: Record<string, unknown>;
};

function isJsonObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function parseControlMessage(input: unknown): WsControlMessage | null {
  if (!isJsonObject(input)) {
    return null;
  }

  const type = input.type;
  if (type !== "ws.ready" && type !== "ws.subscribed" && type !== "ws.error") {
    return null;
  }

  const payload = isJsonObject(input.payload) ? input.payload : {};
  return {
    type,
    payload
  };
}

function resolveDefaultBaseUrl(): string {
  if (typeof window === "undefined") {
    throw new Error("baseUrl is required outside browser environments.");
  }

  return window.location.href;
}

function toWebSocketUrl(baseUrl: string, identity: SessionIdentity): string {
  const url = new URL("/realtime/ws", baseUrl);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Unsupported realtime URL protocol "${url.protocol}".`);
  }

  url.searchParams.set("sessionId", identity.sessionId);
  url.searchParams.set("reconnectToken", identity.reconnectToken);
  return url.toString();
}

function resolveWebSocketFactory(factory: WebSocketFactory | undefined): WebSocketFactory {
  if (factory) {
    return factory;
  }
  if (typeof WebSocket === "function") {
    return (url) => new WebSocket(url);
  }

  throw new Error("WebSocket API is unavailable in this runtime.");
}

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  const requestIdFactory = options.requestIdFactory ?? createRequestId;
  const baseUrl = options.baseUrl?.trim() || resolveDefaultBaseUrl();
  const createSocket = resolveWebSocketFactory(options.webSocketFactory);

  let currentStatus: RealtimeClientStatus = "idle";
  let socket: WebSocket | null = null;
  let removeSocketListeners: (() => void) | null = null;

  const emitLifecycle = (event: RealtimeLifecycleEvent): void => {
    options.onLifecycle?.(event);
  };

  const setStatus = (
    status: RealtimeClientStatus,
    code?: string,
    message?: string
  ): void => {
    currentStatus = status;
    const event: RealtimeLifecycleEvent = {
      status
    };
    if (code) {
      event.code = code;
    }
    if (message) {
      event.message = message;
    }
    emitLifecycle(event);
  };

  const bindSocketListeners = (targetSocket: WebSocket): (() => void) => {
    const onMessage = (event: MessageEvent): void => {
      if (typeof event.data !== "string") {
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data) as unknown;
      } catch {
        emitLifecycle({
          status: currentStatus,
          code: "INVALID_ACTION",
          message: "Realtime payload must be valid JSON."
        });
        return;
      }

      const control = parseControlMessage(parsed);
      if (control) {
        switch (control.type) {
          case "ws.ready":
            setStatus("connected");
            return;
          case "ws.subscribed":
            setStatus("subscribed");
            return;
          case "ws.error": {
            const code =
              typeof control.payload.code === "string" ? control.payload.code : "WS_ERROR";
            const message =
              typeof control.payload.message === "string"
                ? control.payload.message
                : "Realtime server reported an error.";
            emitLifecycle({
              status: currentStatus,
              code,
              message
            });
            return;
          }
        }
      }

      const validated = validateServerToClientEvent(parsed);
      if (!validated.ok) {
        emitLifecycle({
          status: currentStatus,
          code: "INVALID_RESPONSE",
          message: validated.issues.join(" ")
        });
        return;
      }

      options.store.dispatchEvents("realtime", [validated.data]);
    };

    const onClose = (event: CloseEvent): void => {
      if (socket !== targetSocket) {
        return;
      }

      socket = null;
      removeSocketListeners = null;
      const reason = event.reason.trim();
      const message = reason
        ? `Realtime disconnected: ${reason} Rejoin from lobby controls if this persists.`
        : "Realtime disconnected. Rejoin from lobby controls if this persists.";
      setStatus("disconnected", "WS_DISCONNECTED", message);
    };

    const onError = (): void => {
      emitLifecycle({
        status: currentStatus,
        code: "NETWORK_ERROR",
        message: "Realtime websocket encountered an error. Check connection and retry."
      });
    };

    targetSocket.addEventListener("message", onMessage);
    targetSocket.addEventListener("close", onClose);
    targetSocket.addEventListener("error", onError);
    return () => {
      targetSocket.removeEventListener("message", onMessage);
      targetSocket.removeEventListener("close", onClose);
      targetSocket.removeEventListener("error", onError);
    };
  };

  return {
    connect: async (subscribe = {}) => {
      if (socket) {
        if (removeSocketListeners) {
          removeSocketListeners();
          removeSocketListeners = null;
        }
        socket.close(1000, "Replaced by newer connection.");
        socket = null;
      }

      setStatus("connecting", "WS_CONNECTING", "Reconnecting realtime stream...");
      const nextSocket = createSocket(toWebSocketUrl(baseUrl, options.identity));
      socket = nextSocket;

      try {
        await new Promise<void>((resolve, reject) => {
          const handleOpen = (): void => {
            cleanup();
            resolve();
          };
          const handleError = (): void => {
            cleanup();
            reject(new Error("WebSocket connection failed."));
          };
          const handleClose = (): void => {
            cleanup();
            reject(new Error("WebSocket closed before connecting."));
          };
          const cleanup = (): void => {
            nextSocket.removeEventListener("open", handleOpen);
            nextSocket.removeEventListener("error", handleError);
            nextSocket.removeEventListener("close", handleClose);
          };

          nextSocket.addEventListener("open", handleOpen);
          nextSocket.addEventListener("error", handleError);
          nextSocket.addEventListener("close", handleClose);
        });
      } catch (error) {
        if (socket === nextSocket) {
          socket = null;
        }
        setStatus("error", "NETWORK_ERROR", (error as Error).message);
        throw error;
      }

      removeSocketListeners = bindSocketListeners(nextSocket);
      setStatus("connected");

      const payload: {
        lobbyId: string;
        gameId?: string | null;
      } = {
        lobbyId: subscribe.lobbyId ?? options.identity.lobbyId
      };
      if (subscribe.gameId !== undefined) {
        payload.gameId = subscribe.gameId;
      }

      nextSocket.send(
        JSON.stringify({
          type: "subscribe",
          requestId: requestIdFactory(),
          payload
        })
      );
    },
    disconnect: (code = 1000, reason = "Client disconnect.") => {
      if (!socket) {
        return;
      }

      if (removeSocketListeners) {
        removeSocketListeners();
        removeSocketListeners = null;
      }
      const active = socket;
      socket = null;
      active.close(code, reason);
      setStatus("disconnected");
    },
    status: () => currentStatus,
    dispatchHttpOutbound: (events) => options.store.dispatchEvents("http", events)
  };
}
