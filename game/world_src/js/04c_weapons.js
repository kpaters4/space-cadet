// ============================================================ weapons in real space, and the point of view
// The cannons are where the ship model says they are (see 03d_ship.js): the muzzles are 12.2 m ahead of the ship's origin and 3.9 m out to each side. The pilot's eye is 11 m behind them,
// so from the seat the muzzles sit about 19 degrees to each side of the nose and a few degrees below the horizon, and the barrels are FIXED, pointing along the ship's axis towards the
// vanishing point (they do not swing to the target). A shot is a bolt of light that leaves each muzzle and flies to the target as a real 3D object: fat near the muzzle, a thin streak far away.
const EYE_U = new V3(M(0), M(1.0), M(-1.1)).multiplyScalar(SHIP_K);                                            // the pilot's eye, in the ship model's frame
const MUZ_REL = [[-3.87, 0.26, -12.2], [3.87, 0.26, -12.2]].map(([x, y, z]) => new V3(M(x), M(y), M(z)).multiplyScalar(SHIP_K).sub(EYE_U));   // muzzles relative to the eye, in ship axes
const muzzleWorld = (i, out) => out.copy(MUZ_REL[i]).applyQuaternion(ship.q).add(ship.pos);
const shipOriginW = out => out.copy(EYE_U).negate().applyQuaternion(ship.q).add(ship.pos);   // where the ship model's origin is in the world
const BOLT_N = 48, BOLT_LEN = 22; let BOLT_SPEED = 1500;
const bolts = [], later = [];
const bPos = new Float32Array(BOLT_N * 12), bUv = new Float32Array(BOLT_N * 8), bKind = new Float32Array(BOLT_N * 4), bFade = new Float32Array(BOLT_N * 4);
const bGeo = new THREE.BufferGeometry(), bIdx = [];
for (let i = 0; i < BOLT_N; i++) { const b = i * 4; bIdx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3); for (let k = 0; k < 4; k++) { bUv[(b + k) * 2] = k % 2 ? 1 : -1; bUv[(b + k) * 2 + 1] = k < 2 ? 0 : 1; } }
bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3)); bGeo.setAttribute('aUv', new THREE.BufferAttribute(bUv, 2)); bGeo.setAttribute('aKind', new THREE.BufferAttribute(bKind, 1)); bGeo.setAttribute('aFade', new THREE.BufferAttribute(bFade, 1)); bGeo.setIndex(bIdx);
bGeo.setDrawRange(0, 0);
const bMesh = new THREE.Mesh(bGeo, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  vertexShader: 'attribute vec2 aUv; attribute float aKind; attribute float aFade; varying vec2 vUv; varying float vK; varying float vF; void main(){ vUv = aUv; vK = aKind; vF = aFade; gl_Position = projectionMatrix*viewMatrix*vec4(position,1.0); }',
  fragmentShader: `varying vec2 vUv; varying float vK; varying float vF;
    void main(){
      float across = abs(vUv.x), core = 1.0 - across, along = vUv.y;
      float a = (0.25 + 0.75 * pow(core, 1.4)) * mix(pow(along, 1.3), 1.0, min(vK, 1.0)) * vF;
      bool beam = vK > 1.5; vec3 hot = beam ? vec3(1.0, 0.05, 0.12) : vK > 0.5 ? vec3(0.12, 0.55, 1.0) : vec3(1.0, 0.22, 0.1), white = beam ? vec3(1.0, 0.8, 0.8) : vK > 0.5 ? vec3(0.9, 1.0, 1.0) : vec3(1.0, 0.95, 0.8);
      vec3 col = mix(hot, white, clamp(core * (0.35 + 0.65 * along) * 1.3, 0.0, 1.0));
      gl_FragColor = vec4(col * a, a);
    }` }));
