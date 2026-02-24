import type { ServerEventOrdering, ServerToClientEvent } from "@fun-euchre/protocol";
import type { SessionId } from "../domain/types.js";
import type {
  BrokerPublishRequest,
  BrokerPublishResult,
  BrokerSessionConnection,
  RealtimeBroker,
  RealtimeRoomId
} from "./broker.js";

function cloneEvent(event: ServerToClientEvent): ServerToClientEvent {
  return JSON.parse(JSON.stringify(event)) as ServerToClientEvent;
}

export class InMemoryRealtimeBroker implements RealtimeBroker {
  private readonly sinksBySessionId = new Map<SessionId, BrokerSessionConnection["send"]>();
  private readonly sessionIdsByRoomId = new Map<RealtimeRoomId, Set<SessionId>>();
  private readonly roomIdsBySessionId = new Map<SessionId, Set<RealtimeRoomId>>();
  private readonly lastSequenceByRoomId = new Map<RealtimeRoomId, number>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  private nextOrdering(roomId: RealtimeRoomId): ServerEventOrdering {
    const nextSequence = (this.lastSequenceByRoomId.get(roomId) ?? 0) + 1;
    this.lastSequenceByRoomId.set(roomId, nextSequence);
    return {
      sequence: nextSequence,
      emittedAtMs: Math.max(0, Math.trunc(this.now()))
    };
  }

  private withOrdering(
    roomId: RealtimeRoomId,
    event: ServerToClientEvent
  ): ServerToClientEvent {
    const ordering = this.nextOrdering(roomId);
    event.ordering = ordering;
    return {
      ...event,
      ordering: {
        sequence: ordering.sequence,
        emittedAtMs: ordering.emittedAtMs
      }
    };
  }

  hasSession(sessionId: SessionId): boolean {
    return this.sinksBySessionId.has(sessionId);
  }

  connectSession(connection: BrokerSessionConnection): void {
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

  async publish(input: BrokerPublishRequest): Promise<BrokerPublishResult> {
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

    if (input.events.length === 0) {
      return {
        ok: true,
        deliveredSessionIds: [],
        deliveredEventCount: 0
      };
    }

    const orderedEvents = input.events.map((event) =>
      this.withOrdering(input.roomId, event)
    );
    const members = this.sessionIdsByRoomId.get(input.roomId);
    if (!members) {
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
      for (const event of orderedEvents) {
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
