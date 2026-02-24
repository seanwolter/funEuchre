import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SESSION_STORAGE_KEY,
  createSessionClient,
  type SessionStorage,
  type StoredSession
} from "../src/lib/session.js";

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

const sessionFixture: StoredSession = {
  identity: {
    lobbyId: "lobby-1",
    playerId: "player-1",
    sessionId: "session-1",
    reconnectToken: "token-1"
  },
  displayName: "Host"
};

test("session client hydrate restores persisted identity metadata", () => {
  const storage = createMemoryStorage({
    [DEFAULT_SESSION_STORAGE_KEY]: JSON.stringify({
      version: 1,
      session: sessionFixture
    })
  });
  const sessionClient = createSessionClient({ storage });

  assert.deepEqual(sessionClient.hydrate(), sessionFixture);
  assert.deepEqual(sessionClient.current(), sessionFixture);
});

test("session client update persists metadata for future hydrate calls", () => {
  const storage = createMemoryStorage();
  const sessionClient = createSessionClient({ storage });

  assert.deepEqual(sessionClient.update(sessionFixture), sessionFixture);

  const reloadedClient = createSessionClient({ storage });
  assert.deepEqual(reloadedClient.hydrate(), sessionFixture);
});

test("session client clear removes persisted metadata and resets cache", () => {
  const storage = createMemoryStorage();
  const sessionClient = createSessionClient({ storage });

  sessionClient.update(sessionFixture);
  sessionClient.clear();

  assert.equal(storage.getItem(DEFAULT_SESSION_STORAGE_KEY), null);
  assert.equal(sessionClient.current(), null);
  assert.equal(sessionClient.hydrate(), null);
});

test("session client discards invalid persisted payloads during hydrate", () => {
  const storage = createMemoryStorage({
    [DEFAULT_SESSION_STORAGE_KEY]: JSON.stringify({
      version: 1,
      session: {
        identity: {
          lobbyId: "",
          playerId: "player-1",
          sessionId: "session-1",
          reconnectToken: "token-1"
        },
        displayName: "Host"
      }
    })
  });
  const sessionClient = createSessionClient({ storage });

  assert.equal(sessionClient.hydrate(), null);
  assert.equal(storage.getItem(DEFAULT_SESSION_STORAGE_KEY), null);
});

test("session client discards stale persisted metadata based on maxAge", () => {
  const storage = createMemoryStorage({
    [DEFAULT_SESSION_STORAGE_KEY]: JSON.stringify({
      version: 1,
      session: sessionFixture,
      savedAtMs: 1_000
    })
  });
  const sessionClient = createSessionClient({
    storage,
    maxAgeMs: 5_000,
    now: () => 7_000
  });

  assert.equal(sessionClient.hydrate(), null);
  assert.equal(storage.getItem(DEFAULT_SESSION_STORAGE_KEY), null);
});
