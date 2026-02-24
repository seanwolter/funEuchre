import type {
  ActionRejectedPayload,
  GamePhase,
  GamePrivateStatePayload,
  GameStatePayload,
  LobbyPhase,
  LobbyStatePayload,
  ServerToClientEvent,
  SystemNoticePayload
} from "@fun-euchre/protocol";

export type EventSource = "http" | "realtime";

export type ClientNotice = SystemNoticePayload;

export type ClientActionRejection = ActionRejectedPayload;

export type ClientRuntimeState = {
  lobby: LobbyStatePayload | null;
  game: GameStatePayload | null;
  privateGame: GamePrivateStatePayload | null;
  lastLobbySequence: number | null;
  lastGameSequence: number | null;
  lastPrivateGameSequence: number | null;
  notices: ClientNotice[];
  rejections: ClientActionRejection[];
  seenEventKeys: string[];
  appliedEventCount: number;
  ignoredDuplicateCount: number;
  ignoredStaleCount: number;
  lastEventSource: EventSource | null;
};

export type ReducerInput = {
  source: EventSource;
  events: readonly ServerToClientEvent[];
};

export type ReducerResult = {
  state: ClientRuntimeState;
  appliedCount: number;
  ignoredDuplicateCount: number;
  ignoredStaleCount: number;
};

export type ClientStateSnapshot = Pick<
  ClientRuntimeState,
  "lobby" | "game" | "privateGame" | "notices" | "rejections"
>;

const MAX_TRACKED_EVENT_KEYS = 512;
const MAX_FEEDBACK_ITEMS = 30;

const LOBBY_PHASE_RANK: Record<LobbyPhase, number> = {
  waiting: 0,
  in_game: 1,
  completed: 2
};

const GAME_PHASE_RANK: Record<GamePhase, number> = {
  deal: 0,
  round1_bidding: 1,
  round2_bidding: 2,
  play: 3,
  score: 4,
  completed: 5
};

function cloneValue<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

