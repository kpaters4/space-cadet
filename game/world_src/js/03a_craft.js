// ============================================================ craft library: every satellite and station modelled in REAL METRES, then scaled by the single factor M()
// Axes: x = along the track (flight direction), y = up (away from Earth), z = across the track. Dimensions are from agency fact sheets (ESA, NASA, USSF); where a
// source gave a range the model uses the best-supported figure and the REAL table below says so.
const mb = (w, h, d, hex, x, y, z, rot) => C(new THREE.BoxGeometry(M(w), M(h), M(d)), hex, M(x || 0), M(y || 0), M(z || 0), rot);
const mcx = (r, len, hex, x, y, z, seg) => C(new THREE.CylinderGeometry(M(r), M(r), M(len), seg || 8), hex, M(x || 0), M(y || 0), M(z || 0), [0, 0, Math.PI / 2]);   // cylinder along x
const mcz = (r, len, hex, x, y, z, seg) => C(new THREE.CylinderGeometry(M(r), M(r), M(len), seg || 8), hex, M(x || 0), M(y || 0), M(z || 0), [Math.PI / 2, 0, 0]);   // along z
const mcy = (r0, r1, len, hex, x, y, z, seg) => C(new THREE.CylinderGeometry(M(r0), M(r1), M(len), seg || 8), hex, M(x || 0), M(y || 0), M(z || 0));              // along y (r0 top, r1 bottom)
// rotate a group of parts about a pivot (metres) so wings can be tilted about their joint
function pivotParts(list, pv, eul) {
  const T = new THREE.Matrix4().compose(new V3(M(pv[0]), M(pv[1]), M(pv[2])), new Q4().setFromEuler(new THREE.Euler(...eul)), new V3(1, 1, 1));
  return list.map(([geo, hex, x, y, z, rot]) => {
    const g = geo.clone().applyMatrix4(new THREE.Matrix4().compose(new V3(x || 0, y || 0, z || 0), new Q4().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))), new V3(1, 1, 1)));
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(-M(pv[0]), -M(pv[1]), -M(pv[2]))); g.applyMatrix4(T);
    return [g, hex, 0, 0, 0, [0, 0, 0]];
  });
}
const CELL = [0x2b57a6, 0x23499a], GOLD = 0xc79a3a, WHITE = 0xe8eaee, GREY = 0xb4bfca, DARK = 0x4a525c;
// a solar blanket made of banded cells: length along x, width along z, centred at the given point
function blanket(len, wid, x, y, z, bands) {
  const p = [], n = bands || 6;
  for (let k = 0; k < n; k++) p.push(mb(len / n, 0.12, wid, CELL[k % 2], x - len / 2 + len / n * (k + 0.5), y, z));
  return p;
}

