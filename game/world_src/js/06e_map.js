// ============================================================ right-hand projector: the ground-track map
// Built from the project's own Earth data (BAKED.tex: red = land). Kept deliberately plain so it reads at a glance:
//   solid land (bright by day, dark teal at night), YOU = the white diamond with a dotted track ahead, ISS in cyan, and the three most dangerous falling pieces as numbered red / amber crosses
//   at the spot where each will hit the atmosphere. The numbers match the arrows on the glass, and the legend underneath gives the seconds to go.
const MAPH = { x: 344, y: 172, w: 130, h: 58 }, MAP_C = { x: 420, y: 226 };
const MW = 124, MH = 40, MX = MAPH.x + 3, MY = MAPH.y + 8, LATMAX = 72;                    // latitudes +-72 degrees are shown; every fall and the ISS orbit stay inside
const mapLandF = new Uint8Array(MW * MH);
{ const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = MW * 4; c.height = MH * 4; const g = c.getContext('2d', { willReadFrequently: true });
    const sy = (90 - LATMAX) / 180 * im.naturalHeight, sh = 2 * LATMAX / 180 * im.naturalHeight; g.drawImage(im, 0, sy, im.naturalWidth, sh, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { let r = 0; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) r += d[((y * 4 + j) * c.width + x * 4 + i) * 4]; mapLandF[y * MW + x] = r / 16 > 100 ? 1 : 0; }
    mapDirty = 1e9; }; im.src = BAKED.tex; }
