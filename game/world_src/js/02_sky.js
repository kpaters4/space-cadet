// ============================================================ the real sky for 10 Feb 2009, 17:00 UT: Earth with real continents, Sun, Moon, planets, stars, Milky Way
const env = new THREE.Group(); scene.add(env);     // everything that is "inertial": rotates as the ship orbits
const D_SKY = 12000;                                // sky bodies sit at this distance, sized by their true angular radius

const maskTex = new THREE.Texture(), maskTexN = new THREE.Texture();      // the same image twice: smooth for hi-res, nearest-neighbour for chunky retro coasts
for (const t of [maskTex, maskTexN]) { t.wrapS = THREE.RepeatWrapping; t.generateMipmaps = false; }
maskTex.minFilter = maskTex.magFilter = THREE.LinearFilter; maskTexN.minFilter = maskTexN.magFilter = THREE.NearestFilter;
{ const im = new Image(); im.onload = () => { maskTex.image = im; maskTexN.image = im; maskTex.needsUpdate = true; maskTexN.needsUpdate = true; }; im.src = BAKED.tex; }
const RETRO_U = { value: 1 };                        // Earth keeps its smooth shading; the chunky 480x300 grid and light dither give the retro half

const FS_EARTH = `${GLSL_NOISE}
  uniform sampler2D tMask; uniform sampler2D tMaskN; uniform vec3 uSun; uniform float uTime; uniform float uRetro; uniform float uDark;
  varying vec3 vP; varying vec3 vWN; varying vec3 vW;
  // the first-draft Earth art (deep blue ocean, green and tan land, soft white clouds, sun glint, blue rim), now on the real continent mask
  float fresn(vec3 n, vec3 V){ return pow(1.0 - max(dot(n, V), 0.0), 1.5); }
  void main(){
    vec3 p = normalize(vP);
    float lon = atan(-p.z, p.x), lat = asin(clamp(p.y, -1.0, 1.0));
    vec2 uv = vec2(lon/6.2831853 + 0.5, lat/3.1415927 + 0.5);
    bool rt = uRetro > 0.5;
    vec3 m = rt ? texture2D(tMaskN, uv).rgb : texture2D(tMask, uv).rgb;
    float el = 0.53 + (m.r - 0.5)*0.34 + (fbm(p*5.0 + 7.0) - 0.5)*0.05;
    float sea = 0.53;
    float land = rt ? step(sea, el) : smoothstep(sea, sea + 0.012, el);
    float alat = abs(p.y);
    float mo = fbm(p*3.0 + 11.0);
    float shelf = smoothstep(sea - 0.2, sea, el); if (rt) shelf = floor(shelf*3.0)/3.0;
    mo = rt ? floor(mo*5.0 + 0.5)/5.0 : mo;
    vec3 ocean = mix(vec3(0.03,0.17,0.5), vec3(0.09,0.42,0.74), shelf); ocean *= 0.92 + 0.16*fbm(p*14.0 + 1.0);
    float n2 = fbm(p*30.0 + 4.0); if (rt) n2 = floor(n2*4.0)/4.0;
    vec3 green = mix(vec3(0.07,0.30,0.09), vec3(0.24,0.44,0.12), mo*0.7 + n2*0.5);
    float dz = 1.0 - smoothstep(0.05, 0.2, abs(alat - 0.45));                       // the subtropical desert belts
    float dry = smoothstep(0.55, 0.75, dz*0.6 + (0.5 - mo)*1.0); if (rt) dry = step(0.5, dry);
    vec3 landc = mix(green, vec3(0.74,0.60,0.34) * (0.88 + 0.2*n2), dry);
    float rk = smoothstep(0.64, 0.78, fbm(p*21.0 + 3.0)); if (rt) rk = step(0.5, rk);
    landc = mix(landc, vec3(0.34,0.3,0.26), rk);
    float cap = smoothstep(0.80, 0.9, alat + (fbm(p*6.0) - 0.5)*0.1); if (rt) cap = step(0.5, cap);
    vec3 surf = mix(mix(ocean, landc, land), vec3(0.92,0.96,1.0), cap);
    vec3 n = normalize(vWN), L = normalize(uSun), V = normalize(cameraPosition - vW);
    float ndl = dot(n, L), day = smoothstep(-0.05, 0.25, ndl), lit = max(ndl, 0.0);
    if (rt) { lit = floor(lit*5.0 + 0.5)/5.0; day = floor(day*4.0 + 0.5)/4.0; }          // sun shading in bands
    float cf = fbm(p*3.5 + vec3(uTime*0.01, 0.0, uTime*0.006))*0.55 + fbm(p*9.0 + 2.0)*0.4 + fbm(p*24.0 + 7.0)*0.2;
    float c = smoothstep(0.55, 0.74, cf); if (rt) c = step(0.5, c);
    vec3 pl = p + L*0.035; float cs = smoothstep(0.55, 0.74, fbm(pl*3.5 + vec3(uTime*0.01, 0.0, uTime*0.006))*0.55 + fbm(pl*9.0 + 2.0)*0.4 + fbm(pl*24.0 + 7.0)*0.2); if (rt) cs = step(0.5, cs);
    surf *= 1.0 - 0.38*cs*(1.0 - c);                                                          // clouds throw shadows towards the anti-sun side
    vec3 col = surf*(0.1 + day*lit*1.25);
    vec3 H = normalize(L + V);
    float wave = fbm(p*160.0 + uTime*0.02);
    float gl = pow(max(dot(n, H), 0.0), 700.0)*(0.55 + 0.9*wave) + 0.12*pow(max(dot(n, H), 0.0), 60.0)*wave;   // sun glitter on the sea: a small hot core on broken waves
    if (rt) gl = step(0.5, gl)*0.9;
    col += vec3(1.0,0.93,0.8) * gl * (1.0 - land) * (1.0 - c) * day;
    col = mix(col, vec3(1.0)*(0.05 + day*lit*1.1), c*0.9);
    float night = 1.0 - smoothstep(-0.12, 0.05, ndl);
    col += vec3(1.0,0.72,0.3) * (rt ? step(0.28, m.g) : pow(m.g, 1.5)) * night * (1.0 - c*0.8) * 1.1;
    float tw = smoothstep(-0.1, 0.05, ndl)*(1.0 - smoothstep(0.05, 0.38, ndl)); if (rt) tw = floor(tw*4.0 + 0.5)/4.0;
    col += mix(vec3(0.95,0.28,0.1), vec3(0.9,0.5,0.3), smoothstep(0.0, 0.3, ndl)) * tw * 0.42 * (0.4 + 0.6*fresn(n, V));   // sunrise and sunset light scattered through the thick air
    float fres = pow(1.0 - max(dot(n, V), 0.0), 2.6); if (rt) fres = floor(fres*4.0)/4.0;
    col += vec3(0.25,0.5,1.0) * fres * (0.15 + 0.85*day) * 0.8;
    col *= 1.0 - 0.72 * uDark;                                  // the eclipse: the planet goes dim too
    gl_FragColor = vec4(col, 1.0);
  }`;
