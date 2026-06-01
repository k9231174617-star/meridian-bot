import { AccountMeta, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  METAPLEX_METADATA_PROGRAM,
  ORCA_WHIRLPOOL_PROGRAM,
  OrcaDiscriminators,
  OrcaSeeds,
  SYSVAR_RENT,
  TOKEN_PROGRAM,
} from '../protocol-ids.js';
import { invalid_tick_range } from '../errors.js';

function pda(seeds: Buffer[]) {
  return PublicKey.findProgramAddressSync(seeds, ORCA_WHIRLPOOL_PROGRAM);
}

export function derive_position(positionMint: PublicKey) {
  return pda([OrcaSeeds.POSITION, positionMint.toBuffer()]);
}

export function derive_tick_array(whirlpool: PublicKey, startTick: number) {
  return pda([OrcaSeeds.TICK_ARRAY, whirlpool.toBuffer(), Buffer.from(String(startTick))]);
}

export function derive_oracle(whirlpool: PublicKey) {
  return pda([OrcaSeeds.ORACLE, whirlpool.toBuffer()]);
}

function validateTicks(tickLower: number, tickUpper: number, tickSpacing: number) {
  if (tickLower >= tickUpper) throw invalid_tick_range(tickLower, tickUpper, tickSpacing);
  if (tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0) throw invalid_tick_range(tickLower, tickUpper, tickSpacing);
}

export function build_open_position_orca_ix(params: {
  funder: PublicKey;
  owner: PublicKey;
  whirlpool: PublicKey;
  position_mint: PublicKey;
  position_token_account: PublicKey;
  tick_lower: number;
  tick_upper: number;
  tick_spacing: number;
  with_metadata?: boolean;
}) {
  validateTicks(params.tick_lower, params.tick_upper, params.tick_spacing);
  const [position] = derive_position(params.position_mint);
  const discriminator = params.with_metadata ? OrcaDiscriminators.OPEN_POSITION_WITH_METADATA : OrcaDiscriminators.OPEN_POSITION;
  const data = Buffer.concat([discriminator, int32(params.tick_lower), int32(params.tick_upper)]);
  const keys: AccountMeta[] = [
    am(params.funder, true, true),
    am(params.owner, false, false),
    am(position, false, true),
    am(params.position_mint, true, true),
    am(params.position_token_account, false, true),
    am(params.whirlpool, false, false),
    am(TOKEN_PROGRAM, false, false),
    am(SystemProgram.programId, false, false),
    am(SYSVAR_RENT, false, false),
    am(ASSOCIATED_TOKEN_PROGRAM, false, false),
  ];

  if (params.with_metadata) {
    const [positionMetadata] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METAPLEX_METADATA_PROGRAM.toBuffer(), params.position_mint.toBuffer()],
      METAPLEX_METADATA_PROGRAM,
    );
    keys.push(am(positionMetadata, false, true), am(METAPLEX_METADATA_PROGRAM, false, false));
  }

  return new TransactionInstruction({ programId: ORCA_WHIRLPOOL_PROGRAM, keys, data });
}

export function build_increase_liquidity_orca_ix(params: {
  whirlpool: PublicKey;
  position: PublicKey;
  position_token_account: PublicKey;
  token_owner_account_a: PublicKey;
  token_owner_account_b: PublicKey;
  token_vault_a: PublicKey;
  token_vault_b: PublicKey;
  tick_array_lower: PublicKey;
  tick_array_upper: PublicKey;
  position_authority: PublicKey;
  liquidity_amount: number;
  token_max_a: number;
  token_max_b: number;
}) {
  const data = Buffer.concat([
    OrcaDiscriminators.INCREASE_LIQUIDITY,
    u64(params.liquidity_amount),
    u64(params.token_max_a),
    u64(params.token_max_b),
  ]);

  return new TransactionInstruction({
    programId: ORCA_WHIRLPOOL_PROGRAM,
    keys: [
      am(params.whirlpool, false, true),
      am(TOKEN_PROGRAM, false, false),
      am(params.position_authority, true, false),
      am(params.position, false, true),
      am(params.position_token_account, false, false),
      am(params.token_owner_account_a, false, true),
      am(params.token_owner_account_b, false, true),
      am(params.token_vault_a, false, true),
      am(params.token_vault_b, false, true),
      am(params.tick_array_lower, false, true),
      am(params.tick_array_upper, false, true),
    ],
    data,
  });
}

export function build_decrease_liquidity_orca_ix(params: {
  whirlpool: PublicKey;
  position: PublicKey;
  position_token_account: PublicKey;
  token_owner_account_a: PublicKey;
  token_owner_account_b: PublicKey;
  token_vault_a: PublicKey;
  token_vault_b: PublicKey;
  tick_array_lower: PublicKey;
  tick_array_upper: PublicKey;
  position_authority: PublicKey;
  liquidity_amount: number;
  token_min_a: number;
  token_min_b: number;
}) {
  const data = Buffer.concat([
    OrcaDiscriminators.DECREASE_LIQUIDITY,
    u64(params.liquidity_amount),
    u64(params.token_min_a),
    u64(params.token_min_b),
  ]);

  return new TransactionInstruction({
    programId: ORCA_WHIRLPOOL_PROGRAM,
    keys: [
      am(params.whirlpool, false, true),
      am(TOKEN_PROGRAM, false, false),
      am(params.position_authority, true, false),
      am(params.position, false, true),
      am(params.position_token_account, false, false),
      am(params.token_owner_account_a, false, true),
      am(params.token_owner_account_b, false, true),
      am(params.token_vault_a, false, true),
      am(params.token_vault_b, false, true),
      am(params.tick_array_lower, false, true),
      am(params.tick_array_upper, false, true),
    ],
    data,
  });
}

export function build_collect_fees_orca_ix(params: {
  whirlpool: PublicKey;
  position: PublicKey;
  position_token_account: PublicKey;
  token_owner_account_a: PublicKey;
  token_vault_a: PublicKey;
  token_owner_account_b: PublicKey;
  token_vault_b: PublicKey;
  position_authority: PublicKey;
}) {
  return new TransactionInstruction({
    programId: ORCA_WHIRLPOOL_PROGRAM,
    keys: [
      am(params.whirlpool, false, true),
      am(params.position_authority, true, false),
      am(params.position, false, true),
      am(params.position_token_account, false, false),
      am(params.token_owner_account_a, false, true),
      am(params.token_vault_a, false, true),
      am(params.token_owner_account_b, false, true),
      am(params.token_vault_b, false, true),
      am(TOKEN_PROGRAM, false, false),
    ],
    data: OrcaDiscriminators.COLLECT_FEES,
  });
}

export function build_close_position_orca_ix(params: {
  position_authority: PublicKey;
  receiver: PublicKey;
  position: PublicKey;
  position_mint: PublicKey;
  position_token_account: PublicKey;
}) {
  return new TransactionInstruction({
    programId: ORCA_WHIRLPOOL_PROGRAM,
    keys: [
      am(params.position_authority, true, false),
      am(params.receiver, false, true),
      am(params.position, false, true),
      am(params.position_mint, false, true),
      am(params.position_token_account, false, true),
      am(TOKEN_PROGRAM, false, false),
    ],
    data: OrcaDiscriminators.CLOSE_POSITION,
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
