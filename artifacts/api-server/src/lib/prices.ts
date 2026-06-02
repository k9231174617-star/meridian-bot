import type { PricesResponse } from "@workspace/api-zod";
import { DEFAULT_BIRDEYE_PRICE_SYMBOLS, TOKEN_MINTS } from "@workspace/birdeye";

export const DEFAULT_PRICE_TOKENS = [...DEFAULT_BIRDEYE_PRICE_SYMBOLS];
export { TOKEN_MINTS };

export type JupiterPriceRecord = {
  price?: string | number;
  value?: string | number;
  change24h?: string | number;
  price_change_24h?: string | number;
  percentChange24h?: string | number;
  priceChange24hPercent?: string | number;
  price_change_24h_percent?: string | number;
  change_24h?: string | number;
  percent_change_24h?: string | number;
  usdPrice?: string | number;
  priceChange24h?: string | number;
  createdAt?: string;
  blockId?: number;
  decimals?: number;
  liquidity?: number;
};

export function normalizePriceTokens(tokens?: string): string[] {
  const list = (tokens || DEFAULT_PRICE_TOKENS.join(","))
    .split(",")
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);

  return list.length > 0 ? list : [...DEFAULT_PRICE_TOKENS];
}

export function buildPriceResponse(
  tokenList: string[],
  raw: Record<string, any>,
): PricesResponse {
  return {
    prices: Object.fromEntries(
      tokenList.map((token) => {
        const mint = TOKEN_MINTS[token] ?? token;
        const entry = raw[mint];
        return [
          token,
          {
            symbol: token,
            price: toPriceNumber(entry),
            change24h: toChangeNumber(entry),
          },
        ] as const;
      }),
    ),
    updatedAt: new Date().toISOString(),
  };
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPriceNumber(entry: JupiterPriceRecord | undefined) {
  return toNumber(entry?.usdPrice ?? entry?.price ?? (entry as { value?: string | number } | undefined)?.value);
}

function toChangeNumber(entry: JupiterPriceRecord | undefined) {
  return (
    toNumber(
      entry?.priceChange24h ??
        entry?.change24h ??
        entry?.percentChange24h ??
        entry?.priceChange24hPercent ??
        entry?.price_change_24h_percent ??
        entry?.change_24h ??
        entry?.percent_change_24h ??
        entry?.price_change_24h,
    ) || 0
  );
}
