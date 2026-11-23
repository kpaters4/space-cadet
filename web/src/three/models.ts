// Craft models for the website's launch scene, ported from the game
// (game/world_src/js/03_debris.js, 03a_craft.js, 03c_debris_types.js, 03d_ship.js).
// Same parts, colours and real-metre dimensions; here 1 scene unit = 1 metre.
// Each model is a list of parts [geometry, hex colour, x, y, z, rotation] merged into
// one BufferGeometry with flat normals and vertex colours, plus one edge-line geometry.

import * as THREE from "three";

type Rot = [number, number, number];
type Part = [THREE.BufferGeometry, number, number, number, number, Rot | undefined];

const M = (m: number) => m; // the game scales metres by CRAFT_X; the site draws them 1:1
const C = (g: THREE.BufferGeometry, hex: number, x = 0, y = 0, z = 0, rot?: Rot): Part => [g, hex, x, y, z, rot];
const V3 = THREE.Vector3;
const Q4 = THREE.Quaternion;

const mb = (w: number, h: number, d: number, hex: number, x = 0, y = 0, z = 0, rot?: Rot) =>
  C(new THREE.BoxGeometry(M(w), M(h), M(d)), hex, M(x), M(y), M(z), rot);
const mcx = (r: number, len: number, hex: number, x = 0, y = 0, z = 0, seg = 8) =>
  C(new THREE.CylinderGeometry(M(r), M(r), M(len), seg), hex, M(x), M(y), M(z), [0, 0, Math.PI / 2]);
const mcz = (r: number, len: number, hex: number, x = 0, y = 0, z = 0, seg = 8) =>
  C(new THREE.CylinderGeometry(M(r), M(r), M(len), seg), hex, M(x), M(y), M(z), [Math.PI / 2, 0, 0]);
const mcy = (r0: number, r1: number, len: number, hex: number, x = 0, y = 0, z = 0, seg = 8) =>
  C(new THREE.CylinderGeometry(M(r0), M(r1), M(len), seg), hex, M(x), M(y), M(z));
const mtz = (rFront: number, rBack: number, len: number, hex: number, x = 0, y = 0, z = 0, seg = 10) =>
  C(new THREE.CylinderGeometry(M(rBack), M(rFront), M(len), seg), hex, M(x), M(y), M(z), [Math.PI / 2, 0, 0]);

function compose(x: number, y: number, z: number, rot?: Rot) {
  return new THREE.Matrix4().compose(new V3(x, y, z), new Q4().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))), new V3(1, 1, 1));
}

/** Rotate a group of parts about a pivot (metres). */
function pivotParts(list: Part[], pv: Rot, eul: Rot): Part[] {
  const T = compose(M(pv[0]), M(pv[1]), M(pv[2]), eul);
  return list.map(([geo, hex, x, y, z, rot]) => {
    const g = geo.clone().applyMatrix4(compose(x, y, z, rot));
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(-M(pv[0]), -M(pv[1]), -M(pv[2])));
    g.applyMatrix4(T);
    return [g, hex, 0, 0, 0, [0, 0, 0]] as Part;
  });
}

const flatten = (g: THREE.BufferGeometry) => {
  const out = g.index ? g.toNonIndexed() : g;
  out.computeVertexNormals();
  return out;
};

function warp(g: THREE.BufferGeometry, amt: number, seed: number) {
  const a = g.attributes.position;
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
    const s = Math.sin((x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453);
    const f = 1 + (s - Math.floor(s) - 0.5) * amt;
    a.setXYZ(i, x * f, y * f, z * f);
  }
  return g;
}

export type Merged = { geometry: THREE.BufferGeometry; edges: THREE.BufferGeometry | null };

