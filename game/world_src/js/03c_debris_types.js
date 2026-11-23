// ============================================================ debris designs
// Hero objects (the two collision victims, the rocket stage) are built in real metres on the SAME scale as the working satellites, so a dead Iridium is exactly as big as a live one.
// Fragments are catalogue classes (SMALL < 0.1 m2, MEDIUM 0.1-1 m2 radar cross-section): in life a few centimetres, far too small to see at 10 km per unit,
// so they are drawn enlarged by one stated amount per class (FRAG_X below) and the target display says so.
const FRAG_X = { LARGE: 1, MEDIUM: 'x ENLARGED', SMALL: 'x ENLARGED', SHARD: 'x ENLARGED' };
// palettes per break-up: what the pieces are made of tells you where they came from
const DEB_PAL = {
  FENGYUN: { main: [0x6b6f78, 0x585c66, 0x7a6d5c], accent: 0xb5532a, foil: 0x8d7a4a },          // 2007 anti-satellite test: charred grey metal, scorched ribs
  COSMOS: { main: [0x93a392, 0xb9b39a, 0xa8a294], accent: 0xe58a2d, foil: 0xc79a3a },            // 2009 collision, Soviet green and beige
  IRIDIUM: { main: [0xb4bfca, 0xc7ccd4, 0x9aa4b0], accent: 0xc79a3a, foil: 0xd9b24a },           // 2009 collision, grey antenna panels and gold bus
  DEFAULT: { main: [0xa8a294, 0x8d96a3, 0xb7ad98], accent: 0xe58a2d, foil: 0xc79a3a }
};
const palFor = name => /FENGYUN/.test(name) ? DEB_PAL.FENGYUN : /COSMOS/.test(name) ? DEB_PAL.COSMOS : /IRIDIUM/.test(name) ? DEB_PAL.IRIDIUM : DEB_PAL.DEFAULT;
const pick = (a, n) => a[n % a.length];
const BX = (w, h, d, sx, sy, sz) => new THREE.BoxGeometry(w, h, d, sx, sy, sz);