const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 112), new THREE.ShaderMaterial({
  vertexShader: VS_BODY, fragmentShader: FS_EARTH, uniforms: { tMask: { value: maskTex }, tMaskN: { value: maskTexN }, uSun: U.uSun, uTime: U.uTime, uRetro: RETRO_U, uDark: U.uDark } }));
env.add(earth);
// limb glow: brightness from how far the view ray passes from the planet centre, fading to nothing at the shell edge
const atmo = new THREE.Mesh(new THREE.SphereGeometry(R + ATM, 128, 96), new THREE.ShaderMaterial({
  vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
  fragmentShader: `uniform vec3 uSun; uniform float uR; uniform float uRa; varying vec3 vW;
    void main(){
      vec3 rd = normalize(vW - cameraPosition), oc = -cameraPosition;
      float d = length(oc - rd*dot(oc, rd));
      float k = clamp((uRa - d)/(uRa - uR), 0.0, 1.0);
      float a = d >= uR ? pow(k, 1.8) : 0.3*smoothstep(uR*0.9, uR, d);
      float sd = dot(normalize(vW), normalize(uSun)), day = smoothstep(-0.35, 0.45, sd);
      float fwd = pow(max(dot(rd, normalize(uSun)), 0.0), 6.0), rim = smoothstep(-0.2, 0.35, sd)*(1.0 - smoothstep(0.35, 0.8, sd));
      vec3 tint = mix(vec3(0.28,0.55,1.0), vec3(1.0,0.5,0.18), clamp(fwd*1.6*rim*2.0, 0.0, 1.0));       // looking along the sun line the limb turns orange
      gl_FragColor = vec4(tint * (0.2 + 0.8*day) * (1.0 + 1.6*fwd*rim), a);
    }`, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, uniforms: { uSun: U.uSun, uR: { value: R }, uRa: { value: R + ATM } } }));
