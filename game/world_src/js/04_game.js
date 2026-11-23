// ============================================================ game state and rules
const HORIZON_S = 252, FALL_DUR = 30, GRACE = 70;       // seconds: mission horizon, final spiral to Earth, launch grace
const HOME = S0h.clone().multiplyScalar(r0);            // the cloud and the ship live here in the orbiting frame
const ship = { pos: HOME.clone(), vel: new V3(), q: new Q4(), hull: 100, heat: 0, over: false, shake: 0, hurt: 0 };
const st = { x: 0, y: 0 };                               // joystick deflection, -1..1 (y up = nose up)
const keys = {}; let drag = null, firing = false, boost = false, cool = 0, beamT = 0, earthFlash = 0, thrSm = 0, kickPitch = 0, flashT = -1e9, impactFX = null;
const beamEnd = new V3();
const K = { tilt: 0, pitch: 0, recoil: 0, hatT: -1e9, hatDir: 0, hover: '', goT: -1e9 };   // pilot animation state
let lvlCard = null, bossWait = -1;                                   // the title card on screen, and the pause between clearing level 1 and the boss arriving
const showCard = (n, title, sub, ms) => { lvlCard = { n, title, sub, t: performance.now(), ms: ms || 3800 }; };
let state = 'brief', tG = 0, P = [], total = 0, shotN = 0, uid = 0, pinned = null, aim = null, aimSky = null, msg = { text: '', t: -1e9, ms: 3000 };
let coinsRun = 0, coinsBank = 0, result = null, friendlyT = 0;
try { coinsBank = (JSON.parse(localStorage.getItem('spacecadet.world.v1') || '{}') || {}).coins | 0; } catch (e) { coinsBank = 0; }
const bank = () => { try { localStorage.setItem('spacecadet.world.v1', JSON.stringify({ coins: coinsBank })); } catch (e) { /* storage unavailable */ } };
const say = (text, ms) => { msg = { text, t: performance.now(), ms: ms || 3200 }; $('status').textContent = text; };
const hold = k => !!keys[k];

function spawn(o) {
  const S = SIZES[o.size], posIn = o.posIn.clone(), r = posIn.length(), seed = o.seed || (rand() * 1e6 | 0);
  const n = new V3().crossVectors(posIn, o.velDir).normalize(), u = posIn.clone().normalize(), v = new V3().crossVectors(n, u).normalize();
  const built = buildMesh(o.type, o.size, seed, U, o.name);
  const p = { id: ++uid, name: o.name, type: o.type, size: o.size, S, radius: S.r, hp: S.hp, n, u, v, r0: r, r, phi: 0, off: new V3(), offVel: o.offVel || new V3(),
    t0: tG, remS0: o.remS0, tFall: o.remS0 > HORIZON_S ? Infinity : tG + o.remS0, noise: o.noise !== undefined ? o.noise : randn(), perigee: o.perigee, seed,
    flash: 0, posIn, pos: new V3(), vel: new V3(), prev: new V3(), alive: true, spin: new V3(randn(), randn(), randn()).multiplyScalar(0.5), mesh: built.grp, mats: built.mats };
  built.grp.scale.setScalar(S.r); scene.add(built.grp); P.push(p); total++;
  placePiece(p, 0); return p;
}
function startGame() {
  resetBoss(); holoReset(); lvlCard = null; bossWait = -1; weapon = 'pulse'; charge = 0;
  for (const p of P) scene.remove(p.mesh);
  P = []; total = 0; shotN = 0; tG = 0; coinsRun = 0; result = null; pinned = null; impactFX = null;
  ship.pos.copy(HOME); ship.vel.set(0, 0, 0); ship.hull = 100; ship.heat = 0; ship.over = false; ship.shake = 0; ship.hurt = 0; thrSm = 0;
  const back = T0h.clone().negate(), right = new V3().crossVectors(T0h, S0h);
  ship.q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, S0h, back));
  ship.q.multiply(qa.setFromAxisAngle(AX, -0.22));          // look a little down so the limb of the Earth sits in the lower third
  for (const [name, type, size, perigee, , reenters, days] of DATA) {
    const radial = (perigee - 790) / 10, hero = type === 'PAYLOAD';
    const along = hero ? (/IRIDIUM/.test(name) ? 105 : 150) : clamp(randn() * 95, -230, 230), cross = hero ? (/IRIDIUM/.test(name) ? -22 : 38) : clamp(randn() * 55, -130, 130);
    const posIn = new V3().copy(S0h).multiplyScalar(r0 + radial).addScaledVector(T0h, along).addScaledVector(N0, cross).setLength(r0 + radial);
    const nT = N0.clone().add(new V3(randn(), randn(), randn()).multiplyScalar(0.012)).normalize();
    const life = reenters ? (days == null ? 30 + rand() * 270 : days) : 400 + rand() * 800;
    const velDir = new V3().crossVectors(nT, posIn).normalize(), qi = qInv.copy(envQ).invert();    // the orbiting frame has kept turning since page load, so undo it: the cloud must start around the ship
    spawn({ name, type, size, perigee, posIn: posIn.applyQuaternion(qi), velDir: velDir.applyQuaternion(qi), remS0: GRACE + life * 0.5 });
  }
  placeNearSats(); ALIVE = P.filter(p => p.alive);
  state = 'play'; msg.t = -1e9;
}
let ALIVE = [];                                                   // refreshed once per frame
const alive = () => ALIVE;
const daysOf = p => Math.max(1, (p.remS0 - GRACE) * 2);
const modelP = p => 1 / (1 + Math.exp(-((Math.log10(365) - (Math.log10(daysOf(p)) + p.noise * 0.3)) / 0.25)));

