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
  const hashParams = new URLSearchParams();
  hashParams.set("lobbyId", normalizedLobbyId);
  url.hash = `/lobby?${hashParams.toString()}`;
  url.searchParams.set("lobbyId", normalizedLobbyId);
  return url.toString();
}

export function resolveInviteLobbyId(currentUrl: string): string | null {
  const url = new URL(currentUrl);
  const queryLobbyId = asNonEmptyString(url.searchParams.get("lobbyId") ?? "");
  if (queryLobbyId) {
    return queryLobbyId;
  }

  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const queryIndex = hash.indexOf("?");
  if (queryIndex < 0) {
    return null;
  }

  const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
  return asNonEmptyString(hashParams.get("lobbyId") ?? "");
}
