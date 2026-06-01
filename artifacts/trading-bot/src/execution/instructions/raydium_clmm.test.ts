import { strict as assert } from "node:assert";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  build_close_position_clmm_ix,
  build_decrease_liquidity_clmm_ix,
  build_increase_liquidity_clmm_ix,
  build_open_position_clmm_ix,
  derive_personal_position,
  derive_protocol_position,
} from "./raydium_clmm.js";
import { RAYDIUM_CLMM_PROGRAM, RaydiumClmmDiscriminators } from "../protocol-ids.js";

const payer = Keypair.generate().publicKey;
const poolState = Keypair.generate().publicKey;
const positionMint = Keypair.generate().publicKey;
const positionAccount = Keypair.generate().publicKey;
const tickArrayLower = Keypair.generate().publicKey;
const tickArrayUpper = Keypair.generate().publicKey;
const tokenAccountA = Keypair.generate().publicKey;
const tokenAccountB = Keypair.generate().publicKey;
const tokenVault0 = Keypair.generate().publicKey;
const tokenVault1 = Keypair.generate().publicKey;
const recipientA = Keypair.generate().publicKey;
const recipientB = Keypair.generate().publicKey;

test("raydium clmm open/increase/decrease/close builders encode discriminators", () => {
  const open = build_open_position_clmm_ix({
    payer,
    pool_state: poolState,
    position_nft_mint: positionMint,
    position_nft_account: positionAccount,
    tick_lower: 0,
    tick_upper: 64,
    tick_spacing: 1,
    liquidity: 1000,
    amount_a_max: 250,
    amount_b_max: 500,
    token_account_a: tokenAccountA,
    token_account_b: tokenAccountB,
    token_vault_0: tokenVault0,
    token_vault_1: tokenVault1,
    tick_array_lower: tickArrayLower,
    tick_array_upper: tickArrayUpper,
    with_metadata: true,
  });

  assert.equal(open.programId.toBase58(), RAYDIUM_CLMM_PROGRAM.toBase58());
  assert.equal(open.keys.length, 16);
  assert.deepEqual(open.data.subarray(0, 8), RaydiumClmmDiscriminators.OPEN_POSITION);
  assert.equal(open.data.readInt32LE(8), 0);
  assert.equal(open.data.readInt32LE(12), 64);
  assert.equal(open.data.at(-1), 1);

  const increase = build_increase_liquidity_clmm_ix({
    payer,
    pool_state: poolState,
    position_nft_account: positionAccount,
    position_nft_mint: positionMint,
    tick_array_lower: tickArrayLower,
    tick_array_upper: tickArrayUpper,
    token_account_a: tokenAccountA,
    token_account_b: tokenAccountB,
    token_vault_0: tokenVault0,
    token_vault_1: tokenVault1,
    tick_lower: 0,
    tick_upper: 64,
    liquidity: 1000,
    amount_a_max: 250,
    amount_b_max: 500,
  });

  assert.deepEqual(increase.data.subarray(0, 8), RaydiumClmmDiscriminators.INCREASE_LIQUIDITY);

  const decrease = build_decrease_liquidity_clmm_ix({
    payer,
    pool_state: poolState,
    position_nft_account: positionAccount,
    position_nft_mint: positionMint,
    tick_array_lower: tickArrayLower,
    tick_array_upper: tickArrayUpper,
    token_account_a: tokenAccountA,
    token_account_b: tokenAccountB,
    token_vault_0: tokenVault0,
    token_vault_1: tokenVault1,
    recipient_account_a: recipientA,
    recipient_account_b: recipientB,
    tick_lower: 0,
    tick_upper: 64,
    liquidity: 1000,
    amount_a_min: 100,
    amount_b_min: 200,
  });

  assert.deepEqual(decrease.data.subarray(0, 8), RaydiumClmmDiscriminators.DECREASE_LIQUIDITY);

  const close = build_close_position_clmm_ix({
    owner: payer,
    position_nft_mint: positionMint,
    position_nft_account: positionAccount,
    recipient: recipientA,
  });

  assert.deepEqual(close.data, RaydiumClmmDiscriminators.CLOSE_POSITION);
  assert.equal(derive_personal_position(positionMint)[0].toBase58().length > 0, true);
  assert.equal(derive_protocol_position(poolState, 0, 64)[0].toBase58().length > 0, true);
});
