# Space Cadet World: design notes (built from world_src/js/*.js by `python3 build.py` -> ../world.html)

## Scale
- World: 1 unit = 10 km, Earth true size. Satellites/stations are drawn CRAFT_X (3500) times life size by ONE factor (`M(metres)` in 01_setup.js), so sizes are true to each other.
- Models are written in real metres (03a_craft.js): ISS 109x73 m, Hubble 13.2x4.2, Envisat 26x10x5, Terra, Aqua 16.7, GPS IIR 11.4 span, Iridium ~4 m. `REAL` table = facts shown on the target readout.
- Debris: hero objects (Iridium 33, Cosmos 2251, CZ-4B stage) use the same metre scale. Fragments are enlarged for visibility (03c_debris_types.js).

## Files
03a_craft (satellites) | 03c_debris_types (debris) | 03d_ship (Astra-9 Mk2 in named sections + cutaway) | 06d_holo (dash holo projector) | 03e_boss (Kessler Reliquary model) | 04b_boss (fight) | 06b_lab (model lab) | 06c_bay (ship bay)

## Controls added
X = switch PULSE / LANCE (hold to charge, release to fire). V on the briefing = ship bay (1-4 tabs, drag to turn, Enter back).

## Test hashes (open world.html#...)
lab=iss|hubble|envisat|terra|aqua|iridium|gps|geo|ship|shipcut|boss|frags|cz4|cosmos|iridium33 [&rot=deg&pit=deg&h=metres&rel=0..3]
bay[&tab0..3] | play&boss | play&boss&bosstest[&ph2|ph3] | &simN (fast-forward N s) | &selftest | &weapontest

## Boss: THE KESSLER RELIQUARY
Phase 1 THE VEIL: 8 rosary beads shield the heart. Phase 2 THE HEART: bared (36 hp). Phase 3 THE LAMENTATION: heart under half, faster attacks.
Attacks (telegraphed by a flare + HUD warning): TITHE (fan of brass spikes), CENSER (slow orb, 4 hp). Appears after the last debris piece is cleared.

## Ship, weapons, holo projector (second pass)
- Astra-9 Mk2 is 18 m long, 16 m across, built from layered extruded steel plates in the cockpit's own palette (SI ramp = cockpit STEEL), orange lines, hazard stripes, rivet rows, cannon arms on shoulder pivots with toe-in. Sections: hull, canopy, gunL/R, engL/R/C, finL/R, wingL/R.
- Holo projector: puck on the dash lip (05a), hologram in the left window (HOLO rect in 06d_holo.js), each section coloured by gun heat / lance charge / thrust / damage side. H flips exterior <-> cutaway. Hit direction comes from holoHit(worldPos, dmg).
- Weapon art (05b drawBeams / drawLanceCharge / muzzle flash): dithered glow halo, comet pulse, charge arcs, helix lance, impact rings.
- More test hashes: holotest[&cut], holobig, lance, fire.

## Third pass: lasers in space, POV, tracking, controls, dash, map
- Lasers are real 3D bolts (04c_weapons.js) from the true muzzle positions on the ship model (eye-relative MUZ_REL); barrels are fixed and point at the vanishing point; damage lands when the bolt arrives.
- POV: C cycles COCKPIT / CHASE / SIDE (ship model shown with engine flames). Hashes: chase, sideview.
- Threat tracking (04d_threat.js): score = weight/(seconds to Earth impact or collision + 5); top 3 get arrows (red/amber/grey), the top one is labelled; no clutter on the rest. Tab pins in threat order.
- Controls (04e_input.js): mouse flight (click glass, pointer lock, spring-centred stick, wheel throttle, LMB fire, RMB parry), A/D roll, gamepad, F parry. Parry = 0.3 s window, boss projectiles are sent back, ramming debris is smashed.
- Boss attack HURL: thrown wreckage, built to be parried (12 damage to the heart, or breaks beads).
- Dash: raised console, annunciator lamps (PWR COOL RCS GUN LOCK PRY COMM ALRT), switches, two projector pucks. Right projector = ground-track map (06e_map.js) from BAKED.tex: day/night, city lights, ship track, debris, predicted impact points.
- Test hashes added: parrytest, slowbolts, chase, sideview, lance, holotest.

