import { describe, expect, it } from 'vitest';
import { Group, Vector3 } from 'three';
import { moonCoordinates, moonVector } from './moonRuntime';

describe('lunar display coordinate registration', () => {
  it.each([[-85, 0], [-83.4, 42.5], [-43.3, 348.8], [0, 180], [85, 270]])(
    'round trips latitude %s and east longitude %s', (lat, lon) => {
      const coordinates = moonCoordinates(moonVector(lat, lon).multiplyScalar(1.01));
      expect(coordinates.latDeg).toBeCloseTo(lat, 8);
      expect(coordinates.lonEastDeg).toBeCloseTo(lon, 8);
    },
  );

  it('keeps the body centered and the pole axis fixed during its own-axis spin', () => {
    const body = new Group();
    body.rotateY(0.9);
    body.updateMatrixWorld(true);
    expect(body.position.toArray()).toEqual([0, 0, 0]);
    expect(body.localToWorld(new Vector3(0, 1, 0)).toArray()).toEqual([0, 1, 0]);
  });

  it('recovers the same picked coordinate from a spun globe rather than the camera frame', () => {
    const body = new Group();
    body.rotateY(1.25);
    body.updateMatrixWorld(true);
    const worldHit = body.localToWorld(moonVector(-85.7, 132));
    const picked = moonCoordinates(body.worldToLocal(worldHit));
    expect(picked.latDeg).toBeCloseTo(-85.7, 8);
    expect(picked.lonEastDeg).toBeCloseTo(132, 8);
  });
});
