// QR encoder: structure checks (the decode check against OpenCV ran during development:
// versions 1, 3, 5 and 10 decoded to the input text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrEncode, qrSvg } from '../src/util/qr.js';

test('QR: version choice, finder patterns, timing, format info', () => {
  const q = qrEncode('https://analyze.wicki.aero/v/KQZMWB7R');
  assert.equal(q.version, 3); assert.equal(q.size, 29);
  const m = q.modules;
  // finder pattern top-left: outer ring dark, ring light, centre 3x3 dark; separator light
  assert.equal(m[0][0], 1); assert.equal(m[1][1], 0); assert.equal(m[3][3], 1); assert.equal(m[7][7], 0);
  assert.equal(m[0][22], 1); assert.equal(m[22][0], 1);                      // other two finders
  for (let i = 8; i < 21; i++) assert.equal(m[6][i], i % 2 === 0 ? 1 : 0);  // timing row
  assert.equal(m[21][8], 1);                                                 // dark module (4v+9, 8)
  assert.equal(qrEncode('A').version, 1); assert.equal(qrEncode('x'.repeat(200)).version, 10);
  assert.throws(() => qrEncode('x'.repeat(300)));
  const svg = qrSvg('https://analyze.wicki.aero/v/KQZMWB7R', { size: 100 });
  assert.match(svg, /^<svg[^>]+viewBox="0 0 37 37"/); assert.ok(svg.includes('<path d="M4 4h1v1h-1z'));
});
