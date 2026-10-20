/* Throughline — app shell: module registry, hash routing, rail navigation, presenter mode, theme.
 *
 * Module contract:
 *   OPS.register({
 *     id: "dashboard",           // route token (#dashboard) — letters, digits, hyphen
 *     title: "Ops Command Center",
 *     stage: "see",              // start | see | discover | prioritize | build | adopt
 *     order: 10,                 // order within the stage
 *     icon: "gauge",             // UI.icon name
 *     eyebrow: "See the operation",
 *     summary: "One sentence on what this page does and why it matters.",
 *     jd: ["Short quote of the job-description line this demonstrates", ...],
 *     render(root, ctx) {},      // root is an empty <section>; ctx = { data, q, opps, ai, ui, navigate, params }
 *     destroy() {},              // optional cleanup (timers, document listeners)
 *   });
 *
 * Cross-module navigation: OPS.navigate("roi", { opp: "OPP-03" })  → params are held in memory
 * (the URL hash only ever carries the bare route token).
 */
(function () {
  "use strict";
  const OPS = (window.OPS = window.OPS || {});
  const UI = window.UI;

  const STAGES = [
    { id: "start", label: "Start here" },
    { id: "see", label: "1 · See the operation" },
    { id: "discover", label: "2 · Discover" },
    { id: "prioritize", label: "3 · Prioritize" },
    { id: "build", label: "4 · Build" },
    { id: "adopt", label: "5 · Adopt & measure" },
  ];
  OPS.STAGES = STAGES;

  const modules = [];
  let current = null;
  let pendingParams = {};

  OPS.register = (m) => {
    if (!m || !m.id || typeof m.render !== "function") return;
    if (modules.some((x) => x.id === m.id)) return;
    modules.push(m);
  };
  OPS.modules = () => sortedModules();

  function sortedModules() {
    const si = (s) => { const i = STAGES.findIndex((x) => x.id === s); return i < 0 ? 99 : i; };
    return modules.slice().sort((a, b) => si(a.stage) - si(b.stage) || (a.order || 0) - (b.order || 0));
  }

  OPS.navigate = (id, params) => {
    pendingParams = params || {};
    if (location.hash.slice(1) === id) route();
    else location.hash = id;
  };

  // ---------- rail ----------
  function brandSvg() {
    // three nodes on one line: the operating loop traced end to end
    return `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="none" stroke="var(--rail-line)"/>
      <path d="M5 21 C11 21, 11 11, 16 11 S21 21, 27 21" fill="none" stroke="var(--rail-accent)" stroke-width="2" stroke-linecap="round"/>
      <circle cx="5" cy="21" r="2.4" fill="var(--rail-ink)"/><circle cx="16" cy="11" r="2.4" fill="var(--rail-ink)"/><circle cx="27" cy="21" r="2.4" fill="var(--rail-accent)"/>
    </svg>`;
  }

  function buildShell() {
    const app = document.getElementById("app");
    app.innerHTML = `
      <div class="topbar">
        <a class="brand" href="#home">${brandSvg()}<span class="brand-name">Throughline</span></a>
        <button class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="rail">Menu</button>
      </div>
      <div class="app">
        <aside class="rail" id="rail" aria-label="Main navigation">
          <a class="brand" href="#home">${brandSvg()}<span><span class="brand-name">Throughline</span><span class="brand-sub">Healthcare ops workbench</span></span></a>
          <nav class="nav" id="nav"></nav>
          <div class="rail-foot">
            <div class="rail-toggle"><span>Presenter notes</span><label class="switch"><input type="checkbox" id="presenter-toggle" aria-label="Show presenter notes"><span></span></label></div>
            <div class="rail-toggle"><span>Dark theme</span><label class="switch"><input type="checkbox" id="theme-toggle" aria-label="Dark theme"><span></span></label></div>
            <div class="ai-status" id="ai-status" data-state="checking"><span class="ai-dot"></span><span id="ai-status-text">Checking for live Claude…</span></div>
            <div>Synthetic data · no PHI</div>
          </div>
        </aside>
        <div class="rail-scrim" id="rail-scrim"></div>
        <main class="main" id="main">
          <div class="page" id="page"></div>
          <footer class="site-foot"><span>Throughline · built with AI-assisted development (Claude Code) as a working demo for a Business Operations &amp; AI Transformation Lead interview.</span><span>Data: ${UI.esc(OPS.data.meta.company)} (synthetic), as of ${UI.esc(OPS.data.meta.asOf)}</span></footer>
        </main>
      </div>`;

    const nav = document.getElementById("nav");
    const mods = sortedModules();
    nav.innerHTML = STAGES.map((s) => {
      const items = mods.filter((m) => m.stage === s.id);
      if (!items.length) return "";
      return `<div class="nav-stage" data-stage="${s.id}"><div class="nav-stage-label">${UI.esc(s.label)}</div>${items.map((m) => `<a class="nav-link" href="#${m.id}" data-id="${m.id}">${UI.icon(m.icon || "spark")}<span>${UI.esc(m.title)}</span></a>`).join("")}</div>`;
    }).join("");

    // presenter mode
    const pt = document.getElementById("presenter-toggle");
    pt.checked = !!UI.store.get("presenter", false);
    document.body.classList.toggle("presenting", pt.checked);
    pt.addEventListener("change", () => { document.body.classList.toggle("presenting", pt.checked); UI.store.set("presenter", pt.checked); });

    // theme: explicit choice sets data-theme; otherwise follow the system/viewer
    const tt = document.getElementById("theme-toggle");
    const saved = UI.store.get("theme", null);
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    const isDark = () => {
      const t = document.documentElement.getAttribute("data-theme");
      if (t) return t === "dark";
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    };
    tt.checked = isDark();
    tt.addEventListener("change", () => {
      const v = tt.checked ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", v);
      UI.store.set("theme", v);
      rerender();
    });
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => { if (!document.documentElement.getAttribute("data-theme")) { tt.checked = mq.matches; rerender(); } };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
    }
    // the viewer may flip data-theme on the root itself
    new MutationObserver(() => { tt.checked = isDark(); rerender(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // mobile drawer
    const mb = document.getElementById("menu-btn");
    const closeNav = () => { document.body.classList.remove("nav-open"); mb.setAttribute("aria-expanded", "false"); };
    mb.addEventListener("click", () => { const open = !document.body.classList.contains("nav-open"); document.body.classList.toggle("nav-open", open); mb.setAttribute("aria-expanded", String(open)); });
    document.getElementById("rail-scrim").addEventListener("click", closeNav);
    nav.addEventListener("click", (e) => { if (e.target.closest(".nav-link")) closeNav(); });

    // AI status
    OPS.ai.onState((s) => {
      const el = document.getElementById("ai-status");
      const tx = document.getElementById("ai-status-text");
      if (!el) return;
      el.dataset.state = s === "live" ? "live" : s === "checking" ? "checking" : "sim";
      tx.textContent = s === "live" ? "Live Claude connected" : s === "checking" ? "Checking for live Claude…" : s === "declined" ? "Claude not allowed · simulation mode" : "Simulation mode (offline AI)";
    });
  }

  // ---------- routing ----------
  let rerenderTimer = null;
  function rerender() {
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => { if (current) mount(current, current._params || {}, true); }, 30);
  }

  function route() {
    const id = (location.hash || "").replace(/^#/, "") || "home";
    const mods = sortedModules();
    const m = mods.find((x) => x.id === id) || mods.find((x) => x.id === "home") || mods[0];
    if (!m) return;
    const params = pendingParams;
    pendingParams = {};
    mount(m, params, false);
  }

  function mount(m, params, keepScroll) {
    if (current && current.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
    UI.destroyCharts();
    current = m;
    m._params = params;

    document.querySelectorAll(".nav-link").forEach((a) => {
      if (a.dataset.id === m.id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.querySelectorAll(".nav-stage").forEach((s) => s.classList.toggle("is-current", s.dataset.stage === m.stage));

    const page = document.getElementById("page");
    const stage = STAGES.find((s) => s.id === m.stage);
    const jd = (m.jd || []).map((t) => `<span class="jd-chip">${UI.esc(t)}</span>`).join("");
    page.innerHTML = `
      <header class="page-head">
        <div class="eyebrow">${UI.esc(m.eyebrow || (stage ? stage.label : ""))}</div>
        <h1>${UI.esc(m.title)}</h1>
        ${m.summary ? `<p class="page-summary">${UI.esc(m.summary)}</p>` : ""}
        ${jd ? `<div class="jd-strip"><span class="jd-strip-label">From the role</span>${jd}</div>` : ""}
      </header>
      <section class="module-root stack" id="module-root" style="gap:22px"></section>`;
    const root = document.getElementById("module-root");
    document.title = m.id === "home" ? "Throughline" : m.title + " · Throughline";
    try {
      m.render(root, { data: OPS.data, q: OPS.q, opps: OPS.opps, ai: OPS.ai, ui: UI, navigate: OPS.navigate, params: params || {} });
    } catch (e) {
      console.error(e);
      root.innerHTML = `<div class="callout critical"><strong>This page hit an error.</strong> ${UI.esc(e.message || e)}</div>`;
    }
    if (!keepScroll) window.scrollTo(0, 0);
  }

  OPS.boot = () => {
    buildShell();
    window.addEventListener("hashchange", route);
    route();
  };
})();
