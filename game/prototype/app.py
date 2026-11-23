"""Space Cadet - playable prototype (Streamlit).

Sandbox only: all debris here is SIMULATED and the "Auto-Gunner" is a stand-in.
The single swap-point for the real model is `predict_reentry_prob()`.

Run:  uv run --with streamlit --with plotly --with pandas --with numpy streamlit run app.py
"""
from __future__ import annotations

import itertools
import math

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

# ----------------------------------------------------------------------------
# Game constants
# ----------------------------------------------------------------------------
HORIZON_DAYS = 365          # same target as PLAN.md Decision 1, option A
N_MISSIONS = 5
OBJECTS_PER_MISSION = 8
FRAGMENT_LIFE_FACTOR = 0.35  # fragments are lighter per area -> drag hits harder
EARTH_R = 6371.0

SOLAR_LEVELS = {"Quiet (F10.7 ~ 75)": 75, "Normal (F10.7 ~ 130)": 130,
                "Active (F10.7 ~ 200)": 200, "Storm (F10.7 ~ 250)": 250}
OBJECT_MIX = {"Low-orbit heavy": (0.60, 0.30, 0.10),
              "Mixed": (0.35, 0.35, 0.30),
              "High-orbit heavy": (0.10, 0.30, 0.60)}
BANDS = [(300, 450), (450, 600), (600, 800)]          # perigee km: low / mid / high
SIZE_FRAGMENTS = {"SMALL": 1, "MEDIUM": 2, "LARGE": 3}  # pieces a shot creates
SIZE_AM = {"SMALL": 1.5, "MEDIUM": 1.0, "LARGE": 0.6}   # area-to-mass proxy
TYPES = ["DEBRIS", "ROCKET BODY", "UNKNOWN"]


# ----------------------------------------------------------------------------
# Simulated physics (stand-in for sim/decay_sim.py, PLAN.md Phase 6)
# ----------------------------------------------------------------------------
def true_lifetime_days(perigee_km: float, am: float, f107: float, noise: float) -> float:
    """Hidden ground truth. Lifetime grows ~10x per 110 km of perigee, shrinks with
    drag (area-to-mass) and with solar activity (denser upper atmosphere)."""
    base = 5.0 * 10 ** ((perigee_km - 250.0) / 110.0)
    return base / am / 10 ** ((f107 - 130.0) / 150.0) * noise


def make_mission(seed: int, f107: float, mix: tuple[float, float, float]) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(OBJECTS_PER_MISSION):
        lo, hi = BANDS[rng.choice(3, p=mix)]
        perigee = float(rng.uniform(lo, hi))
        apogee = perigee + float(rng.exponential(60.0))
        size = str(rng.choice(list(SIZE_AM), p=[0.45, 0.35, 0.20]))
        am = SIZE_AM[size] * float(rng.lognormal(0.0, 0.2))
        life = true_lifetime_days(perigee, am, f107, float(rng.lognormal(0.0, 0.25)))
        rows.append({
            "id": f"M-{i + 1:02d}",
            "type": str(rng.choice(TYPES, p=[0.6, 0.25, 0.15])),
            "size": size,
            "perigee_km": round(perigee),
            "apogee_km": round(apogee),
            "drag": "High" if am > 1.3 else "Medium" if am > 0.8 else "Low",
            "f107": f107,
            "angle": float(rng.uniform(0, 2 * math.pi)),
            "_life": life,
            "_hint_noise": float(rng.normal(0.0, 0.3)),
        })
    return pd.DataFrame(rows)


def predict_reentry_prob(obj: pd.Series) -> float:
    """P(reenters within HORIZON_DAYS).  STAND-IN for the real model's /predict.

    It peeks at the simulator with a fixed error, so it is imperfect on purpose.
    Replace the body with a call to the trained pipeline / API.
    """
    log_life_hat = math.log10(obj["_life"]) + obj["_hint_noise"]
    z = (math.log10(HORIZON_DAYS) - log_life_hat) / 0.25
    return 1.0 / (1.0 + math.exp(-z))


