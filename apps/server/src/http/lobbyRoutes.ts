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

type LobbyCommandKind =
  | "lobby.create"
  | "lobby.join"
  | "lobby.update_name"
  | "lobby.start";

type LobbyCommand = Extract<DomainCommand, { kind: LobbyCommandKind }>;

export type CommandDispatchSuccess = {
  ok: true;
  outbound: ServerToClientEvent[];
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

async function handleLobbyRoute(
  routeType: LobbyCommandKind,
  dispatchCommand: LobbyCommandDispatcher,
  logger: StructuredLogger,
  request: IncomingMessage,
  response: ServerResponse,
  payloadFactory: (body: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
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

  const requestId = resolveRequestId(request, bodyResult.data);
  const candidate = {
    version: PROTOCOL_VERSION,
    type: routeType,
    requestId,
    payload: payloadFactory(bodyResult.data)
  };
  const validated = validateClientToServerEvent(candidate);
  if (!validated.ok) {
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

  writeJsonResponse(response, dispatched.statusCode ?? 200, {
    requestId,
    outbound: [...dispatched.outbound]
  });
}

export function createLobbyRoutes(options: LobbyRoutesOptions = {}): RouteDefinition[] {
  const dispatchCommand = options.dispatchCommand ?? DEFAULT_LOBBY_DISPATCHER;
  const logger = options.logger ?? createNoopLogger();

  return [
    {
      method: "POST",
      path: "/lobbies/create",
      handler: async ({ request, response }) => {
        await handleLobbyRoute(
          "lobby.create",
          dispatchCommand,
          logger,
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
