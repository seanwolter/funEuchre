type RuntimeConfig = {
  publicOrigin?: string;
};

type ConfiguredWindow = Window & {
  __FUN_EUCHRE_CONFIG__?: RuntimeConfig;
};

function asNonEmptyString(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const normalized = input.trim();
  return normalized.length > 0 ? normalized : null;
}

function toOrigin(input: string): string | null {
  try {
    return new URL(input).origin;
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

export function resolveInviteOrigin(win: Window): string | null {
  const runtimeConfig = (win as ConfiguredWindow).__FUN_EUCHRE_CONFIG__;
  const configuredOrigin = asNonEmptyString(runtimeConfig?.publicOrigin);
  if (configuredOrigin) {
    return toOrigin(configuredOrigin);
  }

  return null;
}

export function isLocalOnlyBrowserOrigin(win: Window): boolean {
  return isLocalHostname(win.location.hostname);
}
