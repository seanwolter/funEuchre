import {
  PROTOCOL_VERSION,
  REJECT_CODE_VALUES,
  type ClientToServerEvent,
  type RejectCode,
  type ServerToClientEvent,
  validateClientToServerEvent,
  validateServerToClientEvent
} from "@fun-euchre/protocol";
import { createRequestId, type RequestIdFactory } from "./requestId.js";
import { parseSessionIdentity, type SessionIdentity } from "./session.js";

type JsonObject = Record<string, unknown>;

type ParseSuccess<T> = {
  ok: true;
  data: T;
};

type ParseFailure = {
  ok: false;
  message: string;
};

type ParseResult<T> = ParseSuccess<T> | ParseFailure;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type RequestOptions = {
  requestId?: string;
  signal?: AbortSignal;
};

type CommandErrorEnvelope = {
  requestId: string | null;
  code: HttpClientErrorCode;
  message: string;
  issues: string[];
};

type JsonBodyResult =
  | {
      ok: true;
      payload: unknown;
    }
  | {
      ok: false;
    };

type LobbyCreateEvent = Extract<ClientToServerEvent, { type: "lobby.create" }>;
type LobbyJoinEvent = Extract<ClientToServerEvent, { type: "lobby.join" }>;
type LobbyUpdateNameEvent = Extract<ClientToServerEvent, { type: "lobby.update_name" }>;
type LobbyStartEvent = Extract<ClientToServerEvent, { type: "lobby.start" }>;

const ACTION_TYPES = [
  "game.play_card",
  "game.pass",
  "game.order_up",
  "game.call_trump"
] as const;

type ActionType = (typeof ACTION_TYPES)[number];
type ActionEvent = Extract<ClientToServerEvent, { type: ActionType }>;

const JSON_HEADERS = {
  "content-type": "application/json",
  accept: "application/json"
} as const;

const REJECT_CODE_SET = new Set<RejectCode>(REJECT_CODE_VALUES);

export type CommandResponse = {
  requestId: string;
  outbound: ServerToClientEvent[];
  identity?: SessionIdentity;
};

export type IdentityCommandResponse = {
  requestId: string;
  outbound: ServerToClientEvent[];
  identity: SessionIdentity;
};

export type CreateLobbyInput = RequestOptions & {
  displayName: string;
};

export type JoinLobbyInput = RequestOptions & {
  lobbyId: string;
  displayName: string;
  reconnectToken?: string | null;
};

export type UpdateLobbyNameInput = RequestOptions & {
  lobbyId: string;
  playerId: string;
  displayName: string;
};

export type StartLobbyInput = RequestOptions & {
  lobbyId: string;
  actorPlayerId: string;
};

export type SubmitActionInput<TType extends ActionType = ActionType> = RequestOptions & {
  type: TType;
  payload: Extract<ActionEvent, { type: TType }>["payload"];
};

export type HttpClient = {
  createLobby(input: CreateLobbyInput): Promise<IdentityCommandResponse>;
  joinLobby(input: JoinLobbyInput): Promise<IdentityCommandResponse>;
  updateLobbyName(input: UpdateLobbyNameInput): Promise<CommandResponse>;
  startLobby(input: StartLobbyInput): Promise<CommandResponse>;
  submitAction<TType extends ActionType>(
    input: SubmitActionInput<TType>
  ): Promise<CommandResponse>;
};

export type HttpClientOptions = {
  baseUrl?: string;
  fetch?: FetchLike;
  requestIdFactory?: RequestIdFactory;
};

export type HttpClientErrorCode = RejectCode | "NETWORK_ERROR" | "INVALID_RESPONSE";

export class HttpClientError extends Error {
  readonly code: HttpClientErrorCode;
  readonly requestId: string | null;
  readonly statusCode: number | null;
  readonly issues: string[];

  constructor(input: {
    code: HttpClientErrorCode;
    message: string;
    requestId?: string | null;
    statusCode?: number | null;
    issues?: string[];
  }) {
    super(input.message);
    this.name = "HttpClientError";
    this.code = input.code;
    this.requestId = input.requestId ?? null;
    this.statusCode = input.statusCode ?? null;
    this.issues = input.issues ? [...input.issues] : [];
  }
}

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

function isRejectCode(code: string): code is RejectCode {
  return REJECT_CODE_SET.has(code as RejectCode);
}

function parseIssues(input: unknown): string[] | null {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    return null;
  }

  const issues: string[] = [];
  for (const entry of input) {
    const issue = asNonEmptyString(entry);
    if (!issue) {
      return null;
    }
    issues.push(issue);
  }

  return issues;
}

