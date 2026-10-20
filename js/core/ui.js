/* Throughline — shared UI helpers (window.UI). Modules build HTML strings with these,
 * mount them with root.innerHTML, then wire events with UI.on / addEventListener. */
(function () {
  "use strict";
  const UI = (window.UI = window.UI || {});

  // ---------- strings & formatting ----------
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  UI.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);

  const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  UI.fmt = {
    num: (v) => nf0.format(v || 0),
    dec: (v, d = 1) => new Intl.NumberFormat("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }).format(v || 0),
    /** 0.4231 → "42.3%" (digits default 1) */
    pct: (v, d = 1) => (v == null || isNaN(v) ? "—" : (v * 100).toFixed(d) + "%"),
    /** percentage-point delta: 0.012 → "+1.2 pts" */
    pts: (v, d = 1) => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(d) + " pts",
    money: (v) => (v < 0 ? "−$" : "$") + nf0.format(Math.abs(v || 0)),
    /** compact money: 1250000 → "$1.25M", 48200 → "$48.2K" */
    moneyK: (v) => {
      const a = Math.abs(v || 0), s = v < 0 ? "−$" : "$";
      if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
      if (a >= 1e3) return s + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "K";
      return s + nf0.format(a);
    },
    compact: (v) => {
      const a = Math.abs(v || 0);
      if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
      if (a >= 1e4) return (v / 1e3).toFixed(0) + "K";
      if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
      return nf0.format(v || 0);
    },
    hrs: (v) => nf0.format(v || 0) + " hrs",
    /** seconds → "7:48" */
    mmss: (sec) => { sec = Math.round(sec || 0); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); },
    signed: (v, d = 0) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d),
    date: (iso) => new Date(iso + (iso.length === 10 ? "T12:00:00Z" : "")).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
  UI.nf1 = nf1;

  // ---------- DOM ----------
  UI.$ = (sel, root) => (root || document).querySelector(sel);
  UI.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  /** delegated listener: UI.on(root, "click", "[data-act]", (e, el) => ...) */
  UI.on = (root, type, selector, fn) => {
    root.addEventListener(type, (e) => {
      const el = e.target.closest(selector);
      if (el && root.contains(el)) fn(e, el);
    });
  };
  /** inject a <style> once per id (module-scoped CSS; use tokens, prefix classes with the module id) */
  UI.style = (id, css) => {
    if (document.getElementById("style-" + id)) return;
    const s = document.createElement("style");
    s.id = "style-" + id;
    s.textContent = css;
    document.head.appendChild(s);
  };

  // ---------- storage (per-viewer conveniences; never required) ----------
  UI.store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("throughline." + key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("throughline." + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
    remove(key) { try { localStorage.removeItem("throughline." + key); } catch (e) { /* ignore */ } },
  };

  // ---------- components (return HTML strings) ----------
  /**
   * KPI tile.
   * opts: { label, value, unit?, delta? (number), deltaLabel? (string, e.g. "+1.2 pts"),
   *         goodWhen?: "up"|"down" (default "up"), foot? (string), id? (for a sparkline canvas) }
   */
  UI.kpi = (o) => {
    let deltaHtml = "";
    if (o.delta != null && !isNaN(o.delta)) {
      const up = o.delta > 0, flat = Math.abs(o.delta) < 1e-9;
      const good = (o.goodWhen || "up") === "up" ? up : !up;
      const cls = flat ? "flat" : (up ? "up-" : "down-") + (good ? "good" : "bad");
      deltaHtml = `<span class="delta ${cls}" title="${good ? "Improving" : "Worsening"}">${flat ? "■" : up ? "▲" : "▼"} ${UI.esc(o.deltaLabel || UI.fmt.signed(o.delta, 1))}</span>`;
    }
    return `<div class="kpi">
      <div class="kpi-label">${UI.esc(o.label)}</div>
      <div class="kpi-value">${UI.esc(o.value)}${o.unit ? `<small>${UI.esc(o.unit)}</small>` : ""}</div>
      ${o.id ? `<div class="kpi-spark"><canvas id="${UI.esc(o.id)}" aria-hidden="true"></canvas></div>` : ""}
      <div class="kpi-foot">${deltaHtml}<span>${UI.esc(o.foot || "")}</span></div>
    </div>`;
  };

  /** status pill: level = good | warning | serious | critical | neutral | accent */
  UI.pill = (level, text) => `<span class="pill ${level}">${UI.esc(text)}</span>`;
  UI.tag = (text) => `<span class="tag">${UI.esc(text)}</span>`;

  /**
   * table: columns = [{ key, label, num?: bool, fmt?: (v,row)=>string (HTML, you escape), width? }]
   */
  UI.table = (columns, rows, opts = {}) => {
    const head = columns.map((c) => `<th class="${c.num ? "num" : ""}"${c.width ? ` style="width:${c.width}"` : ""}>${UI.esc(c.label)}</th>`).join("");
    const body = rows.map((r) => `<tr${opts.rowAttr ? " " + opts.rowAttr(r) : ""}>${columns.map((c) => `<td class="${c.num ? "num" : ""}">${c.fmt ? c.fmt(r[c.key], r) : UI.esc(r[c.key])}</td>`).join("")}</tr>`).join("");
    return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  };

  /** range control with live <output>. Returns HTML; read value via input#id */
  UI.range = (o) => `<div class="range-row">
      <label for="${o.id}">${UI.esc(o.label)}</label>
      <output for="${o.id}" id="${o.id}-out">${UI.esc(o.display != null ? o.display : o.value)}</output>
      <input type="range" id="${o.id}" min="${o.min}" max="${o.max}" step="${o.step || 1}" value="${o.value}">
    </div>`;

  /** segmented control: options = [{value,label}] ; read selection via data-value on aria-pressed button */
  UI.seg = (id, options, value) => `<div class="seg" id="${id}" role="group">${options.map((o) => `<button type="button" data-value="${UI.esc(o.value)}" aria-pressed="${o.value === value}">${UI.esc(o.label)}</button>`).join("")}</div>`;
  /** wire a segmented control; fn(value) */
  UI.wireSeg = (root, id, fn) => {
    const el = root.querySelector("#" + id);
    if (!el) return;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-value]");
      if (!b) return;
      el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      fn(b.dataset.value);
    });
  };

  UI.select = (id, options, value, label) => `<label class="field" for="${id}"><span>${UI.esc(label || "")}</span><select class="select" id="${id}">${options.map((o) => `<option value="${UI.esc(o.value)}"${o.value === value ? " selected" : ""}>${UI.esc(o.label)}</option>`).join("")}</select></label>`;

  /** SVG icon set (stroke icons, 24 viewBox). UI.icon("spark") */
  const ICONS = {
    home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
    gauge: "M12 14l4-4M3.5 17a9 9 0 1 1 17 0",
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
    flow: "M4 6h6v4H4zM14 14h6v4h-6zM7 10v4a2 2 0 0 0 2 2h5M17 14v-4a2 2 0 0 0-2-2h-5",
    list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
    dollar: "M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.6 5 3.5 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3",
    spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
    calendar: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4",
    users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6",
    doc: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7",
    chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
    flag: "M5 21V4M5 4h11l-2 4 2 4H5",
    copy: "M9 9h11v11H9zM5 15H4V4h11v1",
    check: "M5 12l5 5L20 7",
    plus: "M12 5v14M5 12h14",
    x: "M6 6l12 12M18 6L6 18",
    play: "M7 4l13 8-13 8z",
    arrow: "M5 12h14M13 6l6 6-6 6",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
    target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
    route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8",
    book: "M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h8",
    trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  };
  UI.icon = (name, cls) => `<svg class="${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ICONS.spark}"/></svg>`;
  UI.icons = ICONS;

  // ---------- feedback ----------
  UI.toast = (msg, ms = 2600) => {
    let host = document.querySelector(".toasts");
    if (!host) { host = document.createElement("div"); host.className = "toasts"; host.setAttribute("role", "status"); host.setAttribute("aria-live", "polite"); document.body.appendChild(host); }
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(() => t.remove(), ms);
  };

  /** copy text; must be called inside a click handler. Falls back to selecting a hidden textarea. */
  UI.copy = async (text, label = "Copied to clipboard") => {
    try {
      await navigator.clipboard.writeText(text);
      UI.toast(label);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      ta.remove();
      UI.toast(ok ? label : "Copy was blocked — select the text and copy it manually");
      return ok;
    }
  };

  /** modal: UI.modal({ title, body (HTML), actions: [{label, primary?, onClick(close)}] }) → close() */
  UI.modal = (o) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${UI.esc(o.title)}">
      <div class="modal-head"><h3>${UI.esc(o.title)}</h3><button class="btn ghost sm" data-close aria-label="Close">${UI.icon("x")}</button></div>
      <div class="modal-body stack">${o.body || ""}</div>
      ${o.actions && o.actions.length ? `<div class="row" style="justify-content:flex-end">${o.actions.map((a, i) => `<button class="btn ${a.primary ? "primary" : ""}" data-action="${i}">${UI.esc(a.label)}</button>`).join("")}</div>` : ""}
    </div>`;
    const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap || e.target.closest("[data-close]")) return close();
      const b = e.target.closest("[data-action]");
      if (b) o.actions[+b.dataset.action].onClick(close, wrap);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
    const first = wrap.querySelector("input, select, textarea, button.primary");
    if (first) first.focus();
    return close;
  };

  // ---------- color tokens ----------
  UI.cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  /** categorical series color in fixed slot order (0-based). Never cycle past 8. */
  UI.series = (i) => UI.cssVar("--series-" + (Math.min(i, 7) + 1));
  UI.seq = (step) => UI.cssVar("--seq-" + Math.max(1, Math.min(7, step)));
  UI.statusColor = (level) => UI.cssVar("--" + level);
  /** hex/rgb → rgba with alpha */
  UI.alpha = (color, a) => {
    color = color.trim();
    if (color.startsWith("#")) {
      let h = color.slice(1);
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      const n = parseInt(h, 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }
    return color.replace(/rgba?\(([^)]+)\)/, (m, inner) => `rgba(${inner.split(",").slice(0, 3).join(",")}, ${a})`);
  };

  // ---------- charts (Chart.js 4, vendored) ----------
  // Charts created through UI.chart are destroyed automatically on navigation and re-created on theme change
  // (the app re-renders the current page).
  const live = [];
  UI.destroyCharts = () => { while (live.length) { try { live.pop().destroy(); } catch (e) { /* ignore */ } } };

  function themeDefaults() {
    const C = window.Chart;
    if (!C) return;
    const text = UI.cssVar("--chart-text");
    const grid = UI.cssVar("--chart-grid");
    C.defaults.font.family = UI.cssVar("--font-body") || "IBM Plex Sans, system-ui, sans-serif";
    C.defaults.font.size = 12;
    C.defaults.color = text;
    C.defaults.borderColor = grid;
    C.defaults.maintainAspectRatio = false;
    C.defaults.responsive = true;
    C.defaults.animation.duration = 350;
    C.defaults.plugins.legend.labels.boxWidth = 10;
    C.defaults.plugins.legend.labels.boxHeight = 10;
    C.defaults.plugins.legend.labels.useBorderRadius = true;
    C.defaults.plugins.legend.labels.borderRadius = 2;
    C.defaults.plugins.legend.position = "top";
    C.defaults.plugins.legend.align = "start";
    C.defaults.plugins.tooltip.backgroundColor = UI.cssVar("--ink");
    C.defaults.plugins.tooltip.titleColor = UI.cssVar("--bg");
    C.defaults.plugins.tooltip.bodyColor = UI.cssVar("--bg");
    C.defaults.plugins.tooltip.padding = 10;
    C.defaults.plugins.tooltip.cornerRadius = 6;
    C.defaults.plugins.tooltip.boxPadding = 4;
    C.defaults.plugins.tooltip.usePointStyle = true;
    C.defaults.elements.line.borderWidth = 2;
    C.defaults.elements.line.tension = 0.25;
    C.defaults.elements.point.radius = 0;
    C.defaults.elements.point.hoverRadius = 5;
    C.defaults.elements.point.hitRadius = 10;
    C.defaults.elements.bar.borderRadius = 4;
    C.defaults.elements.bar.borderSkipped = "start";
    C.defaults.scale.grid.color = grid;
    C.defaults.scale.border.display = false;
    C.defaults.scale.ticks.color = text;
    C.defaults.interaction.mode = "index";
    C.defaults.interaction.intersect = false;
  }

  /**
   * Create a chart in a canvas (element or id). Returns the Chart instance, or null if Chart.js is missing.
   * Put the canvas inside <div class="chart-box"> (or .sm/.lg) so it has a height.
   */
  UI.chart = (canvas, config) => {
    if (typeof canvas === "string") canvas = document.getElementById(canvas);
    if (!canvas || !window.Chart) return null;
    themeDefaults();
    const c = new window.Chart(canvas, config);
    live.push(c);
    return c;
  };

  /** tiny sparkline (line, no axes) into a canvas */
  UI.spark = (canvas, values, color) => UI.chart(canvas, {
    type: "line",
    data: { labels: values.map((_, i) => i), datasets: [{ data: values, borderColor: color || UI.cssVar("--accent"), backgroundColor: UI.alpha(color || UI.cssVar("--accent"), 0.12), fill: true, borderWidth: 1.5, pointRadius: values.map((_, i) => (i === values.length - 1 ? 2.5 : 0)), pointBackgroundColor: color || UI.cssVar("--accent") }] },
    options: { plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, animation: false, events: [] },
  });

  /** percent axis tick formatter for Chart.js: ticks: { callback: UI.pctTick } */
  UI.pctTick = (v) => Math.round(v * 100) + "%";
})();
