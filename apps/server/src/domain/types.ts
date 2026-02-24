type Opaque<TValue, TTag extends string> = TValue & {
  readonly __brand: TTag;
};

export type LobbyId = Opaque<string, "LobbyId">;
export type GameId = Opaque<string, "GameId">;
export type PlayerId = Opaque<string, "PlayerId">;
export type SessionId = Opaque<string, "SessionId">;
export type ReconnectToken = Opaque<string, "ReconnectToken">;

export type DomainIdFactory = {
  nextLobbyId(): LobbyId;
  nextGameId(): GameId;
  nextPlayerId(): PlayerId;
  nextSessionId(): SessionId;
  nextReconnectToken(): ReconnectToken;
};
