import { EventEmitter } from "node:events";

export type BotEventType =
  | "pool:new"
  | "pool:tvl_drop"
  | "pool:volume_spike"
  | "wallet:dev_swap"
  | "wallet:whale_move"
  | "token:mint_active"
  | "token:rug_signal"
  | "token:migrate"
  | "mempool:large_buy"
  | "mempool:large_sell"
  | "smart_money:cluster"
  | "rug_dna:high_risk"
  | "cross_dex:spread"
  | "pumpfun:graduate"
  | "liquidity:trap"
  | "sniper:detected"
  | "position:open"
  | "position:close"
  | "fee:accumulated"
  | "social:velocity_spike"
  | "phantom:attacked"
  | "strategy:triggered";

export interface BotEvent {
  type: BotEventType;
  ts: number;
  poolAddress?: string;
  tokenMint?: string;
  walletAddress?: string;
  data: Record<string, unknown>;
}

type BotEventListener = (payload: BotEvent) => void | Promise<void>;

class BotEventBus extends EventEmitter {
  emit(event: BotEventType, payload: BotEvent): boolean {
    return super.emit(event, payload);
  }

  on(event: BotEventType, listener: BotEventListener): this {
    return super.on(event, listener);
  }

  once(event: BotEventType, listener: BotEventListener): this {
    return super.once(event, listener);
  }

  off(event: BotEventType, listener: BotEventListener): this {
    return super.off(event, listener);
  }
}

export const eventBus = new BotEventBus();
eventBus.setMaxListeners(100);
