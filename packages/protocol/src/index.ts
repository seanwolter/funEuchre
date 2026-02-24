export const PROTOCOL_VERSION = 1 as const;

export const SEAT_VALUES = ["north", "east", "south", "west"] as const;
export const TEAM_VALUES = ["teamA", "teamB"] as const;
export const SUIT_VALUES = ["clubs", "diamonds", "hearts", "spades"] as const;
export const LOBBY_PHASE_VALUES = ["waiting", "in_game", "completed"] as const;
export const GAME_PHASE_VALUES = [
  "deal",
  "round1_bidding",
  "round2_bidding",
  "play",
  "score",
  "completed"
] as const;
export const REJECT_CODE_VALUES = [
  "NOT_YOUR_TURN",
  "INVALID_ACTION",
  "INVALID_STATE",
  "UNAUTHORIZED"
] as const;
export const NOTICE_SEVERITY_VALUES = ["info", "warning", "error"] as const;

export type Seat = (typeof SEAT_VALUES)[number];
export type Team = (typeof TEAM_VALUES)[number];
export type Suit = (typeof SUIT_VALUES)[number];
export type LobbyPhase = (typeof LOBBY_PHASE_VALUES)[number];
export type GamePhase = (typeof GAME_PHASE_VALUES)[number];
export type RejectCode = (typeof REJECT_CODE_VALUES)[number];
export type NoticeSeverity = (typeof NOTICE_SEVERITY_VALUES)[number];

export type TeamScore = {
  teamA: number;
  teamB: number;
};

export type LobbySeatState = {
  seat: Seat;
  team: Team;
  playerId: string | null;
  displayName: string | null;
  connected: boolean;
};

export type LobbyStatePayload = {
  lobbyId: string;
  hostPlayerId: string;
  phase: LobbyPhase;
  seats: LobbySeatState[];
};

export type BiddingStateSummary = {
  round: 1 | 2;
  turn: Seat;
  upcardSuit: Suit;
  turnedDownSuit: Suit;
  passesInRound: number;
  maker: Seat | null;
  trump: Suit | null;
  alone: boolean;
  availableTrumpSuits: Suit[];
};

export type TrickPlaySummary = {
  seat: Seat;
  cardId: string;
};

export type TrickStateSummary = {
  leader: Seat;
  leadSuit: Suit | null;
  complete: boolean;
  winner: Seat | null;
  plays: TrickPlaySummary[];
};

export type GameStatePayload = {
  gameId: string;
  handNumber: number;
  trickNumber: number;
  dealer: Seat;
  turn: Seat;
  trump: Suit | null;
  scores: TeamScore;
  phase?: GamePhase;
  maker?: Seat | null;
  alone?: boolean;
  partnerSitsOut?: Seat | null;
  bidding?: BiddingStateSummary | null;
  trick?: TrickStateSummary | null;
};

export type GameLegalActionsPayload = {
  playableCardIds: string[];
  canPass: boolean;
  canOrderUp: boolean;
  callableTrumpSuits: Suit[];
};

export type GamePrivateStatePayload = {
  gameId: string;
  seat: Seat;
  phase: GamePhase;
  handCardIds: string[];
  legalActions: GameLegalActionsPayload;
};

export type ActionRejectedPayload = {
  requestId: string | null;
  code: RejectCode;
  message: string;
};

export type SystemNoticePayload = {
  severity: NoticeSeverity;
  message: string;
};

type ClientEventBase<TType extends string, TPayload> = {
  version: typeof PROTOCOL_VERSION;
  type: TType;
  requestId: string;
  payload: TPayload;
};

type ServerEventBase<TType extends string, TPayload> = {
  version: typeof PROTOCOL_VERSION;
  type: TType;
  payload: TPayload;
};

export type LobbyCreateEvent = ClientEventBase<
  "lobby.create",
  {
    displayName: string;
  }
>;

export type LobbyJoinEvent = ClientEventBase<
  "lobby.join",
  {
    lobbyId: string;
    displayName: string;
    reconnectToken?: string | null;
  }
>;

export type LobbyUpdateNameEvent = ClientEventBase<
  "lobby.update_name",
  {
    lobbyId: string;
    playerId: string;
    displayName: string;
  }
>;

export type LobbyStartEvent = ClientEventBase<
  "lobby.start",
  {
    lobbyId: string;
    actorPlayerId: string;
  }
>;

