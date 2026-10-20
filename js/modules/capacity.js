/* Throughline · Clinician Capacity
 *
 * Proves: "Analyze provider utilization and build processes that increase completed visits per clinician".
 * Uses the 4-week clinician roster (OPS.data.clinicians) for supply and the weekly funnel for the demand trend.
 * Sections: KPI row → market capacity vs demand → where a clinician's day goes → what-if levers →
 * Charlotte hiring planner → sortable clinician table with flags.
 */
(function () {
  "use strict";
  const OPS = window.OPS;
  const UI = window.UI;
  if (!OPS || !UI) return;

  const ID = "capacity";
  const F = UI.fmt;
  const PER_MONTH = 52 / 12 / 4; // 4-week roster window → month
  const LAST4 = { from: 22, to: 25 };
  const HORIZON = 26; // planner weeks

  // Labelled assumptions; everything else is computed from the data
  const ASSUME = {
    idleDriveShare: 0.5, // share of drive time lost on an in-home no-show (found at the door)
    docFloor: 12, // documentation minutes per visit that AI assist cannot remove (review + sign-off)
    loadedClinician: 165000, // annual loaded cost of an in-home NP
    rampWeeks: 8, // weeks a new clinician runs below full productivity
    rampFactor: 0.6, // productivity during ramp
    targetHigh: 0.95,
  };
  const LEVER_DEFAULTS = { scope: "all", drive: 20, doc: 8, backfill: 40, tele: 10, conv: 60 };

  // ---------- helpers ----------
  const sumBy = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
  const isHome = (c) => c.modality === "In-home";
  const weekDate = (t) => {
    const last = OPS.data.weeks[OPS.data.weeks.length - 1];
    const d = new Date(Date.parse(last.start + "T12:00:00Z") + Math.round(t) * 7 * 86400000);
    return d.toISOString().slice(0, 10);
  };
  const weekLabel = (t) => F.date(weekDate(t));

  /** weekly growth from a log-linear fit */
  function growth(values) {
    const n = values.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    values.forEach((v, i) => { const y = Math.log(Math.max(1, v)); sx += i; sy += y; sxx += i * i; sxy += i * y; });
    return Math.exp((n * sxy - sx * sy) / (n * sxx - sx * sx)) - 1;
  }

  // ---------- analysis (cached; the roster is static) ----------
  let BASE = null;
  function base() {
    if (BASE) return BASE;
    const C = OPS.data.clinicians;
    const markets = OPS.data.markets;
    const appts = OPS.data.appointments;
    const teleVisit = {};
    markets.forEach((m) => {
      const t = C.filter((c) => c.market === m.id && !isHome(c));
      teleVisit[m.id] = t.length ? sumBy(t, (c) => c.avgVisitMin) / t.length : 36;
    });
    const rows = C.map((c) => {
      const home = isHome(c);
      const util = c.scheduled / c.capacity;
      const failed = Math.max(0, c.scheduled - c.completed);
      const flags = [];
      if (util > 0.95) flags.push({ lvl: "serious", text: "Util " + F.pct(util, 0) });
      if (util < 0.7) flags.push({ lvl: "warning", text: "Util " + F.pct(util, 0) });
      if (c.avgDocMin > 35) flags.push({ lvl: "warning", text: "Doc " + c.avgDocMin + "m" });
      if (c.chartLagHrs > 36) flags.push({ lvl: "warning", text: "Lag " + c.chartLagHrs + "h" });
      if (c.qaPassRate < 0.9) flags.push({ lvl: "critical", text: "QA " + F.pct(c.qaPassRate, 0) });
      return Object.assign({}, c, {
        home, util, failed,
        perDay: c.completed / c.daysWorked,
        yieldR: c.scheduled ? c.completed / c.scheduled : 0,
        idleMin: c.completed ? (failed * (c.avgVisitMin + (home ? ASSUME.idleDriveShare * c.avgDriveMin : 0))) / c.completed : 0,
        newHire: c.tenureMonths <= 3,
        marketName: OPS.q.marketName(c.market),
        flags,
      });
    });
    const agg = (list) => {
      const comp = sumBy(list, (c) => c.completed);
      const homes = list.filter((c) => c.home);
      const compHome = sumBy(homes, (c) => c.completed);
      return {
        n: list.length,
        cap: sumBy(list, (c) => c.capacity),
        sched: sumBy(list, (c) => c.scheduled),
        comp,
        days: sumBy(list, (c) => c.daysWorked),
        cancels: sumBy(list, (c) => c.sameDayCancels),
        util: sumBy(list, (c) => c.scheduled) / (sumBy(list, (c) => c.capacity) || 1),
        perDay: comp / (sumBy(list, (c) => c.daysWorked) || 1),
        drive: compHome ? sumBy(homes, (c) => c.avgDriveMin * c.completed) / compHome : 0,
        visit: comp ? sumBy(list, (c) => c.avgVisitMin * c.completed) / comp : 0,
        driveAll: comp ? sumBy(list, (c) => c.avgDriveMin * c.completed) / comp : 0,
        doc: comp ? sumBy(list, (c) => c.avgDocMin * c.completed) / comp : 0,
        idle: comp ? sumBy(list, (c) => c.idleMin * c.completed) / comp : 0,
        lag: comp ? sumBy(list, (c) => c.chartLagHrs * c.completed) / comp : 0,
        qa: comp ? sumBy(list, (c) => c.qaPassRate * c.completed) / comp : 0,
      };
    };
    const g = growth(OPS.q.byWeek({}).map((w) => w.assigned));
    const net = agg(rows);
    const byMarket = markets.map((m) => {
      const list = rows.filter((c) => c.market === m.id);
      const a = agg(list);
      const ap = appts.filter((x) => x.market === m.id);
      const f4 = OPS.q.funnel({ market: m.id, from: LAST4.from, to: LAST4.to });
      const early = OPS.q.funnel({ market: m.id, from: 0, to: 15 });
      const late = OPS.q.funnel({ market: m.id, from: 16, to: 25 });
      const gm = growth(OPS.q.byWeek({ market: m.id }).map((w) => w.assigned));
      return Object.assign(a, {
        id: m.id, name: m.name, list,
        lead: ap.length ? sumBy(ap, (x) => x.leadDays) / ap.length : 0,
        showRate: f4.showRate, showEarly: early.showRate, showLate: late.showRate,
        revPerVisit: f4.completed ? f4.revenue / f4.completed : 0,
        growth: gm,
        weeksTo95: a.util >= ASSUME.targetHigh ? 0 : Math.log(ASSUME.targetHigh / a.util) / Math.log(1 + g),
      });
    });
    const apptLead = sumBy(appts, (x) => x.leadDays) / appts.length;
    const newHires = rows.filter((c) => c.newHire);
    const tenured = rows.filter((c) => !c.newHire);
    BASE = { rows, net, byMarket, g, teleVisit, apptLead, newHires, tenured, nh: agg(newHires), ten: agg(tenured) };
    return BASE;
  }

  // ---------- levers ----------
  function leverFor(c, L, applies) {
    const B = base();
    const v = c.perDay;
    const out = { v, after: v, addedSlots: 0, fromTime: 0, backfill: 0, backfillSlots: 0, freedDrive: 0, freedDoc: 0, freedTele: 0, docSavedMin: 0 };
    if (!applies) return out;
    const drive1 = c.home ? c.avgDriveMin * (1 - L.drive / 100) : 0;
    const doc1 = Math.max(ASSUME.docFloor, c.avgDocMin - L.doc);
    const t = c.home ? L.tele / 100 : 0;
    const tv = B.teleVisit[c.market] || 36;
    out.freedDrive = c.home ? v * (c.avgDriveMin - drive1) : 0;
    out.freedDoc = v * Math.max(0, c.avgDocMin - doc1);
    out.freedTele = v * t * Math.max(0, c.avgVisitMin + drive1 - tv);
    out.docSavedMin = Math.max(0, c.avgDocMin - doc1);
    const cycle1 = (1 - t) * (c.avgVisitMin + drive1) + t * tv + doc1;
    const freed = out.freedDrive + out.freedDoc + out.freedTele;
    out.addedSlots = (freed * (L.conv / 100)) / cycle1;
    out.fromTime = out.addedSlots * c.yieldR;
    out.backfillSlots = (c.sameDayCancels / c.daysWorked) * (L.backfill / 100);
    out.backfill = out.backfillSlots * c.yieldR;
    out.after = v + out.fromTime + out.backfill;
    return out;
  }

  function runLevers(L) {
    const B = base();
    const res = B.byMarket.map((m) => {
      const applies = L.scope === "all" || L.scope === m.id;
      let after = 0, added = 0, addedSlots = 0, drive = 0, doc = 0, tele = 0, bf = 0, docHours = 0;
      m.list.forEach((c) => {
        const r = leverFor(c, L, applies);
        after += r.after * c.daysWorked;
        added += (r.after - r.v) * c.daysWorked;
        addedSlots += (r.addedSlots + r.backfillSlots) * c.daysWorked;
        const freed = r.freedDrive + r.freedDoc + r.freedTele;
        if (freed > 0) {
          drive += r.fromTime * (r.freedDrive / freed) * c.daysWorked;
          doc += r.fromTime * (r.freedDoc / freed) * c.daysWorked;
          tele += r.fromTime * (r.freedTele / freed) * c.daysWorked;
        }
        bf += r.backfill * c.daysWorked;
        docHours += (r.docSavedMin * c.completed) / 60;
      });
      return {
        id: m.id, name: m.name, applies,
        before: m.perDay, after: after / m.days,
        addedMonth: added * PER_MONTH, addedSlotsWeek: addedSlots / 4,
        parts: { drive: drive * PER_MONTH, doc: doc * PER_MONTH, tele: tele * PER_MONTH, backfill: bf * PER_MONTH },
        revenue: added * PER_MONTH * m.revPerVisit,
        docHoursMonth: docHours * PER_MONTH,
      };
    });
    const inScope = res.filter((r) => r.applies);
    const scopeMarkets = B.byMarket.filter((m) => L.scope === "all" || L.scope === m.id);
    const days = sumBy(scopeMarkets, (m) => m.days);
    const comp = sumBy(scopeMarkets, (m) => m.comp);
    const n = sumBy(scopeMarkets, (m) => m.n);
    const added = sumBy(inScope, (r) => r.addedMonth);
    const perClinMonth = (comp / (n || 1)) * PER_MONTH;
    return {
      byMarket: res,
      before: comp / (days || 1),
      after: (comp + sumBy(inScope, (r) => r.addedMonth) / PER_MONTH) / (days || 1),
      added,
      revenue: sumBy(inScope, (r) => r.revenue),
      fte: added / (perClinMonth || 1),
      perClinMonth,
      docHours: sumBy(inScope, (r) => r.docHoursMonth),
      parts: ["drive", "doc", "tele", "backfill"].reduce((o, k) => { o[k] = sumBy(inScope, (r) => r.parts[k]); return o; }, {}),
      partRevenue: ["drive", "doc", "tele", "backfill"].reduce((o, k) => { o[k] = sumBy(inScope, (r) => r.parts[k] * B.byMarket.find((m) => m.id === r.id).revPerVisit); return o; }, {}),
    };
  }

  // ---------- Charlotte planner ----------
  function plan(P, L) {
    const B = base();
    const m = B.byMarket.find((x) => x.id === "clt");
    const g = m.growth;
    const capWk = m.cap / 4;
    const dem0 = m.sched / 4;
    const homes = m.list.filter((c) => c.home);
    const perHire = homes.length ? (sumBy(homes, (c) => c.slotsPerDay * c.daysWorked) / homes.length) / 4 : 33;
    const levRes = runLevers(Object.assign({}, L, { scope: "clt" })).byMarket.find((x) => x.id === "clt");
    const leverWk = P.levers ? levRes.addedSlotsWeek : 0;
    const target = P.target / 100;
    const cross = (cap) => Math.log(cap / dem0) / Math.log(1 + g);
    const capPlanBase = capWk + leverWk;
    const demH = dem0 * Math.pow(1 + g, HORIZON);
    const hires = Math.max(0, Math.ceil((demH / target - capPlanBase) / perHire));
    const hireList = [];
    for (let k = 1; k <= hires; k++) {
      const need = cross((capPlanBase + (k - 1) * perHire) * target); // week the plan needs hire k productive
      const reqBy = need - P.leadWeeks - ASSUME.rampWeeks * (1 - ASSUME.rampFactor);
      const start = Math.max(P.leadWeeks, Math.round(need - ASSUME.rampWeeks * (1 - ASSUME.rampFactor)));
      hireList.push({ k, need, reqBy, start });
    }
    const hiresNoLever = Math.max(0, Math.ceil((demH / target - capWk) / perHire));
    const series = { labels: [], demand: [], cap: [], lev: [], plan: [] };
    for (let t = 0; t <= HORIZON; t++) {
      series.labels.push(weekLabel(t));
      series.demand.push(dem0 * Math.pow(1 + g, t));
      series.cap.push(capWk);
      series.lev.push(capWk + (levRes ? levRes.addedSlotsWeek : 0));
      let c = capPlanBase;
      hireList.forEach((h) => {
        if (t >= h.start) c += perHire * (t - h.start < ASSUME.rampWeeks ? ASSUME.rampFactor : 1);
      });
      series.plan.push(c);
    }
    return {
      m, g, capWk, dem0, perHire, leverWk, leverWkAvail: levRes ? levRes.addedSlotsWeek : 0, target,
      crossNow: cross(capWk), crossLev: cross(capWk + (levRes ? levRes.addedSlotsWeek : 0)),
      targetNow: cross(capWk * target), hires, hiresNoLever, hireList, series, demH,
    };
  }

  // ---------- charts ----------
  let charts = [];
  const track = (c) => { if (c) charts.push(c); return c; };
  function killCharts() { charts.forEach((c) => { try { c.destroy(); } catch (e) { /* ignore */ } }); charts = []; }
  let afterChart = null, planChart = null;

  // ---------- state ----------
  const state = {
    L: Object.assign({}, LEVER_DEFAULTS),
    P: { target: 85, leadWeeks: 10, levers: true },
    sort: { key: "flagsN", dir: -1 },
    filter: "all",
  };

  // ---------- CSS ----------
  const CSS = `
  .cap-market { display: grid; gap: 16px; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); align-items: start; }
  .cap-flags { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .cap-flags .callout { flex-direction: column; gap: 6px; }
  .cap-flags ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 2px; color: var(--ink-2); }
  .cap-insight { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .cap-insight > div { border-left: 3px solid var(--accent); padding: 4px 0 4px 12px; font-size: var(--fs-sm); color: var(--ink-2); min-width: 0; }
  .cap-insight strong { display: block; color: var(--ink); font-size: var(--fs-md); }
  .cap-lev { display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); gap: 18px; align-items: start; }
  .cap-ctrl { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 14px; }
  .cap-ctrl .range-row small { grid-column: 1 / -1; font-size: var(--fs-xs); color: var(--ink-3); margin-top: -2px; }
  .cap-tiles { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
  .cap-tiles .kpi-value { font-size: 1.6rem; }
  .cap-arrow { color: var(--ink-3); font-weight: 500; margin: 0 4px; }
  .cap-plan { display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 18px; align-items: start; }
  .cap-sort { font: inherit; font-weight: 600; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; letter-spacing: inherit; }
  .cap-sort:hover { color: var(--ink); }
  .cap-sort i { font-style: normal; color: var(--ink-3); font-size: 0.85em; }
  .cap-flagcell { display: flex; flex-wrap: wrap; gap: 4px; min-width: 128px; }
  .cap-tbl th, .cap-tbl td { padding-left: 8px; padding-right: 8px; }
  .cap-name { white-space: nowrap; }
  .cap-tbl td { vertical-align: middle; }
  .cap-hirelist { margin: 0; padding-left: 18px; font-size: var(--fs-sm); color: var(--ink-2); display: flex; flex-direction: column; gap: 3px; }
  @media (max-width: 1100px) {
    .cap-market, .cap-lev, .cap-plan { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 560px) {
    .cap-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .cap-tiles .kpi { padding: 12px; }
    .cap-tiles .kpi-value { font-size: 1.25rem; }
  }`;

  // ---------- sections ----------
  function kpis() {
    const B = base();
    const n = B.net;
    const phx = B.byMarket.find((m) => m.id === "phx");
    const homes = B.rows.filter((c) => c.home), teles = B.rows.filter((c) => !c.home);
    const pd = (list) => sumBy(list, (c) => c.completed) / (sumBy(list, (c) => c.daysWorked) || 1);
    return `<div class="grid g-6">
      ${UI.kpi({ label: "Utilization", value: F.pct(n.util, 0), foot: "Scheduled ÷ capacity · target 85–90%" })}
      ${UI.kpi({ label: "Completed visits / clinician-day", value: F.dec(n.perDay, 1), foot: "In-home " + F.dec(pd(homes), 1) + " · telehealth " + F.dec(pd(teles), 1) })}
      ${UI.kpi({ label: "Drive per visit (in-home)", value: F.num(n.drive), unit: "min", foot: "Phoenix " + F.num(phx.drive) + " min" })}
      ${UI.kpi({ label: "Documentation per visit", value: F.num(n.doc), unit: "min", foot: "New hires " + F.num(B.nh.doc) + " min" })}
      ${UI.kpi({ label: "Chart lag", value: F.num(n.lag), unit: "hrs", foot: "Visit to signed chart · target ≤ 24" })}
      ${UI.kpi({ label: "QA first-pass", value: F.pct(n.qa, 1), foot: "New hires " + F.pct(B.nh.qa, 0) })}
    </div>
    <p class="xs muted">Roster: ${B.rows.length} NPs and RNs across ${B.byMarket.length} markets, last 4 weeks (${F.num(n.cap)} visit slots, ${F.num(n.sched)} booked, ${F.num(n.comp)} completed). Demand trend from the weekly funnel: members assigned for outreach grow ${F.pct(B.g, 1)} a week.</p>`;
  }

  function marketPanel() {
    const B = base();
    const clt = B.byMarket.find((m) => m.id === "clt");
    const phx = B.byMarket.find((m) => m.id === "phx");
    const netHomeDrive = B.net.drive;
    const others = B.byMarket.filter((m) => m.id !== "phx");
    const othersDrive = sumBy(others, (m) => m.drive * m.comp) / sumBy(others, (m) => m.comp);
    const phxHomeUtil = sumBy(phx.list.filter((c) => c.home), (c) => c.scheduled) / sumBy(phx.list.filter((c) => c.home), (c) => c.capacity);
    const tbl = UI.table([
      { key: "name", label: "Market", fmt: (v) => `<strong>${UI.esc(v)}</strong>` },
      { key: "n", label: "Clinicians", num: true },
      { key: "util", label: "Utilization", num: true, fmt: (v) => (v > 0.95 ? UI.pill("critical", F.pct(v, 0)) : v < 0.75 ? UI.pill("warning", F.pct(v, 0)) : F.pct(v, 0)) },
      { key: "perDay", label: "Visits / clin-day", num: true, fmt: (v) => F.dec(v, 1) },
      { key: "lead", label: "Avg lead (days)", num: true, fmt: (v) => F.dec(v, 1) },
      { key: "showRate", label: "Show rate", num: true, fmt: (v) => F.pct(v, 1) },
      { key: "drive", label: "Drive min (in-home)", num: true, fmt: (v) => F.num(v) },
      { key: "weeksTo95", label: "Reaches 95% util", num: true, fmt: (v) => (v <= 0 ? UI.pill("critical", "Now") : "~" + Math.round(v) + " wks · " + weekLabel(v)) },
    ], B.byMarket);
    return `<div class="panel">
      <div class="panel-head"><div><h2>Capacity vs scheduled demand by market</h2><p class="panel-sub">Visit slots vs booked visits, last 4 weeks. Utilization under each market name.</p></div></div>
      <div class="cap-market">
        <div class="chart-box"><canvas id="cap-mkt" role="img" aria-label="Capacity and scheduled visits by market"></canvas></div>
        <div class="cap-flags">
          <div class="callout critical"><div>${UI.pill("critical", "Charlotte · at capacity")}</div><ul class="small">
            <li><strong>${F.pct(clt.util, 0)}</strong> of slots booked; no room for same-day adds.</li>
            <li>Members wait <strong>${F.dec(clt.lead, 1)} days</strong> for a visit vs ${F.dec(B.apptLead, 1)} network.</li>
            <li>Show rate slipped from ${F.pct(clt.showEarly, 1)} (W1–W16) to <strong>${F.pct(clt.showLate, 1)}</strong> (W17–W26) as lead times grew.</li>
          </ul></div>
          <div class="callout warning"><div>${UI.pill("warning", "Phoenix · open slots, long drives")}</div><ul class="small">
            <li>In-home clinicians only <strong>${F.pct(phxHomeUtil, 0)}</strong> booked.</li>
            <li><strong>${F.num(phx.drive)} min</strong> of drive per visit vs ${F.num(othersDrive)} in other markets.</li>
            <li>Show rate <strong>${F.pct(phx.showRate, 1)}</strong>, lowest in the network: distance drives no-shows too.</li>
          </ul></div>
        </div>
      </div>
      ${tbl}
      <div class="presenter-note">Network utilization looks healthy at ${F.pct(B.net.util, 0)}, and that average hides two opposite problems. Charlotte is full, so members wait ${F.dec(clt.lead, 0)} days and the show rate is slipping. Phoenix has open slots because each visit costs ${F.num(phx.drive)} minutes of driving. One needs capacity, the other needs routing.</div>
    </div>`;
  }

  function drawMarket() {
    const B = base();
    track(UI.chart("cap-mkt", {
      type: "bar",
      data: {
        labels: B.byMarket.map((m) => [m.name, F.pct(m.util, 0) + " util"]),
        datasets: [
          { label: "Capacity (slots)", data: B.byMarket.map((m) => m.cap), backgroundColor: UI.series(0), maxBarThickness: 30 },
          { label: "Scheduled visits", data: B.byMarket.map((m) => m.sched), backgroundColor: UI.series(1), maxBarThickness: 30 },
        ],
      },
      options: {
        plugins: { tooltip: { callbacks: { title: (it) => B.byMarket[it[0].dataIndex].name, afterBody: (it) => "Utilization " + F.pct(B.byMarket[it[0].dataIndex].util, 1) } } },
        scales: { x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0 } }, y: { beginAtZero: true, title: { display: true, text: "Visits, 4 weeks" } } },
      },
    }));
  }

  function dayPanel() {
    const B = base();
    const rows = B.byMarket.slice();
    const tot = (m) => m.visit + m.driveAll + m.doc + m.idle;
    const sorted = rows.slice().sort((a, b) => tot(b) - tot(a));
    const worst = sorted[0], best = sorted[sorted.length - 1];
    const gap = tot(worst) - tot(best);
    const gapDI = (worst.driveAll + worst.idle) - (best.driveAll + best.idle);
    const visitShare = B.net.visit / tot(B.net);
    return `<div class="panel">
      <div class="panel-head"><div><h2>Where a clinician's day goes</h2><p class="panel-sub">Clinician minutes per completed visit. Idle = booked visit time lost to no-shows and same-day cancels, plus half the drive for in-home no-shows found at the door.</p></div></div>
      <div class="cap-insight">
        <div><strong>${F.pct(visitShare, 0)} is the visit itself</strong>Across the network, ${F.num(tot(B.net))} clinician minutes go into each completed visit; ${F.num(B.net.visit)} of them are with the member.</div>
        <div><strong>${UI.esc(worst.name)}: ${F.num(tot(worst))} min per visit</strong>vs ${F.num(tot(best))} in ${UI.esc(best.name)}. Drive and no-show idle time alone add ${F.num(Math.max(0, gapDI))} minutes to every completed visit.</div>
        <div><strong>${F.num(B.net.doc)} min of charting per visit</strong>New hires average ${F.num(B.nh.doc)} min; much of it lands after hours as chart lag.</div>
      </div>
      <div class="chart-box"><canvas id="cap-day" role="img" aria-label="Minutes per completed visit by market, split into visit, drive, documentation and idle"></canvas></div>
      <div class="presenter-note">Only about ${F.pct(visitShare, 0)} of the clinician time behind a completed visit is spent with the member. Drive, documentation and no-show idle time are the hidden capacity, and each has a different owner: routing, clinical templates, and scheduling. Sort the roster below by flags and Tampa's new hires explain the QA drop in one click.</div>
    </div>`;
  }

  function drawDay() {
    const B = base();
    const rows = B.byMarket.concat([Object.assign({ name: "Network" }, B.net)]);
    const parts = [
      { k: "visit", label: "Visit" },
      { k: "driveAll", label: "Drive" },
      { k: "doc", label: "Documentation" },
      { k: "idle", label: "Idle: no-shows and cancels" },
    ];
    track(UI.chart("cap-day", {
      type: "bar",
      data: {
        labels: rows.map((r) => r.name),
        datasets: parts.map((p, i) => ({ label: p.label, data: rows.map((r) => r[p.k]), backgroundColor: UI.series(i), maxBarThickness: 26, borderRadius: 0 })),
      },
      options: {
        indexAxis: "y",
        interaction: { mode: "index", axis: "y", intersect: false },
        plugins: { tooltip: { callbacks: {
          label: (c) => " " + c.dataset.label + ": " + F.num(c.raw) + " min",
          footer: (it) => "Total " + F.num(it.reduce((s, x) => s + x.raw, 0)) + " min per completed visit",
        } } },
        scales: { x: { stacked: true, title: { display: true, text: "Minutes per completed visit" } }, y: { stacked: true, grid: { display: false } } },
      },
    }));
  }

  function leverPanel() {
    const L = state.L;
    const opts = [{ value: "all", label: "All markets" }].concat(OPS.data.markets.map((m) => ({ value: m.id, label: m.name })));
    return `<div class="panel" style="border-color:var(--accent-line)">
      <div class="panel-head"><div><h2>What-if: levers before hires</h2><p class="panel-sub">Each lever frees clinician minutes or recovers lost slots. Freed time converts to bookable visits at the new cycle time, and those visits no-show at each clinician's current rate.</p></div>
        <button type="button" class="btn sm" data-act="reset-levers">Reset levers</button></div>
      <div class="cap-lev">
        <div class="panel inset cap-ctrl">
          ${UI.select("cap-scope", opts, L.scope, "Apply to")}
          <div class="range-row"><label for="cap-drive">Zip-cluster routing: drive time cut</label><output id="cap-drive-out" for="cap-drive">${L.drive}%</output><input type="range" id="cap-drive" min="0" max="40" step="5" value="${L.drive}"><small>In-home only. Offer members slots that fit an existing route first (OPP-05).</small></div>
          <div class="range-row"><label for="cap-doc">AI documentation assist: minutes saved per visit</label><output id="cap-doc-out" for="cap-doc">${L.doc} min</output><input type="range" id="cap-doc" min="0" max="15" step="1" value="${L.doc}"><small>Draft narrative from visit notes; clinician reviews and signs. Floor of ${ASSUME.docFloor} min per chart (OPP-06).</small></div>
          <div class="range-row"><label for="cap-backfill">Backfill same-day cancels</label><output id="cap-backfill-out" for="cap-backfill">${L.backfill}%</output><input type="range" id="cap-backfill" min="0" max="80" step="5" value="${L.backfill}"><small>Standby list by zip gets a first-come text (OPP-10).</small></div>
          <div class="range-row"><label for="cap-tele">Shift in-home visits to telehealth</label><output id="cap-tele-out" for="cap-tele">${L.tele}%</output><input type="range" id="cap-tele" min="0" max="30" step="5" value="${L.tele}"><small>Only where the visit type and the member allow it; HEDIS measures that need vitals or a draw stay in-home.</small></div>
          <div class="range-row"><label for="cap-conv">Freed time booked as visits</label><output id="cap-conv-out" for="cap-conv">${L.conv}%</output><input type="range" id="cap-conv" min="30" max="100" step="5" value="${L.conv}"><small>The rest goes to breaks, overruns and less after-hours charting.</small></div>
        </div>
        <div class="stack" style="gap:14px" id="cap-lev-out" aria-live="polite"></div>
      </div>
      <div class="presenter-note">Before anyone posts a requisition, these four levers add visits within weeks, at a fraction of a clinician's loaded cost, while a requisition takes a quarter to fill. Routing is Phoenix's lever, documentation assist is Tampa's, and both buy Charlotte time.</div>
    </div>`;
  }

  function leverOutHtml(R) {
    const L = state.L;
    const scopeName = L.scope === "all" ? "all markets" : OPS.q.marketName(L.scope);
    const partRows = [
      { k: "drive", label: "Zip-cluster routing", opp: "OPP-05" },
      { k: "doc", label: "AI documentation assist", opp: "OPP-06" },
      { k: "backfill", label: "Same-day backfill", opp: "OPP-10" },
      { k: "tele", label: "Telehealth mix shift", opp: "" },
    ].map((p) => ({ lever: p.label, opp: p.opp, visits: R.parts[p.k], revenue: R.partRevenue[p.k], fte: R.parts[p.k] / (R.perClinMonth || 1) }));
    return `<div class="cap-tiles">
        <div class="kpi"><div class="kpi-label">Visits per clinician-day</div><div class="kpi-value">${F.dec(R.before, 2)}<span class="cap-arrow">→</span>${F.dec(R.after, 2)}</div><div class="kpi-foot">${UI.pill(R.after > R.before + 0.005 ? "good" : "neutral", F.signed(((R.after - R.before) / (R.before || 1)) * 100, 1) + "%")}<span>${UI.esc(scopeName)}</span></div></div>
        ${UI.kpi({ label: "Added completed visits", value: "+" + F.num(R.added), unit: "/ mo", foot: "same roster, same hours" })}
        ${UI.kpi({ label: "Equivalent hires avoided", value: F.dec(R.fte, 1), unit: "FTE", foot: "≈ " + F.moneyK(R.fte * ASSUME.loadedClinician) + " / yr loaded cost" })}
        ${UI.kpi({ label: "Revenue capacity", value: F.moneyK(R.revenue), unit: "/ mo", foot: F.num(R.docHours) + " fewer charting hrs / mo" })}
      </div>
      <div class="stack" style="gap:6px">
        <h3 style="font-size:var(--fs-md)">Completed visits per clinician-day, before vs after</h3>
        <div class="chart-box sm"><canvas id="cap-after" role="img" aria-label="Completed visits per clinician-day by market before and after levers"></canvas></div>
      </div>
      ${UI.table([
        { key: "lever", label: "Lever", fmt: (v, r) => `<strong>${UI.esc(v)}</strong>${r.opp ? ` <span class="xs muted">${UI.esc(r.opp)}</span>` : ""}` },
        { key: "visits", label: "Visits / mo", num: true, fmt: (v) => "+" + F.num(v) },
        { key: "fte", label: "FTE equivalent", num: true, fmt: (v) => F.dec(v, 1) },
        { key: "revenue", label: "Revenue / mo", num: true, fmt: (v) => F.moneyK(v) },
      ], partRows)}
      <p class="xs muted">Added visits assume the freed slots get booked. That is true today in Charlotte, and at ${F.pct(base().g, 1)} weekly demand growth every market passes 95% utilization within about ${Math.ceil(Math.max.apply(null, base().byMarket.map((m) => m.weeksTo95)))} weeks. Revenue uses each market's completed-visit revenue after chart QA. Loaded cost of ${F.moneyK(ASSUME.loadedClinician)} per clinician-year is an assumption.</p>`;
  }

  function drawAfter(R) {
    const labels = R.byMarket.map((m) => m.name);
    if (afterChart && afterChart.canvas && afterChart.canvas.isConnected) {
      afterChart.data.datasets[0].data = R.byMarket.map((m) => m.before);
      afterChart.data.datasets[1].data = R.byMarket.map((m) => m.after);
      afterChart.update("none");
      return;
    }
    afterChart = track(UI.chart("cap-after", {
      type: "bar",
      data: { labels, datasets: [
        { label: "Before", data: R.byMarket.map((m) => m.before), backgroundColor: UI.series(0), maxBarThickness: 26 },
        { label: "After levers", data: R.byMarket.map((m) => m.after), backgroundColor: UI.series(2), maxBarThickness: 26 },
      ] },
      options: {
        plugins: { tooltip: { callbacks: { label: (c) => " " + c.dataset.label + ": " + F.dec(c.raw, 2) + " visits / day" } } },
        scales: { y: { beginAtZero: true, title: { display: true, text: "Visits / clinician-day" } }, x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0 } } },
      },
    }));
  }

  function planPanel() {
    const P = state.P;
    return `<div class="panel">
      <div class="panel-head"><div><h2>Charlotte hiring planner</h2><p class="panel-sub">Booked demand grows with the funnel; capacity grows with levers and hires. Hires ramp at ${F.pct(ASSUME.rampFactor, 0)} productivity for their first ${ASSUME.rampWeeks} weeks.</p></div>
        <div class="row"><button type="button" class="btn sm" data-act="opp" data-opp="OPP-05">${UI.icon("list")}OPP-05 routing</button><button type="button" class="btn sm" data-act="opp" data-opp="OPP-06">${UI.icon("list")}OPP-06 AI documentation</button><button type="button" class="btn sm" data-act="roi">${UI.icon("dollar")}Model ROI</button></div></div>
      <div class="cap-plan">
        <div class="panel inset cap-ctrl">
          <div class="field"><span>Plan</span>${UI.seg("cap-plan-mode", [{ value: "levers", label: "Levers first" }, { value: "hire", label: "Hire only" }], P.levers ? "levers" : "hire")}</div>
          ${UI.range({ id: "cap-target", label: "Target utilization", min: 75, max: 95, step: 1, value: P.target, display: P.target + "%" })}
          ${UI.range({ id: "cap-leadwk", label: "Hiring + credentialing lead time", min: 6, max: 16, step: 1, value: P.leadWeeks, display: P.leadWeeks + " wks" })}
          <p class="xs muted">Lead time covers posting, offer, licensure check, credentialing and payer enrollment. Levers use the settings above, applied to Charlotte.</p>
        </div>
        <div class="stack" style="gap:14px" id="cap-plan-out" aria-live="polite"></div>
      </div>
      <div class="presenter-note">Charlotte needs hires either way; the decision is timing. The planner shows the week demand passes capacity, how many clinicians the next six months need, and when the requisition has to open given credentialing lead time. Levers first buy runway while the hires come through, and that tradeoff is the conversation I would want to have with the clinical director.</div>
    </div>`;
  }

  function planOutHtml(R) {
    const B = base();
    const P = state.P;
    const when = (t) => (t <= 0 ? "Already" : weekLabel(t) + " · in " + Math.max(1, Math.round(t)) + " wks");
    const first = R.hireList[0];
    const reqTxt = !first ? "Not needed in 26 wks" : first.reqBy <= 0 ? "Now" : weekLabel(first.reqBy);
    const lateBy = first && first.reqBy < 0 ? Math.round(-first.reqBy) : 0;
    const rec = [];
    rec.push(`Without action, Charlotte's booked demand passes capacity <strong>${R.crossNow <= 0 ? "now" : "the week of " + weekLabel(R.crossNow)}</strong> and is already above the ${F.pct(R.target, 0)} target.`);
    if (R.leverWkAvail > 0.5) rec.push(`The levers add about <strong>${F.num(R.leverWkAvail)} slots a week</strong>, which moves the crossover to <strong>${weekLabel(R.crossLev)}</strong>.`);
    rec.push(`Holding ${F.pct(R.target, 0)} utilization through ${weekLabel(HORIZON)} takes <strong>${R.hires} in-home hire${R.hires === 1 ? "" : "s"}</strong>${P.levers ? " with levers first (" + R.hiresNoLever + " without)" : ""}.`);
    if (P.levers && R.leverWkAvail > 0.5 && R.hires >= R.hiresNoLever && R.hires > 0) rec.push(`So the levers buy about ${Math.max(1, Math.round(R.crossLev - Math.max(0, R.crossNow)))} weeks of runway while the hires come through: run both in parallel.`);
    if (first) rec.push(first.reqBy <= 0 ? `Open the first requisition <strong>now</strong>${lateBy ? "; it is " + lateBy + " week" + (lateBy === 1 ? "" : "s") + " late against a " + P.leadWeeks + "-week lead time" : ""}.` : `Open the first requisition by <strong>${weekLabel(first.reqBy)}</strong>.`);
    const tenureNote = `Plan for the ramp: new hires on this roster average ${F.num(B.nh.doc)} documentation minutes and ${F.pct(B.nh.qa, 0)} QA first-pass vs ${F.num(B.ten.doc)} min and ${F.pct(B.ten.qa, 0)} for tenured clinicians. Pair them with templates and a QA shadow.`;
    return `<div class="cap-tiles">
        ${UI.kpi({ label: "Demand passes capacity", value: R.crossNow <= 0 ? "Now" : weekLabel(R.crossNow), foot: R.crossNow <= 0 ? "already over" : "in " + Math.max(1, Math.round(R.crossNow)) + " wks, no action" })}
        ${UI.kpi({ label: "With levers first", value: R.leverWkAvail > 0.5 ? weekLabel(R.crossLev) : "No change", foot: R.leverWkAvail > 0.5 ? "+" + F.num(R.leverWkAvail) + " slots / wk · in " + Math.round(R.crossLev) + " wks" : "levers are at zero" })}
        ${UI.kpi({ label: "Hires needed in 26 wks", value: String(R.hires), unit: "FTE", foot: P.levers ? R.hiresNoLever + " if we hire only" : "levers not counted" })}
        ${UI.kpi({ label: "Open first requisition", value: reqTxt, foot: !first ? "" : first.need <= 0 ? "Charlotte is already past target" : "productive by " + weekLabel(first.need) })}
      </div>
      <div class="chart-box"><canvas id="cap-plan" role="img" aria-label="Charlotte weekly demand versus capacity over the next 26 weeks"></canvas></div>
      <div class="callout ${R.crossNow <= 6 ? "warning" : "accent"}"><div>${rec.join(" ")}</div></div>
      <p class="xs muted">${UI.esc(tenureNote)} Demand growth ${F.pct(R.g, 2)} / wk is fitted on Charlotte members assigned for outreach; booked visits are capped by capacity, so they understate demand. One in-home hire adds ${F.num(R.perHire)} slots a week.</p>`;
  }

  function drawPlan(R) {
    const s = R.series;
    const ds = [
      { label: "Booked demand", data: s.demand, borderColor: UI.series(0), backgroundColor: UI.series(0) },
      { label: "Capacity today", data: s.cap, borderColor: UI.series(1), backgroundColor: UI.series(1), borderDash: [5, 4] },
      { label: "With levers", data: s.lev, borderColor: UI.series(2), backgroundColor: UI.series(2), borderDash: [2, 3], hidden: !state.P.levers },
      { label: state.P.levers ? "Levers + hiring plan" : "Hiring plan", data: s.plan, borderColor: UI.series(3), backgroundColor: UI.series(3), stepped: true },
    ];
    if (planChart && planChart.canvas && planChart.canvas.isConnected) {
      planChart.data.datasets.forEach((d, i) => { d.data = ds[i].data; d.label = ds[i].label; d.hidden = ds[i].hidden; });
      planChart.update("none");
      return;
    }
    planChart = track(UI.chart("cap-plan", {
      type: "line",
      data: { labels: s.labels, datasets: ds },
      options: {
        elements: { line: { tension: 0 } },
        plugins: { tooltip: { callbacks: { label: (c) => " " + c.dataset.label + ": " + F.num(c.raw) + " / wk" } } },
        scales: { y: { title: { display: true, text: "Visits per week" } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 9, maxRotation: 0 } } },
      },
    }));
  }

  // ---------- clinician table ----------
  const COLS = [
    { key: "name", label: "Clinician" },
    { key: "marketName", label: "Market" },
    { key: "modality", label: "Modality" },
    { key: "tenureMonths", label: "Tenure (mo)", num: true },
    { key: "util", label: "Utilization", num: true },
    { key: "perDay", label: "Visits / day", num: true },
    { key: "avgDriveMin", label: "Drive min", num: true },
    { key: "avgDocMin", label: "Doc min", num: true },
    { key: "chartLagHrs", label: "Lag (h)", num: true },
    { key: "qaPassRate", label: "QA pass", num: true },
    { key: "flagsN", label: "Flags" },
  ];

  function tableHtml() {
    const B = base();
    const { key, dir } = state.sort;
    let rows = B.rows.map((r) => Object.assign({ flagsN: r.flags.length + (r.newHire ? 0.5 : 0) }, r));
    if (state.filter === "flagged") rows = rows.filter((r) => r.flags.length);
    rows.sort((a, b) => {
      const x = a[key], y = b[key];
      const c = typeof x === "string" ? x.localeCompare(y) : x - y;
      return c * dir || a.id.localeCompare(b.id);
    });
    const cell = (c, r) => {
      switch (c.key) {
        case "name": return `<span class="cap-name"><strong>${UI.esc(r.name)}</strong></span> ${r.newHire ? UI.pill("accent", "New hire") : ""}<div class="xs muted">${UI.esc(r.id)}</div>`;
        case "util": return F.pct(r.util, 0);
        case "perDay": return F.dec(r.perDay, 1);
        case "avgDriveMin": return r.home ? F.num(r.avgDriveMin) : `<span class="muted">n/a</span>`;
        case "avgDocMin": return F.num(r.avgDocMin);
        case "chartLagHrs": return F.num(r.chartLagHrs);
        case "qaPassRate": return F.pct(r.qaPassRate, 1);
        case "flagsN": return `<div class="cap-flagcell">${r.flags.length ? r.flags.map((f) => UI.pill(f.lvl, f.text)).join("") : UI.pill("good", "On track")}</div>`;
        default: return UI.esc(r[c.key]);
      }
    };
    const head = COLS.map((c) => {
      const active = c.key === key;
      const aria = active ? (dir > 0 ? "ascending" : "descending") : "none";
      return `<th class="${c.num ? "num" : ""}" aria-sort="${aria}"><button type="button" class="cap-sort" data-sort="${c.key}">${UI.esc(c.label)}<i aria-hidden="true">${active ? (dir > 0 ? "▲" : "▼") : "↕"}</i></button></th>`;
    }).join("");
    const body = rows.map((r) => `<tr>${COLS.map((c) => `<td class="${c.num ? "num" : ""}">${cell(c, r)}</td>`).join("")}</tr>`).join("");
    return `<div class="table-wrap"><table class="data cap-tbl"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${COLS.length}"><div class="empty">No clinicians match.</div></td></tr>`}</tbody></table></div>`;
  }

  function tablePanel() {
    const B = base();
    const flagged = B.rows.filter((r) => r.flags.length).length;
    const tpaNew = B.newHires.filter((c) => c.market === "tpa");
    const tpaTen = B.tenured.filter((c) => c.market === "tpa");
    const avg = (list, k) => sumBy(list, (c) => c[k]) / (list.length || 1);
    return `<div class="panel">
      <div class="panel-head"><div><h2>Clinician roster</h2><p class="panel-sub">Last 4 weeks. Flags: documentation over 35 min, chart lag over 36 h, QA first-pass under 90%, utilization over 95% or under 70%. Click a column to sort.</p></div>
        ${UI.seg("cap-filter", [{ value: "all", label: "All " + B.rows.length }, { value: "flagged", label: "Flagged " + flagged }], state.filter)}</div>
      ${tpaNew.length ? `<div class="callout warning"><div><strong>Tampa's QA drop traces to onboarding.</strong> ${tpaNew.length} new clinician${tpaNew.length === 1 ? "" : "s"} (≤ 3 months) average ${F.num(avg(tpaNew, "avgDocMin"))} documentation minutes, ${F.num(avg(tpaNew, "chartLagHrs"))} h chart lag and ${F.pct(avg(tpaNew, "qaPassRate"), 0)} QA first-pass, vs ${F.num(avg(tpaTen, "avgDocMin"))} min, ${F.num(avg(tpaTen, "chartLagHrs"))} h and ${F.pct(avg(tpaTen, "qaPassRate"), 0)} for Tampa's tenured clinicians. Structured templates (OPP-06) and QA pre-checks (OPP-08) target exactly this.</div></div>` : ""}
      <div id="cap-table">${tableHtml()}</div>
    </div>`;
  }

  // ---------- updates ----------
  let rafId = 0;
  function updateLevers(root) {
    const R = runLevers(state.L);
    const host = root.querySelector("#cap-lev-out");
    if (host) {
      if (afterChart && host.querySelector("#cap-after")) {
        const tmp = document.createElement("div");
        tmp.innerHTML = leverOutHtml(R);
        host.querySelector(".cap-tiles").replaceWith(tmp.querySelector(".cap-tiles"));
        host.querySelector(".table-wrap").replaceWith(tmp.querySelector(".table-wrap"));
        host.querySelector("p.xs").replaceWith(tmp.querySelector("p.xs"));
      } else {
        afterChart = null;
        host.innerHTML = leverOutHtml(R);
      }
      drawAfter(R);
    }
    updatePlan(root);
  }

  function updatePlan(root) {
    const R = plan(state.P, state.L);
    const host = root.querySelector("#cap-plan-out");
    if (!host) return;
    if (planChart && host.querySelector("#cap-plan")) {
      const tmp = document.createElement("div");
      tmp.innerHTML = planOutHtml(R);
      host.querySelector(".cap-tiles").replaceWith(tmp.querySelector(".cap-tiles"));
      host.querySelector(".callout").replaceWith(tmp.querySelector(".callout"));
      host.querySelector("p.xs").replaceWith(tmp.querySelector("p.xs"));
    } else {
      planChart = null;
      host.innerHTML = planOutHtml(R);
    }
    drawPlan(R);
  }

  function schedule(root) {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => updateLevers(root));
  }

  const RANGES = {
    "cap-drive": { obj: "L", key: "drive", disp: (v) => v + "%" },
    "cap-doc": { obj: "L", key: "doc", disp: (v) => v + " min" },
    "cap-backfill": { obj: "L", key: "backfill", disp: (v) => v + "%" },
    "cap-tele": { obj: "L", key: "tele", disp: (v) => v + "%" },
    "cap-conv": { obj: "L", key: "conv", disp: (v) => v + "%" },
    "cap-target": { obj: "P", key: "target", disp: (v) => v + "%" },
    "cap-leadwk": { obj: "P", key: "leadWeeks", disp: (v) => v + " wks" },
  };

  OPS.register({
    id: ID,
    title: "Clinician Capacity",
    stage: "build",
    order: 30,
    icon: "route",
    eyebrow: "4 · Build · Provider utilization",
    summary: "See where clinician time goes, which levers add completed visits without new headcount, and when Charlotte genuinely needs to hire.",
    jd: [
      "Analyze provider utilization to raise completed visits per clinician",
      "Quantify the impact of process improvements",
      "Partner with clinical and provider teams on capacity decisions",
    ],
    render(root, ctx) {
      UI.style(ID, CSS);
      killCharts();
      afterChart = null;
      planChart = null;
      const p = (ctx && ctx.params) || {};
      if (p.market && (p.market === "all" || OPS.data.markets.some((m) => m.id === p.market))) state.L.scope = p.market;
      base();
      root.innerHTML = `
        ${kpis()}
        ${marketPanel()}
        ${dayPanel()}
        ${leverPanel()}
        ${planPanel()}
        ${tablePanel()}`;
      drawMarket();
      drawDay();
      updateLevers(root);

      root.addEventListener("input", (e) => {
        const cfg = RANGES[e.target.id];
        if (!cfg) return;
        const v = parseFloat(e.target.value);
        state[cfg.obj][cfg.key] = v;
        const o = root.querySelector("#" + e.target.id + "-out");
        if (o) o.textContent = cfg.disp(v);
        if (cfg.obj === "P") { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(() => updatePlan(root)); } else schedule(root);
      });
      root.addEventListener("change", (e) => {
        if (e.target.id === "cap-scope") { state.L.scope = e.target.value; schedule(root); }
      });
      UI.wireSeg(root, "cap-plan-mode", (v) => { state.P.levers = v === "levers"; updatePlan(root); });
      UI.wireSeg(root, "cap-filter", (v) => { state.filter = v; root.querySelector("#cap-table").innerHTML = tableHtml(); });
      root.addEventListener("click", (e) => {
        const s = e.target.closest("[data-sort]");
        if (s) {
          const k = s.dataset.sort;
          state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: COLS.find((c) => c.key === k).num || k === "flagsN" ? -1 : 1 };
          root.querySelector("#cap-table").innerHTML = tableHtml();
          const btn = root.querySelector('#cap-table [data-sort="' + k + '"]');
          if (btn) btn.focus();
          return;
        }
        const a = e.target.closest("[data-act]");
        if (!a) return;
        if (a.dataset.act === "reset-levers") {
          state.L = Object.assign({}, LEVER_DEFAULTS);
          Object.keys(RANGES).forEach((id) => {
            const cfg = RANGES[id];
            if (cfg.obj !== "L") return;
            const el = root.querySelector("#" + id);
            if (el) { el.value = state.L[cfg.key]; const o = root.querySelector("#" + id + "-out"); if (o) o.textContent = cfg.disp(state.L[cfg.key]); }
          });
          const sc = root.querySelector("#cap-scope");
          if (sc) sc.value = state.L.scope;
          updateLevers(root);
        } else if (a.dataset.act === "opp") {
          OPS.navigate("pipeline", { focus: a.dataset.opp });
        } else if (a.dataset.act === "roi") {
          OPS.navigate("roi", { opp: "OPP-05" });
        }
      });
    },
    destroy() {
      cancelAnimationFrame(rafId);
      killCharts();
      afterChart = null;
      planChart = null;
    },
  });
})();