const SAT_PARTS = {
  // ---- International Space Station, about 109 m truss x 73 m (array tip to array tip) x 20 m modules. Modules lie along the flight path; the truss is across it.
  iss: () => {
    const p = [], TX = -2.65, TY = 4.6;                                           // truss sits on top of the US lab (Destiny)
    p.push(mcx(2.1, 13, 0xece6d8, -31.5, 0, 0, 10), mcx(1.4, 4.5, 0xcfc6b0, -39.5, 0, 0, 8));                  // Zvezda service module (+ aft docking cone)
    p.push(mcx(2.05, 12.6, 0xd9cfae, -18.7, 0, 0, 10), mcx(2.2, 5.5, 0xe8e8e8, -9.6, 0, 0, 10));              // Zarya, Unity
    p.push(mcx(2.15, 8.5, 0xf2f2f2, TX, 0, 0, 10), mcx(2.2, 7.2, 0xe8e8e8, 5.2, 0, 0, 10));                    // Destiny (US lab), Harmony
    p.push(mcz(2.25, 6.9, 0xefefef, 5.2, 0, 5.65, 10), mcz(2.2, 11.2, 0xe8e8e8, 5.2, 0, -(2.2 + 5.6), 10)); // Columbus (starboard), Kibo pressurised module (port)
    p.push(mb(5, 2.4, 4.6, 0xd2d6dc, 5.2, 0.4, -16.2));                                                       // Kibo exposed facility
    p.push(mcz(2.25, 6.7, 0xefefef, -9.6, 0, -(2.2 + 3.35), 10), C(new THREE.SphereGeometry(M(1.5), 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xdfe6ef, M(-9.6), M(-2.9), M(-5.6), [Math.PI, 0, 0]));   // Tranquility + cupola
    p.push(mcy(1.15, 1.15, 4, 0xcfc6b0, -36.5, 3.2, 0, 8), mcy(1.4, 1.4, 6.8, 0xf4f4f4, -36.5, 8.4, 0, 8), mcy(0.9, 1.2, 2.6, 0xf4f4f4, -36.5, 12.8, 0, 8));  // Poisk + a docked Soyuz
    p.push(mb(4.9, 0.08, 2.1, 0x2b57a6, -36.5, 8.4, 3.4), mb(4.9, 0.08, 2.1, 0x2b57a6, -36.5, 8.4, -3.4));
    p.push(mb(2.3, 2.3, 109 - 18, 0xbcc3cc, TX, TY, 0));                                                       // integrated truss
    for (let k = -4; k <= 4; k++) p.push(mb(3.4, 3.4, 0.7, 0x9aa4b0, TX, TY, k * 10.2));                       // truss bay rings
    p.push(mb(5, 4.4, 6, 0xd8dde4, TX, TY, 0));                                                                // S0 centre
    for (const sz of [-1, 1]) {                                                                                // the four pairs of arrays; each wing 35 x 12 m, a pair spans 73 m
      p.push(mb(2.6, 2.6, 2.4, 0xd8dde4, TX, TY, sz * 54.5 - sz * 3));                                         // outer truss end
      for (const [zc, tilt] of [[sz * 48.5, sz * 0.2], [sz * 24.5, -sz * 0.3]]) {
        const w = [];
        for (const sx of [-1, 1]) { w.push(...blanket(35, 12, sx * 18.5, 0, 0, 7), mb(35, 0.5, 0.5, GOLD, sx * 18.5, 0.1, 0)); }
        p.push(mb(2.2, 2.2, 2.2, 0xd8dde4, TX, TY, zc), ...pivotParts(w.map(([g, h, x, y, z]) => [g, h, x, y, z]), [0, 0, 0], [tilt, 0, 0]).map(([g, h]) => [g.translate(M(TX), M(TY), M(zc)), h, 0, 0, 0, [0, 0, 0]]));
      }
      p.push(mb(0.25, 11, 9, 0xf4f4f4, TX, TY, sz * 10), mb(0.25, 11, 9, 0xe3e6ea, TX + 0.9, TY, sz * 10));      // radiator panels
    }
    return p;
  },
  // ---- Hubble Space Telescope, 13.2 m long x 4.2 m, two 7.1 x 2.6 m arrays
  hubble: () => {
    const p = [mcx(2.1, 7, 0xd5d9df, 3.1, 0, 0, 14), mcx(2.45, 2.2, 0xe8eaee, -1.4, 0, 0, 14), mcx(2.35, 4.4, 0x8a7a4e, -4.4, 0, 0, 14),
      mcx(2.2, 0.5, 0xb9bec6, 6.9, 0, 0, 14), mcx(1.8, 0.1, 0x0a0e14, 7.18, 0, 0, 14), mb(2.8, 0.12, 2.6, 0xdfe3e8, 5.2, 2.25, 0, [0, 0, 0.5])];      // light shield, equipment ring, aft shroud, aperture, door
    for (const s of [-1, 1]) {
      p.push(mb(2.6, 0.1, 7.1, CELL[0], 0.6, 0, s * (2.4 + 3.6)), mb(0.18, 0.18, 6.4, DARK, 0.6, 0, s * 5.8));                                        // solar array + mast
      p.push(mb(0.1, 0.1, 4.2, 0xc9cfd6, -2.4, 2.3, s * 4.3), mcy(0.7, 0.15, 0.3, WHITE, -2.4, 2.45, s * 6.4, 12));                                   // high-gain antenna boom + dish
    }
    return p;
  },
  // ---- Envisat: 26 m x 10 m x 5 m in orbit; 14 x 5 m solar array and a 10 m ASAR radar antenna
  envisat: () => [mb(6.0, 2.6, 2.6, GOLD, 0, 0, 0), mb(10, 0.5, 1.3, 0xd8d8e0, 0, -1.6, -1.6), mb(5, 0.1, 14, CELL[0], 0, 0.2, 10.2), mb(0.4, 0.4, 3.2, DARK, 0, 0, 3.2),
    mcx(0.8, 2, 0xe8e8e8, 3.8, 0.3, 0, 8), mcy(1.3, 0.3, 0.3, 0xe8e8e8, -2, 1.5, -0.8, 10), mb(2.4, 1.6, 2.2, 0xb4a888, -4.6, 0, 0)],
  // ---- Terra (EOS AM-1): about 6.8 x 3.5 m bus, single 9 x 5 m array
  terra: () => [mb(6.8, 3.5, 3.5, GOLD, 0, 0, 0), mb(1.6, 1.3, 1.4, 0x333a44, 1.4, -2.3, 0), mb(1.0, 1.0, 1.0, 0x333a44, -1.5, -2.2, 0.8), mb(5, 0.1, 9, CELL[0], 0, 0, 7.0), mb(0.35, 0.35, 2.2, DARK, 0, 0, 2.9),
    mcy(0.9, 0.2, 0.3, WHITE, -2.2, 2.0, -1.0, 10)],
  // ---- Aqua: 16.7 m long (array out), 4.8 m wide
  aqua: () => [mb(2.7, 2.5, 4.4, 0xe6e4d6, 0, 0, 0), mb(4.8, 0.1, 12.3, CELL[0], 0, 0, 8.3), mb(0.3, 0.3, 1.9, DARK, 0, 0, 3.2), mb(1.4, 1.1, 1.4, 0x333a44, 0.6, -1.9, 0), mcy(0.9, 0.2, 0.3, WHITE, 0, 1.8, -1.0, 10)],
  // ---- GPS IIR: 11.4 m span across two arrays, small bus, L-band array facing Earth
  gps: () => { const p = [mb(1.5, 1.9, 1.9, GOLD, 0, 0, 0), mcy(0.8, 0.8, 0.4, 0xdfe6ef, 0, -1.1, 0, 12)]; for (const s of [-1, 1]) p.push(mb(1.5, 0.05, 4.7, CELL[0], 0, 0, s * (0.95 + 2.35))); return p; },
  // ---- geostationary weather satellite: ~2 m box, single wing (drawn nominally; exact wing size varies by series)
  geo: () => [mb(2.0, 2.0, 2.9, GOLD, 0, 0, 0), mb(2.7, 0.05, 6.5, CELL[0], 0, 0, 5.3), mcy(0.6, 0.15, 0.25, WHITE, 0, 1.2, 0.6, 10), mb(0.2, 0.2, 2.6, DARK, 0, 0, 2.7)],
  iridium: () => iridiumParts()
};
// Iridium (first generation): ~4 m prism with three 1.9 x 0.9 m L-band panels and two small wings (~5 m span)
const iridiumParts = () => {
  const p = [C(new THREE.CylinderGeometry(M(0.8), M(0.8), M(3.2), 3), GOLD)];
  for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; p.push(C(new THREE.BoxGeometry(M(0.07), M(1.9), M(0.9)), GREY, Math.sin(a) * M(1.15), 0, Math.cos(a) * M(1.15), [0, a, 0])); }
  for (const s of [-1, 1]) { p.push(mb(0.8, 0.05, 1.8, CELL[0], 0, 0.2, s * 2.0, [0.3 * s, 0, 0])); p.push(mb(0.08, 0.08, 0.7, 0x7d8794, 0, 0.1, s * 0.8)); }
  p.push(C(new THREE.CylinderGeometry(M(0.25), M(0.35), M(0.6), 8), DARK, 0, M(-1.9), 0));
  return p;
};

