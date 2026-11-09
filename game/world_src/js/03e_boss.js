// ============================================================ THE KESSLER RELIQUARY: boss model
// A baroque monstrance built from orbital wreckage: a fused stack of rocket stages for a body, a caged heart holding a dead cosmonaut, a pale weeping mask under a crown of thorns,
// praying hands made of antenna booms, tattered solar-panel wings, a sunburst halo of gold rays, and a rosary of rocket-tank beads. Faces -z; up is +y. About 200 m tall.
const BONE = 0xe6dcc4, BRASS = 0xc79a3a, BRASS2 = 0x9a7428, BLOOD = 0xb02a2a, EMBER = 0xff6a3a, SOOT = 0x2a2d34, VEIL = 0xd9b24a;
const BOSS_X = 2.2;                                      // drawn this much larger than the real-metre sizes below so it fills the view
const HEART = { x: 0, y: 10, z: -4, r: 13 };             // metres, boss-local: the caged heart (the weak point)
const BEAD_N = 8, BEAD_R = 74;                           // rosary: 8 beads on a ring of this radius (metres) around the heart

// the boss in separate parts (each with a pivot, in metres) so the head can turn to watch you, the halo can spin, the wings can flare and the eyes can glow
function bossSections() {
  const body = [], head = [], eyes = [], halo = [], wingL = [], wingR = [];
  // ---- body: fused stages, tapering up to a neck; thrust cluster below
  body.push(mcy(14, 5, 34, SOOT, 0, -78, 0, 12), mcy(17, 19, 52, 0x8e99a8, 0, -44, 0, 14), mcy(19.5, 19.5, 5, BRASS, 0, -60, 0, 14), mcy(19.5, 19.5, 5, BRASS, 0, -28, 0, 14), mcy(20, 20, 3, BLOOD, 0, -44, 0, 14));
  body.push(mcy(13, 17, 26, 0xb4bfca, 0, 23, 0, 14), mcy(18, 13, 6, BRASS2, 0, 56, 0, 12), mcy(7, 10, 22, 0xc7ccd4, 0, 66, 0, 10));
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; body.push(mcy(2.2, 3.5, 30, BRASS2, Math.sin(a) * 24, -50, Math.cos(a) * 24, 6)); }
  // ---- the heart's cage: a gothic lantern around a glowing red sphere with the dead cosmonaut inside
  body.push(C(new THREE.SphereGeometry(M(HEART.r), 12, 8), EMBER, M(HEART.x), M(HEART.y), M(HEART.z)));
  body.push(mb(5, 12, 4, 0xf4f4f4, 0, 9, -4), C(new THREE.SphereGeometry(M(3.6), 8, 5), 0xf4f4f4, 0, M(18.5), M(-4)), C(new THREE.SphereGeometry(M(2.6), 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xffd37a, 0, M(18.8), M(-6.6), [-1.35, 0, 0]));
  body.push(mb(24, 1.6, 1.6, 0xf4f4f4, 0, 14, -4.5), mb(1.8, 7, 1.8, 0xf4f4f4, 0, 3, -4.5));
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, x = Math.sin(a) * 19, z = HEART.z + Math.cos(a) * 19; body.push(mb(1.8, 46, 1.8, BRASS, x, HEART.y, z), mb(3, 3, 3, BRASS2, x, HEART.y + 24, z)); }
  body.push(mcy(21, 21, 2.2, BRASS, 0, HEART.y + 22, HEART.z, 16), mcy(21, 21, 2.2, BRASS, 0, HEART.y - 22, HEART.z, 16));
  // ---- head: pale mask, dark brow and mouth, tears, crown of thorns (turns to follow you); the eyes are their own glowing part
  head.push(C(new THREE.SphereGeometry(M(15), 12, 8), BONE, 0, M(92), M(-2)), mb(2, 14, 2.5, SOOT, 0, 86, -16.5), mb(9, 1.8, 2.5, SOOT, 0, 78, -15.5), mb(7, 3.4, 3, SOOT, -5.5, 94, -16), mb(7, 3.4, 3, SOOT, 5.5, 94, -16));
  for (const sx of [-1, 1]) head.push(mb(1.2, 46, 1.2, 0xbfe3ff, sx * 5.5, 70, -17), mb(1.2, 30, 1.2, 0x8cc4ff, sx * 6.8, 56, -17));
  for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; head.push(C(new THREE.ConeGeometry(M(1.8), M(13), 5), BRASS2, M(Math.sin(a) * 15), M(104 + (k % 2) * 3), M(Math.cos(a) * 15 - 2), [Math.cos(a) * 0.7, 0, -Math.sin(a) * 0.7])); }
  eyes.push(mb(6.4, 1.6, 2, 0xff3a2a, -5.5, 94.2, -17.4), mb(6.4, 1.6, 2, 0xff3a2a, 5.5, 94.2, -17.4), mb(1.6, 1.6, 2.2, 0xffffff, -5.5, 94.2, -17.9), mb(1.6, 1.6, 2.2, 0xffffff, 5.5, 94.2, -17.9));
  // ---- praying hands: two antenna booms pressed together into a pointed arch before the chest
  for (const sx of [-1, 1]) { body.push(mb(5.5, 74, 9, 0xd8d0b8, sx * 7.5, 60, -26, [0, 0, -sx * 0.1]), mb(1.2, 70, 8, BRASS2, sx * 10, 60, -26.2, [0, 0, -sx * 0.1]));
    for (let f = 0; f < 4; f++) body.push(mb(1.1, 18, 3, 0xe6dcc4, sx * (5.6 + f * 0.1), 88 + f * 2, -31 + f * 2, [0, 0, -sx * 0.1])); }
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) body.push(mb(10, 44 - k * 8, 0.6, VEIL, sx * (22 + k * 4), -22 - k * 4, -14 + k * 5, [0, sx * 0.25, sx * 0.05]));
  // ---- wings: three tiers of tattered solar panels each side, hinged at the shoulder
  for (const sx of [-1, 1]) for (let t = 0; t < 3; t++) {
    const len = 74 - t * 14, y = 10 - t * 22, th = 0.9 - t * 0.4, w = [], list = sx < 0 ? wingL : wingR;
    for (let k = 0; k < 6; k++) w.push(mb(len / 6, 0.8, 26 - t * 4 - (k % 2) * 5, CELL[k % 2], sx * (k + 0.5) * len / 6, 0, -(k % 2) * 2));
    list.push(...pivotParts(w, [0, 0, 0], [0, 0, sx * th]).map(([g, h]) => [g.translate(M(sx * 17), M(y + 40), M(12 + t * 3)), h, 0, 0, 0, [0, 0, 0]]));
  }
  // ---- halo: a sunburst of rays behind the head on a dark disc; the monstrance (spins)
  halo.push(C(new THREE.CylinderGeometry(M(46), M(46), M(2), 24), SOOT, 0, M(92), M(20), [Math.PI / 2, 0, 0]));
  for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2, L = k % 2 ? 62 : 98; halo.push(mb(4, L, 1.6, k % 2 ? BRASS2 : BRASS, Math.sin(a) * (30 + L / 2), 92 + Math.cos(a) * (30 + L / 2), 22, [0, 0, -a])); }
  for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; for (let s = 0; s < 4; s++) body.push(mcy(0.9 - s * 0.12, 0.9 - s * 0.12 + 0.1, 12, k % 2 ? SOOT : BRASS2, Math.sin(a) * (7 + s * 3.5), -98 - s * 10, Math.cos(a) * (7 + s * 3.5), 5)); }
  return { body: { parts: body, pivot: [0, 0, 0] }, head: { parts: head, pivot: [0, 92, -2] }, eyes: { parts: eyes, pivot: [0, 92, -2] }, halo: { parts: halo, pivot: [0, 92, 20] },
    wingL: { parts: wingL, pivot: [-17, 40, 12] }, wingR: { parts: wingR, pivot: [17, 40, 12] } };
}
const bossBody = () => Object.values(bossSections()).flatMap(s => s.parts);
const beadParts = () => [C(new THREE.SphereGeometry(M(6), 9, 6), 0xcfd4da), mcy(6.4, 6.4, 1.2, BRASS, 0, 0, 0, 12), mcy(2, 2, 14, BRASS2, 0, 0, 0, 6), mb(1.5, 1.5, 15, BRASS2, 0, 0, 0, [0, 0, 0])];
SAT_PARTS.boss = bossBody; SAT_PARTS.bead = beadParts;

LABS.boss = US => {
  const g = new THREE.Group(), b = finishMesh(cachedMerge('sat|boss', SAT_PARTS.boss, true), US); g.add(b.grp); const mats = [...b.mats], beads = [];
  for (let k = 0; k < BEAD_N; k++) { const bd = finishMesh(cachedMerge('sat|bead', SAT_PARTS.bead, true), US); g.add(bd.grp); beads.push(bd.grp); mats.push(...bd.mats); }
  return { grp: g, mats, metres: 120, sun: new V3(-0.3, 0.45, -0.85), title: 'THE KESSLER RELIQUARY', info: ['BOSS: A MONSTRANCE OF DEAD SATELLITES', 'WEAK POINT: THE CAGED HEART'],
    tick: t => beads.forEach((bd, k) => { const a = t * 0.35 + k / BEAD_N * Math.PI * 2; bd.position.set(Math.sin(a) * M(BEAD_R), M(HEART.y) + Math.cos(a) * M(BEAD_R) * 0.2, Math.cos(a) * M(BEAD_R)); }) };
};
