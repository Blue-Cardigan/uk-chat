import type { GeoProjection } from "d3-geo";
import type { ZoomTransform } from "d3-zoom";

export interface TileLayerConfig {
  url: string;
  attribution: string;
  minZoomToShow: number;
  tileSize: number;
}

const CARTO_LIGHT: TileLayerConfig = {
  url: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  minZoomToShow: 8,
  tileSize: 256,
};

const CARTO_DARK: TileLayerConfig = {
  ...CARTO_LIGHT,
  url: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
};

type Tile = {
  x: number;
  y: number;
  z: number;
  nwx: number;
  nwy: number;
  nex: number;
  ney: number;
  swx: number;
  swy: number;
};

export function getTileConfig(isDarkMode: boolean): TileLayerConfig {
  return isDarkMode ? CARTO_DARK : CARTO_LIGHT;
}

function tileUrl(config: TileLayerConfig, tile: Tile) {
  return config.url.replace("{z}", String(tile.z)).replace("{x}", String(tile.x)).replace("{y}", String(tile.y));
}

const WEB_MERCATOR_MAX_LAT = 85.05112878;
const TILE_ZOOM_BIAS = 1;
const TILE_MAX_ZOOM = 19;

function clampLat(lat: number): number {
  return Math.max(-WEB_MERCATOR_MAX_LAT, Math.min(WEB_MERCATOR_MAX_LAT, lat));
}

function normalizeLon(lon: number): number {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

function wrapTileX(x: number, z: number): number {
  const world = Math.pow(2, z);
  return ((x % world) + world) % world;
}

function lonLatToTileXY(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = Math.pow(2, z);
  const clampedLat = clampLat(lat);
  const latRad = (clampedLat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

function tileToLonLat(x: number, y: number, z: number): { lon: number; lat: number } {
  const n = Math.pow(2, z);
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lon, lat };
}

function screenToLonLat(
  projection: GeoProjection,
  transform: ZoomTransform,
  sx: number,
  sy: number,
): [number, number] | null {
  const geoX = (sx - transform.x) / transform.k;
  const geoY = (sy - transform.y) / transform.k;
  const lonLat = projection.invert?.([geoX, geoY]);
  if (!lonLat || !Number.isFinite(lonLat[0]) || !Number.isFinite(lonLat[1])) return null;
  return [lonLat[0], lonLat[1]];
}

export function computeVisibleTiles(
  projection: GeoProjection,
  transform: ZoomTransform,
  width: number,
  height: number,
  config: TileLayerConfig,
  mapZoom: number,
): Tile[] | null {
  if (mapZoom < config.minZoomToShow) return null;
  const z = Math.min(TILE_MAX_ZOOM, Math.max(config.minZoomToShow, Math.floor(mapZoom + TILE_ZOOM_BIAS)));

  const samplePoints = [
    screenToLonLat(projection, transform, 0, 0),
    screenToLonLat(projection, transform, width / 2, 0),
    screenToLonLat(projection, transform, width, 0),
    screenToLonLat(projection, transform, width, height / 2),
    screenToLonLat(projection, transform, width, height),
    screenToLonLat(projection, transform, width / 2, height),
    screenToLonLat(projection, transform, 0, height),
    screenToLonLat(projection, transform, 0, height / 2),
    screenToLonLat(projection, transform, width / 2, height / 2),
  ].filter((value): value is [number, number] => value !== null);
  if (samplePoints.length < 3) return null;

  const lons = samplePoints.map(([lon]) => normalizeLon(lon));
  const lats = samplePoints.map(([, lat]) => lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const nw = lonLatToTileXY(minLon, maxLat, z);
  const se = lonLatToTileXY(maxLon, minLat, z);

  const minTileX = Math.floor(Math.min(nw.x, se.x)) - 1;
  const maxTileX = Math.floor(Math.max(nw.x, se.x)) + 1;
  const world = Math.pow(2, z);
  const minTileY = Math.max(0, Math.floor(Math.min(nw.y, se.y)) - 1);
  const maxTileY = Math.min(world - 1, Math.floor(Math.max(nw.y, se.y)) + 1);

  const tiles: Tile[] = [];
  for (let y = minTileY; y <= maxTileY; y += 1) {
    for (let x = minTileX; x <= maxTileX; x += 1) {
      const wrappedX = wrapTileX(x, z);
      const nwCorner = tileToLonLat(x, y, z);
      const neCorner = tileToLonLat(x + 1, y, z);
      const swCorner = tileToLonLat(x, y + 1, z);
      const nwPoint = projection([nwCorner.lon, nwCorner.lat]);
      const nePoint = projection([neCorner.lon, neCorner.lat]);
      const swPoint = projection([swCorner.lon, swCorner.lat]);
      if (!nwPoint || !nePoint || !swPoint) continue;
      tiles.push({
        x: wrappedX,
        y,
        z,
        nwx: nwPoint[0] * transform.k + transform.x,
        nwy: nwPoint[1] * transform.k + transform.y,
        nex: nePoint[0] * transform.k + transform.x,
        ney: nePoint[1] * transform.k + transform.y,
        swx: swPoint[0] * transform.k + transform.x,
        swy: swPoint[1] * transform.k + transform.y,
      });
    }
  }
  return tiles;
}

export class TileRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly config: TileLayerConfig;
  private readonly ctx: CanvasRenderingContext2D;
  private cache = new Map<string, HTMLImageElement>();
  private loading = new Set<string>();
  private currentTiles: Tile[] = [];
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, config: TileLayerConfig) {
    this.canvas = canvas;
    this.config = config;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2d context from canvas");
    this.ctx = ctx;
  }

  update(tiles: Tile[] | null): void {
    if (this.disposed) return;
    if (!tiles) {
      this.currentTiles = [];
      this.clear();
      return;
    }
    this.currentTiles = tiles;
    this.loadAndPaint();
  }

  dispose(): void {
    this.disposed = true;
    this.cache.clear();
    this.loading.clear();
  }

  private clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private loadAndPaint(): void {
    for (const tile of this.currentTiles) {
      const url = tileUrl(this.config, tile);
      if (this.cache.has(url) || this.loading.has(url)) continue;
      this.loading.add(url);
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        if (this.disposed) return;
        this.loading.delete(url);
        this.cache.set(url, image);
        this.paint();
      };
      image.onerror = () => {
        this.loading.delete(url);
      };
      image.src = url;
    }
    this.paint();
  }

  private paint(): void {
    this.clear();
    const seamScale = 1.006;
    const tileSize = this.config.tileSize;
    for (const tile of this.currentTiles) {
      const image = this.cache.get(tileUrl(this.config, tile));
      if (!image) continue;
      const a = ((tile.nex - tile.nwx) / tileSize) * seamScale;
      const b = ((tile.ney - tile.nwy) / tileSize) * seamScale;
      const c = ((tile.swx - tile.nwx) / tileSize) * seamScale;
      const d = ((tile.swy - tile.nwy) / tileSize) * seamScale;
      this.ctx.save();
      this.ctx.setTransform(a, b, c, d, tile.nwx, tile.nwy);
      this.ctx.drawImage(image, 0, 0, tileSize, tileSize);
      this.ctx.restore();
    }
  }
}
