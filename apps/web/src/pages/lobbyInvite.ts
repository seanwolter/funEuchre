function asNonEmptyString(input: string): string | null {
  const normalized = input.trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildInviteLink(
  currentUrl: string,
  lobbyId: string,
  inviteOrigin?: string | null
): string {
  const normalizedLobbyId = lobbyId.trim();
  if (!normalizedLobbyId) {
    throw new Error("lobbyId must be a non-empty string.");
  }

  const url = new URL(currentUrl);
  if (inviteOrigin) {
    const originUrl = new URL(inviteOrigin);
    url.protocol = originUrl.protocol;
    url.host = originUrl.host;
  }
  url.hash = "/lobby";
  url.searchParams.set("lobbyId", normalizedLobbyId);
  return url.toString();
}

export function resolveInviteLobbyId(currentUrl: string): string | null {
  const url = new URL(currentUrl);
  return asNonEmptyString(url.searchParams.get("lobbyId") ?? "");
}
