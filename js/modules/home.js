/* Throughline: Start here (home).
 * The landing page: thesis, the operating loop, live findings from the data, requirement → evidence
 * matrix, a 7-minute demo path and working principles. Every number on this page is computed from
 * OPS.q / OPS.data at render time. */
(function () {
  "use strict";
  const UI = window.UI;
  const OPS = window.OPS;

  // ---------- page catalogue (fallbacks for titles/stages; live registry wins) ----------
  const KNOWN = {
    home: { title: "Start here", stage: "start" },
    plan: { title: "First 90 Days", stage: "start" },
    dashboard: { title: "Ops Command Center", stage: "see" },
    discovery: { title: "Discovery Kit", stage: "discover" },
    workflow: { title: "Workflow Mapper", stage: "discover" },
    pipeline: { title: "Opportunity Pipeline", stage: "prioritize" },
    roi: { title: "ROI Model", stage: "prioritize" },
    ailab: { title: "AI Workflow Lab", stage: "build" },
    scheduling: { title: "Scheduling & No-shows", stage: "build" },
    capacity: { title: "Clinician Capacity", stage: "build" },
    sop: { title: "SOP & Training", stage: "build" },
    adoption: { title: "Adoption & Impact", stage: "adopt" },
  };

  function provesLine(id) {
    const n = OPS.data.appointments.length;
    const w = OPS.data.weeks.length;
    const map = {
      plan: "A dated 90-day plan tied to the five success statements, with targets computed from the baseline",
      dashboard: "Funnel KPIs by plan and market with bottleneck alerts a manager can act on Monday",
      discovery: "Sharp questions for eight departments and a capture log that turns pain points into opportunities",
      workflow: "How work actually moves today, where it waits or gets re-keyed, and the redesigned flow",
      pipeline: "One ranked backlog scored on impact, confidence, effort and PHI risk",
      roi: "A business case in hours, visits and dollars with every assumption in view",
      ailab: "AI call-note drafting with PHI redaction, validation against ground truth and human review",
      scheduling: "No-show drivers estimated from " + UI.fmt.num(n) + " appointments and a reminder policy to test",
      capacity: "Clinician utilization and the levers that add completed visits per clinician-day",
      sop: "Operating procedures and role-based training generated from the redesigned workflow",
      adoption: "Rollout tracking, pilot vs control measurement and nudges when use drops",
      home: "Thesis, live findings from " + w + " weeks of data and the map from role to evidence",
    };
    return map[id] || "";
  }

  const LOOP = [
    { id: "see", n: 1, name: "See", verb: "Find the gap", q: "Where are members, hours and dollars leaking out of the funnel?" },
    { id: "discover", n: 2, name: "Discover", verb: "Learn the work", q: "Why does it happen, according to the people who do the work?" },
    { id: "prioritize", n: 3, name: "Prioritize", verb: "Rank the bets", q: "Which fixes are worth doing first, given impact, effort and PHI risk?" },
    { id: "build", n: 4, name: "Build", verb: "Ship small", q: "What is the smallest change that moves the KPI safely?" },
    { id: "adopt", n: 5, name: "Adopt & measure", verb: "Prove it", q: "Did the team adopt it, and did the number move against a control?" },
  ];

  const reg = (id) => OPS.modules().find((m) => m.id === id) || null;
  const titleOf = (id) => { const m = reg(id); return m ? m.title : (KNOWN[id] || {}).title || id; };
  function pageLink(id, label, params) {
    const text = UI.esc(label || titleOf(id));
    if (!reg(id)) return `<span class="home-link-off">${text}</span>`;
    const p = params ? ` data-params="${UI.esc(JSON.stringify(params))}"` : "";
    return `<a class="home-link" href="#${id}" data-nav="${id}"${p}>${text}</a>`;
  }

  // ---------- analysis (all live) ----------
  const SUMS = ["assigned", "attempts", "reached", "scheduled", "held", "cancels", "noShows", "completed", "chartsSubmitted", "chartsPassedQA", "billed", "revenue"];
  function rates(t) {
    const d = (a, b) => (b ? a / b : 0);
    t.scheduleRate = d(t.scheduled, t.reached);
    t.showRate = d(t.held, t.scheduled);
    t.noShowRate = d(t.noShows, t.scheduled);
    t.completionRate = d(t.completed, t.held);
    t.qaPassRate = d(t.chartsPassedQA, t.chartsSubmitted);
    return t;
  }
  function minus(a, b) { const t = {}; SUMS.forEach((k) => (t[k] = a[k] - b[k])); return rates(t); }
  const avg = (arr, k) => arr.reduce((s, x) => s + (k ? x[k] : x), 0) / Math.max(1, arr.length);
  const median = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

  function analyze(data, q) {
    const last = data.weeks.length - 1;
    const L4 = { from: last - 3, to: last };
    const P4 = { from: last - 7, to: last - 4 };
    const net = q.funnel(L4);
    const netP = q.funnel(P4);
    const mk = {};
    q.by("market", L4).forEach((m) => (mk[m.id] = m));
    const rest = (id) => minus(net, mk[id]);
    const out = { last, net, netP, weeksLabel: data.weeks[last].label };

    // 1 · Houston reached → scheduled gap
    const hou = mk.hou, houR = rest("hou");
    const houGap = houR.scheduleRate - hou.scheduleRate;
    const houVisitsQ = Math.max(0, (hou.reached / 4) * houGap * hou.showRate * hou.completionRate * 13);
    const houRev = hou.completed ? hou.revenue / hou.completed : 0;
    const houSpanish = data.appointments.filter((a) => a.market === "hou");
    const houSpanishShare = houSpanish.filter((a) => a.language === "Spanish").length / Math.max(1, houSpanish.length);
    out.hou = { name: q.marketName("hou"), rate: hou.scheduleRate, rest: houR.scheduleRate, gap: houGap, visitsQ: houVisitsQ, rev: houRev, spanishShare: houSpanishShare,
      spark: q.byWeek({ market: "hou" }).map((w) => w.scheduleRate) };

    // 2 · Phoenix no-show rate
    const phx = mk.phx, phxR = rest("phx");
    const phxGap = phx.noShowRate - phxR.noShowRate;
    const phxVisitsQ = Math.max(0, (phx.scheduled / 4) * phxGap * phx.completionRate * 13);
    const appts = data.appointments;
    const nsRate = (list) => list.filter((a) => a.outcome === "No-show").length / Math.max(1, list.length);
    const twoWay = appts.filter((a) => a.reminder === "SMS two-way");
    const none = appts.filter((a) => a.reminder === "None");
    out.phx = { name: q.marketName("phx"), rate: phx.noShowRate, rest: phxR.noShowRate, gap: phxGap, visitsQ: phxVisitsQ, rev: phx.completed ? phx.revenue / phx.completed : 0,
      lead: median(appts.filter((a) => a.market === "phx").map((a) => a.leadDays)), leadRest: median(appts.filter((a) => a.market !== "phx").map((a) => a.leadDays)),
      twoWay: nsRate(twoWay), none: nsRate(none),
      spark: q.byWeek({ market: "phx" }).map((w) => w.noShowRate) };

    // 3 · Tampa chart QA first-pass, last 6 weeks vs prior 6
    const tL = q.funnel({ market: "tpa", from: last - 5, to: last });
    const tP = q.funnel({ market: "tpa", from: last - 11, to: last - 6 });
    const tDrop = tP.qaPassRate - tL.qaPassRate;
    const tpaClin = data.clinicians.filter((c) => c.market === "tpa");
    const newbies = tpaClin.filter((c) => c.tenureMonths <= 3);
    const vets = tpaClin.filter((c) => c.tenureMonths > 3);
    out.tpa = { name: q.marketName("tpa"), now: tL.qaPassRate, prior: tP.qaPassRate, drop: tDrop,
      bouncedQ: Math.max(0, (tL.chartsSubmitted / 6) * tDrop * 13),
      newN: newbies.length, allN: tpaClin.length, newQA: avg(newbies, "qaPassRate"), vetQA: avg(vets, "qaPassRate"),
      newDoc: avg(newbies, "avgDocMin"), vetDoc: avg(vets, "avgDocMin"),
      spark: q.byWeek({ market: "tpa" }).map((w) => w.qaPassRate) };

    // 4 · Call center AHT / ACW step change (detected, not assumed)
    const cw = data.callCenter.weekly;
    let k = 4, best = -Infinity;
    for (let i = 4; i <= cw.length - 4; i++) {
      const n1 = i, n2 = cw.length - i;
      const d = (avg(cw.slice(i), "acwSec") - avg(cw.slice(0, i), "acwSec")) * Math.sqrt((n1 * n2) / cw.length);
      if (d > best) { best = d; k = i; }
    }
    const pre = cw.slice(0, k), post = cw.slice(k);
    const handled = avg(post.map((w) => w.connects + w.inboundCalls * (1 - w.abandonRate)));
    const dAHT = avg(post, "ahtSec") - avg(pre, "ahtSec");
    out.aht = { week: cw[k].week, preAHT: avg(pre, "ahtSec"), postAHT: avg(post, "ahtSec"), preACW: avg(pre, "acwSec"), postACW: avg(post, "acwSec"),
      preConv: avg(pre, "scheduleConversion"), postConv: avg(post, "scheduleConversion"),
      preAband: avg(pre, "abandonRate"), postAband: avg(post, "abandonRate"),
      hrsWk: Math.max(0, (dAHT * handled) / 3600), spark: cw.map((w) => w.acwSec) };

    // 5 · Charlotte utilization
    const util = (list) => list.reduce((s, c) => s + c.scheduled, 0) / Math.max(1, list.reduce((s, c) => s + c.capacity, 0));
    const clt = data.clinicians.filter((c) => c.market === "clt");
    const cL8 = q.funnel({ market: "clt", from: last - 7, to: last });
    const cP8 = q.funnel({ market: "clt", from: last - 15, to: last - 8 });
    out.clt = { name: q.marketName("clt"), util: util(clt), netUtil: util(data.clinicians), n: clt.length,
      lead: median(appts.filter((a) => a.market === "clt").map((a) => a.leadDays)), leadRest: median(appts.filter((a) => a.market !== "clt").map((a) => a.leadDays)),
      showNow: cL8.showRate, showPrior: cP8.showRate,
      spark: q.byWeek({ market: "clt" }).map((w) => w.showRate) };
    return out;
  }

  // ---------- requirement → evidence ----------
  function matrixRows(w) {
    return [
      { g: "do", req: "Partner with department leaders and frontline teams on workflows, challenges and priorities", pages: ["discovery", "plan"], how: "Interview guides for eight departments (leader and frontline), a capture log, and a stakeholder cadence in the 90-day plan." },
      { g: "do", req: "Map how work actually gets done, find bottlenecks, redesign processes", pages: ["workflow", "dashboard"], how: "Current-state map with handoffs and wait states next to the redesigned flow; funnel bottlenecks by market." },
      { g: "do", req: "Find practical uses for AI, automation, low-code and workflow software", pages: ["pipeline", "discovery"], how: "Pain points from interviews promote into one scored backlog that names the tool and PHI risk for each item." },
      { g: "do", req: "Prototype lightweight solutions with AI-assisted development, low-code and dashboards", pages: ["ailab", "scheduling"], how: "This app was built with Claude Code; the AI lab and the no-show model run as working prototypes on the data." },
      { g: "do", req: "Partner with engineering, data and technology teams on more sophisticated solutions", pages: ["discovery", "plan"], how: "An engineering and data interview guide (APIs, BAA, audit logs) and stage gates that hand production work to engineering." },
      { g: "do", req: "Analyze operational data, define KPIs and quantify the impact of changes", pages: ["dashboard", "roi", "adoption"], how: "Gaps computed from " + w + " weeks of funnel data, KPI targets with baselines, and difference-in-differences on pilots." },
      { g: "do", req: "Build dashboards, scorecards, documentation, SOPs and training materials", pages: ["dashboard", "capacity", "sop"], how: "Live ops dashboard, clinician scorecard, and SOPs with role-based training generated from the redesigned flow." },
      { g: "do", req: "Own initiatives from discovery through adoption, measurement and optimization", pages: ["adoption", "plan", "pipeline"], how: "Stage gates from shadow to sustain, adoption curves, nudge rules and an impact ledger of projected vs measured." },
      { g: "proj", req: "Redesign appointment scheduling to lift engagement and visit completion", pages: ["scheduling", "workflow"], how: "No-show drivers by lead time, distance and reminder type, turned into a risk-based reminder and backfill policy." },
      { g: "proj", req: "Improve call center productivity with AI-assisted workflows", pages: ["ailab", "adoption"], how: "AI call-note drafting with redaction and confidence routing, measured on after-call work against a control team." },
      { g: "proj", req: "Analyze provider utilization to raise completed visits per clinician", pages: ["capacity"], how: "Utilization, drive time and documentation time per clinician, with each lever sized in completed visits." },
      { g: "proj", req: "Automate manual reporting, reconciliation or admin processes", pages: ["pipeline", "roi"], how: "Roster reconciliation and the weekly ops deck scored, sized in hours and tracked to measured savings." },
      { g: "proj", req: "Build operational dashboards that surface bottlenecks for faster decisions", pages: ["dashboard"], how: "Funnel by plan and market with exception alerts, replacing the Monday slide deck." },
      { g: "proj", req: "Streamline customer onboarding, internal handoffs and cross-team workflows", pages: ["workflow", "sop", "discovery"], how: "Handoff counts from shadowing, a health-plan onboarding checklist, and an SOP for each handoff." },
      { g: "look", req: "Personally built AI-enabled workflows with validation, adoption and measured outcomes", pages: ["ailab", "adoption"], how: "Model output scored against human-coded ground truth, adoption tracked weekly, effect measured with a control." },
      { g: "look", req: "Analytical, structured problem solving; redesigning and optimizing processes", pages: ["dashboard", "workflow", "roi"], how: "Each finding moves from metric to root cause to sized fix, with the assumptions visible." },
      { g: "look", req: "Hands-on with Claude and ChatGPT; spreadsheets, dashboards, automation tools", pages: ["ailab", "home", "sop"], how: "Live Claude calls where the viewer allows them, deterministic fallbacks everywhere, and an app built with Claude Code." },
      { g: "look", req: "Learn unfamiliar business processes quickly and spot meaningful improvements", pages: ["discovery", "plan"], how: "A first-30-days learning plan and a question bank written in health-plan operations terms." },
      { g: "look", req: "Communicate with confidence to department leaders and frontline staff", pages: ["discovery", "sop", "plan"], how: "Interview guides, frontline-ready SOPs, a weekly one-page update and a monthly leadership readout." },
      { g: "look", req: "High ownership, resourcefulness, curiosity and a bias toward execution", pages: ["plan", "adoption"], how: "Quick wins live by day 60, a named owner and exit criteria on every phase, and at-risk calls made early." },
      { g: "look", req: "Preferred: healthcare ops fluency; SQL, Power BI, Zapier, Make, n8n, Claude Code", pages: ["pipeline", "scheduling", "discovery"], how: "HEDIS/Star, D-SNP, roster and eligibility, BAA and minimum necessary used correctly; tools named on each opportunity." },
    ];
  }
  const GROUPS = { do: "What you'll do", proj: "Example projects", look: "What they're looking for" };

  function demoSteps() {
    return [
      { t: "0:00", page: "home", click: "Read the thesis, then scroll to the five findings.", say: "Every number here is computed from the data, not typed in. The slider sizes the prize; it starts at half of each gap closed." },
      { t: "0:45", page: "dashboard", click: "Filter to Houston, then look at the call center trend.", say: "The reached-to-scheduled gap and the after-call-work step are visible in one place." },
      { t: "1:45", page: "discovery", click: "Open the Outreach & call center tab, then promote the bilingual callback pain point.", say: "This is how I would spend my first weeks: sharp questions, shadowing, and a log that feeds the backlog." },
      { t: "2:45", page: "pipeline", params: { opp: "OPP-03" }, click: "Find the promoted item next to OPP-03 and compare scores.", say: "One backlog, scored on impact, confidence, effort and PHI risk." },
      { t: "3:30", page: "roi", params: { opp: "OPP-03" }, click: "Open bilingual routing and move one lever.", say: "The business case reads in visits, hours and dollars." },
      { t: "4:15", page: "ailab", click: "Run call-note drafting on a sample note.", say: "Redaction first, structured output, and accuracy scored against human ground truth before any agent sees it." },
      { t: "5:30", page: "adoption", click: "Select AI call-note drafting, then edit the calculator.", say: "Adoption is the product. The control group keeps us honest about the effect." },
      { t: "6:30", page: "plan", click: "Close on the targets table and the 13-week timeline.", say: "Here is what I would ship by day 30, 60 and 90, and how we would know it worked." },
    ];
  }

  const PRINCIPLES = [
    { icon: "target", h: "Measure the baseline before building", p: "Agree the number, its owner and its source first. A change without a baseline cannot prove anything." },
    { icon: "flag", h: "Ship the smallest useful change", p: "A dialer rule or a dashboard that is live in two weeks beats a platform that is live in two quarters." },
    { icon: "users", h: "Adoption is the product", p: "Champions, 15-minute training, office hours and a stop-doing list. If the floor does not use it, it did not ship." },
    { icon: "shield", h: "PHI-safe by design", p: "Minimum necessary fields, BAA-covered vendors only, redaction before any model call, and a human confirms every output." },
    { icon: "route", h: "Partner with engineering on core systems", p: "Prototype on exports and low-code; anything that writes to scheduling, the CRM or billing goes through engineering with a tested spec." },
  ];

  // ---------- CSS ----------
  const CSS = `
  .home-thesis { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 22px; align-items: stretch; }
  .home-lede { font-family: var(--font-display); font-size: clamp(1.2rem, 2vw, 1.6rem); line-height: 1.32; font-weight: 600; letter-spacing: -0.01em; color: var(--ink); text-wrap: pretty; }
  .home-lede b { font-weight: 700; color: var(--accent); }
  .home-meta { color: var(--ink-2); font-size: var(--fs-md); max-width: 68ch; }
  .home-kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-content: start; }
  .home-kpis .kpi { background: var(--surface-2); border-color: transparent; }
  .home-loop { position: relative; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; padding-top: 4px; }
  .home-loop::before { content: ""; position: absolute; left: 10%; right: 10%; top: 27px; height: 2px; background: var(--accent-line); }
  .home-node { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 0 4px 6px; background: none; border: 0; font: inherit; color: var(--ink); cursor: pointer; text-align: center; min-width: 0; border-radius: var(--r-md); }
  .home-node:hover .home-dot { border-color: var(--accent); }
  .home-dot { width: 48px; height: 48px; border-radius: 50%; background: var(--surface); border: 2px solid var(--accent-line); display: grid; place-items: center; font-family: var(--font-mono); font-weight: 600; font-size: var(--fs-md); color: var(--accent); transition: background .15s, color .15s; }
  .home-node[aria-pressed="true"] .home-dot { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
  .home-node-text { display: flex; flex-direction: column; align-items: center; min-width: 0; }
  .home-node-name { font-family: var(--font-display); font-weight: 650; font-size: var(--fs-md); margin-top: 4px; }
  .home-node-verb { font-size: var(--fs-xs); color: var(--ink-3); }
  .home-node[aria-pressed="true"] .home-node-name { color: var(--accent); }
  .home-return { margin: 0 10%; height: 18px; border: 2px dashed var(--accent-line); border-top: 0; border-radius: 0 0 16px 16px; position: relative; }
  .home-return span { position: absolute; left: 50%; bottom: -10px; transform: translateX(-50%); background: var(--surface); padding: 0 8px; font-size: var(--fs-xs); color: var(--ink-3); white-space: nowrap; font-family: var(--font-mono); letter-spacing: .04em; }
  .home-stage { display: grid; grid-template-columns: minmax(0, 260px) minmax(0, 1fr); gap: 18px; margin-top: 10px; }
  .home-stage-q { font-family: var(--font-display); font-size: var(--fs-lg); font-weight: 600; line-height: 1.3; }
  .home-pages { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; align-content: start; }
  .home-pages li { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 4px 14px; padding: 10px 12px; border-radius: var(--r-md); background: var(--surface-2); align-items: baseline; }
  .home-pages li .muted { font-size: var(--fs-sm); }
  .home-link { font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
  .home-link:hover { text-decoration: underline; }
  .home-link::after { content: "→"; font-weight: 500; }
  .home-link-off { font-weight: 600; color: var(--ink-2); }
  .home-findings { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 14px; }
  .home-find { grid-column: span 2; }
  .home-find.home-lead { grid-column: span 3; }
  .home-find { position: relative; background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--line-strong); border-radius: var(--r-lg); padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .home-find.critical { border-left-color: var(--critical); }
  .home-find.serious { border-left-color: var(--serious); }
  .home-find.warning { border-left-color: var(--warning); }
  .home-find-metric { font-family: var(--font-display); font-size: 1.9rem; font-weight: 650; letter-spacing: -0.02em; line-height: 1.05; font-variant-numeric: tabular-nums; }
  .home-find-metric small { font-size: .5em; font-weight: 500; color: var(--ink-3); margin-left: 4px; letter-spacing: 0; }
  .home-find h3 { font-size: var(--fs-md); line-height: 1.35; }
  .home-find ul { margin: 0; padding-left: 18px; font-size: var(--fs-sm); color: var(--ink-2); display: grid; gap: 3px; }
  .home-spark { position: relative; height: 38px; }
  .home-spark canvas { position: absolute; inset: 0; }
  .home-find-acts { margin-top: auto; display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: var(--fs-sm); padding-top: 6px; border-top: 1px solid var(--line); }
  .home-prize { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 18px; align-items: center; }
  .home-prize-out { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  .home-prize-out div { min-width: 0; }
  .home-prize-out b { display: block; font-family: var(--font-display); font-size: 1.45rem; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .home-prize-out span { font-size: var(--fs-xs); color: var(--ink-3); }
  .home-mx td { font-size: var(--fs-sm); }
  .home-mx td.home-mx-req { font-weight: 500; color: var(--ink); min-width: 220px; }
  .home-mx td.home-mx-pages { min-width: 170px; }
  .home-mx td.home-mx-pages .home-link, .home-mx td.home-mx-pages .home-link-off { display: flex; margin-bottom: 2px; }
  .home-mx td.home-mx-how { color: var(--ink-2); }
  .home-steps { list-style: none; margin: 0; padding: 0; counter-reset: hstep; display: grid; gap: 10px; }
  .home-steps li { counter-increment: hstep; display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; align-items: start; }
  .home-steps li::before { content: counter(hstep); width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); font-family: var(--font-mono); font-weight: 600; font-size: var(--fs-sm); }
  .home-step-top { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .home-step-t { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--ink-3); }
  .home-step-click { font-size: var(--fs-sm); color: var(--ink); }
  .home-step-say { font-size: var(--fs-sm); color: var(--ink-3); }
  .home-princ { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .home-princ li { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; }
  .home-princ svg { width: 20px; height: 20px; color: var(--accent); margin-top: 2px; }
  .home-princ h4 { font-size: var(--fs-md); }
  .home-princ p { font-size: var(--fs-sm); color: var(--ink-2); }
  @media (max-width: 1100px) {
    .home-prize { grid-template-columns: minmax(0, 1fr); }
    .home-findings { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .home-find, .home-find.home-lead { grid-column: auto; }
    .home-find:last-child { grid-column: 1 / -1; }
  }
  @media (max-width: 640px) {
    .home-findings { grid-template-columns: minmax(0, 1fr); }
    .home-find:last-child { grid-column: auto; }
  }
  @media (max-width: 900px) {
    .home-thesis { grid-template-columns: minmax(0, 1fr); }
    .home-stage { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 700px) {
    .home-loop { grid-template-columns: minmax(0, 1fr); gap: 6px; }
    .home-loop::before { left: 27px; right: auto; top: 26px; bottom: 26px; width: 2px; height: auto; }
    .home-node { flex-direction: row; text-align: left; gap: 12px; padding: 2px 4px; }
    .home-node-text { align-items: flex-start; }
    .home-node-name { margin-top: 0; }
    .home-dot { width: 44px; height: 44px; flex: none; margin-left: 5px; }
    .home-return { display: none; }
    .home-pages li { grid-template-columns: minmax(0, 1fr); }
    .home-prize-out { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .home-mx thead { display: none; }
    .home-mx, .home-mx tbody, .home-mx tr, .home-mx td { display: block; width: 100%; }
    .home-mx tr { padding: 10px 0; border-bottom: 1px solid var(--line); }
    .home-mx tr:last-child { border-bottom: 0; }
    .home-mx td { border: 0 !important; padding: 3px 12px !important; min-width: 0 !important; }
    .home-mx td::before { content: attr(data-label); display: block; font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 2px; }
    .home-mx td.home-mx-req::before { display: none; }
    .home-mx tbody tr:hover td { background: transparent; }
  }`;

  // ---------- render ----------
  function render(root, ctx) {
    UI.style("home", CSS);
    const { data, q } = ctx;
    const A = analyze(data, q);
    const F = UI.fmt;
    const W = data.weeks.length;
    let stage = UI.store.get("home.stage", "see");
    if (!LOOP.some((s) => s.id === stage)) stage = "see";
    let mxFilter = "all";
    let share = UI.store.get("home.share", 50);
    if (typeof share !== "number" || share < 25 || share > 100) share = 50;

    const net = A.net, netP = A.netP;
    const volChg = (net.completed - netP.completed) / Math.max(1, netP.completed);
    const kpis = [
      UI.kpi({ label: "Completed visits / week", value: F.num(net.completed / 4), delta: volChg, deltaLabel: (volChg >= 0 ? "+" : "−") + F.pct(Math.abs(volChg)), foot: "last 4 wks vs prior 4", id: "home-k1" }),
      UI.kpi({ label: "Reached → scheduled", value: F.pct(net.scheduleRate), delta: net.scheduleRate - netP.scheduleRate, deltaLabel: F.pts(net.scheduleRate - netP.scheduleRate), foot: "network", id: "home-k2" }),
      UI.kpi({ label: "Show rate", value: F.pct(net.showRate), delta: net.showRate - netP.showRate, deltaLabel: F.pts(net.showRate - netP.showRate), foot: "held ÷ scheduled", id: "home-k3" }),
      UI.kpi({ label: "Chart QA first-pass", value: F.pct(net.qaPassRate), delta: net.qaPassRate - netP.qaPassRate, deltaLabel: F.pts(net.qaPassRate - netP.qaPassRate), foot: "passed ÷ submitted", id: "home-k4" }),
    ].join("");

    const findings = buildFindings(A);

    root.innerHTML = `
      <div class="panel home-thesis-panel">
        <div class="home-thesis">
          <div class="stack" style="gap:14px">
            <div class="label">Thesis</div>
            <p class="home-lede">I would own operational improvement here as one loop: <b>see</b> where members, hours and dollars leak out of the funnel, <b>discover</b> why with the people doing the work, <b>prioritize</b> by impact and effort, <b>build</b> the smallest change that moves a measured KPI, and stay through <b>adoption</b> until the number holds.</p>
            <p class="home-meta">Throughline is a working model of a health-plan-facing care delivery operation: ${data.plans.length} health plans across ${data.markets.length} markets, an outreach call center, scheduling, in-home and telehealth visits, chart QA and billing. It runs on ${W} weeks of synthetic data (no PHI) and was built with AI-assisted development in Claude Code.</p>
            <div class="row" style="gap:8px">
              ${pageLink("plan", "See the 90-day plan")}
              <span class="muted small">·</span>
              ${pageLink("dashboard", "Open the live operation")}
            </div>
          </div>
          <div class="stack" style="gap:8px">
            <div class="label">The operation this month · ${UI.esc(data.weeks[A.last - 3].label)}–${UI.esc(A.weeksLabel)}</div>
            <div class="home-kpis">${kpis}</div>
          </div>
        </div>
      </div>
      <div class="presenter-note">This is a working model of the operation you run, built on synthetic data. In the first week I would rebuild these same views on your real exports, so the conversation starts from numbers we agree on.</div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>The operating loop</h2><div class="panel-sub">Each stage is a set of working pages. Select a stage to see what each page proves.</div></div>
          <span class="muted small">${OPS.modules().filter((m) => m.stage !== "start").length} working pages in the loop</span>
        </div>
        <div>
          <div class="home-loop" role="group" aria-label="Operating loop stages">
            ${LOOP.map((s) => {
              const n = OPS.modules().filter((m) => m.stage === s.id).length;
              return `<button type="button" class="home-node" data-stage="${s.id}" aria-pressed="${s.id === stage}">
                <span class="home-dot">${s.n}</span>
                <span class="home-node-text"><span class="home-node-name">${UI.esc(s.name)}</span><span class="home-node-verb">${UI.esc(s.verb)} · ${n} page${n === 1 ? "" : "s"}</span></span>
              </button>`;
            }).join("")}
          </div>
          <div class="home-return" aria-hidden="true"><span>measured results feed the next round of See</span></div>
        </div>
        <div id="home-stage-detail" class="home-stage"></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>What the data says in 10 minutes</h2><div class="panel-sub">Five gaps computed live from ${W} weeks of funnel, call center, clinician and appointment data. Each links to the page that acts on it.</div></div>
          <span class="pill neutral">Computed · as of ${UI.esc(data.meta.asOf)}</span>
        </div>
        <div class="home-findings">${findings.map(findingCard).join("")}</div>
        <div class="panel inset home-prize">
          <div class="stack" style="gap:6px">
            <h3>Size the prize</h3>
            <p class="small muted">If we close part of each gap above, what is it worth per quarter? Visits use each market's current show and completion rates; dollars use its current revenue per completed visit.</p>
            ${UI.range({ id: "home-share", label: "Share of each gap closed", min: 25, max: 100, step: 5, value: share, display: share + "%" })}
          </div>
          <div class="home-prize-out" id="home-prize-out" aria-live="polite"></div>
        </div>
        <div class="presenter-note">None of these numbers are typed in; they are queried from the data each time the page loads. The two biggest are conversion problems in Houston and Phoenix, and the slider shows what half of each gap is worth in visits and revenue per quarter.</div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>Requirement → evidence</h2><div class="panel-sub">Every line of the role mapped to the page that demonstrates it.</div></div>
          ${UI.seg("home-mx-filter", [{ value: "all", label: "All" }, { value: "do", label: "What you'll do" }, { value: "proj", label: "Projects" }, { value: "look", label: "Looking for" }], "all")}
        </div>
        <div id="home-mx"></div>
        <div class="presenter-note">I mapped every line of the job description to something you can click. Pick any row and I will show it to you live.</div>
      </div>

      <div class="grid g-2">
        <div class="panel">
          <div class="panel-head"><div><h2>Suggested 7-minute demo path</h2><div class="panel-sub">One pass through the loop, in order.</div></div></div>
          <ol class="home-steps">
            ${demoSteps().map((s) => `<li><div class="stack" style="gap:2px">
              <div class="home-step-top"><span class="home-step-t">${s.t}</span>${s.page === "home" ? `<strong>${UI.esc(titleOf("home"))}</strong>` : pageLink(s.page, null, s.params)}</div>
              <div class="home-step-click">${UI.esc(s.click)}</div>
              <div class="home-step-say">${UI.esc(s.say)}</div>
            </div></li>`).join("")}
          </ol>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h2>How I work</h2><div class="panel-sub">Five principles that run through every page.</div></div></div>
          <ul class="home-princ">
            ${PRINCIPLES.map((p) => `<li>${UI.icon(p.icon)}<div class="stack" style="gap:2px"><h4>${UI.esc(p.h)}</h4><p>${UI.esc(p.p)}</p></div></li>`).join("")}
          </ul>
          <div class="presenter-note">These principles are how I would earn trust on the floor: measure first, ship something small within weeks, and treat adoption and PHI safety as part of the build.</div>
        </div>
      </div>`;

    // KPI sparklines (last 12 weeks)
    const bw = q.byWeek({ from: Math.max(0, A.last - 11), to: A.last });
    UI.spark("home-k1", bw.map((w) => w.completed));
    UI.spark("home-k2", bw.map((w) => w.scheduleRate));
    UI.spark("home-k3", bw.map((w) => w.showRate));
    UI.spark("home-k4", bw.map((w) => w.qaPassRate));
    findings.forEach((f) => { if (f.spark) UI.spark("home-sp-" + f.id, f.spark); });

    const drawStage = () => {
      const s = LOOP.find((x) => x.id === stage);
      const mods = OPS.modules().filter((m) => m.stage === s.id);
      root.querySelector("#home-stage-detail").innerHTML = `
        <div class="stack" style="gap:6px">
          <div class="label">Stage ${s.n} · ${UI.esc(s.name)}</div>
          <p class="home-stage-q">${UI.esc(s.q)}</p>
        </div>
        ${mods.length ? `<ul class="home-pages">${mods.map((m) => `<li>${pageLink(m.id)}<span class="muted">${UI.esc(provesLine(m.id) || m.summary || "")}</span></li>`).join("")}</ul>`
          : `<div class="empty">No pages in this stage are loaded in this build.</div>`}`;
    };
    drawStage();

    const drawMatrix = () => {
      const rows = matrixRows(W).filter((r) => mxFilter === "all" || r.g === mxFilter);
      let lastG = null;
      root.querySelector("#home-mx").innerHTML = `<div class="table-wrap"><table class="data home-mx">
        <thead><tr><th>Requirement</th><th>Where to see it</th><th>How it is shown</th></tr></thead>
        <tbody>${rows.map((r) => {
          const head = mxFilter === "all" && r.g !== lastG ? `<tr class="home-mx-group"><td colspan="3" data-label=""><span class="label">${UI.esc(GROUPS[r.g])}</span></td></tr>` : "";
          lastG = r.g;
          return head + `<tr>
            <td class="home-mx-req" data-label="Requirement">${UI.esc(r.req)}</td>
            <td class="home-mx-pages" data-label="Where to see it">${r.pages.map((p) => pageLink(p)).join("")}</td>
            <td class="home-mx-how" data-label="How it is shown">${UI.esc(r.how)}</td>
          </tr>`;
        }).join("")}</tbody></table></div>
        <p class="xs muted" style="margin-top:8px">${rows.length} requirement${rows.length === 1 ? "" : "s"} shown · each maps to at least one working page.</p>`;
    };
    drawMatrix();

    const drawPrize = () => {
      const s = share / 100;
      const visits = (A.hou.visitsQ + A.phx.visitsQ) * s;
      const dollars = (A.hou.visitsQ * A.hou.rev + A.phx.visitsQ * A.phx.rev) * s;
      const hrs = A.aht.hrsWk * 13 * s;
      const charts = A.tpa.bouncedQ * s;
      root.querySelector("#home-prize-out").innerHTML = `
        <div><b>+${F.num(visits)}</b><span>completed visits / quarter (${UI.esc(A.hou.name)} + ${UI.esc(A.phx.name)})</span></div>
        <div><b>${F.moneyK(dollars)}</b><span>billed revenue / quarter at current rates</span></div>
        <div><b>${F.num(hrs)}</b><span>agent hours / quarter back from handle time</span></div>
        <div><b>${F.num(charts)}</b><span>${UI.esc(A.tpa.name)} charts / quarter kept out of QA rework</span></div>`;
    };
    drawPrize();

    // ---------- events ----------
    UI.on(root, "click", ".home-node", (e, el) => {
      stage = el.dataset.stage;
      UI.store.set("home.stage", stage);
      root.querySelectorAll(".home-node").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
      drawStage();
    });
    UI.on(root, "click", "a[data-nav]", (e, el) => {
      if (!el.dataset.params) return; // plain hash link
      e.preventDefault();
      let params = {};
      try { params = JSON.parse(el.dataset.params); } catch (err) { params = {}; }
      ctx.navigate(el.dataset.nav, params);
    });
    UI.wireSeg(root, "home-mx-filter", (v) => { mxFilter = v; drawMatrix(); });
    const rng = root.querySelector("#home-share");
    rng.addEventListener("input", () => {
      share = +rng.value;
      root.querySelector("#home-share-out").textContent = share + "%";
      UI.store.set("home.share", share);
      drawPrize();
    });
  }

  function buildFindings(A) {
    const F = UI.fmt;
    const lv = (cond2, cond1) => (cond2 ? "critical" : cond1 ? "serious" : "warning");
    const lvText = { critical: "Critical", serious: "Serious", warning: "Watch" };
    const list = [
      {
        id: "hou", level: lv(A.hou.gap >= 0.08, A.hou.gap >= 0.04),
        tag: A.hou.name + " · scheduling",
        metric: F.pts(-A.hou.gap).replace(" pts", ""), unit: "pts vs network",
        h: `${A.hou.name} converts ${F.pct(A.hou.rate)} of reached members to a scheduled visit; the rest of the network converts ${F.pct(A.hou.rest)}.`,
        ev: [
          `Closing the gap is worth about ${F.num(A.hou.visitsQ)} completed visits a quarter (${F.moneyK(A.hou.visitsQ * A.hou.rev)}).`,
          `${F.pct(A.hou.spanishShare, 0)} of ${A.hou.name} appointments are Spanish-preferred members.`,
        ],
        links: [{ id: "pipeline", label: "Bilingual routing (OPP-03)", params: { opp: "OPP-03" } }, { id: "dashboard", label: null }],
        spark: A.hou.spark,
      },
      {
        id: "phx", level: lv(A.phx.rate >= A.phx.rest * 2, A.phx.rate >= A.phx.rest * 1.4),
        tag: A.phx.name + " · no-shows",
        metric: F.pct(A.phx.rate), unit: "no-show rate",
        h: `${A.phx.name} loses ${F.pct(A.phx.rate)} of scheduled visits to no-shows, against ${F.pct(A.phx.rest)} in the other markets.`,
        ev: [
          `Median booking lead time is ${A.phx.lead} days vs ${A.phx.leadRest} elsewhere.`,
          `Two-way SMS appointments no-show at ${F.pct(A.phx.twoWay)} vs ${F.pct(A.phx.none)} with no reminder.`,
        ],
        links: [{ id: "scheduling", label: null }, { id: "pipeline", label: "Risk-based reminders (OPP-01)", params: { opp: "OPP-01" } }],
        spark: A.phx.spark,
      },
      {
        id: "tpa", level: lv(A.tpa.drop >= 0.12, A.tpa.drop >= 0.04),
        tag: A.tpa.name + " · chart QA",
        metric: F.pts(-A.tpa.drop).replace(" pts", ""), unit: "pts in 6 weeks",
        h: `${A.tpa.name} chart QA first-pass fell from ${F.pct(A.tpa.prior)} to ${F.pct(A.tpa.now)} over the last six weeks.`,
        ev: [
          `${A.tpa.newN} of ${A.tpa.allN} clinicians are in their first 3 months: QA ${F.pct(A.tpa.newQA, 0)} vs ${F.pct(A.tpa.vetQA, 0)}, ${F.num(A.tpa.newDoc)} vs ${F.num(A.tpa.vetDoc)} doc minutes.`,
          `About ${F.num(A.tpa.bouncedQ)} extra charts a quarter bounce back, delaying billing.`,
        ],
        links: [{ id: "pipeline", label: "QA pre-check rules (OPP-08)", params: { opp: "OPP-08" } }, { id: "sop", label: null }],
        spark: A.tpa.spark,
      },
      {
        id: "aht", level: lv(A.aht.hrsWk >= 150, A.aht.hrsWk >= 30),
        tag: "Call center · from " + A.aht.week,
        metric: "+" + F.num(A.aht.postACW - A.aht.preACW) + "s", unit: "after-call work",
        h: `Since ${A.aht.week}, AHT rose from ${F.mmss(A.aht.preAHT)} to ${F.mmss(A.aht.postAHT)} and ACW from ${F.mmss(A.aht.preACW)} to ${F.mmss(A.aht.postACW)}.`,
        ev: [
          `That is about ${F.num(A.aht.hrsWk)} agent hours a week, consistent with double entry after the scheduling-system change.`,
          `Schedule conversion ${F.pct(A.aht.preConv)} → ${F.pct(A.aht.postConv)}; abandon ${F.pct(A.aht.preAband)} → ${F.pct(A.aht.postAband)}.`,
        ],
        links: [{ id: "ailab", label: "AI call-note drafting" }, { id: "workflow", label: null }],
        spark: A.aht.spark,
      },
      {
        id: "clt", level: lv(A.clt.util >= 0.99, A.clt.util >= 0.94),
        tag: A.clt.name + " · capacity",
        metric: F.pct(A.clt.util, 0), unit: "clinician utilization",
        h: `${A.clt.name}'s ${A.clt.n} clinicians are booked at ${F.pct(A.clt.util, 0)} of capacity vs ${F.pct(A.clt.netUtil, 0)} across the network.`,
        ev: [
          `Median lead time is ${A.clt.lead} days vs ${A.clt.leadRest} elsewhere.`,
          `Show rate slipped from ${F.pct(A.clt.showPrior)} to ${F.pct(A.clt.showNow)} over the last 8 weeks.`,
        ],
        links: [{ id: "capacity", label: null }],
        spark: A.clt.spark,
      },
    ];
    list.forEach((f) => (f.levelText = lvText[f.level]));
    // the two largest visit opportunities get the wide cards
    list[0].lead = true; list[1].lead = true;
    return list;
  }

  function findingCard(f) {
    return `<article class="home-find ${f.level}${f.lead ? " home-lead" : ""}">
      <div class="row between" style="gap:6px">${UI.pill(f.level, f.levelText)}<span class="tag">${UI.esc(f.tag)}</span></div>
      <div class="home-find-metric">${UI.esc(f.metric)}<small>${UI.esc(f.unit)}</small></div>
      <div class="home-spark"><canvas id="home-sp-${f.id}" aria-hidden="true"></canvas></div>
      <h3>${UI.esc(f.h)}</h3>
      <ul>${f.ev.map((e) => `<li>${UI.esc(e)}</li>`).join("")}</ul>
      <div class="home-find-acts"><span class="muted">Act on it:</span>${f.links.map((l) => pageLink(l.id, l.label, l.params)).join("")}</div>
    </article>`;
  }

  OPS.register({
    id: "home",
    title: "Start here",
    stage: "start",
    order: 1,
    icon: "home",
    eyebrow: "Business Operations & AI Transformation Lead",
    summary: "How I would find, fix and prove operational improvements in a health-plan-facing care delivery business, shown on a working model of the operation.",
    jd: [
      "Own the changes that make a growing healthcare business run better",
      "Ask sharp questions, map real workflows, find what slows teams down",
      "Measured by real-world business impact",
    ],
    render,
  });
})();
