import { useMemo } from "react";
import type { FeatureCollection, Geometry } from "geojson";
import { VisualizationCard } from "@/components/viz/VisualizationCard";
import { D3MapCanvas } from "@/components/uk-map/d3/D3MapCanvas";
import { useUkMapGeography } from "@/components/uk-map/useUkMapGeography";

function useFeatures(): FeatureCollection<Geometry> | null {
  const { collection } = useUkMapGeography();
  return useMemo(() => collection, [collection]);
}

export function ChoroplethMap() {
  const features = useFeatures();
  return (
    <VisualizationCard title="ChoroplethMap" subtitle="D3 + CARTO custom renderer">
      <D3MapCanvas width={360} height={230} isDarkMode={false} features={features} />
    </VisualizationCard>
  );
}

export function PointMap() {
  const features = useFeatures();
  return (
    <VisualizationCard title="PointMap">
      <D3MapCanvas width={360} height={230} isDarkMode={false} features={features} />
    </VisualizationCard>
  );
}

export function FloodRiskMap() {
  const features = useFeatures();
  return (
    <VisualizationCard title="FloodRiskMap">
      <D3MapCanvas width={360} height={230} isDarkMode={false} features={features} />
    </VisualizationCard>
  );
}

export function PostcodeZoom() {
  const features = useFeatures();
  return (
    <VisualizationCard title="PostcodeZoom">
      <D3MapCanvas width={360} height={230} isDarkMode={false} features={features} />
    </VisualizationCard>
  );
}
