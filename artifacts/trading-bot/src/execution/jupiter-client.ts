import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
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
  private readonly jitoTipAccountCache = new Map<string, PublicKey>();

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
    options?: {
      useJito?: boolean;
      jitoBlockEngineUrl?: string;
      jitoTipLamports?: number;
      jitoDontFrontTag?: string;
    },
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
    tx.sign([this.keypair]);

    if (simulateFirst) {
      const sim = await this.rpc.simulateTransaction(tx);
      if (sim.value.err) {
        throw simulation_failed((sim.value.logs ?? []).map(String), new Error(String(sim.value.err)));
      }
    }

    const signature = options?.useJito
      ? await this.sendViaJito(tx, options)
      : await this.rpc.sendRawTransaction(tx.serialize(), {
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

  private async sendViaJito(tx: VersionedTransaction, options?: { jitoBlockEngineUrl?: string; jitoTipLamports?: number; jitoDontFrontTag?: string; }) {
    const blockEngineUrl = options?.jitoBlockEngineUrl ?? 'https://mainnet.block-engine.jito.wtf/api/v1';
    const tipLamports = Math.max(1_000, options?.jitoTipLamports ?? 1_000);
    const dontFrontTag = options?.jitoDontFrontTag ?? 'jitodontfront';
    const blockhash = tx.message.recentBlockhash;
    const tipAccount = await this.getTipAccount(blockEngineUrl);
    const protectTx = this.buildProtectTransaction(blockhash, dontFrontTag);
    const tipTx = this.buildTipTransaction(blockhash, tipAccount, tipLamports);
    const bundle = [protectTx, tx, tipTx].map((item) => Buffer.from(item.serialize()).toString('base64'));

    const response = await fetch(`${blockEngineUrl}/bundles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [bundle, { encoding: 'base64' }],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new ExecutionError(ExecutionErrorCode.JUPITER_API, `Jito bundle HTTP ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as { result?: string; error?: unknown };
    if (payload.error) {
      throw new ExecutionError(ExecutionErrorCode.JUPITER_API, `Jito bundle rejected: ${JSON.stringify(payload.error)}`);
    }

    return tx.signatures[0] ? base58Encode(tx.signatures[0]) : String(payload.result ?? '');
  }

  private async getTipAccount(blockEngineUrl: string) {
    const cached = this.jitoTipAccountCache.get(blockEngineUrl);
    if (cached) return cached;

    let response = await fetch(`${blockEngineUrl}/getTipAccounts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTipAccounts', params: [] }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      response = await fetch(`${blockEngineUrl}/getTipAccounts`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new ExecutionError(ExecutionErrorCode.JUPITER_API, `Jito tip account lookup failed: ${response.status}`);
      }
    }

    const payload = (await response.json()) as { result?: string[] };
    const account = payload.result?.[0];
    if (!account) {
      throw new ExecutionError(ExecutionErrorCode.JUPITER_API, 'Jito tip account lookup returned no accounts');
    }

    const pubkey = new PublicKey(account);
    this.jitoTipAccountCache.set(blockEngineUrl, pubkey);
    return pubkey;
  }

  private buildProtectTransaction(blockhash: string, dontFrontTag: string) {
    const dontFrontAccount = publicKeyFromSeed(dontFrontTag);
    const memoInstruction = new TransactionInstruction({
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      keys: [{ pubkey: dontFrontAccount, isSigner: false, isWritable: false }],
      data: Buffer.from('jitodontfront'),
    });
    const message = new TransactionMessage({
      payerKey: this.keypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [memoInstruction],
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([this.keypair]);
    return tx;
  }

  private buildTipTransaction(blockhash: string, tipAccount: PublicKey, tipLamports: number) {
    const instruction = SystemProgram.transfer({
      fromPubkey: this.keypair.publicKey,
      toPubkey: tipAccount,
      lamports: tipLamports,
    });
    const message = new TransactionMessage({
      payerKey: this.keypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([this.keypair]);
    return tx;
  }
}

function publicKeyFromSeed(seed: string) {
  const hash = createHash('sha256').update(seed).digest();
  return new PublicKey(hash.subarray(0, 32));
}

function base58Encode(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let x = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  if (x === 0n) return "1";

  let output = "";
  while (x > 0n) {
    const mod = Number(x % 58n);
    output = alphabet[mod] + output;
    x /= 58n;
  }

  for (const byte of bytes) {
    if (byte !== 0) break;
    output = alphabet[0] + output;
  }

  return output;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
