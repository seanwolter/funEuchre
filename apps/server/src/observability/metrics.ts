import type { RejectCode, ServerToClientEvent } from "@fun-euchre/protocol";

export type CommandMetricsScope = "lobby" | "actions";
export type CommandMetricsOutcome = "accepted" | "rejected";
export type ReconnectTransport = "http" | "websocket";

export type LatencySnapshot = {
  count: number;
  totalMs: number;
  averageMs: number | null;
  minMs: number | null;
  maxMs: number | null;
};

export type CommandMetricsSnapshot = {
  total: number;
  accepted: number;
  rejected: number;
  rejectionRate: number;
  rejectionsByCode: Record<string, number>;
  byKind: Record<
    string,
    {
      total: number;
      accepted: number;
      rejected: number;
      rejectionRate: number;
      latencyMs: LatencySnapshot;
    }
  >;
};

export type ReconnectMetricsSnapshot = {
  attempted: number;
  successful: number;
  failed: number;
  successRate: number;
  byTransport: Record<
    ReconnectTransport,
    {
      attempted: number;
      successful: number;
      failed: number;
    }
  >;
  failuresByReason: Record<string, number>;
};

export type SessionMetricsSnapshot = {
  active: number;
  peak: number;
};

export type GameMetricsSnapshot = {
  started: number;
  completed: number;
  forfeits: number;
};

export type OperationalMetricsSnapshot = {
  generatedAtMs: number;
  counters: {
    commands: CommandMetricsSnapshot;
    reconnect: ReconnectMetricsSnapshot;
    sessions: SessionMetricsSnapshot;
    games: GameMetricsSnapshot;
  };
  latencyMs: {
    commands: LatencySnapshot;
  };
};

export type CommandMetricsInput = {
  scope: CommandMetricsScope;
  kind: string;
  outcome: CommandMetricsOutcome;
  latencyMs: number;
  rejectCode?: RejectCode | "INVALID_RESPONSE" | "NETWORK_ERROR" | string | null;
};

export type ReconnectAttemptInput = {
  transport: ReconnectTransport;
};

export type ReconnectFailureInput = {
  transport: ReconnectTransport;
  reason: string;
};

export type OperationalMetrics = {
  recordCommand(input: CommandMetricsInput): void;
  recordReconnectAttempt(input: ReconnectAttemptInput): void;
  recordReconnectSuccess(input: ReconnectAttemptInput): void;
  recordReconnectFailure(input: ReconnectFailureInput): void;
  setActiveSessionCount(count: number): void;
  observeOutbound(events: readonly ServerToClientEvent[]): void;
  snapshot(): OperationalMetricsSnapshot;
};

type CreateOperationalMetricsOptions = {
  now?: () => number;
};

type LatencyAccumulator = {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
};

type CommandCounter = {
  total: number;
  accepted: number;
  rejected: number;
};

function createLatencyAccumulator(): LatencyAccumulator {
  return {
    count: 0,
    totalMs: 0,
    minMs: Number.POSITIVE_INFINITY,
    maxMs: 0
  };
}

function createCommandCounter(): CommandCounter {
  return {
    total: 0,
    accepted: 0,
    rejected: 0
  };
}

function asNonNegativeNumber(input: number): number {
  if (!Number.isFinite(input) || input < 0) {
    return 0;
  }
  return input;
}

function asNonNegativeInteger(input: number): number {
  if (!Number.isFinite(input) || input < 0) {
    return 0;
  }
  return Math.trunc(input);
}

function updateLatency(accumulator: LatencyAccumulator, latencyMs: number): void {
  const normalized = asNonNegativeNumber(latencyMs);
  accumulator.count += 1;
  accumulator.totalMs += normalized;
  if (normalized < accumulator.minMs) {
    accumulator.minMs = normalized;
  }
  if (normalized > accumulator.maxMs) {
    accumulator.maxMs = normalized;
  }
}