function parseCommandResponse(payload: unknown): ParseResult<CommandResponse> {
  if (!isJsonObject(payload)) {
    return {
      ok: false,
      message: "Command response payload must be a JSON object."
    };
  }

  const requestId = asNonEmptyString(payload.requestId);
  if (!requestId) {
    return {
      ok: false,
      message: "Command response must include a non-empty requestId."
    };
  }

  if (!Array.isArray(payload.outbound)) {
    return {
      ok: false,
      message: "Command response must include an outbound event array."
    };
  }

  const outbound: ServerToClientEvent[] = [];
  for (const [index, rawEvent] of payload.outbound.entries()) {
    const validated = validateServerToClientEvent(rawEvent);
    if (!validated.ok) {
      return {
        ok: false,
        message: `outbound[${index}] failed protocol validation: ${validated.issues.join(
          " "
        )}`
      };
    }

    outbound.push(validated.data);
  }

  if (!Object.prototype.hasOwnProperty.call(payload, "identity")) {
    return {
      ok: true,
      data: {
        requestId,
        outbound
      }
    };
  }

  const identity = parseSessionIdentity(payload.identity);
  if (!identity) {
    return {
      ok: false,
      message:
        "Command response identity must include non-empty lobbyId, playerId, sessionId, and reconnectToken."
    };
  }

  return {
    ok: true,
    data: {
      requestId,
      outbound,
      identity
    }
  };
}

function parseErrorEnvelope(payload: unknown): ParseResult<CommandErrorEnvelope> {
  if (!isJsonObject(payload) || !isJsonObject(payload.error)) {
    return {
      ok: false,
      message: "Error response payload is not in normalized envelope format."
    };
  }

  const requestIdRaw = payload.requestId;
  const requestId =
    typeof requestIdRaw === "string"
      ? requestIdRaw.trim() || null
      : requestIdRaw === null || requestIdRaw === undefined
        ? null
        : null;

  const codeRaw = asNonEmptyString(payload.error.code);
  const message = asNonEmptyString(payload.error.message);
  const issues = parseIssues(payload.error.issues);
  if (!codeRaw || !message || issues === null) {
    return {
      ok: false,
      message: "Error response envelope is missing code, message, or valid issues."
    };
  }

  return {
    ok: true,
    data: {
      requestId,
      code: isRejectCode(codeRaw) ? codeRaw : "INVALID_RESPONSE",
      message,
      issues
    }
  };
}

function resolveRequestId(requestId: string | undefined, factory: RequestIdFactory): string {
  const normalized = requestId?.trim();
  if (normalized) {
    return normalized;
  }

  return factory();
}

function resolveFetchImplementation(fetchOverride: FetchLike | undefined): FetchLike {
  if (fetchOverride) {
    return fetchOverride;
  }
  if (typeof fetch === "function") {
    return (input, init) => fetch(input, init);
  }

  throw new Error("Fetch API is unavailable in this runtime.");
}

function resolveDefaultBaseUrl(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const origin = window.location?.origin;
  if (!origin || origin === "null") {
    return null;
  }

  return origin;
}

function resolveBaseUrl(baseUrl: string | undefined): string | null {
  if (baseUrl === undefined) {
    return resolveDefaultBaseUrl();
  }

  const normalized = baseUrl.trim();
  return normalized ? normalized : null;
}

function resolveUrl(path: string, baseUrl: string | null): string {
  if (!baseUrl) {
    return path;
  }

  return new URL(path, baseUrl).toString();
}

function requireIdentity(
  response: CommandResponse,
  routePath: string
): IdentityCommandResponse {
  if (!response.identity) {
    throw new HttpClientError({
      code: "INVALID_RESPONSE",
      message: `Expected identity metadata in ${routePath} response.`,
      requestId: response.requestId
    });
  }

  return {
    requestId: response.requestId,
    outbound: [...response.outbound],
    identity: {
      ...response.identity
    }
  };
}

function validateOutgoingEvent<TEvent extends ClientToServerEvent>(candidate: TEvent): TEvent {
  const validated = validateClientToServerEvent(candidate);
  if (!validated.ok) {
    throw new HttpClientError({
      code: "INVALID_ACTION",
      message: validated.issues.join(" "),
      requestId: candidate.requestId,
      issues: validated.issues
    });
  }

  return validated.data as TEvent;
}

async function readJsonBody(response: Response): Promise<JsonBodyResult> {
  const raw = await response.text();
  if (!raw.trim()) {
    return {
      ok: false
    };
  }

  try {
    return {
      ok: true,
      payload: JSON.parse(raw) as unknown
    };
  } catch {
    return {
      ok: false
    };
  }
}

