# Data dictionary

Four raw sources go in (one optional), two tables come out. `objects.csv` is
the object-level view (one row per catalogued object); `panel.csv` is the
modelling table.

## Join keys

| Source | Key | Notes |
|---|---|---|
| satcat | `NORAD_CAT_ID` | one row per object; the spine of the whole thing |
| decay | `NORAD_CAT_ID` | **many rows per object** — successive reentry messages, collapsed to the latest |
| gp_history *(optional)* | `NORAD_CAT_ID` + `EPOCH` | **many rows per object** — one per element set; as-of joined to each observation epoch |
| SW-All | `DATE` | daily; joined to each observation epoch on calendar day |

Space weather has no object key and the Space-Track tables have no date key, so
the only thing that links them is the observation epoch — which is why the panel
exists. gp_history is the one source that joins on *both* keys: nearest element
set at or before `obs_date`, per object (`pd.merge_asof(..., by="norad_cat_id")`).

## objects.csv

| Column | Type | Source | Meaning |
|---|---|---|---|
| `norad_cat_id` | int | satcat | catalogue number |
| `object_name`, `object_id` | str | satcat | name, international designator |
| `object_type` | str | satcat | PAYLOAD / ROCKET BODY / DEBRIS / UNKNOWN |
| `country`, `site` | str | satcat | owner, launch site |
| `launch_date` | date | satcat | |
| `decay_date` | datetime | decay, else satcat | reentry; null = still in orbit |
| `decay_date_provenance` | str | derived | `decay_dataset` / `satcat` / `none` / `dropped_decay_before_launch` |
| `is_decayed`, `event_observed` | bool/int | derived | reentry observed |
| `lifetime_days` | float | derived | `decay_date - launch_date` |
| `age_at_asof_days` | float | derived | age at the as-of date |
| `apogee_km`, `perigee_km` | float | satcat | **last elements on file** — see leakage below |
| `period_min`, `inclination_deg` | float | satcat | orbital period, inclination |
| `sma_km`, `eccentricity`, `mean_alt_km` | float | derived | from apogee/perigee, Earth radius 6378.137 km |
| `regime` | str | derived | LEO / ELLIPTICAL / MEO / GEO_PLUS / UNKNOWN |
| `rcs_size`, `rcs_value` | str/float | satcat | radar cross-section — the only proxy here for area-to-mass ratio, the dominant physical driver of drag |
| `is_debris` | bool | derived | DEBRIS, ROCKET BODY or TBA |
| `orbit_snapshot_is_terminal` | bool | derived | True when the orbit columns are a near-reentry snapshot |
| `n_decay_msgs`, `decay_pred_spread_days` | int/float | decay | how many reentry messages, and how far their predictions moved |

## panel.csv

One row per (object, observation epoch). `EPOCHS_PER_OBJECT` epochs (default 12)
are spread across each object's observed window — launch→reentry for decayed
objects, launch→as-of for the rest — on an even grid with small seeded jitter.

Carries every `objects.csv` column above, plus:

| Column | Meaning |
|---|---|
| `obs_date` | the observation epoch — "what we would have known on this day" |
| `epoch_index` | 0…n-1 within the object |
| `age_days` | `obs_date - launch_date` |
| **`days_remaining`** | **the label**: days from `obs_date` to reentry. Null for censored rows |
| `days_followed` | duration for survival models: `days_remaining` if decayed, else `asof - obs_date` |
| `log1p_days_remaining` | log label; the raw one spans days to decades |
| `split` | `train` / `valid` / `test`, cut at the 70th and 85th percentile of `obs_date` |

### Space weather features, at `obs_date`

Trailing windows end at and include `obs_date`, so everything in them was
measurable on the day — these are the honest predictors.

