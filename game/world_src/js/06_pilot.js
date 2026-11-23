// ============================================================ the pilot: a human astronaut in a white EVA suit, in pixel art
// Drawn with the same software raster as the cockpit: polygons with ordered-dither shading and dark outlines. Tilt, pitch, recoil and throttle move in
// whole-pixel steps, and each distinct pose is rendered once and cached, so a frame normally just blits a sprite.
const PX0 = 100, PY0 = 168, PBW = 280, PBH = 132;           // the sprite sits at (100,168) on the 480x300 stage
const WHT = ['#1f2733', '#4a566a', '#7c889b', '#aeb9c8', '#dfe6ef', '#ffffff'].map(C32);
const BLU = ['#0a1c3a', '#13396f', '#1f5fb4', '#3b87e0', '#8cc4ff'].map(C32);
const pBuf = makeBuf(PBW, PBH), pCache = new Map();
const since = (t0, t, ms) => Math.max(0, 1 - (t - t0) / ms);
const whitePaint = (cx, cy, base) => (x, y) => ramp(WHT, (base || 3.7) - 0.05 * (x - cx) - 0.03 * (y - cy) + (hash2(x, y) - 0.5) * 0.35, x, y);
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function pilotLayout() {
  const tS = clamp(Math.round(K.tilt / 0.075), -4, 4), pS = clamp(Math.round(K.pitch * 3), -3, 3), kS = Math.round(K.recoil * 3);
  const thr = Math.round(clamp(0.45 + thrSm * 0.55 + ((boost || hold('shift')) ? 0.12 : 0), 0, 1) * 8);
  return { tS, pS, kS, thr, gx: 140 + tS * 2.5, gy: 58 + pS * 1.5 + kS, ty: 78 + 22 * (1 - thr / 8), tbx: 60 };
}
function renderPilot(L, st8) {
  useBuf(pBuf); SD.fill(0);
  const { gx, gy, ty, tbx } = L, sleeveBlue = BLU;
  // ---------------- throttle quadrant ----------------
  part([[26, 113], [94, 113], [98, 128], [22, 128]], (x, y) => ramp(STEEL, 2.4 + (y < 117 ? 1 : 0) + (hash2(x, y) - 0.5) * 0.5, x, y));
  srect(54, 114, 12, 5, STEEL[0]); srect(30, 118, 18, 2, STEEL[0]);
  sdisc(82, 121, 7, STEEL[0], STEEL[0]);
  for (let a = 0; a < 14; a++) sp(Math.round(82 + Math.cos(a / 14 * 6.283) * 6), Math.round(121 + Math.sin(a / 14 * 6.283) * 6), a % 2 ? ORANGE[3] : STEEL[0]);
  sdisc(82, 121 + (st8.boostOn ? 1 : 0), 3, RED[1], st8.boostOn ? RED[3] : RED[2]);
  if (st8.hover === 'go') sring(82, 121, 9, ORANGE[4]);
  part([[56, 113], [64, 113], [63, ty + 4], [57, ty + 4]], (x, y) => ramp(STEEL, 1.4 + (x < 59 ? 1 : 0) + (hash2(x, y) - 0.5) * 0.4, x, y));
  // ---------------- hand controller ----------------
  part([[98, 121], [182, 121], [186, 129], [94, 129]], (x, y) => ramp(STEEL, 2.6 + (y < 124 ? 1.2 : 0) + (hash2(x, y) - 0.5) * 0.4, x, y));
  for (const [lx, c] of [[116, st8.locked ? GREEN[3] : GREEN[1]], [124, st8.over ? AMB[0] : AMB[2]], [132, st8.low ? RED[2] : RED[0]]]) srect(lx, 124, 4, 2, c);
  for (const x of [102, 178]) srivet(x, 123);
  const btx = 140 + L.tS * 1.25, bty = 94 + (gy - 58) * 0.4, shx = 140 + L.tS * 2.1, shy = 82 + (gy - 58) * 0.8;
  const BOOT = [[116, 122], [164, 122], [btx + 8, bty], [btx - 8, bty]];
  part(BOOT, (x, y) => ramp(STEEL, 1.1 + 1.2 * (1 - Math.abs(x - (btx + 140) / 2) / 28) + (hash2(x, y) - 0.5) * 0.3, x, y));
  for (let i = 1; i < 7; i++) { const a = lerp2(BOOT[0], BOOT[3], i / 7), b = lerp2(BOOT[1], BOOT[2], i / 7); sline(Math.round(a[0]), Math.round(a[1]), Math.round(b[0]), Math.round(b[1] + 2), STEEL[0]); }
  part([[btx - 3, bty], [btx + 3, bty], [shx + 3, shy], [shx - 3, shy]], (x, y) => ramp(STEEL, 4 + (x < (btx + shx) / 2 ? 2 : -0.5), x, y));
  part(shiftPts(140 + L.tS * 2.3, 77 + (gy - 58) * 0.9, [[-8, -3], [8, -3], [8, 3], [-8, 3]]), (x, y) => ramp(STEEL, 4 + (y < 77 + (gy - 58) * 0.9 ? 1 : -1), x, y));
  part(shiftPts(gx, gy, [[-9, 26], [-13, 14], [-14, 0], [-11, -14], [-6, -23], [6, -23], [11, -14], [14, 0], [13, 14], [9, 26]]), (x, y) => ramp(STEEL, 1.1 + 1.3 * Math.max(0, 1 - Math.abs(x - gx + 4) / 12) + (((x + y) & 1) ? -0.12 : 0.1), x, y));
  sdisc(gx, gy - 15, 5, STEEL[5], STEEL[1]); sp(gx - 2, gy - 15, STEEL[6]); sp(gx + 2, gy - 15, STEEL[6]);
  if (st8.hover === 'hatL' || st8.hover === 'hatR') sring(gx, gy - 15, 8, ORANGE[4]);
  part(shiftPts(gx, gy, [[-18, -10], [-11, -10], [-11, -5], [-18, -5]]), (x, y) => ramp(STEEL, 4.3, x, y)); sp(gx - 15, gy - 8, st8.locked ? RED[2] : RED[0]);
  if (st8.hover === 'fire') sring(gx - 15, gy - 8, 9, ORANGE[4]);
  outlinePass(0);
  useBuf(SBUF);
}
function pilotKey(t) {
  const L = pilotLayout(), hatPress = since(K.hatT, t, 170) > 0.4 ? K.hatDir : 0, boostOn = boost || hold('shift'), low = ship.hull < 35 && state === 'play' && Math.floor(t / 300) % 2 === 1;
  const st8 = { locked: !!aim, over: ship.over, boostOn, hover: K.hover, hatPress, low };
  return { L, st8, key: [L.tS, L.pS, L.kS, L.thr, st8.locked ? 1 : 0, st8.over ? 1 : 0, boostOn ? 1 : 0, K.hover, hatPress, low ? 1 : 0].join('|') };
}
function drawPilotSprite(t) {
  const { L, st8, key } = pilotKey(t);
  let c = pCache.get(key);
  if (!c) { renderPilot(L, st8); c = document.createElement('canvas'); c.width = PBW; c.height = PBH; c.getContext('2d').putImageData(pBuf.img, 0, 0); pCache.set(key, c); if (pCache.size > 60) pCache.delete(pCache.keys().next().value); }
  ctx.drawImage(c, PX0, PY0);
}
// pointer hit-testing in stage coordinates
function pilotHit(sx, sy) {
  const L = pilotLayout(), x = sx - PX0, y = sy - PY0;
  if (Math.hypot(x - 82, y - 121) < 8) return 'go';
  if (Math.hypot(x - (L.gx - 15), y - (L.gy - 8)) < 8) return 'fire';
  if (Math.hypot(x - L.gx, y - (L.gy - 15)) < 7) return x < L.gx ? 'hatL' : 'hatR';
  if (Math.abs(x - L.gx) < 26 && y > L.gy - 32 && y < L.gy + 40) return 'grip';
  return '';
}
