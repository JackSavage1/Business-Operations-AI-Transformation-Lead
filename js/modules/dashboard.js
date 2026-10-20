/* Throughline: Ops Command Center (route: dashboard).
 *
 * Everything on this page is computed from OPS.data at render time: KPIs with period deltas,
 * the member engagement funnel with its biggest leak, a ranked "Needs attention" alert scan
 * (peer gap, own-history trend and step-change detection), trends with the W14 event marker,
 * a market heat scorecard, the call-center view with agent quartiles, and a weekly ops review
 * generator (deterministic template, optional live Claude draft from aggregates only).
 */
(function () {
  "use strict";
  const OPS = window.OPS;
  const UI = window.UI;
  if (!OPS || !UI || !OPS.data) return;

  const D = OPS.data;
  const Q = OPS.q;
  const F = UI.fmt;
  const esc = UI.esc;

  const LAST = D.weeks.length - 1; // 25
  const QUARTER = 13;
  const EVENTS = [{ index: 13, label: "Scheduling system change" }];
  const W_L4 = { from: LAST - 3, to: LAST };
  const W_P8 = { from: LAST - 11, to: LAST - 4 };
  const STORE_KEY = "dashboard.filters";
  const SEV = { 3: "critical", 2: "serious", 1: "warning" };
  const SEV_LABEL = { 3: "Critical", 2: "Serious", 1: "Warning" };
  const LOADED_HOURLY = 30; // ranking only: values agent hours so call-center alerts can be ordered with $ alerts

  // ---------- small math helpers ----------
  const SUM = ["assigned", "attempts", "reached", "scheduled", "held", "cancels", "noShows", "completed", "chartsSubmitted", "chartsPassedQA", "billed", "revenue"];
  const ratio = (a, b) => (b ? a / b : 0);
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  function total(rows) {
    const t = {};
    SUM.forEach((k) => (t[k] = 0));
    rows.forEach((r) => SUM.forEach((k) => (t[k] += r[k])));
    return t;
  }
  function quantile(arr, p) {
    const a = arr.slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return a[lo] + (a[hi] - a[lo]) * (i - lo);
  }
  const median = (arr) => quantile(arr, 0.5);
  /** two-proportion z statistic */
  function zTest(x1, n1, x2, n2) {
    if (!n1 || !n2) return 0;
    const p = (x1 + x2) / (n1 + n2);
    const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
    return se ? (x1 / n1 - x2 / n2) / se : 0;
  }
  /** best single step change in a weekly series: k = first week index of the new level */
  function changePoint(vals) {
    const n = vals.length;
    let best = null;
    for (let k = 4; k <= n - 4; k++) {
      const a = vals.slice(0, k), b = vals.slice(k);
      const ma = mean(a), mb = mean(b);
      const sse = a.reduce((s, v) => s + (v - ma) * (v - ma), 0) + b.reduce((s, v) => s + (v - mb) * (v - mb), 0);
      const sd = Math.sqrt(sse / Math.max(1, n - 2));
      const t = sd ? Math.abs(mb - ma) / (sd * Math.sqrt(1 / a.length + 1 / b.length)) : 0;
      if (!best || t > best.t) best = { k, before: ma, after: mb, t };
    }
    return best;
  }
  const wk = (i) => D.weeks[i].label;
  const span = (r) => wk(r.from) + "–" + wk(r.to);
  const pctCh = (a, b) => (b ? (a - b) / b : 0);
  const fmtCh = (v) => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "%";
  const ptsAbs = (v) => Math.abs(v * 100).toFixed(1) + " pts";
  const secs = (v) => (v >= 0 ? "+" : "−") + Math.abs(Math.round(v)) + " s";
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const PLAN_RPV = {};
  D.plans.forEach((p) => (PLAN_RPV[p.id] = p.revenuePerVisit));

  /** revenue per billable visit, weighted by the plan mix of completed visits in the filter */
  function rpvFor(f) {
    let num = 0, den = 0;
    Q.by("plan", f).forEach((p) => { num += p.completed * PLAN_RPV[p.id]; den += p.completed; });
    return den ? num / den : mean(D.plans.map((p) => p.revenuePerVisit));
  }

  // ---------- filters & periods ----------
  const PERIODS = [{ value: "4", label: "Last 4 wks" }, { value: "13", label: "Last 13 wks" }, { value: "26", label: "All 26 wks" }];
  function windows(period) {
    const n = +period;
    if (n >= 26) {
      return { cur: { from: 0, to: LAST }, now: { from: LAST - 12, to: LAST }, prev: { from: 0, to: LAST - 13 }, weeks: 26, vs: "last 13 vs first 13 wks", band: null };
    }
    return { cur: { from: LAST - n + 1, to: LAST }, now: { from: LAST - n + 1, to: LAST }, prev: { from: LAST - 2 * n + 1, to: LAST - n }, weeks: n, vs: "vs prior " + n + " wks", band: [LAST - n + 1, LAST] };
  }
  function loadFilters() {
    const s = UI.store.get(STORE_KEY, null) || {};
    return {
      plan: D.plans.some((p) => p.id === s.plan) ? s.plan : "all",
      market: D.markets.some((m) => m.id === s.market) ? s.market : "all",
      period: PERIODS.some((p) => p.value === s.period) ? s.period : "13",
    };
  }
  const planLabel = (id) => (id === "all" ? "All plans" : Q.planName(id));
  const marketLabel = (id) => (id === "all" ? "All markets" : Q.marketName(id));
  const contracted = (plan, market) => Q.rows({ plan, market }).length > 0;

  // ---------- funnel definitions ----------
  const STAGES = [
    { key: "assigned", label: "Assigned", sub: "on outreach lists" },
    { key: "reached", label: "Reached", sub: "live conversation" },
    { key: "scheduled", label: "Scheduled", sub: "visit booked" },
    { key: "held", label: "Held", sub: "member showed" },
    { key: "completed", label: "Completed", sub: "visit finished" },
    { key: "chartsPassedQA", label: "Passed QA", sub: "billable" },
  ];
  const STEPS = [
    { id: "contact", from: "assigned", to: "reached", name: "Assigned → Reached", metric: "contact rate", lostLabel: "not reached", process: "scheduling" },
    { id: "schedule", from: "reached", to: "scheduled", name: "Reached → Scheduled", metric: "schedule rate", lostLabel: "reached, not booked", process: "scheduling" },
    { id: "show", from: "scheduled", to: "held", name: "Scheduled → Held", metric: "show rate", lostLabel: "no-show or cancel", process: "scheduling" },
    { id: "complete", from: "held", to: "completed", name: "Held → Completed", metric: "completion rate", lostLabel: "visit not completed", process: "chart-to-cash" },
    { id: "qa", from: "completed", to: "chartsPassedQA", name: "Completed → Passed QA", metric: "QA first pass", lostLabel: "bounced or unsubmitted", process: "chart-to-cash" },
  ];
  const stepRates = (t) => STEPS.map((s) => ratio(t[s.to], t[s.from]));

  // ---------- driver evidence (computed from appointments, clinicians, agents) ----------
  function apptSplit(plan, market) {
    const inPlan = D.appointments.filter((a) => plan === "all" || a.plan === plan);
    return { mine: inPlan.filter((a) => a.market === market), rest: inPlan.filter((a) => a.market !== market) };
  }
  function spanishSkew(market, plan) {
    const { mine, rest } = apptSplit(plan, market);
    const sh = (x) => ratio(x.filter((a) => a.language === "Spanish").length, x.length);
    const share = sh(mine), other = sh(rest);
    return { share, other, skew: mine.length > 30 && share >= 0.2 && share >= 2 * other };
  }
  function clinicianLoad(market) {
    const mine = D.clinicians.filter((c) => c.market === market), rest = D.clinicians.filter((c) => c.market !== market);
    const u = (x) => ratio(x.reduce((s, c) => s + c.scheduled, 0), x.reduce((s, c) => s + c.capacity, 0));
    return { util: u(mine), other: u(rest), n: mine.length };
  }
  const bilingualAgents = () => D.callCenter.agents.filter((a) => /bilingual/i.test(a.team)).length;

  function driverFor(metric, market, plan, l4, oth) {
    const name = Q.marketName(market);
    if (metric === "schedule") {
      const s = spanishSkew(market, plan);
      if (s.skew) {
        return { opp: "OPP-03", text: `${F.pct(s.share, 0)} of ${name}'s booked visits are for Spanish-preferred members (${F.pct(s.other, 0)} elsewhere), and ${bilingualAgents()} of ${D.callCenter.agents.length} agents sit on the bilingual team.` };
      }
      return { opp: "OPP-02", text: "Language mix matches peers. Next question for the scheduling lead: callback follow-through and open-slot availability for this market." };
    }
    if (metric === "show") {
      const c = clinicianLoad(market);
      const { mine, rest } = apptSplit(plan, market);
      const lead = mean(mine.map((a) => a.leadDays)), leadO = mean(rest.map((a) => a.leadDays));
      if (c.n && c.util >= 0.93) {
        return { opp: "OPP-05", text: `Clinicians are booked to ${F.pct(c.util, 0)} of slot capacity (${F.pct(c.other, 0)} elsewhere), pushing average lead time to ${F.dec(lead)} days vs ${F.dec(leadO)}.` };
      }
      const ih = (x) => x.filter((a) => a.visitType !== "Telehealth assessment");
      const dist = mean(ih(mine).map((a) => a.distanceMi)), distO = mean(ih(rest).map((a) => a.distanceMi));
      const conf = ratio(mine.filter((a) => a.confirmed).length, mine.length), confO = ratio(rest.filter((a) => a.confirmed).length, rest.length);
      const parts = [];
      if (distO && dist / distO >= 1.15) parts.push(`in-home visits average a ${F.dec(dist)} mi trip vs ${F.dec(distO)} mi elsewhere`);
      if (leadO && lead / leadO >= 1.15) parts.push(`lead time averages ${F.dec(lead)} days vs ${F.dec(leadO)}`);
      if (confO && conf / confO <= 0.9) parts.push(`${F.pct(conf, 0)} of visits are confirmed vs ${F.pct(confO, 0)}`);
      if (c.n && c.util < 0.8) parts.push(`clinicians have slack (${F.pct(c.util, 0)} booked), so capacity is not the constraint`);
      return { opp: "OPP-01", text: parts.length ? cap(parts.join("; ")) + "." : "Lead time, distance and confirmation match peers. Next question: reminder cadence by plan." };
    }
    if (metric === "qa") {
      const mine = D.clinicians.filter((c) => c.market === market);
      const fresh = mine.filter((c) => c.tenureMonths <= 3), tenured = mine.filter((c) => c.tenureMonths > 3);
      if (fresh.length && tenured.length) {
        return { opp: "OPP-08", opp2: "OPP-06", text: `${fresh.length} of ${mine.length} ${name} clinicians have 3 months tenure or less: QA pass ${F.pct(mean(fresh.map((c) => c.qaPassRate)), 0)} vs ${F.pct(mean(tenured.map((c) => c.qaPassRate)), 0)} for tenured, ${Math.round(mean(fresh.map((c) => c.avgDocMin)))} vs ${Math.round(mean(tenured.map((c) => c.avgDocMin)))} documentation minutes per visit.` };
      }
      return { opp: "OPP-08", opp2: "OPP-06", text: "No new clinicians in this market. Next question: the top three QA rejection reasons this month." };
    }
    if (metric === "contact") {
      const a = ratio(l4.attempts, l4.assigned), ao = ratio(oth.attempts, oth.assigned);
      if (ao && Math.abs(a / ao - 1) < 0.05) {
        return { opp: "OPP-04", text: `Dial effort matches peers (${F.dec(a, 2)} vs ${F.dec(ao, 2)} attempts per member), which points at roster phone quality or call windows.` };
      }
      return { opp: "OPP-04", text: `${F.dec(a, 2)} attempts per member vs ${F.dec(ao, 2)} elsewhere.` };
    }
    return null;
  }

  // ---------- call center aggregates ----------
  function ccWindow(r) {
    const rows = D.callCenter.weekly.filter((w) => w.weekIndex >= r.from && w.weekIndex <= r.to);
    const calls = rows.reduce((s, w) => s + w.connects + w.inboundCalls, 0);
    const inbound = rows.reduce((s, w) => s + w.inboundCalls, 0);
    const wsum = (k, wt) => rows.reduce((s, w) => s + w[k] * wt(w), 0);
    return {
      weeks: rows.length,
      calls,
      aht: ratio(wsum("ahtSec", (w) => w.connects + w.inboundCalls), calls),
      acw: ratio(wsum("acwSec", (w) => w.connects + w.inboundCalls), calls),
      abandon: ratio(wsum("abandonRate", (w) => w.inboundCalls), inbound),
      asa: ratio(wsum("asaSec", (w) => w.inboundCalls), inbound),
    };
  }

  // ---------- alert scan ----------
  const AM = [
    { id: "contact", label: "Contact rate", lc: "contact rate", num: "reached", den: "assigned", step: 0, process: "scheduling" },
    { id: "schedule", label: "Schedule rate", lc: "schedule rate", num: "scheduled", den: "reached", step: 1, process: "scheduling" },
    { id: "show", label: "Show rate", lc: "show rate", num: "held", den: "scheduled", step: 2, process: "scheduling" },
    { id: "qa", label: "Chart QA first-pass rate", lc: "chart QA first-pass rate", num: "chartsPassedQA", den: "chartsSubmitted", step: 4, process: "chart-to-cash" },
  ];
  const eventAt = (k) => EVENTS.find((e) => Math.abs(e.index - k) <= 1);
  function sevFromGap(pts) { return pts >= 0.08 ? 3 : pts >= 0.05 ? 2 : pts >= 0.03 ? 1 : 0; }
  function sevFromUsd(v) { return v >= 150000 ? 3 : v >= 90000 ? 2 : 1; }

  /** completed + billable visits per quarter from extra output at a funnel step, using t's own downstream rates */
  function propagate(stepIdx, addPerWeek, t) {
    const r = stepRates(t);
    let toCompleted = 1, toBill = 1;
    for (let j = stepIdx + 1; j < STEPS.length; j++) { toBill *= r[j]; if (j <= 3) toCompleted *= r[j]; }
    const q = addPerWeek * QUARTER;
    return { completed: stepIdx <= 3 ? q * toCompleted : 0, billable: q * toBill };
  }
  /** for the QA metric (passed / submitted) the extra output is billable charts directly */
  function impactFor(M, gapAbs, t, weeks, rpv) {
    const perWeek = gapAbs * t[M.den] / weeks;
    if (M.id === "qa") {
      const billable = perWeek * QUARTER;
      return { completed: 0, billable, usd: billable * rpv };
    }
    const p = propagate(M.step, perWeek, t);
    return { completed: p.completed, billable: p.billable, usd: p.billable * rpv };
  }

  function scanAlerts(plan) {
    const allRows = Q.rows({ plan });
    const mkIds = D.markets.map((m) => m.id).filter((id) => allRows.some((r) => r.market === id));
    if (!mkIds.length) return [];
    const inW = (r, w) => r.weekIndex >= w.from && r.weekIndex <= w.to;
    const PRE = { from: 0, to: EVENTS[0].index - 1 };
    const per = mkIds.map((id) => {
      const rows = allRows.filter((r) => r.market === id), others = allRows.filter((r) => r.market !== id);
      return {
        id, name: Q.marketName(id), nOthers: mkIds.length - 1,
        l4: total(rows.filter((r) => inW(r, W_L4))),
        p8: total(rows.filter((r) => inW(r, W_P8))),
        oth: total(others.filter((r) => inW(r, W_L4))),
        pre: total(rows.filter((r) => inW(r, PRE))),
        othPre: total(others.filter((r) => inW(r, PRE))),
        weekly: D.weeks.map((w) => total(rows.filter((r) => r.weekIndex === w.index))),
      };
    });

    const cands = [];
    const cps = {};
    AM.forEach((M) => {
      cps[M.id] = [];
      per.forEach((m) => {
        const rate = (t) => ratio(t[M.num], t[M.den]);
        const r = rate(m.l4), ro = rate(m.oth), rp = rate(m.p8);
        const gap = m.nOthers ? r - ro : 0;
        const zg = m.nOthers ? zTest(m.l4[M.num], m.l4[M.den], m.oth[M.num], m.oth[M.den]) : 0;
        const tr = r - rp;
        const zt = zTest(m.l4[M.num], m.l4[M.den], m.p8[M.num], m.p8[M.den]);
        const cp = changePoint(m.weekly.map(rate));
        const cpAdverse = !!cp && cp.after - cp.before <= -0.02 && cp.t >= 5;
        if (cpAdverse) cps[M.id].push({ market: m.id, k: cp.k });
        cands.push({
          M, m, r, ro, rp, gap, tr, cp: cpAdverse ? cp : null,
          gapFlag: gap <= -0.03 && zg <= -3,
          trendFlag: tr <= -0.025 && zt <= -3,
          preGap: m.nOthers ? rate(m.pre) - rate(m.othPre) : 0,
        });
      });
    });

    const alerts = [];
    const net = { l4: total(allRows.filter((r) => inW(r, W_L4))), p8: total(allRows.filter((r) => inW(r, W_P8))) };
    const netWeekly = D.weeks.map((w) => total(allRows.filter((r) => r.weekIndex === w.index)));
    const rpvNet = rpvFor({ plan, ...W_L4 });
    const ahtCp = changePoint(D.callCenter.weekly.map((w) => w.ahtSec));

    // systemic step changes: the same week in at least half the markets (min 3) is a network event
    AM.forEach((M) => {
      const list = cps[M.id];
      if (!list.length) return;
      let bestK = null, bestN = 0;
      list.forEach((c) => {
        const n = list.filter((x) => Math.abs(x.k - c.k) <= 1).length;
        if (n > bestN) { bestN = n; bestK = c.k; }
      });
      const need = Math.max(3, Math.ceil(mkIds.length / 2));
      if (bestN < need) return;
      const members = list.filter((x) => Math.abs(x.k - bestK) <= 1).map((x) => x.market);
      cands.forEach((c) => { if (c.M === M && c.cp && members.includes(c.m.id)) { c.cp = null; c.systemic = true; } });
      const series = netWeekly.map((t) => ratio(t[M.num], t[M.den]));
      const before = mean(series.slice(0, bestK)), after = mean(series.slice(bestK));
      const shift = before - after;
      const ev = eventAt(bestK);
      const trN = ratio(net.l4[M.num], net.l4[M.den]) - ratio(net.p8[M.num], net.p8[M.den]);
      const imp = impactFor(M, shift, net.l4, 4, rpvNet);
      const evidence = [
        `Stepped down at ${wk(bestK)} in ${members.length} of ${mkIds.length} markets at once: network weekly average ${F.pct(before)} before, ${F.pct(after)} after (−${ptsAbs(shift)}).`,
        `Last 4 wks vs prior 8: ${F.pts(trN)}, so it has not recovered.`,
      ];
      if (ahtCp && Math.abs(ahtCp.k - bestK) <= 1 && ahtCp.after - ahtCp.before > 15) {
        evidence.push(`The same week, call-center AHT rose ${secs(ahtCp.after - ahtCp.before)}.`);
      }
      const sev = Math.max(sevFromGap(shift), sevFromUsd(imp.usd));
      alerts.push({
        key: "net-" + M.id, market: null, scope: "Network", metricLabel: M.label, since: wk(bestK), sev,
        title: `${M.label} dropped ${ptsAbs(shift)} across the network at ${wk(bestK)}${!ev ? "" : ev.index === bestK ? ", the week of the " + ev.label.toLowerCase() : `, one week ${bestK > ev.index ? "after" : "before"} the ${wk(ev.index)} ${ev.label.toLowerCase()}`}`,
        evidence,
        driver: ev ? `A shift in every market in the same week points at a shared cause. The ${wk(ev.index)} ${ev.label.toLowerCase()} is the first hypothesis to test.` : "A shift in most markets in the same week points at a shared cause (system, policy or staffing).",
        impactValue: F.moneyK(imp.usd) + " / qtr",
        impactLabel: M.id === "qa" ? `≈ ${F.num(imp.billable)} billable charts / quarter if restored` : `≈ +${F.num(imp.completed)} completed visits / quarter if restored to the pre-${wk(bestK)} level`,
        value: imp.usd,
        opp: M.id === "qa" ? "OPP-08" : "OPP-02",
        process: M.process,
      });
    });

    // market alerts
    cands.forEach((c) => {
      if (!(c.gapFlag || c.trendFlag || c.cp)) return;
      const { M, m } = c;
      const name = m.name;
      const recent = c.trendFlag || (c.cp && c.cp.k >= LAST - 7);
      const since = c.cp ? wk(c.cp.k) : null;
      const evidence = [];
      if (m.nOthers) evidence.push(`Last 4 wks (${span(W_L4)}): ${F.pct(c.r)} vs ${F.pct(c.ro)} across the other ${m.nOthers} market${m.nOthers > 1 ? "s" : ""} (${F.pts(c.gap)}).`);
      evidence.push(c.trendFlag ? `Down ${ptsAbs(c.tr)} vs its own prior 8 wks (${F.pct(c.rp)}).` : `Flat vs its own prior 8 wks (${F.pct(c.rp)}, ${F.pts(c.tr)}).`);
      if (c.cp) evidence.push(`Step change at ${wk(c.cp.k)}: weekly average ${F.pct(c.cp.before)} before, ${F.pct(c.cp.after)} after.`);
      if (c.gapFlag && !c.trendFlag && !c.cp && c.preGap <= -0.03) evidence.push(`The gap was ${F.pts(c.preGap)} in ${span({ from: 0, to: EVENTS[0].index - 1 })} as well, so it predates the ${wk(EVENTS[0].index)} change.`);

      let gapUsed, basis;
      if (c.gapFlag) { gapUsed = -c.gap; basis = "other markets"; }
      else if (c.trendFlag) { gapUsed = -c.tr; basis = "its prior 8 wks"; }
      else { gapUsed = c.cp.before - c.cp.after; basis = "its pre-" + since + " level"; }
      const rpv = rpvFor({ plan, market: m.id, ...W_L4 });
      const imp = impactFor(M, gapUsed, m.l4, 4, rpv);
      const drv = driverFor(M.id, m.id, plan, m.l4, m.oth);
      let sev = Math.max(sevFromGap(gapUsed), sevFromUsd(imp.usd));
      if (recent) sev = Math.min(3, sev + 1);

      let title;
      if (c.gapFlag && (c.trendFlag || c.cp)) title = `${name} ${M.lc} is ${F.pct(c.r)}, ${ptsAbs(c.gap)} below other markets and slipping since ${since || wk(W_P8.from)}`;
      else if (c.gapFlag) title = `${name} ${M.lc} is ${F.pct(c.r)}, ${ptsAbs(c.gap)} below other markets`;
      else title = `${name} ${M.lc} fell ${ptsAbs(gapUsed)} since ${since || wk(W_P8.from)}`;
      if (c.gapFlag && c.cp && recent) title = `${name} ${M.lc} fell to ${F.pct(c.r)} after ${since}, ${ptsAbs(c.gap)} below other markets`;

      alerts.push({
        key: m.id + "-" + M.id, market: m.id, scope: name, metricLabel: M.label, since, sev, title, evidence,
        driver: drv ? drv.text : null,
        impactValue: F.moneyK(imp.usd) + " / qtr",
        impactLabel: M.id === "qa"
          ? `≈ ${F.num(imp.billable)} charts / quarter bounced beyond ${basis}: revenue delayed or at risk`
          : `≈ +${F.num(imp.completed)} completed visits / quarter if ${name} matched ${basis}`,
        value: imp.usd,
        opp: drv ? drv.opp : "OPP-07",
        opp2: drv && drv.opp2,
        process: M.process,
      });
    });

    // call center handle time (network-wide; the dialer is not split by plan or market)
    const cc = ccAlert();
    if (cc) alerts.push(cc);

    alerts.sort((a, b) => b.sev - a.sev || b.value - a.value);
    return alerts;
  }

  function ccAlert() {
    const cw = D.callCenter.weekly;
    const aht = changePoint(cw.map((w) => w.ahtSec));
    if (!aht || aht.after - aht.before < 15 || aht.t < 5) return null;
    const k = aht.k;
    const pre = ccWindow({ from: 0, to: k - 1 }), post = ccWindow(W_L4), p8 = ccWindow(W_P8);
    const dAht = post.aht - pre.aht, dAcw = post.acw - pre.acw;
    const ev = eventAt(k);
    const hrsWk = (post.calls / post.weeks) * dAht / 3600;
    const fte = hrsWk / 40;
    const evidence = [
      `AHT ${F.mmss(post.aht)} in the last 4 wks vs ${F.mmss(pre.aht)} before ${wk(k)} (${secs(dAht)}); ACW ${F.mmss(post.acw)} vs ${F.mmss(pre.acw)} (${secs(dAcw)}).`,
      `Last 4 wks vs prior 8: AHT ${secs(post.aht - p8.aht)}, so there is no recovery since ${wk(k)}.`,
      `Abandon rate ${F.pct(pre.abandon)} → ${F.pct(post.abandon)} and ASA ${F.mmss(pre.asa)} → ${F.mmss(post.asa)} over the same window.`,
    ];
    const share = dAht > 0 ? Math.max(0, Math.min(1, dAcw / dAht)) : 0;
    return {
      key: "cc-aht", market: null, scope: "Call center", metricLabel: "AHT / ACW", since: wk(k),
      sev: fte >= 5 ? 3 : fte >= 2 ? 2 : 1,
      title: `Handle time jumped ${Math.round(dAht)} s per call at ${wk(k)}, and ${F.pct(share, 0)} of it is after-call work`,
      evidence,
      driver: `Extra time lands after the member hangs up${ev ? `, starting the week of the ${ev.label.toLowerCase()}` : ""}. Double entry into the old and new systems is the first hypothesis to test with a side-by-side observation.`,
      impactValue: F.num(hrsWk) + " hrs / wk",
      impactLabel: `≈ ${F.dec(fte)} FTE of agent time absorbed; AHT includes ACW`,
      value: hrsWk * QUARTER * LOADED_HOURLY,
      opp: "OPP-02",
      process: "scheduling",
    };
  }

  // ---------- page model ----------
  function buildModel(S, win) {
    const base = { plan: S.plan, market: S.market };
    const cur = Q.funnel({ ...base, ...win.cur });
    const now = Q.funnel({ ...base, ...win.now });
    const prev = Q.funnel({ ...base, ...win.prev });
    const spark = Q.byWeek({ ...base, from: Math.min(win.cur.from, win.prev.from), to: LAST });
    const net = Q.funnel({ plan: S.plan, ...win.cur });
    const mk = Q.by("market", { plan: S.plan, ...win.cur });
    const mkNow = Q.by("market", { plan: S.plan, ...win.now });
    const mkPrev = Q.by("market", { plan: S.plan, ...win.prev });

    const steps = STEPS.map((s, i) => {
      const rates = mk.map((m) => ({ id: m.id, name: m.name, rate: ratio(m[s.to], m[s.from]) }));
      const best = rates.reduce((b, r) => (!b || r.rate > b.rate ? r : b), null);
      return { ...s, i, rate: ratio(cur[s.to], cur[s.from]), netRate: ratio(net[s.to], net[s.from]), med: median(rates.map((r) => r.rate)), best, rates, lost: cur[s.from] - cur[s.to] };
    });
    const scope = S.market === "all" ? mk : mk.filter((m) => m.id === S.market);
    const rpvM = {};
    mk.forEach((m) => (rpvM[m.id] = rpvFor({ plan: S.plan, market: m.id, ...win.cur })));
    function leakValue(st, mode) {
      const out = { completed: 0, billable: 0, usd: 0, contrib: [] };
      scope.forEach((m) => {
        const target = mode === "med" ? st.med : st.best ? st.best.rate : 0;
        const r = ratio(m[st.to], m[st.from]);
        const gap = target - r;
        if (gap <= 0.0005) return;
        const p = propagate(st.i, gap * m[st.from] / win.weeks, m);
        const usd = p.billable * rpvM[m.id];
        out.completed += p.completed; out.billable += p.billable; out.usd += usd;
        out.contrib.push({ id: m.id, name: m.name, rate: r, gap, completed: p.completed, billable: p.billable, usd });
      });
      out.contrib.sort((a, b) => b.usd - a.usd);
      return out;
    }
    steps.forEach((st) => { st.toMed = leakValue(st, "med"); st.toBest = leakValue(st, "best"); });
    let leak = null;
    const byMed = steps.slice().sort((a, b) => b.toMed.usd - a.toMed.usd)[0];
    if (byMed && byMed.toMed.usd > 0) leak = { step: byMed, mode: "med", v: byMed.toMed };
    else {
      const byBest = steps.slice().sort((a, b) => b.toBest.usd - a.toBest.usd)[0];
      if (byBest && byBest.toBest.usd > 0) leak = { step: byBest, mode: "best", v: byBest.toBest };
    }
    if (leak) {
      const top = leak.v.contrib[0];
      leak.opp = leakOpp(leak.step.id, top ? top.id : null, S.plan);
    }

    const alertsAll = scanAlerts(S.plan);
    const alerts = S.market === "all" ? alertsAll : alertsAll.filter((a) => !a.market || a.market === S.market);

    const ccCur = ccWindow(win.cur), ccNow = ccWindow(win.now), ccPrev = ccWindow(win.prev);
    const coach = coachingModel();

    return {
      S, win, cur, now, prev, spark, net, mk, mkNow, mkPrev, steps, leak, alerts, alertsAll,
      cc: { cur: ccCur, now: ccNow, prev: ccPrev }, coach,
      scopeLabel: `${planLabel(S.plan)} · ${marketLabel(S.market)} · ${span(win.cur)}`,
    };
  }

  function leakOpp(stepId, market, plan) {
    if (stepId === "schedule") return market && spanishSkew(market, plan).skew ? "OPP-03" : "OPP-02";
    if (stepId === "show") return market && clinicianLoad(market).util >= 0.93 ? "OPP-05" : "OPP-01";
    if (stepId === "qa") return "OPP-08";
    if (stepId === "contact") return "OPP-04";
    return null;
  }

  function coachingModel() {
    const ag = D.callCenter.agents;
    const convs = ag.map((a) => a.schedConv);
    const p25 = quantile(convs, 0.25), p50 = quantile(convs, 0.5), p75 = quantile(convs, 0.75);
    const bottom = ag.filter((a) => a.schedConv <= p25);
    const top = ag.filter((a) => a.schedConv >= p75);
    // calibrate per-agent conversions to the network's actual scheduled volume (last 4 wks)
    const n4 = Q.funnel({ ...W_L4 });
    const schedWk = n4.scheduled / 4;
    const modeled = ag.reduce((s, a) => s + a.schedConv * a.callsPerWeek, 0);
    const k = modeled ? schedWk / modeled : 0;
    const addSchedWk = bottom.reduce((s, a) => s + Math.max(0, p50 - a.schedConv) * a.callsPerWeek, 0) * k;
    const p = propagate(1, addSchedWk, n4);
    const usd = p.billable * rpvFor({ ...W_L4 });
    return { p25, p50, p75, bottom, top, addSchedWk, completedQtr: p.completed, usd, topMean: mean(top.map((a) => a.schedConv)), bottomMean: mean(bottom.map((a) => a.schedConv)) };
  }

  // ---------- chart plugin: selected-period band + event marker ----------
  function eventPlugin(opts) {
    return {
      id: "dashEvents",
      beforeDatasetsDraw(chart) {
        if (!opts.band) return;
        const x = chart.scales.x, a = chart.chartArea, c = chart.ctx;
        const step = x.getPixelForValue(1) - x.getPixelForValue(0);
        const x0 = Math.max(a.left, x.getPixelForValue(opts.band[0]) - step / 2);
        const x1 = Math.min(a.right, x.getPixelForValue(opts.band[1]) + step / 2);
        c.save();
        c.fillStyle = UI.alpha(UI.cssVar("--accent"), 0.08);
        c.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
        c.restore();
      },
      afterDatasetsDraw(chart) {
        const x = chart.scales.x, a = chart.chartArea, c = chart.ctx;
        EVENTS.forEach((ev) => {
          const px = (x.getPixelForValue(ev.index - 1) + x.getPixelForValue(ev.index)) / 2;
          if (px < a.left || px > a.right) return;
          c.save();
          c.strokeStyle = UI.cssVar("--ink-3");
          c.lineWidth = 1.5;
          c.setLineDash([4, 4]);
          c.beginPath(); c.moveTo(px, a.top); c.lineTo(px, a.bottom); c.stroke();
          c.setLineDash([]);
          const text = wk(ev.index) + " · " + ev.label;
          c.font = "600 11px " + (UI.cssVar("--font-body") || "sans-serif");
          const tw = c.measureText(text).width;
          const right = px + 6 + tw + 8 <= a.right;
          const bx = right ? px + 4 : px - 4 - tw - 8;
          const by = opts.labelPos === "top" ? a.top + 2 : a.bottom - 20;
          c.fillStyle = UI.alpha(UI.cssVar("--surface"), 0.92);
          c.fillRect(bx, by, tw + 8, 17);
          c.fillStyle = UI.cssVar("--ink-2");
          c.textBaseline = "middle";
          c.fillText(text, bx + 4, by + 9);
          c.restore();
        });
      },
    };
  }

  // ---------- CSS ----------
  UI.style("dashboard", `
    .dash-filters { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: flex-end; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 12px 16px; }
    .dash-filters .field { flex: 0 1 210px; min-width: 150px; }
    .dash-period { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .dash-period > span { font-size: var(--fs-sm); color: var(--ink-2); font-weight: 500; }
    .dash-scope { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; font-size: var(--fs-xs); color: var(--ink-3); text-align: right; min-width: 0; }
    .dash-scope strong { color: var(--ink-2); font-weight: 600; }
    .dash-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
    .dash-kpis .kpi-label { min-height: 2.5em; line-height: 1.25; }
    .dash-kpis .kpi-foot { justify-content: flex-start; gap: 4px 8px; }

    .dash-fn { display: flex; flex-direction: column; }
    .dash-fn-row { display: grid; grid-template-columns: minmax(104px, 140px) minmax(0, 1fr) 92px 132px 156px 150px; grid-template-areas: "name bar rate net best lost"; gap: 6px 14px; align-items: center; padding: 9px 10px; border-top: 1px solid var(--line); }
    .dash-fn-row > * { min-width: 0; }
    .dash-fn-head { border-top: 0; padding-block: 0 6px; font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
    .dash-fn-row.is-leak { background: var(--critical-soft); border-radius: var(--r-md); box-shadow: inset 4px 0 0 var(--critical); border-top-color: transparent; }
    .dash-fn-row.is-leak + .dash-fn-row { border-top-color: transparent; }
    .dash-a-name { grid-area: name; } .dash-a-bar { grid-area: bar; } .dash-a-rate { grid-area: rate; } .dash-a-net { grid-area: net; } .dash-a-best { grid-area: best; } .dash-a-lost { grid-area: lost; }
    .dash-fn-name strong { display: block; font-size: var(--fs-sm); }
    .dash-fn-name span { display: block; font-size: var(--fs-xs); color: var(--ink-3); }
    .dash-fn-bar { display: flex; align-items: center; gap: 10px; }
    .dash-fn-bar .bar { flex: 1 1 auto; height: 14px; border-radius: 4px; background: var(--surface-2); }
    .dash-fn-bar .bar > i { background: var(--series-1); border-radius: 4px; }
    .dash-fn-count { font-variant-numeric: tabular-nums; font-weight: 600; font-size: var(--fs-sm); min-width: 6.5ch; text-align: right; }
    .dash-fn-rate { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
    .dash-fn-rate b { font-family: var(--font-display); font-weight: 650; font-size: var(--fs-lg); font-variant-numeric: tabular-nums; line-height: 1.1; }
    .dash-fn-cell { font-size: var(--fs-xs); color: var(--ink-2); line-height: 1.35; }
    .dash-fn-cell .dash-k { display: none; color: var(--ink-3); }
    .dash-dev { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .dash-dev.neg { color: var(--critical-ink); }
    .dash-dev.pos { color: var(--good-ink); }
    .dash-dev.flat { color: var(--ink-3); }
    .dash-leak > svg { width: 20px; height: 20px; flex: none; color: var(--warning-ink); margin-top: 1px; }
    .dash-leak p { color: var(--ink); }

    .dash-alerts { display: flex; flex-direction: column; gap: 10px; }
    .dash-alert { display: grid; grid-template-columns: 26px minmax(0, 1fr) minmax(180px, 230px); gap: 10px 16px; padding: 14px 16px 14px 12px; border: 1px solid var(--line); border-left: 4px solid var(--line-strong); border-radius: var(--r-md); background: var(--surface); }
    .dash-alert.sev-critical { border-left-color: var(--critical); }
    .dash-alert.sev-serious { border-left-color: var(--serious); }
    .dash-alert.sev-warning { border-left-color: var(--warning); }
    .dash-alert-rank { font-family: var(--font-mono); font-size: var(--fs-sm); font-weight: 600; color: var(--ink-3); padding-top: 1px; }
    .dash-alert-body { gap: 8px; }
    .dash-alert-tags { gap: 6px; }
    .dash-alert-title { font-family: var(--font-body); font-size: var(--fs-md); font-weight: 600; line-height: 1.35; }
    .dash-ev { margin: 0; padding-left: 18px; font-size: var(--fs-sm); color: var(--ink-2); display: flex; flex-direction: column; gap: 3px; }
    .dash-driver { font-size: var(--fs-sm); color: var(--ink); background: var(--surface-2); border-radius: var(--r-sm); padding: 6px 9px; }
    .dash-driver .label { margin-right: 6px; }
    .dash-alert-side { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .dash-impact-v { font-family: var(--font-display); font-size: var(--fs-xl); font-weight: 650; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .dash-impact-l { font-size: var(--fs-xs); color: var(--ink-3); }
    .dash-alert-side .btn { justify-content: flex-start; }
    .dash-opp-ref { font-size: var(--fs-xs); color: var(--ink-3); }
    .dash-counts { display: flex; gap: 6px; flex-wrap: wrap; }
    details.dash-method summary, details.dash-prompt summary { cursor: pointer; font-size: var(--fs-sm); color: var(--ink-2); font-weight: 500; }
    details.dash-method ul { margin: 8px 0 0; padding-left: 18px; font-size: var(--fs-sm); color: var(--ink-2); display: flex; flex-direction: column; gap: 3px; }

    .dash-heat td { vertical-align: middle; }
    .dash-heat td.dash-hc { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .dash-hv { display: block; font-weight: 600; color: var(--ink); }
    .dash-hd { display: block; font-size: var(--fs-xs); color: var(--ink-2); }
    .dash-heat tbody tr[data-market] { cursor: pointer; }
    .dash-heat tr.is-selected td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
    .dash-heat tr.dash-net td { background: var(--surface-2); font-weight: 600; }
    .dash-linkbtn { font: inherit; background: none; border: 0; padding: 0; color: var(--accent); font-weight: 600; cursor: pointer; text-align: left; }
    .dash-linkbtn:hover { text-decoration: underline; }
    .dash-swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -2px; margin-right: 5px; border: 1px solid var(--line); }

    .dash-agents-wrap { max-height: 460px; overflow: auto; }
    .dash-agents-wrap thead th { position: sticky; top: 0; z-index: 1; }
    .dash-sort { font: inherit; background: none; border: 0; padding: 0; color: inherit; cursor: pointer; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; letter-spacing: inherit; }
    .dash-sort[data-active="true"] { color: var(--ink); }
    .dash-agents-wrap tr.is-coach td { background: var(--warning-soft); }
    .dash-quart { display: flex; flex-direction: column; gap: 10px; }
    .dash-qbar { position: relative; height: 34px; border-radius: var(--r-md); background: var(--surface-2); }
    .dash-qbar span { position: absolute; top: 6px; bottom: 6px; border-radius: 4px; }
    .dash-qbar .q-iqr { background: var(--seq-2); }
    .dash-qbar .q-med { width: 3px; background: var(--ink); }
    .dash-qbar .q-dot { width: 8px; height: 8px; top: 13px; border-radius: 50%; background: var(--ink-3); margin-left: -4px; }
    .dash-qscale { display: flex; justify-content: space-between; font-size: var(--fs-xs); color: var(--ink-3); font-variant-numeric: tabular-nums; }

    .dash-review { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 9px; font-size: var(--fs-sm); color: var(--ink); }
    .dash-review li::marker { color: var(--ink-3); font-weight: 600; }
    .dash-owner { display: inline-block; margin-left: 4px; font-size: var(--fs-xs); color: var(--ink-2); background: var(--surface-2); border-radius: var(--r-sm); padding: 0 6px; white-space: nowrap; }
    .dash-ai-out { white-space: pre-wrap; word-break: break-word; font-size: var(--fs-sm); line-height: 1.55; background: var(--surface-2); border-radius: var(--r-md); padding: 12px 14px; min-height: 64px; color: var(--ink); }
    .dash-rv [hidden] { display: none !important; }
    .dash-agents-wrap td.dash-nw { white-space: nowrap; }
    .dash-out-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }

    @media (max-width: 1100px) {
      .dash-fn-row { grid-template-columns: minmax(96px, 120px) minmax(0, 1fr) 84px 120px 140px; grid-template-areas: "name bar rate net best" "name lost lost lost lost"; }
      .dash-fn-head .dash-a-lost { display: none; }
    }
    @media (max-width: 760px) {
      .dash-fn-head { display: none; }
      .dash-fn-row { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "name rate" "bar bar" "net best" "lost lost"; gap: 6px 12px; }
      .dash-fn-row:first-of-type { grid-template-areas: "name rate" "bar bar"; }
      .dash-fn-rate { align-items: flex-end; }
      .dash-fn-cell .dash-k { display: inline; }
      .dash-a-best { text-align: right; }
      .dash-alert { grid-template-columns: 20px minmax(0, 1fr); }
      .dash-alert-side { grid-column: 2; flex-direction: row; flex-wrap: wrap; align-items: center; }
      .dash-alert-side > div:first-child { flex: 1 1 100%; }
      .dash-scope { margin-left: 0; align-items: flex-start; text-align: left; flex: 1 1 100%; }
    }
    @media (max-width: 560px) {
      .dash-filters .field { flex: 1 1 100%; }
      .dash-period { flex: 1 1 100%; }
    }
  `);

  // ---------- HTML builders ----------
  function devHtml(d, unit) {
    const flat = Math.abs(d) < 0.0005;
    const cls = flat ? "flat" : d > 0 ? "pos" : "neg";
    const glyph = flat ? "■" : d > 0 ? "▲" : "▼";
    const txt = unit === "pts" ? Math.abs(d * 100).toFixed(1) + " pts" : Math.abs(d * 100).toFixed(1) + "%";
    return `<span class="dash-dev ${cls}">${glyph} ${txt}</span>`;
  }

  function filtersHtml(S, win) {
    const planOpts = [{ value: "all", label: "All plans" }].concat(D.plans.map((p) => ({ value: p.id, label: p.name + (S.market !== "all" && !contracted(p.id, S.market) ? " (not in " + Q.marketName(S.market) + ")" : "") })));
    const mkOpts = [{ value: "all", label: "All markets" }].concat(D.markets.map((m) => ({ value: m.id, label: m.name + (S.plan !== "all" && !contracted(S.plan, m.id) ? " (not contracted)" : "") })));
    const isDefault = S.plan === "all" && S.market === "all" && S.period === "13";
    return `<div class="dash-filters" id="dash-filters" role="group" aria-label="Dashboard filters">
      ${UI.select("dash-plan", planOpts, S.plan, "Health plan")}
      ${UI.select("dash-market", mkOpts, S.market, "Market")}
      <div class="dash-period"><span id="dash-period-label">Period</span>${UI.seg("dash-period", PERIODS, S.period).replace('role="group"', 'role="group" aria-labelledby="dash-period-label"')}</div>
      <div class="dash-scope">
        <span><strong>${esc(span(win.cur))}</strong> · deltas ${esc(win.vs)} (${esc(span(win.prev))})</span>
        <span>Data as of ${esc(F.date(D.meta.asOf))} · synthetic${isDefault ? "" : ` · <button type="button" class="dash-linkbtn" data-act="reset">Reset filters</button>`}</span>
      </div>
    </div>`;
  }

  const KPIS = [
    { label: "Contact rate", key: "contactRate", kind: "rate" },
    { label: "Schedule rate (of reached)", key: "scheduleRate", kind: "rate" },
    { label: "Show rate", key: "showRate", kind: "rate" },
    { label: "Completed visits", key: "completed", kind: "count" },
    { label: "Chart QA first-pass rate", key: "qaPassRate", kind: "rate" },
    { label: "Billed revenue (synthetic)", key: "revenue", kind: "money" },
    { label: "Attempts per completed visit", key: "attemptsPerCompleted", kind: "ratio", goodWhen: "down" },
  ];
  function kpiValue(kind, v) {
    if (kind === "rate") return F.pct(v);
    if (kind === "count") return F.num(v);
    if (kind === "money") return F.moneyK(v);
    return F.dec(v, 1);
  }
  function kpisHtml(m) {
    const foot = m.win.weeks >= 26 ? "last 13 vs first 13" : "vs prior " + m.win.weeks + " wks";
    return `<div class="dash-kpis">${KPIS.map((k, i) => {
      const a = m.now[k.key], b = m.prev[k.key];
      let delta, label;
      if (k.kind === "rate") { delta = Math.round((a - b) * 1000) / 1000; label = F.pts(delta); }
      else if (k.kind === "ratio") { delta = Math.round((a - b) * 10) / 10; label = F.signed(delta, 1); }
      else { delta = Math.round(pctCh(a, b) * 1000) / 1000; label = fmtCh(delta); }
      return UI.kpi({ label: k.label, value: kpiValue(k.kind, m.cur[k.key]), delta, deltaLabel: label, goodWhen: k.goodWhen || "up", foot, id: "dash-sp-" + i });
    }).join("")}</div>`;
  }

  function funnelHtml(m) {
    const allMk = m.S.market === "all";
    const head = `<div class="dash-fn-row dash-fn-head" aria-hidden="true"><span class="dash-a-name">Stage</span><span class="dash-a-bar">Volume, ${esc(span(m.win.cur))}</span><span class="dash-a-rate">Step rate</span><span class="dash-a-net">${allMk ? "vs median market" : "vs network"}</span><span class="dash-a-best">vs best market</span><span class="dash-a-lost">Lost at this step</span></div>`;
    const rows = STAGES.map((st, i) => {
      const count = m.cur[st.key];
      const w = m.cur.assigned ? count / m.cur.assigned : 0;
      const name = `<div class="dash-fn-name dash-a-name"><strong>${esc(st.label)}</strong><span>${esc(st.sub)}</span></div>`;
      const bar = `<div class="dash-fn-bar dash-a-bar"><div class="bar" role="img" aria-label="${esc(st.label)}: ${F.pct(w)} of assigned"><i style="width:${Math.max(0.5, w * 100).toFixed(1)}%"></i></div><span class="dash-fn-count">${F.num(count)}</span></div>`;
      if (!i) return `<div class="dash-fn-row">${name}${bar}<div class="dash-fn-rate dash-a-rate"><span class="xs muted">start</span></div></div>`;
      const s = m.steps[i - 1];
      const isLeak = m.leak && m.leak.step.id === s.id;
      const cmpRate = allMk ? s.med : s.netRate;
      const cmpName = allMk ? "Median market" : "Network";
      const best = s.best;
      const isBest = best && !allMk && best.id === m.S.market;
      return `<div class="dash-fn-row${isLeak ? " is-leak" : ""}">
        ${name}${bar}
        <div class="dash-fn-rate dash-a-rate"><b>${F.pct(s.rate)}</b>${isLeak ? UI.pill("critical", "Biggest leak") : ""}</div>
        <div class="dash-fn-cell dash-a-net"><span class="dash-k">${cmpName} </span>${F.pct(cmpRate)} ${devHtml(s.rate - cmpRate, "pts")}</div>
        <div class="dash-fn-cell dash-a-best">${best ? (isBest ? UI.pill("good", "Best market") : `<span class="dash-k">Best </span>${esc(best.name)} ${F.pct(best.rate)} ${devHtml(s.rate - best.rate, "pts")}`) : ""}</div>
        <div class="dash-fn-cell dash-a-lost"><span class="dash-k">Lost </span>${F.num(s.lost)} ${esc(s.lostLabel)}</div>
      </div>`;
    }).join("");
    return `<section class="panel" aria-labelledby="dash-fn-title">
      <div class="panel-head"><div><h2 id="dash-fn-title">Member engagement funnel</h2><div class="panel-sub">${esc(m.scopeLabel)}. Each row shows the step into that stage, compared with ${allMk ? "the median market" : "the network (all markets)"} and the best market.</div></div></div>
      <div class="dash-fn">${head}${rows}</div>
      ${leakHtml(m)}
    </section>`;
  }

  function leakHtml(m) {
    const L = m.leak;
    const name = m.S.market === "all" ? null : Q.marketName(m.S.market);
    if (!L) {
      return `<div class="callout good"><div><strong>No leak against peers.</strong> ${esc(name || "Every market")} is at or above the best market at every step for this filter.</div></div>`;
    }
    const st = L.step;
    const top = L.v.contrib[0];
    const isQa = st.id === "qa";
    const unit = isQa ? "billable visits" : "completed visits";
    const qty = isQa ? L.v.billable : L.v.completed;
    const target = L.mode === "med" ? `a network median of ${F.pct(st.med)}` : `the best market, ${st.best.name} at ${F.pct(st.best.rate)}`;
    let detail;
    if (m.S.market !== "all") {
      detail = `${esc(name)} converts ${F.pct(top.rate)} at this step vs ${esc(target)} (${F.pts(-top.gap)}). Closing this gap to ${L.mode === "med" ? "network median" : "the best market"} ≈ <strong>+${F.num(qty)} ${unit} / quarter ≈ ${F.moneyK(L.v.usd)}</strong>.`;
      if (L.mode === "med" && st.toBest.usd > L.v.usd * 1.05) detail += ` Matching the best market (${esc(st.best.name)}, ${F.pct(st.best.rate)}) ≈ ${F.moneyK(st.toBest.usd)}.`;
    } else {
      const others = L.v.contrib.length - 1;
      const share = L.v.usd ? top.usd / L.v.usd : 0;
      detail = `${esc(top.name)} converts ${F.pct(top.rate)} at this step vs ${esc(target)} (${F.pts(-top.gap)})${others > 0 ? `, and ${others} other market${others > 1 ? "s" : ""} also sit${others > 1 ? "" : "s"} below it` : ""}. Closing this gap to ${L.mode === "med" ? "network median" : "the best market"} ≈ <strong>+${F.num(qty)} ${unit} / quarter ≈ ${F.moneyK(L.v.usd)}</strong>${others > 0 ? `; ${esc(top.name)} is ${F.pct(share, 0)} of it` : ""}.`;
    }
    const opp = L.opp ? OPS.opps.get(L.opp) : null;
    return `<div class="callout warning dash-leak">${UI.icon("target")}
      <div class="stack" style="gap:8px">
        <div><strong>Biggest leak: ${esc(st.name)}</strong> <span class="muted small">(${esc(st.metric)}, ${esc(m.scopeLabel)})</span></div>
        <p class="small">${detail} <span class="muted">Revenue uses each plan's revenue per visit, weighted by visit mix.</span></p>
        <div class="row">
          ${L.opp ? `<button type="button" class="btn sm primary" data-act="opp" data-opp="${esc(L.opp)}">${UI.icon("arrow")} Open opportunity ${esc(L.opp)}</button>` : ""}
          <button type="button" class="btn sm" data-act="wf" data-process="${esc(st.process)}">${UI.icon("flow")} Map the workflow</button>
          ${opp ? `<span class="xs muted">${esc(opp.title)} · ${esc(opp.stage)}</span>` : ""}
        </div>
      </div>
    </div>`;
  }

  function alertCard(a, i) {
    const sev = SEV[a.sev];
    const opp = OPS.opps.get(a.opp);
    const seedOpp = D.opportunitiesSeed.find((o) => o.id === a.opp);
    const o = opp || seedOpp;
    const opp2 = a.opp2 ? OPS.opps.get(a.opp2) || D.opportunitiesSeed.find((x) => x.id === a.opp2) : null;
    return `<article class="dash-alert sev-${sev}" aria-label="${esc(SEV_LABEL[a.sev])} alert ${i + 1}">
      <div class="dash-alert-rank">${i + 1}</div>
      <div class="dash-alert-body stack">
        <div class="row dash-alert-tags">${UI.pill(sev, SEV_LABEL[a.sev])}${UI.tag(a.scope)}${UI.tag(a.metricLabel)}${a.since ? UI.tag("since " + a.since) : ""}</div>
        <h3 class="dash-alert-title">${esc(a.title)}</h3>
        <ul class="dash-ev">${a.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
        ${a.driver ? `<p class="dash-driver"><span class="label">Likely driver</span>${esc(a.driver)}</p>` : ""}
      </div>
      <div class="dash-alert-side">
        <div><div class="dash-impact-v">${esc(a.impactValue)}</div><div class="dash-impact-l">${esc(a.impactLabel)}</div></div>
        <button type="button" class="btn sm primary" data-act="opp" data-opp="${esc(a.opp)}" title="${esc(o ? o.title : a.opp)}">${UI.icon("arrow")} Open opportunity</button>
        <button type="button" class="btn sm" data-act="wf" data-process="${esc(a.process)}">${UI.icon("flow")} Map the workflow</button>
        <div class="dash-opp-ref">${o ? `${esc(o.id)} · ${esc(o.title)} (${esc(opp ? opp.stage : "not in pipeline")})` : esc(a.opp)}${opp2 ? `<br>Also: <button type="button" class="dash-linkbtn" data-act="opp" data-opp="${esc(opp2.id)}">${esc(opp2.id)} ${esc(opp2.title)}</button>` : ""}</div>
      </div>
    </article>`;
  }

  function alertsHtml(m) {
    const list = m.alerts;
    const hidden = m.alertsAll.length - list.length;
    const counts = [3, 2, 1].map((s) => ({ s, n: list.filter((a) => a.sev === s).length })).filter((x) => x.n);
    return `<section class="panel" aria-labelledby="dash-al-title">
      <div class="panel-head">
        <div><h2 id="dash-al-title">Needs attention</h2>
          <div class="panel-sub">Scanned from the data on every load for ${esc(planLabel(m.S.plan))}: each market × metric, last 4 wks (${esc(span(W_L4))}) vs other markets and vs its own prior 8 wks, plus step-change detection across 26 wks. Ranked by severity, then estimated quarterly value.</div></div>
        <div class="dash-counts">${counts.map((c) => UI.pill(SEV[c.s], c.n + " " + SEV[c.s])).join("")}</div>
      </div>
      ${list.length ? `<div class="dash-alerts">${list.map(alertCard).join("")}</div>` : `<div class="empty">No metric in ${esc(marketLabel(m.S.market))} is significantly below peers or its own recent history for ${esc(planLabel(m.S.plan))}.</div>`}
      ${hidden > 0 ? `<p class="small muted">${hidden} more alert${hidden > 1 ? "s" : ""} in other markets. <button type="button" class="dash-linkbtn" data-act="market-all">Show all markets</button></p>` : ""}
      <details class="dash-method"><summary>How alerts are computed</summary><ul>
        <li>Peer gap: last-4-week rate vs the pooled rate of the other markets; flagged at 3+ pts below with a two-proportion z of 3 or more.</li>
        <li>Own trend: last 4 wks vs the market's prior 8 wks; flagged at 2.5+ pts down with z of 3 or more.</li>
        <li>Step change: the single best split of the 26-week series (t of 5 or more, 2+ pts). The same week in at least half the markets becomes one network alert.</li>
        <li>Severity is the higher of the gap tier (3, 5, 8 pts) and the value tier ($90K, $150K per quarter); a deterioration inside the last 8 weeks moves it up one level. Call-center severity uses FTE absorbed (2, 5).</li>
        <li>Value: the gap applied to the market's own last-4-week volume, carried down the funnel at its own rates, priced at the plan-mix revenue per visit. Agent hours are valued at $${LOADED_HOURLY}/hr only to order them against dollar alerts.</li>
      </ul></details>
    </section>`;
  }

  function trendHtml(m) {
    return `<section class="panel" aria-labelledby="dash-tr-title">
      <div class="panel-head"><div><h2 id="dash-tr-title">Weekly trend</h2><div class="panel-sub">${esc(planLabel(m.S.plan))} · ${esc(marketLabel(m.S.market))} · all 26 weeks${m.win.band ? "; the shaded band is the selected period" : ""}. The dashed line marks the ${esc(wk(EVENTS[0].index))} ${esc(EVENTS[0].label.toLowerCase())}.</div></div></div>
      <div class="grid g-2">
        <div class="stack"><div class="label">Conversion rates</div><div class="chart-box"><canvas id="dash-c-rates" role="img" aria-label="Weekly schedule, show and QA first-pass rates"></canvas></div></div>
        <div class="stack"><div class="label">Completed visits per week</div><div class="chart-box"><canvas id="dash-c-visits" role="img" aria-label="Weekly completed visits"></canvas></div></div>
      </div>
    </section>`;
  }

  function tint(dev, scale) {
    const mag = Math.min(1, Math.abs(dev) / scale);
    if (mag < 0.05) return "";
    const a = (0.08 + 0.34 * mag).toFixed(3);
    const base = dev > 0 ? UI.series(0) : UI.cssVar("--critical");
    return ` style="background:${UI.alpha(base, a)}"`;
  }

  function scorecardHtml(m) {
    const cols = [
      { key: "contactRate", label: "Contact" },
      { key: "scheduleRate", label: "Schedule" },
      { key: "showRate", label: "Show" },
      { key: "qaPassRate", label: "QA first-pass" },
      { key: "endToEnd", label: "End-to-end" },
    ];
    const w = m.win.weeks;
    const prevById = {}, nowById = {};
    m.mkPrev.forEach((x) => (prevById[x.id] = x));
    m.mkNow.forEach((x) => (nowById[x.id] = x));
    const nowW = m.win.now.to - m.win.now.from + 1, prevW = m.win.prev.to - m.win.prev.from + 1;
    const rows = m.mk.map((x) => {
      const sel = m.S.market === x.id;
      const cells = cols.map((c) => {
        const dev = x[c.key] - m.net[c.key];
        const scale = c.key === "endToEnd" ? 0.05 : 0.1;
        return `<td class="dash-hc"${tint(dev, scale)}><span class="dash-hv">${F.pct(x[c.key])}</span><span class="dash-hd">${Math.abs(dev) < 0.0005 ? "■ 0.0" : (dev > 0 ? "▲ " : "▼ ") + Math.abs(dev * 100).toFixed(1)}</span></td>`;
      }).join("");
      const perWk = x.completed / w;
      const n = nowById[x.id], p = prevById[x.id];
      const ch = n && p ? pctCh(n.completed / nowW, p.completed / prevW) : 0;
      return `<tr data-act="market" data-market="${esc(x.id)}" class="${sel ? "is-selected" : ""}">
        <td><button type="button" class="dash-linkbtn" data-act="market" data-market="${esc(x.id)}" aria-pressed="${sel}">${esc(x.name)}</button>${sel ? ` ${UI.tag("Filtered")}` : ""}</td>
        ${cells}
        <td class="dash-hc"${tint(ch, 0.15)}><span class="dash-hv">${F.num(perWk)}</span><span class="dash-hd">${(ch >= 0 ? "▲ " : "▼ ") + Math.abs(ch * 100).toFixed(1)}%</span></td>
      </tr>`;
    }).join("");
    const netRow = `<tr class="dash-net"><td>Network</td>${cols.map((c) => `<td class="dash-hc"><span class="dash-hv">${F.pct(m.net[c.key])}</span><span class="dash-hd">reference</span></td>`).join("")}<td class="dash-hc"><span class="dash-hv">${F.num(m.net.completed / w)}</span><span class="dash-hd">${esc(m.win.weeks >= 26 ? "last 13 vs first 13" : "vs prior")}</span></td></tr>`;
    const missing = D.markets.filter((x) => !m.mk.some((y) => y.id === x.id)).map((x) => x.name);
    return `<section class="panel" aria-labelledby="dash-sc-title">
      <div class="panel-head"><div><h2 id="dash-sc-title">Market scorecard</h2><div class="panel-sub">${esc(planLabel(m.S.plan))} · ${esc(span(m.win.cur))}. Rates show the gap to the network in points; completed / wk shows the change ${esc(m.win.vs)}. Select a market to filter the page.</div></div>
        <div class="legend"><span><i style="background:${UI.alpha(UI.series(0), 0.34)}"></i>Better than network</span><span><i style="background:${UI.alpha(UI.cssVar("--critical"), 0.34)}"></i>Worse than network</span></div></div>
      <div class="table-wrap"><table class="data dash-heat"><thead><tr><th>Market</th>${cols.map((c) => `<th class="num">${esc(c.label)}</th>`).join("")}<th class="num">Completed / wk</th></tr></thead><tbody>${rows}${netRow}</tbody></table></div>
      ${missing.length && m.S.plan !== "all" ? `<p class="xs muted">${esc(Q.planName(m.S.plan))} is not contracted in ${esc(missing.join(", "))}.</p>` : ""}
    </section>`;
  }

  // ---------- call center ----------
  let agentSort = { key: "schedConv", dir: -1 };
  const AGENT_COLS = [
    { key: "name", label: "Agent" },
    { key: "team", label: "Team" },
    { key: "callsPerWeek", label: "Calls / wk", num: true, sort: true },
    { key: "ahtSec", label: "AHT", num: true, sort: true },
    { key: "acwSec", label: "ACW", num: true, sort: true },
    { key: "fcr", label: "FCR", num: true, sort: true },
    { key: "schedConv", label: "Sched. conv.", num: true, sort: true },
    { key: "qaScore", label: "QA", num: true, sort: true },
    { key: "flag", label: "Flag" },
  ];
  function agentsTableHtml(coach) {
    const ag = D.callCenter.agents.slice().sort((a, b) => (a[agentSort.key] - b[agentSort.key]) * agentSort.dir || a.id.localeCompare(b.id));
    const bottomIds = new Set(coach.bottom.map((a) => a.id));
    const topIds = new Set(coach.top.map((a) => a.id));
    const head = AGENT_COLS.map((c) => {
      if (!c.sort) return `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`;
      const active = agentSort.key === c.key;
      const aria = active ? (agentSort.dir > 0 ? "ascending" : "descending") : "none";
      return `<th class="num" aria-sort="${aria}"><button type="button" class="dash-sort" data-act="sort" data-key="${c.key}" data-active="${active}">${esc(c.label)}<span aria-hidden="true">${active ? (agentSort.dir > 0 ? "▲" : "▼") : "↕"}</span></button></th>`;
    }).join("");
    const body = ag.map((a) => {
      const coachFlag = bottomIds.has(a.id);
      const flag = coachFlag ? UI.pill("warning", "Coach") : topIds.has(a.id) ? UI.pill("good", "Peer mentor") : "";
      return `<tr class="${coachFlag ? "is-coach" : ""}">
        <td class="dash-nw">${esc(a.name)} <span class="xs muted">${esc(a.id)}</span></td>
        <td class="small dash-nw">${esc(a.team.replace(/\s+—\s+/, ": "))}</td>
        <td class="num">${F.num(a.callsPerWeek)}</td>
        <td class="num">${F.mmss(a.ahtSec)}</td>
        <td class="num">${F.mmss(a.acwSec)}</td>
        <td class="num">${F.pct(a.fcr, 0)}</td>
        <td class="num"><strong>${F.pct(a.schedConv)}</strong></td>
        <td class="num">${a.qaScore}</td>
        <td>${flag}</td>
      </tr>`;
    }).join("");
    return `<div class="table-wrap dash-agents-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function ccHtml(m) {
    const c = m.cc, co = m.coach;
    const foot = m.win.weeks >= 26 ? "last 13 vs first 13" : "vs prior " + m.win.weeks + " wks";
    const kp = [
      UI.kpi({ label: "AHT (incl. ACW)", value: F.mmss(c.cur.aht), delta: c.now.aht - c.prev.aht, deltaLabel: secs(c.now.aht - c.prev.aht), goodWhen: "down", foot }),
      UI.kpi({ label: "After-call work (ACW)", value: F.mmss(c.cur.acw), delta: c.now.acw - c.prev.acw, deltaLabel: secs(c.now.acw - c.prev.acw), goodWhen: "down", foot }),
      UI.kpi({ label: "Abandon rate", value: F.pct(c.cur.abandon), delta: c.now.abandon - c.prev.abandon, deltaLabel: F.pts(c.now.abandon - c.prev.abandon), goodWhen: "down", foot }),
      UI.kpi({ label: "Avg speed of answer", value: F.mmss(c.cur.asa), delta: c.now.asa - c.prev.asa, deltaLabel: secs(c.now.asa - c.prev.asa), goodWhen: "down", foot }),
    ].join("");
    const ag = D.callCenter.agents;
    const lo = Math.min(...ag.map((a) => a.schedConv)), hi = Math.max(...ag.map((a) => a.schedConv));
    const pos = (v) => ((v - lo) / Math.max(0.0001, hi - lo)) * 100;
    const coachOpp = OPS.opps.all().find((o) => o.sourceKey === "dashboard-coaching");
    return `<section class="panel" aria-labelledby="dash-cc-title">
      <div class="panel-head"><div><h2 id="dash-cc-title">Call center</h2><div class="panel-sub">Network-wide; the dialer does not split by plan or market. ${esc(span(m.win.cur))}; AHT includes ACW.</div></div></div>
      <div class="grid g-4">${kp}</div>
      <div class="grid g-2">
        <div class="stack"><div class="label">Weekly AHT and ACW (seconds)</div><div class="chart-box"><canvas id="dash-c-aht" role="img" aria-label="Weekly average handle time and after-call work"></canvas></div></div>
        <div class="panel inset dash-quart">
          <div><h3>Schedule conversion spread across ${ag.length} agents</h3><div class="panel-sub">Top quartile ${F.pct(co.topMean)} vs bottom quartile ${F.pct(co.bottomMean)}: a ${ptsAbs(co.topMean - co.bottomMean)} spread on the same call mix.</div></div>
          <div class="dash-qbar" role="img" aria-label="Agent schedule conversion: interquartile range ${F.pct(co.p25)} to ${F.pct(co.p75)}, median ${F.pct(co.p50)}">
            <span class="q-iqr" style="left:${pos(co.p25).toFixed(1)}%;width:${(pos(co.p75) - pos(co.p25)).toFixed(1)}%"></span>
            ${ag.map((a) => `<span class="q-dot" style="left:${pos(a.schedConv).toFixed(1)}%"></span>`).join("")}
            <span class="q-med" style="left:${pos(co.p50).toFixed(1)}%"></span>
          </div>
          <div class="dash-qscale"><span>${F.pct(lo)}</span><span>median ${F.pct(co.p50)} · middle 50% shaded</span><span>${F.pct(hi)}</span></div>
          <div class="callout accent"><div class="stack" style="gap:6px">
            <div><strong>If the bottom quartile (${co.bottom.length} agents) matched median schedule conversion: +${F.num(co.addSchedWk)} scheduled / week</strong></div>
            <div class="small">≈ +${F.num(co.completedQtr)} completed visits / quarter ≈ ${F.moneyK(co.usd)}. Each agent's gap to the median × their calls, scaled to the network's actual scheduled volume. Pair each coach-flagged agent with a peer mentor and review recorded calls weekly.</div>
            <div class="row">${coachOpp
              ? `<button type="button" class="btn sm" data-act="opp" data-opp="${esc(coachOpp.id)}">${UI.icon("arrow")} Open ${esc(coachOpp.id)} in pipeline</button>`
              : `<button type="button" class="btn sm primary" data-act="add-coaching">${UI.icon("plus")} Add coaching plan to pipeline</button>`}</div>
          </div></div>
        </div>
      </div>
      <div class="stack"><div class="row between"><div class="label">Agents · sort by any metric · "Coach" = bottom quartile on schedule conversion</div></div>
        <div id="dash-agents">${agentsTableHtml(co)}</div></div>
    </section>`;
  }

  // ---------- weekly ops review ----------
  function oppLine(id) {
    const o = OPS.opps.get(id) || D.opportunitiesSeed.find((x) => x.id === id);
    if (!o) return { doing: "", owner: "Ops lead" };
    return { doing: `${o.id} ${o.title} (${o.stage || "Backlog"})`, owner: o.owner || "Ops lead" };
  }
  function buildReview(m) {
    const b = [];
    const w = m.win;
    b.push({ lead: "Volume", text: `${F.num(m.cur.completed)} completed visits in ${span(w.cur)} (${fmtCh(pctCh(m.now.completed, m.prev.completed))} ${w.vs}); ${F.moneyK(m.cur.revenue)} billed (synthetic); ${F.dec(m.cur.attemptsPerCompleted)} attempts per completed visit.`, owner: "Ops analytics" });
    const moves = [["Schedule rate", "scheduleRate"], ["Show rate", "showRate"], ["Contact rate", "contactRate"], ["QA first-pass", "qaPassRate"]]
      .map(([n, k]) => ({ n, d: m.now[k] - m.prev[k], v: m.now[k] }))
      .sort((a, b2) => Math.abs(b2.d) - Math.abs(a.d));
    b.push({ lead: "What moved", text: moves.slice(0, 3).map((x) => `${x.n} ${F.pts(x.d)} to ${F.pct(x.v)}`).join("; ") + ` (${w.vs}).` });
    if (m.leak) {
      const L = m.leak, top = L.v.contrib[0];
      const qty = L.step.id === "qa" ? `${F.num(L.v.billable)} billable visits` : `${F.num(L.v.completed)} completed visits`;
      const o = L.opp ? oppLine(L.opp) : { doing: "", owner: "Ops lead" };
      b.push({ lead: "Biggest leak", text: `${L.step.name}: ${top.name} at ${F.pct(top.rate)} vs ${L.mode === "med" ? "network median " + F.pct(L.step.med) : "best market " + F.pct(L.step.best.rate)}; closing it ≈ +${qty} / quarter ≈ ${F.moneyK(L.v.usd)}.${o.doing ? " Doing: " + o.doing + "." : ""}`, owner: o.owner });
    }
    const leakMarket = m.leak && m.leak.v.contrib[0] ? m.leak.v.contrib[0].id : null;
    const used = new Set();
    m.alerts.forEach((a) => {
      if (b.length >= 6) return;
      if (m.leak && a.market === leakMarket && a.opp === m.leak.opp) return; // already covered by the leak bullet
      if (used.has(a.opp) && a.key !== "cc-aht") return;
      used.add(a.opp);
      const o = oppLine(a.opp);
      b.push({ lead: `${SEV_LABEL[a.sev]}: ${a.scope}`, text: `${a.title}. ${a.impactValue} (${a.impactLabel}).${o.doing ? " Doing: " + o.doing + "." : ""}`, owner: o.owner });
    });
    const co = m.coach;
    if (b.length < 7) b.push({ lead: "Ask", text: `Approve a 4-week peer-coaching pilot for the ${co.bottom.length} bottom-quartile schedulers (+${F.num(co.addSchedWk)} scheduled / week if they reach the median), and confirm owners for the items above by Friday.`, owner: "Call center manager" });
    return b.slice(0, 7);
  }
  function reviewMarkdown(m, bullets) {
    const head = `## Weekly ops review · week of ${F.date(D.weeks[LAST].start)}\n_${m.scopeLabel} · synthetic data_\n\n`;
    return head + bullets.map((x) => `- **${x.lead}.** ${x.text}${x.owner ? ` Owner: ${x.owner}.` : ""}`).join("\n");
  }
  function reviewPrompt(m, bullets) {
    const facts = {
      scope: { plan: planLabel(m.S.plan), market: marketLabel(m.S.market), period: span(m.win.cur), comparedWith: span(m.win.prev) },
      kpis: KPIS.map((k) => ({ name: k.label, value: kpiValue(k.kind, m.cur[k.key]), change: k.kind === "rate" ? F.pts(m.now[k.key] - m.prev[k.key]) : k.kind === "ratio" ? F.signed(m.now[k.key] - m.prev[k.key], 1) : fmtCh(pctCh(m.now[k.key], m.prev[k.key])) })),
      biggestLeak: m.leak ? { step: m.leak.step.name, market: m.leak.v.contrib[0] && m.leak.v.contrib[0].name, rate: F.pct(m.leak.v.contrib[0] ? m.leak.v.contrib[0].rate : 0), benchmark: F.pct(m.leak.mode === "med" ? m.leak.step.med : m.leak.step.best.rate), valuePerQuarter: F.moneyK(m.leak.v.usd) } : null,
      alerts: m.alerts.slice(0, 6).map((a) => { const o = oppLine(a.opp); return { severity: SEV_LABEL[a.sev], scope: a.scope, title: a.title, evidence: a.evidence, likelyDriver: a.driver, impact: a.impactValue + " (" + a.impactLabel + ")", initiative: o.doing, owner: o.owner }; }),
      callCenter: { aht: F.mmss(m.cc.cur.aht), acw: F.mmss(m.cc.cur.acw), abandonRate: F.pct(m.cc.cur.abandon), asa: F.mmss(m.cc.cur.asa), coachingOpportunity: `+${F.num(m.coach.addSchedWk)} scheduled per week if the bottom-quartile agents matched the median` },
    };
    return `You are drafting the Monday weekly operations review for a healthcare services company that runs member outreach, scheduling and in-home or telehealth assessments for health plans.

Write 5 to 7 Markdown bullets for the ops leadership meeting. Each bullet covers what moved (with the number), why (label hypotheses as hypotheses), what we are doing, and the owner. Lead with the biggest risk to completed visits or revenue. Use plain, specific language. Use only the numbers in the data below and do not invent any. No preamble and no closing summary.

Data (aggregated only; it contains no member-level information):
${JSON.stringify(facts, null, 2)}

For reference, the deterministic template produced these bullets; improve the clarity and ordering without adding facts:
${bullets.map((x) => "- " + x.lead + ": " + x.text).join("\n")}`;
  }
  function reviewListHtml(bullets) {
    return `<ol class="dash-review">${bullets.map((x) => `<li><strong>${esc(x.lead)}.</strong> ${esc(x.text)}${x.owner ? `<span class="dash-owner">Owner: ${esc(x.owner)}</span>` : ""}</li>`).join("")}</ol>`;
  }
  function reviewHtml(m, bullets, prompt) {
    return `<section class="panel dash-rv" aria-labelledby="dash-rv-title">
      <div class="panel-head"><div><h2 id="dash-rv-title">Weekly ops review</h2><div class="panel-sub">A Monday-meeting summary built from this page's numbers for ${esc(m.scopeLabel)}: what moved, why, what we're doing, owner.</div></div>
        <div class="row">
          <button type="button" class="btn primary" data-act="review-build">${UI.icon("doc")} Build ops review</button>
          <button type="button" class="btn" data-act="review-ai" id="dash-ai-btn" disabled title="Live Claude is available when this page runs inside the claude.ai Artifact viewer">${UI.icon("spark")} Draft with Claude</button>
          <button type="button" class="btn ghost" data-act="review-stop" id="dash-ai-stop" hidden>${UI.icon("x")} Stop</button>
        </div></div>
      <div class="stack" id="dash-rv-template">
        <div class="dash-out-head"><span class="label" id="dash-rv-stamp">Template · deterministic · week of ${esc(F.date(D.weeks[LAST].start))}</span><button type="button" class="btn sm" data-act="copy-template">${UI.icon("copy")} Copy Markdown</button></div>
        <div id="dash-rv-list">${reviewListHtml(bullets)}</div>
      </div>
      <div class="stack" id="dash-ai-wrap" hidden>
        <div class="dash-out-head"><span class="label" id="dash-ai-status">Claude draft</span><button type="button" class="btn sm" data-act="copy-ai" id="dash-ai-copy" disabled>${UI.icon("copy")} Copy draft</button></div>
        <div class="dash-ai-out" id="dash-ai-out" aria-live="polite"></div>
      </div>
      <p class="xs muted" id="dash-ai-note">Draft with Claude sends only the aggregated numbers shown on this page (no member identifiers). It is enabled when live Claude is connected.</p>
      <details class="dash-prompt"><summary>Prompt sent to Claude (aggregates only)</summary><pre class="code wrap">${esc(prompt)}</pre></details>
    </section>`;
  }

  // ---------- render ----------
  let state = null;
  let root = null;
  let model = null;
  let reviewBullets = [];
  let aiCtl = null;
  let aiText = "";

  function abortAi() {
    if (aiCtl) { try { aiCtl.abort(); } catch (e) { /* ignore */ } }
    aiCtl = null;
  }
  function setState(patch, opts) {
    state = Object.assign({}, state, patch);
    if (state.plan !== "all" && state.market !== "all" && !contracted(state.plan, state.market) && opts && opts.keepMarketValid) state.market = "all";
    UI.store.set(STORE_KEY, state);
    paint();
    if (opts && opts.scrollTop) {
      const f = root.querySelector("#dash-filters");
      if (f && f.scrollIntoView) f.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function emptyHtml(S) {
    return `<section class="panel"><div class="empty stack" style="align-items:center">
      <div><strong>${esc(Q.planName(S.plan))} is not contracted in ${esc(Q.marketName(S.market))}</strong>, so there is no outreach volume to show for this combination.</div>
      <div class="row" style="justify-content:center">
        <button type="button" class="btn sm primary" data-act="market-all">Show ${esc(Q.planName(S.plan))} in all markets</button>
        <button type="button" class="btn sm" data-act="plan-all">Show all plans in ${esc(Q.marketName(S.market))}</button>
      </div></div></section>`;
  }

  function note(text) { return `<div class="presenter-note">${esc(text)}</div>`; }

  function paint() {
    abortAi();
    aiText = "";
    UI.destroyCharts();
    const S = state;
    const win = windows(S.period);
    if (!contracted(S.plan, S.market)) {
      root.innerHTML = filtersHtml(S, win) + emptyHtml(S);
      return;
    }
    const m = (model = buildModel(S, win));
    reviewBullets = buildReview(m);
    const prompt = reviewPrompt(m, reviewBullets);
    m.prompt = prompt;
    const leakTxt = m.leak && m.leak.v.contrib[0]
      ? `The biggest leak for this view is ${m.leak.step.name.toLowerCase()}, led by ${m.leak.v.contrib[0].name}; closing it to the ${m.leak.mode === "med" ? "network median" : "best market"} is worth about ${F.moneyK(m.leak.v.usd)} a quarter. That is where I'd spend my first discovery interviews, and the button takes us straight to the opportunity.`
      : "Every step here is at or above peers, so the next gains come from network-wide changes in the alert list.";
    root.innerHTML = [
      filtersHtml(S, win),
      kpisHtml(m),
      note("This is the Monday view for an ops leader: seven numbers that trace a member from the outreach list to a billed visit, each against the prior period. In week one I'd lock these definitions with ops and finance so the meeting argues about the work, not the numbers."),
      funnelHtml(m),
      note(leakTxt),
      alertsHtml(m),
      note("None of these alerts are typed in. The page scans every market and metric against peers, against its own recent history, and for step changes, which is how it finds the W14 system change hitting all six markets in the same week. Each alert carries its evidence, a dollar or hours estimate, and a one-click path to the opportunity and the workflow map."),
      trendHtml(m),
      scorecardHtml(m),
      ccHtml(m),
      reviewHtml(m, reviewBullets, prompt),
      note("The weekly review writes itself from the same numbers, so the analyst's Monday deck becomes a five-minute check. Claude only sees aggregates, never member data, and the template works with no AI at all."),
    ].join("");
    drawCharts(m);
    checkAi();
  }

  function drawCharts(m) {
    // KPI sparklines: comparison window + current window
    KPIS.forEach((k, i) => UI.spark("dash-sp-" + i, m.spark.map((w) => w[k.key])));

    const bw = Q.byWeek({ plan: m.S.plan, market: m.S.market });
    const labels = bw.map((w) => w.week);
    const sets = [["Schedule rate", "scheduleRate"], ["Show rate", "showRate"], ["QA first-pass", "qaPassRate"]];
    const vals = [];
    sets.forEach(([, k]) => bw.forEach((w) => vals.push(w[k])));
    const yMin = Math.max(0, Math.floor((Math.min(...vals) - 0.08) * 10) / 10);
    UI.chart("dash-c-rates", {
      type: "line",
      data: { labels, datasets: sets.map(([l, k], i) => ({ label: l, data: bw.map((w) => w[k]), borderColor: UI.series(i), backgroundColor: UI.series(i), borderWidth: 2 })) },
      options: {
        scales: { y: { min: yMin, max: 1, ticks: { callback: UI.pctTick } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 8 } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${F.pct(c.parsed.y)}` } } },
      },
      plugins: [eventPlugin({ band: m.win.band, labelPos: "bottom" })],
    });
    const inBand = (i) => !m.win.band || (i >= m.win.band[0] && i <= m.win.band[1]);
    UI.chart("dash-c-visits", {
      type: "bar",
      data: { labels, datasets: [{ label: "Completed visits", data: bw.map((w) => w.completed), backgroundColor: bw.map((w) => (inBand(w.weekIndex) ? UI.series(0) : UI.alpha(UI.series(0), 0.4))), borderRadius: 4, maxBarThickness: 24 }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` Completed: ${F.num(c.parsed.y)}` } } },
        scales: { y: { beginAtZero: true, grace: "18%", ticks: { callback: (v) => F.compact(v) } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 8 } } },
      },
      plugins: [eventPlugin({ band: null, labelPos: "top" })],
    });
    const cw = D.callCenter.weekly;
    UI.chart("dash-c-aht", {
      type: "line",
      data: { labels: cw.map((w) => w.week), datasets: [
        { label: "AHT (incl. ACW)", data: cw.map((w) => w.ahtSec), borderColor: UI.series(0), backgroundColor: UI.series(0), borderWidth: 2 },
        { label: "ACW", data: cw.map((w) => w.acwSec), borderColor: UI.series(1), backgroundColor: UI.series(1), borderWidth: 2 },
      ] },
      options: {
        scales: { y: { beginAtZero: true, max: 600, ticks: { stepSize: 120, callback: (v) => F.mmss(v) } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 8 } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${F.mmss(c.parsed.y)}` } } },
      },
      plugins: [eventPlugin({ band: m.win.band, labelPos: "bottom" })],
    });
  }

  function checkAi() {
    const btn = root && root.querySelector("#dash-ai-btn");
    if (!btn || !OPS.ai) return;
    OPS.ai.available().then((ok) => {
      if (!document.body.contains(btn)) return;
      btn.disabled = !ok;
      btn.title = ok ? "Send the aggregated numbers to Claude for a polished draft" : "Live Claude is available when this page runs inside the claude.ai Artifact viewer";
      const n = root.querySelector("#dash-ai-note");
      if (n) n.textContent = ok
        ? "Live Claude is connected. Draft with Claude sends only the aggregated numbers shown on this page (no member identifiers); review the draft before sending."
        : "Live Claude is not connected in this view, so the deterministic template is the review. Inside the claude.ai Artifact viewer, Draft with Claude sends only aggregated numbers.";
    }).catch(() => { /* stays disabled */ });
  }

  async function draftWithClaude() {
    if (aiCtl || !model) return;
    const wrap = root.querySelector("#dash-ai-wrap"), out = root.querySelector("#dash-ai-out");
    const status = root.querySelector("#dash-ai-status"), stop = root.querySelector("#dash-ai-stop");
    const btn = root.querySelector("#dash-ai-btn"), copyBtn = root.querySelector("#dash-ai-copy");
    if (!wrap || !out) return;
    wrap.hidden = false;
    out.textContent = "Thinking…";
    status.textContent = "Claude draft · streaming";
    stop.hidden = false;
    btn.disabled = true;
    copyBtn.disabled = true;
    const ctl = (aiCtl = new AbortController());
    aiText = "";
    try {
      const res = await OPS.ai.ask(model.prompt, { signal: ctl.signal, onText: ({ text }) => { if (aiCtl === ctl && text) { aiText = text; out.textContent = text; } } });
      if (aiCtl !== ctl) return;
      aiText = (res && res.text) || aiText;
      out.textContent = aiText;
      status.textContent = "Claude draft · review before sending";
    } catch (e) {
      if (aiCtl !== ctl && !(e && e.code === "cancelled")) return;
      if (e && e.code === "cancelled") {
        aiText = (e.text || aiText || "").trim();
        out.textContent = aiText || "Stopped before any text arrived.";
        status.textContent = "Claude draft · stopped";
      } else {
        out.textContent = OPS.ai.message(e) + " The template above is the review.";
        status.textContent = "Claude draft · unavailable";
        aiText = "";
      }
    } finally {
      if (aiCtl === ctl) aiCtl = null;
      if (document.body.contains(stop)) stop.hidden = true;
      if (document.body.contains(btn)) btn.disabled = false;
      if (document.body.contains(copyBtn)) copyBtn.disabled = !aiText;
    }
  }

  function openOpp(id) {
    if (!id) return;
    if (!OPS.opps.get(id)) {
      const seed = D.opportunitiesSeed.find((o) => o.id === id);
      if (seed) { OPS.opps.save(Object.assign({}, seed)); UI.toast(id + " was missing, so it was restored to the pipeline"); }
    }
    OPS.navigate("pipeline", { focus: id });
  }

  function addCoaching() {
    if (!model) return;
    const co = model.coach;
    const existing = OPS.opps.all().find((o) => o.sourceKey === "dashboard-coaching");
    if (existing) { OPS.navigate("pipeline", { focus: existing.id }); return; }
    const rec = OPS.opps.save({
      title: "Peer coaching for bottom-quartile schedulers",
      dept: "Call center",
      stage: "Backlog",
      problem: `Schedule conversion ranges from ${F.pct(co.bottomMean)} (bottom quartile) to ${F.pct(co.topMean)} (top quartile) on the same call mix.`,
      solution: "Pair each bottom-quartile agent with a top-quartile peer mentor, review two recorded calls a week against a scheduling checklist, and track conversion weekly for 4 weeks.",
      kpi: "Schedule conversion (bottom quartile)",
      impact: 3, confidence: 4, effort: 1, risk: "Low",
      hoursSavedPerMonth: 0,
      revenueImpactAnnual: Math.round((co.usd * 4) / 1000) * 1000,
      owner: "Call center manager",
      tools: ["Dialer reports", "Call recordings", "QA scorecard"],
      source: "dashboard",
      sourceKey: "dashboard-coaching",
    });
    UI.toast(`Added ${rec.id} to the pipeline (Backlog)`);
    paint();
  }

  OPS.register({
    id: "dashboard",
    title: "Ops Command Center",
    stage: "see",
    order: 10,
    icon: "gauge",
    eyebrow: "1 · See the operation",
    summary: "One governed view of the member engagement funnel, from outreach list to billed visit, that finds the bottlenecks, sizes them in visits and dollars, and links each one to an improvement opportunity.",
    jd: [
      "Build dashboards that surface bottlenecks for faster decisions",
      "Analyze operational data to uncover performance gaps",
      "Define KPIs and quantify the impact of improvements",
      "Automate manual reporting",
    ],
    render(r, ctx) {
      root = r;
      state = loadFilters();
      const p = (ctx && ctx.params) || {};
      if (p.plan && (p.plan === "all" || D.plans.some((x) => x.id === p.plan))) state.plan = p.plan;
      if (p.market && (p.market === "all" || D.markets.some((x) => x.id === p.market))) state.market = p.market;
      if (p.period && PERIODS.some((x) => x.value === String(p.period))) state.period = String(p.period);

      root.addEventListener("change", (e) => {
        if (e.target.id === "dash-plan") setState({ plan: e.target.value });
        else if (e.target.id === "dash-market") setState({ market: e.target.value });
      });
      UI.on(root, "click", "#dash-period button[data-value]", (e, el) => { if (el.dataset.value !== state.period) setState({ period: el.dataset.value }); });
      UI.on(root, "click", "[data-act]", (e, el) => {
        const act = el.dataset.act;
        if (act === "opp") { e.stopPropagation(); openOpp(el.dataset.opp); }
        else if (act === "wf") OPS.navigate("workflow", { process: el.dataset.process });
        else if (act === "market") {
          const id = el.dataset.market;
          const next = state.market === id ? "all" : id;
          setState({ market: next }, { scrollTop: true });
          UI.toast(next === "all" ? "Showing all markets" : "Filtered to " + Q.marketName(next));
        }
        else if (act === "market-all") setState({ market: "all" });
        else if (act === "plan-all") setState({ plan: "all" });
        else if (act === "reset") setState({ plan: "all", market: "all", period: "13" });
        else if (act === "sort") {
          const k = el.dataset.key;
          agentSort = agentSort.key === k ? { key: k, dir: -agentSort.dir } : { key: k, dir: -1 };
          const host = root.querySelector("#dash-agents");
          if (host && model) {
            host.innerHTML = agentsTableHtml(model.coach);
            const b = host.querySelector(`.dash-sort[data-key="${k}"]`);
            if (b) b.focus();
          }
        }
        else if (act === "review-build") {
          if (!model) return;
          reviewBullets = buildReview(model);
          const list = root.querySelector("#dash-rv-list");
          if (list) list.innerHTML = reviewListHtml(reviewBullets);
          const stamp = root.querySelector("#dash-rv-stamp");
          if (stamp) stamp.textContent = `Template · built ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} from ${model.scopeLabel}`;
          UI.toast("Ops review built from the current filter");
        }
        else if (act === "review-ai") draftWithClaude();
        else if (act === "review-stop") abortAi();
        else if (act === "copy-template") { if (model) UI.copy(reviewMarkdown(model, reviewBullets), "Ops review copied as Markdown"); }
        else if (act === "copy-ai") { if (aiText) UI.copy(aiText, "Claude draft copied"); }
        else if (act === "add-coaching") addCoaching();
      });
      paint();
    },
    destroy() {
      abortAi();
      root = null;
      model = null;
    },
  });
})();
