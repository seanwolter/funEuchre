export type SessionIdentity = {
  lobbyId: string;
  playerId: string;
  sessionId: string;
  reconnectToken: string;
};

export type StoredSession = {
  identity: SessionIdentity;
  displayName: string;
};

export type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SessionClient = {
  hydrate(): StoredSession | null;
  current(): StoredSession | null;
  update(nextSession: StoredSession): StoredSession;
  clear(): void;
};

export type SessionClientOptions = {
  storage?: SessionStorage | null;
  storageKey?: string;
  maxAgeMs?: number | null;
  now?: () => number;
};

const STORAGE_VERSION = 1 as const;

type JsonObject = Record<string, unknown>;

type StoredSessionEnvelope = {
  version: typeof STORAGE_VERSION;
  session: StoredSession;
  savedAtMs?: number;
};

export const DEFAULT_SESSION_STORAGE_KEY = "fun-euchre.session.v1";

function isJsonObject(input: unknown): input is JsonObject {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function asNonEmptyString(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function cloneIdentity(identity: SessionIdentity): SessionIdentity {
  return {
    lobbyId: identity.lobbyId,
    playerId: identity.playerId,
    sessionId: identity.sessionId,
    reconnectToken: identity.reconnectToken
  };
}

function cloneSession(session: StoredSession): StoredSession {
  return {
    identity: cloneIdentity(session.identity),
    displayName: session.displayName
  };
}

function resolveBrowserStorage(): SessionStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function parseSessionIdentity(input: unknown): SessionIdentity | null {
  if (!isJsonObject(input)) {
    return null;
  }

  const lobbyId = asNonEmptyString(input.lobbyId);
  const playerId = asNonEmptyString(input.playerId);
  const sessionId = asNonEmptyString(input.sessionId);
  const reconnectToken = asNonEmptyString(input.reconnectToken);
  if (!lobbyId || !playerId || !sessionId || !reconnectToken) {
    return null;
  }

  return {
    lobbyId,
    playerId,
    sessionId,
    reconnectToken
  };
}

function parseStoredSession(input: unknown): StoredSession | null {
  if (!isJsonObject(input)) {
    return null;
  }

  const identity = parseSessionIdentity(input.identity);
  const displayName = asNonEmptyString(input.displayName);
  if (!identity || !displayName) {
    return null;
  }

  return {
    identity,
    displayName
  };
}

function parseStoredEnvelope(
  raw: string,
  maxAgeMs: number | null,
  now: () => number
): StoredSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isJsonObject(parsed) || parsed.version !== STORAGE_VERSION) {
    return null;
  }

  const rawSavedAtMs = parsed.savedAtMs;
  if (rawSavedAtMs !== undefined) {
    if (
      typeof rawSavedAtMs !== "number" ||
      !Number.isInteger(rawSavedAtMs) ||
      rawSavedAtMs < 0
    ) {
      return null;
    }
    if (maxAgeMs !== null && now() - rawSavedAtMs > maxAgeMs) {
      return null;
    }
  }

  return parseStoredSession(parsed.session);
}

function normalizeStoredSession(input: StoredSession): StoredSession {
  const identity = parseSessionIdentity(input.identity);
  const displayName = asNonEmptyString(input.displayName);
  if (!identity || !displayName) {
    throw new Error(
      "Session metadata must include non-empty identity fields and displayName."
    );
  }

  return {
    identity,
    displayName
  };
}

function toEnvelope(session: StoredSession, nowMs: number): StoredSessionEnvelope {
  return {
    version: STORAGE_VERSION,
    session,
    savedAtMs: nowMs
  };
}

export function createSessionClient(options: SessionClientOptions = {}): SessionClient {
  const storage = options.storage === undefined ? resolveBrowserStorage() : options.storage;
  const storageKey = options.storageKey ?? DEFAULT_SESSION_STORAGE_KEY;
  const maxAgeMs =
    options.maxAgeMs === undefined ? 6 * 60 * 60 * 1000 : options.maxAgeMs;
  const now = options.now ?? (() => Date.now());
  let cachedSession: StoredSession | null = null;

  return {
    hydrate: () => {
      if (!storage) {
        cachedSession = null;
        return null;
      }

      const raw = storage.getItem(storageKey);
      if (raw === null) {
        cachedSession = null;
        return null;
      }

      const parsed = parseStoredEnvelope(raw, maxAgeMs, now);
      if (!parsed) {
        storage.removeItem(storageKey);
        cachedSession = null;
        return null;
      }

      cachedSession = cloneSession(parsed);
      return cloneSession(parsed);
    },
    current: () => {
      if (!cachedSession) {
        return null;
      }

      return cloneSession(cachedSession);
    },
    update: (nextSession) => {
      const normalized = normalizeStoredSession(nextSession);
      const cloned = cloneSession(normalized);
      cachedSession = cloned;
      if (storage) {
        storage.setItem(storageKey, JSON.stringify(toEnvelope(cloned, now())));
      }

      return cloneSession(cloned);
    },
    clear: () => {
      cachedSession = null;
      if (!storage) {
        return;
      }

      storage.removeItem(storageKey);
    }
  };
}
