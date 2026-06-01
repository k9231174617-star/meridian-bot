import { AccountMeta, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  RAYDIUM_CLMM_PROGRAM,
  RaydiumClmmDiscriminators,
  RaydiumClmmSeeds,
  SYSVAR_RENT,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from '../protocol-ids.js';
import { invalid_tick_range } from '../errors.js';

function pda(seeds: Buffer[], programId = RAYDIUM_CLMM_PROGRAM) {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

export function derive_personal_position(positionNftMint: PublicKey) {
  return pda([RaydiumClmmSeeds.PERSONAL_POSITION, positionNftMint.toBuffer()]);
}

export function derive_protocol_position(poolState: PublicKey, tickLower: number, tickUpper: number) {
  return pda([
    RaydiumClmmSeeds.PROTOCOL_POSITION,
    poolState.toBuffer(),
    int32(tickLower),
    int32(tickUpper),
  ]);
}

export function derive_tick_array(poolState: PublicKey, startTickIndex: number) {
  return pda([
    RaydiumClmmSeeds.TICK_ARRAY,
    poolState.toBuffer(),
    Buffer.from(String(startTickIndex)),
  ]);
}

function validateTicks(tickLower: number, tickUpper: number, tickSpacing: number) {
  if (tickLower >= tickUpper) throw invalid_tick_range(tickLower, tickUpper, tickSpacing);
  if (tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0) throw invalid_tick_range(tickLower, tickUpper, tickSpacing);
}

export function build_open_position_clmm_ix(params: {
  payer: PublicKey;
  pool_state: PublicKey;
  position_nft_mint: PublicKey;
  position_nft_account: PublicKey;
  tick_lower: number;
  tick_upper: number;
  tick_spacing: number;
  liquidity: number;
  amount_a_max: number;
  amount_b_max: number;
  token_account_a: PublicKey;
  token_account_b: PublicKey;
  token_vault_0: PublicKey;
  token_vault_1: PublicKey;
  tick_array_lower: PublicKey;
  tick_array_upper: PublicKey;
  with_metadata?: boolean;
}) {
  validateTicks(params.tick_lower, params.tick_upper, params.tick_spacing);
  const [personalPosition] = derive_personal_position(params.position_nft_mint);
  const [protocolPosition] = derive_protocol_position(params.pool_state, params.tick_lower, params.tick_upper);
  const data = Buffer.concat([
    RaydiumClmmDiscriminators.OPEN_POSITION,
    int32(params.tick_lower),
    int32(params.tick_upper),
    u64(params.liquidity),
    u64(params.amount_a_max),
    u64(params.amount_b_max),
    Buffer.from([params.with_metadata ? 1 : 0]),
  ]);

  return new TransactionInstruction({
    programId: RAYDIUM_CLMM_PROGRAM,
    keys: [
      am(params.payer, true, true),
      am(params.position_nft_mint, true, true),
      am(params.position_nft_account, false, true),
      am(params.pool_state, false, true),
      am(protocolPosition, false, true),
      am(personalPosition, false, true),
      am(params.tick_array_lower, false, true),
      am(params.tick_array_upper, false, true),
      am(params.token_account_a, false, true),
      am(params.token_account_b, false, true),
      am(params.token_vault_0, false, true),
      am(params.token_vault_1, false, true),
      am(SYSVAR_RENT, false, false),
      am(SystemProgram.programId, false, false),
      am(TOKEN_PROGRAM, false, false),
      am(ASSOCIATED_TOKEN_PROGRAM, false, false),
    ],
    data,
  });
}

export function build_increase_liquidity_clmm_ix(params: {
  payer: PublicKey;
  pool_state: PublicKey;
  position_nft_account: PublicKey;
  position_nft_mint: PublicKey;
  tick_array_lower: PublicKey;
  tick_array_upper: PublicKey;
  token_account_a: PublicKey;
  token_account_b: PublicKey;
  token_vault_0: PublicKey;
  token_vault_1: PublicKey;
  tick_lower: number;
  tick_upper: number;
  liquidity: number;
  amount_a_max: number;
  amount_b_max: number;
}) {
  const [personalPosition] = derive_personal_position(params.position_nft_mint);
  const [protocolPosition] = derive_protocol_position(params.pool_state, params.tick_lower, params.tick_upper);
  const data = Buffer.concat([
    RaydiumClmmDiscriminators.INCREASE_LIQUIDITY,
    u64(params.liquidity),
    u64(params.amount_a_max),
    u64(params.amount_b_max),
  ]);

  return new TransactionInstruction({
    programId: RAYDIUM_CLMM_PROGRAM,
    keys: [
      am(params.payer, true, true),
      am(params.pool_state, false, true),
      am(protocolPosition, false, true),
      am(personalPosition, false, true),
      am(params.position_nft_account, false, false),
      am(params.tick_array_lower, false, true),
      am(params.tick_array_upper, false, true),
      am(params.token_account_a, false, true),
      am(params.token_account_b, false, true),
      am(params.token_vault_0, false, true),
      am(params.token_vault_1, false, true),
      am(TOKEN_PROGRAM, false, false),
      am(TOKEN_2022_PROGRAM, false, false),
    ],
    data,
  });
}

export function build_decrease_liquidity_clmm_ix(params: {
  payer: PublicKey;
  pool_state: PublicKey;
  position_nft_account: PublicKey;
  position_nft_mint: PublicKey;
  tick_array_lower: PublicKey;
  tick_array_upper: PublicKey;
  token_account_a: PublicKey;
  token_account_b: PublicKey;
  token_vault_0: PublicKey;
  token_vault_1: PublicKey;
  recipient_account_a: PublicKey;
  recipient_account_b: PublicKey;
  tick_lower: number;
  tick_upper: number;
  liquidity: number;
  amount_a_min: number;
  amount_b_min: number;
}) {
  const [personalPosition] = derive_personal_position(params.position_nft_mint);
  const [protocolPosition] = derive_protocol_position(params.pool_state, params.tick_lower, params.tick_upper);
  const data = Buffer.concat([
    RaydiumClmmDiscriminators.DECREASE_LIQUIDITY,
    u64(params.liquidity),
    u64(params.amount_a_min),
    u64(params.amount_b_min),
  ]);

  return new TransactionInstruction({
    programId: RAYDIUM_CLMM_PROGRAM,
    keys: [
      am(params.payer, true, true),
      am(params.pool_state, false, true),
      am(protocolPosition, false, true),
      am(personalPosition, false, true),
      am(params.position_nft_account, false, false),
      am(params.tick_array_lower, false, true),
      am(params.tick_array_upper, false, true),
      am(params.recipient_account_a, false, true),
      am(params.recipient_account_b, false, true),
      am(params.token_vault_0, false, true),
      am(params.token_vault_1, false, true),
      am(TOKEN_PROGRAM, false, false),
      am(TOKEN_2022_PROGRAM, false, false),
    ],
    data,
  });
}

export function build_close_position_clmm_ix(params: {
  owner: PublicKey;
  position_nft_mint: PublicKey;
  position_nft_account: PublicKey;
  recipient: PublicKey;
}) {
  const [personalPosition] = derive_personal_position(params.position_nft_mint);
  return new TransactionInstruction({
    programId: RAYDIUM_CLMM_PROGRAM,
    keys: [
      am(params.owner, true, true),
      am(personalPosition, false, true),
      am(params.position_nft_mint, false, true),
      am(params.position_nft_account, false, true),
      am(params.recipient, false, true),
      am(SystemProgram.programId, false, false),
      am(TOKEN_PROGRAM, false, false),
    ],
    data: RaydiumClmmDiscriminators.CLOSE_POSITION,
  });
}

function am(pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta {
  return { pubkey, isSigner, isWritable };
}

function int32(value: number) {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(value, 0);
  return buf;
}

function u64(value: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(Math.max(0, Math.floor(value))), 0);
  return buf;
}
