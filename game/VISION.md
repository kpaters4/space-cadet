# Space Cadet World: vision, plan, references and stack

Everything someone needs to pick this game up and keep building it. For the research side (the decay model and its data) see the repo's top-level `README.md` and `PLAN.md`. For the engineering notes pass by pass see `world_src/DESIGN.md`.

## 1. Vision

**The pitch.** You are a cadet in a one-seat patrol ship, 780 km above the Earth, on 10 February 2009: the day Iridium 33 and Cosmos 2251 collided. The collision made a cloud of fragments. Some will burn up within weeks. Some will stay for decades. You cannot shoot everything, so you have to learn which pieces are the danger.

**Why it exists.** The research question of this repo is: *can we predict how many days a piece of space junk has left before it burns up, and does knowing what the Sun is doing make the prediction better?* The game is the way to feel that question. Shooting creates fragments, so the skill is knowing which pieces will fall on their own and which will stay. The game's threat arrows, the predicted impact points on the dash map and the "model estimate" on the target readout are all places where the real model plugs in.

**Feel we are going for.**
- A retro-futuristic cockpit: chunky 480x300 pixels, dithered palette, a raised dash with real-looking instruments, lamps, toggles and two holographic projectors. It should look like an 80s-90s space sim, not a modern HUD.
- True scale. The station, Hubble, Envisat and the rest are sized correctly *relative to each other* and to the one-seat ship. The ISS is about 13 ships long. Nothing is quietly enlarged to look better.
- Speed you can feel (dust streaks, field-of-view spring, boost kick) and flight that is smooth, in the spirit of Asphalt: banking, assisted steering, no losing the horizon.
- A boss that is frightening. After the debris cloud (Level 1), **The Kessler Reliquary** (Level 2) arrives: a monstrance built from dead satellites, inspired by the grotesque-and-sacred look of the Blasphemous 2 bosses. It is soulslike: every attack is telegraphed, and the answer to most of them is the **parry**.

**Design principles.**
1. Real data first. Names, sizes and altitudes come from the real data pool. Anything invented is labelled as a stand-in in the code.
2. Readable threat, little clutter. Only the top three threats get arrows; the closest-to-danger one is labelled.
3. One scale factor for all craft (`CRAFT_X`), so sizes stay honest.
4. Every attack can be answered. Telegraph, then a parry or dodge window.
5. The game must not crash. A bad frame is logged and skipped (see `frame()` in `07_main.js`).

## 2. Current state (what is playable)

Open `game/world.html` in a browser (needs internet for three.js and the fonts). No server needed.

| | |
|---|---|
| **Briefing** | "Level 1: Debris Cloud" transmission card. Enter launches, V opens the ship bay. |
| **Level 1: Debris Cloud** | 12 pieces of Iridium/Cosmos debris plus friendly craft (ISS, Hubble, ...). Shoot the hazards, do not fire on cyan craft, do not let pieces fall on Earth, keep the hull up. |
| **Hand-off** | When the last hazard is down: a "LEVEL 1 CLEAR" card, a 3.6 s pause, then the boss arrives under a "LEVEL 2" card. |
| **Level 2: The Kessler Reliquary** | Three phases (Veil: break 8 rosary beads; Heart: 36 hp; Lamentation: faster, enraged). Attacks: tithe, stream, halo, homing wisps, censer, hurl (parry it back), tracked beam, lunge. It chases you if you run and never enters the Earth. |
| **End** | Win or death screen. The boss freezes the moment the run ends; Enter restarts. |
| **Boss fight button** | Red button in the page toolbar: skips Level 1 and starts the boss at once (for testing and practice). |
| **Ship bay** | Inspect screen: exterior, cutaway (pilot, reactor, tanks), weapons, scale comparison with the ISS. |