function killPiece(p, byShot) {
  p.alive = false; scene.remove(p.mesh); burst(p.pos, 26, 14, true);
  if (pinned === p) pinned = null;
  if (!byShot) return;
  shotN++; coinsRun += p.S.coin;
  const remS = Math.max(8, p.remS0 - (tG - p.t0)), tan = new V3().copy(p.u).multiplyScalar(-Math.sin(p.phi)).addScaledVector(p.v, Math.cos(p.phi));
  for (const kind of KIDS[p.size]) {
    const vd = tan.clone().add(new V3(randn(), randn(), randn()).multiplyScalar(0.05)).normalize();
    const c = spawn({ name: /DEB$/.test(p.name) ? p.name : p.name + ' DEB', type: p.type === 'PAYLOAD' ? 'DEBRIS' : p.type, size: kind, perigee: p.perigee, posIn: p.posIn.clone(), velDir: vd,
      offVel: new V3(randn(), randn(), randn()).normalize().multiplyScalar(5 + rand() * 7), remS0: kind === 'SHARD' ? 40 + rand() * 50 : Math.max(14, remS * 0.35), noise: p.noise * 0.7 + randn() * 0.3 });
    c.pos.copy(p.pos); c.mesh.position.copy(p.pos);
  }
}
function impact(p) {
  burst(p.pos, 90, 20, true); impactFX = { pos: p.pos.clone(), t: performance.now() };
  p.alive = false; scene.remove(p.mesh); if (pinned === p) pinned = null;
  if (p.S.dmg > 0) { ship.hull -= p.S.dmg; holoHit(null, p.S.dmg); earthFlash = 1; ship.shake = Math.max(ship.shake, 0.6); say('IMPACT. ' + p.name + ' hit the Earth. Hull -' + p.S.dmg); }
  else say('A shard burned up in the atmosphere.');
}

