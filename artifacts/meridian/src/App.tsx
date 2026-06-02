import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type WalletName } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  PoolSignalType,
  PoolIlRisk,
  type Pool,
  type Position,
  useGetAnalytics,
  useGetPool,
  useGetPools,
  useGetPositions,
  useGetPrices,
  useHealthCheck,
} from "@workspace/api-client-react";
import "./dashboard.css";

const PnLChart = lazy(() => import("./components/pnl-chart").then((module) => ({ default: module.PnLChart })));

type Page = "signals" | "positions" | "analytics" | "wallet" | "settings";
type Chip = "all" | "hot" | "meteora" | "raydium" | "orca" | "smart" | "organic";
type Language = "en" | "ru";
type SupportedDex = "meteora" | "raydium" | "orca";

type WalletRow = {
  symbol: string;
  amount: number;
  valueUsd: number;
};

type WalletOptionName = "Phantom" | "Solflare" | "Backpack" | "OKX Wallet";

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string };
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toBase58(): string } } | void>;
};

type InjectedWalletProvider = PhantomProvider & {
  isSolflare?: boolean;
  isBackpack?: boolean;
  isOKXWallet?: boolean;
};

type WalletConnectSession = {
  publicKeyBase58: string;
  createdAt: number;
};

type StringMap = Record<string, string>;
type RunSummary = {
  snapshots?: number;
  cycles?: number;
  signals?: number;
  approved?: number;
  rejected?: number;
  fills?: number;
  executions?: number;
  failed?: number;
  simulatedPnlUsd?: number;
  winRate?: number;
  maxDrawdownUsd?: number;
};
type BotStatus = {
  storageDir: string;
  updatedAt: string;
  lastRun: {
    runId: number;
    status: "running" | "completed" | "failed";
    mode?: string;
    provider?: string;
    walletAddress?: string;
    startedAt?: string;
    endedAt?: string;
    summary?: RunSummary;
  } | null;
  recentAlerts: Array<{
    severity: "info" | "warning" | "critical";
    title: string;
    message: string;
    createdAt: string;
  }>;
};

type BotControls = {
  autoTradingEnabled: boolean;
  updatedAt: string;
};

type PaperTradeStatus = {
  status: "idle" | "running" | "stopping" | "completed" | "failed";
  pid?: number;
  startedAt?: string;
  endedAt?: string;
  request?: {
    cycles: number;
    intervalMs?: number;
    debug?: {
      forceSignal?: boolean;
      bypassRisk?: boolean;
    };
  };
  error?: string;
};

type DiscoveryStatus = {
  settings: {
    enabledDexes: SupportedDex[];
    updatedAt: string;
  };
  candidates: Array<{
    id: string;
    dex: SupportedDex;
    source: "meteora-api" | "wss-log" | "wss-program" | "rpc-recent" | "rpc-account" | "fallback";
    signature?: string;
    detectedAt: string;
    confidence: number;
    keywords: string[];
    pool: Pool;
  }>;
  observations: Array<{
    id: string;
    dex?: SupportedDex;
    source: "meteora-api" | "wss-log" | "wss-program" | "rpc-recent" | "rpc-account" | "fallback";
    signature?: string;
    detectedAt: string;
    keywords: string[];
    status: "accepted" | "rejected";
    reason: string;
    accounts?: string[];
  }>;
  totals: {
    candidates: number;
    meteora: number;
    raydium: number;
    orca: number;
    observations: number;
    rejected: number;
  };
};

type SignalFeed = {
  updatedAt: string;
  total: number;
  counts: Record<string, number>;
  signals: Array<{
    id: string;
    type: string;
    action: string;
    poolAddress: string;
    poolName: string;
    risk: string;
    confidence: number;
    severity: number;
    reason: string[];
    suggestedCapitalUsd: number;
    slippageBps: number;
    priorityFeeMicroLamports: number;
    degenScore?: number;
    socialVelocityScore?: number;
    whalePressureScore?: number;
    eventName?: string;
    executionHints?: {
      splitCount?: number;
      minDelayMs?: number;
      maxDelayMs?: number;
      priorityProtection?: "HIGH" | "MAX";
      hedgeTo?: string;
    };
    createdAt: string;
  }>;
};

type UiPool = Pool & {
  dex?: SupportedDex;
  discoveryConfidence?: number;
  discoverySource?: "meteora-api" | "wss-log" | "wss-program" | "rpc-recent" | "rpc-account" | "fallback";
  discoverySignature?: string;
  isDiscoveryCandidate?: boolean;
};

const STRINGS: Record<Language, StringMap> = {
  en: {
    stop: "STOP",
    start: "START",
    agentStatus: "⬡ AGENT STATUS",
    scanIn: "SCAN IN",
    poolsScanned: "POOLS SCANNED",
    signals: "SIGNALS",
    positions: "POSITIONS",
    activeSignals: "ACTIVE SIGNALS",
    jupOrganic: "JUP ORGANIC",
    smartMoney: "SMART MONEY",
    ilRisk: "IL RISK",
    low: "LOW",
    enter: "ENTER",
    watch: "WATCH",
    enterPool: "ENTER POOL →",
    viewDetail: "VIEW DETAIL",
    smartMoneyTitle: "SMART MONEY",
    recentWalletActivity: "⬡ RECENT WALLET ACTIVITY",
    myPositions: "MY POSITIONS",
    totalPnl: "TOTAL P&L",
    earnedThisWeek: "EARNED THIS WEEK",
    feesCollected: "FEES COLLECTED",
    activePools: "ACTIVE POOLS",
    invested: "INVESTED",
    feesEarned: "FEES EARNED",
    inRange: "IN RANGE",
    edge: "⚠ EDGE",
    rebalance: "⟳ REBALANCE",
    close: "✕ CLOSE",
    performance: "PERFORMANCE",
    pnlChart: "P&L CHART",
    history: "HISTORY",
    wallet: "WALLET",
    totalBalance: "TOTAL BALANCE",
    connectWallet: "CONNECT WALLET",
    connectPhantom: "CONNECT PHANTOM",
    importSecretKey: "IMPORT SECRET KEY",
    disconnectWallet: "DISCONNECT WALLET",
    deposit: "DEPOSIT",
    withdraw: "WITHDRAW",
    swap: "SWAP",
    assets: "ASSETS",
    inPools: "IN POOLS",
    connected: "CONNECTED",
    settings: "SETTINGS",
    language: "LANGUAGE",
    agent: "AGENT",
    riskLevel: "RISK LEVEL",
    filters: "FILTERS",
    about: "ABOUT",
    version: "VERSION 1.0.0 BETA",
    autoOpen: "Auto Open Positions",
    autoOpenSub: "Agent enters pools automatically",
    autoRebal: "Auto Rebalance",
    autoRebalSub: "Rebalance when price exits range",
    stopLoss: "Stop Loss",
    stopLossSub: "Close position on −15% loss",
    notifications: "Notifications",
    notificationsSub: "Push alerts for signals & positions",
    safe: "SAFE",
    balanced: "BALANCED",
    aggressive: "AGGRESSIVE",
    minTvl: "Min TVL",
    minJup: "Min Jupiter Score",
    smartThr: "Smart Money Threshold",
    settingChanged: "Setting updated",
    disconnected: "Wallet disconnected",
    agentStopped: "⬛ AGENT STOPPED",
    riskLow: "LOW RISK",
    riskBal: "BALANCED",
    riskHigh: "HIGH RISK",
    loadingDetail: "Loading pool detail...",
    rebalancing: "Rebalancing position...",
    closing: "Closing position...",
    depositMsg: "Opening deposit...",
    withdrawMsg: "Opening withdrawal...",
    swapMsg: "Opening swap...",
    connectHint: "Connect a Solana wallet to continue",
    walletAddress: "WALLET ADDRESS",
    secretKey: "SECRET KEY",
    secretKeyHint: "JSON array, hex or base64 secret key",
    connectByAddress: "CONNECT BY ADDRESS",
    walletProvider: "WALLET PROVIDER",
    connect: "CONNECT",
    cancel: "CANCEL",
    selectWallet: "Connect wallet",
    recommended: "RECOMMENDED",
    updated: "UPDATED",
    openPool: "Open pool detail",
    liveData: "LIVE DATA",
    trend: "TREND",
    scanDisabled: "SCAN PAUSED",
    scanRunning: "SCAN ACTIVE",
    noWallet: "No wallet connected",
    invalidWallet: "Enter a valid Solana wallet address first",
    copyAddress: "Copy address",
    copied: "Copied",
    summarize: "TRACKED CAPITAL",
    positionsLabel: "POSITIONS",
    pnl7d: "P&L 7D",
    winRate: "WIN RATE",
    avgHold: "AVG HOLD",
    totalTrades: "TRADES",
    currentPrice: "CURRENT PRICE",
    tvl: "TVL",
    volume24h: "VOL 24H",
    fee24h: "24H FEE",
    signalScore: "SIGNAL SCORE",
    signalScoreShort: "SCORE",
    topPools: "TOP POOLS",
    marketSnapshot: "MARKET SNAPSHOT",
    walletBalance: "TRACKED BALANCE",
    liveAssetBreakdown: "LIVE BREAKDOWN",
  },
  ru: {
    stop: "СТОП",
    start: "СТАРТ",
    agentStatus: "⬡ СТАТУС АГЕНТА",
    scanIn: "СКАН ЧЕРЕЗ",
    poolsScanned: "ПУЛОВ СКАН.",
    signals: "СИГНАЛЫ",
    positions: "ПОЗИЦИИ",
    activeSignals: "АКТИВНЫЕ СИГНАЛЫ",
    jupOrganic: "JUP ОРГАНИКА",
    smartMoney: "УМНЫЕ $",
    ilRisk: "РИСК IL",
    low: "НИЗКИЙ",
    enter: "ВОЙТИ",
    watch: "СЛЕДИТЬ",
    enterPool: "ВОЙТИ В ПУЛ →",
    viewDetail: "ПОДРОБНЕЕ",
    smartMoneyTitle: "УМНЫЕ ДЕНЬГИ",
    recentWalletActivity: "⬡ АКТИВНОСТЬ КОШЕЛЬКОВ",
    myPositions: "МОИ ПОЗИЦИИ",
    totalPnl: "ИТОГО P&L",
    earnedThisWeek: "ЗАРАБОТАНО ЗА НЕДЕЛЮ",
    feesCollected: "СБОРЫ ПОЛУЧЕНЫ",
    activePools: "АКТИВНЫХ ПУЛА",
    invested: "ВЛОЖЕНО",
    feesEarned: "СБОРЫ",
    inRange: "В ДИАПАЗОНЕ",
    edge: "⚠ НА ГРАНИ",
    rebalance: "⟳ РЕБАЛАНС",
    close: "✕ ЗАКРЫТЬ",
    performance: "ДОХОДНОСТЬ",
    pnlChart: "ГРАФИК P&L",
    history: "ИСТОРИЯ",
    wallet: "КОШЕЛЁК",
    totalBalance: "ОБЩИЙ БАЛАНС",
    connectWallet: "ПОДКЛЮЧИТЬ КОШЕЛЁК",
    connectPhantom: "PHANTOM",
    importSecretKey: "СЕКРЕТНЫЙ КЛЮЧ",
    disconnectWallet: "ОТКЛЮЧИТЬ КОШЕЛЁК",
    deposit: "ПОПОЛНИТЬ",
    withdraw: "ВЫВЕСТИ",
    swap: "ОБМЕНЯТЬ",
    assets: "АКТИВЫ",
    inPools: "В ПУЛАХ",
    connected: "ПОДКЛЮЧЁН",
    settings: "НАСТРОЙКИ",
    language: "ЯЗЫК",
    agent: "АГЕНТ",
    riskLevel: "УРОВЕНЬ РИСКА",
    filters: "ФИЛЬТРЫ",
    about: "О ПРОГРАММЕ",
    version: "ВЕРСИЯ 1.0.0 БЕТА",
    autoOpen: "Авто открытие",
    autoOpenSub: "Агент входит в пулы автоматически",
    autoRebal: "Авто ребаланс",
    autoRebalSub: "Ребаланс при выходе цены из диапазона",
    stopLoss: "Стоп-лосс",
    stopLossSub: "Закрытие позиции при убытке −15%",
    notifications: "Уведомления",
    notificationsSub: "Push-уведомления о сигналах и позициях",
    safe: "БЕЗОПАСНО",
    balanced: "БАЛАНС",
    aggressive: "АГРЕССИВНО",
    minTvl: "Мин. TVL",
    minJup: "Мин. оценка Jupiter",
    smartThr: "Порог умных денег",
    settingChanged: "Настройка обновлена",
    disconnected: "Кошелёк отключён",
    agentStopped: "⬛ АГЕНТ ОСТАНОВЛЕН",
    riskLow: "НИЗКИЙ РИСК",
    riskBal: "БАЛАНС",
    riskHigh: "ВЫСОКИЙ РИСК",
    loadingDetail: "Загружаю детали пула...",
    rebalancing: "Ребалансирую позицию...",
    closing: "Закрываю позицию...",
    depositMsg: "Открываю депозит...",
    withdrawMsg: "Открываю вывод...",
    swapMsg: "Открываю обмен...",
    connectHint: "Подключите Solana кошелёк, чтобы продолжить",
    walletAddress: "АДРЕС КОШЕЛЬКА",
    secretKey: "СЕКРЕТНЫЙ КЛЮЧ",
    secretKeyHint: "JSON массив, hex или base64 ключ",
    connectByAddress: "ПО АДРЕСУ",
    walletProvider: "WALLET PROVIDER",
    connect: "ПОДКЛЮЧИТЬ",
    cancel: "ОТМЕНА",
    selectWallet: "Подключение кошелька",
    recommended: "РЕКОМЕНДУЕТСЯ",
    updated: "ОБНОВЛЕНО",
    openPool: "Открыть детали пула",
    liveData: "ЖИВЫЕ ДАННЫЕ",
    trend: "ТРЕНД",
    scanDisabled: "СКАН ПАУЗА",
    scanRunning: "СКАН АКТИВЕН",
    noWallet: "Кошелёк не подключён",
    invalidWallet: "Сначала введите валидный адрес Solana кошелька",
    copyAddress: "Скопировать адрес",
    copied: "Скопировано",
    summarize: "ОТСЛЕЖИВАЕМЫЙ КАПИТАЛ",
    positionsLabel: "ПОЗИЦИИ",
    pnl7d: "P&L 7Д",
    winRate: "WIN RATE",
    avgHold: "СР. ДЕРЖАНИЕ",
    totalTrades: "СДЕЛКИ",
    currentPrice: "ТЕК. ЦЕНА",
    tvl: "TVL",
    volume24h: "VOL 24H",
    fee24h: "24H FEE",
    signalScore: "ОЦЕНКА",
    signalScoreShort: "СКОР",
    topPools: "ТОП ПУЛЫ",
    marketSnapshot: "РЫНОЧНЫЙ СНИМОК",
    walletBalance: "ОТСЛЕЖИВАЕМЫЙ БАЛАНС",
    liveAssetBreakdown: "СТРУКТУРА АКТИВОВ",
  },
};

