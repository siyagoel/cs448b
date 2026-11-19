"""
Per-county NOAA HMS smoke for the ten Bay Area counties, 2020.

Replaces the old method (any HMS polygon touching one Bay-wide bounding box ->
same smoke value for every county) with a county-by-county overlap.

Method
- County outlines: data/raw_boundaries/bay_counties.geojson (California county
  boundaries, from codeforgermany/click_that_hood, originally Census-derived).
- Smoke: data/hms_tmp/hms_smoke2020.shp (NOAA HMS 2020 annual bundle).
- A smoke polygon counts for a county if it covers >= 5% of the county's area
  (MIN_FRAC), which ignores slivers that only graze a county edge.
- Day = the polygon's Start date in UTC (HMS's own convention; same as the old
  file, so only the spatial method changes).
- hms_max_density = densest qualifying polygon that day (0 none, 1 Light,
  2 Medium, 3 Heavy).
- PM2.5 and local_calfire_active are copied unchanged from the old file;
  smoke_high_pm and attributed are recomputed from the new smoke column.

Also rebuilds the Bay-wide daily file used by the section 1 timeline, so all
smoke in the article comes from the same county overlap:
- hms_max_density = densest smoke over at least one county that day
- hms_n_polys / hms_heavy / hms_medium / hms_light = qualifying polygons
  (covering >= 5% of at least one county) by density
- attribution recomputed with the original rule (fire / hms / highPM parts)

Run from the project folder:
  .venv/bin/python scripts/hms_by_county.py
Writes data/bay_county_pm25_fire_hms_2020_bycounty.csv
   and data/bay_pm25_fire_hms_daily_2020_bycounty.csv
"""
import csv, json, logging, datetime as dt
from pathlib import Path
import shapefile
from shapely.geometry import shape
from shapely.validation import make_valid

logging.disable(logging.CRITICAL)  # pyshp warns about ring orientation; harmless here
ROOT = Path(__file__).resolve().parent.parent
MIN_FRAC = 0.05
DENSITY = {"Light": 1, "Medium": 2, "Heavy": 3}
REGION = (-123.6, 36.8, -121.2, 38.9)  # coarse prefilter around the Bay

counties = {
    f["properties"]["county"]: make_valid(shape(f["geometry"]))
    for f in json.load(open(ROOT / "data/raw_boundaries/bay_counties.geojson"))["features"]
}

smoke = {}  # (county, 'YYYY-MM-DD') -> density
bay_polys = {}  # 'YYYY-MM-DD' -> [density of each polygon that qualified for >= 1 county]
reader = shapefile.Reader(str(ROOT / "data/hms_tmp/hms_smoke2020"))
for sr in reader.iterShapeRecords():
    x0, y0, x1, y1 = sr.shape.bbox
    if x1 < REGION[0] or x0 > REGION[2] or y1 < REGION[1] or y0 > REGION[3]:
        continue
    den = DENSITY.get((sr.record["Density"] or "").strip())
    if not den:
        continue
    poly = shape(sr.shape.__geo_interface__)
    if not poly.is_valid:
        poly = make_valid(poly)
    day = dt.datetime.strptime(sr.record["Start"].split()[0], "%Y%j").date().isoformat()
    qualified = False
    for name, cg in counties.items():
        if not poly.intersects(cg):
            continue
        if poly.intersection(cg).area / cg.area >= MIN_FRAC:
            qualified = True
            smoke[(name, day)] = max(smoke.get((name, day), 0), den)
    if qualified:
        bay_polys.setdefault(day, []).append(den)

src = ROOT / "data/bay_county_pm25_fire_hms_2020.csv"
dst = ROOT / "data/bay_county_pm25_fire_hms_2020_bycounty.csv"
rows = list(csv.DictReader(open(src)))
for r in rows:
    h = smoke.get((r["county"], r["date"]), 0)
    pm = float(r["pm25"]) if r["pm25"] else None
    both = int(h >= 1 and pm is not None and pm >= 35)
    r["hms_max_density"] = str(h)
    r["smoke_high_pm"] = str(both)
    r["attributed"] = str(int(both and r["local_calfire_active"] == "1"))
with open(dst, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
print(f"wrote {dst.relative_to(ROOT)} ({len(rows)} rows)")

# ---- Bay-wide daily file (section 1 timeline) ----
src = ROOT / "data/bay_pm25_fire_hms_daily_2020.csv"
dst = ROOT / "data/bay_pm25_fire_hms_daily_2020_bycounty.csv"
rows = list(csv.DictReader(open(src)))
for r in rows:
    dens = bay_polys.get(r["date"], [])
    h = max(dens, default=0)
    r["hms_max_density"] = str(h)
    r["hms_n_polys"] = str(len(dens))
    r["hms_heavy"] = str(dens.count(3))
    r["hms_medium"] = str(dens.count(2))
    r["hms_light"] = str(dens.count(1))
    parts = [p for p, on in (("fire", int(r["active_fire_count"]) > 0), ("hms", h > 0),
                             ("highPM", r["high_pm"] == "1")) if on]
    r["attribution"] = "clear" if not parts else parts[0] + "_only" if len(parts) == 1 else "+".join(parts)
with open(dst, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
print(f"wrote {dst.relative_to(ROOT)} ({len(rows)} rows)")