scene.add(atmo);

// ---- planets, Moon, Sun
const FS_BODY = (albedo, pre) => `${GLSL_NOISE}
  uniform vec3 uLight; uniform float uRetro; varying vec3 vP; varying vec3 vWN; varying vec3 vW;
  ${pre || ''}
  vec3 albedo(vec3 p){ ${albedo} }
  void main(){
    vec3 p = normalize(vP), n = normalize(vWN), V = normalize(cameraPosition - vW), L = normalize(uLight);
    float mu = max(dot(n, V), 0.0), ndl = dot(n, L);
    float lit = smoothstep(-0.02, 0.1, ndl) * (0.04 + 0.96*max(ndl, 0.0)); if (uRetro > 0.5) lit = floor(lit*5.0 + 0.5)/5.0;
    gl_FragColor = vec4(albedo(p) * (0.55 + 0.45*pow(mu, 0.6)) * lit, 1.0);
  }`;
const MOON_PRE = `vec3 md(float lo, float la){ lo*=0.0174533; la*=0.0174533; return vec3(sin(lo)*cos(la), sin(la), cos(lo)*cos(la)); }
  float mare(vec3 p, vec3 c, float r){ return 1.0 - smoothstep(r*0.6, r, distance(p, c)); }`;
const ALBEDO = {
  mercury: `float c = fbm(p*9.0), d = fbm(p*28.0 + 4.0); vec3 b = mix(vec3(0.38,0.36,0.34), vec3(0.62,0.58,0.52), c); return b*(0.8 + 0.4*smoothstep(0.55,0.75,d));`,
  venus: `vec3 q = p*3.0; q += 0.6*vec3(fbm(q + 1.0), fbm(q + 7.0), fbm(q + 13.0)); float c = fbm(q*1.4); return mix(vec3(0.85,0.72,0.45), vec3(0.98,0.93,0.75), c);`,
  mars: `float t = fbm(p*4.0), t2 = fbm(p*13.0 + 3.0); vec3 c = mix(vec3(0.72,0.36,0.2), vec3(0.5,0.22,0.12), smoothstep(0.4,0.65,t)); c = mix(c, vec3(0.86,0.6,0.38), smoothstep(0.55,0.8,t2)*0.5);
         c = mix(c, vec3(0.28,0.16,0.12), smoothstep(0.55,0.65,fbm(p*2.6 + 5.0))*0.8); return mix(c, vec3(0.95), smoothstep(0.9,0.96,abs(p.y)));`,
  jupiter: `float b = p.y*10.0 + fbm(vec3(p.x*2.0, p.y*3.0, p.z*2.0))*1.2; float zone = 0.5 + 0.5*sin(b*3.0); float t = fbm(vec3(p.x*6.0, p.y*26.0, p.z*6.0));
         vec3 c = mix(vec3(0.62,0.4,0.27), vec3(0.94,0.86,0.72), zone); c = mix(c, vec3(0.98,0.93,0.82), smoothstep(0.55,0.8,t)*0.4);
         float spot = 1.0 - smoothstep(0.06, 0.15, distance(p, normalize(vec3(0.88,-0.38,0.28)))); return mix(c, vec3(0.74,0.3,0.2), spot*0.9);`,
  saturn: `float b = p.y*8.0 + fbm(vec3(p.x*2.0, p.y*2.0, p.z*2.0))*0.8; float s = 0.5 + 0.5*sin(b*3.0); return mix(vec3(0.82,0.7,0.48), vec3(0.94,0.85,0.63), s);`,
  uranus: `return mix(vec3(0.55,0.82,0.86), vec3(0.67,0.9,0.92), 0.5 + 0.5*sin(p.y*5.0));`,
  neptune: `float s = 0.5 + 0.5*sin(p.y*9.0 + fbm(p*3.0)*2.0); vec3 c = mix(vec3(0.16,0.3,0.8), vec3(0.3,0.5,0.95), s);
         float spot = 1.0 - smoothstep(0.08, 0.18, distance(p, normalize(vec3(0.7,-0.35,0.62)))); return mix(c, vec3(0.08,0.14,0.45), spot);`,
  moon: `float hl = fbm(p*6.0), cr = fbm(p*22.0 + 2.0); vec3 base = mix(vec3(0.5,0.5,0.48), vec3(0.78,0.77,0.73), hl); float m = 0.0;
         m += mare(p, md(-17.0,33.0), 0.30); m += mare(p, md(18.0,28.0), 0.20); m += mare(p, md(31.0,8.5), 0.22); m += mare(p, md(59.0,17.0), 0.14);
         m += mare(p, md(51.0,-4.0), 0.15); m += mare(p, md(34.0,-15.0), 0.12); m += mare(p, md(-16.0,-21.0), 0.20); m += mare(p, md(-39.0,-24.0), 0.14);
         m += mare(p, md(-57.0,18.0), 0.42); m += mare(p, md(0.0,56.0), 0.20);
         m = clamp(m, 0.0, 1.0)*(0.6 + 0.4*smoothstep(0.3,0.7,fbm(p*9.0)));
         vec3 c = mix(base, vec3(0.26,0.27,0.28), m); c += vec3(0.12)*(1.0 - smoothstep(0.02,0.07, distance(p, md(-11.0,-43.0))));
         return c*1.8*(0.9 + 0.2*smoothstep(0.55,0.7,cr));`
};
const FS_SUN = `${GLSL_NOISE} uniform float uTime; varying vec3 vP; varying vec3 vWN; varying vec3 vW;
  void main(){
    vec3 p = normalize(vP), n = normalize(vWN), V = normalize(cameraPosition - vW); float mu = max(dot(n, V), 0.0);
    float g = fbm(p*18.0 + vec3(uTime*0.05)); vec3 c = mix(vec3(1.0,0.5,0.12), vec3(1.0,0.93,0.65), pow(mu, 0.5)); c *= 0.9 + 0.25*g;
    c = mix(c, vec3(0.5,0.2,0.05), smoothstep(0.62,0.7, fbm(p*5.0 + 2.0))*0.5);
    gl_FragColor = vec4(c*1.2, 1.0);
  }`;
