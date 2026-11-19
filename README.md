# When Smoke Moves In

**The sky and the air don't always agree: the Bay Area's 2020 fire season, from satellites and from the ground.**

An interactive explainer for CS 448B (Fall 2026) by Siya Goel, Rubina Shrestha and Zaid Akthar.

**Live site:** https://siyagoel.github.io/cs448b/

## What it shows

On Sept. 9, 2020, satellites saw heavy smoke over all ten Bay Area counties, but no county's air monitors reached EPA's unhealthy level. The article combines EPA PM2.5 monitors, NOAA satellite smoke and CalFire fire records to show how often smoke overhead actually meant unhealthy air, where and when the two agreed, how 2020 compares to 2017–2021, and what changed when a fire was burning in the same county.

Five interactive charts:

1. Timeline of PM2.5, satellite smoke and named fires (zoom, click a day or a fire)
2. County race of cumulative pollution (play, scrub, follow counties)
3. County map and bars of smoke vs. unhealthy air (play, adjust thresholds, linked selection)
4. 2017–2021 fire-season calendar (time lapse)
5. Smoky days with vs. without a fire in the county (filters, county focus)

## Run locally

```bash
python3 -m http.server 8766
```

Then open http://127.0.0.1:8766/

## Files

| Path | What it is |
|---|---|
| `index.html` | The article (GitHub Pages serves this) |
| `article.html` | Redirects to `index.html` for old links |
| `css/` | Page and chart styles |
| `js/shared.js` | Tooltip helpers and the shared county selection |
| `js/timeline.js` | Sections 1–2: timeline and county race |
| `js/part3.js` | Section 3: county map and agreement bars |
| `js/part4.js` | Sections 4–5: five-year calendar and local-fire comparison |
| `data/` | The CSVs and county outlines the charts load |
| `scripts/hms_by_county.py` | Rebuilds the per-county smoke files from the NOAA HMS shapefile |
| `DATA.md` | Sources, join logic and file notes |

Raw downloads (EPA AirData zips, the NOAA HMS 2020 shapefile, the CalFire GeoJSON) are not in the repo because of their size. DATA.md lists where to download them. To rebuild the smoke data, put the HMS shapefile in `data/hms_tmp/` and run `python3 scripts/hms_by_county.py` (needs `pyshp` and `shapely`).

## Data sources

- EPA AirData, daily PM2.5 (parameter 88101)
- NOAA Hazard Mapping System smoke polygons, 2020
- CalFire incident records
- County outlines: codeforgermany/click_that_hood (Census-derived)
