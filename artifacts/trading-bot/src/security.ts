import { Connection, PublicKey } from "@solana/web3.js";
import type { MarketSnapshot, PoolSnapshot } from "./domain.js";

type MintSafetySample = {
  mintAuthorityRevoked?: boolean;
  freezeAuthorityRevoked?: boolean;
  topHolderSharePct?: number;
  topTenHolderSharePct?: number;
  rugRiskScore: number;
  creatorRiskScore: number;
  liquidityLocked?: boolean;
  checkedAt: string;
  source: "rpc" | "rugcheck" | "fallback";
  notes: string[];
};

type SafetyInspectorOptions = {
  rpcUrl?: string;
  rugcheckApiUrl?: string;
  rugcheckApiKey?: string;
  cacheTtlMs?: number;
  maxTopHolderSharePct?: number;
  maxTopTenHolderSharePct?: number;
  maxRugRiskScore?: number;
};

export class TokenSafetyInspector {
  private readonly rpc?: Connection;
  private readonly cache = new Map<string, { value: MintSafetySample; expiresAt: number }>();
  private readonly cacheTtlMs: number;
  private readonly maxTopHolderSharePct: number;
  private readonly maxTopTenHolderSharePct: number;
  private readonly maxRugRiskScore: number;

  constructor(private readonly options: SafetyInspectorOptions = {}) {
    this.rpc = options.rpcUrl ? new Connection(options.rpcUrl, "confirmed") : undefined;
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60_000;
    this.maxTopHolderSharePct = options.maxTopHolderSharePct ?? 80;
    this.maxTopTenHolderSharePct = options.maxTopTenHolderSharePct ?? 95;
    this.maxRugRiskScore = options.maxRugRiskScore ?? 70;
  }

  async enrichSnapshot(snapshot: MarketSnapshot): Promise<MarketSnapshot> {
    if (!this.rpc) return snapshot;

    const uniqueMints = [...new Set(snapshot.pools.flatMap((pool) => [pool.tokenXMint, pool.tokenYMint].filter(Boolean) as string[]))];
    if (uniqueMints.length === 0) return snapshot;

    const samples = new Map<string, MintSafetySample>();
    await Promise.all(uniqueMints.map(async (mint) => {
      try {
        samples.set(mint, await this.inspectMint(mint));
      } catch {
        samples.set(mint, fallbackSample());
      }
    }));

    return {
      ...snapshot,
      pools: snapshot.pools.map((pool) => this.enrichPool(pool, samples)),
    };
  }

  private enrichPool(pool: PoolSnapshot, samples: Map<string, MintSafetySample>): PoolSnapshot {
    const x = pool.tokenXMint ? samples.get(pool.tokenXMint) : undefined;
    const y = pool.tokenYMint ? samples.get(pool.tokenYMint) : undefined;
    const merged = mergeSamples([x, y]);

    return {
      ...pool,
      mintAuthorityRevoked: merged.mintAuthorityRevoked ?? pool.mintAuthorityRevoked,
      freezeAuthorityRevoked: merged.freezeAuthorityRevoked ?? pool.freezeAuthorityRevoked,
      liquidityLocked: merged.liquidityLocked ?? pool.liquidityLocked,
      topHolderSharePct: merged.topHolderSharePct ?? pool.topHolderSharePct,
      rugRiskScore: merged.rugRiskScore,
      tokenSafetyScore: round2(100 - merged.rugRiskScore),
    };
  }