export type GamePlayCardEvent = ClientEventBase<
  "game.play_card",
  {
    gameId: string;
    actorSeat: Seat;
    cardId: string;
  }
>;

export type GamePassEvent = ClientEventBase<
  "game.pass",
  {
    gameId: string;
    actorSeat: Seat;
  }
>;

export type GameOrderUpEvent = ClientEventBase<
  "game.order_up",
  {
    gameId: string;
    actorSeat: Seat;
    alone?: boolean;
  }
>;

export type GameCallTrumpEvent = ClientEventBase<
  "game.call_trump",
  {
    gameId: string;
    actorSeat: Seat;
    trump: Suit;
    alone?: boolean;
  }
>;

export type ClientToServerEvent =
  | LobbyCreateEvent
  | LobbyJoinEvent
  | LobbyUpdateNameEvent
  | LobbyStartEvent
  | GamePlayCardEvent
  | GamePassEvent
  | GameOrderUpEvent
  | GameCallTrumpEvent;

export type LobbyStateEvent = ServerEventBase<"lobby.state", LobbyStatePayload>;
export type GameStateEvent = ServerEventBase<"game.state", GameStatePayload>;
export type GamePrivateStateEvent = ServerEventBase<
  "game.private_state",
  GamePrivateStatePayload
>;
export type ActionRejectedEvent = ServerEventBase<
  "action.rejected",
  ActionRejectedPayload
>;
export type SystemNoticeEvent = ServerEventBase<"system.notice", SystemNoticePayload>;

export type ServerToClientEvent =
  | LobbyStateEvent
  | GameStateEvent
  | GamePrivateStateEvent
  | ActionRejectedEvent
  | SystemNoticeEvent;

export type ValidationSuccess<T> = {
  ok: true;
  data: T;
};

export type ValidationFailure = {
  ok: false;
  issues: string[];
};

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function ok<T>(data: T): ValidationSuccess<T> {
  return { ok: true, data };
}

function fail(issue: string): ValidationFailure {
  return { ok: false, issues: [issue] };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isEnumValue<T extends string>(
  input: unknown,
  values: readonly T[]
): input is T {
  return typeof input === "string" && values.includes(input as T);
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

function asOptionalString(input: unknown): string | null | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (input === null) {
    return null;
  }

  return asNonEmptyString(input);
}

function asOptionalBoolean(input: unknown): boolean | undefined | null {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === "boolean") {
    return input;
  }

  return null;
}

function asNonNegativeInteger(input: unknown): number | null {
  if (!Number.isInteger(input)) {
    return null;
  }

  if ((input as number) < 0) {
    return null;
  }

  return input as number;
}

function parseTeamScore(input: unknown): TeamScore | null {
  if (!isRecord(input)) {
    return null;
  }

  const teamA = asNonNegativeInteger(input.teamA);
  const teamB = asNonNegativeInteger(input.teamB);
  if (teamA === null || teamB === null) {
    return null;
  }

  return { teamA, teamB };
}

function parseNonEmptyStringArray(input: unknown): string[] | null {
  if (!Array.isArray(input)) {
    return null;
  }

  const result: string[] = [];
  for (const entry of input) {
    const value = asNonEmptyString(entry);
    if (!value) {
      return null;
    }
    result.push(value);
  }

  return result;
}

function parseSuitArray(input: unknown): Suit[] | null {
  if (!Array.isArray(input)) {
    return null;
  }

  const result: Suit[] = [];
  for (const entry of input) {
    if (!isEnumValue(entry, SUIT_VALUES)) {
      return null;
    }
    result.push(entry);
  }

  return result;
}

function parseLobbySeats(input: unknown): LobbySeatState[] | null {
  if (!Array.isArray(input)) {
    return null;
  }

  const result: LobbySeatState[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) {
      return null;
    }

    const seat = entry.seat;
    const team = entry.team;
    const playerId = asOptionalString(entry.playerId);
    const displayName = asOptionalString(entry.displayName);
    const connected = entry.connected;

    if (!isEnumValue(seat, SEAT_VALUES)) {
      return null;
    }
    if (!isEnumValue(team, TEAM_VALUES)) {
      return null;
    }
    if (playerId === undefined || displayName === undefined) {
      return null;
    }
    if (typeof connected !== "boolean") {
      return null;
    }

    result.push({
      seat,
      team,
      playerId,
      displayName,
      connected
    });
  }

  return result;
}

