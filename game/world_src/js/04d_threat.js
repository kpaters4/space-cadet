// ============================================================ threat tracking: what is closest to danger?
// Every piece is scored by how soon it will do harm and how much: EARTH = seconds until it falls into the atmosphere (a hit costs hull by size), HIT = seconds until it
// reaches the ship on its present course. score = weight / (seconds + 5). The top three get arrows (the most urgent one bigger, red, pulsing, labelled with what and when);
// the rest are left unmarked so the glass stays clear. Tab pins threats in that order.
let THREATS = [];
const thRel = new V3(), thVel = new V3(), thHit = new V3();
function computeThreats() {
  const L = [];
  for (const p of ALIVE) {
    const tE = isFinite(p.tFall) && p.S.dmg > 0 ? Math.max(0, p.tFall - tG) : Infinity;
    let tC = Infinity;
    thRel.subVectors(p.pos, ship.pos); thVel.subVectors(p.vel, ship.vel); const vv = thVel.lengthSq();
    if (vv > 1e-3) { const tca = -thRel.dot(thVel) / vv; if (tca > 0 && tca < 25 && thHit.copy(thRel).addScaledVector(thVel, tca).length() < p.radius + 7) tC = tca; }
    const tD = Math.min(tE, tC); if (!isFinite(tD) || tD > 90) continue;
    L.push({ p, t: tD, kind: tC < tE ? 'HIT' : 'EARTH', score: (p.S.dmg + 3) / (tD + 5) });
  }
  L.sort((a, b) => b.score - a.score); THREATS = L;
}
const threatOf = p => THREATS.findIndex(x => x.p === p);
const THREAT_COL = ['#ff5a4d', '#ffd36b', '#9ab0c8'];
// an arrow at the edge of the glass pointing at an off-screen piece
function threatArrow(s, rank, col, label, t) {
  let dx = s.x - 240, dy = s.y - AXIS_Y; if (s.behind) { dx = -dx; dy = -dy; }
  const ang = Math.atan2(dy, dx), ax = clamp(240 + Math.cos(ang) * 205, 26, 454), ay = clamp(AXIS_Y + Math.sin(ang) * 78, 82, 196), L = rank === 0 ? 11 : rank === 1 ? 8 : 6;
  const pulse = rank === 0 && Math.floor(t / 170) % 2;
  for (const o of rank === 0 ? [-1, 0, 1] : [0]) { const ox = -Math.sin(ang) * o, oy = Math.cos(ang) * o; pline(ax + ox, ay + oy, ax + ox - Math.cos(ang - 0.5) * L, ay + oy - Math.sin(ang - 0.5) * L, pulse ? '#ffffff' : col); pline(ax + ox, ay + oy, ax + ox - Math.cos(ang + 0.5) * L, ay + oy - Math.sin(ang + 0.5) * L, pulse ? '#ffffff' : col); pline(ax + ox, ay + oy, ax + ox - Math.cos(ang) * (L - 2), ay + oy - Math.sin(ang) * (L - 2), pulse ? '#ffffff' : col); }
  if (label) { const lx = clamp(ax - Math.cos(ang) * (L + 6), 30, 450), ly = clamp(ay - Math.sin(ang) * (L + 6) - 3, 84, 194); ptext(label, lx, ly, col, 1, 'center', true); }
}
