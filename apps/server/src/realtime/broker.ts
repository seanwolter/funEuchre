import type { ServerToClientEvent } from "@fun-euchre/protocol";
import type { GameId, LobbyId, SessionId } from "../domain/types.js";

export type RealtimeRoomId = `lobby:${string}` | `game:${string}`;

export type BrokerEventSink = (event: ServerToClientEvent) => void | Promise<void>;

export type BrokerSessionConnection = {
  sessionId: SessionId;
  send: BrokerEventSink;
};

export type BrokerPublishSource = "domain-transition" | "external";

export type BrokerPublishSuccess = {
  ok: true;
  deliveredSessionIds: SessionId[];
  deliveredEventCount: number;
};

export type BrokerPublishFailure = {
  ok: false;
  code: "UNAUTHORIZED_SOURCE";
  message: string;
  deliveredSessionIds: SessionId[];
  deliveredEventCount: number;
};

export type BrokerPublishResult = BrokerPublishSuccess | BrokerPublishFailure;

export type BrokerPublishRequest = {
  source: BrokerPublishSource;
  roomId: RealtimeRoomId;
  events: readonly ServerToClientEvent[];
};

export type RealtimeBroker = {
  hasSession(sessionId: SessionId): boolean;
  connectSession(connection: BrokerSessionConnection): void;
  disconnectSession(sessionId: SessionId): void;
  joinRoom(sessionId: SessionId, roomId: RealtimeRoomId): boolean;
  leaveRoom(sessionId: SessionId, roomId: RealtimeRoomId): boolean;
  listSessionRooms(sessionId: SessionId): RealtimeRoomId[];
  publish(input: BrokerPublishRequest): Promise<BrokerPublishResult>;
};

export function lobbyRoomId(lobbyId: LobbyId): RealtimeRoomId {
  return `lobby:${lobbyId}`;
}

export function gameRoomId(gameId: GameId): RealtimeRoomId {
  return `game:${gameId}`;
}
