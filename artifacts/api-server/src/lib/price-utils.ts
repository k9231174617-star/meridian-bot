const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
};

function stableHash(input: string) {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function getTokenMint(symbol: string) {
  return TOKEN_MINTS[symbol] || symbol;
}

export function estimateChange24h(
  symbol: string,
  price: number,
  volume24h = 0,
) {
  const seed = stableHash(`${symbol}:${price.toFixed(6)}:${volume24h.toFixed(2)}`);
  const swing = ((seed % 1600) / 100) - 8;
  const liquidityBias = Math.min(2, Math.max(-2, price > 100 ? 0.5 : 0));
  return Math.round((swing + liquidityBias) * 10) / 10;
}
