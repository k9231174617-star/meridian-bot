import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { JupiterClient } from './jupiter-client.js';
import { ExecutionError, ExecutionErrorCode, protocol_not_supported, retry_exhausted, simulation_failed } from './errors.js';
import { build_add_liquidity_cpmm_ix, build_remove_liquidity_cpmm_ix } from './instructions/raydium_cpmm.js';
import {
  build_close_position_clmm_ix,
  build_decrease_liquidity_clmm_ix,
  build_increase_liquidity_clmm_ix,
  build_open_position_clmm_ix,
} from './instructions/raydium_clmm.js';
import {
  build_close_position_orca_ix,
  build_collect_fees_orca_ix,
  build_decrease_liquidity_orca_ix,
  build_increase_liquidity_orca_ix,
  build_open_position_orca_ix,
  derive_position,
} from './instructions/orca_whirlpool.js';
import {
  build_add_liquidity_meteora_ix,
  build_claim_fee_meteora_ix,
  build_initialize_position_meteora_ix,
  build_remove_liquidity_meteora_ix,
} from './instructions/meteora_dlmm.js';
import { CommandType, ExecutionCommand, ExecutionResult, PoolProtocol } from './types.js';

export class ExecutionOrchestrator {
  private readonly jupiter: JupiterClient;

  constructor(
    private readonly rpc: Connection,
    private readonly keypair: Keypair,
    private readonly maxRetries = 3,
    private readonly simulate = true,
  ) {
    this.jupiter = new JupiterClient(rpc, keypair);
  }

