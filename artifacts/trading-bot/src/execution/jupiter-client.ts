import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { ExecutionError, ExecutionErrorCode, simulation_failed } from './errors.js';

const JUPITER_API_BASE = 'https://quote-api.jup.ag/v6';

export type JupiterQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: number;
  outAmount: number;
  otherAmountThreshold: number;
  priceImpactPct: number;
  slippageBps: number;
  routePlan: unknown[];
  raw: Record<string, unknown>;
};

export type JupiterSwapResult = {
  signature: string;
  slot?: number | null;
  fee?: number | null;
  inAmount: number;
  outAmount: number;
};

export class JupiterClient {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(
    private readonly rpc: Connection,
    private readonly keypair: Keypair,
    private readonly apiBase: string = JUPITER_API_BASE,
    timeoutMs = 15_000,
    maxRetries = 3,
  ) {
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
  }

  async getQuote(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: number,
    slippageBps = 50,
    onlyDirectRoutes = false,
  ): Promise<JupiterQuote> {
    const params = new URLSearchParams({
      inputMint: inputMint.toBase58(),
      outputMint: outputMint.toBase58(),
      amount: String(amount),
      slippageBps: String(slippageBps),
      onlyDirectRoutes: String(onlyDirectRoutes).toLowerCase(),
    });

    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      try {
        const response = await fetch(`${this.apiBase}/quote?${params.toString()}`, {
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw new ExecutionError(ExecutionErrorCode.JUPITER_API, `Quote HTTP ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as Record<string, unknown>;
        return {
          inputMint: String(data.inputMint ?? inputMint.toBase58()),
          outputMint: String(data.outputMint ?? outputMint.toBase58()),
          inAmount: Number(data.inAmount ?? amount),
          outAmount: Number(data.outAmount ?? 0),
          otherAmountThreshold: Number(data.otherAmountThreshold ?? 0),
          priceImpactPct: Number(data.priceImpactPct ?? 0),
          slippageBps,
          routePlan: Array.isArray(data.routePlan) ? data.routePlan : [],
          raw: data,
        };
      } catch (error) {
        if (attempt === this.maxRetries - 1) {
          throw new ExecutionError(ExecutionErrorCode.JUPITER_API, `Quote failed after ${this.maxRetries} retries`, error as Error);
        }
        await sleep(500 * (attempt + 1));
      }
    }

    throw new ExecutionError(ExecutionErrorCode.JUPITER_API, 'Quote failed');
  }

  async batchQuote(pairs: Array<[PublicKey, PublicKey, number]>, slippageBps = 50) {
    const results = await Promise.allSettled(
      pairs.map(([inputMint, outputMint, amount]) => this.getQuote(inputMint, outputMint, amount, slippageBps)),
    );
    return results.map((result) => (result.status === 'fulfilled' ? result.value : null));
  }

  async swap(
    quote: JupiterQuote,
    priorityFeeMicrolamports = 10_000,
    computeUnitLimit = 400_000,
    simulateFirst = true,
  ): Promise<JupiterSwapResult> {
    const body = {
      quoteResponse: quote.raw,
      userPublicKey: this.keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      prioritizationFeeLamports: priorityFeeMicrolamports,
      computeUnitPriceMicroLamports: priorityFeeMicrolamports,
      dynamicComputeUnitLimit: true,
      computeUnitLimit,
    };

    const response = await fetch(`${this.apiBase}/swap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new ExecutionError(ExecutionErrorCode.JUPITER_API, `Swap HTTP ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as { swapTransaction?: string };
    if (!payload.swapTransaction) {
      throw new ExecutionError(ExecutionErrorCode.JUPITER_API, 'Jupiter swap response missing swapTransaction');
    }

    const tx = VersionedTransaction.deserialize(Buffer.from(payload.swapTransaction, 'base64'));

    if (simulateFirst) {
      const sim = await this.rpc.simulateTransaction(tx);
      if (sim.value.err) {
        throw simulation_failed((sim.value.logs ?? []).map(String), new Error(String(sim.value.err)));
      }
    }

    tx.sign([this.keypair]);
    const signature = await this.rpc.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 0,
    });

    await this.confirm(signature);

    return {
      signature,
      slot: null,
      fee: priorityFeeMicrolamports,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
    };
  }

  async confirm(signature: string, timeoutSeconds = 60) {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const status = await this.rpc.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const value = status.value[0];
      if (value?.err) {
        throw new ExecutionError(ExecutionErrorCode.TRANSACTION_EXPIRED, `Transaction ${signature} failed: ${JSON.stringify(value.err)}`);
      }
      if (value?.confirmationStatus === 'confirmed' || value?.confirmationStatus === 'finalized') {
        return;
      }
      await sleep(1000);
    }
    throw new ExecutionError(ExecutionErrorCode.TRANSACTION_EXPIRED, `Transaction ${signature} not confirmed in ${timeoutSeconds}s`);
  }

  async getRecommendedPriorityFee(accounts: string[]) {
    try {
      const url = new URL(`${this.apiBase}/priority-fee`);
      url.searchParams.set('accounts', accounts.join(','));
      const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs), headers: { Accept: 'application/json' } });
      if (response.ok) {
        const payload = (await response.json()) as Record<string, unknown>;
        const fee = Number(payload.priorityFeeLamports ?? payload.priorityFee ?? payload.recommendedPriorityFee ?? 0);
        if (Number.isFinite(fee) && fee > 0) return Math.round(fee * 1000);
      }
    } catch {
      // fall through to RPC-based estimation
    }

    const fees = await this.rpc.getRecentPrioritizationFees();
    if (!fees.length) return 10_000;
    const sorted = fees.map((entry) => entry.prioritizationFee).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.75)] ?? sorted.at(-1) ?? 10_000;
  }

  async close() {
    return undefined;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
