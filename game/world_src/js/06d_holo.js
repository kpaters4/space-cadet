// ============================================================ dash holo projector
// An emitter puck on the dash lip (drawn in 05a) casts a hologram of the ASTRA-9 into the left window. The hologram is the real ship model, split into sections, each lit by its own state:
//   guns: cyan -> amber -> red with heat, white pulse while the lance charges, red blink when overheated   engines: amber with thrust, white on boost
//   hull, canopy, vanes, fins: cyan when sound, amber then red as hits accumulate on that side; a hit flashes the section that took it (front, back, left or right)
// H flips it between the exterior and the cutaway (pilot, reactor core, tanks, gold feed to the cannons). Below 30% hull the projection stutters.
const HOLO = { x: 10, y: 174, w: 100, h: 56 }, HOLO_C = { x: 60, y: 226 };            // window rectangle, and the puck's centre
const holoScene = new THREE.Scene(), holoCam = new THREE.PerspectiveCamera(26, HOLO.w / HOLO.h, 0.5, 200);
let holoMode = 0, holoT = 0, holoGlitch = 0;                                           // 0 exterior, 1 cutaway
const HOLO_DMG = {}, HOLO_FLASH = {};                                                  // per-section damage (0..1) and hit-flash timers
const HC = { ok: new THREE.Color(0x58d6ff), dim: new THREE.Color(0x2a7fa8), warn: new THREE.Color(0xffd36b), bad: new THREE.Color(0xff5a4d), hot: new THREE.Color(0xff8a3a), white: new THREE.Color(0xffffff), green: new THREE.Color(0x5cffa0), gold: new THREE.Color(0xffd060) };
const holoFillMat = () => new THREE.ShaderMaterial({
  uniforms: { uCol: { value: new THREE.Color(0x58d6ff) }, uA: { value: 1 }, uT: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vP = mv.xyz; gl_Position = projectionMatrix*mv; }',
  fragmentShader: `varying vec3 vN; varying vec3 vP; uniform vec3 uCol; uniform float uA, uT;
    void main(){
      vec3 n = normalize(vN); float rim = pow(1.0 - abs(dot(n, normalize(-vP))), 1.5); float lit = 0.5 + 0.5 * dot(n, normalize(vec3(0.3, 0.8, 0.5)));
      float scan = 0.55 + 0.45 * step(0.5, fract(gl_FragCoord.y * 0.5 + uT * 0.7));
      float a = (0.06 + 0.34 * lit + 0.3 * rim) * scan * uA;
      gl_FragColor = vec4(uCol * a * 1.5, a);
    }` });
function holoBuild(kind) {
  const secs = kind === 0 ? SHIP_SEC() : shipCutSections(), root = new THREE.Group(), spin = new THREE.Group(), out = { root, spin, secs: {} };
  for (const name in secs) {
    const m = mergeParts(secs[name], true), fill = holoFillMat(), line = new THREE.LineBasicMaterial({ color: 0x58d6ff, transparent: true, opacity: 0.9 });
    spin.add(new THREE.Mesh(m.g, fill)); if (m.eg) spin.add(new THREE.LineSegments(m.eg, line));
    out.secs[name] = { fill, line, col: new THREE.Color(0x58d6ff) };
  }
  const box = new THREE.Box3().setFromObject(spin), sph = box.getBoundingSphere(new THREE.Sphere()); spin.position.copy(sph.center).multiplyScalar(-1);
  root.add(spin); root.userData.r = sph.radius; holoScene.add(root); root.visible = false; return out;
}
const holoObjs = [holoBuild(0), holoBuild(1)];
{ const r = holoObjs[0].root.userData.r, d = r / Math.sin(holoCam.fov * D2R / 2) * 0.8; holoCam.position.set(0, d * 0.8, d * 0.6); holoCam.lookAt(0, 0, 0); }

// ---- what each section shows right now
const sev = d => d >= 0.45 ? HC.bad : d >= 0.2 ? HC.warn : HC.ok;
function holoColor(name, out, t) {
  const blink = Math.floor(t / 160) % 2, dmg = Math.max(HOLO_DMG[name] || 0, name === 'hull' ? (1 - ship.hull / 100) * 0.8 : 0);
  if (HOLO_FLASH[name] > 0 && blink) return out.copy(HC.bad);
  if (name === 'gunL' || name === 'gunR') {
    if (ship.over) return out.copy(blink ? HC.bad : HC.dim);
    if (charge > 0.05) return out.copy(blink ? HC.white : HC.ok);
    const h = ship.heat; return out.copy(h > 0.7 ? HC.bad : h > 0.4 ? HC.warn : sev(dmg)).lerp(HC.white, 0);
  }
  if (name === 'engL' || name === 'engR' || name === 'engC') { const boosting = boost || hold('shift'); if (boosting) return out.copy(HC.white); return out.copy(sev(dmg)).lerp(HC.hot, clamp(thrSm * 1.2, 0, 1) * 0.85); }
  if (name === 'reactor') return out.copy(ship.heat > 0.7 ? HC.bad : ship.heat > 0.4 ? HC.warn : HC.hot);
  if (name === 'tanks') return out.copy(HC.ok).lerp(HC.hot, clamp(thrSm, 0, 1) * 0.6);
  if (name === 'feed') return out.copy(charge > 0.05 ? (blink ? HC.white : HC.gold) : HC.gold);
  if (name === 'pilot') return out.copy(ship.hull < 35 ? (blink ? HC.bad : HC.warn) : HC.green);
  if (name === 'shell' || name === 'outer') return out.copy(sev(Math.max(dmg, 0))).lerp(HC.dim, 0.35);
  return out.copy(sev(dmg));                                                                   // hull, canopy, vanes, fins, cockpit
}
// a hit from the world position `at` (or null for damage with no direction) lands on the section on that side of the ship
function holoHit(at, dmg) {
  const names = [];
  if (!at) names.push('hull', 'canopy');
  else {
    const loc = tmp.subVectors(at, ship.pos).applyQuaternion(qa.copy(ship.q).invert()), side = loc.x < 0 ? 'L' : 'R', fr = loc.z < 0, aft = loc.z > 0, lateral = Math.abs(loc.x) > Math.abs(loc.z);
    if (lateral) names.push('wing' + side, 'gun' + side, 'eng' + side, 'fin' + side); else if (fr) names.push('canopy', 'hull', 'gun' + side); else names.push('engC', 'eng' + side, 'fin' + side);
    void aft;
  }
  const n = names[(rand() * names.length) | 0];
  HOLO_DMG[n] = Math.min(1, (HOLO_DMG[n] || 0) + dmg / 55); HOLO_DMG.hull = Math.min(1, (HOLO_DMG.hull || 0) + dmg / 140); HOLO_FLASH[n] = 1; holoGlitch = 1;
}
function holoReset() { for (const k in HOLO_DMG) delete HOLO_DMG[k]; for (const k in HOLO_FLASH) delete HOLO_FLASH[k]; holoGlitch = 0; }