function parseBiddingStateSummary(input: unknown): BiddingStateSummary | null {
  if (!isRecord(input)) {
    return null;
  }

  const round = input.round;
  const turn = input.turn;
  const upcardSuit = input.upcardSuit;
  const turnedDownSuit = input.turnedDownSuit;
  const passesInRound = asNonNegativeInteger(input.passesInRound);
  const makerRaw = input.maker;
  const trumpRaw = input.trump;
  const alone = input.alone;
  const availableTrumpSuits = parseSuitArray(input.availableTrumpSuits);

  const maker =
    makerRaw === null
      ? null
      : isEnumValue(makerRaw, SEAT_VALUES)
        ? makerRaw
        : undefined;
  const trump =
    trumpRaw === null
      ? null
      : isEnumValue(trumpRaw, SUIT_VALUES)
        ? trumpRaw
        : undefined;
  if (
    (round !== 1 && round !== 2) ||
    !isEnumValue(turn, SEAT_VALUES) ||
    !isEnumValue(upcardSuit, SUIT_VALUES) ||
    !isEnumValue(turnedDownSuit, SUIT_VALUES) ||
    passesInRound === null ||
    maker === undefined ||
    trump === undefined ||
    typeof alone !== "boolean" ||
    availableTrumpSuits === null
  ) {
    return null;
  }

  return {
    round,
    turn,
    upcardSuit,
    turnedDownSuit,
    passesInRound,
    maker,
    trump,
    alone,
    availableTrumpSuits
  };
}

function parseTrickPlaySummaryList(input: unknown): TrickPlaySummary[] | null {
  if (!Array.isArray(input)) {
    return null;
  }

  const result: TrickPlaySummary[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) {
      return null;
    }
    const seat = entry.seat;
    const cardId = asNonEmptyString(entry.cardId);
    if (!isEnumValue(seat, SEAT_VALUES) || !cardId) {
      return null;
    }
    result.push({
      seat,
      cardId
    });
  }

  return result;
}

function parseTrickStateSummary(input: unknown): TrickStateSummary | null {
  if (!isRecord(input)) {
    return null;
  }

  const leader = input.leader;
  const leadSuitRaw = input.leadSuit;
  const complete = input.complete;
  const winnerRaw = input.winner;
  const plays = parseTrickPlaySummaryList(input.plays);
  const leadSuit =
    leadSuitRaw === null
      ? null
      : isEnumValue(leadSuitRaw, SUIT_VALUES)
        ? leadSuitRaw
        : undefined;
  const winner =
    winnerRaw === null
      ? null
      : isEnumValue(winnerRaw, SEAT_VALUES)
        ? winnerRaw
        : undefined;
  if (
    !isEnumValue(leader, SEAT_VALUES) ||
    leadSuit === undefined ||
    typeof complete !== "boolean" ||
    winner === undefined ||
    plays === null
  ) {
    return null;
  }

  return {
    leader,
    leadSuit,
    complete,
    winner,
    plays
  };
}

function parseGameLegalActions(input: unknown): GameLegalActionsPayload | null {
  if (!isRecord(input)) {
    return null;
  }

  const playableCardIds = parseNonEmptyStringArray(input.playableCardIds);
  const canPass = input.canPass;
  const canOrderUp = input.canOrderUp;
  const callableTrumpSuits = parseSuitArray(input.callableTrumpSuits);
  if (
    playableCardIds === null ||
    typeof canPass !== "boolean" ||
    typeof canOrderUp !== "boolean" ||
    callableTrumpSuits === null
  ) {
    return null;
  }

  return {
    playableCardIds,
    canPass,
    canOrderUp,
    callableTrumpSuits
  };
}

function parseClientBase(
  input: unknown
): ValidationResult<{ type: string; requestId: string; payload: Record<string, unknown> }> {
  if (!isRecord(input)) {
    return fail("Client event must be an object.");
  }

  const version = input.version;
  if (version !== PROTOCOL_VERSION) {
    return fail(`Client event version must be ${PROTOCOL_VERSION}.`);
  }

  const type = input.type;
  if (typeof type !== "string") {
    return fail("Client event type must be a string.");
  }

  const requestId = asNonEmptyString(input.requestId);
  if (!requestId) {
    return fail("Client event requestId must be a non-empty string.");
  }

  const payload = input.payload;
  if (!isRecord(payload)) {
    return fail("Client event payload must be an object.");
  }

  return ok({ type, requestId, payload });
}