bMesh.frustumCulled = false; scene.add(bMesh);
function spawnBeamFrame(o, dir, len, width, warn) { if (bolts.length >= BOLT_N) bolts.shift(); bolts.push({ o: o.clone(), d: dir.clone().normalize(), end: len, s: len, age: 0, beamFrame: true, w: width, warn }); }   // a boss beam: redrawn every frame
function spawnBolt(o, dir, end, lance) { if (bolts.length >= BOLT_N) bolts.shift(); bolts.push({ o: o.clone(), d: dir.clone().normalize(), end, s: 0, lance, age: 0 }); }
const bCam = new V3(), bHead = new V3(), bTail = new V3(), bSide = new V3();
function updateBolts(dt) {
  let n = 0;
  for (let i = bolts.length - 1; i >= 0; i--) { const b = bolts[i]; b.age += dt; b.s += (b.lance ? 9000 : BOLT_SPEED) * dt; if (b.beamFrame ? b.age > 0.001 : b.lance ? b.age > 0.3 : b.s - BOLT_LEN > b.end) bolts.splice(i, 1); }
  for (const b of bolts) {
    const head = Math.min(b.s, b.end), tail = (b.lance || b.beamFrame) ? 0 : Math.max(0, b.s - BOLT_LEN);
    bHead.copy(b.d).multiplyScalar(head).add(b.o); bTail.copy(b.d).multiplyScalar(tail).add(b.o);
    bCam.subVectors(bHead, camera.position); const dist = Math.max(1, bCam.length()); bSide.crossVectors(b.d, bCam).normalize();
    const fade = b.beamFrame ? (b.warn ? 0.45 : 1) : b.lance ? Math.max(0, 1 - b.age / 0.3) : 1, wH = b.beamFrame ? Math.max(b.w, dist * 0.007) : b.lance ? Math.max(0.35, dist * 0.026) * (0.4 + 0.6 * fade) : Math.max(0.1, dist * 0.0095), wT = wH * (b.lance || b.beamFrame ? 0.9 : 0.55);
    const w = [wT, wT, wH, wH], P3 = [bTail, bTail, bHead, bHead], sg = [-1, 1, -1, 1];
    for (let k = 0; k < 4; k++) { const j = (n * 4 + k) * 3; bPos[j] = P3[k].x + bSide.x * w[k] * sg[k]; bPos[j + 1] = P3[k].y + bSide.y * w[k] * sg[k]; bPos[j + 2] = P3[k].z + bSide.z * w[k] * sg[k]; bKind[n * 4 + k] = b.beamFrame ? 2 : b.lance ? 1 : 0; bFade[n * 4 + k] = fade; }
    n++;
  }
  bGeo.setDrawRange(0, n * 6); bGeo.attributes.position.needsUpdate = true; bGeo.attributes.aKind.needsUpdate = true; bGeo.attributes.aFade.needsUpdate = true;
}
function schedule(delay, fn) { later.push({ t: delay, fn }); }
function tickLater(dt) { for (let i = later.length - 1; i >= 0; i--) { const e = later[i]; e.t -= dt; if (e.t <= 0) { later.splice(i, 1); e.fn(); } } }
let hitFX = null;                                                                           // where the last bolt landed (drawn as a ring when it arrives)

