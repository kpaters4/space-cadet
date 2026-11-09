// ============================================================ real satellites (friendly: do not shoot them)
// Real craft with real orbit altitudes and inclinations. The five working satellites near the debris are placed relative to the ship (phases are illustrative,
// as exact positions for that minute are not in the data); the Iridium constellation, GPS and geostationary craft follow real orbital planes.
const SATS = [];
function orbitFromElems(r, incDeg, raanDeg, phi0) {
  const ci = Math.cos(incDeg * D2R), si = Math.sin(incDeg * D2R), co = Math.cos(raanDeg * D2R), so = Math.sin(raanDeg * D2R);
  const e = (xp, yp) => new V3(xp * co - yp * ci * so, yp * si, -(xp * so + yp * ci * co));    // equatorial (x,y,z) -> three (x,z,-y)
  return { u: e(1, 0), v: e(0, 1), r, phi: phi0 * D2R };
}
function addSat(o) {
  const s = { friendly: true, name: o.name, desc: o.desc, kind: o.kind, radius: o.radius, scale: o.scale, u: o.u.clone(), v: o.v.clone(), r: o.r, phi: o.phi, w: Math.sqrt(GM / (o.r * o.r * o.r)),
    posIn: new V3(), pos: new V3(), alt: Math.round((o.r - R) * 10), inc: o.inc, mesh: null, mats: [], flash: 0, marker: !!o.marker, inst: o.inst };
  if (o.mesh) { const b = satMesh(o.kind, U); b.grp.scale.setScalar(o.scale); scene.add(b.grp); s.mesh = b.grp; s.mats = b.mats; }
  SATS.push(s); return s;
}
// the five working satellites that share the neighbourhood: name, role, model, altitude km, inclination, model scale, hit radius, offset along track and across (units of 10 km)
const NEAR = [['ISS', 'SPACE STATION', 'iss', 350, 51.64, 1, 20, 190, 90], ['HUBBLE', 'SPACE TELESCOPE', 'hubble', 559, 28.47, 1, 4, -190, -120],
  ['ENVISAT', 'EARTH OBSERVER', 'envisat', 790, 98.55, 1, 6, -100, 150], ['TERRA', 'EARTH OBSERVER', 'terra', 705, 98.2, 1, 5, -260, -50], ['AQUA', 'EARTH OBSERVER', 'aqua', 705, 98.2, 1, 6, -170, -80]];