const LANGUAGE_KEY = "meridian.lang";
const WALLET_KEY = "meridian.walletAddress";
const PROVIDER_KEY = "meridian.walletProvider";
const AGENT_KEY = "meridian.agentRunning";
const RISK_KEY = "meridian.risk";
const AUTO_OPEN_KEY = "meridian.autoOpen";
const AUTO_REBAL_KEY = "meridian.autoRebal";
const STOP_LOSS_KEY = "meridian.stopLoss";
const NOTIF_KEY = "meridian.notifications";
const PAGE_KEY = "meridian.page";
const MIN_TVL_KEY = "meridian.minTvl";
const MIN_JUP_KEY = "meridian.minJup";
const SMART_KEY = "meridian.smartMoney";
const CHIP_KEY = "meridian.chip";

function readStorage<T extends string>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  return (value as T | null) ?? fallback;
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  if (value === null) return fallback;
  return value === "true";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shortAddress(address: string) {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function encodeBase58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  if (bytes.length === 0) return "";

  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      const value = (digits[index] << 8) + carry;
      digits[index] = value % 58;
      carry = Math.floor(value / 58);
    }

    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let output = "";
  for (const byte of bytes) {
    if (byte === 0) output += alphabet[0];
    else break;
  }

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    output += alphabet[digits[index]];
  }

  return output;
}

function formatCurrency(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(value);
}

function formatPercent(value: number, digits = 1) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function formatTimeSince(iso: string) {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.max(1, Math.round(diff / 60000));
  if (mins < 60) return `${mins} MIN AGO`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}H AGO`;
  const days = Math.round(hours / 24);
  return `${days}D AGO`;
}

function formatRelativeShort(iso: string) {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.max(1, Math.round(diff / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function riskLabel(risk: number, t: StringMap) {
  if (risk < 33) return t.riskLow;
  if (risk < 67) return t.riskBal;
  return t.riskHigh;
}

function poolTone(pool: Pool) {
  if (pool.signalType === PoolSignalType.ENTER) return "hot";
  if (pool.signalType === PoolSignalType.AVOID) return "warm";
  return "warm";
}

function ilRiskScore(risk: string) {
  if (risk === PoolIlRisk.LOW) return 24;
  if (risk === PoolIlRisk.MEDIUM) return 56;
  return 86;
}

function TokenBadge({ symbol, colorClass, label }: { symbol: string; colorClass: string; label?: string }) {
  return <div className={`token-avatar ${colorClass}`}>{label ?? symbol}</div>;
}

function MetricBox({
  value,
  label,
  valueClass = "",
  compact = false,
}: {
  value: string;
  label: string;
  valueClass?: string;
  compact?: boolean;
}) {
  return (
    <div className={`metric ${compact ? "metric-compact" : ""}`}>
      <div className={`metric-val ${valueClass}`}>{value}</div>
      <div className="metric-lbl">{label}</div>
    </div>
  );
}

function StatBox({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="stat-box">
      <div className="stat-val" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="stat-lbl">{label}</div>
    </div>
  );
}

function SmallBadge({ text, tone }: { text: string; tone: "green" | "cyan" | "violet" | "orange" | "red" }) {
  const className =
    tone === "green"
      ? "badge-enter"
      : tone === "violet"
        ? "badge-watch"
        : tone === "orange"
          ? "badge-watch"
          : tone === "red"
            ? "badge-watch"
            : "badge-watch";
  return <div className={`signal-badge ${className}`}>{text}</div>;
}

function formatPoolScore(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))} `;
}

async function fetchBotStatus(): Promise<BotStatus> {
  const response = await fetch("/api/bot/status", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Bot status request failed: ${response.status}`);
  }

  return (await response.json()) as BotStatus;
}

async function fetchPaperTradeStatus(): Promise<PaperTradeStatus> {
  const response = await fetch("/api/bot/paper-trade/status", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Paper trade status request failed: ${response.status}`);
  }

  return (await response.json()) as PaperTradeStatus;
}

async function fetchBotControls(): Promise<BotControls> {
  const response = await fetch("/api/bot/controls", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Bot controls request failed: ${response.status}`);
  }

  return (await response.json()) as BotControls;
}

async function saveBotControls(autoTradingEnabled: boolean): Promise<BotControls> {
  const response = await fetch("/api/bot/controls", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ autoTradingEnabled }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Bot controls update failed: ${response.status}`);
  }

  return payload as BotControls;
}

async function fetchDiscoveryStatus(): Promise<DiscoveryStatus> {
  const response = await fetch("/api/bot/discovery", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Discovery status request failed: ${response.status}`);
  }

  return (await response.json()) as DiscoveryStatus;
}

async function fetchSignalFeed(): Promise<SignalFeed> {
  const response = await fetch("/api/bot/signals", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Signal feed request failed: ${response.status}`);
  }

  return (await response.json()) as SignalFeed;
}

async function saveDiscoverySettings(enabledDexes: SupportedDex[]): Promise<DiscoveryStatus> {
  const response = await fetch("/api/bot/discovery", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ enabledDexes }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Discovery settings request failed: ${response.status}`);
  }

  return payload as DiscoveryStatus;
}

async function stopPaperTrade(): Promise<PaperTradeStatus> {
  const response = await fetch("/api/bot/paper-trade/stop", {
    method: "POST",
    headers: { Accept: "application/json" },
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Stop paper trade request failed: ${response.status}`);
  }

  return payload as PaperTradeStatus;
}

