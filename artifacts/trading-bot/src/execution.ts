// @ts-nocheck
import { createRequire } from "node:module";
import BN from "bn.js";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { ExecutionResult, TradeIntent } from "./domain.js";

type Bn = InstanceType<typeof BN>;
type MeteoraSdk = typeof import("@meteora-ag/dlmm");
type LbPosition = {
  publicKey: PublicKey;
  positionData: {
    totalXAmount: string;
    totalYAmount: string;
    lowerBinId?: number;
    upperBinId?: number;
  };
};

const require = createRequire(import.meta.url);

async function loadMeteoraSdk(): Promise<MeteoraSdk> {
  return require("@meteora-ag/dlmm") as MeteoraSdk;
}

const DEFAULT_CONFIRMATION_TIMEOUT_MS = 45_000;
const DEFAULT_DLMM_POSITION_WIDTH = 69;
const MAX_TRANSACTION_ATTEMPTS = 3;

export type ExecutionClient = {
  execute(intent: TradeIntent): Promise<ExecutionResult>;
};

export class PaperExecutionClient implements ExecutionClient {
  async execute(intent: TradeIntent): Promise<ExecutionResult> {
    const fillRatio = intent.action === "REMOVE_LIQUIDITY" ? 0.98 : 0.995;
    const slippageUsd = round2(intent.amountUsd * (intent.slippageBps / 10_000));
    const feesUsd = round2(Math.max(0.05, intent.amountUsd * 0.0015));
    const filledUsd = round2(intent.amountUsd * fillRatio - slippageUsd);

    return {
      intentId: intent.id,
      status: "simulated",
      filledUsd: Math.max(0, filledUsd),
      feesUsd,
      slippageUsd,
      executedAt: new Date().toISOString(),
      reason: "Paper execution",
    };
  }
}

export class DryRunExecutionClient implements ExecutionClient {
  async execute(intent: TradeIntent): Promise<ExecutionResult> {
    return {
      intentId: intent.id,
      status: "simulated",
      filledUsd: 0,
      feesUsd: 0,
      slippageUsd: 0,
      executedAt: new Date().toISOString(),
      reason: `Dry-run plan for ${intent.action} via ${intent.route}`,
    };
  }
}

export class JupiterSwapExecutionClient implements ExecutionClient {
  constructor(
    private readonly rpcUrl: string,
    private readonly secretKey: string,
    private readonly jupiterApiKey?: string,
  ) {}

  async execute(intent: TradeIntent): Promise<ExecutionResult> {
    if (intent.action === "SWAP") {
      return this.executeSwap(intent);
    }

    if (intent.action === "ADD_LIQUIDITY" || intent.action === "REMOVE_LIQUIDITY") {
      return this.executeDlmm(intent);
    }

    return {
      intentId: intent.id,
      status: "rejected",
      filledUsd: 0,
      feesUsd: 0,
      slippageUsd: 0,
      executedAt: new Date().toISOString(),
      reason: `Unsupported live action: ${intent.action}`,
    };
  }

  private async executeSwap(intent: TradeIntent): Promise<ExecutionResult> {
    const connection = new Connection(this.rpcUrl, "confirmed");
    const keypair = loadKeypair(this.secretKey);

    const signatures = await sendExecutionPlan(
      connection,
      async () => {
        const quote = await fetchQuote(intent, this.jupiterApiKey);
        const swapTransaction = await buildSwapTransaction(
          quote,
          keypair.publicKey.toBase58(),
          intent.priorityFeeMicroLamports,
          this.jupiterApiKey,
        );
        return VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
      },
      [keypair],
      {
        label: "Jupiter swap",
      },
    );

    return {
      intentId: intent.id,
      status: "filled",
      txSignature: signatures.join(","),
      filledUsd: round2(intent.amountUsd),
      feesUsd: round2(Math.max(0.05, intent.amountUsd * 0.002)),
      slippageUsd: round2(intent.amountUsd * (intent.slippageBps / 10_000)),
      executedAt: new Date().toISOString(),
      reason: "Live Jupiter swap submitted",
    };
  }

