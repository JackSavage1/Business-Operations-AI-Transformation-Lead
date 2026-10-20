/* Throughline: First 90 Days (plan).
 * Success statements → dated deliverables, three phases with an interactive checklist, a 13-week
 * Gantt of workstreams, a targets table computed from the last 4 weeks of data with editable
 * 90-day targets sized in visits / hours / dollars, operating cadence, and risks. */
(function () {
  "use strict";
  const UI = window.UI;
  const OPS = window.OPS;

  const DEFAULT_START = "2026-11-02";
  const KEY_START = "plan.start";
  const KEY_CHECKS = "plan.checks.v1";
  const KEY_TARGETS = "plan.targets.v1";

  // ---------- dates ----------
  const isISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T12:00:00Z"));
  function addDays(iso, n) {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  const dayDate = (start, day) => UI.fmt.date(addDays(start, day - 1));

  // ---------- content ----------
  const PHASES = [
    {
      id: "p1", days: [1, 30], name: "Learn & baseline",
      goal: "Understand how work moves from roster file to billed visit, agree the baseline numbers, and earn trust on the floor.",
      items: [
        { id: "p1a", text: "Meet every department leader; agree their top three priorities" },
        { id: "p1b", text: "Shadow outreach, scheduling, chart QA and billing (2 hours each)" },
        { id: "p1c", text: "Get read access: funnel, ACD interval data, scheduling export, QA results" },
        { id: "p1d", text: "Baseline KPI sheet signed off by each metric owner" },
        { id: "p1e", text: "Current-state map: roster → outreach → scheduling → visit → chart QA → billing" },
        { id: "p1f", text: "Day-30 readout: top pain points and the proposed 60-day bets" },
      ],
      who: ["COO / VP Operations", "Call center manager", "Scheduling lead", "Clinical director", "Finance ops", "Data engineering"],
      exit: "Baselines agreed for five KPIs, 20+ pain points logged, and leadership picks two quick wins and one AI pilot.",
    },
    {
      id: "p2", days: [31, 60], name: "Prioritize & ship quick wins",
      goal: "Rank the backlog with the owners, ship two changes the floor can feel, and start the AI pilot in shadow mode.",
      items: [
        { id: "p2a", text: "Score the backlog with owners; publish the ranked pipeline" },
        { id: "p2b", text: "Bilingual routing live in Houston with a callback SLA (OPP-03)" },
        { id: "p2c", text: "Weekly ops dashboard live; the Monday deck retired (OPP-07)" },
        { id: "p2d", text: "Compliance sign-off: BAA in place, minimum-necessary fields, redaction test" },
        { id: "p2e", text: "AI call-note drafting in shadow mode, scored against agent notes (OPP-02)" },
        { id: "p2f", text: "SOP and 15-minute training for each change; champions named" },
      ],
      who: ["Workforce manager", "Call center supervisors", "Ops analytics", "Privacy / compliance officer", "Engineering lead"],
      exit: "Two changes live with weekly active use of 70% or more, shadow-mode accuracy of 95% or more on sampled notes, zero PHI incidents.",
    },
    {
      id: "p3", days: [61, 90], name: "Scale one AI workflow & prove impact",
      goal: "Move the AI workflow to an assisted pilot, run the reminders pilot with a control, and show measured impact.",
      items: [
        { id: "p3a", text: "Assisted pilot: 6 agents confirm AI-drafted notes in one click" },
        { id: "p3b", text: "Risk-based reminders pilot in Phoenix with a control market (OPP-01)" },
        { id: "p3c", text: "Measure each pilot with difference-in-differences against its control" },
        { id: "p3d", text: "Stage-gate decision for each pilot: scale, fix or stop" },
        { id: "p3e", text: "Hand monitoring and ownership to the business for sustain" },
        { id: "p3f", text: "Day-90 impact ledger and next-quarter pipeline" },
      ],
      who: ["COO / VP Operations", "Call center manager", "Scheduling lead", "Engineering & data", "Finance (validates dollars)", "Customer success"],
      exit: "Measured effect on at least two KPIs against a control, a scale decision on the AI pilot, and an agreed next-quarter pipeline.",
    },
  ];

  const SUCCESS = [
    {
      s: "Strong understanding of several core business functions",
      d: [
        { day: 21, text: "Shadowed outreach, scheduling, clinical QA and billing; 20+ interviews logged", check: "p1b", page: "discovery" },
        { day: 30, text: "Current-state map from roster file to billed visit", check: "p1e", page: "workflow" },
        { day: 30, text: "Day-30 readout: what I learned and the top pain points", check: "p1f" },
      ],
    },
    {
      s: "Identified and prioritized a pipeline of high-impact opportunities",
      d: [
        { day: 35, text: "Scored backlog with owners, tools and PHI risk on every item", check: "p2a", page: "pipeline" },
        { day: 40, text: "Top three business cases sized in visits, hours and dollars", page: "roi" },
      ],
    },
    {
      s: "Independently implemented measurable process improvements",
      d: [
        { day: 45, text: "Bilingual routing live in Houston (OPP-03)", check: "p2b", page: "pipeline", params: { opp: "OPP-03" } },
        { day: 55, text: "Weekly ops dashboard replaces the Monday deck (OPP-07)", check: "p2c", page: "dashboard" },
        { day: 75, text: "Before/after readout against a control market", check: "p3c", page: "adoption" },
      ],
    },
    {
      s: "Collaborated with technical teams on a meaningful AI-enabled or automated workflow",
      d: [
        { day: 45, text: "AI call-note drafting in shadow mode with engineering and compliance (OPP-02)", check: "p2e", page: "ailab" },
        { day: 70, text: "Assisted pilot with 6 agents, human confirmation on every note", check: "p3a", page: "adoption" },
        { day: 70, text: "Reminders pilot on the scheduling-system API (OPP-01)", check: "p3b", page: "scheduling" },
      ],
    },
    {
      s: "Established clear metrics showing gains in efficiency, accuracy, speed or cost",
      d: [
        { day: 25, text: "Baseline KPI sheet signed off by owners", check: "p1d", page: "dashboard" },
        { day: 30, text: "90-day targets with a measurement method per KPI (table below)" },
        { day: 90, text: "Impact ledger: measured vs projected, with confidence labels", check: "p3f", page: "adoption" },
      ],
    },
  ];

  const CATS = ["Learn", "Quick wins", "AI & automation pilots", "Adopt & measure"];
  const GANTT = [
    { label: "Discovery interviews & shadowing", cat: 0, link: "discovery", bars: [{ from: 1, to: 4, text: "Interviews and shadowing" }, { from: 5, to: 6, text: "Follow-ups", light: true }] },
    { label: "Baseline metrics & dashboard", cat: 0, link: "dashboard", bars: [{ from: 2, to: 4, text: "Baseline sheet" }, { from: 5, to: 13, text: "Weekly refresh", light: true }] },
    { label: "Quick win: bilingual routing (OPP-03)", cat: 1, link: "pipeline", params: { opp: "OPP-03" }, bars: [{ from: 5, to: 6, text: "Build rule" }, { from: 7, to: 8, text: "Live in Houston" }, { from: 9, to: 13, text: "Measure", light: true, link: "adoption" }] },
    { label: "Quick win: weekly ops dashboard (OPP-07)", cat: 1, link: "dashboard", bars: [{ from: 4, to: 6, text: "Build" }, { from: 7, to: 8, text: "Retire deck" }] },
    { label: "AI call-note drafting (OPP-02)", cat: 2, link: "ailab", bars: [{ from: 5, to: 5, text: "BAA and PHI review", light: true }, { from: 6, to: 8, text: "Shadow" }, { from: 9, to: 13, text: "Assisted pilot, 6 agents" }] },
    { label: "Risk-based reminders pilot (OPP-01)", cat: 2, link: "scheduling", bars: [{ from: 7, to: 8, text: "Design and control", light: true }, { from: 9, to: 13, text: "Pilot in Phoenix" }] },
    { label: "Training & adoption", cat: 3, link: "adoption", bars: [{ from: 6, to: 8, text: "SOPs and champions", link: "sop" }, { from: 9, to: 13, text: "Office hours and nudges" }] },
    { label: "Measurement readouts", cat: 3, link: "adoption", weekly: true, milestones: [{ wk: 5, text: "Day 30" }, { wk: 9, text: "Day 60" }, { wk: 13, text: "Day 90" }], bars: [] },
  ];

  const RISKS = [
    { risk: "Data access takes weeks", like: "High", imp: "High", signal: "No read access to ACD, scheduling or QA data by day 10", mit: "Ask for exports on day 1, start from weekly CSVs, name a data owner per source, and flag blockers in the weekly update.", owner: "Me + data engineering" },
    { risk: "PHI and compliance approvals stall the AI pilot", like: "Medium", imp: "High", signal: "No privacy review date set by day 35", mit: "Bring the privacy officer in during week 2: BAA-covered model only, minimum-necessary field list, redaction test, audit log, and a human confirms every note.", owner: "Me + compliance officer" },
    { risk: "Engineering bandwidth", like: "High", imp: "Medium", signal: "Integration ask sits in the backlog for more than one sprint", mit: "Prototype on exports and low-code first, then bring engineering a tested spec with measured value and a small, scoped ask (one API, one rule).", owner: "Me + engineering lead" },
    { risk: "Change fatigue on the floor", like: "Medium", imp: "High", signal: "Pulse score under 3.5 or weekly active use dropping two weeks in a row", mit: "One change per team at a time, champions on each shift, 15-minute training, and a stop-doing list so new steps replace old ones.", owner: "Me + call center manager" },
    { risk: "Results get credited to noise", like: "Medium", imp: "Medium", signal: "Network-wide shifts (like the scheduling-system change) move the KPI during a pilot", mit: "A control market or team for every pilot, 4-week pre and post windows, and ranges reported with every effect.", owner: "Me + ops analytics" },
  ];

  const CADENCE = [
    { icon: "doc", h: "Weekly one-page update", when: "Fridays · async", who: "COO, department leads, pilot owners", items: ["KPIs vs target with a one-line why", "What shipped and what is next", "Blockers and decisions needed"], copy: true },
    { icon: "users", h: "Biweekly stakeholder check-in", when: "Every other week · 30 min per department", who: "Department leader + one frontline champion", items: ["Pain points from the floor", "Pilot feedback and adoption", "What we stop doing next"] },
    { icon: "chart", h: "Monthly leadership readout", when: "Day 30, 60, 90 · 45 min", who: "COO, finance, engineering, clinical, customer success", items: ["Impact ledger: measured vs projected", "Stage-gate decisions", "Asks: data, engineering time, approvals"] },
  ];

  // ---------- data ----------
  const SUMS = ["assigned", "attempts", "reached", "scheduled", "held", "cancels", "noShows", "completed", "chartsSubmitted", "chartsPassedQA", "billed", "revenue"];
  const avg = (arr, k) => arr.reduce((s, x) => s + (k ? x[k] : x), 0) / Math.max(1, arr.length);
  function rates(t) {
    const d = (a, b) => (b ? a / b : 0);
    t.scheduleRate = d(t.scheduled, t.reached);
    t.showRate = d(t.held, t.scheduled);
    t.completionRate = d(t.completed, t.held);
    t.qaPassRate = d(t.chartsPassedQA, t.chartsSubmitted);
    return t;
  }
  function baselines(data, q) {
    const last = data.weeks.length - 1;
    const L4 = { from: last - 3, to: last };
    const net = q.funnel(L4);
    const mk = {};
    q.by("market", L4).forEach((m) => (mk[m.id] = m));
    const rest = (id) => { const t = {}; SUMS.forEach((k) => (t[k] = net[k] - mk[id][k])); return rates(t); };
    const cw = data.callCenter.weekly;
    // detect the ACW step (scheduling-system change) rather than assume the week
    let k = 4, best = -Infinity;
    for (let i = 4; i <= cw.length - 4; i++) {
      const d = (avg(cw.slice(i), "acwSec") - avg(cw.slice(0, i), "acwSec")) * Math.sqrt((i * (cw.length - i)) / cw.length);
      if (d > best) { best = d; k = i; }
    }
    const cwL4 = cw.slice(-4);
    const opp7 = OPS.opps.get("OPP-07") || data.opportunitiesSeed.find((o) => o.id === "OPP-07") || { hoursSavedPerMonth: 28 };
    const hou = mk.hou, phx = mk.phx, tpa = mk.tpa;
    return {
      window: data.weeks[last - 3].label + "–" + data.weeks[last].label,
      hou: { base: hou.scheduleRate, rest: rest("hou").scheduleRate, reachedWk: hou.reached / 4, show: hou.showRate, comp: hou.completionRate, rev: hou.completed ? hou.revenue / hou.completed : 0, name: q.marketName("hou") },
      phx: { base: phx.showRate, rest: rest("phx").showRate, schedWk: phx.scheduled / 4, comp: phx.completionRate, rev: phx.completed ? phx.revenue / phx.completed : 0, name: q.marketName("phx") },
      acw: { base: avg(cwL4, "acwSec"), pre: avg(cw.slice(0, k), "acwSec"), changeWeek: cw[k].week, handledWk: avg(cwL4.map((w) => w.connects + w.inboundCalls * (1 - w.abandonRate))) },
      tpa: { base: tpa.qaPassRate, rest: rest("tpa").qaPassRate, submittedWk: tpa.chartsSubmitted / 4, name: q.marketName("tpa") },
      analyst: { base: (opp7.hoursSavedPerMonth || 0) / 4.33 + 0.5 },
    };
  }

  const r1 = (v) => Math.round(v * 10) / 10;
  const half = (v) => Math.round(v * 2) / 2;
  function kpiRows(B) {
    return [
      { id: "hou", kpi: `${B.hou.name} reached → scheduled`, unit: "%", dir: "up", base: B.hou.base * 100, def: half((B.hou.base + 0.5 * (B.hou.rest - B.hou.base)) * 100), step: 0.5,
        owner: "Workforce manager", method: `Scheduled ÷ reached from dialer dispositions, weekly; rest of network as control (now ${UI.fmt.pct(B.hou.rest)})`,
        impact: (t) => { const v = ((t - B.hou.base * 100) / 100) * B.hou.reachedWk * B.hou.show * B.hou.comp * 13; return { visits: v, dollars: v * B.hou.rev }; } },
      { id: "phx", kpi: `${B.phx.name} show rate`, unit: "%", dir: "up", base: B.phx.base * 100, def: half((B.phx.base + 0.5 * (B.phx.rest - B.phx.base)) * 100), step: 0.5,
        owner: "Scheduling lead", method: `Held ÷ scheduled, weekly; pilot vs a control market (rest of network now ${UI.fmt.pct(B.phx.rest)})`,
        impact: (t) => { const v = ((t - B.phx.base * 100) / 100) * B.phx.schedWk * B.phx.comp * 13; return { visits: v, dollars: v * B.phx.rev }; } },
      { id: "acw", kpi: "Network after-call work", unit: "sec", dir: "down", base: B.acw.base, def: Math.round(B.acw.base - 0.6 * (B.acw.base - B.acw.pre)), step: 1,
        owner: "Call center manager", method: `ACD after-call-work timer, weekly; AI pilot agents vs the rest of the floor (pre-${B.acw.changeWeek} level ${Math.round(B.acw.pre)}s)`,
        impact: (t) => ({ hours: ((B.acw.base - t) * B.acw.handledWk * 13) / 3600 }) },
      { id: "tpa", kpi: `${B.tpa.name} chart QA first-pass`, unit: "%", dir: "up", base: B.tpa.base * 100, def: half((B.tpa.base + 0.75 * (B.tpa.rest - B.tpa.base)) * 100), step: 0.5,
        owner: "Coding & QA lead", method: `Charts passed ÷ submitted on first submission, by clinician tenure (rest of network now ${UI.fmt.pct(B.tpa.rest)})`,
        impact: (t) => ({ charts: ((t - B.tpa.base * 100) / 100) * B.tpa.submittedWk * 13 }) },
      { id: "analyst", kpi: "Analyst hours on weekly reporting", unit: "hrs/wk", dir: "down", base: B.analyst.base, def: 1, step: 0.5,
        owner: "Ops analytics lead", method: "Two-week time log before launch, repeated at day 60 and 90 (baseline is the OPP-07 discovery estimate)",
        impact: (t) => ({ hours: (B.analyst.base - t) * 13 }) },
    ];
  }
  const fmtVal = (v, unit) => (unit === "%" ? r1(v).toFixed(1) + "%" : unit === "sec" ? Math.round(v) + "s" : r1(v).toFixed(1) + " hrs");

  // ---------- CSS ----------
  const CSS = `
  .plan-top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: end; }
  .plan-start { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
  .plan-start .field { width: 170px; }
  .plan-dates { display: flex; gap: 8px; flex-wrap: wrap; }
  .plan-dates span { font-size: var(--fs-xs); background: var(--surface-2); border-radius: 999px; padding: 3px 10px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .plan-dates b { color: var(--ink); font-weight: 600; }
  .plan-succ { display: grid; gap: 0; }
  .plan-succ-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 16px; padding: 14px 0; border-top: 1px solid var(--line); }
  .plan-succ-row:first-child { border-top: 0; padding-top: 2px; }
  .plan-succ-s { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 8px; align-items: start; }
  .plan-succ-n { width: 24px; height: 24px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-family: var(--font-mono); font-size: var(--fs-xs); font-weight: 600; display: grid; place-items: center; }
  .plan-succ-s p { font-family: var(--font-display); font-weight: 600; font-size: var(--fs-md); line-height: 1.35; }
  .plan-dl { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .plan-dl li { display: grid; grid-template-columns: 116px minmax(0, 1fr) auto; gap: 10px; align-items: baseline; font-size: var(--fs-sm); }
  .plan-day { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--ink-3); white-space: nowrap; }
  .plan-dl .plan-done { color: var(--good-ink); font-weight: 600; font-size: var(--fs-xs); white-space: nowrap; }
  .plan-link { font-weight: 600; text-decoration: none; white-space: nowrap; font-size: var(--fs-xs); }
  .plan-link:hover { text-decoration: underline; }
  .plan-phase { gap: 12px; }
  .plan-phase-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .plan-checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .plan-checks label { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 8px; align-items: start; font-size: var(--fs-sm); padding: 6px 8px; border-radius: var(--r-md); cursor: pointer; }
  .plan-checks label:hover { background: var(--surface-2); }
  .plan-checks input { margin: 3px 0 0; width: 16px; height: 16px; }
  .plan-checks input:checked + span { color: var(--ink-3); text-decoration: line-through; text-decoration-color: var(--line-strong); }
  .plan-tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .plan-tags .tag { white-space: normal; }
  .plan-progress { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: var(--fs-xs); color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .plan-gantt { display: grid; gap: 4px; }
  .plan-grow { display: grid; grid-template-columns: minmax(150px, 240px) minmax(0, 1fr); gap: 12px; align-items: center; }
  .plan-glabel { display: flex; gap: 8px; align-items: center; font-size: var(--fs-sm); font-weight: 500; min-width: 0; }
  .plan-glabel i { width: 10px; height: 10px; border-radius: 2px; flex: none; }
  .plan-gtrack { position: relative; display: grid; grid-template-columns: repeat(13, minmax(0, 1fr)); min-height: 32px; align-items: center; background-image: linear-gradient(to right, var(--line) 1px, transparent 1px); background-size: calc(100% / 13) 100%; border-right: 1px solid var(--line); }
  .plan-gtrack.plan-phase-band { min-height: 0; background: none; border: 0; gap: 0; }
  .plan-band { grid-row: 1; font-size: var(--fs-xs); font-weight: 600; color: var(--ink-2); padding: 4px 8px; background: var(--surface-2); border-left: 2px solid var(--accent); margin-right: 3px; border-radius: 0 4px 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .plan-wk { grid-row: 1; text-align: center; font-family: var(--font-mono); font-size: 0.6875rem; color: var(--ink-3); line-height: 1.25; padding: 2px 0; min-width: 0; overflow: hidden; }
  .plan-wk small { display: block; font-size: 0.625rem; color: var(--ink-3); opacity: .85; }
  .plan-bar { grid-row: 1; height: 24px; margin: 0 2px; border-radius: 4px; border-left: 3px solid transparent; display: flex; align-items: center; min-width: 0; padding: 0 7px; text-decoration: none; color: var(--ink); font-size: var(--fs-xs); font-weight: 600; }
  .plan-bar span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; }
  .plan-bar.light { font-weight: 500; color: var(--ink-2); border-left-style: dashed; }
  .plan-bar:hover { outline: 2px solid var(--focus); outline-offset: 1px; }
  .plan-tick { grid-row: 1; justify-self: center; width: 6px; height: 6px; border-radius: 50%; background: var(--line-strong); }
  .plan-ms { grid-row: 1; justify-self: center; display: flex; align-items: center; gap: 4px; font-size: var(--fs-xs); font-weight: 600; color: var(--ink); white-space: nowrap; text-decoration: none; position: relative; z-index: 1; background: var(--surface); padding: 0 3px; border-radius: 4px; }
  .plan-ms::before { content: ""; width: 10px; height: 10px; transform: rotate(45deg); background: var(--accent); border-radius: 2px; flex: none; }
  .plan-kpi td { font-size: var(--fs-sm); }
  .plan-kpi .plan-in { width: 92px; text-align: right; font-variant-numeric: tabular-nums; }
  .plan-kpi td.plan-kpi-name { font-weight: 600; min-width: 170px; }
  .plan-kpi td.plan-method { color: var(--ink-2); min-width: 220px; }
  .plan-dir { font-size: var(--fs-xs); color: var(--ink-3); font-weight: 400; display: block; }
  .plan-impact { font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .plan-impact.neg { color: var(--critical-ink); }
  .plan-totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .plan-cad { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .plan-cad-card { border: 1px solid var(--line); border-radius: var(--r-lg); padding: 14px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .plan-cad-card svg { width: 20px; height: 20px; color: var(--accent); }
  .plan-cad-card ul { margin: 0; padding-left: 18px; font-size: var(--fs-sm); color: var(--ink-2); display: grid; gap: 2px; }
  .plan-risk td { font-size: var(--fs-sm); }
  .plan-risk td.plan-risk-name { font-weight: 600; min-width: 160px; }
  .plan-risk td.plan-risk-mit { min-width: 260px; }
  .plan-risk td.plan-risk-sig { color: var(--ink-2); min-width: 180px; }
  @media (max-width: 1100px) {
    .plan-cad { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 900px) {
    .plan-top { grid-template-columns: minmax(0, 1fr); }
    .plan-succ-row { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .plan-grow { grid-template-columns: minmax(0, 1fr); gap: 2px; }
    .plan-grow + .plan-grow { margin-top: 6px; }
    .plan-glabel:empty { display: none; }
    .plan-wk small { display: none; }
    .plan-band { font-size: 0.625rem; padding: 3px 4px; }
  }
  @media (max-width: 700px) {
    .plan-dl li { grid-template-columns: minmax(0, 1fr) auto; }
    .plan-dl li .plan-day { grid-column: 1 / -1; }
    .plan-totals { grid-template-columns: minmax(0, 1fr); }
    .plan-bar { padding: 0 4px; font-size: 0.625rem; }
    .plan-ms { font-size: 0.625rem; }
    .plan-stack thead { display: none; }
    .plan-stack, .plan-stack tbody, .plan-stack tr, .plan-stack td { display: block; width: 100%; }
    .plan-stack tr { padding: 10px 0; border-bottom: 1px solid var(--line); }
    .plan-stack tr:last-child { border-bottom: 0; }
    .plan-stack td { border: 0 !important; padding: 3px 12px !important; min-width: 0 !important; text-align: left !important; }
    .plan-stack td::before { content: attr(data-label); display: block; font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 2px; }
    .plan-stack td.plan-nolabel::before { display: none; }
    .plan-stack tbody tr:hover td { background: transparent; }
  }`;

  // ---------- render ----------
  function render(root, ctx) {
    UI.style("plan", CSS);
    const { data, q } = ctx;
    const F = UI.fmt;
    const reg = (id) => OPS.modules().some((m) => m.id === id);
    const titleOf = (id) => { const m = OPS.modules().find((x) => x.id === id); return m ? m.title : id; };
    const link = (id, label, params) => {
      if (!id || !reg(id)) return "";
      const p = params ? ` data-params="${UI.esc(JSON.stringify(params))}"` : "";
      return `<a class="plan-link" href="#${id}" data-nav="${id}"${p}>${UI.esc(label || titleOf(id))} →</a>`;
    };

    let start = UI.store.get(KEY_START, DEFAULT_START);
    if (!isISO(start)) start = DEFAULT_START;
    let checks = UI.store.get(KEY_CHECKS, {});
    if (!checks || typeof checks !== "object") checks = {};
    const B = baselines(data, q);
    const ROWS = kpiRows(B);
    let targets = UI.store.get(KEY_TARGETS, {});
    if (!targets || typeof targets !== "object") targets = {};
    const tgt = (r) => (typeof targets[r.id] === "number" && isFinite(targets[r.id]) ? targets[r.id] : r.def);
    let resetArmed = false;

    root.innerHTML = `
      <div class="panel">
        <div class="plan-top">
          <div class="stack" style="gap:8px">
            <div class="label">Plan clock</div>
            <div class="plan-start">
              <label class="field" for="plan-start"><span>Start date (Day 1)</span><input class="input" type="date" id="plan-start" value="${UI.esc(start)}"></label>
              <div class="plan-dates" id="plan-dates"></div>
            </div>
          </div>
          <div class="stack" style="gap:6px;min-width:220px">
            <div class="label">Checklist progress</div>
            <div class="plan-progress"><div class="bar"><i id="plan-all-bar" style="width:0%"></i></div><span id="plan-all-txt"></span></div>
          </div>
        </div>
        <div class="presenter-note">This is the plan I would walk in with on day one. Change the start date and every milestone moves with it; the checklist is what I would hold myself to in our weekly one-on-ones.</div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>What success looks like → what I will deliver</h2><div class="panel-sub">Each of the role's five 90-day success statements, mapped to concrete deliverables and dates.</div></div></div>
        <div class="plan-succ" id="plan-succ"></div>
      </div>

      <div class="grid g-3" id="plan-phases"></div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>13-week timeline</h2><div class="panel-sub">Workstreams by week. Select a bar to open the page where that work lives.</div></div>
          <div class="legend">${CATS.map((c, i) => `<span><i style="background:${UI.series(i)}"></i>${UI.esc(c)}</span>`).join("")}</div>
        </div>
        <div class="plan-gantt" id="plan-gantt"></div>
        <div class="presenter-note">Two quick wins land by day 60 so the floor sees change early; the AI work starts in shadow mode while compliance review runs in parallel, so the pilot is never waiting on paperwork.</div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>90-day targets</h2><div class="panel-sub">Baselines are the last four weeks (${UI.esc(B.window)}) from the data. Edit a target to see what it is worth per quarter.</div></div>
          <button class="btn sm" type="button" id="plan-reset-targets">Reset targets</button>
        </div>
        <div id="plan-kpi"></div>
        <div class="plan-totals" id="plan-totals"></div>
        <div class="presenter-note">Every target has a baseline from the data, an owner and a measurement method agreed before we build. Try lowering the ACW target and watch the agent hours change; that is the conversation I would have with the call center manager.</div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>Operating cadence</h2><div class="panel-sub">How progress stays visible without adding meetings.</div></div></div>
        <div class="plan-cad">
          ${CADENCE.map((c) => `<div class="plan-cad-card">
            <div class="row" style="gap:8px">${UI.icon(c.icon)}<h3>${UI.esc(c.h)}</h3></div>
            <div class="xs muted">${UI.esc(c.when)}</div>
            <div class="small"><span class="muted">Audience:</span> ${UI.esc(c.who)}</div>
            <ul>${c.items.map((i) => `<li>${UI.esc(i)}</li>`).join("")}</ul>
            ${c.copy ? `<button class="btn sm" type="button" id="plan-copy-update" style="align-self:flex-start;margin-top:auto">${UI.icon("copy")}Copy this week's update</button>` : ""}
          </div>`).join("")}
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>Risks & mitigations</h2><div class="panel-sub">What is most likely to slow the plan, the early signal, and what I would do about it.</div></div></div>
        <div class="table-wrap"><table class="data plan-risk plan-stack">
          <thead><tr><th>Risk</th><th>Likelihood</th><th>Impact</th><th>Early signal</th><th>Mitigation</th><th>Owner</th></tr></thead>
          <tbody>${RISKS.map((r) => `<tr>
            <td class="plan-risk-name plan-nolabel" data-label="Risk">${UI.esc(r.risk)}</td>
            <td data-label="Likelihood">${UI.pill(r.like === "High" ? "serious" : "warning", r.like)}</td>
            <td data-label="Impact">${UI.pill(r.imp === "High" ? "serious" : "warning", r.imp)}</td>
            <td class="plan-risk-sig" data-label="Early signal">${UI.esc(r.signal)}</td>
            <td class="plan-risk-mit" data-label="Mitigation">${UI.esc(r.mit)}</td>
            <td data-label="Owner">${UI.esc(r.owner)}</td>
          </tr>`).join("")}</tbody>
        </table></div>
        <div class="presenter-note">The biggest risk to a plan like this is waiting on data and approvals, so I ask for both in week one and report blockers every Friday.</div>
      </div>`;

    // ---------- draw functions ----------
    const pctDone = (items) => items.filter((i) => checks[i.id]).length / Math.max(1, items.length);

    function drawDates() {
      root.querySelector("#plan-dates").innerHTML = [1, 30, 60, 90].map((d) => `<span>Day ${d} <b>${UI.esc(dayDate(start, d))}</b></span>`).join("");
    }

    function drawSuccess() {
      root.querySelector("#plan-succ").innerHTML = SUCCESS.map((s, i) => `<div class="plan-succ-row">
        <div class="plan-succ-s"><span class="plan-succ-n">${i + 1}</span><p>${UI.esc(s.s)}</p></div>
        <ul class="plan-dl">${s.d.map((d) => `<li>
          <span class="plan-day">Day ${d.day} · ${UI.esc(dayDate(start, d.day))}</span>
          <span>${UI.esc(d.text)}${d.check && checks[d.check] ? ` <span class="plan-done">● Done</span>` : ""}</span>
          ${link(d.page, "Open", d.params)}
        </li>`).join("")}</ul>
      </div>`).join("");
    }

    function drawPhases() {
      root.querySelector("#plan-phases").innerHTML = PHASES.map((p, i) => {
        const pc = pctDone(p.items);
        return `<div class="panel plan-phase">
          <div class="plan-phase-head"><span class="label">Days ${p.days[0]}–${p.days[1]} · ${UI.esc(dayDate(start, p.days[0]))} to ${UI.esc(dayDate(start, p.days[1]))}</span>${pc === 1 ? UI.pill("good", "Complete") : pc > 0 ? UI.pill("accent", "In progress") : UI.pill("neutral", "Not started")}</div>
          <h3>${i + 1}. ${UI.esc(p.name)}</h3>
          <p class="small muted">${UI.esc(p.goal)}</p>
          <div class="plan-progress"><div class="bar"><i style="width:${Math.round(pc * 100)}%"></i></div><span>${p.items.filter((x) => checks[x.id]).length} of ${p.items.length}</span></div>
          <ul class="plan-checks">${p.items.map((it) => `<li><label for="plan-ck-${it.id}"><input type="checkbox" id="plan-ck-${it.id}" data-check="${it.id}"${checks[it.id] ? " checked" : ""}><span>${UI.esc(it.text)}</span></label></li>`).join("")}</ul>
          <div class="stack" style="gap:6px"><span class="label">Stakeholders</span><div class="plan-tags">${p.who.map((w) => UI.tag(w)).join("")}</div></div>
          <div class="callout accent"><div><strong>Exit criteria.</strong> ${UI.esc(p.exit)}</div></div>
        </div>`;
      }).join("");
      const all = PHASES.reduce((a, p) => a.concat(p.items), []);
      const done = all.filter((i) => checks[i.id]).length;
      root.querySelector("#plan-all-bar").style.width = Math.round((done / all.length) * 100) + "%";
      root.querySelector("#plan-all-txt").textContent = `${done} of ${all.length} · ${Math.round((done / all.length) * 100)}%`;
    }

    function drawGantt() {
      const wkDates = Array.from({ length: 13 }, (_, i) => F.date(addDays(start, i * 7)));
      const bands = [
        { from: 1, to: 4, text: "Days 1–30 · Learn" },
        { from: 5, to: 9, text: "31–60 · Ship" },
        { from: 10, to: 13, text: "61–90 · Scale & prove" },
      ];
      const head = `<div class="plan-grow"><div class="plan-glabel"></div><div class="plan-gtrack plan-phase-band">${bands.map((b) => `<div class="plan-band" style="grid-column:${b.from} / ${b.to + 1}" title="${UI.esc(b.text)}">${UI.esc(b.text)}</div>`).join("")}</div></div>
        <div class="plan-grow"><div class="plan-glabel"></div><div class="plan-gtrack" style="background:none;border:0">${wkDates.map((d, i) => `<div class="plan-wk" style="grid-column:${i + 1}">W${i + 1}<small>${UI.esc(d)}</small></div>`).join("")}</div></div>`;
      const rows = GANTT.map((g) => {
        const col = UI.series(g.cat);
        const bars = g.bars.map((b) => {
          const target = b.link || g.link;
          const ok = reg(target);
          const params = b.link ? null : g.params;
          const tag = ok ? "a" : "div";
          const attrs = ok ? ` href="#${target}" data-nav="${target}"${params ? ` data-params="${UI.esc(JSON.stringify(params))}"` : ""}` : "";
          return `<${tag} class="plan-bar${b.light ? " light" : ""}"${attrs} style="grid-column:${b.from} / ${b.to + 1};background:${UI.alpha(col, b.light ? 0.1 : 0.22)};border-left-color:${col}" title="${UI.esc(g.label + ": " + b.text + " (W" + b.from + (b.to !== b.from ? "–W" + b.to : "") + ")")}"><span>${UI.esc(b.text)}</span></${tag}>`;
        }).join("");
        const ticks = g.weekly ? Array.from({ length: 13 }, (_, i) => i + 1).filter((w) => !(g.milestones || []).some((m) => m.wk === w)).map((w) => `<i class="plan-tick" style="grid-column:${w}" title="Weekly one-page update"></i>`).join("") : "";
        const ms = (g.milestones || []).map((m) => {
          const ok = reg(g.link);
          return ok ? `<a class="plan-ms" href="#${g.link}" style="grid-column:${m.wk}" title="${UI.esc(m.text)} readout">${UI.esc(m.text)}</a>` : `<span class="plan-ms" style="grid-column:${m.wk}">${UI.esc(m.text)}</span>`;
        }).join("");
        return `<div class="plan-grow"><div class="plan-glabel"><i style="background:${col}"></i><span>${UI.esc(g.label)}</span></div><div class="plan-gtrack">${bars}${ticks}${ms}</div></div>`;
      }).join("");
      root.querySelector("#plan-gantt").innerHTML = head + rows;
    }

    function impactText(r, t) {
      const im = r.impact(t);
      if (im.visits != null) return { html: `${im.visits < 0 ? "−" : "+"}${F.num(Math.abs(im.visits))} visits · ${F.moneyK(im.dollars)}`, neg: im.visits < 0 };
      if (im.hours != null) return { html: `${im.hours < 0 ? "−" : "+"}${F.num(Math.abs(im.hours))} hrs`, neg: im.hours < 0 };
      return { html: `${im.charts < 0 ? "−" : "+"}${F.num(Math.abs(im.charts))} charts`, neg: im.charts < 0 };
    }

    function drawKpis() {
      root.querySelector("#plan-kpi").innerHTML = `<div class="table-wrap"><table class="data plan-kpi plan-stack">
        <thead><tr><th>KPI</th><th class="num">Baseline</th><th class="num">90-day target</th><th class="num">Change</th><th class="num">Worth / quarter</th><th>Owner</th><th>How we measure</th></tr></thead>
        <tbody>${ROWS.map((r) => {
          const t = tgt(r);
          const ch = t - r.base;
          const im = impactText(r, t);
          const chTxt = r.unit === "%" ? F.pts(ch / 100) : r.unit === "sec" ? F.signed(ch, 0) + "s" : F.signed(ch, 1) + " hrs";
          return `<tr>
            <td class="plan-kpi-name plan-nolabel" data-label="KPI">${UI.esc(r.kpi)}<span class="plan-dir">${r.dir === "up" ? "▲ Higher is better" : "▼ Lower is better"}</span></td>
            <td class="num" data-label="Baseline (last 4 wks)">${UI.esc(fmtVal(r.base, r.unit))}</td>
            <td class="num" data-label="90-day target"><label class="sr-only" for="plan-t-${r.id}" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${UI.esc(r.kpi)} target</label><input class="input plan-in" type="number" id="plan-t-${r.id}" data-target="${r.id}" step="${r.step}" value="${UI.esc(String(r1(t)))}"> <span class="xs muted">${UI.esc(r.unit)}</span></td>
            <td class="num" data-label="Change" id="plan-ch-${r.id}">${UI.esc(chTxt)}</td>
            <td class="num" data-label="Worth / quarter"><span class="plan-impact${im.neg ? " neg" : ""}" id="plan-im-${r.id}">${im.html}</span></td>
            <td data-label="Owner">${UI.esc(r.owner)}</td>
            <td class="plan-method" data-label="How we measure">${UI.esc(r.method)}</td>
          </tr>`;
        }).join("")}</tbody></table></div>`;
      drawTotals();
    }

    function drawTotals() {
      let visits = 0, dollars = 0, hours = 0, charts = 0;
      ROWS.forEach((r) => {
        const im = r.impact(tgt(r));
        visits += im.visits || 0; dollars += im.dollars || 0; hours += im.hours || 0; charts += im.charts || 0;
      });
      root.querySelector("#plan-totals").innerHTML = [
        UI.kpi({ label: "Completed visits / quarter", value: (visits >= 0 ? "+" : "−") + F.num(Math.abs(visits)), foot: `${B.hou.name} + ${B.phx.name} targets` }),
        UI.kpi({ label: "Billed revenue / quarter", value: F.moneyK(dollars), foot: "at current revenue per completed visit" }),
        UI.kpi({ label: "Hours back / quarter", value: F.num(hours), foot: `agents + analyst · plus ${F.num(charts)} charts out of rework` }),
      ].join("");
    }

    function refreshRow(r) {
      const t = tgt(r);
      const ch = t - r.base;
      const im = impactText(r, t);
      const chTxt = r.unit === "%" ? F.pts(ch / 100) : r.unit === "sec" ? F.signed(ch, 0) + "s" : F.signed(ch, 1) + " hrs";
      root.querySelector("#plan-ch-" + r.id).textContent = chTxt;
      const el = root.querySelector("#plan-im-" + r.id);
      el.innerHTML = im.html;
      el.classList.toggle("neg", im.neg);
      drawTotals();
    }

    function weeklyUpdate() {
      const all = PHASES.reduce((a, p) => a.concat(p.items.map((i) => Object.assign({ phase: p }, i))), []);
      const done = all.filter((i) => checks[i.id]);
      const next = all.filter((i) => !checks[i.id]).slice(0, 3);
      const lines = [];
      lines.push(`# Ops improvement: weekly update`);
      lines.push(`Plan start ${dayDate(start, 1)} · Day 30 ${dayDate(start, 30)} · Day 60 ${dayDate(start, 60)} · Day 90 ${dayDate(start, 90)}`);
      lines.push("");
      lines.push(`## KPIs vs 90-day target (baseline ${B.window})`);
      lines.push(`| KPI | Baseline | Target | Owner |`);
      lines.push(`|---|---:|---:|---|`);
      ROWS.forEach((r) => lines.push(`| ${r.kpi} | ${fmtVal(r.base, r.unit)} | ${fmtVal(tgt(r), r.unit)} | ${r.owner} |`));
      lines.push("");
      lines.push(`## Shipped (${done.length} of ${all.length})`);
      if (done.length) done.forEach((d) => lines.push(`- ${d.text}`)); else lines.push(`- Nothing checked off yet`);
      lines.push("");
      lines.push(`## Next`);
      next.forEach((d) => lines.push(`- ${d.text} (Days ${d.phase.days[0]}–${d.phase.days[1]})`));
      lines.push("");
      lines.push(`## Blockers and decisions needed`);
      lines.push(`- Data access: confirm owners for ACD, scheduling and QA exports`);
      lines.push(`- Compliance: privacy review date for AI call-note drafting`);
      return lines.join("\n");
    }

    drawDates(); drawSuccess(); drawPhases(); drawGantt(); drawKpis();

    // ---------- events ----------
    root.querySelector("#plan-start").addEventListener("change", (e) => {
      const v = e.target.value;
      if (!isISO(v)) return;
      start = v;
      UI.store.set(KEY_START, start);
      drawDates(); drawSuccess(); drawPhases(); drawGantt();
    });
    UI.on(root, "change", "input[data-check]", (e, el) => {
      checks[el.dataset.check] = el.checked;
      if (!el.checked) delete checks[el.dataset.check];
      UI.store.set(KEY_CHECKS, checks);
      const id = el.id;
      drawPhases(); drawSuccess();
      const again = root.querySelector("#" + id);
      if (again) again.focus();
    });
    UI.on(root, "input", "input[data-target]", (e, el) => {
      const r = ROWS.find((x) => x.id === el.dataset.target);
      const v = parseFloat(el.value);
      if (!r || !isFinite(v)) return;
      targets[r.id] = v;
      UI.store.set(KEY_TARGETS, targets);
      refreshRow(r);
    });
    const resetBtn = root.querySelector("#plan-reset-targets");
    resetBtn.addEventListener("click", () => {
      if (!resetArmed) {
        resetArmed = true;
        resetBtn.textContent = "Confirm reset";
        resetBtn.classList.add("primary");
        setTimeout(() => { if (resetArmed) { resetArmed = false; resetBtn.textContent = "Reset targets"; resetBtn.classList.remove("primary"); } }, 4000);
        return;
      }
      resetArmed = false;
      targets = {};
      UI.store.set(KEY_TARGETS, targets);
      resetBtn.textContent = "Reset targets";
      resetBtn.classList.remove("primary");
      drawKpis();
      UI.toast("Targets reset to the defaults");
    });
    UI.on(root, "click", "a[data-nav]", (e, el) => {
      if (!el.dataset.params) return;
      e.preventDefault();
      let params = {};
      try { params = JSON.parse(el.dataset.params); } catch (err) { params = {}; }
      ctx.navigate(el.dataset.nav, params);
    });
    root.querySelector("#plan-copy-update").addEventListener("click", () => UI.copy(weeklyUpdate(), "Weekly update copied as Markdown"));
  }

  OPS.register({
    id: "plan",
    title: "First 90 Days",
    stage: "start",
    order: 2,
    icon: "flag",
    eyebrow: "Start here",
    summary: "A dated 90-day plan: learn and baseline, ship quick wins, then scale one AI-enabled workflow and prove its impact against targets set from the data.",
    jd: [
      "Identified and prioritized a pipeline of high-impact opportunities",
      "Collaborated with technical teams on an AI-enabled workflow",
      "Established clear metrics showing improvements",
    ],
    render,
  });
})();
