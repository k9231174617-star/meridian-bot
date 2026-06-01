import { AccountMeta, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import {
  METEORA_DLMM_PROGRAM,
  MeteoraDiscriminators,
  MeteoraSeeds,
  SYSVAR_RENT,
  TOKEN_PROGRAM,
} from '../protocol-ids.js';

function pda(seeds: Buffer[]) {
  return PublicKey.findProgramAddressSync(seeds, METEORA_DLMM_PROGRAM);
}

export function derive_position_pda(lbPair: PublicKey, owner: PublicKey, lowerBinId: number, width: number) {
  return pda([MeteoraSeeds.POSITION_V2, lbPair.toBuffer(), owner.toBuffer(), int32(lowerBinId), int32(width)]);
}

export function derive_bin_array(lbPair: PublicKey, binArrayIndex: number) {
  return pda([MeteoraSeeds.BIN_ARRAY, lbPair.toBuffer(), int64(binArrayIndex)]);
}

export function build_initialize_position_meteora_ix(params: {
  payer: PublicKey;
  owner: PublicKey;
  lb_pair: PublicKey;
  lower_bin_id: number;
  width: number;
}) {
  const [position] = derive_position_pda(params.lb_pair, params.owner, params.lower_bin_id, params.width);
  const data = Buffer.concat([
    MeteoraDiscriminators.INITIALIZE_POSITION,
    int32(params.lower_bin_id),
    int32(params.width),
  ]);

  return new TransactionInstruction({
    programId: METEORA_DLMM_PROGRAM,
    keys: [
      am(params.payer, true, true),
      am(position, false, true),
      am(params.lb_pair, false, false),
      am(params.owner, true, false),
      am(SystemProgram.programId, false, false),
      am(SYSVAR_RENT, false, false),
    ],
    data,
  });
}

export function build_add_liquidity_meteora_ix(params: {
  position: PublicKey;
  lb_pair: PublicKey;
  bin_array_bitmap: PublicKey;
  bin_array_lower: PublicKey;
  bin_array_upper: PublicKey;
  user_token_x: PublicKey;
  user_token_y: PublicKey;
  reserve_x: PublicKey;
  reserve_y: PublicKey;
  token_x_mint: PublicKey;
  token_y_mint: PublicKey;
  sender: PublicKey;
  bin_liquidity: Array<[number, number, number]>;
  active_id: number;
  max_active_bin_slippage?: number;
}) {
  let binData = Buffer.alloc(4);
  binData.writeUInt32LE(params.bin_liquidity.length, 0);
  for (const [binId, xAmount, yAmount] of params.bin_liquidity) {
    binData = Buffer.concat([binData, int32(binId), u64(xAmount), u64(yAmount)]);
  }

  const data = Buffer.concat([
    MeteoraDiscriminators.ADD_LIQUIDITY,
    int32(params.active_id),
    int16(params.max_active_bin_slippage ?? 3),
    binData,
  ]);

  return new TransactionInstruction({
    programId: METEORA_DLMM_PROGRAM,
    keys: [
      am(params.position, false, true),
      am(params.lb_pair, false, true),
      am(params.bin_array_bitmap, false, true),
      am(params.bin_array_lower, false, true),
      am(params.bin_array_upper, false, true),
      am(params.user_token_x, false, true),
      am(params.user_token_y, false, true),
      am(params.reserve_x, false, true),
      am(params.reserve_y, false, true),
      am(params.token_x_mint, false, false),
      am(params.token_y_mint, false, false),
      am(TOKEN_PROGRAM, false, false),
      am(params.sender, true, true),
    ],
    data,
  });
}

export function build_remove_liquidity_meteora_ix(params: {
  position: PublicKey;
  lb_pair: PublicKey;
  bin_array_bitmap: PublicKey;
  bin_array_lower: PublicKey;
  bin_array_upper: PublicKey;
  user_token_x: PublicKey;
  user_token_y: PublicKey;
  reserve_x: PublicKey;
  reserve_y: PublicKey;
  token_x_mint: PublicKey;
  token_y_mint: PublicKey;
  sender: PublicKey;
  bin_ids: number[];
  bps_to_remove?: number;
}) {
  let binData = Buffer.alloc(4);
  binData.writeUInt32LE(params.bin_ids.length, 0);
  for (const binId of params.bin_ids) {
    binData = Buffer.concat([binData, int32(binId)]);
  }

  const data = Buffer.concat([
    MeteoraDiscriminators.REMOVE_LIQUIDITY,
    int16(params.bps_to_remove ?? 10_000),
    binData,
  ]);

  return new TransactionInstruction({
    programId: METEORA_DLMM_PROGRAM,
    keys: [
      am(params.position, false, true),
      am(params.lb_pair, false, true),
      am(params.bin_array_bitmap, false, true),
      am(params.bin_array_lower, false, true),
      am(params.bin_array_upper, false, true),
      am(params.user_token_x, false, true),
      am(params.user_token_y, false, true),
      am(params.reserve_x, false, true),
      am(params.reserve_y, false, true),
      am(params.token_x_mint, false, false),
      am(params.token_y_mint, false, false),
      am(TOKEN_PROGRAM, false, false),
      am(params.sender, true, true),
    ],
    data,
  });
}

export function build_claim_fee_meteora_ix(params: {
  lb_pair: PublicKey;
  position: PublicKey;
  sender: PublicKey;
  reserve_x: PublicKey;
  reserve_y: PublicKey;
  user_token_x: PublicKey;
  user_token_y: PublicKey;
  token_x_mint: PublicKey;
  token_y_mint: PublicKey;
  bin_array_lower: PublicKey;
  bin_array_upper: PublicKey;
}) {
  return new TransactionInstruction({
    programId: METEORA_DLMM_PROGRAM,
    keys: [
      am(params.lb_pair, false, true),
      am(params.position, false, true),
      am(params.sender, true, true),
      am(params.reserve_x, false, true),
      am(params.reserve_y, false, true),
      am(params.user_token_x, false, true),
      am(params.user_token_y, false, true),
      am(params.token_x_mint, false, false),
      am(params.token_y_mint, false, false),
      am(params.bin_array_lower, false, true),
      am(params.bin_array_upper, false, true),
      am(TOKEN_PROGRAM, false, false),
    ],
    data: MeteoraDiscriminators.CLAIM_FEE,
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

function int16(value: number) {
  const buf = Buffer.alloc(2);
  buf.writeInt16LE(value, 0);
  return buf;
}

function int64(value: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(value), 0);
  return buf;
}

function u64(value: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(Math.max(0, Math.floor(value))), 0);
  return buf;
}
