"""Space Cadet -- data audit dashboard for the orbital-debris reentry data.

Run:  uv run --with streamlit --with plotly streamlit run dashboard/app.py
Preprocessing lives in dashboard/preprocess.py; the data dictionary in dashboard/dictionary.py.

Uses train and valid rows only: the reserved test split is discarded while loading.
The earlier exploratory tabs are kept in dashboard/app_explorer_full.py.
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


from preprocess import (AS_OF, DEEP_SPACE_KM, LEAKY, PANEL_COLS, gp_coverage as _gp_coverage, load_objects as _load_objects,
                        load_panel as _load_panel, solar_monthly as _solar_monthly)

load_panel = st.cache_data(show_spinner="Loading and cleaning panel (first run reads ~400 MB)...")(_load_panel)
load_objects = st.cache_data(show_spinner="Loading and cleaning objects...")(_load_objects)
solar_monthly = st.cache_data(_solar_monthly)
gp_coverage = st.cache_data(_gp_coverage)


from dictionary import build_dictionary

panel, split_rows, split_objs, panel_log = load_panel()
objs, objs_log = load_objects()
n_test_reserved = int(panel_log[0][1])

panel["launch_year"] = (panel["obs_date"] - pd.to_timedelta(panel["age_days"], unit="D")).dt.year
panel["age_band"] = pd.cut(panel["age_days"] / 365.25, [-0.01, 1, 3, 10, 25, 100],
                           labels=["under 1 yr", "1-3 yrs", "3-10 yrs", "10-25 yrs", "over 25 yrs"])

GROUP_COLORS = {**TYPE_COLORS, **REGIME_COLORS}


def colors_for(groups):
    """Stable colour per group: fixed for known categories, palette order otherwise."""
    return {g: GROUP_COLORS.get(g, PALETTE[i % len(PALETTE)]) for i, g in enumerate(groups)}


# ----------------------------------------------------------------- sidebar
st.sidebar.markdown("### 🛰️ FILTERS")
st.sidebar.caption(f"Data through **{AS_OF:%Y-%m-%d}** (train + valid). "
                   f"The test split ({n_test_reserved:,} rows) is reserved and not loaded.")
types = sorted(objs["object_type"].dropna().unique())
sel_types = st.sidebar.multiselect("Object type", types, default=[t for t in types if t != "PAYLOAD"],
                                   help="Payloads are hidden by default (junk-only view); add them to compare.")
regimes = sorted(objs["regime"].dropna().unique())
sel_regimes = st.sidebar.multiselect("Orbit regime", regimes, default=regimes)
sizes = [s for s in ["SMALL", "MEDIUM", "LARGE", "UNKNOWN"] if s in set(objs["rcs_size"])]
sel_sizes = st.sidebar.multiselect("Radar size class", sizes, default=sizes,
                                   help="Radar cross-section class; the only stand-in for physical size.")
yr_lo, yr_hi = int(objs["launch_year"].min()), int(objs["launch_year"].max())
sel_years = st.sidebar.slider("Launch years", yr_lo, yr_hi, (1990, yr_hi))
no_deep = st.sidebar.checkbox("Hide deep-space orbits (apogee > 100,000 km)", True,
                              help="Lunar and escape-type orbits stretch every altitude axis.")
sel_splits = st.sidebar.multiselect("Panel split (rows)", ["train", "valid"], default=["train", "valid"],
                                    help="Which reserved-safe splits feed the row-level plots.")

o = objs[objs["object_type"].isin(sel_types) & objs["regime"].isin(sel_regimes) & objs["rcs_size"].isin(sel_sizes)
         & objs["launch_year"].between(*sel_years)]
p = panel[panel["object_type"].isin(sel_types) & panel["regime"].isin(sel_regimes) & panel["rcs_size"].isin(sel_sizes)
          & panel["launch_year"].between(*sel_years) & panel["split"].isin(sel_splits)]
if no_deep:
    o, p = o[~o["deep_space"]], p[~p["deep_space"]]

st.markdown("""
<div class="hero"><div class="orbit"><i></i><i></i><b></b></div>
<h1>SPACE CADET</h1>
<p>Tracking the junk that circles Earth, and the Sun that sweeps it from the sky.</p></div>
""", unsafe_allow_html=True)

tabs = st.tabs(["📊 Overview", "📖 Data dictionary", "📈 Plots", "🧹 Data quality & sampling"])

# ----------------------------------------------------------------- overview
with tabs[0]:
    st.subheader("Dataset overview")
    st.markdown(f"""
