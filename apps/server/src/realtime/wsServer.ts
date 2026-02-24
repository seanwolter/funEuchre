import { createHash } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { parseGameId, parseReconnectToken, parseSessionId } from "../domain/ids.js";
import { setLobbyPlayerConnection } from "../domain/lobby.js";
import {
  toGamePrivateStateEvent,
  toGameStateEvent,
  toLobbyStateEvent
} from "../domain/protocolAdapter.js";
import type { ReconnectPolicy } from "../domain/reconnectPolicy.js";
import type {
  RuntimeGameStorePort,
  RuntimeLobbyStorePort,
  RuntimeRealtimeFanoutPort,
  RuntimeSessionStorePort
} from "../domain/runtimePorts.js";
import type { SessionId } from "../domain/types.js";
import { createNoopLogger, type StructuredLogger } from "../observability/logger.js";
import type { OperationalMetrics } from "../observability/metrics.js";
import type { ReconnectTokenManager } from "../security/reconnectToken.js";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_WS_PATH = "/realtime/ws";

type WsRuntimeDependencies = {
  lobbyStore: RuntimeLobbyStorePort;
  gameStore: RuntimeGameStorePort;
  sessionStore: RuntimeSessionStorePort;
  reconnectPolicy: ReconnectPolicy;
  reconnectTokenManager: ReconnectTokenManager;
  socketServer: RuntimeRealtimeFanoutPort;
  requestCheckpoint?: () => void;
  now?: () => number;
};

export type WsServerOptions = {
  server: Server;
  runtime: WsRuntimeDependencies;
  path?: string;
  logger?: StructuredLogger;
  metrics?: OperationalMetrics;
};

export type WsServerHandle = {
  path: string;
  close(): void;
};

type WsControlMessage = {
  type: "ws.ready" | "ws.subscribed" | "ws.error";
  payload: Record<string, unknown>;
};

type ParsedFrame = {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  bytesConsumed: number;
};

function isWebSocketUpgrade(request: IncomingMessage): boolean {
  const upgrade = request.headers.upgrade;
  return typeof upgrade === "string" && upgrade.toLowerCase() === "websocket";
}

function normalizeRequestPath(request: IncomingMessage): string | null {
  if (!request.url) {
    return null;
  }
  try {
    const parsed = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    return parsed.pathname;
  } catch {
    return null;
  }
}

function getRequestUrl(request: IncomingMessage): URL | null {
  if (!request.url) {
    return null;
  }
  try {
    return new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  } catch {
    return null;
  }
}

function websocketAcceptValue(key: string): string {
  return createHash("sha1")
    .update(key + WEBSOCKET_GUID)
    .digest("base64");
}

