import { VisualizationCard } from "@/components/viz/VisualizationCard";

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] py-1 text-xs last:border-0">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function MPProfile() {
  return (
    <VisualizationCard title="MPProfile">
      <KeyValue label="Name" value="Sample MP" />
      <KeyValue label="Party" value="Labour" />
      <KeyValue label="Loyalty score" value="87%" />
    </VisualizationCard>
  );
}

export function ConstituencySnapshot() {
  return (
    <VisualizationCard title="ConstituencySnapshot">
      <KeyValue label="Population" value="72,300" />
      <KeyValue label="Median age" value="38.1" />
      <KeyValue label="Unemployment" value="4.2%" />
    </VisualizationCard>
  );
}

export function FoodHygieneCard() {
  return (
    <VisualizationCard title="FoodHygieneCard">
      <KeyValue label="Venue" value="Example Cafe" />
      <KeyValue label="Rating" value="5" />
      <KeyValue label="Authority" value="Camden" />
    </VisualizationCard>
  );
}

export function NHSServiceCard() {
  return (
    <VisualizationCard title="NHSServiceCard">
      <KeyValue label="Type" value="GP Surgery" />
      <KeyValue label="Distance" value="1.1 km" />
      <KeyValue label="Open" value="Yes" />
    </VisualizationCard>
  );
}

export function WeatherClimate() {
  return (
    <VisualizationCard title="WeatherClimate">
      <KeyValue label="Temp trend" value="+1.2°C" />
      <KeyValue label="Rainfall" value="62 mm" />
      <KeyValue label="Sunshine" value="124 hrs" />
    </VisualizationCard>
  );
}

export function FloodAlertCard() {
  return (
    <VisualizationCard title="FloodAlertCard">
      <KeyValue label="Severity" value="Amber" />
      <KeyValue label="Area" value="River Thames" />
      <KeyValue label="Updated" value="Today" />
    </VisualizationCard>
  );
}
