import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { moonCoordinates, moonVector } from './moonRuntime';
import {
  buildDisplacedMoonGeometry,
  decodePackedHeightKm,
  readPackedElevationRaster,
  sampleTerrainHeightKm,
  terrainRadius,
  type PackedElevationRaster,
  type TerrainRasters,
} from './terrainRecovery';

/** Deliberately synthetic DEMs test display mechanics, not scientific accuracy. */
function raster(width: number, height: number, elevationAt: (column: number, row: number) => number): PackedElevationRaster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const packed = Math.round((elevationAt(column, row) + 9.5) / 20.5 * 65535);
      const offset = (row * width + column) * 4;
      data[offset] = packed >>> 8;
      data[offset + 1] = packed & 255;
      data[offset + 2] = data[offset];
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

const ridgeAndTrough: TerrainRasters = {
  global: raster(8, 5, column => column < 4 ? 6 : -6),
};

afterEach(() => {
  vi.restoreAllMocks();
});

function mockImageRaster(source: PackedElevationRaster) {
  const image = document.createElement('img');
  image.width = source.width;
  image.height = source.height;
  let sourceRow = 0;
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn((...args: unknown[]) => { sourceRow = args[2] as number; }),
    getImageData: vi.fn((_x: number, _y: number, width: number, rows: number) => ({
      data: source.data.slice(sourceRow * width * 4, (sourceRow + rows) * width * 4),
    })),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  return { image, context };
}

function nearestVertex(geometry: BufferGeometry, latitude: number, longitude: number) {
  const expected = moonVector(latitude, longitude);
  const positions = geometry.getAttribute('position');
  let selected = 0;
  let closest = Infinity;
  for (let index = 0; index < positions.count; index++) {
    const distance = new Vector3().fromBufferAttribute(positions, index).normalize().distanceToSquared(expected);
    if (distance < closest) { closest = distance; selected = index; }
  }
  return { index: selected, point: new Vector3().fromBufferAttribute(positions, selected), directionError: Math.sqrt(closest) };
}