| Column pattern | Meaning |
|---|---|
| `f107_obs`, `f107_adj` | 10.7 cm solar flux that day; `_adj` is normalised to 1 AU |
| `f107_adj_last81` | trailing 81-day flux average, straight from the file |
| `ap_avg`, `ap_max_3h` | daily planetary geomagnetic index and its worst 3-hour value |
| `kp_avg`, `kp_max_3h` | Kp equivalents (raw file stores Kp×10; divided out here) |
| `sunspot_number`, `cp`, `c9` | sunspot number, daily character figures |
| `f107_adj_mean_{1,3,7,27,81,365}d` | trailing mean flux — 27d is a solar rotation, 81d is three |
| `ap_mean_{...}d` | trailing mean geomagnetic activity |
| `ap_max_{7,27,81,365}d` | worst storm in the window |
| `ap_storm_days_{7,27,81,365}d` | count of days with `ap_avg >= 50` |
| `f107_trend_81d` | 27-day mean minus 365-day mean — is the Sun ramping up or down |
| `f107_pct_rank_11y` | where the current flux sits in the last ~11 years, i.e. solar-cycle phase |
| `fwd_f107_adj_mean_{90,365}d`, `fwd_ap_mean_{90,365}d` | **forward-looking**: the days *after* the epoch. Usable only with a forecast at inference time |

### Orbit features, as of `obs_date` — `orbit_asof` (requires gp_history.csv)

Present only if `data/raw/gp_history.csv` has been fetched (`fetch_gp_history.py`).
Unlike `orbit_terminal` below, these come from the most recent element set
*on file at or before* `obs_date` — `pd.merge_asof(..., direction="backward")`
— so they genuinely vary across an object's epochs and never describe an orbit
it hadn't reached yet. This is the fix for leakage item 1 below.

| Column | Meaning |
|---|---|
| `apogee_km_asof`, `perigee_km_asof`, `period_min_asof`, `eccentricity_asof`, `inclination_deg_asof` | the matched element set's orbit, direct from gp_history |
| `sma_km_asof`, `mean_alt_km_asof` | derived from the above, same formulas as the `objects.csv` columns |
| `regime_asof` | LEO / ELLIPTICAL / MEO / GEO_PLUS / UNKNOWN, classified from the as-of orbit — compare to the (leaky) `regime` in `orbit_terminal` |
| `mean_motion`, `mean_motion_dot`, `bstar` | straight from gp_history: revs/day, its drift, and the drag term |
| `perigee_decay_rate_km_per_day` | trailing slope of perigee over the prior `PERIGEE_DECAY_WINDOW_DAYS` (default 30d), using only earlier element sets. Negative = losing altitude. Null if there's no earlier element inside the window |
| `element_age_days` | `obs_date - element_epoch` — how stale the matched element set was. Rows older than `MAX_ELEMENT_AGE_DAYS` (default 45d) have every `*_asof` column and this one set to null rather than stretched over a gap |

## Leakage — the part that decides whether a score means anything

1. **`orbit_terminal` columns** (`apogee_km`, `perigee_km`, `period_min`,
   `sma_km`, `eccentricity`, `mean_alt_km`, `regime`). satcat stores the *last*
   elements on file, not elements as of `obs_date`. For a decayed object that
   is its final, already-decaying orbit, so these partly encode the answer and
   are constant across all of an object's epochs. A model fit on them will look
   far better than it is.

   **Fixed by `orbit_asof` above**, if gp_history.csv has been fetched.
   `feature_groups.json`'s default ablation (`baseline_no_sun`,
   `with_sun_trailing`, `with_sun_and_forecast`) uses `orbit_asof` when it's
   available and falls back to `orbit_terminal` otherwise; the
   `*_leaky_orbit` ablation entries keep the old leaky version around
   specifically so you can measure how much it was inflating the score.
2. **`fwd_*` columns** use future days. Fine *if* you feed a solar forecast at
   inference time; cheating otherwise.
3. **`leakage_never_use_as_features`** in `feature_groups.json` lists columns
   known only after reentry (`lifetime_days`, `n_decay_msgs`, …). They ride
   along for inspection. Never fit on them.
4. **`F10.7_*_CENTER81`** from the raw file is dropped on load — it averages 40
   days of the future and cannot be forecast.
5. **Grouped splitting.** The default split cuts on `obs_date`, which is the
   right test for "would this have worked on junk we hadn't seen yet", but it
   lets one object appear in two splits. For a strictly object-disjoint split,
   group on `norad_cat_id` instead.
6. **gp_history coverage isn't 100%.** Rows before an object's first element
   set, or past `MAX_ELEMENT_AGE_DAYS` since its last one, have null
   `orbit_asof`. Check `element_age_days` and the null rate before assuming
   every row has it — `report()` in build_dataset.py prints the coverage.