function App() {
  const queryClient = useQueryClient();
  const [lang, setLang] = useState<Language>(() => readStorage(LANGUAGE_KEY, "en"));
  const [currentPage, setCurrentPage] = useState<Page>(() => readStorage(PAGE_KEY, "signals") as Page);
  const [agentRunning, setAgentRunning] = useState(() => readBool(AGENT_KEY, true));
  const [risk, setRisk] = useState(() => Number(readStorage(RISK_KEY, "40")) || 40);
  const [autoOpen, setAutoOpen] = useState(() => readBool(AUTO_OPEN_KEY, true));
  const [autoRebal, setAutoRebal] = useState(() => readBool(AUTO_REBAL_KEY, true));
  const [stopLoss, setStopLoss] = useState(() => readBool(STOP_LOSS_KEY, true));
  const [notifications, setNotifications] = useState(() => readBool(NOTIF_KEY, true));
  const [walletAddress, setWalletAddress] = useState<string>(() => readStorage(WALLET_KEY, ""));
  const [walletProvider, setWalletProvider] = useState<string>(() => readStorage(PROVIDER_KEY, "Phantom"));
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [chip, setChip] = useState<Chip>(() => readStorage(CHIP_KEY, "all") as Chip);
  const [minTvl, setMinTvl] = useState(() => Number(readStorage(MIN_TVL_KEY, "500000")) || 500000);
  const [minJup, setMinJup] = useState(() => Number(readStorage(MIN_JUP_KEY, "60")) || 60);
  const [smartThreshold, setSmartThreshold] = useState(() => Number(readStorage(SMART_KEY, "40")) || 40);
  const [selectedPoolAddress, setSelectedPoolAddress] = useState<string | null>(null);
  const [toast, setToast] = useState<string>("");
  const [scanSeconds, setScanSeconds] = useState(18 * 60 + 24);
  const [paperTradeCycles, setPaperTradeCycles] = useState(() => Number(readStorage("paper_trade_cycles", "5")) || 5);
  const [paperTradeDebugForceSignal, setPaperTradeDebugForceSignal] = useState(() =>
    readBool("paper_trade_debug_force_signal", true),
  );
  const [paperTradeDebugBypassRisk, setPaperTradeDebugBypassRisk] = useState(() =>
    readBool("paper_trade_debug_bypass_risk", true),
  );
  const [enabledDexes, setEnabledDexes] = useState<SupportedDex[]>(["meteora", "raydium", "orca"]);
  const { select, connect, wallet: activeAdapterWallet, connected: adapterConnected, publicKey: adapterPublicKey, wallets: adapterWallets } = useWallet();
  const walletConnectSessionRef = useRef<WalletConnectSession | null>(null);
  const [walletConnectReady, setWalletConnectReady] = useState(false);

  const t = STRINGS[lang];
  const walletValid = walletAddress.trim().length >= 32;
  const canQueryWallet = walletConnected && walletValid;
  const isMobileDevice = useMemo(() => /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent), []);
  const adapterWalletNames = useMemo<Set<string>>(
    () => new Set(adapterWallets.map((entry) => entry.adapter.name)),
    [adapterWallets],
  );

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_KEY, lang);
  }, [lang]);

  useEffect(() => {
    window.localStorage.setItem(PAGE_KEY, currentPage);
  }, [currentPage]);

  useEffect(() => {
    window.localStorage.setItem(AGENT_KEY, String(agentRunning));
  }, [agentRunning]);

  useEffect(() => {
    window.localStorage.setItem(RISK_KEY, String(risk));
  }, [risk]);

  useEffect(() => {
    window.localStorage.setItem(AUTO_OPEN_KEY, String(autoOpen));
  }, [autoOpen]);

  useEffect(() => {
    window.localStorage.setItem(AUTO_REBAL_KEY, String(autoRebal));
  }, [autoRebal]);

  useEffect(() => {
    window.localStorage.setItem(STOP_LOSS_KEY, String(stopLoss));
  }, [stopLoss]);

  useEffect(() => {
    window.localStorage.setItem(NOTIF_KEY, String(notifications));
  }, [notifications]);

  useEffect(() => {
    window.localStorage.setItem(WALLET_KEY, walletAddress);
  }, [walletAddress]);

  useEffect(() => {
    window.localStorage.setItem(PROVIDER_KEY, walletProvider);
  }, [walletProvider]);

  useEffect(() => {
    window.localStorage.setItem(MIN_TVL_KEY, String(minTvl));
  }, [minTvl]);

  useEffect(() => {
    window.localStorage.setItem(MIN_JUP_KEY, String(minJup));
  }, [minJup]);

  useEffect(() => {
    window.localStorage.setItem(SMART_KEY, String(smartThreshold));
  }, [smartThreshold]);

  useEffect(() => {
    window.localStorage.setItem("paper_trade_cycles", String(paperTradeCycles));
  }, [paperTradeCycles]);

  useEffect(() => {
    window.localStorage.setItem("paper_trade_debug_force_signal", String(paperTradeDebugForceSignal));
  }, [paperTradeDebugForceSignal]);

  useEffect(() => {
    window.localStorage.setItem("paper_trade_debug_bypass_risk", String(paperTradeDebugBypassRisk));
  }, [paperTradeDebugBypassRisk]);

  useEffect(() => {
    window.localStorage.setItem(CHIP_KEY, chip);
  }, [chip]);

  useEffect(() => {
    let cancelled = false;

    async function prepareWalletConnectSession() {
      try {
        setWalletConnectReady(false);
        const keyPair = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
        const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
        if (cancelled) return;

        walletConnectSessionRef.current = {
          publicKeyBase58: encodeBase58(rawPublicKey),
          createdAt: Date.now(),
        };
        setWalletConnectReady(true);
      } catch {
        if (cancelled) return;
        walletConnectSessionRef.current = null;
        setWalletConnectReady(false);
      }
    }

    void prepareWalletConnectSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!adapterConnected || !adapterPublicKey || !activeAdapterWallet) return;

    const address = adapterPublicKey.toBase58();
    setWalletAddress(address);
    setWalletProvider(activeAdapterWallet.adapter.name);
    setWalletConnected(true);
    setWalletModalOpen(false);
  }, [activeAdapterWallet, adapterConnected, adapterPublicKey]);

  useEffect(() => {
    if (!agentRunning) return;
    const timer = window.setInterval(() => {
      setScanSeconds((current) => (current <= 0 ? 18 * 60 + 24 : current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [agentRunning]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const poolsQuery = useGetPools(
    { limit: 8, minTvl, minJupScore: minJup },
    {
      query: {
        queryKey: ["pools", minTvl, minJup],
        refetchInterval: 30_000,
      },
    },
  );

  const pools = (poolsQuery.data?.pools ?? []) as UiPool[];

  const visiblePools = useMemo(() => {
    const base = [...pools].sort((a, b) => b.signalScore - a.signalScore);

    switch (chip) {
      case "hot":
        return base.filter((pool) => pool.signalType === PoolSignalType.ENTER);
      case "meteora":
        return base.filter((pool) => (pool.dex ?? "meteora") === "meteora");
      case "raydium":
        return base.filter((pool) => pool.dex === "raydium");
      case "orca":
        return base.filter((pool) => pool.dex === "orca");
      case "smart":
        return base.filter((pool) => pool.smartMoneyScore >= smartThreshold);
      case "organic":
        return base.filter((pool) => pool.jupScore >= minJup);
      case "all":
      default:
        return base;
    }
  }, [chip, minJup, pools, smartThreshold]);

  const defaultSelectedPool = visiblePools[0]?.address ?? pools[0]?.address ?? "";
  const activePoolAddress = selectedPoolAddress ?? defaultSelectedPool;

  const poolDetailQuery = useGetPool(activePoolAddress, {
    query: {
      queryKey: ["pool", activePoolAddress],
      enabled: activePoolAddress.length > 0,
      refetchInterval: 45_000,
    },
  });

  const positionsQuery = useGetPositions(
    { wallet: walletAddress || "0" },
    {
      query: {
        queryKey: ["positions", walletAddress],
        enabled: canQueryWallet,
        refetchInterval: 30_000,
      },
    },
  );

  const analyticsQuery = useGetAnalytics(
    { wallet: walletAddress || "0" },
    {
      query: {
        queryKey: ["analytics", walletAddress],
        enabled: canQueryWallet,
        refetchInterval: 45_000,
      },
    },
  );

  const priceSymbols = useMemo(() => {
    const symbols = new Set<string>(["SOL", "USDC", "JUP", "RAY", "BONK"]);
    for (const pool of pools) {
      symbols.add(pool.tokenX);
      symbols.add(pool.tokenY);
    }
    for (const position of positionsQuery.data?.positions ?? []) {
      symbols.add(position.tokenX);
      symbols.add(position.tokenY);
    }
    return Array.from(symbols).filter(Boolean).slice(0, 12);
  }, [pools, positionsQuery.data?.positions]);

  const pricesQuery = useGetPrices(
    { tokens: priceSymbols.join(",") },
    {
      query: {
        queryKey: ["prices", priceSymbols.join(",")],
        enabled: priceSymbols.length > 0,
        refetchInterval: 60_000,
      },
    },
  );

  const healthQuery = useHealthCheck({
    query: {
      queryKey: ["health"],
      refetchInterval: 30_000,
    },
  });
  const statusQuery = useQuery({
    queryKey: ["bot-status"],
    queryFn: fetchBotStatus,
    refetchInterval: 30_000,
  });
  const paperTradeStatusQuery = useQuery({
    queryKey: ["paper-trade-status"],
    queryFn: fetchPaperTradeStatus,
    refetchInterval: 10_000,
  });
  const botControlsQuery = useQuery({
    queryKey: ["bot-controls"],
    queryFn: fetchBotControls,
    refetchInterval: 20_000,
  });
  const botControlsMutation = useMutation({
    mutationFn: saveBotControls,
    onSuccess: async () => {
      toastMessage(lang === "ru" ? "Автотрейдинг переключен" : "Auto trading toggled");
      await Promise.all([statusQuery.refetch(), botControlsQuery.refetch()]);
    },
    onError: (error) => {
      toastMessage(error instanceof Error ? error.message : String(error));
    },
  });
  const paperTradeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/bot/paper-trade", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          cycles: paperTradeCycles,
          debug: {
            forceSignal: paperTradeDebugForceSignal,
            bypassRisk: paperTradeDebugBypassRisk,
          },
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Paper trade request failed: ${response.status}`);
      }

      return payload;
    },
    onSuccess: async () => {
      toastMessage(lang === "ru" ? "▶ Paper trading запущен" : "▶ Paper trading started");
      await Promise.all([
        statusQuery.refetch(),
        paperTradeStatusQuery.refetch(),
        signalFeedQuery.refetch(),
      ]);
    },
    onError: (error) => {
      toastMessage(error instanceof Error ? error.message : String(error));
    },
  });
  const paperTradeStopMutation = useMutation({
    mutationFn: stopPaperTrade,
    onSuccess: async () => {
      toastMessage(lang === "ru" ? "⏹ Paper trading остановлен" : "⏹ Paper trading stopped");
      await Promise.all([
        statusQuery.refetch(),
        paperTradeStatusQuery.refetch(),
        signalFeedQuery.refetch(),
      ]);
    },
    onError: (error) => {
      toastMessage(error instanceof Error ? error.message : String(error));
    },
  });
  const discoveryQuery = useQuery({
    queryKey: ["discovery"],
    queryFn: fetchDiscoveryStatus,
    refetchInterval: 30_000,
  });
  const signalFeedQuery = useQuery({
    queryKey: ["signal-feed"],
    queryFn: fetchSignalFeed,
    refetchInterval: 15_000,
    staleTime: 5_000,
    gcTime: 60_000,
  });
  const discoveryMutation = useMutation({
    mutationFn: saveDiscoverySettings,
    onSuccess: async (result) => {
      setEnabledDexes(result.settings.enabledDexes);
      toastMessage(lang === "ru" ? "Настройки DEX обновлены" : "DEX settings updated");
      await discoveryQuery.refetch();
    },
    onError: (error) => {
      toastMessage(error instanceof Error ? error.message : String(error));
    },
  });

  const analytics = analyticsQuery.data;
  const positions = positionsQuery.data?.positions ?? [];
  const prices = pricesQuery.data?.prices ?? {};
  const discovery = discoveryQuery.data;
  const signalFeed = signalFeedQuery.data;
  const botControls = botControlsQuery.data;
  const autoTradingEnabled = botControls?.autoTradingEnabled ?? false;
  const previousPaperTradeStatus = useRef<PaperTradeStatus["status"] | undefined>(undefined);
  useEffect(() => {
    if (discovery?.settings.enabledDexes) {
      setEnabledDexes(discovery.settings.enabledDexes);
    }
  }, [discovery?.settings.enabledDexes]);
  useEffect(() => {
    const currentStatus = paperTradeStatusQuery.data?.status;
    const previousStatus = previousPaperTradeStatus.current;
    if (currentStatus === "completed" && previousStatus !== "completed") {
      void queryClient.invalidateQueries({ queryKey: ["signal-feed"] });
      void queryClient.invalidateQueries({ queryKey: ["bot-status"] });
    }
    previousPaperTradeStatus.current = currentStatus;
  }, [paperTradeStatusQuery.data?.status, queryClient]);
  const totalPnlUsd = analytics?.totalPnlUsd ?? positionsQuery.data?.totalPnlUsd ?? 0;
  const totalFeesEarned = analytics?.totalFeesEarned ?? positionsQuery.data?.totalFeesEarned ?? 0;
  const totalLiquidityUsd = positionsQuery.data?.totalLiquidityUsd ?? 0;
  const totalTrades = analytics?.totalTrades ?? positions.length;
  const winRate = analytics?.winRate ?? 0;
  const avgHoldHours = analytics?.avgHoldTime ?? 0;
  const pnlHistory = analytics?.pnlHistory ?? [];
  const trackedBalanceUsd = Math.max(0, totalLiquidityUsd + totalPnlUsd);
  const activePoolsCount = positions.length;
  const activeSignalsCount = visiblePools.filter((pool) => pool.signalType === PoolSignalType.ENTER).length;
  const discoveryCandidates = discovery?.candidates ?? [];
  const discoveryObservations = discovery?.observations ?? [];
  const discoveryTotals = discovery?.totals ?? { candidates: 0, meteora: 0, raydium: 0, orca: 0, observations: 0, rejected: 0 };
  const recentSignals = signalFeed?.signals ?? [];
  const signalCounts = signalFeed?.counts ?? {};
  const topSignalType = Object.entries(signalCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "NONE";
  const botStatus = statusQuery.data;
  const liveWalletAddress = botStatus?.lastRun?.walletAddress ?? "";
  const liveWalletLabel = liveWalletAddress ? shortAddress(liveWalletAddress) : "not configured";

  const sortedPositions = useMemo(
    () => [...positions].sort((a, b) => b.liquidityUsd - a.liquidityUsd),
    [positions],
  );

  const positionWalletRows = useMemo(() => {
    const map = new Map<string, { amount: number; valueUsd: number }>();

    for (const position of positions) {
      const xPrice = prices[position.tokenX]?.price ?? 0;
      const yPrice = prices[position.tokenY]?.price ?? 0;

      const currentX = map.get(position.tokenX) ?? { amount: 0, valueUsd: 0 };
      currentX.amount += position.tokenXAmount;
      currentX.valueUsd += position.tokenXAmount * xPrice;
      map.set(position.tokenX, currentX);

      const currentY = map.get(position.tokenY) ?? { amount: 0, valueUsd: 0 };
      currentY.amount += position.tokenYAmount;
      currentY.valueUsd += position.tokenYAmount * yPrice;
      map.set(position.tokenY, currentY);
    }

    return Array.from(map.entries())
      .map(([symbol, values]) => ({ symbol, ...values }))
      .sort((a, b) => b.valueUsd - a.valueUsd);
  }, [positions, prices]);

  const poolActivityRows = useMemo(() => {
    return [...positions]
      .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())
      .slice(0, 3)
      .map((position, index) => ({
        id: `${position.address}-${index}`,
        wallet: shortAddress(position.address || position.poolAddress),
        action: position.inRange ? t.connected : t.updated,
        amount: formatCurrency(position.liquidityUsd, 0),
        tone: position.pnlUsd >= 0 ? "sm-entered" : "sm-exited",
      }));
  }, [positions, t.connected, t.updated]);

  const historyRows = useMemo(() => {
    const items = [...(pnlHistory ?? [])].slice(-4).reverse();
    return items.map((item, index) => ({
      id: `${item.date}-${index}`,
      name: index === 0 ? "SOL/USDC" : index === 1 ? "RAY/USDC" : index === 2 ? "JUP/SOL" : "BONK/SOL",
      time: `${formatRelativeShort(item.date).toUpperCase()}`,
      pnl: item.pnl,
      tone: item.pnl >= 0 ? "up" : "down",
      icon: index === 0 ? "open" : index === 1 ? "rebal" : "close",
    }));
  }, [pnlHistory]);

  const chartData = useMemo(
    () => (pnlHistory ?? []).map((point) => ({ date: point.date, pnl: point.pnl })),
    [pnlHistory],
  );

  const selectedPool = useMemo(
    () => poolDetailQuery.data ?? visiblePools.find((pool) => pool.address === activePoolAddress) ?? pools[0] ?? null,
    [activePoolAddress, poolDetailQuery.data, pools, visiblePools],
  );

  const selectedPoolYield = selectedPool && selectedPool.tvl > 0 ? (selectedPool.fee24h / selectedPool.tvl) * 100 : 0;

  function toastMessage(message: string) {
    setToast(message);
  }

  function switchPage(page: Page) {
    setCurrentPage(page);
  }

  function toggleAgent() {
    setAgentRunning((current) => {
      const next = !current;
      toastMessage(next ? (lang === "ru" ? "▶ Агент запущен" : "▶ Agent started") : (lang === "ru" ? "⬛ Агент остановлен" : "⬛ Agent stopped"));
      return next;
    });
  }

  function toggleLanguage(next: Language) {
    setLang(next);
    toastMessage(next === "ru" ? "Язык: Русский" : "Language: English");
  }

  function toggleDex(dex: SupportedDex) {
    const next = enabledDexes.includes(dex)
      ? enabledDexes.filter((item) => item !== dex)
      : [...enabledDexes, dex];
    const normalized: SupportedDex[] = next.length > 0 ? next : ["meteora"];
    setEnabledDexes(normalized);
    discoveryMutation.mutate(normalized);
  }

  function resolveInjectedWalletProvider(providerName: WalletOptionName) {
    const injected = window as Window & Record<string, any>;

    switch (providerName) {
      case "Phantom":
        return (injected.solana ?? injected.phantom?.solana ?? injected.phantom) as InjectedWalletProvider | undefined;
      case "Solflare":
        return (injected.solflare ?? injected.solana) as InjectedWalletProvider | undefined;
      case "Backpack":
        return (injected.backpack ?? injected.solana) as InjectedWalletProvider | undefined;
      case "OKX Wallet":
        return (injected.okxwallet?.solana ?? injected.okxwallet ?? injected.okx?.solana ?? injected.solana) as InjectedWalletProvider | undefined;
      default:
        return undefined;
    }
  }

  function buildMobileWalletConnectUrl(providerName: WalletOptionName) {
    const session = walletConnectSessionRef.current;
    if (!session?.publicKeyBase58) {
      throw new Error("Wallet connection session is still preparing");
    }

    const appUrl = encodeURIComponent(window.location.origin);
    const redirectLink = encodeURIComponent(window.location.href);
    const cluster = "mainnet-beta";

    switch (providerName) {
      case "Phantom":
        return `https://phantom.app/ul/v1/connect?app_url=${appUrl}&dapp_encryption_public_key=${session.publicKeyBase58}&redirect_link=${redirectLink}`;
      case "Solflare":
        return `https://solflare.com/ul/v1/connect?app_url=${appUrl}&dapp_encryption_public_key=${session.publicKeyBase58}&redirect_link=${redirectLink}&cluster=${cluster}`;
      case "Backpack":
        return `https://backpack.app/ul/v1/connect?app_url=${appUrl}&dapp_encryption_public_key=${session.publicKeyBase58}&redirect_link=${redirectLink}&cluster=${cluster}`;
      case "OKX Wallet": {
        const okxDeepLink = `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(window.location.href)}`;
        return `https://web3.okx.com/download?deeplink=${encodeURIComponent(okxDeepLink)}`;
      }
      default:
        return window.location.href;
    }
  }

  async function connectWalletProvider(providerName: WalletOptionName) {
    if (isMobileDevice) {
      try {
        const url = buildMobileWalletConnectUrl(providerName);
        window.location.href = url;
        return;
      } catch (error) {
        toastMessage(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    if (providerName === "Phantom" || providerName === "Solflare") {
      if (adapterWalletNames.has(providerName)) {
        try {
          select(providerName as WalletName<string>);
          await connect();
          toastMessage(`${providerName} connection requested`);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/not ready|not detected|not installed/i.test(message)) {
            window.location.href = buildMobileWalletConnectUrl(providerName);
            toastMessage(`Opening ${providerName}`);
            return;
          }
          toastMessage(message);
          return;
        }
      }

      window.location.href = buildMobileWalletConnectUrl(providerName);
      toastMessage(`Opening ${providerName}`);
      return;
    }

    const provider = resolveInjectedWalletProvider(providerName);
    if (!provider?.connect) {
      window.location.href = buildMobileWalletConnectUrl(providerName);
      toastMessage(`Opening ${providerName}`);
      return;
    }

    try {
      const response = await provider.connect({ onlyIfTrusted: false });
      const address = response?.publicKey?.toBase58() ?? provider.publicKey?.toBase58();
      if (!address) {
        throw new Error(`${providerName} did not return a wallet address`);
      }

      setWalletAddress(address);
      setWalletProvider(providerName);
      setWalletConnected(true);
      setWalletModalOpen(false);
      toastMessage(`${providerName} · ${shortAddress(address)} connected`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not ready|not detected|not installed/i.test(message)) {
        window.location.href = buildMobileWalletConnectUrl(providerName);
        toastMessage(`Opening ${providerName}`);
        return;
      }
      toastMessage(message);
    }
  }

  function disconnectWallet() {
    setWalletConnected(false);
    if (activeAdapterWallet) {
      void activeAdapterWallet.adapter.disconnect().catch(() => undefined);
    }
    toastMessage(t.disconnected);
  }

  function copyAddress(address: string) {
    navigator.clipboard.writeText(address).then(
      () => toastMessage(t.copied),
      () => toastMessage(address),
    );
  }

  function cycleMinTvl() {
    const next = minTvl >= 5_000_000 ? 500_000 : minTvl >= 1_000_000 ? 5_000_000 : 1_000_000;
    setMinTvl(next);
    toastMessage(`${t.minTvl}: ${formatCurrency(next)}`);
  }

  function cycleMinJup() {
    const next = minJup >= 80 ? 60 : minJup >= 70 ? 80 : 70;
    setMinJup(next);
    toastMessage(`${t.minJup}: ${next}+`);
  }

  function cycleSmartMoney() {
    const next = smartThreshold >= 60 ? 40 : smartThreshold >= 50 ? 60 : 50;
    setSmartThreshold(next);
    toastMessage(`${t.smartThr}: ${next}+`);
  }

  function handleEnterPool(pool: Pool) {
    if (!walletConnected) {
      setWalletModalOpen(true);
      toastMessage(t.connectHint);
      return;
    }
    setSelectedPoolAddress(pool.address);
    switchPage("positions");
    toastMessage(`${t.enterPool} ${pool.name}`);
  }

  function handlePoolDetail(pool: Pool) {
    setSelectedPoolAddress(pool.address);
    toastMessage(`${t.openPool} · ${shortAddress(pool.address)}`);
  }

  function handleRebalance(position: Position) {
    if (!walletConnected) {
      setWalletModalOpen(true);
      toastMessage(t.connectHint);
      return;
    }
    toastMessage(`${t.rebalancing} ${position.poolName}`);
  }

  function handleClose(position: Position) {
    if (!walletConnected) {
      setWalletModalOpen(true);
      toastMessage(t.connectHint);
      return;
    }
    toastMessage(`${t.closing} ${position.poolName}`);
  }

  function handleDeposit() {
    toastMessage(t.depositMsg);
  }

  function handleWithdraw() {
    toastMessage(t.withdrawMsg);
  }

  function handleSwap() {
    toastMessage(t.swapMsg);
  }

  function startPaperTrade() {
    if (paperTradeRunning) {
      paperTradeStopMutation.mutate();
      return;
    }
    paperTradeMutation.mutate();
  }

  function toggleAutoTrading() {
    botControlsMutation.mutate(!autoTradingEnabled);
  }

  function walletBalanceLabel() {
    return walletConnected ? shortAddress(walletAddress) : t.noWallet;
  }

  const paperTradeStatus = paperTradeStatusQuery.data;
  const paperTradeRunning = paperTradeStatus?.status === "running" || paperTradeStatus?.status === "stopping";
  const liveTradingLabel = autoTradingEnabled ? "ENABLED" : "DISABLED";
  const liveTradingTone = autoTradingEnabled ? "running" : "failed";
  const walletOptions: Array<{
    name: WalletOptionName;
    subtitle: string;
    icon: string;
    accent: string;
    recommended?: boolean;
  }> = [
    { name: "Phantom", subtitle: "Most popular Solana wallet", icon: "P", accent: "var(--neon-cyan)", recommended: true },
    { name: "Solflare", subtitle: "Native Solana wallet", icon: "S", accent: "var(--neon-yellow)" },
    { name: "Backpack", subtitle: "xNFT wallet by Coral", icon: "B", accent: "var(--neon-orange)" },
    { name: "OKX Wallet", subtitle: "Multi-chain wallet", icon: "OK", accent: "var(--neon-red)" },
  ];
  const paperSessionSummary = paperTradeStatus?.status === "running"
    ? `PID ${paperTradeStatus.pid ?? "?"} · cycles ${paperTradeStatus.request?.cycles ?? paperTradeCycles}`
    : paperTradeStatus?.status === "completed"
      ? `Completed ${paperTradeStatus.endedAt ? formatRelativeShort(paperTradeStatus.endedAt) : "recently"}`
      : paperTradeStatus?.status === "failed"
        ? `Failed${paperTradeStatus.error ? ` · ${paperTradeStatus.error}` : ""}`
        : "No active test session";
  const runSummary: RunSummary = botStatus?.lastRun?.summary ?? {};
  const summaryExecutions = runSummary.executions ?? ((runSummary.fills ?? 0) + (runSummary.failed ?? 0));
  const apiHealthy = healthQuery.data?.status === "ok";
  const latestAlert = botStatus?.recentAlerts[0];
  const poolsLoadError = poolsQuery.error instanceof Error ? poolsQuery.error.message : poolsQuery.error ? String(poolsQuery.error) : "";
  const positionsLoadError = positionsQuery.error instanceof Error ? positionsQuery.error.message : positionsQuery.error ? String(positionsQuery.error) : "";
  const analyticsLoadError = analyticsQuery.error instanceof Error ? analyticsQuery.error.message : analyticsQuery.error ? String(analyticsQuery.error) : "";
  const pricesLoadError = pricesQuery.error instanceof Error ? pricesQuery.error.message : pricesQuery.error ? String(pricesQuery.error) : "";

  return (
    <main className="dashboard-root min-h-screen bg-background text-foreground">
      <div className={`page ${currentPage === "signals" ? "active" : ""}`} id="page-signals">
        <div className="header">
          <div className="logo-wrap">
            <div className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "#00ffcc" }}>
                <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
            </div>
            <div>
              <div className="logo-text">MERIDIAN</div>
              <div className="logo-sub">METEORA DLMM AGENT</div>
            </div>
          </div>
          <button className={`agent-toggle ${agentRunning ? "running" : "stopped"}`} id="btn-toggle-1" onClick={toggleAgent} type="button">
            <div className="toggle-dot" />
            <span className="btn-toggle-lbl">{agentRunning ? STRINGS[lang].stop : STRINGS[lang].start}</span>
          </button>
        </div>

        <div className="card" id="agentCard">
          <div className="scan-line" />
          <div className={`stopped-overlay ${agentRunning ? "" : "show"}`} id="stoppedOverlay">
            <div className="stopped-msg" id="stoppedMsg">
              {t.agentStopped}
            </div>
          </div>
          <div className="agent-header">
            <div className="section-label" id="lbl-agent-status">
              {t.agentStatus}
            </div>
            <div className="scan-timer">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12,6 12,12 16,14" />
              </svg>
              <span id="scanTimerText">
                {t.scanIn} {String(Math.floor(scanSeconds / 60)).padStart(2, "0")}:{String(scanSeconds % 60).padStart(2, "0")}
              </span>
            </div>
          </div>
          <div className="timer-bar-wrap">
            <div className="timer-bar" id="timerBar" style={{ animationPlayState: agentRunning ? "running" : "paused", opacity: agentRunning ? 1 : 0.35 }} />
          </div>
          <div className="agent-stats">
            <StatBox value={String(poolsQuery.data?.total ?? pools.length)} label={t.poolsScanned} />
            <StatBox value={String(activeSignalsCount)} label={t.signals} color="#39ff14" />
            <StatBox value={String(activePoolsCount)} label={t.positions} color="#00b4ff" />
          </div>
        </div>

        <div className="settings-section">
          <div className="section-label mb-3">BOT RUNTIME</div>
          <div className="grid grid-auto-fit-compact gap-2">
            <div className="metric metric-compact">
              <div className="metric-val">{botStatus?.lastRun ? botStatus.lastRun.status.toUpperCase() : "NO RUN"}</div>
              <div className="metric-lbl">Last run</div>
            </div>
            <div className="metric metric-compact">
              <div className="metric-val">{botStatus?.lastRun?.mode?.toUpperCase() ?? "N/A"}</div>
              <div className="metric-lbl">Mode</div>
            </div>
            <div className="metric metric-compact">
              <div className="metric-val">{botStatus?.lastRun?.provider?.toUpperCase() ?? "N/A"}</div>
              <div className="metric-lbl">Data source</div>
            </div>
            <div className="metric metric-compact">
              <div className="metric-val">{Number(runSummary.snapshots ?? 0)}</div>
              <div className="metric-lbl">Snapshots</div>
            </div>
            <div className="metric metric-compact">
              <div className="metric-val">{Number(runSummary.signals ?? 0)}</div>
              <div className="metric-lbl">Signals</div>
            </div>
            <div className="metric metric-compact">
              <div className="metric-val">{Number(runSummary.approved ?? 0)}</div>
              <div className="metric-lbl">Approved</div>
            </div>
            <div className="metric metric-compact">
              <div className="metric-val">{Number(summaryExecutions ?? 0)}</div>
              <div className="metric-lbl">Executions</div>
            </div>
            <div className="metric metric-compact">
              <div className="metric-val">{enabledDexes.length}</div>
              <div className="metric-lbl">DEX enabled</div>
            </div>
            <div className="metric metric-compact">
              <div className="metric-val">{discoveryCandidates.length}</div>
              <div className="metric-lbl">Discovered</div>
            </div>
            <div className="metric metric-compact">
              <div className="metric-val">{botStatus?.recentAlerts.length ?? 0}</div>
              <div className="metric-lbl">Recent alerts</div>
            </div>
            <div className="metric metric-compact">
              <div className="metric-val">{botStatus ? formatRelativeShort(botStatus.updatedAt) : "—"}</div>
              <div className="metric-lbl">Updated</div>
            </div>
          </div>
          <div className="runtime-control-bar">
            <div className="runtime-control-group runtime-control-live">
              <div className="runtime-control-label">AUTO TRADING</div>
              <div className={`runtime-control-pill ${liveTradingTone}`}>{liveTradingLabel}</div>
              <div className="runtime-control-sub">
                Live wallet: {liveWalletLabel}
                <br />
                {autoTradingEnabled
                  ? "Live execution is allowed and will use the connected wallet."
                  : "Live execution is blocked. Bot still scans and scores signals."}
              </div>
              <button
                className={`connect-wallet-btn runtime-control-button ${autoTradingEnabled ? "active" : "inactive"}`}
                type="button"
                onClick={toggleAutoTrading}
                disabled={botControlsMutation.isPending}
              >
                {botControlsMutation.isPending
                  ? "UPDATING..."
                  : autoTradingEnabled
                    ? "AUTO TRADING: ON"
                    : "AUTO TRADING: OFF"}
              </button>
            </div>
            <div className="runtime-control-group runtime-control-paper">
              <div className="runtime-control-label">PAPER TRADING</div>
              <div className={`runtime-control-pill ${paperTradeStatus?.status === "running" || paperTradeStatus?.status === "stopping" ? "running" : paperTradeStatus?.status === "failed" ? "failed" : "completed"}`}>
                {paperTradeStatus?.status?.toUpperCase() ?? "IDLE"}
              </div>
              <div className="runtime-control-sub">
                {paperSessionSummary}
                <br />
                Bounded test mode for data collection and signal history.
              </div>
              <button
                className={`paper-trade-stop-button runtime-control-button ${paperTradeRunning ? "active" : "inactive"}`}
                type="button"
                onClick={startPaperTrade}
                disabled={paperTradeMutation.isPending || paperTradeStopMutation.isPending}
              >
                {paperTradeRunning
                  ? (paperTradeStopMutation.isPending ? "STOPPING..." : "PAPER TRADE: ON")
                  : paperTradeMutation.isPending
                    ? "STARTING..."
                    : "PAPER TRADE: OFF"}
              </button>
            </div>
          </div>
          <div className="section-title mt-4">{t.marketSnapshot}</div>
          <div className="grid grid-auto-fit-compact gap-2">
            <MetricBox compact value={apiHealthy ? "OK" : "DEGRADED"} label="API HEALTH" valueClass={apiHealthy ? "green" : "orange"} />
            <MetricBox compact value={botStatus?.lastRun?.status?.toUpperCase() ?? "NO RUN"} label="BOT STATUS" valueClass="cyan" />
            <MetricBox compact value={latestAlert ? latestAlert.severity.toUpperCase() : "NONE"} label="LATEST ALERT" valueClass={latestAlert?.severity === "warning" ? "orange" : "violet"} />
            <MetricBox compact value={`${discoveryTotals.candidates}`} label="DISCOVERY CANDIDATES" valueClass="green" />
            <MetricBox compact value={`${poolsQuery.data?.total ?? 0}`} label="LIVE POOLS" valueClass="cyan" />
            <MetricBox compact value={`${Math.round(winRate)}%`} label={t.winRate} valueClass="violet" />
          </div>
          <div className="paper-trade-control">
            <div className="paper-trade-row">
              <div>
                <div className="paper-trade-label">PAPER DATA SESSION</div>
                <div className="paper-trade-sub">
                  Source: {botStatus?.lastRun?.provider?.toUpperCase() ?? "N/A"}
                  <br />
                  {paperTradeDebugForceSignal || paperTradeDebugBypassRisk
                    ? "Debug mode active for data collection."
                    : paperTradeRunning
                      ? "Paper session is collecting data."
                      : autoTradingEnabled
                        ? "Live trading ready."
                        : "Live trading disabled."}
                </div>
              </div>
              <div className={`paper-trade-pill ${paperTradeStatus?.status ?? "idle"}`}>
                {paperTradeStatus?.status?.toUpperCase() ?? "IDLE"}
              </div>
            </div>
            <div className="paper-trade-row paper-trade-row-controls">
              <label className="paper-trade-field">
                <span>Cycles</span>
                <input
                  className="paper-trade-input"
                  type="number"
                  min={1}
                  step={1}
                  value={paperTradeCycles}
                  onChange={(event) => setPaperTradeCycles(Math.max(1, Number(event.target.value) || 1))}
                />
              </label>
              <label className="paper-trade-flag">
                <input
                  type="checkbox"
                  checked={paperTradeDebugForceSignal}
                  onChange={(event) => setPaperTradeDebugForceSignal(event.target.checked)}
                />
                <span>Force test signal</span>
              </label>
              <label className="paper-trade-flag">
                <input
                  type="checkbox"
                  checked={paperTradeDebugBypassRisk}
                  onChange={(event) => setPaperTradeDebugBypassRisk(event.target.checked)}
                />
                <span>Bypass risk gates</span>
              </label>
            </div>
          </div>

	    <div className="settings-section">
	      <div className="section-title" id="s-signal-feed">
	        SIGNAL PULSE
	      </div>
	      <div className="grid grid-auto-fit-compact gap-2">
	        <MetricBox compact value={signalFeedQuery.isLoading ? "..." : String(signalFeed?.total ?? 0)} label="RECENT SIGNALS" valueClass="cyan" />
	        <MetricBox compact value={topSignalType} label="TOP TYPE" valueClass="violet" />
	        <MetricBox compact value={signalCounts.RUG_SHIELD ? String(signalCounts.RUG_SHIELD) : "0"} label="RUG SHIELD" valueClass="green" />
	        <MetricBox compact value={signalCounts.SOCIAL_VELOCITY ? String(signalCounts.SOCIAL_VELOCITY) : "0"} label="SOCIAL VELOCITY" valueClass="orange" />
	        <MetricBox compact value={signalCounts.WHALE_ADJUST ? String(signalCounts.WHALE_ADJUST) : "0"} label="WHALE ADJUST" valueClass="violet" />
	        <MetricBox compact value={signalFeed?.updatedAt ? formatRelativeShort(signalFeed.updatedAt) : "—"} label="FEED UPDATED" valueClass="cyan" />
	      </div>
	      <div className="card" style={{ marginTop: 12 }}>
	        {signalFeedQuery.isLoading ? (
	          <div className="py-4 text-sm text-[var(--text-dim)]">Loading recent signals...</div>
	        ) : signalFeedQuery.error ? (
	          <div className="py-4 text-sm text-[var(--neon-orange)]">
	            {signalFeedQuery.error instanceof Error ? signalFeedQuery.error.message : String(signalFeedQuery.error)}
	          </div>
	        ) : recentSignals.length > 0 ? (
	          recentSignals.slice(0, 5).map((signal) => (
	            <div className="smartmoney-row" key={signal.id}>
	              <div className="sm-wallet" style={{ fontSize: 12, color: "var(--text)" }}>
	                {signal.type} · {signal.action}
	              </div>
	              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 10, color: "var(--neon-cyan)" }}>
	                {shortAddress(signal.poolAddress)} · {signal.risk}
	              </div>
	              <div className="sm-amount" style={{ color: signal.severity >= 95 ? "var(--neon-red)" : signal.severity >= 85 ? "var(--neon-orange)" : "var(--neon-green)" }}>
	                {signal.confidence >= 0.9 ? "HIGH" : "MID"}
	              </div>
	              <div style={{ width: "100%", fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>
	                {signal.reason[0] ?? "Signal generated"}
	                {signal.executionHints?.priorityProtection ? ` · ${signal.executionHints.priorityProtection} protection` : ""}
	                {signal.executionHints?.hedgeTo ? ` · hedge ${signal.executionHints.hedgeTo}` : ""}
	              </div>
	            </div>
	          ))
        ) : (
          <div className="py-4 text-sm text-[var(--text-dim)]">
            No recent signals recorded yet
            {paperTradeRunning ? (
              <div className="mt-1 text-xs text-[var(--neon-cyan)]">Paper trading is still running or just finished. Waiting for the next refresh.</div>
            ) : null}
          </div>
        )}
      </div>
	    </div>

        <div className="chips-row">
          {[
            { id: "all", label: "ALL SIGNALS" },
            { id: "hot", label: "🔥 HOT" },
            { id: "meteora", label: "METEORA" },
            { id: "raydium", label: "RAYDIUM" },
            { id: "orca", label: "ORCA" },
            { id: "smart", label: "SMART $" },
            { id: "organic", label: "ORGANIC" },
          ].map((item) => (
            <button
              key={item.id}
              className={`chip ${chip === item.id ? "selected" : "unselected"}`}
              type="button"
              onClick={() => {
                setChip(item.id as Chip);
                toastMessage(item.label);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="section-title" id="s-active-signals">
          {t.activeSignals}
        </div>

        <div className="space-y-3">
          {poolsQuery.isLoading ? (
            <div className="card">
              <div className="section-label">Loading live pools...</div>
              <div className="paper-trade-hint">Waiting for pool snapshot and signal enrichment.</div>
            </div>
          ) : poolsLoadError ? (
            <div className="card">
              <div className="section-label" style={{ color: "var(--neon-red)" }}>POOL FEED ERROR</div>
              <div className="paper-trade-hint">{poolsLoadError}</div>
              <button className="connect-wallet-btn" type="button" onClick={() => poolsQuery.refetch()}>
                RETRY FEED
              </button>
            </div>
          ) : visiblePools.length === 0 ? (
            <div className="card">
              <div className="section-label">No pools matched current filters</div>
              <div className="paper-trade-hint">Try lowering TVL or Jupiter thresholds.</div>
            </div>
          ) : visiblePools.map((pool) => {
            const tone = poolTone(pool);
            const badge = pool.signalType === PoolSignalType.ENTER ? t.enter : pool.signalType === PoolSignalType.AVOID ? "AVOID" : t.watch;
            const feeYield = selectedPool?.address === pool.address ? selectedPoolYield : pool.tvl > 0 ? (pool.fee24h / pool.tvl) * 100 : 0;

            return (
              <button
                key={pool.address}
                type="button"
                className={`signal-card ${tone} dashboard-card-button ${selectedPoolAddress === pool.address ? "ring-1 ring-cyan-400/60" : ""}`}
                style={pool.signalType === PoolSignalType.AVOID ? { borderColor: "rgba(255,45,85,0.3)" } : undefined}
                onClick={() => handlePoolDetail(pool)}
              >
                <div className="signal-top">
                  <div className="token-info">
                    <TokenBadge symbol={pool.tokenX} colorClass={pool.tokenX === "SOL" ? "sol" : "jup"} label={pool.tokenX.slice(0, 3)} />
                    <div>
                      <div className="token-name" style={{ color: pool.signalType === PoolSignalType.AVOID ? "var(--neon-red)" : pool.signalType === PoolSignalType.ENTER ? "var(--neon-cyan)" : "var(--neon-violet)" }}>
                        {pool.name}
                      </div>
                      <div className="token-pair">
                        {(pool.dex ?? "meteora").toUpperCase()} · bin step {pool.binStep}
                        {pool.isDiscoveryCandidate ? " · discovery" : ""}
                        {pool.discoveryConfidence !== undefined ? ` · ${Math.round(pool.discoveryConfidence * 100)}% confidence` : ""}
                      </div>
                    </div>
                  </div>
                  <SmallBadge text={badge} tone={pool.signalType === PoolSignalType.ENTER ? "green" : pool.signalType === PoolSignalType.AVOID ? "red" : "violet"} />
                </div>

                <div className="signal-metrics">
                  <MetricBox compact value={formatPercent(feeYield, 1)} label={t.fee24h} valueClass="green" />
                  <MetricBox compact value={formatCurrency(pool.tvl, 1)} label={t.tvl} valueClass="cyan" />
                  <MetricBox compact value={formatCurrency(pool.volume24h, 1)} label={t.volume24h} valueClass="orange" />
                  <MetricBox compact value={String(Math.round(pool.jupScore))} label={t.signalScoreShort} valueClass="violet" />
                </div>

                <div className="score-row">
                  <div className="score-label">{t.jupOrganic}</div>
                  <div className="score-bar-bg">
                    <div className="score-bar-fill fill-green" style={{ width: `${clamp(pool.jupScore, 0, 100)}%` }} />
                  </div>
                  <div className="score-num" style={{ color: "var(--neon-green)" }}>
                    {Math.round(pool.jupScore)}
                  </div>
                </div>
                <div className="score-row">
                  <div className="score-label">{t.smartMoney}</div>
                  <div className="score-bar-bg">
                    <div className="score-bar-fill fill-cyan" style={{ width: `${clamp(pool.smartMoneyScore, 0, 100)}%` }} />
                  </div>
                  <div className="score-num" style={{ color: "var(--neon-cyan)" }}>
                    {Math.round(pool.smartMoneyScore)}
                  </div>
                </div>
                <div className="score-row">
                  <div className="score-label">{t.ilRisk}</div>
                  <div className="score-bar-bg">
                    <div className={`score-bar-fill ${pool.ilRisk === PoolIlRisk.HIGH ? "fill-cyan" : pool.ilRisk === PoolIlRisk.MEDIUM ? "fill-violet" : "fill-green"}`} style={{ width: `${ilRiskScore(pool.ilRisk)}%` }} />
                  </div>
                  <div className="score-num" style={{ color: pool.ilRisk === PoolIlRisk.HIGH ? "var(--neon-red)" : pool.ilRisk === PoolIlRisk.MEDIUM ? "var(--neon-violet)" : "var(--neon-green)" }}>
                    {pool.ilRisk}
                  </div>
                </div>
                <div className="signal-footer" style={{ marginBottom: 4 }}>
                  <div className="signal-time">DEX {pool.dex ?? "meteora"} · source {pool.discoverySource ?? "meteora-api"}</div>
                  <div className="signal-time">{pool.tokenSafetyScore !== undefined ? `SAFETY ${Math.round(pool.tokenSafetyScore)}` : "NO SAFETY DATA"}</div>
                </div>

                <div className="signal-footer">
                  <div className="signal-time">
                    🕐 {formatTimeSince(new Date(Date.now() - 2 * 60 * 60 * 1000 + (pool.signalScore * 1000) % 3600000).toISOString())}
                  </div>
                  <button
                    className={`enter-btn ${pool.signalType === PoolSignalType.ENTER ? "active" : "passive"}`}
                    id="s-enter-pool-btn"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (pool.signalType === PoolSignalType.ENTER) {
                        handleEnterPool(pool);
                      } else {
                        handlePoolDetail(pool);
                        toastMessage(t.viewDetail);
                      }
                    }}
                  >
                    {pool.signalType === PoolSignalType.ENTER ? t.enterPool : t.viewDetail}
                  </button>
                </div>
              </button>
            );
          })}
        </div>

        {selectedPool ? (
          <>
            <div className="section-title mt-4">POOL DETAIL</div>
            <div className="card">
              <div className="signal-top">
                <div className="token-info">
                  <TokenBadge symbol={selectedPool.tokenX} colorClass={selectedPool.tokenX === "SOL" ? "sol" : "jup"} label={selectedPool.tokenX.slice(0, 3)} />
                  <div>
                    <div className="token-name">{selectedPool.name}</div>
                    <div className="token-pair">{shortAddress(selectedPool.address)}</div>
                  </div>
                </div>
                <SmallBadge text={selectedPool.signalType} tone={selectedPool.signalType === PoolSignalType.ENTER ? "green" : selectedPool.signalType === PoolSignalType.AVOID ? "red" : "violet"} />
              </div>
              <div className="signal-metrics">
                <MetricBox compact value={formatCurrency(selectedPool.currentPrice, 4)} label={t.currentPrice} valueClass="cyan" />
                <MetricBox compact value={formatCurrency(selectedPool.tvl, 1)} label={t.tvl} valueClass="green" />
                <MetricBox compact value={formatCurrency(selectedPool.volume24h, 1)} label={t.volume24h} valueClass="orange" />
                <MetricBox compact value={String(selectedPool.activeBinId)} label="ACTIVE BIN" valueClass="violet" />
                <MetricBox compact value={formatPercent(selectedPoolYield, 2)} label="FEE YIELD" valueClass="green" />
                <MetricBox compact value={(selectedPool.dex ?? "meteora").toUpperCase()} label="DEX" valueClass="cyan" />
                <MetricBox compact value={selectedPool.discoverySource ? selectedPool.discoverySource.toUpperCase() : "API"} label="SOURCE" valueClass="violet" />
                <MetricBox compact value={selectedPool.discoveryConfidence !== undefined ? `${Math.round(selectedPool.discoveryConfidence * 100)}%` : "N/A"} label="CONFIDENCE" valueClass={selectedPool.discoveryConfidence !== undefined && selectedPool.discoveryConfidence >= 0.7 ? "green" : "orange"} />
              </div>
              <div className="score-row">
                <div className="score-label">{t.signalScore}</div>
                <div className="score-bar-bg">
                  <div className="score-bar-fill fill-green" style={{ width: `${clamp(selectedPool.signalScore, 0, 100)}%` }} />
                </div>
                <div className="score-num" style={{ color: "var(--neon-green)" }}>
                  {Math.round(selectedPool.signalScore)}
                </div>
              </div>
              <div className="score-row">
                <div className="score-label">{t.jupOrganic}</div>
                <div className="score-bar-bg">
                  <div className="score-bar-fill fill-cyan" style={{ width: `${clamp(selectedPool.jupScore, 0, 100)}%` }} />
                </div>
                <div className="score-num" style={{ color: "var(--neon-cyan)" }}>
                  {Math.round(selectedPool.jupScore)}
                </div>
              </div>
              <div className="score-row">
                <div className="score-label">RISK INTEL</div>
                <div className="score-bar-bg">
                  <div className="score-bar-fill fill-violet" style={{ width: `${clamp(selectedPool.rugRiskScore ?? 0, 0, 100)}%` }} />
                </div>
                <div className="score-num" style={{ color: "var(--neon-violet)" }}>
                  {selectedPool.rugRiskScore !== undefined ? Math.round(selectedPool.rugRiskScore) : "—"}
                </div>
              </div>
              <div className="signal-metrics" style={{ marginTop: 16 }}>
                <MetricBox compact value={selectedPool.tokenSafetyScore !== undefined ? String(Math.round(selectedPool.tokenSafetyScore)) : "N/A"} label="TOKEN SAFETY" valueClass="green" />
                <MetricBox compact value={selectedPool.degenScore !== undefined ? String(Math.round(selectedPool.degenScore)) : "N/A"} label="DEGEN" valueClass="cyan" />
                <MetricBox compact value={selectedPool.socialVelocityScore !== undefined ? String(Math.round(selectedPool.socialVelocityScore)) : "N/A"} label="SOCIAL" valueClass="orange" />
                <MetricBox compact value={selectedPool.whalePressureScore !== undefined ? String(Math.round(selectedPool.whalePressureScore)) : "N/A"} label="WHALE PRESSURE" valueClass="violet" />
                <MetricBox compact value={selectedPool.previousRugsByDev !== undefined ? String(selectedPool.previousRugsByDev) : "N/A"} label="PRIOR RUGS" valueClass="orange" />
                <MetricBox compact value={selectedPool.eventWindowActive ? (selectedPool.eventName ?? "ACTIVE") : "CLOSED"} label="EVENT WINDOW" valueClass={selectedPool.eventWindowActive ? "green" : "orange"} />
              </div>
              <div className="signal-footer">
                <div className="signal-time">{t.updated}: {poolsQuery.data?.lastUpdated ?? "—"}</div>
                <div className="flex gap-2">
                  <button className="enter-btn passive" type="button" onClick={() => copyAddress(selectedPool.address)}>
                    {t.copyAddress}
                  </button>
                  <button className="enter-btn active" type="button" onClick={() => handleEnterPool(selectedPool)}>
                    {t.enterPool}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}

        <div className="section-title" id="s-sm-title">
          {t.smartMoneyTitle}
        </div>
        <div className="card">
          <div className="section-label" style={{ marginBottom: 8 }} id="s-wallet-act">
            {t.recentWalletActivity}
          </div>
          {positionsLoadError ? (
            <div className="py-4 text-sm text-[var(--neon-red)]">{positionsLoadError}</div>
          ) : null}
          {poolActivityRows.length > 0 ? (
            poolActivityRows.map((row, index) => (
              <div className="smartmoney-row" key={row.id}>
                <div className="sm-wallet">{row.wallet}</div>
                <div className={`sm-action ${index % 2 === 0 ? "sm-entered" : "sm-exited"}`}>{row.action}</div>
                <div className="sm-amount">{row.amount}</div>
              </div>
            ))
          ) : (
            <div className="text-sm text-[var(--text-dim)]">{t.noWallet}</div>
          )}
        </div>
      </div>
      </div>

      <div className={`page ${currentPage === "positions" ? "active" : ""}`} id="page-positions">
        <div className="header">
          <div className="logo-wrap">
            <div className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "#00ffcc" }}>
                <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
            </div>
            <div>
              <div className="logo-text">MERIDIAN</div>
              <div className="logo-sub" id="p-sub">
                {t.positions}
              </div>
            </div>
          </div>
          <button className={`agent-toggle ${agentRunning ? "running" : "stopped"}`} id="btn-toggle-2" onClick={toggleAgent} type="button">
            <div className="toggle-dot" />
            <span className="btn-toggle-lbl">{agentRunning ? STRINGS[lang].stop : STRINGS[lang].start}</span>
          </button>
        </div>

        <div className="section-title" id="p-my-positions">
          {t.myPositions}
        </div>
        <div className="pnl-summary">
          <div>
            <div className="pnl-label" id="p-total-pnl">
              {t.totalPnl}
            </div>
            <div className="pnl-main">{formatCurrency(totalPnlUsd)}</div>
            <div className="pnl-sub" id="p-this-week">
              {t.earnedThisWeek}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="pnl-label" id="p-fees-col">
              {t.feesCollected}
            </div>
            <div style={{ fontFamily: "'Orbitron', monospace", fontSize: 18, fontWeight: 700, color: "var(--neon-cyan)" }}>
              {formatCurrency(totalFeesEarned, 1)}
            </div>
            <div className="pnl-sub" id="p-active-pools">
              {activePoolsCount} {t.activePools}
            </div>
          </div>
        </div>

        {sortedPositions.length > 0 ? (
          sortedPositions.map((position) => (
            <button key={position.address} type="button" className="pos-card dashboard-card-button" onClick={() => {
              setSelectedPoolAddress(position.poolAddress);
              switchPage("signals");
              toastMessage(position.poolName);
            }}>
              <div className="pos-top">
                <div className="pos-name">{position.poolName}</div>
                <div className={`pos-pnl ${position.pnlUsd >= 0 ? "up" : "down"}`}>
                  {formatCurrency(position.pnlUsd, 2)} ({formatPercent(position.pnlPct, 1)})
                </div>
              </div>
              <div className="pos-details">
                <div className="pos-detail" id="p-invested">
                  {t.invested}
                  <span>{formatCurrency(position.liquidityUsd)}</span>
                </div>
                <div className="pos-detail" id="p-fees-earned">
                  {t.feesEarned}
                  <span style={{ color: "var(--neon-green)" }}>{formatCurrency(position.feesEarned, 1)}</span>
                </div>
                <div className="pos-detail" id="p-in-range">
                  {t.inRange}
                  <span style={{ color: position.inRange ? "var(--neon-green)" : "var(--neon-orange)" }}>
                    {position.inRange ? "✓ YES" : t.edge}
                  </span>
                </div>
              </div>
              <div className="action-row">
                <button className="act-btn rebalance" type="button" onClick={(event) => {
                  event.stopPropagation();
                  handleRebalance(position);
                }}>
                  {t.rebalance}
                </button>
                <button className="act-btn close-pos" type="button" onClick={(event) => {
                  event.stopPropagation();
                  handleClose(position);
                }}>
                  {t.close}
                </button>
              </div>
            </button>
          ))
        ) : (
          <div className="card text-sm text-[var(--text-dim)]">{t.connectHint}</div>
        )}
      </div>

      <div className={`page ${currentPage === "analytics" ? "active" : ""}`} id="page-analytics">
        <div className="header">
          <div className="logo-wrap">
            <div className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "#00ffcc" }}>
                <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
            </div>
            <div>
              <div className="logo-text">MERIDIAN</div>
              <div className="logo-sub" id="a-sub">
                {t.performance}
              </div>
            </div>
          </div>
          <button className={`agent-toggle ${agentRunning ? "running" : "stopped"}`} id="btn-toggle-3" onClick={toggleAgent} type="button">
            <div className="toggle-dot" />
            <span className="btn-toggle-lbl">{agentRunning ? STRINGS[lang].stop : STRINGS[lang].start}</span>
          </button>
        </div>

        <div className="section-title" id="a-performance">
          {t.performance}
        </div>
        <div className="analytics-grid">
          <div className="analytics-tile">
            <div className="a-val" style={{ color: "var(--neon-green)" }}>
              {formatCurrency(totalPnlUsd)}
            </div>
            <div className="a-lbl" id="a-total-pnl">
              {t.totalPnl}
            </div>
            <div className="a-change up">↑ {formatPercent((totalPnlUsd / Math.max(1, totalLiquidityUsd)) * 100, 1)}</div>
          </div>
          <div className="analytics-tile">
            <div className="a-val" style={{ color: "var(--neon-cyan)" }}>
              {formatCurrency(totalFeesEarned, 1)}
            </div>
            <div className="a-lbl" id="a-fees">
              {lang === "ru" ? "СБОРЫ 7Д" : "FEES 7D"}
            </div>
            <div className="a-change up">↑ {formatPercent((totalFeesEarned / Math.max(1, totalLiquidityUsd)) * 100, 1)}</div>
          </div>
          <div className="analytics-tile">
            <div className="a-val" style={{ color: "var(--neon-violet)" }}>
              {totalTrades}
            </div>
            <div className="a-lbl" id="a-trades">
              {t.totalTrades}
            </div>
            <div className="a-change" style={{ color: "var(--neon-blue)" }}>
              → {Math.round(winRate * 100)}% WIN
            </div>
          </div>
          <div className="analytics-tile">
            <div className="a-val" style={{ color: "var(--neon-orange)" }}>
              {avgHoldHours.toFixed(1)}h
            </div>
            <div className="a-lbl" id="a-avgtime">
              {t.avgHold}
            </div>
            <div className="a-change down">↓ {Math.round(Math.max(0, avgHoldHours * 15))}m</div>
          </div>
        </div>

        <div className="section-title" id="a-chart-title">
          {t.pnlChart}
        </div>
        <div className="card">
          <div style={{ width: "100%", height: 180 }}>
            {chartData.length > 0 ? (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-[var(--text-dim)]">
                    Loading chart...
                  </div>
                }
              >
                <PnLChart data={chartData} />
              </Suspense>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-dim)]">{t.connectHint}</div>
            )}
          </div>
        </div>

        <div className="section-title" id="a-history">
          {t.history}
        </div>
        <div className="card" style={{ paddingTop: 8, paddingBottom: 8 }}>
          {historyRows.length > 0 ? (
            historyRows.map((item) => (
              <div className="history-item" key={item.id}>
                <div className={`hi-icon ${item.icon === "open" ? "open" : item.icon === "rebal" ? "rebal" : "close"}`}>
                  {item.icon === "open" ? "📥" : item.icon === "rebal" ? "⟳" : "📤"}
                </div>
                <div className="hi-info">
                  <div className="hi-name">{item.name}</div>
                  <div className="hi-time">{item.time}</div>
                </div>
                <div className={`hi-pnl ${item.tone}`}>{formatCurrency(item.pnl, 0)}</div>
              </div>
            ))
          ) : (
            <div className="py-4 text-sm text-[var(--text-dim)]">{t.noWallet}</div>
          )}
        </div>
      </div>

      <div className={`page ${currentPage === "wallet" ? "active" : ""}`} id="page-wallet">
        <div className="header">
          <div className="logo-wrap">
            <div className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "#00ffcc" }}>
                <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
            </div>
            <div>
              <div className="logo-text">MERIDIAN</div>
              <div className="logo-sub" id="w-sub">
                {t.wallet}
              </div>
            </div>
          </div>
        </div>

        <div id="wallet-not-connected" style={{ display: walletConnected ? "none" : "block" }}>
          <div className="wallet-balance">
            <div className="wb-label" id="w-total-balance">
              {t.totalBalance}
            </div>
            <div className="wb-amount" style={{ fontSize: 24, color: "var(--text-dim)" }}>
              {walletConnected ? formatCurrency(trackedBalanceUsd) : t.noWallet}
            </div>
            <div className="wb-sub" id="w-connect-hint">
              {t.connectHint}
            </div>
          </div>
          <button className="connect-wallet-btn" onClick={() => setWalletModalOpen(true)} type="button" id="w-connect-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
              <circle cx="12" cy="14" r="2" />
            </svg>
            <span>{t.connectWallet}</span>
          </button>
        </div>

        <div id="wallet-connected" style={{ display: walletConnected ? "block" : "none" }}>
          <div className="wallet-balance">
            <div className="wb-label" id="w-total-balance-2">
              {t.totalBalance}
            </div>
            <div className="wb-amount">{formatCurrency(trackedBalanceUsd)}</div>
            <div className="wb-sub">{walletProvider} · {shortAddress(walletAddress)}</div>
          </div>
          <div style={{ textAlign: "center", marginBottom: 12 }}>
            <span className="wallet-connected-badge">
              <span className="wc-dot" />
              <span id="w-connected-label">
                {t.connected}
              </span>
            </span>
          </div>
          <div className="wallet-actions">
            <div className="wa-btn deposit" onClick={handleDeposit} role="button" tabIndex={0}>
              <div className="wa-icon">⬇</div>
              <div className="wa-lbl" id="w-deposit">
                {t.deposit}
              </div>
            </div>
            <div className="wa-btn withdraw" onClick={handleWithdraw} role="button" tabIndex={0}>
              <div className="wa-icon">⬆</div>
              <div className="wa-lbl" id="w-withdraw">
                {t.withdraw}
              </div>
            </div>
            <div className="wa-btn swap" onClick={handleSwap} role="button" tabIndex={0}>
              <div className="wa-icon">⇄</div>
              <div className="wa-lbl" id="w-swap">
                {t.swap}
              </div>
            </div>
          </div>
          <div className="section-title" id="w-assets">
            {t.assets}
          </div>
          <div className="card" style={{ paddingTop: 8, paddingBottom: 8 }}>
            {pricesLoadError ? <div className="py-2 text-xs text-[var(--neon-orange)]">{pricesLoadError}</div> : null}
            {positionWalletRows.length > 0 ? (
              positionWalletRows.map((asset) => {
                const colorClass = asset.symbol === "SOL" ? "sol-a" : asset.symbol === "USDC" ? "usdc-a" : "jup-a";
                return (
                  <div className="asset-row" key={asset.symbol}>
                    <div className={`asset-logo ${colorClass}`}>{asset.symbol}</div>
                    <div className="asset-info">
                      <div className="asset-name" style={{ color: asset.symbol === "SOL" ? "var(--neon-cyan)" : asset.symbol === "USDC" ? "var(--neon-blue)" : "var(--neon-violet)" }}>
                        {asset.symbol}
                      </div>
                      <div className="asset-amount">{asset.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {asset.symbol}</div>
                    </div>
                    <div className="asset-val">{formatCurrency(asset.valueUsd, 0)}</div>
                  </div>
                );
              })
            ) : (
              <div className="py-4 text-sm text-[var(--text-dim)]">{t.noWallet}</div>
            )}
          </div>
          <div className="section-title" id="w-in-pools">
            {t.inPools}
          </div>
          <div className="card">
            {sortedPositions.length > 0 ? (
              sortedPositions.map((position) => (
                <div className="smartmoney-row" key={position.address} onClick={() => {
                  setSelectedPoolAddress(position.poolAddress);
                  switchPage("signals");
                }} role="button" tabIndex={0}>
                  <div className="sm-wallet" style={{ fontSize: 12, color: "var(--text)" }}>
                    {position.poolName}
                  </div>
                  <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 10, color: position.inRange ? "var(--neon-green)" : "var(--neon-orange)" }} id="w-active">
                    {position.inRange ? t.connected : t.edge}
                  </div>
                  <div className="sm-amount" style={{ color: position.pnlUsd >= 0 ? "var(--neon-green)" : "var(--neon-orange)" }}>
                    {formatCurrency(position.liquidityUsd, 0)}
                  </div>
                </div>
              ))
            ) : (
              <div className="py-4 text-sm text-[var(--text-dim)]">{t.connectHint}</div>
            )}
          </div>
          <button className="modal-cancel" style={{ marginTop: 4 }} onClick={disconnectWallet} type="button" id="w-disconnect">
            {t.disconnectWallet}
          </button>
        </div>
      </div>

      <div className={`page ${currentPage === "settings" ? "active" : ""}`} id="page-settings">
        <div className="header">
          <div className="logo-wrap">
            <div className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "#00ffcc" }}>
                <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
            </div>
            <div>
              <div className="logo-text">MERIDIAN</div>
              <div className="logo-sub" id="st-sub">
                {t.settings}
              </div>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="section-title" id="st-language">
            {t.language}
          </div>
          <div className="lang-selector">
            <button className={`lang-btn ${lang === "en" ? "active" : "inactive"}`} id="lang-en" onClick={() => toggleLanguage("en")} type="button">
              <span className="lang-flag">🇬🇧</span>ENGLISH
            </button>
            <button className={`lang-btn ${lang === "ru" ? "active" : "inactive"}`} id="lang-ru" onClick={() => toggleLanguage("ru")} type="button">
              <span className="lang-flag">🇷🇺</span>РУССКИЙ
            </button>
          </div>
        </div>

        <div className="settings-section">
          <div className="section-title" id="st-agent">
            {t.agent}
          </div>
          <div className="setting-row">
            <div className="setting-row-info">
              <div className="setting-icon" style={{ background: "rgba(57,255,20,.08)" }}>⚡</div>
              <div>
                <div className="setting-label" id="st-auto-open">{t.autoOpen}</div>
                <div className="setting-sub" id="st-auto-open-sub">{t.autoOpenSub}</div>
              </div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={autoOpen} onChange={() => {
                setAutoOpen((current) => !current);
                toastMessage(t.settingChanged);
              }} />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-row-info">
              <div className="setting-icon" style={{ background: "rgba(0,180,255,.08)" }}>⟳</div>
              <div>
                <div className="setting-label" id="st-auto-rebal">{t.autoRebal}</div>
                <div className="setting-sub" id="st-auto-rebal-sub">{t.autoRebalSub}</div>
              </div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={autoRebal} onChange={() => {
                setAutoRebal((current) => !current);
                toastMessage(t.settingChanged);
              }} />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-row-info">
              <div className="setting-icon" style={{ background: "rgba(255,45,85,.08)" }}>🛡</div>
              <div>
                <div className="setting-label" id="st-stop-loss">{t.stopLoss}</div>
                <div className="setting-sub" id="st-stop-loss-sub">{t.stopLossSub}</div>
              </div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={stopLoss} onChange={() => {
                setStopLoss((current) => !current);
                toastMessage(t.settingChanged);
              }} />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-row-info">
              <div className="setting-icon" style={{ background: "rgba(168,85,247,.08)" }}>🔔</div>
              <div>
                <div className="setting-label" id="st-notif">{t.notifications}</div>
                <div className="setting-sub" id="st-notif-sub">{t.notificationsSub}</div>
              </div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={notifications} onChange={() => {
                setNotifications((current) => !current);
                toastMessage(t.settingChanged);
              }} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>

        <div className="settings-section">
          <div className="section-title" id="st-dexes">
            DEX DISCOVERY
          </div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: "meteora", label: "Meteora DLMM", hint: "LP + launch flow" },
                { id: "raydium", label: "Raydium", hint: "CLMM / CPMM" },
                { id: "orca", label: "Orca Whirlpool", hint: "Whirlpool pools" },
              ].map((item) => {
                const dex = item.id as SupportedDex;
                const active = enabledDexes.includes(dex);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`setting-row dashboard-card-button ${active ? "active" : ""}`}
                    onClick={() => toggleDex(dex)}
                    style={{ justifyContent: "space-between" }}
                  >
                    <div className="setting-row-info">
                      <div className="setting-icon" style={{ background: active ? "rgba(57,255,20,.12)" : "rgba(255,255,255,.05)" }}>
                        {active ? "ON" : "OFF"}
                      </div>
                      <div>
                        <div className="setting-label">{item.label}</div>
                        <div className="setting-sub">{item.hint}</div>
                      </div>
                    </div>
                    <div className="setting-right">{active ? "✓" : "—"}</div>
                  </button>
                );
              })}
            </div>
            <div className="paper-trade-hint" style={{ marginTop: 12 }}>
              Active: {enabledDexes.join(", ") || "none"} · candidates {discoveryTotals.candidates} · rejected {discoveryTotals.rejected ?? 0}
            </div>
          </div>
          <div className="card" style={{ paddingTop: 8, paddingBottom: 8, marginBottom: 12 }}>
            {discoveryCandidates.length > 0 ? (
              discoveryCandidates.slice(0, 5).map((candidate) => (
                <div className="smartmoney-row" key={candidate.id}>
                  <div className="sm-wallet" style={{ fontSize: 12, color: "var(--text)" }}>
                    {candidate.pool.name}
                  </div>
                  <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 10, color: "var(--neon-cyan)" }}>
                    {candidate.dex.toUpperCase()} · {candidate.source.toUpperCase()}
                  </div>
                  <div className="sm-amount" style={{ color: candidate.confidence >= 0.6 ? "var(--neon-green)" : "var(--neon-orange)" }}>
                    {Math.round(candidate.confidence * 100)}%
                  </div>
                </div>
              ))
            ) : (
              <div className="py-4 text-sm text-[var(--text-dim)]">No discovery candidates yet</div>
            )}
          </div>
          <div className="card" style={{ paddingTop: 8, paddingBottom: 8 }}>
            {discoveryObservations.length > 0 ? (
              discoveryObservations.slice(-5).reverse().map((observation) => (
                <div className="smartmoney-row" key={observation.id}>
                  <div className="sm-wallet" style={{ fontSize: 12, color: "var(--text)" }}>
                    {observation.dex ? `${observation.dex.toUpperCase()} · ` : ""}
                    {observation.status.toUpperCase()} DISCOVERY
                  </div>
                  <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 10, color: "var(--neon-cyan)" }}>
                    {observation.source.toUpperCase()}
                    {observation.signature ? ` · ${shortAddress(observation.signature)}` : ""}
                  </div>
                  <div className="sm-amount" style={{ color: observation.status === "accepted" ? "var(--neon-green)" : "var(--neon-red)" }}>
                    {observation.status === "accepted" ? "OK" : "REJECTED"}
                  </div>
                  <div style={{ width: "100%", fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>
                    {observation.reason}
                  </div>
                </div>
              ))
            ) : (
              <div className="py-4 text-sm text-[var(--text-dim)]">No discovery observations yet</div>
            )}
          </div>
        </div>

        <div className="settings-section">
          <div className="section-title" id="st-risk">
            {t.riskLevel}
          </div>
          <div className="card">
            <div className="risk-labels">
              <span id="st-safe">{t.safe}</span>
              <span id="st-balanced">{t.balanced}</span>
              <span id="st-aggressive">{t.aggressive}</span>
            </div>
            <input type="range" min="0" max="100" value={risk} onChange={(event) => setRisk(Number(event.target.value))} />
            <div style={{ textAlign: "center", fontFamily: "'Orbitron', monospace", fontSize: 12, marginTop: 4 }} id="riskLabel">
              {riskLabel(risk, t)}
            </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="section-title" id="st-filters">
            {t.filters}
          </div>
          <button className="setting-row dashboard-card-button" type="button" onClick={cycleMinTvl}>
            <div className="setting-row-info">
              <div className="setting-icon" style={{ background: "rgba(0,255,180,.08)" }}>📊</div>
              <div>
                <div className="setting-label" id="st-min-tvl">{t.minTvl}</div>
                <div className="setting-sub">{formatCurrency(minTvl, 0)}</div>
              </div>
            </div>
            <div className="setting-right">›</div>
          </button>
          <button className="setting-row dashboard-card-button" type="button" onClick={cycleMinJup}>
            <div className="setting-row-info">
              <div className="setting-icon" style={{ background: "rgba(255,107,0,.08)" }}>🎯</div>
              <div>
                <div className="setting-label" id="st-min-jup">{t.minJup}</div>
                <div className="setting-sub">{minJup}+</div>
              </div>
            </div>
            <div className="setting-right">›</div>
          </button>
          <button className="setting-row dashboard-card-button" type="button" onClick={cycleSmartMoney}>
            <div className="setting-row-info">
              <div className="setting-icon" style={{ background: "rgba(0,180,255,.08)" }}>💎</div>
              <div>
                <div className="setting-label" id="st-smart-thr">{t.smartThr}</div>
                <div className="setting-sub">{smartThreshold}+</div>
              </div>
            </div>
            <div className="setting-right">›</div>
          </button>
        </div>

        <div className="settings-section">
          <div className="section-title" id="st-about">
            {t.about}
          </div>
          <div className="setting-row" style={{ cursor: "default" }}>
            <div className="setting-row-info">
              <div className="setting-icon" style={{ background: "rgba(0,255,180,.06)" }}>⬡</div>
              <div>
                <div className="setting-label">MERIDIAN</div>
                <div className="setting-sub" id="st-version">
                  {t.version}
                </div>
              </div>
            </div>
            <div className="setting-right" style={{ color: "var(--neon-cyan)" }}>v1.0</div>
          </div>
        </div>
        {analyticsLoadError ? <div className="card" style={{ marginTop: 12, color: "var(--neon-red)" }}>{analyticsLoadError}</div> : null}
      </div>

      <div className={`bottom-nav dashboard-bottom-nav`} id="bottomNav">
        {[
          { id: "signals", label: t.signals },
          { id: "positions", label: t.positions },
          { id: "analytics", label: lang === "ru" ? "АНАЛИТИКА" : "ANALYTICS" },
          { id: "wallet", label: t.wallet },
          { id: "settings", label: t.settings },
        ].map((item) => (
          <button
            key={item.id}
            className={`nav-item ${currentPage === item.id ? "active" : ""}`}
            id={`nav-${item.id}`}
            type="button"
            onClick={() => switchPage(item.id as Page)}
          >
            <div className="nav-icon">
              <svg
                id={`nvi-${item.id}`}
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke={currentPage === item.id ? "#00ffcc" : "#4a7a6e"}
                strokeWidth="2"
              >
                {item.id === "signals" ? (
                  <>
                    <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" />
                    <circle cx="12" cy="12" r="3" fill={currentPage === item.id ? "#00ffcc" : "#4a7a6e"} />
                  </>
                ) : item.id === "positions" ? (
                  <>
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <polyline points="3,9 21,9" />
                    <polyline points="9,21 9,9" />
                  </>
                ) : item.id === "analytics" ? (
                  <polyline points="22,12 18,12 15,21 9,3 6,12 2,12" />
                ) : item.id === "wallet" ? (
                  <>
                    <rect x="2" y="7" width="20" height="14" rx="2" />
                    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                    <circle cx="12" cy="14" r="2" />
                  </>
                ) : (
                  <>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
                  </>
                )}
              </svg>
              {item.id === "positions" && activePoolsCount > 0 ? <div className="notif-badge">{Math.min(9, activePoolsCount)}</div> : null}
            </div>
            <div className="nav-label" id={`nl-${item.id}`}>
              {item.label}
            </div>
          </button>
        ))}
      </div>

      <div className={`toast ${toast ? "show" : ""}`} id="toastEl">
        {toast}
      </div>

      <div className={`modal-overlay ${walletModalOpen ? "show" : ""}`} id="walletModal" onClick={() => setWalletModalOpen(false)}>
        <div className="modal-sheet" onClick={(event) => event.stopPropagation()}>
          <div className="modal-title" id="wm-title">
            {lang === "ru" ? "CONNECT WALLET" : "CONNECT WALLET"}
          </div>
          <div className="modal-sub" id="wm-sub">
            {lang === "ru" ? "Выберите Solana кошелёк для подключения" : "Select a Solana wallet to connect"}
          </div>
          <div className="wallet-list">
            {walletOptions.map((option) => (
              <button
                className="wallet-option dashboard-card-button"
                key={option.name}
                type="button"
                onClick={() => void connectWalletProvider(option.name)}
                disabled={isMobileDevice && !walletConnectReady}
                style={{ ["--wallet-accent" as string]: option.accent }}
              >
                <div className="wo-icon" aria-hidden="true">
                  <span className="wo-glyph">{option.icon}</span>
                </div>
                <div>
                  <div className="wo-name">{option.name}</div>
                  <div className="wo-sub">{option.subtitle}</div>
                </div>
                {option.recommended ? <div className="wo-badge" id="wm-recommended">{t.recommended}</div> : null}
              </button>
            ))}
          </div>
          <button className="modal-cancel" style={{ marginTop: 8 }} onClick={() => setWalletModalOpen(false)} type="button" id="wm-cancel">
            {t.cancel}
          </button>
        </div>
      </div>
    </main>
  );
}

export default App;
