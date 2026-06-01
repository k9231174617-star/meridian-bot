import { AccountMeta, PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  RAYDIUM_CPMM_PROGRAM,
  RaydiumCpmmDiscriminators,
  RaydiumCpmmSeeds,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from '../protocol-ids.js';

function pda(seeds: Buffer[]) {
  return PublicKey.findProgramAddressSync(seeds, RAYDIUM_CPMM_PROGRAM);
}

export function derive_pool_auth(_poolState: PublicKey) {
  return pda([RaydiumCpmmSeeds.POOL_AUTH]);
}

export function derive_lp_mint(poolState: PublicKey) {
  return pda([RaydiumCpmmSeeds.LP_MINT, poolState.toBuffer()]);
}

export function build_swap_base_input_cpmm_ix(params: {
  payer: PublicKey;
  authority: PublicKey;
  amm_config: PublicKey;
  pool_state: PublicKey;
  input_token_account: PublicKey;
  output_token_account: PublicKey;
  input_vault: PublicKey;
  output_vault: PublicKey;
  input_token_mint: PublicKey;
  output_token_mint: PublicKey;
  observation_state: PublicKey;
  amount_in: number;
  minimum_amount_out: number;
}) {
  const data = Buffer.concat([
    RaydiumCpmmDiscriminators.SWAP_BASE_INPUT,
    u64(params.amount_in),
    u64(params.minimum_amount_out),
  ]);

  return new TransactionInstruction({
    programId: RAYDIUM_CPMM_PROGRAM,
    keys: [
      am(params.payer, true, true),
      am(params.authority, false, false),
      am(params.amm_config, false, false),
      am(params.pool_state, false, true),
      am(params.input_token_account, false, true),
      am(params.output_token_account, false, true),
      am(params.input_vault, false, true),
      am(params.output_vault, false, true),
      am(params.input_token_mint, false, false),
      am(params.output_token_mint, false, false),
      am(TOKEN_PROGRAM, false, false),
      am(TOKEN_2022_PROGRAM, false, false),
      am(params.observation_state, false, true),
    ],
    data,
  });
}

export function build_add_liquidity_cpmm_ix(params: {
  owner: PublicKey;
  authority: PublicKey;
  pool_state: PublicKey;
  owner_lp_token: PublicKey;
  token_0_account: PublicKey;
  token_1_account: PublicKey;
  token_0_vault: PublicKey;
  token_1_vault: PublicKey;
  token_0_mint: PublicKey;
  token_1_mint: PublicKey;
  lp_mint: PublicKey;
  lp_amount: number;
  max_amount_0: number;
  max_amount_1: number;
}) {
  const data = Buffer.concat([
    RaydiumCpmmDiscriminators.ADD_LIQUIDITY,
    u64(params.lp_amount),
    u64(params.max_amount_0),
    u64(params.max_amount_1),
  ]);

  return new TransactionInstruction({
    programId: RAYDIUM_CPMM_PROGRAM,
    keys: [
      am(params.owner, true, true),
      am(params.authority, false, false),
      am(params.pool_state, false, true),
      am(params.owner_lp_token, false, true),
      am(params.token_0_account, false, true),
      am(params.token_1_account, false, true),
      am(params.token_0_vault, false, true),
      am(params.token_1_vault, false, true),
      am(TOKEN_PROGRAM, false, false),
      am(TOKEN_2022_PROGRAM, false, false),
      am(params.lp_mint, false, true),
      am(params.token_0_mint, false, false),
      am(params.token_1_mint, false, false),
    ],
    data,
  });
}

export function build_remove_liquidity_cpmm_ix(params: {
  owner: PublicKey;
  authority: PublicKey;
  pool_state: PublicKey;
  owner_lp_token: PublicKey;
  token_0_account: PublicKey;
  token_1_account: PublicKey;
  token_0_vault: PublicKey;
  token_1_vault: PublicKey;
  token_0_mint: PublicKey;
  token_1_mint: PublicKey;
  lp_mint: PublicKey;
  lp_amount: number;
  min_amount_0: number;
  min_amount_1: number;
}) {
  const data = Buffer.concat([
    RaydiumCpmmDiscriminators.REMOVE_LIQUIDITY,
    u64(params.lp_amount),
    u64(params.min_amount_0),
    u64(params.min_amount_1),
  ]);

  return new TransactionInstruction({
    programId: RAYDIUM_CPMM_PROGRAM,
    keys: [
      am(params.owner, true, true),
      am(params.authority, false, false),
      am(params.pool_state, false, true),
      am(params.owner_lp_token, false, true),
      am(params.token_0_account, false, true),
      am(params.token_1_account, false, true),
      am(params.token_0_vault, false, true),
      am(params.token_1_vault, false, true),
      am(TOKEN_PROGRAM, false, false),
      am(TOKEN_2022_PROGRAM, false, false),
      am(params.lp_mint, false, true),
      am(params.token_0_mint, false, false),
      am(params.token_1_mint, false, false),
    ],
    data,
  });
}

function am(pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta {
  return { pubkey, isSigner, isWritable };
}

function u64(value: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(Math.max(0, Math.floor(value))), 0);
  return buf;
}
