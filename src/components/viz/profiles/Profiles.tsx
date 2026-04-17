import { VisualizationCard } from "@/components/viz/VisualizationCard";
import type { VizPayload } from "@/lib/types";
import { isRecord } from "@/shared/type-guards";

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="border-b border-(--color-border) py-1 text-xs text-(--color-muted-foreground)">{label}</dt>
      <dd className="border-b border-(--color-border) py-1 text-right text-xs">{value}</dd>
    </>
  );
}

export function MPProfile() {
  return (
    <VisualizationCard title="MPProfile">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3">
        <KeyValue label="Name" value="Sample MP" />
        <KeyValue label="Party" value="Labour" />
        <KeyValue label="Loyalty score" value="87%" />
      </dl>
    </VisualizationCard>
  );
}

export function ConstituencySnapshot() {
  return (
    <VisualizationCard title="ConstituencySnapshot">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3">
        <KeyValue label="Population" value="72,300" />
        <KeyValue label="Median age" value="38.1" />
        <KeyValue label="Unemployment" value="4.2%" />
      </dl>
    </VisualizationCard>
  );
}

export function FoodHygieneCard() {
  return (
    <VisualizationCard title="FoodHygieneCard">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3">
        <KeyValue label="Venue" value="Example Cafe" />
        <KeyValue label="Rating" value="5" />
        <KeyValue label="Authority" value="Camden" />
      </dl>
    </VisualizationCard>
  );
}

export function NHSServiceCard() {
  return (
    <VisualizationCard title="NHSServiceCard">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3">
        <KeyValue label="Type" value="GP Surgery" />
        <KeyValue label="Distance" value="1.1 km" />
        <KeyValue label="Open" value="Yes" />
      </dl>
    </VisualizationCard>
  );
}

export function WeatherClimate() {
  return (
    <VisualizationCard title="WeatherClimate">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3">
        <KeyValue label="Temp trend" value="+1.2°C" />
        <KeyValue label="Rainfall" value="62 mm" />
        <KeyValue label="Sunshine" value="124 hrs" />
      </dl>
    </VisualizationCard>
  );
}

export function FloodAlertCard() {
  return (
    <VisualizationCard title="FloodAlertCard">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3">
        <KeyValue label="Severity" value="Amber" />
        <KeyValue label="Area" value="River Thames" />
        <KeyValue label="Updated" value="Today" />
      </dl>
    </VisualizationCard>
  );
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function CouncilDeliberationCard({ payload }: { payload: VizPayload }) {
  const data = isRecord(payload.data) ? payload.data : {};
  const displayName = typeof data.displayName === "string" ? data.displayName : "Selected area";
  const issue = typeof data.issue === "string" ? data.issue : "Council deliberation";
  const agents = Array.isArray(data.agents) ? data.agents.filter(isRecord) : [];
  const turns = Array.isArray(data.turns) ? data.turns.filter(isRecord) : [];
  const resolution = isRecord(data.resolution) ? data.resolution : {};
  const actionableSteps = readStringList(resolution.actionableSteps);

  return (
    <VisualizationCard title="CouncilDeliberation">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3">
        <KeyValue label="Area" value={displayName} />
        <KeyValue label="Issue" value={issue} />
        <KeyValue label="Representatives" value={String(agents.length)} />
        <KeyValue label="Turns" value={String(turns.length)} />
        <KeyValue label="Actions" value={String(actionableSteps.length)} />
      </dl>
    </VisualizationCard>
  );
}
