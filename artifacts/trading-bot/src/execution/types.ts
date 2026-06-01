import type { PublicKey } from '@solana/web3.js';

export enum PoolProtocol {
  RAYDIUM_CLMM = 'RAYDIUM_CLMM',
  RAYDIUM_CPMM = 'RAYDIUM_CPMM',
  ORCA_WHIRLPOOL = 'ORCA_WHIRLPOOL',
  METEORA_DLMM = 'METEORA_DLMM',
}

export enum CommandType {
  SWAP = 'SWAP',
  OPEN_POSITION = 'OPEN_POSITION',
  CLOSE_POSITION = 'CLOSE_POSITION',
  ADD_LIQUIDITY = 'ADD_LIQUIDITY',
  REMOVE_LIQUIDITY = 'REMOVE_LIQUIDITY',
  COLLECT_FEES = 'COLLECT_FEES',
  REBALANCE = 'REBALANCE',
}

export type PositionInfo = {
  positionNftMint: PublicKey;
  positionNftAccount: PublicKey;
  positionPubkey?: PublicKey;
  tickLowerIndex?: number;
  tickUpperIndex?: number;
  liquidity?: number;
  extra: Record<string, PublicKey | string | number | bigint | undefined>;
};

export type PoolInfo = {
  poolId: PublicKey;
  protocol: PoolProtocol;
  tokenAMint?: PublicKey;
  tokenBMint?: PublicKey;
  tickSpacing?: number;
  liquidity?: number;
  extra: Record<string, PublicKey | string | number | bigint | undefined>;
};

export type ExecutionCommand = {
  cmdType: CommandType;
  protocol: PoolProtocol;
  poolId: PublicKey;
  wallet: PublicKey;
  positionInfo: PositionInfo;
  tickLower?: number;
  tickUpper?: number;
  amountA?: number;
  amountB?: number;
  amountIn?: number;
  inputMint?: PublicKey;
  outputMint?: PublicKey;
  slippageBps: number;
  priorityFeeMicrolamports: number;
  computeUnits: number;
};

export type ExecutionResult = {
  success: boolean;
  signature?: string;
  feePaid?: number;
  amountOut?: number;
  priceImpactBps?: number;
  error?: string;
};
