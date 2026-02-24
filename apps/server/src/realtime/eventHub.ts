import type {
  BrokerEventSink,
  BrokerPublishFailure,
  BrokerPublishRequest,
  BrokerPublishResult,
  BrokerPublishSource,
  BrokerPublishSuccess,
  BrokerSessionConnection,
  RealtimeRoomId
} from "./broker.js";
import { gameRoomId, lobbyRoomId } from "./broker.js";
import { InMemoryRealtimeBroker } from "./inMemoryBroker.js";

export type EventSink = BrokerEventSink;
export type SessionConnection = BrokerSessionConnection;
export type PublishSource = BrokerPublishSource;
export type PublishSuccess = BrokerPublishSuccess;
export type PublishFailure = BrokerPublishFailure;
export type PublishResult = BrokerPublishResult;
export type PublishRequest = BrokerPublishRequest;
export { gameRoomId, lobbyRoomId };
export type { RealtimeRoomId };

export class InMemoryEventHub extends InMemoryRealtimeBroker {}