## Fourth pass: scale, map, sonic blast, boss overhaul, movement
- Ship is 8 m (SHIP_K = 0.45 in 03d_ship.js); ISS 109 m = 13 ships. Cockpit geometry is scale-invariant, so the view from the seat is unchanged.
- Smoother movement: stick input ramps (exp smoothing), then angular velocity eases (wX/wY/wZ in 04e_input.js); chase camera banks into turns.
- BLAST (was lance): hold = the cockpit shakes (stage CSS shake) and air compresses into the muzzles; release = sonic boom: a 420-unit cone (0.2 slope) hitting everything inside with falloff and shoving it, 3D shock rings (04c) and a concussion flash.
- Map (06e_map.js): lat +-72 only, solid land, YOU cross, ISS, three numbered impact crosses with a legend; numbers match the arrows.
- Boss (03e/04b): parts (body/head/eyes/halo/wings) animate; head tracks you, halo spins faster each phase, stalks closer as it weakens (BAND). Attacks: tithe, stream (aimed rapid spikes), halo (ring converging), wisps (homing), censer, hurl, beam (tracked lock-on then frozen sweep, undodgeable only if you stand still), lunge (phase 3). All projectiles can be parried. Cadence 2.3 / 1.7 / 1.05 s.
- Tests: #attacktest (beam, lunge, stream, wisps against a stationary ship).

## Fifth pass: chase, stability, spectacle, speed
- Boss never enters the Earth: B.pos is clamped to R+100 (its body hangs ~75 units below the centre); nothing else collides with it. It chases: speed = clamp(36 + excess*0.7 + shipSpeed*0.9, 36, 150).
- Side view removed; POVS = cockpit, chase.
- Stabiliser (Z toggles, 'STAB' tag): with no roll input the ship levels itself to the horizon (04_game.js); shake amplitudes cut roughly in half.
- Battle spectacle: halo glow sprite (reddens each phase), red shockwave ring on every attack, PHASE II/III banners with flash, cinematic letterbox title, red vignette in phase 3, embers, heartbeat rumble in phase 3.
- Speed: space dust streaks (04c updateDust), radial speed lines (05b drawSpeedLines), chase FOV 62 -> 76 with speed, boost rumble.
- Tests: #chasetest, #fastship.

## Sixth pass: flight assist
- With the stabiliser on (Z toggles), sideways velocity is bled off (rate 4.5/s thrusting, 1.6/s coasting) so the ship goes where the nose points and the dust streaks stay on the view axis; turn rates drop up to 38% at full speed. Test: #assisttest (6 deg off-nose assisted vs 46 deg unassisted).

## Seventh pass: zoom, headlamp, Asphalt-style feel
- Field of view is a spring (04c updateFov): widens with speed and acceleration, kicks +9 on boost, and recoils below 62 on braking (cockpit amp 9, chase amp 15). FOCAL is now a live variable so the guns and brackets re-project.
- Headlamp (L: AUTO / ON / OFF): cone light in the debris shader (uLamp*), visible beam cone mesh; auto-on in Earth's shadow and the boss eclipse (uDark 0.85, dims debris, ship and the Earth). Guttering when the boss telegraphs or hull is below 30%.
- Feel: boost kick (impulse + shake), banking into turns (camera and, in chase, the ship model), chase camera drops back with speed, tunnel-vision vignette, expo on mouse steering.
- Tests: #fovtest, #dark.

## Eighth pass: level flow, title cards, crash safety
- Level 1 briefing and launch card restyled (05b `drawBrief`, `drawCard`): transmission header, big level number and name, three tagged orders. A title card wipes across the glass at the start of each level.
- Flow: clearing Level 1 shows "LEVEL 1 CLEAR", waits 3.6 s (`bossWait`, 04_game.js), then spawns the boss under a "LEVEL 2" card. The red Boss fight button (head.html, 07_main.js) skips straight to it.
- The boss only updates while `state === 'play'`, so it freezes on the win/death screen and in the briefing (`#boss` therefore needs `#play`).
- `frame()` in 07_main.js wraps `frameInner()` in try/catch: an error is logged and the loop keeps running; after 5 errors in a row the game drops back to the briefing.
- Tests: `#play&flowtest`, `#play&bosstest&selftest` (expect win, 420 coins).
