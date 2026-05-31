import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bot,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Copy,
  Gauge,
  Layers3,
  LayoutDashboard,
  LineChart,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Link,
  Route,
  Router as WouterRouter,
  Switch,
  useLocation,
} from "wouter";
import {
  type AnalyticsResponse,
  type Pool,
  type Position,
  useGetAnalytics,
  useGetPools,
  useGetPositions,
  useGetPrices,
  useHealthCheck,
} from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";
import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/utils";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 15_000,
    },
  },
});

const NAV_ITEMS: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
  hint: string;
}> = [
  { href: "/", label: "Overview", icon: LayoutDashboard, hint: "Snapshot" },
  { href: "/pools", label: "Pools", icon: Layers3, hint: "Signals" },
  { href: "/positions", label: "Positions", icon: Wallet, hint: "Portfolio" },
  { href: "/analytics", label: "Analytics", icon: LineChart, hint: "Performance" },
  { href: "/settings", label: "Settings", icon: Settings2, hint: "System" },
];

const DEFAULT_WALLET =
  "J7wVYf7X4a8k3N1m5P8bQ2cT9uR4fL6sH1dG3eK9mQ2";

const PRICE_TOKENS = ["SOL", "USDC", "JUP", "RAY", "BONK"];

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const usdFull = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const numberCompact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const percentOne = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppShell />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function AppShell() {
  const [pathname] = useLocation();
  const [wallet, setWallet] = useStoredValue("meridian.wallet", DEFAULT_WALLET);
  const health = useHealthCheck({
    query: {
      queryKey: ["/api/healthz"],
      refetchInterval: 30_000,
      staleTime: 15_000,
      retry: 1,
    },
  });

  const apiStatus = health.isPending
    ? "checking"
    : health.isError
      ? "degraded"
      : "ready";

  return (
    <div className="app-shell">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-4 px-3 pb-20 pt-3 lg:flex-row lg:px-5 lg:pb-5">
        <aside className="hidden w-80 shrink-0 flex-col gap-4 lg:flex">
          <BrandPanel apiStatus={apiStatus} />
          <SidebarNav pathname={pathname} />
          <WalletPanel wallet={wallet} setWallet={setWallet} />
          <NetworkPanel health={health} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <TopBar
            pathname={pathname}
            wallet={wallet}
            setWallet={setWallet}
            apiStatus={apiStatus}
          />

          <main className="min-w-0 flex-1 pb-6">
            <Switch>
              <Route path="/">
                <OverviewPage wallet={wallet} />
              </Route>
              <Route path="/pools">
                <PoolsPage />
              </Route>
              <Route path="/positions">
                <PositionsPage wallet={wallet} setWallet={setWallet} />
              </Route>
              <Route path="/analytics">
                <AnalyticsPage wallet={wallet} />
              </Route>
              <Route path="/settings">
                <SettingsPage wallet={wallet} setWallet={setWallet} />
              </Route>
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </div>

      <BottomNav pathname={pathname} />
    </div>
  );
}

