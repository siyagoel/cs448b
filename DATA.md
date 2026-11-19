# Data notes: When Smoke Moves In

Sources, join logic and files behind the article. Local preview: `python3 -m http.server 8766`, then
http://127.0.0.1:8766/

**Primary sources (combined)**
- **EPA AirData** — Daily Summary Data, parameter **PM2.5 FRM/FEM Mass (88101)**  
  - Download page: https://aqs.epa.gov/aqsweb/airdata/download_files.html  
  - Exact file: `daily_88101_2020.zip` → `https://aqs.epa.gov/aqsweb/airdata/daily_88101_2020.zip`  
  - Years 2017–2021 for the five-year comparison (`data/epa_other/daily_88101_<year>.zip`)  
  - Year: **2020**; Bay Area counties — Alameda, Contra Costa, Marin, Napa, San Francisco, San Mateo, Santa Clara, Santa Cruz, Solano, Sonoma  
- **CalFire Incident API (2020)** — named wildfire start/contain windows, acres, counties  
  - `https://www.fire.ca.gov/umbraco/api/IncidentApi/GeoJsonList?inactive=true&year=2020`  
  - Raw saved as `data/raw_fires/calfire_2020.geojson`  
- **NOAA HMS smoke polygons (2020 annual bundle)** — satellite smoke density (Light / Medium / Heavy)  
  - `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/Shapefile/Annual_Bundles/hms_smoke2020.zip`  
  - Bay-wide daily file: intersected with Bay Area bbox (−123.15, 36.85) → (−121.45, 38.65)  
  - County-day file: intersected with each county outline (see below)  
- **County outlines** — `data/raw_boundaries/bay_counties.geojson` (10 Bay Area counties; California county
  boundaries from codeforgermany/click_that_hood, Census-derived)  

**Join logic**  
- Windows: timeline & county race = all of 2020; agreement bars & 2017–2021 comparison = Aug 1–Nov 15;
  local-fire comparison = Aug 16–Oct 31 by default (whole year optional)  
- “High PM” scale differs by chart: Bay median (timeline), county-day (race, agreement, local fire),
  any county (2017–2021 comparison)  
- Day is **high-PM** if Bay median PM2.5 ≥ 35 µg/m³  
- **HMS smoke (Bay-wide, timeline)** = densest per-county smoke across the ten counties that day
  (earlier version: any HMS polygon touching the Bay bbox; 135 → 112 smoke days in 2020)  
- **HMS smoke (per county, sections 3 & 5)** = densest HMS polygon that day covering ≥ 5% of that county's area
  (0 none, 1 Light, 2 Medium, 3 Heavy). Day = polygon Start date in UTC. Built by `scripts/hms_by_county.py`.  
  - Replaced the earlier method that copied the Bay-bbox value to every county; that overcounted smoky
    county-days (1,348 → 795 for 2020) and gave every county identical smoke days.  
- **Local fire** (county file) = a CalFire incident active inside that county that day  
- **Fire active** if a major CalFire window (Bay counties or ≥50k acres) covers that day  
- Attribution labels: `fire+hms+highPM`, `hms+highPM`, `fire+highPM`, `highPM_only`, etc.  
- Finding in 2020 Bay data: **all** high-PM days also had HMS smoke overhead, and with per-county smoke all 117
  high-PM county-days had smoke over that county (Light+). Only ~15% of smoke county-days were high-PM.  

**Files in the repo**
| File | What it is |
|---|---|
| `data/bay_area_pm25_daily_2020.csv` | County–day mean PM2.5 (µg/m³) from EPA monitors (county race) |
| `data/bay_pm25_county_daily_2017_2021.csv` | County–day mean PM2.5, 2017–2021 (five-year comparison) |
| `data/calfire_bay_relevant_2020.csv` | CalFire fires touching Bay counties or ≥50k acres (pipeline input) |
| `data/calfire_events_for_charts_2020.csv` | Named fire windows used as chart bands / event picker |
| `data/bay_pm25_fire_hms_daily_2020.csv` | **Old** daily join (Bay-bbox smoke); input to `scripts/hms_by_county.py` |
| `data/bay_pm25_fire_hms_daily_2020_bycounty.csv` | Daily join: Bay median PM + HMS (densest over any county) + active fire acres/names + attribution (used by the timeline) |
| `data/bay_county_pm25_fire_hms_2020.csv` | **Old** county–day file (Bay-bbox smoke copied to every county); input to `scripts/hms_by_county.py` |
| `data/bay_county_pm25_fire_hms_2020_bycounty.csv` | County–day PM + **per-county** HMS + local CalFire flag (used by sections 3 & 5) |
| `data/raw_boundaries/bay_counties.geojson` | County outlines used for the per-county smoke overlap |
| `scripts/hms_by_county.py` | Rebuilds both `_bycounty` files: `.venv/bin/python scripts/hms_by_county.py` |

**Raw downloads (kept locally, not in the repo because of size)**

| File | Source |
|---|---|
| `data/daily_88101_2020.zip`, `data/epa_other/daily_88101_2017–2021.zip` | EPA AirData (links above) |
| `data/hms_tmp/hms_smoke2020.*` | NOAA HMS 2020 shapefile, unzipped (needed by `scripts/hms_by_county.py`) |
| `data/raw_fires/calfire_2020.geojson`, `data/raw_fires/hms_smoke2020.zip` | CalFire API and NOAA HMS bundle |