const NEAR_SATS = NEAR.map(([name, desc, kind, alt, inc, scale, radius]) => addSat({ name, desc, kind, scale, radius, inc, mesh: true, r: R + alt / 10, ...orbitFromElems(R + alt / 10, inc, 0, 0) }));
function placeNearSats() {        // call at launch: the orbiting frame has turned since load, so work in inertial coordinates
  const qi = qInv.copy(envQ).invert();
  NEAR.forEach(([name, desc, kind, alt, inc, scale, radius, along, cross], i) => {
    const world = new V3().copy(S0h).multiplyScalar(r0 + (alt - 790) / 10).addScaledVector(T0h, along).addScaledVector(N0, cross);
    const posIn = world.setLength(r0 + (alt - 790) / 10).applyQuaternion(qi), r = posIn.length(), up = posIn.clone().divideScalar(r);
    const east = new V3().crossVectors(AY, up).normalize(), north = new V3().crossVectors(up, east), lat = Math.asin(clamp(up.y, -1, 1));
    const az = Math.asin(clamp(Math.cos(inc * D2R) / Math.cos(lat), -1, 1)), a2 = i % 2 ? Math.PI - az : az;      // real inclination; alternate ascending / descending passes
    const vel = north.clone().multiplyScalar(Math.cos(a2)).addScaledVector(east, Math.sin(a2)), n = new V3().crossVectors(posIn, vel).normalize();
    const s = NEAR_SATS[i]; s.u.copy(up); s.v.crossVectors(n, up).normalize(); s.r = r; s.phi = 0; s.w = Math.sqrt(GM / (r * r * r)); s.alt = Math.round((r - R) * 10);
  });
}
// Iridium: 66 craft, six planes 31.6 degrees apart at 780 km, inclination 86.4 (drawn as one instanced mesh)
const IR_N = 66, irMesh = new THREE.InstancedMesh(cachedMerge('inst|iridium', SAT_PARTS.iridium, false).g, debMat(U, true), IR_N);
irMesh.frustumCulled = false; scene.add(irMesh);
for (let k = 0; k < IR_N; k++) { const pl = Math.floor(k / 11), j = k % 11; addSat({ name: 'IRIDIUM ' + (k + 1), desc: 'COMMS CONSTELLATION', kind: 'iridium', scale: 1, radius: 2, inc: 86.4, inst: k, r: R + 78, ...orbitFromElems(R + 78, 86.4, 30 + pl * 31.6, j * 360 / 11 + pl * 16.4) }); }
// GPS (20,180 km, 55 degrees) and geostationary craft (35,786 km) are far too distant to see as shapes, so they are markers you can aim at
for (let k = 0; k < 12; k++) addSat({ name: 'GPS IIR-' + (k + 1), desc: 'NAVIGATION', kind: 'gps', scale: 1, radius: 3, inc: 55, marker: true, r: R + 2018, ...orbitFromElems(R + 2018, 55, (k % 6) * 60 + 20, Math.floor(k / 6) * 180 + (k % 6) * 25) });
[['METEOSAT 9', 0], ['GOES 12', -75], ['GOES 11', -135], ['INSAT 3A', 93.5], ['FY-2C', 105], ['MTSAT 1R', 140]].forEach(([name, lon]) => addSat({ name, desc: 'GEOSTATIONARY WEATHER', kind: 'geo', scale: 1, radius: 3, inc: 0, marker: true, r: R + 3579, ...orbitFromElems(R + 3579, 0, 0, lon + BAKED.gmst / D2R) }));
const markerSats = SATS.filter(s => s.marker), mkPos = new Float32Array(markerSats.length * 3);
const mkGeo = new THREE.BufferGeometry(); mkGeo.setAttribute('position', new THREE.BufferAttribute(mkPos, 3));
const mkPts = new THREE.Points(mkGeo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, color: 0x66ddff })); mkPts.frustumCulled = false; scene.add(mkPts);
const _m = new THREE.Matrix4(), _x = new V3(), _y = new V3(), _z = new V3(), _sc = new V3();
function updateSats(dt) {
  for (const s of SATS) {
    s.phi += s.w * dt;
    s.posIn.copy(s.u).multiplyScalar(Math.cos(s.phi) * s.r).addScaledVector(s.v, Math.sin(s.phi) * s.r);
    s.pos.copy(s.posIn).applyQuaternion(envQ);
    if (s.mesh || s.inst !== undefined) {          // nadir-pointing: x along the track, y up, z across
      _y.copy(s.pos).normalize(); _x.copy(s.u).multiplyScalar(-Math.sin(s.phi)).addScaledVector(s.v, Math.cos(s.phi)).applyQuaternion(envQ); _z.crossVectors(_x, _y); _x.crossVectors(_y, _z);
      _m.makeBasis(_x, _y, _z);
      if (s.mesh) { s.mesh.position.copy(s.pos); s.mesh.quaternion.setFromRotationMatrix(_m); s.flash = Math.max(0, s.flash - dt * 4); for (const m of s.mats) m.uniforms.uFlash.value = s.flash; }
      else { _m.scale(_sc.set(s.scale, s.scale, s.scale)); _m.setPosition(s.pos); irMesh.setMatrixAt(s.inst, _m); }
    }
  }
  irMesh.instanceMatrix.needsUpdate = true;
  markerSats.forEach((s, i) => { mkPos[i * 3] = s.pos.x; mkPos[i * 3 + 1] = s.pos.y; mkPos[i * 3 + 2] = s.pos.z; }); mkGeo.attributes.position.needsUpdate = true;
}
placeNearSats();