function TopBar({
  pathname,
  wallet,
  setWallet,
  apiStatus,
}: {
  pathname: string;
  wallet: string;
  setWallet: (value: string) => void;
  apiStatus: "checking" | "ready" | "degraded";
}) {
  const [copied, setCopied] = useState(false);

  async function copyWallet() {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <header className="panel-strong sticky top-3 z-20 rounded-3xl px-4 py-4 shadow-2xl lg:px-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-lg shadow-primary/10">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-gradient sm:text-2xl">
                Meridian
              </h1>
              <Badge
                variant={apiStatus === "ready" ? "default" : "outline"}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] uppercase tracking-[0.24em]",
                  apiStatus === "degraded" &&
                    "border-destructive/30 text-destructive",
                )}
              >
                {apiStatus === "ready"
                  ? "api live"
                  : apiStatus === "checking"
                    ? "checking"
                    : "api degraded"}
              </Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Liquidity-pool dashboard for Meteora DLMM scouting, wallet
              tracking, and performance review.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="rounded-2xl border border-border/70 bg-background/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              wallet
            </p>
            <div className="mt-1 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              <span className="font-mono text-xs text-foreground">
                {shortenAddress(wallet)}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 rounded-full text-muted-foreground"
                onClick={copyWallet}
                aria-label="Copy wallet address"
              >
                {copied ? <CircleAlert className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              api
            </p>
            <p className="mt-1 flex items-center gap-2 text-xs text-foreground">
              <Activity className="h-4 w-4 text-primary" />
              {API_BASE_URL ? API_BASE_URL : "relative /api proxy"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" className="rounded-2xl">
              <Link href="/pools">
                <Search className="h-4 w-4" />
                Explore pools
              </Link>
            </Button>
            <Button
              variant="default"
              className="rounded-2xl"
              onClick={() => setWallet(DEFAULT_WALLET)}
            >
              <Sparkles className="h-4 w-4" />
              Reset wallet
            </Button>
          </div>
        </div>
      </div>

      <Separator className="my-4 bg-border/70" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="hidden items-center gap-2 lg:flex">
          {NAV_ITEMS.map((item) => (
            <Button
              asChild
              key={item.href}
              variant={isActiveRoute(pathname, item.href) ? "default" : "outline"}
              className="rounded-full px-4"
            >
              <Link href={item.href}>
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            </Button>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="rounded-full px-2.5 py-1">
            {pathname === "/" ? "Overview" : pathname.slice(1)}
          </Badge>
          <span className="hidden sm:inline">
            live market data, wallet metrics, and pool signals
          </span>
        </div>
      </div>
    </header>
  );
}

function BrandPanel({ apiStatus }: { apiStatus: "checking" | "ready" | "degraded" }) {
  return (
    <Card className="panel-strong overflow-hidden rounded-[1.75rem]">
      <CardHeader className="space-y-4 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
            <Layers3 className="h-6 w-6" />
          </div>
          <div>
            <CardTitle className="text-xl">Meridian Bot</CardTitle>
            <CardDescription className="text-sm">
              DLMM signal terminal
            </CardDescription>
          </div>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          A focused liquidity dashboard for ranking pools, reading wallet
          performance, and spotting momentum before it becomes crowded.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <StatusRow
          icon={Gauge}
          label="system"
          value={apiStatus === "ready" ? "connected" : apiStatus}
        />
        <StatusRow icon={Zap} label="strategy" value="signal first" />
        <StatusRow icon={TrendingUp} label="coverage" value="pools / positions / analytics" />
      </CardContent>
    </Card>
  );
}

function WalletPanel({
  wallet,
  setWallet,
}: {
  wallet: string;
  setWallet: (value: string) => void;
}) {
  return (
    <Card className="panel rounded-[1.5rem]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Wallet focus</CardTitle>
        <CardDescription>Switch the active wallet used by positions and analytics.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={wallet}
          onChange={(event) => setWallet(event.target.value.trim())}
          spellCheck={false}
          className="font-mono text-xs"
          placeholder="Wallet address"
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{shortenAddress(wallet)}</span>
          <span>{wallet.length} chars</span>
        </div>
      </CardContent>
    </Card>
  );
}

function NetworkPanel({ health }: { health: ReturnType<typeof useHealthCheck> }) {
  return (
    <Card className="panel rounded-[1.5rem]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Network</CardTitle>
        <CardDescription>API health and refresh cadence.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <StatusRow
          icon={health.isError ? ShieldAlert : Activity}
          label="health"
          value={health.isError ? "degraded" : "healthy"}
        />
        <StatusRow icon={RefreshCw} label="polling" value="30s / 60s" />
      </CardContent>
    </Card>
  );
}

function SidebarNav({ pathname }: { pathname: string }) {
  return (
    <Card className="panel rounded-[1.5rem]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Navigation</CardTitle>
        <CardDescription>Move between the working sets.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {NAV_ITEMS.map((item) => {
          const active = isActiveRoute(pathname, item.href);
          return (
            <Button
              asChild
              key={item.href}
              variant={active ? "default" : "outline"}
              className="h-auto w-full justify-start rounded-2xl px-4 py-3"
            >
              <Link href={item.href}>
                <item.icon className="h-4 w-4" />
                <span className="flex-1 text-left">
                  <span className="block text-sm">{item.label}</span>
                  <span className="block text-[11px] font-normal opacity-75">
                    {item.hint}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 opacity-50" />
              </Link>
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
}

function BottomNav({ pathname }: { pathname: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/92 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur-xl lg:hidden">
      <div className="mx-auto grid max-w-3xl grid-cols-5 gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActiveRoute(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function OverviewPage({ wallet }: { wallet: string }) {
  const pools = useGetPools(
    { limit: 6, minTvl: 250_000, minJupScore: 45 },
    {
      query: {
        queryKey: ["/api/pools", { limit: 6, minTvl: 250_000, minJupScore: 45 }],
        refetchInterval: 60_000,
        staleTime: 30_000,
      },
    },
  );

  const positions = useGetPositions(
    { wallet },
    {
      query: {
        queryKey: ["/api/positions", { wallet }],
        refetchInterval: 45_000,
        staleTime: 30_000,
      },
    },
  );

  const analytics = useGetAnalytics(
    { wallet },
    {
      query: {
        queryKey: ["/api/analytics", { wallet }],
        refetchInterval: 60_000,
        staleTime: 30_000,
      },
    },
  );

  const prices = useGetPrices(
    { tokens: PRICE_TOKENS.join(",") },
    {
      query: {
        queryKey: ["/api/prices", { tokens: PRICE_TOKENS.join(",") }],
        refetchInterval: 30_000,
        staleTime: 15_000,
      },
    },
  );

  const totalPoolsTvl = sumBy(pools.data?.pools ?? [], (pool) => pool.tvl);
  const positivePools = (pools.data?.pools ?? []).filter(
    (pool) => pool.signalType === "ENTER",
  ).length;
  const positionsCount = positions.data?.positions.length ?? 0;
  const topScore = maxBy(pools.data?.pools ?? [], (pool) => pool.signalScore);

  const pnlSeries = useMemo(
    () =>
      (analytics.data?.pnlHistory ?? []).map((point) => ({
        ...point,
        date: shortDate(point.date),
      })),
    [analytics.data],
  );

  return (
    <div className="space-y-4">
      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="panel-strong overflow-hidden rounded-[2rem]">
          <CardHeader className="space-y-4 pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full px-2.5 py-1 uppercase tracking-[0.24em]">
                live overview
              </Badge>
              <Badge variant="outline" className="rounded-full px-2.5 py-1">
                refreshed {lastUpdated(pools.data?.lastUpdated)}
              </Badge>
            </div>
            <div className="space-y-3">
              <CardTitle className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Scan liquidity faster, position cleaner, and keep the wallet
                view in one terminal.
              </CardTitle>
              <CardDescription className="max-w-2xl text-base leading-7">
                Pool signals, wallet PnL, and price context are wired to the
                live API. Use the panels below to decide where capital should
                sit next.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 pt-6 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={CircleDollarSign}
              label="Tracked TVL"
              value={usdCompact.format(totalPoolsTvl)}
              note={`${pools.data?.total ?? 0} pools`}
            />
            <MetricCard
              icon={TrendingUp}
              label="Signal entries"
              value={String(positivePools)}
              note="enter / watch candidates"
            />
            <MetricCard
              icon={Wallet}
              label="Wallet PnL"
              value={usdPrecise.format(positions.data?.totalPnlUsd ?? 0)}
              note={`${positionsCount} positions`}
            />
            <MetricCard
              icon={BarChart3}
              label="Win rate"
              value={`${percentOne.format(analytics.data?.winRate ?? 0)}%`}
              note={`${analytics.data?.totalTrades ?? 0} trades`}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="panel rounded-[1.75rem]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Strategy snapshot</CardTitle>
              <CardDescription>
                High-signal pools, wallet exposure, and price context.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <StatusRow
                icon={Gauge}
                label="best pool"
                value={topScore ? topScore.name : "loading"}
              />
              <StatusRow
                icon={TrendingUp}
                label="pnl"
                value={usdPrecise.format(analytics.data?.totalPnlUsd ?? 0)}
              />
              <StatusRow
                icon={Activity}
                label="fees"
                value={usdPrecise.format(analytics.data?.totalFeesEarned ?? 0)}
              />
            </CardContent>
          </Card>

          <Card className="panel rounded-[1.75rem]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Current prices</CardTitle>
              <CardDescription>Quick context for the pool screen.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {prices.isPending
                ? Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-11 w-full rounded-2xl" />
                  ))
                : Object.values(prices.data?.prices ?? {}).map((price) => (
                    <PriceRow key={price.symbol} symbol={price.symbol} price={price.price} change={price.change24h} />
                  ))}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="panel rounded-[1.75rem]">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Signal ladder</CardTitle>
                <CardDescription>Top pools by signal quality.</CardDescription>
              </div>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/pools">
                  View all
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <PoolTable pools={pools.data?.pools ?? []} loading={pools.isPending} />
          </CardContent>
        </Card>

        <Card className="panel rounded-[1.75rem]">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">P&L curve</CardTitle>
            <CardDescription>14-day realized P&L history.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-72 rounded-3xl border border-border/70 bg-background/40 p-3">
              {analytics.isPending ? (
                <Skeleton className="h-full w-full rounded-2xl" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pnlSeries}>
                    <defs>
                      <linearGradient id="pnlGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="4 4" />
                    <XAxis
                      dataKey="date"
                      stroke="hsl(var(--muted-foreground))"
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => usdCompact.format(Number(value))}
                    />
                    <RechartsTooltip
                      cursor={{ stroke: "hsl(var(--primary))", strokeWidth: 1 }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const value = Number(payload[0]?.value ?? 0);
                        return (
                          <div className="rounded-2xl border border-border bg-background/95 px-3 py-2 shadow-2xl">
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className="mt-1 font-mono text-sm text-foreground">
                              {usdPrecise.format(value)}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="pnl"
                      stroke="hsl(var(--primary))"
                      fill="url(#pnlGradient)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard
                icon={TrendingUp}
                label="Total PnL"
                value={usdPrecise.format(analytics.data?.totalPnlUsd ?? 0)}
                note="realized wallet result"
              />
              <MetricCard
                icon={Activity}
                label="Average hold"
                value={`${percentOne.format(analytics.data?.avgHoldTime ?? 0)}h`}
                note="synthetic signal input"
              />
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function PoolsPage() {
  const [limit, setLimit] = useState("12");
  const [minTvl, setMinTvl] = useState("250000");
  const [minJupScore, setMinJupScore] = useState("45");

  const pools = useGetPools(
    {
      limit: Number(limit) || 12,
      minTvl: Number(minTvl) || 0,
      minJupScore: Number(minJupScore) || 0,
    },
    {
      query: {
        queryKey: ["/api/pools", { limit: Number(limit) || 12, minTvl: Number(minTvl) || 0, minJupScore: Number(minJupScore) || 0 }],
        refetchInterval: 60_000,
        staleTime: 30_000,
      },
    },
  );

  return (
    <div className="space-y-4">
      <Card className="panel-strong rounded-[2rem]">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-2xl">Pool radar</CardTitle>
              <CardDescription>
                Filter the live pool feed before moving into a position.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              {pools.data?.total ?? 0} visible
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <FilterField label="Limit" value={limit} onChange={setLimit} />
          <FilterField label="Min TVL" value={minTvl} onChange={setMinTvl} />
          <FilterField label="Min JUP score" value={minJupScore} onChange={setMinJupScore} />
        </CardContent>
      </Card>

      <Card className="panel rounded-[1.75rem]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pools</CardTitle>
          <CardDescription>Ranked by signal quality and liquidity depth.</CardDescription>
        </CardHeader>
        <CardContent>
          <PoolTable pools={pools.data?.pools ?? []} loading={pools.isPending} />
        </CardContent>
      </Card>
    </div>
  );
}

function PositionsPage({
  wallet,
  setWallet,
}: {
  wallet: string;
  setWallet: (value: string) => void;
}) {
  const positions = useGetPositions(
    { wallet },
    {
      query: {
        queryKey: ["/api/positions", { wallet }],
        refetchInterval: 45_000,
        staleTime: 30_000,
      },
    },
  );

  const summaryCards = [
    {
      label: "Liquidity",
      value: usdPrecise.format(positions.data?.totalLiquidityUsd ?? 0),
      icon: CircleDollarSign,
    },
    {
      label: "Fees earned",
      value: usdPrecise.format(positions.data?.totalFeesEarned ?? 0),
      icon: Activity,
    },
    {
      label: "Net PnL",
      value: usdPrecise.format(positions.data?.totalPnlUsd ?? 0),
      icon: TrendingUp,
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="panel-strong rounded-[2rem]">
        <CardHeader className="pb-3">
          <CardTitle className="text-2xl">Positions</CardTitle>
          <CardDescription>
            Track active DLMM exposure for the wallet currently under review.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
              Active wallet
            </p>
            <Input
              value={wallet}
              onChange={(event) => setWallet(event.target.value.trim())}
              className="font-mono text-xs"
            />
            <p className="text-sm text-muted-foreground">
              The positions and analytics tabs use this address for live queries.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {summaryCards.map((item) => (
              <MetricCard
                key={item.label}
                icon={item.icon}
                label={item.label}
                value={item.value}
                note="wallet-level"
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {(positions.data?.positions ?? []).map((position) => (
          <PositionCard key={position.address} position={position} />
        ))}

        {!positions.isPending && (positions.data?.positions.length ?? 0) === 0 ? (
          <Card className="panel rounded-[1.75rem]">
            <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 py-10 text-center">
              <CircleAlert className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-medium">No active positions</p>
                <p className="text-sm text-muted-foreground">
                  This wallet currently has no positions returned by the API.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {positions.isPending
          ? Array.from({ length: 4 }).map((_, index) => (
              <Card key={index} className="panel rounded-[1.75rem]">
                <CardHeader>
                  <Skeleton className="h-6 w-44" />
                  <Skeleton className="h-4 w-28" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-24 w-full rounded-2xl" />
                </CardContent>
              </Card>
            ))
          : null}
      </div>
    </div>
  );
}

function AnalyticsPage({ wallet }: { wallet: string }) {
  const analytics = useGetAnalytics(
    { wallet },
    {
      query: {
        queryKey: ["/api/analytics", { wallet }],
        refetchInterval: 60_000,
        staleTime: 30_000,
      },
    },
  );

  const prices = useGetPrices(
    { tokens: PRICE_TOKENS.join(",") },
    {
      query: {
        queryKey: ["/api/prices", { tokens: PRICE_TOKENS.join(",") }],
        refetchInterval: 30_000,
        staleTime: 15_000,
      },
    },
  );

  const series = useMemo(
    () =>
      (analytics.data?.pnlHistory ?? []).map((point) => ({
        ...point,
        date: shortDate(point.date),
      })),
    [analytics.data],
  );

  return (
    <div className="space-y-4">
      <Card className="panel-strong rounded-[2rem]">
        <CardHeader className="pb-3">
          <CardTitle className="text-2xl">Analytics</CardTitle>
          <CardDescription>
            A wallet-level view of realized performance, volume, and price context.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={TrendingUp}
            label="Total PnL"
            value={usdPrecise.format(analytics.data?.totalPnlUsd ?? 0)}
            note="realized"
          />
          <MetricCard
            icon={Activity}
            label="Fees"
            value={usdPrecise.format(analytics.data?.totalFeesEarned ?? 0)}
            note="collected"
          />
          <MetricCard
            icon={BarChart3}
            label="Win rate"
            value={`${percentOne.format(analytics.data?.winRate ?? 0)}%`}
            note="trade quality"
          />
          <MetricCard
            icon={Zap}
            label="Trades"
            value={numberCompact.format(analytics.data?.totalTrades ?? 0)}
            note="active set"
          />
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
        <Card className="panel rounded-[1.75rem]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">PnL history</CardTitle>
            <CardDescription>14-day realized curve for the active wallet.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80 rounded-3xl border border-border/70 bg-background/40 p-3">
              {analytics.isPending ? (
                <Skeleton className="h-full w-full rounded-2xl" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series}>
                    <defs>
                      <linearGradient id="analyticsGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="4 4" />
                    <XAxis
                      dataKey="date"
                      stroke="hsl(var(--muted-foreground))"
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => usdCompact.format(Number(value))}
                    />
                    <RechartsTooltip
                      cursor={{ stroke: "hsl(var(--accent))", strokeWidth: 1 }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const value = Number(payload[0]?.value ?? 0);
                        return (
                          <div className="rounded-2xl border border-border bg-background/95 px-3 py-2 shadow-2xl">
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className="mt-1 font-mono text-sm text-foreground">
                              {usdPrecise.format(value)}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="pnl"
                      stroke="hsl(var(--accent))"
                      fill="url(#analyticsGradient)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="panel rounded-[1.75rem]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Token prices</CardTitle>
            <CardDescription>Used as the reference layer for pool valuation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {prices.isPending
              ? Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full rounded-2xl" />
                ))
              : Object.values(prices.data?.prices ?? {}).map((price) => (
                  <PriceRow
                    key={price.symbol}
                    symbol={price.symbol}
                    price={price.price}
                    change={price.change24h}
                    compact
                  />
                ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function SettingsPage({
  wallet,
  setWallet,
}: {
  wallet: string;
  setWallet: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Card className="panel-strong rounded-[2rem]">
        <CardHeader className="pb-3">
          <CardTitle className="text-2xl">Settings</CardTitle>
          <CardDescription>
            Runtime details and the active wallet used by the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
              Wallet
            </p>
            <Input
              value={wallet}
              onChange={(event) => setWallet(event.target.value.trim())}
              className="font-mono text-xs"
            />
            <p className="text-sm text-muted-foreground">
              Stored in localStorage and reused across pages.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <StatusRow icon={LayoutDashboard} label="base path" value={import.meta.env.BASE_URL} />
            <StatusRow
              icon={Activity}
              label="api mode"
              value={API_BASE_URL ? "remote" : "proxy /api"}
            />
            <StatusRow icon={Search} label="tokens" value={PRICE_TOKENS.join(", ")} />
            <StatusRow icon={Settings2} label="build" value="Vite + React + pnpm" />
          </div>
        </CardContent>
      </Card>

      <Card className="panel rounded-[1.75rem]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Operational notes</CardTitle>
          <CardDescription>What still matters before the product is finished.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <InfoCallout
            icon={ShieldAlert}
            title="Data quality"
            text="Some API fields are still heuristic, so the UI is designed to make gaps visible instead of hiding them."
          />
          <InfoCallout
            icon={RefreshCw}
            title="Refresh cadence"
            text="Pools refresh every minute, prices every 30 seconds, and wallet views every 45 seconds."
          />
          <InfoCallout
            icon={Zap}
            title="Phase 3 readiness"
            text="The next step is test coverage, deploy wiring, and removing remaining synthetic data paths."
          />
          <InfoCallout
            icon={CircleAlert}
            title="Environment"
            text="Set VITE_API_BASE_URL when the frontend must talk to a remote API instead of the local proxy."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function PoolTable({
  pools,
  loading,
}: {
  pools: Pool[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (pools.length === 0) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border/70 bg-background/30 py-10 text-center">
        <Layers3 className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="font-medium">No pools matched the current filter</p>
          <p className="text-sm text-muted-foreground">
            Relax the TVL or score thresholds and try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Pool</TableHead>
          <TableHead>Signal</TableHead>
          <TableHead className="text-right">TVL</TableHead>
          <TableHead className="text-right">Fees 24h</TableHead>
          <TableHead className="text-right">Score</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pools.map((pool) => (
          <TableRow key={pool.address}>
            <TableCell className="py-4">
              <div className="space-y-1">
                <div className="font-medium text-foreground">{pool.name}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {shortenAddress(pool.address)}
                </div>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <SignalBadge signal={pool.signalType} />
                <RiskBadge risk={pool.ilRisk} />
              </div>
            </TableCell>
            <TableCell className="text-right font-mono">{usdCompact.format(pool.tvl)}</TableCell>
            <TableCell className="text-right font-mono">{usdCompact.format(pool.fee24h)}</TableCell>
            <TableCell className="text-right">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/50 px-3 py-1 font-mono text-sm">
                <span className="text-primary">{pool.signalScore}</span>
                <span className="text-muted-foreground">/100</span>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PositionCard({ position }: { position: Position }) {
  return (
    <Card className="panel rounded-[1.75rem]">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">{position.poolName}</CardTitle>
            <CardDescription className="font-mono text-xs">
              {shortenAddress(position.poolAddress)}
            </CardDescription>
          </div>
          <Badge
            variant={position.inRange ? "default" : "outline"}
            className={cn(
              "rounded-full px-2.5 py-1 uppercase tracking-[0.2em]",
              !position.inRange && "border-destructive/30 text-destructive",
            )}
          >
            {position.inRange ? "in range" : "out of range"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            icon={CircleDollarSign}
            label="Liquidity"
            value={usdPrecise.format(position.liquidityUsd)}
            note="position size"
          />
          <MetricCard
            icon={Activity}
            label="Fees"
            value={usdPrecise.format(position.feesEarned)}
            note="earned so far"
          />
          <MetricCard
            icon={position.pnlUsd >= 0 ? TrendingUp : TrendingDown}
            label="PnL"
            value={usdPrecise.format(position.pnlUsd)}
            note={`${percentOne.format(position.pnlPct)}%`}
          />
        </div>

        <div className="grid gap-3 rounded-3xl border border-border/70 bg-background/35 p-4 sm:grid-cols-3">
          <MiniStat label="Range" value={`${position.lowerBinId} → ${position.upperBinId}`} />
          <MiniStat label="Active" value={String(position.activeBinId)} />
          <MiniStat label="Opened" value={formatRelative(position.openedAt)} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-full">
            {position.tokenX}/{position.tokenY}
          </Badge>
          <Badge variant="secondary" className="rounded-full">
            {usdFull.format(position.tokenXAmount)} {position.tokenX}
          </Badge>
          <Badge variant="secondary" className="rounded-full">
            {usdFull.format(position.tokenYAmount)} {position.tokenY}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-3xl border border-border/70 bg-background/40 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          {note ? <p className="mt-1 text-sm text-muted-foreground">{note}</p> : null}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function StatusRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/35 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="max-w-48 truncate font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

function PriceRow({
  symbol,
  price,
  change,
  compact = false,
}: {
  symbol: string;
  price: number;
  change: number;
  compact?: boolean;
}) {
  const positive = change >= 0;

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-2xl border border-border/70 bg-background/35 px-4 py-3",
        compact && "px-3 py-2.5",
      )}
    >
      <div>
        <p className="font-medium">{symbol}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {usdPrecise.format(price)}
        </p>
      </div>
      <div
        className={cn(
          "rounded-full px-2.5 py-1 font-mono text-xs",
          positive
            ? "bg-emerald-500/10 text-emerald-300"
            : "bg-rose-500/10 text-rose-300",
        )}
      >
        {positive ? "+" : ""}
        {percentOne.format(change)}%
      </div>
    </div>
  );
}

function InfoCallout({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-3xl border border-border/70 bg-background/35 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p>
        </div>
      </div>
    </div>
  );
}

function FilterField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">{label}</p>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="numeric"
        className="font-mono"
      />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}

function SignalBadge({ signal }: { signal: Pool["signalType"] }) {
  if (signal === "ENTER") {
    return (
      <Badge className="rounded-full bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">
        ENTER
      </Badge>
    );
  }
  if (signal === "WATCH") {
    return (
      <Badge variant="secondary" className="rounded-full">
        WATCH
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="rounded-full border-rose-500/30 text-rose-300">
      AVOID
    </Badge>
  );
}

function RiskBadge({ risk }: { risk: Pool["ilRisk"] }) {
  if (risk === "LOW") {
    return (
      <Badge variant="outline" className="rounded-full border-emerald-500/30 text-emerald-300">
        LOW IL
      </Badge>
    );
  }
  if (risk === "MEDIUM") {
    return (
      <Badge variant="outline" className="rounded-full border-amber-500/30 text-amber-300">
        MED IL
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="rounded-full border-rose-500/30 text-rose-300">
      HIGH IL
    </Badge>
  );
}

function StatusRowSkeleton() {
  return <Skeleton className="h-14 w-full rounded-2xl" />;
}

function useStoredValue(key: string, initialValue: string) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return initialValue;
    return window.localStorage.getItem(key) ?? initialValue;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore write failures in private mode
    }
  }, [key, value]);

  return [value, setValue] as const;
}

function isActiveRoute(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function shortenAddress(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function shortDate(dateIso: string) {
  return new Date(dateIso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function lastUpdated(dateIso?: string) {
  if (!dateIso) return "now";
  const diffMs = Date.now() - new Date(dateIso).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatRelative(dateIso: string) {
  const diffMs = Date.now() - new Date(dateIso).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function sumBy<T>(items: T[], selector: (item: T) => number) {
  return items.reduce((sum, item) => sum + selector(item), 0);
}

function maxBy<T>(items: T[], selector: (item: T) => number) {
  if (items.length === 0) return undefined;
  return items.reduce((best, item) => (selector(item) > selector(best) ? item : best));
}

export default App;
