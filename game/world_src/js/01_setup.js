'use strict';
// ============================================================ setup, constants, renderer (retro = 480x300 render target + dithered palette pass)
const $ = id => document.getElementById(id);
const stage = $('stage'), glc = $('gl'), cv = $('cv'), mainCtx = cv.getContext('2d');
let ctx = mainCtx;                                    // swapped briefly while a cached panel redraws
const W = 480, H = 300;
const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
window.addEventListener('error', e => { $('status').textContent = 'Error: ' + e.message; });
if (!window.THREE) { $('status').textContent = 'three.js failed to load, so the 3D world cannot start.'; return; }
const V3 = THREE.Vector3, Q4 = THREE.Quaternion, rand = Math.random, lerp = (a, b, t) => a + (b - a) * t, clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const randn = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const D2R = Math.PI / 180;

// ---- world scale: 1 unit = 10 km. Earth is true size; debris is drawn much bigger than life so it can be seen.
const R = 637.1, ATM = 14, ALT0 = 79, r0 = R + ALT0;           // Earth radius, atmosphere shell height, ship altitude (790 km, where Iridium 33 died)
// ---- craft scale: ONE factor for every satellite and station, so their sizes stay true relative to each other (ISS : Hubble : Iridium = 109 : 13 : 4 m).
// Drawn CRAFT_X times larger than life so they are visible at 10 km per unit; M(metres) gives model units.
const CRAFT_X = 3500, M = m => m * CRAFT_X / 10000;
const LABS = {};                      // model-lab registry (see 06b_lab.js): name -> (US, params) => { grp, mats, metres, ... }
const TS = 9, W0 = 0.0094;                                      // orbital angular speed (rad/s); the real orbit is ~9x slower
const GM = W0 * W0 * r0 * r0 * r0;
const S0h = new V3(...BAKED.ship.S0).normalize(), T0h = new V3(...BAKED.ship.t0).normalize();
T0h.addScaledVector(S0h, -T0h.dot(S0h)).normalize();
const N0 = new V3().crossVectors(S0h, T0h).normalize();         // orbit normal
const AXIS_Y = 126;                                              // centre of the glass on the 300px-high stage
const U = { uSun: { value: new V3(1, 0, 0) }, uTime: { value: 0 }, uSteps: { value: 4 }, uShadowOn: { value: 1 }, uLampP: { value: new V3() }, uLampD: { value: new V3(0, 0, -1) }, uLampOn: { value: 0 }, uDark: { value: 0 } };   // uLamp*: the ship's headlamp; uDark: 0..1, how dark the scene is (eclipse)
let style = 'retro';
const isRetro = () => style === 'retro';

const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000003, 1);
const CLEAR = new THREE.Color(0x000003);
const LAYER_SKY = 1;                                           // stars, Milky Way, Sun, Moon, planets: drawn smooth at full resolution under the chunky Earth/debris layer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, W / H, 1, 30000);
const rt = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postMat = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: rt.texture }, uRes: { value: new THREE.Vector2(W, H) }, uLevels: { value: 14 } }, depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uLevels;
    float bayer2(vec2 a){ a = floor(a); return fract(a.x/2.0 + a.y*a.y*0.75); }
    float bayer4(vec2 a){ return bayer2(0.5*a)*0.25 + bayer2(a); }
    void main(){
      vec4 t = texture2D(tDiffuse, vUv); vec3 c = t.rgb;
      float b = bayer4(vUv*uRes) - 0.47;
      c = floor(c*(uLevels - 1.0) + 0.5 + b*0.6)/(uLevels - 1.0);
      gl_FragColor = vec4(c, t.a);
    }` });
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));
const STAR_PR = { value: 1 };                                    // star point scale: 1 in retro, the device pixel ratio otherwise
let cssW = 960, cssH = 600;
function fit() {
  cssW = stage.clientWidth || 960; cssH = cssW * H / W;
  { const pr = Math.min(window.devicePixelRatio || 1, 2); renderer.setPixelRatio(pr); renderer.setSize(cssW, cssH, false); glc.style.imageRendering = 'auto'; STAR_PR.value = pr; }
  camera.aspect = W / H; applyPov();
}
if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);

// ---- shared GLSL
const GLSL_NOISE = `
  float hash(vec3 p){ p = 50.0*fract(p*0.3183099 + vec3(0.71,0.113,0.419)); return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float noise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
  float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }`;
const VS_BODY = `varying vec3 vP; varying vec3 vWN; varying vec3 vW;
  void main(){ vP = position; vWN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;

// ---- three.js maths helpers for the game and the cockpit
const envQ = new Q4();
const fwdV = new V3(), rightV = new V3(), upV = new V3(), tmp = new V3(), tmp2 = new V3(), qInv = new Q4(), qa = new Q4();
const AX = new V3(1, 0, 0), AY = new V3(0, 1, 0), AZ = new V3(0, 0, 1);