function parseServerBase(
  input: unknown
): ValidationResult<{ type: string; payload: Record<string, unknown> }> {
  if (!isRecord(input)) {
    return fail("Server event must be an object.");
  }

  const version = input.version;
  if (version !== PROTOCOL_VERSION) {
    return fail(`Server event version must be ${PROTOCOL_VERSION}.`);
  }

  const type = input.type;
  if (typeof type !== "string") {
    return fail("Server event type must be a string.");
  }

  const payload = input.payload;
  if (!isRecord(payload)) {
    return fail("Server event payload must be an object.");
  }

  return ok({ type, payload });
}

export function validateClientToServerEvent(
  input: unknown
): ValidationResult<ClientToServerEvent> {
  const base = parseClientBase(input);
  if (!base.ok) {
    return base;
  }

  const { type, requestId, payload } = base.data;

  switch (type) {
    case "lobby.create": {
      const displayName = asNonEmptyString(payload.displayName);
      if (!displayName) {
        return fail("lobby.create payload.displayName must be a non-empty string.");
      }

      return ok({
        version: PROTOCOL_VERSION,
        type,
        requestId,
        payload: { displayName }
      });
    }

    case "lobby.join": {
      const lobbyId = asNonEmptyString(payload.lobbyId);
      const displayName = asNonEmptyString(payload.displayName);
      const reconnectToken = asOptionalString(payload.reconnectToken);
      if (!lobbyId || !displayName) {
        return fail(
          "lobby.join payload must include non-empty lobbyId and displayName."
        );
      }
      if (reconnectToken === undefined) {
        return ok({
          version: PROTOCOL_VERSION,
          type,
          requestId,
          payload: { lobbyId, displayName }
        });
      }

      return ok({
        version: PROTOCOL_VERSION,
        type,
        requestId,
        payload: { lobbyId, displayName, reconnectToken }
      });
    }

    case "lobby.update_name": {
      const lobbyId = asNonEmptyString(payload.lobbyId);
      const playerId = asNonEmptyString(payload.playerId);
      const displayName = asNonEmptyString(payload.displayName);
      if (!lobbyId || !playerId || !displayName) {
        return fail(
          "lobby.update_name payload must include non-empty lobbyId, playerId, and displayName."
        );
      }

      return ok({
        version: PROTOCOL_VERSION,
        type,
        requestId,
        payload: { lobbyId, playerId, displayName }
      });
    }

    case "lobby.start": {
      const lobbyId = asNonEmptyString(payload.lobbyId);
      const actorPlayerId = asNonEmptyString(payload.actorPlayerId);
      if (!lobbyId || !actorPlayerId) {
        return fail(
          "lobby.start payload must include non-empty lobbyId and actorPlayerId."
        );
      }

      return ok({
        version: PROTOCOL_VERSION,
        type,
        requestId,
        payload: { lobbyId, actorPlayerId }
      });
    }

    case "game.play_card": {
      const gameId = asNonEmptyString(payload.gameId);
      const cardId = asNonEmptyString(payload.cardId);
      const actorSeat = payload.actorSeat;
      if (!gameId || !cardId || !isEnumValue(actorSeat, SEAT_VALUES)) {
        return fail(
          "game.play_card payload must include non-empty gameId/cardId and a valid actorSeat."
        );
      }

      return ok({
        version: PROTOCOL_VERSION,
        type,
        requestId,
        payload: { gameId, cardId, actorSeat }
      });
    }

    case "game.pass": {
      const gameId = asNonEmptyString(payload.gameId);
      const actorSeat = payload.actorSeat;
      if (!gameId || !isEnumValue(actorSeat, SEAT_VALUES)) {
        return fail(
          "game.pass payload must include non-empty gameId and a valid actorSeat."
        );
      }

      return ok({
        version: PROTOCOL_VERSION,
        type,
        requestId,
        payload: { gameId, actorSeat }
      });
    }

    case "game.order_up": {
      const gameId = asNonEmptyString(payload.gameId);
      const actorSeat = payload.actorSeat;
      const alone = asOptionalBoolean(payload.alone);
      if (!gameId || !isEnumValue(actorSeat, SEAT_VALUES) || alone === null) {
        return fail(
          "game.order_up payload must include non-empty gameId, valid actorSeat, and optional alone boolean."
        );
      }

      if (alone === undefined) {
        return ok({
          version: PROTOCOL_VERSION,
          type,
          requestId,
          payload: { gameId, actorSeat }
        });
      }

      return ok({
        version: PROTOCOL_VERSION,
        type,
        requestId,
        payload: { gameId, actorSeat, alone }
      });
    }

    case "game.call_trump": {
      const gameId = asNonEmptyString(payload.gameId);
      const actorSeat = payload.actorSeat;
      const trump = payload.trump;
      const alone = asOptionalBoolean(payload.alone);
      if (
        !gameId ||
        !isEnumValue(actorSeat, SEAT_VALUES) ||
        !isEnumValue(trump, SUIT_VALUES) ||
        alone === null
      ) {
        return fail(
          "game.call_trump payload must include non-empty gameId, valid actorSeat/trump, and optional alone boolean."
        );
      }

      if (alone === undefined) {
        return ok({
          version: PROTOCOL_VERSION,
          type,
          requestId,
          payload: { gameId, actorSeat, trump }
        });
      }

      return ok({
        version: PROTOCOL_VERSION,
        type,
        requestId,
        payload: { gameId, actorSeat, trump, alone }
      });
    }

    default:
      return fail(`Unknown client event type "${type}".`);
  }
}