// each design returns parts in unit space (about 1 unit across); seed varies the warp
const FRAG = [
  (P, sq) => [C(warp(BX(1.7, 0.12, 1.2, 3, 1, 3), 0.55, sq * 131 + 3), pick(P.main, sq)), C(warp(BX(0.6, 0.1, 0.5, 2, 1, 2), 0.5, sq + 9), P.accent, 0.5, 0.1, 0.3, [0.2, 0.4, 0.1])],            // torn skin panel
  (P, sq) => [C(warp(BX(1.9, 0.07, 1.15, 4, 1, 3), 0.45, sq * 77 + 1), 0x2b57a6), C(BX(1.9, 0.08, 0.05), 0x7d8794, 0, 0.04, 0.3), C(BX(0.05, 0.08, 1.15), 0x7d8794, -0.4, 0.04, 0, [0, 0.2, 0]),
    C(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 4), 0x2a2f36, 0.9, 0.2, 0.5, [0.8, 0.3, 1.2])],                                                                                                    // solar panel torn from its yoke, wire trailing
  (P, sq) => [C(new THREE.ConeGeometry(0.9, 0.45, 10, 1), 0xe8eaee, 0, 0, 0, [Math.PI, 0, 0]), C(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 8), 0x4a525c, 0, 0.26, 0), C(new THREE.CylinderGeometry(0.04, 0.04, 1.7, 4), 0xb4bfca, 0.2, 0.9, 0.1, [0.15, 0, 0.1])],   // antenna dish and its feed mast
  (P, sq) => [C(new THREE.SphereGeometry(0.75, 9, 5, 0, Math.PI * 2, 0, 2.4), 0xcfd4da), C(new THREE.CylinderGeometry(0.78, 0.78, 0.07, 9), P.accent, 0, 0.1, 0), C(new THREE.CylinderGeometry(0.13, 0.13, 0.35, 6), 0x4a525c, 0, 0.8, 0)],   // ruptured propellant tank
  (P, sq) => [C(new THREE.CylinderGeometry(0.07, 0.07, 1.4, 5), pick(P.main, sq), -0.3, 0.1, 0, [0, 0, 0.5]), C(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 5), pick(P.main, sq), 0.55, -0.35, 0, [0, 0, -0.9]), C(BX(0.3, 0.3, 0.12), 0x4a525c, -0.9, 0.35, 0, [0, 0, 0.5]), C(BX(0.2, 0.2, 0.2), 0x4a525c, 1.0, -0.65, 0)],   // bent strut with fittings
  (P, sq) => [C(BX(1.5, 0.09, 0.7), P.accent, 0, 0.3, 0, [0.5, 0, 0]), C(BX(1.5, 0.09, 0.7), pick(P.main, sq + 1), 0, -0.1, -0.1, [-0.25, 0, 0]), C(BX(1.5, 0.09, 0.5), pick(P.main, sq), 0, -0.55, 0.1, [-0.7, 0, 0])],   // folded fairing petal
  (P, sq) => [C(BX(1.1, 0.5, 0.8, 2, 1, 2), 0x4a525c), C(new THREE.CylinderGeometry(0.4, 0.4, 0.14, 9), pick(P.main, sq), 0.1, 0.35, 0.1), C(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 5), 0xb4bfca, -0.4, 0, 0.55, [Math.PI / 2, 0, 0]), C(BX(0.5, 0.2, 0.9), P.foil, -0.5, 0.1, -0.2, [0, 0.4, 0])],   // bracket, gear and pin assembly
  (P, sq) => [C(warp(new THREE.IcosahedronGeometry(0.85, 1), 0.9, sq * 53 + 5).scale(1.2, 0.6, 0.9), P.foil), C(warp(new THREE.IcosahedronGeometry(0.5, 0), 0.8, sq + 31), 0xe8e0c0, 0.5, 0.25, 0.2)]    // crumpled thermal blanket
];
const SHARDS = [
  (P, sq) => [C(warp(new THREE.TetrahedronGeometry(1), 0.6, sq * 131 + 7), pick(P.main, sq))],                                                                                                       // jagged splinter
  (P, sq) => [C(new THREE.CylinderGeometry(0.8, 0.8, 0.09, 6), pick([0xf2f2f2, P.accent, 0x93a392], sq), 0, 0, 0, [0.5, sq * 0.7, 0.2])],                                                          // paint flake
  (P, sq) => [C(new THREE.SphereGeometry(0.55, 7, 4), 0xcfd6de), C(new THREE.SphereGeometry(0.22, 5, 3), 0xe8eef6, 0.5, 0.2, 0.1)],                                                                 // frozen coolant droplets
  (P, sq) => [C(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 4), 0xb4bfca, 0, 0, 0, [0.3, 0, sq * 0.5]), C(BX(0.3, 0.3, 0.3), 0x4a525c, 0.5, 0.2, 0)]                                              // sliver of strut + bolt
];

