/* Throughline — Impact & ROI Model (#roi).
 * Sizes an opportunity in hours, visits and dollars from explicit drivers, shows a 36-month
 * cumulative cash curve with ramp and break-even, a ±20% tornado on every driver, generated
 * assumptions to validate, and a measurement plan. Writes results back to OPS.opps. */
(function () {
  "use strict";
  const OPS = window.OPS;
  const UI = window.UI;
  const ID = "roi";
  const FTE = 1880;
  const HORIZON = 36;
  const SCEN = [
    { value: "conservative", label: "Conservative", k: 0.7 },
    { value: "base", label: "Base", k: 1 },
    { value: "aggressive", label: "Aggressive", k: 1.2 },
  ];
  const kOf = (s) => (SCEN.find((x) => x.value === s) || SCEN[1]).k;
  const scenLabel = (s) => (SCEN.find((x) => x.value === s) || SCEN[1]).label;

  // in-memory across navigations within one visit (demo-safe: a reload restores the defaults)
  const mem = { drafts: {}, scenario: "base", last: null, customName: "Custom initiative" };
  let S = null;
  let onChange = null;

  // ---------- helpers ----------
  const num = (v) => (isFinite(+v) ? +v : 0);
  const r0 = Math.round;
  const pct0 = (v) => UI.fmt.pct(v, 0);
  const money = (v) => UI.fmt.money(r0(v));
  const moneyK = (v) => UI.fmt.moneyK(v);
  const signedK = (v) => (v >= 0 ? "+" : "−") + UI.fmt.moneyK(Math.abs(v));
  const dec = (v) => (Math.abs(v) < 10 && Math.round(v) !== v ? UI.fmt.dec(v, 1) : UI.fmt.num(v));
  const oppTitle = (o) => (o && o.title) || "Untitled opportunity";
  const riskPill = (r) => UI.pill(r === "High" ? "critical" : r === "Medium" ? "warning" : "good", (r || "Low") + " risk");

  // ---------- baselines from the shared dataset (last 4 weeks, scaled to a month) ----------
  let B = null;
  function base() {
    if (B) return B;
    const k = 52 / 12 / 4;
    const f = (m) => OPS.q.funnel(Object.assign({ from: 22, to: 25 }, m ? { market: m } : {}));
    const rpv = (x) => (x.billed ? x.revenue / x.billed : 261);
    const all = f(), hou = f("hou"), phx = f("phx"), clt = f("clt"), tpa = f("tpa");
    const cw = OPS.data.callCenter.weekly;
    const avg = (a, key) => a.reduce((s, w) => s + w[key], 0) / Math.max(1, a.length);
    B = {
      schedMo: all.scheduled * k, chartsMo: all.chartsSubmitted * k,
      completion: all.completionRate, show: all.showRate, schedRate: all.scheduleRate,
      rpv: rpv(OPS.q.funnel({})),
      hou: { reached: hou.reached * k, show: hou.showRate, schedRate: hou.scheduleRate, rpv: rpv(hou) },
      phx: { sched: phx.scheduled * k, completed: phx.completed * k, show: phx.showRate, rpv: rpv(phx) },
      clt: { sched: clt.scheduled * k, show: clt.showRate, rpv: rpv(clt) },
      tpa: { charts: tpa.chartsSubmitted * k, qa: tpa.qaPassRate, rpv: rpv(tpa) },
      acwPre: avg(cw.filter((w) => w.weekIndex < 13), "acwSec"),
      acwPost: avg(cw.filter((w) => w.weekIndex >= 13), "acwSec"),
    };
    return B;
  }

  // ---------- per-opportunity default drivers ----------
  function seedPresets() {
    const b = base();
    const P = {};
    const v = (o) => Object.assign({ volume: 0, minutes: 0, adoption: 80, ramp: 3, rate: 38, visits: 0, rpv: r0(b.rpv), reworkHours: 0, reworkPct: 0, build: 10000, run: 0, once: false }, o);

    { const vol = r0(b.phx.sched + b.clt.sched);
      const rpv = r0((b.phx.rpv * b.phx.sched + b.clt.rpv * b.clt.sched) / Math.max(1, b.phx.sched + b.clt.sched));
      P["OPP-01"] = { unit: "scheduled visits (Phoenix + Charlotte)", v: v({ volume: vol, minutes: 2, adoption: 85, ramp: 3, visits: r0(vol * 0.06 * b.completion), rpv, build: 15000, run: 650 }),
        notes: { volume: "From data: last 4 weeks of scheduled visits in Phoenix and Charlotte, scaled to a month.", minutes: "Scheduler time per appointment on manual confirmation calls that two-way SMS replaces.", visits: `= ${UI.fmt.num(vol)} scheduled × 6.0 pts show-rate uplift × ${pct0(b.completion)} completion. Phoenix shows at ${pct0(b.phx.show)}, Charlotte at ${pct0(b.clt.show)}.` },
        how: { minutes: "Time 30 confirmation calls and pull confirmation-call counts per appointment from the dialer, before and after.", visits: "Randomize high-risk appointments into treatment and holdout; count only the show-rate difference." },
        design: "Randomize high-risk appointments in Phoenix and Charlotte 50/50 for 6 weeks: two-way SMS plus a live confirm call vs today's reminders.",
        guard: "SMS opt-out rate, member complaints, same-day cancellations", bar: "+3 pts show rate vs holdout" }; }

    P["OPP-02"] = { unit: "member calls that need a note", v: v({ volume: 21000, minutes: 1.6, adoption: 75, ramp: 3, build: 22000, run: 1600 }),
      notes: { volume: "Connected outbound plus inbound conversations per month that need a note and a disposition.", minutes: `ACW averages ${UI.fmt.mmss(b.acwPost)} since the W14 scheduling change, up from ${UI.fmt.mmss(b.acwPre)}. The AI draft removes most of the typing; the agent still reviews and confirms.` },
      how: { minutes: "Compare ACW in dialer logs for pilot vs control agents; spot-check 50 AI-drafted notes for accuracy.", adoption: "Share of calls where the agent accepts the draft (edited or not), from the CRM audit log." },
      design: "Pilot with 6 agents on the English outreach team for 4 weeks; a control group matched on tenure and queue keeps the current workflow.",
      guard: "Disposition accuracy vs a QA sample (target 95%+), QA note score, zero PHI outside approved fields", bar: "−45 sec ACW vs control with QA score flat" };

    { const sp = r0(b.hou.reached * 0.38);
      P["OPP-03"] = { unit: "Spanish-preferred Houston members reached", v: v({ volume: sp, minutes: 1.2, adoption: 90, ramp: 1, visits: r0(sp * 0.08 * b.hou.show * b.completion), rpv: r0(b.hou.rpv), build: 12000, run: 0 }),
        notes: { volume: "From data: Houston members reached per month × 38% Spanish-preferred.", minutes: "Callback attempts and transfers avoided when the first call lands with a bilingual scheduler.", visits: `= ${UI.fmt.num(sp)} reached × 8 pts conversion lift × ${pct0(b.hou.show)} show × ${pct0(b.completion)} completion. Houston converts ${pct0(b.hou.schedRate)} of reached members vs ${pct0(b.schedRate)} network.` },
        how: { visits: "Compare reached-to-scheduled conversion for Spanish-preferred members against English-preferred members in the same weeks." },
        design: "Route Spanish-preferred Houston members to the bilingual queue for 4 weeks; compare conversion with English-preferred members in the same weeks and with the prior 8 weeks (difference-in-differences).",
        guard: "Bilingual queue ASA and abandon rate, callback SLA", bar: "+5 pts conversion for Spanish-preferred members" }; }

    P["OPP-04"] = { unit: "analyst-days of manual reconciliation", v: v({ volume: 3, minutes: 400, adoption: 100, ramp: 2, visits: 11, reworkHours: 40, reworkPct: 60, build: 9000, run: 150 }),
      notes: { volume: "Finance spends about 3 analyst-days a month diffing plan rosters against member files in Excel.", minutes: "Of 480 minutes per analyst-day, about 400 go away; exceptions still need a person.", visits: "Visits that would be denied for eligibility, caught before the visit is scheduled.", rework: "Outreach hours spent each month on termed, moved or deceased members." },
      how: { volume: "Have the analyst log reconciliation time for one full monthly cycle." },
      design: "Run automated and manual reconciliation side by side for 2 monthly cycles; Finance retires the manual pass only when every exception class matches.",
      guard: "Exceptions missed by automation (target 0), outreach attempts to termed members", bar: "Cycle time under half a day with zero missed exceptions" };

    { const vol = r0(b.phx.completed * 0.62);
      P["OPP-05"] = { unit: "Phoenix in-home visits", v: v({ volume: vol, minutes: 14, adoption: 75, ramp: 2, rate: 72, visits: r0((vol * 14 * 0.75) / 60 / 1.6), rpv: r0(b.phx.rpv), build: 30000, run: 900, once: true }),
        notes: { volume: "From data: Phoenix completed visits per month × 62% in-home.", minutes: "Drive minutes saved per visit when slots follow route clusters (Phoenix in-home clinicians average about 50 min of driving per visit).", visits: "Freed clinician hours ÷ about 1.6 hrs per in-home visit (visit plus drive).", once: "Freed clinician hours are what create the extra visits, so the value counts once, as revenue." },
        how: { minutes: "Compare mileage logs and drive time per visit for clustered vs unclustered clinician-days." },
        design: "Cluster scheduling for 2 of 3 Phoenix in-home clinicians, rotating weekly for 6 weeks; compare completed visits per clinician-day with the unclustered schedule.",
        guard: "Member lead time to visit, show rate, clinician overtime", bar: "+0.5 completed visits per clinician-day" }; }

    { const ch = r0(b.tpa.charts);
      P["OPP-06"] = { unit: "Tampa charts", v: v({ volume: ch, minutes: 10, adoption: 70, ramp: 4, rate: 72, visits: r0(ch * Math.max(0, 0.95 - b.tpa.qa) * 0.45), rpv: r0(b.tpa.rpv), reworkHours: r0((ch * (1 - b.tpa.qa) * 25) / 60), reworkPct: 50, build: 60000, run: 2400 }),
        notes: { volume: "From data: Tampa charts submitted per month.", minutes: "New Tampa clinicians take about 40 min per chart vs about 27 for tenured clinicians.", visits: `Charts that fail QA and never bill: recovers 45% of the gap between Tampa's ${pct0(b.tpa.qa)} first-pass rate and 95%.`, rework: `From data: ${pct0(1 - b.tpa.qa)} of Tampa charts bounce from QA, about 25 min each to fix.` },
        how: { minutes: "Use EHR timestamps (visit end to chart sign-off) for pilot vs other Tampa clinicians." },
        design: "Start with 2 new and 2 tenured Tampa clinicians for 6 weeks; compare documentation minutes and QA first-pass rate with the other Tampa clinicians.",
        guard: "Clinical accuracy audit on 100% of AI-drafted charts for the first 4 weeks, clinician sign-off rate, coding accuracy", bar: "QA first-pass above 93% with documentation under 30 min" }; }

    P["OPP-07"] = { unit: "weekly ops decks", v: v({ volume: 4.3, minutes: 360, adoption: 100, ramp: 1, build: 6000, run: 250 }),
      notes: { volume: "One deck per week, about 4.3 per month.", minutes: "Analyst time each Monday spent pulling exports and building slides." },
      design: "Log analyst hours on the Monday review for 4 weeks before and after; run the dashboard and the deck in parallel for 2 weeks and reconcile every number.",
      guard: "Number disputes raised in the review, dashboard data freshness", bar: "Under 1 analyst hour per week on the review" };

    { const ch = r0(b.chartsMo), bounced = ch * 0.06;
      P["OPP-08"] = { unit: "charts submitted", v: v({ volume: ch, minutes: 0.5, adoption: 85, ramp: 2, visits: r0(bounced * 0.13), reworkHours: r0((bounced * 15) / 60), reworkPct: 55, build: 12000, run: 300 }),
        notes: { volume: "From data: network charts submitted per month.", minutes: "Coder review time saved per chart when required fields arrive complete.", visits: `About 13% of the ${UI.fmt.num(bounced)} charts that bounce each month age out unbilled; the pre-check prevents most bounces.`, rework: `${UI.fmt.num(bounced)} bounced charts a month × about 15 min of clinician and coder rework.` },
        design: "Turn the pre-check on for half of clinicians (alternating by clinician ID) for 4 weeks; compare QA first-pass rate and days from visit to bill.",
        guard: "Sign-off time per chart, false-positive flag rate", bar: "+3 pts QA first-pass rate vs control" }; }

    P["OPP-09"] = { unit: "health-plan launches", v: v({ volume: 0.5, minutes: 2400, adoption: 100, ramp: 2, visits: 30, build: 5000, run: 100 }),
      notes: { volume: "About 6 plan launches a year.", minutes: "About 40 hours of chasing, status emails and rework per launch.", visits: "Launches reach first visit about 3 weeks sooner; averaged across the year." },
      design: "Use the checklist on the next 2 plan launches; compare time to first visit and data-feed defects against the last 3 launches.",
      guard: "Data-feed defects found after week 2, plan satisfaction at the launch review", bar: "Time to first visit under 8 weeks" };

    { const c = r0(b.schedMo * 0.03);
      P["OPP-10"] = { unit: "same-day cancellations", v: v({ volume: c, minutes: 4, adoption: 70, ramp: 2, visits: r0(c * 0.2 * b.show), build: 7000, run: 500 }),
        notes: { volume: "From data: about 3% of scheduled visits cancel the same day.", minutes: "Scheduler time on manual phone backfill attempts per cancellation.", visits: `= ${UI.fmt.num(c)} same-day cancellations × 20% backfilled × ${pct0(b.show)} show rate.` },
        design: "Run the standby list in two markets for 6 weeks; compare same-day slot fill rate with two markets that keep phone backfill.",
        guard: "Standby list opt-outs, clinician idle time, member complaints", bar: "20% of same-day cancellations refilled" }; }

    P["OPP-11"] = { unit: "monthly plan reports", v: v({ volume: 4, minutes: 300, adoption: 100, ramp: 1, build: 3000, run: 0 }),
      notes: { volume: "One report per health plan per month.", minutes: "Account manager time pulling three exports and formatting." },
      design: "Track prep hours for the next 2 monthly cycles vs the last 3; the account manager reviews every report before it goes to the plan.",
      guard: "Corrections requested by plans", bar: "Prep time under 1 hour per report" };

    P["OPP-12"] = { unit: "credential renewals", v: v({ volume: 6, minutes: 80, adoption: 100, ramp: 1, visits: 13, build: 2000, run: 60 }),
      notes: { volume: "About 6 license or credential renewals come due each month.", minutes: "Time spent chasing documents and confirming renewals by hand.", visits: "Avoided lapse days × about 6 visits per clinician-day, averaged per month." },
      design: "Load every active credential; compare lapses and lost clinician-days over the next 2 quarters with the prior 2.",
      guard: "Alerts acknowledged within 5 business days", bar: "Zero lapses" };
    return P;
  }

  let PRESETS = null;
  function presetFor(key, opp) {
    if (!PRESETS) PRESETS = seedPresets();
    const b = base();
    if (PRESETS[key]) return PRESETS[key];
    const generic = {
      design: "Pilot with one team for 4 to 6 weeks; compare against a matched team or the prior 8 weeks.",
      guard: "Quality score, error rate, member complaints",
      bar: "A KPI move larger than normal week-to-week variation",
    };
    if (opp) {
      const hrs = num(opp.hoursSavedPerMonth), rev = num(opp.revenueImpactAnnual);
      return Object.assign({ unit: "units of work", how: {},
        v: { volume: Math.max(1, r0((hrs * 60) / (10 * 0.8))), minutes: 10, adoption: 80, ramp: 3, rate: 38, visits: r0(rev / 12 / b.rpv), rpv: r0(b.rpv), reworkHours: 0, reworkPct: 0, build: 10000, run: 300, once: false },
        notes: { volume: "Back-solved from the pipeline record's hours at 10 min per unit and 80% adoption. Replace with a real count.", visits: rev ? "Back-solved from the pipeline record's annual revenue." : "" },
      }, generic);
    }
    return Object.assign({ unit: "units of work", how: {},
      v: { volume: 2000, minutes: 3, adoption: 80, ramp: 3, rate: 38, visits: 0, rpv: r0(b.rpv), reworkHours: 0, reworkPct: 0, build: 10000, run: 300, once: false },
      notes: { volume: "Example: replace with a count from the source system." },
    }, generic);
  }

  // ---------- the model ----------
  function model(inp, k) {
    const minutes = Math.max(0, inp.minutes * k);
    const adoption = Math.min(100, Math.max(0, inp.adoption * k)) / 100;
    const visits = Math.max(0, inp.visits * k);
    const reworkPct = Math.min(100, Math.max(0, inp.reworkPct * k)) / 100;
    const hrsMo = (inp.volume * minutes * adoption) / 60 + inp.reworkHours * reworkPct;
    const hrsYr = hrsMo * 12;
    const laborYr = hrsYr * inp.rate;
    const revYr = visits * inp.rpv * 12;
    const runYr = inp.run * 12;
    const counted = inp.once ? 0 : laborYr;
    const netYr = counted + revYr - runYr;
    const benefitMo = (counted + revYr) / 12;
    const cum = [-inp.build];
    let c = -inp.build, payback = null, benefit = 0, cost = inp.build;
    for (let m = 1; m <= HORIZON; m++) {
      const ramp = inp.ramp > 0 ? Math.min(1, m / inp.ramp) : 1;
      const b = benefitMo * ramp;
      c += b - inp.run;
      benefit += b;
      cost += inp.run;
      cum.push(c);
      if (payback == null && c >= 0 && b - inp.run > 0) payback = m;
    }
    const roi3 = cost > 0 ? (benefit - cost) / cost : null;
    return { hrsMo, hrsYr, fte: hrsYr / FTE, laborYr, counted, revYr, runYr, netYr, cum, payback, y1: cum[12], roi3, visitsMo: visits };
  }

  const DRIVERS = [
    { key: "volume", label: "Monthly volume", fmt: (v) => UI.fmt.num(v) },
    { key: "minutes", label: "Minutes saved per unit", fmt: (v) => dec(v) + " min" },
    { key: "adoption", label: "Steady-state adoption", fmt: (v) => r0(v) + "%" },
    { key: "rate", label: "Loaded hourly cost", fmt: (v) => "$" + r0(v) + "/hr" },
    { key: "visits", label: "Visits gained / month", fmt: (v) => UI.fmt.num(v) },
    { key: "rpv", label: "Revenue per visit", fmt: (v) => "$" + UI.fmt.num(v) },
    { key: "reworkHours", label: "Rework hours today", fmt: (v) => UI.fmt.num(v) + " hrs" },
    { key: "reworkPct", label: "Rework reduction", fmt: (v) => r0(v) + "%" },
    { key: "run", label: "Monthly run cost", fmt: (v) => UI.fmt.money(v) },
  ];
  const UNCERTAINTY = ["minutes", "adoption", "visits", "reworkPct", "rpv", "volume", "reworkHours", "rate", "run"];
  const UNCERTAIN = ["minutes", "adoption", "visits", "reworkPct"];
  function tornado(inp, k) {
    const baseNet = model(inp, k).netYr;
    const rows = DRIVERS.map((d) => {
      const lo = model(Object.assign({}, inp, { [d.key]: inp[d.key] * 0.8 }), k).netYr;
      const hi = model(Object.assign({}, inp, { [d.key]: inp[d.key] * 1.2 }), k).netYr;
      return Object.assign({}, d, { lo, hi, swing: Math.abs(hi - lo), val: inp[d.key] });
    }).filter((d) => d.swing >= 1);
    const top = Math.max(1, ...rows.map((d) => d.swing));
    // ties (drivers that multiply together swing equally): least certain driver first
    rows.sort((a, b) => (Math.abs(a.swing - b.swing) > top * 0.005 ? b.swing - a.swing : UNCERTAINTY.indexOf(a.key) - UNCERTAINTY.indexOf(b.key)));
    return { base: baseNet, rows };
  }

  // ---------- CSS ----------
  const CSS = `
  .roi-top-row { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: flex-end; }
  .roi-pick { flex: 1 1 320px; min-width: 0; }
  .roi-top-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }
  .roi-ctx { display: flex; flex-wrap: wrap; gap: 10px 24px; justify-content: space-between; align-items: flex-start; border-top: 1px solid var(--line); padding-top: 12px; }
  .roi-ctx > * { min-width: 0; }
  .roi-ctx p { max-width: 82ch; }
  .roi-compare { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: var(--fs-sm); color: var(--ink-2); }
  .roi-compare b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .roi-layout { display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); gap: 16px; align-items: start; }
  .roi-inputs { gap: 0; }
  .roi-group { display: flex; flex-direction: column; gap: 12px; padding: 14px 0; border-top: 1px solid var(--line); }
  .roi-group:first-child { border-top: 0; padding-top: 0; }
  .roi-group:last-child { padding-bottom: 0; }
  .roi-group > .label { margin-bottom: -2px; }
  .roi-help { font-size: var(--fs-xs); color: var(--ink-3); line-height: 1.45; }
  .roi-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .roi-check { display: flex; gap: 8px; align-items: flex-start; font-size: var(--fs-sm); color: var(--ink-2); cursor: pointer; }
  .roi-check input { margin-top: 3px; }
  .roi-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .roi-scen { border: 1px solid var(--line); border-radius: var(--r-md); padding: 8px 12px; background: var(--surface); display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .roi-scen.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .roi-scen b { font-family: var(--font-display); font-size: var(--fs-lg); font-variant-numeric: tabular-nums; }
  .roi-scen span.xs { color: var(--ink-3); }
  .roi-assume { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
  .roi-assume li { border-left: 3px solid var(--line-strong); padding: 2px 0 2px 12px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .roi-assume li.top { border-left-color: var(--warning); }
  .roi-assume .roi-a-head { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; font-size: var(--fs-sm); font-weight: 600; color: var(--ink); }
  .roi-dl { display: grid; gap: 10px; margin: 0; }
  .roi-dl dt { font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-3); }
  .roi-dl dd { margin: 2px 0 0; font-size: var(--fs-sm); color: var(--ink); }
  .roi-takeaway { font-size: var(--fs-sm); color: var(--ink-2); }
  .roi-takeaway strong { color: var(--ink); }
  @media (max-width: 1000px) { .roi-layout { grid-template-columns: minmax(0, 1fr); } .roi-results { order: -1; } }
  @media (max-width: 560px) { .roi-2 { grid-template-columns: minmax(0, 1fr); } .roi-top-actions { margin-left: 0; } .roi-strip { gap: 6px; } .roi-scen { padding: 6px 8px; } .roi-scen b { font-size: var(--fs-md); } }
  `;

  // ---------- rendering ----------
  function niceMax(v) {
    const steps = [5, 10, 20, 30, 40, 60, 90, 120, 180, 240, 360, 480, 600, 900, 1200, 1800, 2400, 3600, 4800, 6000, 9000];
    return steps.find((s) => s >= v) || Math.ceil(v / 1000) * 1000;
  }
  function rangeCfg(key, def) {
    if (key === "minutes") { const max = niceMax(Math.max(5, def * 2.5)); return { min: 0, max, step: max <= 10 ? 0.1 : max <= 60 ? 0.5 : 5 }; }
    if (key === "adoption" || key === "reworkPct") return { min: 0, max: 100, step: 5 };
    if (key === "ramp") return { min: 0, max: 12, step: 1 };
    if (key === "rate") return { min: 20, max: 150, step: 1 };
    return { min: 0, max: 100, step: 1 };
  }
  const RANGE_DISPLAY = {
    minutes: (v) => dec(v) + " min",
    adoption: (v) => r0(v) + "%",
    ramp: (v) => (v ? v + " mo" : "none"),
    rate: (v) => "$" + r0(v) + "/hr",
    reworkPct: (v) => r0(v) + "%",
  };
  const RANGE_IDS = { minutes: "roi-minutes", adoption: "roi-adoption", ramp: "roi-ramp", rate: "roi-rate", reworkPct: "roi-rework-p" };
  const NUM_IDS = { volume: "roi-volume", visits: "roi-visits", rpv: "roi-rpv", reworkHours: "roi-rework-h", build: "roi-build", run: "roi-run" };

  function rangeHtml(key, label) {
    const cfg = rangeCfg(key, S.preset.v[key]);
    const v = Math.min(cfg.max, Math.max(cfg.min, S.inp[key]));
    return UI.range({ id: RANGE_IDS[key], label, min: cfg.min, max: cfg.max, step: cfg.step, value: v, display: RANGE_DISPLAY[key](v) });
  }
  function numHtml(key, label, help, step) {
    const id = NUM_IDS[key];
    return `<div class="field"><label for="${id}">${label}</label><input class="input" type="number" id="${id}" min="0" step="${step || "any"}" inputmode="decimal" value="${UI.esc(S.inp[key])}"${help ? ` aria-describedby="${id}-help"` : ""}>${help ? `<div class="roi-help" id="${id}-help">${UI.esc(help)}</div>` : ""}</div>`;
  }

  function inputsHtml() {
    const P = S.preset, n = P.notes || {};
    return `<div class="roi-group">
        <div class="label">Time saved</div>
        ${numHtml("volume", "Monthly volume · " + UI.esc(P.unit), n.volume, "1")}
        ${rangeHtml("minutes", "Minutes saved per unit")}
        ${n.minutes ? `<div class="roi-help">${UI.esc(n.minutes)}</div>` : ""}
        ${rangeHtml("adoption", "Adoption at steady state")}
        ${rangeHtml("ramp", "Ramp to steady state")}
        ${rangeHtml("rate", "Loaded hourly cost")}
      </div>
      <div class="roi-group">
        <div class="label">Visits and revenue</div>
        ${numHtml("visits", "Completed visits gained / month", n.visits, "1")}
        ${numHtml("rpv", "Revenue per completed visit ($)", "Weighted plan rate per billed visit for the plans and markets in scope.", "1")}
        <label class="roi-check" for="roi-once"><input type="checkbox" id="roi-once"${S.inp.once ? " checked" : ""}><span>Freed hours are what create the extra visits, so count the value once (exclude labor value from net)${n.once ? ". " + UI.esc(n.once) : ""}</span></label>
      </div>
      <div class="roi-group">
        <div class="label">Rework</div>
        ${numHtml("reworkHours", "Rework hours / month today", n.rework || "QA bounces, corrections and duplicate work this change removes.", "1")}
        ${rangeHtml("reworkPct", "Rework reduction")}
      </div>
      <div class="roi-group">
        <div class="label">Cost</div>
        <div class="roi-2">
          ${numHtml("build", "One-time build ($)", "", "500")}
          ${numHtml("run", "Run cost / month ($)", "", "50")}
        </div>
        <div class="roi-help">Build includes internal hours at loaded cost, vendor setup, security and privacy review, and training. Run covers licenses, API and SMS fees.</div>
      </div>`;
  }

  function contextHtml() {
    const o = S.opp;
    if (!o) {
      return `<div class="roi-ctx"><div class="field" style="flex:1 1 280px"><label for="roi-custom-name">Initiative name</label><input class="input" id="roi-custom-name" maxlength="90" value="${UI.esc(mem.customName)}"></div>
        <p class="small muted" style="flex:1 1 280px">A blank model with example drivers. Size an idea before it goes into the pipeline, then add it there with these numbers.</p></div>`;
    }
    return `<div class="roi-ctx">
      <div class="stack" style="gap:6px;flex:1 1 380px">
        <div class="row" style="gap:6px"><span class="mono xs muted">${UI.esc(o.id)}</span>${UI.pill("accent", o.stage || "Backlog")}${riskPill(o.risk)}${UI.tag(o.dept || "Unassigned")}${PRESETS && PRESETS[o.id] ? UI.pill("neutral", "Example drivers") : UI.pill("neutral", "Back-solved drivers")}</div>
        <p class="small">${UI.esc(o.problem || "No problem statement yet.")}</p>
      </div>
      <div class="roi-compare" id="roi-compare"></div>
    </div>`;
  }

  function compareHtml() {
    const o = S.opp;
    if (!o) return "";
    const r = S.res;
    return `<span>Pipeline record <b>${UI.fmt.num(num(o.hoursSavedPerMonth))} hrs/mo · ${moneyK(num(o.revenueImpactAnnual))}/yr</b></span><span aria-hidden="true">→</span><span>This model <b>${UI.fmt.num(r.hrsMo)} hrs/mo · ${moneyK(r.revYr)}/yr</b></span>
      <button type="button" class="btn ghost sm" data-act="pipeline">${UI.icon("list")} Open in pipeline</button>`;
  }

  function kpisHtml() {
    const r = S.res, inp = S.inp;
    const roiTxt = r.roi3 == null ? "n/a" : (r.roi3 < 0 ? "−" : "") + UI.fmt.num(Math.abs(r.roi3 * 100)) + "%";
    return [
      UI.kpi({ label: "Annual hours saved", value: UI.fmt.num(r.hrsYr), unit: "hrs", foot: UI.fmt.num(r.hrsMo) + " hrs/month at steady state" }),
      UI.kpi({ label: "FTE capacity freed", value: UI.fmt.dec(r.fte, 1), unit: "FTE", foot: "annual hours ÷ " + UI.fmt.num(FTE) }),
      UI.kpi({ label: "Annual labor value", value: moneyK(r.laborYr), foot: inp.once ? "Counted as visits; excluded from net" : "at $" + r0(inp.rate) + "/hr; capacity, not cash" }),
      UI.kpi({ label: "Annual revenue impact", value: moneyK(r.revYr), foot: UI.fmt.num(r.visitsMo) + " visits/mo × $" + UI.fmt.num(inp.rpv) }),
      UI.kpi({ label: "Net annual benefit", value: moneyK(r.netYr), foot: "steady state, after run cost" }),
      UI.kpi({ label: "Payback", value: r.payback != null ? "Month " + r.payback : "> 36 mo", foot: "includes " + moneyK(inp.build) + " build and ramp" }),
      UI.kpi({ label: "3-year ROI", value: roiTxt, foot: "net gain ÷ (build + 36 mo run)" }),
      UI.kpi({ label: "Year-1 net cash", value: moneyK(r.y1), foot: "after build, ramp and run cost" }),
    ].join("");
  }

  function stripHtml() {
    return `<div class="roi-strip" role="group" aria-label="Net annual benefit by scenario">${SCEN.map((s) => {
      const m = model(S.inp, s.k);
      return `<div class="roi-scen${s.value === mem.scenario ? " on" : ""}"><span class="label">${s.label} · ×${s.k}</span><b>${moneyK(m.netYr)}</b><span class="xs">net / yr · payback ${m.payback != null ? "M" + m.payback : "> 36 mo"}</span></div>`;
    }).join("")}</div>
    <p class="xs muted">Scenarios multiply the uncertain drivers (minutes saved, adoption, visits gained, rework reduction) by 0.7, 1.0 or 1.2. Volume, rates and costs stay fixed.</p>`;
  }

  // ---------- assumptions & measurement ----------
  function assumptionList() {
    const inp = S.inp, P = S.preset, how = P.how || {}, o = S.opp, k = kOf(mem.scenario);
    const topKeys = S.tor.rows.slice(0, 3).map((d) => (d.key === "reworkHours" || d.key === "reworkPct" ? "rework" : d.key));
    const a = [];
    const push = (key, text, h) => a.push({ key, text, how: h, top: topKeys.includes(key) });
    if (inp.volume > 0) push("volume", `${UI.fmt.num(inp.volume)} ${P.unit} per month`, how.volume || "Pull the last 3 months from the source system and confirm the eligible subset with the team lead.");
    if (inp.minutes > 0) push("minutes", `${dec(inp.minutes * k)} min saved per unit (${scenLabel(mem.scenario).toLowerCase()} scenario)`, how.minutes || "Time 20 to 30 real cases before and after with the pilot group; prefer system timestamps over self-report.");
    push("adoption", `${r0(Math.min(100, inp.adoption * k))}% of eligible work runs the new way at steady state, reached in ${inp.ramp || 0} month${inp.ramp === 1 ? "" : "s"}`, how.adoption || "Log usage from day one: units handled the new way ÷ eligible units, by team, every week.");
    if (inp.minutes > 0 || inp.reworkHours > 0) {
      push("rate", `$${r0(inp.rate)}/hr loaded cost`, "Confirm wage, benefits and overhead for the role with Finance.");
      push("capacity", inp.once ? "Freed hours fund the extra visits, so labor value is left out of net benefit" : "Freed hours are capacity; they become savings only when redeployed or when they replace a planned hire", inp.once ? "Check that the visit gain does not also assume new clinician hours." : "Name the redeployment (for example, more outreach attempts per agent) and track it, or confirm the avoided requisition with Finance.");
    }
    if (inp.visits > 0) {
      push("visits", `${UI.fmt.num(inp.visits * k)} more completed visits per month`, how.visits || "Attribute only the lift over a holdout or matched control; a visit counts once it is completed and billed.");
      push("rpv", `$${UI.fmt.num(inp.rpv)} revenue per completed visit`, "Use Finance's weighted plan rate for the plans and markets in scope; only billed visits count.");
    }
    if (inp.reworkHours > 0 && inp.reworkPct > 0) push("rework", `${UI.fmt.num(inp.reworkHours)} rework hours a month today, cut by ${r0(Math.min(100, inp.reworkPct * k))}%`, "Sample 4 weeks of rework (QA bounces, corrections) and time a subset.");
    push("build", `${money(inp.build)} one-time build`, "Include internal build hours (yours and engineering's) at loaded cost, vendor setup, security and privacy review, and training time.");
    if (inp.run > 0) push("run", `${money(inp.run)} a month to run`, "Get a vendor quote at projected volume (licenses, API or per-message fees) and add monitoring time.");
    if (o && o.risk === "High") push("phi", "Any vendor touching PHI works under a signed BAA", "Confirm BAA scope with Compliance, send minimum-necessary fields only, and log and sample outputs weekly.");
    a.sort((x, y) => (y.top ? 1 : 0) - (x.top ? 1 : 0));
    return a;
  }

  function assumeHtml() {
    const list = assumptionList();
    const r = S.res;
    const warn = r.roi3 != null && r.roi3 > 10
      ? `<div class="callout warning"><div><strong>3-year ROI above 1,000%.</strong> That usually means the build cost leaves out internal time. Add your hours and engineering's at loaded cost before this goes to Finance.</div></div>` : "";
    const neg = r.netYr < 0 ? `<div class="callout critical"><div><strong>Net annual benefit is negative.</strong> Run cost exceeds the value at these drivers. Cut run cost or prove a larger effect in the pilot.</div></div>` : "";
    return `<div class="panel-head"><div><h3>Assumptions to validate</h3><p class="panel-sub">Generated from the inputs. The three biggest drivers in the sensitivity chart go first.</p></div></div>
      ${warn}${neg}
      <ol class="roi-assume">${list.map((x) => `<li class="${x.top ? "top" : ""}"><div class="roi-a-head"><span>${UI.esc(x.text)}</span>${x.top ? UI.pill("warning", "Top driver") : ""}</div><div class="small muted">Validate: ${UI.esc(x.how)}</div></li>`).join("")}</ol>`;
  }

  function measurePlan() {
    const P = S.preset, o = S.opp;
    const w = OPS.data.weeks;
    const from = w[18], to = w[25];
    const end = new Date(new Date(to.start + "T12:00:00Z").getTime() + 6 * 86400000).toISOString().slice(0, 10);
    return {
      kpi: (o && o.kpi) || "Define the KPI before launch",
      bar: P.bar,
      baseline: `8 weeks before launch: ${from.label} to ${to.label} (${UI.fmt.date(from.start)} to ${UI.fmt.date(end)}) in this dataset, same markets and plans as the pilot.`,
      design: P.design,
      guard: P.guard,
      owner: (o && o.owner) || "Name a metric owner",
      cadence: "Weekly in the ops review for the first 8 weeks, go/no-go at week 8, then monthly. Re-run this model with actuals and save it to the pipeline.",
    };
  }

  function measureHtml() {
    const m = measurePlan();
    return `<div class="panel-head"><div><h3>How we'll measure it</h3><p class="panel-sub">Written before launch, so the result holds up in a finance review.</p></div></div>
      <dl class="roi-dl">
        <div><dt>Primary KPI</dt><dd>${UI.esc(m.kpi)}</dd></div>
        <div><dt>Go / no-go bar</dt><dd>${UI.esc(m.bar)} at week 8, with guardrails flat</dd></div>
        <div><dt>Baseline window</dt><dd>${UI.esc(m.baseline)}</dd></div>
        <div><dt>Pilot vs control</dt><dd>${UI.esc(m.design)}</dd></div>
        <div><dt>Guardrails</dt><dd>${UI.esc(m.guard)}</dd></div>
        <div><dt>Metric owner</dt><dd>${UI.esc(m.owner)}; ops analytics publishes the weekly number.</dd></div>
        <div><dt>Review cadence</dt><dd>${UI.esc(m.cadence)}</dd></div>
      </dl>
      <div class="presenter-note">I write the measurement plan before launch: a baseline window, a holdout or matched control, one owner, a go/no-go bar. That is how a result survives a finance review, and it is the part most automation projects skip.</div>`;
  }

  // ---------- charts ----------
  function cashChart() {
    const canvas = S.root.querySelector("#roi-cash");
    if (!canvas) return;
    const s0 = UI.series(0);
    const mono = UI.cssVar("--font-mono") || "monospace";
    const marker = {
      id: "roiCash",
      beforeDatasetsDraw(chart) {
        if (!S || !S.res) return;
        const { ctx, chartArea: a, scales: { x, y } } = chart;
        ctx.save();
        const ramp = Math.min(HORIZON, S.inp.ramp || 0);
        if (ramp > 0) {
          const x0 = x.getPixelForValue(0), x1 = x.getPixelForValue(ramp);
          ctx.fillStyle = UI.alpha(UI.cssVar("--ink-3"), 0.09);
          ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
          if (x1 - x0 > 36) { ctx.fillStyle = UI.cssVar("--ink-3"); ctx.font = "600 10px " + mono; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText("RAMP", x0 + 5, a.top + 5); }
        }
        if (y.min < 0 && y.max > 0) {
          const yz = y.getPixelForValue(0);
          ctx.strokeStyle = UI.cssVar("--line-strong"); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.left, yz); ctx.lineTo(a.right, yz); ctx.stroke();
        }
        ctx.restore();
      },
      afterDatasetsDraw(chart) {
        if (!S || !S.res || S.res.payback == null) return;
        const { ctx, chartArea: a, scales: { x, y } } = chart;
        const pb = S.res.payback;
        const px = x.getPixelForValue(pb);
        ctx.save();
        ctx.strokeStyle = UI.cssVar("--ink-2"); ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
        ctx.setLineDash([]);
        const py = y.getPixelForValue(S.res.cum[pb]);
        ctx.fillStyle = UI.cssVar("--surface"); ctx.strokeStyle = UI.cssVar("--ink"); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        const txt = "Break-even · month " + pb;
        ctx.font = "600 11px " + (UI.cssVar("--font-body") || "sans-serif");
        const tw = ctx.measureText(txt).width;
        const right = px + 8 + tw < a.right;
        ctx.fillStyle = UI.cssVar("--ink-2"); ctx.textBaseline = "top"; ctx.textAlign = right ? "left" : "right";
        ctx.fillText(txt, right ? px + 8 : px - 8, a.top + 22);
        ctx.restore();
      },
    };
    S.cash = UI.chart(canvas, {
      type: "line",
      data: { labels: Array.from({ length: HORIZON + 1 }, (_, i) => "M" + i), datasets: [{ label: "Cumulative net cash", data: S.res.cum.slice(), borderColor: s0, backgroundColor: UI.alpha(s0, 0.1), fill: "origin", tension: 0.15, pointHoverBackgroundColor: s0 }] },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: (it) => "Month " + it[0].dataIndex, label: (c) => "Cumulative net cash: " + UI.fmt.money(r0(c.raw)) } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, callback: function (v, i) { return i % 6 === 0 ? "M" + i : ""; } } },
          y: { ticks: { callback: (v) => UI.fmt.moneyK(v) } },
        },
      },
      plugins: [marker],
    });
  }

  function torChart() {
    const canvas = S.root.querySelector("#roi-tor");
    if (!canvas) return;
    const baseLine = {
      id: "roiBase",
      afterDatasetsDraw(chart) {
        if (!S || !S.tor || !S.tor.rows.length) return;
        const { ctx, chartArea: a, scales: { x } } = chart;
        const px = x.getPixelForValue(S.tor.base);
        ctx.save();
        ctx.strokeStyle = UI.cssVar("--ink-2"); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
        ctx.restore();
      },
    };
    S.torC = UI.chart(canvas, {
      type: "bar",
      data: torData(),
      options: {
        indexAxis: "y",
        interaction: { mode: "index", axis: "y", intersect: false },
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              title: (it) => { const d = S.tor.rows[it[0].dataIndex]; return d ? d.label + " (now " + d.fmt(d.val) + ")" : ""; },
              label: (c) => { const d = S.tor.rows[c.dataIndex]; if (!d) return ""; const v = c.datasetIndex === 0 ? d.lo : d.hi; return (c.datasetIndex === 0 ? "−20%: " : "+20%: ") + UI.fmt.moneyK(v) + " net/yr (" + signedK(v - S.tor.base) + ")"; },
            },
          },
        },
        scales: {
          x: { beginAtZero: false, grace: "6%", ticks: { callback: (v) => UI.fmt.moneyK(v) }, title: { display: true, text: "Net annual benefit (vertical line = current base)" } },
          y: { grid: { display: false } },
        },
      },
      plugins: [baseLine],
    });
  }

  function torData() {
    const t = S.tor;
    const narrow = S.root.querySelector("#roi-tor-box") && S.root.querySelector("#roi-tor-box").clientWidth < 520;
    return {
      labels: t.rows.map((d) => (narrow ? [d.label] : [d.label, "now " + d.fmt(d.val)])),
      datasets: [
        { label: "Driver −20%", data: t.rows.map((d) => [t.base, d.lo]), backgroundColor: UI.series(0), grouped: false, barPercentage: 0.72, categoryPercentage: 0.9 },
        { label: "Driver +20%", data: t.rows.map((d) => [t.base, d.hi]), backgroundColor: UI.series(1), grouped: false, barPercentage: 0.72, categoryPercentage: 0.9 },
      ],
    };
  }

  function torTakeaway() {
    const t = S.tor;
    if (!t.rows.length) return "Every driver is zero, so nothing moves the answer yet. Enter a volume and minutes saved, or visits gained.";
    const d = t.rows[0];
    const miss = (x) => moneyK(Math.abs(x.lo - t.base));
    const name = (x) => UI.esc(x.label.toLowerCase());
    const group = t.rows.filter((x) => Math.abs(x.swing - d.swing) <= d.swing * 0.01);
    if (group.length > 1) {
      const names = group.map(name);
      const list = names.length === 2 ? names.join(" and ") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
      const firsts = group.filter((x) => UNCERTAIN.includes(x.key)).slice(0, 2).map(name);
      const known = group.filter((x) => !UNCERTAIN.includes(x.key)).map(name);
      const knownTxt = known.length ? `${known.length === 1 ? known[0] + " is" : known.slice(0, -1).join(", ") + " and " + known[known.length - 1] + " are"} already known from the data; ` : "";
      return `<strong>${list.charAt(0).toUpperCase() + list.slice(1)} tie as the biggest levers.</strong> They multiply together, so a 20% miss on any one moves net annual benefit by ${miss(d)}. ${firsts.length ? `${knownTxt.charAt(0).toUpperCase() + knownTxt.slice(1)}${knownTxt ? "validate" : "Validate"} ${firsts.join(" and ")} first in the pilot.` : "Validate the least certain one first in the pilot."}`;
    }
    const second = t.rows[1];
    return `<strong>Biggest lever: ${name(d)}.</strong> A 20% miss moves net annual benefit by ${miss(d)}${second ? `; next is ${name(second)} at ${miss(second)}` : ""}. Validate these first in the pilot.`;
  }

  // ---------- update loop ----------
  function readInputs() {
    const root = S.root;
    const val = (id) => { const el = root.querySelector("#" + id); if (!el) return 0; const v = parseFloat(el.value); return isFinite(v) ? Math.max(0, v) : 0; };
    Object.keys(NUM_IDS).forEach((k) => (S.inp[k] = val(NUM_IDS[k])));
    Object.keys(RANGE_IDS).forEach((k) => {
      S.inp[k] = val(RANGE_IDS[k]);
      const out = root.querySelector("#" + RANGE_IDS[k] + "-out");
      if (out) out.textContent = RANGE_DISPLAY[k](S.inp[k]);
    });
    const once = root.querySelector("#roi-once");
    S.inp.once = !!(once && once.checked);
    mem.drafts[S.key] = Object.assign({}, S.inp);
  }

  function update() {
    const k = kOf(mem.scenario);
    S.res = model(S.inp, k);
    S.tor = tornado(S.inp, k);
    const root = S.root;
    root.querySelector("#roi-kpis").innerHTML = kpisHtml();
    root.querySelector("#roi-strip").innerHTML = stripHtml();
    const cmp = root.querySelector("#roi-compare");
    if (cmp) cmp.innerHTML = compareHtml();
    root.querySelector("#roi-assume").innerHTML = assumeHtml();
    root.querySelector("#roi-measure").innerHTML = measureHtml();
    root.querySelector("#roi-tor-note").innerHTML = torTakeaway();
    const box = root.querySelector("#roi-tor-box");
    if (box) { box.style.height = Math.max(150, S.tor.rows.length * 46 + 76) + "px"; box.hidden = !S.tor.rows.length; }
    const save = root.querySelector("#roi-save");
    if (save) { save.disabled = !S.opp; save.title = S.opp ? "Write hours/month and annual revenue back to " + S.opp.id : "Pick an opportunity to save results to the pipeline"; }
    if (S.cash) { S.cash.data.datasets[0].data = S.res.cum.slice(); S.cash.update(); } else cashChart();
    if (S.torC) { const d = torData(); S.torC.data.labels = d.labels; S.torC.data.datasets[0].data = d.datasets[0].data; S.torC.data.datasets[1].data = d.datasets[1].data; S.torC.update(); } else torChart();
  }

  function pickerOptions() {
    return OPS.opps.all().map((o) => ({ value: o.id, label: o.id + " · " + oppTitle(o) })).concat([{ value: "custom", label: "Custom initiative (blank model)" }]);
  }

  function selectKey(key) {
    if (key !== "custom" && !OPS.opps.get(key)) key = "custom";
    S.key = key;
    mem.last = key;
    S.opp = key === "custom" ? null : OPS.opps.get(key);
    S.preset = presetFor(key, S.opp);
    S.inp = Object.assign({}, mem.drafts[key] || S.preset.v);
    const sel = S.root.querySelector("#roi-opp");
    if (sel && sel.value !== key) sel.value = key;
    S.root.querySelector("#roi-context").innerHTML = contextHtml();
    S.root.querySelector("#roi-inputs").innerHTML = inputsHtml();
    update();
  }

  // ---------- business case ----------
  function caseText() {
    const r = S.res, inp = S.inp, o = S.opp, m = measurePlan();
    const name = o ? o.id + " " + oppTitle(o) : mem.customName || "Custom initiative";
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const roiTxt = r.roi3 == null ? "n/a" : r0(r.roi3 * 100) + "%";
    const L = [];
    L.push("BUSINESS CASE: " + name);
    L.push(`${scenLabel(mem.scenario)} scenario · prepared ${today} · owner: ${(o && o.owner) || "to be named"}${o && o.source === "seed" ? " · example data (synthetic)" : ""}`);
    L.push("");
    if (o && o.problem) { L.push("Problem"); L.push(o.problem); L.push(""); }
    if (o && o.solution) { L.push("Proposed change"); L.push(o.solution); L.push(""); }
    L.push("Impact at steady state");
    L.push(`- ${UI.fmt.num(r.hrsYr)} hours/year freed (${UI.fmt.dec(r.fte, 1)} FTE of capacity), worth ${money(r.laborYr)} at $${r0(inp.rate)}/hr loaded${inp.once ? "; counted once, as the visits below" : ""}`);
    if (r.revYr > 0) L.push(`- ${UI.fmt.num(r.visitsMo)} more completed visits/month: ${money(r.revYr)}/year at $${UI.fmt.num(inp.rpv)} per visit`);
    L.push(`- Cost: ${money(inp.build)} one-time build, ${money(inp.run)}/month to run`);
    L.push(`- Net annual benefit ${money(r.netYr)} · payback ${r.payback != null ? "month " + r.payback : "beyond 36 months"} · 3-year ROI ${roiTxt} · year-1 net cash ${money(r.y1)}`);
    L.push(`- Scenario range (net/yr): ${SCEN.map((s) => s.label + " " + moneyK(model(inp, s.k).netYr)).join(" · ")}`);
    L.push("");
    if (S.tor.rows.length) {
      L.push("What moves the answer (±20% on each driver)");
      S.tor.rows.slice(0, 3).forEach((d, i) => L.push(`${i + 1}. ${d.label} (now ${d.fmt(d.val)}): ${moneyK(Math.min(d.lo, d.hi))} to ${moneyK(Math.max(d.lo, d.hi))} net/yr`));
      L.push("");
    }
    L.push("Assumptions to validate before scaling");
    assumptionList().slice(0, 6).forEach((a) => L.push(`- ${a.text}. Validate: ${a.how}`));
    L.push("");
    L.push("How we'll measure it");
    L.push(`- KPI: ${m.kpi}; go/no-go: ${m.bar} at week 8 with guardrails flat`);
    L.push(`- Baseline: ${m.baseline}`);
    L.push(`- Design: ${m.design}`);
    L.push(`- Guardrails: ${m.guard}`);
    L.push(`- Owner: ${m.owner}; weekly review for 8 weeks, then monthly`);
    L.push("");
    L.push("Note: freed hours are capacity. They become savings only when redeployed (for example, more outreach attempts per agent) or when they replace a planned hire.");
    L.push("");
    L.push("Decision requested");
    L.push(`Approve ${money(inp.build)} to build and run the pilot above, with a go/no-go at week 8.`);
    return L.join("\n");
  }

  function saveToOpp() {
    const o = S.opp && OPS.opps.get(S.opp.id);
    if (!o) return;
    const hrs = r0(S.res.hrsMo);
    const rev = r0(S.res.revYr / 1000) * 1000;
    OPS.opps.save(Object.assign({}, o, { hoursSavedPerMonth: hrs, revenueImpactAnnual: rev }));
    UI.toast(`Saved to ${o.id}: ${UI.fmt.num(hrs)} hrs/month, ${moneyK(rev)}/yr revenue (${scenLabel(mem.scenario)})`);
  }

  // ---------- register ----------
  OPS.register({
    id: ID,
    title: "Impact & ROI Model",
    stage: "prioritize",
    order: 20,
    icon: "dollar",
    eyebrow: "3 · Prioritize",
    summary: "Size an opportunity in hours, visits and dollars from explicit drivers, see which assumption moves the answer most, and write the measurement plan before anything gets built.",
    jd: [
      "Quantify the impact of process improvements",
      "Analyze operational data, define KPIs",
      "Clear metrics on efficiency, accuracy, speed, or cost",
      "Success is measured by real-world business impact",
    ],
    render(root, ctx) {
      UI.style(ID, CSS);
      const want = (ctx.params && ctx.params.opp) || mem.last || "OPP-02";
      S = { root, ctx, key: null, opp: null, preset: null, inp: null, res: null, tor: null, cash: null, torC: null };
      root.innerHTML = `
        <div class="panel">
          <div class="roi-top-row">
            <div class="roi-pick">${UI.select("roi-opp", pickerOptions(), want, "Opportunity")}</div>
            <div class="field"><span id="roi-scen-label">Scenario</span>${UI.seg("roi-scen", SCEN.map((s) => ({ value: s.value, label: s.label })), mem.scenario)}</div>
            <div class="roi-top-actions">
              <button type="button" class="btn ghost" id="roi-reset">Reset inputs</button>
              <button type="button" class="btn" id="roi-save">${UI.icon("check")} Save to opportunity</button>
              <button type="button" class="btn primary" id="roi-copy">${UI.icon("copy")} Copy business case</button>
            </div>
          </div>
          <div id="roi-context"></div>
        </div>
        <div class="presenter-note">I size every opportunity before building it, and I keep hours freed separate from cash. Freed capacity is worth money only when we redeploy it or skip a hire, and the model says so in every output.</div>
        <div class="roi-layout">
          <div class="panel roi-inputs" id="roi-inputs" aria-label="Model drivers"></div>
          <div class="stack roi-results" style="gap:16px">
            <div class="grid g-4" id="roi-kpis"></div>
            <div class="stack" id="roi-strip" style="gap:6px"></div>
            <div class="panel">
              <div class="panel-head"><div><h3>Cumulative net cash, 36 months</h3><p class="panel-sub">Build cost up front, benefits ramping to steady state, run cost every month.</p></div></div>
              <div class="chart-box"><canvas id="roi-cash" role="img" aria-label="Cumulative net cash over 36 months with the ramp period shaded and the break-even month marked"></canvas></div>
            </div>
            <div class="panel">
              <div class="panel-head"><div><h3>What moves the answer</h3><p class="panel-sub">Net annual benefit when each driver is 20% lower or higher, biggest swing first.</p></div></div>
              <div class="chart-box" id="roi-tor-box"><canvas id="roi-tor" role="img" aria-label="Tornado chart of net annual benefit sensitivity to each driver at plus and minus 20 percent"></canvas></div>
              <p class="roi-takeaway" id="roi-tor-note"></p>
              <div class="presenter-note">The tornado tells me which assumption to validate first. For AI call notes it is minutes saved and adoption, so the pilot is designed to measure exactly those two numbers.</div>
            </div>
          </div>
        </div>
        <div class="grid g-2">
          <div class="panel" id="roi-assume"></div>
          <div class="panel" id="roi-measure"></div>
        </div>`;
      const seg = root.querySelector("#roi-scen");
      if (seg) seg.setAttribute("aria-labelledby", "roi-scen-label");

      UI.on(root, "change", "#roi-opp", (e, el) => selectKey(el.value));
      UI.wireSeg(root, "roi-scen", (v) => { mem.scenario = v; update(); });
      const inputs = root.querySelector("#roi-inputs");
      inputs.addEventListener("input", () => { readInputs(); update(); });
      inputs.addEventListener("change", () => { readInputs(); update(); });
      UI.on(root, "input", "#roi-custom-name", (e, el) => { mem.customName = el.value; });
      UI.on(root, "click", "#roi-reset", () => { delete mem.drafts[S.key]; selectKey(S.key); UI.toast("Inputs reset to the default drivers"); });
      UI.on(root, "click", "#roi-save", () => saveToOpp());
      UI.on(root, "click", "#roi-copy", () => UI.copy(caseText(), "Business case copied"));
      UI.on(root, "click", '[data-act="pipeline"]', () => { if (S.opp) OPS.navigate("pipeline", { focus: S.opp.id }); });

      onChange = () => {
        if (!S) return;
        const sel = root.querySelector("#roi-opp");
        if (sel) {
          sel.innerHTML = pickerOptions().map((o) => `<option value="${UI.esc(o.value)}">${UI.esc(o.label)}</option>`).join("");
          sel.value = OPS.opps.get(S.key) || S.key === "custom" ? S.key : "custom";
        }
        if (S.key !== "custom" && !OPS.opps.get(S.key)) return selectKey("custom");
        S.opp = S.key === "custom" ? null : OPS.opps.get(S.key);
        root.querySelector("#roi-context").innerHTML = contextHtml();
        update();
      };
      document.addEventListener("ops:opps-changed", onChange);
      selectKey(want);
    },
    destroy() {
      if (onChange) document.removeEventListener("ops:opps-changed", onChange);
      onChange = null;
      S = null;
    },
  });
})();
