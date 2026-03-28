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

const categorical = ["#0A7D7D", "#8BAE5A", "#275DAD", "#E08A22", "#B34C54", "#8E6CB6"];

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
            <Line dataKey="value" stroke="#0A7D7D" strokeWidth={2} dot={false} />
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
            <Bar dataKey="value" fill="#275DAD" />
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
            <Area dataKey="cars" stackId="1" fill="#8BAE5A" stroke="#8BAE5A" />
            <Area dataKey="transit" stackId="1" fill="#275DAD" stroke="#275DAD" />
            <Area dataKey="cycle" stackId="1" fill="#E08A22" stroke="#E08A22" />
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
            <Radar dataKey="value" stroke="#0A7D7D" fill="#0A7D7D" fillOpacity={0.35} />
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
          <div key={index} className="h-20 rounded-md border border-[var(--color-border)] p-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={demoSeries}>
                <Line dataKey="value" stroke={categorical[index]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </VisualizationCard>
  );
}
