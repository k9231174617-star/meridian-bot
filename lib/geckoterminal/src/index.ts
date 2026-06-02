export type GeckoTerminalRecord = Record<string, unknown>;

const GECKO_TERMINAL_API_URL = "https://api.geckoterminal.com/api/v2";
const GECKO_TERMINAL_ACCEPT = "application/json;version=20230203";

export async function fetchGeckoTerminalTrendingPools(options: {
  network?: string;
  limit?: number;
  apiVersion?: string;
} = {}): Promise<GeckoTerminalRecord[]> {
  const network = options.network ?? "solana";
  const url = `${GECKO_TERMINAL_API_URL}/networks/${encodeURIComponent(network)}/trending_pools`;

  const response = await fetch(url, {
    headers: {
      accept: options.apiVersion ? `application/json;version=${options.apiVersion}` : GECKO_TERMINAL_ACCEPT,
      "user-agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`GeckoTerminal trending pools error: ${response.status}`);

  const body = await response.json();
  return flattenGeckoTerminalPools(body).slice(0, Math.min(Math.max(options.limit ?? 20, 1), 100));
}

export function flattenGeckoTerminalPools(body: unknown): GeckoTerminalRecord[] {
  if (!isRecord(body)) return [];
  const payload = body as Record<string, unknown>;
  const candidate = payload.data ?? payload.items ?? payload.result;
  if (!Array.isArray(candidate)) return [];

  return candidate.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const attributes = isRecord(entry.attributes) ? (entry.attributes as Record<string, unknown>) : {};
    const relationships = isRecord(entry.relationships) ? (entry.relationships as Record<string, unknown>) : {};
    const dex = isRecord((relationships.dex as Record<string, unknown> | undefined)?.data)
      ? ((relationships.dex as Record<string, unknown>).data as Record<string, unknown>).id
      : undefined;
    const baseToken = isRecord((relationships.base_token as Record<string, unknown> | undefined)?.data)
      ? ((relationships.base_token as Record<string, unknown>).data as Record<string, unknown>).id
      : undefined;
    const quoteToken = isRecord((relationships.quote_token as Record<string, unknown> | undefined)?.data)
      ? ((relationships.quote_token as Record<string, unknown>).data as Record<string, unknown>).id
      : undefined;
    return [
      {
        ...attributes,
        id: typeof entry.id === "string" ? entry.id : undefined,
        dex,
        base_token_id: baseToken,
        quote_token_id: quoteToken,
      } as GeckoTerminalRecord,
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
