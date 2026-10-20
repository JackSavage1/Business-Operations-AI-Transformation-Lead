/* Throughline · No-Show & Scheduling Optimizer
 *
 * Proves: "Redesign appointment scheduling workflows to improve member engagement and visit completion rates".
 * 1. Describes no-shows in the 12-week appointment extract (KPIs, driver small multiples, lift table).
 * 2. Fits a small, explainable logistic regression in the browser (cached at module level).
 * 3. Re-scores every appointment under counterfactual reminder / confirmation / lead-time policies and
 *    sizes the result to the network funnel's monthly volume, with costs and overbooking collisions.
 */
(function () {
  "use strict";
  const OPS = window.OPS;
  const UI = window.UI;
  if (!OPS || !UI) return;

  const ID = "scheduling";
  const F = UI.fmt;
  const PER_MONTH = 52 / 12 / 4; // a 4-week window → one month
  const LAST4 = { from: 22, to: 25 }; // W23–W26: the funnel window used for sizing
  const TRAIN = { from: 14, to: 21 }; // W15–W22
  const TEST = { from: 22, to: 25 }; // W23–W26

  // Labelled assumptions (everything else on the page is computed from the data)
  const ASSUME = {
    acceptEarlier: 0.6, // High-tier members who accept an earlier slot when offered one
    reofferMin: 3, // scheduler minutes per earlier-slot offer
    collisionCost: 35, // rebooking call + service recovery per double-booked slot
    backfillMin: 4, // scheduler minutes per filled standby slot
    backfillText: 0.6, // texts to the standby list per filled slot
    fixedMonthly: 1000, // SMS platform + model monitoring, network-wide, prorated by scope
  };

  const DEFAULTS = { sms: true, smsCost: 0.35, call: true, callMin: 4, loaded: 30, lead: true, leadCap: 10, overbook: false, overPct: 10, backfill: true, fill: 30, credit: 50 };
  const PRESETS = {
    recommended: DEFAULTS,
    confirm: Object.assign({}, DEFAULTS, { call: false, lead: false, overbook: false, backfill: false }),
    all: Object.assign({}, DEFAULTS, { overbook: true, fill: 50 }),
    off: Object.assign({}, DEFAULTS, { sms: false, call: false, lead: false, overbook: false, backfill: false }),
  };

  // ---------- small helpers ----------
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  const isNS = (a) => a.outcome === "No-show";
  const leadBucket = (d) => (d <= 3 ? "1–3" : d <= 7 ? "4–7" : d <= 14 ? "8–14" : d <= 21 ? "15–21" : "22+");
  const planShort = (id) => {
    const p = OPS.q.plan(id) || { name: id, line: "" };
    const line = p.line || "";
    const s = line.includes("D-SNP") ? "D-SNP" : line.startsWith("Medicare") ? "MA" : line.startsWith("Medicaid") ? "Medicaid" : "ACA";
    return p.name + " (" + s + ")";
  };
  const money0 = (v) => F.moneyK(v);
  const visitsFmt = (v) => F.num(Math.round(v));

  // ---------- model features ----------
  // kind "var" features change under the counterfactual policies; the rest stay fixed per appointment.
  const FEATURES = [
    { key: "lead", label: "Lead time, per +7 days", unit: 7, kind: "var", get: (a) => Math.min(a.leadDays, 45) },
    { key: "prior", label: "Prior no-show on record", ref: "vs none", get: (a) => a.priorNoShow },
    { key: "dist", label: "Drive distance, per +10 mi", unit: 10, get: (a) => a.distanceMi },
    { key: "conf", label: "Confirmed before the visit", kind: "var", get: (a) => a.confirmed },
    { key: "remNone", label: "No reminder sent", ref: "vs two-way SMS", kind: "var", get: (a) => +(a.reminder === "None") },
    { key: "remOne", label: "One-way SMS reminder only", ref: "vs two-way SMS", kind: "var", get: (a) => +(a.reminder === "SMS one-way") },
    { key: "remCall", label: "Live-call reminder", ref: "vs two-way SMS", kind: "var", get: (a) => +(a.reminder === "Live call") },
    { key: "early", label: "8–10am slot", ref: "vs midday", get: (a) => +(a.timeSlot === "8–10am") },
    { key: "late", label: "4–6pm slot", ref: "vs midday", get: (a) => +(a.timeSlot === "4–6pm") },
    { key: "chRef", label: "Booked from a plan referral", ref: "vs outbound call", get: (a) => +(a.channel === "Plan referral") },
    { key: "chIn", label: "Member called in to book", ref: "vs outbound call", get: (a) => +(a.channel === "Inbound call") },
    { key: "chSms", label: "Booked by SMS link", ref: "vs outbound call", get: (a) => +(a.channel === "SMS link") },
    { key: "pBeta", label: planShort("beta"), ref: "vs Plan Alpha", get: (a) => +(a.plan === "beta") },
    { key: "pDelta", label: planShort("delta"), ref: "vs Plan Alpha", get: (a) => +(a.plan === "delta") },
    { key: "pGamma", label: planShort("gamma"), ref: "vs Plan Alpha", get: (a) => +(a.plan === "gamma") },
    { key: "spanish", label: "Spanish-preferred member", ref: "vs English", get: (a) => +(a.language === "Spanish") },
    { key: "mon", label: "Monday visit", ref: "vs other days", get: (a) => +(a.dayOfWeek === "Mon") },
    { key: "tele", label: "Telehealth assessment", ref: "vs in-home", get: (a) => +(a.visitType === "Telehealth assessment") },
    { key: "gap", label: "Care-gap visit", ref: "vs in-home assessment", get: (a) => +(a.visitType === "Care-gap visit") },
    { key: "young", label: "Member under 45", ref: "vs 45+", get: (a) => +(a.ageBand === "<45") },
  ];
  const FI = {};
  FEATURES.forEach((f, j) => (FI[f.key] = j));

  // ---------- model fit (cached) ----------
  let MODEL = null;
  function getModel() {
    if (MODEL) return MODEL;
    const t0 = performance.now();
    const A = OPS.data.appointments;
    const K = FEATURES.length;
    const rows = A.map((a) => ({ a, x: FEATURES.map((f) => f.get(a)), y: isNS(a) ? 1 : 0 }));
    const train = rows.filter((r) => r.a.weekIndex >= TRAIN.from && r.a.weekIndex <= TRAIN.to);
    const test = rows.filter((r) => r.a.weekIndex >= TEST.from && r.a.weekIndex <= TEST.to);
    const n = train.length;

    // standardize on the training window
    const mu = new Float64Array(K), sd = new Float64Array(K);
    train.forEach((r) => r.x.forEach((v, j) => (mu[j] += v / n)));
    train.forEach((r) => r.x.forEach((v, j) => (sd[j] += ((v - mu[j]) * (v - mu[j])) / n)));
    for (let j = 0; j < K; j++) sd[j] = Math.sqrt(sd[j]) || 1;
    const X = new Float64Array(n * K), Y = new Float64Array(n);
    train.forEach((r, i) => { for (let j = 0; j < K; j++) X[i * K + j] = (r.x[j] - mu[j]) / sd[j]; Y[i] = r.y; });

    // batch gradient descent, zero-initialized weights → fully deterministic
    const ybar = Y.reduce((s, v) => s + v, 0) / n;
    let b = Math.log(ybar / (1 - ybar));
    const w = new Float64Array(K), gw = new Float64Array(K);
    const LR = 1.5, LAMBDA = 0.002, MAX_IT = 160;
    let it = 0;
    for (; it < MAX_IT; it++) {
      gw.fill(0);
      let gb = 0;
      for (let i = 0; i < n; i++) {
        const o = i * K;
        let z = b;
        for (let j = 0; j < K; j++) z += w[j] * X[o + j];
        const e = sigmoid(z) - Y[i];
        gb += e;
        for (let j = 0; j < K; j++) gw[j] += e * X[o + j];
      }
      let gmax = Math.abs(gb / n);
      b -= (LR * gb) / n;
      for (let j = 0; j < K; j++) {
        const g = gw[j] / n + LAMBDA * w[j];
        gmax = Math.max(gmax, Math.abs(g));
        w[j] -= LR * g;
      }
      if (gmax < 2e-5) { it++; break; }
    }

    // fold standardization into raw-scale weights for fast scoring
    const rawW = new Float64Array(K);
    let b0 = b;
    for (let j = 0; j < K; j++) { rawW[j] = w[j] / sd[j]; b0 -= (w[j] * mu[j]) / sd[j]; }
    const varIdx = FEATURES.map((f, j) => (f.kind === "var" ? j : -1)).filter((j) => j >= 0);
    rows.forEach((r) => {
      let zf = b0;
      for (let j = 0; j < K; j++) if (FEATURES[j].kind !== "var") zf += rawW[j] * r.x[j];
      r.zFixed = zf;
      let z = zf;
      varIdx.forEach((j) => (z += rawW[j] * r.x[j]));
      r.p = sigmoid(z);
    });

    // risk tiers from training-window quantiles: ~50 / 30 / 20 % of volume
    const tp = train.map((r) => r.p).sort((x, y) => x - y);
    const q50 = tp[Math.floor(0.5 * tp.length)], q80 = tp[Math.floor(0.8 * tp.length)];
    rows.forEach((r) => (r.tier = r.p < q50 ? "Low" : r.p < q80 ? "Medium" : "High"));

    const auc = (set) => {
      const s = set.map((r) => ({ p: r.p, y: r.y })).sort((x, y) => x.p - y.p);
      let sumPos = 0, nPos = 0;
      for (let i = 0; i < s.length;) {
        let j = i;
        while (j < s.length && s[j].p === s[i].p) j++;
        const avgRank = (i + j + 1) / 2;
        for (let k = i; k < j; k++) if (s[k].y) { sumPos += avgRank; nPos++; }
        i = j;
      }
      const nNeg = s.length - nPos;
      return nPos && nNeg ? (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : 0.5;
    };

    // calibration by decile on the test window
    const ts = test.slice().sort((x, y) => x.p - y.p);
    const calib = [];
    for (let d = 0; d < 10; d++) {
      const g = ts.slice(Math.floor((d * ts.length) / 10), Math.floor(((d + 1) * ts.length) / 10));
      calib.push({ pred: g.reduce((s, r) => s + r.p, 0) / g.length, act: g.reduce((s, r) => s + r.y, 0) / g.length, n: g.length });
    }
    const testNS = test.reduce((s, r) => s + r.y, 0);
    const tiers = ["Low", "Medium", "High"].map((t) => {
      const g = test.filter((r) => r.tier === t);
      const ns = g.reduce((s, r) => s + r.y, 0);
      return { tier: t, n: g.length, share: g.length / test.length, pred: g.reduce((s, r) => s + r.p, 0) / (g.length || 1), act: ns / (g.length || 1), capture: ns / (testNS || 1) };
    });

    // data-derived intervention parameters
    const two = A.filter((a) => a.reminder === "SMS two-way");
    const live = A.filter((a) => a.reminder === "Live call");
    const nonNS = A.filter((a) => !isNS(a));

    MODEL = {
      K, mu, sd, w, rawW, b0, rows, train, test, q50, q80, calib, tiers, iterations: it,
      aucTrain: auc(train), aucTest: auc(test),
      confirmSms: two.filter((a) => a.confirmed).length / two.length,
      confirmCall: live.filter((a) => a.confirmed).length / live.length,
      rConv: nonNS.filter((a) => a.outcome === "Completed").length / nonNS.length,
      fitMs: performance.now() - t0,
    };
    return MODEL;
  }

  /** probability for a row under a mixture of reminder / confirmation / lead-time states */
  function probOf(r, states) {
    const W = MODEL.rawW;
    let p = 0;
    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      const z = r.zFixed + W[FI.lead] * Math.min(s.lead, 45) + W[FI.conf] * s.conf +
        W[FI.remNone] * (s.rem === "None" ? 1 : 0) + W[FI.remOne] * (s.rem === "SMS one-way" ? 1 : 0) + W[FI.remCall] * (s.rem === "Live call" ? 1 : 0);
      p += s.w * sigmoid(z);
    }
    return p;
  }

  // ---------- descriptive analysis ----------
  const scopeFilter = (scope) => (a) => scope === "all" || a.market === scope;

  const DIMS = [
    { key: "lead", label: "Lead time (days)", short: "Lead time", get: (a) => leadBucket(a.leadDays), order: ["1–3", "4–7", "8–14", "15–21", "22+"], seg: (v) => "Lead time " + v + " days", lever: "Cap lead time; offer earlier slot", multiple: true },
    { key: "reminder", label: "Reminder type", short: "Reminder", get: (a) => a.reminder, order: ["None", "SMS one-way", "SMS two-way", "Live call"], seg: (v) => (v === "None" ? "No reminder" : "Reminder: " + v), lever: "Two-way SMS confirmation", multiple: true },
    { key: "confirmed", label: "Confirmed before visit", short: "Confirmation", get: (a) => (a.confirmed ? "Confirmed" : "Not confirmed"), order: ["Not confirmed", "Confirmed"], seg: (v) => v + " before visit", lever: "Confirmation workflow", multiple: true },
    { key: "prior", label: "Prior no-show on record", short: "Attendance history", get: (a) => (a.priorNoShow ? "Prior no-show" : "None on record"), order: ["None on record", "Prior no-show"], seg: (v) => (v === "Prior no-show" ? "Prior no-show on record" : "No prior no-show"), lever: "Live confirm call (High tier)", multiple: true },
    { key: "slot", label: "Time slot", short: "Time slot", get: (a) => a.timeSlot, order: ["8–10am", "10–12pm", "12–2pm", "2–4pm", "4–6pm"], seg: (v) => v + " slot", lever: "Steer high-risk members to midday", multiple: true },
    { key: "channel", label: "Booking channel", short: "Booking channel", get: (a) => a.channel, order: ["Outbound call", "Inbound call", "SMS link", "Plan referral"], seg: (v) => "Booked via " + v.toLowerCase(), lever: "Confirm at booking; warm handoff", multiple: true },
    { key: "market", label: "Market", short: "Market", get: (a) => OPS.q.marketName(a.market), order: OPS.data.markets.map((m) => m.name), seg: (v) => v + " market", lever: "Market root cause (see Capacity)", multiple: true },
    { key: "plan", label: "Health plan", short: "Health plan", get: (a) => planShort(a.plan), order: OPS.data.plans.map((p) => planShort(p.id)), seg: (v) => v, lever: "Plan contact-data refresh" },
    { key: "visit", label: "Visit type", short: "Visit type", get: (a) => a.visitType, order: ["In-home assessment", "Telehealth assessment", "Care-gap visit"], seg: (v) => v, lever: "Bundle care gaps into assessments" },
    { key: "lang", label: "Language", short: "Language", get: (a) => a.language, order: ["English", "Spanish"], seg: (v) => v + "-preferred", lever: "Spanish templates; bilingual confirm" },
    { key: "age", label: "Age band", short: "Age band", get: (a) => a.ageBand, order: ["<45", "45–64", "65–74", "75–84", "85+"], seg: (v) => "Age " + v, lever: "Evening and SMS-first options" },
    { key: "dow", label: "Day of week", short: "Day of week", get: (a) => a.dayOfWeek, order: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], seg: (v) => v + " visits", lever: "Reminder timing around weekends" },
  ];

  function groupRate(list, dim) {
    const g = {};
    list.forEach((a) => {
      const k = dim.get(a);
      g[k] = g[k] || { n: 0, ns: 0 };
      g[k].n++;
      if (isNS(a)) g[k].ns++;
    });
    return dim.order.filter((k) => g[k]).map((k) => ({ key: k, n: g[k].n, ns: g[k].ns, rate: g[k].ns / g[k].n }));
  }

  function describe(scope) {
    const list = OPS.data.appointments.filter(scopeFilter(scope));
    const n = list.length;
    const ns = list.filter(isNS).length;
    const done = list.filter((a) => a.outcome === "Completed").length;
    const conf = list.filter((a) => a.confirmed).length;
    const lead = list.reduce((s, a) => s + a.leadDays, 0) / (n || 1);
    const f = OPS.q.funnel({ market: scope, from: LAST4.from, to: LAST4.to });
    const byPlan = OPS.q.by("plan", { market: scope, from: LAST4.from, to: LAST4.to });
    const atRisk = byPlan.reduce((s, p) => s + p.noShows * PER_MONTH * (p.held ? p.billed / p.held : 0) * (OPS.q.plan(p.id).revenuePerVisit || 0), 0);
    return {
      list, n, rate: ns / (n || 1), done: done / (n || 1), conf: conf / (n || 1), lead,
      funnel: f, monthSched: f.scheduled * PER_MONTH, monthNoShows: f.noShows * PER_MONTH, atRisk,
    };
  }

  function liftRows(D, overall) {
    const out = [];
    const totalNS = D.list.filter(isNS).length;
    DIMS.forEach((dim) => {
      groupRate(D.list, dim).forEach((g) => {
        const restN = D.n - g.n;
        if (g.n < 25 || restN < 25) return;
        const restNS = totalNS - g.ns;
        const rest = restNS / restN;
        out.push({
          seg: dim.seg(g.key), dim: dim.short, n: g.n, share: g.n / D.n, rate: g.rate, rest,
          lift: rest ? g.rate / rest : 0, excess: g.n * (g.rate - overall), lever: dim.lever,
        });
      });
    });
    return out.filter((r) => r.rate > r.rest);
  }

  // ---------- simulator ----------
  function simulate(scope, s) {
    const M = getModel();
    const rows = M.rows.filter((r) => scope === "all" || r.a.market === scope);
    const f = OPS.q.funnel({ market: scope, from: LAST4.from, to: LAST4.to });
    const fNet = OPS.q.funnel(LAST4);
    const monthSched = f.scheduled * PER_MONTH;
    const scale = monthSched / rows.length; // network appointments per month represented by one extract row
    const predBase = rows.reduce((t, r) => t + r.p, 0) / rows.length;
    const kCal = f.noShowRate / predBase; // align model probabilities to the funnel's no-show rate
    const realize = f.completed ? f.billed / f.completed : 0.93;
    const revPerCompleted = f.completed ? f.revenue / f.completed : 240;
    const perMin = s.loaded / 60;
    const pE = f.noShowRate; // a standby / overbooked member drawn from the general pool
    const cS = M.confirmSms, cC = M.confirmCall;
    const cr = s.credit / 100; // share of the modelled (observational) effect we bank until the holdout proves it

    const sum = { p0: 0, p1: 0, p2: 0, p3: 0, r1: 0, r2: 0, r3: 0 };
    let smsN = 0, callN = 0, offerN = 0, highN = 0, obFill = 0, obCol = 0;
    const tier = { Low: { n: 0, b: 0, s: 0 }, Medium: { n: 0, b: 0, s: 0 }, High: { n: 0, b: 0, s: 0 } };

    rows.forEach((r) => {
      const a = r.a;
      const rev = (OPS.q.plan(a.plan) || {}).revenuePerVisit || 0;
      let st = [{ w: 1, rem: a.reminder, conf: a.confirmed, lead: a.leadDays }];
      const p0 = r.p;
      if (s.sms && r.tier !== "Low" && !a.confirmed && (a.reminder === "None" || a.reminder === "SMS one-way")) {
        st = [{ w: cS, rem: "SMS two-way", conf: 1, lead: a.leadDays }, { w: 1 - cS, rem: "SMS two-way", conf: 0, lead: a.leadDays }];
        smsN += 1;
      }
      const p1 = st.length > 1 ? probOf(r, st) : p0;
      if (s.call && r.tier === "High") {
        const next = [];
        st.forEach((x) => {
          if (x.conf) { next.push(x); return; }
          callN += x.w;
          next.push({ w: x.w * cC, rem: "Live call", conf: 1, lead: x.lead }, { w: x.w * (1 - cC), rem: "Live call", conf: 0, lead: x.lead });
        });
        st = next;
      }
      const p2 = s.call && r.tier === "High" ? probOf(r, st) : p1;
      let p3 = p2;
      if (s.lead && r.tier === "High" && a.leadDays > s.leadCap) {
        offerN += 1;
        const next = [];
        st.forEach((x) => {
          next.push({ w: x.w * ASSUME.acceptEarlier, rem: x.rem, conf: x.conf, lead: s.leadCap });
          next.push({ w: x.w * (1 - ASSUME.acceptEarlier), rem: x.rem, conf: x.conf, lead: x.lead });
        });
        p3 = probOf(r, next);
      }
      sum.p0 += p0; sum.p1 += p1; sum.p2 += p2; sum.p3 += p3;
      sum.r1 += (p0 - p1) * rev; sum.r2 += (p1 - p2) * rev; sum.r3 += (p2 - p3) * rev;
      tier[r.tier].n++; tier[r.tier].b += p0; tier[r.tier].s += p3;
      if (r.tier === "High") {
        highN++;
        if (s.overbook) {
          const q = s.overPct / 100;
          const po = Math.min(0.95, (p0 - (p0 - p3) * cr) * kCal);
          obFill += q * po * (1 - pE);
          obCol += q * (1 - po) * (1 - pE);
        }
      }
    });

    const k = kCal * scale * cr;
    const prevented = (d) => d * k; // no-shows prevented per month
    const lever = (key, label, on, visits, revenue, cost, detail) => ({ key, label, on, visits, revenue, cost, net: revenue - cost, detail });
    const smsVisits = prevented(sum.p0 - sum.p1) * M.rConv;
    const callVisits = prevented(sum.p1 - sum.p2) * M.rConv;
    const leadVisits = prevented(sum.p2 - sum.p3) * M.rConv;
    const obVisits = obFill * scale * f.completionRate;
    const obCollisions = obCol * scale;
    const fills = s.backfill ? f.cancels * PER_MONTH * (s.fill / 100) : 0;
    const bfVisits = fills * (1 - pE) * f.completionRate;
    const monthNet = fNet.scheduled * PER_MONTH;
    const fixed = s.sms || s.call || s.lead ? ASSUME.fixedMonthly * (monthSched / monthNet) : 0;

    const levers = [
      lever("sms", "Two-way SMS confirmation (Medium + High)", s.sms, smsVisits, sum.r1 * k * M.rConv * realize, smsN * scale * s.smsCost, F.num(smsN * scale) + " members texted / mo"),
      lever("call", "Live confirmation call (High)", s.call, callVisits, sum.r2 * k * M.rConv * realize, callN * scale * s.callMin * perMin, F.num(callN * scale) + " calls / mo"),
      lever("lead", "Earlier slot, lead time capped at " + s.leadCap + " days (High)", s.lead, leadVisits, sum.r3 * k * M.rConv * realize, offerN * scale * ASSUME.reofferMin * perMin, F.num(offerN * scale) + " offers / mo"),
      lever("overbook", "Overbook " + s.overPct + "% of High-tier slots", s.overbook, obVisits, obVisits * revPerCompleted, obCollisions * ASSUME.collisionCost, F.num(obCollisions) + " double-booked / mo"),
      lever("backfill", "Same-day backfill list (" + s.fill + "% fill)", s.backfill, bfVisits, bfVisits * revPerCompleted, fills * (ASSUME.backfillMin * perMin + ASSUME.backfillText), F.num(fills) + " slots refilled / mo"),
      lever("fixed", "SMS platform and model monitoring (fixed)", fixed > 0, 0, 0, fixed, "prorated to scope"),
    ];
    const tot = levers.reduce((t, l) => ({ visits: t.visits + l.visits, revenue: t.revenue + l.revenue, cost: t.cost + l.cost }), { visits: 0, revenue: 0, cost: 0 });
    const tierRates = ["Low", "Medium", "High"].map((t) => {
      const b = tier[t].b / (tier[t].n || 1), sc = tier[t].s / (tier[t].n || 1);
      return { tier: t, base: Math.min(1, b * kCal), scn: Math.min(1, (b - (b - sc) * cr) * kCal) };
    });
    return {
      f, monthSched, kCal, scale, cr, baseRate: f.noShowRate, projRate: f.noShowRate * (1 - (1 - sum.p3 / sum.p0) * cr),
      levers, visits: tot.visits, revenue: tot.revenue, cost: tot.cost, net: tot.revenue - tot.cost,
      obVisits, obCollisions, highMonthly: highN * scale, tierRates, realize, revPerCompleted, pE,
      prevented: prevented(sum.p0 - sum.p3),
    };
  }

  // ---------- charts ----------
  let charts = [];
  const track = (c) => { if (c) charts.push(c); return c; };
  function killCharts() { charts.forEach((c) => { try { c.destroy(); } catch (e) { /* already gone */ } }); charts = []; }

  /** vertical (indexAxis y) or horizontal reference line at the overall rate */
  function refLine(value, label, vertical) {
    return {
      id: "schRef",
      afterDatasetsDraw(chart) {
        const area = chart.chartArea;
        const scale = vertical ? chart.scales.x : chart.scales.y;
        if (!area || !scale) return;
        const c = chart.ctx;
        const pos = scale.getPixelForValue(value);
        c.save();
        c.strokeStyle = UI.cssVar("--ink-3");
        c.lineWidth = 1.5;
        c.setLineDash([4, 3]);
        c.beginPath();
        if (vertical) { c.moveTo(pos, area.top); c.lineTo(pos, area.bottom); } else { c.moveTo(area.left, pos); c.lineTo(area.right, pos); }
        c.stroke();
        c.setLineDash([]);
        c.font = "500 11px " + (UI.cssVar("--font-body") || "sans-serif");
        const tw = c.measureText(label).width;
        let tx = vertical ? pos - tw / 2 : area.right - tw;
        tx = Math.max(area.left, Math.min(area.right - tw, tx));
        const ty = vertical ? area.top - 14 : pos - 15;
        c.fillStyle = UI.cssVar("--chart-surface");
        c.fillRect(tx - 3, ty, tw + 6, 13);
        c.fillStyle = UI.cssVar("--ink-2");
        c.textBaseline = "top";
        c.fillText(label, tx, ty + 1);
        c.restore();
      },
    };
  }

  // ---------- state ----------
  let state = { scope: "all", rank: "excess", s: Object.assign({}, DEFAULTS), allCoefs: false, preset: "recommended" };
  let simChart = null;
  let rafId = 0;

  // ---------- CSS ----------
  const CSS = `
  .sch-scope { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; justify-content: space-between; }
  .sch-scope .seg { max-width: 100%; }
  .sch-src { font-size: var(--fs-xs); color: var(--ink-3); max-width: 90ch; }
  .sch-multiples { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); }
  .sch-mini { border: 1px solid var(--line); border-radius: var(--r-md); padding: 10px 12px 8px; display: flex; flex-direction: column; gap: 4px; min-width: 0; background: var(--surface); }
  .sch-mini h4 { font-size: var(--fs-sm); font-weight: 600; }
  .sch-mini .chart-box { height: 168px; }
  .sch-mini-foot { font-size: var(--fs-xs); color: var(--ink-3); }
  .sch-findings { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .sch-finding { border-left: 3px solid var(--accent); padding: 4px 0 4px 12px; font-size: var(--fs-sm); color: var(--ink-2); min-width: 0; }
  .sch-finding strong { color: var(--ink); display: block; font-size: var(--fs-md); }
  .sch-stats { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
  .sch-stat { background: var(--surface-2); border-radius: var(--r-md); padding: 10px 12px; min-width: 0; }
  .sch-stat b { display: block; font-family: var(--font-display); font-size: var(--fs-xl); font-weight: 650; font-variant-numeric: tabular-nums; }
  .sch-stat span { font-size: var(--fs-xs); color: var(--ink-3); }
  .sch-coef { display: flex; flex-direction: column; gap: 7px; }
  .sch-coef-row { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(80px, 1fr) 4.6rem; gap: 10px; align-items: center; font-size: var(--fs-sm); }
  .sch-coef-label { min-width: 0; line-height: 1.3; }
  .sch-coef-label small { display: block; font-size: var(--fs-xs); color: var(--ink-3); }
  .sch-coef-track { position: relative; height: 12px; background: var(--surface-2); border-radius: 3px; }
  .sch-coef-track::before { content: ""; position: absolute; left: 50%; top: -4px; bottom: -4px; width: 1px; background: var(--line-strong); }
  .sch-coef-track i { position: absolute; top: 0; bottom: 0; border-radius: 3px; }
  .sch-coef-track i.pos { background: var(--series-2); }
  .sch-coef-track i.neg { background: var(--series-1); }
  .sch-coef-val { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--ink-2); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sch-coef-axis { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(80px, 1fr) 4.6rem; gap: 10px; font-size: var(--fs-xs); color: var(--ink-3); }
  .sch-coef-axis span:nth-child(2) { display: flex; justify-content: space-between; gap: 6px; }
  .sch-card { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); gap: 4px 12px; margin: 0; font-size: var(--fs-sm); }
  .sch-card dt { color: var(--ink-3); }
  .sch-card dd { margin: 0; color: var(--ink-2); min-width: 0; }
  .sch-tiers { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .sch-tier { border: 1px solid var(--line); border-top-width: 3px; border-radius: var(--r-md); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; min-width: 0; background: var(--surface); }
  .sch-tier.t-low { border-top-color: var(--good); }
  .sch-tier.t-medium { border-top-color: var(--warning); }
  .sch-tier.t-high { border-top-color: var(--critical); }
  .sch-tier dl { display: grid; grid-template-columns: auto auto; gap: 2px 10px; margin: 0; font-size: var(--fs-sm); }
  .sch-tier dt { color: var(--ink-3); }
  .sch-tier dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .sch-tier ul { margin: 0; padding-left: 18px; font-size: var(--fs-sm); color: var(--ink-2); display: flex; flex-direction: column; gap: 4px; }
  .sch-sim-panel { border-color: var(--accent-line); }
  .sch-sim { display: grid; grid-template-columns: minmax(0, 350px) minmax(0, 1fr); gap: 18px; align-items: start; }
  .sch-levers { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .sch-lever { border: 1px solid var(--line); border-radius: var(--r-md); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: var(--surface); min-width: 0; }
  .sch-lever.is-on { border-color: var(--accent-line); box-shadow: inset 3px 0 0 var(--accent); }
  .sch-lever-head { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; min-width: 0; }
  .sch-lever-head input { margin: 3px 0 0; width: 16px; height: 16px; flex: none; }
  .sch-lever-head > span { min-width: 0; }
  .sch-lever-head strong { display: block; font-size: var(--fs-sm); line-height: 1.35; }
  .sch-lever-head small { display: block; font-size: var(--fs-xs); color: var(--ink-3); line-height: 1.4; }
  .sch-lever:not(.is-on) .sch-lever-body { opacity: 0.5; }
  .sch-lever-body { display: flex; flex-direction: column; gap: 8px; }
  .sch-results { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .sch-tiles { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
  .sch-levtable td:first-child { min-width: 190px; }
  .sch-lift td:first-child { min-width: 160px; }
  .sch-tiles .kpi-value { font-size: 1.6rem; }
  .sch-tile-net.is-pos { border-color: var(--good); box-shadow: inset 0 3px 0 var(--good); }
  .sch-tile-net.is-neg { border-color: var(--critical); box-shadow: inset 0 3px 0 var(--critical); }
  .sch-off td { color: var(--ink-3); }
  .sch-assume { font-size: var(--fs-sm); color: var(--ink-2); }
  .sch-assume summary { cursor: pointer; font-weight: 600; color: var(--ink); }
  .sch-assume ul { margin: 8px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; }
  .sch-play { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .sch-guard { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sch-guard ul { margin: 0; padding-left: 18px; font-size: var(--fs-sm); color: var(--ink-2); display: flex; flex-direction: column; gap: 4px; }
  @media (max-width: 1100px) {
    .sch-sim { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 900px) {
    .sch-tiers, .sch-play, .sch-guard { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 560px) {
    .sch-coef-row, .sch-coef-axis { grid-template-columns: minmax(0, 1fr) minmax(70px, 0.8fr) 3.9rem; gap: 8px; }
    .sch-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .sch-tiles .kpi { padding: 12px; }
    .sch-tiles .kpi-value { font-size: 1.3rem; }
  }`;

  // ---------- rendering ----------
  function scopeLabel(scope) { return scope === "all" ? "All markets" : OPS.q.marketName(scope); }

  function kpiRow(D) {
    const f = D.funnel;
    return `<div class="grid g-6">
      ${UI.kpi({ label: "No-show rate", value: F.pct(D.rate), foot: "Extract · " + F.num(D.n) + " appts" })}
      ${UI.kpi({ label: "Completed share", value: F.pct(D.done), foot: "Rest cancel or reschedule" })}
      ${UI.kpi({ label: "Avg lead time", value: F.dec(D.lead, 1), unit: "days", foot: "Booking to visit date" })}
      ${UI.kpi({ label: "Confirmed before visit", value: F.pct(D.conf, 0), foot: "Two-way SMS or live call" })}
      ${UI.kpi({ label: "Visits lost to no-shows", value: F.num(D.monthNoShows), unit: "/ mo", foot: "Funnel · " + F.pct(f.noShowRate) + " of scheduled" })}
      ${UI.kpi({ label: "Revenue at risk", value: F.moneyK(D.atRisk), unit: "/ mo", foot: "Plan rates, after chart QA" })}
    </div>
    <p class="sch-src">Rates and drivers come from the 12-week appointment extract (W15–W26, ${F.num(D.n)} appointments${state.scope === "all" ? "" : " in " + UI.esc(scopeLabel(state.scope))}). Volumes and dollars are sized to the network funnel, the system of record: ${F.num(D.monthSched)} scheduled visits a month over the last 4 weeks.</p>`;
  }

  function driversPanel(D) {
    const multiples = DIMS.filter((d) => d.multiple);
    const groups = multiples.map((dim) => groupRate(dim.key === "market" ? OPS.data.appointments : D.list, dim));
    const lead = groups[0];
    const rem = groups[1];
    const g = (arr, k) => arr.find((x) => x.key === k) || { rate: 0, n: 0 };
    const shortLead = (g(lead, "1–3").ns + g(lead, "4–7").ns + g(lead, "8–14").ns) / Math.max(1, g(lead, "1–3").n + g(lead, "4–7").n + g(lead, "8–14").n);
    const conf = groups[2];
    const prior = groups[3];
    return `<div class="panel">
      <div class="panel-head"><div><h2>What drives no-shows</h2><p class="panel-sub">No-show rate by segment, ${UI.esc(scopeLabel(state.scope))}. Dashed line = overall rate (${F.pct(D.rate)}). Same scale on every chart so bar lengths compare.</p></div></div>
      <div class="sch-findings">
        <div class="sch-finding"><strong>${F.pct(g(lead, "22+").rate, 0)} at 22+ days lead</strong>vs ${F.pct(shortLead, 0)} when the visit is booked within 2 weeks. Lead time is the lever scheduling controls directly.</div>
        <div class="sch-finding"><strong>${F.pct(g(rem, "None").rate, 0)} with no reminder</strong>vs ${F.pct(g(rem, "SMS two-way").rate, 0)} with two-way SMS. ${F.pct(g(rem, "None").n / D.n + g(rem, "SMS one-way").n / D.n, 0)} of appointments still get none or one-way only.</div>
        <div class="sch-finding"><strong>${F.pct(g(conf, "Not confirmed").rate, 0)} unconfirmed vs ${F.pct(g(conf, "Confirmed").rate, 0)} confirmed</strong>A confirmation step is the cheapest signal we can create before the visit.</div>
        <div class="sch-finding"><strong>${F.pct(g(prior, "Prior no-show").rate, 0)} with a prior no-show</strong>${F.pct(g(prior, "Prior no-show").n / D.n, 0)} of volume. These members need a live confirmation call from a person.</div>
      </div>
      <div class="sch-multiples">
        ${multiples.map((dim, i) => `<div class="sch-mini"><h4>${UI.esc(dim.label)}</h4><div class="chart-box"><canvas id="sch-m-${dim.key}" role="img" aria-label="No-show rate by ${UI.esc(dim.label.toLowerCase())}"></canvas></div>${dim.key === "market" && state.scope !== "all" ? `<div class="sch-mini-foot">All markets shown; ${UI.esc(scopeLabel(state.scope))} highlighted.</div>` : ""}</div>`).join("")}
      </div>
      <div class="presenter-note">About ${F.pct(D.funnel.noShowRate, 0)} of scheduled visits no-show: roughly ${F.num(D.monthNoShows)} visits and ${F.moneyK(D.atRisk)} a month. Lead time is the biggest driver scheduling controls: booked more than three weeks out, ${F.pct(g(lead, "22+").rate, 0)} of members no-show, against ${F.pct(shortLead, 0)} inside two weeks. Reminders matter almost as much, and ${F.pct((g(rem, "None").n + g(rem, "SMS one-way").n) / D.n, 0)} of appointments still get no reminder or a one-way text. Those two facts shape the whole redesign.</div>
    </div>`;
  }

  function drawMultiples(D) {
    const multiples = DIMS.filter((d) => d.multiple);
    const all = multiples.map((dim) => groupRate(dim.key === "market" ? OPS.data.appointments : D.list, dim));
    const max = Math.max(0.1, Math.ceil(Math.max.apply(null, all.flat().map((x) => x.rate)) * 20) / 20);
    const c0 = UI.series(0);
    const overallAll = OPS.data.appointments.filter(isNS).length / OPS.data.appointments.length;
    multiples.forEach((dim, i) => {
      const data = all[i];
      const isMarket = dim.key === "market";
      const ref = isMarket ? overallAll : D.rate;
      const colors = data.map((x) => (isMarket && state.scope !== "all" && x.key !== OPS.q.marketName(state.scope) ? UI.alpha(c0, 0.35) : c0));
      track(UI.chart("sch-m-" + dim.key, {
        type: "bar",
        data: { labels: data.map((x) => x.key), datasets: [{ label: "No-show rate", data: data.map((x) => x.rate), backgroundColor: colors, maxBarThickness: 18, borderRadius: 4 }] },
        options: {
          indexAxis: "y",
          layout: { padding: { top: 16, right: 6 } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => " " + F.pct(c.raw) + " no-show · n=" + F.num(data[c.dataIndex].n) } } },
          scales: { x: { min: 0, max, ticks: { callback: UI.pctTick, maxTicksLimit: 5 } }, y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } } },
        },
        plugins: [refLine(ref, (isMarket ? "network " : "avg ") + F.pct(ref, 0), true)],
      }));
    });
  }

  function liftPanel(D) {
    const rows = liftRows(D, D.rate).sort((a, b) => (state.rank === "lift" ? b.lift - a.lift : b.excess - a.excess)).slice(0, 10);
    const perMonth = D.n ? (D.monthSched / D.n) * (D.funnel.noShowRate / (D.rate || 1)) : 0;
    const table = UI.table([
      { key: "seg", label: "Segment", fmt: (v, r) => `<strong>${UI.esc(v)}</strong><div class="xs muted">${UI.esc(r.dim)}</div>` },
      { key: "rate", label: "No-show in segment", num: true, fmt: (v) => F.pct(v) },
      { key: "rest", label: "Everyone else", num: true, fmt: (v) => F.pct(v) },
      { key: "lift", label: "Lift", num: true, fmt: (v) => "×" + F.dec(v, 2) },
      { key: "share", label: "Share of volume", num: true, fmt: (v) => F.pct(v, 0) },
      { key: "excess", label: "Excess no-shows / mo", num: true, fmt: (v) => F.num(Math.max(0, v * perMonth)) },
      { key: "lever", label: "Lever", fmt: (v) => UI.tag(v) },
    ], rows);
    return `<div class="panel">
      <div class="panel-head"><div><h2>Driver lift, ranked</h2><p class="panel-sub">Segments whose no-show rate beats the rest of the book. Excess no-shows = segment volume × (segment rate − overall), sized to network monthly volume.</p></div>
        <div class="row"><span class="label">Rank by</span>${UI.seg("sch-rank", [{ value: "excess", label: "Excess no-shows" }, { value: "lift", label: "Lift" }], state.rank)}</div></div>
      <div class="sch-lift">${table}</div>
    </div>`;
  }

  function modelPanel() {
    const M = getModel();
    const coefs = FEATURES.map((f, j) => ({ f, std: M.w[j], odds: Math.exp(M.rawW[j] * (f.unit || 1)) }))
      .sort((a, b) => b.std - a.std);
    const maxAbs = Math.max.apply(null, coefs.map((c) => Math.abs(c.std))) || 1;
    const shown = state.allCoefs ? coefs : coefs.filter((c) => Math.abs(c.std) >= 0.05);
    const high = M.tiers[2];
    const coefRows = shown.map((c) => {
      const wPct = (Math.abs(c.std) / maxAbs) * 50;
      const pos = c.std >= 0;
      return `<div class="sch-coef-row" role="listitem">
        <span class="sch-coef-label">${UI.esc(c.f.label)}${c.f.ref ? `<small>${UI.esc(c.f.ref)}</small>` : ""}</span>
        <span class="sch-coef-track" aria-hidden="true"><i class="${pos ? "pos" : "neg"}" style="${pos ? "left:50%" : "left:" + (50 - wPct).toFixed(2) + "%"};width:${Math.max(0.6, wPct).toFixed(2)}%"></i></span>
        <span class="sch-coef-val" title="Odds multiplier">×${F.dec(c.odds, 2)}</span>
      </div>`;
    }).join("");
    return `<div class="panel">
      <div class="panel-head"><div><h2>No-show risk model</h2><p class="panel-sub">Logistic regression fitted in this browser on W15–W22 (${F.num(M.train.length)} appointments), tested on W23–W26 (${F.num(M.test.length)}). ${FEATURES.length} standardized inputs, batch gradient descent from zero weights, so every run gives the same answer.</p></div>${UI.pill("accent", "Fitted in " + F.num(Math.max(1, M.fitMs)) + " ms · " + M.iterations + " iterations")}</div>
      <div class="sch-stats">
        <div class="sch-stat"><b>${F.dec(M.aucTest, 2)}</b><span>Test AUC on weeks the model never saw (train ${F.dec(M.aucTrain, 2)})</span></div>
        <div class="sch-stat"><b>${F.pct(high.capture, 0)}</b><span>of test-week no-shows fall in the High tier, ${F.pct(high.share, 0)} of volume</span></div>
        <div class="sch-stat"><b>${F.pct(high.act, 0)} vs ${F.pct(M.tiers[0].act, 0)}</b><span>Actual no-show rate, High vs Low tier (test weeks)</span></div>
      </div>
      <div class="grid g-2">
        <div class="stack">
          <h3 class="small" style="font-size:var(--fs-md)">What raises risk</h3>
          <div class="legend"><span><i style="background:var(--series-2)"></i>Raises no-show risk</span><span><i style="background:var(--series-1)"></i>Lowers risk</span><span>Bar = standardized effect · label = odds multiplier</span></div>
          <div class="sch-coef" role="list" aria-label="Model coefficients sorted by effect">
            <div class="sch-coef-axis" aria-hidden="true"><span></span><span><span>← lowers</span><span>raises →</span></span><span></span></div>
            ${coefRows}
          </div>
          <div><button type="button" class="btn ghost sm" data-act="coefs">${state.allCoefs ? "Show the main drivers only" : "Show all " + FEATURES.length + " inputs"}</button></div>
        </div>
        <div class="stack">
          <h3 class="small" style="font-size:var(--fs-md)">Calibration, test weeks</h3>
          <p class="xs muted">Appointments sorted into 10 equal groups by predicted risk. When the lines track, a "20% risk" really means about 1 in 5.</p>
          <div class="chart-box"><canvas id="sch-calib" role="img" aria-label="Predicted versus actual no-show rate by risk decile"></canvas></div>
          <div class="panel inset" style="padding:12px 14px;gap:8px">
            <h3 style="font-size:var(--fs-md)">Model card</h3>
            <dl class="sch-card">
              <dt>Predicts</dt><dd>No-show vs any other outcome, per booked appointment</dd>
              <dt>Inputs</dt><dd>${FEATURES.length} scheduling fields. No free text, no diagnosis codes, no member identifiers</dd>
              <dt>Validation</dt><dd>Out-of-time: trained on W15–W22, scored on W23–W26</dd>
              <dt>Allowed use</dt><dd>Decides who gets extra outreach. Never used to deny, delay or deprioritize a visit</dd>
              <dt>Monitoring</dt><dd>Weekly tier rates and calibration; refit monthly or if AUC drops below 0.65</dd>
            </dl>
          </div>
        </div>
      </div>
      <div class="sch-tiers">
        ${M.tiers.map((t) => {
          const lvl = t.tier === "Low" ? "good" : t.tier === "Medium" ? "warning" : "critical";
          const rule = t.tier === "Low" ? "risk < " + F.pct(M.q50) : t.tier === "Medium" ? F.pct(M.q50) + " – " + F.pct(M.q80) : "risk ≥ " + F.pct(M.q80);
          return `<div class="sch-tier t-${t.tier.toLowerCase()}">
            <div class="row between">${UI.pill(lvl, t.tier + " risk")}<span class="xs muted">${UI.esc(rule)}</span></div>
            <dl><dt>Share of volume</dt><dd>${F.pct(t.share, 0)}</dd><dt>Predicted no-show</dt><dd>${F.pct(t.pred)}</dd><dt>Actual no-show</dt><dd>${F.pct(t.act)}</dd><dt>Share of all no-shows</dt><dd>${F.pct(t.capture, 0)}</dd></dl>
          </div>`;
        }).join("")}
      </div>
      <div class="presenter-note">This is deliberately a model a scheduling lead can read: every bar is a reason, and none of it is a black box. An AUC around ${F.dec(M.aucTest, 2)} on weeks it never saw is good enough to decide who gets extra outreach. It is never used to deny or delay anyone's visit.</div>
    </div>`;
  }

  function drawCalibration() {
    const M = getModel();
    track(UI.chart("sch-calib", {
      type: "line",
      data: {
        labels: M.calib.map((_, i) => "D" + (i + 1)),
        datasets: [
          { label: "Predicted", data: M.calib.map((c) => c.pred), borderColor: UI.series(0), backgroundColor: UI.series(0), pointRadius: 3 },
          { label: "Actual", data: M.calib.map((c) => c.act), borderColor: UI.series(1), backgroundColor: UI.series(1), pointRadius: 3 },
        ],
      },
      options: {
        elements: { line: { tension: 0 } },
        plugins: { tooltip: { callbacks: { title: (it) => "Risk decile " + it[0].label + " (n=" + M.calib[it[0].dataIndex].n + ")", label: (c) => " " + c.dataset.label + ": " + F.pct(c.raw) } } },
        scales: { y: { min: 0, ticks: { callback: UI.pctTick, maxTicksLimit: 6 } }, x: { grid: { display: false }, title: { display: true, text: "Predicted risk decile (low → high)" } } },
      },
    }));
  }

  function rangeHtml(id, label, min, max, step, value, display) {
    return UI.range({ id, label, min, max, step, value, display });
  }

  function leverBlock(key, title, sub, body) {
    const on = !!state.s[key];
    return `<div class="sch-lever${on ? " is-on" : ""}" data-lever="${key}" role="group" aria-labelledby="sch-${key}-title">
      <label class="sch-lever-head" for="sch-${key}"><input type="checkbox" id="sch-${key}" data-toggle="${key}"${on ? " checked" : ""}><span><strong id="sch-${key}-title">${UI.esc(title)}</strong><small>${sub}</small></span></label>
      ${body ? `<div class="sch-lever-body">${body}</div>` : ""}
    </div>`;
  }

  function simPanel() {
    const M = getModel();
    const s = state.s;
    return `<div class="panel sch-sim-panel">
      <div class="panel-head"><div><h2>Intervention simulator</h2><p class="panel-sub">Turns on workflow changes, re-scores every appointment in the extract with the fitted model, and sizes the change to ${state.scope === "all" ? "network" : UI.esc(scopeLabel(state.scope))} monthly volume. Costs and double-bookings count against the gain.</p></div>
        ${UI.seg("sch-preset", [{ value: "recommended", label: "Recommended" }, { value: "confirm", label: "Texts only" }, { value: "all", label: "Everything on" }, { value: "off", label: "All off" }], state.preset)}</div>
      <div class="sch-sim">
        <div class="panel inset sch-levers" style="padding:12px">
          ${leverBlock("sms", "Two-way SMS confirmation", "Medium + High tiers not already confirmed · " + F.pct(M.confirmSms, 0) + " reply to confirm in the extract", rangeHtml("sch-smsCost", "Cost per member texted", 0.1, 2, 0.05, s.smsCost, "$" + F.dec(s.smsCost, 2)))}
          ${leverBlock("call", "Live confirmation call", "High tier, only if still unconfirmed · " + F.pct(M.confirmCall, 0) + " confirm on a live call", rangeHtml("sch-callMin", "Agent minutes per call", 2, 10, 1, s.callMin, s.callMin + " min"))}
          ${leverBlock("lead", "Offer an earlier slot", "High tier booked past the cap · assumes " + F.pct(ASSUME.acceptEarlier, 0) + " accept; needs open near-term slots", rangeHtml("sch-leadCap", "Cap lead time at", 5, 21, 1, s.leadCap, s.leadCap + " days"))}
          ${leverBlock("overbook", "Overbook High-tier slots", "Adds a second booking to a share of High-tier slots; both may show", rangeHtml("sch-overPct", "Share of High-tier slots overbooked", 5, 30, 5, s.overPct, s.overPct + "%"))}
          ${leverBlock("backfill", "Same-day backfill list", "Opt-in standby members by zip get a first-come text when a slot cancels", rangeHtml("sch-fill", "Cancelled slots refilled", 5, 80, 5, s.fill, s.fill + "%"))}
          <div class="sch-lever is-on"><div class="sch-lever-body">
            ${rangeHtml("sch-credit", "Share of the modelled effect we bank", 25, 100, 5, s.credit, s.credit + "%")}
            <p class="xs muted" style="margin-top:-2px">The model learns from history, and members who plan to show are the ones who confirm. Bank part of the effect until the holdout proves the rest.</p>
            ${rangeHtml("sch-loaded", "Loaded agent cost per hour (calls, offers, backfill)", 20, 45, 1, s.loaded, "$" + s.loaded)}
          </div></div>
        </div>
        <div class="sch-results" id="sch-results" aria-live="polite"></div>
      </div>
      <div class="presenter-note">Turn on overbooking and watch the double-bookings column: once confirmations are running, the High tier shows up more often, so overbooking mostly creates collisions. That is why I would pilot confirmation and backfill first, with a 10% holdout to prove the lift, and keep overbooking off.</div>
    </div>`;
  }

  function resultsHtml(R) {
    const M = getModel();
    const net = R.net;
    const roi = R.cost > 0 ? R.revenue / R.cost : 0;
    const colPill = R.obCollisions <= 0 ? "" : R.obCollisions > 2 * R.obVisits ? UI.pill("critical", "More collisions than visits") : R.obCollisions > R.obVisits ? UI.pill("warning", "Collisions exceed visits") : UI.pill("good", "Within tolerance");
    const rowsHtml = R.levers.map((l) => `<tr class="${l.on ? "" : "sch-off"}">
        <td><strong>${UI.esc(l.label)}</strong><div class="xs muted">${l.on ? UI.esc(l.detail) : "Off"}</div></td>
        <td class="num">${l.on && l.key !== "fixed" ? "+" + visitsFmt(l.visits) : "—"}</td>
        <td class="num">${l.on && l.key !== "fixed" ? money0(l.revenue) : "—"}</td>
        <td class="num">${l.on ? money0(l.cost) : "—"}</td>
        <td class="num">${l.on ? money0(l.net) : "—"}</td>
        <td class="num">${l.on && l.visits > 0.5 ? F.money(l.cost / l.visits) : "—"}</td>
      </tr>`).join("");
    return `<div class="sch-tiles">
        ${UI.kpi({ label: "Projected no-show rate", value: F.pct(R.projRate), delta: R.projRate - R.baseRate, deltaLabel: F.pts(R.projRate - R.baseRate), goodWhen: "down", foot: "from " + F.pct(R.baseRate) })}
        ${UI.kpi({ label: "Extra completed visits", value: "+" + visitsFmt(R.visits), unit: "/ mo", foot: F.num(R.prevented) + " no-shows prevented" })}
        ${UI.kpi({ label: "Revenue gained", value: money0(R.revenue), unit: "/ mo", foot: "after chart QA (" + F.pct(R.realize, 0) + " bill)" })}
        ${UI.kpi({ label: "Program cost", value: money0(R.cost), unit: "/ mo", foot: R.visits > 0.5 ? F.money(R.cost / R.visits) + " per added visit" : "no levers on" })}
        <div class="kpi sch-tile-net ${net >= 0 ? "is-pos" : "is-neg"}"><div class="kpi-label">Net monthly impact</div><div class="kpi-value">${UI.esc(money0(net))}<small>/ mo</small></div><div class="kpi-foot">${net >= 0 ? UI.pill("good", "Net positive") : UI.pill("critical", "Net negative")}<span>${roi ? "ROI " + F.dec(roi, 1) + "× · " + money0(net * 12) + " / yr" : ""}</span></div></div>
        <div class="kpi"><div class="kpi-label">Double-booked slots</div><div class="kpi-value">${F.num(R.obCollisions)}<small>/ mo</small></div><div class="kpi-foot">${colPill || UI.pill("neutral", "Overbooking off")}<span>${R.obCollisions > 0 ? "vs +" + visitsFmt(R.obVisits) + " visits from overbooking" : ""}</span></div></div>
      </div>
      <div class="stack" style="gap:6px">
        <h3 style="font-size:var(--fs-md)">No-show rate by risk tier: today vs scenario</h3>
        <div class="chart-box sm"><canvas id="sch-simchart" role="img" aria-label="No-show rate by risk tier, today versus scenario"></canvas></div>
      </div>
      <div class="table-wrap"><table class="data sch-levtable">
        <thead><tr><th>Lever</th><th class="num">Visits / mo</th><th class="num">Revenue / mo</th><th class="num">Cost / mo</th><th class="num">Net / mo</th><th class="num">Cost per visit</th></tr></thead>
        <tbody>${rowsHtml}<tr><td><strong>Total</strong></td><td class="num"><strong>+${visitsFmt(R.visits)}</strong></td><td class="num"><strong>${money0(R.revenue)}</strong></td><td class="num"><strong>${money0(R.cost)}</strong></td><td class="num"><strong>${money0(R.net)}</strong></td><td class="num">${R.visits > 0.5 ? F.money(R.cost / R.visits) : "—"}</td></tr></tbody>
      </table></div>
      <details class="sch-assume"><summary>How the simulator counts</summary><ul>
        <li>Each appointment is re-scored with the fitted model after its reminder, confirmation and lead time change. Confirmation rates come from the extract: two-way SMS ${F.pct(M.confirmSms, 0)}, live call ${F.pct(M.confirmCall, 0)}.</li>
        <li>Reminder, call and earlier-slot effects are credited at ${F.pct(R.cr, 0)} of what the model estimates, because confirmation is partly self-selection. The holdout replaces this haircut with a measured lift.</li>
        <li>Model probabilities are scaled to the funnel's ${F.pct(R.baseRate)} no-show rate (factor ${F.dec(R.kCal, 2)}) so sizing matches the system of record.</li>
        <li>A prevented no-show becomes a completed visit ${F.pct(M.rConv, 0)} of the time (the rest cancel or reschedule ahead, which frees the slot). ${F.pct(R.realize, 0)} of completed visits pass chart QA and bill at the plan's rate.</li>
        <li>Overbooked and standby members show at the funnel rate (${F.pct(1 - R.pE, 0)}). A double-booking costs ${F.money(ASSUME.collisionCost)} in rebooking and service recovery, before any grievance risk with the plan.</li>
        <li>Labelled assumptions: ${F.pct(ASSUME.acceptEarlier, 0)} accept an earlier slot; ${ASSUME.reofferMin} min per offer; ${ASSUME.backfillMin} min plus ${F.money(ASSUME.backfillText)} in texts per refilled slot; ${F.money(ASSUME.fixedMonthly)} / mo network platform and monitoring.</li>
      </ul></details>`;
  }

  function drawSimChart(R) {
    const labels = R.tierRates.map((t) => t.tier + " tier");
    const base = R.tierRates.map((t) => t.base), scn = R.tierRates.map((t) => t.scn);
    if (simChart && simChart.canvas && simChart.canvas.isConnected) {
      simChart.data.datasets[0].data = base;
      simChart.data.datasets[1].data = scn;
      simChart.update("none");
      return;
    }
    simChart = track(UI.chart("sch-simchart", {
      type: "bar",
      data: { labels, datasets: [
        { label: "Today", data: base, backgroundColor: UI.series(0), maxBarThickness: 34 },
        { label: "Scenario", data: scn, backgroundColor: UI.series(2), maxBarThickness: 34 },
      ] },
      options: {
        plugins: { tooltip: { callbacks: { label: (c) => " " + c.dataset.label + ": " + F.pct(c.raw) } } },
        scales: { y: { min: 0, ticks: { callback: UI.pctTick, maxTicksLimit: 5 } }, x: { grid: { display: false } } },
      },
    }));
  }

  function updateSim(root) {
    const R = simulate(state.scope, state.s);
    state.lastR = R;
    const host = root.querySelector("#sch-results");
    if (!host) return;
    // keep the chart canvas alive across updates: rebuild only the text parts
    const existing = host.querySelector("#sch-simchart");
    if (existing && simChart) {
      const tmp = document.createElement("div");
      tmp.innerHTML = resultsHtml(R);
      const newTiles = tmp.querySelector(".sch-tiles"), newTable = tmp.querySelector(".table-wrap"), newAssume = tmp.querySelector(".sch-assume");
      host.querySelector(".sch-tiles").replaceWith(newTiles);
      host.querySelector(".table-wrap").replaceWith(newTable);
      const oldAssume = host.querySelector(".sch-assume");
      newAssume.open = oldAssume ? oldAssume.open : false;
      oldAssume.replaceWith(newAssume);
    } else {
      simChart = null;
      host.innerHTML = resultsHtml(R);
    }
    drawSimChart(R);
    const pb = root.querySelector("#sch-playbook-impact");
    if (pb) pb.innerHTML = playbookImpact(R);
  }

  function playbookImpact(R) {
    return `Current scenario for ${UI.esc(scopeLabel(state.scope))}: no-show rate ${F.pct(R.baseRate)} → ${F.pct(R.projRate)}, <strong>+${visitsFmt(R.visits)} completed visits</strong> and <strong>${money0(R.net)} net</strong> a month.`;
  }

  const PLAY = (M, s) => [
    { tier: "Low", lvl: "good", owner: "Automated · scheduling ops", items: [
      "One-way SMS reminder at 72 h and 24 h from a plan-approved template.",
      "No live touches: protect agent time for higher tiers.",
      "Offer opt-in to the same-day standby list for earlier visits.",
    ] },
    { tier: "Medium", lvl: "warning", owner: "Scheduling team lead", items: [
      "Two-way SMS at 72 h: reply C to confirm, R to reschedule.",
      "No reply by 24 h: second text with a reschedule link; mark the slot soft for the standby list.",
      "Reschedule replies reach the scheduler queue within 2 business hours.",
    ] },
    { tier: "High", lvl: "critical", owner: "Scheduling + outreach agents", items: [
      "Two-way SMS at 5 days; live confirmation call within 48 h if still unconfirmed.",
      "Booked more than " + s.leadCap + " days out: offer the earliest open slot.",
      "Barrier check on the call: ride (plan transportation benefit), caregiver present, language; route SDOH needs to care coordination.",
      "Prefer midday slots over 8–10am when the member is flexible. Overbooking stays off unless the scheduling lead approves it for a clinician-day with buffer.",
    ] },
  ];

  const GUARDS = [
    "The risk score adds support. It never removes access, delays a visit or lowers priority. Plan, age and language are used to measure risk and are excluded from any overbooking decision.",
    "Texts follow HIPAA minimum necessary: date, time and a callback number, with no diagnosis or visit purpose. TCPA consent on file; STOP honored within 24 h; Spanish templates for Spanish-preferred members.",
    "Weekly: no-show rate and calibration by tier. Refit monthly, or sooner if test AUC on the latest 4 weeks drops below 0.65.",
  ];
  const MEASURE = [
    "10% randomized holdout per tier for the first 8 weeks, so lift is measured against the same weeks.",
    "Scorecard: show rate by tier vs holdout, confirmation rate, cost per added visit, double-bookings, member complaints.",
    "Go / no-go at week 8 with the scheduling lead and plan account managers.",
  ];

  function playbookPanel() {
    const M = getModel();
    const plays = PLAY(M, state.s);
    return `<div class="panel">
      <div class="panel-head"><div><h2>Recommended playbook by tier</h2><p class="panel-sub">What schedulers do differently for each tier, who owns it, and how we will know it worked.</p></div>
        <div class="row"><button type="button" class="btn primary sm" data-act="copy-play">${UI.icon("copy")}Copy playbook (Markdown)</button><button type="button" class="btn sm" data-act="opp">${UI.icon("list")}Open OPP-01</button><button type="button" class="btn sm" data-act="roi">${UI.icon("dollar")}Model ROI</button></div></div>
      <div class="callout accent"><div id="sch-playbook-impact">${state.lastR ? playbookImpact(state.lastR) : ""}</div></div>
      <div class="sch-play">
        ${plays.map((p) => {
          const t = M.tiers.find((x) => x.tier === p.tier);
          return `<div class="sch-tier t-${p.tier.toLowerCase()}">
            <div class="row between">${UI.pill(p.lvl, p.tier + " risk")}<span class="xs muted">${F.pct(t.share, 0)} of volume · ${F.pct(t.act, 0)} no-show</span></div>
            <ul>${p.items.map((x) => `<li>${UI.esc(x)}</li>`).join("")}</ul>
            <div class="xs muted">Owner: ${UI.esc(p.owner)}</div>
          </div>`;
        }).join("")}
      </div>
      <div class="sch-guard">
        <div class="panel inset"><h3 style="font-size:var(--fs-md)">Guardrails</h3><ul>${GUARDS.map((x) => `<li>${UI.esc(x)}</li>`).join("")}</ul></div>
        <div class="panel inset"><h3 style="font-size:var(--fs-md)">Measurement</h3><ul>${MEASURE.map((x) => `<li>${UI.esc(x)}</li>`).join("")}</ul></div>
      </div>
      <div class="presenter-note">This is what I would hand the scheduling lead in week one: three tiers, one owner each, and a holdout so we can prove the lift to finance and to the health plans. The same model feeds OPP-01 in the pipeline and the ROI page.</div>
    </div>`;
  }

  function playbookMarkdown() {
    const M = getModel();
    const R = state.lastR || simulate(state.scope, state.s);
    const s = state.s;
    const lines = [];
    lines.push("# No-show reduction playbook: " + scopeLabel(state.scope));
    lines.push("");
    lines.push("Model: logistic regression on " + FEATURES.length + " scheduling inputs, trained W15–W22, tested W23–W26 (AUC " + F.dec(M.aucTest, 2) + ").");
    lines.push("Projected impact: no-show rate " + F.pct(R.baseRate) + " → " + F.pct(R.projRate) + "; +" + visitsFmt(R.visits) + " completed visits / mo; revenue " + money0(R.revenue) + " / mo; cost " + money0(R.cost) + " / mo; net " + money0(R.net) + " / mo.");
    lines.push("");
    PLAY(M, s).forEach((p) => {
      const t = M.tiers.find((x) => x.tier === p.tier);
      const rule = p.tier === "Low" ? "risk < " + F.pct(M.q50) : p.tier === "Medium" ? F.pct(M.q50) + " to " + F.pct(M.q80) : "risk ≥ " + F.pct(M.q80);
      lines.push("## " + p.tier + " risk (" + rule + ", " + F.pct(t.share, 0) + " of volume, " + F.pct(t.act, 0) + " no-show in test weeks)");
      lines.push("Owner: " + p.owner);
      p.items.forEach((x) => lines.push("- " + x));
      lines.push("");
    });
    lines.push("## Levers in this scenario");
    R.levers.filter((l) => l.on).forEach((l) => lines.push("- " + l.label + ": " + (l.key === "fixed" ? "" : "+" + visitsFmt(l.visits) + " visits, ") + "cost " + money0(l.cost) + ", net " + money0(l.net) + " / mo"));
    lines.push("");
    lines.push("## Guardrails");
    GUARDS.forEach((x) => lines.push("- " + x));
    lines.push("");
    lines.push("## Measurement");
    MEASURE.forEach((x) => lines.push("- " + x));
    lines.push("");
    lines.push("Linked opportunity: OPP-01 (risk-based reminders with two-way SMS confirmation). Synthetic data; no PHI.");
    return lines.join("\n");
  }

  function paint(root) {
    killCharts();
    simChart = null;
    const D = describe(state.scope);
    const body = root.querySelector("#sch-body");
    state.lastR = simulate(state.scope, state.s);
    body.innerHTML = `
      ${kpiRow(D)}
      ${driversPanel(D)}
      ${liftPanel(D)}
      ${modelPanel()}
      ${simPanel()}
      ${playbookPanel()}`;
    drawMultiples(D);
    drawCalibration();
    syncLeverClasses(root);
    updateSim(root);
  }

  function syncLeverClasses(root) {
    root.querySelectorAll(".sch-lever[data-lever]").forEach((el) => {
      const k = el.dataset.lever;
      el.classList.toggle("is-on", !!state.s[k]);
      el.querySelectorAll(".sch-lever-body input").forEach((inp) => (inp.disabled = !state.s[k]));
    });
  }

  function applyPreset(root, name) {
    state.s = Object.assign({}, PRESETS[name] || DEFAULTS);
    state.preset = name;
    ["sms", "call", "lead", "overbook", "backfill"].forEach((k) => { const el = root.querySelector("#sch-" + k); if (el) el.checked = !!state.s[k]; });
    const set = (id, v, disp) => { const el = root.querySelector("#" + id); if (el) { el.value = v; const o = root.querySelector("#" + id + "-out"); if (o) o.textContent = disp; } };
    set("sch-smsCost", state.s.smsCost, "$" + F.dec(state.s.smsCost, 2));
    set("sch-callMin", state.s.callMin, state.s.callMin + " min");
    set("sch-leadCap", state.s.leadCap, state.s.leadCap + " days");
    set("sch-overPct", state.s.overPct, state.s.overPct + "%");
    set("sch-fill", state.s.fill, state.s.fill + "%");
    set("sch-loaded", state.s.loaded, "$" + state.s.loaded);
    set("sch-credit", state.s.credit, state.s.credit + "%");
    syncLeverClasses(root);
    updateSim(root);
  }

  const RANGES = {
    "sch-smsCost": { key: "smsCost", disp: (v) => "$" + F.dec(v, 2) },
    "sch-callMin": { key: "callMin", disp: (v) => v + " min" },
    "sch-leadCap": { key: "leadCap", disp: (v) => v + " days" },
    "sch-overPct": { key: "overPct", disp: (v) => v + "%" },
    "sch-fill": { key: "fill", disp: (v) => v + "%" },
    "sch-loaded": { key: "loaded", disp: (v) => "$" + v },
    "sch-credit": { key: "credit", disp: (v) => v + "%" },
  };

  function clearPreset(root) {
    state.preset = "";
    const seg = root.querySelector("#sch-preset");
    if (seg) seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
  }

  function schedule(root) {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => updateSim(root));
  }

  OPS.register({
    id: ID,
    title: "No-Show & Scheduling Optimizer",
    stage: "build",
    order: 20,
    icon: "calendar",
    eyebrow: "4 · Build · Member scheduling",
    summary: "Find which appointments will no-show and why, then test reminder, confirmation and lead-time policies on real volume before changing the scheduling workflow.",
    jd: [
      "Redesign appointment scheduling workflows to improve visit completion",
      "Analyze operational data to uncover performance gaps",
      "Build AI-enabled workflows with validation and measurable outcomes",
    ],
    render(root, ctx) {
      UI.style(ID, CSS);
      const markets = OPS.data.markets;
      const p = (ctx && ctx.params) || {};
      if (p.market && markets.some((m) => m.id === p.market)) state.scope = p.market;
      else if (p.market === "all") state.scope = "all";
      const scopeOpts = [{ value: "all", label: "All markets" }].concat(markets.map((m) => ({ value: m.id, label: m.name })));
      root.innerHTML = `
        <div class="sch-scope">
          <div class="row"><span class="label">Scope</span>${UI.seg("sch-scope", scopeOpts, state.scope)}</div>
        </div>
        <div class="stack" id="sch-body" style="gap:22px"></div>`;
      getModel();
      paint(root);

      UI.wireSeg(root, "sch-scope", (v) => { state.scope = v; paint(root); });
      root.addEventListener("click", (e) => {
        const segBtn = e.target.closest("#sch-rank button[data-value]");
        if (segBtn) {
          state.rank = segBtn.dataset.value;
          const D = describe(state.scope);
          const tmp = document.createElement("div");
          tmp.innerHTML = liftPanel(D);
          const old = root.querySelector("#sch-rank").closest(".panel");
          old.replaceWith(tmp.firstElementChild);
          return;
        }
        const preset = e.target.closest("#sch-preset button[data-value]");
        if (preset) {
          root.querySelectorAll("#sch-preset button").forEach((b) => b.setAttribute("aria-pressed", String(b === preset)));
          applyPreset(root, preset.dataset.value);
          return;
        }
        const act = e.target.closest("[data-act]");
        if (!act) return;
        const a = act.dataset.act;
        if (a === "coefs") {
          state.allCoefs = !state.allCoefs;
          const old = act.closest(".panel");
          const tmp = document.createElement("div");
          tmp.innerHTML = modelPanel();
          const calibCanvas = old.querySelector("#sch-calib");
          charts = charts.filter((c) => { if (c.canvas === calibCanvas) { try { c.destroy(); } catch (err) { /* ignore */ } return false; } return true; });
          old.replaceWith(tmp.firstElementChild);
          drawCalibration();
          const btn = root.querySelector('[data-act="coefs"]');
          if (btn) btn.focus();
        } else if (a === "copy-play") {
          UI.copy(playbookMarkdown(), "Playbook copied as Markdown");
        } else if (a === "opp") {
          OPS.navigate("pipeline", { focus: "OPP-01" });
        } else if (a === "roi") {
          OPS.navigate("roi", { opp: "OPP-01" });
        }
      });
      root.addEventListener("change", (e) => {
        const t = e.target;
        if (t.dataset && t.dataset.toggle) {
          state.s[t.dataset.toggle] = t.checked;
          clearPreset(root);
          syncLeverClasses(root);
          schedule(root);
        }
      });
      root.addEventListener("input", (e) => {
        const t = e.target;
        const cfg = RANGES[t.id];
        if (!cfg) return;
        const v = parseFloat(t.value);
        state.s[cfg.key] = v;
        const o = root.querySelector("#" + t.id + "-out");
        if (o) o.textContent = cfg.disp(v);
        clearPreset(root);
        schedule(root);
      });
      syncLeverClasses(root);
    },
    destroy() {
      cancelAnimationFrame(rafId);
      killCharts();
      simChart = null;
    },
  });
})();
