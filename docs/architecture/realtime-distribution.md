# Realtime Distribution Architecture

## Purpose
Phase 5 introduces a broker seam so websocket fanout is not coupled to an in-memory room map. Runtime dispatchers continue to publish only authoritative domain-transition events, but fanout now depends on the `RealtimeBroker` contract.

## Broker Contract
`apps/server/src/realtime/broker.ts` defines:
- session connection lifecycle: `connectSession`, `hasSession`, `disconnectSession`
- room membership lifecycle: `joinRoom`, `leaveRoom`, `listSessionRooms`
- room publish path: `publish({ source, roomId, events })`
- room helpers: `lobbyRoomId(...)` and `gameRoomId(...)`

`source` is currently restricted to:
- `"domain-transition"`: allowed
- `"external"`: rejected with `UNAUTHORIZED_SOURCE`

## Default Implementation
`apps/server/src/realtime/inMemoryBroker.ts` is the default adapter used by `InMemorySocketServer`.

Behavior:
- joining a room requires an active connected session
- reconnecting a session replaces the previous sink and clears prior room membership
- disconnecting a session removes it from every room
- each authoritative publish assigns event ordering metadata:
  - `ordering.sequence`: strictly increasing per room
  - `ordering.emittedAtMs`: broker emission timestamp
- publish iterates room members in insertion order and emits the batch event-by-event per member
- each delivered event is deep-cloned before sink delivery, preventing shared mutation across subscribers

## Delivery and Ordering Semantics
Current guarantees (single-process in-memory broker):
- room-scoped fanout only: events publish to one room per call
- per-publish deterministic order:
  - member order follows room membership insertion order
  - event order follows the input `events` array order
- per-room sequence progression is monotonic across authoritative publishes
- no retries: sink failures reject the publish call
- no cross-room global ordering guarantee

These semantics are the compatibility baseline for any distributed broker adapter.

## Distributed Adapter Requirements
A future distributed adapter (for example Redis/Kafka/NATS-backed) must preserve:
- authoritative-source gate (`UNAUTHORIZED_SOURCE` behavior parity)
- room membership correctness across connect/disconnect/join/leave transitions
- deterministic per-room publish ordering for a single authoritative transition batch
- payload isolation equivalent to deep-clone semantics (or immutable payload enforcement)
- runtime-facing API parity so `RuntimeRealtimeFanoutPort` behavior does not change

## Verification Harness
`apps/server/test/realtime-broker-contract.test.ts` validates broker-level contract behavior for:
- connect/join/leave/disconnect lifecycle
- source authorization on publish
- room-local fanout semantics
- ordered, cloned batch delivery
