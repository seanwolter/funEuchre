import type { ServerToClientEvent } from "@fun-euchre/protocol";
import type { GameId, LobbyId, SessionId } from "../domain/types.js";
import {
  InMemoryEventHub,
  gameRoomId,
  lobbyRoomId,
  type EventSink,
  type PublishResult,
  type RealtimeRoomId
} from "./eventHub.js";

export type SocketSessionConnection = {
  sessionId: SessionId;
  send: EventSink;
};

export type SocketServerOptions = {
  eventHub?: InMemoryEventHub;
};

export class InMemorySocketServer {
  private readonly eventHub: InMemoryEventHub;

  constructor(options: SocketServerOptions = {}) {
    this.eventHub = options.eventHub ?? new InMemoryEventHub();
  }

  connectSession(connection: SocketSessionConnection): void {
    this.eventHub.connectSession(connection);
  }

  disconnectSession(sessionId: SessionId): void {
    this.eventHub.disconnectSession(sessionId);
  }

  bindSessionToLobby(sessionId: SessionId, lobbyId: LobbyId): boolean {
    return this.eventHub.joinRoom(sessionId, lobbyRoomId(lobbyId));
  }

  unbindSessionFromLobby(sessionId: SessionId, lobbyId: LobbyId): boolean {
    return this.eventHub.leaveRoom(sessionId, lobbyRoomId(lobbyId));
  }

  bindSessionToGame(sessionId: SessionId, gameId: GameId): boolean {
    return this.eventHub.joinRoom(sessionId, gameRoomId(gameId));
  }

  unbindSessionFromGame(sessionId: SessionId, gameId: GameId): boolean {
    return this.eventHub.leaveRoom(sessionId, gameRoomId(gameId));
  }

  listSessionRooms(sessionId: SessionId): RealtimeRoomId[] {
    return this.eventHub.listSessionRooms(sessionId);
  }

  async broadcastLobbyEvents(
    lobbyId: LobbyId,
    events: readonly ServerToClientEvent[]
  ): Promise<PublishResult> {
    return this.eventHub.publish({
      source: "domain-transition",
      roomId: lobbyRoomId(lobbyId),
      events
    });
  }

  async broadcastGameEvents(
    gameId: GameId,
    events: readonly ServerToClientEvent[]
  ): Promise<PublishResult> {
    return this.eventHub.publish({
      source: "domain-transition",
      roomId: gameRoomId(gameId),
      events
    });
  }
}
