import { geoPath, geoTransverseMercator, type GeoPath, type GeoProjection } from "d3-geo";

const UK_CENTER: [number, number] = [-2, 55];
const UK_ROTATION: [number, number, number] = [UK_CENTER[0], -UK_CENTER[1], 0];
const BASE_SCALE = 2400;

export function createUkProjection(width: number, height: number): GeoProjection {
  return geoTransverseMercator().rotate(UK_ROTATION).center([0, 0]).scale(BASE_SCALE).translate([width / 2, height / 2]);
}

export function createPathGenerator(projection: GeoProjection): GeoPath {
  return geoPath(projection);
}

export function scaleToZoom(k: number): number {
  return Math.log2((k * BASE_SCALE) / 256) + 0.72;
}

export function zoomToScale(zoom: number): number {
  return (Math.pow(2, zoom - 0.72) * 256) / BASE_SCALE;
}
