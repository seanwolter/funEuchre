import type { ServerToClientEvent } from "@fun-euchre/protocol";
import type {
  RuntimePublishResult,
  RuntimeRealtimeFanoutPort,
  RuntimeRealtimeRoomId,
  RuntimeSocketSessionConnection
} from "../domain/runtimePorts.js";
import type { GameId, LobbyId, SessionId } from "../domain/types.js";
import type { OperationalMetrics } from "../observability/metrics.js";
import type { RealtimeBroker } from "./broker.js";
import { gameRoomId, lobbyRoomId } from "./broker.js";
import type { InMemoryEventHub } from "./eventHub.js";
import { InMemoryRealtimeBroker } from "./inMemoryBroker.js";

export type SocketSessionConnection = RuntimeSocketSessionConnection;

export type SocketServerOptions = {
  broker?: RealtimeBroker;
  eventHub?: InMemoryEventHub;
  metrics?: OperationalMetrics;
};

export class InMemorySocketServer implements RuntimeRealtimeFanoutPort {
  private readonly broker: RealtimeBroker;
  private readonly metrics: OperationalMetrics | null;

  constructor(options: SocketServerOptions = {}) {
    this.broker = options.broker ?? options.eventHub ?? new InMemoryRealtimeBroker();
    this.metrics = options.metrics ?? null;
  }

  connectSession(connection: RuntimeSocketSessionConnection): void {
    this.broker.connectSession(connection);
  }

  hasSession(sessionId: SessionId): boolean {
    return this.broker.hasSession(sessionId);
  }

  disconnectSession(sessionId: SessionId): void {
    this.broker.disconnectSession(sessionId);
  }

  bindSessionToLobby(sessionId: SessionId, lobbyId: LobbyId): boolean {
    return this.broker.joinRoom(sessionId, lobbyRoomId(lobbyId));
  }

  unbindSessionFromLobby(sessionId: SessionId, lobbyId: LobbyId): boolean {
    return this.broker.leaveRoom(sessionId, lobbyRoomId(lobbyId));
  }

  bindSessionToGame(sessionId: SessionId, gameId: GameId): boolean {
    return this.broker.joinRoom(sessionId, gameRoomId(gameId));
  }

  unbindSessionFromGame(sessionId: SessionId, gameId: GameId): boolean {
    return this.broker.leaveRoom(sessionId, gameRoomId(gameId));
  }

  listSessionRooms(sessionId: SessionId): RuntimeRealtimeRoomId[] {
    return this.broker.listSessionRooms(sessionId);
  }

  async sendSessionEvents(
    sessionId: SessionId,
    events: readonly ServerToClientEvent[]
  ): Promise<number> {
    const result = await this.broker.sendSession(sessionId, events);
    if (result.delivered && result.deliveredEventCount > 0) {
      this.metrics?.observeOutbound(events);
    }
    return result.deliveredEventCount;
  }

  async broadcastLobbyEvents(
    lobbyId: LobbyId,
    events: readonly ServerToClientEvent[]
  ): Promise<RuntimePublishResult> {
    const result = await this.broker.publish({
      source: "domain-transition",
      roomId: lobbyRoomId(lobbyId),
      events
    });
    if (result.ok) {
      this.metrics?.observeOutbound(events);
    }
    return result;
  }

  async broadcastGameEvents(
    gameId: GameId,
    events: readonly ServerToClientEvent[]
  ): Promise<RuntimePublishResult> {
    const result = await this.broker.publish({
      source: "domain-transition",
      roomId: gameRoomId(gameId),
      events
    });
    if (result.ok) {
      this.metrics?.observeOutbound(events);
    }
    return result;
  }
}