/** parts -> one geometry (positions, flat normals, vertex colours) + one edge geometry. */
export function mergeParts(parts: Part[], withEdges = true): Merged {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], epos: number[] = [];
  for (const [geo0, hex, x, y, z, rot] of parts) {
    const geo = flatten(geo0);
    geo.applyMatrix4(compose(x || 0, y || 0, z || 0, rot));
    const c = new THREE.Color(hex), a = geo.attributes.position, n = geo.attributes.normal;
    for (let i = 0; i < a.count; i++) {
      pos.push(a.getX(i), a.getY(i), a.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    if (withEdges) {
      const eg = new THREE.EdgesGeometry(geo, 25), ea = eg.attributes.position;
      for (let i = 0; i < ea.count; i++) epos.push(ea.getX(i), ea.getY(i), ea.getZ(i));
      eg.dispose();
    }
    geo.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  let edges: THREE.BufferGeometry | null = null;
  if (withEdges && epos.length) {
    edges = new THREE.BufferGeometry();
    edges.setAttribute("position", new THREE.Float32BufferAttribute(epos, 3));
  }
  return { geometry, edges };
}

/* ------------------------------------------------------------------ satellites (03a_craft.js) */

const CELL = [0x2b57a6, 0x23499a], GOLD = 0xc79a3a, WHITE = 0xe8eaee, GREY = 0xb4bfca, DARK = 0x4a525c;

function blanket(len: number, wid: number, x: number, y: number, z: number, bands = 6) {
  const p: Part[] = [];
  for (let k = 0; k < bands; k++) p.push(mb(len / bands, 0.12, wid, CELL[k % 2], x - len / 2 + (len / bands) * (k + 0.5), y, z));
  return p;
}

/** International Space Station, about 109 m truss x 73 m x 20 m. */
export function issParts(): Part[] {
  const p: Part[] = [], TX = -2.65, TY = 4.6;
  p.push(mcx(2.1, 13, 0xece6d8, -31.5, 0, 0, 10), mcx(1.4, 4.5, 0xcfc6b0, -39.5, 0, 0, 8));
  p.push(mcx(2.05, 12.6, 0xd9cfae, -18.7, 0, 0, 10), mcx(2.2, 5.5, 0xe8e8e8, -9.6, 0, 0, 10));
  p.push(mcx(2.15, 8.5, 0xf2f2f2, TX, 0, 0, 10), mcx(2.2, 7.2, 0xe8e8e8, 5.2, 0, 0, 10));
  p.push(mcz(2.25, 6.9, 0xefefef, 5.2, 0, 5.65, 10), mcz(2.2, 11.2, 0xe8e8e8, 5.2, 0, -(2.2 + 5.6), 10));
  p.push(mb(5, 2.4, 4.6, 0xd2d6dc, 5.2, 0.4, -16.2));
  p.push(mcz(2.25, 6.7, 0xefefef, -9.6, 0, -(2.2 + 3.35), 10));
  p.push(mcy(1.15, 1.15, 4, 0xcfc6b0, -36.5, 3.2, 0, 8), mcy(1.4, 1.4, 6.8, 0xf4f4f4, -36.5, 8.4, 0, 8), mcy(0.9, 1.2, 2.6, 0xf4f4f4, -36.5, 12.8, 0, 8));
  p.push(mb(4.9, 0.08, 2.1, 0x2b57a6, -36.5, 8.4, 3.4), mb(4.9, 0.08, 2.1, 0x2b57a6, -36.5, 8.4, -3.4));
  p.push(mb(2.3, 2.3, 109 - 18, 0xbcc3cc, TX, TY, 0));
  for (let k = -4; k <= 4; k++) p.push(mb(3.4, 3.4, 0.7, 0x9aa4b0, TX, TY, k * 10.2));
  p.push(mb(5, 4.4, 6, 0xd8dde4, TX, TY, 0));
  for (const sz of [-1, 1]) {
    p.push(mb(2.6, 2.6, 2.4, 0xd8dde4, TX, TY, sz * 54.5 - sz * 3));
    for (const [zc, tilt] of [[sz * 48.5, sz * 0.2], [sz * 24.5, -sz * 0.3]]) {
      const w: Part[] = [];
      for (const sx of [-1, 1]) w.push(...blanket(35, 12, sx * 18.5, 0, 0, 7), mb(35, 0.5, 0.5, GOLD, sx * 18.5, 0.1, 0));
      p.push(mb(2.2, 2.2, 2.2, 0xd8dde4, TX, TY, zc));
      p.push(...pivotParts(w, [0, 0, 0], [tilt, 0, 0]).map(([g, h]) => [g.translate(M(TX), M(TY), M(zc)), h, 0, 0, 0, [0, 0, 0]] as Part));
    }
    p.push(mb(0.25, 11, 9, 0xf4f4f4, TX, TY, sz * 10), mb(0.25, 11, 9, 0xe3e6ea, TX + 0.9, TY, sz * 10));
  }
  return p;
}

/** Hubble Space Telescope, 13.2 m x 4.2 m. */
export function hubbleParts(): Part[] {
  const p: Part[] = [mcx(2.1, 7, 0xd5d9df, 3.1, 0, 0, 14), mcx(2.45, 2.2, 0xe8eaee, -1.4, 0, 0, 14), mcx(2.35, 4.4, 0x8a7a4e, -4.4, 0, 0, 14),
    mcx(2.2, 0.5, 0xb9bec6, 6.9, 0, 0, 14), mcx(1.8, 0.1, 0x0a0e14, 7.18, 0, 0, 14), mb(2.8, 0.12, 2.6, 0xdfe3e8, 5.2, 2.25, 0, [0, 0, 0.5])];
  for (const s of [-1, 1]) {
    p.push(mb(2.6, 0.1, 7.1, CELL[0], 0.6, 0, s * (2.4 + 3.6)), mb(0.18, 0.18, 6.4, DARK, 0.6, 0, s * 5.8));
    p.push(mb(0.1, 0.1, 4.2, 0xc9cfd6, -2.4, 2.3, s * 4.3), mcy(0.7, 0.15, 0.3, WHITE, -2.4, 2.45, s * 6.4, 12));
  }
  return p;
}

/** Iridium (first generation), ~4 m prism with three antenna panels. */
export function iridiumParts(): Part[] {
  const p: Part[] = [C(new THREE.CylinderGeometry(M(0.8), M(0.8), M(3.2), 3), GOLD)];
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3;
    p.push(C(new THREE.BoxGeometry(M(0.07), M(1.9), M(0.9)), GREY, Math.sin(a) * M(1.15), 0, Math.cos(a) * M(1.15), [0, a, 0]));
  }
  for (const s of [-1, 1]) {
    p.push(mb(0.8, 0.05, 1.8, CELL[0], 0, 0.2, s * 2.0, [0.3 * s, 0, 0]));
    p.push(mb(0.08, 0.08, 0.7, 0x7d8794, 0, 0.1, s * 0.8));
  }
  p.push(C(new THREE.CylinderGeometry(M(0.25), M(0.35), M(0.6), 8), DARK, 0, M(-1.9), 0));
  return p;
}

/** CZ-4B third stage, a spent rocket body (2.9 m). */
export function rocketBodyParts(): Part[] {
  return [mcy(1.45, 1.45, 4.2, 0xb4bfca, 0, 0, 0, 14), mcy(1.5, 1.5, 0.5, 0xe58a2d, 0, 1.2, 0, 14), mcy(0.55, 1.3, 1.9, 0x4a525c, 0, -3.0, 0, 12),
    C(new THREE.SphereGeometry(M(1.45), 12, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x8b97a4, 0, M(2.1), 0),
    mb(2.9, 0.08, 0.5, 0x4a525c, 0, -1.0, 0), mb(0.7, 0.05, 2.2, 0x7d8794, 0, 0.3, 1.9, [0.3, 0.5, 0.1])];
}

/* ------------------------------------------------------------------ debris fragments (03c_debris_types.js) */

const PAL = { main: [0xb4bfca, 0xc7ccd4, 0x9aa4b0], accent: 0xc79a3a, foil: 0xd9b24a };
const pick = (a: number[], n: number) => a[n % a.length];
const BX = (w: number, h: number, d: number, sx = 1, sy = 1, sz = 1) => new THREE.BoxGeometry(w, h, d, sx, sy, sz);

/** A few fragment designs in unit space (about 1 m across). */
export const FRAGMENTS: ((sq: number) => Part[])[] = [
  (sq) => [C(warp(BX(1.7, 0.12, 1.2, 3, 1, 3), 0.55, sq * 131 + 3), pick(PAL.main, sq)), C(warp(BX(0.6, 0.1, 0.5, 2, 1, 2), 0.5, sq + 9), PAL.accent, 0.5, 0.1, 0.3, [0.2, 0.4, 0.1])],
  (sq) => [C(warp(BX(1.9, 0.07, 1.15, 4, 1, 3), 0.45, sq * 77 + 1), 0x2b57a6), C(BX(1.9, 0.08, 0.05), 0x7d8794, 0, 0.04, 0.3), C(BX(0.05, 0.08, 1.15), 0x7d8794, -0.4, 0.04, 0, [0, 0.2, 0]),
    C(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 4), 0x2a2f36, 0.9, 0.2, 0.5, [0.8, 0.3, 1.2])],
  () => [C(new THREE.ConeGeometry(0.9, 0.45, 10, 1), 0xe8eaee, 0, 0, 0, [Math.PI, 0, 0]), C(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 8), 0x4a525c, 0, 0.26, 0),
    C(new THREE.CylinderGeometry(0.04, 0.04, 1.7, 4), 0xb4bfca, 0.2, 0.9, 0.1, [0.15, 0, 0.1])],
  () => [C(new THREE.SphereGeometry(0.75, 9, 5, 0, Math.PI * 2, 0, 2.4), 0xcfd4da), C(new THREE.CylinderGeometry(0.78, 0.78, 0.07, 9), PAL.accent, 0, 0.1, 0),
    C(new THREE.CylinderGeometry(0.13, 0.13, 0.35, 6), 0x4a525c, 0, 0.8, 0)],
  (sq) => [C(BX(1.5, 0.09, 0.7), PAL.accent, 0, 0.3, 0, [0.5, 0, 0]), C(BX(1.5, 0.09, 0.7), pick(PAL.main, sq + 1), 0, -0.1, -0.1, [-0.25, 0, 0]),
    C(BX(1.5, 0.09, 0.5), pick(PAL.main, sq), 0, -0.55, 0.1, [-0.7, 0, 0])],
  (sq) => [C(warp(new THREE.IcosahedronGeometry(0.85, 1), 0.9, sq * 53 + 5).scale(1.2, 0.6, 0.9), PAL.foil), C(warp(new THREE.IcosahedronGeometry(0.5, 0), 0.8, sq + 31), 0xe8e0c0, 0.5, 0.25, 0.2)],
];

