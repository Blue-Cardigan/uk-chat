import { useEffect, useMemo, useState } from "react";
import * as topojson from "topojson-client";
import type { FeatureCollection, Geometry, MultiLineString } from "geojson";

export function useUkMapGeography() {
  const [collection, setCollection] = useState<FeatureCollection<Geometry> | null>(null);
  const [mesh, setMesh] = useState<MultiLineString | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const response = await fetch("/geojson/pcon24_uk.topojson");
        if (!response.ok) throw new Error("Failed to load boundaries");
        const topo = (await response.json()) as { objects: Record<string, unknown> };
        const objectKey = Object.keys(topo.objects)[0];
        const object = topo.objects[objectKey] as never;
        const converted = topojson.feature(topo as never, object) as unknown as FeatureCollection<Geometry>;
        const boundaryMesh = topojson.mesh(topo as never, object) as unknown as MultiLineString;
        if (mounted) setCollection(converted);
        if (mounted) setMesh(boundaryMesh);
      } catch {
        // Fallback keeps UI usable in early environments without a dataset.
        if (mounted) setCollection({ type: "FeatureCollection", features: [] });
        if (mounted) setMesh(null);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  return useMemo(() => ({ collection, mesh }), [collection, mesh]);
}