  async execute(cmd: ExecutionCommand): Promise<ExecutionResult> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      try {
        return await this.dispatch(cmd);
      } catch (error) {
        lastError = error as Error;
        if (error instanceof ExecutionError) {
          if ([
            ExecutionErrorCode.SIMULATION_FAILED,
            ExecutionErrorCode.INVALID_TICK_RANGE,
            ExecutionErrorCode.PROTOCOL_NOT_SUPPORTED,
            ExecutionErrorCode.WALLET_NOT_CONNECTED,
            ExecutionErrorCode.MATH_OVERFLOW,
            ExecutionErrorCode.SLIPPAGE_EXCEEDED,
            ExecutionErrorCode.POOL_NOT_FOUND,
            ExecutionErrorCode.POSITION_NOT_FOUND,
            ExecutionErrorCode.ATA_NOT_FOUND,
          ].includes(error.code)) {
            throw error;
          }
        }
        await sleep(500 * 2 ** attempt);
      }
    }
    throw retry_exhausted(this.maxRetries, lastError);
  }

  async close() {
    await this.jupiter.close();
  }

  private async dispatch(cmd: ExecutionCommand): Promise<ExecutionResult> {
    switch (cmd.cmdType) {
      case CommandType.SWAP:
        return this.executeSwap(cmd);
      case CommandType.OPEN_POSITION:
        return this.executeOpenPosition(cmd);
      case CommandType.CLOSE_POSITION:
        return this.executeClosePosition(cmd);
      case CommandType.ADD_LIQUIDITY:
        return this.executeAddLiquidity(cmd);
      case CommandType.REMOVE_LIQUIDITY:
        return this.executeRemoveLiquidity(cmd);
      case CommandType.COLLECT_FEES:
        return this.executeCollectFees(cmd);
      case CommandType.REBALANCE:
        return this.executeRebalance(cmd);
      default:
        throw protocol_not_supported(String(cmd.cmdType));
    }
  }

  private async executeSwap(cmd: ExecutionCommand): Promise<ExecutionResult> {
    if (!cmd.inputMint || !cmd.outputMint || !cmd.amountIn) {
      return { success: false, error: 'SWAP requires inputMint, outputMint and amountIn' };
    }
    const priorityFee = Math.max(
      await this.jupiter.getRecommendedPriorityFee([cmd.poolId.toBase58(), cmd.inputMint.toBase58(), cmd.outputMint.toBase58()]),
      cmd.priorityFeeMicrolamports,
    );
    const quote = await this.jupiter.getQuote(cmd.inputMint, cmd.outputMint, cmd.amountIn, cmd.slippageBps);
    const honeypot = cmd.simulateHoneypot !== false;
    if (honeypot) {
      await this.assertRoundTripIsViable(cmd, quote, cmd.maxHoneypotLossBps ?? 150);
    }
    const result = cmd.useJito
      ? await this.jupiter.swap(
        quote,
        priorityFee,
        cmd.computeUnits,
        this.simulate,
        {
          useJito: true,
          jitoBlockEngineUrl: cmd.jitoBlockEngineUrl,
          jitoTipLamports: cmd.jitoTipLamports,
          jitoDontFrontTag: cmd.jitoDontFrontTag,
        },
      )
      : await this.jupiter.swap(quote, priorityFee, cmd.computeUnits, this.simulate);
    return { success: true, signature: result.signature, feePaid: result.fee ?? undefined, amountOut: result.outAmount, priceImpactBps: Math.round(quote.priceImpactPct * 100) };
  }

  private async assertRoundTripIsViable(cmd: ExecutionCommand, quote: Awaited<ReturnType<JupiterClient["getQuote"]>>, maxLossBps: number) {
    const reverseAmount = Math.max(1, Math.floor(quote.outAmount));
    const reverseQuote = await this.jupiter.getQuote(cmd.outputMint!, cmd.inputMint!, reverseAmount, cmd.slippageBps, true);
    const roundTripBps = quote.inAmount > 0
      ? Math.round((1 - (reverseQuote.outAmount / quote.inAmount)) * 10_000)
      : 10_000;
    if (!Number.isFinite(roundTripBps) || roundTripBps > maxLossBps) {
      throw simulation_failed([
        `roundTripLossBps=${roundTripBps}`,
        `maxLossBps=${maxLossBps}`,
        `input=${quote.inAmount}`,
        `output=${quote.outAmount}`,
      ], new Error(`Potential honeypot or excessive round-trip loss: ${roundTripBps} bps`));
    }
  }

  private async executeOpenPosition(cmd: ExecutionCommand): Promise<ExecutionResult> {
    const p = cmd.positionInfo;
    const positionMint = p.positionNftMint;
    const positionAccount = p.positionNftAccount;

    let ix: TransactionInstruction;
    if (cmd.protocol === PoolProtocol.RAYDIUM_CLMM) {
      ix = build_open_position_clmm_ix({
        payer: cmd.wallet,
        pool_state: cmd.poolId,
        position_nft_mint: positionMint,
        position_nft_account: positionAccount,
        tick_lower: cmd.tickLower ?? 0,
        tick_upper: cmd.tickUpper ?? 0,
        tick_spacing: 10,
        liquidity: cmd.amountA ?? 0,
        amount_a_max: cmd.amountA ?? 0,
        amount_b_max: cmd.amountB ?? 0,
        token_account_a: asPubkey(p.extra.token_account_a),
        token_account_b: asPubkey(p.extra.token_account_b),
        token_vault_0: asPubkey(p.extra.vault_0),
        token_vault_1: asPubkey(p.extra.vault_1),
        tick_array_lower: asPubkey(p.extra.tick_array_lower),
        tick_array_upper: asPubkey(p.extra.tick_array_upper),
      });
    } else if (cmd.protocol === PoolProtocol.ORCA_WHIRLPOOL) {
      ix = build_open_position_orca_ix({
        funder: cmd.wallet,
        owner: cmd.wallet,
        whirlpool: cmd.poolId,
        position_mint: positionMint,
        position_token_account: positionAccount,
        tick_lower: cmd.tickLower ?? 0,
        tick_upper: cmd.tickUpper ?? 0,
        tick_spacing: 64,
      });
    } else if (cmd.protocol === PoolProtocol.METEORA_DLMM) {
      ix = build_initialize_position_meteora_ix({
        payer: cmd.wallet,
        owner: cmd.wallet,
        lb_pair: cmd.poolId,
        lower_bin_id: cmd.tickLower ?? 0,
        width: (cmd.tickUpper ?? 0) - (cmd.tickLower ?? 0),
      });
    } else {
      throw protocol_not_supported(cmd.protocol);
    }

    const sig = await this.sendInstructions([ix], cmd);
    return { success: true, signature: sig };
  }

  private async executeClosePosition(cmd: ExecutionCommand): Promise<ExecutionResult> {
    const p = cmd.positionInfo;
    let ix: TransactionInstruction;
    if (cmd.protocol === PoolProtocol.RAYDIUM_CLMM) {
      ix = build_close_position_clmm_ix({
        owner: cmd.wallet,
        position_nft_mint: p.positionNftMint,
        position_nft_account: p.positionNftAccount,
        recipient: cmd.wallet,
      });
    } else if (cmd.protocol === PoolProtocol.ORCA_WHIRLPOOL) {
      const [position] = derive_position(p.positionNftMint);
      ix = build_close_position_orca_ix({
        position_authority: cmd.wallet,
        receiver: cmd.wallet,
        position,
        position_mint: p.positionNftMint,
        position_token_account: p.positionNftAccount,
      });
    } else {
      throw protocol_not_supported(cmd.protocol);
    }
    const sig = await this.sendInstructions([ix], cmd);
    return { success: true, signature: sig };
  }

  private async executeAddLiquidity(cmd: ExecutionCommand): Promise<ExecutionResult> {
    const p = cmd.positionInfo;
    let ix: TransactionInstruction;
    if (cmd.protocol === PoolProtocol.RAYDIUM_CLMM) {
      ix = build_increase_liquidity_clmm_ix({
        payer: cmd.wallet,
        pool_state: cmd.poolId,
        position_nft_account: p.positionNftAccount,
        position_nft_mint: p.positionNftMint,
        tick_array_lower: asPubkey(p.extra.tick_array_lower),
        tick_array_upper: asPubkey(p.extra.tick_array_upper),
        token_account_a: asPubkey(p.extra.token_account_a),
        token_account_b: asPubkey(p.extra.token_account_b),
        token_vault_0: asPubkey(p.extra.vault_0),
        token_vault_1: asPubkey(p.extra.vault_1),
        tick_lower: cmd.tickLower ?? 0,
        tick_upper: cmd.tickUpper ?? 0,
        liquidity: cmd.amountA ?? 0,
        amount_a_max: cmd.amountA ?? 0,
        amount_b_max: cmd.amountB ?? 0,
      });
    } else if (cmd.protocol === PoolProtocol.RAYDIUM_CPMM) {
      ix = build_add_liquidity_cpmm_ix({
        owner: cmd.wallet,
        authority: asPubkey(p.extra.authority),
        pool_state: cmd.poolId,
        owner_lp_token: asPubkey(p.extra.owner_lp_token),
        token_0_account: asPubkey(p.extra.token_account_a),
        token_1_account: asPubkey(p.extra.token_account_b),
        token_0_vault: asPubkey(p.extra.vault_0),
        token_1_vault: asPubkey(p.extra.vault_1),
        token_0_mint: asPubkey(p.extra.mint_a),
        token_1_mint: asPubkey(p.extra.mint_b),
        lp_mint: asPubkey(p.extra.lp_mint),
        lp_amount: cmd.amountA ?? 0,
        max_amount_0: cmd.amountA ?? 0,
        max_amount_1: cmd.amountB ?? 0,
      });
    } else if (cmd.protocol === PoolProtocol.ORCA_WHIRLPOOL) {
      const [position] = derive_position(p.positionNftMint);
      ix = build_increase_liquidity_orca_ix({
        whirlpool: cmd.poolId,
        position,
        position_token_account: p.positionNftAccount,
        token_owner_account_a: asPubkey(p.extra.token_account_a),
        token_owner_account_b: asPubkey(p.extra.token_account_b),
        token_vault_a: asPubkey(p.extra.vault_0),
        token_vault_b: asPubkey(p.extra.vault_1),
        tick_array_lower: asPubkey(p.extra.tick_array_lower),
        tick_array_upper: asPubkey(p.extra.tick_array_upper),
        position_authority: cmd.wallet,
        liquidity_amount: cmd.amountA ?? 0,
        token_max_a: cmd.amountA ?? 0,
        token_max_b: cmd.amountB ?? 0,
      });
    } else if (cmd.protocol === PoolProtocol.METEORA_DLMM) {
      ix = build_add_liquidity_meteora_ix({
        position: p.positionPubkey ?? p.positionNftMint,
        lb_pair: cmd.poolId,
        bin_array_bitmap: asPubkey(p.extra.bin_array_bitmap),
        bin_array_lower: asPubkey(p.extra.bin_array_lower),
        bin_array_upper: asPubkey(p.extra.bin_array_upper),
        user_token_x: asPubkey(p.extra.token_account_a),
        user_token_y: asPubkey(p.extra.token_account_b),
        reserve_x: asPubkey(p.extra.reserve_x),
        reserve_y: asPubkey(p.extra.reserve_y),
        token_x_mint: asPubkey(p.extra.mint_a),
        token_y_mint: asPubkey(p.extra.mint_b),
        sender: cmd.wallet,
        bin_liquidity: [[cmd.tickLower ?? 0, cmd.amountA ?? 0, cmd.amountB ?? 0]],
        active_id: cmd.tickLower ?? 0,
      });
    } else {
      throw protocol_not_supported(cmd.protocol);
    }
    const sig = await this.sendInstructions([ix], cmd);
    return { success: true, signature: sig };
  }

  private async executeRemoveLiquidity(cmd: ExecutionCommand): Promise<ExecutionResult> {
    const p = cmd.positionInfo;
    let ix: TransactionInstruction;
    if (cmd.protocol === PoolProtocol.RAYDIUM_CLMM) {
      ix = build_decrease_liquidity_clmm_ix({
        payer: cmd.wallet,
        pool_state: cmd.poolId,
        position_nft_account: p.positionNftAccount,
        position_nft_mint: p.positionNftMint,
        tick_array_lower: asPubkey(p.extra.tick_array_lower),
        tick_array_upper: asPubkey(p.extra.tick_array_upper),
        token_account_a: asPubkey(p.extra.token_account_a),
        token_account_b: asPubkey(p.extra.token_account_b),
        token_vault_0: asPubkey(p.extra.vault_0),
        token_vault_1: asPubkey(p.extra.vault_1),
        recipient_account_a: asPubkey(p.extra.token_account_a),
        recipient_account_b: asPubkey(p.extra.token_account_b),
        tick_lower: cmd.tickLower ?? p.tickLowerIndex ?? 0,
        tick_upper: cmd.tickUpper ?? p.tickUpperIndex ?? 0,
        liquidity: p.liquidity ?? 0,
        amount_a_min: cmd.amountA ?? 0,
        amount_b_min: cmd.amountB ?? 0,
      });
    } else if (cmd.protocol === PoolProtocol.ORCA_WHIRLPOOL) {
      const [position] = derive_position(p.positionNftMint);
      ix = build_decrease_liquidity_orca_ix({
        whirlpool: cmd.poolId,
        position,
        position_token_account: p.positionNftAccount,
        token_owner_account_a: asPubkey(p.extra.token_account_a),
        token_owner_account_b: asPubkey(p.extra.token_account_b),
        token_vault_a: asPubkey(p.extra.vault_0),
        token_vault_b: asPubkey(p.extra.vault_1),
        tick_array_lower: asPubkey(p.extra.tick_array_lower),
        tick_array_upper: asPubkey(p.extra.tick_array_upper),
        position_authority: cmd.wallet,
        liquidity_amount: p.liquidity ?? 0,
        token_min_a: cmd.amountA ?? 0,
        token_min_b: cmd.amountB ?? 0,
      });
    } else if (cmd.protocol === PoolProtocol.RAYDIUM_CPMM) {
      ix = build_remove_liquidity_cpmm_ix({
        owner: cmd.wallet,
        authority: asPubkey(p.extra.authority),
        pool_state: cmd.poolId,
        owner_lp_token: asPubkey(p.extra.owner_lp_token),
        token_0_account: asPubkey(p.extra.token_account_a),
        token_1_account: asPubkey(p.extra.token_account_b),
        token_0_vault: asPubkey(p.extra.vault_0),
        token_1_vault: asPubkey(p.extra.vault_1),
        token_0_mint: asPubkey(p.extra.mint_a),
        token_1_mint: asPubkey(p.extra.mint_b),
        lp_mint: asPubkey(p.extra.lp_mint),
        lp_amount: p.liquidity ?? 0,
        min_amount_0: cmd.amountA ?? 0,
        min_amount_1: cmd.amountB ?? 0,
      });
    } else if (cmd.protocol === PoolProtocol.METEORA_DLMM) {
      ix = build_remove_liquidity_meteora_ix({
        position: p.positionPubkey ?? p.positionNftMint,
        lb_pair: cmd.poolId,
        bin_array_bitmap: asPubkey(p.extra.bin_array_bitmap),
        bin_array_lower: asPubkey(p.extra.bin_array_lower),
        bin_array_upper: asPubkey(p.extra.bin_array_upper),
        user_token_x: asPubkey(p.extra.token_account_a),
        user_token_y: asPubkey(p.extra.token_account_b),
        reserve_x: asPubkey(p.extra.reserve_x),
        reserve_y: asPubkey(p.extra.reserve_y),
        token_x_mint: asPubkey(p.extra.mint_a),
        token_y_mint: asPubkey(p.extra.mint_b),
        sender: cmd.wallet,
        bin_ids: [cmd.tickLower ?? 0, cmd.tickUpper ?? 0],
      });
    } else {
      throw protocol_not_supported(cmd.protocol);
    }
    const sig = await this.sendInstructions([ix], cmd);
    return { success: true, signature: sig };
  }

  private async executeCollectFees(cmd: ExecutionCommand): Promise<ExecutionResult> {
    const p = cmd.positionInfo;
    let ix: TransactionInstruction;
    if (cmd.protocol === PoolProtocol.ORCA_WHIRLPOOL) {
      const [position] = derive_position(p.positionNftMint);
      ix = build_collect_fees_orca_ix({
        whirlpool: cmd.poolId,
        position,
        position_token_account: p.positionNftAccount,
        token_owner_account_a: asPubkey(p.extra.token_account_a),
        token_vault_a: asPubkey(p.extra.vault_0),
        token_owner_account_b: asPubkey(p.extra.token_account_b),
        token_vault_b: asPubkey(p.extra.vault_1),
        position_authority: cmd.wallet,
      });
    } else if (cmd.protocol === PoolProtocol.METEORA_DLMM) {
      ix = build_claim_fee_meteora_ix({
        lb_pair: cmd.poolId,
        position: p.positionPubkey ?? p.positionNftMint,
        sender: cmd.wallet,
        reserve_x: asPubkey(p.extra.reserve_x),
        reserve_y: asPubkey(p.extra.reserve_y),
        user_token_x: asPubkey(p.extra.token_account_a),
        user_token_y: asPubkey(p.extra.token_account_b),
        token_x_mint: asPubkey(p.extra.mint_a),
        token_y_mint: asPubkey(p.extra.mint_b),
        bin_array_lower: asPubkey(p.extra.bin_array_lower),
        bin_array_upper: asPubkey(p.extra.bin_array_upper),
      });
    } else {
      throw protocol_not_supported(cmd.protocol);
    }
    const sig = await this.sendInstructions([ix], cmd);
    return { success: true, signature: sig };
  }

  private async executeRebalance(cmd: ExecutionCommand): Promise<ExecutionResult> {
    const removeCmd: ExecutionCommand = {
      ...cmd,
      cmdType: CommandType.REMOVE_LIQUIDITY,
      tickLower: cmd.positionInfo.tickLowerIndex,
      tickUpper: cmd.positionInfo.tickUpperIndex,
    };
    await this.dispatch(removeCmd);

    if (cmd.inputMint && cmd.outputMint && cmd.amountIn) {
      await this.dispatch({ ...cmd, cmdType: CommandType.SWAP });
    }

    const openCmd: ExecutionCommand = { ...cmd, cmdType: CommandType.OPEN_POSITION };
    return this.dispatch(openCmd);
  }

  private async sendInstructions(instructions: TransactionInstruction[], cmd: ExecutionCommand) {
    const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: cmd.computeUnits });
    const cuPriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cmd.priorityFeeMicrolamports });
    const all = [cuLimitIx, cuPriceIx, ...instructions];
    const { blockhash } = await this.rpc.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({
      payerKey: this.keypair.publicKey,
      recentBlockhash: blockhash,
      instructions: all,
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([this.keypair]);

    if (this.simulate) {
      const sim = await this.rpc.simulateTransaction(tx);
      if (sim.value.err) {
        throw simulation_failed((sim.value.logs ?? []).map(String), new Error(String(sim.value.err)));
      }
    }

    const signature = await this.rpc.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 0 });
    return signature;
  }
}

function asPubkey(value: PublicKey | string | number | bigint | undefined) {
  if (value instanceof PublicKey) return value;
  if (typeof value === 'string' && value.length > 0) return new PublicKey(value);
  throw new ExecutionError(ExecutionErrorCode.UNKNOWN, `Missing public key in position extra data: ${String(value)}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
