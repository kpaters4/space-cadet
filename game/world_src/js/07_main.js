// ============================================================ input, style switch, main loop
const stageXY = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
const TIPS = { fire: 'Index finger: hold to fire (Space)', go: 'Hold to boost (Shift)', hatL: 'Thumb switch: pin previous hazard', hatR: 'Thumb switch: pin next hazard (Tab)', grip: 'Drag to steer', '': '' };
const advance = () => { if (state === 'brief' || state === 'win' || state === 'dead') { startGame(); showCard('LEVEL 1', 'DEBRIS CLOUD', 'FIND THEM. SHOOT THEM DOWN. X SWITCHES WEAPON', 3600); return true; } return false; };
const release = () => { hg.drag = null; firing = false; boost = false; drag = null; };
cv.addEventListener('pointermove', e => {
  if (mouse.locked) return;
  if (state === 'bay') { if (hg.drag) { hg.yaw = hg.drag.yaw + (e.clientX - hg.drag.x) * 0.01; hg.pit = clamp(hg.drag.pit + (e.clientY - hg.drag.y) * 0.01, -1.2, 1.2); } return; }
  if (drag) { const r = cv.getBoundingClientRect(); drag.x = clamp((e.clientX - drag.x0) / (r.width * 0.09), -1, 1); drag.y = clamp(-(e.clientY - drag.y0) / (r.width * 0.09), -1, 1); return; }
  const p = stageXY(e); K.hover = pilotHit(p.x, p.y); cv.style.cursor = K.hover === 'grip' ? 'grab' : K.hover ? 'pointer' : (p.x > 368 && p.y < 72) ? 'pointer' : 'default'; cv.title = TIPS[K.hover] || '';
});
cv.addEventListener('pointerleave', () => { if (!drag) K.hover = ''; });
cv.addEventListener('pointerdown', e => {
  if (mouse.locked) return;
  const p = stageXY(e);
  if (state === 'bay') { if (p.y < 22) TAB_X.forEach((x, i) => { if (p.x >= x && p.x < x + TAB_W) bayTab(i); }); else { hg.drag = { x: e.clientX, y: e.clientY, yaw: hg.yaw, pit: hg.pit }; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* capture not available */ } } return; }
  if (p.x > 368 && p.y < 72) { showBrief(); return; }
  if (advance()) { e.preventDefault(); return; }
  const h = pilotHit(p.x, p.y); if (!h) return;
  e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (err) { /* capture not available */ }
  if (h === 'fire') firing = true; else if (h === 'go') { boost = true; K.goT = performance.now(); }
  else if (h === 'hatL') cyclePinned(-1); else if (h === 'hatR') cyclePinned(1);
  else { drag = { x0: e.clientX, y0: e.clientY, x: 0, y: 0 };  cv.style.cursor = 'grabbing'; }
});
cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k) || (k === 'tab' && state === 'play')) e.preventDefault();
  if (k === 'enter' || (k === ' ' && state !== 'play')) advance();
  if (k === 'tab' && state === 'play') cyclePinned(e.shiftKey ? -1 : 1);
  if (k === 'b') showBrief();
  if (state === 'brief' && k === 'v') { bayEnter(); return; }
  if (state === 'bay') { if (k >= '1' && k <= '4') bayTab(+k - 1); if (k === 'enter' || k === 'escape') bayExit(); keys[k] = true; return; }
  if (k === 'n') labelsOn = !labelsOn;
  if (k === 'f' && state === 'play') doParry();
  if (k === 'l' && state === 'play') { lampMode = (lampMode + 1) % 3; say('HEADLAMP ' + ['AUTO: on in the dark', 'ON', 'OFF'][lampMode], 1400); }
  if (k === 'z' && state === 'play') { assist = !assist; say('STABILISER ' + (assist ? 'ON: the horizon levels itself' : 'OFF: full manual roll'), 1600); }
  if (k === 'c' && state !== 'bay') setPov((povMode + 1) % POVS.length);
  if (k === 'h' && state !== 'bay') holoMode = 1 - holoMode;
  if (k === 'x' && state === 'play') { weapon = weapon === 'pulse' ? 'lance' : 'pulse'; charge = 0; say(weapon === 'lance' ? 'BLAST: hold to charge (the ship shakes), release for a sonic boom.' : 'PULSE: rapid fire.', 2400); }
  keys[k] = true;
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; release(); });

