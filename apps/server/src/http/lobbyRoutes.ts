import {
  PROTOCOL_VERSION,
  type ClientToServerEvent,
  type RejectCode,
  type ServerToClientEvent,
  validateClientToServerEvent
} from "@fun-euchre/protocol";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  toDomainCommand,
  type DomainCommand
} from "../domain/protocolAdapter.js";
import { createNoopLogger, type StructuredLogger } from "../observability/logger.js";
import type { RouteDefinition } from "./router.js";
import {
  readJsonBody,
  resolveRequestId,
  statusCodeForRejectCode,
  writeJsonError,
  writeJsonResponse
} from "./json.js";
import type { OperationalMetrics } from "../observability/metrics.js";

type LobbyCommandKind =
  | "lobby.create"
  | "lobby.join"
  | "lobby.update_name"
  | "lobby.start";

type LobbyCommand = Extract<DomainCommand, { kind: LobbyCommandKind }>;

export type LobbyCommandDispatchIdentity = {
  lobbyId: string;
  playerId: string;
  sessionId: string;
  reconnectToken: string;
};

export type CommandDispatchSuccess = {
  ok: true;
  outbound: ServerToClientEvent[];
  identity?: LobbyCommandDispatchIdentity;
  statusCode?: number;
};

export type CommandDispatchFailure = {
  ok: false;
  code: RejectCode;
  message: string;
  statusCode?: number;
};

export type CommandDispatchResult = CommandDispatchSuccess | CommandDispatchFailure;

export type LobbyCommandDispatcher = (
  command: LobbyCommand,
  event: ClientToServerEvent
) => Promise<CommandDispatchResult> | CommandDispatchResult;

export type LobbyRoutesOptions = {
  dispatchCommand?: LobbyCommandDispatcher;
  logger?: StructuredLogger;
  metrics?: OperationalMetrics;
};

const DEFAULT_LOBBY_DISPATCHER: LobbyCommandDispatcher = () => ({
  ok: false,
  code: "INVALID_STATE",
  message: "Lobby command dispatcher is not configured."
});

function isLobbyCommand(command: DomainCommand): command is LobbyCommand {
  return (
    command.kind === "lobby.create" ||
    command.kind === "lobby.join" ||
    command.kind === "lobby.update_name" ||
    command.kind === "lobby.start"
  );
}

function correlationFromLobbyCommand(
  command: LobbyCommand
): { lobbyId: string | null; playerId: string | null } {
  switch (command.kind) {
    case "lobby.create":
      return {
        lobbyId: null,
        playerId: null
      };
    case "lobby.join":
      return {
        lobbyId: command.lobbyId,
        playerId: null
      };
    case "lobby.update_name":
      return {
        lobbyId: command.lobbyId,
        playerId: command.playerId
      };
    case "lobby.start":
      return {
        lobbyId: command.lobbyId,
        playerId: command.actorPlayerId
      };
  }
}

function elapsedSince(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs);
}