### Controls
| Input | Action |
|---|---|
| Click the glass | Mouse flight (pointer lock). Move = steer, wheel = throttle, left button = fire, right button = parry |
| Arrow keys | Steer (keyboard) |
| W / S | Throttle up / brake |
| A D or Q E | Roll |
| Shift | Boost |
| Space | Fire (hold) |
| X | Switch PULSE (rapid) and BLAST (hold to charge, release for a sonic boom) |
| F | Parry (0.3 s window; sends boss projectiles back, smashes ramming debris) |
| Z | Stabiliser / flight assist (levels the horizon, bleeds sideways drift) |
| L | Headlamp: auto (on in the dark), on, off |
| C | Camera: cockpit / chase |
| H | Dash hologram: exterior / cutaway |
| Tab | Pin the next threat (Shift+Tab previous) |
| N | Toggle sky labels |
| B | Back to the briefing |
| V (on briefing) | Ship bay |
| Gamepad | Supported through the Gamepad API (untested headless) |

## 3. How it is built

- **Single-file output.** `python3 world_src/build.py` concatenates `head.html` + `baked.js` + `world_src/js/*.js` (in filename order, wrapped in one IIFE) into `game/world.html`. Edit the sources, rebuild, reload. `world.html` is committed so the game can be opened straight from GitHub.
- **Renderer.** three.js r128. The 3D scene renders into a 480x300 `NearestFilter` render target; a post pass posterises and dithers it; a 2D canvas (`cv`, context `ctx`) is drawn over it for the cockpit, HUD and effects. Modes: Retro, Hi-Res, Smooth.
- **Scale.** 1 world unit = 10 km, the Earth is true size. Craft are drawn `CRAFT_X = 3500` times life size by one factor (`M(metres)` in `01_setup.js`). The player ship is 8 m (`SHIP_K = 0.45` in `03d_ship.js`).
- **Models** are written in real metres from merged parts (`mergeParts`, helpers `mb/mcx/mcz/mcy/mtz`, extruded `plate()` outlines, `pivotParts` for moving sections) with a flat-shaded material and a dark outline pass.
- **Real sky and Earth** are baked once by `bake.py` (stars, planets, Moon, land mask, city lights, day/night) for the epoch 2009-02-10 17:00 UTC, into `baked.js`.

### Source map (`world_src/js`, loaded in this order)
| File | What it holds |
|---|---|
| `01_setup.js` | DOM handles, constants, renderer, render target, shared shader uniforms `U`, `LABS` registry |
| `02_sky.js` | Stars, Earth shader (day/night, clouds, eclipse dimming), Moon and planets |
| `03_debris.js` | Debris material (flat shade + headlamp cone), instancing helpers |
| `03a_craft.js` | Satellite and station models in metres (ISS, Hubble, Envisat, Terra, Aqua, GPS, GEO, Iridium), `REAL` facts table |
| `03b_sats.js` | Friendly craft placement and orbits |
| `03c_debris_types.js` | Fragment and shard designs, family palettes, hero debris (Iridium 33, Cosmos 2251, CZ-4B stage) |
| `03d_ship.js` | The Astra-9 Mk2 ship in named sections, and its cutaway |
| `03e_boss.js` | The Kessler Reliquary model (body, head, eyes, halo, wings, rosary beads) |
| `04_game.js` | Game state, `update()`, flight model, firing, level flow (`bossWait`, `showCard`), `endGame`, the stand-in decay model `modelP` |
| `04b_boss.js` | Boss state machine: phases, attacks, telegraphs, chase, parry targets |
| `04c_weapons.js` | 3D laser ribbons from real muzzle positions, blast shockwave, camera and POV, FOV spring, space dust, headlamp |
| `04d_threat.js` | Threat scoring (`weight / (seconds + 5)`), arrows |
| `04e_input.js` | Mouse/keyboard/gamepad flight, smoothing, stabiliser, parry |
| `05a_pixel.js` | Pixel toolkit (`ptext`, `rect`, glyph font), static cockpit art, dash and instruments |
| `05b_dynamic.js` | HUD, guns, effects, boss HUD, **briefing card (`drawBrief`) and level title card (`drawCard`)**, overlays |
| `06_pilot.js` | The pilot sprite and animation |
| `06b_lab.js` | `#lab=NAME` orthographic model viewer with a metre ruler |
| `06c_bay.js` | Ship bay screens |
| `06d_holo.js` | Left dash hologram (ship sections coloured by heat, charge, thrust, damage) |
| `06e_map.js` | Right dash ground-track map: land, day/night, you, the ISS, predicted impact points |
| `07_main.js` | Event wiring, frame loop (with crash guard), test hashes |

