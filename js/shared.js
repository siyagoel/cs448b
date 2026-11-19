/* Shared UI helpers for all draft explainers */
window.FP = {
  tooltip: null,
  ensureTooltip() {
    if (!this.tooltip) {
      this.tooltip = d3.select("body").append("div").attr("class", "tooltip");
    }
    return this.tooltip;
  },
  showTip(event, html) {
    const tip = this.ensureTooltip();
    tip.html(html).classed("show", true)
      .style("left", event.clientX + "px")
      .style("top", event.clientY + "px");
  },
  moveTip(event) {
    if (!this.tooltip) return;
    this.tooltip.style("left", event.clientX + "px").style("top", event.clientY + "px");
  },
  hideTip() {
    if (this.tooltip) this.tooltip.classed("show", false);
  },
  widthOf(sel) {
    const n = sel && sel.node && sel.node();
    return Math.max(260, (n && n.clientWidth) || 900);
  }
};

/* Shared county selection, so a county clicked in one chart is highlighted in the others.
   FP.sel is a Set of county names; charts subscribe with FP.onCounties(fn). */
FP.sel = new Set();
FP._selSubs = [];
FP.onCounties = function (fn) { this._selSubs.push(fn); };
FP._notifyCounties = function () { this._selSubs.forEach((fn) => fn(this.sel)); };
FP.toggleCounty = function (c) {
  if (this.sel.has(c)) this.sel.delete(c); else this.sel.add(c);
  this._notifyCounties();
};
FP.clearCounties = function () { this.sel.clear(); this._notifyCounties(); };
FP.isDimmed = function (c) { return this.sel.size > 0 && !this.sel.has(c); };