  private async executeDlmm(intent: TradeIntent): Promise<ExecutionResult> {
    const connection = new Connection(this.rpcUrl, "confirmed");
    const user = loadKeypair(this.secretKey);
    const poolAddress = parsePublicKey(intent.poolAddress, "BOT intent poolAddress");
    const meteora = await loadMeteoraSdk();
    const dlmmHelpers = meteora as unknown as {
      getPositionLowerUpperBinIdWithLiquidity: (
        position: LbPosition["positionData"],
      ) => { lowerBinId: Bn; upperBinId: Bn } | null;
      getTokenDecimals: (connection: Connection, mint: PublicKey) => Promise<number>;
      getTokensMintFromPoolAddress: (
        connection: Connection,
        poolAddress: string,
        opt?: { cluster?: "mainnet-beta" | "devnet" | "testnet" | "localhost"; programId?: PublicKey },
      ) => Promise<{ tokenXMint: PublicKey; tokenYMint: PublicKey }>;
    };
    const DLMM = meteora.default;
    const StrategyType = meteora.StrategyType;
    const dlmmPool = await DLMM.create(connection, poolAddress);

    const { activeBin, userPositions } = await dlmmPool.getPositionsByUserAndLbPair(user.publicKey);
    const activeBinId = activeBin.binId;

    const { tokenXMint, tokenYMint } = await dlmmHelpers.getTokensMintFromPoolAddress(connection, intent.poolAddress, {
      cluster: inferCluster(this.rpcUrl),
    });

    const [tokenXDecimals, tokenYDecimals, tokenPrices] = await Promise.all([
      dlmmHelpers.getTokenDecimals(connection, tokenXMint),
      dlmmHelpers.getTokenDecimals(connection, tokenYMint),
      fetchTokenUsdPrices([tokenXMint.toBase58(), tokenYMint.toBase58()], this.jupiterApiKey),
    ]);

    const tokenXPriceUsd = tokenPrices[tokenXMint.toBase58()];
    const tokenYPriceUsd = tokenPrices[tokenYMint.toBase58()];

    if (!Number.isFinite(tokenXPriceUsd) || tokenXPriceUsd <= 0) {
      return unsupportedExecution(intent, "Could not resolve token X USD price for live Meteora execution");
    }

    if (!Number.isFinite(tokenYPriceUsd) || tokenYPriceUsd <= 0) {
      return unsupportedExecution(intent, "Could not resolve token Y USD price for live Meteora execution");
    }

    const slippagePct = Math.max(0.01, intent.slippageBps / 100);

    if (intent.action === "ADD_LIQUIDITY") {
      const position = selectPositionForAdd(userPositions, activeBinId, dlmmHelpers);
      const amounts = splitUsdCapital(intent.amountUsd, tokenXPriceUsd, tokenYPriceUsd, tokenXDecimals, tokenYDecimals);
      if (!amounts) {
        return unsupportedExecution(intent, "Could not split capital into valid token amounts for live Meteora add");
      }
      const positionKeypair = position ? null : Keypair.generate();

      const buildTransaction = async () => {
        if (position) {
          const range = getPositionRange(position, dlmmHelpers);
          if (!range) {
            throw new Error("Unable to determine existing Meteora position range");
          }

          return dlmmPool.addLiquidityByStrategy({
            positionPubKey: position.publicKey,
            totalXAmount: amounts.totalXAmount,
            totalYAmount: amounts.totalYAmount,
            strategy: {
              minBinId: range.lowerBinId,
              maxBinId: range.upperBinId,
              strategyType: StrategyType.Spot,
            },
            user: user.publicKey,
            slippage: slippagePct,
          });
        }

        if (!positionKeypair) {
          throw new Error("Expected a fresh position keypair for live Meteora initialization");
        }

        return dlmmPool.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: positionKeypair.publicKey,
          totalXAmount: amounts.totalXAmount,
          totalYAmount: amounts.totalYAmount,
          strategy: {
            minBinId: activeBinId - defaultHalfWidth(DEFAULT_DLMM_POSITION_WIDTH),
            maxBinId: activeBinId + defaultUpperOffset(DEFAULT_DLMM_POSITION_WIDTH),
            strategyType: StrategyType.Spot,
          },
          user: user.publicKey,
          slippage: slippagePct,
          });
      };

      const signers = position ? [user] : [user, positionKeypair!];
      const signatures = await sendExecutionPlan(connection, buildTransaction, signers, {
        label: "Meteora add liquidity",
      });

