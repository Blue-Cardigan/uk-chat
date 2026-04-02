import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, Feature, Geometry } from "geojson";
import { select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { createPathGenerator, createUkProjection, scaleToZoom, zoomToScale } from "@/components/uk-map/d3/projection";
import { computeVisibleTiles, getTileConfig, TileRenderer } from "@/components/uk-map/d3/tileLayer";
import { MAP_ZOOM } from "@/components/uk-map/mapZoom";
import { WaterBackground } from "@/components/uk-map/d3/WaterBackground";
import type { ChoroplethEntry, FocusPoint, OverlayPoint } from "@/lib/viz-data-parser";

const FEATURE_CODE_ALIASES = [
  "PCON24CD",
  "pcon24cd",
  "geography_code",
  "geography",
  "area_code",
  "lad_code",
  "gss_code",
  "code",
  "id",
];

const POINT_PALETTE = [
  "#38bdf8",
  "#a78bfa",
  "#22c55e",
  "#f97316",
  "#ef4444",
  "#14b8a6",
  "#eab308",
  "#f472b6",
];

function normalizeCode(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeField(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function getFeatureCode(feature: Feature<Geometry>): string | null {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const aliases = new Set(FEATURE_CODE_ALIASES.map((alias) => normalizeField(alias)));
  for (const [key, raw] of Object.entries(props)) {
    if (!aliases.has(normalizeField(key))) continue;
    if (typeof raw !== "string") continue;
    const normalized = normalizeCode(raw);
    if (normalized.length > 0) return normalized;
  }
  return null;
}

function pointColor(category: string | undefined): string {
  if (!category) return POINT_PALETTE[0];
  let hash = 0;
  for (let index = 0; index < category.length; index += 1) {
    hash = (hash << 5) - hash + category.charCodeAt(index);
    hash |= 0;
  }
  return POINT_PALETTE[Math.abs(hash) % POINT_PALETTE.length];
}

function pointRadius(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3.5;
  return Math.max(2.75, Math.min(8.5, 2.25 + Math.sqrt(Math.abs(value)) / 4));
}

export function D3MapCanvas({
  width,
  height,
  isDarkMode,
  features,
  choropleth,
  points,
  focusPoint,
}: {
  width: number;
  height: number;
  isDarkMode: boolean;
  features: FeatureCollection<Geometry> | null;
  choropleth?: ChoroplethEntry[];
  points?: OverlayPoint[];
  focusPoint?: FocusPoint;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tileRendererRef = useRef<TileRenderer | null>(null);
  const zoomTransformRef = useRef<ZoomTransform>(zoomIdentity);
  const [mapZoom, setMapZoom] = useState(5.5);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  const projection = useMemo(() => createUkProjection(width, height), [height, width]);
  const pathGen = useMemo(() => createPathGenerator(projection), [projection]);
  const tileConfig = useMemo(() => getTileConfig(isDarkMode), [isDarkMode]);
  const logicalZoom = mapZoom;
  const fadeRange = MAP_ZOOM.tileBackgroundFadeEnd - MAP_ZOOM.tileBackgroundFadeStart;
  const fadeProgress = Math.max(0, Math.min(1, (logicalZoom - MAP_ZOOM.tileBackgroundFadeStart) / Math.max(0.0001, fadeRange)));
  const smoothFade = 1 - fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
  const fade =
    logicalZoom <= MAP_ZOOM.tileBackgroundFadeStart
      ? 1
      : smoothFade;
  const choroplethLookup = useMemo(() => {
    const map = new Map<string, ChoroplethEntry>();
    for (const entry of choropleth ?? []) {
      map.set(normalizeCode(entry.code), entry);
    }
    return map;
  }, [choropleth]);
  const choroplethColor = useMemo(() => {
    const values = (choropleth ?? []).map((entry) => entry.value).filter((value) => Number.isFinite(value));
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      const uniform = isDarkMode ? "oklch(63% 0.16 250)" : "oklch(78% 0.13 250)";
      return () => uniform;
    }
    const lightnessScale = scaleLinear()
      .domain([min, max])
      .range(isDarkMode ? [72, 48] : [88, 56])
      .clamp(true);
    const chroma = isDarkMode ? 0.16 : 0.13;
    return (value: number) => `oklch(${lightnessScale(value).toFixed(1)}% ${chroma} 250)`;
  }, [choropleth, isDarkMode]);
  const projectedPoints = useMemo(
    () =>
      (points ?? [])
        .map((point) => {
          const projected = projection([point.lng, point.lat]);
          if (!projected) return null;
          return {
            ...point,
            x: projected[0],
            y: projected[1],
          };
        })
        .filter((point): point is OverlayPoint & { x: number; y: number } => point !== null),
    [points, projection],
  );

  useEffect(() => {
    if (!svgRef.current || !canvasRef.current) return;
    const svg = select(svgRef.current);
    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;
    tileRendererRef.current?.dispose();
    tileRendererRef.current = new TileRenderer(canvas, tileConfig);

    const zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 30])
      .filter((event) => {
        if (!prefersReducedMotion) return true;
        return event.type !== "wheel" && event.type !== "dblclick";
      })
      .on("zoom", (event: { transform: ZoomTransform }) => {
        zoomTransformRef.current = event.transform;
        const nextMapZoom = scaleToZoom(event.transform.k);
        setMapZoom(nextMapZoom);
        svg.select<SVGGElement>(".zoom-group").attr("transform", event.transform.toString());
        const visibleTiles = computeVisibleTiles(projection, event.transform, width, height, tileConfig, nextMapZoom);
        tileRendererRef.current?.update(visibleTiles);
      });

    svg.call(zoomBehavior);
    const defaultTransform = zoomIdentity.translate(width / 2, height / 2).scale(1.2).translate(-width / 2, -height / 2);
    const activeFocus = focusPoint ?? null;
    const projectedFocus = activeFocus ? projection([activeFocus.lng, activeFocus.lat]) : null;
    const focusTransform =
      projectedFocus !== null
        ? zoomIdentity
            .translate(width / 2, height / 2)
            .scale(zoomToScale(activeFocus?.zoom ?? 8.5))
            .translate(-projectedFocus[0], -projectedFocus[1])
        : null;
    svg.call(zoomBehavior.transform, prefersReducedMotion ? defaultTransform : focusTransform ?? defaultTransform);
    return () => {
      svg.on(".zoom", null);
      tileRendererRef.current?.dispose();
    };
  }, [focusPoint, height, prefersReducedMotion, projection, tileConfig, width]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-(--color-border)">
      <div className="absolute inset-0 z-0">
        <WaterBackground fade={fade} />
      </div>
      <canvas ref={canvasRef} className="absolute inset-0 z-10" />
      <svg ref={svgRef} width={width} height={height} className="relative z-20">
        <g className="zoom-group">
          {(features?.features ?? []).map((feature: FeatureCollection<Geometry>["features"][number], index: number) => (
            (() => {
              const featureCode = getFeatureCode(feature as Feature<Geometry>);
              const entry = featureCode ? choroplethLookup.get(featureCode) : undefined;
              const fill =
                featureCode && choroplethColor
                  ? entry
                    ? choroplethColor(entry.value)
                    : "color-mix(in oklch, var(--color-primary), transparent 88%)"
                  : "color-mix(in oklch, var(--color-primary), transparent 82%)";
              return (
                <path key={feature.id ? String(feature.id) : index} d={pathGen(feature) ?? ""} fill={fill} stroke="var(--color-border)" strokeWidth={0.8} />
              );
            })()
          ))}
          {projectedPoints.map((point, index) => (
            <circle
              key={`${point.label ?? "point"}-${index}-${point.x.toFixed(2)}-${point.y.toFixed(2)}`}
              cx={point.x}
              cy={point.y}
              r={pointRadius(point.value)}
              fill={pointColor(point.category)}
              fillOpacity={0.75}
              stroke="white"
              strokeOpacity={0.75}
              strokeWidth={0.9}
            >
              <title>{point.label ?? `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`}</title>
            </circle>
          ))}
          {focusPoint ? (
            (() => {
              const projected = projection([focusPoint.lng, focusPoint.lat]);
              if (!projected) return null;
              return (
                <g>
                  <circle cx={projected[0]} cy={projected[1]} r={10} fill="none" stroke="white" strokeOpacity={0.55} strokeWidth={1.2} />
                  <circle cx={projected[0]} cy={projected[1]} r={4.5} fill="oklch(70% 0.18 30)" stroke="white" strokeWidth={1.1} />
                  <title>{focusPoint.label ?? `${focusPoint.lat.toFixed(4)}, ${focusPoint.lng.toFixed(4)}`}</title>
                </g>
              );
            })()
          ) : null}
        </g>
      </svg>
    </div>
  );
}