function stableSerialize(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (value === undefined) {
    return "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const segments = keys.map(
      (key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`
    );
    return `{${segments.join(",")}}`;
  }

  return JSON.stringify(String(value));
}

function eventKey(event: ServerToClientEvent): string {
  return stableSerialize(event);
}

function asPositiveInteger(input: unknown): number | null {
  if (!Number.isInteger(input)) {
    return null;
  }
  if ((input as number) <= 0) {
    return null;
  }
  return input as number;
}

function eventSequence(event: ServerToClientEvent): number | null {
  if (!event.ordering) {
    return null;
  }
  return asPositiveInteger(event.ordering.sequence);
}

function boundedAppend<T>(list: readonly T[], nextEntry: T, maxLength: number): T[] {
  const nextList = [...list, nextEntry];
  if (nextList.length <= maxLength) {
    return nextList;
  }

  return nextList.slice(nextList.length - maxLength);
}

function isStaleLobbyState(
  current: LobbyStatePayload | null,
  currentSequence: number | null,
  incoming: LobbyStatePayload,
  incomingSequence: number | null
): boolean {
  if (!current || current.lobbyId !== incoming.lobbyId) {
    return false;
  }

  if (incomingSequence !== null && currentSequence !== null) {
    return incomingSequence <= currentSequence;
  }

  return LOBBY_PHASE_RANK[incoming.phase] < LOBBY_PHASE_RANK[current.phase];
}

function asPhaseRank(phase: GamePhase | undefined): number {
  if (!phase) {
    return GAME_PHASE_RANK.deal;
  }
  return GAME_PHASE_RANK[phase];
}

function trickPlayCount(state: GameStatePayload): number {
  return state.trick?.plays.length ?? 0;
}

function biddingPassCount(state: GameStatePayload): number {
  return state.bidding?.passesInRound ?? 0;
}

function isStaleGameState(
  current: GameStatePayload | null,
  currentSequence: number | null,
  incoming: GameStatePayload,
  incomingSequence: number | null
): boolean {
  if (!current || current.gameId !== incoming.gameId) {
    return false;
  }
  if (incomingSequence !== null && currentSequence !== null) {
    return incomingSequence <= currentSequence;
  }
  if (incoming.handNumber < current.handNumber) {
    return true;
  }
  if (incoming.handNumber > current.handNumber) {
    return false;
  }

  if (incoming.trickNumber < current.trickNumber) {
    return true;
  }
  if (incoming.trickNumber > current.trickNumber) {
    return false;
  }

  const incomingPhaseRank = asPhaseRank(incoming.phase);
  const currentPhaseRank = asPhaseRank(current.phase);
  if (incomingPhaseRank < currentPhaseRank) {
    return true;
  }
  if (incomingPhaseRank > currentPhaseRank) {
    return false;
  }

  if (trickPlayCount(incoming) < trickPlayCount(current)) {
    return true;
  }
  if (biddingPassCount(incoming) < biddingPassCount(current)) {
    return true;
  }

  return false;
}

function isStalePrivateGameState(
  current: GamePrivateStatePayload | null,
  currentSequence: number | null,
  incoming: GamePrivateStatePayload,
  incomingSequence: number | null
): boolean {
  if (!current || current.gameId !== incoming.gameId) {
    return false;
  }

  if (incomingSequence !== null && currentSequence !== null) {
    return incomingSequence <= currentSequence;
  }

  return GAME_PHASE_RANK[incoming.phase] < GAME_PHASE_RANK[current.phase];
}

export function createInitialClientRuntimeState(): ClientRuntimeState {
  return {
    lobby: null,
    game: null,
    privateGame: null,
    lastLobbySequence: null,
    lastGameSequence: null,
    lastPrivateGameSequence: null,
    notices: [],
    rejections: [],
    seenEventKeys: [],
    appliedEventCount: 0,
    ignoredDuplicateCount: 0,
    ignoredStaleCount: 0,
    lastEventSource: null
  };
}

export function cloneClientRuntimeState(state: ClientRuntimeState): ClientRuntimeState {
  return {
    lobby: state.lobby ? cloneValue(state.lobby) : null,
    game: state.game ? cloneValue(state.game) : null,
    privateGame: state.privateGame ? cloneValue(state.privateGame) : null,
    lastLobbySequence: state.lastLobbySequence,
    lastGameSequence: state.lastGameSequence,
    lastPrivateGameSequence: state.lastPrivateGameSequence,
    notices: state.notices.map((entry) => ({ ...entry })),
    rejections: state.rejections.map((entry) => ({ ...entry })),
    seenEventKeys: [...state.seenEventKeys],
    appliedEventCount: state.appliedEventCount,
    ignoredDuplicateCount: state.ignoredDuplicateCount,
    ignoredStaleCount: state.ignoredStaleCount,
    lastEventSource: state.lastEventSource
  };
}

export function toClientStateSnapshot(state: ClientRuntimeState): ClientStateSnapshot {
  return {
    lobby: state.lobby ? cloneValue(state.lobby) : null,
    game: state.game ? cloneValue(state.game) : null,
    privateGame: state.privateGame ? cloneValue(state.privateGame) : null,
    notices: state.notices.map((entry) => ({ ...entry })),
    rejections: state.rejections.map((entry) => ({ ...entry }))
  };
}

export function reduceServerEvents(
  state: ClientRuntimeState,
  input: ReducerInput
): ReducerResult {
  if (input.events.length === 0) {
    return {
      state,
      appliedCount: 0,
      ignoredDuplicateCount: 0,
      ignoredStaleCount: 0
    };
  }

  let lobby = state.lobby;
  let game = state.game;
  let privateGame = state.privateGame;
  let lastLobbySequence = state.lastLobbySequence;
  let lastGameSequence = state.lastGameSequence;
  let lastPrivateGameSequence = state.lastPrivateGameSequence;
  let notices = state.notices;
  let rejections = state.rejections;
  let appliedCount = 0;
  let ignoredDuplicateCount = 0;
  let ignoredStaleCount = 0;

  const nextSeenEventKeys = [...state.seenEventKeys];
  const seenEventKeySet = new Set(nextSeenEventKeys);

  const trackEventKey = (key: string): void => {
    nextSeenEventKeys.push(key);
    seenEventKeySet.add(key);
    if (nextSeenEventKeys.length <= MAX_TRACKED_EVENT_KEYS) {
      return;
    }

    const removed = nextSeenEventKeys.shift();
    if (removed !== undefined) {
      seenEventKeySet.delete(removed);
    }
  };

  for (const event of input.events) {
    const key = eventKey(event);
    const incomingSequence = eventSequence(event);
    if (seenEventKeySet.has(key)) {
      ignoredDuplicateCount += 1;
      continue;
    }
    trackEventKey(key);

    if (
      event.type === "lobby.state" &&
      isStaleLobbyState(lobby, lastLobbySequence, event.payload, incomingSequence)
    ) {
      ignoredStaleCount += 1;
      continue;
    }
    if (
      event.type === "game.state" &&
      isStaleGameState(game, lastGameSequence, event.payload, incomingSequence)
    ) {
      ignoredStaleCount += 1;
      continue;
    }
    if (
      event.type === "game.private_state" &&
      isStalePrivateGameState(
        privateGame,
        lastPrivateGameSequence,
        event.payload,
        incomingSequence
      )
    ) {
      ignoredStaleCount += 1;
      continue;
    }

    appliedCount += 1;
    switch (event.type) {
      case "lobby.state":
        lobby = cloneValue(event.payload);
        if (incomingSequence !== null) {
          lastLobbySequence = incomingSequence;
        }
        break;
      case "game.state":
        game = cloneValue(event.payload);
        if (incomingSequence !== null) {
          lastGameSequence = incomingSequence;
        }
        if (privateGame && privateGame.gameId !== event.payload.gameId) {
          privateGame = null;
          lastPrivateGameSequence = null;
        }
        break;
      case "game.private_state":
        privateGame = cloneValue(event.payload);
        if (incomingSequence !== null) {
          lastPrivateGameSequence = incomingSequence;
        }
        break;
      case "system.notice":
        notices = boundedAppend(notices, { ...event.payload }, MAX_FEEDBACK_ITEMS);
        break;
      case "action.rejected":
        rejections = boundedAppend(
          rejections,
          { ...event.payload },
          MAX_FEEDBACK_ITEMS
        );
        break;
    }
  }

  if (appliedCount === 0 && ignoredDuplicateCount === 0 && ignoredStaleCount === 0) {
    return {
      state,
      appliedCount,
      ignoredDuplicateCount,
      ignoredStaleCount
    };
  }

  return {
    state: {
      lobby,
      game,
      privateGame,
      lastLobbySequence,
      lastGameSequence,
      lastPrivateGameSequence,
      notices,
      rejections,
      seenEventKeys: nextSeenEventKeys,
      appliedEventCount: state.appliedEventCount + appliedCount,
      ignoredDuplicateCount: state.ignoredDuplicateCount + ignoredDuplicateCount,
      ignoredStaleCount: state.ignoredStaleCount + ignoredStaleCount,
      lastEventSource: input.source
    },
    appliedCount,
    ignoredDuplicateCount,
    ignoredStaleCount
  };
}
