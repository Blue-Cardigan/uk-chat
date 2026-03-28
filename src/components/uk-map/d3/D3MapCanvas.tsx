import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, Geometry } from "geojson";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { createPathGenerator, createUkProjection, scaleToZoom } from "@/components/uk-map/d3/projection";
import { computeVisibleTiles, getTileConfig, TileRenderer } from "@/components/uk-map/d3/tileLayer";
import { MAP_ZOOM } from "@/components/uk-map/mapZoom";
import { WaterBackground } from "@/components/uk-map/d3/WaterBackground";

export function D3MapCanvas({
  width,
  height,
  isDarkMode,
  features,
}: {
  width: number;
  height: number;
  isDarkMode: boolean;
  features: FeatureCollection<Geometry> | null;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tileRendererRef = useRef<TileRenderer | null>(null);
  const zoomTransformRef = useRef<ZoomTransform>(zoomIdentity);
  const [mapZoom, setMapZoom] = useState(5.5);

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
      .on("zoom", (event: { transform: ZoomTransform }) => {
        zoomTransformRef.current = event.transform;
        const nextMapZoom = scaleToZoom(event.transform.k);
        setMapZoom(nextMapZoom);
        svg.select<SVGGElement>(".zoom-group").attr("transform", event.transform.toString());
        const visibleTiles = computeVisibleTiles(projection, event.transform, width, height, tileConfig, nextMapZoom);
        tileRendererRef.current?.update(visibleTiles);
      });

    svg.call(zoomBehavior);
    svg.call(zoomBehavior.transform, zoomIdentity.translate(width / 2, height / 2).scale(1.2).translate(-width / 2, -height / 2));
    return () => {
      svg.on(".zoom", null);
      tileRendererRef.current?.dispose();
    };
  }, [height, projection, tileConfig, width]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--color-border)]">
      <div className="absolute inset-0 z-0">
        <WaterBackground fade={fade} />
      </div>
      <canvas ref={canvasRef} className="absolute inset-0 z-10" />
      <svg ref={svgRef} width={width} height={height} className="relative z-20">
        <g className="zoom-group">
          {(features?.features ?? []).map((feature: FeatureCollection<Geometry>["features"][number], index: number) => (
            <path
              key={feature.id ? String(feature.id) : index}
              d={pathGen(feature) ?? ""}
              fill="color-mix(in oklch, var(--color-primary), transparent 82%)"
              stroke="var(--color-border)"
              strokeWidth={0.8}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
