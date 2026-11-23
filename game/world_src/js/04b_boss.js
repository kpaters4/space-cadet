// ============================================================ THE KESSLER RELIQUARY: the fight
// It stalks you: it closes the distance as it weakens, its head turns to watch you and its eyes burn, the halo spins faster and the wings spread. Every attack is telegraphed by a flare and a HUD call-out.
// Parry (F) sends projectiles back: spikes, orbs, wreckage and homing wisps. Beams and the lunge cannot be parried: move.
// Phase 1 THE VEIL: eight rosary beads shield the heart. Phase 2 THE HEART: the cage is open. Phase 3 THE LAMENTATION (heart under half): faster, with the lunge.
let B = null, bossDone = false;
const BP = [];                                               // boss projectiles: {kind, mesh, mats, pos, vel, hp, radius, dmg, life, returned}
const bq = new Q4(), bv1 = new V3(), bv2 = new V3(), bNull = new V3(0, 1, 0), bv3 = new V3();
const BOSS_NAME = 'THE KESSLER RELIQUARY', PHASE_NAME = ['', 'THE VEIL', 'THE HEART', 'THE LAMENTATION'];
const HEART_HP = 36, BEAD_HP = 4;
const projGeo = {
  shard: () => [C(new THREE.ConeGeometry(0.5, 3.0, 5), 0xe0b24a), C(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 5), 0xb02a2a, 0, -1.4, 0)],                                    // a brass spike of the halo
  hurl: () => [...FRAG[3](DEB_PAL.FENGYUN, 2), ...FRAG[4](DEB_PAL.FENGYUN, 3), ...FRAG[0](DEB_PAL.FENGYUN, 4), ...FRAG[7](DEB_PAL.FENGYUN, 1)],                            // hurled wreckage: tank, strut, skin and foil fused together
  wisp: () => [C(new THREE.SphereGeometry(1.5, 8, 5), 0xffe6d8), C(new THREE.CylinderGeometry(2.4, 2.4, 0.25, 10), 0xff2a2a), C(new THREE.ConeGeometry(0.9, 6, 6), 0xff5a3a, 0, -3.6, 0, [Math.PI, 0, 0])],   // a homing wisp: a pale core in a red ring, a tail behind
  censer: () => [C(new THREE.SphereGeometry(2.2, 9, 6), 0xff6a3a), C(new THREE.CylinderGeometry(3.4, 3.4, 0.35, 12), 0xc79a3a, 0, 0, 0), C(new THREE.CylinderGeometry(0.15, 0.15, 7, 5), 0x9a7428, 0, 0, 0, [0, 0, Math.PI / 2])]
};
const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
const BRINGS = []; for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); m.visible = false; scene.add(m); BRINGS.push({ m, age: 9 }); }
let bringI = 0;
function bossRing(at) { const r = BRINGS[bringI++ % BRINGS.length]; r.age = 0; r.m.position.copy(at); r.m.lookAt(ship.pos); r.m.visible = true; }       // a shockwave ring that spreads from the boss as it attacks
function projMesh(kind) { return finishMesh(cachedMerge('bp|' + kind, projGeo[kind], true), U); }
const toWorld = (m, x, y, z, out) => out.set(M(x), M(y), M(z)).applyMatrix4(m);       // boss-local metres -> world position
let bossBanner = -1e9; const bossFx = { pos: new V3() };