// ---- particles (world space)
const NP = 700, pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP);
const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const pMat = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const pts = new THREE.Points(pGeo, pMat); pts.frustumCulled = false; scene.add(pts);
let pIdx = 0;
function burst(at, n, speed, hot) {
  for (let k = 0; k < n; k++) {
    const i = pIdx++ % NP, d = new V3(randn(), randn(), randn()).normalize().multiplyScalar(speed * (0.3 + rand()));
    pPos.set([at.x, at.y, at.z], i * 3); pVel.set([d.x, d.y, d.z], i * 3); pLife[i] = 0.5 + rand() * 0.8;
    pCol.set(hot ? [1, 0.55 + rand() * 0.3, 0.15] : [1, 0.9, 0.6], i * 3);
  }
}
function stepParticles(dt) {
  for (let i = 0; i < NP; i++) {
    if (pLife[i] <= 0) { pCol[i * 3] = pCol[i * 3 + 1] = pCol[i * 3 + 2] = 0; continue; }
    pLife[i] -= dt; for (let c = 0; c < 3; c++) { pPos[i * 3 + c] += pVel[i * 3 + c] * dt; pCol[i * 3 + c] *= 0.96; }
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}

// ---- per-frame update
function placePiece(p, dt) {
  p.prev.copy(p.pos); p.posIn.copy(p.u).multiplyScalar(Math.cos(p.phi) * p.r).addScaledVector(p.v, Math.sin(p.phi) * p.r);
  p.off.addScaledVector(p.offVel, dt); p.offVel.multiplyScalar(Math.exp(-0.9 * dt));
  p.pos.copy(p.posIn).applyQuaternion(envQ).add(p.off);
  if (dt > 0) p.vel.subVectors(p.pos, p.prev).divideScalar(dt);
  p.mesh.position.copy(p.pos); p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt; p.mesh.rotation.z += p.spin.z * dt;
  p.flash = Math.max(0, p.flash - dt * 5); for (const m of p.mats) m.uniforms.uFlash.value = p.flash;
}
function updatePiece(p, dt) {
  const start = p.tFall - FALL_DUR;
  if (tG > start) { const f = Math.min(1, (tG - start) / FALL_DUR); p.r = lerp(p.r0, R + 1.2, f * f * 0.6 + f * 0.4); }
  p.phi += Math.sqrt(GM / (p.r * p.r * p.r)) * dt; placePiece(p, dt);
  if (p.r <= R + 2.5) { impact(p); return; }
  if (tmp.subVectors(p.pos, ship.pos).length() < p.radius * 1.1 + 2.5) {
    const dmg = Math.max(2, Math.round(p.S.dmg * 0.8)); ship.hull -= dmg; holoHit(p.pos, dmg); ship.shake = 1; ship.hurt = 1; killPiece(p, false); say('Collision. Hull -' + dmg, 1800);
  }
}
function skyOccluded(dirW) { const b = ship.pos.dot(dirW), c = ship.pos.lengthSq() - R * R, disc = b * b - c; return b < 0 && disc > 0; }
function update(dt, now) {
  if (stopT > 0) { stopT -= dt; dt *= 0.2; }                       // hit-stop: a parry freezes the world for a beat
  U.uTime.value = now / 1000; updateEnv(dt); const IN = readInput(dt);
  const kx = (hold('arrowright') ? 1 : 0) - (hold('arrowleft') ? 1 : 0), ky = (hold('arrowup') ? 1 : 0) - (hold('arrowdown') ? 1 : 0);
  const tx = drag ? drag.x : clamp(kx + IN.x, -1, 1), ty = drag ? drag.y : clamp(ky + IN.y, -1, 1);
  const smK = drag ? 12 : (tx === 0 && ty === 0 ? 4.2 : 6); st.x += (tx - st.x) * (1 - Math.exp(-dt * smK)); st.y += (ty - st.y) * (1 - Math.exp(-dt * smK));
  const roll = clamp((hold('e') ? 1 : 0) - (hold('q') ? 1 : 0) + (hold('d') ? 1 : 0) - (hold('a') ? 1 : 0) + IN.roll, -1, 1), thrIn = clamp((hold('w') ? 1 : 0) - (hold('s') ? 0.6 : 0) + IN.thr, -0.6, 1);
  thrSm += (thrIn * (thrIn < 0 ? 0.83 : 1) - thrSm) * Math.min(1, dt * 6);
  if (state === 'play') {
    tG += dt;
    const rateK = assist ? 1 - 0.38 * clamp(ship.vel.length() / 66, 0, 1) : 1; wX += (st.y * 0.9 * rateK - wX) * (1 - Math.exp(-dt * 7)); wY += (st.x * 1.0 * rateK - wY) * (1 - Math.exp(-dt * 7)); wZ += (roll * 1.4 - wZ) * (1 - Math.exp(-dt * 5.5));   // angular velocity eases toward the stick
    qa.setFromAxisAngle(AX, wX * dt); ship.q.multiply(qa);
    qa.setFromAxisAngle(AY, -wY * dt); ship.q.multiply(qa);
    qa.setFromAxisAngle(AZ, -wZ * dt); ship.q.multiply(qa);
    if (assist && Math.abs(roll) < 0.05) {                                  // stabiliser: with no roll input the ship levels itself to the horizon, so it never drifts onto its side
      tmp.copy(ship.pos).normalize(); const rt = new V3(1, 0, 0).applyQuaternion(ship.q), fw = new V3(0, 0, -1).applyQuaternion(ship.q), err = rt.dot(tmp);
      if (Math.abs(fw.dot(tmp)) < 0.92) { qa.setFromAxisAngle(AZ, -clamp(err * 1.6, -0.9, 0.9) * dt); ship.q.multiply(qa); }
    }
    ship.q.normalize();
    fwdV.set(0, 0, -1).applyQuaternion(ship.q);
    const bst = boost || hold('shift') || IN.boost, thr = thrIn;
    if (bst && !prevBst) { fovS.kick = 9; shakeAmp = Math.max(shakeAmp, 2); ship.vel.addScaledVector(fwdV, 6); }       // boost kick, like hitting the nitro
    prevBst = bst;
    ship.vel.addScaledVector(fwdV, thr * (bst ? 50 : 26) * dt);
    ship.vel.multiplyScalar(Math.exp(-(thr ? 0.12 : 0.55) * dt));
    if (assist) {                                                           // flight assist: the ship goes where the nose points. Sideways drift is bled off, so the velocity swings round with you and never slides away from the view
      const along = ship.vel.dot(fwdV); tmp.copy(ship.vel).addScaledVector(fwdV, -along);
      ship.vel.addScaledVector(tmp, -(1 - Math.exp(-dt * (thr > 0.2 || bst ? 4.5 : 1.6))));
    }
    const maxV = bst ? 66 : 36; if (ship.vel.length() > maxV) ship.vel.setLength(maxV);
    ship.pos.addScaledVector(ship.vel, dt);
    const dist = ship.pos.length(), alt = dist - R;
    if (alt < 22) { ship.hull -= 10 * dt; ship.hurt = 1; ship.vel.addScaledVector(tmp.copy(ship.pos).normalize(), 50 * dt); if (alt < 12) ship.pos.setLength(R + 12); if (rand() < dt * 2) say('Too low. The atmosphere is burning the hull.', 1500); }
    if (alt > 170) ship.vel.addScaledVector(tmp.copy(ship.pos).normalize(), -30 * dt);
    const away = tmp.subVectors(HOME, ship.pos), off = away.length();
    if (off > 430) { ship.vel.addScaledVector(away.normalize(), 40 * dt); if (rand() < dt * 1.5) say('Leaving the mission area. Turn back.', 1500); }
    cool -= dt; ship.heat = Math.max(0, ship.heat - dt * (ship.over ? 0.28 : 0.38)); if (ship.over && ship.heat < 0.4) ship.over = false;
    const trig = firing || hold(' ') || IN.fire; updateParry(dt);
    if (weapon === 'pulse') { charge = 0; if (trig && cool <= 0 && !ship.over && parry.win <= 0) fire(false); }
    else if (trig && !ship.over && cool <= 0 && parry.win <= 0) charge = Math.min(1.2, charge + dt);
    else { if (charge >= 0.7 && !ship.over && cool <= 0) fire(true); charge = 0; }
    for (const p of P) if (p.alive) updatePiece(p, dt);
    P = P.filter(p => p.alive || p.mesh.parent); ALIVE = P.filter(p => p.alive);
    if (ship.hull <= 0) { ship.hull = 0; endGame('dead'); } else if (ALIVE.length === 0 && !B) {
      if (bossDone) endGame('win');
      else {                                                            // level 1 is clear: a breath, then LEVEL 2, the boss
        if (bossWait < 0) { bossWait = 3.6; showCard('LEVEL 1 CLEAR', 'DEBRIS CLOUD NEUTRALISED', 'SOMETHING ANSWERS FROM THE DARK', 3400); }
        bossWait -= dt; if (bossWait <= 0) { bossWait = -1; spawnBoss(); showCard('LEVEL 2', 'THE KESSLER RELIQUARY', 'IT HAS BEEN WAITING', 4200); }
      }
    }
  } else { for (const p of P) if (p.alive) { p.phi += Math.sqrt(GM / (p.r * p.r * p.r)) * dt; placePiece(p, dt); } ALIVE = P.filter(p => p.alive); }
  computeThreats(); updateDust(dt); updateLamp(dt); if (state === 'play') updateBoss(dt); updateBolts(dt); updateRings(dt); if (state === 'play') tickLater(dt);
  updateSats(dt);
  ship.hurt = Math.max(0, ship.hurt - dt * 2); earthFlash = Math.max(0, earthFlash - dt * 1.6); ship.shake = Math.max(0, ship.shake - dt * 1.4);
  friendlyT = Math.max(0, friendlyT - dt); K.recoil = Math.max(0, K.recoil - dt * 7); kickPitch *= Math.exp(-dt * 10); beamT = Math.max(0, beamT - dt);
  stepParticles(dt);
  placeCamera(dt);
  camera.updateMatrixWorld(true);
  // what is under the reticle: debris first, then a planet / the Moon / the Sun
  fwdV.set(0, 0, -1).applyQuaternion(ship.q); aim = null; aimSky = null; let best = 1e9;
  for (const p of P) if (p.alive) { tmp.subVectors(p.pos, ship.pos); const d = tmp.length(), ang = Math.acos(clamp(tmp.dot(fwdV) / d, -1, 1)); if (ang < 0.09 && d < 800 && d < best) { best = d; aim = p; } }
  if (!aim) { let bs = 1e9; for (const s of SATS) { tmp.subVectors(s.pos, ship.pos); const d = tmp.length(), ang = Math.acos(clamp(tmp.dot(fwdV) / d, -1, 1)), lim = s.marker ? 0.03 : 0.09; if (ang < lim && d < (s.marker ? 9000 : 800) && d < bs) { bs = d; aim = s; } } }
  if (!aim) { let ba = 0.05; for (const b of bodies) { const a = Math.acos(clamp(b.dirW.dot(fwdV), -1, 1)); if (a < ba && !skyOccluded(b.dirW)) { ba = a; aimSky = b; } } }
  vduSet(aim || pinned || aimSky);
}
// ---- weapons. PULSE: rapid single beam, low heat. LANCE (X to switch): hold to charge, release to fire a piercing beam that does 5 damage to everything on the line, and heats the guns hard.
let weapon = 'pulse', charge = 0, beamLance = false, blastT = -1e9, shakeAmp = 0;
function fire(lance) {
  const dmg = lance ? 5 : 1, coneK = lance ? 0.2 : 0.012, maxT = lance ? 420 : 650;
  if (lance) { ship.heat += 0.5; cool = 0.5; } else { cool = 0.16; ship.heat += 0.07; }
  if (ship.heat >= 1) { ship.over = true; say('Weapon overheated.', 1500); }
  fwdV.set(0, 0, -1).applyQuaternion(ship.q); const hits = [];
  for (const p of P) {
    if (!p.alive) continue;
    tmp.subVectors(p.pos, ship.pos); const t = tmp.dot(fwdV); if (t < 4 || t > maxT) continue;
    const d = tmp.addScaledVector(fwdV, -t).length(); if (d < p.radius * 1.25 + t * coneK) hits.push({ t, o: p, piece: true });
  }
  let fallback = null;
  for (const o of bossHittables()) {                                  // boss parts: the body only counts when nothing else on the line is hit
    tmp.subVectors(o.pos, ship.pos); const t = tmp.dot(fwdV); if (t < 4 || t > maxT) continue;
    const d = tmp.addScaledVector(fwdV, -t).length(); if (d < o.radius * 1.25 + t * coneK) { if (o === hBody) fallback = { t, o }; else hits.push({ t, o }); }
  }
  if (!hits.length && fallback) hits.push(fallback);
  hits.sort((x, y) => x.t - y.t);
  let ht = 650, friend = null;
  for (const s of SATS) { if (s.marker) continue; tmp.subVectors(s.pos, ship.pos); const t = tmp.dot(fwdV); if (t < 4 || t > ht) continue; const d = tmp.addScaledVector(fwdV, -t).length(); if (d < s.radius * 1.25 + t * 0.012) { friend = s; ht = t; } }
  const reach = friend ? ht : 650, used = hits.filter(h => h.t < reach), first = used[0];
  const strike = lance ? used.slice(0, 14) : (first ? [first] : []);
  beamLance = !!lance; beamEnd.copy(ship.pos).addScaledVector(fwdV, lance ? (friend ? Math.min(ht, 420) : 420) : first ? first.t : friend ? ht : 650);
  beamT = lance ? 0.3 : 0.14; K.recoil = lance ? 3 : 1; kickPitch += lance ? 0.035 : 0.007; ship.shake = Math.max(ship.shake, lance ? 1.1 : 0.1); if (lance) { blastT = performance.now(); shakeAmp = 6; } flashT = performance.now();
  const mw = new V3(), dirv = new V3();
  if (lance) spawnBlast(); else for (let i = 0; i < 2; i++) { muzzleWorld(i, mw); dirv.subVectors(beamEnd, mw); const end = dirv.length(); spawnBolt(mw, dirv, end, false); }   // pulse: two real bolts, one from each muzzle
  const flight = lance ? 0.12 : muzzleWorld(0, mw).distanceTo(beamEnd) / BOLT_SPEED, endPos = beamEnd.clone();
  schedule(flight, () => {                                              // the damage lands when the bolt does
    hitFX = { pos: endPos, t: performance.now(), lance: !!lance };
    if (friend && friendlyT <= 0 && (lance || !first)) { friendlyT = 1.2; ship.hull -= 12; holoHit(null, 12); ship.hurt = 1; ship.shake = Math.max(ship.shake, 0.5); friend.flash = 1; coinsRun = Math.max(0, coinsRun - 20); say('FRIENDLY FIRE on ' + friend.name + '. Hull -12, coins -20.', 2600); burst(friend.pos, 10, 6, false); }
    for (const h of strike) {
      const dd = lance ? Math.max(1, Math.round(dmg * (1 - h.t / 560))) : dmg;
      if (h.piece) { const p = h.o; if (!p.alive) continue; p.hp -= dd; p.flash = 1; if (lance) { p.offVel.addScaledVector(fwdV, 18).add(new V3(randn(), randn(), randn()).multiplyScalar(4)); } burst(p.pos, lance ? 18 : 6, lance ? 12 : 8, false); if (p.hp <= 0) killPiece(p, true); }   // the blast also shoves what it does not break
      else if (B) h.o.hit(dd);
    }
  });
}
function endGame(kind) {
  const pct = total ? shotN / total : 0, bonus = kind === 'win' ? (pct >= 0.999 ? 60 : Math.round(pct * 30)) : 0;
  coinsBank += coinsRun + bonus; bank();
  result = { kind, pct, shot: shotN, total, coins: coinsRun, bonus, hull: Math.round(ship.hull) };
  state = kind; firing = false; boost = false;
}
function cyclePinned(d) {                                             // threats first, most urgent first, then the rest by distance
  const rank = p => { const i = threatOf(p); return i < 0 ? 1e6 + p.pos.distanceTo(ship.pos) : i; };
  const l = alive().slice().sort((a, b) => rank(a) - rank(b)); if (!l.length) return;
  const i = l.indexOf(pinned); pinned = l[(i + d + l.length) % l.length]; K.hatDir = d; K.hatT = performance.now();
}
