// ============================================================ ASTRA-9 Mk2: the player's ship, in real metres (about 18 m long, 16 m across the vanes)
// Designed from the cockpit outward so the outside matches the inside: the same blue-steel plating, orange identification lines and hazard stripes, rivet rows, the long cannon
// arms on shoulder pivots that you see from the seat, and a glass canopy held by two angled pillars. Forward is -z, up is +y, the vanes are along x.
// Built in named SECTIONS (hull, canopy, gunL, gunR, engL, engR, engC, finL, finR, wingL, wingR) so the dash hologram can colour each one by its own state.
const SI = { dk: 0x121b27, s1: 0x1c2837, s2: 0x293749, s3: 0x384a60, s4: 0x4d627c, s5: 0x6b83a0, s6: 0x93a9c2, s7: 0xc2d2e4 };      // the cockpit's steel ramp, dark to light
const ORG = 0xe08435, ORG2 = 0xa9561c, ORG3 = 0xffb866, GLASS = 0x3b87e0, LAMP = 0xff3b2a, EMBERC = 0xffb866;
// a flat plate from a plan-view outline [x, z] in metres, between heights y0 and y1 (extruded upward)
function plate(pts, y0, y1, hex) {
  const sh = new THREE.Shape(); pts.forEach(([x, z], i) => i ? sh.lineTo(M(x), -M(z)) : sh.moveTo(M(x), -M(z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: M(y1 - y0), bevelEnabled: false }); g.rotateX(-Math.PI / 2);
  return C(g, hex, 0, M(y0), 0);
}
const mtz = (rFront, rBack, len, hex, x, y, z, seg) => C(new THREE.CylinderGeometry(M(rBack), M(rFront), M(len), seg || 10), hex, M(x || 0), M(y || 0), M(z || 0), [Math.PI / 2, 0, 0]);   // taper along z: rFront at -z
const scalePts = (pts, k) => pts.map(([x, z]) => [x * k, z]);
function hazard(x, y, z, n, w, d, dir) {                 // a run of orange / dark warning stripes along x
  const p = []; for (let k = 0; k < n; k++) p.push(mb(w, 0.1, d, k % 2 ? SI.dk : ORG, x + k * w * (dir || 1), y, z)); return p;
}
const HULL_PLAN = [[-1.3, -7], [1.3, -7], [2.9, -3.4], [4.2, -0.2], [4.5, 4], [3.7, 8.6], [-3.7, 8.6], [-4.5, 4], [-4.2, -0.2], [-2.9, -3.4]];
function clipHalf(pts) {                                   // Sutherland-Hodgman: keep the part of an outline with x <= 0 (the cutaway keeps the -x half)
  const out = []; for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], ain = a[0] <= 0, bin = b[0] <= 0;
    if (ain) out.push(a); if (ain !== bin) { const t = (0 - a[0]) / (b[0] - a[0]); out.push([0, a[1] + (b[1] - a[1]) * t]); }
  } return out;
}
function hullPlates(half) {
  const f = half ? clipHalf : (p => p);
  const P = [plate(f(HULL_PLAN), -0.9, -0.3, SI.s1), plate(f(scalePts(HULL_PLAN, 0.96)), -0.3, 0.7, SI.s4),
    plate(f([[-0.9, -5.6], [0.9, -5.6], [2.3, -2.6], [3.1, 1], [3.1, 5.2], [-3.1, 5.2], [-3.1, 1], [-2.3, -2.6]]), 0.7, 1.2, SI.s5),
    plate(f([[-0.55, -3.4], [0.55, -3.4], [1.1, 0], [1.1, 6.4], [-1.1, 6.4], [-1.1, 0]]), 1.2, 1.7, SI.s6)];
  P.push(...hazard(-1.5, 1.25, -2.9, 6, 0.5, 0.7), mb(6, 0.05, 0.07, SI.dk, 0, 1.23, 1.4), mb(6, 0.05, 0.07, SI.dk, 0, 1.23, 3.4), mb(6, 0.05, 0.07, SI.dk, 0, 1.23, 5.0));                  // warning stripes, panel seams
  for (let k = 0; k < 7; k++) for (const s of [-1, 1]) if (!half || s < 0) P.push(mb(0.2, 0.14, 0.2, SI.s7, s * 3.95, 0.8, -1.2 + k * 1.2));              // rivet row down each shoulder
  P.push(mb(3.2, 0.1, 0.35, ORG, 0, 0.74, -5.1), mb(0.35, 0.1, 5.0, ORG2, 0, 1.73, 2.6), mtz(0.12, 0.4, 2.7, SI.s4, 0, 0.1, -8.4, 6), C(new THREE.SphereGeometry(M(0.42), 8, 5), SI.s2, 0, M(0.1), M(-7.7)));   // nose stripe, spine stripe, sensor probe
  P.push(mcy(0.6, 0.15, 0.3, SI.s7, 0, 2.15, 6.2, 10), mb(0.12, 0.8, 0.12, SI.s5, 0, 1.8, 6.2), mb(0.07, 2.6, 0.07, SI.s6, -0.9, 2.9, 7.0, [0, 0, 0.1]));                  // dorsal dish and antenna
  return P;
}
function canopyParts(half) {
  const p = [C(new THREE.SphereGeometry(M(1.75), 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1.55), GLASS, 0, M(1.2), M(-2.6)), mb(3.6, 0.35, 4.4, SI.s3, 0, 1.12, -2.6)];
  for (const s of [-1, 1]) if (!half || s < 0) p.push(mb(0.34, 1.7, 0.34, SI.s3, s * 1.45, 1.9, -1.4, [0.35, 0, -s * 0.32]), mb(0.34, 1.5, 0.34, SI.s3, s * 1.2, 1.8, -4.1, [-0.5, 0, -s * 0.22]), mb(0.1, 0.14, 0.12, ORG, s * 1.45, 2.7, -1.3));
  p.push(mb(2.9, 0.34, 0.4, SI.s4, 0, 2.55, -2.4), mb(2.4, 0.5, 1.9, SI.s5, 0, 1.55, 0.2));                                    // canopy header, rear hood
  return p;
}
function cannon(s) {                          // one laser cannon: shoulder pivot, breech, long tapering barrel with orange cooling rings, slotted muzzle brake
  const px = s * 4.35, parts = [];
  parts.push(mb(1.9, 1.2, 2.6, SI.s2, s * 3.6, 0, -1.6), mcy(1.15, 1.25, 0.5, SI.s3, px, -0.45, -1.5, 8), C(new THREE.SphereGeometry(M(0.95), 9, 6), SI.s5, M(px), M(0.15), M(-1.5)), mcy(0.5, 0.5, 0.16, SI.dk, px, 1.12, -1.5, 8));   // bracket, mount ring, pivot ball
  const arm = [mb(1.5, 1.4, 2.6, SI.s3, px, 0.1, -2.9), mb(1.7, 0.4, 2.0, SI.s4, px, 0.85, -2.9), mtz(0.34, 0.58, 8.6, SI.s5, px, 0.1, -8.0, 10), mtz(0.7, 0.7, 2.6, SI.s2, px, 0.1, -4.5, 8), mb(0.22, 0.3, 6.4, SI.s6, px, 0.72, -7.4)];
  for (let k = 0; k < 4; k++) arm.push(mtz(0.52 - k * 0.05, 0.52 - k * 0.05, 0.26, ORG, px, 0.1, -5.7 - k * 1.45, 10));
  for (let k = 0; k < 3; k++) arm.push(mtz(0.46, 0.46, 0.22, SI.dk, px, 0.1, -11.1 - k * 0.3, 10));
  arm.push(mtz(0.2, 0.2, 0.18, LAMP, px, 0.1, -12.2, 8), mb(0.3, 0.3, 1.5, SI.s2, px - s * 0.7, -0.5, -3.4));
  parts.push(...pivotParts(arm, [px, 0.15, -1.5], [0.015, s * 0.045, 0]));                                                       // toe-in: the two barrels converge
  return parts;
}
function nacelle(s) {
  const x = s * 3.0, p = [mb(1.7, 0.6, 3.2, SI.s3, s * 2.2, -0.2, 4.6)];
  p.push(mtz(0.55, 1.3, 1.8, SI.s2, x, -0.2, 1.4, 10), mcz(1.3, 6.2, SI.s3, x, -0.2, 5.5, 12), mcz(1.34, 0.5, ORG, x, -0.2, 3.6, 12), mcz(1.34, 0.18, ORG3, x, -0.2, 7.3, 12), mb(0.2, 0.3, 4.6, SI.s6, x, 1.12, 5.2));
  p.push(C(new THREE.CylinderGeometry(M(1.0), M(1.55), M(1.8), 12, 1, true), SI.s1, M(x), M(-0.2), M(9.3), [Math.PI / 2, 0, 0]), mtz(0.85, 0.85, 0.1, EMBERC, x, -0.2, 8.75, 12));
  return p;
}
function fin(s) { return [mb(0.28, 3.2, 2.8, SI.s4, s * 3.0, 2.0, 7.0, [0, 0, -s * 0.33]), mb(0.3, 0.55, 1.1, ORG, s * 3.55, 3.5, 7.0, [0, 0, -s * 0.33]), mb(0.3, 0.3, 2.9, SI.s2, s * 3.0, 0.5, 7.0)]; }
function vane(s) {                                           // short radiator vane with a hazard-striped tip
  const pts = s > 0 ? [[3.9, -0.8], [7.9, 2.2], [7.9, 4.9], [3.9, 4.3]] : [[-3.9, 4.3], [-7.9, 4.9], [-7.9, 2.2], [-3.9, -0.8]];
  const p = [plate(pts, -0.15, 0.15, SI.s4), plate(pts.map(([x, z]) => [x * 0.98, z * 0.97]), 0.15, 0.3, SI.s3), mb(0.3, 0.34, 2.8, ORG, s * 7.9, 0, 3.5)];
  for (let k = 0; k < 4; k++) p.push(mb(3.4, 0.08, 0.1, SI.dk, s * 5.9, 0.32, 0.6 + k * 1.0, [0, s * -0.55, 0]));
  p.push(mb(0.5, 0.5, 0.6, LAMP, s * 7.9, 0, 5.0), mb(0.5, 0.5, 0.5, SI.s2, s * 7.5, 0, -0.1));                                  // nav lamp, RCS block
  return p;
}
function engCentre() { return [mb(3.0, 1.7, 3.0, SI.s2, 0, 0.1, 8.0), C(new THREE.CylinderGeometry(M(1.0), M(1.5), M(1.8), 12, 1, true), SI.s1, 0, M(0.1), M(9.95), [Math.PI / 2, 0, 0]), mtz(0.8, 0.8, 0.1, EMBERC, 0, 0.1, 9.4, 12)]; }
// A single-seat craft is a few metres long (a Soyuz is 7.5 m): the model is drawn in the sizes above, then scaled by SHIP_K to about 8 m, so the ISS (109 m) is more than thirteen of it end to end.
const SHIP_K = 0.45;
const kScale = (parts, k, gk) => parts.map(([g, h, x, y, z, r]) => { g.scale(gk || k, gk || k, gk || k); return [g, h, (x || 0) * k, (y || 0) * k, (z || 0) * k, r]; });
const SHIP_SEC = () => { const s = { hull: hullPlates(false), canopy: canopyParts(false), gunL: cannon(-1), gunR: cannon(1), engL: nacelle(-1), engR: nacelle(1), engC: engCentre(), finL: fin(-1), finR: fin(1), wingL: vane(-1), wingR: vane(1) }; for (const n in s) s[n] = kScale(s[n], SHIP_K); return s; };
SAT_PARTS.ship = () => Object.values(SHIP_SEC()).flat();