describe('progressive lunar display terrain', () => {
  it('decodes the packed height range and a reference pixel from the bundled global DEM', () => {
    expect(decodePackedHeightKm(0, 0)).toBe(-9.5);
    expect(decodePackedHeightKm(255, 255)).toBe(11);
    // R/G copied from ldem_global_2k.png at (1024, 512). This checks the
    // packed representation, not the provenance or accuracy of the source DEM.
    expect(decodePackedHeightKm(109, 144)).toBeCloseTo(-0.7263065537, 6);
  });

  it('samples the north-to-south global raster and limits the polar overlay to the south', () => {
    const northToSouth: TerrainRasters = { global: raster(8, 5, (_column, row) => 6 - row * 3) };
    expect(sampleTerrainHeightKm(northToSouth, 90, 0)).toBeCloseTo(6, 2);
    expect(sampleTerrainHeightKm(northToSouth, -90, 0)).toBeCloseTo(-6, 2);
    const withPolar: TerrainRasters = {
      global: raster(8, 5, () => -3),
      south: raster(8, 8, () => 7),
    };
    expect(sampleTerrainHeightKm(withPolar, -90, 0)).toBeCloseTo(7, 2);
    expect(sampleTerrainHeightKm(withPolar, 90, 0)).toBeCloseTo(-3, 2);
    expect(sampleTerrainHeightKm(withPolar, 0, 90)).toBeCloseTo(-3, 2);
    expect(sampleTerrainHeightKm(withPolar, -87, -45)).toBeCloseTo(sampleTerrainHeightKm(withPolar, -87, 315), 8);
  });

  it('builds actual nonuniform mesh radii from DEM heights while retaining angular and texture registration', async () => {
    const geometry = await buildDisplacedMoonGeometry({ rasters: ridgeAndTrough, widthSegments: 64, heightSegments: 32, yieldControl: async () => {} });
    expect(geometry).not.toBeNull();
    const ridge = nearestVertex(geometry!, 0, 270);
    const trough = nearestVertex(geometry!, 0, 90);
    expect(ridge.directionError).toBeLessThan(1e-6);
    expect(trough.directionError).toBeLessThan(1e-6);
    expect(ridge.point.length()).toBeGreaterThan(1.01);
    expect(trough.point.length()).toBeLessThan(0.99);
    expect(ridge.point.length() - trough.point.length()).toBeGreaterThan(0.02);
    expect(ridge.point.length()).toBeCloseTo(terrainRadius(sampleTerrainHeightKm(ridgeAndTrough, 0, 270)), 6);
    expect(trough.point.length()).toBeCloseTo(terrainRadius(sampleTerrainHeightKm(ridgeAndTrough, 0, 90)), 6);
    const primeMeridian = nearestVertex(geometry!, 0, 0);
    expect(geometry!.getAttribute('uv').getX(primeMeridian.index) % 1).toBeCloseTo(0.5, 6);
    expect(geometry!.getAttribute('uv').getX(ridge.index) % 1).toBeCloseTo(0.25, 6);
    expect(geometry!.getAttribute('normal').count).toBe(geometry!.getAttribute('position').count);
    geometry!.dispose();
  });

  it('raycasts the displaced mesh after own-axis rotation and recovers the displayed lunar point', async () => {
    const geometry = await buildDisplacedMoonGeometry({ rasters: ridgeAndTrough, widthSegments: 64, heightSegments: 32, yieldControl: async () => {} });
    expect(geometry).not.toBeNull();
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(geometry!, material);
    const body = new Group();
    body.add(mesh);
    body.rotateY(1.25);
    body.updateMatrixWorld(true);
    const direction = body.localToWorld(moonVector(0, 270)).normalize();
    const raycaster = new Raycaster(direction.clone().multiplyScalar(4), direction.clone().negate());
    const hit = raycaster.intersectObject(mesh, false)[0];
    expect(hit).toBeDefined();
    const localHit = body.worldToLocal(hit.point.clone());
    const coordinates = moonCoordinates(localHit);
    expect(coordinates.latDeg).toBeCloseTo(0, 4);
    expect(coordinates.lonEastDeg).toBeCloseTo(270, 4);
    // This is the actual raised mesh, not a raycast against the baseline sphere.
    expect(localHit.length()).toBeGreaterThan(1.01);
    expect(body.position.toArray()).toEqual([0, 0, 0]);
    expect(body.localToWorld(new Vector3(0, 1, 0)).toArray()).toEqual([0, 1, 0]);
    geometry!.dispose();
    material.dispose();
  });

  it('yields before completing enhancement so the baseline renderer can remain available', async () => {
    let releaseFirstYield: (() => void) | undefined;
    let yieldCount = 0;
    const promise = buildDisplacedMoonGeometry({
      rasters: ridgeAndTrough, widthSegments: 64, heightSegments: 32,
      yieldControl: () => {
        yieldCount++;
        return yieldCount === 1 ? new Promise<void>(resolve => { releaseFirstYield = resolve; }) : Promise.resolve();
      },
    });
    let completed = false;
    void promise.then(() => { completed = true; });
    await Promise.resolve();
    expect(yieldCount).toBe(1);
    expect(completed).toBe(false);
    releaseFirstYield!();
    const geometry = await promise;
    expect(geometry).not.toBeNull();
    expect(yieldCount).toBeGreaterThan(1);
    geometry!.dispose();
  });

  it('stops scheduled enhancement after cancellation without returning a partial mesh', async () => {
    let cancelled = false;
    let yieldCount = 0;
    const result = await buildDisplacedMoonGeometry({
      rasters: ridgeAndTrough, widthSegments: 128, heightSegments: 64,
      cancelled: () => cancelled,
      yieldControl: vi.fn(async () => { yieldCount++; if (yieldCount === 2) cancelled = true; }),
    });
    expect(result).toBeNull();
    expect(yieldCount).toBe(2);
  });

  it('reads the packed elevation image in bounded stripes and preserves every source byte', async () => {
    const source = raster(4, 130, (column, row) => -6 + row / 20 + column / 4);
    const { image, context } = mockImageRaster(source);
    const yieldControl = vi.fn(async () => {});
    const result = await readPackedElevationRaster(image, { yieldControl });
    expect(result).not.toBeNull();
    expect(result!.data).toEqual(source.data);
    expect(context.getImageData.mock.calls.map(call => call[3])).toEqual([64, 64, 2]);
    expect(context.drawImage.mock.calls.map(call => call[2])).toEqual([0, 64, 128]);
    expect(yieldControl.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('stops reading elevation stripes when enhancement is cancelled', async () => {
    const { image, context } = mockImageRaster(raster(4, 130, () => 0));
    let cancelled = false;
    let yieldCount = 0;
    const result = await readPackedElevationRaster(image, {
      cancelled: () => cancelled,
      yieldControl: async () => { if (++yieldCount === 2) cancelled = true; },
    });
    expect(result).toBeNull();
    expect(context.drawImage).toHaveBeenCalledTimes(1);
  });
});
