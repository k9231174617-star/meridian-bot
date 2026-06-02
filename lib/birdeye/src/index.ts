export const BIRDEYE_CHAIN = "solana";

export const DEFAULT_BIRDEYE_PRICE_SYMBOLS = ["SOL", "USDC", "JUP", "RAY", "BONK"] as const;

export const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
};

export type BirdeyeRecord = Record<string, unknown>;

const BIRDEYE_API_URL = "https://public-api.birdeye.so";

export function getBirdeyeApiKey(env = process.env): string | undefined {
  return env.BIRDEYE_API_KEY?.trim() || env.BOT_BIRDEYE_API_KEY?.trim() || undefined;
}

export async function fetchBirdeyeTokenList(options: {
  limit?: number;
  minLiquidity?: number;
  sortBy?: string;
  apiKey?: string;
} = {}): Promise<BirdeyeRecord[]> {
  const query = new URLSearchParams({
    chain: BIRDEYE_CHAIN,
    sort_by: options.sortBy ?? "liquidity",
    sort_type: "desc",
    min_liquidity: String(options.minLiquidity ?? 0),
    offset: "0",
    limit: String(Math.min(Math.max(options.limit ?? 20, 1), 100)),
    ui_amount_mode: "scaled",
  });

  const response = await fetch(`${BIRDEYE_API_URL}/defi/v3/token/list?${query.toString()}`, {
    headers: birdeyeHeaders(options.apiKey),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Birdeye token list error: ${response.status}`);

  const body = await response.json();
  return flattenBirdeyeRecords(body);
}

export async function fetchBirdeyeTokenMarketData(address: string, apiKey?: string): Promise<BirdeyeRecord | undefined> {
  const query = new URLSearchParams({
    address,
    ui_amount_mode: "scaled",
  });
  const response = await fetch(`${BIRDEYE_API_URL}/defi/v3/token/market-data?${query.toString()}`, {
    headers: birdeyeHeaders(apiKey),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Birdeye token market data error: ${response.status}`);

  const body = await response.json();
  const record = extractBirdeyeRecord(body);
  return record ?? undefined;
}

export async function fetchBirdeyeTokenPrice(address: string, apiKey?: string): Promise<BirdeyeRecord | undefined> {
  const query = new URLSearchParams({
    address,
    ui_amount_mode: "raw",
  });
  const response = await fetch(`${BIRDEYE_API_URL}/defi/price?${query.toString()}`, {
    headers: birdeyeHeaders(apiKey),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Birdeye token price error: ${response.status}`);

  const body = await response.json();
  const record = extractBirdeyeRecord(body);
  return record ?? undefined;
}

export function flattenBirdeyeRecords(body: unknown): BirdeyeRecord[] {
  const records: BirdeyeRecord[] = [];

  const pushRecord = (value: unknown) => {
    if (isRecord(value)) records.push(value);
  };

  const visit = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (isRecord(entry) && Array.isArray(entry.result)) {
          entry.result.forEach((nested) => pushRecord(nested));
        } else {
          pushRecord(entry);
        }
      });
      return;
    }

    if (!isRecord(value)) return;
    const candidate = value.data ?? value.items ?? value.result;
    if (Array.isArray(candidate)) {
      candidate.forEach((entry) => {
        if (isRecord(entry) && Array.isArray(entry.result)) {
          entry.result.forEach((nested) => pushRecord(nested));
        } else {
          pushRecord(entry);
        }
      });
      return;
    }

    if (isRecord(candidate)) {
      const nested = candidate.items ?? candidate.result ?? candidate.data;
      if (Array.isArray(nested)) {
        nested.forEach((entry) => pushRecord(entry));
        return;
      }
      pushRecord(candidate);
      return;
    }

    pushRecord(value);
  };

  visit(body);
  return records;
}

export function extractBirdeyeRecord(body: unknown): BirdeyeRecord | undefined {
  if (isRecord(body)) {
    const candidate = body.data ?? body.result ?? body.item;
    if (isRecord(candidate) && "value" in candidate && "updateUnixTime" in candidate) return candidate;
    if (isRecord(candidate)) return candidate;
    return body;
  }
  return undefined;
}

function birdeyeHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json", "x-chain": BIRDEYE_CHAIN };
  if (apiKey?.trim()) {
    return { ...headers, "x-api-key": apiKey.trim() };
  }
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
