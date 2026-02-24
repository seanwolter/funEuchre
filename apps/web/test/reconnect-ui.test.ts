import assert from "node:assert/strict";
import test from "node:test";
import type { ServerToClientEvent } from "@fun-euchre/protocol";
import { bootstrapAppSession } from "../src/app/bootstrap.js";
import type { HttpClient, IdentityCommandResponse } from "../src/lib/httpClient.js";
import {
  DEFAULT_SESSION_STORAGE_KEY,
  createSessionClient,
  type SessionStorage,
  type StoredSession
} from "../src/lib/session.js";
import { createGameStore } from "../src/state/gameStore.js";

function createMemoryStorage(initial: Record<string, string> = {}): SessionStorage {
  const values = new Map<string, string>(Object.entries(initial));

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    }
  };
}

function persistedSessionEnvelope(session: StoredSession, savedAtMs: number): string {
  return JSON.stringify({
    version: 1,
    session,
    savedAtMs
  });
}

function lobbyStateEvent(lobbyId: string): ServerToClientEvent {
  return {
    version: 1,
    type: "lobby.state",
    payload: {
      lobbyId,
      hostPlayerId: "player-1",
      phase: "waiting",
      seats: [
        {
          seat: "north",
          team: "teamA",
          playerId: "player-1",
          displayName: "Host",
          connected: true
        },
        {
          seat: "east",
          team: "teamB",
          playerId: null,
          displayName: null,
          connected: false
        },
        {
          seat: "south",
          team: "teamA",
          playerId: null,
          displayName: null,
          connected: false
        },
        {
          seat: "west",
          team: "teamB",
          playerId: null,
          displayName: null,
          connected: false
        }
      ]
    }
  };
}

const storedSession: StoredSession = {
  identity: {
    lobbyId: "lobby-1",
    playerId: "player-1",
    sessionId: "session-1",
    reconnectToken: "token-1"
  },
  displayName: "Host"
};

function createHttpClient(joinLobby: HttpClient["joinLobby"]): HttpClient {
  const client = {
    createLobby: async () => {
      throw new Error("createLobby is not used in reconnect-ui tests.");
    },
    joinLobby,
    updateLobbyName: async () => {
      throw new Error("updateLobbyName is not used in reconnect-ui tests.");
    },
    startLobby: async () => {
      throw new Error("startLobby is not used in reconnect-ui tests.");
    },
    submitAction: async () => {
      throw new Error("submitAction is not used in reconnect-ui tests.");
    }
  };
  return client as unknown as HttpClient;
}

test("bootstrap reconnect reclaims session and dispatches lobby projection", async () => {
  const storage = createMemoryStorage({
    [DEFAULT_SESSION_STORAGE_KEY]: persistedSessionEnvelope(storedSession, 1_000)
  });
  const sessionClient = createSessionClient({
    storage,
    now: () => 1_500
  });
  const store = createGameStore();
  const joinCalls: Parameters<HttpClient["joinLobby"]>[0][] = [];

  const rejoinedIdentity: IdentityCommandResponse["identity"] = {
    lobbyId: "lobby-1",
    playerId: "player-1",
    sessionId: "session-2",
    reconnectToken: "token-2"
  };
  const joinResponse: IdentityCommandResponse = {
    requestId: "req-reconnect-1",
    identity: rejoinedIdentity,
    outbound: [lobbyStateEvent("lobby-1")]
  };
  const httpClient = createHttpClient(async (input) => {
    joinCalls.push(input);
    return joinResponse;
  });

  const result = await bootstrapAppSession({
    store,
    httpClient,
    sessionClient
  });

  assert.equal(result.status, "reconnected");
  assert.equal(joinCalls.length, 1);
  assert.deepEqual(joinCalls[0], {
    lobbyId: "lobby-1",
    displayName: "Host",
    reconnectToken: "token-1"
  });
  assert.deepEqual(result.session?.identity, rejoinedIdentity);
  assert.equal(store.getState().lobby?.lobbyId, "lobby-1");
  assert.equal(store.getState().notices.at(-1)?.message, "Reconnected to lobby lobby-1.");
});

test("bootstrap reconnect expiry clears stored identity and removes stale lobby state", async () => {
  const storage = createMemoryStorage({
    [DEFAULT_SESSION_STORAGE_KEY]: persistedSessionEnvelope(storedSession, 2_000)
  });
  const sessionClient = createSessionClient({
    storage,
    now: () => 2_100
  });
  const store = createGameStore();
  store.dispatchEvents("http", [lobbyStateEvent("lobby-1")]);
  assert.equal(store.getState().lobby?.lobbyId, "lobby-1");

  const httpClient = createHttpClient(async () => {
    throw {
      code: "UNAUTHORIZED",
      message: "Reconnect timeout expired."
    };
  });

  const result = await bootstrapAppSession({
    store,
    httpClient,
    sessionClient
  });

  assert.equal(result.status, "expired");
  assert.equal(result.session, null);
  assert.equal(sessionClient.current(), null);
  assert.equal(storage.getItem(DEFAULT_SESSION_STORAGE_KEY), null);
  assert.equal(store.getState().lobby, null);
  assert.equal(store.getState().notices.length, 1);
  assert.equal(store.getState().notices[0]?.severity, "warning");
  assert.match(
    store.getState().notices[0]?.message ?? "",
    /Reconnect window expired|Join a lobby again/
  );
});

test("bootstrap reconnect transient failure keeps session and surfaces retry notice", async () => {
  const storage = createMemoryStorage({
    [DEFAULT_SESSION_STORAGE_KEY]: persistedSessionEnvelope(storedSession, 3_000)
  });
  const sessionClient = createSessionClient({
    storage,
    now: () => 3_100
  });
  const store = createGameStore();

  const httpClient = createHttpClient(async () => {
    throw new Error("ECONNRESET");
  });

  const result = await bootstrapAppSession({
    store,
    httpClient,
    sessionClient
  });

  assert.equal(result.status, "failed");
  assert.deepEqual(result.session, storedSession);
  assert.deepEqual(sessionClient.current(), storedSession);
  assert.equal(store.getState().notices.length, 2);
  assert.match(store.getState().notices[0]?.message ?? "", /Reconnecting as Host/);
  assert.match(store.getState().notices[1]?.message ?? "", /Retry from lobby controls/);
});
