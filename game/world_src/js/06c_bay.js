// ============================================================ ship bay: inspect the ASTRA-9 Mk2 before launch. V on the briefing opens it; 1-4 or click the tabs; drag or arrows to turn the ship; Enter or Esc returns.
// Tabs: EXTERIOR, CUTAWAY (the interior), WEAPONS (the two cannons), SCALE (a metre-for-metre comparison of everything in the game).
const BAYU = { uSun: { value: new V3(0.5, 0.7, 0.5).normalize() }, uSteps: { value: 3 }, uShadowOn: { value: 0 } };
const hg = { tab: 0, yaw: 0.7, pit: 0.35, drag: null, scene: null, cam: null, meshes: null };
const BAY_TABS = ['EXTERIOR', 'CUTAWAY', 'WEAPONS', 'SCALE'];
const TAB_X = [8, 76, 144, 212], TAB_W = 64;
function bayBuild() {
  hg.scene = new THREE.Scene(); hg.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
  const mk = (kind, dbl) => { const b = finishMesh(cachedMerge('sat|' + kind, SAT_PARTS[kind], true), BAYU); if (dbl) b.mats.forEach(m => m.side = THREE.DoubleSide); b.grp.visible = false; hg.scene.add(b.grp); return b.grp; };
  hg.meshes = [mk('ship'), mk('shipcut', true)];
}
function bayEnter() { if (!hg.scene) bayBuild(); state = 'bay'; firing = false; boost = false; hg.drag = null; stage.classList.add('lab'); }
function bayExit() { state = 'brief'; hg.drag = null; }
function bayTab(i) { hg.tab = i; if (i === 1) { hg.yaw = 1.2; } else if (i === 2) { hg.yaw = -0.6; hg.pit = 0.3; } else if (i === 0) { hg.yaw = 0.7; hg.pit = 0.35; } }
const WEAPON_TXT = [
  ['PULSE LASER', 'TWIN CANNONS, RAPID BEAM', '1 DAMAGE, 6 SHOTS A SECOND', 'LOW HEAT: 7% A SHOT', 'GOOD FOR SHARDS, BEADS, SPIKES'],
  ['SONIC BLAST (PRESS X)', 'HOLD TO CHARGE: THE SHIP SHAKES', 'RELEASE: A BOOM CONE, 420 UNITS', 'HITS EVERYTHING INSIDE IT, SHOVES IT', 'UP TO 5 DAMAGE, 50% HEAT A SHOT']
];
const SCALE_ROWS = [['PERSON', 1.8, '#ff7a3a'], ['IRIDIUM', 4, '#c79a3a'], ['GPS IIR', 11.4, '#c79a3a'], ['HUBBLE', 13.2, '#8cc4ff'], ['ASTRA-9', 8, '#ffd060'], ['AQUA', 16.7, '#8cc4ff'], ['ENVISAT', 26, '#8cc4ff'], ['ISS', 109, '#ffffff'], ['RELIQUARY', 200, '#ff5a4d']];
function bayFrame(now) {
  const t = now / 1000; if (!hg.drag) hg.yaw += 0.003 * (hg.tab === 3 ? 0 : 1);
  const kx = (hold('arrowright') ? 1 : 0) - (hold('arrowleft') ? 1 : 0), ky = (hold('arrowup') ? 1 : 0) - (hold('arrowdown') ? 1 : 0); hg.yaw += kx * 0.03; hg.pit = clamp(hg.pit + ky * 0.02, -1.2, 1.2);
  const tab = hg.tab; hg.meshes[0].visible = tab === 0 || tab === 2; hg.meshes[1].visible = tab === 1;
  const hM = tab === 2 ? 3.4 : 5, halfH = M(hM), asp = W / H, c = hg.cam; c.left = -halfH * asp; c.right = halfH * asp; c.top = halfH; c.bottom = -halfH; c.updateProjectionMatrix();
  const cx = tab === 2 ? M(0) : 0, cz = tab === 2 ? M(-1.3) : 0;                       // the weapons view is centred on the cannons
  c.position.set(Math.sin(hg.yaw) * Math.cos(hg.pit) * 500 + cx, Math.sin(hg.pit) * 500, Math.cos(hg.yaw) * Math.cos(hg.pit) * 500 + cz); c.lookAt(cx, 0, cz);
  renderer.setRenderTarget(rt); renderer.setClearColor(0x03060c, 1); renderer.render(hg.scene, c);
  renderer.setRenderTarget(null); renderer.autoClear = false; renderer.render(postScene, postCam); renderer.autoClear = true;
  ctx.clearRect(0, 0, W, H);
  if (tab === 3) rect(0, 0, W, H, '#03060c');
  ptext('SHIP BAY: ASTRA-9 MK2', 472, 290, '#ffd060', 1, 'right', true);
  BAY_TABS.forEach((n, i) => { const on = i === tab; rect(TAB_X[i], 6, TAB_W, 14, on ? '#ffd060' : '#101a26'); ctx.strokeStyle = '#4a566a'; ctx.strokeRect(TAB_X[i] + .5, 6.5, TAB_W - 1, 13); ptext((i + 1) + ' ' + n, TAB_X[i] + TAB_W / 2, 10, on ? '#10141c' : '#8cc4ff', 1, 'center'); });
  ptext('ENTER: BACK   DRAG OR ARROWS: TURN', 472, 10, '#6f7f95', 1, 'right', true);
  const lines = [];
  if (tab === 0) lines.push('EXTERIOR', '8 M LONG, 7 M ACROSS: ONE PILOT', 'TWIN LASER ARMS ON SHOULDER PIVOTS', 'STEEL ARMOUR, THREE ENGINES', 'THE ISS (109 M) IS 13 SHIPS LONG', 'THE LEFT DASH PROJECTOR SHOWS THIS LIVE (H)');
  if (tab === 1) lines.push('CUTAWAY: THE INSIDE', 'PILOT SEAT AND CONTROLS (FRONT)', 'ORANGE: REACTOR AND CAPACITOR CORE', 'WHITE: PROPELLANT. BLUE: COOLANT', 'GOLD CABLES FEED BOTH CANNONS');
  if (tab === 2) { for (const w of WEAPON_TXT) lines.push(...w, ''); }
  if (tab === 0 || tab === 1 || tab === 2) lines.forEach((l, i) => ptext(l, 8, 30 + i * 9, i === 0 || (tab === 2 && (l === WEAPON_TXT[0][0] || l === WEAPON_TXT[1][0])) ? '#ffd060' : '#8cc4ff', 1, 'left', true));
  if (tab === 3) {
    ptext('SCALE: EVERYTHING IN METRES, SAME SCALE', 8, 28, '#ffd060', 1, 'left', true);
    const pxm = 1.7, x0 = 74; SCALE_ROWS.forEach(([n, m, col], i) => { const y = 42 + i * 21; ptext(n, 8, y + 5, '#8cc4ff', 1, 'left', true); rect(x0, y, Math.max(2, Math.round(m * pxm)), 14, col); rect(x0, y + 14, Math.max(2, Math.round(m * pxm)), 1, '#000'); ptext(m + ' M', x0 + Math.round(m * pxm) + 4, y + 5, '#ffffff', 1, 'left', true); });
    ptext('THE GAME DRAWS EVERY CRAFT ' + CRAFT_X + ' TIMES LIFE SIZE, BY THE SAME FACTOR,', 8, 234, '#6f7f95', 1, 'left', true); ptext('SO THEIR SIZES STAY TRUE TO EACH OTHER. THE RELIQUARY IS FICTION.', 8, 243, '#6f7f95', 1, 'left', true);
  } else { const bar = 2, pxm = H / 2 / hM; rect(8, 286, Math.round(bar * pxm), 2, '#fff'); rect(8, 283, 1, 8, '#fff'); rect(8 + Math.round(bar * pxm), 283, 1, 8, '#fff'); ptext(bar + ' M', 14 + Math.round(bar * pxm), 284, '#fff', 1, 'left', true); }
}