async function handleLobbyRoute(
  routeType: LobbyCommandKind,
  dispatchCommand: LobbyCommandDispatcher,
  logger: StructuredLogger,
  metrics: OperationalMetrics | undefined,
  request: IncomingMessage,
  response: ServerResponse,
  payloadFactory: (body: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  const startedAtMs = Date.now();
  let reconnectAttempted = false;
  const recordCommand = (
    outcome: "accepted" | "rejected",
    rejectCode?: RejectCode | null
  ): void => {
    metrics?.recordCommand({
      scope: "lobby",
      kind: routeType,
      outcome,
      latencyMs: elapsedSince(startedAtMs),
      rejectCode: rejectCode ?? null
    });
  };
  const recordReconnectAttempt = (): void => {
    if (routeType !== "lobby.join") {
      return;
    }
    reconnectAttempted = true;
    metrics?.recordReconnectAttempt({
      transport: "http"
    });
  };
  const recordReconnectSuccess = (): void => {
    if (!reconnectAttempted) {
      return;
    }
    metrics?.recordReconnectSuccess({
      transport: "http"
    });
  };
  const recordReconnectFailure = (reason: string): void => {
    if (!reconnectAttempted) {
      return;
    }
    metrics?.recordReconnectFailure({
      transport: "http",
      reason
    });
  };

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
    recordCommand("rejected", "INVALID_ACTION");
    logger.logReject({
      code: "INVALID_ACTION",
      message: bodyResult.message,
      requestId: null,
      metadata: {
        routeType
      }
    });
    writeJsonError(response, {
      statusCode: 400,
      requestId: null,
      code: "INVALID_ACTION",
      message: bodyResult.message
    });
    return;
  }

  if (
    routeType === "lobby.join" &&
    typeof bodyResult.data.reconnectToken === "string" &&
    bodyResult.data.reconnectToken.trim().length > 0
  ) {
    recordReconnectAttempt();
  }

  const requestId = resolveRequestId(request, bodyResult.data);
  const candidate = {
    version: PROTOCOL_VERSION,
    type: routeType,
    requestId,
    payload: payloadFactory(bodyResult.data)
  };
  const validated = validateClientToServerEvent(candidate);
  if (!validated.ok) {
    recordCommand("rejected", "INVALID_ACTION");
    recordReconnectFailure("INVALID_ACTION");
    logger.logReject({
      code: "INVALID_ACTION",
      message: validated.issues.join(" "),
      requestId,
      metadata: {
        routeType,
        issues: validated.issues
      }
    });
    writeJsonError(response, {
      statusCode: 400,
      requestId,
      code: "INVALID_ACTION",
      message: validated.issues.join(" "),
      issues: validated.issues
    });
    return;
  }

  const mapped = toDomainCommand(validated.data);
  if (!mapped.ok) {
    recordCommand("rejected", mapped.reject.code);
    recordReconnectFailure(mapped.reject.code);
    logger.logReject({
      code: mapped.reject.code,
      message: mapped.reject.message,
      requestId,
      metadata: {
        routeType
      }
    });
    writeJsonError(response, {
      statusCode: statusCodeForRejectCode(mapped.reject.code),
      requestId,
      code: mapped.reject.code,
      message: mapped.reject.message
    });
    return;
  }
  if (!isLobbyCommand(mapped.data)) {
    recordCommand("rejected", "INVALID_ACTION");
    recordReconnectFailure("INVALID_ACTION");
    logger.logReject({
      code: "INVALID_ACTION",
      message: `Unsupported command kind "${mapped.data.kind}" for ${routeType}.`,
      requestId,
      metadata: {
        routeType,
        commandKind: mapped.data.kind
      }
    });
    writeJsonError(response, {
      statusCode: 400,
      requestId,
      code: "INVALID_ACTION",
      message: `Unsupported command kind "${mapped.data.kind}" for ${routeType}.`
    });
    return;
  }

  const correlation = correlationFromLobbyCommand(mapped.data);
  const dispatched = await dispatchCommand(mapped.data, validated.data);
  if (!dispatched.ok) {
    recordCommand("rejected", dispatched.code);
    recordReconnectFailure(dispatched.code);
    logger.logReject({
      code: dispatched.code,
      message: dispatched.message,
      requestId,
      lobbyId: correlation.lobbyId,
      playerId: correlation.playerId,
      metadata: {
        routeType,
        commandKind: mapped.data.kind
      }
    });
    writeJsonError(response, {
      statusCode: dispatched.statusCode ?? statusCodeForRejectCode(dispatched.code),
      requestId,
      code: dispatched.code,
      message: dispatched.message
    });
    return;
  }

  recordCommand("accepted");
  recordReconnectSuccess();
  metrics?.observeOutbound(dispatched.outbound);
  logger.logLobbyAction({
    action: mapped.data.kind,
    outcome: "accepted",
    message: "Lobby command accepted.",
    requestId,
    lobbyId: correlation.lobbyId,
    playerId: correlation.playerId,
    metadata: {
      routeType,
      statusCode: dispatched.statusCode ?? 200,
      outboundCount: dispatched.outbound.length
    }
  });

  const responsePayload: {
    requestId: string;
    outbound: ServerToClientEvent[];
    identity?: LobbyCommandDispatchIdentity;
  } = {
    requestId,
    outbound: [...dispatched.outbound]
  };
  if (dispatched.identity) {
    responsePayload.identity = {
      ...dispatched.identity
    };
  }

  writeJsonResponse(response, dispatched.statusCode ?? 200, responsePayload);
}

export function createLobbyRoutes(options: LobbyRoutesOptions = {}): RouteDefinition[] {
  const dispatchCommand = options.dispatchCommand ?? DEFAULT_LOBBY_DISPATCHER;
  const logger = options.logger ?? createNoopLogger();
  const metrics = options.metrics;

  return [
    {
      method: "POST",
      path: "/lobbies/create",
      handler: async ({ request, response }) => {
        await handleLobbyRoute(
          "lobby.create",
          dispatchCommand,
          logger,
          metrics,
          request,
          response,
          (body) => ({
            displayName: body.displayName
          })
        );
      }
    },
    {
      method: "POST",
      path: "/lobbies/join",
      handler: async ({ request, response }) => {
        await handleLobbyRoute(
          "lobby.join",
          dispatchCommand,
          logger,
          metrics,
          request,
          response,
          (body) => {
            const payload: Record<string, unknown> = {
              lobbyId: body.lobbyId,
              displayName: body.displayName
            };
            if (Object.prototype.hasOwnProperty.call(body, "reconnectToken")) {
              payload.reconnectToken = body.reconnectToken;
            }

            return payload;
          }
        );
      }
    },
    {
      method: "POST",
      path: "/lobbies/update-name",
      handler: async ({ request, response }) => {
        await handleLobbyRoute(
          "lobby.update_name",
          dispatchCommand,
          logger,
          metrics,
          request,
          response,
          (body) => ({
            lobbyId: body.lobbyId,
            playerId: body.playerId,
            displayName: body.displayName
          })
        );
      }
    },
    {
      method: "POST",
      path: "/lobbies/start",
      handler: async ({ request, response }) => {
        await handleLobbyRoute(
          "lobby.start",
          dispatchCommand,
          logger,
          metrics,
          request,
          response,
          (body) => ({
            lobbyId: body.lobbyId,
            actorPlayerId: body.actorPlayerId
          })
        );
      }
    }
  ];
}
