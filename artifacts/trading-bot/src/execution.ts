import BN from "bn.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { ExecutionResult, TradeIntent } from "./domain.js";
import {
  ExecutionOrchestrator,
  CommandType,
  PoolProtocol,
  derive_position_pda,
  METEORA_DLMM_PROGRAM,
  type ExecutionCommand,
  type PositionInfo,
} from "./execution/index.js";

export type ExecutionClient = {
  execute(intent: TradeIntent): Promise<ExecutionResult>;
};

const DEFAULT_DLMM_POSITION_WIDTH = 8;

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
  private orchestrator: ExecutionOrchestrator | null = null;

  constructor(
    private readonly rpcUrl: string,
    private readonly secretKey: string,
    private readonly jupiterApiKey?: string,
  ) {}

  async execute(intent: TradeIntent): Promise<ExecutionResult> {
    if (intent.action === "SWAP") {
      return this.executeSwap(intent);
    }

    if (intent.action === "ADD_LIQUIDITY" || intent.action === "REMOVE_LIQUIDITY" || intent.action === "REBALANCE") {
      return this.executeMeteora(intent);
    }

    return unsupportedExecution(intent, `Unsupported live action: ${intent.action}`);
  }

  private async executeSwap(intent: TradeIntent): Promise<ExecutionResult> {
    const orchestrator = await this.getOrchestrator();
    const command = buildSwapCommand(intent, loadKeypair(this.secretKey).publicKey);
    const result = await orchestrator.execute(command);

    return mapOrchestratorResult(intent, result, intent.amountUsd, "Live Jupiter swap submitted");
  }

  private async executeMeteora(intent: TradeIntent): Promise<ExecutionResult> {
    const connection = new Connection(this.rpcUrl, "confirmed");
    const user = loadKeypair(this.secretKey);
    const orchestrator = await this.getOrchestrator();
    const meteora = (await import("@meteora-ag/dlmm")) as typeof import("@meteora-ag/dlmm");
    const DLMM = meteora.default;

    const poolAddress = parsePublicKey(intent.poolAddress, "BOT intent poolAddress");
    const dlmmPool = await DLMM.create(connection, poolAddress);
    const { activeBin, userPositions } = await dlmmPool.getPositionsByUserAndLbPair(user.publicKey);
    const activeBinId = activeBin.binId;

    const { tokenXMint, tokenYMint } = await meteora.getTokensMintFromPoolAddress(connection, intent.poolAddress, {
      cluster: inferCluster(this.rpcUrl),
    });

    const [tokenXDecimals, tokenYDecimals, tokenPrices] = await Promise.all([
      meteora.getTokenDecimals(connection, tokenXMint),
      meteora.getTokenDecimals(connection, tokenYMint),
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

    const existingPosition = selectPositionForAction(userPositions, activeBinId, intent.action !== "ADD_LIQUIDITY", {
      getPositionLowerUpperBinIdWithLiquidity: meteora.getPositionLowerUpperBinIdWithLiquidity,
    });

    const amounts = splitUsdCapital(
      intent.amountUsd,
      tokenXPriceUsd,
      tokenYPriceUsd,
      tokenXDecimals,
      tokenYDecimals,
    );

    if (!amounts) {
      return unsupportedExecution(intent, "Could not split capital into valid token amounts for live Meteora execution");
    }

    const lowerBinId = existingPosition?.positionData.lowerBinId ?? activeBinId - defaultHalfWidth(DEFAULT_DLMM_POSITION_WIDTH);
    const upperBinId = existingPosition?.positionData.upperBinId ?? activeBinId + defaultUpperOffset(DEFAULT_DLMM_POSITION_WIDTH);
    const width = Math.max(1, upperBinId - lowerBinId);
    const positionPubkey = existingPosition?.publicKey ?? derivePositionPda(poolAddress, user.publicKey, lowerBinId, width);
    const positionRange = { lowerBinId, upperBinId };
    const positionInfo = await buildPositionInfo({
      connection,
      user,
      poolAddress,
      tokenXMint,
      tokenYMint,
      lowerBinId: positionRange.lowerBinId,
      upperBinId: positionRange.upperBinId,
      positionPubkey,
      meteora,
    });

    if (intent.action === "REBALANCE") {
      if (!existingPosition) {
        return unsupportedExecution(intent, "No live Meteora position was found for this wallet and pool");
      }

      const rebalanceResult = await orchestrator.execute({
        cmdType: CommandType.REBALANCE,
        protocol: PoolProtocol.METEORA_DLMM,
        poolId: poolAddress,
        wallet: user.publicKey,
        positionInfo,
        tickLower: positionRange.lowerBinId,
        tickUpper: positionRange.upperBinId,
        amountA: Number(amounts.totalXAmount.toString()),
        amountB: Number(amounts.totalYAmount.toString()),
        inputMint: tokenXMint,
        outputMint: tokenYMint,
        amountIn: Number(amounts.totalXAmount.toString()),
        slippageBps: intent.slippageBps,
        priorityFeeMicrolamports: intent.priorityFeeMicroLamports,
        computeUnits: 650_000,
      });

      if (!rebalanceResult.success) {
        return unsupportedExecution(intent, rebalanceResult.error ?? "Failed to rebalance Meteora position");
      }

      return mapOrchestratorResult(intent, rebalanceResult, intent.amountUsd, "Live Meteora rebalance submitted");
    }

    if (intent.action === "ADD_LIQUIDITY") {
      if (!existingPosition) {
        const openResult = await orchestrator.execute({
          cmdType: CommandType.OPEN_POSITION,
          protocol: PoolProtocol.METEORA_DLMM,
          poolId: poolAddress,
          wallet: user.publicKey,
          positionInfo,
          tickLower: positionRange.lowerBinId,
          tickUpper: positionRange.upperBinId,
          amountA: Number(amounts.totalXAmount.toString()),
          amountB: Number(amounts.totalYAmount.toString()),
          slippageBps: intent.slippageBps,
          priorityFeeMicrolamports: intent.priorityFeeMicroLamports,
          computeUnits: 450_000,
        });

        if (!openResult.success) {
      return unsupportedExecution(intent, openResult.error ?? "Failed to open Meteora position");
        }
      }

      const addResult = await orchestrator.execute({
        cmdType: CommandType.ADD_LIQUIDITY,
        protocol: PoolProtocol.METEORA_DLMM,
        poolId: poolAddress,
        wallet: user.publicKey,
        positionInfo,
        tickLower: positionRange.lowerBinId,
        tickUpper: positionRange.upperBinId,
        amountA: Number(amounts.totalXAmount.toString()),
        amountB: Number(amounts.totalYAmount.toString()),
        slippageBps: intent.slippageBps,
        priorityFeeMicrolamports: intent.priorityFeeMicroLamports,
        computeUnits: 450_000,
      });

      if (!addResult.success) {
        return unsupportedExecution(intent, addResult.error ?? "Failed to add Meteora liquidity");
      }

      return mapOrchestratorResult(intent, addResult, intent.amountUsd, existingPosition ? "Live Meteora add liquidity submitted to an existing position" : "Live Meteora add liquidity submitted to a new position");
    }

    if (!existingPosition) {
      return unsupportedExecution(intent, "No live Meteora position was found for this wallet and pool");
    }

    const removeResult = await orchestrator.execute({
      cmdType: CommandType.REMOVE_LIQUIDITY,
      protocol: PoolProtocol.METEORA_DLMM,
      poolId: poolAddress,
      wallet: user.publicKey,
      positionInfo,
      tickLower: positionRange.lowerBinId,
      tickUpper: positionRange.upperBinId,
      amountA: Number(amounts.totalXAmount.toString()),
      amountB: Number(amounts.totalYAmount.toString()),
      slippageBps: intent.slippageBps,
      priorityFeeMicrolamports: intent.priorityFeeMicroLamports,
      computeUnits: 450_000,
    });

    if (!removeResult.success) {
      return unsupportedExecution(intent, removeResult.error ?? "Failed to remove Meteora liquidity");
    }

    return mapOrchestratorResult(intent, removeResult, intent.amountUsd, "Live Meteora remove liquidity submitted");
  }

  private async getOrchestrator() {
    if (!this.orchestrator) {
      const connection = new Connection(this.rpcUrl, "confirmed");
      const keypair = loadKeypair(this.secretKey);
      this.orchestrator = new ExecutionOrchestrator(connection, keypair, 3, true);
    }
    return this.orchestrator;
  }
}

function buildSwapCommand(intent: TradeIntent, wallet: PublicKey): ExecutionCommand {
  return {
    cmdType: CommandType.SWAP,
    protocol: PoolProtocol.METEORA_DLMM,
    poolId: parsePublicKey(intent.poolAddress, "BOT intent poolAddress"),
    wallet,
    positionInfo: {
      positionNftMint: wallet,
      positionNftAccount: wallet,
      extra: {},
    },
    inputMint: toMint(intent.symbolIn ?? "SOL"),
    outputMint: toMint(intent.symbolOut ?? "USDC"),
    amountIn: Math.max(1, Math.round(intent.amountUsd * 1_000_000)),
    slippageBps: intent.slippageBps,
    priorityFeeMicrolamports: intent.priorityFeeMicroLamports,
    computeUnits: 400_000,
  };
}

async function buildPositionInfo(params: {
  connection: Connection;
  user: Keypair;
  poolAddress: PublicKey;
  tokenXMint: PublicKey;
  tokenYMint: PublicKey;
  lowerBinId: number;
  upperBinId: number;
  positionPubkey: PublicKey;
  meteora: typeof import("@meteora-ag/dlmm");
}): Promise<PositionInfo> {
  const [binArrayBitmap, binArrayKeys, reserveX, reserveY] = await Promise.all([
    Promise.resolve(params.meteora.deriveBinArrayBitmapExtension(params.poolAddress, METEORA_DLMM_PROGRAM)[0]),
    Promise.resolve(params.meteora.getBinArrayKeysCoverage(
      new BN(params.lowerBinId),
      new BN(params.upperBinId),
      params.poolAddress,
      METEORA_DLMM_PROGRAM,
    )),
    Promise.resolve(params.meteora.deriveReserve(params.tokenXMint, params.poolAddress, METEORA_DLMM_PROGRAM)[0]),
    Promise.resolve(params.meteora.deriveReserve(params.tokenYMint, params.poolAddress, METEORA_DLMM_PROGRAM)[0]),
  ]);

  const [tokenAccountA, tokenAccountB] = [
    deriveAssociatedTokenAddress(params.user.publicKey, params.tokenXMint),
    deriveAssociatedTokenAddress(params.user.publicKey, params.tokenYMint),
  ];

  return {
    positionNftMint: params.positionPubkey,
    positionNftAccount: params.positionPubkey,
    positionPubkey: params.positionPubkey,
    tickLowerIndex: params.lowerBinId,
    tickUpperIndex: params.upperBinId,
    extra: {
      token_account_a: tokenAccountA,
      token_account_b: tokenAccountB,
      mint_a: params.tokenXMint,
      mint_b: params.tokenYMint,
      bin_array_bitmap: binArrayBitmap,
      bin_array_lower: binArrayKeys[0],
      bin_array_upper: binArrayKeys[binArrayKeys.length - 1],
      reserve_x: reserveX,
      reserve_y: reserveY,
    },
  };
}

function selectPositionForAction(
  positions: Array<{ publicKey: PublicKey; positionData: { totalXAmount: string; totalYAmount: string; lowerBinId?: number; upperBinId?: number } }>,
  activeBinId: number,
  requireLiquidity: boolean,
  helpers: { getPositionLowerUpperBinIdWithLiquidity: (position: { totalXAmount: string; totalYAmount: string; lowerBinId?: number; upperBinId?: number }) => { lowerBinId: number; upperBinId: number } | null },
) {
  const scored = positions
    .map((position) => {
      const range = getPositionRange(position, helpers);
      const hasLiquidity = positionNotional(position) > 0n;
      if (requireLiquidity && !hasLiquidity) return null;
      return {
        position,
        activeCoverage: range ? (range.lowerBinId <= activeBinId && activeBinId <= range.upperBinId ? 1 : 0) : 0,
        notional: positionNotional(position),
      };
    })
    .filter((entry): entry is { position: { publicKey: PublicKey; positionData: { totalXAmount: string; totalYAmount: string; lowerBinId?: number; upperBinId?: number } }; activeCoverage: number; notional: bigint } => entry !== null);

  if (scored.length === 0) return null;

  scored.sort((a, b) => {
    if (a.activeCoverage !== b.activeCoverage) return b.activeCoverage - a.activeCoverage;
    if (a.notional === b.notional) return 0;
    return a.notional > b.notional ? -1 : 1;
  });

  return scored[0]?.position ?? null;
}

function getPositionRange(
  position: { positionData: { totalXAmount: string; totalYAmount: string; lowerBinId?: number; upperBinId?: number } },
  helpers: { getPositionLowerUpperBinIdWithLiquidity: (position: { totalXAmount: string; totalYAmount: string; lowerBinId?: number; upperBinId?: number }) => { lowerBinId: number; upperBinId: number } | null },
) {
  const range = helpers.getPositionLowerUpperBinIdWithLiquidity(position.positionData);
  if (range) {
    return range;
  }

  if (typeof position.positionData.lowerBinId === "number" && typeof position.positionData.upperBinId === "number") {
    return {
      lowerBinId: position.positionData.lowerBinId,
      upperBinId: position.positionData.upperBinId,
    };
  }

  return null;
}

function positionNotional(position: { positionData: { totalXAmount: string; totalYAmount: string } }) {
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

function deriveAssociatedTokenAddress(owner: PublicKey, mint: PublicKey) {
  return PublicKey.findProgramAddressSync([
    owner.toBuffer(),
    new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
    mint.toBuffer(),
  ], new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRX"))[0];
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

function derivePositionPda(
  lbPair: PublicKey,
  owner: PublicKey,
  lowerBinId: number,
  width: number,
) {
  return derive_position_pda(lbPair, owner, lowerBinId, width)[0];
}

function toMint(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (normalized === "SOL") return new PublicKey("So11111111111111111111111111111111111111112");
  if (normalized === "USDC") return new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  return parsePublicKey(symbol, "Token mint");
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

function mapOrchestratorResult(intent: TradeIntent, result: { success: boolean; signature?: string; error?: string }, filledUsd: number, reason: string): ExecutionResult {
  return {
    intentId: intent.id,
    status: result.success ? "filled" : "failed",
    txSignature: result.signature,
    filledUsd: round2(filledUsd),
    feesUsd: round2(Math.max(0.05, intent.amountUsd * 0.0015)),
    slippageUsd: round2(intent.amountUsd * (intent.slippageBps / 10_000)),
    executedAt: new Date().toISOString(),
    reason: result.success ? reason : result.error ?? reason,
  };
}

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
    const data = (payload?.data ?? payload) as Record<string, { usdPrice?: number; price?: number }>;
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

function defaultHalfWidth(width: number) {
  return Math.floor((width - 1) / 2);
}

function defaultUpperOffset(width: number) {
  return width - 1 - defaultHalfWidth(width);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function jupiterHeaders(apiKey?: string, contentType = false) {
  const headers: Record<string, string> = contentType
    ? { "content-type": "application/json", Accept: "application/json" }
    : { Accept: "application/json" };

  if (apiKey) headers["x-api-key"] = apiKey;
  return headers;
}