// the real-world facts shown on the target display and the bay screen
const REAL = {
  iss: { name: 'INTERNATIONAL SPACE STATION', size: '109 x 73 M', mass: '420 T', crew: '7 ABOARD', note: 'ABOUT A FOOTBALL FIELD' },
  hubble: { name: 'HUBBLE SPACE TELESCOPE', size: '13.2 x 4.2 M', mass: '11 T', crew: 'UNCREWED', note: 'ABOUT A SCHOOL BUS' },
  envisat: { name: 'ENVISAT', size: '26 x 10 x 5 M', mass: '8.2 T', crew: 'UNCREWED', note: 'ESA EARTH OBSERVER' },
  terra: { name: 'TERRA', size: '6.8 x 3.5 M + ARRAY', mass: '4.9 T', crew: 'UNCREWED', note: 'NASA EOS AM-1' },
  aqua: { name: 'AQUA', size: '16.7 x 4.8 M', mass: '3.1 T', crew: 'UNCREWED', note: 'NASA EOS PM-1' },
  iridium: { name: 'IRIDIUM 1ST GEN', size: '4 M, ~5 M SPAN', mass: '689 KG', crew: 'UNCREWED', note: 'ABOUT A DELIVERY VAN' },
  gps: { name: 'GPS BLOCK IIR', size: '11.4 M SPAN', mass: '2.0 T', crew: 'UNCREWED', note: 'ABOUT A BUS LENGTH' },
  geo: { name: 'GEOSTATIONARY WEATHER SAT', size: '~2 M BUS', mass: '~3 T', crew: 'UNCREWED', note: 'AT 35,786 KM' }
};