# ----------------------------------------------------------------------------
# Scoring
# ----------------------------------------------------------------------------
def resolve(df: pd.DataFrame, shot_ids: list[str]) -> dict:
    """Fast-forward 365 days. Returns per-object outcomes and the mission score."""
    out = []
    after = 0
    for _, o in df.iterrows():
        persists = o["_life"] > HORIZON_DAYS
        if o["id"] in shot_ids:
            frags = SIZE_FRAGMENTS[o["size"]]
            persisting = frags if FRAGMENT_LIFE_FACTOR * o["_life"] > HORIZON_DAYS else 0
            after += persisting
            if not persists:
                verdict = "Wasted shot (it was coming down anyway)"
            elif persisting == 0:
                verdict = "Clean kill (fragments all fall)"
            else:
                verdict = f"Backfire: {persisting} fragment(s) stay up"
            status = "shot"
        else:
            persisting = 0
            after += int(persists)
            verdict = "Still up" if persists else "Fell on its own"
            status = "up" if persists else "fell"
        out.append({"id": o["id"], "life_days": round(o["_life"]), "status": status,
                    "result": verdict, "fragments_up": persisting})
    baseline = int((df["_life"] > HORIZON_DAYS).sum())
    wasted = sum(1 for r, (_, o) in zip(out, df.iterrows())
                 if r["status"] == "shot" and o["_life"] <= HORIZON_DAYS)
    score = 10 * (baseline - after) - 2 * wasted
    return {"rows": out, "baseline": baseline, "after": after, "wasted": wasted, "score": score}


def best_possible(df: pd.DataFrame, shots: int) -> int:
    ids = list(df["id"])
    best = 0
    for k in range(shots + 1):
        for combo in itertools.combinations(ids, k):
            best = max(best, resolve(df, list(combo))["score"])
    return best


