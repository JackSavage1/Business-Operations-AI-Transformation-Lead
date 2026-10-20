/* Throughline: Adoption & Impact.
 * A simulated rollout of three initiatives: adoption curves, pilot vs control KPI trends,
 * a difference-in-differences card with an editable calculator, an impact ledger (projected vs
 * measured with confidence labels), adoption nudges triggered by risk signals, and stage gates.
 * Pre-launch KPI values are the real synthetic data; post-launch pilot values add a modeled effect
 * scaled by weekly adoption so the measurement method can be shown end to end. */
(function () {
  "use strict";
  const UI = window.UI;
  const OPS = window.OPS;

  const KEY_SEL = "adoption.selected";
  const KEY_NUDGES = "adoption.nudges.v1";

  const STAGES = ["Shadow", "Pilot", "Scale", "Sustain"];

  // simulated rollout logs (weekly active users per week from launch, training, pulse survey)
  const INITS = [
    {
      id: "bilingual", opp: "OPP-03", name: "Bilingual routing", scope: "Houston outreach floor", launch: 17, stage: "Scale",
      eligible: 18, active: [7, 11, 14, 15, 16, 17, 16, 17, 17], trained: 18, pulse: 4.3, pulseN: 16,
      kpi: "Reached → scheduled", kpiShort: "schedule rate", unit: "pct", dir: "up", lift: 0.06,
      pilotLabel: "Houston",
      facts: { acc: true, phi: true, sop: true, ctrl: true, p1: true, owner: true, stop: false, review: false },
      factNotes: { stop: "Shared Spanish callback inbox still open as a fallback" },
      units: [{ name: "Outreach, English team", eligible: 13, active: 12 }, { name: "Outreach, bilingual team", eligible: 5, active: 5 }],
      stopDoing: ["English-only agents logging Spanish callbacks to the shared inbox", "Manual end-of-day callback list in a spreadsheet"],
    },
    {
      id: "sms", opp: "OPP-01", name: "Two-way SMS confirmations", scope: "Phoenix scheduling pilot", launch: 18, stage: "Pilot",
      eligible: 7, active: [3, 4, 5, 5, 6, 6, 6, 6], trained: 6, pulse: 4.1, pulseN: 7,
      kpi: "Show rate", kpiShort: "show rate", unit: "pct", dir: "up", lift: 0.065,
      pilotLabel: "Phoenix",
      facts: { acc: true, phi: true, sop: true, ctrl: true, p1: true, owner: false, stop: false, review: false },
      factNotes: {},
      units: [{ name: "Phoenix schedulers, pod A", eligible: 4, active: 4, trainedAll: true }, { name: "Phoenix schedulers, pod B", eligible: 3, active: 2, untrained: 1 }],
      stopDoing: ["One-way reminder blasts to members who already confirmed by text", "Confirmation calls to members with a two-way SMS reply"],
    },
    {
      id: "notes", opp: "OPP-02", name: "AI call-note drafting", scope: "Pilot team of 6 agents", launch: 22, shadowFrom: 20, stage: "Pilot",
      eligible: 6, active: [4, 4, 3, 4], trained: 6, pulse: 3.4, pulseN: 6,
      kpi: "After-call work", kpiShort: "ACW", unit: "sec", dir: "down", lift: -40,
      pilotLabel: "Pilot agents",
      facts: { acc: true, phi: true, sop: true, ctrl: true, p1: true, owner: false, stop: false, review: false },
      factNotes: { acc: "Shadow mode matched human disposition on 96% of 50 sampled notes" },
      agents: [
        { id: "AG103", share: 0.88, edit: 0.18 }, { id: "AG105", share: 0.81, edit: 0.21 }, { id: "AG108", share: 0.74, edit: 0.26 },
        { id: "AG111", share: 0.69, edit: 0.29 }, { id: "AG114", share: 0.31, edit: 0.57 }, { id: "AG116", share: 0.22, edit: 0.62 },
      ],
      stopDoing: ["Typing free-text notes when the AI draft is confirmed", "Re-keying the disposition into the CRM after the scheduler"],
    },
  ];

  const GATES = [
    { from: "Shadow", to: "Pilot", criteria: [
      { id: "acc", text: "Output matches a human reviewer on 95%+ of a 50-case sample (rule changes: tested on 2 weeks of history)" },
      { id: "phi", text: "PHI review passed: BAA in place, minimum-necessary fields, redaction tested" },
      { id: "sop", text: "SOP drafted and a champion named on every shift" },
      { id: "ctrl", text: "Baseline window and control group defined before launch" },
    ] },
    { from: "Pilot", to: "Scale", criteria: [
      { id: "adopt", text: "Weekly active use 70%+ for 2 consecutive weeks" },
      { id: "effect", text: "Effect measured against control; 95% range excludes zero" },
      { id: "pulse", text: "Pulse score 3.8+ out of 5" },
      { id: "train", text: "Training complete for 90%+ of eligible users" },
      { id: "p1", text: "No open P1 issues or PHI incidents" },
    ] },
    { from: "Scale", to: "Sustain", criteria: [
      { id: "owner", text: "Named business owner and a monitoring dashboard" },
      { id: "hold", text: "Effect holds for 4+ weeks at 70%+ use" },
      { id: "stop", text: "Old process retired; stop-doing list complete" },
      { id: "review", text: "Quarterly review on the calendar" },
    ] },
  ];

  const PLAYBOOK = [
    { icon: "users", h: "Champions", p: "One per shift, picked by peers, with 30 minutes a week protected. They hear problems first and demo the new way at huddles." },
    { icon: "book", h: "Role-based training", p: "15-minute modules for agents, supervisors and QA, practiced on synthetic calls. Completion tracked per person before go-live." },
    { icon: "calendar", h: "Office hours", p: "Twice a week for the first four weeks at the floor, then weekly. Every question logged and answered in the SOP." },
    { icon: "trend", h: "Feedback loop", p: "In-tool thumbs up or down with a reason, triaged weekly. A short 'you said, we did' note goes out every Friday." },
  ];

  // ---------- small helpers ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  const variance = (a) => { const m = mean(a); return a.length > 1 ? a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1) : 0; };
  const SUMS = ["reached", "scheduled", "held", "completed", "revenue"];

  // ---------- model ----------
  function buildModel(data, q) {
    const W = data.weeks.length, last = W - 1;
    const net = q.byWeek({});
    const L4 = { from: last - 3, to: last };
    const rnd = mulberry32(7310);
    const restRate = (mk, fn) => q.byWeek({ market: mk }).map((m, i) => {
      const t = {}; SUMS.forEach((k) => (t[k] = net[i][k] - m[k]));
      return fn(t);
    });
    const hou = q.byWeek({ market: "hou" });
    const phx = q.byWeek({ market: "phx" });
    const cw = data.callCenter.weekly;
    const houL4 = q.funnel(Object.assign({ market: "hou" }, L4));
    const phxL4 = q.funnel(Object.assign({ market: "phx" }, L4));
    const agents = data.callCenter.agents;

    return INITS.map((src, idx) => {
      const I = Object.assign({ idx }, src);
      I.adopt = (t) => (t < I.launch ? null : I.active[t - I.launch] / I.eligible);
      if (I.id === "bilingual") {
        I.control = restRate("hou", (t) => t.scheduled / t.reached);
        I.pilot = hou.map((w, t) => w.scheduleRate + (t >= I.launch ? I.lift * I.adopt(t) : 0));
        I.toBiz = (eff) => { const v = eff * (houL4.reached / 4) * houL4.showRate * houL4.completionRate * 13; return { visitsQ: v, dollarsY: v * 4 * (houL4.revenue / houL4.completed) }; };
        I.controlName = "Rest of network";
      } else if (I.id === "sms") {
        I.control = restRate("phx", (t) => t.held / t.scheduled);
        I.pilot = phx.map((w, t) => w.showRate + (t >= I.launch ? I.lift * I.adopt(t) : 0));
        I.toBiz = (eff) => { const v = eff * (phxL4.scheduled / 4) * phxL4.completionRate * 13; return { visitsQ: v, dollarsY: v * 4 * (phxL4.revenue / phxL4.completed) }; };
        I.controlName = "Rest of network";
      } else {
        I.control = cw.map((w) => w.acwSec);
        I.pilot = cw.map((w, t) => w.acwSec + 5 + (rnd() * 2 - 1) * 5 + (t >= I.launch ? I.lift * I.adopt(t) : 0));
        I.agentRows = I.agents.map((a) => Object.assign({}, a, agents.find((x) => x.id === a.id) || { name: a.id, team: "", callsPerWeek: 300 }));
        const pilotCalls = I.agentRows.reduce((s, a) => s + a.callsPerWeek, 0);
        const floorCalls = agents.filter((a) => /Outreach/.test(a.team)).reduce((s, a) => s + a.callsPerWeek, 0);
        I.toBiz = (eff) => ({ hoursM: (-eff * pilotCalls * 4.33) / 3600, floorHoursM: (-eff * floorCalls * 4.33) / 3600 });
        I.controlName = "Rest of the floor";
        I.units = I.agentRows.map((a) => ({ name: a.name + " · " + a.team.replace("Outreach — ", ""), eligible: 1, active: a.share >= 0.5 ? 1 : 0, share: a.share, edit: a.edit, agent: true }));
      }
      // measurement windows: 4 weeks before launch vs the last 4 weeks
      I.before = [I.launch - 4, I.launch - 1];
      I.after = [last - 3, last];
      const win = (arr, w) => arr.slice(w[0], w[1] + 1);
      I.m = {
        pB: mean(win(I.pilot, I.before)), pA: mean(win(I.pilot, I.after)),
        cB: mean(win(I.control, I.before)), cA: mean(win(I.control, I.after)),
      };
      const dB = win(I.pilot, I.before).map((v, i) => v - win(I.control, I.before)[i]);
      const dA = win(I.pilot, I.after).map((v, i) => v - win(I.control, I.after)[i]);
      I.effect = (I.m.pA - I.m.pB) - (I.m.cA - I.m.cB);
      I.naive = I.m.pA - I.m.pB;
      I.half = 2.45 * Math.sqrt(variance(dA) / dA.length + variance(dB) / dB.length); // t, 6 df
      const lo = I.effect - I.half, hi = I.effect + I.half;
      I.sig = I.dir === "up" ? lo > 0 : hi < 0;
      // adoption & gates
      const a = I.active.map((x) => x / I.eligible);
      I.adoptNow = a[a.length - 1];
      I.adoptPrev = a.length > 1 ? a[a.length - 2] : null;
      I.trainPct = I.trained / I.eligible;
      I.weeksAbove = a.filter((x) => x >= 0.7).length;
      const auto = {
        adopt: a.length >= 2 && a[a.length - 1] >= 0.7 && a[a.length - 2] >= 0.7,
        effect: I.sig,
        pulse: I.pulse >= 3.8,
        train: I.trainPct >= 0.9,
        hold: I.sig && I.weeksAbove >= 4,
      };
      I.met = (id) => (id in auto ? auto[id] : !!I.facts[id]);
      const reasons = [];
      if (!auto.adopt) reasons.push(`weekly active use ${UI.fmt.pct(I.adoptNow, 0)} (gate 70% two weeks running)`);
      if (I.pulse < 3.5) reasons.push(`pulse ${I.pulse.toFixed(1)} of 5`);
      if (!I.sig) reasons.push("effect not yet distinguishable from the control");
      I.atRisk = reasons.length > 0;
      I.reason = I.atRisk
        ? "At risk: " + reasons.join("; ") + "."
        : `On track: ${UI.fmt.pct(I.adoptNow, 0)} weekly active use, effect measured against control, pulse ${I.pulse.toFixed(1)}.`;
      I.stageIdx = STAGES.indexOf(I.stage);
      I.conf = I.sig && I.eligible >= 7 ? "Measured with control" : "Directional";
      I.confWhy = I.conf === "Measured with control" ? "The effect is separated from the control with a 95% range that excludes zero." : I.sig ? `The range excludes zero, but a ${I.eligible}-person pilot is too small to count as hard savings yet.` : "The 95% range still includes zero, so treat this as directional.";
      return I;
    });
  }

  function effectText(I, v) {
    if (I.unit === "pct") return UI.fmt.pts(v);
    return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(0) + "s";
  }
  const valText = (I, v) => (I.unit === "pct" ? UI.fmt.pct(v) : Math.round(v) + "s");
  function bizText(I, eff) {
    const b = I.toBiz(eff);
    const F = UI.fmt;
    if (b.visitsQ != null) return `${b.visitsQ >= 0 ? "+" : "−"}${F.num(Math.abs(b.visitsQ))} completed visits a quarter (${F.moneyK(b.dollarsY)} a year)`;
    return `${b.hoursM >= 0 ? "+" : "−"}${F.num(Math.abs(b.hoursM))} agent hours a month for the pilot team; about ${F.num(Math.max(0, b.floorHoursM))} a month across the outreach floor`;
  }

  // ---------- chart plugins ----------
  const font = () => "11px " + (UI.cssVar("--font-body") || "sans-serif");
  function markerPlugin(index, label) {
    return {
      id: "adoptMarker",
      afterDatasetsDraw(chart) {
        const x = chart.scales.x.getPixelForValue(index);
        const { top, bottom } = chart.chartArea;
        const c = chart.ctx;
        c.save();
        c.strokeStyle = UI.cssVar("--ink-2"); c.lineWidth = 1.5; c.setLineDash([4, 4]);
        c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
        c.setLineDash([]); c.fillStyle = UI.cssVar("--ink"); c.font = "600 " + font();
        const w = c.measureText(label).width;
        const tx = x + 6 + w > chart.chartArea.right ? x - 6 - w : x + 6;
        c.fillText(label, tx, top + 12);
        c.restore();
      },
    };
  }
  function bandsPlugin(bands) {
    return {
      id: "adoptBands",
      beforeDatasetsDraw(chart) {
        const xs = chart.scales.x;
        const step = Math.abs(xs.getPixelForValue(1) - xs.getPixelForValue(0)) / 2;
        const { top, bottom } = chart.chartArea;
        const c = chart.ctx;
        bands.forEach((b) => {
          if (b.to < 0) return;
          const x0 = xs.getPixelForValue(Math.max(0, b.from)) - step, x1 = xs.getPixelForValue(b.to) + step;
          c.save();
          c.fillStyle = UI.alpha(UI.cssVar("--ink-3"), 0.09);
          c.fillRect(x0, top, x1 - x0, bottom - top);
          c.fillStyle = UI.cssVar("--ink-2"); c.font = font();
          c.fillText(b.label, x0 + 9, bottom - 6);
          c.restore();
        });
      },
    };
  }
  function gateLinePlugin(value, label) {
    return {
      id: "adoptGate",
      afterDatasetsDraw(chart) {
        const y = chart.scales.y.getPixelForValue(value);
        const { left, right } = chart.chartArea;
        const c = chart.ctx;
        c.save();
        c.strokeStyle = UI.cssVar("--ink-3"); c.lineWidth = 1; c.setLineDash([3, 4]);
        c.beginPath(); c.moveTo(left, y); c.lineTo(right, y); c.stroke();
        c.setLineDash([]); c.fillStyle = UI.cssVar("--ink-2"); c.font = font();
        if (label) c.fillText(label, left + 6, y - 5);
        c.restore();
      },
    };
  }
  function endLabelsPlugin(fmt) {
    return {
      id: "adoptEnd",
      afterDatasetsDraw(chart) {
        const c = chart.ctx;
        c.save(); c.fillStyle = UI.cssVar("--ink-2"); c.font = "600 " + font(); c.textBaseline = "middle";
        chart.data.datasets.forEach((ds, i) => {
          const meta = chart.getDatasetMeta(i);
          if (meta.hidden) return;
          let k = ds.data.length - 1;
          while (k >= 0 && ds.data[k] == null) k--;
          if (k < 0) return;
          const pt = meta.data[k];
          c.fillText(fmt(ds.data[k]), pt.x + 7, pt.y);
        });
        c.restore();
      },
    };
  }

  // ---------- CSS ----------
  const CSS = `
  .adopt-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
  .adopt-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .adopt-card { text-align: left; font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--good); border-radius: var(--r-lg); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; cursor: pointer; min-width: 0; }
  .adopt-card.at-risk { border-left-color: var(--serious); }
  .adopt-card[aria-pressed="true"] { outline: 2px solid var(--accent); outline-offset: -1px; box-shadow: var(--shadow); }
  .adopt-card:hover { border-color: var(--line-strong); }
  .adopt-card h3 { font-size: var(--fs-md); }
  .adopt-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: 0; }
  .adopt-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
  .adopt-step { font-size: 0.6875rem; text-align: center; padding: 3px 0; border-radius: 4px; background: var(--surface-2); color: var(--ink-3); font-family: var(--font-mono); letter-spacing: .03em; }
  .adopt-step.done { background: var(--accent-soft); color: var(--accent); }
  .adopt-step.now { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .adopt-mini { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; }
  .adopt-mini div { min-width: 0; }
  .adopt-mini b { display: block; font-family: var(--font-display); font-size: 1.2rem; font-variant-numeric: tabular-nums; }
  .adopt-mini span { font-size: var(--fs-xs); color: var(--ink-3); }
  .adopt-reason { font-size: var(--fs-sm); color: var(--ink-2); }
  .adopt-did { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 18px; align-items: start; }
  .adopt-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .adopt-result { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: var(--r-md); background: var(--accent-soft); }
  .adopt-result b { font-family: var(--font-display); font-size: 1.6rem; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .adopt-formula { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--ink-2); overflow-wrap: anywhere; }
  .adopt-ledger td { font-size: var(--fs-sm); }
  .adopt-ledger td.adopt-l-name { font-weight: 600; min-width: 170px; }
  .adopt-pm { display: flex; flex-direction: column; gap: 1px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .adopt-pm .xs { color: var(--ink-3); }
  .adopt-nudges td { font-size: var(--fs-sm); }
  .adopt-nudges td.adopt-n-sig { font-weight: 600; min-width: 170px; }
  .adopt-nudges td.adopt-n-act { min-width: 220px; }
  .adopt-play { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .adopt-play > div { border: 1px solid var(--line); border-radius: var(--r-md); padding: 12px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .adopt-play svg { width: 18px; height: 18px; color: var(--accent); }
  .adopt-play p, .adopt-play li { font-size: var(--fs-sm); color: var(--ink-2); }
  .adopt-play ul { margin: 0; padding-left: 18px; display: grid; gap: 3px; }
  .adopt-gates { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .adopt-gate { border: 1px solid var(--line); border-radius: var(--r-md); padding: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .adopt-gate.is-next { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .adopt-gate.is-later { opacity: .75; }
  .adopt-crit { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .adopt-crit li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 6px; font-size: var(--fs-sm); align-items: start; }
  .adopt-crit .adopt-mark { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; margin-top: 1px; }
  .adopt-mark.ok { background: var(--good-soft); color: var(--good-ink); }
  .adopt-mark.no { background: var(--serious-soft); color: var(--serious-ink); }
  .adopt-mark.na { background: var(--surface-2); color: var(--ink-3); }
  .adopt-crit .xs { display: block; color: var(--ink-3); }
  @media (max-width: 1100px) {
    .adopt-cards { grid-template-columns: minmax(0, 1fr); }
    .adopt-gates { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 900px) {
    .adopt-did { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 700px) {
    .adopt-stack thead { display: none; }
    .adopt-stack, .adopt-stack tbody, .adopt-stack tr, .adopt-stack td { display: block; width: 100%; }
    .adopt-stack tr { padding: 10px 0; border-bottom: 1px solid var(--line); }
    .adopt-stack tr:last-child { border-bottom: 0; }
    .adopt-stack td { border: 0 !important; padding: 3px 12px !important; min-width: 0 !important; text-align: left !important; }
    .adopt-stack td::before { content: attr(data-label); display: block; font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 2px; }
    .adopt-stack td.adopt-nolabel::before { display: none; }
    .adopt-stack tbody tr:hover td { background: transparent; }
  }`;

  // ---------- render ----------
  function render(root, ctx) {
    UI.style("adoption", CSS);
    const { data, q } = ctx;
    const F = UI.fmt;
    const M = buildModel(data, q);
    const weeks = data.weeks;
    let sel = UI.store.get(KEY_SEL, "notes");
    if (!M.some((i) => i.id === sel)) sel = "notes";
    let nudgeLog = UI.store.get(KEY_NUDGES, {});
    if (!nudgeLog || typeof nudgeLog !== "object") nudgeLog = {};
    let calc = null;
    let kpiChart = null;

    root.innerHTML = `
      <div class="callout warning"><div><strong>Simulated rollout.</strong> Before each launch week the KPI lines are the real synthetic data. After launch, the pilot line adds a modeled effect scaled by that week's adoption, and adoption, training and pulse come from a simulated rollout log. The method is the point: this is how I would track and prove a real rollout.</div></div>

      <div class="adopt-cards" id="adopt-cards" role="group" aria-label="Initiatives"></div>
      <div class="presenter-note">Three initiatives from the 90-day plan, tracked the way I would run them: weekly active use, training, a pulse score and a primary KPI against a control. Note that the AI pilot is flagged at risk; I would rather say that in week 3 than discover it at day 90.</div>

      <div class="grid g-2">
        <div class="panel">
          <div class="panel-head"><div><h2>Adoption curves</h2><div class="panel-sub">Weekly active users ÷ eligible users, from each launch week. Dashed line: the 70% scale gate.</div></div></div>
          <div class="chart-box"><canvas id="adopt-c-curves" aria-label="Adoption curves for three initiatives"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h2 id="adopt-kpi-title">Primary KPI</h2><div class="panel-sub" id="adopt-kpi-sub"></div></div></div>
          <div class="chart-box"><canvas id="adopt-c-kpi" aria-label="Pilot vs control KPI trend"></canvas></div>
        </div>
      </div>

      <div class="panel" id="adopt-did-panel"></div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>Impact ledger</h2><div class="panel-sub">Projected value from the business case next to what was measured, with how much to trust each number.</div></div>
          <button class="btn sm" type="button" id="adopt-copy-ledger">${UI.icon("copy")}Copy as Markdown</button>
        </div>
        <div id="adopt-ledger"></div>
        <div class="presenter-note">This ledger is what I would bring to finance: projected next to measured, and a confidence label on every line. Only numbers measured against a control get counted as hard savings.</div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>Adoption risk signals → nudges</h2><div class="panel-sub">Rules evaluated on this week's usage. Each triggered signal names who and what to do.</div></div>
        </div>
        <div id="adopt-nudges"></div>
        <div id="adopt-units"></div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>Adoption playbook</h2><div class="panel-sub">Adoption is the product: these run alongside every rollout.</div></div></div>
        <div class="adopt-play">
          ${PLAYBOOK.map((p) => `<div><div class="row" style="gap:8px">${UI.icon(p.icon)}<h3>${UI.esc(p.h)}</h3></div><p>${UI.esc(p.p)}</p></div>`).join("")}
          <div><div class="row" style="gap:8px">${UI.icon("x")}<h3>Stop-doing list</h3></div><p>Each rollout retires an old step, so the new way replaces work instead of adding to it. Stop:</p><ul>${M.map((i) => i.stopDoing[0]).concat(["Building the Monday ops deck by hand"]).map((s) => `<li>${UI.esc(s)}</li>`).join("")}</ul></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>Stage gates</h2><div class="panel-sub" id="adopt-gate-sub"></div></div></div>
        <div class="adopt-gates" id="adopt-gates"></div>
        <div class="presenter-note">Nothing scales on enthusiasm. Each gate has criteria the business owner and I agree on before launch, and the page checks the measurable ones automatically.</div>
      </div>`;

    // ---------- cards ----------
    function drawCards() {
      root.querySelector("#adopt-cards").innerHTML = M.map((I) => `
        <button type="button" class="adopt-card${I.atRisk ? " at-risk" : ""}" data-sel="${I.id}" aria-pressed="${I.id === sel}">
          <div class="row between" style="gap:6px">
            <h3><span class="adopt-swatch" style="background:${UI.series(I.idx)}"></span>${UI.esc(I.name)}</h3>
            ${I.atRisk ? UI.pill("serious", "At risk") : UI.pill("good", "On track")}
          </div>
          <div class="xs muted">${UI.esc(I.scope)} · ${UI.esc(I.opp)} · launched ${UI.esc(weeks[I.shadowFrom != null ? I.shadowFrom : I.launch].label)}${I.shadowFrom != null ? ` (shadow), assisted ${UI.esc(weeks[I.launch].label)}` : ""}</div>
          <div class="adopt-steps">${STAGES.map((s, k) => `<span class="adopt-step${k < I.stageIdx ? " done" : k === I.stageIdx ? " now" : ""}">${s}</span>`).join("")}</div>
          <div class="adopt-mini">
            <div><b>${F.pct(I.adoptNow, 0)}</b><span>weekly active (${I.active[I.active.length - 1]} of ${I.eligible})</span></div>
            <div><b>${F.pct(I.trainPct, 0)}</b><span>training complete</span></div>
            <div><b>${I.pulse.toFixed(1)}<small class="xs muted"> / 5</small></b><span>pulse score (n=${I.pulseN})</span></div>
            <div><b>${effectText(I, I.effect)}</b><span>${UI.esc(I.kpiShort)} vs control</span></div>
          </div>
          <p class="adopt-reason">${UI.esc(I.reason)}</p>
        </button>`).join("");
    }

    // ---------- charts ----------
    function drawCurves() {
      const from = Math.min.apply(null, M.map((I) => I.launch));
      const idx = [];
      for (let t = from; t < weeks.length; t++) idx.push(t);
      UI.chart("adopt-c-curves", {
        type: "line",
        data: {
          labels: idx.map((t) => weeks[t].label),
          datasets: M.map((I) => ({
            label: I.name, data: idx.map((t) => I.adopt(t)), borderColor: UI.series(I.idx), backgroundColor: UI.series(I.idx),
            pointRadius: 2.5, pointHoverRadius: 5, spanGaps: false, borderWidth: 2,
          })),
        },
        options: {
          layout: { padding: { right: 34 } },
          scales: { y: { min: 0, max: 1, ticks: { callback: UI.pctTick, stepSize: 0.25 } }, x: { grid: { display: false } } },
          plugins: { tooltip: { callbacks: { label: (c) => (c.parsed.y == null ? "" : ` ${c.dataset.label}: ${F.pct(c.parsed.y, 0)}`) } } },
        },
        plugins: [gateLinePlugin(0.7, ""), endLabelsPlugin((v) => F.pct(v, 0))],
      });
    }

    function drawKpi() {
      const I = M.find((x) => x.id === sel);
      const from = Math.max(0, I.before[0] - 5);
      const idx = [];
      for (let t = from; t < weeks.length; t++) idx.push(t);
      root.querySelector("#adopt-kpi-title").textContent = `${I.kpi}: ${I.pilotLabel} vs control`;
      root.querySelector("#adopt-kpi-sub").textContent = `${I.name}. Shaded: the 4 weeks before launch and the last 4 weeks, the windows used for the measurement below.`;
      if (kpiChart) { try { kpiChart.destroy(); } catch (e) { /* ignore */ } }
      const muted = UI.cssVar("--chart-muted");
      kpiChart = UI.chart("adopt-c-kpi", {
        type: "line",
        data: {
          labels: idx.map((t) => weeks[t].label),
          datasets: [
            { label: I.pilotLabel + " (pilot)", data: idx.map((t) => I.pilot[t]), borderColor: UI.series(I.idx), backgroundColor: UI.series(I.idx), borderWidth: 2 },
            { label: I.controlName + " (control)", data: idx.map((t) => I.control[t]), borderColor: muted, backgroundColor: muted, borderDash: [5, 4], borderWidth: 2 },
          ],
        },
        options: {
          layout: { padding: { right: 8 } },
          scales: { y: I.unit === "pct" ? { ticks: { callback: UI.pctTick } } : { ticks: { callback: (v) => v + "s" } }, x: { grid: { display: false } } },
          plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${valText(I, c.parsed.y)}` } } },
        },
        plugins: [
          bandsPlugin([{ from: I.before[0] - from, to: I.before[1] - from, label: "Before" }, { from: I.after[0] - from, to: I.after[1] - from, label: "After" }]),
          markerPlugin(I.launch - from, (I.shadowFrom != null ? "Assisted pilot " : "Launch ") + weeks[I.launch].label),
        ],
      });
    }

    // ---------- difference in differences ----------
    const toInput = (I, v) => (I.unit === "pct" ? +(v * 100).toFixed(1) : Math.round(v));
    const fromInput = (I, v) => (I.unit === "pct" ? v / 100 : v);
    function drawDid() {
      const I = M.find((x) => x.id === sel);
      calc = { pB: toInput(I, I.m.pB), pA: toInput(I, I.m.pA), cB: toInput(I, I.m.cB), cA: toInput(I, I.m.cA) };
      const u = I.unit === "pct" ? "%" : "sec";
      const inp = (k, label) => `<label class="field" for="adopt-in-${k}"><span>${UI.esc(label)}</span><input class="input" type="number" step="${I.unit === "pct" ? 0.1 : 1}" id="adopt-in-${k}" data-calc="${k}" value="${calc[k]}"></label>`;
      root.querySelector("#adopt-did-panel").innerHTML = `
        <div class="panel-head">
          <div><h2>Difference-in-differences · ${UI.esc(I.name)}</h2><div class="panel-sub">Pilot change minus control change. The control absorbs anything that moved the whole operation at the same time.</div></div>
          <span title="${UI.esc(I.confWhy)}">${UI.pill(I.conf === "Measured with control" ? "good" : "warning", I.conf)}</span>
        </div>
        <div class="adopt-did">
          <div class="stack">
            ${UI.table([
              { key: "g", label: "Group", fmt: (v, r) => `${UI.esc(v)}<span class="xs muted" style="display:block">${UI.esc(r.sub)}</span>` },
              { key: "b", label: "Before", num: true },
              { key: "a", label: "After", num: true },
              { key: "d", label: "Change", num: true },
            ], [
              { g: "Pilot", sub: I.pilotLabel, b: valText(I, I.m.pB), a: valText(I, I.m.pA), d: effectText(I, I.m.pA - I.m.pB) },
              { g: "Control", sub: I.controlName, b: valText(I, I.m.cB), a: valText(I, I.m.cA), d: effectText(I, I.m.cA - I.m.cB) },
            ])}
            <p class="xs muted">Before: ${UI.esc(weeks[I.before[0]].label)}–${UI.esc(weeks[I.before[1]].label)}, the 4 weeks before launch. After: ${UI.esc(weeks[I.after[0]].label)}–${UI.esc(weeks[I.after[1]].label)}, the last 4 weeks.</p>
            <div class="adopt-result">
              <span class="label">Measured effect on ${UI.esc(I.kpiShort)}</span>
              <b>${effectText(I, I.effect)}</b>
              <span class="small">95% range ${effectText(I, I.effect - I.half)} to ${effectText(I, I.effect + I.half)} · ${UI.esc(bizText(I, I.effect))}</span>
            </div>
            <p class="small muted">${UI.esc(I.confWhy)} A plain before/after on the pilot alone would claim ${effectText(I, I.naive)}. The ${effectText(I, I.naive - I.effect).replace(/^\+/, "")} difference is movement the control saw too, which the pilot did not cause.</p>
          </div>
          <div class="panel inset" style="gap:10px">
            <div class="row between"><h3>Try the method</h3><button class="btn sm" type="button" id="adopt-calc-reset">Use measured values</button></div>
            <div class="adopt-grid2">
              ${inp("pB", `Pilot before (${u})`)}${inp("pA", `Pilot after (${u})`)}
              ${inp("cB", `Control before (${u})`)}${inp("cA", `Control after (${u})`)}
            </div>
            <div id="adopt-calc-out" aria-live="polite"></div>
          </div>
        </div>
        <div class="presenter-note">This is the slide I would show the COO. Edit the control's after value and watch the claimed effect change: without a control, any network-wide shift gets credited to the pilot.</div>`;
      drawCalc();
    }
    function drawCalc() {
      const I = M.find((x) => x.id === sel);
      const v = (k) => fromInput(I, calc[k]);
      const pc = v("pA") - v("pB"), cc = v("cA") - v("cB"), eff = pc - cc;
      const good = I.dir === "up" ? eff > 0 : eff < 0;
      root.querySelector("#adopt-calc-out").innerHTML = `
        <div class="adopt-formula">(${valText(I, v("pA"))} − ${valText(I, v("pB"))}) − (${valText(I, v("cA"))} − ${valText(I, v("cB"))})</div>
        <div class="adopt-formula">= ${effectText(I, pc)} − (${effectText(I, cc)}) = <strong>${effectText(I, eff)}</strong></div>
        <div class="small">${good ? UI.pill("good", "Improvement") : Math.abs(eff) < 1e-9 ? UI.pill("neutral", "No effect") : UI.pill("critical", "Worse than control")} <span style="margin-left:6px">${UI.esc(bizText(I, eff))}</span></div>`;
    }

    // ---------- ledger ----------
    function ledgerRows() {
      const opp = (id) => OPS.opps.get(id) || data.opportunitiesSeed.find((o) => o.id === id) || {};
      const rows = [];
      M.forEach((I) => {
        const o = opp(I.opp);
        const b = I.toBiz(I.effect);
        let revPerVisit = 1;
        if (I.id !== "notes") { const bb = I.toBiz(0.01); revPerVisit = bb.visitsQ ? bb.dollarsY / (bb.visitsQ * 4) : 1; }
        const conf = I.conf;
        rows.push({
          name: I.name, opp: I.opp,
          hrsP: o.hoursSavedPerMonth || 0, hrsM: I.id === "notes" ? b.hoursM : null,
          visP: I.id === "notes" ? null : (o.revenueImpactAnnual || 0) / revPerVisit / 4, visM: b.visitsQ != null ? b.visitsQ : null,
          usdP: o.revenueImpactAnnual || 0, usdM: b.dollarsY != null ? b.dollarsY : null,
          conf, note: I.id === "sms" ? "Projection covers Phoenix and Charlotte; measured is the Phoenix pilot" : I.id === "notes" ? `Pilot team only (n=${I.eligible}); full floor ≈ ${F.num(Math.max(0, b.floorHoursM))} hrs/month` : "",
        });
      });
      const o7 = opp("OPP-07");
      rows.push({ name: "Weekly ops dashboard", opp: "OPP-07", hrsP: o7.hoursSavedPerMonth || 0, hrsM: ((6.9 - 1.5) * 4.33), visP: null, visM: null, usdP: o7.revenueImpactAnnual || 0, usdM: null, conf: "Directional", note: "Analyst time log, 6.9 → 1.5 hrs/week (simulated); no control group" });
      const o4 = opp("OPP-04");
      rows.push({ name: "Roster reconciliation", opp: "OPP-04", hrsP: o4.hoursSavedPerMonth || 0, hrsM: null, visP: null, visM: null, usdP: o4.revenueImpactAnnual || 0, usdM: null, conf: "Projected", note: "Not built yet; value from the business case" });
      return rows;
    }
    function drawLedger() {
      const rows = ledgerRows();
      const pm = (p, m, fmt) => `<div class="adopt-pm"><span>${m == null ? `<span class="muted">—</span>` : fmt(m)}</span><span class="xs">proj. ${p == null || p === 0 ? "—" : fmt(p)}</span></div>`;
      const confPill = (c) => UI.pill(c === "Measured with control" ? "good" : c === "Directional" ? "warning" : "neutral", c);
      const meas = rows.filter((r) => r.conf === "Measured with control");
      const tv = meas.reduce((s, r) => s + (r.visM || 0), 0), tu = meas.reduce((s, r) => s + (r.usdM || 0), 0);
      const dh = rows.filter((r) => r.conf === "Directional").reduce((s, r) => s + (r.hrsM || 0), 0);
      root.querySelector("#adopt-ledger").innerHTML = `
        <div class="grid g-3" style="margin-bottom:14px">
          ${UI.kpi({ label: "Measured with control · visits / quarter", value: "+" + F.num(tv), foot: `${meas.length} initiative${meas.length === 1 ? "" : "s"}` })}
          ${UI.kpi({ label: "Measured with control · revenue / year", value: F.moneyK(tu), foot: "at current revenue per completed visit" })}
          ${UI.kpi({ label: "Directional · hours / month", value: F.num(dh), foot: "not counted as hard savings yet" })}
        </div>
        <div class="table-wrap"><table class="data adopt-ledger adopt-stack">
          <thead><tr><th>Initiative</th><th class="num">Hours / month</th><th class="num">Visits / quarter</th><th class="num">$ / year</th><th>Confidence</th><th>Note</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td class="adopt-l-name adopt-nolabel" data-label="Initiative">${UI.esc(r.name)} <span class="xs muted">${UI.esc(r.opp)}</span></td>
            <td class="num" data-label="Hours / month">${pm(r.hrsP, r.hrsM, (v) => F.num(v))}</td>
            <td class="num" data-label="Visits / quarter">${pm(r.visP, r.visM, (v) => (v >= 0 ? "+" : "−") + F.num(Math.abs(v)))}</td>
            <td class="num" data-label="$ / year">${pm(r.usdP, r.usdM, (v) => F.moneyK(v))}</td>
            <td data-label="Confidence">${confPill(r.conf)}</td>
            <td class="small muted" data-label="Note">${UI.esc(r.note)}</td>
          </tr>`).join("")}</tbody></table></div>`;
      return rows;
    }
    function ledgerMarkdown() {
      const rows = ledgerRows();
      const f = (v, fn) => (v == null || v === 0 ? "—" : fn(v));
      const L = ["| Initiative | Hours/month (measured / projected) | Visits/quarter (measured / projected) | $/year (measured / projected) | Confidence |", "|---|---:|---:|---:|---|"];
      rows.forEach((r) => L.push(`| ${r.name} (${r.opp}) | ${f(r.hrsM, F.num)} / ${f(r.hrsP, F.num)} | ${f(r.visM, F.num)} / ${f(r.visP, F.num)} | ${f(r.usdM, F.moneyK)} / ${f(r.usdP, F.moneyK)} | ${r.conf} |`));
      return "## Impact ledger (simulated rollout)\n\n" + L.join("\n");
    }

    // ---------- nudges ----------
    function signals() {
      const out = [];
      M.forEach((I) => {
        I.units.forEach((u) => {
          const use = u.share != null ? u.share : u.active / u.eligible;
          if (use < 0.5) out.push({ key: `${I.id}:low:${u.name}`, sig: "Weekly active use under 50%", who: `${I.name} · ${u.name}`, val: F.pct(use, 0), act: "Floor walk plus a 15-minute refresher at the desk; pair with a champion for one shift." });
          if (u.edit != null && u.edit > 0.4) out.push({ key: `${I.id}:edit:${u.name}`, sig: "AI draft edit rate over 40%", who: `${I.name} · ${u.name}`, val: F.pct(u.edit, 0), act: "Pull 10 heavily edited drafts, fix the prompt or template (Spanish-language calls first), re-test in shadow." });
          if (u.untrained) out.push({ key: `${I.id}:train:${u.name}`, sig: "Training incomplete 2+ weeks after launch", who: `${I.name} · ${u.name}`, val: `${u.untrained} not trained`, act: "Manager assigns the module in the next 1:1; 15-minute make-up session this week." });
        });
        if (I.pulse < 3.5) out.push({ key: `${I.id}:pulse`, sig: "Pulse score under 3.5", who: I.name, val: I.pulse.toFixed(1) + " / 5", act: "30-minute listening session with the pilot team; publish 'you said, we did' within a week." });
        if (I.adoptPrev != null && I.adoptPrev - I.adoptNow >= 0.15) out.push({ key: `${I.id}:drop`, sig: "Use dropped 15+ points week over week", who: I.name, val: F.pts(I.adoptNow - I.adoptPrev), act: "Check for a system change or outage before coaching anyone." });
      });
      return out;
    }
    function drawNudges() {
      const S = signals();
      root.querySelector("#adopt-nudges").innerHTML = S.length ? `<div class="table-wrap"><table class="data adopt-nudges adopt-stack">
        <thead><tr><th>Signal</th><th>Where</th><th class="num">Now</th><th>Nudge</th><th>Status</th></tr></thead>
        <tbody>${S.map((s) => `<tr>
          <td class="adopt-n-sig adopt-nolabel" data-label="Signal">${UI.pill("warning", "Triggered")} ${UI.esc(s.sig)}</td>
          <td data-label="Where">${UI.esc(s.who)}</td>
          <td class="num" data-label="Now">${UI.esc(s.val)}</td>
          <td class="adopt-n-act" data-label="Nudge">${UI.esc(s.act)}</td>
          <td data-label="Status">${nudgeLog[s.key] ? `<button class="btn sm ghost" type="button" data-nudge="${UI.esc(s.key)}">${UI.icon("check")}Logged</button>` : `<button class="btn sm" type="button" data-nudge="${UI.esc(s.key)}">Log nudge</button>`}</td>
        </tr>`).join("")}</tbody></table></div>` : `<div class="empty">No adoption risk signals this week.</div>`;
      const I = M.find((x) => x.id === sel);
      root.querySelector("#adopt-units").innerHTML = `<div class="stack" style="margin-top:6px">
        <h3>${UI.esc(I.name)}: usage by ${I.units[0] && I.units[0].agent ? "agent" : "team"} this week</h3>
        ${UI.table([
          { key: "name", label: I.units[0] && I.units[0].agent ? "Agent" : "Team" },
          { key: "use", label: "Weekly use", num: true, fmt: (v) => F.pct(v, 0) },
          { key: "bar", label: "", fmt: (v, r) => `<div class="bar" style="min-width:90px" role="img" aria-label="${F.pct(r.use, 0)}"><i style="width:${Math.round(r.use * 100)}%;${r.use < 0.5 ? "background:var(--serious)" : ""}"></i></div>` },
          { key: "extra", label: I.id === "notes" ? "Draft edit rate" : "Active / eligible", num: true },
          { key: "flag", label: "Signal", fmt: (v) => (v ? UI.pill("warning", v) : UI.pill("good", "OK")) },
        ], I.units.map((u) => {
          const use = u.share != null ? u.share : u.active / u.eligible;
          return { name: u.name, use, bar: "", extra: u.edit != null ? F.pct(u.edit, 0) : `${u.active} / ${u.eligible}`, flag: use < 0.5 ? "Low use" : u.edit > 0.4 ? "Heavy edits" : u.untrained ? "Training gap" : "" };
        }))}
      </div>`;
    }

    // ---------- gates ----------
    function drawGates() {
      const I = M.find((x) => x.id === sel);
      const nextGate = I.stageIdx; // gate k moves stage k → k+1
      root.querySelector("#adopt-gate-sub").textContent = nextGate < GATES.length
        ? `${I.name} is in ${I.stage}. Next gate: ${GATES[nextGate].from} → ${GATES[nextGate].to}, ${GATES[nextGate].criteria.filter((c) => I.met(c.id)).length} of ${GATES[nextGate].criteria.length} criteria met.`
        : `${I.name} is in ${I.stage}.`;
      root.querySelector("#adopt-gates").innerHTML = GATES.map((g, k) => {
        const passed = k < nextGate, isNext = k === nextGate;
        const metN = g.criteria.filter((c) => I.met(c.id)).length;
        return `<div class="adopt-gate${isNext ? " is-next" : ""}${k > nextGate ? " is-later" : ""}">
          <div class="row between" style="gap:6px"><h3>${g.from} → ${g.to}</h3>${passed ? UI.pill("good", "Passed") : isNext ? UI.pill(metN === g.criteria.length ? "good" : "accent", `${metN} of ${g.criteria.length} met`) : UI.pill("neutral", "Later")}</div>
          <ul class="adopt-crit">${g.criteria.map((c) => {
            const ok = passed || (isNext && I.met(c.id));
            const cls = passed || isNext ? (ok ? "ok" : "no") : "na";
            const glyph = cls === "ok" ? "✓" : cls === "no" ? "!" : "○";
            const note = isNext ? critNote(I, c.id) : (passed && I.factNotes[c.id]) || "";
            return `<li><span class="adopt-mark ${cls}" aria-label="${cls === "ok" ? "Met" : cls === "no" ? "Not met" : "Later"}">${glyph}</span><span>${UI.esc(c.text)}${note ? `<span class="xs">${UI.esc(note)}</span>` : ""}</span></li>`;
          }).join("")}</ul>
        </div>`;
      }).join("");
    }
    function critNote(I, id) {
      const a = I.active.map((x) => x / I.eligible);
      if (id === "adopt") return `Last two weeks: ${a.slice(-2).map((x) => F.pct(x, 0)).join(", ")}`;
      if (id === "effect") return `${effectText(I, I.effect)} (95% range ${effectText(I, I.effect - I.half)} to ${effectText(I, I.effect + I.half)})`;
      if (id === "pulse") return `Now ${I.pulse.toFixed(1)} (n=${I.pulseN})`;
      if (id === "train") return `${I.trained} of ${I.eligible} trained`;
      if (id === "hold") return `${I.weeksAbove} weeks at 70%+ use`;
      return I.factNotes[id] || "";
    }

    function select(id) {
      sel = id;
      UI.store.set(KEY_SEL, sel);
      root.querySelectorAll(".adopt-card").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sel === sel)));
      drawKpi(); drawDid(); drawNudges(); drawGates();
    }

    drawCards(); drawCurves(); drawKpi(); drawDid(); drawLedger(); drawNudges(); drawGates();

    // ---------- events ----------
    UI.on(root, "click", "[data-sel]", (e, el) => select(el.dataset.sel));
    UI.on(root, "input", "[data-calc]", (e, el) => {
      const v = parseFloat(el.value);
      if (!isFinite(v)) return;
      calc[el.dataset.calc] = v;
      drawCalc();
    });
    UI.on(root, "click", "#adopt-calc-reset", () => drawDid());
    UI.on(root, "click", "[data-nudge]", (e, el) => {
      const k = el.dataset.nudge;
      if (nudgeLog[k]) delete nudgeLog[k]; else { nudgeLog[k] = new Date().toISOString().slice(0, 10); UI.toast("Nudge logged for this week"); }
      UI.store.set(KEY_NUDGES, nudgeLog);
      drawNudges();
    });
    root.querySelector("#adopt-copy-ledger").addEventListener("click", () => UI.copy(ledgerMarkdown(), "Impact ledger copied as Markdown"));
  }

  OPS.register({
    id: "adoption",
    title: "Adoption & Impact",
    stage: "adopt",
    order: 20,
    icon: "users",
    summary: "Rollout tracking for three initiatives: adoption curves, pilot vs control measurement, nudges when use drops, stage gates, and an impact ledger that separates measured from projected.",
    jd: [
      "Own initiatives through implementation, adoption and measurement",
      "Quantify the impact of process improvements",
      "Attention to validation, adoption, and measurable outcomes",
    ],
    render,
  });
})();
