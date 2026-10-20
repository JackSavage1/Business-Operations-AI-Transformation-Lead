/* Throughline — Opportunity Pipeline (#pipeline).
 * One ranked backlog of improvement opportunities from the shared OPS.opps store:
 * impact/effort matrix, kanban board (drag-and-drop + keyboard move buttons), sortable table,
 * detail drawer with the score math, intake form, and a generated prioritization memo. */
(function () {
  "use strict";
  const OPS = window.OPS;
  const UI = window.UI;
  const ID = "pipeline";
  const RATE = 38; // loaded $/hr used to value hours freed
  const FTE_HOURS = 1880;
  const FLOOR = 50000; // materiality floor for a funded slot in the memo
  const FLOOR_TXT = "$" + FLOOR / 1000 + "K";
  const LIVE = ["Scaled", "Measured"];
  const FLIGHT = ["Discovery", "Prototype", "Pilot"];
  const DEPTS = ["Scheduling", "Call center", "Clinical", "Provider management", "Finance", "Operations", "Customer success"];

  const ANCHORS = {
    impact: ["Minor convenience for one team", "Saves a few hours a month", "Noticeable lift on a team KPI", "Moves a department KPI (show rate, AHT, QA)", "Moves a company KPI (completed visits, revenue)"],
    confidence: ["A hunch", "Anecdotes from the floor", "Observed while mapping the workflow", "Shown in our operating data", "Proven in a pilot or at a peer organization"],
    effort: ["Days: a rule or configuration change", "1 to 3 weeks inside one team", "About a month, needs an integration", "A quarter, needs engineering", "Multi-quarter platform work"],
  };
  const QUADS = {
    quick: { label: "Quick wins", hint: "High impact, low effort" },
    big: { label: "Big bets", hint: "High impact, real effort" },
    fill: { label: "Fill-ins", hint: "Low effort, modest impact" },
    dep: { label: "Deprioritize", hint: "Modest impact, high effort" },
  };
  const LINKS = {
    "OPP-01": { label: "Open no-show risk model", route: "scheduling" },
    "OPP-02": { label: "Open AI lab", route: "ailab" },
    "OPP-03": { label: "Open ops dashboard", route: "dashboard" },
    "OPP-04": { label: "Open roster reconciliation map", route: "workflow", params: { process: "roster-recon" } },
    "OPP-05": { label: "Open clinician capacity", route: "capacity" },
    "OPP-06": { label: "Open clinician capacity", route: "capacity" },
    "OPP-07": { label: "Open ops dashboard", route: "dashboard" },
    "OPP-08": { label: "Open chart-to-cash map", route: "workflow", params: { process: "chart-to-cash" } },
  };
  const STAGE_ACTION = {
    Backlog: "start discovery this week",
    Discovery: "finish discovery and build a prototype",
    Prototype: "move to a measured pilot",
    Pilot: "read out the pilot and decide on scale",
  };

  // ---------- helpers ----------
  const num = (v) => (isFinite(+v) ? +v : 0);
  const value = (o) => num(o.hoursSavedPerMonth) * 12 * RATE + num(o.revenueImpactAnnual);
  const score = (o) => OPS.opps.score(o);
  const fmtScore = (o) => UI.fmt.dec(score(o), 1);
  const quad = (o) => (num(o.impact) > 3.5 ? (num(o.effort) < 2.5 ? "quick" : "big") : num(o.effort) < 2.5 ? "fill" : "dep");
  const riskLevel = (r) => (r === "High" ? "critical" : r === "Medium" ? "warning" : "good");
  const riskPill = (r) => UI.pill(riskLevel(r), (r || "Low") + " risk");
  const stagePill = (s) => UI.pill(LIVE.includes(s) ? "good" : FLIGHT.includes(s) ? "accent" : "neutral", s || "Backlog");
  const byRank = (a, b) => score(b) - score(a) || value(b) - value(a);
  const title = (o) => o.title || "Untitled opportunity";
  const dept = (o) => o.dept || "Unassigned";
  const sum = (arr, fn) => arr.reduce((s, o) => s + fn(o), 0);
  const tools = (o) => (Array.isArray(o.tools) ? o.tools : String(o.tools || "").split(",")).map((t) => String(t).trim()).filter(Boolean);
  const shortId = (id) => String(id).replace(/^OPP-/, "");

  const CSS = `
  .pl-toolbar { display: flex; flex-wrap: wrap; gap: 10px 12px; align-items: center; justify-content: space-between; }
  .pl-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .pl-foot { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); padding-top: 12px; }
  .pl-foot .pl-method { max-width: 78ch; }
  .pl-reset { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .pl-reset .pl-warn { font-size: var(--fs-xs); color: var(--critical-ink); max-width: 46ch; }
  .pl-matrix { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 300px); gap: 18px; align-items: start; }
  .pl-matrix .chart-box { height: 400px; }
  .pl-rank { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .pl-rank-btn { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 2px 10px; align-items: start; width: 100%; text-align: left; font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--line-strong); border-radius: var(--r-md); padding: 8px 10px; cursor: pointer; }
  .pl-rank-btn.q-quick { border-left-color: var(--accent); }
  .pl-rank-btn:hover { background: var(--surface-2); }
  .pl-rank-n { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--ink-3); padding-top: 2px; }
  .pl-rank-t { font-size: var(--fs-sm); font-weight: 600; line-height: 1.3; min-width: 0; }
  .pl-rank-s { font-family: var(--font-mono); font-size: var(--fs-sm); font-weight: 600; font-variant-numeric: tabular-nums; }
  .pl-rank-m { grid-column: 2 / -1; font-size: var(--fs-xs); color: var(--ink-3); }
  .pl-board-wrap { overflow-x: auto; min-width: 0; padding-bottom: 4px; }
  .pl-board { display: grid; grid-template-columns: repeat(6, minmax(170px, 1fr)); gap: 10px; }
  .pl-col { background: var(--surface-2); border: 1px dashed transparent; border-radius: var(--r-md); padding: 8px; display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 180px; transition: background 0.12s, border-color 0.12s; }
  .pl-col.is-over { border-color: var(--accent); background: var(--accent-soft); }
  .pl-col-head { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; padding: 2px 4px; font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-2); font-weight: 600; }
  .pl-col-head .pl-col-val { text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--ink-3); }
  .pl-col-empty { font-size: var(--fs-xs); color: var(--ink-3); border: 1px dashed var(--line-strong); border-radius: var(--r-md); padding: 14px 8px; text-align: center; }
  .pl-card { background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--line-strong); border-radius: var(--r-md); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; min-width: 0; cursor: grab; }
  .pl-card.q-quick { border-left-color: var(--accent); }
  .pl-card.is-dragging { opacity: 0.45; }
  .pl-card-top { display: flex; justify-content: space-between; gap: 6px; font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--ink-3); }
  .pl-card-top b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .pl-link { font: inherit; font-size: var(--fs-sm); font-weight: 600; line-height: 1.3; color: var(--ink); background: none; border: 0; padding: 0; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
  .pl-link:hover { text-decoration: underline; color: var(--accent); }
  .pl-card-tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .pl-card-foot { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .pl-moves { display: inline-flex; gap: 4px; }
  .pl-moves .btn { padding: 2px 7px; min-width: 28px; }
  .pl-filters { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: flex-end; }
  .pl-filters .field { min-width: 200px; }
  .pl-sort { font: inherit; font-weight: 600; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; display: inline-flex; gap: 4px; align-items: center; }
  .pl-sort:hover { color: var(--ink); text-decoration: underline; }
  .pl-sort .pl-arrow { font-size: 0.7em; color: var(--ink-3); }
  .pl-table td .pl-link { font-size: var(--fs-sm); }
  .pl-table td:nth-child(2) { min-width: 220px; }
  .modal-backdrop.pl-drawer-bd { justify-content: flex-end; align-items: stretch; padding: 0; }
  .pl-drawer { background: var(--surface); color: var(--ink); width: min(560px, 100%); height: 100%; overflow-y: auto; padding: 20px 22px 28px; display: flex; flex-direction: column; gap: 14px; border-left: 1px solid var(--line); box-shadow: var(--shadow); animation: pl-slide 0.18s ease-out; }
  @keyframes pl-slide { from { transform: translateX(24px); opacity: 0.6; } to { transform: none; opacity: 1; } }
  .pl-dr-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
  .pl-dr-head h2 { font-size: var(--fs-xl); }
  .pl-sec { display: flex; flex-direction: column; gap: 8px; padding-top: 14px; border-top: 1px solid var(--line); }
  .pl-formula { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--ink-2); }
  .pl-term { display: inline-flex; flex-direction: column; align-items: center; background: var(--surface-2); border-radius: var(--r-sm); padding: 4px 9px; min-width: 52px; }
  .pl-term b { font-family: var(--font-mono); font-size: var(--fs-md); color: var(--ink); font-variant-numeric: tabular-nums; }
  .pl-term small { font-size: 0.6875rem; color: var(--ink-3); white-space: nowrap; }
  .pl-term.is-total { background: var(--accent-soft); }
  .pl-term.is-cut { background: var(--critical-soft); }
  .pl-dl { display: grid; gap: 10px; margin: 0; }
  .pl-dl dt { font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-3); }
  .pl-dl dd { margin: 2px 0 0; font-size: var(--fs-sm); color: var(--ink); }
  .pl-steps { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4px; }
  .pl-steps i { height: 6px; border-radius: 999px; background: var(--surface-3); }
  .pl-steps i.on { background: var(--accent); }
  .pl-dr-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .pl-confirm { display: flex; flex-direction: column; gap: 10px; }
  .pl-err { color: var(--critical-ink); font-size: var(--fs-xs); margin: 0; }
  .pl-err:empty { display: none; }
  .pl-anchor { font-size: var(--fs-xs); color: var(--ink-3); min-height: 2.6em; }
  .pl-form .input[aria-invalid="true"], .pl-form .textarea[aria-invalid="true"], .pl-form .select[aria-invalid="true"] { border-color: var(--critical); }
  .pl-form .textarea { min-height: 70px; }
  .pl-memo { max-height: 52vh; }
  @media (max-width: 1000px) { .pl-matrix { grid-template-columns: minmax(0, 1fr); } .pl-matrix .chart-box { height: 340px; } }
  @media (max-width: 760px) { .pl-board { grid-template-columns: minmax(0, 1fr); } .pl-col { min-height: 0; } }
  @media (max-width: 560px) { .pl-drawer { padding: 16px; } .pl-filters .field { min-width: 0; width: 100%; } }
  `;

  // ---------- module state ----------
  let S = null; // per-render state
  let onChange = null;
  let drawer = null; // { bd, el, id, confirm, opener, onKey }
  const modalClosers = new Set();

  // ---------- KPIs ----------
  function kpisHtml() {
    const all = OPS.opps.all();
    const flight = all.filter((o) => FLIGHT.includes(o.stage));
    const live = all.filter((o) => LIVE.includes(o.stage));
    const qw = all.filter((o) => quad(o) === "quick" && !LIVE.includes(o.stage) && o.stage !== "Pilot");
    const totalV = sum(all, value);
    const liveV = sum(all.filter((o) => o.stage === "Pilot" || LIVE.includes(o.stage)), value);
    const hrs = sum(all, (o) => num(o.hoursSavedPerMonth));
    return [
      UI.kpi({ label: "Opportunities in flight", value: String(flight.length), unit: "of " + all.length, foot: live.length + " live (Scaled or Measured)" }),
      UI.kpi({ label: "Quick wins available", value: String(qw.length), foot: UI.fmt.moneyK(sum(qw, value)) + "/yr, not yet piloted" }),
      UI.kpi({ label: "Annual value in pipeline", value: UI.fmt.moneyK(totalV), foot: UI.fmt.moneyK(liveV) + " in Pilot or later" }),
      UI.kpi({ label: "Hours freed per month", value: UI.fmt.num(hrs), unit: "hrs", foot: "≈ " + UI.fmt.dec((hrs * 12) / FTE_HOURS, 1) + " FTE of capacity" }),
    ].join("");
  }

  // ---------- views ----------
  function matrixHtml() {
    const all = OPS.opps.all();
    const ranked = all.slice().sort(byRank).slice(0, 6);
    return `<div class="pl-matrix">
      <div class="stack">
        <div class="chart-box"><canvas id="pl-bubble" role="img" aria-label="Impact versus effort matrix of ${all.length} opportunities. Bubble size shows annual value. The table view lists the same data."></canvas></div>
        <p class="xs muted">Bubble size = annual value. Tied positions are nudged apart so every item stays visible. Numbers are opportunity IDs; select a bubble for details.</p>
      </div>
      <div class="stack" style="gap:8px">
        <div class="label">Ranked by score</div>
        <ol class="pl-rank">${ranked.map((o, i) => `<li><button type="button" class="pl-rank-btn q-${quad(o)}" data-open="${UI.esc(o.id)}">
            <span class="pl-rank-n">#${i + 1}</span><span class="pl-rank-t">${UI.esc(title(o))}</span><span class="pl-rank-s">${fmtScore(o)}</span>
            <span class="pl-rank-m">${UI.esc(o.id)} · ${UI.esc(QUADS[quad(o)].label)} · ${UI.fmt.moneyK(value(o))}/yr · ${UI.esc(o.stage)}</span>
          </button></li>`).join("")}</ol>
        <button type="button" class="btn ghost sm" data-view-go="table">See all ${all.length} in the table</button>
      </div>
    </div>`;
  }

  function cardHtml(o, si, n) {
    const stages = OPS.opps.STAGES;
    const prev = stages[si - 1], next = stages[si + 1];
    return `<article class="pl-card q-${quad(o)}" draggable="true" data-id="${UI.esc(o.id)}" aria-label="${UI.esc(o.id + " " + title(o))}">
      <div class="pl-card-top"><span>${UI.esc(o.id)}</span><span>Score <b>${fmtScore(o)}</b></span></div>
      <button type="button" class="pl-link" data-open="${UI.esc(o.id)}">${UI.esc(title(o))}</button>
      <div class="pl-card-tags">${UI.tag(dept(o))}${riskPill(o.risk)}</div>
      <div class="pl-card-foot"><span>${UI.fmt.moneyK(value(o))}/yr</span>
        <span class="pl-moves">
          <button type="button" class="btn sm" data-move="-1" data-id="${UI.esc(o.id)}" ${prev ? `aria-label="Move ${UI.esc(o.id)} back to ${prev}" title="Move to ${prev}"` : `disabled aria-label="Already in the first stage"`}>←</button>
          <button type="button" class="btn sm" data-move="1" data-id="${UI.esc(o.id)}" ${next ? `aria-label="Move ${UI.esc(o.id)} forward to ${next}" title="Move to ${next}"` : `disabled aria-label="Already in the last stage"`}>→</button>
        </span>
      </div>
    </article>`;
  }

  function boardHtml() {
    const all = OPS.opps.all();
    const stages = OPS.opps.STAGES;
    return `<p class="xs muted">Drag a card to another column, or use its ← → buttons. Stages run from discovery to a measured result; nothing reaches Measured without a before/after number.</p>
    <div class="pl-board-wrap"><div class="pl-board">${stages.map((s, si) => {
      const items = all.filter((o) => (stages.includes(o.stage) ? o.stage : "Backlog") === s).sort(byRank);
      return `<section class="pl-col" data-stage="${UI.esc(s)}" aria-label="${UI.esc(s)}: ${items.length} ${items.length === 1 ? "opportunity" : "opportunities"}">
        <div class="pl-col-head"><span>${UI.esc(s)} · ${items.length}</span><span class="pl-col-val">${items.length ? UI.fmt.moneyK(sum(items, value)) : ""}</span></div>
        ${items.length ? items.map((o) => cardHtml(o, si, stages.length)).join("") : `<div class="pl-col-empty">Drop a card here</div>`}
      </section>`;
    }).join("")}</div></div>`;
  }

  const SORTS = {
    score: { label: "Score", fn: (o) => score(o), first: -1 },
    value: { label: "Annual value", fn: (o) => value(o), first: -1 },
    effort: { label: "Effort", fn: (o) => num(o.effort), first: 1 },
    dept: { label: "Dept", fn: (o) => dept(o).toLowerCase(), first: 1 },
  };

  function tableHtml() {
    const all = OPS.opps.all();
    const depts = Array.from(new Set(all.map(dept))).sort();
    if (S.dept !== "all" && !depts.includes(S.dept)) S.dept = "all";
    const rows = (S.dept === "all" ? all : all.filter((o) => dept(o) === S.dept)).slice();
    const sk = SORTS[S.sort.key];
    rows.sort((a, b) => {
      const x = sk.fn(a), y = sk.fn(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return c * S.sort.dir || byRank(a, b);
    });
    const th = (key, cls) => {
      const on = S.sort.key === key;
      const aria = on ? (S.sort.dir < 0 ? "descending" : "ascending") : "none";
      return `<th class="${cls || ""}" aria-sort="${aria}"><button type="button" class="pl-sort" data-sort="${key}">${SORTS[key].label}<span class="pl-arrow" aria-hidden="true">${on ? (S.sort.dir < 0 ? "▼" : "▲") : "↕"}</span></button></th>`;
    };
    return `<div class="pl-filters">
        ${UI.select("pl-dept", [{ value: "all", label: "All departments" }].concat(depts.map((d) => ({ value: d, label: d }))), S.dept, "Department")}
        <p class="small muted" aria-live="polite">Showing ${rows.length} of ${all.length} · ${UI.fmt.moneyK(sum(rows, value))}/yr · ${UI.fmt.num(sum(rows, (o) => num(o.hoursSavedPerMonth)))} hrs/month</p>
      </div>
      <div class="table-wrap"><table class="data pl-table">
        <thead><tr><th>ID</th><th>Opportunity</th>${th("dept")}<th>Stage</th><th class="num" title="Impact · Confidence">I · C</th>${th("effort", "num")}<th>Risk</th>${th("score", "num")}${th("value", "num")}<th>Owner</th></tr></thead>
        <tbody>${rows.map((o) => `<tr>
          <td class="mono xs">${UI.esc(o.id)}</td>
          <td><button type="button" class="pl-link" data-open="${UI.esc(o.id)}">${UI.esc(title(o))}</button><div class="xs muted">KPI: ${UI.esc(o.kpi || "Not set")}</div></td>
          <td>${UI.tag(dept(o))}</td>
          <td>${stagePill(o.stage)}</td>
          <td class="num">${num(o.impact)} · ${num(o.confidence)}</td>
          <td class="num">${num(o.effort)}</td>
          <td>${riskPill(o.risk)}</td>
          <td class="num"><strong>${fmtScore(o)}</strong></td>
          <td class="num">${UI.fmt.moneyK(value(o))}</td>
          <td class="small">${UI.esc(o.owner || "Unassigned")}</td>
        </tr>`).join("") || `<tr><td colspan="10"><div class="empty">No opportunities in this department yet.</div></td></tr>`}</tbody>
      </table></div>`;
  }

  // ---------- bubble chart ----------
  function bubblePoints() {
    const all = OPS.opps.all();
    const groups = {};
    all.forEach((o) => { const k = num(o.effort) + "|" + num(o.impact); (groups[k] = groups[k] || []).push(o); });
    const pts = [];
    Object.keys(groups).forEach((k) => {
      const g = groups[k].slice().sort(byRank);
      const n = g.length;
      const rr = n >= 3 ? 0.3 : 0.18;
      g.forEach((o, i) => {
        const ang = (Math.PI * 2 * i) / n + Math.PI / 4;
        const dx = n > 1 ? Math.cos(ang) * rr : 0;
        const dy = n > 1 ? Math.sin(ang) * rr : 0;
        pts.push({ x: num(o.effort) + dx, y: num(o.impact) + dy, id: o.id, v: value(o) });
      });
    });
    return pts;
  }

  function drawMatrix() {
    if (S.chart) { try { S.chart.destroy(); } catch (e) { /* ignore */ } S.chart = null; }
    const canvas = S.root.querySelector("#pl-bubble");
    if (!canvas) return;
    const pts = bubblePoints();
    const maxV = Math.max(1, ...pts.map((p) => p.v));
    const s0 = UI.series(0);
    const radius = (c) => {
      const raw = c.raw || {};
      const k = c.chart.width < 520 ? 0.68 : 1;
      return k * (5 + 17 * Math.sqrt(Math.max(0, raw.v || 0) / maxV));
    };
    const quadPlugin = {
      id: "plQuad",
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales } = chart;
        const xm = scales.x.getPixelForValue(2.5), ym = scales.y.getPixelForValue(3.5);
        ctx.save();
        ctx.fillStyle = UI.alpha(UI.cssVar("--accent"), 0.09);
        ctx.fillRect(a.left, a.top, xm - a.left, ym - a.top);
        ctx.fillStyle = UI.alpha(UI.cssVar("--ink-3"), 0.07);
        ctx.fillRect(xm, ym, a.right - xm, a.bottom - ym);
        ctx.strokeStyle = UI.cssVar("--line-strong");
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xm, a.top); ctx.lineTo(xm, a.bottom); ctx.moveTo(a.left, ym); ctx.lineTo(a.right, ym); ctx.stroke();
        ctx.setLineDash([]);
        const mono = UI.cssVar("--font-mono") || "monospace";
        ctx.font = "600 11px " + mono;
        const pad = 8;
        const label = (t, x, y, align, base, strong) => { ctx.fillStyle = UI.cssVar(strong ? "--ink-2" : "--ink-3"); ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(t, x, y); };
        label("QUICK WINS", a.left + pad, a.top + pad, "left", "top", true);
        label("BIG BETS", a.right - pad, a.top + pad, "right", "top");
        label("FILL-INS", a.left + pad, a.bottom - pad, "left", "bottom");
        label("DEPRIORITIZE", a.right - pad, a.bottom - pad, "right", "bottom");
        ctx.restore();
      },
    };
    const labelPlugin = {
      id: "plIds",
      afterDatasetsDraw(chart) {
        const meta = chart.getDatasetMeta(0);
        const { ctx } = chart;
        ctx.save();
        ctx.font = "600 10px " + (UI.cssVar("--font-mono") || "monospace");
        ctx.fillStyle = UI.cssVar("--ink");
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        meta.data.forEach((el, i) => { const p = pts[i]; if (p) ctx.fillText(shortId(p.id), el.x, el.y); });
        ctx.restore();
      },
    };
    const intTick = (v) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : "");
    const fiveTicks = (scale) => { scale.ticks = [1, 2, 3, 4, 5].map((v) => ({ value: v })); };
    S.chart = UI.chart(canvas, {
      type: "bubble",
      data: { datasets: [{ label: "Opportunities", data: pts, backgroundColor: UI.alpha(s0, 0.3), hoverBackgroundColor: UI.alpha(s0, 0.5), borderColor: s0, hoverBorderColor: s0, borderWidth: 1.5, radius, hoverRadius: 2, hitRadius: 4 }] },
      options: {
        interaction: { mode: "nearest", intersect: true },
        layout: { padding: { top: 4, right: 6 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) => { const o = OPS.opps.get(items[0].raw.id); return o ? o.id + " · " + title(o) : ""; },
              label: (c) => { const o = OPS.opps.get(c.raw.id); if (!o) return ""; return ["Score " + fmtScore(o) + " · " + UI.fmt.moneyK(value(o)) + "/yr", "Impact " + o.impact + " · Confidence " + o.confidence + " · Effort " + o.effort, QUADS[quad(o)].label + " · " + o.stage + " · " + (o.risk || "Low") + " risk"]; },
            },
          },
        },
        scales: {
          x: { min: 0.5, max: 5.5, grid: { display: false }, afterBuildTicks: fiveTicks, ticks: { callback: intTick }, title: { display: true, text: "Effort (1 = days, 5 = multi-quarter)" } },
          y: { min: 0.5, max: 5.5, grid: { display: false }, afterBuildTicks: fiveTicks, ticks: { callback: intTick }, title: { display: true, text: "Impact (1 = minor, 5 = company KPI)" } },
        },
        onClick: (evt, els) => { if (els && els.length) { const p = pts[els[0].index]; if (p) openDrawer(p.id); } },
        onHover: (evt, els) => { const t = evt.native && evt.native.target; if (t) t.style.cursor = els && els.length ? "pointer" : "default"; },
      },
      plugins: [quadPlugin, labelPlugin],
    });
  }

  // ---------- reset ----------
  function resetHtml() {
    if (!S.resetArmed) return `<button type="button" class="btn ghost sm" data-reset="arm">Reset to example backlog</button>`;
    return `<span class="pl-warn" role="alert">This replaces every edit, move and added opportunity with the 12 example items.</span>
      <button type="button" class="btn sm primary" data-reset="confirm">Confirm reset</button>
      <button type="button" class="btn sm" data-reset="cancel">Cancel</button>`;
  }

  // ---------- paint ----------
  function paintView() {
    const host = S.root.querySelector("#pl-view");
    if (!host) return;
    if (S.chart) { try { S.chart.destroy(); } catch (e) { /* ignore */ } S.chart = null; }
    host.innerHTML = S.view === "board" ? boardHtml() : S.view === "table" ? tableHtml() : matrixHtml();
    if (S.view === "matrix") drawMatrix();
    if (S.focusAfter) {
      const f = S.focusAfter;
      S.focusAfter = null;
      const card = host.querySelector(`.pl-card[data-id="${CSS_ID(f.id)}"]`);
      if (card) {
        const b = card.querySelector(`[data-move="${f.dir}"]:not([disabled])`) || card.querySelector("[data-move]:not([disabled])");
        if (b) b.focus();
      }
    }
  }
  const CSS_ID = (s) => String(s).replace(/["\\]/g, "\\$&");

  function paint() {
    if (!S) return;
    S.root.querySelector("#pl-kpis").innerHTML = kpisHtml();
    const ex = S.root.querySelector("#pl-example");
    if (ex) ex.innerHTML = OPS.opps.all().some((o) => o.source === "seed") ? UI.pill("neutral", "Example backlog") : "";
    S.root.querySelector("#pl-reset").innerHTML = resetHtml();
    paintView();
  }

  function setView(v) {
    S.view = v;
    UI.store.set("pipeline.view", v);
    S.root.querySelectorAll("#pl-view-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === v)));
    paintView();
  }

  // ---------- moves ----------
  function moveTo(id, stage) {
    const o = OPS.opps.get(id);
    if (!o || !stage || o.stage === stage) return false;
    OPS.opps.save(Object.assign({}, o, { stage }));
    UI.toast(id + " moved to " + stage);
    return true;
  }
  function moveBy(id, dir) {
    const o = OPS.opps.get(id);
    if (!o) return;
    const st = OPS.opps.STAGES;
    const next = st[st.indexOf(o.stage) + dir];
    if (!next) return;
    S.focusAfter = { id, dir };
    moveTo(id, next);
  }

  // ---------- drawer ----------
  function drawerHtml(o) {
    const st = OPS.opps.STAGES;
    const si = Math.max(0, st.indexOf(o.stage));
    const raw = (num(o.impact) * num(o.confidence)) / Math.max(1, num(o.effort));
    const hi = o.risk === "High";
    const link = LINKS[o.id];
    const labor = num(o.hoursSavedPerMonth) * 12 * RATE;
    const q = quad(o);
    const tl = tools(o);
    const confirm = drawer && drawer.confirm;
    return `<div class="pl-dr-head">
        <div class="stack" style="gap:8px">
          <div class="row" style="gap:6px"><span class="mono xs muted">${UI.esc(o.id)}</span>${stagePill(o.stage)}${riskPill(o.risk)}${UI.pill(q === "quick" ? "accent" : "neutral", QUADS[q].label)}</div>
          <h2 id="pl-dr-title">${UI.esc(title(o))}</h2>
          <div class="row" style="gap:8px">${UI.tag(dept(o))}<span class="small muted">Owner: ${UI.esc(o.owner || "Unassigned")}</span></div>
        </div>
        <button type="button" class="btn ghost sm" data-dr="close" aria-label="Close details">${UI.icon("x")}</button>
      </div>
      <div class="pl-sec">
        <div class="label">Priority score</div>
        <div class="pl-formula">
          <span class="pl-term"><b>${num(o.impact)}</b><small>Impact</small></span>×
          <span class="pl-term"><b>${num(o.confidence)}</b><small>Confidence</small></span>÷
          <span class="pl-term"><b>${num(o.effort)}</b><small>Effort</small></span>=
          ${hi ? `<span class="pl-term"><b>${UI.fmt.dec(raw, 1)}</b><small>Raw</small></span>×<span class="pl-term is-cut"><b>0.85</b><small>High-risk haircut</small></span>=` : ""}
          <span class="pl-term is-total"><b>${fmtScore(o)}</b><small>Score</small></span>
        </div>
        <p class="xs muted">${hi
          ? "High PHI or compliance risk takes a 15% haircut. Delivering it safely needs a BAA, a minimum-necessary data design and a human review step, so the same impact costs more and lands later."
          : (o.risk || "Low") + " risk, so no haircut. Only High-risk items take the 15% haircut for the BAA, privacy review and human-in-the-loop controls they need."}</p>
      </div>
      <div class="pl-sec">
        <div class="label">Annual value</div>
        <div class="pl-formula">
          <span class="pl-term"><b>${UI.fmt.num(num(o.hoursSavedPerMonth))}</b><small>hrs / month</small></span>× 12 × $${RATE} =
          <span class="pl-term"><b>${UI.fmt.moneyK(labor)}</b><small>Labor value</small></span>+
          <span class="pl-term"><b>${UI.fmt.moneyK(num(o.revenueImpactAnnual))}</b><small>Revenue / yr</small></span>=
          <span class="pl-term is-total"><b>${UI.fmt.moneyK(value(o))}</b><small>Per year</small></span>
        </div>
        <p class="xs muted">Hours are valued at a $${RATE}/hr loaded rate as capacity. Use Model ROI to test the drivers and write the measurement plan.</p>
      </div>
      <dl class="pl-dl pl-sec">
        <div><dt>Problem</dt><dd>${UI.esc(o.problem || "Not described yet.")}</dd></div>
        <div><dt>Proposed solution</dt><dd>${UI.esc(o.solution || "To be designed in discovery.")}</dd></div>
        <div><dt>Success KPI</dt><dd>${UI.esc(o.kpi || "Not set")}</dd></div>
        <div><dt>Tools</dt><dd><span class="row" style="gap:4px">${tl.length ? tl.map(UI.tag).join("") : `<span class="muted">None listed</span>`}</span></dd></div>
      </dl>
      <div class="pl-sec">
        <div class="pl-steps" aria-hidden="true">${st.map((s, i) => `<i class="${i <= si ? "on" : ""}" title="${UI.esc(s)}"></i>`).join("")}</div>
        ${UI.select("pl-dr-stage", st.map((s) => ({ value: s, label: s })), o.stage, "Stage " + (si + 1) + " of " + st.length)}
      </div>
      <div class="pl-dr-actions pl-sec" style="flex-direction:row">
        <button type="button" class="btn primary" data-dr="roi">${UI.icon("dollar")} Model ROI</button>
        ${link ? `<button type="button" class="btn" data-dr="link">${UI.icon("arrow")} ${UI.esc(link.label)}</button>` : ""}
        <button type="button" class="btn" data-dr="edit">Edit</button>
        <button type="button" class="btn ghost" data-dr="delete">Delete</button>
      </div>
      ${confirm ? `<div class="callout critical pl-confirm" role="alert">
          <div><strong>Delete ${UI.esc(o.id)} from the pipeline?</strong> Pages that link to it will no longer find it. Reset to example backlog brings the seeded items back.</div>
          <div class="row"><button type="button" class="btn primary sm" data-dr="confirm-delete">Confirm delete</button><button type="button" class="btn sm" data-dr="cancel-delete">Keep it</button></div>
        </div>` : ""}`;
  }

  function openDrawer(id, opener) {
    const o = OPS.opps.get(id);
    if (!o) return;
    if (!drawer) {
      const bd = document.createElement("div");
      bd.className = "modal-backdrop pl-drawer-bd";
      bd.innerHTML = `<aside class="pl-drawer" role="dialog" aria-modal="true" aria-labelledby="pl-dr-title"></aside>`;
      const el = bd.querySelector(".pl-drawer");
      drawer = { bd, el, id, confirm: false, opener: opener || document.activeElement };
      bd.addEventListener("click", (e) => {
        if (e.target === bd) return closeDrawer();
        const b = e.target.closest("[data-dr]");
        if (b) drawerAction(b.dataset.dr, b);
      });
      bd.addEventListener("change", (e) => {
        if (e.target && e.target.id === "pl-dr-stage") { const cur = OPS.opps.get(drawer.id); if (cur) moveTo(cur.id, e.target.value); }
      });
      drawer.onKey = (e) => {
        if (e.key !== "Escape") return;
        if (document.querySelector(".modal-backdrop:not(.pl-drawer-bd)")) return; // a modal on top handles its own Escape
        closeDrawer();
      };
      document.addEventListener("keydown", drawer.onKey);
      document.body.appendChild(bd);
    } else {
      drawer.id = id;
      drawer.confirm = false;
    }
    if (S && S.ctx && S.ctx.params) S.ctx.params.focus = id; // a re-render (theme change) restores the open drawer
    renderDrawer();
    const c = drawer.el.querySelector('[data-dr="close"]');
    if (c) c.focus();
  }

  function renderDrawer() {
    if (!drawer) return;
    const o = OPS.opps.get(drawer.id);
    if (!o) return closeDrawer();
    const keepScroll = drawer.el.scrollTop;
    drawer.el.innerHTML = drawerHtml(o);
    drawer.el.scrollTop = keepScroll;
  }

  function closeDrawer(silent) {
    if (!drawer) return;
    document.removeEventListener("keydown", drawer.onKey);
    drawer.bd.remove();
    const opener = drawer.opener;
    drawer = null;
    if (!silent && S && S.ctx && S.ctx.params) delete S.ctx.params.focus;
    if (!silent && opener && document.body.contains(opener) && opener.focus) opener.focus();
  }

  function drawerAction(act) {
    const o = drawer && OPS.opps.get(drawer.id);
    if (!o) return closeDrawer();
    if (act === "close") return closeDrawer();
    if (act === "roi") { closeDrawer(true); return OPS.navigate("roi", { opp: o.id }); }
    if (act === "link") { const l = LINKS[o.id]; closeDrawer(true); return OPS.navigate(l.route, l.params || {}); }
    if (act === "edit") return openForm(o);
    if (act === "delete") { drawer.confirm = true; renderDrawer(); const b = drawer.el.querySelector('[data-dr="confirm-delete"]'); if (b) b.focus(); return; }
    if (act === "cancel-delete") { drawer.confirm = false; renderDrawer(); const b = drawer.el.querySelector('[data-dr="delete"]'); if (b) b.focus(); return; }
    if (act === "confirm-delete") {
      closeDrawer();
      OPS.opps.remove(o.id);
      UI.toast("Deleted " + o.id + " from the pipeline");
    }
  }

  // ---------- intake / edit form ----------
  function sliderHtml(key, label, v) {
    return `<div class="stack" style="gap:4px">
      ${UI.range({ id: "pl-f-" + key, label, min: 1, max: 5, step: 1, value: v })}
      <div class="pl-anchor" id="pl-f-${key}-desc">${v} · ${UI.esc(ANCHORS[key][v - 1])}</div>
    </div>`;
  }

  function formHtml(o) {
    const v = Object.assign({ impact: 3, confidence: 3, effort: 2, risk: "Low", hoursSavedPerMonth: 0, revenueImpactAnnual: 0, tools: [], stage: "Backlog" }, o || {});
    const deptOpts = DEPTS.slice();
    if (v.dept && !deptOpts.includes(v.dept)) deptOpts.push(v.dept);
    const fld = (id, label, control, cls) => `<div class="field ${cls || ""}"><label for="${id}">${label}</label>${control}<p class="pl-err" id="${id}-err"></p></div>`;
    const inp = (id, val, attrs) => `<input class="input" id="${id}" value="${UI.esc(val == null ? "" : val)}" ${attrs || ""}>`;
    return `<div class="callout critical" id="pl-f-summary" role="alert" hidden></div>
      <div class="grid g-2 pl-form">
        ${fld("pl-f-title", "Title", inp("pl-f-title", v.title, 'type="text" maxlength="110" placeholder="e.g. Auto-assign interpreter for Spanish-preferred visits" aria-describedby="pl-f-title-err"'), "span-2")}
        ${fld("pl-f-dept", "Department", `<select class="select" id="pl-f-dept" aria-describedby="pl-f-dept-err"><option value="">Choose a department</option>${deptOpts.map((d) => `<option value="${UI.esc(d)}"${d === v.dept ? " selected" : ""}>${UI.esc(d)}</option>`).join("")}</select>`)}
        ${fld("pl-f-owner", "Owner", inp("pl-f-owner", v.owner, 'type="text" maxlength="60" placeholder="Role that owns the KPI" aria-describedby="pl-f-owner-err"'))}
        ${fld("pl-f-problem", "Problem", `<textarea class="textarea" id="pl-f-problem" maxlength="400" placeholder="What is slow, wrong or costly today? Include a number if you have one." aria-describedby="pl-f-problem-err">${UI.esc(v.problem || "")}</textarea>`, "span-2")}
        ${fld("pl-f-solution", "Proposed solution", `<textarea class="textarea" id="pl-f-solution" maxlength="400" placeholder="Optional at intake. What would we change, and who confirms the output?">${UI.esc(v.solution || "")}</textarea>`, "span-2")}
        ${fld("pl-f-kpi", "Success KPI", inp("pl-f-kpi", v.kpi, 'type="text" maxlength="80" placeholder="e.g. Show rate, ACW seconds, QA first-pass rate" aria-describedby="pl-f-kpi-err"'))}
        ${fld("pl-f-tools", "Tools (comma separated)", inp("pl-f-tools", tools(v).join(", "), 'type="text" maxlength="160" placeholder="e.g. n8n, Twilio, SQL"'))}
      </div>
      <div class="grid g-3">
        ${sliderHtml("impact", "Impact", num(v.impact) || 3)}
        ${sliderHtml("confidence", "Confidence", num(v.confidence) || 3)}
        ${sliderHtml("effort", "Effort", num(v.effort) || 2)}
      </div>
      <div class="grid g-3 pl-form">
        ${fld("pl-f-risk", "PHI / compliance risk", `<select class="select" id="pl-f-risk">${["Low", "Medium", "High"].map((r) => `<option value="${r}"${r === (v.risk || "Low") ? " selected" : ""}>${r}</option>`).join("")}</select>`)}
        ${fld("pl-f-hours", "Hours saved / month", inp("pl-f-hours", num(v.hoursSavedPerMonth), 'type="number" min="0" max="20000" step="1" inputmode="numeric" aria-describedby="pl-f-hours-err"'))}
        ${fld("pl-f-rev", "Annual revenue impact ($)", inp("pl-f-rev", num(v.revenueImpactAnnual), 'type="number" min="0" max="50000000" step="1000" inputmode="numeric" aria-describedby="pl-f-rev-err"'))}
      </div>
      ${o ? `<div class="grid g-2">${UI.select("pl-f-stage", OPS.opps.STAGES.map((s) => ({ value: s, label: s })), v.stage, "Stage")}</div>` : ""}
      <div class="callout accent" id="pl-f-preview" aria-live="polite"></div>`;
  }

  function readForm(wrap) {
    const g = (id) => { const el = wrap.querySelector("#" + id); return el ? el.value : ""; };
    return {
      title: g("pl-f-title").trim(),
      dept: g("pl-f-dept"),
      owner: g("pl-f-owner").trim(),
      problem: g("pl-f-problem").trim(),
      solution: g("pl-f-solution").trim(),
      kpi: g("pl-f-kpi").trim(),
      tools: g("pl-f-tools").split(",").map((t) => t.trim()).filter(Boolean),
      impact: +g("pl-f-impact") || 3,
      confidence: +g("pl-f-confidence") || 3,
      effort: +g("pl-f-effort") || 2,
      risk: g("pl-f-risk") || "Low",
      hoursRaw: g("pl-f-hours"),
      revRaw: g("pl-f-rev"),
      stage: g("pl-f-stage"),
    };
  }

  function validate(f) {
    const err = {};
    if (f.title.length < 6) err["pl-f-title"] = "Give it a specific title (at least 6 characters).";
    if (!f.dept) err["pl-f-dept"] = "Pick the department that owns the work.";
    if (!f.owner) err["pl-f-owner"] = "Every opportunity needs a named owner (a role is fine).";
    if (f.problem.length < 15) err["pl-f-problem"] = "Describe the problem in a sentence, with a number if you have one.";
    if (!f.kpi) err["pl-f-kpi"] = "Name the KPI this should move, so we can measure it.";
    const h = f.hoursRaw === "" ? 0 : Number(f.hoursRaw);
    if (!isFinite(h) || h < 0 || h > 20000) err["pl-f-hours"] = "Enter hours per month between 0 and 20,000.";
    const r = f.revRaw === "" ? 0 : Number(f.revRaw);
    if (!isFinite(r) || r < 0 || r > 50000000) err["pl-f-rev"] = "Enter annual revenue between $0 and $50M.";
    return { err, hours: Math.round(h || 0), rev: Math.round(r || 0) };
  }

  function updatePreview(wrap) {
    const f = readForm(wrap);
    ["impact", "confidence", "effort"].forEach((k) => {
      const v = f[k];
      const out = wrap.querySelector("#pl-f-" + k + "-out");
      if (out) out.textContent = String(v);
      const d = wrap.querySelector("#pl-f-" + k + "-desc");
      if (d) d.textContent = v + " · " + ANCHORS[k][v - 1];
    });
    const h = Math.max(0, Number(f.hoursRaw) || 0), r = Math.max(0, Number(f.revRaw) || 0);
    const tmp = { impact: f.impact, confidence: f.confidence, effort: f.effort, risk: f.risk, hoursSavedPerMonth: h, revenueImpactAnnual: r };
    const all = OPS.opps.all();
    const rank = all.filter((o) => byRank(o, tmp) < 0).length + 1;
    const p = wrap.querySelector("#pl-f-preview");
    if (p) p.innerHTML = `<div><strong>Score preview ${UI.fmt.dec(score(tmp), 1)}</strong> · ${UI.esc(QUADS[quad(tmp)].label)} · ${UI.fmt.moneyK(value(tmp))}/yr · would rank about #${rank} of ${all.length + 1}${f.risk === "High" ? " (includes the 15% High-risk haircut)" : ""}.</div>`;
  }

  function openForm(existing) {
    let wrap = null;
    const close = UI.modal({
      title: existing ? "Edit " + existing.id : "Add opportunity",
      body: formHtml(existing),
      actions: [
        { label: "Cancel", onClick: (c) => c() },
        { label: existing ? "Save changes" : "Add to pipeline", primary: true, onClick: (c, w) => submitForm(c, w || wrap, existing) },
      ],
    });
    const wraps = document.querySelectorAll(".modal-backdrop:not(.pl-drawer-bd)");
    wrap = wraps[wraps.length - 1];
    const closer = () => { modalClosers.delete(closer); close(); };
    modalClosers.add(closer);
    if (!wrap) return;
    // keep the modal open when a slider drag ends over the backdrop
    let downOnBackdrop = false;
    wrap.addEventListener("mousedown", (e) => { downOnBackdrop = e.target === wrap; }, true);
    wrap.addEventListener("click", (e) => { if (e.target === wrap && !downOnBackdrop) e.stopImmediatePropagation(); }, true);
    wrap.addEventListener("input", () => updatePreview(wrap));
    wrap.addEventListener("change", () => updatePreview(wrap));
    updatePreview(wrap);
  }

  function submitForm(close, wrap, existing) {
    if (!wrap) return;
    const f = readForm(wrap);
    const v = validate(f);
    const ids = ["pl-f-title", "pl-f-dept", "pl-f-owner", "pl-f-problem", "pl-f-kpi", "pl-f-hours", "pl-f-rev"];
    ids.forEach((id) => {
      const el = wrap.querySelector("#" + id), m = wrap.querySelector("#" + id + "-err");
      if (el) el.setAttribute("aria-invalid", v.err[id] ? "true" : "false");
      if (m) m.textContent = v.err[id] || "";
    });
    const bad = ids.filter((id) => v.err[id]);
    const sumEl = wrap.querySelector("#pl-f-summary");
    if (bad.length) {
      if (sumEl) { sumEl.hidden = false; sumEl.innerHTML = `<div><strong>${bad.length === 1 ? "One field needs" : bad.length + " fields need"} attention</strong> before this can be scored.</div>`; }
      const first = wrap.querySelector("#" + bad[0]);
      if (first) first.focus();
      return;
    }
    const rec = Object.assign({}, existing || { stage: "Backlog", source: "intake" }, {
      title: f.title, dept: f.dept, owner: f.owner, problem: f.problem, solution: f.solution, kpi: f.kpi, tools: f.tools,
      impact: f.impact, confidence: f.confidence, effort: f.effort, risk: f.risk,
      hoursSavedPerMonth: v.hours, revenueImpactAnnual: v.rev,
    });
    if (existing && f.stage) rec.stage = f.stage;
    close();
    const saved = OPS.opps.save(rec);
    UI.toast(existing ? "Saved " + saved.id : "Added " + saved.id + " to Backlog · score " + fmtScore(saved));
    openDrawer(saved.id);
  }

  // ---------- prioritization memo ----------
  function whyNot(o, cutoff) {
    const r = [];
    if (o.risk === "High") r.push("High PHI/compliance risk needs a BAA review, a minimum-necessary data design and clinician or QA sign-off before it can scale");
    if (num(o.effort) >= 4) r.push("effort " + o.effort + "/5 would take most of a quarter");
    else if (num(o.effort) >= 3) r.push("effort " + o.effort + "/5 needs engineering time already committed to the top items");
    if (num(o.confidence) <= 3) r.push("confidence " + o.confidence + "/5, so the value estimate needs baseline data first");
    if (num(o.impact) <= 2) r.push("impact " + o.impact + "/5");
    r.push("score " + fmtScore(o) + " vs " + UI.fmt.dec(cutoff, 1) + " for the last funded slot");
    const s = r.join("; ");
    const lead = FLIGHT.includes(o.stage) ? "Pause at " + o.stage + ". " : "";
    return lead + s.charAt(0).toUpperCase() + s.slice(1) + ".";
  }

  function memoText() {
    const all = OPS.opps.all();
    const live = all.filter((o) => LIVE.includes(o.stage));
    const open = all.filter((o) => !LIVE.includes(o.stage)).sort(byRank);
    const material = open.filter((o) => value(o) >= FLOOR);
    const small = open.filter((o) => value(o) < FLOOR);
    const now = material.slice(0, 3), next = material.slice(3, 5), rest = material.slice(5);
    const cutoff = next.length ? score(next[next.length - 1]) : now.length ? score(now[now.length - 1]) : 0;
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const line = (o, i) => [
      `${i}. ${o.id} ${title(o)}`,
      `   Score ${fmtScore(o)} · ${UI.fmt.moneyK(value(o))}/yr · effort ${o.effort}/5 · ${o.risk || "Low"} risk · owner: ${o.owner || "unassigned"}`,
      `   Now in ${o.stage}: ${STAGE_ACTION[o.stage] || "confirm next step"}. Success = ${o.kpi || "KPI to be defined"}.`,
    ].join("\n");
    const out = [];
    out.push("PRIORITIZATION MEMO: operations improvement pipeline");
    out.push(`Prepared ${today} · ${all.length} opportunities · ${UI.fmt.moneyK(sum(all, value))}/yr total value${all.some((o) => o.source === "seed") ? " · example backlog (synthetic)" : ""}`);
    out.push("");
    out.push("How we ranked");
    out.push(`Score = (impact × confidence) ÷ effort, with a 15% haircut for High PHI/compliance risk. Ties go to higher annual value (hours/month × 12 × $${RATE} loaded + revenue). A funded slot needs at least ${FLOOR_TXT}/yr of value.`);
    out.push("");
    out.push("Do now (next 30 days)");
    out.push(now.length ? now.map((o, i) => line(o, i + 1)).join("\n") : "Nothing above the value floor yet. Run discovery on the backlog.");
    out.push("");
    if (next.length) {
      out.push("Do next (30 to 90 days)");
      out.push(next.map((o, i) => line(o, now.length + i + 1)).join("\n"));
      out.push("");
    }
    if (rest.length) {
      out.push("Not doing this quarter");
      rest.slice(0, 4).forEach((o) => out.push(`- ${o.id} ${title(o)} (${o.stage}, ${UI.fmt.moneyK(value(o))}/yr): ${whyNot(o, cutoff)}`));
      if (rest.length > 4) out.push(`- Plus ${rest.length - 4} more in the backlog, reviewed monthly.`);
      out.push("");
    }
    if (small.length) {
      out.push(`Fill-ins (under ${FLOOR_TXT}/yr; bundle into related work, no dedicated slot)`);
      small.slice(0, 4).forEach((o) => out.push(`- ${o.id} ${title(o)}: score ${fmtScore(o)}, ${UI.fmt.moneyK(value(o))}/yr.`));
      out.push("");
    }
    if (live.length) {
      out.push("Already live: keep measuring");
      live.forEach((o) => out.push(`- ${o.id} ${title(o)} (${o.stage}): ${o.stage === "Measured" ? "hand the KPI to the owner's monthly review" : "confirm the before/after result, then move to Measured"}.`));
      out.push("");
    }
    out.push("Ask");
    out.push(now.length ? `Approve the ${now.length} do-now items and confirm a metric owner for each by Friday. I will report each against its KPI in the weekly ops review.` : "Approve a discovery sprint on the top backlog items.");
    return out.join("\n");
  }

  function openMemo() {
    const text = memoText();
    const close = UI.modal({
      title: "Prioritization memo",
      body: `<p class="small muted">Generated from the current scores and values. It updates whenever the pipeline changes.</p><pre class="code wrap pl-memo">${UI.esc(text)}</pre>`,
      actions: [
        { label: "Close", onClick: (c) => c() },
        { label: "Copy memo", primary: true, onClick: () => UI.copy(text, "Memo copied") },
      ],
    });
    const closer = () => { modalClosers.delete(closer); close(); };
    modalClosers.add(closer);
  }

  // ---------- wiring ----------
  function wire() {
    const root = S.root;
    UI.wireSeg(root, "pl-view-seg", (v) => setView(v));
    UI.on(root, "click", "[data-open]", (e, el) => openDrawer(el.dataset.open, el));
    UI.on(root, "click", "[data-move]", (e, el) => { e.stopPropagation(); moveBy(el.dataset.id, +el.dataset.move); });
    UI.on(root, "click", "[data-view-go]", (e, el) => setView(el.dataset.viewGo));
    UI.on(root, "click", "#pl-add", () => openForm(null));
    UI.on(root, "click", "#pl-memo", () => openMemo());
    UI.on(root, "click", "[data-sort]", (e, el) => {
      const k = el.dataset.sort;
      if (S.sort.key === k) S.sort.dir = -S.sort.dir; else S.sort = { key: k, dir: SORTS[k].first };
      paintView();
      const b = root.querySelector(`[data-sort="${k}"]`);
      if (b) b.focus();
    });
    UI.on(root, "change", "#pl-dept", (e, el) => { S.dept = el.value; paintView(); const s = root.querySelector("#pl-dept"); if (s) s.focus(); });
    UI.on(root, "click", "[data-reset]", (e, el) => {
      const a = el.dataset.reset;
      if (a === "arm") { S.resetArmed = true; root.querySelector("#pl-reset").innerHTML = resetHtml(); const b = root.querySelector('[data-reset="cancel"]'); if (b) b.focus(); }
      else if (a === "cancel") { S.resetArmed = false; root.querySelector("#pl-reset").innerHTML = resetHtml(); const b = root.querySelector('[data-reset="arm"]'); if (b) b.focus(); }
      else if (a === "confirm") { S.resetArmed = false; closeDrawer(true); OPS.opps.reset(); UI.toast("Pipeline reset to the 12 example opportunities"); }
    });
    // HTML5 drag and drop between board columns
    UI.on(root, "dragstart", ".pl-card", (e, card) => {
      S.dragId = card.dataset.id;
      try { e.dataTransfer.setData("text/plain", card.dataset.id); e.dataTransfer.effectAllowed = "move"; } catch (err) { /* ignore */ }
      card.classList.add("is-dragging");
    });
    UI.on(root, "dragend", ".pl-card", (e, card) => {
      card.classList.remove("is-dragging");
      root.querySelectorAll(".pl-col.is-over").forEach((c) => c.classList.remove("is-over"));
    });
    UI.on(root, "dragover", ".pl-col", (e, col) => {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = "move"; } catch (err) { /* ignore */ }
      col.classList.add("is-over");
    });
    UI.on(root, "dragleave", ".pl-col", (e, col) => { if (!col.contains(e.relatedTarget)) col.classList.remove("is-over"); });
    UI.on(root, "drop", ".pl-col", (e, col) => {
      e.preventDefault();
      col.classList.remove("is-over");
      let id = "";
      try { id = e.dataTransfer.getData("text/plain"); } catch (err) { /* ignore */ }
      id = id || S.dragId;
      S.dragId = null;
      if (id) moveTo(id, col.dataset.stage);
    });
  }

  OPS.register({
    id: ID,
    title: "Opportunity Pipeline",
    stage: "prioritize",
    order: 10,
    icon: "list",
    eyebrow: "3 · Prioritize",
    summary: "Every improvement idea in one ranked backlog: scored the same way, valued in hours and dollars, owned by a named leader, and tracked from discovery to a measured result.",
    jd: [
      "Identified and prioritized a pipeline of high-impact opportunities",
      "Own initiatives from discovery through adoption and measurement",
      "Practical opportunities for AI, automation and low-code tools",
    ],
    render(root, ctx) {
      UI.style(ID, CSS);
      let view = UI.store.get("pipeline.view", "matrix");
      if (!["matrix", "board", "table"].includes(view)) view = "matrix";
      S = { root, ctx, view, sort: { key: "score", dir: -1 }, dept: "all", resetArmed: false, chart: null, focusAfter: null, dragId: null };
      root.innerHTML = `
        <div class="grid g-4" id="pl-kpis"></div>
        <div class="presenter-note">This is the backlog I would keep from week one. Every idea gets the same score and a dollar value, so the conversation with department leaders runs on evidence, and anyone can see why an item is ranked where it is.</div>
        <div class="panel">
          <div class="pl-toolbar">
            <div class="row">${UI.seg("pl-view-seg", [{ value: "matrix", label: "Matrix" }, { value: "board", label: "Board" }, { value: "table", label: "Table" }], view)}<span id="pl-example"></span></div>
            <div class="pl-actions">
              <button type="button" class="btn" id="pl-memo">${UI.icon("doc")} Prioritization memo</button>
              <button type="button" class="btn primary" id="pl-add">${UI.icon("plus")} Add opportunity</button>
            </div>
          </div>
          <div class="presenter-note">Top-left is where I start: high impact, low effort. Bilingual routing in Houston ranks first because the data already shows a 12-point conversion gap and the fix is a dialer rule. Switch to Board and I move cards as work progresses; nothing reaches Measured without a before/after number.</div>
          <div id="pl-view" class="stack" style="gap:12px"></div>
          <div class="pl-foot">
            <p class="xs muted pl-method">Score = (impact × confidence) ÷ effort, 1 to 5 scales; High PHI/compliance risk takes a 15% haircut. Annual value = hours saved per month × 12 × $${RATE} loaded rate + annual revenue impact. Edits save in this browser and feed the ROI model.</p>
            <div class="pl-reset" id="pl-reset"></div>
          </div>
        </div>
        <div class="presenter-note">The memo is the one-pager I would send leadership: what we do now, what comes next, and what we are choosing to skip this quarter, with the reason. Adding an idea scores it on the spot, so intake takes a minute.</div>`;
      wire();
      paint();
      onChange = () => { paint(); if (drawer) renderDrawer(); };
      document.addEventListener("ops:opps-changed", onChange);
      const focus = ctx.params && ctx.params.focus;
      if (focus && OPS.opps.get(focus)) openDrawer(focus);
    },
    destroy() {
      if (onChange) document.removeEventListener("ops:opps-changed", onChange);
      onChange = null;
      closeDrawer(true);
      Array.from(modalClosers).forEach((c) => { try { c(); } catch (e) { /* ignore */ } });
      modalClosers.clear();
      if (S && S.chart) { try { S.chart.destroy(); } catch (e) { /* ignore */ } }
      S = null;
    },
  });
})();
