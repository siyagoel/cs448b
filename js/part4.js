/* Part 4 — context: 2020 vs other years (time lapse) + local fire vs distant smoke.
   Data: EPA daily PM2.5 (county means, 2017–2021), NOAA HMS + CalFire for 2020. */
(async function () {
  const parse = d3.timeParse("%Y-%m-%d");
  const fmtL = d3.timeFormat("%b %d, %Y");
  const fmtS = d3.timeFormat("%b %d");
  const FONT = "IBM Plex Sans, system-ui, sans-serif";
  // Color system across the article: purple = smoke + high PM agreement (section 3 only);
  // orange-brown to dark red = PM2.5 level (matches the timeline's line and high-PM dots); burnt orange = local fire.
  const PM_COLOR = "#c45c26", PM_DARK = "#7f1d1d";
  const pmScale = d3.scaleSequentialSqrt(d3.interpolateRgbBasis(["#fbf4ec", "#f4cfa8", "#e3955c", "#c45c26", "#7f1d1d"])).domain([0, 130]);
  const NA = "#e5e1da";
  const fmtN = d3.format(",");
  const upperMedian = (arr) => { const s = arr.slice().sort(d3.ascending); return s[Math.floor(s.length / 2)]; };

  const [five, cd] = await Promise.all([
    d3.csv("data/bay_pm25_county_daily_2017_2021.csv", (d) => ({ year: +d.year, county: d.county, date: parse(d.date), pm: +d.pm25 })),
    d3.csv("data/bay_county_pm25_fire_hms_2020_bycounty.csv", (d) => ({
      county: d.county, date: parse(d.date), pm: d.pm25 === "" ? null : +d.pm25, hms: +d.hms_max_density, fire: +d.local_calfire_active === 1
    }))
  ]);

  function mk(sel, h, m) {
    const el = d3.select(sel);
    el.selectAll("*").remove();
    const w = FP.widthOf(el);
    const svg = el.append("svg").attr("width", w).attr("height", h);
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
    return { svg, g, w, iw: w - m.left - m.right, ih: h - m.top - m.bottom };
  }

  // ---------- per-year Bay series ----------
  const years = [2017, 2018, 2019, 2020, 2021];
  const bayByYear = new Map();
  const byRef = new Map(); // year -> Map(+refDate -> day)
  years.forEach((y) => {
    const byDate = d3.group(five.filter((d) => d.year === y), (d) => +d.date);
    const days = [...byDate.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({
      date: new Date(t), median: v.length >= 5 ? upperMedian(v.map((d) => d.pm)) : null, max: d3.max(v, (d) => d.pm), n: v.length
    }));
    bayByYear.set(y, days);
    const m = new Map();
    days.forEach((d) => m.set(+refDate(d.date), d));
    byRef.set(y, m);
  });
  function refDate(d) { return new Date(2020, d.getMonth(), d.getDate()); }

  // ---------- 1. Time lapse across years ----------
  const WINDOWS = {
    season: [new Date(2020, 7, 1), new Date(2020, 10, 15)],
    all: [new Date(2020, 0, 1), new Date(2020, 11, 31)]
  };
  const L = { winKey: "season", idx: 0, playing: false, timer: null };
  let calDays = []; // shared 2020-calendar days in the window

  function rebuildCalendar() {
    const [lo, hi] = WINDOWS[L.winKey];
    calDays = d3.timeDay.range(lo, d3.timeDay.offset(hi, 1));
    const slider = document.getElementById("yr-slider");
    slider.max = Math.max(0, calDays.length - 1);
    L.idx = calDays.length - 1;
    slider.value = L.idx;
  }

  function dayAt(y, cal) {
    return byRef.get(y).get(+cal) || null;
  }

  function statsThrough(idx) {
    const through = calDays.slice(0, idx + 1);
    return years.map((y) => {
      const rows = through.map((c) => dayAt(y, c)).filter(Boolean);
      const days = rows.filter((d) => d.median != null);
      const hi = days.filter((d) => d.median >= 35);
      return {
        year: y,
        peak: days.length ? d3.greatest(days, (d) => d.median) : null,
        n35: hi.length,
        nAny: rows.filter((d) => d.max >= 35).length,
        exposure: d3.sum(days, (d) => Math.max(0, d.median - 12)),
        today: dayAt(y, calDays[idx])
      };
    });
  }

  const peakVal = (s) => (s.peak ? s.peak.median : 0);
  const colsDef = [
    ["Highest PM2.5 Median across Bay Area Counties", peakVal, (s) => (s.peak
      ? `${fmtS(s.peak.date)} · ${s.peak.median.toFixed(0)} µg/m³`
      : "—")],
    ["Days any county ≥ 35 µg/m³", (s) => s.nAny, (s) => s.nAny]
  ];

  function renderTable(st) {
    const cal = calDays[L.idx];
    const tbl = d3.select("#t-years");
    tbl.selectAll("*").remove();
    const head = tbl.append("thead").append("tr");
    head.append("th").text("Year");
    colsDef.forEach((c) => head.append("th").text(c[0]));
    const body = tbl.append("tbody");
    st.forEach((s) => {
      const tr = body.append("tr").style("background", s.year === 2020 ? "#f3eefa" : null);
      tr.append("td").style("font-weight", s.year === 2020 ? 700 : 400).text(s.year);
      colsDef.forEach(([, f, fmt]) => {
        const top = d3.max(st, f);
        tr.append("td").style("font-weight", top > 0 && f(s) === top ? 700 : 400).text(fmt(s));
      });
    });
    d3.select("#years-win").text(fmtS(cal));
    const s20 = st.find((s) => s.year === 2020);
    const rank = (f) => 1 + st.filter((s) => f(s) > f(s20)).length;
    const lead = (f) => st.slice().sort((a, b) => f(b) - f(a))[0];
    const atEnd = L.idx === calDays.length - 1;
    const tPeak = lead(peakVal);
    const tAny = lead((s) => s.nAny);
    if (atEnd && L.winKey === "all") {
      d3.select("#years-sum").html(
        `2020 ranks <b>#${rank(peakVal)}</b> of 5 for its worst single day (${s20.peak ? fmtS(s20.peak.date) + " · " + s20.peak.median.toFixed(0) : "–"} vs ${tPeak.peak ? fmtS(tPeak.peak.date) + " · " + tPeak.peak.median.toFixed(0) : "–"} µg/m³ in ${tPeak.year}), ` +
        `but <b>#${rank((s) => s.nAny)}</b> for days when at least one county had unhealthy air (${s20.nAny} days). ` +
        `A sharp late peak made ${tPeak.year} look worse on paper. However, 2020 had the most unhealthy days <i>somewhere</i> in the Bay, spread across about six weeks.`);
    } else if (atEnd && L.winKey === "season") {
      d3.select("#years-sum").html(
        `From Aug. 1 to Nov. 15, 2020 had the most days when at least one county had unhealthy air (<b>${s20.nAny}</b>` +
        (tAny.year === 2020 ? "" : `, currently led by ${tAny.year} with ${tAny.nAny}`) +
        `). The worst single day in this window was <b>${tPeak.peak ? fmtS(tPeak.peak.date) + " · " + tPeak.peak.median.toFixed(0) : "–"} µg/m³</b> in ${tPeak.year}. ` +
        `Press <b>Play</b> from the start to watch 2020 pull ahead week by week. Then switch to Full year to see 2018’s sharper November peak.`);
    } else {
      d3.select("#years-sum").html(
        `Through <b>${fmtS(cal)}</b>: the most days with unhealthy air somewhere in the Bay belong to <b>${tAny.year}</b> (${tAny.nAny})` +
        (tAny.year === 2020 ? ", so 2020 is ahead" : `, while 2020 has ${s20.nAny}`) +
        `. The worst single day so far belongs to <b>${tPeak.year}</b> (${tPeak.peak ? fmtS(tPeak.peak.date) + " · " + tPeak.peak.median.toFixed(0) : "–"} µg/m³).`);
    }
  }

  function stopPlay() {
    L.playing = false;
    if (L.timer) { clearInterval(L.timer); L.timer = null; }
    d3.select("#yr-play").text("Play").classed("playing", false);
  }

  function setIdx(i, fromPlay) {
    L.idx = Math.max(0, Math.min(calDays.length - 1, i));
    document.getElementById("yr-slider").value = L.idx;
    d3.select("#yr-label").text(fmtS(calDays[L.idx]));
    updateLapse(fromPlay);
  }

  function updateLapse() {
    const st = statsThrough(L.idx);
    yearsChart(st);
    cumChart(st);
    renderTable(st);
  }

  function yearsChart(st) {
    const lgd = d3.select("#legend-years"); lgd.selectAll("*").remove();
    const grad = d3.range(0, 131, 13).map((v) => pmScale(v)).join(",");
    lgd.append("span").html(`Bay median PM2.5: 0 <i style="width:120px;background:linear-gradient(90deg,${grad})"></i> 130+ µg/m³`);
    lgd.append("span").html(`<i style="background:${NA}"></i>no data`);

    const m = { top: 14, right: 118, bottom: 44, left: 52 };
    const rowH = 34;
    const { g, iw } = mk("#v-years", m.top + years.length * rowH + m.bottom, m);
    const [lo, hi] = WINDOWS[L.winKey];
    const x = d3.scaleTime().domain([lo, d3.timeDay.offset(hi, 1)]).range([0, iw]);
    const cw = Math.max(1, iw / calDays.length);
    const ih = years.length * rowH;
    const playCal = calDays[L.idx];
    // Black border = year with the highest PM2.5 median so far.
    const leadPeak = d3.max(st, (s) => (s.peak ? s.peak.median : 0)) || 0;
    const leaders = new Set(st.filter((s) => leadPeak > 0 && s.peak && s.peak.median === leadPeak).map((s) => s.year));

    years.forEach((y, i) => {
      const row = g.append("g").attr("transform", `translate(0,${i * rowH})`);
      const leading = leaders.has(y);
      row.append("text").attr("x", -8).attr("y", rowH / 2 + 4).attr("text-anchor", "end").attr("font-size", 12).attr("font-family", FONT)
        .attr("font-weight", leading ? 700 : 400).text(y);
      calDays.forEach((cal, k) => {
        const d = dayAt(y, cal);
        const past = k <= L.idx;
        row.append("rect")
          .attr("x", x(cal)).attr("y", 2).attr("width", cw + 0.3).attr("height", rowH - 6)
          .attr("fill", !d || d.median == null ? NA : pmScale(d.median))
          .attr("opacity", past ? 1 : 0.18)
          .style("cursor", "pointer")
          .on("mousemove", (event) => {
            const real = new Date(y, cal.getMonth(), cal.getDate());
            FP.showTip(event, `<b>${fmtL(real)}</b><br>Bay median PM2.5: ${!d || d.median == null ? "no data" : d.median.toFixed(1) + " µg/m³"}` +
              (d && d.max >= 35 ? `<br><span style="opacity:.75">at least one county had unhealthy air</span>` : ""));
          })
          .on("mouseleave", () => FP.hideTip())
          .on("click", () => { stopPlay(); setIdx(k); });
      });
      if (leading) {
        row.append("rect").attr("x", -1).attr("y", 1).attr("width", iw + 2).attr("height", rowH - 4)
          .attr("fill", "none").attr("stroke", "#111").attr("stroke-width", 1.8).attr("pointer-events", "none");
      }
      const s = st.find((q) => q.year === y);
      const peakLab = s.peak ? `${fmtS(s.peak.date)} · ${s.peak.median.toFixed(0)}` : "—";
      row.append("text").attr("x", iw + 8).attr("y", rowH / 2 + 4).attr("font-size", 11).attr("font-family", FONT)
        .attr("fill", PM_DARK).attr("font-weight", leading ? 700 : 500)
        .text(peakLab)
        .on("mousemove", (event) => {
          if (!s.peak) return;
          FP.showTip(event, `<b>${y}</b><br>Worst day so far (Bay median)<br>${fmtS(s.peak.date)} · ${s.peak.median.toFixed(1)} µg/m³`);
        })
        .on("mouseleave", () => FP.hideTip());
    });
    g.append("text").attr("x", iw + 8).attr("y", -4).attr("font-size", 10).attr("font-family", FONT).attr("fill", "#666")
      .text("Worst day so far");

    // playhead
    const px = x(playCal) + cw / 2;
    g.append("line").attr("x1", px).attr("x2", px).attr("y1", 0).attr("y2", ih)
      .attr("stroke", "#111").attr("stroke-width", 1.5).attr("pointer-events", "none");

    const span = calDays.length;
    const ax = d3.axisBottom(x);
    if (span > 120) ax.ticks(d3.timeMonth.every(1)).tickFormat(d3.timeFormat("%b"));
    else if (span > 45) ax.ticks(d3.timeMonth.every(1)).tickFormat(d3.timeFormat("%b %d"));
    else ax.ticks(d3.timeDay.every(span > 20 ? 7 : 2)).tickFormat(d3.timeFormat("%b %d"));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(ax);
    g.append("text").attr("x", iw / 2).attr("y", ih + 36).attr("text-anchor", "middle").attr("font-size", 11).attr("font-family", FONT).attr("fill", "#555")
      .text(L.winKey === "all" ? "Date (same calendar for every year)" : "Date in the fire season (same calendar for every year)");
    g.append("text").attr("x", -8).attr("y", -4).attr("text-anchor", "end").attr("font-size", 10).attr("font-family", FONT).attr("fill", "#666").text("Year");
  }

  function cumChart(st) {
    // Dark red = high-PM days, as on the timeline's dots
    const BAR = "#7f1d1d", BAR_TRACK = "#f2e8e4", BAR_INK = "#7f1d1d";
    const m = { top: 8, right: 48, bottom: 46, left: 52 };
    const rowH = 26;
    const { g, iw } = mk("#v-cum", m.top + years.length * rowH + m.bottom, m);
    const maxAny = Math.max(1, d3.max(st, (s) => s.nAny));
    const x = d3.scaleLinear().domain([0, Math.max(maxAny, 22)]).range([0, iw]);
    const cumAxY = years.length * rowH;
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${cumAxY})`)
      .call(d3.axisBottom(x).ticks(Math.min(6, x.domain()[1])).tickFormat(d3.format("d")));
    g.append("text").attr("x", iw / 2).attr("y", cumAxY + 36).attr("text-anchor", "middle").attr("font-size", 11).attr("font-family", FONT).attr("fill", "#555")
      .text("Number of days with unhealthy air in at least one county");
    years.forEach((y, i) => {
      const s = st.find((q) => q.year === y);
      const row = g.append("g").attr("transform", `translate(0,${i * rowH})`);
      row.append("text").attr("x", -8).attr("y", 16).attr("text-anchor", "end").attr("font-size", 12).attr("font-family", FONT)
        .attr("font-weight", y === 2020 ? 700 : 400).text(y);
      row.append("rect").attr("x", 0).attr("y", 4).attr("width", iw).attr("height", 16).attr("fill", BAR_TRACK);
      row.append("rect").attr("x", 0).attr("y", 4).attr("width", Math.max(0, x(s.nAny))).attr("height", 16)
        .attr("fill", BAR);
      row.append("text").attr("x", x(s.nAny) + 6).attr("y", 16).attr("font-size", 11).attr("font-family", FONT)
        .attr("font-weight", 600).attr("fill", BAR_INK).text(s.nAny);
      const today = s.today;
      if (today && today.max >= 35) {
        row.append("circle").attr("cx", Math.max(4, x(s.nAny) - 4)).attr("cy", 12).attr("r", 3.5)
          .attr("fill", "#111").attr("stroke", "#fff").attr("stroke-width", 1);
      }
    });
  }

  function startPlay() {
    if (L.playing) { stopPlay(); return; }
    if (L.idx >= calDays.length - 1) L.idx = 0;
    L.playing = true;
    d3.select("#yr-play").text("Pause").classed("playing", true);
    const stepMs = L.winKey === "all" ? 18 : 45;
    L.timer = setInterval(() => {
      if (L.idx >= calDays.length - 1) { stopPlay(); setIdx(calDays.length - 1); return; }
      setIdx(L.idx + 1, true);
    }, stepMs);
  }

  d3.select("#yr-play").on("click", startPlay);
  d3.select("#yr-slider").on("input", function () { stopPlay(); setIdx(+this.value); });
  d3.selectAll("#yr-window button").on("click", function () {
    stopPlay();
    L.winKey = this.dataset.w;
    d3.selectAll("#yr-window button").classed("on", function () { return this.dataset.w === L.winKey; });
    rebuildCalendar();
    setIdx(calDays.length - 1);
  });

  // ---------- 2. Local fire vs distant smoke (headline % bars + county grouped bars) ----------
  const counties = [...new Set(cd.map((d) => d.county))].sort(d3.ascending);
  const lf = { minHms: 1, season: true, focus: new Set() };
  const COL_OFF = "#b8b2a7", COL_ON = "#0f766e", FIRE_DARK = "#115e59"; // teal = fire, as on the timeline
  const MIN = 5; // need enough days in each group for a fair county comparison
  const pct = d3.format(".0%");
  const HMS_MIN = { 1: "Light", 2: "Medium", 3: "Heavy" };
  const HMS_WHEN = { 1: "smoky", 2: "medium or thicker smoke", 3: "heavy smoke" };

  function lfBase() {
    const lo = lf.season ? new Date(2020, 7, 16) : new Date(2020, 0, 1);
    const hi = lf.season ? new Date(2020, 9, 31) : new Date(2020, 11, 31);
    return cd.filter((d) => d.pm != null && d.hms >= lf.minHms && d.date >= lo && d.date <= hi);
  }
  function lfStats(rows) {
    const n = rows.length, hi = rows.filter((d) => d.pm >= 35).length;
    return { n, hi, mean: n ? d3.mean(rows, (d) => d.pm) : null, share: n ? hi / n : null };
  }

  function localFire() {
    const baseAll = lfBase();
    const focused = [...lf.focus];
    const base = focused.length ? baseAll.filter((d) => lf.focus.has(d.county)) : baseAll;
    const off = lfStats(base.filter((d) => !d.fire));
    const on = lfStats(base.filter((d) => d.fire));
    const when = `${HMS_WHEN[lf.minHms]} days${lf.season ? " between Aug 16 and Oct 31" : ""}`;
    const whereLabel = focused.length === 0 ? "" : focused.length === 1 ? focused[0] : focused.length === 2 ? focused.join(" and ") : focused.slice(0, -1).join(", ") + ", and " + focused[focused.length - 1];
    const where = focused.length ? ` in <b>${whereLabel}</b>` : "";
    const titleFocus = focused.length === 0 ? "" : focused.length <= 2 ? ": " + focused.join(", ") : `: ${focused.length} counties`;

    // --- headline bars ---
    const m = { top: 28, right: 24, bottom: 56, left: 64 };
    const barH = 200;
    const { g, iw } = mk("#v-local", m.top + barH + m.bottom, m);
    const groups = [
      { key: "off", label: "No fire burning\nin the county", short: "No fire in the county", s: off, col: COL_OFF },
      { key: "on", label: "Fire burning\nin the county", short: "Fire in the county", s: on, col: COL_ON }
    ];
    const x = d3.scaleBand().domain(groups.map((d) => d.key)).range([0, iw]).paddingInner(0.35).paddingOuter(0.2);
    const yMax = Math.max(0.35, (on.share || 0) * 1.25, (off.share || 0) * 1.25);
    const y = d3.scaleLinear().domain([0, yMax]).range([barH, 0]);
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickFormat(pct));
    g.append("text").attr("transform", "rotate(-90)").attr("x", -barH / 2).attr("y", -48).attr("text-anchor", "middle").attr("font-size", 11).attr("font-family", FONT).attr("fill", "#555")
      .text("Share with unhealthy air");
    g.append("text").attr("x", 0).attr("y", -12).attr("font-size", 12).attr("font-family", FONT).attr("font-weight", 600).attr("fill", "#333")
      .text(`Share of smoky days with unhealthy air (35 µg/m³ or more)${titleFocus}`);
    groups.forEach((d) => {
      const bx = x(d.key), bw = x.bandwidth();
      const h = d.s.share == null ? 0 : barH - y(d.s.share);
      g.append("rect").attr("x", bx).attr("width", bw).attr("y", y(d.s.share || 0)).attr("height", Math.max(0, h))
        .attr("fill", d.col)
        .on("mousemove", (event) => FP.showTip(event, `<b>${d.short}${focused.length ? " · " + whereLabel : ""}</b><br>${pct(d.s.share || 0)} had unhealthy air<br>${d.s.hi} of ${fmtN(d.s.n)} county-days<br>average PM2.5 ${d.s.mean == null ? "—" : d.s.mean.toFixed(1)} µg/m³`))
        .on("mouseleave", () => FP.hideTip());
      if (d.s.share != null) {
        g.append("text").attr("x", bx + bw / 2).attr("y", y(d.s.share) - 8).attr("text-anchor", "middle")
          .attr("font-size", 22).attr("font-weight", 700).attr("font-family", FONT).attr("fill", d.key === "on" ? FIRE_DARK : "#444")
          .text(pct(d.s.share));
      }
      d.label.split("\n").forEach((line, i) => {
        g.append("text").attr("x", bx + bw / 2).attr("y", barH + 18 + i * 14).attr("text-anchor", "middle")
          .attr("font-size", 12).attr("font-weight", 600).attr("font-family", FONT).text(line);
      });
      g.append("text").attr("x", bx + bw / 2).attr("y", barH + 50).attr("text-anchor", "middle")
        .attr("font-size", 11).attr("font-family", FONT).attr("fill", "#666")
        .text(d.s.n ? `${fmtN(d.s.n)} county-days · average ${d.s.mean.toFixed(0)} µg/m³` : "no days");
    });

    d3.select("#local-sum").html(off.n >= MIN && on.n >= MIN
      ? `On ${when}${where}, the air was unhealthy <b>${pct(on.share)}</b> of the time when a fire was burning in the county, compared with <b>${pct(off.share)}</b> when there was none` +
        ` (average PM2.5 <b>${on.mean.toFixed(0)}</b> vs. <b>${off.mean.toFixed(0)}</b> µg/m³).` +
        (off.n < 100 ? ` <span style="color:#8a3b12">Small sample: only ${off.n} county-days had no fire in the county, so treat this gap as a hint.</span>` : "") +
        (focused.length ? ` <span style="color:#888">Click counties to add/remove, or “Clear county selection” for all counties.</span>` : "")
      : `Too few ${when}${focused.length ? " in " + whereLabel : ""} to compare (${off.n} without a fire in the county, ${on.n} with one). Try another county, Light smoke, or Whole year.`);
    d3.select("#lf-clear").style("display", focused.length ? null : "none");

    // --- county grouped bars ---
    const lg = d3.select("#legend-local"); lg.selectAll("*").remove();
    lg.append("span").html(`<i style="background:${COL_OFF}"></i>no fire in the county`);
    lg.append("span").html(`<i style="background:${COL_ON}"></i>fire burning in the county`);
    lg.append("span").style("color", "#888").text("Click counties to focus on them (you can pick more than one)");

    const allRows = counties.map((c) => {
      const r = baseAll.filter((d) => d.county === c);
      const a = lfStats(r.filter((d) => !d.fire));
      const b = lfStats(r.filter((d) => d.fire));
      return { county: c, off: a, on: b, ok: a.n >= MIN && b.n >= MIN, diff: (b.share || 0) - (a.share || 0) };
    });
    const rows = allRows.filter((d) => d.ok).sort((a, b) => d3.descending(a.diff, b.diff) || d3.ascending(a.county, b.county));
    const dropped = allRows.filter((d) => !d.ok && (d.off.n + d.on.n) > 0);
    if (!dropped.length) d3.select("#local-drop").html("");
    else {
      const bits = dropped.map((d) => {
        if (d.off.n < MIN && d.on.n < MIN) return `${d.county} (too few days in both groups)`;
        if (d.off.n < MIN) return `${d.county} (almost every smoky day had a fire in the county)`;
        return `${d.county} (almost no smoky days had a fire in the county)`;
      });
      d3.select("#local-drop").html(`Not shown: ${bits.join(", ")}. We need at least ${MIN} days in each group for a fair comparison.`);
    }

    const sm = { top: 8, right: 64, bottom: 44, left: 100 };
    const rowH = 36;
    const { g: sg, iw: siw } = mk("#v-local-counties", sm.top + Math.max(rows.length, 1) * rowH + sm.bottom, sm);
    if (rows.length < 3) {
      // too few counties to compare: say so rather than drawing a one- or two-row chart
      sg.append("text").attr("x", 0).attr("y", 20).attr("font-size", 13).attr("font-family", FONT).attr("fill", "#888")
        .text(rows.length
          ? `Only ${rows.length} ${rows.length === 1 ? "county has" : "counties have"} enough days in both groups at this setting. That is too few for a county comparison. Try Light or Medium smoke.`
          : "No county has enough smoke days in both groups for this filter.");
      return;
    }
    const xShare = d3.scaleLinear().domain([0, Math.max(0.4, d3.max(rows, (d) => Math.max(d.off.share, d.on.share)) * 1.15)]).range([0, siw]);
    sg.append("g").attr("class", "axis").attr("transform", `translate(0,${rows.length * rowH})`)
      .call(d3.axisBottom(xShare).ticks(5).tickFormat(pct));
    sg.append("text").attr("x", siw / 2).attr("y", rows.length * rowH + 38).attr("text-anchor", "middle")
      .attr("font-size", 11).attr("font-family", FONT).attr("fill", "#555").text("Share of that county’s smoky days with unhealthy air");

    rows.forEach((d, i) => {
      const yy = i * rowH;
      const isOn = lf.focus.has(d.county);
      const dim = lf.focus.size > 0 && !isOn;
      const row = sg.append("g").attr("opacity", dim ? 0.28 : 1).style("cursor", "pointer")
        .on("click", () => { if (isOn) lf.focus.delete(d.county); else lf.focus.add(d.county); localFire(); });
      row.append("rect").attr("x", -sm.left + 4).attr("y", yy + 2).attr("width", sm.left + siw + sm.right - 8).attr("height", rowH - 4)
        .attr("fill", isOn ? "#e3f1ee" : "transparent").attr("rx", 3);
      row.append("text").attr("x", -8).attr("y", yy + 22).attr("text-anchor", "end").attr("font-size", 12).attr("font-family", FONT)
        .attr("font-weight", isOn ? 700 : 400).text(d.county);
      const pairY = [yy + 8, yy + 20];
      [["off", d.off, COL_OFF, "no fire in the county"], ["on", d.on, COL_ON, "fire burning in the county"]].forEach(([, s, col, lab], j) => {
        row.append("rect").attr("x", 0).attr("y", pairY[j]).attr("width", Math.max(1, xShare(s.share))).attr("height", 10)
          .attr("fill", col)
          .on("mousemove", (event) => {
            event.stopPropagation();
            FP.showTip(event, `<b>${d.county}</b> · ${lab}<br>${pct(s.share)} had unhealthy air (${s.hi} of ${s.n} days)<br>average ${s.mean.toFixed(1)} µg/m³<br><span style="opacity:.7">click to ${isOn ? "remove from" : "add to"} selection</span>`);
          })
          .on("mouseleave", () => FP.hideTip());
      });
      row.append("text").attr("x", siw + 8).attr("y", yy + 22).attr("font-size", 11).attr("font-family", FONT)
        .attr("fill", d.diff >= 0 ? FIRE_DARK : "#666").attr("font-weight", 600)
        .text(`${d.diff >= 0 ? "+" : ""}${Math.round(d.diff * 100)} pts`);
    });
  }

  function seg(sel, get, set) {
    d3.selectAll(`${sel} button`).classed("on", function () { return get(this); });
    d3.selectAll(`${sel} button`).on("click", function () { set(this); d3.selectAll(`${sel} button`).classed("on", function () { return get(this); }); });
  }
  d3.selectAll("#lf-season button").classed("on", function () { return (this.dataset.v === "season") === lf.season; });
  seg("#lf-season", (b) => (b.dataset.v === "season") === lf.season, (b) => { lf.season = b.dataset.v === "season"; localFire(); });
  d3.select("#lf-hms-range").on("input", function () {
    lf.minHms = +this.value;
    d3.select("#lf-hms-label").text(HMS_MIN[lf.minHms]);
    localFire();
  });
  d3.select("#lf-clear").on("click", () => { lf.focus.clear(); localFire(); });

  function drawAll() {
    stopPlay();
    const keep = L.idx;
    rebuildCalendar();
    setIdx(Math.min(keep, calDays.length - 1));
    localFire();
  }

  rebuildCalendar();
  setIdx(calDays.length - 1);
  localFire();
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(drawAll, 250); });
})().catch((err) => console.error(err));
