import { useMemo, useSyncExternalStore } from "react";
import type { FeatureCollection, Geometry } from "geojson";
import { VisualizationCard } from "@/components/viz/VisualizationCard";
import { D3MapCanvas } from "@/components/uk-map/d3/D3MapCanvas";
import { useUkMapGeography } from "@/components/uk-map/useUkMapGeography";
import { useAppStore } from "@/lib/store";
import { extractMapData } from "@/lib/viz-data-parser";
import type { VizPayload } from "@/lib/types";

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

export function ChoroplethMap({ payload }: { payload?: VizPayload }) {
  const features = useFeatures();
  const isDarkMode = useIsDarkMode();
  const choropleth = useMemo(() => {
    const data = payload ? extractMapData(payload.data, "choropleth") : null;
    return data?.kind === "choropleth" ? data.entries : undefined;
  }, [payload]);
  return (
    <VisualizationCard title="ChoroplethMap" subtitle="D3 + CARTO custom renderer">
      <D3MapCanvas width={360} height={230} isDarkMode={isDarkMode} features={features} choropleth={choropleth} />
    </VisualizationCard>
  );
}

export function PointMap({ payload }: { payload?: VizPayload }) {
  const features = useFeatures();
  const isDarkMode = useIsDarkMode();
  const points = useMemo(() => {
    const data = payload ? extractMapData(payload.data, "points") : null;
    return data?.kind === "points" ? data.items : undefined;
  }, [payload]);
  return (
    <VisualizationCard title="PointMap">
      <D3MapCanvas width={360} height={230} isDarkMode={isDarkMode} features={features} points={points} />
    </VisualizationCard>
  );
}

export function FloodRiskMap({ payload }: { payload?: VizPayload }) {
  const features = useFeatures();
  const isDarkMode = useIsDarkMode();
  const points = useMemo(() => {
    const data = payload ? extractMapData(payload.data, "points") : null;
    return data?.kind === "points" ? data.items : undefined;
  }, [payload]);
  return (
    <VisualizationCard title="FloodRiskMap">
      <D3MapCanvas width={360} height={230} isDarkMode={isDarkMode} features={features} points={points} />
    </VisualizationCard>
  );
}

export function PostcodeZoom({ payload }: { payload?: VizPayload }) {
  const features = useFeatures();
  const isDarkMode = useIsDarkMode();
  const focusPoint = useMemo(() => {
    const data = payload ? extractMapData(payload.data, "focus") : null;
    return data?.kind === "focus"
      ? {
          ...data.point,
          zoom: data.point.zoom ?? 9.5,
        }
      : undefined;
  }, [payload]);
  const points = useMemo(
    () =>
      focusPoint
        ? [
            {
              lat: focusPoint.lat,
              lng: focusPoint.lng,
              label: focusPoint.label,
            },
          ]
        : undefined,
    [focusPoint],
  );
  return (
    <VisualizationCard title="PostcodeZoom">
      <D3MapCanvas width={360} height={230} isDarkMode={isDarkMode} features={features} points={points} focusPoint={focusPoint} />
    </VisualizationCard>
  );
}
