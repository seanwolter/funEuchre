import {
  PROTOCOL_VERSION,
  type ClientToServerEvent,
  type RejectCode,
  type ServerToClientEvent,
  validateClientToServerEvent
} from "@fun-euchre/protocol";
import type { DomainCommand } from "../domain/protocolAdapter.js";
import { toDomainCommand } from "../domain/protocolAdapter.js";
import type { RouteDefinition } from "./router.js";
import {
  readJsonBody,
  resolveRequestId,
  statusCodeForRejectCode,
  writeJsonError,
  writeJsonResponse
} from "./json.js";
import { createNoopLogger, type StructuredLogger } from "../observability/logger.js";
import type { OperationalMetrics } from "../observability/metrics.js";

export type GameCommandDispatchSuccess = {
  ok: true;
  outbound: ServerToClientEvent[];
  statusCode?: number;
};

export type GameCommandDispatchFailure = {
  ok: false;
  code: RejectCode;
  message: string;
  statusCode?: number;
};

export type GameCommandDispatchResult =
  | GameCommandDispatchSuccess
  | GameCommandDispatchFailure;

export type GameCommandDispatcher = (
  command: DomainCommand,
  event: ClientToServerEvent
) => Promise<GameCommandDispatchResult> | GameCommandDispatchResult;

export type GameRoutesOptions = {
  dispatchCommand?: GameCommandDispatcher;
  logger?: StructuredLogger;
  metrics?: OperationalMetrics;
};

const DEFAULT_GAME_DISPATCHER: GameCommandDispatcher = () => ({
  ok: false,
  code: "INVALID_STATE",
  message: "Game command dispatcher is not configured."
});

function correlationFromCommand(command: DomainCommand): {
  lobbyId: string | null;
  gameId: string | null;
  playerId: string | null;
} {
  switch (command.kind) {
    case "lobby.create":
      return { lobbyId: null, gameId: null, playerId: null };
    case "lobby.join":
      return { lobbyId: command.lobbyId, gameId: null, playerId: null };
    case "lobby.update_name":
      return { lobbyId: command.lobbyId, gameId: null, playerId: command.playerId };
    case "lobby.start":
      return { lobbyId: command.lobbyId, gameId: null, playerId: command.actorPlayerId };
    case "game.play_card":
    case "game.pass":
    case "game.order_up":
    case "game.call_trump":
      return { lobbyId: null, gameId: command.gameId, playerId: null };
  }
}

function elapsedSince(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs);
}

export function createGameRoutes(options: GameRoutesOptions = {}): RouteDefinition[] {
  const dispatchCommand = options.dispatchCommand ?? DEFAULT_GAME_DISPATCHER;
  const logger = options.logger ?? createNoopLogger();
  const metrics = options.metrics;

  return [
    {
      method: "POST",
      path: "/actions",
      handler: async ({ request, response }) => {
        const startedAtMs = Date.now();
        let commandKind = "actions.unknown";
        const recordCommand = (
          outcome: "accepted" | "rejected",
          rejectCode?: RejectCode | null
        ): void => {
          metrics?.recordCommand({
            scope: "actions",
            kind: commandKind,
            outcome,
            latencyMs: elapsedSince(startedAtMs),
            rejectCode: rejectCode ?? null
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
              routeType: "actions"
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

        if (typeof bodyResult.data.type === "string") {
          commandKind = bodyResult.data.type;
        }
        const requestId = resolveRequestId(request, bodyResult.data);
        const candidate: unknown = {
          version:
            bodyResult.data.version === undefined
              ? PROTOCOL_VERSION
              : bodyResult.data.version,
          type: bodyResult.data.type,
          requestId,
          payload: bodyResult.data.payload
        };
        const validated = validateClientToServerEvent(candidate);
        if (!validated.ok) {
          recordCommand("rejected", "INVALID_ACTION");
          logger.logReject({
            code: "INVALID_ACTION",
            message: validated.issues.join(" "),
            requestId,
            metadata: {
              routeType: "actions",
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

        commandKind = validated.data.type;
        const mapped = toDomainCommand(validated.data);
        if (!mapped.ok) {
          recordCommand("rejected", mapped.reject.code);
          logger.logReject({
            code: mapped.reject.code,
            message: mapped.reject.message,
            requestId,
            metadata: {
              routeType: "actions"
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

        const correlation = correlationFromCommand(mapped.data);
        const dispatched = await dispatchCommand(mapped.data, validated.data);
        if (!dispatched.ok) {
          recordCommand("rejected", dispatched.code);
          logger.logReject({
            code: dispatched.code,
            message: dispatched.message,
            requestId,
            lobbyId: correlation.lobbyId,
            gameId: correlation.gameId,
            playerId: correlation.playerId,
            metadata: {
              routeType: "actions",
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
        metrics?.observeOutbound(dispatched.outbound);
        logger.logGameTransition({
          transition: mapped.data.kind,
          message: "Game command accepted.",
          requestId,
          lobbyId: correlation.lobbyId,
          gameId: correlation.gameId,
          playerId: correlation.playerId,
          metadata: {
            routeType: "actions",
            statusCode: dispatched.statusCode ?? 200,
            outboundCount: dispatched.outbound.length
          }
        });

        writeJsonResponse(response, dispatched.statusCode ?? 200, {
          requestId,
          outbound: [...dispatched.outbound]
        });
      }
    }
  ];
}
