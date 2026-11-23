// ============================================================ flight controls and the parry
// Mouse flight: click the glass to grab the mouse. Moving it deflects the stick; it springs back to centre like a real hand controller. Wheel = throttle lever. Left button fires, right button parries. Esc lets go.
// Keyboard: arrows pitch and yaw, A/D (or Q/E) roll, W/S thrust, Shift boost, Space fire, F parry, X weapon, C view, H hologram, Tab pins the next threat.
// Gamepad: left stick pitch and yaw, right stick roll, RT fire, LT boost, A parry, B weapon, Y view, X hologram, bumpers pin, D-pad thrust.
// PARRY: a 0.3 s deflector pulse in front of the ship. Boss debris that reaches you inside it is sent back at the boss; debris that rams you in it is smashed. A whiff costs a 1 s lock-out.
const IN = { x: 0, y: 0, roll: 0, thr: 0, boost: false, fire: false };
const mouse = { x: 0, y: 0, locked: false }, pad = { prev: [], thrSet: 0 };
let thrSet = 0, stopT = 0, wX = 0, wY = 0, wZ = 0, assist = true, prevBst = false;
const dz = (v, d) => Math.abs(v) < d ? 0 : Math.sign(v) * Math.pow((Math.abs(v) - d) / (1 - d), 1.6);
function mouseGrab() { try { const r = cv.requestPointerLock && cv.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* not available */ } }
document.addEventListener('pointerlockchange', () => { mouse.locked = document.pointerLockElement === cv; if (!mouse.locked) { firing = false; mouse.x = mouse.y = 0; } });
cv.addEventListener('pointerdown', e => {
  if (state !== 'play') return;
  if (mouse.locked) { e.preventDefault(); if (e.button === 2) doParry(); else firing = true; return; }
  const p = stageXY(e); if (e.button === 0 && !pilotHit(p.x, p.y) && !(p.x > 368 && p.y < 72) && p.y < 250) mouseGrab();
});
cv.addEventListener('pointerup', () => { if (mouse.locked) firing = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('mousemove', e => { if (mouse.locked && state === 'play') { mouse.x = clamp(mouse.x + e.movementX * 0.012, -1, 1); mouse.y = clamp(mouse.y - e.movementY * 0.012, -1, 1); } });
window.addEventListener('wheel', e => { if (state === 'play' && mouse.locked) { thrSet = clamp(thrSet - Math.sign(e.deltaY) * 0.15, 0, 1); e.preventDefault(); } }, { passive: false });

function readInput(dt) {
  mouse.x *= Math.exp(-dt * 1.6); mouse.y *= Math.exp(-dt * 1.6);
  IN.x = Math.sign(mouse.x) * Math.pow(Math.abs(mouse.x), 1.35); IN.y = Math.sign(mouse.y) * Math.pow(Math.abs(mouse.y), 1.35);   // small movements are fine, big ones sweep IN.roll = 0; IN.thr = thrSet; IN.boost = false; IN.fire = false;
  const gp = (navigator.getGamepads && navigator.getGamepads() || [])[0];
  if (gp) {
    const b = i => gp.buttons[i] ? gp.buttons[i].value : 0, edge = i => { const now = b(i) > 0.5, was = pad.prev[i]; pad.prev[i] = now; return now && !was; };
    IN.x += dz(gp.axes[0] || 0, 0.14); IN.y += -dz(gp.axes[1] || 0, 0.14); IN.roll += dz(gp.axes[2] || 0, 0.14);
    IN.fire = b(7) > 0.4; IN.boost = b(6) > 0.4; IN.thr += (b(12) ? 1 : 0) - (b(13) ? 0.5 : 0);
    if (edge(0)) doParry(); if (edge(1) && state === 'play') { weapon = weapon === 'pulse' ? 'lance' : 'pulse'; charge = 0; say(weapon === 'lance' ? 'BLAST: hold to charge, release for a sonic boom.' : 'PULSE: rapid fire.', 1500); }
    if (edge(3)) setPov((povMode + 1) % POVS.length); if (edge(2)) holoMode = 1 - holoMode; if (edge(4)) cyclePinned(-1); if (edge(5)) cyclePinned(1);
  }
  return IN;
}

// ---- parry
const parry = { win: 0, cd: 0, flash: 0, text: '', textT: -1e9, perfect: 0 };
function doParry() {
  if (state !== 'play' || parry.cd > 0 || ship.over) return;
  parry.win = 0.3; parry.cd = 1.0; parry.flash = 1; K.recoil = 1.4; ship.heat = Math.min(1, ship.heat + 0.06);
}
function parryReflect(p) {                                       // send a boss projectile back at the boss
  const to = B ? (B.beadsLeft > 0 ? hHeart.pos : hHeart.pos) : bNull.set(0, 0, 0), dir = new V3().subVectors(to, p.pos).normalize(), perfect = p.pos.distanceTo(ship.pos) < 55;
  p.returned = true; p.perfect = perfect; p.vel.copy(dir).multiplyScalar(Math.max(70, p.vel.length() * 1.8)); p.hp = 99; p.life = 9; p.flash = 1; p.dmg = 0;
  parry.cd = 0.3; parry.text = perfect ? 'PERFECT PARRY' : 'PARRY'; parry.textT = performance.now(); parry.flash = 1.4; stopT = 0.14; ship.shake = Math.max(ship.shake, 0.35); coinsRun += perfect ? 10 : 4;
  burst(p.pos, 30, 14, false);
}
function updateParry(dt) {
  parry.cd = Math.max(0, parry.cd - dt); parry.flash = Math.max(0, parry.flash - dt * 3);
  if (parry.win <= 0) return; parry.win -= dt; fwdV.set(0, 0, -1).applyQuaternion(ship.q);
  for (const p of BP) { if (p.returned) continue; tmp.subVectors(p.pos, ship.pos); const d = tmp.length(); if (d < 95 && tmp.dot(fwdV) / d > 0.1 && p.vel.dot(tmp) < 0) parryReflect(p); }
  for (const p of ALIVE) { if (p.pos.distanceTo(ship.pos) < p.radius * 1.1 + 6) { killPiece(p, true); parry.text = 'SMASHED'; parry.textT = performance.now(); parry.cd = 0.3; stopT = 0.08; } }   // debris that rams you inside the window is smashed and counts as shot
}
// what a returned projectile does when it reaches the boss: a heart hit if the heart is open, otherwise it breaks the rosary
function returnedHits(p) {
  const hit = hHeart.pos.distanceTo(p.pos) < hHeart.radius + 4 || hBody.pos.distanceTo(p.pos) < hBody.radius * 0.6;
  if (!hit) return false;
  const power = (p.kind === 'hurl' ? 12 : p.kind === 'censer' ? 8 : 3) * (p.perfect ? 1.5 : 1);
  if (B.beadsLeft > 0) { let n = Math.ceil(power / 4); for (const b of B.beads) { if (n <= 0) break; if (b.alive) { hitBead(b, BEAD_HP); n--; } } }
  else hitHeart(power);
  burst(p.pos, p.kind === 'hurl' ? 90 : 40, 22, true); ship.shake = Math.max(ship.shake, 0.4); stopT = 0.1;
  return true;
}
function drawParry(t) {                                          // a pulse of deflector rings out from the reticle, and the call-out
  const now = performance.now();
  if (parry.win > 0 || parry.flash > 0.05) {
    const age = 1 - Math.max(0, parry.win) / 0.3, rp = toScreen(tmp.copy(ship.pos).addScaledVector(fwdV.set(0, 0, -1).applyQuaternion(ship.q), 300), projV), cx = Math.round(rp.behind ? 240 : rp.x), cy = Math.round(rp.behind ? AXIS_Y : rp.y);
    for (let k = 0; k < 3; k++) { const r = Math.round(10 + age * 80 + k * 9); const c = k === 0 ? '#ffffff' : k === 1 ? '#7fdcff' : '#2a8bd8'; if (r < 140) { pcircle(cx, cy, r, c); if (k < 2) pcircle(cx, cy, r + 1, 'rgba(127,220,255,.45)'); } }
    for (let i = 0; i < 12; i++) { const a = i * 0.5236 + age, r = 10 + age * 80; px(Math.round(cx + Math.cos(a) * (r + 4)), Math.round(cy + Math.sin(a) * (r + 4)), '#d8f6ff'); }
  }
  if (now - parry.textT < 900) ptext(parry.text, 240, 108, parry.text === 'PERFECT PARRY' ? '#ffd060' : '#7fdcff', 2, 'center', true);
  if (state === 'play') { const k = parry.cd > 0 ? 1 - parry.cd / 1.0 : 1; ptext('PARRY F', 128, 224, k < 1 ? '#5a6b7c' : '#7fdcff', 1, 'center', true); rect(110, 232, 36, 2, '#12202c'); rect(110, 232, Math.round(36 * k), 2, k < 1 ? '#5a6b7c' : '#7fdcff'); }
}
