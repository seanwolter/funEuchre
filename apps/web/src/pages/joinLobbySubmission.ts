type JoinLobbyDraft = {
  lobbyId: string;
  displayName: string;
  reconnectToken: string;
};

export type JoinLobbySubmission = {
  lobbyId: string;
  displayName: string;
  reconnectToken?: string;
};

export type JoinLobbySubmissionResult =
  | {
      ok: true;
      input: JoinLobbySubmission;
    }
  | {
      ok: false;
      message: string;
    };

function asNonEmptyString(input: string): string | null {
  const normalized = input.trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildJoinLobbySubmission(
  draft: JoinLobbyDraft
): JoinLobbySubmissionResult {
  const lobbyId = asNonEmptyString(draft.lobbyId);
  const displayName = asNonEmptyString(draft.displayName);
  if (!lobbyId || !displayName) {
    return {
      ok: false,
      message: "Join lobby requires lobby ID and display name."
    };
  }

  const reconnectToken = asNonEmptyString(draft.reconnectToken);
  const input: JoinLobbySubmission = {
    lobbyId,
    displayName
  };
  if (reconnectToken) {
    input.reconnectToken = reconnectToken;
  }

  return {
    ok: true,
    input
  };
}