# ----------------------------------------------------------------------------
# UI helpers
# ----------------------------------------------------------------------------
def orbit_map(df: pd.DataFrame, outcome: dict | None = None) -> go.Figure:
    fig = go.Figure()
    fig.add_shape(type="circle", x0=-EARTH_R, y0=-EARTH_R, x1=EARTH_R, y1=EARTH_R,
                  fillcolor="#1f4e8c", line_color="#4aa3ff")
    for lo, hi in [(450, 600), (600, 800)]:
        r = EARTH_R + lo
        fig.add_shape(type="circle", x0=-r, y0=-r, x1=r, y1=r,
                      line=dict(color="rgba(255,255,255,0.12)", dash="dot"))
    status = {r["id"]: r["status"] for r in outcome["rows"]} if outcome else {}
    palette = {"shot": "#ffb000", "up": "#ff5c5c", "fell": "#5cd68a", None: "#9fb3c8"}
    r = EARTH_R + df["perigee_km"]
    fig.add_trace(go.Scatter(
        x=r * np.cos(df["angle"]), y=r * np.sin(df["angle"]),
        mode="markers+text", text=df["id"], textposition="top center",
        textfont=dict(color="#cfe3ff", size=11),
        marker=dict(size=df["size"].map({"SMALL": 9, "MEDIUM": 13, "LARGE": 18}),
                    color=[palette[status.get(i)] for i in df["id"]],
                    line=dict(color="white", width=1)),
        customdata=np.stack([df["type"], df["size"], df["perigee_km"], df["drag"]], axis=-1),
        hovertemplate="%{text}<br>%{customdata[0]} - %{customdata[1]}"
                      "<br>perigee %{customdata[2]} km<br>drag %{customdata[3]}<extra></extra>",
    ))
    lim = EARTH_R + 900
    fig.update_xaxes(range=[-lim, lim], visible=False, scaleanchor="y")
    fig.update_yaxes(range=[-lim, lim], visible=False)
    fig.update_layout(height=460, margin=dict(l=0, r=0, t=0, b=0), showlegend=False,
                      paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")
    return fig


def start_run() -> None:
    st.session_state.update(mission=0, phase="plan", history=[], df=None, outcome=None,
                            run_seed=int(np.random.default_rng().integers(1, 10**6)))


def ensure_mission() -> None:
    if st.session_state.df is None:
        m = st.session_state.mission
        st.session_state.df = make_mission(
            st.session_state.run_seed * 10 + m,
            SOLAR_LEVELS[st.session_state.solar], OBJECT_MIX[st.session_state.mix])
        st.session_state.shots = st.session_state.ammo
        st.session_state.hints = False


# ----------------------------------------------------------------------------
# App
# ----------------------------------------------------------------------------
st.set_page_config(page_title="Space Cadet", page_icon="🛰️", layout="wide")
if "phase" not in st.session_state:
    start_run()

with st.sidebar:
    st.header("Knobs")
    st.caption("Applied to the *next* mission you start.")
    st.select_slider("Solar activity", options=list(SOLAR_LEVELS), value="Normal (F10.7 ~ 130)",
                     key="solar")
    st.selectbox("Object mix", list(OBJECT_MIX), index=1, key="mix")
    st.slider("Ammo per mission", 3, 5, 4, key="ammo")
    st.divider()
    if st.button("Restart run", width="stretch"):
        start_run()
        st.rerun()
    st.caption("Debris and physics are simulated. The Auto-Gunner is a stand-in, not the trained model.")

st.title("🛰️ Space Cadet")
total = sum(h["score"] for h in st.session_state.history)
c1, c2, c3 = st.columns(3)
c1.metric("Mission", f"{min(st.session_state.mission + 1, N_MISSIONS)} / {N_MISSIONS}")
c2.metric("Total score", total)
c3.metric("Horizon", f"{HORIZON_DAYS} days")

# ---- Final screen ----------------------------------------------------------
if st.session_state.phase == "final":
    st.subheader("Run complete")
    hist = pd.DataFrame(st.session_state.history)
    pct = total / max(hist["best"].sum(), 1)
    st.write(f"You scored **{total}** of a possible **{hist['best'].sum()}** ({pct:.0%}).")
    st.bar_chart(hist.set_index("mission")[["score", "best"]])
    if st.button("Play again", type="primary"):
        start_run()
        st.rerun()
    st.stop()

ensure_mission()
df: pd.DataFrame = st.session_state.df
m = st.session_state.mission

# ---- Planning phase -----------------------------------------------------------
if st.session_state.phase == "plan":
    st.markdown(
        f"**Mission {m + 1}.** You have **{st.session_state.shots} shots**. Anything that "
        f"stays up past {HORIZON_DAYS} days is a lasting hazard. Shoot those, not the ones "
        "about to fall. Careful: a shot creates fragments, and a big, high object can leave "
        "more lasting pieces than the one you removed."
    )
    left, right = st.columns([3, 2])
    with left:
        st.plotly_chart(orbit_map(df), width="stretch")
    with right:
        view = df[["id", "type", "size", "perigee_km", "apogee_km", "drag"]].copy()
        if st.toggle("Ask the Auto-Gunner", key=f"hint_{m}"):
            view["P(down in 365d)"] = [round(predict_reentry_prob(o), 2) for _, o in df.iterrows()]
        st.dataframe(view, hide_index=True, width="stretch")
    labels = {r.id: f"{r.id} · {r.type} · {r.size} · {r.perigee_km} km" for r in df.itertuples()}
    picks = st.multiselect("Pick your targets", list(labels), format_func=labels.get,
                           max_selections=st.session_state.shots, key=f"picks_{m}")
    if st.button(f"Fire {len(picks)} shot(s) and fast-forward {HORIZON_DAYS} days",
                 type="primary"):
        outcome = resolve(df, picks)
        outcome["best"] = best_possible(df, st.session_state.shots)
        outcome["picks"] = picks
        st.session_state.outcome = outcome
        st.session_state.history.append({"mission": f"M{m + 1}", "score": outcome["score"],
                                         "best": outcome["best"]})
        st.session_state.phase = "debrief"
        st.rerun()

# ---- Debrief phase -----------------------------------------------------------
else:
    out = st.session_state.outcome
    st.subheader(f"Debrief - mission {m + 1}")
    d1, d2, d3, d4 = st.columns(4)
    d1.metric("Hazards if you'd done nothing", out["baseline"])
    d2.metric("Hazards after your shots", out["after"])
    d3.metric("Mission score", out["score"])
    d4.metric("Best possible", out["best"])
    left, right = st.columns([3, 2])
    with left:
        st.plotly_chart(orbit_map(df, out), width="stretch")
        st.caption("Green fell on its own - red still up - amber was shot.")
    with right:
        res = pd.DataFrame(out["rows"]).merge(df[["id", "type", "size", "perigee_km"]], on="id")
        res = res[["id", "type", "size", "perigee_km", "life_days", "result"]]
        st.dataframe(res, hide_index=True, width="stretch")
    st.caption("Scoring: +10 per lasting hazard removed (net of fragments left behind), "
               "-2 per shot wasted on something that was coming down anyway.")
    last = m + 1 >= N_MISSIONS
    if st.button("See final result" if last else "Next mission", type="primary"):
        if last:
            st.session_state.phase = "final"
        else:
            st.session_state.update(mission=m + 1, phase="plan", df=None, outcome=None)
        st.rerun()
