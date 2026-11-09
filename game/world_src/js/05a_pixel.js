// ============================================================ pixel toolkit and the static ship (built once, drawn every frame)
const PAL = { frame: '#2a3644', hi: '#51657b', lo: '#141c26', lamp: '#f2a93b', crt: '#46e07a', crtDk: '#0b2f1a', crtMd: '#1f8f4e',
  alert: '#ff5a4d', ok: '#5cd68a', amber: '#ffd36b', ink: '#cfe3ff', blue: '#4aa3ff', g0: '#031109', g1: '#0e3a1f', g2: '#1c7a40', g3: '#3fd673', g4: '#a8ffc9' };
const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); };
const px = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, 1, 1); };
function pline(x0, y0, x1, y1, c) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0; const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
  ctx.fillStyle = c;
  for (let n = 0; n < 900; n++) { ctx.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
}
function pcircle(cx, cy, r, c) {   // 1px circle outline (midpoint)
  ctx.fillStyle = c; let x = r, y = 0, e = 1 - r;
  while (x >= y) { for (const [a, b] of [[x, y], [y, x], [-x, y], [-y, x], [x, -y], [y, -x], [-x, -y], [-y, -x]]) ctx.fillRect(cx + a, cy + b, 1, 1); y++; if (e < 0) e += 2 * y + 1; else { x--; e += 2 * (y - x) + 1; } }
}
// 3x5 pixel font, used for every label and readout
const GL = {};
`A:010 101 111 101 101|B:110 101 110 101 110|C:011 100 100 100 011|D:110 101 101 101 110|E:111 100 110 100 111|F:111 100 110 100 100|G:011 100 101 101 011|H:101 101 111 101 101|I:111 010 010 010 111|J:001 001 001 101 010|K:101 101 110 101 101|L:100 100 100 100 111|M:101 111 111 101 101|N:111 101 101 101 101|O:010 101 101 101 010|P:110 101 110 100 100|Q:010 101 101 111 011|R:110 101 110 101 101|S:011 100 010 001 110|T:111 010 010 010 010|U:101 101 101 101 111|V:101 101 101 101 010|W:101 101 111 111 101|X:101 101 010 101 101|Y:101 101 010 010 010|Z:111 001 010 100 111|0:111 101 101 101 111|1:010 110 010 010 111|2:110 001 010 100 111|3:110 001 010 001 110|4:101 101 111 001 001|5:111 100 110 001 110|6:011 100 111 101 111|7:111 001 010 100 100|8:111 101 111 101 111|9:111 101 111 001 110|.:000 000 000 000 010|,:000 000 000 010 100|::000 010 000 010 000|-:000 000 111 000 000|+:000 010 111 010 000|/:001 001 010 100 100|%:101 001 010 100 101|>:100 010 001 010 100|<:001 010 100 010 001|(:010 100 100 100 010|):010 001 001 001 010|!:010 010 010 000 010|?:110 001 010 000 010|=:000 111 000 111 000|':010 010 000 000 000|_:000 000 000 000 111|*:101 010 111 010 101|#:101 111 101 111 101`
  .split('|').forEach(g => { GL[g[0]] = g.slice(2).replace(/ /g, ''); });