      return {
        intentId: intent.id,
        status: "filled",
        txSignature: signatures.join(","),
        filledUsd: round2(intent.amountUsd),
        feesUsd: round2(Math.max(0.05, intent.amountUsd * 0.0015)),
        slippageUsd: round2(intent.amountUsd * (intent.slippageBps / 10_000)),
        executedAt: new Date().toISOString(),
        reason: position
          ? "Live Meteora add liquidity submitted to an existing position"
          : "Live Meteora add liquidity submitted to a new position",
      };
    }

    const position = selectPositionForRemoval(userPositions, activeBinId, dlmmHelpers);
    if (!position) {
      return unsupportedExecution(intent, "No live Meteora position was found for this wallet and pool");
    }

    const range = getPositionRange(position, dlmmHelpers);
    if (!range) {
      return unsupportedExecution(intent, "The live Meteora position does not expose a valid liquidity range");
    }

    const buildTransaction = async () =>
      dlmmPool.removeLiquidity({
        user: user.publicKey,
        position: position.publicKey,
        fromBinId: range.lowerBinId,
        toBinId: range.upperBinId,
        bps: new BN(10_000),
        shouldClaimAndClose: true,
      });

    const signatures = await sendExecutionPlan(connection, buildTransaction, [user], {
      label: "Meteora remove liquidity",
    });

    return {
      intentId: intent.id,
      status: "filled",
      txSignature: signatures.join(","),
      filledUsd: round2(intent.amountUsd),
      feesUsd: round2(Math.max(0.05, intent.amountUsd * 0.0015)),
      slippageUsd: round2(intent.amountUsd * (intent.slippageBps / 10_000)),
      executedAt: new Date().toISOString(),
      reason: "Live Meteora remove liquidity submitted",
    };
  }
}

async function sendExecutionPlan(
  connection: Connection,
  buildPlan: () => Promise<Transaction | VersionedTransaction | Array<Transaction | VersionedTransaction>>,
  signers: Keypair[],
  options?: { label?: string },
): Promise<string[]> {
  const maxPlanAttempts = MAX_TRANSACTION_ATTEMPTS;

  for (let attempt = 1; attempt <= maxPlanAttempts; attempt += 1) {
    const plan = await buildPlan();
    const transactions = Array.isArray(plan) ? plan : [plan];
    const signatures: string[] = [];

    try {
      for (const transaction of transactions) {
        const signature = await sendPreparedTransaction(connection, transaction, signers, options);
        signatures.push(signature);
      }

      return signatures;
    } catch (error) {
      if (transactions.length > 1 || !isRetryableExecutionError(error) || attempt === maxPlanAttempts) {
        throw error;
      }
      await delay(backoffMs(attempt));
    }
  }

  throw new Error(`Execution failed${options?.label ? `: ${options.label}` : ""}`);
}

async function sendPreparedTransaction(
  connection: Connection,
  transaction: Transaction | VersionedTransaction,
  signers: Keypair[],
  options?: { label?: string },
): Promise<string> {
  const retryableAttempts = transaction instanceof Transaction ? MAX_TRANSACTION_ATTEMPTS : 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retryableAttempts; attempt += 1) {
    try {
      if (transaction instanceof Transaction) {
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        transaction.recentBlockhash = blockhash;
        transaction.feePayer ??= signers[0]?.publicKey;
        transaction.sign(...signers);
      } else {
        transaction.sign(signers);
      }

      const rawTransaction = transaction.serialize();
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        maxRetries: 0,
      });

      await waitForSignatureConfirmation(connection, signature, options?.label);
      return signature;
    } catch (error) {
      lastError = error;
      if (!isRetryableExecutionError(error) || attempt === retryableAttempts) {
        throw error;
      }
      await delay(backoffMs(attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Transaction failed${options?.label ? `: ${options.label}` : ""}`);
}

async function waitForSignatureConfirmation(connection: Connection, signature: string, label?: string) {
  const deadline = Date.now() + DEFAULT_CONFIRMATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = value[0];

    if (status?.err) {
      throw new Error(`Transaction ${signature} failed${label ? ` (${label})` : ""}: ${JSON.stringify(status.err)}`);
    }

    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }

    await delay(1_000);
  }

  throw new Error(`Timed out waiting for transaction confirmation${label ? ` (${label})` : ""}: ${signature}`);
}

async function fetchQuote(intent: TradeIntent, apiKey?: string) {
  const params = new URLSearchParams({
    inputMint: intent.symbolIn ?? "So11111111111111111111111111111111111111112",
    outputMint: intent.symbolOut ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount: String(Math.max(1, Math.round(intent.amountUsd * 1_000_000))),
    slippageBps: String(intent.slippageBps),
  });

  const candidates = [
    { url: `https://api.jup.ag/swap/v1/quote?${params.toString()}`, headers: jupiterHeaders(apiKey) },
    { url: `https://quote-api.jup.ag/v6/quote?${params.toString()}`, headers: { Accept: "application/json" } },
  ];

  for (const candidate of candidates) {
    const response = await fetch(candidate.url, {
      headers: candidate.headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) continue;
    return response.json();
  }

  throw new Error("Jupiter quote API failed for all known endpoints");
}

async function buildSwapTransaction(
  quote: unknown,
  userPublicKey: string,
  priorityFeeMicroLamports: number,
  apiKey?: string,
) {
  const body = JSON.stringify({
    quoteResponse: quote,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: Math.max(1_000, Math.floor(priorityFeeMicroLamports / 1_000)),
  });

  for (const [url, headers] of [
    ["https://api.jup.ag/swap/v1/swap", jupiterHeaders(apiKey, true)],
    ["https://quote-api.jup.ag/v6/swap", { "content-type": "application/json" }],
  ] as const) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) continue;

    const payload = (await response.json()) as { swapTransaction?: string };
    if (payload.swapTransaction) return payload.swapTransaction;
  }

  throw new Error("Jupiter swap API failed for all known endpoints");
}

