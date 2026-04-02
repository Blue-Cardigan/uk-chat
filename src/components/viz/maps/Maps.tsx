import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FeatureCollection, Geometry } from "geojson";
import { VisualizationCard } from "@/components/viz/VisualizationCard";
import { D3MapCanvas } from "@/components/uk-map/d3/D3MapCanvas";
import { useUkMapGeography } from "@/components/uk-map/useUkMapGeography";
import { useAppStore } from "@/lib/store";
import { extractMapData } from "@/lib/viz-data-parser";
import type { VizPayload } from "@/lib/types";
import type { ChoroplethEntry, FocusPoint, OverlayPoint } from "@/lib/viz-data-parser";

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

function ResponsiveMapFrame({
  isDarkMode,
  features,
  choropleth,
  points,
  focusPoint,
}: {
  isDarkMode: boolean;
  features: FeatureCollection<Geometry> | null;
  choropleth?: ChoroplethEntry[];
  points?: OverlayPoint[];
  focusPoint?: FocusPoint;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(360);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextWidth = Math.max(240, Math.round(entry.contentRect.width));
      setWidth(nextWidth);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const height = Math.max(200, Math.round(width * (230 / 360)));

  return (
    <div ref={containerRef} className="w-full">
      <D3MapCanvas
        width={width}
        height={height}
        isDarkMode={isDarkMode}
        features={features}
        choropleth={choropleth}
        points={points}
        focusPoint={focusPoint}
      />
    </div>
  );
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
      <ResponsiveMapFrame isDarkMode={isDarkMode} features={features} choropleth={choropleth} />
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
      <ResponsiveMapFrame isDarkMode={isDarkMode} features={features} points={points} />
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
      <ResponsiveMapFrame isDarkMode={isDarkMode} features={features} points={points} />
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
      <ResponsiveMapFrame isDarkMode={isDarkMode} features={features} points={points} focusPoint={focusPoint} />
    </VisualizationCard>
  );
}