### Plugging in the real model
`modelP(p)` in `04_game.js` is a **stand-in**: a logistic curve over `log10(daysOf(p))` for a 365-day re-entry target. Replace it (and `daysOf`) with predictions from the pipeline in `src/` (target settings are in `src/config.py`). The threat arrows, the dash map's impact crosses and the target readout all read from it.

## 4. Testing

There is no unit-test framework. The game has hash-triggered self-tests that print to the browser console, and a headless Chrome recipe for screenshots.

Open `world.html#<hash>`. Combine with `&`.

| Hash | What it does |
|---|---|
| `play` | Skip the briefing |
| `play&boss` | Start straight at the boss (needs `play`, otherwise the boss is frozen in the briefing) |
| `play&bosstest[&ph2\|&ph3]` | Boss with the intro skipped, optionally in phase 2 or 3 |
| `play&bosstest&selftest` | Drives the boss through all phases; expect `["end","win",false,true,420]` |
| `play&flowtest` | Clears Level 1, checks the hand-off to the boss, kills the ship, checks the boss freezes |
| `bosstest&parrytest` | Parry returns thrown wreckage; the heart loses hp |
| `clickboss` | Presses the Boss fight button and logs the state |
| `attacktest`, `chasetest`, `fovtest`, `assisttest`, `weapontest`, `holotest` | Beam/lunge/stream/wisps, boss chase and Earth floor, FOV spring, flight assist, weapons, hologram |
| `lab=iss` (also `hubble`, `envisat`, `terra`, `aqua`, `gps`, `geo`, `iridium`, `ship`, `shipcut`, `boss`, `frags`, `cz4`, `cosmos`, `iridium33`) | Model viewer; add `&rot=deg&pit=deg&h=metres` |
| `bay[&tab0..3]` | Open the ship bay |
| `&simN` | Fast-forward N seconds |
| `dark`, `chase`, `fastship`, `slowbolts`, `holobig`, `lance`, `fire` | Visual setups for screenshots |

**Headless screenshot** (macOS, Chrome):
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --use-angle=swiftshader \
  --enable-unsafe-swiftshader --ignore-gpu-blocklist --window-size=1000,640 --virtual-time-budget=6000 \
  --screenshot=out.png "file://$PWD/game/world.html#play&boss"
