import { strict as assert } from "node:assert";
import test from "node:test";
import { ContextualBandit, createDefaultLearningBanditState } from "./contextual-bandit.js";

test("contextual bandit selects a strategy and updates source-specific state", () => {
  const bandit = new ContextualBandit(createDefaultLearningBanditState());
  const choice = bandit.selectStrategy({
    degenScore: 82,
    holderGini: 0.24,
    socialVelocityScore: 71,
    tvlUsd: 180_000,
    isUnderMevAttack: false,
    source: "wss-sniper",
    hourOfDay: 14,
    marketVolatility: 38,
  });

  assert.ok(choice.strategy);
  assert.ok(choice.config.positionSizeMultiplier > 0);

  bandit.update(choice.strategy, {
    degenScore: 82,
    holderGini: 0.24,
    socialVelocityScore: 71,
    tvlUsd: 180_000,
    isUnderMevAttack: false,
    source: "wss-sniper",
    hourOfDay: 14,
    marketVolatility: 38,
  }, 120, 3, 2);

  const nextChoice = bandit.selectStrategy({
    degenScore: 82,
    holderGini: 0.24,
    socialVelocityScore: 71,
    tvlUsd: 180_000,
    isUnderMevAttack: false,
    source: "wss-sniper",
    hourOfDay: 14,
    marketVolatility: 38,
  });

  assert.equal(typeof nextChoice.score, "number");
});
