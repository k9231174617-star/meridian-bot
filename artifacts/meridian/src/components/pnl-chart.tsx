import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type PnLPoint = {
  date: string;
  pnl: number;
};

type PnLChartProps = {
  data: PnLPoint[];
};

export function PnLChart({ data }: PnLChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#00ffcc" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#00ffcc" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: "#4a7a6e", fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fill: "#4a7a6e", fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          contentStyle={{ background: "rgba(2, 6, 8, 0.92)", border: "1px solid rgba(0,255,204,0.2)", borderRadius: 10 }}
          labelStyle={{ color: "#00ffcc" }}
          itemStyle={{ color: "#00ffcc" }}
        />
        <Area
          type="monotone"
          dataKey="pnl"
          stroke="#00ffcc"
          strokeWidth={2}
          fill="url(#pnlFill)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
