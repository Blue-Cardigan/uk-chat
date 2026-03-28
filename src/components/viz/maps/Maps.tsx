import { useMemo, useSyncExternalStore } from "react";
import type { FeatureCollection, Geometry } from "geojson";
import { VisualizationCard } from "@/components/viz/VisualizationCard";
import { D3MapCanvas } from "@/components/uk-map/d3/D3MapCanvas";
import { useUkMapGeography } from "@/components/uk-map/useUkMapGeography";
import { useAppStore } from "@/lib/store";

function useFeatures(): FeatureCollection<Geometry> | null {
  const { collection } = useUkMapGeography();
  return useMemo(() => collection, [collection]);
}

function subscribeToSystemTheme(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getSystemThemeSnapshot() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function useIsDarkMode() {
  const themePreference = useAppStore((state) => state.themePreference);
  const systemPrefersDark = useSyncExternalStore(subscribeToSystemTheme, getSystemThemeSnapshot, () => false);
  return themePreference === "dark" || (themePreference === "system" && systemPrefersDark);
}

export function ChoroplethMap() {
  const features = useFeatures();
  const isDarkMode = useIsDarkMode();
  return (
    <VisualizationCard title="ChoroplethMap" subtitle="D3 + CARTO custom renderer">
      <D3MapCanvas width={360} height={230} isDarkMode={isDarkMode} features={features} />
    </VisualizationCard>
  );
}

export function PointMap() {
  const features = useFeatures();
  const isDarkMode = useIsDarkMode();
  return (
    <VisualizationCard title="PointMap">
      <D3MapCanvas width={360} height={230} isDarkMode={isDarkMode} features={features} />
    </VisualizationCard>
  );
}

export function FloodRiskMap() {
  const features = useFeatures();
  const isDarkMode = useIsDarkMode();
  return (
    <VisualizationCard title="FloodRiskMap">
      <D3MapCanvas width={360} height={230} isDarkMode={isDarkMode} features={features} />
    </VisualizationCard>
  );
}

export function PostcodeZoom() {
  const features = useFeatures();
  const isDarkMode = useIsDarkMode();
  return (
    <VisualizationCard title="PostcodeZoom">
      <D3MapCanvas width={360} height={230} isDarkMode={isDarkMode} features={features} />
    </VisualizationCard>
  );
}
