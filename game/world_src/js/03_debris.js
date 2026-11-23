// ============================================================ retro debris and satellites: flat-shaded, stepped light, black outlines, ONE merged mesh per object
const VS_DEB = `attribute vec3 aColor; varying vec3 vN; varying vec3 vWp; varying vec3 vC;
  void main(){ vC = aColor; vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vWp = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
const VS_DEB_I = `attribute vec3 aColor; varying vec3 vN; varying vec3 vWp; varying vec3 vC;
  void main(){ vC = aColor; vN = normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal); vec4 w = modelMatrix*instanceMatrix*vec4(position,1.0); vWp = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
const FS_DEB = `uniform vec3 uSun, uLampP, uLampD; uniform float uSteps, uFlash, uShadowOn, uLampOn, uDark; varying vec3 vN; varying vec3 vWp; varying vec3 vC;
  void main(){
    vec3 n = normalize(vN), L = normalize(uSun); if (!gl_FrontFacing) n = -n;
    float ndl = max(dot(n, L), 0.0);
    float l = uSteps > 0.5 ? floor(ndl*uSteps + 0.5)/uSteps : ndl;
    // Earth's shadow: a cylinder of radius R behind the planet along the sun line. Inside it only faint earthshine lights the craft.
    float s = dot(vWp, L), sh = (uShadowOn > 0.5 && s < 0.0) ? smoothstep(${R*0.985}, ${R*1.015}, length(vWp - L*s)) : 1.0;
    sh *= 1.0 - uDark * 0.9;
    vec3 col = vC * (mix(0.2 - 0.12*uDark, 0.4 + 0.1*n.y, sh) + l*0.85*sh);
    // headlamp: a cone from the ship, bright near it, fading with distance, brighter on faces that look back at the lamp
    vec3 toP = vWp - uLampP; float dl = max(length(toP), 0.001); vec3 ld = toP / dl;
    float cone = smoothstep(0.90, 0.985, dot(ld, uLampD)), att = 1.0 / (1.0 + dl*dl*0.00004), lam = uLampOn * cone * att * (0.3 + 0.7*max(dot(n, -ld), 0.0));
    if (uSteps > 0.5) lam = floor(lam*uSteps + 0.5)/uSteps;
    col += vC * lam * 1.8 * vec3(1.0, 0.96, 0.85);
    col += vec3(0.08,0.13,0.26) * (1.0 - sh) * (0.5 + 0.5*n.y);
    if (uSteps < 0.5) { vec3 V = normalize(cameraPosition - vWp), H = normalize(L + V); col += pow(max(dot(n, H), 0.0), 40.0)*0.45; }
    gl_FragColor = vec4(col + vec3(1.0,0.85,0.5)*uFlash, 1.0);
  }`;
const edgeMat = new THREE.LineBasicMaterial({ color: 0x05070b });
const flatten = g => { g = g.index ? g.toNonIndexed() : g; g.computeVertexNormals(); return g; };
const warp = (g, amt, seed) => {
  const a = g.attributes.position;
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i), y = a.getY(i), z = a.getZ(i), s = Math.sin((x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453), f = 1 + (s - Math.floor(s) - 0.5) * amt;
    a.setXYZ(i, x * f, y * f, z * f);
  }
  return g;
};
// parts = [[geometry, hex colour, x, y, z, [rx, ry, rz]], ...]  ->  one BufferGeometry (positions, flat normals, vertex colours) plus one merged edge-line geometry
function mergeParts(parts, withEdges) {
  const pos = [], nor = [], col = [], epos = [];
  for (const [geo0, hex, x, y, z, rot] of parts) {
    const geo = flatten(geo0);
    geo.applyMatrix4(new THREE.Matrix4().compose(new V3(x || 0, y || 0, z || 0), new Q4().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))), new V3(1, 1, 1)));
    const c = new THREE.Color(hex), a = geo.attributes.position, n = geo.attributes.normal;
    for (let i = 0; i < a.count; i++) { pos.push(a.getX(i), a.getY(i), a.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); col.push(c.r, c.g, c.b); }
    if (withEdges) { const eg = new THREE.EdgesGeometry(geo, 25), ea = eg.attributes.position; for (let i = 0; i < ea.count; i++) epos.push(ea.getX(i), ea.getY(i), ea.getZ(i)); eg.dispose(); }
    geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  let eg = null; if (withEdges && epos.length) { eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(epos, 3)); }
  return { g, eg };
}
const debMat = (US, instanced) => new THREE.ShaderMaterial({ vertexShader: instanced ? VS_DEB_I : VS_DEB, fragmentShader: FS_DEB, uniforms: { uSun: US.uSun, uSteps: US.uSteps, uShadowOn: US.uShadowOn || { value: 0 }, uFlash: { value: 0 }, uLampP: US.uLampP || { value: new V3() }, uLampD: US.uLampD || { value: new V3(0, 0, -1) }, uLampOn: US.uLampOn || { value: 0 }, uDark: US.uDark || { value: 0 } } });