  private async inspectMint(mint: string): Promise<MintSafetySample> {
    const cached = this.cache.get(mint);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const pubkey = new PublicKey(mint);
    const [mintInfo, supplyInfo, largestInfo, signatureInfo] = await Promise.allSettled([
      this.rpc!.getParsedAccountInfo(pubkey, "confirmed"),
      this.rpc!.getTokenSupply(pubkey),
      this.rpc!.getTokenLargestAccounts(pubkey),
      this.rpc!.getSignaturesForAddress(pubkey, { limit: 20 }),
    ]);

    const notes: string[] = [];
    let mintAuthorityRevoked: boolean | undefined;
    let freezeAuthorityRevoked: boolean | undefined;
    let topHolderSharePct: number | undefined;
    let topTenHolderSharePct: number | undefined;
    let creatorRiskScore = 0;
    let rugRiskScore = 0;

    if (mintInfo.status === "fulfilled") {
      const value = mintInfo.value.value as any;
      const parsed = value?.data?.parsed?.info ?? value?.data?.parsed ?? {};
      if (Object.prototype.hasOwnProperty.call(parsed, "mintAuthority")) {
        mintAuthorityRevoked = !parsed.mintAuthority;
        if (mintAuthorityRevoked) notes.push("mint authority revoked");
      }
      if (Object.prototype.hasOwnProperty.call(parsed, "freezeAuthority")) {
        freezeAuthorityRevoked = !parsed.freezeAuthority;
        if (freezeAuthorityRevoked) notes.push("freeze authority revoked");
      }
    }

    if (supplyInfo.status === "fulfilled" && largestInfo.status === "fulfilled") {
      const supply = Number(supplyInfo.value.value.uiAmount ?? supplyInfo.value.value.amount ?? 0);
      const largestAccounts = largestInfo.value.value ?? [];
      const largest = Number(largestAccounts[0]?.uiAmount ?? largestAccounts[0]?.amount ?? 0);
      const topTen = largestAccounts.slice(0, 10).reduce((sum, account) => sum + Number(account?.uiAmount ?? account?.amount ?? 0), 0);
      if (Number.isFinite(supply) && supply > 0 && Number.isFinite(largest) && largest > 0) {
        topHolderSharePct = round2((largest / supply) * 100);
        if (topHolderSharePct > this.maxTopHolderSharePct) {
          notes.push(`top holder concentration ${topHolderSharePct.toFixed(2)}%`);
          rugRiskScore += 20;
        }
      }
      if (Number.isFinite(supply) && supply > 0 && Number.isFinite(topTen) && topTen > 0) {
        topTenHolderSharePct = round2((topTen / supply) * 100);
        if (topTenHolderSharePct > this.maxTopTenHolderSharePct) {
          notes.push(`top 10 holder concentration ${topTenHolderSharePct.toFixed(2)}%`);
          rugRiskScore += 15;
        }
      }
    }

    if (signatureInfo.status === "fulfilled") {
      const signatures = signatureInfo.value;
      const first = signatures.at(-1);
      if (!first) {
        creatorRiskScore += 20;
      } else {
        const ageHours = first.blockTime ? (Date.now() / 1000 - first.blockTime) / 3600 : Number.POSITIVE_INFINITY;
        if (!Number.isFinite(ageHours) || ageHours < 6) {
          creatorRiskScore += 25;
          notes.push("mint history is very recent");
        } else if (ageHours < 24) {
          creatorRiskScore += 15;
        }
      }

      if (signatures.some((entry) => entry.err)) {
        creatorRiskScore += 10;
      }

      if (signatures.length < 3) {
        creatorRiskScore += 10;
      }
    }

    const rugcheck = await this.fetchRugcheckScore(mint);
    if (rugcheck !== undefined) {
      rugRiskScore = Math.max(rugRiskScore, rugcheck);
      notes.push(`rugcheck score ${rugcheck}`);
    }

    if (!mintAuthorityRevoked) rugRiskScore += 30;
    if (!freezeAuthorityRevoked) rugRiskScore += 20;
    rugRiskScore += Math.min(30, creatorRiskScore);
    rugRiskScore = Math.min(100, Math.max(0, rugRiskScore));

    const sample: MintSafetySample = {
      mintAuthorityRevoked,
      freezeAuthorityRevoked,
      topHolderSharePct,
      topTenHolderSharePct,
      rugRiskScore,
      creatorRiskScore,
      liquidityLocked: Boolean(mintAuthorityRevoked && freezeAuthorityRevoked && (topHolderSharePct ?? 100) <= this.maxTopHolderSharePct),
      checkedAt: new Date().toISOString(),
      source: "rpc",
      notes,
    };

    this.cache.set(mint, { value: sample, expiresAt: Date.now() + this.cacheTtlMs });
    return sample;
  }

  private async fetchRugcheckScore(mint: string): Promise<number | undefined> {
    if (!this.options.rugcheckApiUrl) return undefined;

    try {
      const url = new URL(this.options.rugcheckApiUrl);
      url.searchParams.set("mint", mint);
      const response = await fetch(url, {
        headers: this.options.rugcheckApiKey ? { Accept: "application/json", Authorization: `Bearer ${this.options.rugcheckApiKey}` } : { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return undefined;
      const payload = await response.json() as Record<string, unknown>;
      const raw = payload.riskScore ?? payload.score ?? payload.rugRiskScore ?? payload.risk;
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) {
        return clamp(numeric, 0, this.maxRugRiskScore);
      }
    } catch {
      return undefined;
    }

    return undefined;
  }
}

function mergeSamples(samples: Array<MintSafetySample | undefined>) {
  const present = samples.filter((sample): sample is MintSafetySample => Boolean(sample));
  if (present.length === 0) return fallbackSample();

  return present.reduce<MintSafetySample>((acc, sample) => ({
    mintAuthorityRevoked: acc.mintAuthorityRevoked && sample.mintAuthorityRevoked,
    freezeAuthorityRevoked: acc.freezeAuthorityRevoked && sample.freezeAuthorityRevoked,
      topHolderSharePct: Math.max(acc.topHolderSharePct ?? 0, sample.topHolderSharePct ?? 0) || undefined,
      topTenHolderSharePct: Math.max(acc.topTenHolderSharePct ?? 0, sample.topTenHolderSharePct ?? 0) || undefined,
      rugRiskScore: Math.max(acc.rugRiskScore, sample.rugRiskScore),
    creatorRiskScore: Math.max(acc.creatorRiskScore, sample.creatorRiskScore),
    liquidityLocked: Boolean(acc.liquidityLocked && sample.liquidityLocked),
    checkedAt: sample.checkedAt,
    source: sample.source,
    notes: [...acc.notes, ...sample.notes],
  }), present[0]);
}

function fallbackSample(): MintSafetySample {
  return {
    rugRiskScore: 50,
    creatorRiskScore: 10,
    checkedAt: new Date().toISOString(),
    source: "fallback",
    notes: ["safety analysis unavailable"],
  };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
