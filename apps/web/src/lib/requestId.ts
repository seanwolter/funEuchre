export type RequestIdFactory = () => string;

type CryptoWithRandomUuid = {
  randomUUID: () => string;
};

function resolveRandomUuidCrypto(): CryptoWithRandomUuid | null {
  const candidate = globalThis.crypto as Partial<CryptoWithRandomUuid> | undefined;
  if (!candidate || typeof candidate.randomUUID !== "function") {
    return null;
  }

  return candidate as CryptoWithRandomUuid;
}

function fallbackRequestId(nowMs = Date.now()): string {
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `req-${nowMs.toString(36)}-${randomSuffix}`;
}

export function createRequestId(): string {
  const cryptoApi = resolveRandomUuidCrypto();
  if (cryptoApi) {
    return cryptoApi.randomUUID();
  }

  return fallbackRequestId();
}
