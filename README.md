## space-cadet

# Research Question: Can we predict how many days a piece of space junk has left before it burns up, and does knowing what the Sun is doing make the prediction better?

Idea: A short arcade-style game where you're a cadet with limited space shots and a sky full of space junk. Shooting creates fragments, so the skill is knowing which pieces will fall on their own which wil stay up for decades.

## Datasets

| Source | What it gives us | Access |
|---|---|---|
| [CelesTrak Space Weather](https://celestrak.org/SpaceData/#:~:text=CSV%20starting%201957%20Oct%2001) | daily solar flux (F10.7) and geomagnetic indices (Ap/Kp), 1957-10-01 → present, plus a forecast to 2041 | public download → `data/raw/SW-All.csv` |
| [Space-Track Decay/Reentry](https://www.space-track.org/#decay) | when each object actually came down — **the labels** | free account required |
| [Satellite Catalogue](https://www.space-track.org/#catalog) | one row per object: launch date, orbit, type, radar cross-section — **the features** | free account required |

The three join through one idea: satcat is the spine (`NORAD_CAT_ID`), decay
supplies the event, and space weather attaches by calendar day to an
*observation epoch* — "what we would have known on this date". Space weather has
no object key and the Space-Track tables have no date key, so without that epoch
there is nothing to join on.

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

## Build

```bash
python src/build_dataset.py
```

Writes to `data/processed/`:

- **`objects.csv`** — one row per catalogued object: launch, reentry, lifetime, orbit, type, size.
- **`panel.csv`** — **the modelling table.** One row per (object, observation epoch), with the label `days_remaining` and the space weather as of that epoch.
- **`feature_groups.json`** — which columns are orbit vs. space weather vs. known-only-after-the-fact, plus ready-made feature lists for the ablation.
- **`space_weather_daily.csv`**, **`space_weather_monthly_forecast.csv`** — the cleaned solar series on their own.

No credentials yet? Smoke-test the whole pipeline on fake-but-correctly-shaped data:

```bash
python src/make_sample_data.py
python src/build_dataset.py --raw-dir data/sample --out-dir data/sample_out
```

Full column reference: [`src/SCHEMA.md`](src/SCHEMA.md).

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

`feature_groups.json` ships three nested feature sets. Fit the same model on
each, compare on the `test` split, and the gap *is* the answer:

| Set | Features |
|---|---|
| `baseline_no_sun` | orbit + size + age only |
| `with_sun_trailing` | + solar/geomagnetic history up to the epoch |
| `with_sun_and_forecast` | + forward-looking solar means (needs a forecast at inference time) |

Suggested target: `log1p_days_remaining` — the raw label spans days to decades.
Suggested metric: median absolute error in log space, or a survival
concordance index if you keep the censored rows.

## Known limitations — read before trusting a number

1. **The orbit columns leak.** satcat's `APOGEE`/`PERIGEE`/`PERIOD` are the
   *last* values on file. For an object that has already come down, that is its
   final decaying orbit — a feature that has seen the answer, and one that never
   changes across that object's epochs. They are isolated in the
   `orbit_terminal` feature group so you can exclude them.

   **The fix:** pull Space-Track `gp_history` (the TLE archive) and take orbital
   elements *at each epoch* instead. That turns the panel into genuine
   time-series features — real perigee decay rate, real `n-dot` — and is the
   single biggest available improvement to this dataset. It is a much larger
   download, which is why it is not wired up here.
2. **No mass or area.** Drag depends on area-to-mass ratio; `rcs_size` /
   `rcs_value` are the only proxy available, and `rcs_size` is missing for a
   large share of debris.
3. **Catalogue bias.** Small debris is tracked inconsistently and historical
   coverage is thinner the further back you go, so the early record is not a
   random sample.
4. **Split caveat.** The default split cuts on `obs_date`, which is the honest
   test of forecasting forward in time but lets one object land in two splits.
   Group on `norad_cat_id` for an object-disjoint split.

## Layout

```
src/config.py            paths and tunables (epochs per object, perigee cut, seed)
src/fetch_spacetrack.py  authenticated download of satcat + decay
src/normalize.py         canonical column names across Space-Track's header variants
src/space_weather.py     clean SW-All.csv, derive trailing solar/geomagnetic features
src/build_dataset.py     join the three sources -> objects.csv + panel.csv
src/make_sample_data.py  fake data for smoke-testing without credentials
src/SCHEMA.md            full data dictionary
```

`data/` is gitignored — everything in it is re-downloadable.
