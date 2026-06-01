import { strict as assert } from "node:assert";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import {
  build_add_liquidity_meteora_ix,
  build_claim_fee_meteora_ix,
  build_initialize_position_meteora_ix,
  build_remove_liquidity_meteora_ix,
  derive_bin_array,
  derive_position_pda,
} from "./meteora_dlmm.js";
import { METEORA_DLMM_PROGRAM, MeteoraDiscriminators } from "../protocol-ids.js";

const payer = Keypair.generate().publicKey;
const owner = Keypair.generate().publicKey;
const lbPair = Keypair.generate().publicKey;
const position = derive_position_pda(lbPair, owner, 0, 16)[0];
const binArrayBitmap = Keypair.generate().publicKey;
const binArrayLower = Keypair.generate().publicKey;
const binArrayUpper = Keypair.generate().publicKey;
const userTokenX = Keypair.generate().publicKey;
const userTokenY = Keypair.generate().publicKey;
const reserveX = Keypair.generate().publicKey;
const reserveY = Keypair.generate().publicKey;
const tokenXMint = Keypair.generate().publicKey;
const tokenYMint = Keypair.generate().publicKey;
const sender = Keypair.generate().publicKey;

test("meteora dlmm builders encode discriminators", () => {
  const init = build_initialize_position_meteora_ix({
    payer,
    owner,
    lb_pair: lbPair,
    lower_bin_id: 0,
    width: 16,
  });

  assert.equal(init.programId.toBase58(), METEORA_DLMM_PROGRAM.toBase58());
  assert.deepEqual(init.data.subarray(0, 8), MeteoraDiscriminators.INITIALIZE_POSITION);
  assert.ok(init.keys.length >= 6);

  const add = build_add_liquidity_meteora_ix({
    position,
    lb_pair: lbPair,
    bin_array_bitmap: binArrayBitmap,
    bin_array_lower: binArrayLower,
    bin_array_upper: binArrayUpper,
    user_token_x: userTokenX,
    user_token_y: userTokenY,
    reserve_x: reserveX,
    reserve_y: reserveY,
    token_x_mint: tokenXMint,
    token_y_mint: tokenYMint,
    sender,
    bin_liquidity: [
      [0, 100, 100],
      [1, 200, 200],
    ],
    active_id: 1,
  });

  assert.deepEqual(add.data.subarray(0, 8), MeteoraDiscriminators.ADD_LIQUIDITY);

  const remove = build_remove_liquidity_meteora_ix({
    position,
    lb_pair: lbPair,
    bin_array_bitmap: binArrayBitmap,
    bin_array_lower: binArrayLower,
    bin_array_upper: binArrayUpper,
    user_token_x: userTokenX,
    user_token_y: userTokenY,
    reserve_x: reserveX,
    reserve_y: reserveY,
    token_x_mint: tokenXMint,
    token_y_mint: tokenYMint,
    sender,
    bin_ids: [0, 1],
    bps_to_remove: 5_000,
  });

  assert.deepEqual(remove.data.subarray(0, 8), MeteoraDiscriminators.REMOVE_LIQUIDITY);

  const claim = build_claim_fee_meteora_ix({
    lb_pair: lbPair,
    position,
    sender,
    reserve_x: reserveX,
    reserve_y: reserveY,
    user_token_x: userTokenX,
    user_token_y: userTokenY,
    token_x_mint: tokenXMint,
    token_y_mint: tokenYMint,
    bin_array_lower: binArrayLower,
    bin_array_upper: binArrayUpper,
  });

  assert.deepEqual(claim.data, MeteoraDiscriminators.CLAIM_FEE);
  assert.equal(derive_bin_array(lbPair, 1)[0].toBase58().length > 0, true);
});