<div class="readout">
<div><span>Panel rows (train + valid)</span><strong>{len(panel):,}</strong></div>
<div><span>Panel columns</span><strong>{panel.shape[1] - 2}</strong></div>
<div><span>Objects in panel</span><strong>{panel['norad_cat_id'].nunique():,}</strong></div>
<div><span>Catalogued objects</span><strong>{len(objs):,}</strong></div>
<div><span>Test rows reserved</span><strong>{n_test_reserved:,}</strong></div>
</div>""", unsafe_allow_html=True)
    sp = (panel.groupby("split", observed=True)
          .agg(rows=("norad_cat_id", "size"), objects=("norad_cat_id", "nunique"),
               first_obs=("obs_date", "min"), last_obs=("obs_date", "max")))
    sp["first_obs"], sp["last_obs"] = sp["first_obs"].dt.date, sp["last_obs"].dt.date
    sp.loc["test (reserved, not loaded)"] = [n_test_reserved, None, None, None]
    st.dataframe(sp.rename_axis("split"), width="content")
    st.caption("Time-based split on `obs_date`: test is the most recent period and is never used for "
               "cleaning rules, filters or plots here. Only its row count is shown.")
    with st.expander("New to space? Quick glossary"):
        st.markdown("""
- **Reentry:** an object sinks low enough to hit the thick air, burn up and leave orbit.
- **Drag:** the tiny push from the thin air at the edge of space. It slows objects down so they sink.
- **Perigee / apogee:** the lowest and highest point of an orbit, in km above the ground.
- **Solar flux (F10.7):** how active the Sun is. High flux puffs up the upper atmosphere, which means more drag.
- **Ap:** a geomagnetic-storm index; storms also disturb the atmosphere for a few days.
- **Censored:** an object that has not fallen by the cutoff, so its days remaining is unknown.
""")

# ----------------------------------------------------------------- dictionary
with tabs[1]:
    st.subheader("Data dictionary: cleaned panel")
    st.caption("Type, % missing and ranges are computed from the loaded data (train + valid, after cleaning). "
               "Descriptions and notes are written by hand in `dashboard/dictionary.py`.")
    dd = build_dictionary(panel.drop(columns=["launch_year", "age_band"]))
    st.dataframe(dd, hide_index=True, width="stretch", height=640)
    st.download_button("Download dictionary (CSV)", dd.to_csv(index=False), "data_dictionary.csv", "text/csv")

# ----------------------------------------------------------------- plots
with tabs[2]:
    st.caption(f"All plots follow the sidebar filters. Currently {len(p):,} observation rows "
               f"({p['norad_cat_id'].nunique():,} objects) and {len(o):,} catalogued objects selected.")
    if p.empty or o.empty:
        st.info("No data matches the current filters. Widen the sidebar selection.")
        st.stop()

    # ---- 1. time to reentry
    st.markdown("### 1. Time to reentry")
    a, b, c, d = st.columns(4)
    grp1 = a.selectbox("Compare by", ["(none)", "object_type", "regime", "rcs_size", "country", "age_band"], key="g1",
                       format_func=lambda s: s.replace("_", " "))
    view1 = b.radio("View", ["Distribution", "Cumulative share"], key="v1", horizontal=True)
    norm1 = c.checkbox("Normalise each group to 100%", True, key="n1", disabled=view1 == "Cumulative share")
    top1 = d.slider("Max groups", 2, 10, 6, key="t1", disabled=grp1 == "(none)")
    fell = p[(p["event_observed"] == 1) & (p["days_remaining"] >= 1)]
    edges = np.logspace(0, np.log10(max(fell["days_remaining"].max(), 10)), 50)
    mid = np.sqrt(edges[:-1] * edges[1:])
    if grp1 == "(none)":
        groups = [("all selected rows", fell["days_remaining"])]
    else:
        keep = fell[grp1].value_counts().head(top1).index
        groups = [(str(g), fell.loc[fell[grp1] == g, "days_remaining"]) for g in keep]
    cmap = colors_for([g for g, _ in groups]) if grp1 != "(none)" else {"all selected rows": BARS}
    fig = go.Figure()
    for g, s in groups:
        cnt, _ = np.histogram(s, bins=edges)
        if view1 == "Cumulative share":
            fig.add_scatter(x=edges[1:], y=cnt.cumsum() / max(cnt.sum(), 1), mode="lines", line_shape="hv",
                            name=f"{g} (n={len(s):,})", line=dict(color=cmap[g], width=3))
        else:
            y = cnt / max(cnt.sum(), 1) if norm1 else cnt
            fig.add_bar(x=mid, y=y, name=f"{g} (n={len(s):,})", marker_color=cmap[g], opacity=0.7)
    fig.update_xaxes(type="log", title="days from observation to reentry")
    fig.update_yaxes(title="share of the group's rows" if (norm1 or view1 == "Cumulative share") else "rows")
    fig.update_layout(height=430, barmode="overlay", hovermode="x unified", legend=dict(orientation="h", y=1.12))
    show(fig)
    cens = 1 - p["event_observed"].mean()
    st.caption(f"Only rows whose object reentered by {AS_OF:%Y-%m-%d} can be shown; the other {cens:.0%} of selected rows "
               "have no days-remaining value yet. The curve is therefore skewed towards objects that fall quickly.")

    # ---- 2. reentry share within horizon
    st.markdown("### 2. Share of objects reentering within a time window")
    a, b, c = st.columns(3)
    horizon = a.slider("Window (days)", 30, 1825, 365, 30, key="h2")
    grp2 = b.selectbox("Group by", ["object_type", "regime", "rcs_size", "country", "age_band"], key="g2",
                       format_func=lambda s: s.replace("_", " "))
    min_n = c.slider("Hide groups with fewer rows than", 0, 5000, 200, 100, key="m2")
    # a row has a defined outcome only once its whole window has elapsed
    r = p[p["obs_date"] + pd.Timedelta(days=horizon) <= AS_OF]
    r = r.assign(hit=((r["event_observed"] == 1) & (r["days_remaining"] <= horizon)).astype(int))
    lab = r.groupby(grp2, observed=True)["hit"].agg(share="mean", rows="size").reset_index()
    lab = lab[lab["rows"] >= min_n]
    if lab.empty:
        st.info("No group has enough rows with a fully elapsed window; lower the minimum or window.")
    else:
        lab[grp2] = lab[grp2].astype(str)
        fig = px.bar(lab, x=grp2, y="share", text="rows", color=grp2, color_discrete_map=GROUP_COLORS,
                     color_discrete_sequence=PALETTE, height=400, hover_data={"rows": ":,"})
        fig.update_traces(texttemplate="n=%{text:,}", textposition="outside")
        fig.update_layout(showlegend=False, xaxis_title=grp2.replace("_", " "), yaxis_title=f"share reentering within {horizon} days",
                          yaxis_tickformat=".0%")
        show(fig)
        st.caption(f"Share of observations whose object reentered within {horizon} days. Only rows with a fully "
                   f"elapsed window (observed at least {horizon} days before {AS_OF:%Y-%m-%d}) are counted, and "
                   "objects that never fell count as misses.")

    # ---- 3. feature vs time to reentry
    st.markdown("### 3. How features relate to days remaining")
    skip = {"norad_cat_id", "obs_date", "split", "object_type", "regime", "country", "deep_space", "rcs_size",
            "days_remaining", "log1p_days_remaining", "event_observed", "launch_year", "age_band"}
    feats = [c for c in p.columns if c not in skip]
    a, b, c, d = st.columns(4)
    feat = a.selectbox("Feature (x-axis)", feats, index=feats.index("f107_adj_mean_81d"), key="f3")
    grp3 = b.selectbox("Compare by", ["(none)", "object_type", "regime", "rcs_size", "age_band"], key="g3",
                       format_func=lambda s: s.replace("_", " "))
    nbins = c.slider("Bins", 5, 30, 15, key="b3")
    pts = d.checkbox("Show individual rows", False, key="p3")
    if feat in LEAKY:
        st.warning("This orbit column is satcat's last-on-file value, a near-reentry snapshot for fallen objects, "
                   "so it leaks the answer. Fine to look at, not to model with.")
    q = fell.dropna(subset=[feat])
    glist = [("all selected rows", q)] if grp3 == "(none)" else \
        [(str(g), q[q[grp3] == g]) for g in q[grp3].value_counts().head(6).index]
    cmap3 = colors_for([g for g, _ in glist]) if grp3 != "(none)" else {"all selected rows": BARS}
    fig = go.Figure()
    if pts and len(q):
        s = q.sample(min(6000, len(q)), random_state=0)
        fig.add_scatter(x=s[feat], y=s["days_remaining"], mode="markers", name="rows",
                        marker=dict(size=3, color="rgba(160,170,210,.25)"), hoverinfo="skip")
    for g, sub in glist:
        if len(sub) < 100:
            continue
        bins = pd.qcut(sub[feat], nbins, duplicates="drop")
        m = sub.groupby(bins, observed=True).agg(x=(feat, "mean"), y=("days_remaining", "median"), n=("days_remaining", "size"))
        m = m[m["n"] >= 30]
        fig.add_scatter(x=m["x"], y=m["y"], mode="lines+markers", name=g, line=dict(color=cmap3[g], width=3),
                        customdata=m["n"], hovertemplate="%{x:.3g}: median %{y:,.0f} days (n=%{customdata:,})<extra>" + g + "</extra>")
    fig.update_xaxes(title=feat)
    fig.update_yaxes(title="median days remaining", type="log")
    fig.update_layout(height=450, legend=dict(orientation="h", y=1.1))
    show(fig)
    if len(q) > 100:
        rho = q[[feat, "days_remaining"]].rank().corr().iloc[0, 1]
        st.caption(f"Each point is the median days remaining for one bin of equal-sized slices of {feat}. "
                   f"Overall Spearman rho = {rho:.2f} across {len(q):,} rows with an observed reentry.")

    # ---- 4. reentries vs solar activity over time
    st.markdown("### 4. Reentries per month vs. solar activity")
    a, b, c, d = st.columns(4)
    flux = a.selectbox("Solar series", ["f107_adj_mean_27d", "f107_adj_mean_81d", "f107_adj_mean_365d", "ap_mean_27d", "ap_mean_81d"],
                       index=1, key="s4")
    smooth = b.slider("Smooth reentries (months)", 1, 24, 3, key="sm4")
    lag = c.slider("Shift solar series later (months)", 0, 24, 0, key="l4",
                   help="Plots solar activity as if it arrived this many months later; look for the lag that lines up peaks.")
    y_lo, y_hi = d.slider("Years shown", 1960, AS_OF.year, (1990, AS_OF.year), key="y4")
    ev = o[o["event"] == 1]
    monthly = ev.groupby(ev["decay_date"].dt.to_period("M")).size().rename("reentries")
    monthly.index = monthly.index.to_timestamp()
    monthly = monthly.asfreq("MS", fill_value=0).rolling(smooth, min_periods=1).mean()
    sol = panel.dropna(subset=[flux]).groupby(panel["obs_date"].dt.to_period("M"))[flux].mean()
    sol.index = sol.index.to_timestamp()
    sol = sol.shift(lag, freq="MS").dropna()
    span = (pd.Timestamp(f"{y_lo}-01-01"), pd.Timestamp(f"{y_hi}-12-31"))
    monthly, sol = monthly.loc[span[0]:span[1]], sol.loc[span[0]:span[1]]
    fig = go.Figure()
    fig.add_bar(x=monthly.index, y=monthly.values, name="Reentries per month", marker_color=BARS, marker_opacity=0.65)
    fig.add_scatter(x=sol.index, y=sol.values, name=flux, yaxis="y2", line=dict(width=3, color=SOLAR))
    fig.update_layout(height=450, yaxis=dict(title="reentries per month"), yaxis2=dict(title=flux, overlaying="y", side="right"),
                      legend=dict(orientation="h", y=1.1), hovermode="x unified")
    show(fig)
    joined = pd.concat([monthly, sol], axis=1, join="inner").dropna()
    if len(joined) > 12:
        st.caption(f"Spearman correlation between the two series at a {lag}-month shift: "
                   f"**{joined.iloc[:, 0].rank().corr(joined.iloc[:, 1].rank()):.2f}** over {len(joined)} months. "
                   "Descriptive only: catalogue growth also moves reentry counts.")

    # ---- 5. tracked population over time
    st.markdown("### 5. Tracked objects in orbit over time")
    a, b = st.columns(2)
    grp5 = a.selectbox("Stack by", ["object_type", "regime", "rcs_size", "country"], key="g5",
                       format_func=lambda s: s.replace("_", " "))
    share5 = b.radio("Show", ["Count", "Share of total"], key="sh5", horizontal=True)
    base5 = objs[objs["object_type"].isin(sel_types) & objs["regime"].isin(sel_regimes) & objs["rcs_size"].isin(sel_sizes)]
    if no_deep:
        base5 = base5[~base5["deep_space"]]
    grid = pd.date_range("1957-10-01", AS_OF, freq="MS")
    launched = base5.groupby([base5["launch_date"].dt.to_period("M").dt.to_timestamp(), grp5], observed=True).size().unstack(fill_value=0)
    dec = base5.dropna(subset=["decay_date"])
    gone = dec.groupby([dec["decay_date"].dt.to_period("M").dt.to_timestamp(), grp5], observed=True).size().unstack(fill_value=0)
    launched = launched.reindex(grid, fill_value=0).cumsum()
    gone = gone.reindex(grid, fill_value=0).reindex(columns=launched.columns, fill_value=0).cumsum()
    pop = (launched - gone).clip(lower=0)
    fig = px.area(pop, color_discrete_map=GROUP_COLORS, color_discrete_sequence=PALETTE,
                  groupnorm="percent" if share5 == "Share of total" else None, height=430)
    fig.update_layout(xaxis_title="", yaxis_title="objects in orbit" if share5 == "Count" else "% of objects in orbit",
                      legend_title="", hovermode="x unified")
    show(fig)
    st.caption("Launched minus reentered, by month, for the sidebar's object type, regime and size filters (launch-year "
               "filter not applied). Breakup fragments carry their parent's launch date in satcat, so breakups appear "
               "back-dated instead of as a step.")

# ----------------------------------------------------------------- data quality
with tabs[3]:
    st.subheader("Data quality")
    st.markdown("**Cleaning log**: what the loaders did before any chart saw the data.")
    st.dataframe(pd.DataFrame(panel_log + objs_log, columns=["step", "rows / columns affected", "what happened"]),
                 hide_index=True, width="stretch")

    st.markdown("**Empty values per column** (train + valid, unfiltered)")
    mt = (panel.drop(columns=["launch_year", "age_band"]).isna().mean().mul(100).round(2).rename("% missing").reset_index()
          .rename(columns={"index": "column"}).sort_values("% missing", ascending=False))
    st.dataframe(mt, hide_index=True, width="stretch")

    n_gp, rows_gp, gp_lo, gp_hi = gp_coverage()
    if n_gp < 1000:
        st.warning(f"`gp_history.csv` currently holds only **{n_gp} objects** ({rows_gp:,} element sets, "
                   f"{gp_lo} to {gp_hi}). That is a small test pull, so the `*_asof` orbit features are almost empty.")
    else:
        st.caption(f"`gp_history.csv`: {n_gp:,} objects, {rows_gp:,} element sets, {gp_lo} to {gp_hi}.")
    st.warning("The orbit columns in this table (`perigee_km`, `apogee_km`, `mean_alt_km`, `eccentricity`, "
               "`inclination_deg`, `regime`) are satcat last-on-file values and leak the answer for fallen objects.")

    st.subheader("Sampling")
    both = panel.groupby("norad_cat_id", observed=True)["split"].nunique()
    st.markdown(f"""
- **Time coverage:** observations run {panel['obs_date'].min():%Y-%m-%d} to {panel['obs_date'].max():%Y-%m-%d} (train + valid); the test split covers the most recent period and is not shown.
- **Split by date, not by object:** {int((both > 1).sum()):,} of {len(both):,} objects appear in both train and valid, so the same object can appear on both sides of the split.
- **Low orbits only:** the panel keeps objects with perigee at or below 1,000 km, so it covers {panel['norad_cat_id'].nunique():,} of {len(objs):,} catalogued objects.
- **Only tracked objects:** the catalogue omits objects too small to track, and tracking has improved over time, so recent years look more crowded.
- **Censoring:** {1 - panel['event_observed'].mean():.0%} of rows are objects that had not fallen by the cutoff.
""")
