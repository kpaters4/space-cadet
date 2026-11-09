"""Bake the real-sky and real-Earth data the world uses. Run:  uv run --with astropy --with numpy --with pillow python bake.py
Inputs (fetched once): stars.json (d3-celestial, BSD-3), land50.json (world-atlas/Natural Earth, public domain), places.json (Natural Earth).
Output: baked.js  (const BAKED = {...}) which build.py splices into world.html."""
import base64, io, json, math
import numpy as np
from PIL import Image
from astropy.time import Time
from astropy.coordinates import get_body, get_body_barycentric
import astropy.units as u

T0 = Time("2009-02-10 17:00:00", scale="utc")          # Iridium 33 / Cosmos 2251 collided at 16:56 UTC
gmst = float(T0.sidereal_time("apparent", "greenwich").rad)
th = lambda v: [float(v[0]), float(v[2]), float(-v[1])]  # equatorial (x,y,z) -> three.js (x,y,z): north = +Y
unit = lambda v: v / np.linalg.norm(v)

def radec(ra, dec):
    ra, dec = math.radians(ra), math.radians(dec)
    return np.array([math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)])

# ---- bodies: direction from Earth, direction to the Sun from the body (for phase), size, magnitude, pole, colour
BODIES = {  # name: (equatorial radius km, V(1,0), phase coefficients, pole ra, pole dec, colour)
    "mercury": (2440, -0.60, (0.0380, -0.000273, 2e-6), 281.01, 61.45, "#c7b299"),
    "venus": (6052, -4.40, (0.0009, 0.000239, -6.5e-7), 272.76, 67.16, "#fff3cf"),
    "mars": (3396, -1.52, (0.016, 0, 0), 317.68, 52.89, "#ff9566"),
    "jupiter": (71492, -9.40, (0.005, 0, 0), 268.057, 64.495, "#ffe4bd"),
    "saturn": (60268, -8.88, (0.044, 0, 0), 40.589, 83.537, "#ffeab0"),
    "uranus": (25559, -7.19, (0, 0, 0), 257.311, -15.175, "#a6ecec"),
    "neptune": (24764, -6.87, (0, 0, 0), 299.36, 43.46, "#86adff"),
}
sun_b = get_body_barycentric("sun", T0).xyz.to(u.km).value
earth_b = get_body_barycentric("earth", T0).xyz.to(u.km).value
out_bodies = []
sun_g = get_body("sun", T0); sdir = unit(sun_g.cartesian.xyz.value)
moon_g = get_body("moon", T0); mdir = unit(moon_g.cartesian.xyz.value); mdist = moon_g.distance.to(u.km).value
sdist = sun_g.distance.to(u.km).value
out_bodies.append(dict(name="Sun", kind="sun", dir=th(sdir), light=th(sdir), angR=math.asin(695700 / sdist), mag=-26.7, pole=th(radec(286.13, 63.87)), color="#fff6d8", distAU=sdist / 1.495978707e8))
moon_b = get_body_barycentric("moon", T0).xyz.to(u.km).value
ml = unit(sun_b - moon_b)
out_bodies.append(dict(name="Moon", kind="moon", dir=th(mdir), light=th(ml), angR=math.asin(1737.4 / mdist), mag=-12.6, pole=th(radec(266.86, 65.64)), color="#f2f0e6", distKM=mdist))
for name, (rad, v10, (c1, c2, c3), pra, pdec, col) in BODIES.items():
    g = get_body(name, T0); d = unit(g.cartesian.xyz.value); dist = g.distance.to(u.km).value
    pb = get_body_barycentric(name, T0).xyz.to(u.km).value
    to_sun = sun_b - pb; to_earth = earth_b - pb; r = np.linalg.norm(to_sun) / 1.495978707e8; dAU = dist / 1.495978707e8
    ph = math.degrees(math.acos(np.dot(unit(to_sun), unit(to_earth))))
    mag = v10 + 5 * math.log10(r * dAU) + c1 * ph + c2 * ph ** 2 + c3 * ph ** 3
    out_bodies.append(dict(name=name.capitalize(), kind=name, dir=th(d), light=th(unit(to_sun)), angR=math.asin(rad / dist), mag=round(mag, 2),
                           pole=th(radec(pra, pdec)), color=col, distAU=round(dAU, 3), phase=round(ph, 1)))

# ---- stars (d3-celestial stars.6.json: [lon=RA, lat=Dec], mag, bv)
stars = []
for f in json.load(open("stars.json"))["features"]:
    m = f["properties"]["mag"]
    if m > 5.6: continue
    ra, dec = f["geometry"]["coordinates"]; ra %= 360
    try: bv = float(f["properties"]["bv"])
    except Exception: bv = 0.4
    stars.append([int(round(ra * 100)), int(round(dec * 100)), int(round(m * 10)), int(round(bv * 10))])