const twidth = (s, sc) => Math.max(0, String(s).length * 4 * (sc || 1) - (sc || 1));
function glyphs(s, x, y, sc, put) {
  s = String(s).toUpperCase(); sc = sc || 1;
  for (let i = 0; i < s.length; i++) { const g = GL[s[i]]; if (!g) continue; for (let k = 0; k < 15; k++) if (g[k] === '1') put(x + i * 4 * sc + (k % 3) * sc, y + Math.floor(k / 3) * sc, sc); }
}
function ptext(s, x, y, c, sc, align, shadow) {
  sc = sc || 1; if (align === 'center') x -= twidth(s, sc) >> 1; else if (align === 'right') x -= twidth(s, sc);
  if (shadow) { ctx.fillStyle = '#000'; glyphs(s, x + sc, y + sc, sc, (a, b, z) => ctx.fillRect(a, b, z, z)); }
  ctx.fillStyle = c; glyphs(s, x, y, sc, (a, b, z) => ctx.fillRect(a, b, z, z));
}
function pwrap(s, maxW, sc) { const out = []; let cur = ''; for (const w of String(s).split(' ')) { const t = cur ? cur + ' ' + w : w; if (twidth(t, sc) > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }

// ---- the static ship, rasterised pixel by pixel (crisp edges, ordered dither, dark outline pass)
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], bay = (x, y) => (B4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
let SD, BW = W, BH = H;                                                     // the pixel buffer that sp / srect / sline / fillPoly currently write into
const makeBuf = (w, h) => { const img = new ImageData(w, h); return { w, h, img, d: new Uint32Array(img.data.buffer) }; };
const useBuf = b => { SD = b.d; BW = b.w; BH = b.h; };
const SBUF = makeBuf(W, H); useBuf(SBUF);
const C32 = hex => { const n = parseInt(hex.slice(1), 16); return ((255 << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255)) >>> 0; };
const STEEL = ['#080d14', '#121b27', '#1c2837', '#293749', '#384a60', '#4d627c', '#6b83a0', '#93a9c2'].map(C32);
const ORANGE = ['#2e1507', '#6e3412', '#a9561c', '#e08435', '#ffb866'].map(C32);
const GREEN = [PAL.g0, PAL.g1, PAL.g2, PAL.g3, PAL.g4].map(C32);
const RED = ['#2a0c09', '#7a2a24', '#ff5a4d', '#ffa79a'].map(C32), AMB = ['#3a2c08', '#8a6a1a', '#ffd36b', '#fff0b8'].map(C32);
const ramp = (arr, l, x, y) => { const i = Math.floor(l), f = l - i; return arr[clamp(i + (bay(x, y) < f ? 1 : 0), 0, arr.length - 1)]; };
const sp = (x, y, c) => { if (x >= 0 && x < BW && y >= 0 && y < BH) SD[y * BW + x] = c; };
const srect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) sp(x + i, y + j, c); };
function sline(x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
  for (let n = 0; n < 900; n++) { sp(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
}
function fillPoly(pts, fn) {
  let y0 = 1e9, y1 = -1e9; for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(BH - 1, Math.ceil(y1)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] <= y + 0.5 && b[1] > y + 0.5) || (b[1] <= y + 0.5 && a[1] > y + 0.5)) xs.push(a[0] + (y + 0.5 - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k] - 0.5); x < Math.ceil(xs[k + 1] - 0.5); x++) { if (x < 0 || x >= BW) continue; const c = fn(x, y); if (c) SD[y * BW + x] = c; }
  }
}
const metal = (base, vgrad, ydir) => (x, y) => { const l = base + (vgrad || 0) * (y - (ydir || 0)) / 100 + (hash2(x, y) - 0.5) * 0.8 + ((y % 6) === 0 ? -0.18 : 0); return ramp(STEEL, l, x, y); };
const lighten = (c, a) => { const r = Math.min(255, (c & 255) + a), g = Math.min(255, ((c >> 8) & 255) + a), b = Math.min(255, ((c >> 16) & 255) + a); return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; };
function srivet(x, y) { sp(x, y, STEEL[6]); sp(x + 1, y, STEEL[3]); sp(x, y + 1, STEEL[3]); sp(x + 1, y + 1, STEEL[1]); }
function sscrew(x, y) { srect(x - 1, y - 1, 3, 3, STEEL[2]); sp(x - 1, y - 1, STEEL[5]); sp(x, y, STEEL[0]); sp(x + 1, y, STEEL[0]); }
function sstripes(x, y, w, h) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) sp(x + i, y + j, ((i + j) >> 2) & 1 ? ORANGE[3] : STEEL[0]); }
function slamp(x, y, c) { srect(x, y, 3, 3, c[1]); sp(x, y, c[3] || c[2]); }
function stext(s, x, y, col, sc) { glyphs(s, x, y, sc || 1, (a, b, z) => srect(a, b, z, z, col)); }
function splate(x, y, w, h, label) { srect(x, y, w, h, STEEL[1]); srect(x, y, w, 1, STEEL[5]); srect(x, y, 1, h, STEEL[4]); srect(x, y + h - 1, w, 1, STEEL[0]); srect(x + w - 1, y, 1, h, STEEL[0]); if (label) stext(label, x + 2, y + (h - 5) / 2 | 0, STEEL[6]); }
function sbezel(x, y, w, h, fill) {    // a recessed screen: dark ring, lit top-left, shadowed bottom-right, dark glass
  srect(x - 2, y - 2, w + 4, h + 4, STEEL[0]); srect(x - 1, y - 1, w + 2, h + 2, STEEL[5]); srect(x, y, w, 1, STEEL[2]); srect(x, y, 1, h, STEEL[2]);
  srect(x + 1, y + 1, w - 2, h - 2, fill); srect(x - 1, y + h, w + 2, 1, STEEL[1]); srect(x + w, y - 1, 1, h + 2, STEEL[1]);
}
function sdisc(cx, cy, r, ringC, fill) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = Math.hypot(x, y); if (d <= r) sp(cx + x, cy + y, d > r - 1.2 ? ringC : fill); } }
function outlinePass(lightAmt) {       // dark edge on every silhouette in the current buffer, optionally a lit edge just inside the top-left ones
  const a = i => SD[i] >>> 24, edge = new Uint8Array(BW * BH);
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
    const i = y * BW + x; if (!a(i)) continue;
    if ((x > 0 && !a(i - 1)) || (x < BW - 1 && !a(i + 1)) || (y > 0 && !a(i - BW)) || (y < BH - 1 && !a(i + BW))) edge[i] = 1;
  }
  if (lightAmt) for (let y = 1; y < BH - 1; y++) for (let x = 1; x < BW - 1; x++) { const i = y * BW + x; if (a(i) && !edge[i] && (edge[i - 1] || edge[i - BW])) SD[i] = lighten(SD[i], lightAmt); }
  for (let i = 0; i < BW * BH; i++) if (edge[i]) SD[i] = STEEL[0];
}
const part = (pts, painter) => { fillPoly(pts, painter); for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; sline(Math.round(a[0]), Math.round(a[1]), Math.round(b[0]), Math.round(b[1]), STEEL[0]); } };   // a filled polygon with its own dark outline
const shiftPts = (ox, oy, pts) => pts.map(([x, y]) => [ox + x, oy + y]);
function sring(cx, cy, r, c) { let x = r, y = 0, e = 1 - r; while (x >= y) { for (const [a, b] of [[x, y], [y, x], [-x, y], [-y, x], [x, -y], [y, -x], [-x, -y], [-y, -x]]) sp(cx + a, cy + b, c); y++; if (e < 0) e += 2 * y + 1; else { x--; e += 2 * (y - x) + 1; } } }
const mirror = pts => pts.map(([x, y]) => [479 - x, y]).reverse();

