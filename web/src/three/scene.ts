// The launch scene behind the page: a pad on the ground, a short climb through the
// sky, then space with Earth below and satellites and debris drifting past while the
// ship keeps rising. Driven by two scroll values from LaunchScene.tsx:
//   climb  0..1  ground -> space (the hero and the climb)
//   space  0..1  through the space sections, ending at the debris field (the game)

import * as THREE from "three";
import {
  EXHAUSTS,
  FRAGMENTS,
  hubbleParts,
  iridiumParts,
  issParts,
  mergeParts,
  rocketBodyParts,
  shipParts,
  type Merged,
} from "./models";

export type SceneInput = {
  climb: number;
  space: number;
  /** eased scroll speed, px per frame (positive = scrolling down / climbing) */
  speed: number;
  /** seconds */
  time: number;
  /** idle motion on? (off for reduced motion) */
  animate: boolean;
};

export type LaunchScene = {
  update: (s: SceneInput) => void;
  render: () => void;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

const CLIMB_HEIGHT = 2600; // metres climbed between the pad and space
const SPACE_HEIGHT = 5200; // metres climbed through the space sections
const EARTH_R = 60000;

// sky colour stops over `climb` (never pure black)
const SKY: [number, string][] = [
  [0, "#7cbcff"], [0.3, "#3f86e6"], [0.55, "#1b4fb0"], [0.75, "#0b1d4a"], [0.9, "#070c1c"], [1, "#050914"],
];

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function skyColor(c: number, out: THREE.Color) {
  for (let i = 1; i < SKY.length; i++) {
    if (c <= SKY[i][0]) {
      const [a0, ca] = SKY[i - 1], [a1, cb] = SKY[i];
      return out.set(ca).lerp(new THREE.Color(cb), (c - a0) / (a1 - a0));
    }
  }
  return out.set(SKY[SKY.length - 1][1]);
}

// deterministic random, so the scene looks the same on every load
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function softDotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.75)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createLaunchScene(canvas: HTMLCanvasElement): LaunchScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY[0][1]);
  scene.fog = new THREE.Fog(SKY[0][1], 400, 9000);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 120000);

  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

  const solid = track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const edgeMat = track(new THREE.LineBasicMaterial({ color: 0x05070b, transparent: true, opacity: 0.55 }));
  const meshOf = (m: Merged, edges: boolean) => {
    track(m.geometry);
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(m.geometry, solid));
    if (edges && m.edges) grp.add(new THREE.LineSegments(track(m.edges), edgeMat));
    return grp;
  };

  // ---- lights
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a5a44, 1.4);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(-0.6, 0.8, 0.7).multiplyScalar(100);
  scene.add(hemi, sun, sun.target);

  // ---- Earth: the ground near the pad is the top of the same sphere seen from space
  const earthMat = track(new THREE.MeshLambertMaterial({ color: 0x48603f }));
  const earth = new THREE.Mesh(track(new THREE.SphereGeometry(EARTH_R, 160, 80)), earthMat);
  earth.position.set(0, -EARTH_R, 0);
  const glowMat = track(new THREE.MeshBasicMaterial({ color: 0x6fb3ff, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false }));
  const glow = new THREE.Mesh(track(new THREE.SphereGeometry(EARTH_R * 1.012, 96, 48)), glowMat);
  glow.position.copy(earth.position);
  scene.add(earth, glow);

  // ---- launch pad: concrete slab, flame trench, service tower with an access arm
  const pad = new THREE.Group();
  const concrete = track(new THREE.MeshLambertMaterial({ color: 0x9aa1a8, flatShading: true }));
  const steel = track(new THREE.MeshLambertMaterial({ color: 0xc0562a, flatShading: true }));
  const dark = track(new THREE.MeshLambertMaterial({ color: 0x2b3038, flatShading: true }));
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    pad.add(m);
    return m;
  };
  box(46, 1, 46, concrete, 0, 0.5, 0);
  box(8, 1.05, 30, dark, 0, 0.52, 0);
  // service tower behind the ship and to its right, so it frames the ship instead of the text
  const TX = 9, TZ = -7;
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) box(0.5, 34, 0.5, steel, TX + x, 18, TZ + z);
  for (let k = 0; k < 11; k++) box(3.7, 0.35, 3.7, steel, TX, 2 + k * 3.2, TZ);
  for (let k = 0; k < 10; k++) {
    const brace = box(0.25, 4.6, 0.25, steel, TX, 3.6 + k * 3.2, TZ + 1.65);
    brace.rotation.z = k % 2 ? 0.8 : -0.8;
  }
  const arm = box(9, 0.5, 1.2, steel, TX - 4.2, 14, TZ + 3.4);
  arm.rotation.y = 0.6;
  box(1.4, 1.4, 1.4, dark, TX, 35.6, TZ);
  scene.add(pad);

  // ---- clouds (seen during the climb)
  const dot = track(softDotTexture());
  const clouds = new THREE.Group();
  const rnd = rng(7);
  const cloudMats: THREE.SpriteMaterial[] = [];
  for (let i = 0; i < 26; i++) {
    const mat = track(new THREE.SpriteMaterial({ map: dot, color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    cloudMats.push(mat);
    const puff = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Sprite(mat);
      const size = 90 + rnd() * 120;
      s.scale.set(size * 1.6, size, 1);
      s.position.set((rnd() - 0.5) * 160, (rnd() - 0.5) * 30, (rnd() - 0.5) * 60);
      puff.add(s);
    }
    puff.position.set((rnd() - 0.5) * 2400, 500 + rnd() * 1300, -300 - rnd() * 1400);
    clouds.add(puff);
  }
  scene.add(clouds);

  // ---- stars: a shell that follows the camera, so they sit at infinity
  const starGeo = track(new THREE.BufferGeometry());
  const starPos: number[] = [];
  const srnd = rng(3);
  for (let i = 0; i < 2400; i++) {
    const u = srnd() * 2 - 1, th = srnd() * Math.PI * 2, r = 40000;
    const s = Math.sqrt(1 - u * u);
    starPos.push(r * s * Math.cos(th), r * u, r * s * Math.sin(th));
  }
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = track(new THREE.PointsMaterial({ color: 0xeef4ff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ---- the ship, nose up, with engine flames
  const ship = new THREE.Group();
  const hull = meshOf(mergeParts(shipParts()), true);
  hull.rotation.x = Math.PI / 2; // the game's forward (-z) becomes up (+y); the canopy faces the camera
  ship.add(hull);
  const flameMat = track(new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const coreMat = track(new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const flameGeo = track(new THREE.ConeGeometry(0.55, 1, 12, 1, true));
  flameGeo.translate(0, -0.5, 0); // tip at the bottom, base at the nozzle
  const flames: THREE.Group[] = [];
  for (const [x, y, z] of EXHAUSTS) {
    const f = new THREE.Group();
    const outer = new THREE.Mesh(flameGeo, flameMat);
    const inner = new THREE.Mesh(flameGeo, coreMat);
    inner.scale.set(0.5, 0.6, 0.5);
    f.add(outer, inner);
    // exhaust points along the ship's +z, which is -y after the hull rotation
    f.position.set(x, -z, y);
    flames.push(f);
    ship.add(f);
  }
  const PAD_HEIGHT = 1 + 4.9; // pad top + the engines' distance below the ship's centre
  ship.position.set(0, PAD_HEIGHT, 0);
  scene.add(ship);

  // ---- space: satellites and debris along the climb, denser near the debris field
  const spaceObjs: { obj: THREE.Object3D; spin: THREE.Vector3; drift: number; baseX: number }[] = [];
  const addSpace = (obj: THREE.Object3D, x: number, y: number, z: number, spin: [number, number, number], drift: number) => {
    obj.position.set(x, y, z);
    spaceObjs.push({ obj, spin: new THREE.Vector3(...spin), drift, baseX: x });
    scene.add(obj);
  };
  const SPACE0 = CLIMB_HEIGHT;
  addSpace(meshOf(mergeParts(issParts()), true), -260, SPACE0 + 1500, -420, [0, 0.02, 0], 3);
  addSpace(meshOf(mergeParts(hubbleParts()), false), 90, SPACE0 + 2700, -150, [0.05, 0.1, 0.02], -2);
  const iridium = mergeParts(iridiumParts(), false);
  addSpace(meshOf(iridium, false), -60, SPACE0 + 700, -90, [0.2, 0.3, 0.1], 1.5);
  addSpace(meshOf(iridium, false), 140, SPACE0 + 3800, -210, [0.1, 0.25, 0.3], -1);
  const rocket = mergeParts(rocketBodyParts(), false);
  for (const [x, y, z] of [[-150, SPACE0 + 2100, -260], [200, SPACE0 + 4300, -320], [-90, SPACE0 + 4900, -140]]) {
    const r = meshOf(rocket, false);
    r.scale.setScalar(1.8);
    addSpace(r, x, y, z, [0.15, 0.05, 0.25], 1.2);
  }

  // debris: instanced fragments, more of them towards the top (the debris field)
  const debris: { mesh: THREE.InstancedMesh; items: { p: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; s: number }[] }[] = [];
  const drnd = rng(11);
  const tmp = new THREE.Object3D();
  FRAGMENTS.forEach((make, i) => {
    const m = mergeParts(make(i + 1), false);
    track(m.geometry);
    const count = 34;
    const mesh = new THREE.InstancedMesh(m.geometry, solid, count);
    const items = [];
    for (let k = 0; k < count; k++) {
      const h = Math.pow(drnd(), 0.55); // biased upward
      items.push({
        p: new THREE.Vector3((drnd() - 0.5) * 700, SPACE0 + 200 + h * (SPACE_HEIGHT + 400), -60 - drnd() * 520),
        r: new THREE.Euler(drnd() * 6, drnd() * 6, drnd() * 6),
        w: new THREE.Vector3((drnd() - 0.5) * 0.8, (drnd() - 0.5) * 0.8, (drnd() - 0.5) * 0.8),
        s: 3 + drnd() * 6,
      });
    }
    debris.push({ mesh, items });
    scene.add(mesh);
  });

  const sky = new THREE.Color();
  let width = 1, height = 1;

  function update({ climb, space, speed, time, animate }: SceneInput) {
    const c = clamp(climb), s = clamp(space);

    // ship altitude: eases off the pad, then keeps rising through space
    const lift = c * c * (3 - 2 * c);
    const shipY = PAD_HEIGHT + lift * CLIMB_HEIGHT + s * SPACE_HEIGHT;
    const bob = animate ? Math.sin(time * 1.3) * 0.35 * smooth(0.02, 0.2, c) : 0;
    ship.position.y = shipY + bob;
    const bank = clamp(speed * 0.004, -0.12, 0.12);
    ship.rotation.z = (animate ? Math.sin(time * 0.6) * 0.03 : 0) - bank;
    ship.rotation.y = 0.35 + (animate ? Math.sin(time * 0.4) * 0.05 : 0);

    // engine: off on the pad, full during the climb, cruising in space, bigger when moving
    const thrust = c < 0.004 && s === 0 ? 0 : 0.45 + 0.55 * smooth(0, 0.15, c) * (1 - 0.5 * s) + Math.min(Math.abs(speed) * 0.02, 0.6);
    const flicker = animate ? 1 + Math.sin(time * 37) * 0.08 + Math.sin(time * 23.7) * 0.06 : 1;
    for (const f of flames) {
      f.visible = thrust > 0;
      f.scale.set(1, (2.2 + 4 * thrust) * flicker, 1);
    }

    // sky, fog, light: blend continuously from day to space
    skyColor(c, sky);
    (scene.background as THREE.Color).copy(sky);
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(sky);
    fog.near = 400 + c * 20000;
    fog.far = 9000 + c * 110000;
    hemi.intensity = 1.4 - 0.9 * c;
    starMat.opacity = smooth(0.45, 0.85, c);
    glowMat.opacity = 0.35 * smooth(0.5, 1, c);
    earthMat.color.set(0x48603f).lerp(new THREE.Color(0x1f4f8f), smooth(0.35, 0.9, c));
    for (const m of cloudMats) m.opacity = 0.85 * (1 - smooth(0.55, 0.8, c));
    pad.visible = c < 0.6;
    clouds.visible = c < 0.85;

    // satellites and debris drift and tumble
    if (animate) {
      for (const o of spaceObjs) {
        o.obj.rotation.x = o.spin.x * time;
        o.obj.rotation.y = o.spin.y * time;
        o.obj.rotation.z = o.spin.z * time;
        o.obj.position.x = o.baseX + Math.sin(time * 0.05) * 40 * Math.sign(o.drift);
      }
    }
    for (const d of debris) {
      d.items.forEach((it, k) => {
        tmp.position.copy(it.p);
        if (animate) tmp.position.x += Math.sin(time * 0.07 + k) * 12;
        tmp.rotation.set(it.r.x + it.w.x * (animate ? time : 0), it.r.y + it.w.y * (animate ? time : 0), it.r.z + it.w.z * (animate ? time : 0));
        tmp.scale.setScalar(it.s);
        tmp.updateMatrix();
        d.mesh.setMatrixAt(k, tmp.matrix);
      });
      d.mesh.instanceMatrix.needsUpdate = true;
    }

    // camera: beside the ship, the ship sitting right of centre on wide screens
    const aspect = width / height;
    const wide = aspect > 1.05;
    const dist = wide ? 34 : 46;
    const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist * aspect;
    const side = wide ? halfW * 0.5 : 0; // ship at about 75% of the width, right of the text column
    const pitchDown = 0.08 + 0.22 * smooth(0.5, 1, c);
    const lookY = shipY + (wide ? 0 : -3) + (1 - smooth(0, 0.15, c)) * 6;
    camera.position.set(ship.position.x - side, lookY + Math.sin(pitchDown) * dist, dist * Math.cos(pitchDown));
    camera.lookAt(ship.position.x - side, lookY, 0);
    stars.position.copy(camera.position);
    sun.position.set(ship.position.x - 60, shipY + 80, 70);
    sun.target.position.copy(ship.position);
  }

  function resize(w: number, h: number) {
    width = Math.max(1, w);
    height = Math.max(1, h);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return {
    update,
    render: () => renderer.render(scene, camera),
    resize,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    },
  };
}