export function validateServerToClientEvent(
  input: unknown
): ValidationResult<ServerToClientEvent> {
  const base = parseServerBase(input);
  if (!base.ok) {
    return base;
  }

  const { type, payload } = base.data;

  switch (type) {
    case "lobby.state": {
      const lobbyId = asNonEmptyString(payload.lobbyId);
      const hostPlayerId = asNonEmptyString(payload.hostPlayerId);
      const phase = payload.phase;
      const seats = parseLobbySeats(payload.seats);
      if (
        !lobbyId ||
        !hostPlayerId ||
        !isEnumValue(phase, LOBBY_PHASE_VALUES) ||
        !seats
      ) {
        return fail(
          "lobby.state payload must include non-empty lobbyId/hostPlayerId, a valid phase, and valid seats."
        );
      }

      return ok({
        version: PROTOCOL_VERSION,
        type,
        payload: { lobbyId, hostPlayerId, phase, seats }
      });
    }

    case "game.state": {
      const gameId = asNonEmptyString(payload.gameId);
      const handNumber = asNonNegativeInteger(payload.handNumber);
      const trickNumber = asNonNegativeInteger(payload.trickNumber);
      const dealer = payload.dealer;
      const turn = payload.turn;
      const trumpRaw = payload.trump;
      const scores = parseTeamScore(payload.scores);
      const phaseRaw = payload.phase;
      const makerRaw = payload.maker;
      const aloneRaw = payload.alone;
      const partnerSitsOutRaw = payload.partnerSitsOut;
      const biddingRaw = payload.bidding;
      const trickRaw = payload.trick;
      const trump =
        trumpRaw === null
          ? null
          : isEnumValue(trumpRaw, SUIT_VALUES)
            ? trumpRaw
            : undefined;
      const phase =
        phaseRaw === undefined
          ? undefined
          : isEnumValue(phaseRaw, GAME_PHASE_VALUES)
            ? phaseRaw
            : undefined;
      const phaseValid =
        phaseRaw === undefined || isEnumValue(phaseRaw, GAME_PHASE_VALUES);
      const maker =
        makerRaw === undefined
          ? undefined
          : makerRaw === null
            ? null
            : isEnumValue(makerRaw, SEAT_VALUES)
              ? makerRaw
              : undefined;
      const makerValid =
        makerRaw === undefined ||
        makerRaw === null ||
        isEnumValue(makerRaw, SEAT_VALUES);
      const alone =
        aloneRaw === undefined
          ? undefined
          : typeof aloneRaw === "boolean"
            ? aloneRaw
            : undefined;
      const aloneValid = aloneRaw === undefined || typeof aloneRaw === "boolean";
      const partnerSitsOut =
        partnerSitsOutRaw === undefined
          ? undefined
          : partnerSitsOutRaw === null
            ? null
            : isEnumValue(partnerSitsOutRaw, SEAT_VALUES)
              ? partnerSitsOutRaw
              : undefined;
      const partnerSitsOutValid =
        partnerSitsOutRaw === undefined ||
        partnerSitsOutRaw === null ||
        isEnumValue(partnerSitsOutRaw, SEAT_VALUES);
      const parsedBidding =
        biddingRaw === undefined || biddingRaw === null
          ? null
          : parseBiddingStateSummary(biddingRaw);
      const bidding =
        biddingRaw === undefined ? undefined : biddingRaw === null ? null : parsedBidding;
      const biddingValid =
        biddingRaw === undefined || biddingRaw === null || parsedBidding !== null;
      const parsedTrick =
        trickRaw === undefined || trickRaw === null
          ? null
          : parseTrickStateSummary(trickRaw);
      const trick =
        trickRaw === undefined ? undefined : trickRaw === null ? null : parsedTrick;
      const trickValid =
        trickRaw === undefined || trickRaw === null || parsedTrick !== null;

      if (
        !gameId ||
        handNumber === null ||
        trickNumber === null ||
        !isEnumValue(dealer, SEAT_VALUES) ||
        !isEnumValue(turn, SEAT_VALUES) ||
        trump === undefined ||
        !scores ||
        !phaseValid ||
        !makerValid ||
        !aloneValid ||
        !partnerSitsOutValid ||
        !biddingValid ||
        !trickValid
      ) {
        return fail(
          "game.state payload must include valid ids, non-negative counters, valid dealer/turn, trump (or null), scores, and valid optional projection fields."
        );
      }

      const statePayload: GameStatePayload = {
        gameId,
        handNumber,
        trickNumber,
        dealer,
        turn,
        trump,
        scores
      };
      if (phase !== undefined) {
        statePayload.phase = phase;
      }
      if (maker !== undefined) {
        statePayload.maker = maker;
      }
      if (alone !== undefined) {
        statePayload.alone = alone;
      }
      if (partnerSitsOut !== undefined) {
        statePayload.partnerSitsOut = partnerSitsOut;
      }
      if (bidding !== undefined) {
        statePayload.bidding = bidding;
      }
      if (trick !== undefined) {
        statePayload.trick = trick;
      }

      return ok({
        version: PROTOCOL_VERSION,
        type,
        payload: statePayload
      });
    }

    case "game.private_state": {
      const gameId = asNonEmptyString(payload.gameId);
      const seat = payload.seat;
      const phase = payload.phase;
      const handCardIds = parseNonEmptyStringArray(payload.handCardIds);
      const legalActions = parseGameLegalActions(payload.legalActions);
      if (
        !gameId ||
        !isEnumValue(seat, SEAT_VALUES) ||
        !isEnumValue(phase, GAME_PHASE_VALUES) ||
        handCardIds === null ||
        legalActions === null
      ) {
        return fail(
          "game.private_state payload must include valid gameId/seat/phase, handCardIds, and legalActions."
        );
      }

      return ok({
        version: PROTOCOL_VERSION,
        type,
        payload: {
          gameId,
          seat,
          phase,
          handCardIds,
          legalActions
        }
      });
    }

    case "action.rejected": {
      const code = payload.code;
      const message = asNonEmptyString(payload.message);
      const requestId = asOptionalString(payload.requestId);
      if (!isEnumValue(code, REJECT_CODE_VALUES) || !message || requestId === undefined) {
        return fail(
          "action.rejected payload must include valid code, non-empty message, and optional requestId."
        );
      }

      return ok({
        version: PROTOCOL_VERSION,
        type,
        payload: { code, message, requestId }
      });
    }

    case "system.notice": {
      const severity = payload.severity;
      const message = asNonEmptyString(payload.message);
      if (!isEnumValue(severity, NOTICE_SEVERITY_VALUES) || !message) {
        return fail("system.notice payload must include valid severity and message.");
      }

      return ok({
        version: PROTOCOL_VERSION,
        type,
        payload: { severity, message }
      });
    }

    default:
      return fail(`Unknown server event type "${type}".`);
  }
}

export function parseClientToServerEvent(input: unknown): ClientToServerEvent {
  const result = validateClientToServerEvent(input);
  if (!result.ok) {
    throw new Error(`Invalid client event: ${result.issues.join(" ")}`);
  }

  return result.data;
}

export function parseServerToClientEvent(input: unknown): ServerToClientEvent {
  const result = validateServerToClientEvent(input);
  if (!result.ok) {
    throw new Error(`Invalid server event: ${result.issues.join(" ")}`);
  }

  return result.data;
}
