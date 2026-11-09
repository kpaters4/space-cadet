// ============================================================ model lab: #lab=NAME[&rot=deg][&pit=deg][&h=metres half-height]  renders one model orthographically, with an exact metre ruler
// Used to design and check every craft against its real size. Names: any key of SAT_PARTS, or the LABS registry below (debris, ship, boss).
function labParams() { const o = {}; /lab=([^&]+)/.test(location.hash) && (o.name = decodeURIComponent(RegExp.$1)); for (const k of ['rot', 'pit', 'h', 'rel']) { const m = new RegExp(k + '=(-?[\\d.]+)').exec(location.hash); if (m) o[k] = +m[1]; } return o; }
function startLab(o) {
  state = 'lab'; stage.classList.add('lab');
  const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
  const US = { uSun: { value: new V3(0.55, 0.7, 0.45).normalize() }, uSteps: { value: 3 }, uShadowOn: { value: 0 } };
  let built;
  if (LABS[o.name]) built = LABS[o.name](US, o);
  else { const b = finishMesh(cachedMerge('sat|' + o.name, SAT_PARTS[o.name], true), US); built = { grp: b.grp, mats: b.mats, metres: ({ iss: 75, hubble: 11, envisat: 20, terra: 11, aqua: 13, iridium: 4, gps: 8, geo: 8 })[o.name] || 10 }; }
  for (const m of built.mats) m.uniforms.uSun = US.uSun, m.uniforms.uSteps = US.uSteps;
  if (built.sun) US.uSun.value.copy(built.sun).normalize();
  sc.add(built.grp);
  const upm = built.unitsPerMetre || M(1), halfH = (o.h || built.metres) * upm, aspect = W / H;
  cam.left = -halfH * aspect; cam.right = halfH * aspect; cam.top = halfH; cam.bottom = -halfH; cam.updateProjectionMatrix();
  const yaw = (o.rot !== undefined ? o.rot : 35) * D2R, pit = (o.pit !== undefined ? o.pit : 22) * D2R;
  cam.position.set(Math.sin(yaw) * Math.cos(pit), Math.sin(pit), Math.cos(yaw) * Math.cos(pit)).multiplyScalar(500); cam.lookAt(0, 0, 0);
  const fl = built.fit; if (fl) fl(cam);
  const pxPerMetre = H / 2 / (halfH / upm);
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]; let bar = nice[0]; for (const n of nice) if (n * pxPerMetre <= W * 0.4) bar = n;
  function labFrame(now) {
    if (o.rot === undefined) { const a = (now / 1000) * 0.4; cam.position.set(Math.sin(a) * Math.cos(pit), Math.sin(pit), Math.cos(a) * Math.cos(pit)).multiplyScalar(500); cam.lookAt(0, 0, 0); }
    if (built.tick) built.tick(now / 1000);
    renderer.setRenderTarget(rt); renderer.setClearColor(0x03060c, 1); renderer.render(sc, cam);
    renderer.setRenderTarget(null); renderer.autoClear = false; renderer.render(postScene, postCam); renderer.autoClear = true;
    ctx.clearRect(0, 0, W, H);
    ptext(built.title || (REAL[o.name] && REAL[o.name].name) || o.name.toUpperCase(), 6, 6, '#ffd060', 2, 'left', true);
    const info = built.info || (REAL[o.name] ? [REAL[o.name].size, REAL[o.name].note] : []);
    info.forEach((t, i) => ptext(t, 6, 24 + i * 9, '#8cc4ff', 1, 'left', true));
    const bx = 8, by = H - 12, bl = Math.round(bar * pxPerMetre);
    if (!built.noRuler) { rect(bx, by, bl, 2, '#fff'); rect(bx, by - 3, 1, 8, '#fff'); rect(bx + bl, by - 3, 1, 8, '#fff'); ptext(bar + ' M', bx + bl + 4, by - 2, '#fff', 1, 'left', true); }
    const hh = Math.round(1.8 * pxPerMetre); if (!built.noRuler && hh >= 3) { const hx = W - 14; rect(hx - 1, by + 2 - hh, 2, hh, '#ff7a3a'); ptext('1.8 M PERSON', hx - 6, by - 2 - hh - 6, '#ff7a3a', 1, 'right', true); }
    requestAnimationFrame(labFrame);
  }
  fit(); requestAnimationFrame(labFrame);
}
