export const PROTOCOL_VERSION = 1;
export const SEAT_VALUES = ["north", "east", "south", "west"];
export const TEAM_VALUES = ["teamA", "teamB"];
export const SUIT_VALUES = ["clubs", "diamonds", "hearts", "spades"];
export const LOBBY_PHASE_VALUES = ["waiting", "in_game", "completed"];
export const REJECT_CODE_VALUES = [
    "NOT_YOUR_TURN",
    "INVALID_ACTION",
    "INVALID_STATE",
    "UNAUTHORIZED"
];
export const NOTICE_SEVERITY_VALUES = ["info", "warning", "error"];
function ok(data) {
    return { ok: true, data };
}
function fail(issue) {
    return { ok: false, issues: [issue] };
}
function isRecord(input) {
    return typeof input === "object" && input !== null && !Array.isArray(input);
}
function isEnumValue(input, values) {
    return typeof input === "string" && values.includes(input);
}
function asNonEmptyString(input) {
    if (typeof input !== "string") {
        return null;
    }
    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed;
}
function asOptionalString(input) {
    if (input === undefined) {
        return undefined;
    }
    if (input === null) {
        return null;
    }
    return asNonEmptyString(input);
}
function asNonNegativeInteger(input) {
    if (!Number.isInteger(input)) {
        return null;
    }
    if (input < 0) {
        return null;
    }
    return input;
}
function parseTeamScore(input) {
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
function parseLobbySeats(input) {
    if (!Array.isArray(input)) {
        return null;
    }
    const result = [];
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
function parseClientBase(input) {
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
function parseServerBase(input) {
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
export function validateClientToServerEvent(input) {
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
                return fail("lobby.join payload must include non-empty lobbyId and displayName.");
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
                return fail("lobby.update_name payload must include non-empty lobbyId, playerId, and displayName.");
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
                return fail("lobby.start payload must include non-empty lobbyId and actorPlayerId.");
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
                return fail("game.play_card payload must include non-empty gameId/cardId and a valid actorSeat.");
            }
            return ok({
                version: PROTOCOL_VERSION,
                type,
                requestId,
                payload: { gameId, cardId, actorSeat }
            });
        }
        default:
            return fail(`Unknown client event type "${type}".`);
    }
}
export function validateServerToClientEvent(input) {
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
            if (!lobbyId ||
                !hostPlayerId ||
                !isEnumValue(phase, LOBBY_PHASE_VALUES) ||
                !seats) {
                return fail("lobby.state payload must include non-empty lobbyId/hostPlayerId, a valid phase, and valid seats.");
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
            const trump = trumpRaw === null
                ? null
                : isEnumValue(trumpRaw, SUIT_VALUES)
                    ? trumpRaw
                    : undefined;
            if (!gameId ||
                handNumber === null ||
                trickNumber === null ||
                !isEnumValue(dealer, SEAT_VALUES) ||
                !isEnumValue(turn, SEAT_VALUES) ||
                trump === undefined ||
                !scores) {
                return fail("game.state payload must include valid ids, non-negative counters, valid dealer/turn, trump (or null), and scores.");
            }
            return ok({
                version: PROTOCOL_VERSION,
                type,
                payload: {
                    gameId,
                    handNumber,
                    trickNumber,
                    dealer,
                    turn,
                    trump,
                    scores
                }
            });
        }
        case "action.rejected": {
            const code = payload.code;
            const message = asNonEmptyString(payload.message);
            const requestId = asOptionalString(payload.requestId);
            if (!isEnumValue(code, REJECT_CODE_VALUES) || !message || requestId === undefined) {
                return fail("action.rejected payload must include valid code, non-empty message, and optional requestId.");
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
export function parseClientToServerEvent(input) {
    const result = validateClientToServerEvent(input);
    if (!result.ok) {
        throw new Error(`Invalid client event: ${result.issues.join(" ")}`);
    }
    return result.data;
}
export function parseServerToClientEvent(input) {
    const result = validateServerToClientEvent(input);
    if (!result.ok) {
        throw new Error(`Invalid server event: ${result.issues.join(" ")}`);
    }
    return result.data;
}
