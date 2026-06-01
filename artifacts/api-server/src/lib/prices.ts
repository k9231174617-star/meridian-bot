import type { PricesResponse } from "@workspace/api-zod";

export const DEFAULT_PRICE_TOKENS = ["SOL", "USDC", "JUP", "RAY", "BONK"];

export const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
};

export type JupiterPriceRecord = {
  price?: string | number;
  change24h?: string | number;
  price_change_24h?: string | number;
  percentChange24h?: string | number;
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
  return toNumber(entry?.usdPrice ?? entry?.price);
}

function toChangeNumber(entry: JupiterPriceRecord | undefined) {
  return (
    toNumber(
      entry?.priceChange24h ??
        entry?.change24h ??
        entry?.percentChange24h ??
        entry?.percent_change_24h ??
        entry?.price_change_24h,
    ) || 0
  );
}
