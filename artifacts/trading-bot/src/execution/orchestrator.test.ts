import { strict as assert } from "node:assert";
import test from "node:test";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { ExecutionOrchestrator } from "./orchestrator.js";
import { CommandType, PoolProtocol, type ExecutionCommand } from "./types.js";

function createRpcMock() {
  const calls = {
    getLatestBlockhash: 0,
    simulateTransaction: 0,
    sendRawTransaction: 0,
    getSignatureStatuses: 0,
    getRecentPrioritizationFees: 0,
  };

  const rpc = {
    getLatestBlockhash: async () => {
      calls.getLatestBlockhash += 1;
      return { blockhash: "mock-blockhash" };
    },
    simulateTransaction: async () => {
      calls.simulateTransaction += 1;
      return { value: { err: null, logs: [] } };
    },
    sendRawTransaction: async () => {
      calls.sendRawTransaction += 1;
      return "mock-signature";
    },
    getSignatureStatuses: async () => {
      calls.getSignatureStatuses += 1;
      return { value: [{ confirmationStatus: "confirmed", err: null }] };
    },
    getRecentPrioritizationFees: async () => {
      calls.getRecentPrioritizationFees += 1;
      return [{ prioritizationFee: 10_000 }];
    },
  } as unknown as Connection;

  return { rpc, calls };
}

function createSwapCommand(): ExecutionCommand {
  return {
    cmdType: CommandType.SWAP,
    protocol: PoolProtocol.METEORA_DLMM,
    poolId: key(),
    wallet: key(),
    positionInfo: {
      positionNftMint: key(),
      positionNftAccount: key(),
      extra: {},
    },
    inputMint: key(),
    outputMint: key(),
    amountIn: 1_000_000,
    slippageBps: 50,
    priorityFeeMicrolamports: 12_000,
    computeUnits: 400_000,
    simulateHoneypot: false,
  };
}

function createOpenMeteoraCommand(): ExecutionCommand {
  return {
    cmdType: CommandType.OPEN_POSITION,
    protocol: PoolProtocol.METEORA_DLMM,
    poolId: key(),
    wallet: key(),
    positionInfo: {
      positionNftMint: key(),
      positionNftAccount: key(),
      extra: {},
    },
    tickLower: 0,
    tickUpper: 16,
    amountA: 100,
    amountB: 100,
    slippageBps: 50,
    priorityFeeMicrolamports: 12_000,
    computeUnits: 400_000,
  };
}

test("execution orchestrator dispatches swaps through Jupiter", async () => {
  const { rpc, calls } = createRpcMock();
  const orchestrator = new ExecutionOrchestrator(rpc, Keypair.generate(), 1, true);
  const mockJupiter = {
    getRecommendedPriorityFee: async () => 8_000,
    getQuote: async () => ({
      inputMint: key().toBase58(),
      outputMint: key().toBase58(),
      inAmount: 1_000_000,
      outAmount: 980_000,
      otherAmountThreshold: 970_000,
      priceImpactPct: 0.12,
      slippageBps: 50,
      routePlan: [],
      raw: { quote: true },
    }),
    swap: async () => ({
      signature: "mock-jupiter-sig",
      fee: 8_000,
      inAmount: 1_000_000,
      outAmount: 980_000,
    }),
    close: async () => undefined,
  };

  (orchestrator as unknown as { jupiter: typeof mockJupiter }).jupiter = mockJupiter;

  const result = await orchestrator.execute(createSwapCommand());

  assert.equal(result.success, true);
  assert.equal(result.signature, "mock-jupiter-sig");
  assert.equal(calls.getLatestBlockhash, 0);
  assert.equal(calls.sendRawTransaction, 0);
});

test("execution orchestrator builds and sends meteora open position instructions", async () => {
  const { rpc, calls } = createRpcMock();
  const orchestrator = new ExecutionOrchestrator(rpc, Keypair.generate(), 1, true);
  (orchestrator as unknown as { jupiter: { close: () => Promise<void> } }).jupiter = { close: async () => undefined };
  const sent: ExecutionCommand[] = [];
  (orchestrator as unknown as { sendInstructions: (instructions: unknown[], cmd: ExecutionCommand) => Promise<string> }).sendInstructions = async (_instructions, cmd) => {
    sent.push(cmd);
    return "mock-meteora-sig";
  };

  const result = await orchestrator.execute(createOpenMeteoraCommand());

  assert.equal(result.success, true);
  assert.equal(result.signature, "mock-meteora-sig");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.cmdType, CommandType.OPEN_POSITION);
  assert.equal(sent[0]?.protocol, PoolProtocol.METEORA_DLMM);
  assert.equal(calls.getLatestBlockhash, 0);
  assert.equal(calls.simulateTransaction, 0);
  assert.equal(calls.sendRawTransaction, 0);
});

function key() {
  return Keypair.generate().publicKey;
}