function setStyle(s) {
  style = s; U.uSteps.value = s === 'retro' ? 3 : s === 'hybrid' ? 4 : 0; fit();
  $('sRetro').setAttribute('aria-pressed', s === 'retro'); $('sHybrid').setAttribute('aria-pressed', s === 'hybrid'); $('sReal').setAttribute('aria-pressed', s === 'realistic');
}
$('sRetro').onclick = () => setStyle('retro'); $('sHybrid').onclick = () => setStyle('hybrid'); $('sReal').onclick = () => setStyle('realistic');
$('bFull').onclick = () => { const el = $('shell'); try { if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); } catch (err) { /* fullscreen unavailable */ } };

// the Boss fight button: restart, clear the debris, and begin the fight at once
$('bBoss').onclick = () => {
  if (hg && state === 'bay') { stage.classList.remove('lab'); }
  startGame(); for (const p of P) { p.alive = false; scene.remove(p.mesh); } P = []; ALIVE = []; spawnBoss(); state = 'play'; showCard('LEVEL 2', 'THE KESSLER RELIQUARY', 'IT HAS BEEN WAITING', 4200); $('bBoss').blur();
};
let last = performance.now(), hudT = 0;
let frameErrs = 0;
function frame(now) {                                                  // one bad frame must never freeze the game: log it, keep the loop alive, and drop back to the briefing if it keeps failing
  let lab = false;
  try { lab = frameInner(now); frameErrs = Math.max(0, frameErrs - 0.02); }
  catch (err) { console.error('frame error', err); if (++frameErrs > 5) { frameErrs = 0; firing = false; boost = false; if (state === 'play') state = 'brief'; try { stage.style.transform = ''; renderer.setRenderTarget(null); renderer.autoClear = true; } catch (e2) { /* ignore */ } } }
  if (!lab) requestAnimationFrame(frame);
}
function frameInner(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  if (state === 'bay') { bayFrame(now); return false; }
  K.tilt += (st.x * 0.3 - K.tilt) * Math.min(1, dt * 14); K.pitch += (st.y - K.pitch) * Math.min(1, dt * 14);
  update(dt, now);
  { shakeAmp *= Math.exp(-dt * 5); const ampC = charge > 0.05 && state === 'play' ? 0.5 + 2.6 * Math.min(1, charge / 0.7) : 0, amp = RM ? 0 : Math.max(shakeAmp, ampC, ship.shake * 0.55, (boost || hold('shift')) && state === 'play' ? 0.3 : 0); stage.style.transform = amp > 0.12 ? 'translate(' + ((rand() - 0.5) * 2 * amp).toFixed(1) + 'px,' + ((rand() - 0.5) * 2 * amp).toFixed(1) + 'px)' : ''; }   // the whole cockpit trembles
  if (isRetro()) {
    camera.layers.set(LAYER_SKY); renderer.setRenderTarget(null); renderer.setClearColor(CLEAR, 1); renderer.render(scene, camera);   // smooth sky
    camera.layers.set(0); renderer.setRenderTarget(rt); renderer.setClearColor(CLEAR, 0); renderer.render(scene, camera);           // chunky Earth, debris, satellites
    renderer.setClearColor(CLEAR, 1); if (povMode === 0) { renderVdu(dt); renderHolo(dt); }
    renderer.setRenderTarget(null); renderer.autoClear = false; renderer.render(postScene, postCam); renderer.autoClear = true;
  } else { camera.layers.enableAll(); renderer.render(scene, camera); if (povMode === 0) { renderVdu(dt); renderHolo(dt); } }
  if (povMode === 0) drawCockpit(now); else drawChaseHud(now);
  drawOverlay();
  if ((hudT += dt) > 0.15) { hudT = 0; $('hLeft').textContent = alive().length; $('hShot').textContent = shotN + '/' + total; $('hHull').textContent = Math.round(ship.hull) + '%'; $('hCoins').textContent = coinsBank + (state === 'play' ? coinsRun : 0); }
  if (labParams().name) { startLab(labParams()); return true; }
  return false;
}