// ---- the point of view: 0 cockpit (the seat), 1 chase (behind and above, the ship in view), 2 side (off the right wing, the cannons firing across the frame). Press C.
const POVS = ['COCKPIT', 'CHASE'], POV_OFF = [null, [0, 9, 30]].map(o => o && o.map(v => v * SHIP_K));       // camera offsets in metres from the ship origin, in ship axes
let povMode = 0; const povPos = new V3(), povLook = new V3();
const povShip = finishMesh(cachedMerge('sat|ship', SAT_PARTS.ship, true), U); povShip.grp.visible = false; scene.add(povShip.grp);
const flames = [[-3.0, -0.2, 10.0], [3.0, -0.2, 10.0], [0, 0.1, 10.6]].map(([x, y, z]) => { const m = new THREE.Mesh(new THREE.ConeGeometry(M(1.0 * SHIP_K), 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = Math.PI / 2; m.position.set(M(x * SHIP_K), M(y * SHIP_K), M(z * SHIP_K)); povShip.grp.add(m); return m; });
function applyPov() { camera.setViewOffset(W, H, 0, povMode === 0 ? H / 2 - AXIS_Y : 0, W, H); povShip.grp.visible = povMode !== 0; }
function setPov(m) { povMode = m; applyPov(); if (m) { shipOriginW(povPos); const o = POV_OFF[m]; povPos.add(new V3(M(o[0]), M(o[1]), M(o[2])).applyQuaternion(ship.q)); } say('View: ' + POVS[m], 1200); }
function placeCamera(dt) {
  updateFov(dt); const bank = clamp(-wY * 0.55, -0.5, 0.5);                      // bank: roll into the turn
  if (povMode === 0) { camera.position.copy(ship.pos); camera.quaternion.copy(ship.q); camera.rotateX(kickPitch); }
  else {
    const org = shipOriginW(povLook), o = POV_OFF[povMode], pull = 1 + 0.5 * clamp(ship.vel.length() / 66, 0, 1.1), want = new V3(M(o[0]), M(o[1] * (1 + 0.2 * (pull - 1))), M(o[2] * pull)).applyQuaternion(ship.q).add(org);   // it drops back as you speed up
    povPos.lerp(want, 1 - Math.exp(-dt * (4.5 + 3 * (pull - 1)))); camera.position.copy(povPos); camera.up.set(0, 1, 0).applyQuaternion(ship.q);
    camera.lookAt(povMode === 1 ? org.addScaledVector(new V3(0, 0, -1).applyQuaternion(ship.q), M(30 * SHIP_K)) : org);
    povShip.grp.position.copy(shipOriginW(bTail)); povShip.grp.quaternion.copy(ship.q).multiply(qa.setFromAxisAngle(AZ, bank));   // the ship rolls into the turn
    const thr = clamp(thrSm * 1.1 + 0.15 + ((boost || hold('shift')) ? 0.5 : 0), 0.1, 1.6); flames.forEach((f, i) => { const L = M((i === 2 ? 5 : 4) * SHIP_K) * thr; f.scale.y = L; f.position.z = M((i === 2 ? 10.6 : 10.0) * SHIP_K) + L / 2; f.material.opacity = 0.55 + 0.35 * Math.random(); });
  }
  camera.rotateZ(povMode ? bank * 0.32 : bank * 0.06);                          // lean into a turn: a lot in the chase view, a little from the seat
  if (ship.shake > 0 && !RM) { camera.position.add(tmp.set(randn(), randn(), randn()).multiplyScalar(ship.shake * 0.32)); camera.rotateZ(randn() * ship.shake * 0.005); }
}

// ---- the sonic blast: rings of compressed air rushing out of the muzzles in a widening cone
const RINGS = [], ringMat = () => new THREE.MeshBasicMaterial({ color: 0xe4efff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), ringMat()); m.visible = false; scene.add(m); RINGS.push({ m, s: -1, q: new Q4(), o: new V3() }); }
function spawnBlast() {
  const o = new V3(), a = new V3(); muzzleWorld(0, o); muzzleWorld(1, a); o.add(a).multiplyScalar(0.5);
  RINGS.forEach((r, k) => { r.s = -k * 28; r.q.copy(ship.q); r.o.copy(o); });
}
function updateRings(dt) {
  for (const r of RINGS) {
    if (r.s > 440) { r.m.visible = false; continue; }
    if (r.s === -1 && !r.m.visible) continue; r.s += 1250 * dt;
    if (r.s <= 0 || r.s > 440) { r.m.visible = r.s > 0 && r.s <= 440; continue; }
    r.m.visible = true; r.m.quaternion.copy(r.q); r.m.position.copy(r.o).addScaledVector(tmp.set(0, 0, -1).applyQuaternion(r.q), r.s); const rad = 0.5 + r.s * 0.2; r.m.scale.setScalar(rad); r.m.material.opacity = 0.85 * (1 - r.s / 440);
    r.m.geometry.dispose && 0;
  }
}

// ---- the sense of speed: dust drifting in the void is invisible until you move; then it streaks past, longer the faster you go
const DUST_N = 300, DUST_R = 75, dust = new Float32Array(DUST_N * 3), dustLine = new Float32Array(DUST_N * 6), dGeo = new THREE.BufferGeometry();
for (let i = 0; i < DUST_N; i++) { const v = new V3(randn(), randn(), randn()).normalize().multiplyScalar(DUST_R * Math.cbrt(rand())); dust[i * 3] = ship.pos.x + v.x; dust[i * 3 + 1] = ship.pos.y + v.y; dust[i * 3 + 2] = ship.pos.z + v.z; }
dGeo.setAttribute('position', new THREE.BufferAttribute(dustLine, 3));
const dMat = new THREE.LineBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), dMesh = new THREE.LineSegments(dGeo, dMat); dMesh.frustumCulled = false; scene.add(dMesh);
const speedFrac = () => clamp(ship.vel.length() / 66, 0, 1.15);
function updateDust(dt) {
  const sp = ship.vel.length(), f = speedFrac(), len = 0.03 + f * 0.09; dMat.opacity = clamp((sp - 5) / 40, 0, 0.85);
  const fw = tmp.set(0, 0, -1).applyQuaternion(ship.q);
  for (let i = 0; i < DUST_N; i++) {
    let dx = dust[i * 3] - ship.pos.x, dy = dust[i * 3 + 1] - ship.pos.y, dz = dust[i * 3 + 2] - ship.pos.z;
    if (dx * dx + dy * dy + dz * dz > DUST_R * DUST_R) {                                  // left the cloud: reappear on the far side, biased ahead of where you are going
      const v = new V3(randn(), randn(), randn()).normalize(); if (sp > 3 && v.dot(ship.vel) < 0) v.negate(); const r = DUST_R * (0.7 + 0.3 * rand());
      dust[i * 3] = ship.pos.x + v.x * r; dust[i * 3 + 1] = ship.pos.y + v.y * r; dust[i * 3 + 2] = ship.pos.z + v.z * r; dx = v.x * r; dy = v.y * r; dz = v.z * r;
    }
    const x = dust[i * 3], y = dust[i * 3 + 1], z = dust[i * 3 + 2];
    dustLine[i * 6] = x; dustLine[i * 6 + 1] = y; dustLine[i * 6 + 2] = z; dustLine[i * 6 + 3] = x + ship.vel.x * len; dustLine[i * 6 + 4] = y + ship.vel.y * len; dustLine[i * 6 + 5] = z + ship.vel.z * len;   // the streak trails behind its motion relative to you
  }
  void fw; dGeo.attributes.position.needsUpdate = true;
}

