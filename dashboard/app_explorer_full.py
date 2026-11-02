"""Space Cadet EDA -- interactive explorer for the orbital-debris reentry data.

Run:  uv run --with streamlit --with plotly streamlit run dashboard/app.py
Preprocessing lives in dashboard/preprocess.py.

Uses every row (train, valid and test). The loaders clean the data first and
record each step in a log, shown on the "Composition & data health" tab.
"""
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

st.set_page_config(page_title="Space Cadet", page_icon="🛰️", layout="wide")

PALETTE = ["#5ef2ff", "#ff6bd6", "#ffd166", "#9b8cff", "#6bffb0", "#ff8a5c", "#4d9bff", "#f2f2f2"]
TYPE_COLORS = {"DEBRIS": "#ff6bd6", "ROCKET BODY": "#ffd166", "PAYLOAD": "#5ef2ff",
               "UNKNOWN": "#9b8cff", "TBA": "#6bffb0"}
REGIME_COLORS = {"LEO": "#5ef2ff", "ELLIPTICAL": "#ff6bd6", "MEO": "#ffd166",
                 "GEO_PLUS": "#9b8cff", "UNKNOWN": "#8a8fa8"}
SOLAR, BARS = "#ffb347", "#5ef2ff"

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;800&family=Space+Grotesk:wght@300;400;600&display=swap');
html, body, [class*="css"], .stApp { font-family: 'Space Grotesk', sans-serif; }
.stApp {
  background:
    radial-gradient(1.5px 1.5px at 12% 18%, #fff, transparent),
    radial-gradient(1px 1px at 78% 8%, #cfe9ff, transparent),
    radial-gradient(1.5px 1.5px at 44% 62%, #fff, transparent),
    radial-gradient(1px 1px at 90% 74%, #ffe9cf, transparent),
    radial-gradient(1px 1px at 28% 88%, #fff, transparent),
    radial-gradient(1px 1px at 63% 36%, #cfe9ff, transparent),
    radial-gradient(ellipse at 15% 0%, #2a1458 0%, transparent 50%),
    radial-gradient(ellipse at 100% 100%, #08334d 0%, transparent 55%),
    #05060f;
  background-attachment: fixed;
}
header[data-testid="stHeader"] { background: transparent; }
section[data-testid="stSidebar"] { background: rgba(10,12,28,.72); backdrop-filter: blur(14px);
  border-right: 1px solid rgba(94,242,255,.15); }
h1, h2, h3 { font-family: 'Orbitron', sans-serif !important; letter-spacing: .04em; }
.hero { position: relative; padding: 2.2rem 0 1.2rem; }
.hero h1 { font-size: 3.1rem; font-weight: 800; margin: 0; line-height: 1.05;
  background: linear-gradient(92deg, #5ef2ff 0%, #9b8cff 45%, #ff6bd6 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.hero p { color: #9aa3c7; font-weight: 300; font-size: 1.1rem; margin: .5rem 0 0; max-width: 46rem; }
.orbit { position: absolute; right: 2%; top: -10px; width: 150px; height: 150px; opacity: .8; }
.orbit i { position: absolute; inset: 0; border: 1px solid rgba(94,242,255,.35); border-radius: 50%;
  transform: rotateX(70deg); }
.orbit i:nth-child(2) { inset: 18px; border-color: rgba(255,107,214,.4); transform: rotateX(70deg) rotateZ(40deg); }
.orbit b { position: absolute; width: 9px; height: 9px; border-radius: 50%; background: #ffd166;
  box-shadow: 0 0 12px #ffd166; top: 50%; left: 50%; margin: -4px; animation: spin 7s linear infinite; }
@keyframes spin { from { transform: rotate(0) translateX(75px) scaleY(.35); }
  to { transform: rotate(360deg) translateX(75px) scaleY(.35); } }
.readout { display: flex; gap: 14px; flex-wrap: wrap; margin: .6rem 0 1.4rem; }
.readout div { flex: 1 1 170px; padding: 12px 16px; border-radius: 14px;
  background: linear-gradient(160deg, rgba(94,242,255,.08), rgba(155,140,255,.04));
  border: 1px solid rgba(94,242,255,.2); box-shadow: inset 0 0 24px rgba(94,242,255,.04); }
.readout span { display: block; font-size: .68rem; letter-spacing: .18em; text-transform: uppercase; color: #7f89b3; }
.readout strong { font-family: 'Orbitron', sans-serif; font-size: 1.55rem; color: #eaf6ff;
  text-shadow: 0 0 14px rgba(94,242,255,.55); }
button[data-baseweb="tab"] { font-family: 'Orbitron', sans-serif; font-size: .78rem; letter-spacing: .06em; }
div[data-baseweb="tab-highlight"] { background: linear-gradient(90deg, #5ef2ff, #ff6bd6) !important; height: 3px; }
.key { margin: .2rem 0 1rem; padding: 12px 18px; border-radius: 14px; font-size: .9rem; color: #b8c0e0;
  background: rgba(14,16,36,.65); border: 1px dashed rgba(155,140,255,.35); }
.key b.t { font-family: 'Orbitron', sans-serif; font-size: .7rem; letter-spacing: .2em; color: #9b8cff; margin-right: 12px; }
.key .it { display: inline-flex; align-items: center; margin: 3px 18px 3px 0; }
.key .sw { width: 14px; height: 14px; border-radius: 4px; margin-right: 7px; box-shadow: 0 0 8px currentColor; }
.key .ln { width: 22px; height: 3px; margin-right: 7px; border-radius: 2px; box-shadow: 0 0 8px currentColor; }
.key .dm { width: 11px; height: 11px; margin-right: 8px; transform: rotate(45deg); background: currentColor; }
.key .note { display: block; margin-top: 4px; color: #8c95bd; font-size: .82rem; }
[data-testid="stPlotlyChart"] { border-radius: 18px; border: 1px solid rgba(94,242,255,.14);
  background: rgba(8,10,24,.45); padding: 6px; }
</style>
""", unsafe_allow_html=True)


def style(fig):
    fig.update_layout(
        template="plotly_dark", paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        colorway=PALETTE, font=dict(family="Space Grotesk, sans-serif", color="#c9d1f0"),
        legend=dict(bgcolor="rgba(8,10,24,.6)", bordercolor="rgba(94,242,255,.2)", borderwidth=1),
        margin=dict(l=40, r=30, t=40, b=40), hoverlabel=dict(bgcolor="#0b0e24", bordercolor="#5ef2ff"))
    fig.update_xaxes(gridcolor="rgba(120,140,220,.10)", zerolinecolor="rgba(120,140,220,.2)")
    fig.update_yaxes(gridcolor="rgba(120,140,220,.10)", zerolinecolor="rgba(120,140,220,.2)")
    return fig


def show(fig):
    st.plotly_chart(style(fig), width="stretch")


def key(items, note=""):
    """Legend panel. items: (kind, colour, label) with kind in sw/ln/dm."""
    html = "".join(f'<span class="it" style="color:{c}"><i class="{k}" style="background:{c}"></i>'
                   f'<span style="color:#c9d1f0">{lab}</span></span>' for k, c, lab in items)
    st.markdown(f'<div class="key"><b class="t">KEY</b>{html}'
                f'{f"<span class=note>{note}</span>" if note else ""}</div>', unsafe_allow_html=True)



st.markdown("""
<style>
.explain { margin: .3rem 0 1.6rem; padding: 14px 20px; border-radius: 14px; line-height: 1.55;
  background: linear-gradient(160deg, rgba(155,140,255,.10), rgba(94,242,255,.05));
  border-left: 3px solid #9b8cff; color: #c9d1f0; font-size: .93rem; }
.explain b.h { display: block; font-family: 'Orbitron', sans-serif; font-size: .66rem; letter-spacing: .2em;
  color: #5ef2ff; margin-top: 8px; }
.explain b.h:first-child { margin-top: 0; }
</style>
""", unsafe_allow_html=True)


def explain(what, read, why):
    """Plain-language caption under a chart, written for someone new to space data."""
    st.markdown(f'<div class="explain"><b class="h">WHAT THIS SHOWS</b>{what}'
                f'<b class="h">HOW TO READ IT</b>{read}'
                f'<b class="h">WHY IT MATTERS</b>{why}</div>', unsafe_allow_html=True)


from preprocess import (AS_OF, LEAKY, PANEL_COLS, gp_coverage as _gp_coverage, load_objects as _load_objects,
                        load_panel as _load_panel, solar_monthly as _solar_monthly)

load_panel = st.cache_data(show_spinner="Loading and cleaning panel (first run reads ~400 MB)...")(_load_panel)
load_objects = st.cache_data(show_spinner="Loading and cleaning objects...")(_load_objects)
solar_monthly = st.cache_data(_solar_monthly)
gp_coverage = st.cache_data(_gp_coverage)

def kaplan_meier(durations, events):
    """Returns (t, S(t)) step points. Plain numpy so there's no extra dependency."""
    d = np.asarray(durations, float)
    e = np.asarray(events, int)
    order = np.argsort(d)
    d, e = d[order], e[order]
    uniq, idx = np.unique(d, return_index=True)
    n = len(d)
    s, ts, ss = 1.0, [0.0], [1.0]
    for t, i in zip(uniq, idx):
        at_risk = n - i
        deaths = e[(d == t)].sum()
        if deaths:
            s *= 1 - deaths / at_risk
        ts.append(t)
        ss.append(s)
    return np.array(ts), np.array(ss)


panel, split_rows, split_objs, panel_log = load_panel()
objs, objs_log = load_objects()
CUTOFF = AS_OF

# ----------------------------------------------------------------- sidebar
st.sidebar.markdown("### 🛰️ MISSION FILTERS")
st.sidebar.caption(f"All data through **{AS_OF:%Y-%m-%d}**: train, valid and test.")
types = sorted(objs["object_type"].dropna().unique())
sel_types = st.sidebar.multiselect("Object types", types, default=[t for t in types if t != "PAYLOAD"])
yr_lo, yr_hi = int(objs["launch_year"].min()), int(objs["launch_year"].max())
sel_years = st.sidebar.slider("Launch years", yr_lo, yr_hi, (1990, yr_hi))
no_deep = st.sidebar.checkbox("Hide deep-space orbits (apogee > 100,000 km)", True,
                              help="109 objects on lunar/escape-type orbits stretch every altitude axis.")
sel_splits = st.sidebar.multiselect("Panel split (rows)", ["train", "valid", "test"], default=["train", "valid", "test"],
                                    help="Affects row-level charts built from panel.csv.")
st.sidebar.markdown("---")
st.sidebar.caption("Payloads are hidden by default (junk-only view); add them to compare.")

o = objs[objs["object_type"].isin(sel_types) & objs["launch_year"].between(*sel_years)]
p = panel[panel["object_type"].isin(sel_types) & panel["obs_date"].dt.year.between(*sel_years)
          & panel["split"].isin(sel_splits)]
if no_deep:
    o, p = o[~o["deep_space"]], p[~p["deep_space"]]

st.markdown("""
<div class="hero"><div class="orbit"><i></i><i></i><b></b></div>
<h1>SPACE CADET</h1>
<p>Tracking the junk that circles Earth, and the Sun that sweeps it from the sky.</p></div>
""", unsafe_allow_html=True)
med = o.loc[o["event"] == 1, "life_days"].median() if o["event"].sum() else None
st.markdown(f"""
<div class="readout">
<div><span>Objects tracked</span><strong>{len(o):,}</strong></div>
<div><span>Already fallen</span><strong>{o['event'].mean() if len(o) else 0:.0%}</strong></div>
<div><span>Median time aloft</span><strong>{f"{med:,.0f} d" if med == med and med is not None else "–"}</strong></div>
<div><span>Observations</span><strong>{len(p):,}</strong></div>
</div>""", unsafe_allow_html=True)

with st.expander("New to space? Quick glossary"):
    st.markdown("""
- **Orbit:** the path an object follows around the Earth. It keeps falling around the planet without hitting it.
- **Space junk (debris):** dead satellites, spent rocket stages and broken-off fragments that no longer do anything.
- **Reentry:** when an object sinks low enough to hit the thick air, burn up and leave orbit.
- **Drag:** the tiny push from the thin air at the edge of space. It slows objects down so they sink.
- **Low Earth orbit (LEO):** roughly 160 to 2,000 km up. It is crowded, and junk here eventually falls on its own.
- **Perigee / apogee:** the lowest and highest point of an orbit, in km above the ground.
- **Inclination:** the tilt of the orbit. 0 degrees is over the equator and 90 degrees passes over the poles.
- **Solar flux (F10.7):** a number for how active the Sun is. High flux heats and puffs up the upper atmosphere, which means more drag.
- **Geomagnetic storm (Ap):** a burst of solar activity that disturbs the atmosphere for a few days.
- **Radar size:** how big an object looks to radar (small, medium, large). It is a rough hint at size.
- **NORAD id:** the catalogue number each tracked object gets.
""")

tabs = st.tabs(["☀️ Solar pulse", "⏳ Survival curves", "🔭 Free explorer",
                "🌌 Orbit garden", "📅 Reentry calendar", "🧭 Composition & data health",
                "🧨 Debris clouds", "🌍 Orbital census", "🧪 Lifespan lab", "🧬 Feature signal"])

# ----------------------------------------------------------------- solar pulse
with tabs[0]:
    st.subheader("Does the Sun clear the sky?")
    st.caption("Bars are monthly reentries; the line is solar flux. Drag the rolling window "
               "and compare lag: a denser atmosphere should raise reentries shortly after flux rises.")
    a, b, c = st.columns(3)
    flux_col = a.selectbox("Solar series", ["f107_adj_mean_27d", "f107_adj_mean_81d", "f107_adj_mean_365d", "ap_mean_27d"], index=1)
    smooth = b.slider("Smooth reentries (months)", 1, 24, 3)
    lag = c.slider("Shift solar series forward (months)", 0, 24, 0,
                   help="Plots flux as if it arrived this many months later; look for the lag that lines up peaks.")
    key([("sw", BARS, "reentries per month (left axis)"), ("ln", SOLAR, "solar / geomagnetic series (right axis)")],
        "Tall bars under a high orange line = more junk falling while the Sun is active. "
        "Slide the shift to test whether the Sun leads or lags.")
    ev = o[o["event"] == 1].copy()
    monthly = ev.groupby(ev["decay_date"].dt.to_period("M")).size().rename("reentries")
    monthly.index = monthly.index.to_timestamp()
    monthly = monthly.asfreq("MS", fill_value=0).rolling(smooth, min_periods=1).mean()
    # Panel obs rows are sparse per month; average the solar series over each month.
    solar = (panel.dropna(subset=[flux_col]).groupby(panel["obs_date"].dt.to_period("M"))[flux_col].mean())
    solar.index = solar.index.to_timestamp()
    solar = solar.shift(lag, freq="MS")
    solar = solar.dropna()
    if len(monthly) and len(solar):
        # Only show months where both series have data.
        lo, hi = max(monthly.index.min(), solar.index.min()), min(monthly.index.max(), solar.index.max())
        monthly, solar = monthly.loc[lo:hi], solar.loc[lo:hi]
    fig = go.Figure()
    fig.add_bar(x=monthly.index, y=monthly.values, name="Reentries / month", marker_color=BARS, marker_opacity=0.65)
    fig.add_scatter(x=solar.index, y=solar.values, name=flux_col, yaxis="y2", line=dict(width=3, color=SOLAR))
    fig.update_layout(height=480, yaxis=dict(title="reentries"),
                      yaxis2=dict(title=flux_col, overlaying="y", side="right"),
                      legend=dict(orientation="h", y=1.1), hovermode="x unified")
    show(fig)
    explain(
        'Two things on one timeline: how many pieces of space junk fall back to Earth each month (cyan bars), and how active the Sun is (orange line).',
        "When the Sun is busy, it heats and puffs up the Earth's thin upper atmosphere, like warm air expanding. Satellites and junk skim through that thin air and get slowed down (this is called drag), so they sink lower and eventually burn up. If the Sun really helps clear the sky, tall cyan bars should line up with high stretches of the orange line. The lag slider checks whether the effect shows up months later.",
        'This is the core idea of the project: the Sun is a natural cleaner for low orbits. If the two curves clearly move together, solar activity is a useful clue for predicting when junk will fall.')
    joined = pd.concat([monthly, solar], axis=1, join="inner").dropna()
    if len(joined) > 12:
        st.info(f"Correlation between the two series at lag {lag} months: "
                f"**{joined.iloc[:, 0].corr(joined.iloc[:, 1]):.2f}** over {len(joined)} months. "
                "Correlation here is descriptive, not causal; catalog growth also moves reentry counts.")

    st.markdown("#### Lag profile: when does the Sun matter most?")
    key([("ln", "#ff6bd6", "correlation at each lag"), ("dm", "#ffd166", "best lag")],
        "Positive lag = solar flux leads reentries. A clear peak away from zero means the atmosphere takes time to "
        "swell and drag objects down; a flat curve means the link is weak or swamped by catalog growth.")
    raw = ev.groupby(ev["decay_date"].dt.to_period("M")).size()
    raw.index = raw.index.to_timestamp()
    raw = raw.asfreq("MS", fill_value=0)
    sol = panel.dropna(subset=[flux_col]).groupby(panel["obs_date"].dt.to_period("M"))[flux_col].mean()
    sol.index = sol.index.to_timestamp()
    rows = []
    for L in range(-12, 37):
        j = pd.concat([raw, sol.shift(L, freq="MS")], axis=1, join="inner").dropna()
        if len(j) > 24:
            rows.append((L, j.iloc[:, 0].rank().corr(j.iloc[:, 1].rank()), len(j)))
    if rows:
        lp = pd.DataFrame(rows, columns=["lag_months", "corr", "n"])
        best = lp.loc[lp["corr"].idxmax()]
        fig = px.line(lp, x="lag_months", y="corr", markers=True, hover_data=["n"],
                      color_discrete_sequence=["#ff6bd6"], height=360)
        fig.add_scatter(x=[best["lag_months"]], y=[best["corr"]], mode="markers",
                        marker=dict(size=14, symbol="diamond", color="#ffd166"), showlegend=False,
                        hovertext=f"best lag {best['lag_months']:.0f} mo (rho={best['corr']:.2f})")
        fig.update_layout(xaxis_title="months solar series is shifted forward", yaxis_title="Spearman correlation")
        show(fig)
        explain(
            "A timing test. It slides the Sun's curve earlier or later and asks, at each shift, how closely reentries still match it.",
            'Each dot is one shift, from 12 months before to 36 months after. The higher the dot, the better the match. The yellow diamond is the best match. A peak at 0 means the atmosphere reacts quickly. A peak a few months out means it reacts slowly. A flat line means there is no clear link.',
            "It tells us whether a prediction should use today's solar activity or an average from months ago.")

# ----------------------------------------------------------------- survival
with tabs[1]:
    st.subheader("How long does junk last?")
    st.caption("Kaplan-Meier curves: the share of objects still in orbit after N days. "
               "Objects not yet fallen as of today are censored, not dropped.")
    a, b, c = st.columns(3)
    group = a.selectbox("Split curves by", ["object_type", "regime", "launch_decade", "rcs_size", "country"])
    top_n = b.slider("Max groups", 2, 12, 6)
    xlog = c.checkbox("Log x-axis", True)
    show_half = c.checkbox("Mark half-life", True)
    key([("ln", "#5ef2ff", "one curve per group (n = objects)"), ("dm", "#ffd166", "half-life: day when half the group has fallen")],
        "Curves falling faster to the left decay sooner. A curve that stays high is junk that will linger for decades.")
    keep = o[group].value_counts().head(top_n).index
    fig = go.Figure()
    for g in keep:
        sub = o[o[group] == g]
        t, s = kaplan_meier(sub["life_days"], sub["event"])
        fig.add_scatter(x=t, y=s, mode="lines", line_shape="hv", name=f"{g} (n={len(sub):,})")
        if show_half and (s < 0.5).any():
            half = t[np.argmax(s < 0.5)]
            fig.add_scatter(x=[half], y=[0.5], mode="markers", marker=dict(size=10, symbol="diamond"),
                            showlegend=False, hovertext=f"{g} half-life: {half:,.0f} d")
    fig.update_layout(height=520, xaxis_title="days since launch",
                      yaxis_title="P(still in orbit)", xaxis_type="log" if xlog else "linear",
                      yaxis_range=[0, 1.02])
    show(fig)
    explain(
        'For each group of objects, a curve showing what share of them is still in orbit as time passes after launch. The time axis is logarithmic, so each step to the right is ten times longer.',
        "Everything starts at 100% on the left, right when it is launched. Each time an object falls back to Earth, the line steps down. A curve that drops fast is a group that falls quickly. A curve that stays high is a group that lingers for decades. The diamonds mark the half-life: the time by which half the group has fallen. Objects still up today are counted as 'not fallen yet' instead of being thrown out, which keeps the comparison fair.",
        'It shows which kinds of junk are the long-term problem (slow curves) and which clear on their own.')

# ----------------------------------------------------------------- explorer
with tabs[2]:
    st.subheader("Plot anything against anything")
    num = [c for c in p.columns if c not in ("norad_cat_id", "obs_date", "split", "object_type", "regime", "country", "deep_space")]
    a, b, c, d = st.columns(4)
    x = a.selectbox("X", num, index=num.index("f107_adj_mean_81d"))
    y = b.selectbox("Y", num, index=num.index("log1p_days_remaining"))
    color = c.selectbox("Colour", ["object_type", "regime", "split", "(none)"] + num, index=0)
    kind = d.radio("Mark", ["scatter", "density heatmap", "hexbin-style contour"], horizontal=False)
    e, f, g = st.columns(3)
    n = e.slider("Sample size", 1000, 60000, 15000, 1000)
    only_fell = f.checkbox("Only rows with an observed reentry", True)
    trend = g.checkbox("Trendline (scatter, LOWESS)", False)
    if {x, y} & LEAKY:
        st.warning("These orbit columns are satcat's **last-on-file** values, which for decayed objects "
                   "are a near-reentry snapshot, so they leak the answer. "
                   "Fine for understanding, not for features.")
    key([("sw", TYPE_COLORS["DEBRIS"], "debris"), ("sw", TYPE_COLORS["ROCKET BODY"], "rocket body"),
         ("sw", TYPE_COLORS["PAYLOAD"], "payload"), ("sw", TYPE_COLORS["UNKNOWN"], "unknown")],
        "Colours apply when colouring by object type. Heatmap/contour: brighter = more observations. "
        "Hover a point for its NORAD id and date.")
    q = p[p["event_observed"] == 1] if only_fell else p
    q = q.dropna(subset=[x, y]).sample(min(n, len(q)), random_state=0) if len(q) else q
    if q.empty:
        st.info("No rows match the current filters.")
    else:
        col = None if color == "(none)" else color
        if kind == "scatter":
            fig = px.scatter(q, x=x, y=y, color=col, opacity=0.5, color_discrete_map={**TYPE_COLORS, **REGIME_COLORS}, height=560,
                             hover_data=["norad_cat_id", "obs_date"],
                             trendline="lowess" if trend else None)
        elif kind == "density heatmap":
            fig = px.density_heatmap(q, x=x, y=y, nbinsx=60, nbinsy=60, height=560,
                                     color_continuous_scale="Plasma")
        else:
            fig = px.density_contour(q, x=x, y=y, color=col if color in ("object_type", "regime", "split") else None,
                                     color_discrete_map={**TYPE_COLORS, **REGIME_COLORS},
                                     height=560)
        show(fig)
        explain(
            'A build-your-own chart. Pick any two measurements for the two axes and see how they relate. Each dot is one object on one date.',
            "If the dots form a pattern (a slope or a curve), the two measurements are related. A shapeless cloud means they are not. The heatmap and contour modes show where dots pile up: brighter means more. The colour setting adds a third measurement. Each row of data holds the object, the Sun's activity that day, and how long the object lasted after that.",
            'It is free exploration: spot relationships, outliers and strange clusters before trusting anything in a model. Orbit columns marked as leaky give away the answer, so they should not be used as predictors.')

# ----------------------------------------------------------------- orbit garden
with tabs[3]:
    st.subheader("Orbit garden")
    st.caption("Every object as a point in orbit space. Rotate, zoom, and filter by altitude; "
               "colour by how long it lasted.")
    a, b, c = st.columns(3)
    key([("sw", "#440154", "short-lived (low log-lifetime)"), ("sw", "#21918c", "medium"), ("sw", "#fde725", "long-lived")],
        "Axes: inclination (tilt), perigee (lowest point) and apogee (highest point), in km. "
        "Dense low clusters are the crowded shells of low Earth orbit.")
    alt_hi = a.slider("Max apogee (km)", 400, 400000, 2000, 100)
    color_by = b.selectbox("Colour by", ["life_days", "launch_year", "eccentricity"], index=0)
    nmax = c.slider("Max points", 1000, 30000, 8000, 1000)
    z = o[(o["apogee_km"] <= alt_hi) & o["orbit_valid"]]
    z = z[z["perigee_km"] > -100]
    z = z.sample(min(nmax, len(z)), random_state=0) if len(z) else z
    if z.empty:
        st.info("No objects match.")
    else:
        zc = z.assign(log_life=np.log10(z["life_days"].clip(lower=1)))
        fig = px.scatter_3d(zc, x="inclination_deg", y="perigee_km", z="apogee_km",
                            color="log_life" if color_by == "life_days" else color_by,
                            color_continuous_scale="Turbo", opacity=0.75, height=640,
                            hover_name="object_name", hover_data=["object_type", "launch_year", "event"])
        fig.update_traces(marker_size=2.5)
        show(fig)
        explain(
            'A 3D map of orbits. Each dot is one object, placed by how tilted its orbit is and by its lowest and highest altitude.',
            'Perigee is the lowest point of an orbit and apogee is the highest, both in km above the ground. Dots along a diagonal have nearly circular orbits. Inclination is the tilt: 0 degrees circles over the equator, 90 degrees passes over the poles. Colour shows how long the object stayed up: purple is short, yellow or red is long. Drag to rotate, scroll to zoom.',
            'It shows where the junk actually is. The crowded layers low down are where drag and collisions happen, and altitude is the biggest single factor in how long something lasts.')
        st.caption("Orbit columns are satcat's last-on-file values, so decayed objects show their near-reentry "
                   "orbit (low perigee). Colour `log_life` = log10(days observed).")

# ----------------------------------------------------------------- calendar
with tabs[4]:
    st.subheader("Reentry calendar")
    key([("sw", "#0b0b25", "few reentries"), ("sw", "#d9467f", "some"), ("sw", "#fcffa4", "many")],
        "Each cell is one reentry year against month or launch decade. Bright diagonals mark debris from one era falling out together.")
    ev = o[o["event"] == 1]
    a, b = st.columns(2)
    mode = a.radio("Axes", ["year × month", "year × launch decade"], horizontal=True)
    norm = b.checkbox("Normalise each year to 100%", False)
    if ev.empty:
        st.info("No reentries match.")
    else:
        if mode == "year × month":
            tbl = ev.groupby([ev["decay_date"].dt.year.rename("year"), ev["decay_date"].dt.month.rename("month")]).size().unstack(fill_value=0)
            tbl = tbl.reindex(columns=range(1, 13), fill_value=0)
        else:
            tbl = ev.groupby([ev["decay_year"].rename("year"), "launch_decade"]).size().unstack(fill_value=0)
        if norm:
            tbl = tbl.div(tbl.sum(axis=1).replace(0, np.nan), axis=0) * 100
        fig = px.imshow(tbl.T, aspect="auto", color_continuous_scale="Magma",
                        labels=dict(x="reentry year", color="% of year" if norm else "reentries"), height=520)
        show(fig)
        explain(
            'A heatmap of how many objects fell back to Earth in each year and month, or in each year grouped by the decade they were launched.',
            "Each square is one period: dark means few, bright means many. Vertical bright stripes are busy years. In the decade view, each row is the decade the object was launched, so a bright patch shows which era's junk is falling now. 'Normalise' makes every year add up to 100%, so you see the mix instead of the volume.",
            'It reveals waves of reentries, for example after high-Sun years or big breakups, and how old the junk is when it falls.')
        st.caption("Year × launch decade shows who is coming down now: bright diagonals are debris "
                   "from a single era falling out together.")

# ----------------------------------------------------------------- composition + health
with tabs[5]:
    st.subheader("Composition")
    sb = o.assign(status=np.where(o["event"] == 1, "reentered", "in orbit")).fillna({"regime": "UNKNOWN"})
    key([("sw", TYPE_COLORS["DEBRIS"], "debris"), ("sw", TYPE_COLORS["ROCKET BODY"], "rocket body"),
         ("sw", TYPE_COLORS["PAYLOAD"], "payload"), ("sw", TYPE_COLORS["UNKNOWN"], "unknown")],
        "Inner ring: object type. Middle: orbit regime. Outer: reentered or still in orbit. Click a slice to zoom.")
    fig = px.sunburst(sb, path=["object_type", "regime", "status"], color_discrete_map=TYPE_COLORS, height=560)
    show(fig)
    explain(
        'A pie chart made of rings that breaks down everything in the catalogue.',
        'Inner ring: type of object. Debris is broken-off fragments, a rocket body is a spent rocket stage, a payload is a satellite (working or dead). Middle ring: how high it orbits. LEO is low Earth orbit (up to about 2,000 km), MEO is the middle band, GEO is about 36,000 km up, and elliptical means an egg-shaped orbit. Outer ring: fallen back, or still in orbit. Click a slice to zoom in and the centre to zoom out.',
        'It gives a quick picture of what we are dealing with: most of it is debris in low orbit.')

    st.subheader("Reentry within a horizon, by group")
    a, b = st.columns(2)
    horizon = a.slider("Horizon (days)", 30, 1825, 365, 30)
    by = b.selectbox("Group by", ["object_type", "regime", "rcs_size"], key="hz")
    # A row has a defined label only if its whole horizon has already happened.
    r = p[p["obs_date"] + pd.Timedelta(days=horizon) <= AS_OF]
    hit = ((r["event_observed"] == 1) & (r["days_remaining"] <= horizon)).astype(int)
    lab = r.assign(hit=hit).groupby(by, observed=True)["hit"].agg(["mean", "size"]).reset_index()
    fig = px.bar(lab, x=by, y="mean", text="size", color=by, color_discrete_map={**TYPE_COLORS, **REGIME_COLORS}, height=380,
                 labels={"mean": f"share reentering ≤ {horizon}d"})
    fig.update_traces(texttemplate="n=%{text:,}", textposition="outside")
    show(fig)
    explain(
        'The chance that an object falls back within a time you choose, for each group.',
        'Pick a horizon (365 means one year). Each bar is the share of observations in that group that fell within that time. The number on top is how many observations went into it. Only observations whose whole time window has already passed are counted, so the comparison is fair.',
        'This is the question a prediction model has to answer: will this object come down in the next year? Big differences between bars show which groups are easier to call.')
    st.caption(f"Uses every observation whose {horizon}-day window has fully elapsed (including objects that never fell), "
               "so the rates are unbiased within each group. Bars are labelled with the number of observations.")

    st.subheader("Split sizes and missingness")
    sp = pd.DataFrame({"rows": pd.Series(split_rows), "objects": pd.Series(split_objs)})
    st.dataframe(sp.rename_axis("split"), width="content")
    st.caption("Rows after cleaning, before the sidebar filters.")
    miss = p.drop(columns="deep_space").isna().mean().sort_values(ascending=False).head(15).reset_index()
    miss.columns = ["column", "share missing"]
    fig = px.bar(miss, x="share missing", y="column", orientation="h", color_discrete_sequence=["#9b8cff"], height=420)
    fig.update_yaxes(autorange="reversed")
    show(fig)
    explain(
        'A bar for each column with the most gaps, meaning missing values.',
        "A longer bar means more of that column is empty. Empty usually means the information was not recorded or does not apply. For example, objects that have not fallen yet have no 'days remaining'.",
        'It shows which columns we can trust and where cleaning or filling-in is needed.')

    st.subheader("Cleaning log")
    st.caption(f"What the loaders did before any chart saw the data (as of {AS_OF:%Y-%m-%d}).")
    st.dataframe(pd.DataFrame(panel_log + objs_log, columns=["step", "rows / columns affected", "what happened"]),
                 hide_index=True, width="stretch")
    n_gp, rows_gp, gp_lo, gp_hi = gp_coverage()
    if n_gp < 1000:
        st.warning(f"`gp_history.csv` currently holds only **{n_gp} objects** ({rows_gp:,} element sets, "
                   f"{gp_lo} to {gp_hi}). That is a small test pull, so the `*_asof` orbit features are almost "
                   "empty and descent-trajectory plots are not possible yet.")

# ----------------------------------------------------------------- debris clouds
fam_all = objs.dropna(subset=["object_id"]).assign(fam=lambda d: d["object_id"].astype(str).str[:8])


@st.cache_data
def family_table(_df, cutoff):
    d = _df[_df["object_type"].isin(["DEBRIS", "ROCKET BODY", "TBA", "UNKNOWN"])]
    g = d.groupby("fam")
    t = g.agg(pieces=("norad_cat_id", "size"), fallen=("event", "sum"), launch=("launch_date", "min")).reset_index()
    names = _df.sort_values("norad_cat_id").groupby("fam")["object_name"].first()
    t["parent"] = t["fam"].map(names)
    t["pct_fallen"] = t["fallen"] / t["pieces"]
    t["year"] = t["launch"].dt.year
    t["label"] = t["parent"].astype(str) + " (" + t["year"].astype(str) + ")"
    return t.sort_values("pieces", ascending=False)


with tabs[6]:
    st.subheader("Debris clouds: one launch, thousands of pieces")
    fam_t = family_table(fam_all, CUTOFF)
    key([("sw", "#2b0f54", "mostly still up"), ("sw", "#ff6bd6", "about half fallen"), ("sw", "#5ef2ff", "mostly fallen")],
        "Each tile is one launch (international designator). Size = pieces of junk catalogued, colour = share already "
        "reentered. Big, mostly-still-up tiles are the long-term threat.")
    a, b = st.columns(2)
    top = a.slider("Show top N launches", 10, 80, 30)
    min_year = b.slider("Launched since", 1957, 2025, 1957)
    ft = fam_t[fam_t["year"] >= min_year].head(top)
    fig = px.treemap(ft, path=["label"], values="pieces", color="pct_fallen",
                     color_continuous_scale=[[0, "#2b0f54"], [0.5, "#ff6bd6"], [1, "#5ef2ff"]],
                     range_color=(0, 1), hover_data=["fallen", "pieces"], height=520)
    fig.update_traces(textinfo="label+value")
    show(fig)
    explain(
        'Each tile is one launch or event that created a lot of junk, such as a satellite destroyed in a test or a rocket stage that broke apart.',
        'A bigger tile means more pieces. Colour shows how many have fallen: dark purple means most are still up, cyan means most have come down. A big dark tile is a lasting hazard.',
        'A handful of events produce a huge share of all the junk, and the ones that stay up are the ones to worry about.')

    st.markdown("#### How fast does a cloud clear?")
    key([("ln", "#5ef2ff", "one line per selected cloud")],
        "Fraction (or count) of that launch's junk still in orbit. Steep drops = low, drag-dominated clouds; "
        "long plateaus = clouds above ~800 km that will outlast us.")
    pick = st.multiselect("Clouds", ft["label"].tolist(), default=ft["label"].tolist()[:5])
    mode = st.radio("Measure", ["fraction still in orbit", "objects still in orbit"], horizontal=True)
    grid = pd.date_range("1960-01-01", CUTOFF, freq="MS")
    fig = go.Figure()
    for lab in pick:
        fam = ft.loc[ft["label"] == lab, "fam"].iloc[0]
        m = fam_all[(fam_all["fam"] == fam) & fam_all["object_type"].isin(["DEBRIS", "ROCKET BODY", "TBA", "UNKNOWN"])]
        dec = m["decay_date"].dropna().dt.to_period("M").dt.to_timestamp()
        gone = dec.value_counts().reindex(grid, fill_value=0).cumsum()
        left = len(m) - gone
        start = max(m["launch_date"].min().to_period("M").to_timestamp(), grid[0])
        left = left[left.index >= start]
        fig.add_scatter(x=left.index, y=left / len(m) if mode.startswith("fraction") else left, mode="lines",
                        line_shape="hv", name=f"{lab} (n={len(m):,})")
    fig.update_layout(height=480, yaxis_title=mode, hovermode="x unified", legend=dict(orientation="h", y=-0.2))
    show(fig)
    explain(
        'For the clouds you pick, how fast their pieces disappear over time.',
        'Each line starts at 100% (or the full count) and steps down every time a piece falls back to Earth. A steep line means a low cloud that clears fast. A line that stays flat for years means a high cloud that will stay for a long time. You can switch between fraction and raw count.',
        'It shows how long a breakup stays dangerous. High clouds can last for decades.')

# ----------------------------------------------------------------- orbital census
with tabs[7]:
    st.subheader("Orbital census: how crowded is it getting?")
    oc = objs[objs["object_type"].isin(sel_types)]
    grid = pd.date_range("1957-10-01", CUTOFF, freq="MS")
    launched = oc.groupby([oc["launch_date"].dt.to_period("M").dt.to_timestamp(), "object_type"]).size().unstack(fill_value=0)
    dec = oc.dropna(subset=["decay_date"])
    gone = dec.groupby([dec["decay_date"].dt.to_period("M").dt.to_timestamp(), "object_type"]).size().unstack(fill_value=0)
    launched = launched.reindex(grid, fill_value=0).cumsum()
    gone = gone.reindex(grid, fill_value=0).reindex(columns=launched.columns, fill_value=0).cumsum()
    pop = (launched - gone).clip(lower=0)
    key([("sw", TYPE_COLORS.get(t, "#999"), t.lower()) for t in pop.columns],
        "Stack height = objects in orbit at that month. Caveat: breakup fragments carry their parent's launch date in "
        "satcat, so a breakup (e.g. Fengyun 1C, 2007) is back-dated to the parent launch (1999) instead of showing as a step.")
    share = st.radio("Show", ["count", "share of total"], horizontal=True)
    fig = px.area(pop, color_discrete_map=TYPE_COLORS, groupnorm="percent" if share == "share of total" else None, height=440)
    fig.update_layout(xaxis_title="", yaxis_title="objects in orbit", legend_title="")
    show(fig)
    explain(
        'How many tracked objects were in orbit at each point in time, stacked by type.',
        "The height is the number in orbit that month and the colours are the types. A rising stack means objects are being added faster than they fall. 'Share of total' shows the mix instead of the count. Pieces from a breakup are dated to their parent's launch, so breakups appear back-dated.",
        'It shows how crowded orbit is getting and whether the junk share is growing.')

    st.markdown("#### Inflow vs outflow")
    key([("sw", "#5ef2ff", "launched that year (fragments dated to parent launch)"), ("sw", "#ff6bd6", "reentered that year (plotted down)"),
         ("ln", "#ffd166", "net change in population")],
        "When the cyan bars outgrow the pink ones the sky fills up. The yellow line is the yearly net change.")
    yl = oc.groupby(oc["launch_date"].dt.year).size()
    yd = oc.dropna(subset=["decay_date"]).groupby(oc["decay_date"].dt.year).size()
    yrs = pd.RangeIndex(1957, CUTOFF.year + 1)
    yl, yd = yl.reindex(yrs, fill_value=0), yd.reindex(yrs, fill_value=0)
    fig = go.Figure()
    fig.add_bar(x=yrs, y=yl, name="launched", marker_color="#5ef2ff")
    fig.add_bar(x=yrs, y=-yd, name="reentered", marker_color="#ff6bd6")
    fig.add_scatter(x=yrs, y=yl - yd, name="net", line=dict(color="#ffd166", width=3))
    fig.update_layout(barmode="relative", height=400, hovermode="x unified", legend=dict(orientation="h", y=1.1))
    show(fig)
    explain(
        'Each year, how many objects were added to orbit (bars going up) against how many fell back (bars going down), plus the net change.',
        'Cyan up is added, pink down is fallen, and the yellow line is the difference. Above zero means orbit is filling up. Below zero means it is clearing.',
        'It shows whether natural cleanup is keeping pace with new launches.')

    st.markdown("#### Time machine: who owns the sky?")
    key([("sw", "#9b8cff", "bars = objects in orbit on the chosen date, by owner country code")],
        "Drag the date. CIS = former Soviet / Russia, PRC = China, US = United States.")
    snap = st.slider("Snapshot date", 1960, CUTOFF.year, 2009)
    snap_d = pd.Timestamp(f"{snap}-12-31")
    live = oc[(oc["launch_date"] <= snap_d) & (oc["decay_date"].isna() | (oc["decay_date"] > snap_d))]
    cc = live.groupby(["country", "object_type"]).size().reset_index(name="n")
    topc = cc.groupby("country")["n"].sum().nlargest(10).index
    fig = px.bar(cc[cc["country"].isin(topc)], x="country", y="n", color="object_type",
                 color_discrete_map=TYPE_COLORS, height=400,
                 category_orders={"country": list(topc)}, title=f"In orbit on {snap_d:%Y-%m-%d}: {len(live):,} objects")
    show(fig)
    explain(
        'A snapshot of who owns the objects in orbit on a date you pick.',
        "Move the slider and each bar shows a country's objects in orbit that year, split by type. The codes are US (United States), CIS (former Soviet Union and Russia) and PRC (China), among others.",
        'It shows how the makeup of orbit has changed over the decades.')

# ----------------------------------------------------------------- lifespan lab
with tabs[8]:
    st.subheader("Lifespan lab: what decides how long junk lasts?")
    dead = o[(o["event"] == 1) & (o["life_days"] > 0)].copy()
    dead["log_life"] = np.log10(dead["life_days"])

    st.markdown("#### 1. Size and shape")
    key([("sw", "#5ef2ff", "box = middle 50% of lifetimes; line = median; violin width = how common")],
        "Radar cross-section is the only stand-in here for area-to-mass, the biggest drag driver. "
        "Lifetimes shown are log10 days, so 3 = ~3 years and 4 = ~27 years.")
    by = st.selectbox("Group by", ["rcs_size", "object_type", "regime", "country", "launch_decade"], key="lab_by")
    kinds = dead[by].value_counts().head(8).index
    fig = px.violin(dead[dead[by].isin(kinds)], x=by, y="log_life", color=by, box=True, points=False,
                    color_discrete_sequence=PALETTE, height=440)
    fig.update_layout(showlegend=False, yaxis_title="log10 days aloft")
    show(fig)
    explain(
        'How long objects lasted before falling, compared across groups.',
        "Each 'violin' shape is one group. Wider means more objects at that lifetime. The box inside holds the middle half of objects and the line is the typical (median) one. The up-and-down scale is a power of ten in days: 1 is about 10 days, 2 is about 100 days, 3 is about 3 years and 4 is about 27 years. Only objects that have already fallen are shown. Radar size is a rough sign of how big the object looks to radar, which hints at how much air it catches.",
        'It shows what kind of object lasts longer, such as bigger ones or ones in higher orbits.')

    st.markdown("#### 2. Launching into a puffed-up atmosphere")
    key([("sw", "#ff6bd6", "binned median lifetime"), ("sw", "#5ef2ff", "each dot = one object")],
        "x is the 81-day solar flux the month the object was launched. If high-flux launches fall sooner, the dots "
        "and the pink line slope down. Restrict to one regime so altitude isn't mixed in.")
    reg = st.multiselect("Regime", sorted(dead["regime"].dropna().unique()), default=["LEO"])
    sm = solar_monthly()
    dd = dead[dead["regime"].isin(reg)].copy()
    dd["launch_month"] = dd["launch_date"].dt.to_period("M").dt.to_timestamp()
    dd["flux_at_launch"] = dd["launch_month"].map(sm)
    dd = dd.dropna(subset=["flux_at_launch"])
    if len(dd) > 50:
        dd["bin"] = pd.cut(dd["flux_at_launch"], 12)
        med = dd.groupby("bin", observed=True).agg(x=("flux_at_launch", "mean"), y=("log_life", "median")).reset_index()
        samp = dd.sample(min(8000, len(dd)), random_state=0)
        fig = px.scatter(samp, x="flux_at_launch", y="log_life", opacity=0.25, color_discrete_sequence=["#5ef2ff"],
                         height=460)
        fig.add_scatter(x=med["x"], y=med["y"], mode="lines+markers", line=dict(color="#ff6bd6", width=4),
                        marker=dict(size=9), name="median")
        fig.update_layout(xaxis_title="F10.7 (81-day mean) at launch", yaxis_title="log10 days aloft")
        show(fig)
        explain(
            'A test of whether objects launched while the Sun was very active fell sooner.',
            'Each cyan dot is one object. Across is how active the Sun was the month it launched. Up is how long it lasted, as a power of ten in days. The pink line is the typical (median) lifetime in each band. A downward slope would mean objects launched into an active Sun fall sooner, because the air is thicker. The chart is limited to low orbit so altitude differences do not hide the effect.',
            'It checks the solar idea at the level of single objects.')
    else:
        st.info("Not enough objects for the current filters.")

    st.markdown("#### 3. Cohort fallout")
    key([("sw", "#0b0b25", "none fallen"), ("sw", "#d9467f", "about half"), ("sw", "#fcffa4", "all fallen"),
         ("sw", "#1a1d33", "not yet observable (blank)")],
        "Each row is the year objects were launched; each column is years since launch. Read across to see how "
        "quickly a cohort clears. Rows that stay dark are high-altitude cohorts.")
    maxk = st.slider("Years since launch", 5, 40, 20)
    rows_ = {}
    for yr_, grp in o.groupby("launch_year"):
        vals = {}
        for k in range(1, maxk + 1):
            if yr_ + k <= CUTOFF.year:
                vals[k] = ((grp["event"] == 1) & (grp["life_days"] <= k * 365.25)).mean()
        rows_[yr_] = vals
    coh = pd.DataFrame(rows_).T.sort_index()
    if coh.empty:
        st.info("No cohorts match.")
    else:
        fig = px.imshow(coh * 100, aspect="auto", color_continuous_scale="Magma", origin="lower",
                        labels=dict(x="years since launch", y="launch year", color="% fallen"), height=520)
        show(fig)
        explain(
            'A heatmap that follows each launch year as a group and shows what share of it has fallen after 1, 2, 3 and more years.',
            'Each row is a launch year and each column is years since launch. Brighter means more of the group has fallen. Read across a row to see how fast that group cleared. Blank squares on the right mean not enough time has passed to know yet. Rows that stay dark are groups that mostly remain in orbit.',
            'It shows whether newer objects clear faster than old ones and how long a typical clean-up takes.')

# ----------------------------------------------------------------- feature signal
with tabs[9]:
    st.subheader("Feature signal: what actually moves with time-to-reentry?")
    feats = [c for c in p.columns if c not in ("norad_cat_id", "obs_date", "split", "object_type", "regime", "country", "deep_space",
                                                  "days_remaining", "log1p_days_remaining", "event_observed")]
    tgt = st.selectbox("Target", ["log1p_days_remaining", "days_remaining"])
    base = p[p["event_observed"] == 1][feats + [tgt]]
    base = base.sample(min(80000, len(base)), random_state=0) if len(base) else base
    if len(base) < 100:
        st.info("Not enough rows for the current filters.")
    else:
        corr = base.rank().corr()[tgt].drop(tgt).dropna()
        kind_of = lambda c: ("leaky orbit (terminal)" if c in LEAKY else
                             "solar / geomagnetic" if c.startswith(("f107", "ap_")) else "other")
        cd = pd.DataFrame({"feature": corr.index, "rho": corr.values})
        cd["kind"] = cd["feature"].map(kind_of)
        cd = cd.reindex(cd["rho"].abs().sort_values(ascending=False).index)
        key([("sw", "#ffb347", "solar / geomagnetic"), ("sw", "#ff6bd6", "leaky orbit (terminal) - do not model with these"),
             ("sw", "#5ef2ff", "other")],
            "Spearman rank correlation with the target, on rows where the reentry was observed. Long bars are strong "
            "monotone relationships. Pink bars look strong because they are near-reentry snapshots, not because they predict.")
        fig = px.bar(cd, x="rho", y="feature", color="kind", orientation="h", height=max(400, 22 * len(cd)),
                     color_discrete_map={"solar / geomagnetic": "#ffb347", "leaky orbit (terminal)": "#ff6bd6", "other": "#5ef2ff"})
        fig.update_yaxes(autorange="reversed")
        fig.update_layout(xaxis_title="Spearman rho", legend_title="")
        show(fig)
        explain(
            'A ranking of each measurement by how strongly it moves together with how long until an object falls.',
            "Bar length is strength, from -1 to +1. A bar to the right means a bigger value goes with more time left in orbit. A bar to the left means a bigger value goes with less time left. Pink bars are measured near the end of an object's life, so they give away the answer (leaky) and should be ignored for prediction. Only objects that have fallen are used.",
            'It gives an early hint of which ingredients matter, so a model can use the honest ones such as solar activity, age and size.')

        st.markdown("#### Redundancy map")
        key([("sw", "#b2182b", "move together"), ("sw", "#2166ac", "move oppositely"), ("sw", "#f7f7f7", "unrelated")],
            "Features that are nearly identical (e.g. the 27/81/365-day flux means) add little for a model. Pick a set to compare.")
        default = [c for c in ["f107_adj_mean_27d", "f107_adj_mean_81d", "f107_adj_mean_365d", "ap_mean_27d",
                               "ap_mean_81d", "age_days", "f107_pct_rank_11y"] if c in feats]
        chosen = st.multiselect("Features", feats, default=default)
        if len(chosen) >= 2:
            cm = base[chosen].rank().corr()
            fig = px.imshow(cm, color_continuous_scale="RdBu_r", zmin=-1, zmax=1, text_auto=".2f", height=520)
            show(fig)
            explain(
                'A map of which measurements are near-duplicates of each other.',
                'Each square compares two measurements. Red (+1) means they rise and fall together. Blue (-1) means they move oppositely. White means unrelated. The numbers give the strength.',
                'If two measurements are nearly identical, a model only needs one of them, so this helps trim the list.')