const C = (g, hex, x, y, z, rot) => [g, hex, x, y, z, rot];
const cache = {};
function cachedMerge(key, parts, edges) { return cache[key] || (cache[key] = mergeParts(parts(), edges)); }
const finishMesh = (m, US) => { const mat = debMat(US), grp = new THREE.Group(); grp.add(new THREE.Mesh(m.g, mat)); if (m.eg) grp.add(new THREE.LineSegments(m.eg, edgeMat)); return { grp, mats: [mat] }; };
const satMesh = (kind, US) => finishMesh(cachedMerge('sat|' + kind, SAT_PARTS[kind], true), US || U);

// ---- real debris rows from the merged pool (name, type, size, perigee km, apogee km, reenters within 365 d, days remaining when it fell)
// The two payloads are the actual collision victims; everything else is a real catalogue row.
const DATA = [
  ['IRIDIUM 33', 'PAYLOAD', 'LARGE', 786, 790, 0, null], ['COSMOS 2251', 'PAYLOAD', 'LARGE', 792, 796, 0, null],
  ['CZ-4B R/B', 'ROCKET BODY', 'LARGE', 560, 780, 0, null],
  ['IRIDIUM 33 DEB', 'DEBRIS', 'MEDIUM', 395, 400, 1, 17], ['COSMOS 2251 DEB', 'DEBRIS', 'MEDIUM', 452, 598, 0, null],
  ['FENGYUN 1C DEB', 'DEBRIS', 'MEDIUM', 505, 804, 0, null], ['OBJECT A', 'UNKNOWN', 'MEDIUM', 610, 640, 0, null],
  ['CBERS 1 DEB', 'DEBRIS', 'SMALL', 481, 485, 1, 308], ['COSMOS 2251 DEB', 'DEBRIS', 'SMALL', 503, 537, 1, 183],
  ['RESURS O1 DEB', 'DEBRIS', 'SMALL', 570, 580, 1, 167], ['FENGYUN 1C DEB', 'DEBRIS', 'SMALL', 575, 929, 0, null],
  ['DMSP 5D-2 DEB', 'DEBRIS', 'SMALL', 582, 598, 1, 214]
];
const SIZES = { LARGE: { r: 8, hp: 8, dmg: 18, coin: 20 }, MEDIUM: { r: 5, hp: 4, dmg: 10, coin: 10 }, SMALL: { r: 3.2, hp: 2, dmg: 5, coin: 6 }, SHARD: { r: 1.7, hp: 1, dmg: 0, coin: 3 } };
const KIDS = { LARGE: ['MEDIUM', 'SMALL', 'SMALL'], MEDIUM: ['SMALL', 'SHARD', 'SHARD'], SMALL: ['SHARD', 'SHARD'], SHARD: [] };