// ---- layout (480x300). The glass is everything not listed here.
const CANOPY = [[0, 0], [480, 0], [480, 10], [400, 14], [340, 12], [300, 13], [180, 13], [140, 12], [80, 14], [0, 10]];
const POD_L = [[0, 0], [126, 0], [121, 14], [113, 58], [104, 66], [92, 72], [0, 72]], POD_R = mirror(POD_L);
const OVER = [[172, 0], [308, 0], [303, 38], [289, 58], [191, 58], [177, 38]];
const strutX = y => 107 + (y - 66) * 0.4176;               // centre line of the left strut; the right one mirrors it
const STRUT_L = [[100, 64], [114, 64], [192, 250], [178, 250]], STRUT_R = mirror(STRUT_L);
const RAIL_L = [[0, 70], [9, 70], [9, 250], [0, 248]], RAIL_R = mirror(RAIL_L);
const DASH = [[0, 300], [0, 230], [56, 234], [124, 242], [158, 262], [176, 250], [304, 250], [322, 262], [356, 244], [424, 234], [480, 230], [480, 300]];
const lipY = x => { const P = DASH.slice(1, -1); for (let i = 0; i < P.length - 1; i++) if (x >= P[i][0] && x <= P[i + 1][0]) return P[i][1] + (P[i + 1][1] - P[i][1]) * (x - P[i][0]) / (P[i + 1][0] - P[i][0]); return 250; };
const GUN_L = [112, 172], GUN_R = [368, 172];                // muzzle tips of the two cannons: where the beams leave the ship
const SCR_L = { x: 10, y: 8, w: 92, h: 46 }, SCR_R = { x: 378, y: 8, w: 92, h: 46 };
const RAD = { x: 240, y: 30, r: 21 };
const onGlass = (x, y) => x > 10 && x < 470 && y > 12 && y < 228 && !(x < 126 && y < 72) && !(x > 354 && y < 72) && !(x > 176 && x < 304 && y < 60) &&
  Math.abs(x - strutX(y)) > 9 && Math.abs(479 - x - strutX(y)) > 9;