const mapLayer = document.createElement('canvas'); mapLayer.width = MW; mapLayer.height = MH; const mapG = mapLayer.getContext('2d');
let mapDirty = 1e9, mapT = 0;
const _mq = new Q4(), _mv = new V3(), _sv = new V3();
function latLonIn(pin, dGame) {                                                           // inertial direction -> [lat, lon] in degrees, dGame seconds from now (the Earth turns under it)
  const a = earth.rotation.y + 7.2921159e-5 * TS * (dGame || 0), c = Math.cos(a), s = Math.sin(a), x = pin.x * c - pin.z * s, z = pin.x * s + pin.z * c, r = pin.length() || 1;
  return [Math.asin(clamp(pin.y / r, -1, 1)) / D2R, Math.atan2(-z, x) / D2R];
}
const latLonW = pw => latLonIn(_mv.copy(pw).applyQuaternion(_mq.copy(envQ).invert()), 0);
const mapXY = (lat, lon) => [MX + (lon + 180) / 360 * MW, MY + (LATMAX - clamp(lat, -LATMAX, LATMAX)) / (2 * LATMAX) * MH];
function mapBuild() {                                                                      // land and the day / night line: cached, redone about once a second
  const sun = _sv.copy(U.uSun.value).applyQuaternion(_mq.copy(envQ).invert()), a = earth.rotation.y, c = Math.cos(a), s = Math.sin(a), sl = [sun.x * c - sun.z * s, sun.y, sun.x * s + sun.z * c];
  const img = mapG.createImageData(MW, MH), d = new Uint32Array(img.data.buffer);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const lat = (LATMAX - (y + 0.5) / MH * 2 * LATMAX) * D2R, lon = ((x + 0.5) / MW * 360 - 180) * D2R, dayDot = Math.cos(lat) * Math.cos(lon) * sl[0] + Math.sin(lat) * sl[1] + (-Math.cos(lat) * Math.sin(lon)) * sl[2], night = dayDot < 0, i = y * MW + x;
    d[i] = (mapLandF[i] ? (night ? 0xff6a7a1a : 0xffd8c83a) : (night ? 0xff2a1208 : 0xff4a2a10)) >>> 0;       // ABGR: bright cyan land by day, dark teal at night; navy sea
  }
  mapG.putImageData(img, 0, 0);
}
function drawMapProjection(t) {
  const now = performance.now(); if (now - mapT > 900 || mapDirty) { mapT = now; mapDirty = 0; mapBuild(); }
  const flick = Math.floor(t / 90) % 3, cx = MAP_C.x;
  ctx.fillStyle = 'rgba(88,214,255,' + (0.06 + (flick === 0 ? 0.03 : 0)) + ')'; ctx.beginPath(); ctx.moveTo(cx - 8, MAP_C.y); ctx.lineTo(cx + 8, MAP_C.y); ctx.lineTo(MAPH.x + MAPH.w - 2, MAPH.y + 6); ctx.lineTo(MAPH.x + 2, MAPH.y + 6); ctx.closePath(); ctx.fill();
  rect(MAPH.x, MAPH.y + 6, MAPH.w, MH + 14, 'rgba(2,12,22,.8)'); ctx.drawImage(mapLayer, MX, MY);
  ctx.fillStyle = 'rgba(160,230,255,.22)'; for (let lon = -120; lon <= 120; lon += 60) ctx.fillRect(Math.round(mapXY(0, lon)[0]), MY, 1, MH); ctx.fillRect(MX, Math.round(mapXY(0, 0)[1]), MW, 1);   // meridians every 60 degrees, the equator
  const bc = '#58d6ff'; ctx.strokeStyle = bc; ctx.lineWidth = 1; ctx.strokeRect(MX - 0.5, MY - 0.5, MW + 1, MH + 1);
  // the ship's track ahead, dotted, with the ship
  const pin = new V3().copy(ship.pos).applyQuaternion(_mq.copy(envQ).invert()), rq = new Q4(), tp = new V3(); let last = null;
  for (let k = 0; k <= 40; k++) { const tau = k * 5; rq.setFromAxisAngle(N0, W0 * tau); tp.copy(pin).applyQuaternion(rq); const [la, lo] = latLonIn(tp, tau), [x, y] = mapXY(la, lo); if (last && Math.abs(x - last[0]) < MW / 2 && k % 2 === 0) pline(last[0], last[1], x, y, '#ffffff'); last = [x, y]; }
  for (const p of ALIVE) { const [la, lo] = latLonW(p.pos), [x, y] = mapXY(la, lo); rect(x, y, 1, 1, '#8a6a3a'); }                                    // debris: faint
  const iss = SATS.find(s => s.kind === 'iss'); if (iss) { const [la, lo] = latLonW(iss.pos), [x, y] = mapXY(la, lo); rect(x - 1, y - 1, 3, 3, '#58d6ff'); ptext('ISS', x + 3, y - 2, '#58d6ff', 1, 'left', true); }
  const [sla, slo] = latLonW(ship.pos), [shx, shy] = mapXY(sla, slo), sx = Math.round(shx), sy2 = Math.round(shy), on = Math.floor(t / 350) % 2;
  rect(sx - 1, sy2 - 3, 3, 7, '#000'); rect(sx - 3, sy2 - 1, 7, 3, '#000'); rect(sx, sy2 - 2, 1, 5, '#fff'); rect(sx - 2, sy2, 5, 1, '#fff'); if (on) pcircle(sx, sy2, 4, '#ffffff');       // YOU: a white cross
  ptext('YOU', clamp(sx + 5, MX, MX + MW - 14), clamp(sy2 - 2, MY, MY + MH - 6), '#ffffff', 1, 'left', true);
  const cols = ['#ff5a4d', '#ffd36b', '#9ab0c8'], leg = [];                                                                                     // the three worst: where they will land
  THREATS.slice(0, 3).forEach((th, i) => {
    if (th.kind !== 'EARTH') { leg.push([i, 'HIT ' + Math.round(th.t) + 'S']); return; }
    const p = th.p, dt = th.t, phi = p.phi + Math.sqrt(GM / (p.r * p.r * p.r)) * dt, fut = new V3().copy(p.u).multiplyScalar(Math.cos(phi)).addScaledVector(p.v, Math.sin(phi)), [la, lo] = latLonIn(fut, dt), [x, y] = mapXY(la, lo), c = cols[i], xr = Math.round(x), yr = Math.round(y);
    pline(xr - 3, yr - 3, xr + 3, yr + 3, '#000'); pline(xr - 3, yr + 3, xr + 3, yr - 3, '#000'); pline(xr - 2, yr - 2, xr + 2, yr + 2, c); pline(xr - 2, yr + 2, xr + 2, yr - 2, c);
    if (i === 0 && Math.floor(t / 220) % 2) pcircle(xr, yr, 5, c);
    ptext(String(i + 1), clamp(xr + 4, MX, MX + MW - 5), clamp(yr - 7, MY, MY + MH - 6), c, 1, 'left', true); leg.push([i, 'EARTH ' + Math.round(dt) + 'S']);
  });
  ptext('GROUND TRACK', MAPH.x + 2, MAPH.y, '#7fdcff', 1, 'left', true);
  ptext(Math.abs(Math.round(sla)) + (sla >= 0 ? 'N ' : 'S ') + Math.abs(Math.round(slo)) + (slo >= 0 ? 'E' : 'W'), MAPH.x + MAPH.w - 3, MAPH.y, '#ffffff', 1, 'right', true);
  let lx = MAPH.x + 3; for (const [i, s] of leg) { ptext(String(i + 1), lx, MY + MH + 3, cols[i], 1, 'left', true); ptext(s, lx + 5, MY + MH + 3, cols[i], 1, 'left', true); lx += 5 + twidth(s, 1) + 5; }
  if (!leg.length) ptext('NO FALLS DUE', MAPH.x + 3, MY + MH + 3, '#58d6ff', 1, 'left', true);
}