const FS_RING = `${GLSL_NOISE} uniform vec3 uLight; uniform vec3 uCenter; uniform float uRad; varying vec3 vP; varying vec3 vW;
  float ringA(float r){
    float a = smoothstep(1.24,1.3,r)*(1.0 - smoothstep(1.5,1.53,r))*0.25;
    a += smoothstep(1.5,1.56,r)*(1.0 - smoothstep(1.92,1.95,r))*0.9;
    a += smoothstep(2.03,2.06,r)*(1.0 - smoothstep(2.25,2.27,r))*0.6;
    return a*(0.85 + 0.15*noise(vec3(r*60.0, 1.0, 2.0)));
  }
  void main(){
    float r = length(vP.xz); vec3 L = normalize(uLight), rel = vW - uCenter; float s = dot(rel, L); vec3 perp = rel - L*s;
    float shadow = (s < 0.0 && length(perp) < uRad) ? 0.12 : 1.0;
    gl_FragColor = vec4(vec3(0.86,0.78,0.62)*shadow, ringA(r));
  }`;
const bodies = BAKED.bodies.map(b => {
  const o = { name: b.name, kind: b.kind, dirIn: new V3(...b.dir).normalize(), lightIn: new V3(...b.light).normalize(), pole: new V3(...b.pole).normalize(), angR: b.angR, mag: b.mag,
    color: b.color, distAU: b.distAU, distKM: b.distKM, phase: b.phase, uLight: { value: new V3() }, dirW: new V3() };
  const rad = D_SKY * Math.tan(b.angR);
  const mat = b.kind === 'sun' ? new THREE.ShaderMaterial({ vertexShader: VS_BODY, fragmentShader: FS_SUN, uniforms: { uTime: U.uTime } })
    : new THREE.ShaderMaterial({ vertexShader: VS_BODY, fragmentShader: FS_BODY(ALBEDO[b.kind], b.kind === 'moon' ? MOON_PRE : ''), uniforms: { uLight: o.uLight, uRetro: RETRO_U } });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), mat);
  mesh.scale.setScalar(rad); mesh.position.copy(o.dirIn).multiplyScalar(D_SKY);
  const q1 = new Q4().setFromUnitVectors(AY, o.pole);
  if (b.kind === 'moon') {   // turn the near side towards Earth
    const toEarth = o.dirIn.clone().negate(); toEarth.addScaledVector(o.pole, -toEarth.dot(o.pole)).normalize();
    const z0 = AZ.clone().applyQuaternion(q1); const ang = Math.atan2(new V3().crossVectors(z0, toEarth).dot(o.pole), z0.dot(toEarth));
    q1.premultiply(new Q4().setFromAxisAngle(o.pole, ang));
  }
  mesh.quaternion.copy(q1); o.quat = q1.clone(); o.mesh = mesh; if (b.kind === 'sun') mesh.layers.set(LAYER_SKY); env.add(mesh);
  if (b.kind === 'saturn') {
    const rg = new THREE.RingGeometry(1.24, 2.27, 128, 1); rg.rotateX(-Math.PI / 2);
    o.ringU = { uLight: o.uLight, uCenter: { value: new V3() }, uRad: { value: rad } };
    const ring = new THREE.Mesh(rg, new THREE.ShaderMaterial({ vertexShader: VS_BODY, fragmentShader: FS_RING, transparent: true, side: THREE.DoubleSide, depthWrite: false, uniforms: o.ringU }));
    mesh.add(ring); o.ring = ring;
  }
  return o;
});
const bodyBy = n => bodies.find(b => b.name === n);
const sunBody = bodyBy('Sun'), SUN_IN = sunBody.dirIn.clone();

