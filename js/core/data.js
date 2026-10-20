/* Throughline — synthetic operating dataset.
 *
 * Everything here is generated, deterministic (seeded PRNG) and fictional. It models a
 * growing healthcare company that contracts with health plans to engage members and
 * deliver in-home / telehealth assessments and care-gap visits.
 *
 * Built-in "stories" the modules can discover (they are real in the data, not hard-coded text):
 *   1. Houston   — weak reached→scheduled conversion (bilingual scheduler coverage gap).
 *   2. Phoenix   — high no-show rate (long lead times, long drive distances).
 *   3. Tampa     — chart QA pass rate drops in the last 6 weeks (new clinicians onboarding).
 *   4. Network   — call-center AHT/ACW jump from week 14 (double entry after a scheduling
 *                  system change) and schedule conversion softens with it.
 *   5. Charlotte — clinicians near full utilization; long scheduling lead times.
 */
(function () {
  "use strict";
  const OPS = (window.OPS = window.OPS || {});

  // ---------- seeded PRNG ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(20261021);
  const between = (lo, hi) => lo + (hi - lo) * rand();
  const jitter = (v, pct) => v * (1 + (rand() * 2 - 1) * pct);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = Math.round;
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  // ---------- dimensions ----------
  const WEEKS = 26;
  const firstMonday = new Date(Date.UTC(2026, 3, 20)); // 2026-04-20
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const d = new Date(firstMonday.getTime() + i * 7 * 86400000);
    return { index: i, label: "W" + (i + 1), start: d.toISOString().slice(0, 10) };
  });

  const plans = [
    { id: "alpha", name: "Plan Alpha", line: "Medicare Advantage", revenuePerVisit: 285 },
    { id: "beta", name: "Plan Beta", line: "Medicaid managed care", revenuePerVisit: 190 },
    { id: "gamma", name: "Plan Gamma", line: "Medicare Advantage D-SNP", revenuePerVisit: 320 },
    { id: "delta", name: "Plan Delta", line: "ACA Marketplace", revenuePerVisit: 165 },
  ];

  const markets = [
    { id: "atl", name: "Atlanta", state: "GA" },
    { id: "hou", name: "Houston", state: "TX" },
    { id: "phx", name: "Phoenix", state: "AZ" },
    { id: "tpa", name: "Tampa", state: "FL" },
    { id: "clt", name: "Charlotte", state: "NC" },
    { id: "cmh", name: "Columbus", state: "OH" },
  ];

  // weekly members assigned for outreach (week 1 baseline) by plan × market; 0 = not contracted there
  const baseAssigned = {
    alpha: { atl: 520, hou: 610, phx: 380, tpa: 450, clt: 300, cmh: 260 },
    beta: { atl: 340, hou: 480, phx: 0, tpa: 290, clt: 0, cmh: 310 },
    gamma: { atl: 210, hou: 260, phx: 240, tpa: 300, clt: 220, cmh: 0 },
    delta: { atl: 180, hou: 0, phx: 160, tpa: 0, clt: 190, cmh: 150 },
  };

  // market-level rate profiles (the stories live here)
  const marketProfile = {
    atl: { contact: 0.54, schedule: 0.5, show: 0.85, qa: 0.95 },
    hou: { contact: 0.5, schedule: 0.37, show: 0.83, qa: 0.94 },
    phx: { contact: 0.52, schedule: 0.48, show: 0.71, qa: 0.95 },
    tpa: { contact: 0.55, schedule: 0.5, show: 0.86, qa: 0.95 },
    clt: { contact: 0.53, schedule: 0.47, show: 0.8, qa: 0.95 },
    cmh: { contact: 0.56, schedule: 0.51, show: 0.87, qa: 0.96 },
  };
  const planAdj = {
    alpha: { contact: 0.0, schedule: 0.02, show: 0.01 },
    beta: { contact: -0.06, schedule: -0.03, show: -0.04 },
    gamma: { contact: 0.02, schedule: 0.03, show: 0.0 },
    delta: { contact: -0.04, schedule: -0.02, show: -0.02 },
  };

  // ---------- weekly member-engagement funnel ----------
  // one row per week × plan × market (where contracted)
  const weekly = [];
  weeks.forEach((w) => {
    const growth = Math.pow(1.011, w.index); // ~33% growth over 26 weeks
    const postChange = w.index >= 13; // week 14 onward: scheduling-system change
    plans.forEach((p) => {
      markets.forEach((m) => {
        const base = baseAssigned[p.id][m.id];
        if (!base) return;
        const mp = marketProfile[m.id];
        const pa = planAdj[p.id];
        const assigned = round(jitter(base * growth, 0.06));
        const attempts = round(assigned * jitter(2.35, 0.05));
        const contactRate = clamp(jitter(mp.contact + pa.contact, 0.04), 0.3, 0.75);
        const reached = round(assigned * contactRate);
        let schedRate = mp.schedule + pa.schedule - (postChange ? 0.035 : 0);
        schedRate = clamp(jitter(schedRate, 0.05), 0.2, 0.7);
        const scheduled = round(reached * schedRate);
        const cancelRate = clamp(jitter(0.065, 0.15), 0.03, 0.12);
        let showRate = mp.show + pa.show;
        if (m.id === "clt" && w.index >= 16) showRate -= 0.03; // capacity squeeze → longer lead times
        showRate = clamp(jitter(showRate, 0.03), 0.5, 1 - cancelRate);
        const held = round(scheduled * showRate);
        const cancels = round(scheduled * cancelRate);
        const noShows = Math.max(0, scheduled - held - cancels);
        const completed = round(held * clamp(jitter(0.955, 0.015), 0.9, 0.99));
        const chartsSubmitted = round(completed * clamp(jitter(0.985, 0.01), 0.95, 1));
        let qa = mp.qa;
        if (m.id === "tpa" && w.index >= 20) qa -= 0.1 - (w.index - 20) * 0.004;
        const chartsPassedQA = round(chartsSubmitted * clamp(jitter(qa, 0.012), 0.7, 0.995));
        const billed = chartsPassedQA;
        weekly.push({
          week: w.label, weekIndex: w.index, weekStart: w.start,
          plan: p.id, market: m.id,
          assigned, attempts, reached, scheduled, held, cancels, noShows, completed,
          chartsSubmitted, chartsPassedQA, billed,
          revenue: billed * p.revenuePerVisit,
        });
      });
    });
  });

  // ---------- call center ----------
  const firstNames = ["Avery", "Jordan", "Morgan", "Riley", "Casey", "Quinn", "Rowan", "Skyler", "Dakota", "Reese", "Emerson", "Finley", "Harper", "Jules", "Kai", "Logan", "Marlowe", "Noel", "Parker", "Sage", "Tatum", "Blake", "Camden", "Devon", "Ellis", "Hayden", "Jesse", "Lennon", "Micah", "Oakley", "Peyton", "Remy"];
  const lastInitials = "ABCDEFGHJKLMNPRSTVW".split("");
  const usedNames = new Set();
  function personName() {
    let n;
    do { n = pick(firstNames) + " " + pick(lastInitials) + "."; } while (usedNames.has(n));
    usedNames.add(n);
    return n;
  }

  const teams = ["Outreach — English", "Outreach — Bilingual", "Scheduling & Escalations"];
  const agents = Array.from({ length: 22 }, (_, i) => {
    const team = i < 13 ? teams[0] : i < 18 ? teams[1] : teams[2];
    const tenureMonths = round(between(2, 40));
    const skill = clamp((tenureMonths / 40) * 0.6 + rand() * 0.4, 0, 1);
    return {
      id: "AG" + String(101 + i),
      name: personName(),
      team,
      tenureMonths,
      callsPerWeek: round(between(260, 340) * (team === teams[2] ? 0.7 : 1)),
      ahtSec: round(520 - skill * 160 + between(-20, 20)),
      acwSec: round(150 - skill * 60 + between(-10, 10)),
      fcr: +clamp(0.62 + skill * 0.22 + between(-0.03, 0.03), 0.5, 0.92).toFixed(3),
      schedConv: +clamp(0.36 + skill * 0.18 + between(-0.03, 0.03), 0.25, 0.62).toFixed(3),
      qaScore: round(clamp(78 + skill * 18 + between(-4, 4), 70, 99)),
    };
  });

  const callWeekly = weeks.map((w) => {
    const rows = weekly.filter((r) => r.weekIndex === w.index);
    const attempts = rows.reduce((s, r) => s + r.attempts, 0);
    const reached = rows.reduce((s, r) => s + r.reached, 0);
    const scheduled = rows.reduce((s, r) => s + r.scheduled, 0);
    const post = w.index >= 13;
    const inbound = round(attempts * jitter(0.16, 0.05));
    const abandonRate = clamp(jitter(post ? 0.094 : 0.061, 0.08), 0.03, 0.16);
    return {
      week: w.label, weekIndex: w.index, weekStart: w.start,
      outboundAttempts: attempts,
      connects: reached,
      inboundCalls: inbound,
      abandonRate: +abandonRate.toFixed(3),
      asaSec: round(jitter(post ? 74 : 41, 0.1)),
      ahtSec: round(jitter(post ? 468 : 412, 0.025)),
      acwSec: round(jitter(post ? 138 : 96, 0.04)),
      scheduleConversion: +(scheduled / reached).toFixed(3),
      agentsOnShift: round(jitter(19, 0.05)),
    };
  });

  // ---------- clinicians (last 4 weeks) ----------
  const clinicianMix = { atl: 5, hou: 6, phx: 4, tpa: 5, clt: 3, cmh: 3 };
  const clinicians = [];
  let cn = 0;
  markets.forEach((m) => {
    for (let i = 0; i < clinicianMix[m.id]; i++) {
      cn++;
      const tele = i === clinicianMix[m.id] - 1; // one telehealth NP per market
      const slotsPerDay = tele ? 11 : 7;
      const daysWorked = round(between(17, 20));
      const capacity = slotsPerDay * daysWorked;
      let util = between(0.74, 0.9);
      if (m.id === "clt") util = between(0.95, 0.99);
      if (m.id === "phx" && !tele) util = between(0.62, 0.72);
      const scheduled = round(capacity * util);
      const showRate = m.id === "phx" ? between(0.69, 0.75) : m.id === "clt" ? between(0.78, 0.82) : between(0.82, 0.89);
      const completed = round(scheduled * showRate * between(0.94, 0.97));
      const newHire = m.id === "tpa" && i >= 3;
      clinicians.push({
        id: "CL" + String(200 + cn),
        name: (tele ? "NP " : pick(["NP ", "NP ", "RN "])) + personName(),
        market: m.id,
        modality: tele ? "Telehealth" : "In-home",
        tenureMonths: newHire ? round(between(1, 3)) : round(between(6, 48)),
        daysWorked,
        slotsPerDay,
        capacity,
        scheduled,
        completed,
        sameDayCancels: round(scheduled * between(0.03, 0.08)),
        avgVisitMin: round(tele ? between(32, 40) : between(52, 62)),
        avgDriveMin: tele ? 0 : round(m.id === "phx" ? between(44, 56) : m.id === "hou" ? between(34, 42) : between(22, 32)),
        avgDocMin: round(newHire ? between(38, 46) : between(22, 32)),
        chartLagHrs: round(newHire ? between(40, 60) : between(12, 26)),
        qaPassRate: +(newHire ? between(0.78, 0.85) : between(0.93, 0.98)).toFixed(3),
      });
    }
  });

  // ---------- appointment-level records (last 12 weeks) ----------
  const visitTypes = ["In-home assessment", "Telehealth assessment", "Care-gap visit"];
  const channels = ["Outbound call", "Inbound call", "SMS link", "Plan referral"];
  const slots = ["8–10am", "10–12pm", "12–2pm", "2–4pm", "4–6pm"];
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const ageBands = ["<45", "45–64", "65–74", "75–84", "85+"];
  const reminderTypes = ["None", "SMS one-way", "SMS two-way", "Live call"];
  const appointments = [];
  for (let i = 0; i < 2400; i++) {
    const m = pick(markets);
    const planChoices = plans.filter((p) => baseAssigned[p.id][m.id] > 0);
    const p = pick(planChoices);
    const visitType = rand() < 0.62 ? visitTypes[0] : rand() < 0.55 ? visitTypes[1] : visitTypes[2];
    let leadDays = round(Math.max(1, -Math.log(1 - rand()) * (m.id === "phx" ? 15 : m.id === "clt" ? 17 : 9)));
    leadDays = Math.min(leadDays, 45);
    const priorNoShow = rand() < (p.id === "beta" ? 0.24 : 0.14) ? 1 : 0;
    const distanceMi = visitType === visitTypes[1] ? 0 : +(Math.max(1, -Math.log(1 - rand()) * (m.id === "phx" ? 19 : 9))).toFixed(1);
    const ageBand = p.line.startsWith("Medicare") ? pick(["65–74", "65–74", "75–84", "75–84", "85+", "45–64"]) : pick(["<45", "<45", "45–64", "45–64", "65–74"]);
    const language = m.id === "hou" ? (rand() < 0.38 ? "Spanish" : "English") : m.id === "phx" ? (rand() < 0.22 ? "Spanish" : "English") : rand() < 0.08 ? "Spanish" : "English";
    const reminder = pick(m.id === "cmh" ? ["SMS two-way", "SMS two-way", "SMS one-way", "Live call"] : reminderTypes);
    const confirmed = reminder === "SMS two-way" ? (rand() < 0.72 ? 1 : 0) : reminder === "Live call" ? (rand() < 0.8 ? 1 : 0) : 0;
    const slot = pick(slots);
    const dow = pick(days);
    const channel = pick(channels);
    // true no-show propensity (the scheduling module estimates these drivers back from outcomes)
    let z = -2.8;
    z += 0.055 * Math.min(leadDays, 30);
    z += 1.05 * priorNoShow;
    z += 0.022 * Math.min(distanceMi, 40);
    z += confirmed ? -0.95 : 0;
    z += reminder === "None" ? 0.45 : reminder === "SMS one-way" ? 0.15 : 0;
    z += slot === "8–10am" ? 0.3 : slot === "4–6pm" ? 0.18 : 0;
    z += language === "Spanish" && m.id === "hou" ? 0.35 : 0;
    z += p.id === "beta" ? 0.3 : 0;
    z += channel === "Plan referral" ? 0.25 : channel === "Inbound call" ? -0.35 : 0;
    z += dow === "Mon" ? 0.12 : 0;
    const pNoShow = sigmoid(z);
    const r = rand();
    let outcome;
    if (r < pNoShow) outcome = "No-show";
    else if (r < pNoShow + 0.055) outcome = "Cancelled";
    else if (r < pNoShow + 0.095) outcome = "Rescheduled";
    else outcome = "Completed";
    const week = weeks[WEEKS - 12 + Math.floor(rand() * 12)];
    appointments.push({
      id: "AP" + String(100000 + i),
      week: week.label, weekIndex: week.index,
      market: m.id, plan: p.id, visitType, channel,
      leadDays, priorNoShow, distanceMi, ageBand, language, reminder, confirmed,
      timeSlot: slot, dayOfWeek: dow, outcome,
    });
  }

  // ---------- call notes (unstructured text for the AI lab; synthetic PHI for redaction demos) ----------
  // truth = what a careful human reviewer would record. Intents:
  // schedule | confirm | reschedule | callback | decline | opt-out | data-correction | clinical-concern
  const callNotes = [
    { id: "CN-1001", agent: "AG104", market: "atl", plan: "alpha",
      text: "Outbound to mbr Dolores Whitfield (DOB 03/14/1951, MBR# AX55102938) at 404-555-0182. Confirmed in-home assessment Tue 10/27 10am at 2214 Peachtree Ln. Asked if NP can review her BP meds, told her to have bottles ready. No concerns.",
      truth: { intent: "confirm", barriers: [], callbackNeeded: false, escalate: false, escalationReason: null, sdoh: false } },
    { id: "CN-1002", agent: "AG109", market: "hou", plan: "beta",
      text: "Mbr Ramon Ortega DOB 07/02/1968 ID BT33019284 ph 713-555-0147 answered, speaks mostly Spanish. I don't have Spanish, he asked for a call back from someone who speaks Spanish. Prefers afternoons.",
      truth: { intent: "callback", barriers: ["language"], callbackNeeded: true, escalate: false, escalationReason: null, sdoh: false } },
    { id: "CN-1003", agent: "AG112", market: "phx", plan: "gamma",
      text: "Spoke with Gloria Benally (dob 11/30/1947, member GM77120456). Needs A1c draw at clinic but has no ride, lives alone ~35 mi out. Asked if we can do it at home instead. Moved to in-home care-gap visit 11/04 1pm.",
      truth: { intent: "reschedule", barriers: ["transportation"], callbackNeeded: false, escalate: false, escalationReason: null, sdoh: true } },
    { id: "CN-1004", agent: "AG103", market: "tpa", plan: "alpha",
      text: "Daughter Janet answered for mbr Harold Pruitt (DOB 05/09/1939, MBR# AX55190077, 813-555-0136). Harold has dementia, Janet is POA. Wants to schedule assessment on a Saturday when she is off work. Booked Sat 11/07 9am, Janet will be present.",
      truth: { intent: "schedule", barriers: ["caregiver-needed"], callbackNeeded: false, escalate: false, escalationReason: null, sdoh: false } },
    { id: "CN-1005", agent: "AG101", market: "atl", plan: "delta",
      text: "Member Kevin Adeyemi ph 470-555-0119 very upset, says he has gotten 5 calls this week and wants to be taken off the list. Says he will report us to his plan. Apologized, marked do-not-call pending supervisor review.",
      truth: { intent: "opt-out", barriers: [], callbackNeeded: false, escalate: true, escalationReason: "complaint", sdoh: false } },
    { id: "CN-1006", agent: "AG115", market: "clt", plan: "gamma",
      text: "During confirm call mbr Bernice Caldwell (DOB 02/21/1944, GM77155820) said she has had chest tightness since this morning and feels short of breath. Advised to call 911, warm transferred to on-call RN line.",
      truth: { intent: "clinical-concern", barriers: [], callbackNeeded: false, escalate: true, escalationReason: "clinical-urgent", sdoh: false } },
    { id: "CN-1007", agent: "AG106", market: "cmh", plan: "beta",
      text: "Called 614-555-0173 for mbr Thomas Greer ID BT33087710. Woman who answered said Thomas passed away in August. Expressed condolences. Needs roster update with plan.",
      truth: { intent: "data-correction", barriers: [], callbackNeeded: false, escalate: true, escalationReason: "roster-update", sdoh: false } },
    { id: "CN-1008", agent: "AG110", market: "hou", plan: "alpha",
      text: "Mbr Lakisha Monroe (DOB 09/17/1972, AX55120345) works days and can't do the 11am slot. Needs evening or weekend. Next evening slot is 2+ weeks out, she will call back when she has her schedule.",
      truth: { intent: "reschedule", barriers: ["schedule-conflict"], callbackNeeded: true, escalate: false, escalationReason: null, sdoh: false } },
    { id: "CN-1009", agent: "AG102", market: "tpa", plan: "gamma",
      text: "Mbr Walter Kim GM77140998 says he already had his annual wellness visit with his PCP Dr. Shah last month and does not want another visit. Declined. Thanked him.",
      truth: { intent: "decline", barriers: [], callbackNeeded: false, escalate: false, escalationReason: null, sdoh: false } },
    { id: "CN-1010", agent: "AG108", market: "atl", plan: "beta",
      text: "Mbr Patrice Lowe (DOB 12/03/1985, BT33044120, 678-555-0164) worried about cost. Explained visit is $0 through her plan. She agreed, scheduled telehealth assessment Thu 10/29 2pm.",
      truth: { intent: "schedule", barriers: ["cost-concern"], callbackNeeded: false, escalate: false, escalationReason: null, sdoh: false } },
    { id: "CN-1011", agent: "AG114", market: "clt", plan: "delta",
      text: "Mbr Eugene Fairley is hard of hearing, call was difficult. He asked us to text him instead at 704-555-0128. Sent SMS scheduling link, he booked in-home 11/02 10am.",
      truth: { intent: "schedule", barriers: ["accessibility"], callbackNeeded: false, escalate: false, escalationReason: null, sdoh: false } },
    { id: "CN-1012", agent: "AG105", market: "phx", plan: "alpha",
      text: "Mbr Sandra Voss (AX55177231) says she moved to Oregon in September, new address 88 Alder St Bend OR. Outside our service area. Need to update plan roster.",
      truth: { intent: "data-correction", barriers: [], callbackNeeded: false, escalate: true, escalationReason: "roster-update", sdoh: false } },
    { id: "CN-1013", agent: "AG111", market: "cmh", plan: "alpha",
      text: "Telehealth visit for mbr Arthur Bell (DOB 06/22/1949) can't happen, he has no smartphone or internet. Switched him to in-home assessment 11/05 1pm.",
      truth: { intent: "reschedule", barriers: ["technology"], callbackNeeded: false, escalate: false, escalationReason: null, sdoh: false } },
    { id: "CN-1014", agent: "AG107", market: "hou", plan: "gamma",
      text: "Mbr Francisca Delgado ph 832-555-0191 thought this was a scam call. Asked for a number she can verify with her plan first. Gave her our main line and plan member services number. She will call back.",
      truth: { intent: "callback", barriers: ["trust"], callbackNeeded: true, escalate: false, escalationReason: null, sdoh: false } },
    { id: "CN-1015", agent: "AG113", market: "tpa", plan: "beta",
      text: "Scheduled mbr Denise Holloway (BT33061187) for in-home 10/30 11am. She mentioned she can't afford groceries until the 1st and has been skipping meals. Gave her 211 info, flagged for SDOH / food resources referral.",
      truth: { intent: "schedule", barriers: ["food-insecurity"], callbackNeeded: false, escalate: true, escalationReason: "sdoh-referral", sdoh: true } },
    { id: "CN-1016", agent: "AG116", market: "hou", plan: "alpha",
      text: "Confirmed in-home visit for mbr Esperanza Ruiz (DOB 04/08/1953, AX55133309) 10/28 3pm. She asked for a Spanish-speaking nurse if possible. Noted in visit request.",
      truth: { intent: "confirm", barriers: ["language"], callbackNeeded: false, escalate: false, escalationReason: null, sdoh: false } },
  ];

  // ---------- improvement opportunity backlog (seed; the shared store starts from this) ----------
  // impact / confidence / effort: 1 (low) – 5 (high). risk: PHI / compliance exposure.
  const opportunitiesSeed = [
    { id: "OPP-01", title: "Risk-based reminders with two-way SMS confirmation", dept: "Scheduling", stage: "Pilot",
      problem: "No-shows run 14–20% in Phoenix and Charlotte; reminders are one-size-fits-all and many are one-way.",
      solution: "Score each appointment's no-show risk nightly; high-risk members get two-way SMS plus a live confirm call; unconfirmed slots release to a backfill list 24h out.",
      kpi: "Show rate", impact: 5, confidence: 4, effort: 2, risk: "Medium", hoursSavedPerMonth: 60, revenueImpactAnnual: 410000, owner: "Scheduling lead", tools: ["Twilio", "n8n", "Scheduling system API"], source: "seed" },
    { id: "OPP-02", title: "AI call-note summarization and disposition coding", dept: "Call center", stage: "Prototype",
      problem: "Agents spend 2+ min of after-call work per call writing notes and choosing dispositions; quality varies.",
      solution: "LLM drafts the note and disposition from agent bullets or transcript; agent confirms in one click; low-confidence cases route to QA.",
      kpi: "After-call work (sec)", impact: 4, confidence: 4, effort: 3, risk: "High", hoursSavedPerMonth: 310, revenueImpactAnnual: 0, owner: "Call center manager", tools: ["Claude (BAA)", "CRM", "n8n"], source: "seed" },
    { id: "OPP-03", title: "Route Spanish-preferred members to bilingual schedulers", dept: "Call center", stage: "Discovery",
      problem: "Houston reached→scheduled conversion trails the network by ~12 points; Spanish-preferred members often get callbacks that never happen.",
      solution: "Use plan language preference + first-call flag to route directly to the bilingual queue; track callback SLA.",
      kpi: "Schedule conversion (Houston)", impact: 4, confidence: 4, effort: 1, risk: "Low", hoursSavedPerMonth: 25, revenueImpactAnnual: 260000, owner: "Workforce manager", tools: ["Dialer rules", "CRM"], source: "seed" },
    { id: "OPP-04", title: "Automated monthly roster reconciliation", dept: "Finance", stage: "Backlog",
      problem: "Finance reconciles health-plan eligibility rosters against internal member files by hand in Excel (~3 days/month); termed members still get outreach.",
      solution: "Scheduled job diffs rosters, classifies exceptions (termed, moved, deceased, ID mismatch), and posts a review queue; only exceptions need a human.",
      kpi: "Reconciliation cycle time (days)", impact: 3, confidence: 5, effort: 2, risk: "Medium", hoursSavedPerMonth: 44, revenueImpactAnnual: 35000, owner: "Finance ops", tools: ["SQL", "Python/n8n", "SFTP"], source: "seed" },
    { id: "OPP-05", title: "Zip-cluster routing for in-home clinicians", dept: "Provider management", stage: "Discovery",
      problem: "Phoenix in-home clinicians average ~50 min drive per visit; schedules are booked first-come, not by geography.",
      solution: "Offer members slots that fit an existing route cluster first; cap daily drive radius per clinician.",
      kpi: "Completed visits per clinician-day", impact: 4, confidence: 3, effort: 3, risk: "Low", hoursSavedPerMonth: 120, revenueImpactAnnual: 300000, owner: "Provider ops", tools: ["Routing API", "Scheduling system"], source: "seed" },
    { id: "OPP-06", title: "Ambient AI documentation templates for assessments", dept: "Clinical", stage: "Backlog",
      problem: "New clinicians in Tampa take ~40 min per chart and QA pass rate dropped to the mid-80s.",
      solution: "Structured assessment templates plus AI-drafted narrative from visit notes; clinician signs off; QA rules check before submission.",
      kpi: "Documentation minutes per visit", impact: 5, confidence: 3, effort: 4, risk: "High", hoursSavedPerMonth: 260, revenueImpactAnnual: 220000, owner: "Clinical director", tools: ["EHR templates", "Claude (BAA)"], source: "seed" },
    { id: "OPP-07", title: "Replace the manual weekly ops deck with a live dashboard", dept: "Operations", stage: "Scaled",
      problem: "An analyst spends most of Monday building the weekly ops review in spreadsheets; numbers disagree across teams.",
      solution: "One governed funnel dataset and a dashboard with bottleneck alerts; the Monday meeting starts from exceptions, not slides.",
      kpi: "Analyst hours per week", impact: 3, confidence: 5, effort: 2, risk: "Low", hoursSavedPerMonth: 28, revenueImpactAnnual: 0, owner: "Ops analytics", tools: ["SQL", "Power BI"], source: "seed" },
    { id: "OPP-08", title: "Chart QA pre-check rules before submission", dept: "Clinical", stage: "Prototype",
      problem: "~6% of charts bounce from QA for missing required fields, which delays billing by 3–5 days.",
      solution: "Rules engine flags missing fields and inconsistent codes at sign-off; clinician fixes before it leaves the visit.",
      kpi: "QA first-pass rate", impact: 4, confidence: 4, effort: 2, risk: "Medium", hoursSavedPerMonth: 90, revenueImpactAnnual: 150000, owner: "Coding & QA lead", tools: ["EHR rules", "Zapier/n8n"], source: "seed" },
    { id: "OPP-09", title: "Health-plan onboarding checklist and handoff automation", dept: "Customer success", stage: "Backlog",
      problem: "New plan launches take 10–14 weeks; tasks live in email and one person's head; data-feed issues surface late.",
      solution: "Templated launch plan with owners, automated reminders, and a data-feed validation step in week 2.",
      kpi: "Time to first visit (days)", impact: 3, confidence: 3, effort: 2, risk: "Low", hoursSavedPerMonth: 30, revenueImpactAnnual: 90000, owner: "Customer success", tools: ["Asana/ClickUp", "Zapier"], source: "seed" },
    { id: "OPP-10", title: "Same-day cancellation backfill list", dept: "Scheduling", stage: "Backlog",
      problem: "Same-day cancellations leave open clinician slots that nobody fills.",
      solution: "Maintain an opt-in standby list by zip; on cancellation, text the nearest standby members a first-come link.",
      kpi: "Slot fill rate", impact: 3, confidence: 3, effort: 2, risk: "Medium", hoursSavedPerMonth: 15, revenueImpactAnnual: 120000, owner: "Scheduling lead", tools: ["Twilio", "Scheduling system API"], source: "seed" },
    { id: "OPP-11", title: "Self-serve plan performance reports", dept: "Customer success", stage: "Backlog",
      problem: "Account managers build monthly plan reports by hand from three exports.",
      solution: "Parameterized report per plan generated from the governed dataset, reviewed and sent by the account manager.",
      kpi: "Report prep hours", impact: 2, confidence: 5, effort: 1, risk: "Low", hoursSavedPerMonth: 20, revenueImpactAnnual: 0, owner: "Customer success", tools: ["SQL", "Power BI"], source: "seed" },
    { id: "OPP-12", title: "Credential and license expiration tracker", dept: "Provider management", stage: "Backlog",
      problem: "Clinician license and credential renewals are tracked in a spreadsheet; a lapse takes a clinician off the schedule.",
      solution: "Tracker with 90/60/30-day automated alerts to clinician and manager; dashboard of upcoming expirations.",
      kpi: "Days of lost clinician capacity", impact: 2, confidence: 4, effort: 1, risk: "Low", hoursSavedPerMonth: 8, revenueImpactAnnual: 40000, owner: "Credentialing", tools: ["Airtable/Smartsheet", "Zapier"], source: "seed" },
  ];

  OPS.data = {
    meta: {
      company: "Demo HealthCo",
      note: "Synthetic data generated in the browser for demonstration. No real members, plans or PHI.",
      asOf: "2026-10-18",
      weeks: WEEKS,
    },
    weeks, plans, markets, weekly,
    callCenter: { agents, weekly: callWeekly, teams },
    clinicians, appointments, callNotes, opportunitiesSeed,
  };

  // ---------- query helpers ----------
  // filter = { plan?: id | "all", market?: id | "all", from?: weekIndex, to?: weekIndex }
  function match(r, f) {
    f = f || {};
    if (f.plan && f.plan !== "all" && r.plan !== f.plan) return false;
    if (f.market && f.market !== "all" && r.market !== f.market) return false;
    if (f.from != null && r.weekIndex < f.from) return false;
    if (f.to != null && r.weekIndex > f.to) return false;
    return true;
  }
  const SUM_FIELDS = ["assigned", "attempts", "reached", "scheduled", "held", "cancels", "noShows", "completed", "chartsSubmitted", "chartsPassedQA", "billed", "revenue"];
  function sum(rows) {
    const t = {};
    SUM_FIELDS.forEach((k) => (t[k] = 0));
    rows.forEach((r) => SUM_FIELDS.forEach((k) => (t[k] += r[k])));
    return withRates(t);
  }
  function withRates(t) {
    const d = (a, b) => (b ? a / b : 0);
    t.contactRate = d(t.reached, t.assigned);
    t.scheduleRate = d(t.scheduled, t.reached);
    t.showRate = d(t.held, t.scheduled);
    t.noShowRate = d(t.noShows, t.scheduled);
    t.cancelRate = d(t.cancels, t.scheduled);
    t.completionRate = d(t.completed, t.held);
    t.qaPassRate = d(t.chartsPassedQA, t.chartsSubmitted);
    t.endToEnd = d(t.completed, t.assigned);
    t.attemptsPerCompleted = d(t.attempts, t.completed);
    return t;
  }

  OPS.q = {
    rows: (f) => weekly.filter((r) => match(r, f)),
    /** totals + rates for a filter */
    funnel: (f) => sum(weekly.filter((r) => match(r, f))),
    /** array (one per week in range) of totals + rates */
    byWeek: (f) => {
      const out = [];
      weeks.forEach((w) => {
        if (f && f.from != null && w.index < f.from) return;
        if (f && f.to != null && w.index > f.to) return;
        const t = sum(weekly.filter((r) => r.weekIndex === w.index && match(r, f)));
        t.week = w.label; t.weekIndex = w.index; t.weekStart = w.start;
        out.push(t);
      });
      return out;
    },
    /** dimension = "market" | "plan" → array of {id, name, ...totals+rates} */
    by: (dimension, f) => {
      const list = dimension === "plan" ? plans : markets;
      return list
        .map((d) => {
          const ff = Object.assign({}, f, { [dimension]: d.id });
          const rows = weekly.filter((r) => match(r, ff));
          if (!rows.length) return null;
          return Object.assign({ id: d.id, name: d.name }, sum(rows));
        })
        .filter(Boolean);
    },
    plan: (id) => plans.find((p) => p.id === id),
    market: (id) => markets.find((m) => m.id === id),
    marketName: (id) => (markets.find((m) => m.id === id) || {}).name || id,
    planName: (id) => (plans.find((p) => p.id === id) || {}).name || id,
  };

  // ---------- shared opportunity store (pipeline, ROI, discovery, workflow all use this) ----------
  const OPP_KEY = "throughline.opportunities.v1";
  const STAGES = ["Backlog", "Discovery", "Prototype", "Pilot", "Scaled", "Measured"];
  function readOpps() {
    try {
      const raw = localStorage.getItem(OPP_KEY);
      if (raw) {
        const v = JSON.parse(raw);
        if (Array.isArray(v)) return v;
      }
    } catch (e) { /* storage unavailable: fall back to seed */ }
    return opportunitiesSeed.map((o) => Object.assign({}, o));
  }
  let opps = readOpps();
  function persist() {
    try { localStorage.setItem(OPP_KEY, JSON.stringify(opps)); } catch (e) { /* ignore */ }
    document.dispatchEvent(new CustomEvent("ops:opps-changed"));
  }
  OPS.opps = {
    STAGES,
    all: () => opps.slice(),
    get: (id) => opps.find((o) => o.id === id) || null,
    /** insert or update by id; missing id → new id assigned. Returns the saved record. */
    save(o) {
      const rec = Object.assign({ stage: "Backlog", impact: 3, confidence: 3, effort: 3, risk: "Low", hoursSavedPerMonth: 0, revenueImpactAnnual: 0, tools: [], source: "manual" }, o);
      if (!rec.id) {
        const max = opps.reduce((m, x) => Math.max(m, parseInt(String(x.id).replace(/\D/g, ""), 10) || 0), 0);
        rec.id = "OPP-" + String(max + 1).padStart(2, "0");
        rec.createdAt = new Date().toISOString();
      }
      const i = opps.findIndex((x) => x.id === rec.id);
      if (i >= 0) opps[i] = rec; else opps.push(rec);
      persist();
      return rec;
    },
    remove(id) { opps = opps.filter((o) => o.id !== id); persist(); },
    reset() { opps = opportunitiesSeed.map((o) => Object.assign({}, o)); persist(); },
    /** canonical priority score: (impact × confidence) ÷ effort, 0.2 – 25; risk "High" applies a 15% haircut */
    score(o) {
      const s = (o.impact * o.confidence) / Math.max(1, o.effort);
      return Math.round(s * (o.risk === "High" ? 0.85 : 1) * 10) / 10;
    },
  };
})();