function renderHolo(dt) {
  holoT += dt; holoGlitch = Math.max(0, holoGlitch - dt * 2.5);
  for (const k in HOLO_FLASH) HOLO_FLASH[k] = Math.max(0, HOLO_FLASH[k] - dt * 1.6);
  const now = performance.now(), low = ship.hull < 30, stutter = low && Math.random() < 0.18, hit = holoGlitch > 0.4 && Math.random() < 0.5;
  holoCam.aspect = HOLO.w / HOLO.h; holoCam.updateProjectionMatrix();
  holoObjs.forEach((o, i) => { o.root.visible = i === holoMode; });
  const o = holoObjs[holoMode]; o.spin.rotation.y = (stutter ? Math.random() * 6 : Math.sin(holoT * 0.55) * 0.95 + 0.55);
  o.root.position.x = (hit ? (Math.random() - 0.5) * 0.4 : 0); o.root.scale.setScalar(stutter ? 0.9 : 1);
  const alpha = (low ? 0.55 + 0.35 * Math.random() : 1) * (hit ? 0.6 : 1);
  for (const name in o.secs) { const s = o.secs[name]; holoColor(name, tmpCol, now); s.col.lerp(tmpCol, 0.4); s.fill.uniforms.uCol.value.copy(s.col); s.fill.uniforms.uA.value = alpha * (name === 'shell' || name === 'outer' ? 0.5 : 1); s.fill.uniforms.uT.value = holoT; s.line.color.copy(s.col); s.line.opacity = alpha; }
  if (isRetro()) {
    const x = HOLO.x, y = H - (HOLO.y + HOLO.h);
    rt.viewport.set(x, y, HOLO.w, HOLO.h); rt.scissor.set(x, y, HOLO.w, HOLO.h); rt.scissorTest = true;
    renderer.setRenderTarget(rt); renderer.autoClear = false; renderer.clearDepth(); renderer.render(holoScene, holoCam); renderer.autoClear = true;
    rt.scissorTest = false; rt.viewport.set(0, 0, W, H); rt.scissor.set(0, 0, W, H);
  } else {
    const k = cssW / W, x = HOLO.x * k, y = (H - HOLO.y - HOLO.h) * k, w = HOLO.w * k, h = HOLO.h * k;
    renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h); renderer.setScissorTest(true);
    renderer.autoClear = false; renderer.clearDepth(); renderer.render(holoScene, holoCam); renderer.autoClear = true;
    renderer.setScissorTest(false); renderer.setViewport(0, 0, cssW, cssH);
  }
}
const tmpCol = new THREE.Color();
// the 2D side of the projector: the beam of light up from the puck, a scanning line, and the readout above the hologram
function drawHoloProjection(t) {
  const flick = Math.floor(t / 90) % 3, a = 0.07 + (flick === 0 ? 0.04 : 0), cx = HOLO_C.x;
  ctx.fillStyle = 'rgba(88,214,255,' + a + ')'; ctx.beginPath(); ctx.moveTo(cx - 8, HOLO_C.y); ctx.lineTo(cx + 8, HOLO_C.y); ctx.lineTo(cx + 40, HOLO.y + 6); ctx.lineTo(cx - 40, HOLO.y + 6); ctx.closePath(); ctx.fill();
  const sy = HOLO.y + 6 + ((t / 40) % (HOLO.h - 8)); ctx.fillStyle = 'rgba(180,240,255,.35)'; ctx.fillRect(HOLO.x + 6, Math.round(sy), HOLO.w - 12, 1);              // scanning line
  const st = ship.hull < 30 ? 'HULL CRIT' : ship.over ? 'GUNS OUT' : charge > 0.05 ? 'BLAST CHG' : ship.heat > 0.7 ? 'GUNS HOT' : (boost || hold('shift')) ? 'BOOST' : holoMode ? 'CUTAWAY' : 'ASTRA-9';
  const c = ship.hull < 30 || ship.over || ship.heat > 0.7 ? PAL.alert : charge > 0.05 ? '#ffffff' : '#7fdcff';
  ptext(st, HOLO.x + 2, HOLO.y - 1, c, 1, 'left', true); ptext('H', HOLO.x + HOLO.w - 3, HOLO.y - 1, '#4a7f98', 1, 'right', true);
  const hullTxt = Math.round(ship.hull) + '%'; ptext(hullTxt, HOLO.x + HOLO.w - 3, HOLO.y + HOLO.h - 7, ship.hull < 35 ? PAL.alert : '#58d6ff', 1, 'right', true);
}
