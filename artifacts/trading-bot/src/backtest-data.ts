import { readFile } from "node:fs/promises";
import type { MarketSnapshot } from "./domain.js";

export async function loadBacktestSnapshots(source: string): Promise<MarketSnapshot[]> {
  const raw = await readFile(source, "utf8");
  return parseBacktestSnapshots(raw);
}

export function parseBacktestSnapshots(raw: string): MarketSnapshot[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.flatMap((entry) => normalizeSnapshot(entry));
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { snapshots?: unknown[] }).snapshots)) {
      return (parsed as { snapshots: unknown[] }).snapshots.flatMap((entry) => normalizeSnapshot(entry));
    }
  } catch {
    // fall through to JSONL parsing
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return normalizeSnapshot(JSON.parse(line) as unknown);
      } catch {
        return [];
      }
    });
}

function normalizeSnapshot(entry: unknown): MarketSnapshot[] {
  if (!entry || typeof entry !== "object") return [];
  const snapshot = entry as Partial<MarketSnapshot> & { pools?: unknown; prices?: unknown };
  if (typeof snapshot.capturedAt !== "string") return [];
  if (!Array.isArray(snapshot.pools) || !Array.isArray(snapshot.prices)) return [];

  return [
    {
      capturedAt: snapshot.capturedAt,
      pools: snapshot.pools as MarketSnapshot["pools"],
      prices: snapshot.prices as MarketSnapshot["prices"],
    },
  ];
}
