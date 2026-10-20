// Minimal Mapbox-Vector-Tile (MVT, protobuf) reader – just enough for water polygons: layers,
// features with class/kind properties and polygon geometry in tile coordinates. Pure, no DOM.

class Pbf {
  constructor(u8) { this.b = u8; this.p = 0; }
  get eof() { return this.p >= this.b.length; }
  varint() { let r = 0, s = 0, byte; do { byte = this.b[this.p++]; r += s < 28 ? (byte & 0x7f) << s : (byte & 0x7f) * 2 ** s; s += 7; } while (byte >= 0x80); return r; }
  svarint() { const n = this.varint(); return n % 2 === 1 ? -(n + 1) / 2 : n / 2; }   // zigzag
  bytes() { const n = this.varint(); const out = this.b.subarray(this.p, this.p + n); this.p += n; return out; }
  string() { return new TextDecoder().decode(this.bytes()); }
  skip(type) { if (type === 0) this.varint(); else if (type === 1) this.p += 8; else if (type === 2) this.bytes(); else if (type === 5) this.p += 4; else throw new Error('pbf wire type ' + type); }
  fixed64() { const lo = this.b[this.p] | (this.b[this.p + 1] << 8) | (this.b[this.p + 2] << 16) | (this.b[this.p + 3] * 2 ** 24); const hi = this.b[this.p + 4] | (this.b[this.p + 5] << 8) | (this.b[this.p + 6] << 16) | (this.b[this.p + 7] * 2 ** 24); this.p += 8; return lo + hi * 2 ** 32; }
  double() { const v = new DataView(this.b.buffer, this.b.byteOffset + this.p, 8).getFloat64(0, true); this.p += 8; return v; }
  float() { const v = new DataView(this.b.buffer, this.b.byteOffset + this.p, 4).getFloat32(0, true); this.p += 4; return v; }
}

function readValue(u8) {
  const p = new Pbf(u8);
  while (!p.eof) {
    const key = p.varint(), f = key >> 3, w = key & 7;
    if (f === 1) return p.string(); if (f === 2) return p.float(); if (f === 3) return p.double();
    if (f === 4) return p.varint(); if (f === 5) return p.varint(); if (f === 6) return p.svarint(); if (f === 7) return !!p.varint();
    p.skip(w);
  }
  return null;
}

/** Geometry commands → rings [[x,y],…] (polygons: all rings, outer and inner; lines: parts). */
function readGeometry(cmds) {
  const rings = []; let ring = null, x = 0, y = 0;
  for (let i = 0; i < cmds.length;) {
    const c = cmds[i++], id = c & 7, n = c >> 3;
    if (id === 1) { for (let k = 0; k < n; k++) { x += zz(cmds[i++]); y += zz(cmds[i++]); ring = [[x, y]]; rings.push(ring); } }
    else if (id === 2) { for (let k = 0; k < n; k++) { x += zz(cmds[i++]); y += zz(cmds[i++]); ring.push([x, y]); } }
    else if (id === 7) { if (ring && ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0]); }
    else throw new Error('mvt command ' + id);
  }
  return rings;
}
const zz = (n) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

/** Parse a tile: {layers: {name: {extent, features: [{type, props, rings}]}}} */
export function parseTile(u8) {
  const tile = new Pbf(u8), layers = {};
  while (!tile.eof) {
    const key = tile.varint(), f = key >> 3, w = key & 7;
    if (f !== 3) { tile.skip(w); continue; }
    const lp = new Pbf(tile.bytes());
    const layer = { name: '', extent: 4096, keys: [], values: [], raw: [] };
    while (!lp.eof) {
      const k = lp.varint(), lf = k >> 3, lw = k & 7;
      if (lf === 1) layer.name = lp.string();
      else if (lf === 2) layer.raw.push(lp.bytes());
      else if (lf === 3) layer.keys.push(lp.string());
      else if (lf === 4) layer.values.push(readValue(lp.bytes()));
      else if (lf === 5) layer.extent = lp.varint();
      else lp.skip(lw);
    }
    layer.features = layer.raw.map((fb) => {
      const fp = new Pbf(fb); const feat = { type: 0, props: {}, rings: [] };
      while (!fp.eof) {
        const k = fp.varint(), ff = k >> 3, fw = k & 7;
        if (ff === 2) { const tp = new Pbf(fp.bytes()); while (!tp.eof) { const ki = tp.varint(), vi = tp.varint(); feat.props[layer.keys[ki]] = layer.values[vi]; } }
        else if (ff === 3) feat.type = fp.varint();
        else if (ff === 4) { const gp = new Pbf(fp.bytes()); const cmds = []; while (!gp.eof) cmds.push(gp.varint()); feat.rings = readGeometry(cmds); }
        else fp.skip(fw);
      }
      return feat;
    });
    delete layer.raw;
    layers[layer.name] = layer;
  }
  return { layers };
}

/** Point-in-polygon over all rings of a feature (even-odd rule) in tile coordinates. */
export function insideFeature(feat, x, y) {
  let inside = false;
  for (const ring of feat.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Encode (test helper): build a tiny tile with one polygon layer. */
export function encodeTestTile(layerName, polygons, extent = 4096) {
  const enc = []; const varint = (n) => { const o = []; while (n >= 0x80) { o.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } o.push(n); return o; };
  const zig = (n) => (n < 0 ? -n * 2 - 1 : n * 2);
  const str = (s) => { const b = new TextEncoder().encode(s); return [...varint(b.length), ...b]; };
  const feats = polygons.map((rings, idx) => {
    const cmds = [];
    for (const ring of rings) { let px = 0, py = 0; cmds.push(...varint((1 << 3) | 1)); cmds.push(...varint(zig(ring[0][0] - px)), ...varint(zig(ring[0][1] - py))); px = ring[0][0]; py = ring[0][1]; cmds.push(...varint((ring.length - 1) << 3 | 2)); for (let i = 1; i < ring.length; i++) { cmds.push(...varint(zig(ring[i][0] - px)), ...varint(zig(ring[i][1] - py))); px = ring[i][0]; py = ring[i][1]; } cmds.push(...varint((1 << 3) | 7)); }
    const tags = [...varint(0), ...varint(0)];
    const body = [...[(2 << 3) | 2, ...varint(tags.length), ...tags], (3 << 3) | 0, 3, (4 << 3) | 2, ...varint(cmds.length), ...cmds];
    return [(2 << 3) | 2, ...varint(body.length), ...body];
  }).flat();
  const value = [(1 << 3) | 2, ...str('lake')];
  const layer = [(1 << 3) | 2, ...str(layerName), ...feats, (3 << 3) | 2, ...str('class'), (4 << 3) | 2, ...varint(value.length), ...value, (5 << 3) | 0, ...varint(extent)];
  enc.push((3 << 3) | 2, ...varint(layer.length), ...layer);
  return new Uint8Array(enc);
}