/* ------------------------------------------------------------------ the ship: Astra-9 Mk2 (03d_ship.js) */

const SI = { dk: 0x121b27, s1: 0x1c2837, s2: 0x293749, s3: 0x384a60, s4: 0x4d627c, s5: 0x6b83a0, s6: 0x93a9c2, s7: 0xc2d2e4 };
const ORG = 0xe08435, ORG2 = 0xa9561c, ORG3 = 0xffb866, GLASS = 0x3b87e0, LAMP = 0xff3b2a, EMBERC = 0xffb866;

function plate(pts: [number, number][], y0: number, y1: number, hex: number) {
  const sh = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? sh.lineTo(M(x), -M(z)) : sh.moveTo(M(x), -M(z))));
  const g = new THREE.ExtrudeGeometry(sh, { depth: M(y1 - y0), bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return C(g, hex, 0, M(y0), 0);
}
const scalePts = (pts: [number, number][], k: number) => pts.map(([x, z]) => [x * k, z] as [number, number]);
function hazard(x: number, y: number, z: number, n: number, w: number, d: number) {
  const p: Part[] = [];
  for (let k = 0; k < n; k++) p.push(mb(w, 0.1, d, k % 2 ? SI.dk : ORG, x + k * w, y, z));
  return p;
}
const HULL_PLAN: [number, number][] = [[-1.3, -7], [1.3, -7], [2.9, -3.4], [4.2, -0.2], [4.5, 4], [3.7, 8.6], [-3.7, 8.6], [-4.5, 4], [-4.2, -0.2], [-2.9, -3.4]];

function hullPlates(): Part[] {
  const P: Part[] = [plate(HULL_PLAN, -0.9, -0.3, SI.s1), plate(scalePts(HULL_PLAN, 0.96), -0.3, 0.7, SI.s4),
    plate([[-0.9, -5.6], [0.9, -5.6], [2.3, -2.6], [3.1, 1], [3.1, 5.2], [-3.1, 5.2], [-3.1, 1], [-2.3, -2.6]], 0.7, 1.2, SI.s5),
    plate([[-0.55, -3.4], [0.55, -3.4], [1.1, 0], [1.1, 6.4], [-1.1, 6.4], [-1.1, 0]], 1.2, 1.7, SI.s6)];
  P.push(...hazard(-1.5, 1.25, -2.9, 6, 0.5, 0.7), mb(6, 0.05, 0.07, SI.dk, 0, 1.23, 1.4), mb(6, 0.05, 0.07, SI.dk, 0, 1.23, 3.4), mb(6, 0.05, 0.07, SI.dk, 0, 1.23, 5.0));
  for (let k = 0; k < 7; k++) for (const s of [-1, 1]) P.push(mb(0.2, 0.14, 0.2, SI.s7, s * 3.95, 0.8, -1.2 + k * 1.2));
  P.push(mb(3.2, 0.1, 0.35, ORG, 0, 0.74, -5.1), mb(0.35, 0.1, 5.0, ORG2, 0, 1.73, 2.6), mtz(0.12, 0.4, 2.7, SI.s4, 0, 0.1, -8.4, 6),
    C(new THREE.SphereGeometry(M(0.42), 8, 5), SI.s2, 0, M(0.1), M(-7.7)));
  P.push(mcy(0.6, 0.15, 0.3, SI.s7, 0, 2.15, 6.2, 10), mb(0.12, 0.8, 0.12, SI.s5, 0, 1.8, 6.2), mb(0.07, 2.6, 0.07, SI.s6, -0.9, 2.9, 7.0, [0, 0, 0.1]));
  return P;
}
function canopyParts(): Part[] {
  const p: Part[] = [C(new THREE.SphereGeometry(M(1.75), 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1.55), GLASS, 0, M(1.2), M(-2.6)), mb(3.6, 0.35, 4.4, SI.s3, 0, 1.12, -2.6)];
  for (const s of [-1, 1]) p.push(mb(0.34, 1.7, 0.34, SI.s3, s * 1.45, 1.9, -1.4, [0.35, 0, -s * 0.32]), mb(0.34, 1.5, 0.34, SI.s3, s * 1.2, 1.8, -4.1, [-0.5, 0, -s * 0.22]), mb(0.1, 0.14, 0.12, ORG, s * 1.45, 2.7, -1.3));
  p.push(mb(2.9, 0.34, 0.4, SI.s4, 0, 2.55, -2.4), mb(2.4, 0.5, 1.9, SI.s5, 0, 1.55, 0.2));
  return p;
}
function cannon(s: number): Part[] {
  const px = s * 4.35, parts: Part[] = [];
  parts.push(mb(1.9, 1.2, 2.6, SI.s2, s * 3.6, 0, -1.6), mcy(1.15, 1.25, 0.5, SI.s3, px, -0.45, -1.5, 8), C(new THREE.SphereGeometry(M(0.95), 9, 6), SI.s5, M(px), M(0.15), M(-1.5)), mcy(0.5, 0.5, 0.16, SI.dk, px, 1.12, -1.5, 8));
  const arm: Part[] = [mb(1.5, 1.4, 2.6, SI.s3, px, 0.1, -2.9), mb(1.7, 0.4, 2.0, SI.s4, px, 0.85, -2.9), mtz(0.34, 0.58, 8.6, SI.s5, px, 0.1, -8.0, 10), mtz(0.7, 0.7, 2.6, SI.s2, px, 0.1, -4.5, 8), mb(0.22, 0.3, 6.4, SI.s6, px, 0.72, -7.4)];
  for (let k = 0; k < 4; k++) arm.push(mtz(0.52 - k * 0.05, 0.52 - k * 0.05, 0.26, ORG, px, 0.1, -5.7 - k * 1.45, 10));
  for (let k = 0; k < 3; k++) arm.push(mtz(0.46, 0.46, 0.22, SI.dk, px, 0.1, -11.1 - k * 0.3, 10));
  arm.push(mtz(0.2, 0.2, 0.18, LAMP, px, 0.1, -12.2, 8), mb(0.3, 0.3, 1.5, SI.s2, px - s * 0.7, -0.5, -3.4));
  parts.push(...pivotParts(arm, [px, 0.15, -1.5], [0.015, s * 0.045, 0]));
  return parts;
}
function nacelle(s: number): Part[] {
  const x = s * 3.0, p: Part[] = [mb(1.7, 0.6, 3.2, SI.s3, s * 2.2, -0.2, 4.6)];
  p.push(mtz(0.55, 1.3, 1.8, SI.s2, x, -0.2, 1.4, 10), mcz(1.3, 6.2, SI.s3, x, -0.2, 5.5, 12), mcz(1.34, 0.5, ORG, x, -0.2, 3.6, 12), mcz(1.34, 0.18, ORG3, x, -0.2, 7.3, 12), mb(0.2, 0.3, 4.6, SI.s6, x, 1.12, 5.2));
  p.push(C(new THREE.CylinderGeometry(M(1.0), M(1.55), M(1.8), 12, 1, true), SI.s1, M(x), M(-0.2), M(9.3), [Math.PI / 2, 0, 0]), mtz(0.85, 0.85, 0.1, EMBERC, x, -0.2, 8.75, 12));
  return p;
}
const fin = (s: number): Part[] => [mb(0.28, 3.2, 2.8, SI.s4, s * 3.0, 2.0, 7.0, [0, 0, -s * 0.33]), mb(0.3, 0.55, 1.1, ORG, s * 3.55, 3.5, 7.0, [0, 0, -s * 0.33]), mb(0.3, 0.3, 2.9, SI.s2, s * 3.0, 0.5, 7.0)];
function vane(s: number): Part[] {
  const pts: [number, number][] = s > 0 ? [[3.9, -0.8], [7.9, 2.2], [7.9, 4.9], [3.9, 4.3]] : [[-3.9, 4.3], [-7.9, 4.9], [-7.9, 2.2], [-3.9, -0.8]];
  const p: Part[] = [plate(pts, -0.15, 0.15, SI.s4), plate(pts.map(([x, z]) => [x * 0.98, z * 0.97] as [number, number]), 0.15, 0.3, SI.s3), mb(0.3, 0.34, 2.8, ORG, s * 7.9, 0, 3.5)];
  for (let k = 0; k < 4; k++) p.push(mb(3.4, 0.08, 0.1, SI.dk, s * 5.9, 0.32, 0.6 + k * 1.0, [0, s * -0.55, 0]));
  p.push(mb(0.5, 0.5, 0.6, LAMP, s * 7.9, 0, 5.0), mb(0.5, 0.5, 0.5, SI.s2, s * 7.5, 0, -0.1));
  return p;
}
const engCentre = (): Part[] => [mb(3.0, 1.7, 3.0, SI.s2, 0, 0.1, 8.0), C(new THREE.CylinderGeometry(M(1.0), M(1.5), M(1.8), 12, 1, true), SI.s1, 0, M(0.1), M(9.95), [Math.PI / 2, 0, 0]), mtz(0.8, 0.8, 0.1, EMBERC, 0, 0.1, 9.4, 12)];

/** About 8 m long once scaled, as in the game. */
export const SHIP_K = 0.45;
/** Engine exhaust centres in the ship's own frame (metres, already scaled). Forward is -z. */
export const EXHAUSTS: [number, number, number][] = [[-3.0, -0.2, 10.2], [3.0, -0.2, 10.2], [0, 0.1, 10.9]].map(
  ([x, y, z]) => [x * SHIP_K, y * SHIP_K, z * SHIP_K] as [number, number, number],
);

export function shipParts(): Part[] {
  const sections = [hullPlates(), canopyParts(), cannon(-1), cannon(1), nacelle(-1), nacelle(1), engCentre(), fin(-1), fin(1), vane(-1), vane(1)];
  return sections.flat().map(([g, h, x, y, z, r]) => {
    g.scale(SHIP_K, SHIP_K, SHIP_K);
    return [g, h, (x || 0) * SHIP_K, (y || 0) * SHIP_K, (z || 0) * SHIP_K, r] as Part;
  });
}
