import { strict as assert } from "node:assert";
import test from "node:test";
import { SignalWeightTuner, createDefaultSignalWeightState } from "./signal-weight-tuner.js";

test("signal weight tuner adjusts weights after observations", () => {
  const tuner = new SignalWeightTuner(createDefaultSignalWeightState());
  for (let index = 0; index < 10; index += 1) {
    tuner.observe({
      rewardUsd: 40,
      holderGini: 0.82,
      socialVelocityScore: 68,
      mintAuthorityRevoked: false,
      devWalletAgeDays: 2,
      tvlUsd: 12_000,
      fdvRatio: 18,
      previousRugsByDev: 3,
      degenScore: 44,
      whalePressureScore: 77,
    });
  }

  const weights = tuner.getWeights();
  assert.ok(weights.holderGini > 0.9 || weights.socialVelocity > 0.9 || weights.degenScore > 0.9);
});