function glowTexture(spikes) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.1, 'rgba(255,246,214,.95)'); gr.addColorStop(0.28, 'rgba(255,214,140,.35)'); gr.addColorStop(1, 'rgba(255,190,100,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  if (spikes) { g.globalCompositeOperation = 'lighter'; for (const [w, h] of [[256, 3], [3, 256]]) { const l = g.createLinearGradient(0, 0, w > h ? 256 : 0, w > h ? 0 : 256); l.addColorStop(0, 'rgba(255,230,170,0)'); l.addColorStop(0.5, 'rgba(255,240,200,.9)'); l.addColorStop(1, 'rgba(255,230,170,0)'); g.fillStyle = l; g.fillRect(128 - w / 2, 128 - h / 2, w, h); } }
  return new THREE.CanvasTexture(c);
}
const moonB = bodies.find(b => b.kind === 'moon');
const sunGlows = [[2400, 0.55, glowTexture(false), SUN_IN, 0xffffff], [700, 1, glowTexture(true), SUN_IN, 0xffffff], [1500, 0.7, glowTexture(false), moonB.dirIn, 0xbcd0ff]].map(([s, o, tex, dir, tint]) => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: tint, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: o }));
  sp.position.copy(dir).multiplyScalar(D_SKY * 0.999); sp.scale.set(s, s, 1); sp.layers.set(LAYER_SKY); env.add(sp); return sp;
});

// ---- stars: real catalogue (magnitude <= 5.6), plus a Milky Way drawn from galactic coordinates
const starMat = () => new THREE.ShaderMaterial({
  uniforms: { uPR: STAR_PR }, depthWrite: false,
  vertexShader: `attribute float aSize; attribute vec3 aColor; uniform float uPR; varying vec3 vC;
    void main(){ vC = aColor; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize*uPR; }`,
  fragmentShader: 'varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }' });