// ---- cutaway: the same craft opened along its centreline (the +x half removed) so you see the cockpit as the pilot does, then the systems behind it
const SUIT = 0xdfe6ef, SLEEVE = 0x1f5fb4, SCREEN_G = 0x46e07a;
function shipCutSections() {
  const cockpit = [], pilot = [], reactor = [], tanks = [], feed = [];
  // cockpit, as seen from the seat: sloped dash with its amber lip, screens, dials, the stick and throttle
  cockpit.push(mb(3.4, 0.2, 4.0, SI.s2, -0.1, -0.35, -2.6), mb(3.2, 0.7, 1.3, SI.s3, -0.1, 0.1, -4.7, [-0.45, 0, 0]), mb(3.2, 0.06, 0.12, ORG3, -0.1, 0.42, -4.35, [-0.45, 0, 0]));
  cockpit.push(mb(0.9, 0.05, 0.5, SCREEN_G, -1.1, 0.34, -4.5, [-0.45, 0, 0]), mb(0.9, 0.05, 0.5, 0x3b87e0, 0.9, 0.34, -4.5, [-0.45, 0, 0]), mb(0.5, 0.05, 0.4, ORG, -0.1, 0.36, -4.4, [-0.45, 0, 0]));
  cockpit.push(mcy(0.28, 0.32, 0.4, SI.s1, 0, 0.2, -3.2, 10), mtz(0.18, 0.3, 1.0, SI.s3, 0, 0.7, -3.2, 8), mcy(0.34, 0.2, 0.9, SI.s2, 0, 0.55, -3.2, 8), C(new THREE.SphereGeometry(M(0.24), 8, 5), SI.s4, 0, M(1.05), M(-3.2)), mb(0.14, 0.1, 0.14, LAMP, -0.1, 1.28, -3.35));   // hand controller
  cockpit.push(mb(0.7, 0.7, 1.2, SI.s3, -1.2, 0.0, -2.9), mb(0.14, 0.9, 0.14, SI.s6, -1.2, 0.8, -3.1, [0.2, 0, 0]), mcy(0.15, 0.15, 0.2, LAMP, -1.2, 1.28, -3.0, 8));         // throttle quadrant (left of the stick)
  cockpit.push(mb(0.34, 1.9, 0.34, SI.s3, -1.45, 1.9, -1.4, [0.35, 0, 0.32]), mb(1.4, 0.45, 1.0, SI.s3, -0.1, 2.0, -1.8), mcy(0.55, 0.55, 0.1, SI.dk, -0.1, 1.74, -2.0, 14), mcy(0.45, 0.45, 0.12, SCREEN_G, -0.1, 1.72, -2.0, 14));   // pillar, overhead console with the radar disc
  // pilot in the white EVA suit with blue sleeves, gold visor, hands reaching for the stick
  pilot.push(mb(1.4, 0.5, 1.2, SI.s4, 0, -0.1, -1.0), mb(1.4, 1.7, 0.3, SI.s4, 0, 0.9, -0.1, [-0.2, 0, 0]));                                                         // seat and back
  pilot.push(mb(1.0, 1.4, 0.7, SUIT, 0, 0.8, -1.1), mb(0.45, 0.45, 1.5, SUIT, -0.35, -0.1, -2.0), mb(0.45, 0.45, 1.5, SUIT, 0.35, -0.1, -2.0), mb(0.4, 0.4, 0.5, SI.s5, -0.35, -0.35, -2.9), mb(0.4, 0.4, 0.5, SI.s5, 0.35, -0.35, -2.9));   // torso, legs, boots
  pilot.push(mb(0.34, 0.34, 1.5, SLEEVE, -0.65, 1.2, -2.0, [0.1, 0, 0]), mb(0.34, 0.34, 1.5, SLEEVE, 0.65, 1.2, -2.0, [0.1, 0, 0]), C(new THREE.SphereGeometry(M(0.55), 10, 6), SUIT, 0, M(1.9), M(-1.15)), C(new THREE.SphereGeometry(M(0.45), 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-1.45), 0xffd37a, 0, M(1.92), M(-1.55)));   // arms, helmet, visor
  // behind the cockpit: reactor and capacitor core, propellant, coolant
  reactor.push(mcz(1.1, 2.6, ORG, 0, 0.2, 2.2, 14), mcz(1.15, 0.2, SI.s3, 0, 0.2, 0.8, 14), mcz(1.15, 0.2, SI.s3, 0, 0.2, 3.6, 14), mcz(0.5, 2.8, ORG3, 0, 0.2, 2.2, 8), mb(2.2, 0.2, 0.4, SI.s2, 0, -0.55, 2.2));
  tanks.push(mcz(0.6, 2.8, SI.s7, -1.6, 0.9, 5.6, 10), mcz(0.6, 2.8, SI.s7, 1.0, 0.9, 5.6, 10), mcz(0.55, 2.4, 0x8cc4ff, 0, -0.6, 5.6, 10), mb(3.0, 1.2, 2.4, SI.s2, 0, 0.1, 8.0), mb(0.2, 0.2, 2.0, SI.s6, -0.4, 0.2, 7.0));
  feed.push(mb(0.2, 0.2, 4.4, 0xffd060, -1.5, -0.1, -0.2), mb(1.8, 0.2, 0.2, 0xffd060, -2.4, -0.2, -2.6), mb(0.6, 0.6, 1.4, LAMP, -3.4, -0.2, -2.6), mb(0.2, 0.2, 2.6, 0xffd060, -0.6, -0.5, 1.2));          // conduits to the cannon root
  const shell = hullPlates(true), outer = [...canopyParts(true).slice(1), ...cannon(-1), ...nacelle(-1), ...vane(-1), ...fin(-1), ...engCentre()];      // only the far side's outer parts, so the near side is open to the eye
  const sec = { shell, cockpit, pilot, reactor, tanks, feed, outer }; for (const n in sec) sec[n] = n === 'pilot' ? kScale(sec[n], SHIP_K, 0.62) : kScale(sec[n], SHIP_K);   // the pilot stays human-sized against a small craft
  return sec;
}
SAT_PARTS.shipcut = () => Object.values(shipCutSections()).flat();

LABS.ship = US => { const b = finishMesh(cachedMerge('sat|ship', SAT_PARTS.ship, true), US); return { grp: b.grp, mats: b.mats, metres: 5.5, title: 'ASTRA-9 MK2 EXTERIOR', info: ['8 M LONG, 7 M ACROSS: ONE PILOT', 'ISS IS 109 M'] }; };
LABS.shipcut = US => { const b = finishMesh(cachedMerge('sat|shipcut', SAT_PARTS.shipcut, true), US); b.mats.forEach(m => m.side = THREE.DoubleSide); return { grp: b.grp, mats: b.mats, metres: 5.5, title: 'ASTRA-9 MK2 CUTAWAY', info: ['COCKPIT, PILOT, REACTOR, TANKS', 'GOLD FEED TO THE CANNONS'] }; };
