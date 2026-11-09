// ============================================================ dynamic cockpit: HUD, screens, gauges, lamps, cannons, flashes (480x300 pixel grid)
// Panels that change slowly are drawn into small off-screen canvases and only redrawn when their values change (cacheDraw), so a typical frame does very little 2D work.
let FOCAL = (H / 2) / Math.tan(THREE.MathUtils.degToRad(31));                    // pixels per unit of tan(angle): changes with the zoom (see updateFov)
const projV = new V3(), FRIEND = '#6fe3ff';
const toScreen = (wp, out) => { out.copy(wp).project(camera); return { x: (out.x + 1) / 2 * W, y: (1 - out.y) / 2 * H, z: out.z, behind: out.z > 1 }; };
let labelsOn = false;
const fmtT = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
function utcStr() { const s = (17 * 3600 + tE * TS) | 0; return String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
const altKm = () => Math.round((ship.pos.length() - R) * 10);
const km = d => Math.round(d * 10);
function localOf(p) { return tmp.subVectors(p.pos, ship.pos).applyQuaternion(qInv.copy(ship.q).invert()); }
const cdr = {};
function cacheDraw(name, x, y, w, h, key, fn) {
  let c = cdr[name];
  if (!c) { const e = document.createElement('canvas'); e.width = w; e.height = h; c = cdr[name] = { cv: e, g: e.getContext('2d'), key: null }; }
  if (c.key !== key) { c.key = key; const main = ctx; ctx = c.g; ctx.setTransform(1, 0, 0, 1, -x, -y); ctx.clearRect(x, y, w, h); fn(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx = main; }
  ctx.drawImage(c.cv, x, y);
}

function bracketAt(x, y, r, c, thick) {
  x = Math.round(x); y = Math.round(y); r = Math.round(r); const l = 4;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = x + sx * r, cy = y + sy * r;
    rect(sx < 0 ? cx : cx - l + 1, cy, l, 1, c); rect(cx, sy < 0 ? cy : cy - l + 1, 1, l, c);
    if (thick) { rect(sx < 0 ? cx : cx - l + 1, cy - sy, l, 1, c); rect(cx - sx, sy < 0 ? cy : cy - l + 1, 1, l, c); }
  }
}

// ---- twin laser cannons out in front of the cockpit. Each sits on a pivot and swings to point at what the beam is aimed at, so the beam leaves
// along the barrel. The barrel sprite is cached per recoil step and heat step; the right cannon is the left one mirrored.
const GUN_PIV = [[22, 178], [22, 178]], GUN_LEN = 118, gunBuf = makeBuf(140, 26), gunSprites = {}, gunAng = [-0.2, -0.2];
function gunSprite(kick, heat) {
  const key = kick * 10 + heat; if (gunSprites[key]) return gunSprites[key];
  useBuf(gunBuf); SD.fill(0);
  const A = [8, 13], L = GUN_LEN, hot = heat > 0 ? (heat > 1 ? ORANGE : [ORANGE[0], ORANGE[1], ORANGE[2], ORANGE[2], ORANGE[3]]) : null;
  const quad = (t0, t1, h0, h1, lvl, back, tint) => {                          // a tapered tube along +x with a lit top edge
    const x0 = A[0] + L*t0 - (back || 0), x1 = A[0] + L*t1 - (back || 0);
    part([[x0, A[1] - h0], [x1, A[1] - h1], [x1, A[1] + h1], [x0, A[1] + h0]], (x, y) => { const sd = (y - A[1]) / Math.max(h0, 1); return hot && tint ? ramp(hot, 1 + clamp(1 - sd, 0, 2) * 0.9, x, y) : ramp(STEEL, lvl - 1.5*clamp(sd, -1, 1) + (hash2(x, y) - 0.5) * 0.3, x, y); });
  };
  quad(0, 0.3, 6, 5, 3.0, 0, false);                                           // breech
  quad(0.28, 0.98, 3.6, 2.2, 3.2, kick, true);                                  // the long tapering barrel, it slides back on a shot
  for (const t of [0.34, 0.5, 0.66, 0.82]) { const x = Math.round(A[0] + L*t - kick); srect(x, Math.round(A[1] - 5 + (t * 3)), 2, Math.round(10 - t * 6), hot ? ORANGE[4] : ORANGE[3]); }   // cooling rings
  quad(0.94, 1.0, 3.2, 3.2, 4.2, kick, false);                                  // muzzle brake
  sline(Math.round(A[0] + L*0.3), Math.round(A[1] - 1), Math.round(A[0] + L*0.94 - kick), Math.round(A[1] - 1), STEEL[5]);   // specular streak along the top
  outlinePass(0); useBuf(SBUF);
  const e = document.createElement('canvas'); e.width = 140; e.height = 26; e.getContext('2d').putImageData(gunBuf.img, 0, 0);
  return (gunSprites[key] = e);
}
const mountBuf = makeBuf(64, 44); let mountSpr = null;
function mountSprite() {
  if (mountSpr) return mountSpr;
  useBuf(mountBuf); SD.fill(0);
  part([[18, 6], [38, 6], [44, 14], [38, 26], [18, 26], [12, 14]], (x, y) => ramp(STEEL, 2.8 + (hash2(x, y) - 0.5) * 0.5 + (y < 12 ? 0.8 : -0.4), x, y));
  srivet(15, 12); srivet(15, 20); sdisc(32, 14, 5, STEEL[1], STEEL[3]); sdisc(32, 14, 2, STEEL[5], STEEL[1]);
  outlinePass(0); useBuf(SBUF);
  mountSpr = document.createElement('canvas'); mountSpr.width = 64; mountSpr.height = 44; mountSpr.getContext('2d').putImageData(mountBuf.img, 0, 0);
  return mountSpr;
}
// where each cannon is aimed on the glass: the beam's end while firing, the reticle otherwise
function gunAim() {
  let tx = W / 2, ty = AXIS_Y;
  if (beamT > 0) { const s = toScreen(beamEnd, projV); if (!s.behind && isFinite(s.x)) { tx = s.x; ty = s.y; } }
  return [tx, ty];
}
const _mw = new V3();
function gunGeo() {                                                  // the barrels are fixed to the ship: the tip is where the muzzle really projects, and the barrel points at the vanishing point
  const out = [];
  for (let i = 0; i < 2; i++) {
    let mx, my;
    if (povMode === 0) { const r = MUZ_REL[i]; mx = W / 2 + FOCAL * r.x / -r.z; my = AXIS_Y - FOCAL * r.y / -r.z; }   // eye-relative: independent of camera shake
    else { const q = toScreen(muzzleWorld(i, _mw), projV); mx = q.behind ? -99 : q.x; my = q.behind ? -99 : q.y; }
    const [px_, py_] = GUN_PIV[i], tx = i ? W - mx : mx, a = Math.atan2(my - py_, tx - px_), len = Math.hypot(tx - px_, my - py_);
    out.push({ a, px: px_, py: py_, mx, my, mir: i === 1, kick: Math.round(K.recoil * 3), sc: len / GUN_LEN });
  }
  return out;
}
function drawGuns() {
  const spr = gunSprite(Math.round(K.recoil * 3), ship.heat > 0.66 ? 2 : ship.heat > 0.33 ? 1 : 0), ms = mountSprite();
  for (const g of gunGeo()) {
    const jk = charge > 0.05 ? Math.min(1, charge / 0.7) * 1.6 : 0;
    ctx.save(); ctx.translate((g.mir ? W - g.px : g.px) + (rand() - 0.5) * jk, g.py + (rand() - 0.5) * jk); if (g.mir) ctx.scale(-1, 1);
    ctx.rotate(g.a); ctx.scale(g.sc, 1); ctx.drawImage(spr, -8, -13); ctx.scale(1 / g.sc, 1); ctx.rotate(-g.a); ctx.drawImage(ms, -32, -14); ctx.restore();
  }
}
// ---- weapon effects (pixel art). A pulse is a glow halo, an orange body, a white core and a bright comet that runs down the line; the lance charges with crackling arcs, then fires a helix column.
function ditherLine(x0, y0, x1, y1, c) {                               // a line with every other pixel dropped: a soft glow edge on a 1-bit grid
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0; const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy; ctx.fillStyle = c;
  for (let n = 0; n < 900; n++) { if (((x0 + y0) & 1) === 0) ctx.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
}
function pdisc(cx, cy, r, c) { ctx.fillStyle = c; for (let y = -r; y <= r; y++) { const w = Math.floor(Math.sqrt(r * r - y * y)); ctx.fillRect(Math.round(cx) - w, Math.round(cy) + y, w * 2 + 1, 1); } }
const reticleXY = () => { fwdV.set(0, 0, -1).applyQuaternion(ship.q); const rp = toScreen(tmp.copy(ship.pos).addScaledVector(fwdV, 300), projV); return [Math.round(rp.behind ? 240 : rp.x), Math.round(rp.behind ? AXIS_Y : rp.y)]; };
function drawLanceCharge(now) {                                       // charging the BLAST: the air compresses into the muzzles (rings that shrink inward), the guns shake, the whole cockpit trembles
  const k = Math.min(1, charge / 0.7), full = k >= 1, phase = (now / (full ? 200 : 340)) % 1;
  for (const g of gunGeo()) {
    const mx = g.mx + (rand() - 0.5) * 2 * k, my = g.my + (rand() - 0.5) * 2 * k;
    for (let i = 0; i < 3; i++) { const ph = (phase + i / 3) % 1, r = Math.round(2 + (1 - ph) * (8 + 18 * k)); if (ph > 0.08) pcircle(Math.round(mx), Math.round(my), r, ph > 0.75 ? '#ffffff' : ph > 0.4 ? '#ffd9a0' : '#a8651f'); }
    pdisc(mx, my, Math.round(1 + k * 3), full ? '#ffffff' : '#ff9a3c');
    for (let i = 0; i < 5; i++) { const a = rand() * 6.283, d = 4 + rand() * (6 + 10 * k); px(Math.round(mx + Math.cos(a) * d), Math.round(my + Math.sin(a) * d * 0.5), rand() < 0.5 ? '#ffd9a0' : '#8a5a2a'); }   // dust shaken loose
  }
  if (full && Math.floor(now / 90) % 2) ptext('RELEASE', 240, 188, '#ffffff', 1, 'center', true);
}
function drawBeams() {                                                // the bolts themselves are 3D (04c_weapons.js); here are the charge-up, the blast's concussion and where a bolt lands
  const now = performance.now();
  if (charge > 0.05) drawLanceCharge(now);
  if (now - blastT < 420) {                                           // the boom: a white-out, then rings of pressure spreading from the reticle
    const age = (now - blastT) / 420, [cx, cy] = reticleXY(); ctx.fillStyle = 'rgba(255,238,215,' + (0.42 * (1 - age) * (1 - age)) + ')'; ctx.fillRect(0, 0, W, H);
    for (let k = 0; k < 4; k++) { const r = Math.round(6 + age * 250 - k * 16); if (r > 3 && r < 260) { pcircle(cx, cy, r, k === 0 ? '#ffffff' : k === 1 ? '#ffe2b8' : '#d8903a'); if (k < 2) pcircle(cx, cy, r + 1, 'rgba(255,226,184,.5)'); } }
  }
  if (hitFX && now - hitFX.t < (hitFX.lance ? 420 : 230)) {
    const s = toScreen(hitFX.pos, projV), age = (now - hitFX.t) / (hitFX.lance ? 420 : 230), lance = hitFX.lance;
    if (!s.behind && s.x > 0 && s.x < W && s.y > 0 && s.y < H && hitFX.pos.distanceTo(ship.pos) < 640) {
      const x = Math.round(s.x), y = Math.round(s.y), r = Math.round(2 + age * (lance ? 22 : 8)), c1 = lance ? '#d8f6ff' : '#fff3d0', c2 = lance ? '#7fdcff' : '#ffd36b';
      if (age < 0.4) pdisc(x, y, lance ? 4 : 2, '#ffffff'); pcircle(x, y, r, c2); if (lance) pcircle(x, y, Math.max(2, r - 5), '#ffffff');
      for (let i = 0; i < 8; i++) { const a = i * 0.785 + 0.3, d = r + 2 + age * 6; px(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), age < 0.6 ? c1 : '#ff7a3a'); }
    }
  }
}
function drawSkyHud() {
  fwdV.set(0, 0, -1).applyQuaternion(ship.q);
  for (const b of bodies) {
    tmp.copy(camera.position).addScaledVector(b.dirW, 1000); const s = toScreen(tmp, projV);
    if (s.behind || !onGlass(s.x, s.y) || skyOccluded(b.dirW)) continue;
    const x = Math.round(s.x), y = Math.round(s.y), planet = b.kind !== 'sun' && b.kind !== 'moon';
    if (planet && b.mag < 1.6) { const len = clamp(Math.round(2 + (1.2 - b.mag) * 1.2), 2, 8); ctx.fillStyle = b.color; ctx.fillRect(x - len, y, len * 2 + 1, 1); ctx.fillRect(x, y - len, 1, len * 2 + 1); px(x, y, '#fff'); }
    const near = Math.acos(clamp(b.dirW.dot(fwdV), -1, 1)) < 0.14;
    if (labelsOn || near || b === aimSky || b.kind === 'moon' || b.kind === 'sun') ptext(b.name + (planet ? ' ' + b.mag.toFixed(1) : ''), x + 6, y - 3, b.color, 1, 'left', true);
  }
  for (const s of SATS) {            // friendly craft: cyan brackets for the close ones, a label on the far markers when you are near them
    if (s.marker) { tmp.copy(s.pos); const q = toScreen(tmp, projV); if (!q.behind && onGlass(q.x, q.y) && (labelsOn || s === aim || Math.hypot(q.x - 240, q.y - AXIS_Y) < 40)) { pcircle(Math.round(q.x), Math.round(q.y), 4, FRIEND); ptext(s.name, q.x + 7, q.y - 3, FRIEND, 1, 'left', true); } continue; }
    const d = s.pos.distanceTo(ship.pos), lim = s.kind === 'iridium' ? 260 : 520; if (d > lim) continue;
    const q = toScreen(s.pos, projV); if (q.behind || !onGlass(q.x, q.y)) continue;
    const r = Math.max(4, s.radius * FOCAL / d + 3); bracketAt(q.x, q.y, r, FRIEND, s === aim);
    if (s.kind !== 'iridium' || s === aim) ptext(s.name, q.x, q.y + r + 3, FRIEND, 1, 'center', true);
  }
}
const ptextName = p => (p.name || '').slice(0, 10);
function drawSpeedLines(t) {                                           // streaks radiating from the vanishing point, only when you are really moving
  const f = clamp((ship.vel.length() - 14) / 50, 0, 1); if (f <= 0) return;
  { const gr = ctx.createRadialGradient(240, AXIS_Y, 120, 240, AXIS_Y, 290); gr.addColorStop(0, 'rgba(0,0,12,0)'); gr.addColorStop(1, 'rgba(0,0,14,' + (0.5 * f) + ')'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); }   // the edges of the view darken as you go faster: tunnel vision
  const [cx, cy] = reticleXY(), n = Math.round(6 + 14 * f);
  for (let i = 0; i < n; i++) {
    const a = i * 2.399 + Math.floor(t / 70) * 0.7, ph = ((t / 26 + i * 41) % 100) / 100, r0 = 70 + ph * 190, len = 5 + 34 * f * (0.4 + ph);
    pline(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.62, cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len) * 0.62, ph > 0.6 ? '#dbe8ff' : '#6f8bb0');
  }
}
function drawHud(t) {
  drawSpeedLines(t);
  // what to mark: the three most dangerous pieces, the pinned one, and the one under the reticle. Everything else stays unmarked.
  const marked = new Map(); THREATS.slice(0, 3).forEach((th, i) => marked.set(th.p, { rank: i, th }));
  if (pinned && pinned.alive && !marked.has(pinned)) marked.set(pinned, { rank: 3, th: null });
  if (!marked.size && ALIVE.length) { let best = null, bd = 1e9; for (const p of ALIVE) { const d = p.pos.distanceTo(ship.pos); if (d < bd) { bd = d; best = p; } } marked.set(best, { rank: 3, th: null }); }   // nothing urgent: point at the nearest
  for (const [p, m] of marked) {
    const s = toScreen(p.pos, projV), on = !s.behind && onGlass(s.x, s.y), d = p.pos.distanceTo(ship.pos), rank = m.rank, isPin = p === pinned;
    const col = isPin ? '#ffffff' : rank > 2 ? '#7f93a8' : THREAT_COL[rank], label = m.th ? (m.th.kind === 'HIT' ? 'HIT ' : 'EARTH ') + Math.max(0, Math.round(m.th.t)) + 'S' : '';
    if (on) {
      const r = Math.max(6, p.radius * FOCAL / Math.max(d, 1) + 4);
      if (rank === 0 || isPin) { bracketAt(s.x, s.y, r, col, true); if (label) ptext(label, s.x, s.y - r - 8, col, 1, 'center', true); }
      else if (rank < 3) { const y = Math.round(s.y - r - 6), x = Math.round(s.x); for (let k = 0; k < 3; k++) rect(x - 2 + k, y + k, 5 - k * 2, 1, col); if (label && rank === 1) ptext(label, s.x, y - 8, col, 1, 'center', true); }   // a small chevron over the object
    } else threatArrow(s, rank, col, rank === 0 || isPin ? label || ptextName(p) : '', t);
  }
  if (aim && !aim.friendly && aim.alive && !marked.has(aim)) { const s = toScreen(aim.pos, projV), d = aim.pos.distanceTo(ship.pos); if (!s.behind) bracketAt(s.x, s.y, Math.max(6, aim.radius * FOCAL / Math.max(d, 1) + 3), '#e8eef6', false); }   // lock feedback: thin ticks only
  fwdV.set(0, 0, -1).applyQuaternion(ship.q); const rp = toScreen(tmp.copy(ship.pos).addScaledVector(fwdV, 600), projV), cx = Math.round(rp.behind ? 240 : rp.x), cy = Math.round(rp.behind ? AXIS_Y : rp.y), friend = aim && aim.friendly, c = friend ? FRIEND : aim ? PAL.alert : '#e8eef6';
  rect(cx - 10, cy, 6, 1, c); rect(cx + 5, cy, 6, 1, c); rect(cx, cy - 10, 1, 6, c); rect(cx, cy + 5, 1, 6, c); px(cx, cy, c); pcircle(cx, cy, 8, friend ? 'rgba(111,227,255,.6)' : aim ? 'rgba(255,90,77,.55)' : 'rgba(232,238,246,.35)');
  if (friend && Math.floor(t / 250) % 2) ptext('FRIENDLY - HOLD FIRE', 240, cy + 16, FRIEND, 1, 'center', true);
  const age = performance.now() - msg.t;
  if (msg.text && age < msg.ms) pwrap(msg.text.toUpperCase(), 200, 2).slice(0, 2).forEach((ln, i) => ptext(ln, 240, 78 + i * 12, '#ffffff', 2, 'center', true));
  if (state === 'play' && ship.hull < 30 && Math.floor(t / 300) % 2) ptext('HULL CRITICAL', 240, 212, PAL.alert, 2, 'center', true);
  if (state === 'play') {                                             // weapon mode + lance charge
    ptext((assist ? 'STAB  ' : '') + (weapon === 'lance' ? 'BLAST' : 'PULSE'), 128, 208, weapon === 'lance' ? '#ffd9a0' : PAL.amber, 1, 'center', true);
    if (weapon === 'lance') { rect(110, 216, 36, 3, '#12202c'); rect(110, 216, Math.round(36 * Math.min(1, charge / 0.7)), 3, charge >= 0.7 ? '#ffffff' : '#c8792a'); }
  }
  if (B) drawBossHud(t);
  drawParry(t);
}
function drawBossHud(t) {
  const now = performance.now();
  if (B.phase === 3 || B.state === 'dying') { const k = 0.18 + 0.14 * (0.5 + 0.5 * Math.sin(t / (B.phase === 3 ? 140 : 70))), gr = ctx.createRadialGradient(240, AXIS_Y, 90, 240, AXIS_Y, 300); gr.addColorStop(0, 'rgba(120,0,0,0)'); gr.addColorStop(1, 'rgba(180,10,10,' + k + ')'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); }   // the glass reddens as it rages
  if (B.banner) {
    const age = now - B.banner.t, T = B.banner.long ? 4200 : 2600;
    if (age < T) { const a = age < 300 ? age / 300 : age > T - 600 ? (T - age) / 600 : 1, big = B.banner.long;
      if (big) { rect(0, 40, W, 18, 'rgba(0,0,0,' + a * 0.85 + ')'); rect(0, 196, W, 20, 'rgba(0,0,0,' + a * 0.85 + ')'); }
      if (age < 240 && !big) { ctx.fillStyle = 'rgba(255,60,40,' + (0.5 * (1 - age / 240)) + ')'; ctx.fillRect(0, 0, W, H); }
      ptext(B.banner.text, 240, big ? 130 : 76, a > 0.5 ? '#ffffff' : '#ffb0a0', big ? 2 : 3, 'center', true); ptext(B.banner.sub, 240, big ? 150 : 100, '#ff7a5a', 1, 'center', true); }
  }
  const hp = B.beadsLeft > 0 ? 1 : Math.max(0, B.heartHp / HEART_HP), w = 150, x0 = 165, y0 = 207;
  ptext(BOSS_NAME, 240, y0 - 10, '#ffd060', 1, 'center', true);
  rect(x0 - 1, y0 - 1, w + 2, 6, '#000'); rect(x0, y0, w, 4, '#3a1511');
  rect(x0, y0, Math.round(w * hp), 4, B.beadsLeft > 0 ? '#c79a3a' : B.phase === 3 ? '#ff5a4d' : '#d84a3a');
  if (B.beadsLeft > 0) for (let k = 0; k < BEAD_N; k++) rect(x0 + 8 + k * 17, y0 + 6, 9, 2, k < B.beadsLeft ? '#e8e0c0' : '#2a2d34');   // beads left
  else rect(x0 + w / 2, y0 - 1, 1, 6, '#000');                                                                                    // phase mark at half
  ptext(PHASE_NAME[B.phase], 240, y0 + 9, B.phase === 3 ? '#ff7a6a' : '#e8e0c0', 1, 'center', true);
  if (B.tele && Math.floor(t / 110) % 2) { ptext({ censer: 'CENSER', hurl: 'HURL', tithe: 'TITHE', stream: 'STREAM', halo: 'HALO', wisps: 'WISPS', beam: 'BEAM', lunge: 'LUNGE' }[B.tele.kind], 240, 98, PAL.alert, 2, 'center', true); ptext(B.tele.kind === 'beam' || B.tele.kind === 'lunge' ? 'DODGE: MOVE SIDEWAYS' : 'PARRY: F', 240, 116, B.tele.kind === 'beam' || B.tele.kind === 'lunge' ? '#ffd36b' : '#7fdcff', 1, 'center', true); }          // telegraph: it is about to attack
  for (const o of bossHittables()) {
    if (o === hBody) continue;
    const s = toScreen(o.pos, projV); if (s.behind || !onGlass(s.x, s.y)) continue;
    if (o.kind === 'shard') { rect(Math.round(s.x) - 1, Math.round(s.y) - 1, 3, 3, '#ff5a4d'); continue; }                          // spikes: a small red tick, no clutter
    const d = o.pos.distanceTo(ship.pos), r = Math.max(5, o.radius * FOCAL / d + 2), c = o === hHeart ? (B.beadsLeft > 0 ? '#8a7a5a' : '#ff6a3a') : o.kind ? '#ff5a4d' : '#ffe39a';
    bracketAt(s.x, s.y, r, c, o === aim);
    if (o === hHeart) ptext(B.beadsLeft > 0 ? 'HEART SHIELDED' : 'HEART', s.x, s.y + r + 3, c, 1, 'center', true);
  }
}

