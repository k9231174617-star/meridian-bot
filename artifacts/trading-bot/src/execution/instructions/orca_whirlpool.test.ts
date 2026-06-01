import { strict as assert } from "node:assert";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import {
  build_close_position_orca_ix,
  build_collect_fees_orca_ix,
  build_decrease_liquidity_orca_ix,
  build_increase_liquidity_orca_ix,
  build_open_position_orca_ix,
  derive_oracle,
  derive_position,
  derive_tick_array,
} from "./orca_whirlpool.js";
import { ORCA_WHIRLPOOL_PROGRAM, OrcaDiscriminators } from "../protocol-ids.js";

const funder = Keypair.generate().publicKey;
const owner = Keypair.generate().publicKey;
const whirlpool = Keypair.generate().publicKey;
const positionMint = Keypair.generate().publicKey;
const positionTokenAccount = Keypair.generate().publicKey;
const tokenOwnerA = Keypair.generate().publicKey;
const tokenOwnerB = Keypair.generate().publicKey;
const tokenVaultA = Keypair.generate().publicKey;
const tokenVaultB = Keypair.generate().publicKey;
const tickArrayLower = Keypair.generate().publicKey;
const tickArrayUpper = Keypair.generate().publicKey;

test("orca whirlpool builders encode discriminators", () => {
  const open = build_open_position_orca_ix({
    funder,
    owner,
    whirlpool,
    position_mint: positionMint,
    position_token_account: positionTokenAccount,
    tick_lower: 0,
    tick_upper: 64,
    tick_spacing: 1,
    with_metadata: true,
  });

  assert.equal(open.programId.toBase58(), ORCA_WHIRLPOOL_PROGRAM.toBase58());
  assert.deepEqual(open.data.subarray(0, 8), OrcaDiscriminators.OPEN_POSITION_WITH_METADATA);
  assert.ok(open.keys.length > 10);

  const increase = build_increase_liquidity_orca_ix({
    whirlpool,
    position: derive_position(positionMint)[0],
    position_token_account: positionTokenAccount,
    token_owner_account_a: tokenOwnerA,
    token_owner_account_b: tokenOwnerB,
    token_vault_a: tokenVaultA,
    token_vault_b: tokenVaultB,
    tick_array_lower: tickArrayLower,
    tick_array_upper: tickArrayUpper,
    position_authority: owner,
    liquidity_amount: 1_000,
    token_max_a: 500,
    token_max_b: 500,
  });

  assert.deepEqual(increase.data.subarray(0, 8), OrcaDiscriminators.INCREASE_LIQUIDITY);

  const decrease = build_decrease_liquidity_orca_ix({
    whirlpool,
    position: derive_position(positionMint)[0],
    position_token_account: positionTokenAccount,
    token_owner_account_a: tokenOwnerA,
    token_owner_account_b: tokenOwnerB,
    token_vault_a: tokenVaultA,
    token_vault_b: tokenVaultB,
    tick_array_lower: tickArrayLower,
    tick_array_upper: tickArrayUpper,
    position_authority: owner,
    liquidity_amount: 1_000,
    token_min_a: 100,
    token_min_b: 100,
  });

  assert.deepEqual(decrease.data.subarray(0, 8), OrcaDiscriminators.DECREASE_LIQUIDITY);

  const collect = build_collect_fees_orca_ix({
    whirlpool,
    position: derive_position(positionMint)[0],
    position_token_account: positionTokenAccount,
    token_owner_account_a: tokenOwnerA,
    token_vault_a: tokenVaultA,
    token_owner_account_b: tokenOwnerB,
    token_vault_b: tokenVaultB,
    position_authority: owner,
  });

  assert.deepEqual(collect.data, OrcaDiscriminators.COLLECT_FEES);

  const close = build_close_position_orca_ix({
    position_authority: owner,
    receiver: funder,
    position: derive_position(positionMint)[0],
    position_mint: positionMint,
    position_token_account: positionTokenAccount,
  });

  assert.deepEqual(close.data, OrcaDiscriminators.CLOSE_POSITION);
  assert.equal(derive_tick_array(whirlpool, 0)[0].toBase58().length > 0, true);
  assert.equal(derive_oracle(whirlpool)[0].toBase58().length > 0, true);
});
