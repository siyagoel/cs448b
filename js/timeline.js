/* Part 1 — six timeline concepts on EPA PM2.5 + CalFire + NOAA HMS (Bay Area 2020) */
(async function () {
  const parse = d3.timeParse("%Y-%m-%d");
  const fmt = d3.timeFormat("%b %d");
  const fmtL = d3.timeFormat("%b %d, %Y");
  const FONT = "IBM Plex Sans, system-ui, sans-serif";
  const YEAR = [new Date(2020, 0, 1), new Date(2020, 11, 31)];
  const CAL = [new Date(2020, 7, 1), new Date(2020, 10, 15)];
  // Sep 11, 2020 = Bay-wide peak (~130 µg/m³). Sep 9 was the "orange sky" day, but smoke was aloft and surface PM2.5 was only ~28.
  const DEFAULT_DATE = new Date(2020, 8, 11);
  const densLabel = ["None", "Light", "Medium", "Heavy"];
  // Article color system: PM2.5 = orange to dark red, satellite smoke = grays, fires = teal,
  // smoke + unhealthy air together = purple (section 3).
  const densColor = ["#eceae6", "#c5cad3", "#8f99a8", "#4b5563"];
  const FIRE = "#0f766e";

  const [daily, joined, fires] = await Promise.all([
    d3.csv("data/bay_area_pm25_daily_2020.csv", (d) => ({ county: d.county, date: parse(d.date), pm25: +d.pm25 })),
    d3.csv("data/bay_pm25_fire_hms_daily_2020_bycounty.csv", (d) => ({
      date: parse(d.date),
      median: d.median_pm25 === "" ? null : +d.median_pm25,
      hms: +d.hms_max_density,
      fireNames: d.active_fire_names,
      highPm: +d.high_pm === 1
    })),
    d3.csv("data/calfire_events_for_charts_2020.csv", (d) => ({
      id: d.event_id, name: d.name, short: d.short_label,
      start: parse(d.start), end: parse(d.end),
      acres: +d.acres, bayHit: +d.bay_hit === 1, counties: d.counties.replace(/;/g, ", ")
    }))
  ]);

  fires.sort((a, b) => a.start - b.start || b.acres - a.acres);
  const fireColor = d3.scaleOrdinal(d3.schemeTableau10).domain(fires.map((f) => f.id));
  const byDate = new Map(joined.map((d) => [+d.date, d]));
  const rowAt = (d) => byDate.get(+d3.timeDay.floor(d));
  const activeFires = (d) => fires.filter((f) => d >= f.start && d <= f.end);
  const fmtAcres = d3.format(".2s");

  const counties = [...new Set(daily.map((d) => d.county))].sort(d3.ascending);
  // county highlight colors avoid the PM (orange/red), smoke (gray), fire (teal) and agreement (purple) colors
  const countyColor = d3.scaleOrdinal(["#2563eb", "#db2777", "#65a30d", "#1e3a8a", "#be185d", "#4d7c0f", "#0284c7", "#ca8a04", "#9d174d", "#166534"]).domain(counties);
  const byCounty = d3.group(daily, (d) => d.county);
  const countyAt = new Map(counties.map((c) => [c, new Map(byCounty.get(c).map((d) => [+d.date, d.pm25]))]));

  const pmScale = d3.scaleSequentialSqrt(d3.interpolateYlOrRd).domain([0, 130]);

  // cumulative exposure per county (µg/m³·days above 12) and smoke days (>=35)
  const nDays = d3.timeDay.count(YEAR[0], YEAR[1]) + 1;
  const cum = new Map();
  counties.forEach((c) => {
    let e = 0, s = 0;
    const arr = [];
    for (let i = 0; i < nDays; i++) {
      const pm = countyAt.get(c).get(+d3.timeDay.offset(YEAR[0], i));
      if (pm != null) { e += Math.max(0, pm - 12); if (pm >= 35) s += 1; }
      arr.push({ e, s });
    }
    cum.set(c, arr);
  });

  const S = { range: YEAR.slice(), date: DEFAULT_DATE, fire: null, cmp: new Set() };
  ["SCU", "LNU", "CZU", "Creek Fire", "Glass Fire"].forEach((s) => {
    const f = fires.find((x) => x.short === s);
    if (f) S.cmp.add(f.id);
  });
  const reg = new Map(); // chart name -> fn(date)
  let tmTimer = null;

  function mk(sel, h, m) {
    const root = d3.select(sel);
    root.selectAll("*").remove();
    const W = FP.widthOf(root);
    const svg = root.append("svg").attr("viewBox", `0 0 ${W} ${h}`);
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
    return { root, svg, g, W, iw: W - m.left - m.right, ih: h - m.top - m.bottom };
  }

  function tipDay(date) {
    const r = rowAt(date);
    if (!r) return `<b>${fmtL(date)}</b>`;
    const fs = activeFires(date).map((f) => f.short).join(", ");
    return `<b>${fmtL(date)}</b><br>Bay median PM2.5: <b>${r.median != null ? r.median.toFixed(1) : "—"}</b>` +
      `<br>HMS smoke: ${densLabel[r.hms]}<br>Active fires: ${fs || "none"}`;
  }

  function fireTip(f) {
    return `<b>${f.name}</b><br>${fmt(f.start)} → ${fmt(f.end)} (${d3.timeDay.count(f.start, f.end) + 1} days)` +
      `<br>${d3.format(",")(f.acres)} acres<br>${f.counties}` +
      `<br>${f.bayHit ? "Burned in Bay Area counties" : "Outside Bay counties (regional smoke source)"}`;
  }

  function focusFire(f) {
    if (S.fire && S.fire.id === f.id) {
      S.fire = null;
      S.range = YEAR.slice();
    } else {
      S.fire = f;
      S.range = [
        d3.max([YEAR[0], d3.timeDay.offset(f.start, -7)]),
        d3.min([YEAR[1], d3.timeDay.offset(f.end, 7)])
      ];
    }
    redrawAll();
  }

  function setDate(d) {
    const day = d3.timeDay.floor(d);
    if (day < YEAR[0] || day > YEAR[1]) return;
    S.date = day;
    reg.forEach((fn) => fn(S.date));
    syncChrome();
  }

  function syncChrome() {
    const r = rowAt(S.date);
    d3.select("#sb-date").text(fmtL(S.date));
    d3.select("#sb-pm").text(r && r.median != null ? `${r.median.toFixed(1)} µg/m³` : "—");
    d3.select("#sb-hms").text(r ? densLabel[r.hms] : "—");
    d3.select("#sb-fires").text(activeFires(S.date).map((f) => f.short).join(", ") || "none");
    d3.select("#sb-fire").text(S.fire ? S.fire.short : "none");
    const full = +S.range[0] === +YEAR[0] && +S.range[1] === +YEAR[1];
    d3.select("#sb-range").text(full ? "full year" : `${fmt(S.range[0])} – ${fmt(S.range[1])}`);
    d3.select("#tm-slider").property("value", d3.timeDay.count(YEAR[0], S.date));
    d3.select("#tm-label").text(fmtL(S.date));
    window.dispatchEvent(new CustomEvent("tl-date", { detail: S.date }));
  }
  window.TL = { setDate: (d) => setDate(d), getDate: () => S.date };

  // ---------- 1. Line + fire lanes + HMS strip ----------
  function chart1() {
    const m = { top: 14, right: 20, bottom: 28, left: 46 };
    const pmH = 200, hmsH = 12, laneH = 17, gap = 8;
    const lanes = fires;
    const bodyH = pmH + gap + hmsH + gap + lanes.length * laneH;
    const { svg, g, iw } = mk("#v-lanes", m.top + bodyH + m.bottom, m);
    const x = d3.scaleTime().domain(S.range).range([0, iw]);
    const inR = joined.filter((d) => d.median != null && d.date >= S.range[0] && d.date <= S.range[1]);
    const y = d3.scaleLinear().domain([0, Math.max(50, d3.max(inR, (d) => d.median) * 1.1)]).nice().range([pmH, 0]);

    svg.append("defs").append("clipPath").attr("id", "clip1").append("rect").attr("width", iw).attr("height", bodyH);
    const plot = g.append("g").attr("clip-path", "url(#clip1)");

    if (S.fire) {
      plot.append("rect").attr("x", x(S.fire.start)).attr("width", Math.max(2, x(S.fire.end) - x(S.fire.start)))
        .attr("y", 0).attr("height", pmH).attr("fill", FIRE).attr("opacity", 0.1);
    }

    plot.append("path").datum(inR).attr("fill", "#c45c26").attr("opacity", 0.18)
      .attr("d", d3.area().curve(d3.curveMonotoneX).x((d) => x(d.date)).y0(pmH).y1((d) => y(d.median)));
    plot.append("path").datum(inR).attr("fill", "none").attr("stroke", "#c45c26").attr("stroke-width", 2)
      .attr("d", d3.line().curve(d3.curveMonotoneX).x((d) => x(d.date)).y((d) => y(d.median)));
    // dark red shading wherever the Bay median is above 35 (replaces one dot per high day)
    plot.append("path").datum(inR).attr("fill", "#7f1d1d").attr("opacity", 0.55)
      .attr("d", d3.area().curve(d3.curveMonotoneX).x((d) => x(d.date))
        .y0(y(35)).y1((d) => y(Math.max(35, d.median))));

    g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(35)).attr("y2", y(35))
      .attr("stroke", "#7f1d1d").attr("stroke-dasharray", "4,4").attr("opacity", 0.7);
    g.append("text").attr("x", 4).attr("y", y(35) - 4).attr("font-size", 10).attr("font-family", FONT).attr("fill", "#7f1d1d").text("35 µg/m³");

    // On-chart annotations for the story's two key days (only when that day is in the zoomed range)
    const ann = g.append("g").attr("pointer-events", "none").attr("font-family", FONT).attr("font-size", 10.5);
    const annotate = (iso, lines, side, labelY, dotFill) => {
      const d = parse(iso), r = joined.find((j) => +j.date === +d);
      if (!r || r.median == null || d < S.range[0] || d > S.range[1]) return;
      const px = x(d), py = y(r.median);
      const lx = side === "left" ? px - 14 : px + 14;
      const ly = Math.min(pmH - 30, Math.max(12, y(labelY)));
      ann.append("path").attr("d", `M${px},${py}L${lx + (side === "left" ? 4 : -4)},${ly - 4}`)
        .attr("stroke", "#444").attr("stroke-width", 0.8).attr("fill", "none");
      ann.append("circle").attr("cx", px).attr("cy", py).attr("r", 5).attr("fill", dotFill).attr("stroke", "#222").attr("stroke-width", 1.2);
      const t = ann.append("text").attr("x", lx).attr("y", ly).attr("text-anchor", side === "left" ? "end" : "start")
        .attr("stroke", "rgba(255,252,248,.92)").attr("stroke-width", 3).attr("paint-order", "stroke");
      lines.forEach((line, i) => t.append("tspan").attr("x", lx).attr("dy", i ? 13 : 0)
        .attr("font-weight", i ? 400 : 600).attr("fill", i ? "#444" : "#111").text(line));
    };
    annotate("2020-09-09", ["Sept. 9: orange sky", "heavy smoke overhead,", "Bay median only 28"], "left", 95, "#c45c26");
    annotate("2020-09-11", ["Sept. 11: the real peak", "Bay median 130 µg/m³"], "right", 128, "#c45c26");

    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5));
    g.append("text").attr("transform", "rotate(-90)").attr("x", -pmH / 2).attr("y", -34)
      .attr("text-anchor", "middle").attr("font-size", 11).attr("font-family", FONT).attr("fill", "#555").text("Bay median PM2.5 (µg/m³)");

    // HMS strip
    const days = d3.timeDay.count(S.range[0], S.range[1]) + 1;
    const cw = Math.max(1, iw / days);
    plot.selectAll("rect.hms").data(inR).join("rect").attr("class", "hms")
      .attr("x", (d) => x(d.date) - cw / 2).attr("width", cw + 0.3)
      .attr("y", pmH + gap).attr("height", hmsH).attr("fill", (d) => densColor[d.hms]);

    // fire lanes
    const laneY0 = pmH + gap + hmsH + gap;
    lanes.forEach((f, i) => {
      const x0 = x(f.start), x1 = x(f.end);
      const w = Math.max(2, x1 - x0);
      const ly = laneY0 + i * laneH;
      plot.append("rect").attr("x", x0).attr("y", ly).attr("width", w).attr("height", laneH - 4)
        .attr("fill", FIRE).attr("opacity", f.bayHit ? 0.9 : 0.35).attr("rx", 2)
        .attr("stroke", S.fire && S.fire.id === f.id ? "#111" : "none").attr("stroke-width", 2)
        .style("cursor", "pointer")
        .on("mousemove", (event) => FP.showTip(event, fireTip(f)))
        .on("mouseleave", () => FP.hideTip())
        .on("click", () => focusFire(f));
      const label = `${f.short} · ${fmtAcres(f.acres)} acres`;
      const inside = w > 120;
      plot.append("text").attr("x", inside ? x0 + 5 : Math.min(iw - 4, x1 + 5)).attr("y", ly + laneH - 8)
        .attr("text-anchor", !inside && x1 + 5 > iw - 4 ? "end" : "start")
        .attr("font-size", 10).attr("font-family", FONT).attr("pointer-events", "none")
        .attr("fill", inside && f.bayHit ? "#fff" : "#1f2937").text(label);
    });

    g.append("g").attr("class", "axis").attr("transform", `translate(0,${bodyH})`).call(d3.axisBottom(x).ticks(8));

    const hover = g.append("line").attr("y1", 0).attr("y2", pmH).attr("stroke", "#555").attr("stroke-dasharray", "2,3").style("display", "none");
    const sel = g.append("line").attr("y1", 0).attr("y2", bodyH).attr("stroke", "#111").attr("stroke-width", 1.5).style("display", "none");
    reg.set("c1", (d) => {
      const inside = d >= S.range[0] && d <= S.range[1];
      sel.style("display", inside ? null : "none").attr("x1", x(d)).attr("x2", x(d));
    });

    const brush = d3.brushX().extent([[0, 0], [iw, pmH]]).on("end", (event) => {
      if (!event.sourceEvent) return;
      if (!event.selection) {
        const px = d3.pointer(event.sourceEvent, g.node())[0];
        setDate(x.invert(px));
        return;
      }
      S.range = event.selection.map(x.invert).map((d) => d3.timeDay.round(d));
      S.fire = null;
      redrawAll();
    });
    g.append("g").attr("class", "brush").call(brush)
      .select(".overlay")
      .on("mousemove.tip", (event) => {
        const px = d3.pointer(event, g.node())[0];
        hover.style("display", null).attr("x1", px).attr("x2", px);
        FP.showTip(event, tipDay(x.invert(px)));
      })
      .on("mouseleave.tip", () => { hover.style("display", "none"); FP.hideTip(); });
  }

  // ---------- 2. Calendar heatmap ----------
  function chart2() {
    // The calendar always shows the same window as chart 1 (S.range), so zooming
    // or focusing a fire in chart 1 redraws this chart too.
    const win = S.range;
    const root0 = d3.select("#v-cal");
    const W0 = FP.widthOf(root0);
    const m = { top: 30, right: 12, bottom: 24, left: 34 };
    const start = d3.timeSunday.floor(win[0]);
    const nCols = d3.timeSunday.count(start, win[1]) + 1;
    const cell = Math.max(10, Math.min(40, Math.floor((W0 - m.left - m.right) / nCols)));
    const H = m.top + 7 * cell + m.bottom;
    const { svg, g } = mk("#v-cal", H, m);
    const daysList = d3.timeDay.range(win[0], d3.timeDay.offset(win[1], 1));
    const colOf = (d) => d3.timeSunday.count(start, d);

    "SMTWTFS".split("").forEach((l, i) => {
      g.append("text").attr("x", -8).attr("y", i * cell + cell / 2 + 3).attr("text-anchor", "end")
        .attr("font-size", 10).attr("font-family", FONT).attr("fill", "#777").text(l);
    });
    const monthLabels = d3.timeMonth.range(d3.timeMonth.floor(win[0]), d3.timeDay.offset(win[1], 1))
      .map((mo) => ({ mo, col: colOf(mo < win[0] ? win[0] : mo) }));
    monthLabels.forEach((o, i) => {
      const next = monthLabels[i + 1];
      if (next && next.col - o.col < 3) return; // avoid overlapping labels
      g.append("text").attr("x", o.col * cell).attr("y", -10)
        .attr("font-size", 11).attr("font-family", FONT).attr("fill", "#333").text(d3.timeFormat("%B")(o.mo));
    });

    const cells = g.selectAll("g.cell").data(daysList).join("g").attr("class", "cell")
      .attr("transform", (d) => `translate(${d3.timeSunday.count(start, d) * cell},${d.getDay() * cell})`)
      .style("cursor", "pointer")
      .on("mousemove", (event, d) => FP.showTip(event, tipDay(d)))
      .on("mouseleave", () => FP.hideTip())
      .on("click", (event, d) => setDate(d));
    cells.append("rect").attr("class", "bg").attr("width", cell - 2).attr("height", cell - 2).attr("rx", 3)
      .attr("fill", (d) => { const r = rowAt(d); return r && r.median != null ? pmScale(r.median) : "#e5e1da"; });
    if (cell >= 22) { // day numbers only when cells are big enough to read
      cells.append("text").attr("x", 4).attr("y", 12).attr("font-size", 9).attr("font-family", FONT)
        .attr("fill", (d) => { const r = rowAt(d); return r && r.median > 70 ? "#fff" : "#444"; })
        .attr("pointer-events", "none").text((d) => d.getDate());
    }

    d3.select("#v-cal").append("div").attr("class", "hint").style("margin", "6px 0 0")
      .text(`Showing ${fmt(win[0])} – ${fmt(win[1])}. Follows the zoom and focused fire in chart 1.`);

    // legend
    const lg = svg.append("g").attr("transform", `translate(${m.left},${H - 12})`);
    d3.range(0, 131, 10).forEach((v, i) => {
      lg.append("rect").attr("x", i * 22).attr("width", 22).attr("height", 7).attr("fill", pmScale(v));
    });
    lg.append("text").attr("x", 0).attr("y", -3).attr("font-size", 9).attr("font-family", FONT).attr("fill", "#666").text("0");
    lg.append("text").attr("x", 14 * 22).attr("y", -3).attr("font-size", 9).attr("font-family", FONT).attr("fill", "#666").text("130+ µg/m³");

    reg.set("c2", (d) => {
      cells.select("rect.bg")
        .attr("stroke", (c) => {
          if (+c === +d) return "#111";
          if (S.fire && c >= S.fire.start && c <= S.fire.end) return fireColor(S.fire.id);
          return "none";
        })
        .attr("stroke-width", (c) => (+c === +d ? 3 : 2))
        .attr("opacity", (c) => (S.fire && !(c >= S.fire.start && c <= S.fire.end) ? 0.35 : 1));
    });
  }

  // ---------- 3. Event-aligned ----------
  function chart3() {
    const chips = d3.select("#c-chips");
    chips.selectAll("*").remove();
    chips.selectAll("button").data(fires.filter((f) => f.acres >= 4000)).join("button")
      .attr("class", "chip").attr("type", "button")
      .classed("on", (f) => S.cmp.has(f.id))
      .style("border-color", (f) => fireColor(f.id))
      .style("background", (f) => (S.cmp.has(f.id) ? fireColor(f.id) : "#fff"))
      .style("color", (f) => (S.cmp.has(f.id) ? "#fff" : "#222"))
      .text((f) => f.short)
      .on("click", (event, f) => {
        if (S.cmp.has(f.id) && S.cmp.size > 1) S.cmp.delete(f.id); else S.cmp.add(f.id);
        chart3();
        reg.get("c3")(S.date);
      });

    const m = { top: 18, right: 20, bottom: 40, left: 46 };
    const { g, iw, ih } = mk("#v-aligned", 330, m);
    const lo = -14, hi = 60;
    const sel = fires.filter((f) => S.cmp.has(f.id));
    const series = sel.map((f) => ({
      f,
      pts: d3.timeDay.range(d3.timeDay.offset(f.start, lo), d3.timeDay.offset(f.start, hi + 1))
        .map((d) => ({ off: d3.timeDay.count(f.start, d), date: d, r: rowAt(d) }))
        .filter((p) => p.r && p.r.median != null)
    }));
    const x = d3.scaleLinear().domain([lo, hi]).range([0, iw]);
    const ymax = Math.max(50, d3.max(series, (s) => d3.max(s.pts, (p) => p.r.median)) * 1.08);
    const y = d3.scaleLinear().domain([0, ymax]).nice().range([ih, 0]);

    g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(10));
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6));
    g.append("text").attr("x", iw / 2).attr("y", ih + 34).attr("text-anchor", "middle").attr("font-size", 11).attr("font-family", FONT).attr("fill", "#555").text("Days since fire start");
    g.append("text").attr("transform", "rotate(-90)").attr("x", -ih / 2).attr("y", -34).attr("text-anchor", "middle").attr("font-size", 11).attr("font-family", FONT).attr("fill", "#555").text("Bay median PM2.5 (µg/m³)");

    g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", ih).attr("stroke", "#111").attr("stroke-width", 1);
    g.append("text").attr("x", x(0) + 4).attr("y", 10).attr("font-size", 10).attr("font-family", FONT).text("fire start");
    g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(35)).attr("y2", y(35)).attr("stroke", "#7f1d1d").attr("stroke-dasharray", "4,4").attr("opacity", 0.7);
    g.append("text").attr("x", iw - 2).attr("y", y(35) - 4).attr("text-anchor", "end").attr("font-size", 10).attr("font-family", FONT).attr("fill", "#7f1d1d").text("35 µg/m³");

    const line = d3.line().curve(d3.curveMonotoneX).x((p) => x(p.off)).y((p) => y(p.r.median));
    series.forEach((s) => {
      const focused = S.fire && S.fire.id === s.f.id;
      g.append("path").datum(s.pts).attr("fill", "none").attr("stroke", fireColor(s.f.id))
        .attr("stroke-width", focused ? 3.4 : 2).attr("opacity", S.fire && !focused ? 0.35 : 1)
        .attr("d", line).style("cursor", "pointer")
        .on("mousemove", (event) => FP.showTip(event, fireTip(s.f)))
        .on("mouseleave", () => FP.hideTip())
        .on("click", () => focusFire(s.f));
      const peak = s.pts.reduce((a, b) => (b.r.median > a.r.median ? b : a));
      g.append("circle").attr("cx", x(peak.off)).attr("cy", y(peak.r.median)).attr("r", 4.5)
        .attr("fill", fireColor(s.f.id)).attr("stroke", "#fff").attr("stroke-width", 1.2)
        .on("mousemove", (event) => FP.showTip(event, `<b>${s.f.short}</b> peak<br>${peak.r.median.toFixed(1)} µg/m³ on ${fmtL(peak.date)}<br>day +${peak.off}`))
        .on("mouseleave", () => FP.hideTip());
    });

    const rule = g.append("line").attr("y1", 0).attr("y2", ih).attr("stroke", "#555").attr("stroke-dasharray", "2,3").style("display", "none");
    g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "transparent").lower()
      .on("mousemove", function (event) {
        const off = Math.round(x.invert(d3.pointer(event, this)[0]));
        rule.style("display", null).attr("x1", x(off)).attr("x2", x(off));
        const rows = series.map((s) => {
          const p = s.pts.find((q) => q.off === off);
          return p ? `<div><span style="color:${fireColor(s.f.id)}">●</span> ${s.f.short}: <b>${p.r.median.toFixed(1)}</b> (${fmt(p.date)})</div>` : "";
        }).join("");
        FP.showTip(event, `<b>Day ${off >= 0 ? "+" : ""}${off}</b>${rows}`);
      })
      .on("mouseleave", () => { rule.style("display", "none"); FP.hideTip(); });

    const marks = g.append("g");
    reg.set("c3", (d) => {
      const pts = series.map((s) => {
        const off = d3.timeDay.count(s.f.start, d);
        const p = s.pts.find((q) => q.off === off);
        return p ? { s, p } : null;
      }).filter(Boolean);
      marks.selectAll("circle").data(pts, (q) => q.s.f.id).join("circle")
        .attr("cx", (q) => x(q.p.off)).attr("cy", (q) => y(q.p.r.median)).attr("r", 6)
        .attr("fill", "none").attr("stroke", "#111").attr("stroke-width", 2).attr("pointer-events", "none");
    });
  }

  // ---------- 4. County horizon ----------
  function chart4() {
    const rowH = 28;
    const m = { top: 22, right: 20, bottom: 28, left: 100 };
    const H = m.top + counties.length * rowH + m.bottom;
    const { g, iw } = mk("#v-horizon", H, m);
    const x = d3.scaleTime().domain(S.range).range([0, iw]);
    const step = 15, bands = 4;
    const bandColors = ["#fdd49e", "#fc8d59", "#d7301f", "#7f0000"];

    d3.select("#legend-horizon").selectAll("*").remove();
    bandColors.forEach((c, i) => {
      d3.select("#legend-horizon").append("span").html(`<i style="background:${c}"></i>${i * step}–${(i + 1) * step}${i === bands - 1 ? "+" : ""} µg/m³`);
    });

    fires.filter((f) => f.acres >= 50000).forEach((f, i) => {
      const x0 = Math.max(0, x(f.start)), x1 = Math.min(iw, x(f.end));
      if (x1 <= 0 || x0 >= iw) return;
      g.append("rect").attr("x", x0).attr("width", Math.max(2, x1 - x0)).attr("y", 0).attr("height", counties.length * rowH)
        .attr("fill", fireColor(f.id)).attr("opacity", 0.1).style("cursor", "pointer")
        .on("mousemove", (event) => FP.showTip(event, fireTip(f)))
        .on("mouseleave", () => FP.hideTip())
        .on("click", () => focusFire(f));
      g.append("text").attr("x", x0 + 3).attr("y", -6 - (i % 2) * 0).attr("font-size", 10).attr("font-family", FONT)
        .attr("fill", "#444").attr("pointer-events", "none").text(f.short);
    });

    counties.forEach((c, i) => {
      const row = g.append("g").attr("transform", `translate(0,${i * rowH})`);
      const vals = byCounty.get(c).filter((d) => d.date >= S.range[0] && d.date <= S.range[1]).sort((a, b) => a.date - b.date);
      row.append("rect").attr("width", iw).attr("height", rowH - 2).attr("fill", "#f7f4ee");
      bandColors.forEach((col, k) => {
        row.append("path").datum(vals).attr("fill", col)
          .attr("d", d3.area().x((d) => x(d.date)).y0(rowH - 2)
            .y1((d) => rowH - 2 - (rowH - 2) * Math.max(0, Math.min(1, (d.pm25 - k * step) / step))));
      });
      row.append("text").attr("x", -8).attr("y", rowH / 2 + 2).attr("text-anchor", "end")
        .attr("font-size", 11).attr("font-family", FONT).attr("fill", "#333").text(c);
    });

    g.append("g").attr("class", "axis").attr("transform", `translate(0,${counties.length * rowH})`).call(d3.axisBottom(x).ticks(8));

    const hover = g.append("line").attr("y1", 0).attr("y2", counties.length * rowH).attr("stroke", "#555").attr("stroke-dasharray", "2,3").style("display", "none");
    const sel = g.append("line").attr("y1", 0).attr("y2", counties.length * rowH).attr("stroke", "#111").attr("stroke-width", 1.5).style("display", "none");
    reg.set("c4", (d) => {
      const inside = d >= S.range[0] && d <= S.range[1];
      sel.style("display", inside ? null : "none").attr("x1", x(d)).attr("x2", x(d));
    });
    const brush = d3.brushX().extent([[0, 0], [iw, counties.length * rowH]]).on("end", (event) => {
      if (!event.sourceEvent) return;
      if (!event.selection) {
        setDate(x.invert(d3.pointer(event.sourceEvent, g.node())[0]));
        return;
      }
      S.range = event.selection.map(x.invert).map((d) => d3.timeDay.round(d));
      S.fire = null;
      redrawAll();
    });
    g.append("g").attr("class", "brush").call(brush)
      .select(".overlay")
      .style("cursor", "crosshair")
      .on("mousemove.tip", (event) => {
        const px = d3.pointer(event, g.node())[0];
        const day = d3.timeDay.round(x.invert(px));
        hover.style("display", null).attr("x1", px).attr("x2", px);
        const rows = counties.map((c) => ({ c, v: countyAt.get(c).get(+day) }))
          .filter((o) => o.v != null).sort((a, b) => b.v - a.v)
          .map((o) => `<div>${o.c}: <b>${o.v.toFixed(1)}</b></div>`).join("");
        FP.showTip(event, `<b>${fmtL(day)}</b>${rows}`);
      })
      .on("mouseleave.tip", () => { hover.style("display", "none"); FP.hideTip(); });
  }

  // ---------- 5. Radial year ----------
  function chart5() {
    const root = d3.select("#v-radial");
    root.selectAll("*").remove();
    const W = Math.min(FP.widthOf(root), 640);
    const cx = W / 2, cy = W / 2;
    const svg = root.append("svg").attr("viewBox", `0 0 ${W} ${W}`).style("max-width", "640px").style("margin", "0 auto");
    const g = svg.append("g").attr("transform", `translate(${cx},${cy})`);
    const R0 = W * 0.11, Rmax = W * 0.22, outer = W / 2 - 8;
    const base = R0 + Rmax + 12;
    const step = Math.min(9, (outer - base) / fires.length);
    const len = d3.scaleSqrt().domain([0, 150]).range([2, Rmax]).clamp(true);
    const ang = (d) => (d3.timeDay.count(YEAR[0], d) / nDays) * 2 * Math.PI;
    const dw = (2 * Math.PI) / nDays;

    const ring = g.append("circle").attr("r", R0 + len(35)).attr("fill", "none").attr("stroke", "#7f1d1d").attr("stroke-dasharray", "3,3").attr("opacity", 0.6);
    g.append("circle").attr("r", R0).attr("fill", "none").attr("stroke", "#cfc9bf");

    const arc = d3.arc();
    const bars = g.selectAll("path.day").data(joined.filter((d) => d.median != null)).join("path").attr("class", "day")
      .attr("d", (d) => arc({ innerRadius: R0, outerRadius: R0 + len(d.median), startAngle: ang(d.date), endAngle: ang(d.date) + dw * 0.9 }))
      .attr("fill", (d) => pmScale(d.median))
      .attr("opacity", (d) => (d.date >= S.range[0] && d.date <= S.range[1] ? 1 : 0.22))
      .style("cursor", "pointer")
      .on("mousemove", (event, d) => FP.showTip(event, tipDay(d.date)))
      .on("mouseleave", () => FP.hideTip())
      .on("click", (event, d) => setDate(d.date));

    d3.range(12).forEach((i) => {
      const mo = new Date(2020, i, 1);
      const a = ang(mo) + (Math.PI / 12);
      const r = R0 - 12;
      g.append("text").attr("x", r * Math.sin(a)).attr("y", -r * Math.cos(a) + 3).attr("text-anchor", "middle")
        .attr("font-size", 10).attr("font-family", FONT).attr("fill", "#666").text(d3.timeFormat("%b")(mo));
      g.append("line").attr("x1", (R0 - 3) * Math.sin(ang(mo))).attr("y1", -(R0 - 3) * Math.cos(ang(mo)))
        .attr("x2", (R0 + 3) * Math.sin(ang(mo))).attr("y2", -(R0 + 3) * Math.cos(ang(mo))).attr("stroke", "#999");
    });

    fires.forEach((f, i) => {
      const ir = base + i * step;
      g.append("path")
        .attr("d", arc({ innerRadius: ir, outerRadius: ir + step - 2, startAngle: ang(f.start), endAngle: ang(f.end) + dw }))
        .attr("fill", fireColor(f.id)).attr("opacity", S.fire && S.fire.id !== f.id ? 0.3 : (f.bayHit ? 0.95 : 0.6))
        .attr("stroke", S.fire && S.fire.id === f.id ? "#111" : "none").style("cursor", "pointer")
        .on("mousemove", (event) => FP.showTip(event, fireTip(f)))
        .on("mouseleave", () => FP.hideTip())
        .on("click", () => focusFire(f));
    });

    const cDate = g.append("text").attr("text-anchor", "middle").attr("y", -4).attr("font-size", 12).attr("font-family", FONT).attr("font-weight", 600).attr("fill", "#222");
    const cPm = g.append("text").attr("text-anchor", "middle").attr("y", 12).attr("font-size", 11).attr("font-family", FONT).attr("fill", "#666");
    reg.set("c5", (d) => {
      bars.attr("stroke", (b) => (+b.date === +d ? "#111" : "none")).attr("stroke-width", 1.5);
      const r = rowAt(d);
      cDate.text(fmt(d));
      cPm.text(r && r.median != null ? `${r.median.toFixed(0)} µg/m³` : "");
    });
  }

  // ---------- 6. Time machine ----------
  // Race bars are neutral until a reader picks counties; picked counties keep their own color.
  const RACE_NEUTRAL = "#cfc8bc";
  let racePaint = null;
  function chart6() {
    const rowH = 26;
    const m = { top: 8, right: 170, bottom: 14, left: 100 };
    const H = m.top + counties.length * rowH + m.bottom;
    const { g, iw } = mk("#v-race", H, m);
    const maxFinal = d3.max(counties, (c) => cum.get(c)[nDays - 1].e);
    const x = d3.scaleLinear().domain([0, maxFinal]).range([0, iw]);
    const y = d3.scaleBand().domain(counties).range([0, counties.length * rowH]).padding(0.18);
    let rank = new Map(counties.map((c, i) => [c, i + 1]));

    // full-width transparent rows make the whole line clickable, not just the bar
    const hits = g.selectAll("rect.hit").data(counties, (c) => c).join("rect").attr("class", "hit")
      .attr("x", -m.left).attr("width", iw + m.left + m.right).attr("height", y.step())
      .attr("y", (c) => y(c) - (y.step() - y.bandwidth()) / 2).attr("fill", "transparent").style("cursor", "pointer")
      .on("click", (event, c) => FP.toggleCounty(c));
    const bars = g.selectAll("rect.bar").data(counties, (c) => c).join("rect").attr("class", "bar")
      .attr("x", 0).attr("height", y.bandwidth()).attr("y", (c) => y(c)).attr("width", 0)
      .style("cursor", "pointer")
      .on("click", (event, c) => FP.toggleCounty(c))
      .on("mousemove", (event, c) => {
        const o = cum.get(c)[d3.timeDay.count(YEAR[0], S.date)];
        FP.showTip(event, `<b>${c}</b> · #${rank.get(c)} of ${counties.length}<br>Total above background: ${d3.format(",")(Math.round(o.e))}<br>Unhealthy days (35+): ${o.s}<br><span style="opacity:.7">Click to ${FP.sel.has(c) ? "unfollow" : "follow"}</span>`);
      })
      .on("mouseleave", () => FP.hideTip());
    const names = g.selectAll("text.n").data(counties, (c) => c).join("text").attr("class", "n")
      .attr("x", -8).attr("text-anchor", "end").attr("font-size", 11).attr("font-family", FONT)
      .attr("y", (c) => y(c) + y.bandwidth() / 2 + 4).style("cursor", "pointer").text((c) => c)
      .on("click", (event, c) => FP.toggleCounty(c));
    const vals = g.selectAll("text.v").data(counties, (c) => c).join("text").attr("class", "v")
      .attr("font-size", 10).attr("font-family", FONT).attr("y", (c) => y(c) + y.bandwidth() / 2 + 4)
      .style("pointer-events", "none");
    // story annotation inside the Santa Cruz bar once the CZU fire has started
    const CZU_START = parse("2020-08-16");
    const czu = g.append("text").attr("font-size", 10).attr("font-family", FONT).attr("font-style", "italic")
      .attr("fill", "#222").style("pointer-events", "none").text("CZU fire ignites in the county Aug. 16");

    let lastIdx = d3.timeDay.count(YEAR[0], S.date);
    const valText = (c) => {
      const o = cum.get(c)[lastIdx];
      return `${FP.sel.has(c) ? "#" + rank.get(c) + " · " : ""}${d3.format(",")(Math.round(o.e))} · ${o.s} unhealthy ${o.s === 1 ? "day" : "days"}`;
    };
    racePaint = () => {
      const any = FP.sel.size > 0;
      bars.attr("fill", (c) => (!any || FP.sel.has(c) ? (any ? countyColor(c) : RACE_NEUTRAL) : RACE_NEUTRAL))
        .attr("opacity", (c) => (FP.isDimmed(c) ? 0.55 : 1))
        .attr("stroke", (c) => (FP.sel.has(c) ? "#222" : "none")).attr("stroke-width", 1);
      names.attr("font-weight", (c) => (FP.sel.has(c) ? 700 : 400)).attr("fill", (c) => (FP.isDimmed(c) ? "#999" : "#222"));
      vals.attr("font-weight", (c) => (FP.sel.has(c) ? 700 : 400)).attr("fill", (c) => (FP.isDimmed(c) ? "#aaa" : "#333")).text(valText);
      d3.select("#race-clear").style("display", any ? null : "none");
    };
    racePaint();

    reg.set("c6", (d) => {
      const idx = d3.timeDay.count(YEAR[0], d);
      lastIdx = idx;
      const order = counties.slice().sort((a, b) => cum.get(b)[idx].e - cum.get(a)[idx].e);
      rank = new Map(order.map((c, i) => [c, i + 1]));
      y.domain(order);
      const t = d3.transition().duration(tmTimer ? 90 : 250).ease(d3.easeLinear);
      hits.transition(t).attr("y", (c) => y(c) - (y.step() - y.bandwidth()) / 2);
      bars.transition(t).attr("y", (c) => y(c)).attr("width", (c) => x(cum.get(c)[idx].e));
      names.transition(t).attr("y", (c) => y(c) + y.bandwidth() / 2 + 4);
      vals.transition(t).attr("y", (c) => y(c) + y.bandwidth() / 2 + 4)
        .attr("x", (c) => x(cum.get(c)[idx].e) + 6);
      vals.text(valText);
      const showCzu = d >= CZU_START && x(cum.get("Santa Cruz")[idx].e) > 230;
      czu.style("display", showCzu ? null : "none")
        .transition(t).attr("x", 8).attr("y", y("Santa Cruz") + y.bandwidth() / 2 + 4);
    });
  }
  FP.onCounties(() => { if (racePaint) racePaint(); });
  d3.select("#race-clear").on("click", () => FP.clearCounties());

  // Charts are split across pages: timeline.html (1,2,3,5) and counties.html (4,6).
  // Each page only renders the charts whose container exists.
  const CHARTS = [
    ["#v-lanes", chart1], ["#v-cal", chart2], ["#v-aligned", chart3],
    ["#v-horizon", chart4], ["#v-radial", chart5], ["#v-race", chart6]
  ];

  function redrawAll() {
    reg.clear();
    CHARTS.forEach(([sel, fn]) => { if (document.querySelector(sel)) fn(); });
    reg.forEach((fn) => fn(S.date));
    syncChrome();
  }

  // legends / chrome wiring
  const lh = d3.select("#legend-hms");
  if (!lh.empty()) {
    lh.append("span").html(`<i style="background:#7f1d1d;opacity:.6"></i>Line above 35 µg/m³ (unhealthy)`);
    lh.append("span").style("color", "#555").style("margin-left", "14px").text("Smoke strip:");
    densLabel.forEach((l, i) => lh.append("span").html(`<i style="background:${densColor[i]}"></i>${l}`));
    lh.append("span").style("color", "#555").style("margin-left", "14px").text("Fires:");
    lh.append("span").html(`<i style="background:${FIRE};opacity:.9"></i>Inside the Bay Area`);
    lh.append("span").html(`<i style="background:${FIRE};opacity:.35"></i>Outside the Bay Area`);
  }

  d3.select("#sb-reset").on("click", () => {
    S.range = YEAR.slice();
    S.fire = null;
    S.date = DEFAULT_DATE;
    redrawAll();
  });

  d3.select("#tm-slider").on("input", function () {
    setDate(d3.timeDay.offset(YEAR[0], +this.value));
  });
  d3.select("#tm-play").on("click", function () {
    if (tmTimer) {
      clearInterval(tmTimer); tmTimer = null; d3.select(this).text("Play year"); return;
    }
    if (+S.date >= +YEAR[1]) S.date = YEAR[0];
    d3.select(this).text("Pause");
    tmTimer = setInterval(() => {
      if (+S.date >= +YEAR[1]) {
        clearInterval(tmTimer); tmTimer = null; d3.select("#tm-play").text("Play year"); return;
      }
      setDate(d3.timeDay.offset(S.date, 1));
    }, 110);
  });

  redrawAll();
  window.addEventListener("resize", () => {
    clearTimeout(window.__tlResize);
    window.__tlResize = setTimeout(redrawAll, 250);
  });
})().catch((err) => {
  console.error(err);
  alert("Timeline failed to load. Check the console and that you are running a local server.");
});