stars.sort(key=lambda s: s[2])

# ---- Earth texture: R = land, G = city lights (1024x512 equirectangular, row 0 = +90 deg)
W, H = 2048, 1024
land = json.load(open("land50.json")); sc, tr = land["transform"]["scale"], land["transform"]["translate"]
arcs = []
for a in land["arcs"]:
    x = y = 0; pts = []
    for dx, dy in a:
        x += dx; y += dy; pts.append((x * sc[0] + tr[0], y * sc[1] + tr[1]))
    arcs.append(pts)
def ring(idx):
    pts = []
    for i in idx:
        seg = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts += seg if not pts else seg[1:]
    return pts
img = Image.new("L", (W, H), 0)
from PIL import ImageDraw
d = ImageDraw.Draw(img)
px = lambda lon, lat: ((lon + 180) / 360 * W, (90 - lat) / 180 * H)
def draw_poly(rings):
    for k, r in enumerate(rings):
        d.polygon([px(*p) for p in ring(r)], fill=255 if k == 0 else 0)
for g in land["objects"]["land"]["geometries"]:
    if g["type"] == "Polygon": draw_poly(g["arcs"])
    elif g["type"] == "MultiPolygon":
        for poly in g["arcs"]: draw_poly(poly)
landmask = np.array(img, dtype=np.float32) / 255
lights = np.zeros((H, W), dtype=np.float32)
yy, xx = np.mgrid[0:H, 0:W]
for f in json.load(open("places.json"))["features"]:
    pop = f["properties"]["pop_max"] or 0
    if pop < 100000: continue
    lon, lat = f["geometry"]["coordinates"]; cx, cy = px(lon, lat)
    s = 1.3 + 0.55 * math.log10(max(pop, 1e5) / 1e5); amp = min(1.0, (pop / 3e6) ** 0.4)
    x0, x1, y0, y1 = int(cx - 6 * s), int(cx + 6 * s) + 1, int(cy - 6 * s), int(cy + 6 * s) + 1
    xs = np.arange(max(x0, 0), min(x1, W)); ys = np.arange(max(y0, 0), min(y1, H))
    if len(xs) == 0 or len(ys) == 0: continue
    gx, gy = np.meshgrid(xs, ys)
    lights[gy, gx] += amp * np.exp(-((gx - cx) ** 2 + (gy - cy) ** 2) / (2 * s * s))
lights = np.clip(lights, 0, 1) ** 0.6 * landmask
rgb = np.zeros((H, W, 3), dtype=np.uint8); rgb[..., 0] = (landmask * 255).astype(np.uint8); rgb[..., 1] = (lights * 255).astype(np.uint8)
buf = io.BytesIO(); Image.fromarray(rgb).save(buf, "PNG", optimize=True)
tex = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

# ---- where the ship starts: over 20N on the morning side of the subsolar point, sun 55 degrees up, flying east-south-east over the Caribbean and South America in full daylight
Rz = lambda a: np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
sun_ecef = Rz(-gmst) @ sdir
def enu(lat, lon):
    la, lo = math.radians(lat), math.radians(lon)
    up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    east = np.array([-math.sin(lo), math.cos(lo), 0]); north = np.cross(up, east)
    return east, north, up
lat = 20.0; best = None
for lon in np.arange(-180, 180, 0.05):
    e, n, up = enu(lat, lon); el = math.degrees(math.asin(np.dot(sun_ecef, up)))
    sub_lon = math.degrees(math.atan2(sun_ecef[1], sun_ecef[0]))
    if (lon - sub_lon + 540) % 360 - 180 < 0 and (best is None or abs(el - 55) < abs(best[1] - 55)): best = (lon, el)
lon = best[0]; e, n, up = enu(lat, lon)
az_sun = math.atan2(np.dot(sun_ecef, e), np.dot(sun_ecef, n)); heading = math.radians(100)               # head east-north-east: Iberia, North Africa and the dusk line lie ahead, the Sun behind
hvec = math.cos(heading) * n + math.sin(heading) * e
S0 = Rz(gmst) @ up; t0 = Rz(gmst) @ hvec
ship = dict(lat=lat, lon=round(lon, 2), sunElev=round(best[1], 1), heading_deg=round(math.degrees(heading) % 360, 1), S0=th(S0), t0=th(t0))

baked = dict(T0="2009-02-10T17:00:00Z", gmst=gmst, bodies=out_bodies, stars=stars, ship=ship, tex=tex)
open("baked.js", "w").write("const BAKED = " + json.dumps(baked, separators=(",", ":")) + ";\n")
print("stars", len(stars), "texture KB", len(tex) // 1024, "ship", ship)
for b in out_bodies: print(b["name"], "mag", b["mag"], "angR deg", round(math.degrees(b["angR"]), 4), "phase", b.get("phase"))