// ---- start: the briefing is up, the field is already in orbit behind it
buildCockpit(); fit(); setStyle('retro');
{ const m = /t=(\d+)/.exec(location.hash); if (m) updateEnv(+m[1]); }   // #t=seconds: jump the orbit clock (testing)
startGame();
if (/moon/.test(location.hash)) { updateEnv(0); const mb = bodyBy('Moon'); ship.q.setFromUnitVectors(new V3(0, 0, -1), mb.dirW.clone().normalize()); }   // #moon: face the Moon (testing)
if (/gc/.test(location.hash)) { updateEnv(0); ship.q.setFromUnitVectors(new V3(0, 0, -1), new V3(-0.0549, -0.8677, -0.4941).applyQuaternion(envQ).normalize()); }   // #gc: face the galactic centre (testing)
if (/gp/.test(location.hash)) { updateEnv(0); ship.q.setFromUnitVectors(new V3(0, 0, -1), new V3(0.4941, 0.7470, 0.4448).applyQuaternion(envQ).normalize()); }   // #gp: face the galactic plane (testing)
if (/nadir/.test(location.hash)) ship.q.setFromUnitVectors(new V3(0, 0, -1), ship.pos.clone().negate().normalize());   // #nadir: look straight down (testing)
if (/chase/.test(location.hash)) setPov(1);   // #chase / #sideview: start in that view (testing)
if (/fastship/.test(location.hash)) ship.vel.set(0, 0, -60).applyQuaternion(ship.q);   // #fastship: start at speed (testing)
if (/#.*dark/.test(location.hash)) { U.uDark.value = darkTarget = 0.85; }   // #dark: start in the eclipse (testing)
if (/slowbolts/.test(location.hash)) BOLT_SPEED = 120;   // #slowbolts: slow the bolts so a screenshot can catch them (testing)
if (/lance/.test(location.hash)) weapon = 'lance';   // #lance: start with the lance (testing)
if (/fire/.test(location.hash)) firing = true;   // #fire: hold the trigger (testing)
if (/boss/.test(location.hash)) { for (const p of P) { p.alive = false; scene.remove(p.mesh); } P = []; ALIVE = []; spawnBoss(); if (/bosstest/.test(location.hash)) { B.state = 'fight'; B.t = 6; B.atkT = 0.2; const ph = /ph(\d)/.exec(location.hash); if (ph && +ph[1] >= 2) { for (const b of B.beads) { b.alive = false; b.grp.visible = false; } B.beadsLeft = 0; B.phase = +ph[1]; if (+ph[1] === 3) B.heartHp = 15; } } }   // #boss: skip straight to the boss; #bosstest[ph2|ph3]: skip its intro too (testing): skip straight to the boss (testing)
{ const sm = /sim(\d+)/.exec(location.hash); if (sm && state === 'play') for (let i = 0; i < +sm[1] * 20; i++) update(0.05, performance.now()); }   // #simN: fast-forward N seconds (testing)
if (/holotest/.test(location.hash)) { ship.heat = 0.8; holoHit(ship.pos.clone().add(new V3(-5, 0, 0).applyQuaternion(ship.q)), 40); holoHit(ship.pos.clone().add(new V3(0, 0, 6).applyQuaternion(ship.q)), 30); ship.hull = 62; if (/cut/.test(location.hash)) holoMode = 1; }   // #holotest[&cut]: heat + damage on the hologram (testing)
if (/holobig/.test(location.hash)) { HOLO.x = 90; HOLO.y = 70; HOLO.w = 300; HOLO.h = 170; }   // #holobig: show the hologram large (testing)
if (/weapontest/.test(location.hash) && B) {   // #weapontest: aim at the heart, fire pulse then lance, log the damage (testing)
  for (const b of B.beads) { b.alive = false; b.grp.visible = false; } B.beadsLeft = 0; B.state = 'fight'; B.atkT = 99; bossHittables();
  ship.q.setFromUnitVectors(new V3(0, 0, -1), hHeart.pos.clone().sub(ship.pos).normalize()); const h0 = B.heartHp, adv = s => { for (let i = 0; i < s * 20; i++) update(0.05, performance.now()); }; fire(false); adv(1); const h1 = B.heartHp; cool = 0; ship.heat = 0; fire(true); const hz = ship.heat; adv(1); console.log('WEAPONTEST', JSON.stringify({ start: h0, afterPulse: h1, afterLance: B.heartHp, beamLance, heat: hz }));
}
if (/clickboss/.test(location.hash)) { $('bBoss').click(); for (let i = 0; i < 40; i++) update(0.05, performance.now()); console.log('CLICKBOSS', JSON.stringify({ state, boss: !!B, phase: B && B.phase, debris: ALIVE.length })); }   // #clickboss: press the Boss fight button (testing)
if (/fovtest/.test(location.hash)) {   // #fovtest: boost, then brake, and log the field of view (testing)
  const out = { rest: Math.round(camera.fov * 10) / 10 }; let mx = 0, mn = 99; keys['shift'] = true; keys['w'] = true;
  for (let i = 0; i < 60; i++) { update(0.05, performance.now()); mx = Math.max(mx, camera.fov); } out.boostMax = Math.round(mx * 10) / 10; keys['shift'] = keys['w'] = false; keys['s'] = true;
  for (let i = 0; i < 60; i++) { update(0.05, performance.now()); mn = Math.min(mn, camera.fov); } keys['s'] = false; out.brakeMin = Math.round(mn * 10) / 10;
  console.log('FOVTEST', JSON.stringify(out));
}
if (/assisttest/.test(location.hash)) {   // #assisttest: boost while yawing and log how far the velocity strays from the nose (testing)
  const adv = s => { for (let i = 0; i < s * 20; i++) update(0.05, performance.now()); }, off = () => { const v = ship.vel.clone(); return v.length() < 1 ? 0 : Math.round(Math.acos(clamp(v.normalize().dot(new V3(0, 0, -1).applyQuaternion(ship.q)), -1, 1)) / D2R); }, out = {};
  keys['shift'] = true; keys['w'] = true; adv(3); out.straight = off(); keys['arrowright'] = true; adv(1.5); out.turning = off(); keys['arrowright'] = false; adv(1); out.after = off(); out.speed = Math.round(ship.vel.length());
  assist = false; ship.vel.set(0, 0, 0); keys['arrowright'] = false; adv(1); keys['arrowright'] = true; adv(1.5); out.noAssistTurning = off(); keys['arrowright'] = false; adv(1); out.noAssistAfter = off(); keys['shift'] = keys['w'] = false;
  console.log('ASSISTTEST', JSON.stringify(out));
}
if (/chasetest/.test(location.hash) && B) {   // #chasetest: push the boss into the Earth, then run away; log the altitude and the distance (testing)
  B.state = 'fight'; B.atkT = 99; const adv = s => { for (let i = 0; i < s * 20; i++) update(0.05, performance.now()); }, out = {};
  B.off.addScaledVector(B.pos.clone().normalize(), -900); adv(2); out.minR = Math.round(B.pos.length()); out.floor = Math.round(R + 100);
  B.off.set(0, 0, 0); B.offVel.set(0, 0, 0); adv(0.1); const up = B.pos.clone().normalize(), side = new V3().crossVectors(up, N0).normalize(); ship.pos.copy(B.pos).addScaledVector(side, 420).setLength(B.pos.length()); ship.vel.set(0, 0, 0);
  const d0 = B.pos.distanceTo(ship.pos); adv(3); const d1 = B.pos.distanceTo(ship.pos); adv(5); out.dist = [Math.round(d0), Math.round(d1), Math.round(B.pos.distanceTo(ship.pos))]; out.band = BAND[B.phase];
  console.log('CHASETEST', JSON.stringify(out));
}
if (/attacktest/.test(location.hash) && B) {   // #attacktest: stand still and let the boss's beam and lunge run; log the damage (testing)
  for (const b of B.beads) { b.alive = false; b.grp.visible = false; } B.beadsLeft = 0; B.phase = 3; B.state = 'fight'; B.atkT = 99; const adv = s => { for (let i = 0; i < s * 20; i++) update(0.05, performance.now()); };
  const out = {}; ship.hull = 100; bossAttack('beam'); adv(4); out.beamHull = ship.hull;  ship.hull = 100; B.beam = null; B.beamCd = 0; B.off.set(0, 0, 0); bossAttack('lunge'); adv(2); out.lungeHull = ship.hull; ship.hull = 100; B.timers.length = 0; bossAttack('stream'); adv(3); out.projectiles = BP.length; out.streamHull = ship.hull; out.wispSpeed = (() => { bossAttack('wisps'); adv(0.5); const w = BP.find(p => p.kind === 'wisp'); return w ? Math.round(w.vel.length()) : -1; })();
  console.log('ATTACKTEST', JSON.stringify(out));
}
if (/parrytest/.test(location.hash) && B) {   // #parrytest: throw wreckage at the ship, parry it, log what it did to the boss (testing)
  for (const b of B.beads) { b.alive = false; b.grp.visible = false; } B.beadsLeft = 0; B.state = 'fight'; B.atkT = 99; bossHittables();
  const from = hHeart.pos.clone(), aim = ship.pos.clone().sub(from).normalize(); const pr = shootProj('hurl', from, aim, 26); pr.pos.copy(ship.pos).addScaledVector(new V3(0, 0, -1).applyQuaternion(ship.q), 70); pr.vel.copy(aim).setLength(26);
  const h0 = B.heartHp; doParry(); for (let i = 0; i < 60; i++) update(0.05, performance.now()); console.log('PARRYTEST', JSON.stringify({ heart0: h0, heart1: B ? B.heartHp : 'dead', returned: pr.returned, text: parry.text, hull: ship.hull }));
}
if (/selftest/.test(location.hash) && B) {   // #selftest: drive the boss through every phase and log the result (testing)
  const log = []; const step = (s) => { for (let i = 0; i < s * 20; i++) update(0.05, performance.now()); };
  hHeart.hit && 0; step(1); bossHittables(); const beads = B.beads.slice(); beads.forEach(b => { hitBead(b, 4); }); log.push(['afterBeads', B.phase, B.beadsLeft]);
  hitHeart(18); log.push(['heart18', B.phase, B.heartHp]); hitHeart(18); log.push(['heartDead', B.state]); step(5); log.push(['end', state, !!B, bossDone, Math.round(coinsRun)]);
  console.log('SELFTEST', JSON.stringify(log));
}
if (!/play/.test(location.hash)) { state = 'brief'; $('status').textContent = ''; } else if (!/boss/.test(location.hash)) showCard('LEVEL 1', 'DEBRIS CLOUD', 'FIND THEM. SHOOT THEM DOWN. X SWITCHES WEAPON', 3600);
if (/bay/.test(location.hash)) { state = 'brief'; bayEnter(); const tb = /tab(\d)/.exec(location.hash); if (tb) bayTab(+tb[1]); }   // #bay[&tabN]: open the ship bay
if (/flowtest/.test(location.hash)) {   // #play&flowtest: clear level 1 and watch the hand-off to the boss, then die and check the boss stops (testing)
  const log = [], step = s => { for (let i = 0; i < s * 20; i++) update(0.05, performance.now()); };
  for (const p of P) killPiece(p, false); step(1); log.push(['cleared', state, !!B, bossWait > 0, lvlCard && lvlCard.n]); step(4); log.push(['boss', state, !!B, lvlCard && lvlCard.n]);
  step(6); ship.hull = 0; step(1); const t0 = B && B.t; step(3); log.push(['dead', state, B ? B.t === t0 : 'none', BP.length]);
  console.log('FLOWTEST', JSON.stringify(log));
}
window.__W = { get B() { return B; }, BP, get weapon() { return weapon; }, spawnBoss, bossDie, ship, st, K, startGame, setStyle, update, drawCockpit, get state() { return state; }, get P() { return P; }, fire, killPiece, bodies, THREE };
if (labParams().name) startLab(labParams()); else requestAnimationFrame(frame);