function mkSection(sec, US) {                                                          // one animatable part: geometry re-centred on its pivot, the mesh sits at the pivot
  const m = mergeParts(sec.parts, true), pv = sec.pivot, t = [-M(pv[0]), -M(pv[1]), -M(pv[2])]; m.g.translate(...t); if (m.eg) m.eg.translate(...t);
  const b = finishMesh(m, US); b.grp.position.set(M(pv[0]), M(pv[1]), M(pv[2])); return b;
}
function spawnBoss() {
  const fw = new V3(0, 0, -1).applyQuaternion(ship.q);
  const posW = ship.pos.clone().addScaledVector(fw, 250).setLength(ship.pos.length());
  const qi = bq.copy(envQ).invert(), velW = new V3().crossVectors(N0, posW).normalize();
  const posIn = posW.clone().applyQuaternion(qi), velIn = velW.applyQuaternion(qi), n = new V3().crossVectors(posIn, velIn).normalize(), u = posIn.clone().normalize(), v = new V3().crossVectors(n, u).normalize();
  const root = new THREE.Group(), S = bossSections(), body = mkSection(S.body, U), head = mkSection(S.head, U), eyes = mkSection(S.eyes, U), halo = mkSection(S.halo, U), wL = mkSection(S.wingL, U), wR = mkSection(S.wingR, U);
  root.add(body.grp, head.grp, halo.grp, wL.grp, wR.grp); head.grp.add(eyes.grp); eyes.grp.position.set(0, 0, 0);
  eyes.mats.forEach(m => m.uniforms.uFlash.value = 1);
  const mats = [...body.mats, ...head.mats, ...halo.mats, ...wL.mats, ...wR.mats], beadMeshes = [];
  for (let k = 0; k < BEAD_N; k++) { const bd = finishMesh(cachedMerge('sat|bead', SAT_PARTS.bead, true), U); root.add(bd.grp); beadMeshes.push({ grp: bd.grp, mats: bd.mats, hp: BEAD_HP, alive: true, flash: 0 }); }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a3a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.setScalar(M(330)); glow.position.set(0, M(92), M(26)); root.add(glow);   // the halo's glow
  root.scale.setScalar(BOSS_X * 0.4); scene.add(root);
  B = { root, parts: { head: head.grp, halo: halo.grp, wingL: wL.grp, wingR: wR.grp, eyes: eyes.mats }, mats, beads: beadMeshes, u, v, r: posIn.length(), phi: 0, off: new V3(), offVel: new V3(), pos: posW.clone(), t: 0, state: 'intro', phase: 1, beadsLeft: BEAD_N,
    glow, banner: null, beatT: 0, heartHp: HEART_HP, atkT: 5, tele: null, flash: 0, heartFlash: 0, dieT: 0, atkN: 0, bodyMsgT: 0, timers: [], beam: null, lunge: null, beamCd: 0, spread: 0, haloSpd: 0.25 };
  bossPlace(0); bossFx.pos.copy(B.pos);
  darkTarget = 0.85;                                                                       // the fight is fought in an eclipse: only your lamp, its glow and its fire light the scene
  say(BOSS_NAME, 4200); bossBanner = performance.now(); ship.shake = 1.2; stopT = 0.25; shakeAmp = 6; B.banner = { text: BOSS_NAME, sub: 'KEEPER OF THE DEAD ORBIT', t: performance.now(), long: true };
}
const BAND = { 1: [190, 290], 2: [140, 230], 3: [95, 180] };
function bossPlace(dt) {
  B.phi += Math.sqrt(GM / (B.r * B.r * B.r)) * dt;
  B.pos.copy(B.u).multiplyScalar(Math.cos(B.phi) * B.r).addScaledVector(B.v, Math.sin(B.phi) * B.r).applyQuaternion(envQ);
  B.off.addScaledVector(B.offVel, dt); B.pos.add(B.off);
  const minR = R + 100;                                                                      // the body hangs ~75 units below its centre: keep the whole of it above the atmosphere, and let it pass through everything else
  if (B.pos.length() < minR) { tmp.copy(B.pos).setLength(minR).sub(B.pos); B.pos.add(tmp); B.off.add(tmp); const up = bv3.copy(B.pos).normalize(), vr = B.offVel.dot(up); if (vr < 0) B.offVel.addScaledVector(up, -vr); }
  const toShip = bv1.subVectors(ship.pos, B.pos), d = toShip.length(), band = BAND[B.phase];
  if (B.lunge && B.lunge.state === 'go') { /* the lunge sets its own velocity */ }
  else if (B.beam && B.beam.state === 'fire') B.offVel.multiplyScalar(Math.exp(-6 * dt));                // it plants itself while the beam fires
  else if (B.state === 'dying') B.offVel.multiplyScalar(Math.exp(-2 * dt));
  else if (d > band[1]) B.offVel.copy(toShip).setLength(clamp(36 + (d - band[1]) * 0.7 + ship.vel.length() * 0.9, 36, 150));   // it chases: faster than you can run, and faster the further you get else if (d < band[0]) B.offVel.copy(toShip).setLength(-26); else B.offVel.multiplyScalar(Math.exp(-4.5 * dt));    // it stalks: closer as it weakens; settles at range instead of overshooting
  const bob = Math.sin(B.t * 0.9) * 3;
  B.root.position.copy(B.pos).addScaledVector(bNull.copy(B.pos).normalize(), bob); B.root.up.copy(B.pos).normalize(); B.root.lookAt(bv2.copy(B.pos).multiplyScalar(2).sub(ship.pos));   // up is away from Earth, face the ship (model faces -z)
  B.root.updateMatrixWorld(true);
}
// ---- things the cannons can hit
const hHeart = { name: 'HEART', radius: 0, pos: new V3(), prio: 1 }, hBody = { name: 'BODY', radius: 0, pos: new V3(), prio: 0 };
function bossHittables() {
  if (!B || B.state === 'dying') return [];
  const out = [], m = B.root.matrixWorld;
  toWorld(m, HEART.x, HEART.y, HEART.z, hHeart.pos); hHeart.radius = M(HEART.r) * BOSS_X * 0.9 * B.root.scale.x / BOSS_X; hHeart.hit = hitHeart; out.push(hHeart);
  B.beads.forEach((b, k) => { if (!b.alive) return; b.grp.getWorldPosition(b.pos || (b.pos = new V3())); b.radius = M(6) * B.root.scale.x * 1.3; b.name = 'BEAD'; b.hit = d => hitBead(b, d); b.prio = 1; out.push(b); });
  for (const p of BP) if (!p.returned) out.push(p);
  hBody.pos.copy(B.pos).addScaledVector(bNull.copy(B.root.up), M(20) * B.root.scale.x); hBody.radius = M(70) * B.root.scale.x; hBody.hit = hitBody; out.push(hBody);
  return out;
}
function hitBead(b, d) {
  b.hp -= d; b.flash = 1; burst(b.pos, 6, 8, false);
  if (b.hp > 0) return;
  b.alive = false; b.grp.visible = false; B.beadsLeft--; burst(b.pos, 40, 16, true); coinsRun += 15; ship.shake = Math.max(ship.shake, 0.3);
  if (B.beadsLeft === 0) { B.phase = 2; B.atkT = 1.8; B.tele = null; B.haloSpd = 0.7; stopT = 0.3; ship.shake = 1; shakeAmp = 7; B.banner = { text: 'PHASE II', sub: 'THE HEART', t: performance.now() }; say('THE ROSARY IS BROKEN. THE HEART IS BARED.', 3600); } else say('A BEAD OF THE ROSARY BREAKS. ' + B.beadsLeft + ' LEFT', 1600);
}
function hitHeart(d) {
  if (B.beadsLeft > 0) { burst(hHeart.pos, 4, 5, false); B.bodyMsgT <= 0 && (say('THE ROSARY SHIELDS THE HEART. BREAK THE BEADS.', 2000), B.bodyMsgT = 2.5); return; }
  if (B.state === 'intro') return;
  B.heartHp -= d; B.heartFlash = 1; burst(hHeart.pos, 8, 9, true);
  if (B.heartHp <= HEART_HP / 2 && B.phase === 2) { B.phase = 3; B.atkT = 1.0; B.tele = null; B.haloSpd = 1.6; stopT = 0.4; shakeAmp = 9; B.banner = { text: 'PHASE III', sub: 'THE LAMENTATION', t: performance.now() }; say('THE LAMENTATION BEGINS', 3000); ship.shake = 1.4; }
  if (B.heartHp <= 0) bossDie();
}
function hitBody(d) { burst(hBody.pos.clone().addScaledVector(fwdV, -M(60) * BOSS_X), 3, 4, false); if (B.bodyMsgT <= 0) { say('THE VEIL HOLDS. AIM AT THE HEART.', 1500); B.bodyMsgT = 3; } }
function bossDie() {
  B.state = 'dying'; B.dieT = 0; B.tele = null; B.beam = null; B.lunge = null; B.timers.length = 0; for (const p of BP) scene.remove(p.mesh); BP.length = 0;
  say('THE RELIQUARY FALLS SILENT', 4000); coinsRun += 300; ship.shake = 1;
}
// ---- attacks
const K3 = { shard: [1, 2.6, 5, 'SPIKE', 1.15], censer: [4, 6, 22, 'CENSER', 1.3], hurl: [14, 9, 30, 'WRECKAGE', 4.2], wisp: [2, 3.4, 14, 'WISP', 1.4] };
function shootProj(kind, from, dir, speed) {
  const b = projMesh(kind), k3 = K3[kind], pr = { kind, mesh: b.grp, mats: b.mats, pos: from.clone(), vel: dir.clone().setLength(speed), hp: k3[0], radius: k3[1], dmg: k3[2], life: kind === 'wisp' ? 14 : 16, flash: 0, name: k3[3], prio: 2, spin: rand() * 6, returned: false };
  pr.hit = d => { pr.hp -= d; pr.flash = 1; burst(pr.pos, 4, 6, false); if (pr.hp <= 0) killProj(pr, true); };
  b.grp.scale.setScalar(k3[4]); b.grp.position.copy(from); scene.add(b.grp); BP.push(pr); return pr;
}
function killProj(p, shot) {
  scene.remove(p.mesh); const i = BP.indexOf(p); if (i >= 0) BP.splice(i, 1); burst(p.pos, p.kind === 'hurl' ? 80 : p.kind === 'censer' ? 50 : p.kind === 'wisp' ? 24 : 14, p.kind === 'hurl' ? 24 : p.kind === 'censer' ? 18 : 9, true);
  if (shot) coinsRun += p.kind === 'censer' || p.kind === 'hurl' ? 8 : p.kind === 'wisp' ? 3 : 1;
}
function muzzle(out) { return toWorld(B.root.matrixWorld, 0, 70, -30, out); }                  // the halo's centre-front: where spikes leave from
const eyePos = out => toWorld(B.root.matrixWorld, 0, 94, -18, out);
const later_b = (t, fn) => B.timers.push({ t, fn });
function aimFrom(from, lead) { const d = new V3().subVectors(ship.pos, from); if (lead) d.addScaledVector(ship.vel, d.length() / 60); return d.normalize(); }
function bossAttack(kind) {
  const from = muzzle(new V3()), aim = aimFrom(from), ph = B.phase;
  if (kind === 'tithe') {                                                                       // a fan of spikes
    const n = ph === 3 ? 13 : ph === 2 ? 9 : 7, right = new V3().crossVectors(aim, B.root.up).normalize(), up = new V3().crossVectors(right, aim).normalize();
    for (let k = 0; k < n; k++) { const a = (k - (n - 1) / 2) * 0.07, row = (k % 2) * 0.05; shootProj('shard', from, aim.clone().addScaledVector(right, a).addScaledVector(up, row).normalize(), 48 + (k % 3) * 5); }
  } else if (kind === 'stream') {                                                               // a rapid stream, each spike aimed afresh: ten chances to parry, if you keep still enough to
    for (let k = 0; k < (ph === 3 ? 14 : 10); k++) later_b(k * (ph === 3 ? 0.13 : 0.18), () => { const f = muzzle(new V3()), a = aimFrom(f, true); a.x += (rand() - 0.5) * 0.04; a.y += (rand() - 0.5) * 0.04; shootProj('shard', f, a.normalize(), 56); });
  } else if (kind === 'halo') {                                                                 // a ring of spikes peels off the halo, then all turn on you
    const right = new V3().crossVectors(aim, B.root.up).normalize(), up = new V3().crossVectors(right, aim).normalize(), n = ph === 3 ? 18 : 12;
    for (let k = 0; k < n; k++) { const a = k / n * 6.283, off = right.clone().multiplyScalar(Math.cos(a) * 34).addScaledVector(up, Math.sin(a) * 34); later_b(k * 0.05, () => { const f = muzzle(new V3()).add(off); shootProj('shard', f, aimFrom(f), 50); }); }
  } else if (kind === 'wisps') {                                                                // homing wisps: they curve after you
    const right = new V3().crossVectors(aim, B.root.up).normalize(); const n = ph === 3 ? 5 : 3;
    for (let k = 0; k < n; k++) { const f = from.clone().addScaledVector(right, (k - (n - 1) / 2) * 30); shootProj('wisp', f, aim.clone().addScaledVector(right, (k - (n - 1) / 2) * 0.3).normalize(), 34); }
  } else if (kind === 'hurl') shootProj('hurl', from, aim, 26);
  else if (kind === 'censer') { const n = ph === 3 ? 2 : 1; for (let k = 0; k < n; k++) { const off = new V3().crossVectors(aim, B.root.up).normalize().multiplyScalar((k - (n - 1) / 2) * 60); shootProj('censer', from.clone().add(off), aim.clone().add(off.clone().multiplyScalar(-0.002)).normalize(), 24); } }
  else if (kind === 'beam') {                                                                   // a beam sweeps across where you were: lock-on line first, then the sweep
    const f = eyePos(new V3()), a = aimFrom(f), right = new V3().crossVectors(a, B.root.up).normalize(), sg = rand() < 0.5 ? 1 : -1;
    B.beam = { state: 'warn', t: 0, warn: 1.0, fire: ph === 3 ? 1.7 : 1.3, sg, A: a.clone(), Bd: a.clone() };
  } else if (kind === 'lunge') { B.lunge = { state: 'go', t: 0, dir: aimFrom(B.pos).clone(), hit: false }; B.offVel.copy(B.lunge.dir).multiplyScalar(120); ship.shake = Math.max(ship.shake, 0.6); }
  burst(from, 30, 12, true); bossRing(from); ship.shake = Math.max(ship.shake, 0.3);
}
const ATTACKS = { 1: ['tithe', 'stream', 'tithe', 'halo', 'hurl'], 2: ['stream', 'wisps', 'tithe', 'beam', 'hurl', 'halo', 'censer'], 3: ['beam', 'stream', 'wisps', 'halo', 'lunge', 'hurl', 'stream', 'beam', 'tithe'] };
const TELE = { tithe: 0.8, stream: 0.7, halo: 0.9, wisps: 0.9, censer: 1.0, hurl: 1.4, beam: 0.5, lunge: 1.0 };
const CADENCE = { 1: 2.3, 2: 1.7, 3: 1.05 };
function updateBoss(dt) {
  if (!B) return;
  B.t += dt; B.bodyMsgT = Math.max(0, B.bodyMsgT - dt); B.beamCd = Math.max(0, B.beamCd - dt);
  // ---- the boss itself: rises at the start, then every part moves
  const intro = B.state === 'intro', rise = intro ? 0.4 + 0.6 * (1 - Math.pow(1 - Math.min(1, B.t / 4.5), 3)) : 1; B.root.scale.setScalar(BOSS_X * rise);
  bossPlace(dt);
  const P = B.parts, local = B.root.worldToLocal(bv3.copy(ship.pos)), yaw = clamp(Math.atan2(-local.x, -local.z), -0.8, 0.8), pitch = clamp(Math.atan2(local.y - M(92), Math.hypot(local.x, local.z)), -0.3, 0.3);
  P.head.rotation.y += (yaw - P.head.rotation.y) * (1 - Math.exp(-dt * 3)); P.head.rotation.x += (-pitch * 0.5 - P.head.rotation.x) * (1 - Math.exp(-dt * 3));      // the head turns to watch you
  P.halo.rotation.z += dt * B.haloSpd * (B.tele ? 3 : 1);
  B.spread += ((B.phase === 3 ? 0.42 : B.phase === 2 ? 0.14 : 0) - B.spread) * (1 - Math.exp(-dt * 1.5)); const flap = Math.sin(B.t * 0.9) * 0.06 + B.spread;
  P.wingL.rotation.z = -flap; P.wingR.rotation.z = flap;                                                                                                        // wings rise and flex
  const beat = 0.5 + 0.5 * Math.sin(B.t * (B.phase === 3 ? 7 : 3.4)), eye = 0.65 + 0.35 * Math.sin(B.t * 2.3) + (B.tele ? 0.3 : 0);
  P.eyes.forEach(m => m.uniforms.uFlash.value = clamp(eye, 0, 1.3));
  B.beads.forEach((b, k) => { if (!b.alive) return; const a = B.t * (B.phase === 3 ? 0.7 : 0.4) + k / BEAD_N * Math.PI * 2; b.grp.position.set(Math.sin(a) * M(BEAD_R), M(HEART.y) + Math.cos(a) * M(BEAD_R) * 0.2, Math.cos(a) * M(BEAD_R)); b.grp.rotation.y += dt; b.flash = Math.max(0, b.flash - dt * 5); for (const m of b.mats) m.uniforms.uFlash.value = b.flash; });
  B.heartFlash = Math.max(0, B.heartFlash - dt * 4);
  { const g = B.glow, pulse = 0.5 + 0.5 * Math.sin(B.t * (B.phase === 3 ? 6 : 2.4)); g.material.opacity = (0.28 + 0.22 * pulse + (B.tele ? 0.25 : 0)) * rise; g.material.color.setHex(B.phase === 3 ? 0xff2a1a : B.phase === 2 ? 0xff5a2a : 0xff9a4a); }   // the halo glows, redder and faster as it weakens
  for (const r of BRINGS) { if (r.age > 1) { r.m.visible = false; continue; } r.age += dt * 1.6; r.m.scale.setScalar(8 + r.age * 190); r.m.material.opacity = 0.8 * (1 - r.age); }
  if (state === 'play') { for (let k = 0; k < 2; k++) burst(toWorld(B.root.matrixWorld, (rand() - 0.5) * 70, (rand() - 0.45) * 190, (rand() - 0.5) * 40, bv1), 1, 5, true); }   // embers drift off it
  B.beatT += dt * (B.phase === 3 ? 1.1 : 0); if (B.beatT > 1 && B.phase === 3) { B.beatT = 0; shakeAmp = Math.max(shakeAmp, 2.2); }                                          // its heart thuds through the cockpit
  // ---- state
  if (intro) { if (B.t > 4.5) B.state = 'fight'; B.flash = 0.2 + 0.15 * Math.sin(B.t * 3); }
  else if (B.state === 'fight' && state === 'play') {
    B.atkT -= dt;
    if (!B.tele && B.atkT <= 0 && !B.beam && !(B.lunge && B.lunge.state === 'go')) { const list = ATTACKS[B.phase], kd = list[B.atkN++ % list.length]; B.tele = { kind: kd, t: TELE[kd] * (B.phase === 3 ? 0.8 : 1) }; }
    if (B.tele) { B.tele.t -= dt; B.flash = Math.abs(Math.sin(B.tele.t * 14)) * 0.9; if (B.tele.t <= 0) { const kd = B.tele.kind; bossAttack(kd); B.tele = null; B.atkT = CADENCE[B.phase] + (kd === 'hurl' || kd === 'censer' ? 0.5 : 0); B.flash = 0; } }
    else B.flash = Math.max(0, B.flash - dt * 3);
  } else if (B.state === 'dying') {
    B.dieT += dt; B.flash = 0.5 + 0.5 * Math.sin(B.dieT * 30); P.halo.rotation.z += dt * 4;
    if (rand() < dt * 18) { const p = toWorld(B.root.matrixWorld, (rand() - 0.5) * 60, (rand() - 0.3) * 160, (rand() - 0.5) * 30, new V3()); burst(p, 40, 22, true); ship.shake = Math.max(ship.shake, 0.4); }
    if (B.dieT > 3.2) { burst(B.pos, 200, 40, true); scene.remove(B.root); B = null; bossDone = true; darkTarget = 0; endGame('win'); return; }
  }
  for (const m of B.mats) m.uniforms.uFlash.value = Math.max(B.flash, B.heartFlash * 0.6, 0.1 * beat * (B.phase === 3 ? 1.5 : 0.6));
  // ---- queued shots (streams, halo rings)
  for (let i = B.timers.length - 1; i >= 0; i--) { const e = B.timers[i]; e.t -= dt; if (e.t <= 0) { B.timers.splice(i, 1); if (B.state === 'fight' && state === 'play') e.fn(); } }
  // ---- the beam: a thin red lock-on line, then a thick sweep
  if (B.beam && state === 'play') {
    const bm = B.beam, f = eyePos(bv1.set(0, 0, 0)).clone(); bm.t += dt;
    if (bm.state === 'warn') {                                                                   // the lock-on line follows you; at the moment of firing the sweep line is frozen
      const a = aimFrom(f), right = bv3.crossVectors(a, B.root.up).normalize(); bm.A.copy(a).addScaledVector(right, 0.42 * bm.sg).normalize(); bm.Bd.copy(a).addScaledVector(right, -0.42 * bm.sg).normalize();
      spawnBeamFrame(f, bm.A, 900, 0.3, true); B.flash = 0.5 + 0.4 * Math.sin(bm.t * 30); if (bm.t >= bm.warn) { bm.state = 'fire'; bm.t = 0; ship.shake = Math.max(ship.shake, 0.7); } }
    else {
      const u = Math.min(1, bm.t / bm.fire), dir = bv2.copy(bm.A).lerp(bm.Bd, u).normalize(); spawnBeamFrame(f, dir, 900, 3.4, false); ship.shake = Math.max(ship.shake, 0.25);
      tmp.subVectors(ship.pos, f); const along = tmp.dot(dir), perp = tmp.addScaledVector(dir, -along).length();
      if (perp < 7 && along > 0 && B.beamCd <= 0) { B.beamCd = 0.45; ship.hull -= 22; holoHit(ship.pos.clone().addScaledVector(dir, -5), 22); ship.shake = 1.1; ship.hurt = 1; say('BEAM. Hull -22. MOVE.', 1200); }
      if (bm.t >= bm.fire) B.beam = null;
    }
  }
  // ---- the lunge: it rushes you along a locked line
  if (B.lunge && B.lunge.state === 'go' && state === 'play') {
    const lg = B.lunge; lg.t += dt; B.flash = 0.7;
    if (!lg.hit && ship.pos.distanceTo(B.pos) < M(60) * B.root.scale.x) { lg.hit = true; ship.hull -= 35; holoHit(B.pos, 35); ship.shake = 1.6; ship.hurt = 1; ship.vel.addScaledVector(tmp.subVectors(ship.pos, B.pos).normalize(), 60); stopT = 0.2; say('CRUSHED. Hull -35.', 1600); }
    if (lg.t > 1.25) { B.lunge = null; B.offVel.multiplyScalar(0.2); }
  }
  // ---- projectiles
  for (let i = BP.length - 1; i >= 0; i--) {
    const p = BP[i]; p.life -= dt;
    if (p.kind === 'wisp' && !p.returned) { const want = bv1.subVectors(ship.pos, p.pos).normalize(), sp = p.vel.length(); p.vel.normalize().lerp(want, 1 - Math.exp(-dt * 1.7)).normalize().multiplyScalar(sp); }   // homing
    p.pos.addScaledVector(p.vel, dt); p.mesh.position.copy(p.pos); p.mesh.rotation.y += dt * 6;
    if (p.kind === 'shard' || p.kind === 'wisp') p.mesh.quaternion.setFromUnitVectors(bNull.set(0, 1, 0), bv1.copy(p.vel).normalize());
    p.flash = Math.max(0, p.flash - dt * 5); for (const m of p.mats) m.uniforms.uFlash.value = p.kind === 'wisp' ? 0.6 + 0.3 * Math.sin(B.t * 20) : p.flash;
    if (p.life <= 0 || p.pos.length() < R + 3) { killProj(p, false); continue; }
    if (p.returned) { if (returnedHits(p)) killProj(p, false); continue; }                   // a parried projectile flies back at the boss
    if (state === 'play' && p.pos.distanceTo(ship.pos) < p.radius + 3) { ship.hull -= p.dmg; holoHit(p.pos, p.dmg); ship.shake = 1; ship.hurt = 1; killProj(p, false); say(p.name + ' HIT. Hull -' + p.dmg + '. PARRY WITH F.', 1800); }
  }
}
function resetBoss() { if (B) scene.remove(B.root); B = null; darkTarget = 0; for (const p of BP) scene.remove(p.mesh); BP.length = 0; bossDone = false; }
