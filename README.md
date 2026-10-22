## space-cadet

# Research Question: Can we predict how many days a piece of space junk has left before it burns up, and does knowing what the Sun is doing make the prediction better?

Idea: A short arcade-style game where you're a cadet with limited space shots and a sky full of space junk. Shooting creates fragments, so the skill is knowing which pieces will fall on their own which wil stay up for decades.

## Datasets

| Source | What it gives us | Access |
|---|---|---|
| [CelesTrak Space Weather](https://celestrak.org/SpaceData/#:~:text=CSV%20starting%201957%20Oct%2001) | daily solar flux (F10.7) and geomagnetic indices (Ap/Kp), 1957-10-01 → present, plus a forecast to 2041 | public download → `data/raw/SW-All.csv` |
| [Space-Track Decay/Reentry](https://www.space-track.org/#decay) | when each object actually came down — **the labels** | free account required |
| [Satellite Catalogue](https://www.space-track.org/#catalog) | one row per object: launch date, orbit, type, radar cross-section — **the features** | free account required |
| Space-Track `gp_history` | orbital element history — one row per element set per object, across its life | free account required |

The first three join through one idea: satcat is the spine (`NORAD_CAT_ID`),
decay supplies the event, and space weather attaches by calendar day to an
*observation epoch* — "what we would have known on this date". Space weather has
no object key and the Space-Track tables have no date key, so without that epoch
there is nothing to join on. `gp_history` fixes the biggest weakness in the
other three: see [Orbit features](#orbit-features) below.

## Setup

```bash
pip install -r requirements.txt
```

Space weather is already in `data/raw/`. For the two Space-Track tables, either:

```bash
cp .env.example .env        # add your space-track.org credentials
python src/fetch_spacetrack.py
```

or export the catalogue and decay tables from the website by hand into
`data/raw/satcat.csv` and `data/raw/decay.csv`. The loader normalises the
different header spellings Space-Track uses, so either route works.

Then the orbital element history:

```bash
python src/fetch_gp_history.py
```

This is a separate, bigger download, which is why it's a second step — see
[Orbit features](#orbit-features) for why it matters.

## Build

```bash
python src/build_dataset.py
```

Writes to `data/processed/`:

- **`objects.csv`** — one row per catalogued object: launch, reentry, lifetime, orbit, type, size.
- **`panel.csv`** — **the modelling table.** One row per (object, observation epoch), with the label `days_remaining` and the space weather as of that epoch.
- **`feature_groups.json`** — which columns are orbit vs. space weather vs. known-only-after-the-fact, plus ready-made feature lists for the ablation. This one is checked into the repo (see below) so it's visible without running the pipeline; running the build overwrites it in place with the schema from your real data.
- **`space_weather_daily.csv`**, **`space_weather_monthly_forecast.csv`** — the cleaned solar series on their own.

No credentials yet? Smoke-test the whole pipeline, gp_history included, on
fake-but-correctly-shaped data:

```bash
python src/make_sample_data.py
python src/build_dataset.py --raw-dir data/sample --out-dir data/sample_out
```

Full column reference: [`src/SCHEMA.md`](src/SCHEMA.md).

## Orbit features

satcat only gives one snapshot of each object's orbit: the *last* values on
file. For a decayed object that's its final, already-decaying orbit — a
feature that has already seen the answer, and one that never changes across
that object's epochs (`orbit_terminal` in `feature_groups.json`, isolated so
you can exclude it).

`fetch_gp_history.py` fixes this by pulling Space-Track's orbital element
history (TLE-equivalent) for the objects the panel actually needs it for —
not the whole catalogue, just those with perigee ≤ `MAX_PERIGEE_KM` and
launched on/after `MIN_EPOCH`, in config.py — and `build_dataset.py` then
looks up each observation epoch's orbit from whichever element set was most
recently on file *at or before* that epoch (`orbit_asof`). That's a real,
epoch-accurate feature set: actual perigee decay rate, actual mean-motion
derivative, never a value from the object's future. This is the single
biggest available improvement to this dataset's honesty, which is why
`feature_groups.json`'s default ablation uses `orbit_asof`.

`build_dataset.py` requires `gp_history.csv` just like it requires `satcat.csv`
and `decay.csv` — it checks for all three up front and refuses to build the
panel if any is missing. `orbit_terminal` stays in the panel alongside
`orbit_asof`, purely so the `*_leaky_orbit` ablation entries can measure how
much the leaky snapshot would have been inflating the score.

## Why a panel instead of one row per object

"Days left" only means something relative to a moment of observation, and one
row per object can carry only one such moment — on which the Sun's behaviour is
a single day's noise. So each object contributes several epochs across its life:
the label is days from that epoch to reentry, the features are what the Sun had
been doing up to it. That is what makes the second half of the research question
answerable at all.

Objects still in orbit are kept as right-censored rows (`event_observed = 0`,
`days_remaining` null, `days_followed` = how long we watched). Survival models
should use them; drop them for plain regression. They are the majority of the
catalogue and throwing them away would bias everything toward things that fall
fast.

## Answering the second half of the question

`feature_groups.json` ships nested feature sets. Fit the same model on each,
compare on the `test` split, and the gap *is* the answer:

| Set | Features |
|---|---|
| `baseline_no_sun` | orbit (`orbit_asof`) + size + age only |
| `with_sun_trailing` | + solar/geomagnetic history up to the epoch |
| `with_sun_and_forecast` | + forward-looking solar means (needs a forecast at inference time) |
| `baseline_no_sun_leaky_orbit`, `with_sun_trailing_leaky_orbit` | the same two, but with `orbit_terminal` instead of `orbit_asof` — compare against `baseline_no_sun` to see how much the leaky snapshot was inflating the score |

Suggested target: `log1p_days_remaining` — the raw label spans days to decades.
Suggested metric: median absolute error in log space, or a survival
concordance index if you keep the censored rows.

## Known limitations — read before trusting a number

1. **`orbit_terminal` leaks.** satcat's `APOGEE`/`PERIGEE`/`PERIOD` are the
   *last* values on file. For an object that has already come down, that is
   its final decaying orbit — a feature that has seen the answer, and one
   that never changes across that object's epochs. They're isolated in the
   `orbit_terminal` feature group; `orbit_asof`, from `gp_history`, is the
   real fix (see above) and what the default ablation uses.
2. **gp_history coverage isn't total.** An epoch before an object's first
   element set, or more than `MAX_ELEMENT_AGE_DAYS` after its last one, has
   null `orbit_asof`. Check `element_age_days` and the coverage percentage
   `build_dataset.py` prints before assuming every row has it.
3. **No mass or area.** Drag depends on area-to-mass ratio; `rcs_size` /
   `rcs_value` are the only proxy available, and `rcs_size` is missing for a
   large share of debris.
4. **Catalogue bias.** Small debris is tracked inconsistently and historical
   coverage is thinner the further back you go, so the early record is not a
   random sample.
5. **Split caveat.** The default split cuts on `obs_date`, which is the honest
   test of forecasting forward in time but lets one object land in two splits.
   Group on `norad_cat_id` for an object-disjoint split.

## Layout

```
src/config.py            paths and tunables (epochs per object, perigee cut, seed)
src/fetch_spacetrack.py  authenticated download of satcat + decay
src/fetch_gp_history.py  authenticated download of gp_history, scoped to eligible objects
src/normalize.py         canonical column names across Space-Track's header variants
src/space_weather.py     clean SW-All.csv, derive trailing solar/geomagnetic features
src/build_dataset.py     join the sources -> objects.csv + panel.csv (incl. orbit_asof)
src/make_sample_data.py  fake data (incl. gp_history) for smoke-testing without credentials
src/SCHEMA.md            full data dictionary
```

## What's in `data/`, and what's on GitHub

`data/` itself is gitignored. One file is deliberately un-ignored:
`data/processed/feature_groups.json` — it's checked in, so the panel schema
and ablation feature lists are visible on GitHub without running anything.
Everything else stays local-only, for three different reasons:

| Path | What it is | Pushable? | Why |
|---|---|---|---|
| `data/raw/SW-All.csv` | CelesTrak space weather, downloaded by hand | No (but harmless if you did) | Public, re-downloadable, and its tail is a forecast that goes stale — a committed copy would quietly drift from the live file. Re-run the download instead of syncing a copy. |
| `data/raw/satcat.csv`, `data/raw/decay.csv`, `data/raw/gp_history.csv` | Space-Track catalogue, decay, and orbital-element-history exports | **No, never** | Space-Track's user agreement (accepted at sign-up) prohibits redistributing their data without USSTRATCOM's written permission. This holds even for a private repo — redistribution isn't about who can see it, it's about putting a copy somewhere outside their control. Applies to `gp_history.csv` just as much as the other two. |
| `data/processed/space_weather_daily.csv`, `space_weather_monthly_forecast.csv` | Cleaned/derived from `SW-All.csv` | No (not prohibited, just not worth it) | 8.3 MB, fully regenerated by `space_weather.py` from the raw file, and inherits the raw file's staleness problem. No redistribution restriction here — CelesTrak's data has none — this one's a size/maintenance call, not a legal one. |
| `data/processed/objects.csv`, `panel.csv` | The real modelling tables, once built from real Space-Track data | **No, never** | Derived *from* satcat/decay — close enough to the source that redistribution concerns carry over, on top of being large and regenerable. |
| `data/processed/feature_groups.json` | Column-name manifest + ablation feature lists | **Yes — committed** | Pure schema: column names and leakage notes, no Space-Track row values and no space-weather numbers. Deterministic given the code, so it's documentation, not data. |
| `data/sample/*.csv` (incl. `gp_history.csv`), `data/sample_out/*.csv` | Fake fixtures from `make_sample_data.py`, and the pipeline's output on them | No | Synthetic and seeded — reproducible with `python src/make_sample_data.py`. `sample_out/panel.csv` is also 26 MB for data nobody should model on. |

Rule of thumb: if it came from Space-Track (even indirectly), it doesn't leave
this machine. If it's just large and reproducible, regenerate it instead of
committing it. Schema-only files with no data in them are fair game.