function pointCloud(pos, col, size, order) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const p = new THREE.Points(g, starMat()); p.frustumCulled = false; p.renderOrder = order; p.layers.set(LAYER_SKY); env.add(p); return p;
}
{
  const n = BAKED.stars.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  BAKED.stars.forEach(([ra, dec, mg, bv], i) => {
    const a = ra / 100 * D2R, d = dec / 100 * D2R, m = mg / 10, b = bv / 10, v = new V3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
    pos.set([v.x * 20000, v.z * 20000, -v.y * 20000], i * 3);
    const br = clamp(1.3 - (m + 1.5) * 0.13, 0.6, 1), tint = b < 0.2 ? [0.72, 0.82, 1] : b < 0.7 ? [1, 0.97, 0.9] : b < 1.2 ? [1, 0.82, 0.58] : [1, 0.62, 0.45];
    col.set([tint[0] * br, tint[1] * br, tint[2] * br], i * 3); size[i] = m < 1.2 ? 3 : m < 3.2 ? 2 : 1;
  });
  pointCloud(pos, col, size, -3);
  // Milky Way: galactic -> equatorial matrix (Hipparcos), density peaks toward the galactic centre
  const A = [[-0.0548755604, 0.4941094279, -0.8676661490], [-0.8734370902, -0.4448296300, -0.1980763734], [-0.4838350155, 0.7469822445, 0.4559837762]];
  const M = 16000, mp = new Float32Array(M * 3), mc = new Float32Array(M * 3), ms = new Float32Array(M).fill(1);
  for (let i = 0; i < M; i++) {
    const l = rand() * 2 * Math.PI, bump = Math.exp(-Math.pow(Math.atan2(Math.sin(l), Math.cos(l)) / 1.0, 2)), keep = 0.25 + 0.75 * bump;
    if (rand() > keep) { i--; continue; }
    const b = randn() * (4.5 + 3 * bump) * D2R, x = Math.cos(b) * Math.cos(l), y = Math.cos(b) * Math.sin(l), z = Math.sin(b);
    const e = [A[0][0] * x + A[0][1] * y + A[0][2] * z, A[1][0] * x + A[1][1] * y + A[1][2] * z, A[2][0] * x + A[2][1] * y + A[2][2] * z], br = (0.2 + 0.3 * rand()) * (0.6 + 0.6 * bump);
    mp.set([e[0] * 19900, e[2] * 19900, -e[1] * 19900], i * 3); mc.set([br * 0.8, br * 0.9, br], i * 3);
  }
  pointCloud(mp, mc, ms, -4);
}
// nebula glow: faint blue, magenta and teal gas hugging the real galactic plane (computed from galactic coordinates), drawn smooth behind everything
{
  const FS_NEB = `${GLSL_NOISE} varying vec3 vP;
    void main(){
      vec3 p = normalize(vP), e = vec3(p.x, -p.z, p.y);
      float sb = dot(e, vec3(-0.8677, -0.1981, 0.4560)), l = atan(dot(e, vec3(0.4941, -0.4448, 0.7470)), dot(e, vec3(-0.0549, -0.8734, -0.4838)));
      float core = exp(-pow(sb/0.2, 2.0)), gc = 0.45 + 0.55*cos(l);
      float n1 = fbm(p*3.0 + 1.0), n2 = fbm(p*7.0 + 5.0), n3 = fbm(p*13.0 + 9.0);
      float dens = core*(0.35 + 0.65*gc)*smoothstep(0.3, 0.8, n1*0.55 + n2*0.65);
      float wide = exp(-pow(sb/0.55, 2.0))*smoothstep(0.4, 0.8, n2);
      vec3 c = mix(vec3(0.10,0.18,0.62), vec3(0.62,0.14,0.55), smoothstep(0.3, 0.72, n3));
      c = mix(c, vec3(0.08,0.42,0.55), smoothstep(0.55, 0.85, n1)*0.5);
      vec3 col = c*(dens*1.5 + wide*0.3) + vec3(0.9,0.85,1.0)*pow(dens, 3.0)*0.3;
      gl_FragColor = vec4(col, 1.0);
    }`;
  const neb = new THREE.Mesh(new THREE.SphereGeometry(24000, 40, 28), new THREE.ShaderMaterial({ vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: FS_NEB, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  neb.frustumCulled = false; neb.renderOrder = -10; neb.layers.set(LAYER_SKY); env.add(neb);
}
// markers so the planets show as bright points at normal field of view (the discs are well under a pixel)
{
  const pl = bodies.filter(b => b.kind !== 'sun' && b.kind !== 'moon'), pos = new Float32Array(pl.length * 3), col = new Float32Array(pl.length * 3), size = new Float32Array(pl.length);
  pl.forEach((b, i) => { pos.set([b.dirIn.x * 11900, b.dirIn.y * 11900, b.dirIn.z * 11900], i * 3); const c = new THREE.Color(b.color); col.set([c.r, c.g, c.b], i * 3); size[i] = clamp(2 + (2 - b.mag) * 0.8, 2, 7); });
  pointCloud(pos, col, size, -2);
}

// ---- time: the whole inertial sky turns as the ship orbits (rotating frame), Earth also spins
let tE = 0;
function updateEnv(dt) {
  tE += dt; envQ.setFromAxisAngle(N0, -W0 * tE); env.quaternion.copy(envQ);
  earth.rotation.y = BAKED.gmst + 7.2921159e-5 * TS * tE;
  U.uSun.value.copy(SUN_IN).applyQuaternion(envQ);
  for (const b of bodies) { b.uLight.value.copy(b.lightIn).applyQuaternion(envQ); b.dirW.copy(b.dirIn).applyQuaternion(envQ); }
  if (sunBody) { /* sun disc needs no light */ }
  const sat = bodyBy('Saturn'); sat.mesh.getWorldPosition(sat.ringU.uCenter.value);
}
