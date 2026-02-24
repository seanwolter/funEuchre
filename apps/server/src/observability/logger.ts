export type StructuredLogLevel = "info" | "warn" | "error";

export type StructuredLogEvent =
  | "server.lifecycle"
  | "lobby.action"
  | "game.transition"
  | "action.rejected"
  | "session.disconnected"
  | "session.reconnected"
  | "game.forfeit";

export type LogCorrelation = {
  lobbyId?: string | null | undefined;
  gameId?: string | null | undefined;
  playerId?: string | null | undefined;
  requestId?: string | null | undefined;
};

export type StructuredLogEntry = {
  timestamp: string;
  level: StructuredLogLevel;
  event: StructuredLogEvent;
  message: string;
  lobbyId: string | null;
  gameId: string | null;
  playerId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
};

export type StructuredLogger = {
  logServerLifecycle(input: {
    phase: "starting" | "stopping" | "stopped";
    message: string;
    metadata?: Record<string, unknown>;
  }): void;
  logLobbyAction(input: {
    action: string;
    outcome: "accepted" | "rejected";
    message: string;
    lobbyId?: string | null;
    playerId?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  }): void;
  logGameTransition(input: {
    transition: string;
    message: string;
    lobbyId?: string | null;
    gameId?: string | null;
    playerId?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  }): void;
  logReject(input: {
    code: string;
    message: string;
    lobbyId?: string | null;
    gameId?: string | null;
    playerId?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  }): void;
  logDisconnect(input: {
    message: string;
    lobbyId?: string | null;
    gameId?: string | null;
    playerId?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  }): void;
  logReconnect(input: {
    message: string;
    lobbyId?: string | null;
    gameId?: string | null;
    playerId?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  }): void;
  logForfeit(input: {
    message: string;
    lobbyId?: string | null;
    gameId?: string | null;
    playerId?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  }): void;
};

export type StructuredLoggerOptions = {
  sink?: (entry: StructuredLogEntry) => void;
  now?: () => Date;
};

function normalizeCorrelation(input: LogCorrelation): {
  lobbyId: string | null;
  gameId: string | null;
  playerId: string | null;
  requestId: string | null;
} {
  return {
    lobbyId: input.lobbyId ?? null,
    gameId: input.gameId ?? null,
    playerId: input.playerId ?? null,
    requestId: input.requestId ?? null
  };
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

function defaultSink(entry: StructuredLogEntry): void {
  const serialized = JSON.stringify(entry);
  if (entry.level === "error") {
    console.error(serialized);
    return;
  }
  if (entry.level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
}

export function createStructuredLogger(options: StructuredLoggerOptions = {}): StructuredLogger {
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());

  function emit(
    level: StructuredLogLevel,
    event: StructuredLogEvent,
    message: string,
    correlation: LogCorrelation,
    metadata: Record<string, unknown> | undefined
  ): void {
    const normalized = normalizeCorrelation(correlation);
    sink({
      timestamp: now().toISOString(),
      level,
      event,
      message,
      lobbyId: normalized.lobbyId,
      gameId: normalized.gameId,
      playerId: normalized.playerId,
      requestId: normalized.requestId,
      metadata: sanitizeMetadata(metadata)
    });
  }

  return {
    logServerLifecycle: (input) => {
      emit(
        "info",
        "server.lifecycle",
        input.message,
        {},
        {
          phase: input.phase,
          ...sanitizeMetadata(input.metadata)
        }
      );
    },
    logLobbyAction: (input) => {
      emit(
        input.outcome === "accepted" ? "info" : "warn",
        "lobby.action",
        input.message,
        {
          lobbyId: input.lobbyId,
          playerId: input.playerId,
          requestId: input.requestId
        },
        {
          action: input.action,
          outcome: input.outcome,
          ...sanitizeMetadata(input.metadata)
        }
      );
    },
    logGameTransition: (input) => {
      emit(
        "info",
        "game.transition",
        input.message,
        {
          lobbyId: input.lobbyId,
          gameId: input.gameId,
          playerId: input.playerId,
          requestId: input.requestId
        },
        {
          transition: input.transition,
          ...sanitizeMetadata(input.metadata)
        }
      );
    },
    logReject: (input) => {
      emit(
        "warn",
        "action.rejected",
        input.message,
        {
          lobbyId: input.lobbyId,
          gameId: input.gameId,
          playerId: input.playerId,
          requestId: input.requestId
        },
        {
          code: input.code,
          ...sanitizeMetadata(input.metadata)
        }
      );
    },
    logDisconnect: (input) => {
      emit(
        "warn",
        "session.disconnected",
        input.message,
        {
          lobbyId: input.lobbyId,
          gameId: input.gameId,
          playerId: input.playerId,
          requestId: input.requestId
        },
        sanitizeMetadata(input.metadata)
      );
    },
    logReconnect: (input) => {
      emit(
        "info",
        "session.reconnected",
        input.message,
        {
          lobbyId: input.lobbyId,
          gameId: input.gameId,
          playerId: input.playerId,
          requestId: input.requestId
        },
        sanitizeMetadata(input.metadata)
      );
    },
    logForfeit: (input) => {
      emit(
        "warn",
        "game.forfeit",
        input.message,
        {
          lobbyId: input.lobbyId,
          gameId: input.gameId,
          playerId: input.playerId,
          requestId: input.requestId
        },
        sanitizeMetadata(input.metadata)
      );
    }
  };
}

export function createNoopLogger(): StructuredLogger {
  return createStructuredLogger({
    sink: () => {}
  });
}

export function createConsoleStructuredLogger(): StructuredLogger {
  return createStructuredLogger({
    sink: defaultSink
  });
}