type JupiterPriceEntry = { usdPrice?: number; price?: number; priceChange24h?: number };
type JupiterPriceMap = Record<string, JupiterPriceEntry>;

async function fetchTokenUsdPrices(mints: string[], apiKey?: string) {
  const uniqueMints = [...new Set(mints)].filter(Boolean);
  if (uniqueMints.length === 0) return {};

  const params = new URLSearchParams({ ids: uniqueMints.join(",") });
  const candidates = [
    { url: `https://api.jup.ag/price/v3?${params.toString()}`, headers: jupiterHeaders(apiKey) },
    { url: `https://lite-api.jup.ag/price/v3?${params.toString()}`, headers: { Accept: "application/json" } },
  ];

  for (const candidate of candidates) {
    const response = await fetch(candidate.url, {
      headers: candidate.headers,
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) continue;

    const payload: any = await response.json();
    const data = (payload?.data ?? payload) as JupiterPriceMap;
    const prices: Record<string, number> = {};
    for (const mint of uniqueMints) {
      const price = data[mint]?.usdPrice ?? data[mint]?.price;
      if (typeof price === "number") {
        prices[mint] = price;
      }
    }

    if (Object.keys(prices).length > 0) return prices;
  }

  throw new Error("Jupiter price API failed for all known endpoints");
}

function splitUsdCapital(
  amountUsd: number,
  tokenXPriceUsd: number,
  tokenYPriceUsd: number,
  tokenXDecimals: number,
  tokenYDecimals: number,
) {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  if (!Number.isFinite(tokenXPriceUsd) || tokenXPriceUsd <= 0) return null;
  if (!Number.isFinite(tokenYPriceUsd) || tokenYPriceUsd <= 0) return null;

  const halfUsd = amountUsd / 2;
  const totalXAmount = toRawAmount(halfUsd, tokenXPriceUsd, tokenXDecimals);
  const totalYAmount = toRawAmount(halfUsd, tokenYPriceUsd, tokenYDecimals);

  if (totalXAmount.lte(new BN(0)) || totalYAmount.lte(new BN(0))) return null;
  return { totalXAmount, totalYAmount };
}

function toRawAmount(usdAmount: number, tokenPriceUsd: number, decimals: number) {
  const tokenAmount = usdAmount / tokenPriceUsd;
  const rawAmount = Math.floor(tokenAmount * 10 ** decimals);
  return new BN(Math.max(0, rawAmount));
}

function selectPositionForAdd(
  positions: Array<LbPosition>,
  activeBinId: number,
  helpers: {
    getPositionLowerUpperBinIdWithLiquidity: (
      position: LbPosition["positionData"],
    ) => { lowerBinId: Bn; upperBinId: Bn } | null;
  },
): LbPosition | null {
  return selectPosition(positions, activeBinId, false, helpers);
}

function selectPositionForRemoval(
  positions: Array<LbPosition>,
  activeBinId: number,
  helpers: {
    getPositionLowerUpperBinIdWithLiquidity: (
      position: LbPosition["positionData"],
    ) => { lowerBinId: Bn; upperBinId: Bn } | null;
  },
): LbPosition | null {
  return selectPosition(positions, activeBinId, true, helpers);
}

function selectPosition(
  positions: Array<LbPosition>,
  activeBinId: number,
  requireLiquidity: boolean,
  helpers: {
    getPositionLowerUpperBinIdWithLiquidity: (
      position: LbPosition["positionData"],
    ) => { lowerBinId: Bn; upperBinId: Bn } | null;
  },
): LbPosition | null {
  const scored = positions
    .map((position) => {
      const range = getPositionRange(position, helpers);
      const hasLiquidity = positionHasLiquidity(position);
      if (requireLiquidity && !hasLiquidity) return null;

      return {
        position,
        activeCoverage: range ? (range.lowerBinId <= activeBinId && activeBinId <= range.upperBinId ? 1 : 0) : 0,
        notional: positionNotional(position),
      };
    })
    .filter((entry): entry is { position: LbPosition; activeCoverage: number; notional: bigint } =>
      entry !== null,
    );

  if (scored.length === 0) return null;

  scored.sort((a, b) => {
    if (a.activeCoverage !== b.activeCoverage) return b.activeCoverage - a.activeCoverage;
    if (a.notional === b.notional) return 0;
    return a.notional > b.notional ? -1 : 1;
  });

  return scored[0]?.position ?? null;
}

function getPositionRange(
  position: LbPosition,
  helpers: {
    getPositionLowerUpperBinIdWithLiquidity: (
      position: LbPosition["positionData"],
    ) => { lowerBinId: Bn; upperBinId: Bn } | null;
  },
) {
  const range = helpers.getPositionLowerUpperBinIdWithLiquidity(position.positionData);
  if (range) {
    return {
      lowerBinId: range.lowerBinId.toNumber(),
      upperBinId: range.upperBinId.toNumber(),
    };
  }

  if (typeof position.positionData.lowerBinId === "number" && typeof position.positionData.upperBinId === "number") {
    return {
      lowerBinId: position.positionData.lowerBinId,
      upperBinId: position.positionData.upperBinId,
    };
  }

  return null;
}

function positionHasLiquidity(position: LbPosition) {
  return positionNotional(position) > 0n;
}

function positionNotional(position: LbPosition) {
  return safeBigInt(position.positionData.totalXAmount) + safeBigInt(position.positionData.totalYAmount);
}

function safeBigInt(value: string | number | bigint | undefined) {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(value);
    if (typeof value === "string" && value.trim().length > 0) return BigInt(value);
  } catch {
    return 0n;
  }
  return 0n;
}

