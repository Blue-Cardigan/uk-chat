import { VisualizationCard } from "@/components/viz/VisualizationCard";

function GridItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] p-2 text-xs">
      <div className="text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

export function SyntheticPersona() {
  return (
    <VisualizationCard title="SyntheticPersona" subtitle="IPF census-fitted persona">
      <div className="grid grid-cols-2 gap-2">
        <GridItem label="Name" value="Alex Morgan" />
        <GridItem label="Age group" value="35-54" />
        <GridItem label="Tenure" value="Private rent" />
        <GridItem label="Employment" value="Employed" />
      </div>
    </VisualizationCard>
  );
}

export function AreaScorecard() {
  return (
    <VisualizationCard title="AreaScorecard">
      <div className="grid grid-cols-3 gap-2">
        <GridItem label="Health" value="B" />
        <GridItem label="Safety" value="C" />
        <GridItem label="Transport" value="A" />
      </div>
    </VisualizationCard>
  );
}

export function LocalServicesAudit() {
  return (
    <VisualizationCard title="LocalServicesAudit">
      <GridItem label="Service density" value="+14% vs UK avg" />
    </VisualizationCard>
  );
}

export function ElectionSwing() {
  return (
    <VisualizationCard title="ElectionSwing">
      <GridItem label="Swing" value="+4.1% to Labour" />
    </VisualizationCard>
  );
}

export function DemographicPyramid() {
  return (
    <VisualizationCard title="DemographicPyramid">
      <p className="text-xs text-[var(--color-muted-foreground)]">Population age distribution by gender.</p>
    </VisualizationCard>
  );
}

export function CostOfLivingSnapshot() {
  return (
    <VisualizationCard title="CostOfLivingSnapshot">
      <div className="grid grid-cols-2 gap-2">
        <GridItem label="Energy cost" value="£1,804/yr" />
        <GridItem label="Median wage" value="£35,100" />
      </div>
    </VisualizationCard>
  );
}