// ---- the zoom: a spring on the field of view. It widens as you speed up and as you accelerate, kicks wider when you hit the boost, and on braking it snaps back past where it started and settles
// (the spring is slightly under-damped, so deceleration feels like the world rushing in). From the seat the swing is smaller; the cockpit art is drawn for 62 degrees and the guns re-project with FOCAL.
const fovS = { v: 62, vel: 0, prevSp: 0, aSm: 0, kick: 0 };
function updateFov(dt) {
  if (dt <= 0) return;
  const sp = ship.vel.length(), a = (sp - fovS.prevSp) / dt; fovS.prevSp = sp; fovS.aSm += (clamp(a, -120, 120) - fovS.aSm) * (1 - Math.exp(-dt * 6)); fovS.kick *= Math.exp(-dt * 3.5);
  const f = clamp(sp / 66, 0, 1.1), amp = povMode ? 15 : 9, target = 62 + amp * f + clamp(fovS.aSm * (povMode ? 0.15 : 0.1), -7, 9) + fovS.kick;
  fovS.vel += ((target - fovS.v) * 42 - fovS.vel * 7.5) * dt; fovS.v = clamp(fovS.v + fovS.vel * dt, 50, 92);
  if (Math.abs(camera.fov - fovS.v) > 0.02) { camera.fov = fovS.v; camera.updateProjectionMatrix(); FOCAL = (H / 2) / Math.tan(camera.fov * D2R / 2); }
}

// ---- the headlamp: in the dark the ship throws a cone of light ahead, and you can see it as a faint beam. L cycles AUTO (on in Earth's shadow and in the boss's eclipse), ON, OFF.
let lampMode = 0, lampI = 0, darkTarget = 0;
const lampCone = new THREE.Mesh(new THREE.ConeGeometry(260 * Math.tan(0.2), 260, 28, 1, true).translate(0, -130, 0).rotateX(Math.PI / 2), new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  uniforms: { uOn: { value: 0 } }, vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vP; void main(){ vUv = uv; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vP = mv.xyz; gl_Position = projectionMatrix*mv; }',
  fragmentShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vP; uniform float uOn; void main(){ float t = 1.0 - vUv.y; float edge = pow(abs(dot(normalize(vN), normalize(-vP))), 1.3); float a = pow(1.0 - t, 1.7) * 0.2 * edge * uOn; gl_FragColor = vec4(vec3(1.0, 0.95, 0.8) * a, a); }' }));
lampCone.frustumCulled = false; lampCone.visible = false; scene.add(lampCone);
function updateLamp(dt) {
  const L = U.uSun.value, s = ship.pos.dot(L), inShadow = s < 0 && tmp.copy(ship.pos).addScaledVector(L, -s).length() < R ? 1 : 0;
  U.uDark.value += (darkTarget - U.uDark.value) * (1 - Math.exp(-dt * 1.2));
  const want = lampMode === 1 ? 1 : lampMode === 2 ? 0 : (inShadow || U.uDark.value > 0.25) ? 1 : 0;
  lampI += (want - lampI) * (1 - Math.exp(-dt * 3));
  const flick = (B && B.tele && Math.random() < 0.35) || (ship.hull < 30 && Math.random() < 0.12) ? 0.25 : 1;                 // it gutters when the boss draws near or the hull is failing
  const on = lampI * flick; U.uLampOn.value = on;
  const o = tmp.set(0, 0, 0); muzzleWorld(0, o); const a = new V3(); muzzleWorld(1, a); o.add(a).multiplyScalar(0.5); U.uLampP.value.copy(o); U.uLampD.value.set(0, 0, -1).applyQuaternion(ship.q);
  lampCone.visible = on > 0.03; lampCone.position.copy(o); lampCone.quaternion.copy(ship.q); lampCone.material.uniforms.uOn.value = on;
}