const staticCanvas = document.createElement('canvas'); staticCanvas.width = W; staticCanvas.height = H;
const flashCanvas = document.createElement('canvas'); flashCanvas.width = W; flashCanvas.height = H;
const glassCanvas = document.createElement('canvas'); glassCanvas.width = W; glassCanvas.height = H;
function holoPuck(cx, lip) {                                              // an emitter puck sitting on the dash lip: casts a hologram into the window above it
  const top = lip - 9, CY = C32('#58d6ff'), CW = C32('#d8f6ff');
  part([[cx - 25, lip + 1], [cx - 18, top], [cx + 18, top], [cx + 25, lip + 1]], (x, y) => ramp(STEEL, 2.2 + (y < top + 4 ? 1.6 : 0) + (hash2(x, y) - 0.5) * 0.5, x, y));
  srect(cx - 17, top + 1, 34, 1, STEEL[6]); srect(cx - 22, top + 7, 44, 1, ORANGE[3]); srect(cx - 24, top + 8, 48, 1, ORANGE[1]);
  srect(cx - 11, top + 1, 22, 2, STEEL[0]); srect(cx - 9, top + 1, 18, 1, CY); srect(cx - 4, top + 1, 8, 1, CW); srect(cx - 6, top + 2, 12, 1, CY);       // the lens
  srivet(cx - 21, top + 4); srivet(cx + 19, top + 4); for (let i = 0; i < 3; i++) slamp(cx - 12 + i * 9, top + 4, i === 1 ? GREEN.map(c => c) : AMB);
}
const ANN = ['PWR', 'COOL', 'RCS', 'GUN', 'LOCK', 'PRY', 'COMM', 'ALRT'], annXY = i => [8 + (i % 4) * 21, 238 + Math.floor(i / 4) * 11];
function dashExtras() {                                                    // the console: annunciator bank, switch guards, a knob, hazard decals, placards, and the two projector pucks
  holoPuck(HOLO_C.x, Math.round(lipY(HOLO_C.x)) + 1); holoPuck(MAP_C.x, Math.round(lipY(MAP_C.x)) + 1);
  ANN.forEach((n, i) => { const [x, y] = annXY(i); srect(x - 1, y - 1, 21, 11, STEEL[0]); srect(x - 1, y - 1, 21, 1, STEEL[4]); srect(x, y, 19, 9, STEEL[1]); });          // lamp bezels (the lamps are live)
  splate(90, 236, 40, 5, null); stext('ANNUNC', 92, 236, STEEL[6]);
  for (let i = 0; i < 3; i++) { const x = 150 + i * 8; srect(x, 266, 7, 14, STEEL[0]); srect(x + 1, 267, 5, 6, ORANGE[2]); srect(x + 2, 272 + (i % 2) * 3, 3, 5, STEEL[7]); sp(x + 3, 271 + (i % 2) * 3, STEEL[5]); }   // toggle switches under orange guards
  sdisc(162, 288, 5, STEEL[6], STEEL[2]); sline(162, 288, 164, 285, ORANGE[4]); stext('GAIN', 154, 283 - 0, STEEL[5]);
  const L = Math.round(lipY(450)) + 4; sstripes(446, L, 28, 3);
  for (const [x, y] of [[4, 236], [118, 242], [472, 234], [350, 246]]) sscrew(x, y);
  srect(132, 247, 18, 1, STEEL[0]); for (let i = 0; i < 4; i++) srect(132 + i * 5, 248, 3, 3, STEEL[0]);       // vent grille
}
function buildCockpit() {
  useBuf(SBUF); SD.fill(0);
  // struts: lit ridge, rivet columns, a dark conduit, hazard marks
  for (const [poly, sgn] of [[STRUT_L, 1], [STRUT_R, -1]]) fillPoly(poly, (x, y) => {
    const d = sgn * (x - (sgn > 0 ? strutX(y) : 479 - strutX(y)));          // -7..7 across the strut, 0 on the ridge
    let l = 2.5 + (1 - Math.abs(d) / 7) * 1.0 + (hash2(x, y) - 0.5) * 0.5;
    if (Math.abs(d) < 1) l = 5; if (d === 3) l = 1.2; return ramp(STEEL, l, x, y);
  });
  for (const y of [90, 120, 150, 180, 210, 236]) for (const s of [-1, 1]) { const cx = Math.round(s < 0 ? strutX(y) : 479 - strutX(y)); srivet(cx - 4, y); srivet(cx + 3, y); }
  for (const y of [130, 200]) for (const s of [-1, 1]) { const cx = Math.round(s < 0 ? strutX(y) : 479 - strutX(y)); sstripes(cx - 5, y, 10, 6); }
  fillPoly(RAIL_L, metal(2.8)); fillPoly(RAIL_R, metal(2.8));
  for (const y of [90, 130, 170, 210]) { srivet(3, y); srivet(474, y); sline(0, y + 8, 8, y + 8, STEEL[0]); sline(471, y + 8, 479, y + 8, STEEL[0]); }
  fillPoly(CANOPY, (x, y) => ramp(STEEL, 3.6 - y * 0.12 + (hash2(x, y) - 0.5) * 0.7 + ((x % 40) === 0 ? -1.3 : 0), x, y));
  for (let x = 40; x < 480; x += 40) { srivet(x - 3, 3); srivet(x + 2, 3); srivet(x - 3, 8); srivet(x + 2, 8); }
  sline(0, 11, 80, 13, ORANGE[3]); sline(80, 13, 140, 11, ORANGE[3]); sline(340, 11, 400, 13, ORANGE[3]); sline(400, 13, 479, 11, ORANGE[3]);
  // pods: the environment board (left) and the commander's comm panel (right), bolted into the struts and canopy
  fillPoly(POD_L, metal(3.1, 0)); fillPoly(POD_R, metal(3.1, 0));
  sbezel(SCR_L.x, SCR_L.y, SCR_L.w, SCR_L.h, GREEN[0]); sbezel(SCR_R.x, SCR_R.y, SCR_R.w, SCR_R.h, GREEN[0]);
  for (const mx of [false, true]) {
    const X = x => mx ? 479 - x : x, off = mx ? -1 : 0;
    splate(mx ? X(34) : 10, 59, 25, 9, mx ? 'COMM' : 'ENV');
    for (let i = 0; i < 4; i++) slamp(mx ? X(44 + i * 9) - 2 : 44 + i * 9, 61, i === 3 ? RED : i === 0 ? GREEN.slice(0).map(c => c) : AMB);
    for (let i = 0; i < 3; i++) { const tx = mx ? X(88 + i * 5) : 88 + i * 5; srect(tx, 61, 3, 6, STEEL[0]); srect(tx, 61 + (i % 2) * 3, 3, 3, STEEL[6]); }
    for (let i = 0; i < 6; i++) { const vx = mx ? X(108) : 108; srect(vx, 8 + i * 7, 11, 2, STEEL[0]); srect(vx, 10 + i * 7, 11, 1, STEEL[4]); }
    for (const [sx, sy] of [[4, 4], [96, 4], [4, 56], [112, 6]]) sscrew(mx ? X(sx) : sx, sy);
  }
  sline(2, 72, 90, 72, ORANGE[2]); sline(477, 72, 389, 72, ORANGE[2]); sstripes(94, 68, 10, 3); sstripes(375, 68, 10, 3);
  // overhead console with the radar
  fillPoly(OVER, metal(3.0, 0));
  for (let y = RAD.y - 26; y <= RAD.y + 26; y++) for (let x = RAD.x - 26; x <= RAD.x + 26; x++) {
    const d = Math.hypot(x - RAD.x, y - RAD.y);
    if (d <= RAD.r + 3) sp(x, y, d > RAD.r + 2 ? STEEL[0] : d > RAD.r + 0.5 ? STEEL[5] : GREEN[0]);
  }
  for (const lx of [184, 292]) { for (let i = 0; i < 4; i++) { srect(lx, 8 + i * 9, 4, 6, STEEL[0]); } }
  splate(212, 52, 29, 5, null); stext('RDR', 215, 52, STEEL[6]);
  for (let i = 0; i < 4; i++) { srect(247 + i * 7, 52, 3, 5, STEEL[0]); srect(247 + i * 7, 52 + (i % 2) * 2, 3, 3, STEEL[6]); }
  srivet(180, 6); srivet(298, 6); srivet(186, 50); srivet(292, 50);
  // dash: sloped top with an amber lip, low hood in the middle, wings with instrument wells
  fillPoly(DASH, (x, y) => ramp(STEEL, 2.4 + (300 - y) * 0.035 + (hash2(x, y) - 0.5) * 0.6, x, y));
  for (let i = 0; i < DASH.length - 1; i++) { const a = DASH[i], b = DASH[i + 1]; if (a[1] < 270 && b[1] < 270) sline(a[0], a[1], b[0], b[1], ORANGE[3]); }

  splate(8, 262, 78, 34, null);                                           // gauge bank (HULL, HEAT, AMMO bars)
  stext('HULL', 12, 266, STEEL[6]); stext('HEAT', 12, 275, STEEL[6]); stext('SPD', 12, 284, STEEL[6]);
  for (const y of [265, 274, 283]) srect(34, y, 48, 7, STEEL[0]);
  sbezel(VDU.x, VDU.y, VDU.w, VDU.h, 0);                                  // target display well (transparent hole punched below)
  splate(332, 262, 76, 34, null); splate(410, 256, 66, 40, null);
  for (const [cx, cy] of [[204, 270], [276, 270]]) { sdisc(cx, cy, 13, STEEL[5], STEEL[0]); for (let a = -135; a <= 135; a += 30) { const r = a * D2R; sline(Math.round(cx + Math.sin(r) * 10), Math.round(cy - Math.cos(r) * 10), Math.round(cx + Math.sin(r) * 12), Math.round(cy - Math.cos(r) * 12), STEEL[6]); } }
  stext('SPD', 199, 286, STEEL[6]); stext('SET', 271, 286, STEEL[6]);
  stext('ASTRA-9 MK2', 181, 252, ORANGE[3]);
  for (const x of [20, 70, 118, 150, 168, 308, 330, 372, 424, 464]) srivet(x, 297);
  dashExtras();
  srect(VDU.x, VDU.y, VDU.w, VDU.h, 0);                                  // punch the hole the target display shows through
  outlinePass(26);
  staticCanvas.getContext('2d').putImageData(SBUF.img, 0, 0);
  const fg = flashCanvas.getContext('2d'); fg.clearRect(0, 0, W, H); fg.drawImage(staticCanvas, 0, 0); fg.globalCompositeOperation = 'source-in'; fg.fillStyle = '#ff9a3c'; fg.fillRect(0, 0, W, H);
  // glass: diagonal glints and a dithered vignette
  const gg = glassCanvas.getContext('2d'); gg.clearRect(0, 0, W, H);
  const gi = gg.createImageData(W, H), gd = new Uint32Array(gi.data.buffer);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - 240) / 250, dy = (y - AXIS_Y) / 170, v = Math.max(0, Math.hypot(dx, dy) - 0.72) / 0.5;
    if (bay(x, y) < v * 0.55) gd[y * W + x] = 0x99000000;
  }
  gg.putImageData(gi, 0, 0);
  gg.fillStyle = 'rgba(255,255,255,0.05)';
  for (const x0 of [96, 214, 330]) for (let y = 16; y < 246; y++) gg.fillRect(Math.round(x0 + (y - 16) * 0.42), y, 7, 1);
  gg.fillStyle = 'rgba(255,255,255,0.035)';
  for (const x0 of [112, 232, 346]) for (let y = 16; y < 246; y++) gg.fillRect(Math.round(x0 + (y - 16) * 0.42), y, 3, 1);
}