function toCommandResponseClone(response: CommandResponse): CommandResponse {
  const cloned: CommandResponse = {
    requestId: response.requestId,
    outbound: [...response.outbound]
  };
  if (response.identity) {
    cloned.identity = {
      ...response.identity
    };
  }

  return cloned;
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const fetchImpl = resolveFetchImplementation(options.fetch);
  const requestIdFactory = options.requestIdFactory ?? createRequestId;
  const baseUrl = resolveBaseUrl(options.baseUrl);

  const postCommand = async (
    path: string,
    body: unknown,
    requestId: string,
    signal: AbortSignal | undefined
  ): Promise<CommandResponse> => {
    let response: Response;
    try {
      response = await fetchImpl(resolveUrl(path, baseUrl), {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
        signal: signal ?? null
      });
    } catch {
      throw new HttpClientError({
        code: "NETWORK_ERROR",
        message: `Network request to ${path} failed.`,
        requestId
      });
    }

    const bodyResult = await readJsonBody(response);
    if (!bodyResult.ok) {
      throw new HttpClientError({
        code: "INVALID_RESPONSE",
        message: `Request to ${path} returned a non-JSON or empty response body.`,
        requestId,
        statusCode: response.status
      });
    }

    if (!response.ok) {
      const parsedError = parseErrorEnvelope(bodyResult.payload);
      if (!parsedError.ok) {
        throw new HttpClientError({
          code: "INVALID_RESPONSE",
          message: `Request to ${path} failed with status ${response.status} and an invalid error envelope.`,
          requestId,
          statusCode: response.status
        });
      }

      throw new HttpClientError({
        code: parsedError.data.code,
        message: parsedError.data.message,
        requestId: parsedError.data.requestId ?? requestId,
        statusCode: response.status,
        issues: parsedError.data.issues
      });
    }

    const parsedResponse = parseCommandResponse(bodyResult.payload);
    if (!parsedResponse.ok) {
      throw new HttpClientError({
        code: "INVALID_RESPONSE",
        message: parsedResponse.message,
        requestId,
        statusCode: response.status
      });
    }

    return toCommandResponseClone(parsedResponse.data);
  };

  return {
    createLobby: async (input) => {
      const requestId = resolveRequestId(input.requestId, requestIdFactory);
      const event = validateOutgoingEvent<LobbyCreateEvent>({
        version: PROTOCOL_VERSION,
        type: "lobby.create",
        requestId,
        payload: {
          displayName: input.displayName
        }
      });

      const response = await postCommand(
        "/lobbies/create",
        {
          requestId: event.requestId,
          displayName: event.payload.displayName
        },
        event.requestId,
        input.signal
      );

      return requireIdentity(response, "/lobbies/create");
    },
    joinLobby: async (input) => {
      const requestId = resolveRequestId(input.requestId, requestIdFactory);
      const payload: LobbyJoinEvent["payload"] = {
        lobbyId: input.lobbyId,
        displayName: input.displayName
      };
      if (input.reconnectToken !== undefined) {
        payload.reconnectToken = input.reconnectToken;
      }

      const event = validateOutgoingEvent<LobbyJoinEvent>({
        version: PROTOCOL_VERSION,
        type: "lobby.join",
        requestId,
        payload
      });

      const body: {
        requestId: string;
        lobbyId: string;
        displayName: string;
        reconnectToken?: string | null;
      } = {
        requestId: event.requestId,
        lobbyId: event.payload.lobbyId,
        displayName: event.payload.displayName
      };
      if (event.payload.reconnectToken !== undefined) {
        body.reconnectToken = event.payload.reconnectToken;
      }

      const response = await postCommand("/lobbies/join", body, event.requestId, input.signal);
      return requireIdentity(response, "/lobbies/join");
    },
    updateLobbyName: async (input) => {
      const requestId = resolveRequestId(input.requestId, requestIdFactory);
      const event = validateOutgoingEvent<LobbyUpdateNameEvent>({
        version: PROTOCOL_VERSION,
        type: "lobby.update_name",
        requestId,
        payload: {
          lobbyId: input.lobbyId,
          playerId: input.playerId,
          displayName: input.displayName
        }
      });

      return postCommand(
        "/lobbies/update-name",
        {
          requestId: event.requestId,
          lobbyId: event.payload.lobbyId,
          playerId: event.payload.playerId,
          displayName: event.payload.displayName
        },
        event.requestId,
        input.signal
      );
    },
    startLobby: async (input) => {
      const requestId = resolveRequestId(input.requestId, requestIdFactory);
      const event = validateOutgoingEvent<LobbyStartEvent>({
        version: PROTOCOL_VERSION,
        type: "lobby.start",
        requestId,
        payload: {
          lobbyId: input.lobbyId,
          actorPlayerId: input.actorPlayerId
        }
      });

      return postCommand(
        "/lobbies/start",
        {
          requestId: event.requestId,
          lobbyId: event.payload.lobbyId,
          actorPlayerId: event.payload.actorPlayerId
        },
        event.requestId,
        input.signal
      );
    },
    submitAction: async (input) => {
      const requestId = resolveRequestId(input.requestId, requestIdFactory);
      const event = validateOutgoingEvent<ActionEvent>({
        version: PROTOCOL_VERSION,
        type: input.type,
        requestId,
        payload: input.payload
      } as ActionEvent);

      return postCommand("/actions", event, event.requestId, input.signal);
    }
  };
}
