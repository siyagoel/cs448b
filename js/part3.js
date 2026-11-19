/* Part 3 — wildfire smoke (NOAA HMS) vs high-pollution days (EPA PM2.5), Bay Area 2020, county-days */
(async function () {
  const parse = d3.timeParse("%Y-%m-%d");
  const fmt = d3.timeFormat("%b %d");
  const fmtL = d3.timeFormat("%b %d, %Y");
  const FONT = "IBM Plex Sans, system-ui, sans-serif";
  const densLabel = ["None", "Light", "Medium", "Heavy"];
  const densColor = ["#eceae6", "#c5cad3", "#8f99a8", "#4b5563"];
  // purple = smoke and unhealthy air together; gray = smoke only; orange = unhealthy air only (PM2.5 color)
  const C = { agree: "#5a2d93", smokeOnly: "#a9b1bd", pmOnly: "#c45c26", neither: "#efebe4" };
  const CAT_LABEL = {
    agree: "Smoke and unhealthy air",
    smokeOnly: "Smoke, but air not unhealthy",
    pmOnly: "Unhealthy air, no smoke",
    neither: "No smoke, air not unhealthy"
  };

  const rows = (await d3.csv("data/bay_county_pm25_fire_hms_2020_bycounty.csv", (d) => ({
    county: d.county, date: parse(d.date),
    pm: d.pm25 === "" ? null : +d.pm25,
    hms: +d.hms_max_density, fire: +d.local_calfire_active === 1
  }))).filter((d) => d.pm != null);
  const counties = [...new Set(rows.map((d) => d.county))].sort(d3.ascending);
  const geo = document.querySelector("#v-county-map")
    ? await d3.json("data/raw_boundaries/bay_counties.geojson").catch(() => null)
    : null;

  const S = { thr: 35, minLevel: 1, cat: null };

  const catOf = (d) => {
    const hi = d.pm >= S.thr, sm = d.hms >= S.minLevel;
    return hi && sm ? "agree" : sm ? "smokeOnly" : hi ? "pmOnly" : "neither";
  };

  function mk(sel, h, m) {
    const el = d3.select(sel);
    el.selectAll("*").remove();
    const w = FP.widthOf(el);
    const svg = el.append("svg").attr("width", w).attr("height", h);
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
    return { svg, g, iw: w - m.left - m.right, ih: h - m.top - m.bottom };
  }

  function counts() {
    const c = { agree: 0, smokeOnly: 0, pmOnly: 0, neither: 0 };
    rows.forEach((d) => { c[catOf(d)]++; });
    return c;
  }

  // ---------- summary + chrome ----------
  function summary() {
    const c = counts();
    const smoke = c.agree + c.smokeOnly, high = c.agree + c.pmOnly;
    const pct = d3.format(".0%");
    d3.select("#p3-thr").text(S.thr);
    d3.select("#p3-sum").html(
      high === 0
        ? `No county-day reaches ${S.thr} µg/m³.`
        : `Across all of 2020, <b>${pct(c.agree / high)}</b> of unhealthy county-days (${S.thr} µg/m³ or more) had ${densLabel[S.minLevel].toLowerCase()} or thicker smoke overhead. ` +
          `But only <b>${pct(smoke ? c.agree / smoke : 0)}</b> of smoky county-days had unhealthy air.`
    );
  }

  // ---------- A. PM2.5 distribution by HMS class ----------
  function chartA() {
    const m = { top: 16, right: 20, bottom: 56, left: 52 };
    const { g, iw, ih } = mk("#v-dist", 320, m);
    const groups = d3.range(4).map((k) => {
      const v = rows.filter((d) => d.hms === k).map((d) => d.pm).sort(d3.ascending);
      return { k, v, n: v.length,
        q05: d3.quantile(v, 0.05), q25: d3.quantile(v, 0.25), q50: d3.quantile(v, 0.5),
        q75: d3.quantile(v, 0.75), q95: d3.quantile(v, 0.95),
        above: v.filter((x) => x >= S.thr).length };
    });
    const x = d3.scaleBand().domain(d3.range(4)).range([0, iw]).paddingInner(0.4).paddingOuter(0.2);
    const y = d3.scaleSymlog().constant(10).domain([0, 230]).range([ih, 0]);

    g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickValues([0, 5, 10, 25, 35, 50, 100, 200]).tickFormat(d3.format("d")));
    g.append("text").attr("transform", "rotate(-90)").attr("x", -ih / 2).attr("y", -40).attr("text-anchor", "middle")
      .attr("font-size", 11).attr("font-family", FONT).attr("fill", "#555").text("County daily PM2.5 (µg/m³, compressed scale)");

    groups.forEach((d) => {
      const bx = x(d.k), bw = x.bandwidth(), on = d.k >= S.minLevel;
      const gg = g.append("g").attr("opacity", on ? 1 : 0.45);
      // outlier dots (above 95th pct)
      gg.selectAll("circle").data(d.v.filter((p) => p > d.q95)).join("circle")
        .attr("cx", (_, i) => bx + bw / 2 + ((i * 37) % 21 - 10) * (bw / 60)).attr("cy", (p) => y(p)).attr("r", 2)
        .attr("fill", densColor[d.k]).attr("stroke", "#777").attr("stroke-width", 0.4).attr("opacity", 0.8);
      gg.append("line").attr("x1", bx + bw / 2).attr("x2", bx + bw / 2).attr("y1", y(d.q05)).attr("y2", y(d.q95)).attr("stroke", "#777");
      gg.append("rect").attr("x", bx).attr("width", bw).attr("y", y(d.q75)).attr("height", Math.max(1, y(d.q25) - y(d.q75)))
        .attr("fill", densColor[d.k]).attr("stroke", "#555").style("cursor", "default")
        .on("mousemove", (event) => FP.showTip(event,
          `<b>HMS ${densLabel[d.k]}</b><br>${d.n} county-days<br>median ${d.q50.toFixed(1)} · middle half ${d.q25.toFixed(1)}–${d.q75.toFixed(1)}<br>5th–95th pct ${d.q05.toFixed(1)}–${d.q95.toFixed(1)}`))
        .on("mouseleave", () => FP.hideTip());
      gg.append("line").attr("x1", bx).attr("x2", bx + bw).attr("y1", y(d.q50)).attr("y2", y(d.q50)).attr("stroke", "#111").attr("stroke-width", 2.5);
      g.append("text").attr("x", bx + bw / 2).attr("y", ih + 18).attr("text-anchor", "middle")
        .attr("font-size", 12).attr("font-family", FONT).attr("font-weight", 600).text(`HMS ${densLabel[d.k]}`);
      g.append("text").attr("x", bx + bw / 2).attr("y", ih + 34).attr("text-anchor", "middle")
        .attr("font-size", 10.5).attr("font-family", FONT).attr("fill", "#666").text(`${d3.format(",")(d.n)} county-days`);
      g.append("text").attr("x", bx + bw / 2).attr("y", ih + 48).attr("text-anchor", "middle")
        .attr("font-size", 10.5).attr("font-family", FONT).attr("fill", C.agree)
        .text(`${d3.format(".1%")(d.above / d.n)} ≥ ${S.thr}`);
    });

    g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(S.thr)).attr("y2", y(S.thr))
      .attr("stroke", C.agree).attr("stroke-dasharray", "4,4");
    g.append("text").attr("x", iw).attr("y", y(S.thr) - 4).attr("text-anchor", "end")
      .attr("font-size", 10).attr("font-family", FONT).attr("fill", C.agree).text(`high-PM threshold: ${S.thr} µg/m³`);
  }

  // ---------- B. Two 100% bars: precision and recall of smoke as a signal ----------
  function chartB() {
    const m = { top: 8, right: 20, bottom: 8, left: 20 };
    const barH = 38, labelH = 22, gap = 26;
    const { g, iw } = mk("#v-match", m.top + m.bottom + 2 * (barH + labelH) + gap, m);
    const c = counts();
    const smoke = c.agree + c.smokeOnly, high = c.agree + c.pmOnly;
    const bars = [
      { y: 0, title: `When satellites show smoke (${densLabel[S.minLevel]}+): ${d3.format(",")(smoke)} county-days`,
        segs: [["agree", c.agree, "had high PM2.5"], ["smokeOnly", c.smokeOnly, "did not"]] },
      { y: barH + labelH + gap, title: `When PM2.5 is high (≥ ${S.thr}): ${d3.format(",")(high)} county-days`,
        segs: [["agree", c.agree, "had satellite smoke"], ["pmOnly", c.pmOnly, "had none"]] }
    ];
    bars.forEach((b) => {
      const tot = d3.sum(b.segs, (s) => s[1]);
      g.append("text").attr("y", b.y + 12).attr("font-size", 12.5).attr("font-weight", 600).attr("font-family", FONT).text(b.title);
      let x0 = 0;
      b.segs.forEach(([cat, n, txt]) => {
        const w = tot ? (n / tot) * iw : 0;
        if (w <= 0) return;
        const sel = S.cat === cat;
        g.append("rect").attr("x", x0).attr("y", b.y + labelH - 4).attr("width", w).attr("height", barH)
          .attr("fill", C[cat]).attr("opacity", S.cat && !sel ? 0.35 : 1)
          .attr("stroke", sel ? "#111" : "#fff").attr("stroke-width", sel ? 2.5 : 1).style("cursor", "pointer")
          .on("mousemove", (event) => FP.showTip(event, `<b>${CAT_LABEL[cat]}</b><br>${d3.format(",")(n)} county-days<br><span style="opacity:.7">click to highlight in the matrix below</span>`))
          .on("mouseleave", () => FP.hideTip())
          .on("click", () => { S.cat = S.cat === cat ? null : cat; redraw(); });
        if (w > 120) {
          g.append("text").attr("x", x0 + 8).attr("y", b.y + labelH - 4 + barH / 2 + 4).attr("pointer-events", "none")
            .attr("font-size", 12).attr("font-family", FONT).attr("fill", cat === "smokeOnly" ? "#1f2937" : "#fff")
            .text(`${d3.format(".0%")(n / tot)} ${txt}`);
        } else if (w > 34) {
          g.append("text").attr("x", x0 + w / 2).attr("y", b.y + labelH - 4 + barH / 2 + 4).attr("pointer-events", "none")
            .attr("text-anchor", "middle").attr("font-size", 11).attr("font-family", FONT)
            .attr("fill", cat === "smokeOnly" ? "#1f2937" : "#fff").text(d3.format(".0%")(n / tot));
        }
        x0 += w;
      });
    });
  }

  // ---------- C. Original 4-color county × day matrix ----------
  function chartC() {
    const m = { top: 10, right: 20, bottom: 28, left: 100 };
    const rowH = 20;
    const { g, iw } = mk("#v-matrix", m.top + counties.length * rowH + m.bottom, m);
    const start = new Date(2020, 7, 1), end = new Date(2020, 10, 15);
    const x = d3.scaleTime().domain([start, d3.timeDay.offset(end, 1)]).range([0, iw]);
    const cw = x(d3.timeDay.offset(start, 1)) - x(start);
    const stat = new Map(counties.map((c) => [c, 0]));
    rows.forEach((d) => { if (catOf(d) === "agree") stat.set(d.county, stat.get(d.county) + 1); });
    const order = [...counties].sort((a, b) => stat.get(b) - stat.get(a) || d3.ascending(a, b));

    order.forEach((c, i) => {
      g.append("text").attr("x", -8).attr("y", i * rowH + rowH / 2 + 4).attr("text-anchor", "end")
        .attr("font-size", 11).attr("font-family", FONT).text(c);
    });
    const data = rows.filter((d) => d.date >= start && d.date <= end);
    g.selectAll("rect.cell").data(data).join("rect").attr("class", "cell")
      .attr("x", (d) => x(d.date)).attr("y", (d) => order.indexOf(d.county) * rowH + 1)
      .attr("width", Math.max(1, cw - 0.4)).attr("height", rowH - 2)
      .attr("fill", (d) => C[catOf(d)])
      .attr("opacity", (d) => (S.cat ? (catOf(d) === S.cat ? 1 : 0.12) : 1))
      .on("mousemove", tipCD)
      .on("mouseleave", () => FP.hideTip());

    g.append("g").attr("class", "axis").attr("transform", `translate(0,${order.length * rowH})`)
      .call(d3.axisBottom(x).ticks(d3.timeMonth.every(1)).tickFormat(d3.timeFormat("%b")));
  }

  function legend() {
    const lg = d3.select("#legend-cat");
    lg.selectAll("*").remove();
    ["agree", "smokeOnly", "pmOnly", "neither"].forEach((k) => {
      lg.append("span").style("cursor", "pointer").style("opacity", S.cat && S.cat !== k ? 0.4 : 1)
        .html(`<i style="background:${C[k]}"></i>${CAT_LABEL[k]}`)
        .on("click", () => { S.cat = S.cat === k ? null : k; redraw(); });
    });
  }

  // ---------- Alternatives: five clearer “where/when” views (Aug–Nov) ----------
  const SEASON = [new Date(2020, 7, 1), new Date(2020, 10, 15)];
  const OTHER = "#f4f1ea";
  const seasonRows = () => rows.filter((d) => d.date >= SEASON[0] && d.date <= SEASON[1]);
  const tipCD = (event, d) => FP.showTip(event,
    `<b>${d.county}</b> · ${fmtL(d.date)}<br>PM2.5 ${d.pm.toFixed(1)} µg/m³<br>HMS smoke: ${densLabel[d.hms]}` +
    `${d.fire ? "<br>CalFire incident active in this county" : ""}<br><span style="opacity:.7">${CAT_LABEL[catOf(d)]}</span>`);
  function fillLegend(sel, items) {
    const lg = d3.select(sel); lg.selectAll("*").remove();
    items.forEach(([col, lab]) => lg.append("span").html(`<i style="background:${col}"></i>${lab}`));
  }
  function countyOrderByAgree(data) {
    const stat = new Map(counties.map((c) => [c, 0]));
    data.forEach((d) => { if (catOf(d) === "agree") stat.set(d.county, stat.get(d.county) + 1); });
    return [...counties].sort((a, b) => stat.get(b) - stat.get(a) || d3.ascending(a, b));
  }

  // 1. Two linked Bay-day strips
  function chartStrips() {
    const m = { top: 8, right: 20, bottom: 28, left: 120 };
    const rowH = 28, gap = 14;
    const { g, iw } = mk("#v-strips", m.top + 2 * rowH + gap + m.bottom, m);
    const [start, end] = SEASON;
    const days = d3.timeDay.range(start, d3.timeDay.offset(end, 1));
    const x = d3.scaleTime().domain([start, d3.timeDay.offset(end, 1)]).range([0, iw]);
    const cw = Math.max(1, x(d3.timeDay.offset(start, 1)) - x(start));
    const byDay = d3.group(seasonRows(), (d) => +d.date);
    const series = days.map((day) => {
      const v = byDay.get(+day) || [];
      const smoke = v.some((d) => d.hms >= S.minLevel);
      const high = v.some((d) => d.pm >= S.thr);
      return { day, smoke, high, agree: smoke && high, n: v.length };
    });
    const bands = [
      { y: 0, key: "smoke", label: "Any county: smoke", on: (d) => d.smoke, col: C.smokeOnly },
      { y: rowH + gap, key: "high", label: `Any county: PM2.5 ≥ ${S.thr}`, on: (d) => d.high, col: C.agree }
    ];
    bands.forEach((b) => {
      g.append("text").attr("x", -8).attr("y", b.y + rowH / 2 + 4).attr("text-anchor", "end")
        .attr("font-size", 11).attr("font-family", FONT).text(b.label);
      g.selectAll(`rect.${b.key}`).data(series).join("rect")
        .attr("x", (d) => x(d.day)).attr("y", b.y).attr("width", cw + 0.2).attr("height", rowH)
        .attr("fill", (d) => (b.on(d) ? (d.agree ? C.agree : b.col) : OTHER))
        .on("mousemove", (event, d) => FP.showTip(event,
          `<b>${fmtL(d.day)}</b><br>Smoke somewhere: ${d.smoke ? "yes" : "no"}<br>High PM somewhere: ${d.high ? "yes" : "no"}` +
          `${d.agree ? "<br><b>Agree somewhere in the Bay</b>" : ""}`))
        .on("mouseleave", () => FP.hideTip());
    });
    // mark overlap days with ticks on the gap
    series.filter((d) => d.agree).forEach((d) => {
      g.append("rect").attr("x", x(d.day)).attr("y", rowH + 4).attr("width", cw + 0.2).attr("height", gap - 8)
        .attr("fill", C.agree).attr("opacity", 0.85);
    });
    g.append("text").attr("x", iw).attr("y", rowH + gap / 2 + 4).attr("text-anchor", "end")
      .attr("font-size", 10).attr("font-family", FONT).attr("fill", "#666")
      .text(`${series.filter((d) => d.agree).length} overlap days`);
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${2 * rowH + gap})`)
      .call(d3.axisBottom(x).ticks(d3.timeMonth.every(1)).tickFormat(d3.timeFormat("%b")));
  }

  // 2. Simplified 3-state matrix
  function chartMatrixSimple() {
    fillLegend("#legend-simple", [
      [C.agree, "Smoke + high PM2.5"],
      [C.smokeOnly, "Smoke only"],
      [OTHER, "Other"]
    ]);
    const m = { top: 10, right: 20, bottom: 28, left: 100 };
    const rowH = 20;
    const data = seasonRows();
    const order = countyOrderByAgree(data);
    const { g, iw } = mk("#v-matrix-simple", m.top + order.length * rowH + m.bottom, m);
    const [start, end] = SEASON;
    const x = d3.scaleTime().domain([start, d3.timeDay.offset(end, 1)]).range([0, iw]);
    const cw = x(d3.timeDay.offset(start, 1)) - x(start);
    const simple = (d) => { const c = catOf(d); return c === "agree" || c === "smokeOnly" ? c : "other"; };
    const col = { agree: C.agree, smokeOnly: C.smokeOnly, other: OTHER };
    order.forEach((c, i) => {
      g.append("text").attr("x", -8).attr("y", i * rowH + rowH / 2 + 4).attr("text-anchor", "end")
        .attr("font-size", 11).attr("font-family", FONT).text(c);
    });
    g.selectAll("rect.cell").data(data).join("rect")
      .attr("x", (d) => x(d.date)).attr("y", (d) => order.indexOf(d.county) * rowH + 1)
      .attr("width", Math.max(1, cw - 0.4)).attr("height", rowH - 2)
      .attr("fill", (d) => col[simple(d)])
      .attr("opacity", (d) => (S.cat ? (catOf(d) === S.cat ? 1 : 0.12) : 1))
      .on("mousemove", tipCD).on("mouseleave", () => FP.hideTip());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${order.length * rowH})`)
      .call(d3.axisBottom(x).ticks(d3.timeMonth.every(1)).tickFormat(d3.timeFormat("%b")));
  }

  // 3. County stacked % bars + Aug–Nov season-so-far time lapse
  const barsDays = d3.timeDay.range(SEASON[0], d3.timeDay.offset(SEASON[1], 1));
  const Bars = { idx: barsDays.length - 1, playing: false, timer: null };

  function stopBarsPlay() {
    Bars.playing = false;
    if (Bars.timer) { clearInterval(Bars.timer); Bars.timer = null; }
    d3.select("#p3-bars-play").text("Play").classed("playing", false);
  }

  function setBarsIdx(i) {
    Bars.idx = Math.max(0, Math.min(barsDays.length - 1, i));
    const slider = document.getElementById("p3-bars-slider");
    if (slider) {
      slider.max = barsDays.length - 1;
      slider.value = Bars.idx;
    }
    d3.select("#p3-bars-date").text(fmt(barsDays[Bars.idx]));
    chartCountyBars();
    chartCountyMap();
  }

  function startBarsPlay() {
    if (Bars.playing) { stopBarsPlay(); return; }
    if (Bars.idx >= barsDays.length - 1) Bars.idx = 0;
    Bars.playing = true;
    d3.select("#p3-bars-play").text("Pause").classed("playing", true);
    Bars.timer = setInterval(() => {
      if (Bars.idx >= barsDays.length - 1) { stopBarsPlay(); setBarsIdx(barsDays.length - 1); return; }
      setBarsIdx(Bars.idx + 1);
    }, 45);
  }

  function chartCountyBars() {
    fillLegend("#legend-bars", [
      [C.agree, "Smoke and unhealthy air"],
      [C.smokeOnly, "Smoke, air not unhealthy"],
      [C.pmOnly, "Unhealthy air, no smoke"],
      [C.neither, "Neither"]
    ]);
    const through = barsDays[Bars.idx] || SEASON[1];
    const full = seasonRows();
    const data = full.filter((d) => d.date <= through);
    const keys = ["agree", "smokeOnly", "pmOnly", "neither"];
    // Stable order by full-season agree counts so rows don’t jump while playing
    const fullAgree = new Map(counties.map((c) => [c, full.filter((d) => d.county === c && catOf(d) === "agree").length]));
    const order = [...counties].sort((a, b) => fullAgree.get(b) - fullAgree.get(a) || d3.ascending(a, b));
    const stats = order.map((c) => {
      const v = data.filter((d) => d.county === c);
      const o = { county: c, n: v.length };
      keys.forEach((k) => { o[k] = v.filter((d) => catOf(d) === k).length; });
      return o;
    });
    const m = { top: 8, right: 56, bottom: 46, left: 100 };
    const rowH = 26;
    const { g, iw } = mk("#v-county-bars", m.top + stats.length * rowH + m.bottom, m);
    const x = d3.scaleLinear().domain([0, 1]).range([0, iw]);
    stats.forEach((s, i) => {
      const yy = i * rowH;
      const dim = FP.isDimmed(s.county), picked = FP.sel.has(s.county);
      g.append("text").attr("x", -8).attr("y", yy + 16).attr("text-anchor", "end")
        .attr("font-size", 11).attr("font-family", FONT)
        .attr("font-weight", picked ? 700 : 400).attr("fill", dim ? "#999" : "#222")
        .style("cursor", "pointer").text(s.county)
        .on("click", () => FP.toggleCounty(s.county));
      if (picked) {
        g.append("rect").attr("x", -2).attr("y", yy + 2).attr("width", iw + 4).attr("height", 20)
          .attr("fill", "none").attr("stroke", "#222").attr("stroke-width", 1.2);
      }
      let x0 = 0;
      keys.forEach((k) => {
        const w = s.n ? s[k] / s.n : 0;
        if (w <= 0) return;
        g.append("rect").attr("x", x(x0)).attr("y", yy + 4).attr("width", Math.max(0, x(w) - x(0))).attr("height", 16)
          .attr("fill", C[k])
          .attr("opacity", (S.cat && S.cat !== k ? 0.25 : 1) * (dim ? 0.3 : 1))
          .on("mousemove", (event) => FP.showTip(event, `<b>${s.county}</b> · through ${fmt(through)}<br>${CAT_LABEL[k]}: <b>${s[k]}</b> days (${d3.format(".0%")(w)})`))
          .on("mouseleave", () => FP.hideTip())
          .on("click", () => { S.cat = S.cat === k ? null : k; redraw(); });
        x0 += w;
      });
      g.append("text").attr("x", iw + 6).attr("y", yy + 16).attr("font-size", 10).attr("font-family", FONT).attr("fill", C.agree)
        .attr("opacity", dim ? 0.4 : 1).attr("font-weight", picked ? 700 : 400)
        .text(`${s.agree} both`);
    });
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${stats.length * rowH})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));
    g.append("text").attr("x", iw / 2).attr("y", stats.length * rowH + 36).attr("text-anchor", "middle").attr("font-size", 11).attr("font-family", FONT).attr("fill", "#555")
      .text("Share of the county’s days since Aug. 1");

    const agreeN = d3.sum(stats, (s) => s.agree);
    const nDays = new Set(data.filter((d) => catOf(d) === "agree").map((d) => +d.date)).size;
    d3.select("#p3-bars-sum").html(
      `Through <b>${fmtL(through)}</b>: <b>${agreeN}</b> county-days had both smoke and unhealthy air, spread across <b>${nDays}</b> calendar days.`
    );
  }

  // 3b. County map, linked to the bars: share of each county's smoke days that were also high-PM2.5
  const MAP_EMPTY = "#ece8e1";
  const MIN_SMOKE = 3; // below this many smoke days a share is too noisy to color (1 of 1 = 100%)
  const SCALE_MIN_SMOKE = 10; // early-season spikes on a handful of days shouldn't set the color scale
  // small or narrow coastal counties get their label out in the ocean, with a leader line
  const OCEAN_LABEL = { "Marin": -6, "San Francisco": 0, "San Mateo": 10, "Santa Cruz": 8 }; // value = vertical nudge (px)
  const LABEL_NUDGE = { "Solano": [8, 4], "Contra Costa": [0, -2] };
  let mapMaxCache = { key: null, max: 0.1 };
  function mapMaxShare() {
    // highest share any county reaches at any playhead position (with >= MIN_SMOKE smoke days),
    // so the color scale stays fixed while playing
    const key = S.thr + "|" + S.minLevel;
    if (mapMaxCache.key === key) return mapMaxCache.max;
    const acc = new Map(counties.map((c) => [c, { smoke: 0, agree: 0 }]));
    const byDay = d3.group(seasonRows(), (d) => +d.date);
    let max = 0;
    barsDays.forEach((day) => {
      (byDay.get(+day) || []).forEach((d) => {
        const k = catOf(d), a = acc.get(d.county);
        if (k === "agree" || k === "smokeOnly") a.smoke++;
        if (k === "agree") a.agree++;
      });
      acc.forEach((a) => { if (a.smoke >= SCALE_MIN_SMOKE) max = Math.max(max, a.agree / a.smoke); });
    });
    mapMaxCache = { key, max: Math.max(0.1, Math.min(1, max)) };
    return mapMaxCache.max;
  }
  function countyShares(through) {
    const m = new Map(counties.map((c) => [c, { smoke: 0, agree: 0 }]));
    seasonRows().forEach((d) => {
      if (d.date > through) return;
      const k = catOf(d);
      if (k === "agree" || k === "smokeOnly") m.get(d.county).smoke++;
      if (k === "agree") m.get(d.county).agree++;
    });
    m.forEach((v) => { v.share = v.smoke >= MIN_SMOKE ? v.agree / v.smoke : null; });
    return m;
  }
  function chartCountyMap() {
    const el = document.querySelector("#v-county-map");
    if (!el || !geo) return;
    const w = el.clientWidth || 320, h = Math.round(Math.min(440, Math.max(320, w * 1.15)));
    d3.select(el).selectAll("*").remove();
    const svg = d3.select(el).append("svg").attr("width", w).attr("height", h);
    const legendH = 46;
    const proj = d3.geoMercator().fitExtent([[Math.min(78, w * 0.22), 8], [w - 10, h - legendH]], geo);
    const path = d3.geoPath(proj);
    const through = barsDays[Bars.idx] || SEASON[1];
    const now = countyShares(through);
    // square-root ramp: keeps the fixed scale honest (early-Sept peaks near the top) while still separating
    // the 10–25% range most counties end the season in
    const color = d3.scaleSequentialSqrt(d3.interpolateRgb("#f3eefa", C.agree)).domain([0, mapMaxShare()]).clamp(true);
    const pct = d3.format(".0%");

    svg.append("g").selectAll("path").data(geo.features).join("path")
      .attr("d", path)
      .attr("fill", (f) => { const v = now.get(f.properties.county); return v && v.share != null ? color(v.share) : MAP_EMPTY; })
      .attr("stroke", (f) => (FP.sel.has(f.properties.county) ? "#111" : "#fff"))
      .attr("stroke-width", (f) => (FP.sel.has(f.properties.county) ? 2.4 : 1))
      .attr("opacity", (f) => (FP.isDimmed(f.properties.county) ? 0.35 : 1))
      .style("cursor", "pointer")
      .on("click", (event, f) => FP.toggleCounty(f.properties.county))
      .on("mousemove", (event, f) => {
        const c = f.properties.county, v = now.get(c);
        FP.showTip(event, `<b>${c}</b> · Aug 1 – ${fmt(through)}<br>` +
          (v && v.smoke ? `${v.smoke} smoke days, <b>${v.agree}</b> with unhealthy air` +
                          (v.share != null ? `<br><b>${pct(v.share)}</b> of smoke days turned unhealthy` : `<br>Too few smoke days yet to compare`)
                        : "No smoke days yet") +
          `<br><span style="opacity:.7">Click to ${FP.sel.has(c) ? "remove highlight" : "highlight"}</span>`);
      })
      .on("mouseleave", () => FP.hideTip());
    // raise selected outlines above neighbours
    svg.selectAll("path").filter((f) => FP.sel.has(f.properties.county)).raise();

    const lab = svg.append("g").style("pointer-events", "none").attr("font-family", FONT).attr("text-anchor", "middle");
    geo.features.forEach((f) => {
      const c = f.properties.county, v = now.get(c);
      const [cx, cy] = path.centroid(f);
      const ocean = c in OCEAN_LABEL;
      let lx, ly, anchor = "middle";
      if (ocean) {
        lx = path.bounds(f)[0][0] - 10; ly = cy + OCEAN_LABEL[c] - 4; anchor = "end";
        lab.append("line").attr("x1", lx + 3).attr("y1", ly + 2).attr("x2", cx).attr("y2", cy)
          .attr("stroke", "#777").attr("stroke-width", 0.8).attr("opacity", FP.isDimmed(c) ? 0.4 : 1);
      } else {
        const [dx, dy] = LABEL_NUDGE[c] || [0, 0];
        lx = cx + dx; ly = cy + dy - 2;
      }
      const dark = !ocean && v && v.share != null && v.share > color.domain()[1] * 0.55;
      const t = lab.append("text").attr("x", lx).attr("y", ly).attr("text-anchor", anchor)
        .attr("fill", dark ? "#fff" : "#222").attr("opacity", FP.isDimmed(c) ? 0.45 : 1)
        .attr("stroke", dark ? "none" : "rgba(255,252,248,.9)").attr("stroke-width", 3).attr("paint-order", "stroke");
      t.append("tspan").attr("x", lx).attr("font-size", 10).attr("font-weight", FP.sel.has(c) ? 700 : 500).text(c);
      t.append("tspan").attr("x", lx).attr("dy", 12).attr("font-size", 11).attr("font-weight", 700)
        .text(v && v.share != null ? pct(v.share) : "–");
    });

    // legend
    const lw = Math.min(170, w - 130), lx = 6, ly = h - legendH + 14;
    const gid = "p3-map-grad";
    const grad = svg.append("defs").append("linearGradient").attr("id", gid);
    // stops placed along the sqrt ramp, so legend position t shows value t² × max
    d3.range(0, 1.01, 0.125).forEach((t) => grad.append("stop").attr("offset", `${t * 100}%`).attr("stop-color", color(t * t * color.domain()[1])));
    const lg = svg.append("g").attr("font-family", FONT).attr("font-size", 10).attr("fill", "#555");
    const mid = color.domain()[1] / 4; // with a sqrt ramp, 1/4 of the max sits at the gradient's midpoint
    lg.append("text").attr("x", lx + lw / 2).attr("y", ly + 21).attr("text-anchor", "middle").text(pct(mid));
    lg.append("text").attr("x", lx).attr("y", ly - 4).text("Share of smoke days with unhealthy air");
    lg.append("rect").attr("x", lx).attr("y", ly).attr("width", lw).attr("height", 9).attr("fill", `url(#${gid})`);
    lg.append("text").attr("x", lx).attr("y", ly + 21).text("0%");
    lg.append("text").attr("x", lx + lw).attr("y", ly + 21).attr("text-anchor", "end").text(pct(color.domain()[1]) + "+");
    lg.append("rect").attr("x", lx + lw + 12).attr("y", ly).attr("width", 9).attr("height", 9).attr("fill", MAP_EMPTY);
    lg.append("text").attr("x", lx + lw + 25).attr("y", ly + 8).text(`under ${MIN_SMOKE} smoke days`);
  }

  // 4. Agreement-only calendar
  function chartAgreeOnly() {
    const data = seasonRows().filter((d) => catOf(d) === "agree");
    const order = countyOrderByAgree(seasonRows());
    const m = { top: 10, right: 72, bottom: 28, left: 100 };
    const rowH = 20;
    const { g, iw } = mk("#v-agree-only", m.top + order.length * rowH + m.bottom, m);
    const [start, end] = SEASON;
    const x = d3.scaleTime().domain([start, d3.timeDay.offset(end, 1)]).range([0, iw]);
    const cw = x(d3.timeDay.offset(start, 1)) - x(start);
    order.forEach((c, i) => {
      const n = data.filter((d) => d.county === c).length;
      g.append("rect").attr("x", 0).attr("y", i * rowH + 1).attr("width", iw).attr("height", rowH - 2).attr("fill", "#f7f4ee");
      g.append("text").attr("x", -8).attr("y", i * rowH + rowH / 2 + 4).attr("text-anchor", "end")
        .attr("font-size", 11).attr("font-family", FONT).text(c);
      g.append("text").attr("x", iw + 8).attr("y", i * rowH + rowH / 2 + 4)
        .attr("font-size", 11).attr("font-family", FONT).attr("fill", C.agree).attr("font-weight", 600).text(n);
    });
    g.append("text").attr("x", iw + 8).attr("y", -2).attr("font-size", 10).attr("font-family", FONT).attr("fill", "#666").text("days");
    g.selectAll("rect.hit").data(data).join("rect").attr("class", "hit")
      .attr("x", (d) => x(d.date)).attr("y", (d) => order.indexOf(d.county) * rowH + 3)
      .attr("width", Math.max(2, cw - 0.2)).attr("height", rowH - 6)
      .attr("fill", C.agree).attr("rx", 1)
      .on("mousemove", tipCD).on("mouseleave", () => FP.hideTip());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${order.length * rowH})`)
      .call(d3.axisBottom(x).ticks(d3.timeMonth.every(1)).tickFormat(d3.timeFormat("%b")));
    const nDays = new Set(data.map((d) => +d.date)).size;
    d3.select("#p3-agree-sum").html(
      `<b>${data.length}</b> county-days (across <b>${nDays}</b> calendar days) had both smoke and PM2.5 ≥ ${S.thr} µg/m³ in Aug–Nov. Most of the grid stays empty.`
    );
  }

  // 5. Small multiples per county
  function chartMulti() {
    fillLegend("#legend-multi", [
      [C.agree, "Smoke + high PM2.5"],
      [C.smokeOnly, "Smoke only"],
      [OTHER, "Other"]
    ]);
    const data = seasonRows();
    const order = countyOrderByAgree(data);
    const m = { top: 4, right: 20, bottom: 20, left: 100 };
    const rowH = 18;
    const { g, iw } = mk("#v-multi", m.top + order.length * rowH + m.bottom, m);
    const [start, end] = SEASON;
    const x = d3.scaleTime().domain([start, d3.timeDay.offset(end, 1)]).range([0, iw]);
    const cw = x(d3.timeDay.offset(start, 1)) - x(start);
    const simple = (d) => { const c = catOf(d); return c === "agree" || c === "smokeOnly" ? c : "other"; };
    const col = { agree: C.agree, smokeOnly: C.smokeOnly, other: OTHER };
    order.forEach((c, i) => {
      g.append("text").attr("x", -8).attr("y", i * rowH + rowH / 2 + 3).attr("text-anchor", "end")
        .attr("font-size", 11).attr("font-family", FONT).text(c);
      g.append("rect").attr("x", 0).attr("y", i * rowH + 2).attr("width", iw).attr("height", rowH - 4).attr("fill", OTHER);
    });
    g.selectAll("rect.cell").data(data.filter((d) => simple(d) !== "other")).join("rect")
      .attr("x", (d) => x(d.date)).attr("y", (d) => order.indexOf(d.county) * rowH + 2)
      .attr("width", Math.max(1, cw - 0.3)).attr("height", rowH - 4)
      .attr("fill", (d) => col[simple(d)])
      .on("mousemove", tipCD).on("mouseleave", () => FP.hideTip());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${order.length * rowH})`)
      .call(d3.axisBottom(x).ticks(d3.timeMonth.every(1)).tickFormat(d3.timeFormat("%b")));
  }

  function redraw() {
    if (document.querySelector("#p3-sum") || document.querySelector("#p3-thr")) summary();
    if (document.querySelector("#v-dist")) chartA();
    if (document.querySelector("#v-match")) chartB();
    if (document.querySelector("#v-matrix")) { chartC(); legend(); }
    if (document.querySelector("#v-strips")) chartStrips();
    if (document.querySelector("#v-matrix-simple")) chartMatrixSimple();
    if (document.querySelector("#v-county-bars")) chartCountyBars();
    if (document.querySelector("#v-county-map")) chartCountyMap();
    if (document.querySelector("#v-agree-only")) chartAgreeOnly();
    if (document.querySelector("#v-multi")) chartMulti();
    d3.selectAll("#p3-level button").classed("on", function () { return +this.dataset.level === S.minLevel; });
    d3.select("#p3-clear").style("display", S.cat || FP.sel.size ? null : "none");
    d3.select("#p3-bars-date").text(fmt(barsDays[Bars.idx]));
    const slider = document.getElementById("p3-bars-slider");
    if (slider) { slider.max = barsDays.length - 1; slider.value = Bars.idx; }
  }

  d3.select("#p3-range").on("input", function () { S.thr = +this.value; redraw(); });
  d3.selectAll("#p3-level button").on("click", function () { S.minLevel = +this.dataset.level; redraw(); });
  d3.select("#p3-clear").on("click", () => { S.cat = null; FP.sel.clear(); FP._notifyCounties(); });
  FP.onCounties(() => redraw());
  d3.select("#p3-reset").on("click", () => {
    stopBarsPlay();
    S.thr = 35; S.minLevel = 1; S.cat = null;
    document.getElementById("p3-range").value = 35;
    Bars.idx = barsDays.length - 1;
    FP.sel.clear();
    FP._notifyCounties(); // redraws section 3 and repaints the section 2 race
  });
  d3.select("#p3-bars-play").on("click", startBarsPlay);
  d3.select("#p3-bars-slider").on("input", function () { stopBarsPlay(); setBarsIdx(+this.value); });
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(redraw, 150); });
  redraw();
})();