```
A blank, tiny screenshot almost always means a JavaScript error; add `--enable-logging=stderr` to see it.

To read a self-test result, add `--dump-dom --enable-logging=stderr` and grep the output for `SELFTEST`, `FLOWTEST` and so on.

## 5. Packages, imports and external resources

**The game (runtime).** No npm, no bundler, no framework.
- **three.js r128**, loaded from `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` (pinned in `build.py`). The game fails with a message if it cannot load.
- **Google Fonts** for the page chrome: Barlow, Barlow Condensed, Press Start 2P. The in-game text uses the project's own 5x7 pixel font (`05a_pixel.js`), so it works without the fonts.
- Browser APIs: WebGL, Canvas 2D, Pointer Lock, Gamepad, Fullscreen, `matchMedia` (reduced motion).

**Build.** Python 3 standard library only (`glob`, `os`) for `world_src/build.py`.

**Baking (one-off, only when the sky or Earth data changes).** `world_src/bake.py` imports `base64, io, json, math`, plus:
- `numpy`
- `Pillow` (`PIL.Image`)
- `astropy` (`astropy.time.Time`, `astropy.coordinates.get_body`, `get_body_barycentric`, `astropy.units`)

```bash
cd game/world_src
uv run --with astropy --with numpy --with pillow python bake.py     # rewrites baked.js
python3 build.py                                                      # rewrites ../world.html
```
Inputs, already in the folder: `stars.json`, `land.json`, `land50.json`, `places.json`.

**Prototype (earlier Streamlit version, kept for reference).** `game/prototype/app.py` imports `streamlit`, `pandas`, `numpy`, `plotly` (`plotly.graph_objects`), `itertools`, `math`.
```bash
uv run --with streamlit --with plotly --with pandas --with numpy streamlit run game/prototype/app.py
```

**Testing and screenshots.** Headless Google Chrome (command above). Nothing else.

**Research pipeline (the rest of the repo).** See the root `requirements.txt` / `pyproject.toml` / `uv.lock`.

## 6. References

**Data and sources**
- Star positions: **d3-celestial** (BSD-3) -> `stars.json`.
- Coastlines and cities: **Natural Earth** (public domain), via the world-atlas package -> `land.json`, `land50.json`, `places.json`.
- Sun, Moon and planet positions and sidereal time: **astropy** ephemerides, for 2009-02-10 17:00 UTC (the Iridium 33 / Cosmos 2251 collision was at about 16:56 UTC).
- Craft dimensions and masses: agency fact sheets from **NASA** (ISS, Hubble, Terra, Aqua), **ESA** (Envisat), USSF (GPS IIR), and Iridium. Where a source gave a range, `03a_craft.js` uses the best-supported number and the `REAL` table says so.
- Decay, catalogue and space-weather data for the model: **Space-Track** and **CelesTrak** (see the root `README.md`).

**Creative and design inspiration**
- **Blasphemous 2** (The Game Kitchen): the boss's grotesque-and-sacred imagery (monstrance, rosary, halo, wings, the telegraph-and-punish soulslike rhythm). Our boss, its name and its attacks are original; the game is not affiliated with it.
- **Asphalt** series (Gameloft): the flight feel (FOV spring that widens with speed and kicks on boost, banking into turns, assisted steering).
- 80s-90s cockpit space sims (Wing Commander, X-Wing, Elite) for the dash and retro-futuristic look; Horror-game headlamps (darkness with a cone of light) for the eclipse phase.
- The pixel look: ordered (Bayer 4x4) dithering and a fixed palette ramp shared by the cockpit art and the 3D scene.

## 7. Plan and next steps

**Done so far (in order):** scaled satellites and stations; ship exterior, cockpit match and cutaway; 3D laser bolts from the real gun positions; sonic BLAST weapon; dash hologram and ground-track map; threat arrows; parry; the Kessler Reliquary and its attacks; boss chase and Earth floor; flight assist, FOV spring, headlamp, smoother movement; Boss fight button; Level 1 title and briefing style; Level 1 -> boss hand-off; crash guard and boss freeze.

**Next, roughly in priority order**
1. **Hand-play balance.** The boss has only been tuned with scripted tests. Play it: damage numbers, cadence (2.3 / 1.7 / 1.05 s), parry window (0.3 s), phase thresholds.
2. **Connect the real model.** Replace `modelP` / `daysOf` with the project's decay predictions, so the threat ranking and the impact map reflect the research.
3. **Fragmentation.** The core idea of the original pitch: shooting a piece creates fragments, and the player must decide what is worth shooting.
4. **More levels.** The level flow now has a card system (`showCard`) and a hand-off (`bossWait`); a level table would replace the single hard-coded Level 1 -> boss path in `04_game.js`.
5. **Verify on real input.** Mouse flight (pointer lock) and gamepad have never been tested headlessly. Check the headlamp cone from the cockpit view.
6. **Sound.** There is none yet: charge hum, sonic boom, parry clang, boss heartbeat.
7. **Tidy.** `07_main.js` holds many test hashes and could be split; the boss lunge test reports no hit only because the harness resets the boss distance (the lunge does hit in play).

**Known quirks**
- The boss can overshoot its preferred distance slightly when the ship is stationary.
- `#boss` without `#play` leaves the boss frozen (by design: nothing runs in the briefing).

## 8. Picking it up

```bash
git clone https://github.com/kpaters4/space-cadet.git
cd space-cadet && git checkout space-cadet-world
open game/world.html                      # play it
python3 game/world_src/build.py           # after editing anything in game/world_src
```
Read `world_src/DESIGN.md` for the history of each design decision, then `06b_lab.js` (`#lab=ship`) is the fastest way to see any model in isolation.
