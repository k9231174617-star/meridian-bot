import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

type Page = "signals" | "positions" | "analytics" | "wallet" | "settings";
type Chip = "all" | "hot" | "meteora" | "smart" | "organic";
type Language = "en" | "ru";

type WalletRow = {
  symbol: string;
  amount: number;
  valueUsd: number;
};

type StringMap = Record<string, string>;

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
    walletProvider: "WALLET PROVIDER",
    connect: "CONNECT",
    cancel: "CANCEL",
    selectWallet: "Select a Solana wallet to connect",
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
    walletProvider: "WALLET PROVIDER",
    connect: "ПОДКЛЮЧИТЬ",
    cancel: "ОТМЕНА",
    selectWallet: "Выберите Solana кошелёк для подключения",
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

function MetricBox({ value, label, valueClass = "" }: { value: string; label: string; valueClass?: string }) {
  return (
    <div className="metric">
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

function App() {
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

  const t = STRINGS[lang];
  const walletValid = walletAddress.trim().length >= 32;
  const canQueryWallet = walletConnected && walletValid;

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
    window.localStorage.setItem(CHIP_KEY, chip);
  }, [chip]);

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

  const pools = poolsQuery.data?.pools ?? [];

  const visiblePools = useMemo(() => {
    const base = [...pools].sort((a, b) => b.signalScore - a.signalScore);

    switch (chip) {
      case "hot":
        return base.filter((pool) => pool.signalType === PoolSignalType.ENTER);
      case "smart":
        return base.filter((pool) => pool.smartMoneyScore >= smartThreshold);
      case "organic":
        return base.filter((pool) => pool.jupScore >= minJup);
      case "meteora":
        return base;
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

  const analytics = analyticsQuery.data;
  const positions = positionsQuery.data?.positions ?? [];
  const prices = pricesQuery.data?.prices ?? {};
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

  function connectWallet(providerOverride?: string) {
    if (!walletValid) {
      toastMessage(t.invalidWallet);
      return;
    }
    if (providerOverride) setWalletProvider(providerOverride);
    setWalletConnected(true);
    toastMessage(`${providerOverride ?? walletProvider} · ${shortAddress(walletAddress)} connected`);
    setWalletModalOpen(false);
  }

  function disconnectWallet() {
    setWalletConnected(false);
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

  function walletBalanceLabel() {
    return walletConnected ? shortAddress(walletAddress) : t.noWallet;
  }

  function submitWalletProvider(provider: string) {
    setWalletProvider(provider);
    connectWallet(provider);
  }

  const providerOptions = ["Phantom", "Solflare", "Backpack", "OKX Wallet"];

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

        <div className="chips-row">
          {[
            { id: "all", label: "ALL SIGNALS" },
            { id: "hot", label: "🔥 HOT" },
            { id: "meteora", label: "METEORA" },
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
          {visiblePools.map((pool) => {
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
                        METEORA DLMM · bin step {pool.binStep}
                      </div>
                    </div>
                  </div>
                  <SmallBadge text={badge} tone={pool.signalType === PoolSignalType.ENTER ? "green" : pool.signalType === PoolSignalType.AVOID ? "red" : "violet"} />
                </div>

                <div className="signal-metrics">
                  <MetricBox value={formatPercent(feeYield, 1)} label={t.fee24h} valueClass="green" />
                  <MetricBox value={formatCurrency(pool.tvl, 1)} label={t.tvl} valueClass="cyan" />
                  <MetricBox value={formatCurrency(pool.volume24h, 1)} label={t.volume24h} valueClass="orange" />
                  <MetricBox value={String(Math.round(pool.jupScore))} label={t.signalScoreShort} valueClass="violet" />
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
                <MetricBox value={formatCurrency(selectedPool.currentPrice, 4)} label={t.currentPrice} valueClass="cyan" />
                <MetricBox value={formatCurrency(selectedPool.tvl, 1)} label={t.tvl} valueClass="green" />
                <MetricBox value={formatCurrency(selectedPool.volume24h, 1)} label={t.volume24h} valueClass="orange" />
                <MetricBox value={String(selectedPool.activeBinId)} label="ACTIVE BIN" valueClass="violet" />
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
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#39ff14" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#39ff14" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(0,255,180,0.08)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#4a7a6e", fontSize: 9 }} tickFormatter={(value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
                  <YAxis tick={{ fill: "#4a7a6e", fontSize: 9 }} />
                  <Tooltip
                    contentStyle={{ background: "#081310", border: "1px solid rgba(0,255,180,.2)", borderRadius: 12, color: "#c8f0e8" }}
                    labelFormatter={(value) => new Date(String(value)).toLocaleDateString("en-US")}
                    formatter={(value: number) => [formatCurrency(value, 2), "P&L"]}
                  />
                  <Area type="monotone" dataKey="pnl" stroke="#39ff14" fill="url(#pnlGradient)" strokeWidth={2.25} />
                </AreaChart>
              </ResponsiveContainer>
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
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-label mb-2">{t.walletAddress}</div>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-black/30 px-4 py-3 font-[var(--font-mono)] text-sm text-[var(--text)] outline-none"
              placeholder="Paste Solana wallet address"
              value={walletAddress}
              onChange={(event) => setWalletAddress(event.target.value.trim())}
            />
          </div>
          <button className="connect-wallet-btn" onClick={() => setWalletModalOpen(true)} type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
              <circle cx="12" cy="14" r="2" />
            </svg>
            <span id="w-connect-btn">{t.connectWallet}</span>
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
            {t.selectWallet}
          </div>
          <div className="modal-sub" id="wm-sub">
            {t.walletAddress}
          </div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="section-label mb-2">{t.walletAddress}</div>
            <input
              className="w-full rounded-xl border border-[var(--border)] bg-black/30 px-4 py-3 font-[var(--font-mono)] text-sm text-[var(--text)] outline-none"
              placeholder="Paste Solana wallet address"
              value={walletAddress}
              onChange={(event) => setWalletAddress(event.target.value.trim())}
            />
          </div>
          {providerOptions.map((provider, index) => (
            <button className="wallet-option dashboard-card-button" key={provider} type="button" onClick={() => submitWalletProvider(provider)}>
              <div className="wo-icon">{index === 0 ? "👻" : index === 1 ? "☀️" : index === 2 ? "🎒" : "⭕"}</div>
              <div>
                <div className="wo-name">{provider}</div>
                <div className="wo-sub">{index === 0 ? "Most popular Solana wallet" : index === 1 ? "Native Solana wallet" : index === 2 ? "xNFT wallet by Coral" : "Multi-chain wallet"}</div>
              </div>
              {index === 0 ? <div className="wo-badge" id="wm-recommended">{t.recommended}</div> : null}
            </button>
          ))}
          <button className="modal-cancel" onClick={() => setWalletModalOpen(false)} type="button" id="wm-cancel">
            {t.cancel}
          </button>
          <button className="connect-wallet-btn" style={{ marginTop: 10 }} onClick={() => connectWallet()} type="button">
            {t.connect}
          </button>
        </div>
      </div>
    </main>
  );
}

export default App;
