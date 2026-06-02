import { boolean, doublePrecision, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const walletProfilesTable = pgTable("wallet_profiles", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  profileType: text("profile_type").notNull(),
  score: doublePrecision("score").notNull().default(0),
  rugsCount: integer("rugs_count").notNull().default(0),
  winsCount: integer("wins_count").notNull().default(0),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  walletAddressIdx: uniqueIndex("wallet_profiles_wallet_address_idx").on(table.walletAddress),
}));

export const degenScoreHistoryTable = pgTable("degen_score_history", {
  id: serial("id").primaryKey(),
  poolAddress: text("pool_address").notNull(),
  score: doublePrecision("score").notNull(),
  previousScore: doublePrecision("previous_score"),
  delta: doublePrecision("delta"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").notNull(),
});

export const phantomAttacksTable = pgTable("phantom_attacks", {
  id: serial("id").primaryKey(),
  poolAddress: text("pool_address").notNull(),
  walletAddress: text("wallet_address"),
  attackCount: integer("attack_count").notNull().default(0),
  suspectedMev: boolean("suspected_mev").notNull().default(false),
  payload: jsonb("payload").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

export const narrativeGraphEdgesTable = pgTable("narrative_graph_edges", {
  id: serial("id").primaryKey(),
  sourceMint: text("source_mint").notNull(),
  targetMint: text("target_mint").notNull(),
  sharedHoldersCount: integer("shared_holders_count").notNull().default(0),
  weight: doublePrecision("weight").notNull().default(0),
  active: boolean("active").notNull().default(true),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  edgeIdx: uniqueIndex("narrative_graph_edges_idx").on(table.sourceMint, table.targetMint),
}));
