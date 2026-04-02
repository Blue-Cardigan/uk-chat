import { VisualizationCard } from "@/components/viz/VisualizationCard";

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
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
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border-b border-(--color-border) py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DataGrid() {
  return (
    <VisualizationCard title="DataGrid">
      <SimpleTable headers={["Area", "Metric"]} rows={[["Bristol", "71"], ["Leeds", "64"]]} />
    </VisualizationCard>
  );
}

export function ContractsList() {
  return (
    <VisualizationCard title="ContractsList">
      <SimpleTable headers={["Buyer", "Value"]} rows={[["Manchester CC", "£2.4m"], ["NHS Trust", "£820k"]]} />
    </VisualizationCard>
  );
}

export function PlanningTimeline() {
  return (
    <VisualizationCard title="PlanningTimeline">
      <SimpleTable headers={["Application", "Status"]} rows={[["Retail conversion", "Approved"], ["Housing block", "Submitted"]]} />
    </VisualizationCard>
  );
}

export function CouncillorDirectory() {
  return (
    <VisualizationCard title="CouncillorDirectory">
      <SimpleTable headers={["Name", "Ward", "Party"]} rows={[["A. Smith", "North", "Labour"], ["B. Jones", "West", "Conservative"]]} />
    </VisualizationCard>
  );
}

export function TubeStatusBoard() {
  return (
    <VisualizationCard title="TubeStatusBoard">
      <SimpleTable headers={["Line", "Status"]} rows={[["Central", "Minor delays"], ["Victoria", "Good service"]]} />
    </VisualizationCard>
  );
}

export function TrafficCountChart() {
  return (
    <VisualizationCard title="TrafficCountChart">
      <SimpleTable headers={["Year", "AADF"]} rows={[["2023", "31,122"], ["2024", "30,870"]]} />
    </VisualizationCard>
  );
}