// type: DEBRIS | ROCKET BODY | UNKNOWN | PAYLOAD. US = the light uniforms to use (the world's, or the target display's).
function buildMesh(type, size, seed, US, name) {
  US = US || U; name = name || '';
  const sq = seed % 7, hero = type === 'PAYLOAD' ? (/IRIDIUM/.test(name) ? 'I' : 'C') : '', P = palFor(name), real = !!hero || type === 'ROCKET BODY';
  const parts = () => {
    if (hero === 'I') return iridiumParts();                                                         // a dead Iridium 33: the very same model as the 66 live ones, 4 m
    if (hero === 'C') return [mcy(0.95, 0.95, 2.7, 0x93a392, 0, 0, 0, 12), mcy(0.98, 0.98, 0.3, 0xe58a2d, 0, 0.55, 0, 12),                       // Strela-class comms bus, 1.9 m
      C(new THREE.SphereGeometry(M(0.95), 12, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x7d8a7c, 0, M(1.35), 0),
      ...[0, 1, 2, 3].map(k => mb(0.4, 0.8, 0.4, 0x5b6670, Math.sin(k * Math.PI / 2) * 1.1, -0.9, Math.cos(k * Math.PI / 2) * 1.1)), mb(0.06, 6.0, 0.06, 0xcfd6de, 0.5, 4.3, 0, [0, 0, 0.1])];
    if (type === 'ROCKET BODY') return [mcy(1.45, 1.45, 4.2, 0xb4bfca, 0, 0, 0, 14), mcy(1.5, 1.5, 0.5, 0xe58a2d, 0, 1.2, 0, 14), mcy(0.55, 1.3, 1.9, 0x4a525c, 0, -3.0, 0, 12),    // CZ-4B third stage: 2.9 m
      C(new THREE.SphereGeometry(M(1.45), 12, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x8b97a4, 0, M(2.1), 0), mb(2.9, 0.08, 0.5, 0x4a525c, 0, -1.0, 0, [0, 0, 0]), mb(0.7, 0.05, 2.2, 0x7d8794, 0, 0.3, 1.9, [0.3, 0.5, 0.1])];
    if (type === 'UNKNOWN') return [C(BX(1, 0.9, 1.2), 0xa49bc4), C(BX(2.3, 0.09, 1), 0x2b57a6, 1.75, 0, 0, [0.4, 0, 0]), C(BX(2.3, 0.09, 1), 0x2b57a6, -1.75, 0, 0, [0.4, 0, 0]), C(new THREE.ConeGeometry(0.4, 0.35, 8), 0xd8d8e0, 0, 0.62, 0)];
    if (size === 'SHARD') return pick(SHARDS, sq + (seed >> 3))(P, sq);
    // fragments: the family decides which designs it tends to produce
    const bias = /FENGYUN/.test(name) ? [0, 4, 7, 5] : /IRIDIUM/.test(name) ? [1, 2, 0, 6] : /COSMOS/.test(name) ? [0, 3, 6, 5] : [0, 1, 2, 3, 4, 5, 6, 7];
    return FRAG[pick(bias, sq + (seed >> 3))](P, sq);
  };
  const out = finishMesh(cachedMerge(['deb', type, size, sq, seed >> 3, hero, P.accent, P.main[0]].join('|'), parts, size !== 'SHARD'), US); out.real = real;
  return out;
}

// lab: #lab=frags[&rel=0..3] shows every fragment and shard design (0 default, 1 Fengyun, 2 Cosmos, 3 Iridium palettes)
LABS.frags = (US, o) => {
  const P = [DEB_PAL.DEFAULT, DEB_PAL.FENGYUN, DEB_PAL.COSMOS, DEB_PAL.IRIDIUM][o.rel || 0], grp = new THREE.Group(), mats = [];
  FRAG.forEach((f, i) => { const m = finishMesh(mergeParts(f(P, i + 1), true), US); m.grp.position.set((i % 4 - 1.5) * 3.4, 1.9 - Math.floor(i / 4) * 3.6, 0); grp.add(m.grp); mats.push(...m.mats); });
  SHARDS.forEach((f, i) => { const m = finishMesh(mergeParts(f(P, i + 2), true), US); m.grp.position.set((i - 1.5) * 3.4, -5.4, 0); grp.add(m.grp); mats.push(...m.mats); });
  return { grp, mats, metres: 7.5, unitsPerMetre: 1, noRuler: true, title: 'DEBRIS DESIGNS', info: ['FRAGMENTS (ENLARGED FOR VISIBILITY)', 'BOTTOM ROW: SHARDS'] };
};
for (const [k, type, name] of [['cz4', 'ROCKET BODY', 'CZ-4B R/B'], ['cosmos', 'PAYLOAD', 'COSMOS 2251'], ['iridium33', 'PAYLOAD', 'IRIDIUM 33']]) LABS[k] = US => { const b = buildMesh(type, 'LARGE', 3, US, name); return { grp: b.grp, mats: b.mats, metres: k === 'cz4' ? 9 : 6, title: name + ' (REAL SIZE ON CRAFT SCALE)', info: [k === 'cz4' ? '2.9 M STAGE' : k === 'cosmos' ? '1.9 M BUS' : '4 M, SAME MODEL AS LIVE IRIDIUM'] }; };
