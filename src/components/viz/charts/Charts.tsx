import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { VisualizationCard } from "@/components/viz/VisualizationCard";

const demoSeries = [
  { name: "Jan", value: 120 },
  { name: "Feb", value: 132 },
  { name: "Mar", value: 141 },
  { name: "Apr", value: 156 },
  { name: "May", value: 180 },
];

export const categorical = [
  "oklch(0.50 0.19 255)",
  "oklch(0.55 0.19 22)",
  "oklch(0.58 0.12 160)",
  "oklch(0.60 0.14 55)",
  "oklch(0.50 0.14 300)",
  "oklch(0.55 0.10 130)",
];

export function TimeSeriesLine() {
  return (
    <VisualizationCard title="TimeSeriesLine">
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={demoSeries}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Line dataKey="value" stroke={categorical[0]} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </VisualizationCard>
  );
}

export function RankedBarChart() {
  const data = [...demoSeries].sort((a, b) => b.value - a.value);
  return (
    <VisualizationCard title="RankedBarChart">
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical">
            <XAxis type="number" />
            <YAxis type="category" dataKey="name" />
            <Tooltip />
            <Bar dataKey="value" fill={categorical[0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </VisualizationCard>
  );
}

export function CompositionStack() {
  const data = demoSeries.map((item) => ({
    name: item.name,
    cars: item.value * 0.5,
    transit: item.value * 0.35,
    cycle: item.value * 0.15,
  }));
  return (
    <VisualizationCard title="CompositionStack">
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Area dataKey="cars" stackId="1" fill={categorical[2]} stroke={categorical[2]} />
            <Area dataKey="transit" stackId="1" fill={categorical[0]} stroke={categorical[0]} />
            <Area dataKey="cycle" stackId="1" fill={categorical[3]} stroke={categorical[3]} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </VisualizationCard>
  );
}

export function DonutBreakdown() {
  return (
    <VisualizationCard title="DonutBreakdown">
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={demoSeries} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
              {demoSeries.map((entry, index) => (
                <Cell key={entry.name} fill={categorical[index % categorical.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </VisualizationCard>
  );
}

export function ComparisonRadar() {
  const data = [
    { domain: "Health", value: 76 },
    { domain: "Safety", value: 64 },
    { domain: "Economy", value: 70 },
    { domain: "Transport", value: 81 },
    { domain: "Environment", value: 58 },
  ];
  return (
    <VisualizationCard title="ComparisonRadar">
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data}>
            <PolarGrid />
            <PolarAngleAxis dataKey="domain" />
            <Radar dataKey="value" stroke={categorical[0]} fill={categorical[0]} fillOpacity={0.35} />
            <Tooltip />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </VisualizationCard>
  );
}

export function SparklineGrid() {
  return (
    <VisualizationCard title="SparklineGrid">
      <div className="grid grid-cols-2 gap-2">
        {[1, 2, 3, 4].map((index) => (
          <div key={index} className="h-20 rounded-md border border-(--color-border) p-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={demoSeries}>
                <Line dataKey="value" stroke={categorical[(index - 1) % categorical.length]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </VisualizationCard>
  );
}