// ---- VDU: a live close-up of whatever the reticle is on (debris, planet, Moon or Sun), drawn into a hole in the dash
const VDU = { x: 91, y: 257, w: 54, h: 38 };
const vduScene = new THREE.Scene(); vduScene.background = new THREE.Color(0x031109);
const vduCam = new THREE.PerspectiveCamera(32, VDU.w / VDU.h, 0.1, 100);
const UV = { uSun: { value: new V3(-0.5, 0.6, 0.65).normalize() }, uSteps: { value: 3 } };
let vduObj = null, vduKey = null, vduSpin = true;
function vduSet(t) {
  const key = !t ? null : t.friendly ? 's' + t.name : t.id ? 'p' + t.id : 'b' + t.name;
  if (key === vduKey) return; vduKey = key;
  if (vduObj) { vduScene.remove(vduObj); vduObj = null; }
  if (!t) return;
  if (t.id || t.friendly) {
    const b = t.friendly ? satMesh(t.kind, UV) : buildMesh(t.type, t.size, t.seed, UV, t.name), box = new THREE.Box3().setFromObject(b.grp), s = box.getBoundingSphere(new THREE.Sphere());
    b.grp.scale.setScalar(1.15 / s.radius); b.grp.position.copy(s.center).multiplyScalar(-1.15 / s.radius);
    const wrap = new THREE.Group(); wrap.add(b.grp); vduObj = wrap; vduSpin = true; vduCam.position.set(0, 0.4, 4.6); vduCam.up.set(0, 1, 0); vduCam.lookAt(0, 0, 0);
  } else {
    const L = { value: t.lightIn.clone() };
    const mat = t.kind === 'sun' ? new THREE.ShaderMaterial({ vertexShader: VS_BODY, fragmentShader: FS_SUN, uniforms: { uTime: U.uTime } })
      : new THREE.ShaderMaterial({ vertexShader: VS_BODY, fragmentShader: FS_BODY(ALBEDO[t.kind], t.kind === 'moon' ? MOON_PRE : ''), uniforms: { uLight: L } });
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), mat); m.quaternion.copy(t.quat);
    if (t.kind === 'saturn') {
      const rg = new THREE.RingGeometry(1.24, 2.27, 96, 1); rg.rotateX(-Math.PI / 2);
      m.add(new THREE.Mesh(rg, new THREE.ShaderMaterial({ vertexShader: VS_BODY, fragmentShader: FS_RING, transparent: true, side: THREE.DoubleSide, depthWrite: false,
        uniforms: { uLight: L, uCenter: { value: new V3() }, uRad: { value: 1 } } })));
    }
    vduObj = m; vduSpin = false;
    const dist = t.kind === 'saturn' ? 8 : 4.6;                         // look at it from Earth, north up
    vduCam.position.copy(t.dirIn).multiplyScalar(-dist); vduCam.up.set(0, 1, 0); vduCam.lookAt(0, 0, 0);
  }
  vduScene.add(vduObj);
}
function renderVdu(dt) {
  if (!vduObj) return;
  if (vduSpin) { vduObj.rotation.y += dt * 0.9; vduObj.rotation.x = 0.35; }
  vduCam.aspect = VDU.w / VDU.h; vduCam.updateProjectionMatrix();
  if (isRetro()) {
    const x = VDU.x, y = H - (VDU.y + VDU.h);
    rt.viewport.set(x, y, VDU.w, VDU.h); rt.scissor.set(x, y, VDU.w, VDU.h); rt.scissorTest = true;
    renderer.setRenderTarget(rt); renderer.render(vduScene, vduCam);
    rt.scissorTest = false; rt.viewport.set(0, 0, W, H); rt.scissor.set(0, 0, W, H);
  } else {
    const k = cssW / W, x = VDU.x * k, y = (H - VDU.y - VDU.h) * k, w = VDU.w * k, h = VDU.h * k;
    renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h); renderer.setScissorTest(true);
    renderer.render(vduScene, vduCam);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, cssW, cssH);
  }
}