// ---- the two corner boards, built into the pods
function scanlines(r) { ctx.fillStyle = 'rgba(0,0,0,.28)'; for (let y = r.y; y < r.y + r.h; y += 2) ctx.fillRect(r.x, y, r.w, 1); ctx.fillStyle = 'rgba(180,255,200,.05)'; for (let k = 0; k < r.h; k++) ctx.fillRect(r.x + 10 + k * 0.8 | 0, r.y + k, 5, 1); }
function drawEnv(t) {
  const r = { x: SCR_L.x + 1, y: SCR_L.y + 1, w: SCR_L.w - 2, h: SCR_L.h - 2 }, utc = utcStr(), ph = Math.floor(t / 250);
  cacheDraw('env', r.x, r.y, r.w, r.h, ph + '|' + utc + '|' + altKm(), () => {
    rect(r.x, r.y, r.w, r.h, PAL.g0); ptext('SOLAR F10.7 130', r.x + 3, r.y + 3, PAL.g3);
    for (let i = 0; i < 20; i++) { const h = 3 + Math.round(11 * (0.5 + 0.5 * Math.sin(i * 0.7 + 1.3 + t / 2500))); rect(r.x + 4 + i * 4, r.y + 26 - h, 3, h, i === 19 ? PAL.amber : PAL.g2); }
    rect(r.x + 3, r.y + 27, r.w - 6, 1, PAL.g3); ptext('DRAG LOW   ALT ' + altKm() + 'K', r.x + 3, r.y + 30, PAL.g4); ptext('UTC ' + utc + ' FEB 10', r.x + 3, r.y + 37, PAL.amber); scanlines(r);
  });
}
function drawComm(t) {
  const r = { x: SCR_R.x + 1, y: SCR_R.y + 1, w: SCR_R.w - 2, h: SCR_R.h - 2 }, cx = r.x + 46, talking = performance.now() - msg.t < 1800, open = talking && Math.floor(t / 110) % 2;
  const blink = Math.floor(t / 3000) % 5 === 0 && (t % 3000) < 160;
  cacheDraw('comm', r.x, r.y, r.w, r.h, (open ? 1 : 0) + '|' + (blink ? 1 : 0) + '|' + (Math.floor(t / 600) % 2), () => {
    rect(r.x, r.y, r.w, r.h, PAL.g0);
    for (let y = r.y + 4; y < r.y + r.h; y += 8) rect(r.x, y, r.w, 1, PAL.g1);
    const ell = (ex, ey, rx, ry, col, half) => { for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) { if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1 && (!half || y <= 0)) px(ex + x, ey + y, col); } };
    rect(cx - 22, r.y + 36, 44, 9, PAL.g2); rect(cx - 8, r.y + 33, 16, 4, PAL.g1); rect(cx - 5, r.y + 36, 10, 2, PAL.g3); rect(cx - 4, r.y + 28, 8, 7, PAL.g1);
    ell(cx, r.y + 20, 10, 12, PAL.g2); for (let y = 0; y < 22; y++) for (let x = 3; x < 11; x++) if (bay(x, y) > 0.55) px(cx + x, r.y + 10 + y, PAL.g1);
    ell(cx, r.y + 13, 12, 8, PAL.g1, true); rect(cx - 13, r.y + 13, 26, 3, PAL.g0); rect(cx - 12, r.y + 13, 24, 1, PAL.g3); rect(cx - 1, r.y + 8, 3, 3, PAL.g4); px(cx, r.y + 7, PAL.g4);
    for (const ex of [-5, 2]) { rect(cx + ex, r.y + 19, 4, blink ? 1 : 2, PAL.g0); if (!blink) px(cx + ex + 1, r.y + 19, PAL.g4); rect(cx + ex, r.y + 17, 4, 1, PAL.g0); }
    rect(cx, r.y + 21, 1, 4, PAL.g1); rect(cx - 3, r.y + 28, 7, open ? 3 : 1, PAL.g0);
    pline(cx - 10, r.y + 19, cx - 12, r.y + 27, PAL.g3); pline(cx - 12, r.y + 27, cx - 6, r.y + 31, PAL.g3); px(cx - 6, r.y + 31, PAL.g4);
    ptext('CMDR', r.x + 3, r.y + 2, PAL.g3); if (Math.floor(t / 600) % 2) ptext('CLICK', r.x + r.w - 3, r.y + r.h - 7, PAL.g2, 1, 'right'); scanlines(r);
  });
}
function drawRadar(t) {
  const cx = RAD.x, cy = RAD.y, rr = RAD.r, range = 320;
  for (const r of [7, 14, 21]) pcircle(cx, cy, r, PAL.crtMd);
  rect(cx - rr, cy, rr * 2 + 1, 1, PAL.crtMd); rect(cx, cy - rr, 1, rr * 2 + 1, PAL.crtMd);
  const a = (t / 1500) % (Math.PI * 2); pline(cx, cy, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, PAL.crt); rect(cx - 1, cy - 1, 3, 3, PAL.ink);
  const blip = (p, c, sz) => { const l = localOf(p), d2 = Math.hypot(l.x, l.z), k = Math.min(1, d2 / range), ang = Math.atan2(l.x, -l.z), x = Math.round(cx + Math.sin(ang) * k * rr), y = Math.round(cy - Math.cos(ang) * k * rr); rect(x - (sz >> 1), y - (sz >> 1), sz, sz, d2 > range ? '#555' : c); if (l.y > 40) px(x, y - 3, c); else if (l.y < -40) px(x, y + 3, c); };
  for (const s of SATS) if (!s.marker && s.pos.distanceTo(ship.pos) < range * 1.6) blip(s, FRIEND, 2);
  for (const p of ALIVE) blip(p, p === pinned ? '#fff' : threatOf(p) === 0 ? PAL.alert : threatOf(p) > 0 && threatOf(p) < 3 ? PAL.amber : PAL.crtMd, p.size === 'LARGE' ? 3 : p.size === 'SHARD' ? 1 : 2);
  const e = tmp.copy(ship.pos).negate().applyQuaternion(qInv.copy(ship.q).invert()), ea = Math.atan2(e.x, -e.z);
  rect(Math.round(cx + Math.sin(ea) * rr - 1), Math.round(cy - Math.cos(ea) * rr - 1), 3, 3, PAL.blue);
  ptext('HAZ', 193, 20, PAL.crtMd); ptext(String(ALIVE.length), 193, 27, PAL.crt); ptext('RNG', 265, 20, PAL.crtMd); ptext('3200KM', 265, 27, PAL.crt);
  const lk = !!aim && !aim.friendly, bl = Math.floor(t / 200) % 2;
  for (const lx of [184, 292]) for (let i = 0; i < 4; i++) rect(lx + 1, 9 + i * 9, 2, 4, lk ? (bl ? PAL.alert : '#ff9a8a') : '#3a1511');
}
const segBar = (x, y, n, colorFn) => { for (let i = 0; i < 12; i++) rect(x + i * 4, y, 3, 5, i < n ? colorFn(i / 12) : '#12202c'); };
function dial(cx, cy, n, c) { const a = (-135 + n / 30 * 270) * D2R; pline(cx, cy, cx + Math.sin(a) * 9, cy - Math.cos(a) * 9, c); rect(cx - 1, cy - 1, 3, 3, '#e8eef6'); }
function drawDash(t) {
  const hp = ship.hull / 100, hn = Math.round(clamp(hp, 0, 1) * 12), tn = Math.round(clamp(ship.heat, 0, 1) * 12), sn = Math.round(clamp(ship.vel.length() / 66, 0, 1) * 12), bl = Math.floor(t / 250) % 2;
  cacheDraw('bars', 34, 265, 50, 25, hn + '|' + tn + '|' + sn + '|' + (hp < 0.3 ? bl : 0), () => {
    segBar(35, 266, hn, f => hp < 0.3 ? (bl ? PAL.alert : '#7a2a24') : PAL.crt); segBar(35, 275, tn, f => f > 0.75 ? PAL.alert : PAL.lamp); segBar(35, 284, sn, f => f > 0.8 ? PAL.lamp : PAL.crt);
  });
  { const bl = Math.floor(t / 250) % 2, f = x => x ? 1 : 0, lk = aim ? (aim.friendly ? 2 : 1) : 0, hot = ship.heat > 0.7 ? 2 : ship.heat > 0.4 ? 1 : 0;
    const lamps = [1, ship.over ? 3 : hot, (thrSm > 0.2 || Math.abs(st.x) + Math.abs(st.y) > 0.3) ? 1 : 0, ship.over ? 3 : charge > 0.05 ? 4 : hot === 2 ? 2 : 1, lk, parry.cd > 0 ? 0 : 4, B ? 2 : 0, (ship.hull < 35 || (B && B.tele)) ? 3 : 0];
    cacheDraw('ann', 7, 237, 88, 23, lamps.join('') + '|' + (bl && (lamps[1] === 3 || lamps[3] === 3 || lamps[4] === 1 || lamps[6] === 2 || lamps[7] === 3) ? 1 : 0), () => {
      const LAMP = [['#12301e', '#2f6a48'], ['#3fd673', '#0b2f1a'], ['#ffd36b', '#3a2c08'], ['#ff5a4d', '#2a0c09'], ['#7fdcff', '#0a2a3a']];      // [lit, text colour]; index 0 is unlit
      ANN.forEach((n, i) => { const [x, y] = annXY(i); let k = lamps[i]; if ((k === 3 || (i === 4 && k === 1) || (i === 6 && k === 2)) && !bl) k = 0; const c = i === 4 && k === 1 ? LAMP[3] : i === 4 && k === 2 ? LAMP[4] : LAMP[k === 0 ? 0 : k]; rect(x, y, 19, 9, c[0]); ptext(n, x + 2, y + 2, c[1], 1); });
    }); }
  const dv = Math.round(clamp(ship.vel.length() / 66, 0, 1) * 30), dt2 = Math.round(clamp(thrSm, 0, 1) * 30);
  cacheDraw('dials', 190, 255, 100, 32, dv + '|' + dt2, () => { dial(204, 270, dv, PAL.crt); dial(276, 270, dt2, PAL.amber); });
  const coins = coinsBank + (state === 'play' ? coinsRun : 0);
  cacheDraw('counts', 334, 264, 72, 32, shotN + '|' + total + '|' + coins + '|' + ALIVE.length + '|' + Math.floor(tG), () => {
    ptext('SHOT ' + shotN + '/' + total, 336, 266, PAL.crt); ptext('COIN ' + coins, 336, 274, PAL.amber); ptext('LEFT ' + ALIVE.length, 336, 282, PAL.crt); ptext('TIME ' + fmtT(tG), 336, 290, PAL.crt);
  });
  // readout of whatever is under the reticle
  const info = aim || pinned, sky = !info && aimSky, ph = Math.floor(t / 250) % 2;
  const key = info ? (info.friendly ? 'f' + info.name : 'p' + info.id) + '|' + Math.round(info.pos.distanceTo(ship.pos) / 2) + '|' + info.hp + '|' + (isFinite(info.tFall) ? Math.round(info.tFall - tG) : 'x') + '|' + ph : sky ? 's' + sky.name : 'none|' + ph;
  cacheDraw('read', 412, 258, 62, 36, key, () => {
    rect(412, 258, 62, 36, '#000');
    if (info && info.friendly) {
      const rk = km(info.pos.distanceTo(ship.pos));
      ptext(info.name.slice(0, 15), 414, 259, FRIEND); ptext((REAL[info.kind] ? REAL[info.kind].size : info.desc).slice(0, 15), 414, 265, '#ffffff');       // true size, not the drawn size
      ptext('ALT ' + info.alt + ' KM', 414, 271, PAL.crt);
      ptext('INC ' + Math.round(info.inc) + ' RNG ' + (rk >= 10000 ? Math.round(rk / 1000) + 'K' : rk), 414, 277, PAL.crt); ptext('FRIENDLY CRAFT', 414, 283, FRIEND); if (ph) ptext('DO NOT FIRE', 414, 289, PAL.alert);
    } else if (info) {
      const eta = isFinite(info.tFall) ? Math.round(info.tFall - tG) : null, alt = Math.round((info.posIn.length() - R) * 10);
      ptext(info.name.slice(0, 15), 414, 259, PAL.amber); ptext(info.type.slice(0, 7) + ' ' + info.size.slice(0, 3), 414, 265, PAL.crt);
      ptext('RNG ' + km(info.pos.distanceTo(ship.pos)) + ' KM', 414, 271, PAL.crt); ptext('ALT ' + alt + 'K  HP ' + info.hp, 414, 277, PAL.crt);
      if (info.size !== 'SHARD') ptext('MODEL ' + Math.round(modelP(info) * 100) + '% DOWN', 414, 283, PAL.ink);
      if (eta !== null && eta < 90) ptext('FALLS IN ' + Math.max(0, eta) + 'S', 414, 289, ph ? PAL.alert : '#ff9a8a');
    } else if (sky) {
      const deg = sky.angR * 2 / D2R;
      ptext(sky.name.toUpperCase(), 414, 259, PAL.amber); ptext('MAG ' + sky.mag.toFixed(1), 414, 265, PAL.crt);
      ptext(sky.distKM ? 'DIST ' + Math.round(sky.distKM / 1000) + 'K KM' : 'DIST ' + sky.distAU.toFixed(2) + ' AU', 414, 271, PAL.crt);
      ptext('SIZE ' + (deg >= 0.1 ? deg.toFixed(2) + ' DEG' : (deg * 3600).toFixed(0) + ' ARCSEC'), 414, 277, PAL.crt);
      if (sky.phase !== undefined) ptext('PHASE ' + Math.round(sky.phase) + ' DEG', 414, 283, PAL.crt);
    } else { if (ph) ptext('NO TARGET', 414, 261, PAL.alert); ptext('AIM RETICLE', 414, 269, '#567'); ptext('AT HAZARD OR', 414, 276, '#567'); ptext('PLANET', 414, 283, '#567'); }
  });
  // pod lamps
  const blk = Math.floor(t / 350) % 2, talking = performance.now() - msg.t < 1800;
  for (const [x, c] of [[44, '#46e07a'], [53, hp < 0.6 && blk ? '#ffd36b' : '#3a2c08'], [62, ship.heat > 0.6 ? '#ffd36b' : '#3a2c08'], [71, hp < 0.3 && blk ? '#ff5a4d' : '#2a0c09']]) rect(x + 1, 62, 2, 2, c);
  for (const [x, c] of [[435, talking ? '#46e07a' : '#0e3a1f'], [426, '#3a2c08'], [417, ship.over ? '#ffd36b' : '#3a2c08'], [408, state === 'dead' ? '#ff5a4d' : '#2a0c09']]) rect(x + 1, 62, 2, 2, c);
}
function drawVduFrame(t) {
  const info = aim || pinned || aimSky;
  if (!info) {
    rect(VDU.x, VDU.y, VDU.w, VDU.h, PAL.g0); for (let i = 0; i < 50; i++) px(VDU.x + (rand() * VDU.w | 0), VDU.y + (rand() * VDU.h | 0), rand() < 0.5 ? PAL.g1 : PAL.g2);
    if (Math.floor(t / 600) % 2) ptext('NO LOCK', VDU.x + VDU.w / 2, VDU.y + VDU.h / 2 - 2, PAL.g3, 1, 'center');
  } else ptext(info.name.slice(0, 13), VDU.x + 2, VDU.y + VDU.h - 7, info.friendly ? FRIEND : PAL.g4, 1, 'left', true);
  scanlines(VDU);
}
function drawEffects(t) {
  const now = performance.now();
  if (now - flashT < 120) {                                                                        // muzzle flash: a star, a ring, and a short flare along the barrel
    const age = (now - flashT) / 120, big = beamLance ? 1.6 : 1, k = Math.round((6 - age * 4) * big);
    for (const g of gunGeo()) {
      const x = Math.round(g.mx), y = Math.round(g.my), c1 = beamLance ? '#d8f6ff' : '#ffd6a0', c2 = beamLance ? '#2a8bd8' : '#ff9a3c', dirx = (g.mir ? -1 : 1) * Math.cos(g.a), diry = Math.sin(g.a);
      rect(x - k, y, k * 2 + 1, 1, c1); rect(x, y - k, 1, k * 2 + 1, c1); pdisc(x, y, age < 0.4 ? 2 : 1, '#ffffff'); pcircle(x, y, Math.max(2, k - 2), c2);
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { px(x + a * (k - 1), y + b * (k - 1), c2); px(x + a * Math.max(1, k - 3), y + b * Math.max(1, k - 3), c1); }
      for (let d = 2; d < 10 - age * 6; d++) px(Math.round(x + dirx * d), Math.round(y + diry * d), d < 5 ? '#ffffff' : c1);
    }
  }
  if (impactFX && now - impactFX.t < 600) {
    const s = toScreen(impactFX.pos, projV), f = (now - impactFX.t) / 600;
    if (!s.behind && s.x > 0 && s.x < W && s.y > 0 && s.y < H) { pcircle(Math.round(s.x), Math.round(s.y), 3 + Math.round(f * 14), f < 0.5 ? '#fff3d0' : '#ff5a2a'); rect(s.x - 2, s.y - 2, 5, 5, f < 0.4 ? '#fff' : '#ff9a3c'); }
  }
  if (ship.hurt > 0 || earthFlash > 0) { ctx.fillStyle = 'rgba(255,40,30,' + (0.26 * Math.max(ship.hurt, earthFlash)) + ')'; ctx.fillRect(0, 0, W, H); }
}
function overlayPanel(lines, foot, head, headColor) {
  rect(52, 78, 376, 132, 'rgba(0,6,14,.84)'); ctx.strokeStyle = PAL.crtMd; ctx.lineWidth = 1; ctx.strokeRect(52.5, 78.5, 375, 131);
  ptext(head, 240, 86, headColor || PAL.amber, 3, 'center', true);
  let y = 110; for (const ln of lines) { ptext(ln, 240, y, PAL.crt, 2, 'center'); y += 12; }
  if (Math.floor(performance.now() / 500) % 2) ptext(foot, 240, 194, '#ffffff', 2, 'center', true);
}
// the level 1 briefing: a transmission header, the level number and name big, three tagged orders, and the launch prompt
const BRIEF_ROWS = [['GOAL', PAL.amber, 'SHOOT DOWN EVERY PIECE BEFORE IT FALLS'], ['HOLD', '#6fe3ff', 'FIRE ON NOTHING CYAN: ISS, HUBBLE, FRIENDS'], ['THEN', '#ff6a5a', 'SOMETHING WAITS BEYOND THE CLOUD']];
function drawBrief(t) {
  rect(0, 0, W, H, 'rgba(0,4,10,.55)');
  const x0 = 56, w = W - 112, y0 = 62;
  rect(x0, y0, w, 150, 'rgba(0,8,18,.9)'); ctx.strokeStyle = PAL.crtMd; ctx.lineWidth = 1; ctx.strokeRect(x0 + .5, y0 + .5, w - 1, 149);
  for (const [cx, cy] of [[x0, y0], [x0 + w - 5, y0], [x0, y0 + 145], [x0 + w - 5, y0 + 145]]) rect(cx, cy, 5, 5, PAL.amber);                           // corner brackets
  if (Math.floor(t / 600) % 2) rect(x0 + 8, y0 + 8, 3, 3, '#ff5a4d');
  ptext('INCOMING TRANSMISSION', x0 + 16, y0 + 7, '#4a8fb0', 1); ptext('10 FEB 2009', x0 + w - 8, y0 + 7, '#4a8fb0', 1, 'right');
  rect(x0 + 8, y0 + 19, w - 16, 1, PAL.crtMd);
  ptext('LEVEL 1', 240, y0 + 27, PAL.amber, 4, 'center', true);
  ptext('DEBRIS CLOUD', 240, y0 + 58, '#ffffff', 2, 'center', true);
  ptext('IRIDIUM 33 AND COSMOS 2251 HAVE COLLIDED', 240, y0 + 78, '#7fdcff', 1, 'center');
  rect(x0 + 8, y0 + 90, w - 16, 1, PAL.crtMd);
  BRIEF_ROWS.forEach((r, i) => { const y = y0 + 98 + i * 12; ptext(r[0], x0 + 14, y, r[1], 1, 'left', true); ptext(r[2], x0 + 56, y, '#cfe6f2', 1, 'left'); });
  if (Math.floor(t / 500) % 2) ptext('[ENTER] LAUNCH      [V] SHIP BAY', 240, y0 + 138, '#ffffff', 1, 'center', true);
}
// the title card that wipes across the glass at the start of a level
function drawCard(t) {
  if (!lvlCard) return; const age = performance.now() - lvlCard.t, T = lvlCard.ms; if (age > T) { lvlCard = null; return; }
  const a = age < 350 ? age / 350 : age > T - 600 ? (T - age) / 600 : 1, bandH = Math.round(46 * a), cy = 118;
  rect(0, cy - bandH, W, bandH * 2, 'rgba(0,4,10,' + (0.72 * a) + ')'); rect(0, cy - bandH, W, 1, PAL.amber); rect(0, cy + bandH - 1, W, 1, PAL.amber);
  if (a < 0.6) return;
  const isBoss = lvlCard.n === 'LEVEL 2', hot = isBoss ? '#ff6a5a' : PAL.amber;
  ptext(lvlCard.n, 240, cy - 34, hot, 1, 'center', true);
  ptext(lvlCard.title, 240, cy - 20, '#ffffff', lvlCard.title.length > 18 ? 2 : 3, 'center', true);
  ptext(lvlCard.sub, 240, cy + 12, isBoss ? '#ff9a8a' : '#7fdcff', 1, 'center', true);
}
function drawOverlay() {
  const t = performance.now();
  if (state === 'brief') drawBrief(t);
  else if (state === 'win' || state === 'dead') {
    const r = result, ok = state === 'win', lines = [ok ? 'ALL HAZARDS CLEARED' : 'HULL BREACHED. YOU DIED.', 'SHOT ' + r.shot + ' OF ' + r.total + ' PIECES  (' + Math.round(r.pct * 100) + '%)', 'COINS +' + (r.coins + r.bonus) + (r.bonus ? '  (BONUS ' + r.bonus + ')' : ''), 'HULL LEFT ' + r.hull + '%'];
    overlayPanel(lines, 'PRESS ENTER TO FLY AGAIN', ok ? (r.pct >= 0.999 ? '100% CLEAN' : 'MISSION COMPLETE') : 'MISSION FAILED', ok ? PAL.ok : PAL.alert);
  } else if (state === 'play') drawCard(t);
}
function drawChaseHud(t) {                                              // chase and side views: no cockpit, just the glass with a slim instrument strip
  ctx.clearRect(0, 0, W, H); ctx.imageSmoothingEnabled = false;
  drawBeams(); drawSkyHud(); drawHud(t);
  rect(6, 262, 96, 32, 'rgba(4,10,18,.72)'); ctx.strokeStyle = PAL.crtMd; ctx.strokeRect(6.5, 262.5, 95, 31);
  const hp = clamp(ship.hull / 100, 0, 1), hn = Math.round(hp * 12), tn = Math.round(clamp(ship.heat, 0, 1) * 12), sn = Math.round(clamp(ship.vel.length() / 66, 0, 1) * 12);
  ptext('HULL', 10, 266, PAL.crt); segBar(30, 265, hn, f => hp < 0.3 ? PAL.alert : PAL.crt); ptext('HEAT', 10, 275, PAL.crt); segBar(30, 274, tn, f => f > 0.75 ? PAL.alert : PAL.lamp); ptext('SPD', 10, 284, PAL.crt); segBar(30, 283, sn, f => f > 0.8 ? PAL.lamp : PAL.crt);
  ptext(POVS[povMode] + ' VIEW  C: CHANGE', 472, 6, '#8cc4ff', 1, 'right', true);
  drawEffects(t);
}
function showBrief() { if (state === 'play') { state = 'brief'; firing = false; boost = false; } }
function drawCockpit(t) {
  ctx.clearRect(0, 0, W, H); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(glassCanvas, 0, 0);
  drawBeams(); drawSkyHud(); drawHud(t); drawHoloProjection(t); drawMapProjection(t);
  ctx.drawImage(staticCanvas, 0, 0);
  const f = Math.max(0, 1 - (performance.now() - flashT) / 160);
  if (f > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = f * 0.15; ctx.drawImage(flashCanvas, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  drawGuns(); drawEnv(t); drawComm(t); drawRadar(t); drawDash(t); drawVduFrame(t);
  drawPilotSprite(t);
  drawEffects(t);
}
