import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { VisualizationCard } from "@/components/viz/VisualizationCard";
import type { ChartSpec } from "@/lib/types";
import { categorical } from "@/components/viz/charts/Charts";

const axisTick = { fill: "var(--color-muted-foreground)", fontSize: 11 } as const;
const axisLabelStyle = {
  fill: "var(--color-muted-foreground)",
  fontSize: 11,
  textAnchor: "middle" as const,
};
const tooltipStyle = {
  contentStyle: {
    backgroundColor: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: 6,
    color: "var(--color-foreground)",
    fontSize: 12,
    boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
  },
  labelStyle: { color: "var(--color-muted-foreground)", fontSize: 11 },
  itemStyle: { color: "var(--color-foreground)" },
  cursor: { stroke: "var(--color-muted-foreground)", strokeOpacity: 0.3 },
} as const;
const legendStyle = { color: "var(--color-muted-foreground)", fontSize: "11px" } as const;
const gridStroke = "var(--color-border)";

function prettify(field: string): string {
  if (!field) return "";
  return field
    .replace(/[_\-]+/g, " ")
    .replace(/\./g, " · ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function yAxisLabel(spec: ChartSpec): string {
  if (spec.yFields.length === 1) return prettify(spec.yFields[0]);
  return "Value";
}

function renderTable(spec: ChartSpec) {
  const headers = Array.from(
    new Set([spec.xField, ...spec.yFields, ...spec.data.flatMap((row) => Object.keys(row))].filter((header) => header.length > 0)),
  );
  const rows = spec.data.slice(0, 100);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className="border-b border-(--color-border) py-2">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {headers.map((header) => (
                <td key={header} className="border-b border-(--color-border) py-2">
                  {String(row[header] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function chartBody(spec: ChartSpec) {
  if (spec.type === "table") return renderTable(spec);

  const xLabel = prettify(spec.xField);
  const yLabel = yAxisLabel(spec);

  if (spec.type === "line") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={spec.data} margin={{ top: 8, right: 16, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} strokeOpacity={0.5} />
          <XAxis dataKey={spec.xField} tick={axisTick} stroke={gridStroke} label={{ value: xLabel, position: "insideBottom", offset: -12, style: axisLabelStyle }} />
          <YAxis tick={axisTick} stroke={gridStroke} label={{ value: yLabel, angle: -90, position: "insideLeft", style: axisLabelStyle }} />
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={legendStyle} />
          {spec.yFields.map((field, index) => (
            <Line key={field} dataKey={field} name={prettify(field)} stroke={categorical[index % categorical.length]} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (spec.type === "bar") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={spec.data} margin={{ top: 8, right: 16, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} strokeOpacity={0.5} />
          <XAxis dataKey={spec.xField} tick={axisTick} stroke={gridStroke} label={{ value: xLabel, position: "insideBottom", offset: -12, style: axisLabelStyle }} />
          <YAxis tick={axisTick} stroke={gridStroke} label={{ value: yLabel, angle: -90, position: "insideLeft", style: axisLabelStyle }} />
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={legendStyle} />
          {spec.yFields.map((field, index) => (
            <Bar key={field} dataKey={field} name={prettify(field)} fill={categorical[index % categorical.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (spec.type === "area") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={spec.data} margin={{ top: 8, right: 16, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} strokeOpacity={0.5} />
          <XAxis dataKey={spec.xField} tick={axisTick} stroke={gridStroke} label={{ value: xLabel, position: "insideBottom", offset: -12, style: axisLabelStyle }} />
          <YAxis tick={axisTick} stroke={gridStroke} label={{ value: yLabel, angle: -90, position: "insideLeft", style: axisLabelStyle }} />
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={legendStyle} />
          {spec.yFields.map((field, index) => (
            <Area
              key={field}
              dataKey={field}
              name={prettify(field)}
              stackId="stack"
              stroke={categorical[index % categorical.length]}
              fill={categorical[index % categorical.length]}
              fillOpacity={0.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (spec.type === "scatter") {
    const yField = spec.yFields[0];
    if (!yField) return renderTable(spec);
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, left: 8, bottom: 24 }}>
          <CartesianGrid stroke={gridStroke} strokeOpacity={0.5} />
          <XAxis dataKey={spec.xField} name={prettify(spec.xField)} tick={axisTick} stroke={gridStroke} label={{ value: xLabel, position: "insideBottom", offset: -12, style: axisLabelStyle }} />
          <YAxis dataKey={yField} name={prettify(yField)} tick={axisTick} stroke={gridStroke} label={{ value: prettify(yField), angle: -90, position: "insideLeft", style: axisLabelStyle }} />
          <Tooltip {...tooltipStyle} cursor={{ strokeDasharray: "3 3", stroke: "var(--color-muted-foreground)", strokeOpacity: 0.3 }} />
          <Scatter data={spec.data} name={prettify(yField)} fill={categorical[0]} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  if (spec.type === "pie") {
    const yField = spec.yFields[0];
    if (!yField) return renderTable(spec);
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={spec.data} dataKey={yField} nameKey={spec.xField} innerRadius={45} outerRadius={75}>
            {spec.data.map((row, index) => (
              <Cell key={`${String(row[spec.xField] ?? index)}-${index}`} fill={categorical[index % categorical.length]} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={legendStyle} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return renderTable(spec);
}

export function DataDrivenChart({ spec }: { spec: ChartSpec }) {
  return (
    <VisualizationCard title={spec.title} subtitle={spec.note}>
      {spec.type === "table" ? renderTable(spec) : <div className="h-60">{chartBody(spec)}</div>}
      {Array.isArray(spec.sources) && spec.sources.length > 0 ? (
        <p className="mt-2 text-xs text-(--color-muted-foreground)">Sources: {spec.sources.join(", ")}</p>
      ) : null}
    </VisualizationCard>
  );
}
