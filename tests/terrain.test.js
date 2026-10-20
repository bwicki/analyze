import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTile, insideFeature, encodeTestTile } from '../src/terrain/mvt.js';
import { tileXY, pixelInTile, pickZoom, decodeTerrarium } from '../src/terrain/terrain.js';

test('MVT: encode → parse round trip, polygon with hole, point-in-polygon', () => {
  const outer = [[100, 100], [900, 100], [900, 900], [100, 900], [100, 100]], hole = [[400, 400], [600, 400], [600, 600], [400, 600], [400, 400]];
  const u8 = encodeTestTile('water', [[outer, hole], [[[2000, 2000], [2100, 2000], [2100, 2100], [2000, 2000]]]]);
  const tile = parseTile(u8);
  assert.ok(tile.layers.water); assert.equal(tile.layers.water.extent, 4096); assert.equal(tile.layers.water.features.length, 2);
  const f = tile.layers.water.features[0];
  assert.equal(f.type, 3); assert.equal(f.props.class, 'lake'); assert.equal(f.rings.length, 2); assert.equal(f.rings[0].length, 5);
  assert.ok(insideFeature(f, 200, 200)); assert.ok(!insideFeature(f, 500, 500), 'hole'); assert.ok(!insideFeature(f, 1500, 1500));
  assert.ok(insideFeature(tile.layers.water.features[1], 2050, 2030));
});

test('tiles: xyz from lat/lon, pixel in tile, zoom choice, terrarium decoding', () => {
  const { x, y } = tileXY(47.0, 8.0, 10);
  assert.equal(x, 534); assert.equal(y, 360);
  const p = pixelInTile(47.0, 8.0, 10, 256); assert.ok(p.px >= 0 && p.px < 256 && p.py >= 0 && p.py < 256);
  assert.ok(pickZoom({ minLat: 47, maxLat: 47.2, minLon: 8, maxLon: 8.3 }) >= 10);
  assert.ok(pickZoom({ minLat: 47, maxLat: 60, minLon: 6, maxLon: 27 }) <= 8);
  // terrarium: (R*256 + G + B/256) - 32768 → 800 m = R 131, G 32, B 0
  assert.equal(decodeTerrarium(131, 32, 0), 800);
});
