import type { Feature, Geometry } from "geojson";

type Position = [number, number];

function isPointInRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonContains(point: Position, coordinates: Position[][]): boolean {
  if (!isPointInRing(point, coordinates[0])) return false;
  for (let holeIndex = 1; holeIndex < coordinates.length; holeIndex += 1) {
    if (isPointInRing(point, coordinates[holeIndex])) return false;
  }
  return true;
}

export function findFeatureAtPoint(point: Position, features: Array<Feature<Geometry>>): Feature<Geometry> | null {
  for (const feature of features) {
    const geometry = feature.geometry;
    if (geometry.type === "Polygon" && polygonContains(point, geometry.coordinates as Position[][])) return feature;
    if (geometry.type === "MultiPolygon") {
      const matches = (geometry.coordinates as Position[][][]).some((polygon) => polygonContains(point, polygon));
      if (matches) return feature;
    }
  }
  return null;
}
