import { strict as assert } from "node:assert";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import {
  build_add_liquidity_cpmm_ix,
  build_remove_liquidity_cpmm_ix,
  build_swap_base_input_cpmm_ix,
  derive_lp_mint,
  derive_pool_auth,
} from "./raydium_cpmm.js";
import { RAYDIUM_CPMM_PROGRAM, RaydiumCpmmDiscriminators } from "../protocol-ids.js";

const payer = Keypair.generate().publicKey;
const authority = Keypair.generate().publicKey;
const ammConfig = Keypair.generate().publicKey;
const poolState = Keypair.generate().publicKey;
const inputTokenAccount = Keypair.generate().publicKey;
const outputTokenAccount = Keypair.generate().publicKey;
const inputVault = Keypair.generate().publicKey;
const outputVault = Keypair.generate().publicKey;
const inputMint = Keypair.generate().publicKey;
const outputMint = Keypair.generate().publicKey;
const observationState = Keypair.generate().publicKey;
const ownerLpToken = Keypair.generate().publicKey;
const token0Account = Keypair.generate().publicKey;
const token1Account = Keypair.generate().publicKey;
const token0Vault = Keypair.generate().publicKey;
const token1Vault = Keypair.generate().publicKey;
const token0Mint = Keypair.generate().publicKey;
const token1Mint = Keypair.generate().publicKey;
const lpMint = Keypair.generate().publicKey;

test("raydium cpmm builders encode discriminators", () => {
  const swap = build_swap_base_input_cpmm_ix({
    payer,
    authority,
    amm_config: ammConfig,
    pool_state: poolState,
    input_token_account: inputTokenAccount,
    output_token_account: outputTokenAccount,
    input_vault: inputVault,
    output_vault: outputVault,
    input_token_mint: inputMint,
    output_token_mint: outputMint,
    observation_state: observationState,
    amount_in: 1_000,
    minimum_amount_out: 900,
  });

  assert.equal(swap.programId.toBase58(), RAYDIUM_CPMM_PROGRAM.toBase58());
  assert.deepEqual(swap.data.subarray(0, 8), RaydiumCpmmDiscriminators.SWAP_BASE_INPUT);

  const add = build_add_liquidity_cpmm_ix({
    owner: payer,
    authority,
    pool_state: poolState,
    owner_lp_token: ownerLpToken,
    token_0_account: token0Account,
    token_1_account: token1Account,
    token_0_vault: token0Vault,
    token_1_vault: token1Vault,
    token_0_mint: token0Mint,
    token_1_mint: token1Mint,
    lp_mint: lpMint,
    lp_amount: 2_000,
    max_amount_0: 1_000,
    max_amount_1: 1_000,
  });

  assert.deepEqual(add.data.subarray(0, 8), RaydiumCpmmDiscriminators.ADD_LIQUIDITY);

  const remove = build_remove_liquidity_cpmm_ix({
    owner: payer,
    authority,
    pool_state: poolState,
    owner_lp_token: ownerLpToken,
    token_0_account: token0Account,
    token_1_account: token1Account,
    token_0_vault: token0Vault,
    token_1_vault: token1Vault,
    token_0_mint: token0Mint,
    token_1_mint: token1Mint,
    lp_mint: lpMint,
    lp_amount: 2_000,
    min_amount_0: 900,
    min_amount_1: 900,
  });

  assert.deepEqual(remove.data.subarray(0, 8), RaydiumCpmmDiscriminators.REMOVE_LIQUIDITY);
  assert.equal(derive_pool_auth(poolState)[0].toBase58().length > 0, true);
  assert.equal(derive_lp_mint(poolState)[0].toBase58().length > 0, true);
});
