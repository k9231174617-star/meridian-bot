import { boolean, index, jsonb, integer, pgTable, serial, text, timestamp, doublePrecision, uniqueIndex } from "drizzle-orm/pg-core";

export const botRunsTable = pgTable("bot_runs", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull(),
  status: text("status").notNull().default("running"),
  config: jsonb("config").notNull(),
  summary: jsonb("summary").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const marketSnapshotsTable = pgTable("market_snapshots", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  payload: jsonb("payload").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const botEventHistoryTable = pgTable("bot_event_history", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  strategy: text("strategy"),
  action: text("action"),
  source: text("source"),
  poolAddress: text("pool_address"),
  tokenMint: text("token_mint"),
  walletAddress: text("wallet_address"),
  confidence: doublePrecision("confidence"),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  eventIdIdx: uniqueIndex("bot_event_history_event_id_idx").on(table.eventId),
  eventTypeIdx: index("bot_event_history_event_type_idx").on(table.eventType, table.createdAt),
}));

export const botSignalsTable = pgTable("bot_signals", {
  id: serial("id").primaryKey(),
  signalId: text("signal_id").notNull(),
  signalType: text("signal_type").notNull(),
  action: text("action").notNull(),
  poolAddress: text("pool_address").notNull(),
  poolName: text("pool_name").notNull(),
  riskLevel: text("risk_level").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  severity: integer("severity").notNull(),
  reasons: jsonb("reasons").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  signalIdIdx: uniqueIndex("bot_signals_signal_id_idx").on(table.signalId),
}));

export const botTradeIntentsTable = pgTable("bot_trade_intents", {
  id: serial("id").primaryKey(),
  intentId: text("intent_id").notNull(),
  signalId: text("signal_id").notNull(),
  signalType: text("signal_type").notNull(),
  action: text("action").notNull(),
  mode: text("mode").notNull(),
  route: text("route").notNull(),
  poolAddress: text("pool_address").notNull(),
  amountUsd: doublePrecision("amount_usd").notNull(),
  slippageBps: integer("slippage_bps").notNull(),
  priorityFeeMicroLamports: integer("priority_fee_micro_lamports").notNull(),
  status: text("status").notNull().default("created"),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  intentIdIdx: uniqueIndex("bot_trade_intents_intent_id_idx").on(table.intentId),
}));

export const botPositionsTable = pgTable(
  "bot_positions",
  {
    id: serial("id").primaryKey(),
    poolAddress: text("pool_address").notNull(),
    positionAddress: text("position_address").notNull(),
    minBinId: integer("min_bin_id").notNull(),
    maxBinId: integer("max_bin_id").notNull(),
    strategyType: text("strategy_type").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    poolAddressIdx: uniqueIndex("bot_positions_pool_address_idx").on(table.poolAddress),
  }),
);

export const botExecutionsTable = pgTable("bot_executions", {
  id: serial("id").primaryKey(),
  intentId: text("intent_id").notNull(),
  status: text("status").notNull(),
  txSignature: text("tx_signature"),
  filledUsd: doublePrecision("filled_usd").notNull().default(0),
  feesUsd: doublePrecision("fees_usd").notNull().default(0),
  slippageUsd: doublePrecision("slippage_usd").notNull().default(0),
  reason: text("reason"),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  intentIdIdx: uniqueIndex("bot_executions_intent_id_idx").on(table.intentId),
}));

export const botRiskEventsTable = pgTable("bot_risk_events", {
  id: serial("id").primaryKey(),
  signalId: text("signal_id").notNull(),
  kind: text("kind").notNull(),
  severity: text("severity").notNull(),
  message: text("message").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const botRetryJobsTable = pgTable("bot_retry_jobs", {
  id: serial("id").primaryKey(),
  retryId: text("retry_id").notNull(),
  intentId: text("intent_id").notNull(),
  signalId: text("signal_id").notNull(),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  retryIdIdx: uniqueIndex("bot_retry_jobs_retry_id_idx").on(table.retryId),
  pendingIdx: uniqueIndex("bot_retry_jobs_pending_idx").on(table.retryId, table.status),
}));
