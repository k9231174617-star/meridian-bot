import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { defaultDiscoverySettings, discoverRecentProgramCandidates, programIdsForDex } from "./dex-discovery.js";

test("discoverRecentProgramCandidates filters program signatures into dex candidates", async () => {
  const programId = programIdsForDex("raydium")[0];
  const connection = {
    async getSignaturesForAddress(_address: PublicKey, _options?: { limit?: number }) {
      return [{ signature: "sig-1", blockTime: 1_716_000_000 }];
    },
    async getTransaction(_signature: string) {
      return {
        meta: {
          logMessages: [
            "Program log: Raydium createPool",
            "Program log: initialize",
          ],
        },
        transaction: {
          message: {
            compiledInstructions: [{ programIdIndex: 0 }],
            staticAccountKeys: [programId],
          },
        },
      };
    },
  };

  const discovery = await discoverRecentProgramCandidates(connection as never, ["raydium"], new Set<string>(), 1);
  assert.equal(discovery.candidates.length, 1);
  assert.equal(discovery.observations.length, 1);
  assert.equal(discovery.candidates[0].dex, "raydium");
  assert.equal(discovery.candidates[0].source, "rpc-account");
  assert.equal(discovery.candidates[0].signature, "sig-1");
  assert.equal(discovery.observations[0].status, "accepted");
});

test("defaultDiscoverySettings respects an explicit empty dex list", () => {
  const settings = defaultDiscoverySettings([]);
  assert.deepEqual(settings.enabledDexes, []);
});
