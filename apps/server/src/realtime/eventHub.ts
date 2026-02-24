import type { ServerToClientEvent } from "@fun-euchre/protocol";
import type { GameId, LobbyId, SessionId } from "../domain/types.js";

export type RealtimeRoomId = `lobby:${string}` | `game:${string}`;

export type EventSink = (event: ServerToClientEvent) => void | Promise<void>;

export type SessionConnection = {
  sessionId: SessionId;
  send: EventSink;
};

export type PublishSource = "domain-transition" | "external";

export type PublishSuccess = {
  ok: true;
  deliveredSessionIds: SessionId[];
  deliveredEventCount: number;
};

export type PublishFailure = {
  ok: false;
  code: "UNAUTHORIZED_SOURCE";
  message: string;
  deliveredSessionIds: SessionId[];
  deliveredEventCount: number;
};

export type PublishResult = PublishSuccess | PublishFailure;

export type PublishRequest = {
  source: PublishSource;
  roomId: RealtimeRoomId;
  events: readonly ServerToClientEvent[];
};

function cloneEvent(event: ServerToClientEvent): ServerToClientEvent {
  return JSON.parse(JSON.stringify(event)) as ServerToClientEvent;
}

export function lobbyRoomId(lobbyId: LobbyId): RealtimeRoomId {
  return `lobby:${lobbyId}`;
}

export function gameRoomId(gameId: GameId): RealtimeRoomId {
  return `game:${gameId}`;
}

export class InMemoryEventHub {
  private readonly sinksBySessionId = new Map<SessionId, EventSink>();
  private readonly sessionIdsByRoomId = new Map<RealtimeRoomId, Set<SessionId>>();
  private readonly roomIdsBySessionId = new Map<SessionId, Set<RealtimeRoomId>>();

  hasSession(sessionId: SessionId): boolean {
    return this.sinksBySessionId.has(sessionId);
  }

  connectSession(connection: SessionConnection): void {
    this.disconnectSession(connection.sessionId);
    this.sinksBySessionId.set(connection.sessionId, connection.send);
    this.roomIdsBySessionId.set(connection.sessionId, new Set<RealtimeRoomId>());
  }

  disconnectSession(sessionId: SessionId): void {
    const roomIds = this.roomIdsBySessionId.get(sessionId);
    if (roomIds) {
      for (const roomId of roomIds) {
        const members = this.sessionIdsByRoomId.get(roomId);
        if (!members) {
          continue;
        }
        members.delete(sessionId);
        if (members.size === 0) {
          this.sessionIdsByRoomId.delete(roomId);
        }
      }
    }

    this.roomIdsBySessionId.delete(sessionId);
    this.sinksBySessionId.delete(sessionId);
  }

  joinRoom(sessionId: SessionId, roomId: RealtimeRoomId): boolean {
    if (!this.sinksBySessionId.has(sessionId)) {
      return false;
    }

    let members = this.sessionIdsByRoomId.get(roomId);
    if (!members) {
      members = new Set<SessionId>();
      this.sessionIdsByRoomId.set(roomId, members);
    }
    members.add(sessionId);

    let rooms = this.roomIdsBySessionId.get(sessionId);
    if (!rooms) {
      rooms = new Set<RealtimeRoomId>();
      this.roomIdsBySessionId.set(sessionId, rooms);
    }
    rooms.add(roomId);

    return true;
  }

  leaveRoom(sessionId: SessionId, roomId: RealtimeRoomId): boolean {
    const members = this.sessionIdsByRoomId.get(roomId);
    const rooms = this.roomIdsBySessionId.get(sessionId);
    if (!members || !rooms) {
      return false;
    }

    const deleted = members.delete(sessionId);
    rooms.delete(roomId);
    if (members.size === 0) {
      this.sessionIdsByRoomId.delete(roomId);
    }
    if (rooms.size === 0) {
      this.roomIdsBySessionId.delete(sessionId);
    }

    return deleted;
  }

  listRoomMembers(roomId: RealtimeRoomId): SessionId[] {
    const members = this.sessionIdsByRoomId.get(roomId);
    if (!members) {
      return [];
    }
    return [...members];
  }

  listSessionRooms(sessionId: SessionId): RealtimeRoomId[] {
    const rooms = this.roomIdsBySessionId.get(sessionId);
    if (!rooms) {
      return [];
    }
    return [...rooms];
  }

  async publish(input: PublishRequest): Promise<PublishResult> {
    if (input.source !== "domain-transition") {
      return {
        ok: false,
        code: "UNAUTHORIZED_SOURCE",
        message:
          "Only authoritative domain transitions may publish realtime events.",
        deliveredSessionIds: [],
        deliveredEventCount: 0
      };
    }

    const members = this.sessionIdsByRoomId.get(input.roomId);
    if (!members || input.events.length === 0) {
      return {
        ok: true,
        deliveredSessionIds: [],
        deliveredEventCount: 0
      };
    }

    const deliveredSessionIds: SessionId[] = [];
    let deliveredEventCount = 0;

    for (const sessionId of members) {
      const sink = this.sinksBySessionId.get(sessionId);
      if (!sink) {
        continue;
      }

      deliveredSessionIds.push(sessionId);
      for (const event of input.events) {
        await sink(cloneEvent(event));
        deliveredEventCount += 1;
      }
    }

    return {
      ok: true,
      deliveredSessionIds,
      deliveredEventCount
    };
  }
}