function defaultHalfWidth(width: number) {
  return Math.floor((width - 1) / 2);
}

function defaultUpperOffset(width: number) {
  return width - 1 - defaultHalfWidth(width);
}

function inferCluster(rpcUrl: string): "mainnet-beta" | "devnet" | "testnet" | "localhost" {
  const normalized = rpcUrl.toLowerCase();
  if (normalized.includes("localhost") || normalized.includes("127.0.0.1")) return "localhost";
  if (normalized.includes("devnet")) return "devnet";
  if (normalized.includes("testnet")) return "testnet";
  return "mainnet-beta";
}

function parsePublicKey(value: string, fieldName: string) {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${fieldName} must be a valid Solana public key`);
  }
}

function unsupportedExecution(intent: TradeIntent, reason: string): ExecutionResult {
  return {
    intentId: intent.id,
    status: "rejected",
    filledUsd: 0,
    feesUsd: 0,
    slippageUsd: 0,
    executedAt: new Date().toISOString(),
    reason,
  };
}

function loadKeypair(secretKey: string) {
  const trimmed = secretKey.trim();
  if (trimmed.startsWith("[")) {
    const bytes = JSON.parse(trimmed) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Keypair.fromSecretKey(Uint8Array.from(Buffer.from(trimmed, "hex")));
  }

  try {
    return Keypair.fromSecretKey(Uint8Array.from(Buffer.from(trimmed, "base64")));
  } catch {
    throw new Error("BOT_SIGNER_SECRET_KEY must be JSON array, hex, or base64 encoded secret key");
  }
}

function jupiterHeaders(apiKey?: string, contentType = false) {
  const headers: Record<string, string> = contentType
    ? { "content-type": "application/json", Accept: "application/json" }
    : { Accept: "application/json" };

  if (apiKey) headers["x-api-key"] = apiKey;
  return headers;
}

function isRetryableExecutionError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return [
    "blockhash not found",
    "transaction expired",
    "expired blockheight",
    "timed out",
    "timeout",
    "node is behind",
    "network error",
    "econnreset",
    "etimedout",
    "fetch failed",
    "429",
    "too many requests",
    "service unavailable",
    "gateway timeout",
  ].some((needle) => message.includes(needle));
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function backoffMs(attempt: number) {
  return Math.min(2_500, 350 * 2 ** (attempt - 1));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