function writeHttpUpgradeError(
  socket: Duplex,
  statusCode: 400 | 401 | 403 | 404,
  reason: string
): void {
  const body = `${reason}\n`;
  socket.write(
    `HTTP/1.1 ${statusCode} ${reason}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "\r\n" +
      body
  );
  socket.destroy();
}

function encodeFrame(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, payload]);
}

function tryParseFrame(buffer: Buffer): ParsedFrame | null {
  if (buffer.length < 2) {
    return null;
  }

  const first = buffer[0] ?? 0;
  const second = buffer[1] ?? 0;
  const fin = (first & 0x80) === 0x80;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) === 0x80;
  let payloadLength = second & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    const wideLength = buffer.readBigUInt64BE(offset);
    if (wideLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Unsupported websocket payload length.");
    }
    payloadLength = Number(wideLength);
    offset += 8;
  }

  if (!masked) {
    throw new Error("Client frames must be masked.");
  }

  if (buffer.length < offset + 4) {
    return null;
  }
  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  if (buffer.length < offset + payloadLength) {
    return null;
  }

  const payload = buffer.subarray(offset, offset + payloadLength);
  const unmasked = Buffer.alloc(payloadLength);
  for (let index = 0; index < payloadLength; index += 1) {
    const key = mask[index % 4];
    if (key === undefined) {
      throw new Error("Mask key is missing.");
    }
    const payloadByte = payload[index];
    if (payloadByte === undefined) {
      throw new Error("Payload byte is missing.");
    }
    unmasked[index] = payloadByte ^ key;
  }

  return {
    fin,
    opcode,
    payload: unmasked,
    bytesConsumed: offset + payloadLength
  };
}

function sendText(socket: Duplex, payload: unknown): void {
  socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(payload), "utf8")));
}

function sendClose(socket: Duplex, code = 1000, reason = ""): void {
  const reasonBuffer = Buffer.from(reason, "utf8");
  const payload = Buffer.alloc(2 + reasonBuffer.length);
  payload.writeUInt16BE(code, 0);
  reasonBuffer.copy(payload, 2);
  socket.write(encodeFrame(0x8, payload));
}

function sendControl(socket: Duplex, message: WsControlMessage): void {
  sendText(socket, message);
}

async function applySessionConnectionState(
  dependencies: WsRuntimeDependencies,
  sessionId: SessionId,
  connected: boolean,
  logger: StructuredLogger
): Promise<void> {
  const current = dependencies.sessionStore.getBySessionId(sessionId);
  if (!current || current.connected === connected) {
    return;
  }

  const session = dependencies.sessionStore.setConnection(sessionId, connected);
  if (!session) {
    return;
  }

  const lobby = dependencies.lobbyStore.getByLobbyId(session.lobbyId);
  if (!lobby) {
    return;
  }

  const updatedLobby = setLobbyPlayerConnection(lobby.state, {
    playerId: session.playerId,
    connected
  });
  if (!updatedLobby.ok) {
    logger.logReject({
      code: updatedLobby.code,
      message: updatedLobby.message,
      lobbyId: lobby.state.lobbyId,
      playerId: session.playerId,
      requestId: null,
      metadata: {
        transport: "websocket",
        sessionId
      }
    });
    return;
  }

  dependencies.lobbyStore.upsert({ state: updatedLobby.state });
  dependencies.requestCheckpoint?.();
  await dependencies.socketServer.broadcastLobbyEvents(session.lobbyId, [
    toLobbyStateEvent(updatedLobby.state)
  ]);
}

function sendSubscribeCatchup(
  dependencies: WsRuntimeDependencies,
  socket: Duplex,
  sessionId: SessionId
): void {
  const session = dependencies.sessionStore.getBySessionId(sessionId);
  if (!session) {
    return;
  }

  const lobby = dependencies.lobbyStore.getByLobbyId(session.lobbyId);
  if (lobby) {
    sendText(socket, toLobbyStateEvent(lobby.state));
  }

  const game =
    session.gameId === null
      ? null
      : dependencies.gameStore.getByGameId(session.gameId) ??
        dependencies.gameStore.findByLobbyId(session.lobbyId);
  if (!game) {
    return;
  }

  sendText(socket, toGameStateEvent(game.gameId, game.state));

  const seat = lobby?.state.seats.find((candidate) => candidate.playerId === session.playerId);
  if (!seat) {
    return;
  }

  sendText(socket, toGamePrivateStateEvent(game.gameId, game.state, seat.seat));
}

export function createWsServer(options: WsServerOptions): WsServerHandle {
  const path = options.path ?? DEFAULT_WS_PATH;
  const logger = options.logger ?? createNoopLogger();
  const metrics = options.metrics;
  const now = options.runtime.now ?? (() => Date.now());
  const socketsBySessionId = new Map<SessionId, Duplex>();
  const syncActiveSessionCount = (): void => {
    metrics?.setActiveSessionCount(socketsBySessionId.size);
  };
  const recordReconnectFailure = (reason: string): void => {
    metrics?.recordReconnectFailure({
      transport: "websocket",
      reason
    });
  };

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (!isWebSocketUpgrade(request)) {
      writeHttpUpgradeError(socket, 400, "Bad Request");
      return;
    }
    if (normalizeRequestPath(request) !== path) {
      writeHttpUpgradeError(socket, 404, "Not Found");
      return;
    }

    metrics?.recordReconnectAttempt({
      transport: "websocket"
    });

    const requestUrl = getRequestUrl(request);
    if (!requestUrl) {
      recordReconnectFailure("INVALID_REQUEST_URL");
      writeHttpUpgradeError(socket, 400, "Bad Request");
      return;
    }

    const sessionId = parseSessionId(requestUrl.searchParams.get("sessionId"));
    const reconnectToken = parseReconnectToken(
      requestUrl.searchParams.get("reconnectToken")
    );
    if (!sessionId || !reconnectToken) {
      recordReconnectFailure("INVALID_QUERY");
      writeHttpUpgradeError(socket, 401, "Unauthorized");
      return;
    }

    const tokenVerification = options.runtime.reconnectTokenManager.verify(reconnectToken, {
      expectedSessionId: sessionId
    });
    if (!tokenVerification.ok) {
      recordReconnectFailure("UNAUTHORIZED");
      writeHttpUpgradeError(socket, 401, "Unauthorized");
      return;
    }

    const session = options.runtime.sessionStore.getBySessionId(sessionId);
    if (!session || session.reconnectToken !== reconnectToken) {
      recordReconnectFailure("UNAUTHORIZED");
      writeHttpUpgradeError(socket, 401, "Unauthorized");
      return;
    }
    if (
      session.lobbyId !== tokenVerification.claims.lobbyId ||
      session.playerId !== tokenVerification.claims.playerId
    ) {
      recordReconnectFailure("UNAUTHORIZED");
      writeHttpUpgradeError(socket, 401, "Unauthorized");
      return;
    }
    if (options.runtime.reconnectPolicy.shouldForfeit(session, now())) {
      recordReconnectFailure("FORBIDDEN");
      writeHttpUpgradeError(socket, 403, "Forbidden");
      return;
    }

    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string" || key.length === 0) {
      recordReconnectFailure("INVALID_HANDSHAKE");
      writeHttpUpgradeError(socket, 400, "Bad Request");
      return;
    }

    const existingSocket = socketsBySessionId.get(sessionId);
    if (existingSocket) {
      sendClose(existingSocket, 1012, "Replaced by newer websocket session.");
      existingSocket.destroy();
      socketsBySessionId.delete(sessionId);
      syncActiveSessionCount();
    }

    const accept = websocketAcceptValue(key);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        "\r\n"
    );
    if ("setNoDelay" in socket && typeof socket.setNoDelay === "function") {
      socket.setNoDelay(true);
    }
    socketsBySessionId.set(sessionId, socket);
    syncActiveSessionCount();
    metrics?.recordReconnectSuccess({
      transport: "websocket"
    });

    options.runtime.socketServer.connectSession({
      sessionId,
      send: (event) => {
        sendText(socket, event);
      }
    });
    void applySessionConnectionState(options.runtime, sessionId, true, logger);
    sendControl(socket, {
      type: "ws.ready",
      payload: {
        sessionId,
        lobbyId: session.lobbyId,
        gameId: session.gameId
      }
    });

    let disconnected = false;
    const disconnect = (): void => {
      if (disconnected) {
        return;
      }
      disconnected = true;
      if (socketsBySessionId.get(sessionId) === socket) {
        socketsBySessionId.delete(sessionId);
        syncActiveSessionCount();
      }
      options.runtime.socketServer.disconnectSession(sessionId);
      void applySessionConnectionState(options.runtime, sessionId, false, logger);
    };

    let buffered = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
    const handleBuffered = (): void => {
      while (buffered.length > 0) {
        let frame: ParsedFrame | null;
        try {
          frame = tryParseFrame(buffered);
        } catch {
          sendClose(socket, 1002, "Invalid websocket frame.");
          socket.destroy();
          return;
        }
        if (!frame) {
          return;
        }

        buffered = buffered.subarray(frame.bytesConsumed);
        if (!frame.fin) {
          sendClose(socket, 1003, "Fragmented frames are not supported.");
          socket.destroy();
          return;
        }

        if (frame.opcode === 0x8) {
          sendClose(socket, 1000, "Closing.");
          socket.end();
          return;
        }
        if (frame.opcode === 0x9) {
          socket.write(encodeFrame(0xA, frame.payload));
          continue;
        }
        if (frame.opcode !== 0x1) {
          sendClose(socket, 1003, "Unsupported websocket opcode.");
          socket.destroy();
          return;
        }

        let message: unknown;
        try {
          message = JSON.parse(frame.payload.toString("utf8"));
        } catch {
          sendControl(socket, {
            type: "ws.error",
            payload: {
              code: "INVALID_ACTION",
              message: "Realtime payload must be valid JSON."
            }
          });
          continue;
        }

        if (typeof message !== "object" || message === null || Array.isArray(message)) {
          sendControl(socket, {
            type: "ws.error",
            payload: {
              code: "INVALID_ACTION",
              message: "Realtime message must be a JSON object."
            }
          });
          continue;
        }

        const parsedMessage = message as Record<string, unknown>;
        const messageType =
          typeof parsedMessage.type === "string" ? parsedMessage.type : null;
        if (messageType !== "subscribe") {
          sendControl(socket, {
            type: "ws.error",
            payload: {
              code: "INVALID_ACTION",
              message: "Unsupported realtime message type."
            }
          });
          continue;
        }

        const latestSession = options.runtime.sessionStore.getBySessionId(sessionId);
        if (!latestSession || latestSession.reconnectToken !== reconnectToken) {
          sendControl(socket, {
            type: "ws.error",
            payload: {
              code: "UNAUTHORIZED",
              message: "Realtime session is not authorized."
            }
          });
          sendClose(socket, 1008, "Unauthorized.");
          socket.destroy();
          return;
        }

        const payload =
          typeof parsedMessage.payload === "object" &&
          parsedMessage.payload !== null &&
          !Array.isArray(parsedMessage.payload)
            ? (parsedMessage.payload as Record<string, unknown>)
            : {};

        const requestedLobbyRaw =
          typeof payload.lobbyId === "string" ? payload.lobbyId : latestSession.lobbyId;
        const requestedGameRaw =
          typeof payload.gameId === "string" ? payload.gameId : latestSession.gameId;

        if (requestedLobbyRaw !== latestSession.lobbyId) {
          sendControl(socket, {
            type: "ws.error",
            payload: {
              code: "UNAUTHORIZED",
              message: "Realtime subscribe lobbyId does not match session lobby."
            }
          });
          continue;
        }

        if (
          requestedGameRaw !== null &&
          requestedGameRaw !== latestSession.gameId
        ) {
          sendControl(socket, {
            type: "ws.error",
            payload: {
              code: "UNAUTHORIZED",
              message: "Realtime subscribe gameId does not match session game."
            }
          });
          continue;
        }

        const lobbyId = latestSession.lobbyId;
        const gameId =
          requestedGameRaw === null ? null : parseGameId(requestedGameRaw);
        if (requestedGameRaw !== null && !gameId) {
          sendControl(socket, {
            type: "ws.error",
            payload: {
              code: "INVALID_ACTION",
              message: "Realtime subscribe gameId is invalid."
            }
          });
          continue;
        }

        options.runtime.socketServer.bindSessionToLobby(sessionId, lobbyId);
        if (gameId !== null) {
          options.runtime.socketServer.bindSessionToGame(sessionId, gameId);
        }

        sendSubscribeCatchup(options.runtime, socket, sessionId);
        sendControl(socket, {
          type: "ws.subscribed",
          payload: {
            rooms: options.runtime.socketServer.listSessionRooms(sessionId)
          }
        });
      }
    };

    socket.on("data", (chunk: Buffer | string) => {
      const nextChunk = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      buffered = Buffer.concat([buffered, nextChunk]);
      handleBuffered();
    });
    socket.on("end", disconnect);
    socket.on("close", disconnect);
    socket.on("error", disconnect);
    handleBuffered();
  };

  options.server.on("upgrade", onUpgrade);

  return {
    path,
    close: () => {
      options.server.off("upgrade", onUpgrade);
      for (const socket of socketsBySessionId.values()) {
        socket.destroy();
      }
      socketsBySessionId.clear();
      syncActiveSessionCount();
    }
  };
}