function latencySnapshot(accumulator: LatencyAccumulator): LatencySnapshot {
  if (accumulator.count === 0) {
    return {
      count: 0,
      totalMs: 0,
      averageMs: null,
      minMs: null,
      maxMs: null
    };
  }

  return {
    count: accumulator.count,
    totalMs: accumulator.totalMs,
    averageMs: accumulator.totalMs / accumulator.count,
    minMs: accumulator.minMs,
    maxMs: accumulator.maxMs
  };
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function toSortedRecord(map: Map<string, number>): Record<string, number> {
  const entries = [...map.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const record: Record<string, number> = {};
  for (const [key, value] of entries) {
    record[key] = value;
  }
  return record;
}

function asRejectRate(rejected: number, total: number): number {
  if (total === 0) {
    return 0;
  }
  return rejected / total;
}

function asRate(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

function asGameId(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function isForfeitNotice(event: ServerToClientEvent): boolean {
  return (
    event.type === "system.notice" &&
    typeof event.payload.message === "string" &&
    /forfeit/i.test(event.payload.message)
  );
}

export function createOperationalMetrics(
  options: CreateOperationalMetricsOptions = {}
): OperationalMetrics {
  const now = options.now ?? (() => Date.now());

  const commands = createCommandCounter();
  const commandLatency = createLatencyAccumulator();
  const commandCountersByKind = new Map<string, CommandCounter>();
  const commandLatencyByKind = new Map<string, LatencyAccumulator>();
  const rejectionsByCode = new Map<string, number>();

  const reconnectByTransport: Record<
    ReconnectTransport,
    {
      attempted: number;
      successful: number;
      failed: number;
    }
  > = {
    http: {
      attempted: 0,
      successful: 0,
      failed: 0
    },
    websocket: {
      attempted: 0,
      successful: 0,
      failed: 0
    }
  };
  const reconnectFailuresByReason = new Map<string, number>();

  let activeSessions = 0;
  let peakActiveSessions = 0;
  let startedGames = 0;
  let completedGames = 0;
  let forfeitedGames = 0;
  const seenStartedGameIds = new Set<string>();
  const seenCompletedGameIds = new Set<string>();
  const seenForfeitedGameIds = new Set<string>();

  return {
    recordCommand: (input) => {
      commands.total += 1;
      if (input.outcome === "accepted") {
        commands.accepted += 1;
      } else {
        commands.rejected += 1;
        if (input.rejectCode) {
          increment(rejectionsByCode, input.rejectCode);
        }
      }

      updateLatency(commandLatency, input.latencyMs);

      const kindKey = `${input.scope}:${input.kind}`;
      const perKindCounter =
        commandCountersByKind.get(kindKey) ?? createCommandCounter();
      perKindCounter.total += 1;
      if (input.outcome === "accepted") {
        perKindCounter.accepted += 1;
      } else {
        perKindCounter.rejected += 1;
      }
      commandCountersByKind.set(kindKey, perKindCounter);

      const perKindLatency =
        commandLatencyByKind.get(kindKey) ?? createLatencyAccumulator();
      updateLatency(perKindLatency, input.latencyMs);
      commandLatencyByKind.set(kindKey, perKindLatency);
    },

    recordReconnectAttempt: ({ transport }) => {
      reconnectByTransport[transport].attempted += 1;
    },

    recordReconnectSuccess: ({ transport }) => {
      reconnectByTransport[transport].successful += 1;
    },

    recordReconnectFailure: ({ transport, reason }) => {
      reconnectByTransport[transport].failed += 1;
      increment(reconnectFailuresByReason, reason);
    },

    setActiveSessionCount: (count) => {
      activeSessions = asNonNegativeInteger(count);
      if (activeSessions > peakActiveSessions) {
        peakActiveSessions = activeSessions;
      }
    },

    observeOutbound: (events) => {
      if (events.length === 0) {
        return;
      }

      const forfeitObserved = events.some((event) => isForfeitNotice(event));
      for (const event of events) {
        if (event.type !== "game.state") {
          continue;
        }

        const gameId = asGameId(event.payload.gameId);
        if (!gameId) {
          continue;
        }

        if (!seenStartedGameIds.has(gameId)) {
          seenStartedGameIds.add(gameId);
          startedGames += 1;
        }

        if (event.payload.phase === "completed") {
          if (!seenCompletedGameIds.has(gameId)) {
            seenCompletedGameIds.add(gameId);
            completedGames += 1;
          }
          if (forfeitObserved && !seenForfeitedGameIds.has(gameId)) {
            seenForfeitedGameIds.add(gameId);
            forfeitedGames += 1;
          }
        }
      }
    },

    snapshot: () => {
      const reconnectAttempted =
        reconnectByTransport.http.attempted + reconnectByTransport.websocket.attempted;
      const reconnectSuccessful =
        reconnectByTransport.http.successful +
        reconnectByTransport.websocket.successful;
      const reconnectFailed =
        reconnectByTransport.http.failed + reconnectByTransport.websocket.failed;

      const byKindEntries = [...commandCountersByKind.entries()].sort(
        ([left], [right]) => left.localeCompare(right)
      );
      const byKind: CommandMetricsSnapshot["byKind"] = {};
      for (const [kind, counter] of byKindEntries) {
        const latency = commandLatencyByKind.get(kind) ?? createLatencyAccumulator();
        byKind[kind] = {
          total: counter.total,
          accepted: counter.accepted,
          rejected: counter.rejected,
          rejectionRate: asRejectRate(counter.rejected, counter.total),
          latencyMs: latencySnapshot(latency)
        };
      }

      return {
        generatedAtMs: asNonNegativeInteger(now()),
        counters: {
          commands: {
            total: commands.total,
            accepted: commands.accepted,
            rejected: commands.rejected,
            rejectionRate: asRejectRate(commands.rejected, commands.total),
            rejectionsByCode: toSortedRecord(rejectionsByCode),
            byKind
          },
          reconnect: {
            attempted: reconnectAttempted,
            successful: reconnectSuccessful,
            failed: reconnectFailed,
            successRate: asRate(reconnectSuccessful, reconnectAttempted),
            byTransport: {
              http: {
                attempted: reconnectByTransport.http.attempted,
                successful: reconnectByTransport.http.successful,
                failed: reconnectByTransport.http.failed
              },
              websocket: {
                attempted: reconnectByTransport.websocket.attempted,
                successful: reconnectByTransport.websocket.successful,
                failed: reconnectByTransport.websocket.failed
              }
            },
            failuresByReason: toSortedRecord(reconnectFailuresByReason)
          },
          sessions: {
            active: activeSessions,
            peak: peakActiveSessions
          },
          games: {
            started: startedGames,
            completed: completedGames,
            forfeits: forfeitedGames
          }
        },
        latencyMs: {
          commands: latencySnapshot(commandLatency)
        }
      };
    }
  };
}
